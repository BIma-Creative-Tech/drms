import { sql } from '@payloadcms/db-postgres'
import { APIError, type PayloadRequest, type Where } from 'payload'

import { hasExactRole, hasRole, hasRoleAny, mappedCompanies, relId, userId, userRoles } from '@/access/roles'
import { writeAudit, writeAuditDetached } from '@/audit/writer'
import { contextCompanyId, displayNames, membersWithRole } from '@/domain/companies'
import { displayName, resolveSignature, today, type Signature } from '@/domain/expense/common'
import { notificationTemplate, pushEnabled } from '@/domain/notifications'
import { parseBusinessDate } from '@/domain/numbering'
import { allocateDocNo } from '@/domain/numbering-db'
import { formatRupiah } from '@/lib/money'
import { requestMeta } from '@/lib/request-meta'
import { searchWhere } from '@/lib/text-search'
import { getRequestTx } from '@/lib/tx'

import { mayReadLoans } from './access'
import {
  daysOverdue,
  DIREKTUR_SELF_NOTE,
  direkturPool,
  isOverdue,
  LOAN_KIND_LABELS,
  LOAN_REPAYABLE,
  LOAN_STATUS_LABELS,
  loanAllowedActions,
  loanInputErrors,
  mayDecide,
  mayVoidRepayment,
  outstandingOf,
  OVERDUE_LABEL,
  repaymentInputErrors,
  SAME_PM_NOTE,
  statusForRepaid,
  type LoanAction,
  type LoanActorContext,
  type LoanG1Exception,
  type LoanKind,
  type LoanStatus,
} from './rules'

/**
 * ADR 0022 Pinjaman antar project — the single write path behind /api/v1/project-loans. Every function runs inside
 * the caller's transaction: number allocation, status change, the Direktur decision row (`approvals`, docType
 * project_loan), repayments, audit rows and in-app notifications commit or roll back together.
 *
 * Flow: Draft (PM of the BORROWER project) → submit (number PJ/{COMPANY}/{YY}{MM}/{seq}, Direktur pool resolved, G1)
 * → Menunggu persetujuan Direktur → Disetujui | Ditolak (reason). Repayments (borrower PM / Finance, no approval,
 * ≤ outstanding) → Sebagian kembali → Lunas; void (Direktur / Finance, reason) moves the status back. Cancel: the
 * creator in Draft / Menunggu, a Direktur after approval while no repayment is posted.
 * NO cash entry is written anywhere in this module (notional allocation, ADR 0022 §5 option B).
 */

export class LoanError extends APIError {
  constructor(
    status: number,
    message: string,
    readonly pkCode: string,
    field?: string,
  ) {
    super(message, status, field ? { errors: [{ path: field, message }] } : null, true)
  }
}

const fail = (status: number, code: string, message: string, field?: string): never => {
  throw new LoanError(status, message, code, field)
}

export type LoanDoc = {
  id: number
  company?: unknown
  uuid?: string | null
  docNo?: string | null
  lenderProject: unknown
  borrowerProject: unknown
  kind: LoanKind
  amount: number
  reason: string
  loanDate: string
  dueDate: string
  status: LoanStatus
  repaidTotal?: number | null
  outstanding?: number | null
  samePm?: boolean | null
  createdBy: unknown
  submittedAt?: string | null
  decidedAt?: string | null
  decidedBy?: unknown
  rejectReason?: string | null
  cancelReason?: string | null
  approvalCycle?: number | null
  g1Exception?: LoanG1Exception | null
  source?: 'web' | 'apk' | null
  createdAt?: string
  updatedAt?: string
}

export type RepaymentDoc = {
  id: number
  loan: unknown
  repayDate: string
  amount: number
  note?: string | null
  status: 'posted' | 'void'
  voidReason?: string | null
  recordedBy: unknown
  voidedBy?: unknown
  voidedAt?: string | null
  source?: 'web' | 'apk' | null
  createdAt?: string
}

type ProjectRow = { id: number; code?: string; name?: string; status?: string | null; pm?: unknown; company?: unknown }

type DecisionRow = { id: number; cycle: number; position: string; level: number; actor?: unknown; actorName?: string | null; decision: 'approved' | 'rejected' | 'acknowledged'; reason?: string | null; decidedAt?: string | null; signatureSource?: string | null }

const repaid = (d: LoanDoc) => Math.round(Number(d.repaidTotal ?? 0))
const amountOf = (d: LoanDoc) => Math.round(Number(d.amount))

// ---------------------------------------------------------------- loading

async function lockLoan(req: PayloadRequest, id: number): Promise<void> {
  const tx = await getRequestTx(req)
  await tx.execute(sql`SELECT id FROM project_loans WHERE id = ${id} FOR UPDATE`)
}

async function loadRawLoan(req: PayloadRequest, id: number): Promise<LoanDoc> {
  return (await req.payload.findByID({ collection: 'project-loans', id, depth: 0, overrideAccess: true /* SYSTEM-READ: after the visibility check */, req })) as unknown as LoanDoc
}

/** A loan the CALLER may read (collection access), else 404 (no existence leak). */
export async function loadVisibleLoan(req: PayloadRequest, id: number, opts: { lock?: boolean } = {}): Promise<LoanDoc> {
  if (!Number.isSafeInteger(id) || id <= 0 || !mayReadLoans(req)) fail(404, 'NOT_FOUND', 'Pinjaman tidak ditemukan.')
  if (opts.lock) await lockLoan(req, id)
  const doc = (await req.payload
    .findByID({ collection: 'project-loans', id, depth: 0, user: req.user, overrideAccess: false /* caller's read scope */, req })
    .catch(() => null)) as LoanDoc | null
  if (!doc) fail(404, 'NOT_FOUND', 'Pinjaman tidak ditemukan.')
  return doc!
}

async function loadProject(req: PayloadRequest, projectId: number, path: string): Promise<ProjectRow> {
  const p = (await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, overrideAccess: true /* SYSTEM-READ: PT / PM / status (caller checked) */, req, disableErrors: true })) as ProjectRow | null
  if (!p) fail(404, 'NOT_FOUND', 'Project tidak ditemukan.', path)
  return p!
}

async function decisionsOf(req: PayloadRequest, loanId: number): Promise<DecisionRow[]> {
  const res = await req.payload.find({
    collection: 'approvals',
    where: { and: [{ docType: { equals: 'project_loan' } }, { loan: { equals: loanId } }] },
    depth: 0,
    pagination: false,
    sort: 'id',
    overrideAccess: true, // SYSTEM-READ: decision rows of a loan the caller may read
    req,
  })
  return res.docs as unknown as DecisionRow[]
}

export async function repaymentsOf(req: PayloadRequest, loanId: number): Promise<RepaymentDoc[]> {
  const res = await req.payload.find({
    collection: 'project-loan-repayments',
    where: { loan: { equals: loanId } },
    depth: 0,
    pagination: false,
    sort: 'id',
    overrideAccess: true, // SYSTEM-READ: repayments of a loan the caller may read
    req,
  })
  return res.docs as unknown as RepaymentDoc[]
}

/** Caller = `projects.pm` of the borrower project AND holds pk-pm in the loan's PT (ADR 0022 §3). */
async function isBorrowerPm(req: PayloadRequest, borrower: ProjectRow, company: number | undefined): Promise<boolean> {
  const uid = userId(req)
  return uid !== undefined && relId(borrower.pm) === uid && hasRole(req, 'pk-pm', company ?? relId(borrower.company))
}

export async function actorContext(req: PayloadRequest, doc: LoanDoc, repayments?: RepaymentDoc[]): Promise<LoanActorContext> {
  const uid = userId(req) ?? -1
  const company = relId(doc.company)
  const borrower = await loadProject(req, relId(doc.borrowerProject)!, 'borrowerProjectId')
  // ADR 0016 §5: roles IN THE LOAN's PT
  const isDirektur = hasRole(req, 'pk-owner', company)
  // ADR 0026: loans stay Direktur-only — the decision pool is the STORED Direktur role (the Owner sees and may cancel /
  // void like a Direktur, but never approves or rejects a loan)
  const decides = hasExactRole(req, 'pk-owner', company)
  const posted = (repayments ?? (repaid(doc) > 0 ? await repaymentsOf(req, doc.id) : [])).some((r) => r.status === 'posted')
  return {
    status: doc.status,
    isCreator: relId(doc.createdBy) === uid,
    isBorrowerPm: await isBorrowerPm(req, borrower, company),
    isDirektur,
    isFinance: hasRole(req, 'pk-finance', company),
    mayDecide: mayDecide({ callerId: uid, creatorId: relId(doc.createdBy) ?? -2, callerIsDirektur: decides, g1Exception: doc.g1Exception ?? null }),
    hasRepayment: posted || repaid(doc) > 0,
  }
}

// ---------------------------------------------------------------- guards

const DECISIONS: ReadonlySet<LoanAction> = new Set<LoanAction>(['approve', 'reject'])

/** 403 not allowed (checked first, E9), 409 wrong status; refused decisions are audited (`access_denied`, own transaction). */
async function requireAction(req: PayloadRequest, doc: LoanDoc, action: LoanAction): Promise<LoanActorContext> {
  const ctx = await actorContext(req, doc)
  if (loanAllowedActions(ctx).includes(action)) return ctx
  const decision = DECISIONS.has(action)
  if (decision) {
    const direktur = hasExactRole(req, 'pk-owner', relId(doc.company)) // ADR 0026: the Owner does not decide loans
    const reason = !direktur
      ? 'hanya Direktur PT yang memutuskan pinjaman antar project (ADR 0022 §4, ADR 0026)'
      : ctx.isCreator
        ? 'pembuat pinjaman tidak boleh memutuskan pinjamannya sendiri (G1; ada Direktur lain)'
        : 'bukan langkah keputusan'
    await writeAuditDetached(req, [{ action: 'access_denied', docType: 'project_loan', docId: String(doc.id), docNo: doc.docNo ?? undefined, field: action, newValue: { action, status: doc.status, roles: userRoles(req) }, reason }])
    if (!direktur) fail(403, 'FORBIDDEN', 'Hanya Direktur yang dapat menyetujui atau menolak pinjaman antar project.')
    if (ctx.isCreator && !ctx.mayDecide) fail(403, 'FORBIDDEN', 'Pembuat pinjaman tidak dapat memutuskan pinjamannya sendiri. Direktur lain yang memutuskan.')
    if (doc.status !== 'pending_approval') fail(409, 'STATE_CONFLICT', `Aksi tidak dapat dilakukan pada status pinjaman saat ini (${LOAN_STATUS_LABELS[doc.status]}).`)
    return fail(403, 'FORBIDDEN', 'Anda tidak berhak memutuskan pinjaman ini.')
  }
  if (action === 'repay') {
    if (!ctx.isBorrowerPm && !ctx.isFinance) fail(403, 'FORBIDDEN', 'Pengembalian dicatat oleh PM project peminjam atau Finance.')
    return fail(409, 'STATE_CONFLICT', `Pengembalian hanya untuk pinjaman yang sudah disetujui dan belum lunas (status: ${LOAN_STATUS_LABELS[doc.status]}).`)
  }
  if (action === 'cancel') {
    if (!ctx.isCreator && !ctx.isDirektur) fail(403, 'FORBIDDEN', 'Hanya pembuat (sebelum diputuskan) atau Direktur (setelah disetujui) yang dapat membatalkan pinjaman.')
    if (ctx.status === 'approved' && ctx.hasRepayment) fail(409, 'STATE_CONFLICT', 'Pinjaman yang sudah ada pengembaliannya tidak dapat dibatalkan.')
    return fail(409, 'STATE_CONFLICT', `Pinjaman tidak dapat dibatalkan pada status ${LOAN_STATUS_LABELS[doc.status]}.`)
  }
  // edit / submit
  if (!ctx.isCreator) fail(403, 'FORBIDDEN', 'Hanya pembuat yang dapat mengubah atau mengajukan pinjaman ini.')
  if (doc.status !== 'draft') fail(409, 'STATE_CONFLICT', `Aksi tidak dapat dilakukan pada status pinjaman saat ini (${LOAN_STATUS_LABELS[doc.status]}).`)
  return fail(403, 'FORBIDDEN', 'Pinjaman diajukan oleh PM project peminjam. Anda bukan lagi PM project ini.')
}

async function updateLoan(req: PayloadRequest, id: number, data: Record<string, unknown>, reason?: string): Promise<LoanDoc> {
  if (reason) req.context.auditReason = reason
  try {
    return (await req.payload.update({
      collection: 'project-loans',
      id,
      data: data as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: loan state machine after the guards above
      req,
    })) as unknown as LoanDoc
  } finally {
    delete req.context.auditReason
  }
}

// ---------------------------------------------------------------- notifications

export type LoanEvent = 'project_loan.pending' | 'project_loan.submitted' | 'project_loan.approved' | 'project_loan.rejected' | 'project_loan.repaid' | 'project_loan.overdue'

export const LOAN_NOTIFICATION_DEFAULTS: Record<LoanEvent, { title: string; body: string }> = {
  'project_loan.pending': { title: 'Persetujuan Direktur: {docNo}', body: 'Pinjaman antar project {docNo}: {borrower} meminjam {amount} dari {lender}. Menunggu persetujuan Anda sebagai Direktur.' },
  'project_loan.submitted': { title: 'Project Anda dipinjam: {docNo}', body: 'Pinjaman antar project {docNo}: {borrower} meminjam {amount} dari project Anda {lender}. Direktur yang memutuskan.' },
  'project_loan.approved': { title: 'Pinjaman disetujui: {docNo}', body: 'Pinjaman antar project {docNo} ({borrower} dari {lender}, {amount}) disetujui Direktur. Jatuh tempo {dueDate}.' },
  'project_loan.rejected': { title: 'Pinjaman ditolak: {docNo}', body: 'Pinjaman antar project {docNo} ({borrower} dari {lender}) ditolak. Lihat alasan di detail pinjaman.' },
  'project_loan.repaid': { title: 'Pengembalian pinjaman: {docNo}', body: 'Pengembalian {payment} untuk pinjaman {docNo} ({borrower} ke {lender}) dicatat. Sisa pinjaman {outstanding}.' },
  'project_loan.overdue': { title: 'Pinjaman terlambat: {docNo}', body: 'Pinjaman antar project {docNo} ({borrower} dari {lender}) lewat jatuh tempo {dueDate} ({days} hari). Sisa {outstanding}.' },
}

export function loanVars(doc: Pick<LoanDoc, 'id' | 'docNo' | 'amount' | 'dueDate' | 'repaidTotal'>, lender: ProjectRow | undefined, borrower: ProjectRow | undefined, extra: Record<string, string> = {}): Record<string, string> {
  const name = (p?: ProjectRow) => `${p?.code ?? ''} ${p?.name ?? ''}`.trim()
  return {
    docNo: doc.docNo ?? `#${doc.id}`,
    lender: name(lender),
    borrower: name(borrower),
    amount: formatRupiah(Number(doc.amount)),
    dueDate: doc.dueDate,
    outstanding: formatRupiah(outstandingOf(Number(doc.amount), Number(doc.repaidTotal ?? 0))),
    ...extra,
  }
}

export const renderLoanText = (s: string, vars: Record<string, string>) => s.replace(/\{([a-zA-Z]+)\}/g, (_, k: string) => vars[k] ?? '')

async function notify(req: PayloadRequest, doc: LoanDoc, event: LoanEvent, to: Iterable<number>, vars: Record<string, string>): Promise<void> {
  const actor = userId(req)
  const t = await notificationTemplate(req, event, LOAN_NOTIFICATION_DEFAULTS[event])
  for (const uid of new Set(to)) {
    if (uid === actor) continue
    await req.payload.create({
      collection: 'notifications',
      data: {
        user: uid,
        event,
        title: renderLoanText(t.title, vars).slice(0, 160),
        body: renderLoanText(t.body, vars).slice(0, 1000),
        docType: 'project_loan',
        docId: String(doc.id),
        docNo: doc.docNo ?? null,
        company: relId(doc.company) ?? null, // ADR 0016 §4
        pushStatus: pushEnabled() ? 'pending' : 'skipped',
      } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: in-app notification of a committed-together transition
      req,
    })
  }
}

/** Active Direktur (pk-owner) of the loan's PT. */
async function direkturOf(req: PayloadRequest, company: number): Promise<number[]> {
  return membersWithRole(req, 'pk-owner', company)
}

/** Lender PM (projects.pm of the lender) when he is a member of the PT; [] when unset. */
const pmOf = (p: ProjectRow): number[] => {
  const pm = relId(p.pm)
  return pm === undefined ? [] : [pm]
}

// ---------------------------------------------------------------- create / edit / submit / cancel

export type LoanInput = { lenderProjectId: number; borrowerProjectId: number; kind?: LoanKind; amount: number; reason: string; loanDate?: string; dueDate: string; submit?: boolean }

function check(input: Parameters<typeof loanInputErrors>[0], todayStr: string): void {
  const errs = loanInputErrors(input, todayStr)
  if (errs.length > 0) throw new LoanError(400, errs[0]!.message, 'VALIDATION', errs[0]!.path)
}

/** Q-L2: both projects in the same PT, open (not archived). Same answer for a project of an unmapped PT as for a missing one. */
async function checkProjects(req: PayloadRequest, lenderId: number, borrowerId: number): Promise<{ lender: ProjectRow; borrower: ProjectRow; company: number }> {
  const borrower = await loadProject(req, borrowerId, 'borrowerProjectId')
  const lender = await loadProject(req, lenderId, 'lenderProjectId')
  const mapped = mappedCompanies(req)
  const company = relId(borrower.company)!
  if (mapped !== null && !mapped.includes(company)) fail(404, 'NOT_FOUND', 'Project tidak ditemukan.', 'borrowerProjectId')
  if (relId(lender.company) !== company) fail(400, 'COMPANY_MISMATCH', 'Project pemberi dan peminjam harus di PT yang sama.', 'lenderProjectId')
  if (borrower.status === 'arsip') fail(409, 'STATE_CONFLICT', 'Project peminjam sudah diarsipkan.', 'borrowerProjectId')
  if (lender.status === 'arsip') fail(409, 'STATE_CONFLICT', 'Project pemberi pinjaman sudah diarsipkan.', 'lenderProjectId')
  return { lender, borrower, company }
}

async function deniedCreate(req: PayloadRequest, borrowerId: number): Promise<never> {
  await writeAuditDetached(req, [{ action: 'access_denied', docType: 'project_loan', field: 'create', newValue: { borrowerProjectId: borrowerId }, reason: 'pinjaman antar project diajukan oleh PM project peminjam (ADR 0022 §3, D6)' }])
  return fail(403, 'FORBIDDEN', 'Pinjaman antar project hanya dapat diajukan oleh PM project peminjam.', 'borrowerProjectId')
}

/** D6: the PM of the borrower project creates a Draft (and submits it at once with `submit: true`). */
export async function createLoan(req: PayloadRequest, input: LoanInput): Promise<LoanDoc> {
  const uid = userId(req)
  if (uid === undefined) fail(401, 'FORBIDDEN', 'Unauthorized')
  if (!Number.isSafeInteger(input.borrowerProjectId) || input.borrowerProjectId <= 0) fail(400, 'VALIDATION', 'Project peminjam wajib dipilih.', 'borrowerProjectId')
  const borrower = await loadProject(req, input.borrowerProjectId, 'borrowerProjectId')
  const mapped = mappedCompanies(req)
  if (mapped !== null && !mapped.includes(relId(borrower.company) ?? -1)) fail(404, 'NOT_FOUND', 'Project tidak ditemukan.', 'borrowerProjectId')
  if (!(await isBorrowerPm(req, borrower, relId(borrower.company)))) await deniedCreate(req, input.borrowerProjectId)
  const company = relId(borrower.company)!
  const todayStr = await today(req, company)
  const data = { ...input, kind: input.kind ?? 'dana', loanDate: input.loanDate ?? todayStr }
  check(data, todayStr)
  await checkProjects(req, data.lenderProjectId, data.borrowerProjectId)
  const doc = (await req.payload.create({
    collection: 'project-loans',
    data: {
      lenderProject: data.lenderProjectId,
      borrowerProject: data.borrowerProjectId,
      kind: data.kind,
      amount: data.amount,
      reason: data.reason.trim(),
      loanDate: data.loanDate,
      dueDate: data.dueDate,
      status: 'draft',
      repaidTotal: 0,
      outstanding: data.amount,
      createdBy: uid!,
      approvalCycle: 0,
      source: requestMeta(req).source === 'apk' ? 'apk' : 'web',
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: loan after the role/scope checks above (HTTP create is closed)
    req,
  })) as unknown as LoanDoc
  return input.submit ? submitLoan(req, doc.id) : doc
}

export type LoanPatch = { lenderProjectId?: number; kind?: LoanKind; amount?: number; reason?: string; loanDate?: string; dueDate?: string }

/** Draft edit by its creator (still PM of the borrower project). The borrower project is fixed (create a new loan). */
export async function editLoan(req: PayloadRequest, id: number, patch: LoanPatch): Promise<LoanDoc> {
  const doc = await loadVisibleLoan(req, id, { lock: true })
  await requireAction(req, doc, 'edit')
  const next = {
    lenderProjectId: patch.lenderProjectId ?? relId(doc.lenderProject)!,
    borrowerProjectId: relId(doc.borrowerProject)!,
    kind: patch.kind ?? doc.kind,
    amount: patch.amount ?? amountOf(doc),
    reason: patch.reason ?? doc.reason,
    loanDate: patch.loanDate ?? doc.loanDate,
    dueDate: patch.dueDate ?? doc.dueDate,
  }
  check(next, await today(req, relId(doc.company)))
  await checkProjects(req, next.lenderProjectId, next.borrowerProjectId)
  const data: Record<string, unknown> = {}
  if (next.lenderProjectId !== relId(doc.lenderProject)) data.lenderProject = next.lenderProjectId
  if (next.kind !== doc.kind) data.kind = next.kind
  if (next.amount !== amountOf(doc)) Object.assign(data, { amount: next.amount, outstanding: next.amount })
  if (next.reason.trim() !== doc.reason) data.reason = next.reason.trim()
  if (next.loanDate !== doc.loanDate) data.loanDate = next.loanDate
  if (next.dueDate !== doc.dueDate) data.dueDate = next.dueDate
  if (Object.keys(data).length === 0) return doc
  return updateLoan(req, id, data)
}

/** Draft → Menunggu persetujuan Direktur: inputs re-checked, Direktur pool (G1), number PJ/… at the loan date. */
export async function submitLoan(req: PayloadRequest, id: number): Promise<LoanDoc> {
  const visible = await loadVisibleLoan(req, id, { lock: true })
  await requireAction(req, visible, 'submit')
  const doc = await loadRawLoan(req, id)
  const company = relId(doc.company) ?? (await contextCompanyId(req))
  const todayStr = await today(req, company)
  check({ lenderProjectId: relId(doc.lenderProject), borrowerProjectId: relId(doc.borrowerProject), kind: doc.kind, amount: amountOf(doc), reason: doc.reason, loanDate: doc.loanDate, dueDate: doc.dueDate }, todayStr)
  const { lender, borrower } = await checkProjects(req, relId(doc.lenderProject)!, relId(doc.borrowerProject)!)
  const creator = relId(doc.createdBy)!
  const { pool, exception } = direkturPool(creator, await direkturOf(req, company))
  if (pool.length === 0) fail(409, 'NO_DIREKTUR', 'PT ini belum punya Direktur aktif untuk menyetujui pinjaman. Hubungi Admin.')
  const docNo = doc.docNo ?? (await allocateDocNo(req, 'project_loan', { companyId: company, date: parseBusinessDate(doc.loanDate), docId: String(id) })).docNo
  const samePm = relId(lender.pm) !== undefined && relId(lender.pm) === relId(borrower.pm)
  const updated = await updateLoan(req, id, {
    status: 'pending_approval',
    docNo,
    submittedAt: new Date().toISOString(),
    approvalCycle: 1,
    g1Exception: exception,
    samePm,
    outstanding: amountOf(doc),
  })
  if (exception) {
    await writeAudit(req, [
      {
        action: 'approval_policy_exception',
        docType: 'project_loan',
        docId: String(id),
        docNo,
        field: 'g1Exception',
        newValue: { exception, creator, pool },
        reason: `${DIREKTUR_SELF_NOTE} (ADR 0022 §4, Q-L5)`,
      },
    ])
  }
  const vars = loanVars(updated, lender, borrower)
  await notify(req, updated, 'project_loan.pending', pool, vars)
  if (!samePm) await notify(req, updated, 'project_loan.submitted', pmOf(lender).filter((x) => !pool.includes(x)), vars)
  return updated
}

/** Cancel (reason required): the creator in Draft / Menunggu; a Direktur after approval while nothing is repaid. */
export async function cancelLoan(req: PayloadRequest, id: number, reason: string): Promise<LoanDoc> {
  const doc = await loadVisibleLoan(req, id, { lock: true })
  await requireAction(req, doc, 'cancel')
  const r = reason.trim()
  const cancelled = await updateLoan(req, id, { status: 'cancelled', cancelReason: r, outstanding: 0 }, r)
  if (doc.status === 'approved') {
    const lender = await loadProject(req, relId(doc.lenderProject)!, 'lenderProjectId')
    const borrower = await loadProject(req, relId(doc.borrowerProject)!, 'borrowerProjectId')
    await notify(req, cancelled, 'project_loan.rejected', [relId(doc.createdBy)!, ...pmOf(lender)], loanVars(cancelled, lender, borrower))
  }
  return cancelled
}

// ---------------------------------------------------------------- decision (one Direktur level)

type SignOpts = { signatureMediaId?: number | null }

async function insertDecision(req: PayloadRequest, doc: LoanDoc, decision: 'approved' | 'rejected', reason: string | null, signature: Signature | null): Promise<void> {
  const caller = userId(req)!
  const meta = requestMeta(req)
  await req.payload.create({
    collection: 'approvals',
    data: {
      docType: 'project_loan',
      loan: doc.id,
      cycle: doc.approvalCycle ?? 1,
      position: 'approval',
      level: 1,
      actor: caller,
      actorName: await displayName(req, caller),
      onBehalf: false,
      decision,
      reason,
      signature: signature?.mediaId ?? null,
      signatureSha256: signature?.sha256 ?? null,
      signatureSource: signature ? signature.source : 'none',
      deviceId: meta.deviceId ?? null,
      source: meta.source,
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: Class A decision row after the guards (G1; DB re-checks)
    req,
  })
  await writeAudit(req, [
    {
      action: decision === 'approved' ? 'approve' : 'reject',
      docType: 'project_loan',
      docId: String(doc.id),
      docNo: doc.docNo ?? undefined,
      field: 'approval',
      newValue: { decision, amount: amountOf(doc), g1Exception: doc.g1Exception ?? null, selfDecision: caller === relId(doc.createdBy), signatureSource: signature?.source ?? 'none' },
      reason: reason ?? undefined,
    },
  ])
}

async function decide(req: PayloadRequest, id: number, decision: 'approved' | 'rejected', reason: string | null, opts: SignOpts): Promise<LoanDoc> {
  const visible = await loadVisibleLoan(req, id, { lock: true })
  await requireAction(req, visible, decision === 'approved' ? 'approve' : 'reject')
  const doc = await loadRawLoan(req, id)
  const lender = await loadProject(req, relId(doc.lenderProject)!, 'lenderProjectId')
  const borrower = await loadProject(req, relId(doc.borrowerProject)!, 'borrowerProjectId')
  if (decision === 'approved' && (lender.status === 'arsip' || borrower.status === 'arsip')) fail(409, 'STATE_CONFLICT', 'Project sudah diarsipkan; pinjaman tidak dapat disetujui.')
  const sig = await resolveSignature(req, userId(req)!, opts.signatureMediaId)
  await insertDecision(req, doc, decision, reason, sig)
  const now = new Date().toISOString()
  const updated =
    decision === 'approved'
      ? await updateLoan(req, id, { status: 'approved', decidedAt: now, decidedBy: userId(req), outstanding: amountOf(doc) })
      : await updateLoan(req, id, { status: 'rejected', decidedAt: now, decidedBy: userId(req), rejectReason: reason, outstanding: 0 }, reason ?? undefined)
  await notify(req, updated, decision === 'approved' ? 'project_loan.approved' : 'project_loan.rejected', [relId(doc.createdBy)!, ...pmOf(lender)], loanVars(updated, lender, borrower))
  return updated
}

export const approveLoan = (req: PayloadRequest, id: number, opts: SignOpts = {}) => decide(req, id, 'approved', null, opts)
export const rejectLoan = (req: PayloadRequest, id: number, reason: string, opts: SignOpts = {}) => decide(req, id, 'rejected', reason.trim(), opts)

// ---------------------------------------------------------------- repayments

/** Recomputes repaidTotal / outstanding / status from the POSTED repayments (row lock on the loan held by the caller). */
async function applyRepayments(req: PayloadRequest, doc: LoanDoc, reason?: string): Promise<LoanDoc> {
  const rows = await repaymentsOf(req, doc.id)
  const total = rows.filter((r) => r.status === 'posted').reduce((s, r) => s + Math.round(Number(r.amount)), 0)
  const amount = amountOf(doc)
  if (total > amount) fail(409, 'OVER_REPAID', 'Total pengembalian melebihi nilai pinjaman.', 'amount')
  return updateLoan(req, doc.id, { repaidTotal: total, outstanding: outstandingOf(amount, total), status: statusForRepaid(amount, total) }, reason)
}

export type RepaymentInput = { amount: number; repayDate?: string; note?: string | null }

/** ADR 0022 §7 (Q-L7): borrower PM or Finance records a (partial) repayment; no approval; ≤ outstanding. */
export async function addRepayment(req: PayloadRequest, id: number, input: RepaymentInput): Promise<LoanDoc> {
  const doc = await loadVisibleLoan(req, id, { lock: true }) // serialises concurrent repayments
  await requireAction(req, doc, 'repay')
  const fresh = await loadRawLoan(req, id)
  const company = relId(fresh.company)!
  const todayStr = await today(req, company)
  const repayDate = input.repayDate ?? todayStr
  const outstanding = outstandingOf(amountOf(fresh), repaid(fresh))
  const errs = repaymentInputErrors({ amount: input.amount, repayDate, note: input.note ?? undefined }, { loanDate: fresh.loanDate, outstanding }, todayStr)
  if (errs.length > 0) throw new LoanError(400, errs[0]!.message, 'VALIDATION', errs[0]!.path)
  await req.payload.create({
    collection: 'project-loan-repayments',
    data: {
      loan: id,
      repayDate,
      amount: input.amount,
      note: input.note?.trim() || null,
      status: 'posted',
      recordedBy: userId(req)!,
      source: requestMeta(req).source === 'apk' ? 'apk' : 'web',
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: append-only repayment after the role check above (no cash entry, ADR 0022 §5)
    req,
  })
  const updated = await applyRepayments(req, fresh)
  const lender = await loadProject(req, relId(fresh.lenderProject)!, 'lenderProjectId')
  const borrower = await loadProject(req, relId(fresh.borrowerProject)!, 'borrowerProjectId')
  await notify(req, updated, 'project_loan.repaid', [...(await direkturOf(req, company)), ...pmOf(lender)], loanVars(updated, lender, borrower, { payment: formatRupiah(input.amount) }))
  return updated
}

/** Void of a posted repayment (Direktur / Finance, reason required, audited `void`); the loan status moves back. */
export async function voidRepayment(req: PayloadRequest, id: number, repaymentId: number, reason: string): Promise<LoanDoc> {
  const doc = await loadVisibleLoan(req, id, { lock: true })
  const ctx = await actorContext(req, doc)
  if (!mayVoidRepayment(ctx)) {
    await writeAuditDetached(req, [{ action: 'access_denied', docType: 'project_loan', docId: String(id), docNo: doc.docNo ?? undefined, field: 'void_repayment', newValue: { repaymentId, roles: userRoles(req) }, reason: 'void pengembalian hanya Direktur / Finance (ADR 0022 §7)' }])
    fail(403, 'FORBIDDEN', 'Pembatalan (void) pengembalian hanya oleh Direktur atau Finance.')
  }
  const rows = await repaymentsOf(req, id)
  const row = rows.find((r) => r.id === repaymentId)
  if (!row) fail(404, 'NOT_FOUND', 'Pengembalian tidak ditemukan.')
  if (row!.status !== 'posted') fail(409, 'STATE_CONFLICT', 'Pengembalian ini sudah dibatalkan (void).')
  const r = reason.trim()
  req.context.auditReason = r
  try {
    await req.payload.update({
      collection: 'project-loan-repayments',
      id: repaymentId,
      data: { status: 'void', voidReason: r, voidedBy: userId(req)!, voidedAt: new Date().toISOString() } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: void (append-only; only the void columns change, DB guard)
      req,
    })
  } finally {
    delete req.context.auditReason
  }
  const fresh = await loadRawLoan(req, id)
  return applyRepayments(req, fresh, `Void pengembalian #${repaymentId}: ${r}`.slice(0, 1000))
}

// ---------------------------------------------------------------- read models

type Names = { projects: Map<number, ProjectRow>; users: Map<number, string> }

async function names(req: PayloadRequest, docs: readonly LoanDoc[], extraUsers: number[] = []): Promise<Names> {
  const out: Names = { projects: new Map(), users: new Map() }
  const pIds = [...new Set(docs.flatMap((d) => [relId(d.lenderProject), relId(d.borrowerProject)]).filter((x): x is number => x !== undefined))]
  if (pIds.length) {
    const r = await req.payload.find({ collection: 'projects', where: { id: { in: pIds } }, depth: 0, pagination: false, select: { code: true, name: true, status: true, pm: true, company: true }, overrideAccess: true /* SYSTEM-READ: names of projects of readable loans */, req })
    for (const p of r.docs as unknown as ProjectRow[]) out.projects.set(p.id, p)
  }
  const uids = [...new Set([...docs.flatMap((d) => [relId(d.createdBy), relId(d.decidedBy)]), ...[...out.projects.values()].map((p) => relId(p.pm)), ...extraUsers].filter((x): x is number => x !== undefined))]
  if (uids.length) for (const [k, v] of await displayNames(req, uids)) out.users.set(k, v)
  return out
}

const projectRef = (n: Names, id: number) => {
  const p = n.projects.get(id)
  const pm = relId(p?.pm)
  return { id, code: p?.code ?? null, name: p?.name ?? null, pm: pm === undefined ? null : { id: pm, name: n.users.get(pm) ?? null } }
}

function summary(d: LoanDoc, n: Names, todayStr: string) {
  const amount = amountOf(d)
  const rep = repaid(d)
  const outstanding = ['approved', 'partially_repaid', 'repaid'].includes(d.status) ? outstandingOf(amount, rep) : d.status === 'draft' || d.status === 'pending_approval' ? amount : 0
  const l = { status: d.status, dueDate: d.dueDate, outstanding }
  const uid = relId(d.createdBy)!
  const decider = relId(d.decidedBy)
  const overdue = isOverdue(l, todayStr)
  return {
    id: d.id,
    uuid: d.uuid ?? null,
    companyId: relId(d.company) ?? null,
    docNo: d.docNo ?? null,
    status: d.status,
    statusLabel: LOAN_STATUS_LABELS[d.status],
    overdue,
    overdueLabel: overdue ? OVERDUE_LABEL : null,
    daysOverdue: daysOverdue(l, todayStr),
    kind: d.kind,
    kindLabel: LOAN_KIND_LABELS[d.kind],
    lenderProject: projectRef(n, relId(d.lenderProject)!),
    borrowerProject: projectRef(n, relId(d.borrowerProject)!),
    amount,
    repaidTotal: rep,
    outstanding,
    reason: d.reason,
    loanDate: d.loanDate,
    dueDate: d.dueDate,
    samePm: d.samePm === true,
    samePmNote: d.samePm === true ? SAME_PM_NOTE : null,
    g1Exception: d.g1Exception ?? null,
    createdBy: { id: uid, name: n.users.get(uid) ?? null },
    submittedAt: d.submittedAt ?? null,
    decidedAt: d.decidedAt ?? null,
    decidedBy: decider === undefined ? null : { id: decider, name: n.users.get(decider) ?? null },
    rejectReason: d.rejectReason ?? null,
    cancelReason: d.cancelReason ?? null,
    source: d.source ?? null,
    createdAt: d.createdAt ?? null,
  }
}

export type LoanSummary = ReturnType<typeof summary>

/** Detail: summary + repayments ("Pengembalian ke-n") + decision timeline + allowed actions + notes. */
export async function loanDetail(req: PayloadRequest, doc: LoanDoc) {
  // "Pengembalian ke-n" in repayment-date order (then entry order)
  const rows = (await repaymentsOf(req, doc.id)).sort((a, b) => a.repayDate.localeCompare(b.repayDate) || a.id - b.id)
  const decisions = await decisionsOf(req, doc.id)
  const n = await names(req, [doc], rows.flatMap((r) => [relId(r.recordedBy), relId(r.voidedBy)]).filter((x): x is number => x !== undefined))
  const ctx = await actorContext(req, doc, rows)
  const todayStr = await today(req, relId(doc.company))
  const s = summary(doc, n, todayStr)
  const selfDecided = doc.g1Exception === 'direktur_self' && decisions.some((x) => relId(x.actor) === relId(doc.createdBy))
  let k = 0
  return {
    ...s,
    allowedActions: loanAllowedActions(ctx),
    mayVoidRepayment: mayVoidRepayment(ctx),
    g1Note: doc.g1Exception === 'direktur_self' ? (selfDecided ? DIREKTUR_SELF_NOTE : 'Pembuat adalah satu-satunya Direktur PT: ia dapat memutuskan pinjamannya sendiri (tercatat di audit).') : null,
    repayments: rows.map((r) => ({
      id: r.id,
      seq: r.status === 'posted' ? ++k : null,
      repayDate: r.repayDate,
      amount: Math.round(Number(r.amount)),
      note: r.note ?? null,
      status: r.status,
      statusLabel: r.status === 'posted' ? 'Tercatat' : 'Dibatalkan (void)',
      voidReason: r.voidReason ?? null,
      recordedBy: { id: relId(r.recordedBy) ?? null, name: n.users.get(relId(r.recordedBy) ?? -1) ?? null },
      voidedBy: relId(r.voidedBy) === undefined ? null : { id: relId(r.voidedBy)!, name: n.users.get(relId(r.voidedBy)!) ?? null },
      voidedAt: r.voidedAt ?? null,
      createdAt: r.createdAt ?? null,
    })),
    decisions: decisions.map((r) => ({
      id: r.id,
      actor: { id: relId(r.actor) ?? null, name: r.actorName ?? null },
      decision: r.decision === 'rejected' ? ('rejected' as const) : ('approved' as const),
      reason: r.reason ?? null,
      decidedAt: r.decidedAt ?? null,
      signatureSource: r.signatureSource ?? null,
    })),
  }
}

export type LoanDetail = Awaited<ReturnType<typeof loanDetail>>

export type LoanFilter = {
  /** One project or several (DRMS 13/10 Umum #4: multi-select filter of the web list). */
  projectId?: number | readonly number[]
  role?: 'borrower' | 'lender'
  status?: LoanStatus | readonly LoanStatus[]
  overdue?: boolean
  q?: string
  page: number
  limit: number
  companyIds?: readonly number[]
}

/** List (newest first, caller scope; D8: search, filters, numbered pages). */
export async function listLoans(req: PayloadRequest, f: LoanFilter) {
  const empty = { items: [] as LoanSummary[], page: 1, totalPages: 0, totalDocs: 0, limit: f.limit }
  if (!mayReadLoans(req)) return empty
  const and: Where[] = []
  const projects = f.projectId === undefined ? [] : typeof f.projectId === 'number' ? [f.projectId] : [...f.projectId]
  if (projects.length) {
    if (f.role === 'borrower') and.push({ borrowerProject: { in: projects } })
    else if (f.role === 'lender') and.push({ lenderProject: { in: projects } })
    else and.push({ or: [{ borrowerProject: { in: projects } }, { lenderProject: { in: projects } }] })
  }
  const statuses = f.status === undefined ? [] : typeof f.status === 'string' ? [f.status] : [...f.status]
  if (statuses.length) and.push({ status: { in: statuses } })
  if (f.companyIds?.length) and.push({ company: { in: [...f.companyIds] } })
  if (f.overdue) {
    // derived: due date before today (per PT business date; the PT of the context — exact per row below)
    and.push({ status: { in: [...LOAN_REPAYABLE] } }, { dueDate: { less_than: await today(req) } })
  }
  const text = searchWhere(['docNo', 'reason'], f.q)
  if (text) and.push(text)
  const res = await req.payload.find({
    collection: 'project-loans',
    where: and.length ? { and } : undefined,
    sort: '-id',
    page: f.page,
    limit: f.limit,
    depth: 0,
    user: req.user,
    overrideAccess: false, // caller's read scope
    req,
  })
  const docs = res.docs as unknown as LoanDoc[]
  const n = await names(req, docs)
  const todayStr = await today(req)
  return { items: docs.map((d) => summary(d, n, todayStr)), page: res.page ?? f.page, totalPages: res.totalPages, totalDocs: res.totalDocs, limit: f.limit }
}

/** Loans waiting for the CALLER's decision (Direktur pool, G1), oldest first. */
export async function loanInbox(req: PayloadRequest, f: { companyIds?: readonly number[] } = {}) {
  if (!hasRoleAny(req, 'pk-owner')) return { items: [] as LoanSummary[] }
  const where: Where = f.companyIds?.length ? { and: [{ status: { equals: 'pending_approval' } }, { company: { in: [...f.companyIds] } }] } : { status: { equals: 'pending_approval' } }
  const res = await req.payload.find({ collection: 'project-loans', where, sort: 'submittedAt', limit: 200, depth: 0, user: req.user, overrideAccess: false, req })
  const docs = res.docs as unknown as LoanDoc[]
  const uid = userId(req) ?? -1
  const mine = docs.filter((d) => mayDecide({ callerId: uid, creatorId: relId(d.createdBy) ?? -2, callerIsDirektur: hasExactRole(req, 'pk-owner', relId(d.company)), g1Exception: d.g1Exception ?? null }))
  const n = await names(req, mine)
  const todayStr = await today(req)
  return { items: mine.map((d) => summary(d, n, todayStr)) }
}

/**
 * Create form options: borrower projects = the caller is `projects.pm` and holds pk-pm in that PT; lender options =
 * every open project of the same PT (code + name only, SYSTEM-READ: the lender is picked by name — ADR 0022 §3).
 */
export async function loanProjectOptions(req: PayloadRequest): Promise<{ borrowers: Array<{ id: number; code: string; name: string; companyId: number }>; lenders: Array<{ id: number; code: string; name: string; companyId: number }> }> {
  const uid = userId(req)
  if (uid === undefined) return { borrowers: [], lenders: [] }
  const mapped = mappedCompanies(req)
  const res = await req.payload.find({
    collection: 'projects',
    where: { and: [{ status: { not_equals: 'arsip' } }, ...(mapped !== null ? [{ company: { in: mapped } }] : [])] },
    sort: 'code',
    depth: 0,
    pagination: false,
    select: { code: true, name: true, company: true, pm: true },
    overrideAccess: true, // SYSTEM-READ: open projects of the caller's PTs (names only) for the lender picker
    req,
  })
  const all = (res.docs as unknown as Array<{ id: number; code: string; name: string; company?: unknown; pm?: unknown }>).map((p) => ({ id: p.id, code: p.code, name: p.name, companyId: relId(p.company)!, pm: relId(p.pm) }))
  const borrowers = all.filter((p) => p.pm === uid && hasRole(req, 'pk-pm', p.companyId))
  const companies = new Set(borrowers.map((b) => b.companyId))
  const strip = ({ pm: _pm, ...rest }: (typeof all)[number]) => rest
  return { borrowers: borrowers.map(strip), lenders: all.filter((p) => companies.has(p.companyId)).map(strip) }
}
