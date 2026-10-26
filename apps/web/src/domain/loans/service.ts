import { sql } from '@payloadcms/db-postgres'
import { APIError, type Payload, type PayloadRequest, type TypedUser, type Where } from 'payload'

import { companiesWithRole, hasExactRole, hasRole, hasRoleAny, mappedCompanies, relId, userId, userRoles } from '@/access/roles'
import { writeAudit, writeAuditDetached } from '@/audit/writer'
import { contextCompanyId, displayNames, membersWithRole } from '@/domain/companies'
import { signDecision, signerColumns, type DecisionSigner } from '@/domain/direktur-signature'
import { today } from '@/domain/expense/common'
import { claimMedia } from '@/domain/expense/receipts'
import { auditFundInsufficient, lockFunds, pbFigures } from '@/domain/fundcheck/service'
import { FUND_INSUFFICIENT } from '@/domain/fundcheck/rules'
import { notificationTemplate, pushEnabled } from '@/domain/notifications'
import { parseBusinessDate } from '@/domain/numbering'
import { allocateDocNo } from '@/domain/numbering-db'
import { formatRupiah } from '@/lib/money'
import { requestMeta } from '@/lib/request-meta'
import { searchWhere } from '@/lib/text-search'
import { getRequestTx } from '@/lib/tx'

import { mayReadLoans } from './access'
import { legNumbers, postLoanLegs, voidLoanLegs } from './cash'
import {
  addDays,
  AUTO_LOAN_DUE_DAYS,
  daysOverdue,
  decisionPools,
  executeDateError,
  isCashBacked,
  DIREKTUR_SELF_NOTE,
  isOverdue,
  LOAN_KIND_LABELS,
  LOAN_LEVEL_LABELS,
  LOAN_REPAYABLE,
  LOAN_STATUS_LABELS,
  levelOf,
  loanAllowedActions,
  loanInputErrors,
  loanOriginLabel,
  loanStatusLabel,
  mayDecideLevel,
  mayVoidRepayment,
  outstandingOf,
  OVERDUE_LABEL,
  POOL_ERROR_MESSAGES,
  repaymentAllowedActions,
  repaymentInputErrors,
  repaymentRequestErrors,
  repaymentStatusLabel,
  reservedOf,
  SAME_PM_NOTE,
  statusForRepaid,
  type LoanAction,
  type LoanActorContext,
  type LoanApprovalLevel,
  type LoanG1Exception,
  type LoanKind,
  type LoanOrigin,
  type LoanStatus,
  type LoanSubmitterRole,
  type RepaymentAction,
  type RepaymentStatus,
} from './rules'
import { closedProjectMessage, isClosedProjectStatus } from '@/domain/projects/status'

/**
 * ADR 0022 Pinjaman antar project — the single write path behind /api/v1/project-loans. Every function runs inside
 * the caller's transaction: number allocation, status change, the Direktur decision row (`approvals`, docType
 * project_loan), repayments, audit rows and in-app notifications commit or roll back together.
 *
 * Flow: Draft (PM of the BORROWER project) → submit (number PJ/{COMPANY}/{YY}{MM}/{seq}, Direktur pool resolved, G1)
 * → Menunggu persetujuan Direktur → Disetujui | Ditolak (reason). Repayments (borrower PM / Finance, no approval,
 * ≤ outstanding) → Sebagian kembali → Lunas; void (Direktur / Finance, reason) moves the status back. Cancel: the
 * creator in Draft / Menunggu, a Direktur after approval while no repayment is posted.
 * ADR 0031 (DRMS 21/10, amends ADR 0022 §5): the approval freezes both projects' Pusat Biaya (cash accounts); money
 * between two different accounts is `cashBacked` → Finance "Cairkan" posts KK lender / KM borrower (domain/loans/cash.ts)
 * and repayments (Finance only) post the mirror pair; a void reverses them. Goods, or one account, stay a claim (no cash).
 * `createTransferLoan`: the automatic, approved loan of a transfer Finance paid from another account (origin `transfer`).
 * 2026-10-24 (DRMS 24/10 #10–#12, ADR 0022/0031 amendment): the borrower PM OR Finance of the PT files; Direktur
 * (level 1) → Owner (level 2), reject with reason at either level (G1: the creator never decides — `direktur_self` stays
 * a level-1 exception; a PT without an Owner refuses the submit). A cash-backed loan (money between two known accounts,
 * one shared account included) then waits as a TRANSFER ORDER in "Antrian Transfer": Finance executes it (`executeLoan`,
 * also behind the legacy `disburse`) → KK lender account tagged with the lender project + KM borrower account tagged with
 * the borrower project. A repayment of a cash-backed loan is a REQUEST with the same path (`submitRepayment` →
 * `decideRepayment` → `executeRepayment`: KK borrower / KM lender); a claim's repayment is recorded at once as before.
 * Finance may execute an order it submitted itself (no Finance self-guard on loans; audited `selfExecuted`).
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
  /** ADR 0031 */
  origin?: LoanOrigin | null
  lenderCashAccount?: unknown
  borrowerCashAccount?: unknown
  cashBacked?: boolean | null
  transfer?: unknown
  /** 2026-10-26: the expense request an Owner-instructed loan (`submitterRole` owner) covers. */
  expenseRequest?: unknown
  disbursedAt?: string | null
  disbursedBy?: unknown
  lenderProject?: unknown
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
  /** 2026-10-24: level waiting while pending (1 Direktur, 2 Owner). */
  approvalLevel?: number | null
  submitterRole?: LoanSubmitterRole | null
  g1Exception?: LoanG1Exception | null
  source?: 'web' | 'apk' | null
  createdAt?: string
  updatedAt?: string
}

export type RepaymentDoc = {
  id: number
  loan: unknown
  company?: unknown
  repayDate: string
  amount: number
  note?: string | null
  status: RepaymentStatus
  voidReason?: string | null
  recordedBy: unknown
  voidedBy?: unknown
  voidedAt?: string | null
  /** 2026-10-24 (#12): the request part of a cash-backed repayment. */
  plannedDate?: string | null
  approvalLevel?: number | null
  submittedAt?: string | null
  decidedAt?: string | null
  decidedBy?: unknown
  rejectReason?: string | null
  cancelReason?: string | null
  executedAt?: string | null
  executedBy?: unknown
  source?: 'web' | 'apk' | null
  createdAt?: string
}

type ProjectRow = { id: number; code?: string; name?: string; status?: string | null; pm?: unknown; company?: unknown; cashAccount?: unknown }

type DecisionRow = { id: number; cycle: number; position: string; level: number; actor?: unknown; actorName?: string | null; decision: 'approved' | 'rejected' | 'acknowledged'; reason?: string | null; decidedAt?: string | null; signatureSource?: string | null; loan?: unknown; loanRepayment?: unknown }

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

/** Lender project of a manual loan (an automatic loan's lender is an account → undefined). */
async function lenderOf(req: PayloadRequest, doc: LoanDoc): Promise<ProjectRow | undefined> {
  const id = relId(doc.lenderProject)
  return id === undefined ? undefined : loadProject(req, id, 'lenderProjectId')
}

/** Names of cash accounts (Pusat Biaya) — SYSTEM-READ: the account name is shown on a loan the caller may read. */
async function accountNames(req: PayloadRequest, ids: ReadonlyArray<number | undefined>): Promise<Map<number, string>> {
  const want = [...new Set(ids.filter((x): x is number => x !== undefined))]
  if (want.length === 0) return new Map()
  const r = await req.payload.find({ collection: 'cash-accounts', where: { id: { in: want } }, depth: 0, pagination: false, select: { name: true }, overrideAccess: true /* SYSTEM-READ: account names of a readable loan */, req })
  return new Map((r.docs as unknown as Array<{ id: number; name?: string }>).map((a) => [a.id, a.name ?? `#${a.id}`]))
}

/** ADR 0031: `{lenderAccount}` / `{borrowerAccount}` of the notification texts. */
async function accountVars(req: PayloadRequest, doc: LoanDoc): Promise<Record<string, string>> {
  const l = relId(doc.lenderCashAccount)
  const b = relId(doc.borrowerCashAccount)
  const m = await accountNames(req, [l, b])
  return { lenderAccount: l === undefined ? '' : (m.get(l) ?? ''), borrowerAccount: b === undefined ? '' : (m.get(b) ?? '') }
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

/** 2026-10-24 (#12): decision rows of repayment requests (one query for a detail / an inbox). */
async function repaymentDecisionsOf(req: PayloadRequest, repaymentIds: readonly number[]): Promise<DecisionRow[]> {
  if (repaymentIds.length === 0) return []
  const res = await req.payload.find({
    collection: 'approvals',
    where: { and: [{ docType: { equals: 'project_loan_repayment' } }, { loanRepayment: { in: [...repaymentIds] } }] },
    depth: 0,
    pagination: false,
    sort: 'id',
    overrideAccess: true, // SYSTEM-READ: decision rows of repayments of loans the caller may read
    req,
  })
  return res.docs as unknown as DecisionRow[]
}

/** Users who APPROVED an earlier level of the current cycle (one decision position per person, G1). */
const priorDeciders = (rows: readonly DecisionRow[], cycle: number): number[] =>
  rows.filter((r) => r.cycle === cycle && r.decision === 'approved').map((r) => relId(r.actor)).filter((x): x is number => x !== undefined)

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

/** Active Owner (STORED `pk-principal`) of the PT — the level-2 pool (2026-10-24 #10). */
async function ownersOf(req: PayloadRequest, company: number): Promise<number[]> {
  return membersWithRole(req, 'pk-principal', company)
}

/**
 * 2026-10-24 (#10, G1): may the caller decide the level a loan / repayment request waits at? Level 1 = STORED Direktur
 * (not the creator unless `direktur_self`; not the last Owner who could still take level 2), level 2 = STORED Owner
 * who neither created it nor approved level 1 (ADR 0026: the Owner's implied Direktur role never decides level 1).
 */
async function callerMayDecide(req: PayloadRequest, c: { company: number | undefined; level: LoanApprovalLevel; creatorId: number; g1Exception?: LoanG1Exception | null; decisions: () => Promise<DecisionRow[]>; cycle: number }): Promise<boolean> {
  const uid = userId(req) ?? -1
  const callerIsDirektur = hasExactRole(req, 'pk-owner', c.company)
  const callerIsOwner = hasExactRole(req, 'pk-principal', c.company)
  if (c.level === 1 ? !callerIsDirektur : !callerIsOwner) return false
  const prior = c.level === 2 ? priorDeciders(await c.decisions(), c.cycle) : []
  const ownerPool = c.level === 1 && callerIsOwner && c.company !== undefined ? await ownersOf(req, c.company) : undefined
  return mayDecideLevel({ level: c.level, callerId: uid, creatorId: c.creatorId, callerIsDirektur, callerIsOwner, g1Exception: c.g1Exception ?? null, priorDeciders: prior, ownerPool })
}

export async function actorContext(req: PayloadRequest, doc: LoanDoc, repayments?: RepaymentDoc[]): Promise<LoanActorContext> {
  const uid = userId(req) ?? -1
  const company = relId(doc.company)
  const borrower = await loadProject(req, relId(doc.borrowerProject)!, 'borrowerProjectId')
  // ADR 0016 §5: roles IN THE LOAN's PT
  const isDirektur = hasRole(req, 'pk-owner', company)
  const rows = repayments ?? (repaid(doc) > 0 || doc.cashBacked === true ? await repaymentsOf(req, doc.id) : [])
  const posted = rows.some((r) => r.status === 'posted')
  // 2026-10-24 (#10): the level the loan waits at decides who may decide (Direktur, then Owner)
  const decides =
    doc.status === 'pending_approval' &&
    (await callerMayDecide(req, { company, level: levelOf(doc.approvalLevel), creatorId: relId(doc.createdBy) ?? -2, g1Exception: doc.g1Exception ?? null, decisions: () => decisionsOf(req, doc.id), cycle: doc.approvalCycle ?? 1 }))
  return {
    status: doc.status,
    isCreator: relId(doc.createdBy) === uid,
    isBorrowerPm: await isBorrowerPm(req, borrower, company),
    isDirektur,
    isFinance: hasRole(req, 'pk-finance', company),
    mayDecide: decides,
    hasRepayment: posted || repaid(doc) > 0,
    cashBacked: doc.cashBacked === true,
    disbursed: Boolean(doc.disbursedAt),
    origin: doc.origin ?? 'manual',
    // #12: outstanding not yet covered by a repayment request (pending / approved, not executed)
    repayableAmount: doc.cashBacked === true ? Math.max(0, outstandingOf(amountOf(doc), repaid(doc)) - reservedOf(rows)) : undefined,
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
    await refuseDecision(req, { docType: 'project_loan', docId: doc.id, docNo: doc.docNo ?? null, company: relId(doc.company), status: doc.status, level: levelOf(doc.approvalLevel), isCreator: ctx.isCreator, g1Exception: doc.g1Exception ?? null, decisions: () => decisionsOf(req, doc.id), cycle: doc.approvalCycle ?? 1, action, what: 'pinjaman' })
  }
  if (action === 'disburse') {
    // ADR 0031 + 2026-10-24 (#11): Finance of the loan's PT executes the transfer order of an approved cash-backed loan once
    if (!ctx.isFinance) fail(403, 'FORBIDDEN', 'Transfer pinjaman dieksekusi oleh Finance (Antrian Transfer).')
    if (!ctx.cashBacked) fail(409, 'STATE_CONFLICT', 'Pinjaman ini tidak menggerakkan kas (barang/material, atau project tanpa pusat biaya).')
    if (ctx.disbursed) fail(409, 'STATE_CONFLICT', 'Transfer pinjaman ini sudah dieksekusi.')
    return fail(409, 'STATE_CONFLICT', `Transfer hanya untuk pinjaman yang sudah disetujui Owner (status: ${loanStatusLabel(doc)}).`)
  }
  if (action === 'repay') {
    if (!ctx.isBorrowerPm && !ctx.isFinance) fail(403, 'FORBIDDEN', ctx.cashBacked ? 'Pengembalian diajukan oleh PM project peminjam atau Finance.' : 'Pengembalian dicatat oleh PM project peminjam atau Finance.')
    if (ctx.cashBacked && LOAN_REPAYABLE.includes(ctx.status)) {
      // #12: a repayment of a cash-backed loan is requested after the loan's transfer, up to what is not yet requested
      if (!ctx.disbursed) fail(409, 'STATE_CONFLICT', 'Transfer pinjaman belum dieksekusi Finance; pengembalian diajukan setelah transfer.')
      fail(409, 'STATE_CONFLICT', 'Seluruh sisa pinjaman sudah diajukan pengembaliannya (menunggu persetujuan / transfer Finance).')
    }
    return fail(409, 'STATE_CONFLICT', `Pengembalian hanya untuk pinjaman yang sudah disetujui dan belum lunas (status: ${loanStatusLabel(doc)}).`)
  }
  if (action === 'cancel') {
    if (ctx.origin === 'transfer') fail(409, 'STATE_CONFLICT', 'Pinjaman otomatis dari transfer dibatalkan lewat pembatalan (void) transfernya.')
    if (!ctx.isCreator && !ctx.isDirektur) fail(403, 'FORBIDDEN', 'Hanya pembuat (sebelum diputuskan) atau Direktur (setelah disetujui) yang dapat membatalkan pinjaman.')
    if (ctx.status === 'approved' && ctx.hasRepayment) fail(409, 'STATE_CONFLICT', 'Pinjaman yang sudah ada pengembaliannya tidak dapat dibatalkan.')
    if (ctx.status === 'approved' && ctx.cashBacked && ctx.disbursed) fail(409, 'STATE_CONFLICT', 'Pinjaman yang sudah ditransfer tidak dapat dibatalkan; ajukan pengembaliannya.')
    return fail(409, 'STATE_CONFLICT', `Pinjaman tidak dapat dibatalkan pada status ${loanStatusLabel(doc)}.`)
  }
  // edit / submit
  if (!ctx.isCreator) fail(403, 'FORBIDDEN', 'Hanya pembuat yang dapat mengubah atau mengajukan pinjaman ini.')
  if (doc.status !== 'draft') fail(409, 'STATE_CONFLICT', `Aksi tidak dapat dilakukan pada status pinjaman saat ini (${loanStatusLabel(doc)}).`)
  return fail(403, 'FORBIDDEN', 'Pinjaman diajukan oleh PM project peminjam atau Finance PT. Anda bukan lagi PM project ini atau Finance.')
}

/**
 * Refused decision of a loan / repayment request (audited `access_denied` in its own transaction, then 403 / 409 with
 * the reason of THIS level): wrong role for the level, G1 (creator; level-1 decider at level 2; last Owner at level 1),
 * or not pending. Never returns.
 */
async function refuseDecision(
  req: PayloadRequest,
  c: { docType: 'project_loan' | 'project_loan_repayment'; docId: number; docNo: string | null; company: number | undefined; status: string; level: LoanApprovalLevel; isCreator: boolean; g1Exception: LoanG1Exception | null; decisions: () => Promise<DecisionRow[]>; cycle: number; action: string; what: 'pinjaman' | 'pengembalian' },
): Promise<never> {
  const uid = userId(req) ?? -1
  const pending = c.status === 'pending_approval'
  // pending: the role of THIS level; otherwise any decider role (then the answer is 409, not 403)
  const roleOk = hasExactRole(req, pending ? (c.level === 2 ? 'pk-principal' : 'pk-owner') : ['pk-owner', 'pk-principal'], c.company)
  const decidedBefore = pending && c.level === 2 && priorDeciders(await c.decisions(), c.cycle).includes(uid)
  const reason = !roleOk
    ? c.level === 2
      ? 'level Owner: hanya Owner PT yang memutuskan (2026-10-24, ADR 0026)'
      : 'level Direktur: hanya Direktur PT yang memutuskan (ADR 0022 §4, ADR 0026)'
    : c.isCreator
      ? 'pembuat / pengaju tidak boleh memutuskan pengajuannya sendiri (G1)'
      : decidedBefore
        ? 'sudah memutuskan level Direktur; satu orang satu posisi keputusan (G1)'
        : pending
          ? 'Owner terakhir untuk level Owner tidak memutuskan level Direktur (G1)'
          : 'bukan langkah keputusan'
  await writeAuditDetached(req, [{ action: 'access_denied', docType: c.docType, docId: String(c.docId), docNo: c.docNo ?? undefined, field: c.action, newValue: { action: c.action, status: c.status, level: c.level, roles: userRoles(req) }, reason }])
  const subject = c.what === 'pinjaman' ? 'pinjaman antar project' : 'pengembalian pinjaman'
  if (!roleOk) fail(403, 'FORBIDDEN', pending ? `Langkah ini menunggu persetujuan ${LOAN_LEVEL_LABELS[c.level]}: hanya ${LOAN_LEVEL_LABELS[c.level]} PT yang dapat menyetujui atau menolak ${subject}.` : `Hanya Direktur atau Owner yang dapat menyetujui atau menolak ${subject}.`)
  if (c.isCreator) fail(403, 'FORBIDDEN', c.what === 'pinjaman' ? 'Pembuat pinjaman tidak dapat memutuskan pinjamannya sendiri. Direktur / Owner lain yang memutuskan.' : 'Pengaju pengembalian tidak dapat memutuskan pengajuannya sendiri. Direktur / Owner lain yang memutuskan.')
  if (!pending) fail(409, 'STATE_CONFLICT', `Aksi tidak dapat dilakukan pada status ${c.what} saat ini.`)
  if (decidedBefore) fail(403, 'FORBIDDEN', 'Anda sudah memberi persetujuan Direktur; persetujuan Owner diberikan Owner lain.')
  return fail(403, 'FORBIDDEN', c.level === 1 ? 'Anda satu-satunya Owner yang dapat memutuskan level Owner; persetujuan Direktur diberikan Direktur lain.' : `Anda tidak berhak memutuskan ${subject} ini.`)
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

export type LoanEvent =
  | 'project_loan.pending'
  | 'project_loan.submitted'
  | 'project_loan.approved'
  | 'project_loan.rejected'
  | 'project_loan.repaid'
  | 'project_loan.overdue'
  | 'project_loan.disburse_pending'
  | 'project_loan.disbursed'
  | 'project_loan.auto_created'
  | 'project_loan.pending_owner'
  | 'project_loan.filed'
  | 'project_loan.repayment_pending'
  | 'project_loan.repayment_pending_owner'
  | 'project_loan.repayment_transfer_pending'
  | 'project_loan.repayment_rejected'
  | 'project_loan.owner_instructed'
  | 'project_loan.request_ready'

export const LOAN_NOTIFICATION_DEFAULTS: Record<LoanEvent, { title: string; body: string }> = {
  'project_loan.pending': { title: 'Persetujuan Direktur: {docNo}', body: 'Pinjaman antar project {docNo}: {borrower} meminjam {amount} dari {lender}. Menunggu persetujuan Anda sebagai Direktur.' },
  'project_loan.submitted': { title: 'Project Anda dipinjam: {docNo}', body: 'Pinjaman antar project {docNo}: {borrower} meminjam {amount} dari project Anda {lender}. Direktur yang memutuskan.' },
  'project_loan.approved': { title: 'Pinjaman disetujui: {docNo}', body: 'Pinjaman antar project {docNo} ({borrower} dari {lender}, {amount}) disetujui Direktur dan Owner. Jatuh tempo {dueDate}.' },
  'project_loan.rejected': { title: 'Pinjaman ditolak: {docNo}', body: 'Pinjaman antar project {docNo} ({borrower} dari {lender}) ditolak. Lihat alasan di detail pinjaman.' },
  'project_loan.repaid': { title: 'Pengembalian pinjaman: {docNo}', body: 'Pengembalian {payment} untuk pinjaman {docNo} ({borrower} ke {lender}) dicatat. Sisa pinjaman {outstanding}.' },
  'project_loan.overdue': { title: 'Pinjaman terlambat: {docNo}', body: 'Pinjaman antar project {docNo} ({borrower} dari {lender}) lewat jatuh tempo {dueDate} ({days} hari). Sisa {outstanding}.' },
  // ADR 0031
  // 2026-10-24 (#11): the approved loan is a transfer order in "Antrian Transfer"
  'project_loan.disburse_pending': { title: 'Transfer pinjaman: {docNo}', body: 'Pinjaman antar project {docNo} ({borrower} dari {lender}, {amount}) disetujui Owner dan masuk Antrian Transfer: transfer dari {lenderAccount} ke {borrowerAccount}.' },
  'project_loan.disbursed': { title: 'Pinjaman ditransfer: {docNo}', body: 'Pinjaman antar project {docNo} ({amount}) ditransfer: kas keluar {lenderAccount}, kas masuk {borrowerAccount}. Jatuh tempo {dueDate}.' },
  'project_loan.auto_created': { title: 'Pinjaman otomatis: {docNo}', body: 'Transfer {transferNo} untuk {borrower} dibayar dari {lenderAccount}, bukan pusat biaya project ({borrowerAccount}). Tercatat pinjaman {docNo} {amount}, jatuh tempo {dueDate}.' },
  // 2026-10-24 (#10–#12): level 2 (Owner), a loan filed by Finance, repayment requests
  'project_loan.pending_owner': { title: 'Persetujuan Owner: {docNo}', body: 'Pinjaman antar project {docNo}: {borrower} meminjam {amount} dari {lender}. Disetujui Direktur, menunggu persetujuan Anda sebagai Owner.' },
  'project_loan.filed': { title: 'Pinjaman untuk project Anda: {docNo}', body: 'Finance mengajukan pinjaman antar project {docNo}: {borrower} meminjam {amount} dari {lender}. Menunggu persetujuan Direktur lalu Owner.' },
  'project_loan.repayment_pending': { title: 'Persetujuan Direktur: pengembalian {docNo}', body: 'Pengembalian {payment} pinjaman {docNo} ({borrower} ke {lender}) diajukan. Menunggu persetujuan Anda sebagai Direktur.' },
  'project_loan.repayment_pending_owner': { title: 'Persetujuan Owner: pengembalian {docNo}', body: 'Pengembalian {payment} pinjaman {docNo} ({borrower} ke {lender}) disetujui Direktur, menunggu persetujuan Anda sebagai Owner.' },
  'project_loan.repayment_transfer_pending': { title: 'Transfer pengembalian: {docNo}', body: 'Pengembalian {payment} pinjaman {docNo} disetujui Owner dan masuk Antrian Transfer: transfer dari {borrowerAccount} ke {lenderAccount}.' },
  'project_loan.repayment_rejected': { title: 'Pengembalian ditolak: {docNo}', body: 'Pengajuan pengembalian {payment} pinjaman {docNo} ditolak. Lihat alasan di detail pinjaman.' },
  // 2026-10-26 (DRMS 26/10 #1): "Instruksi pinjam antar proyek" — to the PMs; the instructor after Finance's transfer
  'project_loan.owner_instructed': { title: 'Instruksi pinjaman: {docNo}', body: 'Owner menginstruksikan pinjaman antar project {docNo}: {borrower} meminjam {amount} dari {lender} untuk pengajuan {requestNo}. Menunggu transfer Finance.' },
  'project_loan.request_ready': { title: 'Pengajuan siap disetujui: {requestNo}', body: 'Pinjaman {docNo} ({amount}) sudah ditransfer Finance ke {borrowerAccount}. Pengajuan {requestNo} dapat disetujui sekarang.' },
}

export function loanVars(doc: Pick<LoanDoc, 'id' | 'docNo' | 'amount' | 'dueDate' | 'repaidTotal'>, lender: ProjectRow | undefined, borrower: ProjectRow | undefined, extra: Record<string, string> = {}): Record<string, string> {
  const name = (p?: ProjectRow) => `${p?.code ?? ''} ${p?.name ?? ''}`.trim()
  return {
    docNo: doc.docNo ?? `#${doc.id}`,
    // ADR 0031: an automatic loan has no lender project — its lender is the account (`extra.lenderAccount`)
    lender: lender ? name(lender) : (extra.lenderAccount ?? ''),
    borrower: name(borrower),
    amount: formatRupiah(Number(doc.amount)),
    dueDate: doc.dueDate,
    outstanding: formatRupiah(outstandingOf(Number(doc.amount), Number(doc.repaidTotal ?? 0))),
    ...extra,
  }
}

export const renderLoanText = (s: string, vars: Record<string, string>) => s.replace(/\{([a-zA-Z]+)\}/g, (_, k: string) => vars[k] ?? '')

/** In-app notification of a loan event (docType project_loan; `target` = another document, e.g. the request it covers). */
async function notify(req: PayloadRequest, doc: LoanDoc, event: LoanEvent, to: Iterable<number>, vars: Record<string, string>, target?: { docType: 'expense_request'; docId: number; docNo: string | null }): Promise<void> {
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
        docType: target?.docType ?? 'project_loan',
        docId: String(target?.docId ?? doc.id),
        docNo: target ? target.docNo : (doc.docNo ?? null),
        company: relId(doc.company) ?? null, // ADR 0016 §4
        pushStatus: pushEnabled() ? 'pending' : 'skipped',
      } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: in-app notification of a committed-together transition
      req,
    })
  }
}

export const notifyLoan = notify

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
  if (isClosedProjectStatus(borrower.status)) fail(409, 'STATE_CONFLICT', borrower.status === 'dibatalkan' ? 'Project peminjam sudah dibatalkan.' : 'Project peminjam sudah diarsipkan.', 'borrowerProjectId')
  if (isClosedProjectStatus(lender.status)) fail(409, 'STATE_CONFLICT', lender.status === 'dibatalkan' ? 'Project pemberi pinjaman sudah dibatalkan.' : 'Project pemberi pinjaman sudah diarsipkan.', 'lenderProjectId')
  return { lender, borrower, company }
}

async function deniedCreate(req: PayloadRequest, borrowerId: number): Promise<never> {
  await writeAuditDetached(req, [{ action: 'access_denied', docType: 'project_loan', field: 'create', newValue: { borrowerProjectId: borrowerId }, reason: 'pinjaman antar project diajukan oleh PM project peminjam atau Finance PT (ADR 0022 §3, D6; 2026-10-24 #10)' }])
  return fail(403, 'FORBIDDEN', 'Pinjaman antar project hanya dapat diajukan oleh PM project peminjam atau Finance PT.', 'borrowerProjectId')
}

/**
 * D6 + 2026-10-24 (#10): the PM of the borrower project OR a Finance user of its PT creates a Draft (and submits it at
 * once with `submit: true`); Finance picks both projects among the open projects of the PT. `submitterRole` records
 * which (PM first when the caller is both).
 */
export async function createLoan(req: PayloadRequest, input: LoanInput): Promise<LoanDoc> {
  const uid = userId(req)
  if (uid === undefined) fail(401, 'FORBIDDEN', 'Unauthorized')
  if (!Number.isSafeInteger(input.borrowerProjectId) || input.borrowerProjectId <= 0) fail(400, 'VALIDATION', 'Project peminjam wajib dipilih.', 'borrowerProjectId')
  const borrower = await loadProject(req, input.borrowerProjectId, 'borrowerProjectId')
  const mapped = mappedCompanies(req)
  if (mapped !== null && !mapped.includes(relId(borrower.company) ?? -1)) fail(404, 'NOT_FOUND', 'Project tidak ditemukan.', 'borrowerProjectId')
  const asPm = await isBorrowerPm(req, borrower, relId(borrower.company))
  const submitterRole: LoanSubmitterRole | null = asPm ? 'pm' : hasRole(req, 'pk-finance', relId(borrower.company)) ? 'finance' : null
  if (submitterRole === null) await deniedCreate(req, input.borrowerProjectId)
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
      approvalLevel: 0,
      submitterRole,
      source: requestMeta(req).source === 'apk' ? 'apk' : 'web',
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: loan after the role/scope checks above (HTTP create is closed)
    req,
  })) as unknown as LoanDoc
  return input.submit ? submitLoan(req, doc.id) : doc
}

export type LoanPatch = { lenderProjectId?: number; kind?: LoanKind; amount?: number; reason?: string; loanDate?: string; dueDate?: string }

/** Draft edit by its creator (still PM of the borrower project, or Finance). The borrower project is fixed (create a new loan). */
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

/**
 * Draft → Menunggu persetujuan Direktur (level 1): inputs re-checked, both decision pools resolved (G1; 2026-10-24 #10:
 * no Owner → 409 NO_OWNER), number PJ/… at the loan date.
 */
export async function submitLoan(req: PayloadRequest, id: number): Promise<LoanDoc> {
  const visible = await loadVisibleLoan(req, id, { lock: true })
  await requireAction(req, visible, 'submit')
  const doc = await loadRawLoan(req, id)
  const company = relId(doc.company) ?? (await contextCompanyId(req))
  const todayStr = await today(req, company)
  check({ lenderProjectId: relId(doc.lenderProject), borrowerProjectId: relId(doc.borrowerProject), kind: doc.kind, amount: amountOf(doc), reason: doc.reason, loanDate: doc.loanDate, dueDate: doc.dueDate }, todayStr)
  const { lender, borrower } = await checkProjects(req, relId(doc.lenderProject)!, relId(doc.borrowerProject)!)
  const creator = relId(doc.createdBy)!
  const pools = decisionPools(creator, await direkturOf(req, company), await ownersOf(req, company))
  if (pools.error) fail(409, pools.error, POOL_ERROR_MESSAGES[pools.error])
  const { direktur: pool, exception } = pools
  const docNo = doc.docNo ?? (await allocateDocNo(req, 'project_loan', { companyId: company, date: parseBusinessDate(doc.loanDate), docId: String(id) })).docNo
  const samePm = relId(lender.pm) !== undefined && relId(lender.pm) === relId(borrower.pm)
  const updated = await updateLoan(req, id, {
    status: 'pending_approval',
    docNo,
    submittedAt: new Date().toISOString(),
    approvalCycle: 1,
    approvalLevel: 1,
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
  // 2026-10-24 (#10): filed by Finance → the borrower PM learns about it
  if (doc.submitterRole === 'finance') await notify(req, updated, 'project_loan.filed', pmOf(borrower).filter((x) => !pool.includes(x)), vars)
  return updated
}

/** Cancel (reason required): the creator in Draft / Menunggu; a Direktur after approval while nothing is repaid. */
export async function cancelLoan(req: PayloadRequest, id: number, reason: string): Promise<LoanDoc> {
  const doc = await loadVisibleLoan(req, id, { lock: true })
  await requireAction(req, doc, 'cancel')
  const r = reason.trim()
  const cancelled = await updateLoan(req, id, { status: 'cancelled', cancelReason: r, outstanding: 0 }, r)
  if (doc.status === 'approved') {
    const lender = await lenderOf(req, doc)
    const borrower = await loadProject(req, relId(doc.borrowerProject)!, 'borrowerProjectId')
    await notify(req, cancelled, 'project_loan.rejected', [relId(doc.createdBy)!, ...(lender ? pmOf(lender) : [])], loanVars(cancelled, lender, borrower, await accountVars(req, doc)))
  }
  return cancelled
}

/**
 * D1610 (ADR 0030) "Batalkan proyek" cascade: cancel a loan of the cancelled project (lender or borrower) as the
 * system (the caller holds the project-cancel permission). Same rule as `cancelLoan` without the actor part: Draft /
 * Menunggu, or Disetujui while nothing was repaid — a loan with a repayment must be settled first (409).
 */
export async function cancelLoanForProject(req: PayloadRequest, id: number, reason: string): Promise<LoanDoc> {
  await lockLoan(req, id)
  const doc = await loadRawLoan(req, id)
  const r = reason.trim()
  const repaidAny = doc.status === 'approved' && (repaid(doc) > 0 || (await repaymentsOf(req, doc.id)).some((x) => x.status === 'posted'))
  // ADR 0031: cash already moved (disbursed / automatic loan) → settle by repayment (or the transfer void), not by the cascade
  const moved = doc.cashBacked === true && Boolean(doc.disbursedAt)
  if (!['draft', 'pending_approval', 'approved'].includes(doc.status) || repaidAny || moved) {
    fail(409, 'STATE_CONFLICT', `Pinjaman ${doc.docNo ?? `#${id}`} (${LOAN_STATUS_LABELS[doc.status]}) tidak dapat dibatalkan${repaidAny ? ': sudah ada pengembalian' : moved ? ': kasnya sudah dicairkan' : ''}.`)
  }
  const cancelled = await updateLoan(req, id, { status: 'cancelled', cancelReason: r, outstanding: 0 }, r)
  if (doc.status === 'approved') {
    const lender = await lenderOf(req, doc)
    const borrower = await loadProject(req, relId(doc.borrowerProject)!, 'borrowerProjectId')
    await notify(req, cancelled, 'project_loan.rejected', [relId(doc.createdBy)!, ...(lender ? pmOf(lender) : [])], loanVars(cancelled, lender, borrower, await accountVars(req, doc)))
  }
  return cancelled
}

// ---------------------------------------------------------------- decision (Direktur level 1 → Owner level 2, 2026-10-24 #10)

type SignOpts = { signatureMediaId?: number | null }

/** One decision row (`approvals`, Class A) of a loan or of a repayment request + its audit row. */
async function insertDecision(
  req: PayloadRequest,
  target: { docType: 'project_loan'; loan: LoanDoc } | { docType: 'project_loan_repayment'; loan: LoanDoc; repayment: RepaymentDoc },
  level: LoanApprovalLevel,
  decision: 'approved' | 'rejected',
  reason: string | null,
  signer: DecisionSigner,
): Promise<void> {
  const caller = userId(req)!
  const meta = requestMeta(req)
  const doc = target.loan
  const repayment = target.docType === 'project_loan_repayment' ? target.repayment : null
  await req.payload.create({
    collection: 'approvals',
    data: {
      docType: target.docType,
      ...(repayment ? { loanRepayment: repayment.id } : { loan: doc.id }),
      cycle: repayment ? 1 : (doc.approvalCycle ?? 1),
      position: 'approval',
      level,
      actor: caller,
      onBehalf: false,
      decision,
      reason,
      ...signerColumns(signer), // ADR 0025: signature + display name (the PT's definitive Direktur when represented)
      deviceId: meta.deviceId ?? null,
      source: meta.source,
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: Class A decision row after the guards (G1; DB re-checks)
    req,
  })
  const creator = relId(repayment ? repayment.recordedBy : doc.createdBy)
  await writeAudit(req, [
    {
      action: decision === 'approved' ? 'approve' : 'reject',
      docType: target.docType,
      docId: String(repayment ? repayment.id : doc.id),
      docNo: doc.docNo ?? undefined,
      field: 'approval',
      newValue: {
        decision,
        level,
        levelLabel: LOAN_LEVEL_LABELS[level],
        amount: repayment ? Math.round(Number(repayment.amount)) : amountOf(doc),
        ...(repayment ? { loanId: doc.id } : { g1Exception: doc.g1Exception ?? null }),
        selfDecision: caller === creator,
        signatureSource: signer.signature?.source ?? 'none',
      },
      reason: reason ?? undefined,
    },
  ])
}

async function decide(req: PayloadRequest, id: number, decision: 'approved' | 'rejected', reason: string | null, opts: SignOpts): Promise<LoanDoc> {
  const visible = await loadVisibleLoan(req, id, { lock: true })
  await requireAction(req, visible, decision === 'approved' ? 'approve' : 'reject')
  const doc = await loadRawLoan(req, id)
  const level = levelOf(doc.approvalLevel)
  const company = relId(doc.company)!
  const lender = (await lenderOf(req, doc))!
  const borrower = await loadProject(req, relId(doc.borrowerProject)!, 'borrowerProjectId')
  if (decision === 'approved' && (isClosedProjectStatus(lender.status) || isClosedProjectStatus(borrower.status))) fail(409, 'STATE_CONFLICT', `${closedProjectMessage(isClosedProjectStatus(lender.status) ? lender.status : borrower.status).replace(/\.$/, '')}; pinjaman tidak dapat disetujui.`)
  // the Owner level still needs an Owner who neither created the loan nor gives this level-1 approval (G1)
  const owners = decision === 'approved' && level === 1 ? (await ownersOf(req, company)).filter((x) => x !== relId(doc.createdBy) && x !== userId(req)) : []
  if (decision === 'approved' && level === 1 && owners.length === 0) fail(409, 'NO_OWNER', POOL_ERROR_MESSAGES.NO_OWNER)
  // ADR 0025: level 1 IS the Direktur step — a designated representative signs as the PT's definitive Direktur
  const sig = await signDecision(req, { companyId: company, callerId: userId(req)!, direkturStep: level === 1, capturedId: opts.signatureMediaId, required: false })
  await insertDecision(req, { docType: 'project_loan', loan: doc }, level, decision, reason, sig)
  const now = new Date().toISOString()
  if (decision === 'approved' && level === 1) {
    // level 1 approved → waits for the Owner (status unchanged, DB: level 1 → 2 only after an approved level-1 row)
    const updated = await updateLoan(req, id, { approvalLevel: 2 })
    await notify(req, updated, 'project_loan.pending_owner', owners, loanVars(updated, lender, borrower))
    return updated
  }
  // ADR 0031: the final approval freezes both projects' Pusat Biaya; money between two known accounts moves cash
  // (2026-10-24 #11: also one shared account) → a transfer order in "Antrian Transfer"
  const lenderCashAccount = relId(lender.cashAccount) ?? null
  const borrowerCashAccount = relId(borrower.cashAccount) ?? null
  const cashBacked = isCashBacked({ kind: doc.kind, lenderCashAccountId: lenderCashAccount, borrowerCashAccountId: borrowerCashAccount })
  const updated =
    decision === 'approved'
      ? await updateLoan(req, id, { status: 'approved', decidedAt: now, decidedBy: userId(req), outstanding: amountOf(doc), lenderCashAccount, borrowerCashAccount, cashBacked })
      : await updateLoan(req, id, { status: 'rejected', decidedAt: now, decidedBy: userId(req), rejectReason: reason, outstanding: 0 }, reason ?? undefined)
  const vars = loanVars(updated, lender, borrower, await accountVars(req, updated))
  await notify(req, updated, decision === 'approved' ? 'project_loan.approved' : 'project_loan.rejected', [relId(doc.createdBy)!, ...pmOf(lender), ...pmOf(borrower)], vars)
  if (decision === 'approved' && cashBacked) await notify(req, updated, 'project_loan.disburse_pending', await membersWithRole(req, 'pk-finance', company), vars)
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

export type RepaymentInput = { amount: number; repayDate?: string; note?: string | null; confirmOverdraft?: boolean }

async function updateRepayment(req: PayloadRequest, id: number, data: Record<string, unknown>, reason?: string): Promise<RepaymentDoc> {
  if (reason) req.context.auditReason = reason
  try {
    return (await req.payload.update({
      collection: 'project-loan-repayments',
      id,
      data: data as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: repayment state machine after the guards (DB re-checks the transition)
      req,
    })) as unknown as RepaymentDoc
  } finally {
    delete req.context.auditReason
  }
}

/**
 * ADR 0022 §7 (Q-L7): borrower PM or Finance; ≤ outstanding. A CLAIM (no cash) is recorded at once, without approval,
 * as before. 2026-10-24 (#12): on a CASH-BACKED loan the same call SUBMITS a repayment request (amount ≤ outstanding not
 * yet requested, `repayDate` = the planned date, may be in the future) → Direktur → Owner → transfer order.
 */
export async function addRepayment(req: PayloadRequest, id: number, input: RepaymentInput): Promise<LoanDoc> {
  const doc = await loadVisibleLoan(req, id, { lock: true }) // serialises concurrent repayments
  await requireAction(req, doc, 'repay')
  const fresh = await loadRawLoan(req, id)
  if (fresh.cashBacked === true) return submitRepayment(req, fresh, input)
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
    overrideAccess: true, // SYSTEM-WRITE: append-only repayment after the role check above
    req,
  })
  const updated = await applyRepayments(req, fresh)
  const lender = await lenderOf(req, fresh)
  const borrower = await loadProject(req, relId(fresh.borrowerProject)!, 'borrowerProjectId')
  await notify(req, updated, 'project_loan.repaid', [...(await direkturOf(req, company)), ...(lender ? pmOf(lender) : [])], loanVars(updated, lender, borrower, { payment: formatRupiah(input.amount), ...(await accountVars(req, fresh)) }))
  return updated
}

/** #12: the repayment request of a cash-backed loan (row lock on the loan held by `addRepayment`). */
async function submitRepayment(req: PayloadRequest, loan: LoanDoc, input: RepaymentInput): Promise<LoanDoc> {
  const company = relId(loan.company)!
  const uid = userId(req)!
  const repayDate = input.repayDate ?? (await today(req, company))
  const repayable = Math.max(0, outstandingOf(amountOf(loan), repaid(loan)) - reservedOf(await repaymentsOf(req, loan.id)))
  const errs = repaymentRequestErrors({ amount: input.amount, repayDate, note: input.note ?? undefined }, { loanDate: loan.loanDate, repayable })
  if (errs.length > 0) throw new LoanError(400, errs[0]!.message, 'VALIDATION', errs[0]!.path)
  // G1 without exception: the submitter never decides either level (no `direktur_self` for repayments)
  const pools = decisionPools(uid, await direkturOf(req, company), await ownersOf(req, company))
  if (pools.exception) fail(409, 'NO_DIREKTUR', 'Persetujuan Direktur tidak boleh oleh pengaju sendiri dan PT ini tidak punya Direktur lain. Hubungi Admin.')
  if (pools.error) fail(409, pools.error, POOL_ERROR_MESSAGES[pools.error])
  const row = (await req.payload.create({
    collection: 'project-loan-repayments',
    data: {
      loan: loan.id,
      repayDate,
      plannedDate: repayDate,
      amount: input.amount,
      note: input.note?.trim() || null,
      status: 'pending_approval',
      approvalLevel: 1,
      submittedAt: new Date().toISOString(),
      recordedBy: uid,
      source: requestMeta(req).source === 'apk' ? 'apk' : 'web',
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: repayment request after the role / amount checks above (DB re-checks)
    req,
  })) as unknown as RepaymentDoc
  const lender = await lenderOf(req, loan)
  const borrower = await loadProject(req, relId(loan.borrowerProject)!, 'borrowerProjectId')
  await notify(req, loan, 'project_loan.repayment_pending', pools.direktur, loanVars(loan, lender, borrower, { payment: formatRupiah(Math.round(Number(row.amount))), ...(await accountVars(req, loan)) }))
  return loadRawLoan(req, loan.id)
}

/** A repayment of the loan (404 when it belongs to another loan). */
async function repaymentOf(req: PayloadRequest, loanId: number, repaymentId: number): Promise<RepaymentDoc> {
  const row = (await repaymentsOf(req, loanId)).find((r) => r.id === repaymentId)
  if (!row) fail(404, 'NOT_FOUND', 'Pengembalian tidak ditemukan.')
  return row!
}

/** Row actions the caller may take on one repayment (`repaymentAllowedActions` + the level-aware decision pool). */
async function repaymentActions(req: PayloadRequest, loan: LoanDoc, row: RepaymentDoc, decisions?: DecisionRow[]): Promise<RepaymentAction[]> {
  const company = relId(loan.company)
  const pending = row.status === 'pending_approval'
  const mayDecide =
    pending &&
    (await callerMayDecide(req, { company, level: levelOf(row.approvalLevel), creatorId: relId(row.recordedBy) ?? -2, g1Exception: null, decisions: async () => decisions ?? (await repaymentDecisionsOf(req, [row.id])), cycle: 1 }))
  return repaymentAllowedActions({
    status: row.status,
    isCreator: relId(row.recordedBy) === userId(req),
    isDirektur: hasRole(req, 'pk-owner', company),
    isFinance: hasRole(req, 'pk-finance', company),
    mayDecide,
    cashBacked: loan.cashBacked === true,
  })
}

/**
 * #12: Direktur (level 1) → Owner (level 2) decision of a repayment request; reject with reason at either level. The
 * final approval makes it a transfer order (Finance notified).
 */
async function decideRepayment(req: PayloadRequest, id: number, repaymentId: number, decision: 'approved' | 'rejected', reason: string | null, opts: SignOpts): Promise<LoanDoc> {
  const loan = await loadVisibleLoan(req, id, { lock: true })
  const row = await repaymentOf(req, id, repaymentId)
  const action = decision === 'approved' ? 'approve' : 'reject'
  const level = levelOf(row.approvalLevel)
  if (!(await repaymentActions(req, loan, row)).includes(action)) {
    await refuseDecision(req, { docType: 'project_loan_repayment', docId: row.id, docNo: loan.docNo ?? null, company: relId(loan.company), status: row.status, level, isCreator: relId(row.recordedBy) === userId(req), g1Exception: null, decisions: () => repaymentDecisionsOf(req, [row.id]), cycle: 1, action, what: 'pengembalian' })
  }
  const company = relId(loan.company)!
  const owners = decision === 'approved' && level === 1 ? (await ownersOf(req, company)).filter((x) => x !== relId(row.recordedBy) && x !== userId(req)) : []
  if (decision === 'approved' && level === 1 && owners.length === 0) fail(409, 'NO_OWNER', POOL_ERROR_MESSAGES.NO_OWNER)
  const sig = await signDecision(req, { companyId: company, callerId: userId(req)!, direkturStep: level === 1, capturedId: opts.signatureMediaId, required: false })
  await insertDecision(req, { docType: 'project_loan_repayment', loan, repayment: row }, level, decision, reason, sig)
  const lender = await lenderOf(req, loan)
  const borrower = await loadProject(req, relId(loan.borrowerProject)!, 'borrowerProjectId')
  const vars = loanVars(loan, lender, borrower, { payment: formatRupiah(Math.round(Number(row.amount))), ...(await accountVars(req, loan)) })
  const now = new Date().toISOString()
  if (decision === 'rejected') {
    await updateRepayment(req, row.id, { status: 'rejected', rejectReason: reason, decidedAt: now, decidedBy: userId(req) }, reason ?? undefined)
    await notify(req, loan, 'project_loan.repayment_rejected', [relId(row.recordedBy)!], vars)
  } else if (level === 1) {
    await updateRepayment(req, row.id, { approvalLevel: 2 })
    await notify(req, loan, 'project_loan.repayment_pending_owner', owners, vars)
  } else {
    await updateRepayment(req, row.id, { status: 'approved', decidedAt: now, decidedBy: userId(req) })
    await notify(req, loan, 'project_loan.repayment_transfer_pending', [...(await membersWithRole(req, 'pk-finance', company)), relId(row.recordedBy)!], vars)
  }
  return loadRawLoan(req, id)
}

export const approveRepayment = (req: PayloadRequest, id: number, repaymentId: number, opts: SignOpts = {}) => decideRepayment(req, id, repaymentId, 'approved', null, opts)
export const rejectRepayment = (req: PayloadRequest, id: number, repaymentId: number, reason: string, opts: SignOpts = {}) => decideRepayment(req, id, repaymentId, 'rejected', reason.trim(), opts)

/** #12: the submitter cancels a request while pending; Finance (or the submitter) cancels an approved order not executed yet. */
export async function cancelRepayment(req: PayloadRequest, id: number, repaymentId: number, reason: string): Promise<LoanDoc> {
  const loan = await loadVisibleLoan(req, id, { lock: true })
  const row = await repaymentOf(req, id, repaymentId)
  if (!(await repaymentActions(req, loan, row)).includes('cancel')) {
    await writeAuditDetached(req, [{ action: 'access_denied', docType: 'project_loan_repayment', docId: String(row.id), docNo: loan.docNo ?? undefined, field: 'cancel', newValue: { status: row.status, roles: userRoles(req) }, reason: 'batal pengembalian: pengaju (menunggu) atau Finance (disetujui)' }])
    if (row.status !== 'pending_approval' && row.status !== 'approved') fail(409, 'STATE_CONFLICT', `Pengembalian berstatus "${repaymentStatusLabel(row.status, row.approvalLevel)}" tidak dapat dibatalkan.`)
    fail(403, 'FORBIDDEN', row.status === 'approved' ? 'Pengembalian yang sudah disetujui dibatalkan oleh Finance atau pengajunya.' : 'Hanya pengaju yang dapat membatalkan pengembalian yang menunggu persetujuan.')
  }
  const r = reason.trim()
  await updateRepayment(req, row.id, { status: 'cancelled', cancelReason: r }, r)
  return loadRawLoan(req, id)
}

/** Void of a posted repayment (Direktur / Finance — ADR 0031: Finance only when it moved cash — reason required, audited `void`); the loan status moves back. */
export async function voidRepayment(req: PayloadRequest, id: number, repaymentId: number, reason: string): Promise<LoanDoc> {
  const doc = await loadVisibleLoan(req, id, { lock: true })
  const ctx = await actorContext(req, doc)
  if (!mayVoidRepayment(ctx)) {
    await writeAuditDetached(req, [{ action: 'access_denied', docType: 'project_loan', docId: String(id), docNo: doc.docNo ?? undefined, field: 'void_repayment', newValue: { repaymentId, roles: userRoles(req) }, reason: 'void pengembalian hanya Direktur / Finance (ADR 0022 §7)' }])
    fail(403, 'FORBIDDEN', 'Pembatalan (void) pengembalian hanya oleh Direktur atau Finance.')
  }
  const row = await repaymentOf(req, id, repaymentId)
  if (row.status !== 'posted') fail(409, 'STATE_CONFLICT', row.status === 'void' ? 'Pengembalian ini sudah dibatalkan (void).' : 'Hanya pengembalian yang sudah tercatat / ditransfer yang dapat di-void; pengajuan dibatalkan dengan "Batalkan".')
  const r = reason.trim()
  await updateRepayment(req, repaymentId, { status: 'void', voidReason: r, voidedBy: userId(req)!, voidedAt: new Date().toISOString() }, r)
  const fresh = await loadRawLoan(req, id)
  // ADR 0031: the repayment's KK / KM are reversed with it (same reason)
  if (fresh.cashBacked === true) await voidLoanLegs(req, id, repaymentId, `Void pengembalian pinjaman ${fresh.docNo ?? `#${id}`}: ${r}`.slice(0, 900))
  return applyRepayments(req, fresh, `Void pengembalian #${repaymentId}: ${r}`.slice(0, 1000))
}

// ---------------------------------------------------------------- ADR 0031 + 2026-10-24 (#11/#12): transfer orders, automatic loan

export type ExecuteInput = { executeDate?: string; note?: string | null; proofMediaId?: number | null; confirmOverdraft?: boolean }
/** Legacy body of POST /project-loans/:id/disburse (older APKs) — same execution. */
export type DisburseInput = { disburseDate?: string; note?: string | null; proofMediaId?: number | null; confirmOverdraft?: boolean }

async function executionDate(req: PayloadRequest, loan: LoanDoc, date: string | undefined): Promise<string> {
  const todayStr = await today(req, relId(loan.company)!)
  const d = date ?? todayStr
  const err = executeDateError(d, { minDate: loan.loanDate, today: todayStr })
  if (err) fail(400, 'VALIDATION', err.message, err.path)
  return d
}

/**
 * #11 "Antrian Transfer" — Finance of the loan's PT executes the transfer order of an approved cash-backed manual loan:
 * KK on the lender's Pusat Biaya tagged with the LENDER project + KM on the borrower's tagged with the BORROWER project
 * (one shared account: both on it), dated `executeDate` (default today; not before the loan date, not in the future);
 * once. A Finance user who filed the loan may execute it (no Finance self-guard on loans) — audited `selfExecuted`.
 */
export async function executeLoan(req: PayloadRequest, id: number, input: ExecuteInput = {}): Promise<LoanDoc> {
  const doc = await loadVisibleLoan(req, id, { lock: true })
  await requireAction(req, doc, 'disburse')
  const fresh = await loadRawLoan(req, id)
  const requestId = relId(fresh.expenseRequest)
  // 2026-10-26: an Owner-instructed loan — the lender account's dana bebas is re-checked under the PT fund lock
  if (requestId !== undefined) await recheckInstructedLender(req, fresh)
  const date = await executionDate(req, fresh, input.executeDate)
  const legs = await postLoanLegs(req, {
    loanId: id,
    fromAccountId: relId(fresh.lenderCashAccount)!,
    toAccountId: relId(fresh.borrowerCashAccount)!,
    amount: amountOf(fresh),
    date,
    description: `Pencairan pinjaman ${fresh.docNo ?? `#${id}`}${input.note?.trim() ? ` — ${input.note.trim()}` : ''}`,
    borrowerProjectId: relId(fresh.borrowerProject) ?? null,
    lenderProjectId: relId(fresh.lenderProject) ?? null,
    confirmOverdraft: input.confirmOverdraft === true,
    proofId: input.proofMediaId ?? null,
  })
  if (input.proofMediaId) await claimMedia(req, 'media-attachments', input.proofMediaId, legs.kk.id, { ownerType: 'cash_entry' })
  const updated = await updateLoan(req, id, { disbursedAt: new Date().toISOString(), disbursedBy: userId(req) })
  const selfExecuted = relId(fresh.createdBy) === userId(req)
  await writeAudit(req, [
    {
      action: 'disburse',
      docType: 'project_loan',
      docId: String(id),
      docNo: fresh.docNo ?? undefined,
      field: 'disbursedAt',
      newValue: { amount: amountOf(fresh), date, kk: legs.kk.entryNo, km: legs.km.entryNo, lenderCashAccountId: relId(fresh.lenderCashAccount), borrowerCashAccountId: relId(fresh.borrowerCashAccount), selfExecuted },
      reason: selfExecuted ? 'Finance pengaju mengeksekusi transfer pinjamannya sendiri (diizinkan, 2026-10-24 #11)' : undefined,
    },
  ])
  const lender = await lenderOf(req, fresh)
  const borrower = await loadProject(req, relId(fresh.borrowerProject)!, 'borrowerProjectId')
  const vars = loanVars(updated, lender, borrower, await accountVars(req, updated))
  if (requestId === undefined) {
    await notify(req, updated, 'project_loan.disbursed', [relId(fresh.createdBy)!, ...pmOf(borrower), ...(lender ? pmOf(lender) : [])], vars)
    return updated
  }
  // 2026-10-26: the instructor learns that the request can now be approved (opens the request); the PMs as before
  const rq = await requestRef(req, requestId)
  await notify(req, updated, 'project_loan.disbursed', [...pmOf(borrower), ...(lender ? pmOf(lender) : [])].filter((u) => u !== relId(fresh.createdBy)), vars)
  await notify(req, updated, 'project_loan.request_ready', [relId(fresh.createdBy)!], { ...vars, requestNo: rq.docNo ?? `#${requestId}` }, { docType: 'expense_request', docId: requestId, docNo: rq.docNo })
  return updated
}

/** Number / title of the expense request an instructed loan covers (SYSTEM-READ: shown on a loan the caller may read). */
export async function requestRef(req: PayloadRequest, id: number): Promise<{ id: number; docNo: string | null; title: string | null }> {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`SELECT doc_no, title FROM expense_requests WHERE id = ${id}`)) as unknown as { rows: Array<{ doc_no: string | null; title: string | null }> }
  return { id, docNo: r.rows[0]?.doc_no ?? null, title: r.rows[0]?.title ?? null }
}

/**
 * 2026-10-26 (ADR 0031 amendment): at Finance's execution of an Owner-instructed loan, the lender account must still cover
 * it — its dana bebas without this loan (which it reserves while not transferred) ≥ the amount, under the PT fund lock
 * (ADR 0029 §1 lock order: loan row → fund lock → the account lock of the postings). Else 409 FUND_INSUFFICIENT (audited);
 * the loan can be cancelled (Direktur / Owner) and instructed again from the request.
 */
async function recheckInstructedLender(req: PayloadRequest, loan: LoanDoc): Promise<void> {
  const company = relId(loan.company)!
  await lockFunds(req, [company])
  const lenderId = relId(loan.lenderCashAccount)!
  const name = (await accountNames(req, [lenderId])).get(lenderId) ?? `#${lenderId}`
  const f = await pbFigures(req, { id: lenderId, name })
  const amount = amountOf(loan)
  const free = f.available + amount
  if (free >= amount) return
  await auditFundInsufficient(req, { docType: 'project_loan', docId: loan.id, docNo: loan.docNo }, 'execute', { companyId: company, balance: f.balance, commitments: f.commitments - amount, available: free, needed: amount }, company, null)
  fail(409, FUND_INSUFFICIENT, `Dana bebas akun kas ${name} tidak cukup lagi untuk pinjaman ${loan.docNo ?? `#${loan.id}`}: tersedia ${formatRupiah(free)}, dibutuhkan ${formatRupiah(amount)}. Batalkan pinjaman ini (Direktur / Owner) lalu instruksikan ulang dari pengajuan.`)
}

/** ADR 0031 "Cairkan" (POST /project-loans/:id/disburse, older APKs): the same execution as the transfer order. */
export const disburseLoan = (req: PayloadRequest, id: number, input: DisburseInput = {}) =>
  executeLoan(req, id, { executeDate: input.disburseDate, note: input.note, proofMediaId: input.proofMediaId, confirmOverdraft: input.confirmOverdraft })

/**
 * #12: Finance executes an approved repayment order: KK on the borrower's Pusat Biaya tagged with the BORROWER project
 * + KM on the lender's tagged with the LENDER project, the repayment becomes `posted` (dated `executeDate`) and the
 * loan Sebagian kembali / Lunas — one transaction. The submitter may be the executing Finance user (audited).
 */
export async function executeRepayment(req: PayloadRequest, id: number, repaymentId: number, input: ExecuteInput = {}): Promise<LoanDoc> {
  const loan = await loadVisibleLoan(req, id, { lock: true })
  const row = await repaymentOf(req, id, repaymentId)
  if (!(await repaymentActions(req, loan, row)).includes('execute')) {
    await writeAuditDetached(req, [{ action: 'access_denied', docType: 'project_loan_repayment', docId: String(row.id), docNo: loan.docNo ?? undefined, field: 'execute', newValue: { status: row.status, roles: userRoles(req) }, reason: 'transfer pengembalian dieksekusi Finance setelah disetujui Owner' }])
    if (!hasRole(req, 'pk-finance', relId(loan.company))) fail(403, 'FORBIDDEN', 'Transfer pengembalian dieksekusi oleh Finance (Antrian Transfer).')
    fail(409, 'STATE_CONFLICT', `Hanya pengembalian yang sudah disetujui Owner yang dapat ditransfer (status: ${repaymentStatusLabel(row.status, row.approvalLevel)}).`)
  }
  const fresh = await loadRawLoan(req, id)
  const amount = Math.round(Number(row.amount))
  if (amount > outstandingOf(amountOf(fresh), repaid(fresh))) fail(409, 'OVER_REPAID', 'Nominal pengembalian melebihi sisa pinjaman.', 'amount')
  const date = await executionDate(req, fresh, input.executeDate)
  // the row is `posted` first: the DB cash-leg check of a posted repayment then finds its pair (deferred, same transaction)
  await updateRepayment(req, row.id, { status: 'posted', repayDate: date, executedAt: new Date().toISOString(), executedBy: userId(req) })
  const legs = await postLoanLegs(req, {
    loanId: id,
    repaymentId: row.id,
    fromAccountId: relId(fresh.borrowerCashAccount)!,
    toAccountId: relId(fresh.lenderCashAccount)!,
    amount,
    date,
    description: `Pengembalian pinjaman ${fresh.docNo ?? `#${id}`}${row.note ? ` — ${row.note}` : ''}${input.note?.trim() ? ` — ${input.note.trim()}` : ''}`,
    borrowerProjectId: relId(fresh.borrowerProject) ?? null,
    lenderProjectId: relId(fresh.lenderProject) ?? null,
    confirmOverdraft: input.confirmOverdraft === true,
    proofId: input.proofMediaId ?? null,
  })
  if (input.proofMediaId) await claimMedia(req, 'media-attachments', input.proofMediaId, legs.kk.id, { ownerType: 'cash_entry' })
  const selfExecuted = relId(row.recordedBy) === userId(req)
  await writeAudit(req, [
    {
      action: 'disburse',
      docType: 'project_loan_repayment',
      docId: String(row.id),
      docNo: fresh.docNo ?? undefined,
      field: 'executedAt',
      newValue: { loanId: id, amount, date, kk: legs.kk.entryNo, km: legs.km.entryNo, selfExecuted },
      reason: selfExecuted ? 'Finance pengaju mengeksekusi transfer pengembaliannya sendiri (diizinkan, 2026-10-24 #12)' : undefined,
    },
  ])
  const updated = await applyRepayments(req, fresh)
  const lender = await lenderOf(req, fresh)
  const borrower = await loadProject(req, relId(fresh.borrowerProject)!, 'borrowerProjectId')
  const company = relId(fresh.company)!
  await notify(
    req,
    updated,
    'project_loan.repaid',
    [...(await direkturOf(req, company)), ...(lender ? pmOf(lender) : []), ...pmOf(borrower), relId(row.recordedBy)!],
    loanVars(updated, lender, borrower, { payment: formatRupiah(amount), ...(await accountVars(req, fresh)) }),
  )
  return updated
}

export type TransferLoanInput = {
  /** The request's project (borrower) and its Pusat Biaya (charged account). */
  borrowerProjectId: number
  borrowerCashAccountId: number
  /** The account Finance actually paid from (lender). */
  lenderCashAccountId: number
  amount: number
  transfer: { id: number; docNo: string }
  request: { id: number; docNo?: string | null; title: string }
  transferDate: string
  reason: string
  dueDate?: string | null
  confirmOverdraft?: boolean
}

/**
 * ADR 0031 (DRMS 21/10 #4–#5): Finance paid a project request from account B ≠ the project's Pusat Biaya A → an
 * automatic, APPROVED loan "B → project" (origin `transfer`, lender = the account, no Direktur step — the user's
 * decision 2026-10-21, notified to the project's PM and the Direktur) with its cash legs: KK on B, KM on A. The caller
 * (recordTransfer) then posts the transfer KK on A, so A nets to 0 and B carries the payment — like the bank statement.
 */
export async function createTransferLoan(req: PayloadRequest, input: TransferLoanInput): Promise<{ loan: LoanDoc; kk: string; km: string }> {
  const r = input.reason.trim()
  if (r.length < 3) fail(400, 'VALIDATION', 'Alasan membayar dari akun lain wajib diisi (min. 3 karakter): tercatat sebagai pinjaman antar project.', 'loanReason')
  const borrower = await loadProject(req, input.borrowerProjectId, 'borrowerProjectId')
  const company = relId(borrower.company)!
  const dueDate = input.dueDate ?? addDays(input.transferDate, AUTO_LOAN_DUE_DAYS)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < input.transferDate) fail(400, 'VALIDATION', 'Jatuh tempo pinjaman tidak boleh sebelum tanggal transfer.', 'loanDueDate')
  const { docNo } = await allocateDocNo(req, 'project_loan', { companyId: company, date: parseBusinessDate(input.transferDate) })
  const now = new Date().toISOString()
  const loan = (await req.payload.create({
    collection: 'project-loans',
    data: {
      origin: 'transfer',
      docNo,
      borrowerProject: input.borrowerProjectId,
      lenderCashAccount: input.lenderCashAccountId,
      borrowerCashAccount: input.borrowerCashAccountId,
      cashBacked: true,
      transfer: input.transfer.id,
      kind: 'dana',
      amount: input.amount,
      reason: `${r} (transfer ${input.transfer.docNo}, pengajuan ${input.request.docNo ?? `#${input.request.id}`})`.slice(0, 1000),
      loanDate: input.transferDate,
      dueDate,
      status: 'approved',
      repaidTotal: 0,
      outstanding: input.amount,
      createdBy: userId(req)!,
      submittedAt: now,
      decidedAt: now,
      decidedBy: userId(req)!,
      disbursedAt: now,
      disbursedBy: userId(req)!,
      approvalCycle: 0,
      source: requestMeta(req).source === 'apk' ? 'apk' : 'web',
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: automatic loan of a guarded transfer (DB: born approved + disbursed, origin shape)
    req,
  })) as unknown as LoanDoc
  const legs = await postLoanLegs(req, {
    loanId: loan.id,
    fromAccountId: input.lenderCashAccountId,
    toAccountId: input.borrowerCashAccountId,
    amount: input.amount,
    date: input.transferDate,
    description: `Pinjaman ${docNo}: transfer ${input.transfer.docNo} (${input.request.docNo ?? ''} ${input.request.title}) dibayar dari akun lain`.trim(),
    borrowerProjectId: input.borrowerProjectId,
    confirmOverdraft: input.confirmOverdraft === true,
  })
  await writeAudit(req, [
    {
      action: 'auto_create',
      docType: 'project_loan',
      docId: String(loan.id),
      docNo,
      field: 'transfer',
      newValue: { transferId: input.transfer.id, transferNo: input.transfer.docNo, requestId: input.request.id, amount: input.amount, lenderCashAccountId: input.lenderCashAccountId, borrowerCashAccountId: input.borrowerCashAccountId, kk: legs.kk.entryNo, km: legs.km.entryNo },
      reason: r,
      companyId: company,
    },
  ])
  const vars = loanVars(loan, undefined, borrower, { ...(await accountVars(req, loan)), transferNo: input.transfer.docNo })
  await notify(req, loan, 'project_loan.auto_created', [...pmOf(borrower), ...(await direkturOf(req, company))], vars)
  return { loan, kk: legs.kk.entryNo, km: legs.km.entryNo }
}

/** ADR 0031: the automatic loan of a transfer (null for a transfer paid from its Pusat Biaya). */
export async function transferLoanOf(req: PayloadRequest, transferId: number): Promise<LoanDoc | null> {
  const r = await req.payload.find({ collection: 'project-loans', where: { transfer: { equals: transferId } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: loan of a transfer the caller acts on */, req })
  return (r.docs[0] as unknown as LoanDoc | undefined) ?? null
}

/**
 * ADR 0031: void of a transfer paid from another account → its automatic loan is cancelled and its KK / KM reversed
 * (refused while a repayment is posted: void the repayments first; 2026-10-24: or a repayment request is open).
 */
export async function cancelTransferLoan(req: PayloadRequest, transferId: number, reason: string): Promise<LoanDoc | null> {
  const loan = await transferLoanOf(req, transferId)
  if (!loan || loan.status === 'cancelled') return loan
  await lockLoan(req, loan.id)
  const fresh = await loadRawLoan(req, loan.id)
  const rows = await repaymentsOf(req, fresh.id)
  if (repaid(fresh) > 0 || rows.some((x) => x.status === 'posted')) {
    fail(409, 'STATE_CONFLICT', `Transfer ini tercatat sebagai pinjaman ${fresh.docNo ?? ''} yang sudah ada pengembaliannya. Void pengembaliannya dulu.`)
  }
  // 2026-10-24 (#12): an open repayment request (pending / approved, not executed) is settled first
  if (reservedOf(rows) > 0) fail(409, 'STATE_CONFLICT', `Pinjaman ${fresh.docNo ?? ''} dari transfer ini masih punya pengajuan pengembalian yang belum selesai. Batalkan atau selesaikan dulu.`)
  const r = `Transfer dibatalkan: ${reason.trim()}`.slice(0, 1000)
  await voidLoanLegs(req, fresh.id, null, r.slice(0, 900))
  return updateLoan(req, fresh.id, { status: 'cancelled', cancelReason: r, outstanding: 0 }, r)
}

// ---------------------------------------------------------------- read models

/** `representedDecider`: loan id → name of the PT's definitive Direktur when a representative decided it (ADR 0025). */
type Names = { projects: Map<number, ProjectRow>; users: Map<number, string>; representedDecider: Map<number, string>; accounts: Map<number, string>; transfers: Map<number, string | null>; requests: Map<number, string | null> }

async function names(req: PayloadRequest, docs: readonly LoanDoc[], extraUsers: number[] = []): Promise<Names> {
  const out: Names = { projects: new Map(), users: new Map(), representedDecider: new Map(), accounts: new Map(), transfers: new Map(), requests: new Map() }
  const decided = docs.filter((d) => relId(d.decidedBy) !== undefined).map((d) => d.id)
  if (decided.length) {
    // ADR 0025: "Diputuskan oleh" shows the definitive Direktur, never the representative (rows keep the real user)
    const r = await req.payload.find({
      collection: 'approvals',
      where: { and: [{ loan: { in: decided } }, { signatureSource: { equals: 'company' } }] },
      depth: 0,
      pagination: false,
      sort: 'id',
      select: { loan: true, actorName: true },
      overrideAccess: true, // SYSTEM-READ: decision rows of readable loans
      req,
    })
    for (const a of r.docs as unknown as Array<{ loan?: unknown; actorName?: string | null }>) {
      const loan = relId(a.loan)
      if (loan !== undefined && a.actorName) out.representedDecider.set(loan, a.actorName)
    }
  }
  const pIds = [...new Set(docs.flatMap((d) => [relId(d.lenderProject), relId(d.borrowerProject)]).filter((x): x is number => x !== undefined))]
  if (pIds.length) {
    const r = await req.payload.find({ collection: 'projects', where: { id: { in: pIds } }, depth: 0, pagination: false, select: { code: true, name: true, status: true, pm: true, company: true }, overrideAccess: true /* SYSTEM-READ: names of projects of readable loans */, req })
    for (const p of r.docs as unknown as ProjectRow[]) out.projects.set(p.id, p)
  }
  // ADR 0031: Pusat Biaya names + transfer numbers of automatic loans
  out.accounts = await accountNames(req, docs.flatMap((d) => [relId(d.lenderCashAccount), relId(d.borrowerCashAccount)]))
  const tIds = [...new Set(docs.map((d) => relId(d.transfer)).filter((x): x is number => x !== undefined))]
  if (tIds.length) {
    const r = await req.payload.find({ collection: 'transfers', where: { id: { in: tIds } }, depth: 0, pagination: false, select: { docNo: true }, overrideAccess: true /* SYSTEM-READ: transfer numbers of readable loans */, req })
    for (const t of r.docs as unknown as Array<{ id: number; docNo?: string | null }>) out.transfers.set(t.id, t.docNo ?? null)
  }
  // 2026-10-26: numbers of the expense requests Owner-instructed loans cover
  for (const rid of new Set(docs.map((d) => relId(d.expenseRequest)).filter((x): x is number => x !== undefined))) out.requests.set(rid, (await requestRef(req, rid)).docNo)
  const uids = [...new Set([...docs.flatMap((d) => [relId(d.createdBy), relId(d.decidedBy), relId(d.disbursedBy)]), ...[...out.projects.values()].map((p) => relId(p.pm)), ...extraUsers].filter((x): x is number => x !== undefined))]
  if (uids.length) for (const [k, v] of await displayNames(req, uids)) out.users.set(k, v)
  return out
}

const accountRef = (n: Names, v: unknown) => {
  const id = relId(v)
  return id === undefined ? null : { id, name: n.accounts.get(id) ?? null }
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
  const disburser = relId(d.disbursedBy)
  const overdue = isOverdue(l, todayStr)
  const lenderId = relId(d.lenderProject)
  const transferId = relId(d.transfer)
  const requestId = relId(d.expenseRequest)
  const awaiting = d.status === 'approved' && d.cashBacked === true && !d.disbursedAt
  return {
    id: d.id,
    uuid: d.uuid ?? null,
    companyId: relId(d.company) ?? null,
    docNo: d.docNo ?? null,
    status: d.status,
    // 2026-10-24 (#10/#11): "Menunggu persetujuan Direktur / Owner", "Disetujui – menunggu transfer Finance"
    statusLabel: loanStatusLabel({ status: d.status, approvalLevel: d.approvalLevel, awaitingDisbursement: awaiting }),
    approvalLevel: d.status === 'pending_approval' ? levelOf(d.approvalLevel) : null,
    overdue,
    overdueLabel: overdue ? OVERDUE_LABEL : null,
    daysOverdue: daysOverdue(l, todayStr),
    kind: d.kind,
    kindLabel: LOAN_KIND_LABELS[d.kind],
    origin: d.origin ?? 'manual',
    originLabel: loanOriginLabel(d.origin, d.submitterRole),
    submitterRole: d.origin === 'transfer' ? null : (d.submitterRole ?? 'pm'),
    lenderProject: lenderId === undefined ? null : projectRef(n, lenderId),
    borrowerProject: projectRef(n, relId(d.borrowerProject)!),
    lenderCashAccount: accountRef(n, d.lenderCashAccount),
    borrowerCashAccount: accountRef(n, d.borrowerCashAccount),
    cashBacked: d.cashBacked === true,
    disbursedAt: d.disbursedAt ?? null,
    disbursedBy: disburser === undefined ? null : { id: disburser, name: n.users.get(disburser) ?? null },
    awaitingDisbursement: awaiting,
    // #11: the loan's transfer order in "Antrian Transfer" (web anchor) while it waits for Finance
    transferQueueHref: awaiting ? transferOrderHref('loan', d.id) : null,
    transfer: transferId === undefined ? null : { id: transferId, docNo: n.transfers.get(transferId) ?? null },
    // 2026-10-26: the expense request an Owner-instructed loan covers ("Instruksi pinjam antar proyek")
    expenseRequest: requestId === undefined ? null : { id: requestId, docNo: n.requests.get(requestId) ?? null },
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
    decidedBy: decider === undefined ? null : { id: decider, name: n.representedDecider.get(d.id) ?? n.users.get(decider) ?? null },
    rejectReason: d.rejectReason ?? null,
    cancelReason: d.cancelReason ?? null,
    source: d.source ?? null,
    createdAt: d.createdAt ?? null,
  }
}

export type LoanSummary = ReturnType<typeof summary>

/** #11/#12: anchor of a transfer order in the web "Antrian Transfer" (section "Transfer pinjaman antar project"). */
export const transferOrderHref = (kind: 'loan' | 'repayment', id: number) => `/admin/antrian-transfer#pinjaman-${kind}-${id}`

const levelRow = (r: DecisionRow) => ({ level: levelOf(r.level), levelLabel: LOAN_LEVEL_LABELS[levelOf(r.level)] })

/** Detail: summary + repayments ("Pengembalian ke-n", requests with their row actions) + decision timeline + allowed actions + notes. */
export async function loanDetail(req: PayloadRequest, doc: LoanDoc) {
  // "Pengembalian ke-n" in repayment-date order (then entry order)
  const rows = (await repaymentsOf(req, doc.id)).sort((a, b) => a.repayDate.localeCompare(b.repayDate) || a.id - b.id)
  const decisions = await decisionsOf(req, doc.id)
  const rowDecisions = await repaymentDecisionsOf(req, rows.filter((r) => r.submittedAt || r.status !== 'posted').map((r) => r.id))
  const n = await names(req, [doc], rows.flatMap((r) => [relId(r.recordedBy), relId(r.voidedBy), relId(r.executedBy)]).filter((x): x is number => x !== undefined))
  const ctx = await actorContext(req, doc, rows)
  const todayStr = await today(req, relId(doc.company))
  const s = summary(doc, n, todayStr)
  const selfDecided = doc.g1Exception === 'direktur_self' && decisions.some((x) => relId(x.actor) === relId(doc.createdBy))
  let k = 0
  // ADR 0031: KK / KM numbers of the disbursement and of each posted repayment of a cash-backed loan
  const cash = doc.cashBacked === true
  const disbursement = cash && doc.disbursedAt ? await legNumbers(req, doc.id, null) : null
  const repaymentCash = new Map<number, { kk: string | null; km: string | null }>()
  if (cash) for (const r of rows.filter((x) => x.status === 'posted')) repaymentCash.set(r.id, await legNumbers(req, doc.id, r.id))
  const user = (v: unknown) => (relId(v) === undefined ? null : { id: relId(v)!, name: n.users.get(relId(v)!) ?? null })
  const decisionOut = (r: DecisionRow) => ({
    id: r.id,
    ...levelRow(r),
    actor: { id: relId(r.actor) ?? null, name: r.actorName ?? null },
    decision: r.decision === 'rejected' ? ('rejected' as const) : ('approved' as const),
    reason: r.reason ?? null,
    decidedAt: r.decidedAt ?? null,
    signatureSource: r.signatureSource ?? null,
  })
  const repayments = []
  for (const r of rows) {
    const mine = rowDecisions.filter((x) => relId(x.loanRepayment) === r.id)
    repayments.push({
      id: r.id,
      seq: r.status === 'posted' ? ++k : null,
      repayDate: r.repayDate,
      plannedDate: r.plannedDate ?? null,
      amount: Math.round(Number(r.amount)),
      note: r.note ?? null,
      status: r.status,
      statusLabel: repaymentStatusLabel(r.status, r.approvalLevel),
      approvalLevel: r.status === 'pending_approval' ? levelOf(r.approvalLevel) : null,
      voidReason: r.voidReason ?? null,
      rejectReason: r.rejectReason ?? null,
      cancelReason: r.cancelReason ?? null,
      recordedBy: { id: relId(r.recordedBy) ?? null, name: n.users.get(relId(r.recordedBy) ?? -1) ?? null },
      voidedBy: user(r.voidedBy),
      voidedAt: r.voidedAt ?? null,
      submittedAt: r.submittedAt ?? null,
      executedAt: r.executedAt ?? null,
      executedBy: user(r.executedBy),
      createdAt: r.createdAt ?? null,
      cash: repaymentCash.get(r.id) ?? null,
      // #12: what the caller may do on this row, and its transfer order while approved
      allowedActions: await repaymentActions(req, doc, r, mine),
      transferQueueHref: r.status === 'approved' && cash ? transferOrderHref('repayment', r.id) : null,
      decisions: mine.map(decisionOut),
    })
  }
  return {
    ...s,
    allowedActions: loanAllowedActions(ctx),
    disbursement,
    mayVoidRepayment: mayVoidRepayment(ctx),
    // #12: a repayment of a cash-backed loan is a request (Direktur → Owner → Antrian Transfer); max of a new one
    repaymentNeedsApproval: cash,
    repayableAmount: ctx.repayableAmount ?? s.outstanding,
    g1Note: doc.g1Exception === 'direktur_self' ? (selfDecided ? DIREKTUR_SELF_NOTE : 'Pembuat adalah satu-satunya Direktur PT: ia dapat memutuskan level Direktur pinjamannya sendiri (tercatat di audit); level Owner tetap oleh Owner.') : null,
    repayments,
    decisions: decisions.map(decisionOut),
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

/** Pending loans waiting for the CALLER's decision at their current level (Direktur 1 / Owner 2, G1), oldest first. */
async function pendingLoansForCaller(req: PayloadRequest, f: { companyIds?: readonly number[] }): Promise<LoanDoc[]> {
  const where: Where = f.companyIds?.length ? { and: [{ status: { equals: 'pending_approval' } }, { company: { in: [...f.companyIds] } }] } : { status: { equals: 'pending_approval' } }
  const res = await req.payload.find({ collection: 'project-loans', where, sort: 'submittedAt', limit: 200, depth: 0, user: req.user, overrideAccess: false, req })
  const docs = res.docs as unknown as LoanDoc[]
  const level2 = docs.filter((d) => levelOf(d.approvalLevel) === 2).map((d) => d.id)
  const rows = level2.length
    ? ((
        await req.payload.find({ collection: 'approvals', where: { and: [{ docType: { equals: 'project_loan' } }, { loan: { in: level2 } }] }, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: decision rows of readable loans */, req })
      ).docs as unknown as DecisionRow[])
    : []
  const out: LoanDoc[] = []
  for (const d of docs) {
    const mine = rows.filter((r) => relId(r.loan) === d.id)
    if (await callerMayDecide(req, { company: relId(d.company), level: levelOf(d.approvalLevel), creatorId: relId(d.createdBy) ?? -2, g1Exception: d.g1Exception ?? null, decisions: async () => mine, cycle: d.approvalCycle ?? 1 })) out.push(d)
  }
  return out
}

/** #12: repayment requests waiting for the CALLER's decision at their current level (G1: never the submitter). */
async function pendingRepaymentsForCaller(req: PayloadRequest, f: { companyIds?: readonly number[] }): Promise<Array<{ row: RepaymentDoc; loan: LoanDoc }>> {
  const where: Where = f.companyIds?.length ? { and: [{ status: { equals: 'pending_approval' } }, { company: { in: [...f.companyIds] } }] } : { status: { equals: 'pending_approval' } }
  // read access of the repayments = the loans the caller may read
  const res = await req.payload.find({ collection: 'project-loan-repayments', where, sort: 'submittedAt', limit: 200, depth: 0, user: req.user, overrideAccess: false, req })
  const rows = res.docs as unknown as RepaymentDoc[]
  if (rows.length === 0) return []
  const loans = new Map(
    ((await req.payload.find({ collection: 'project-loans', where: { id: { in: [...new Set(rows.map((r) => relId(r.loan)!))] } }, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: loans of readable repayments */, req })).docs as unknown as LoanDoc[]).map((l) => [l.id, l]),
  )
  const decisions = await repaymentDecisionsOf(req, rows.map((r) => r.id))
  const out: Array<{ row: RepaymentDoc; loan: LoanDoc }> = []
  for (const row of rows) {
    const loan = loans.get(relId(row.loan) ?? -1)
    if (!loan) continue
    const mine = decisions.filter((x) => relId(x.loanRepayment) === row.id)
    if (await callerMayDecide(req, { company: relId(loan.company), level: levelOf(row.approvalLevel), creatorId: relId(row.recordedBy) ?? -2, g1Exception: null, decisions: async () => mine, cycle: 1 })) out.push({ row, loan })
  }
  return out
}

/** DRMS 20/10: nav badge of "Persetujuan" — loanInbox() without the summaries (loans + repayment requests). */
export async function loanInboxCount(req: PayloadRequest): Promise<number> {
  if (!hasRoleAny(req, 'pk-owner')) return 0
  return (await pendingLoansForCaller(req, {})).length + (await pendingRepaymentsForCaller(req, {})).length
}

/**
 * Loans waiting for the CALLER's decision (Direktur level 1 / Owner level 2, G1), oldest first, and — 2026-10-24 #12 —
 * the repayment requests at the caller's level (`repayments`, decided on the loan's detail).
 */
export async function loanInbox(req: PayloadRequest, f: { companyIds?: readonly number[] } = {}) {
  // the Owner holds pk-owner too (ADR 0026, implied): both levels pass this gate, the level check is per row
  if (!hasRoleAny(req, 'pk-owner')) return { items: [] as LoanSummary[], repayments: [] as RepaymentInboxItem[] }
  const mine = await pendingLoansForCaller(req, f)
  const reps = await pendingRepaymentsForCaller(req, f)
  const n = await names(req, [...mine, ...reps.map((x) => x.loan)], reps.map((x) => relId(x.row.recordedBy)).filter((x): x is number => x !== undefined))
  const todayStr = await today(req)
  return {
    items: mine.map((d) => summary(d, n, todayStr)),
    repayments: reps.map(({ row, loan }) => {
      const l = summary(loan, n, todayStr)
      const by = relId(row.recordedBy)
      return {
        id: row.id,
        loanId: loan.id,
        companyId: l.companyId,
        loanDocNo: l.docNo,
        lenderProject: l.lenderProject,
        borrowerProject: l.borrowerProject,
        lenderCashAccount: l.lenderCashAccount,
        borrowerCashAccount: l.borrowerCashAccount,
        amount: Math.round(Number(row.amount)),
        plannedDate: row.plannedDate ?? row.repayDate,
        note: row.note ?? null,
        approvalLevel: levelOf(row.approvalLevel),
        statusLabel: repaymentStatusLabel(row.status, row.approvalLevel),
        outstanding: l.outstanding,
        submittedBy: by === undefined ? null : { id: by, name: n.users.get(by) ?? null },
        submittedAt: row.submittedAt ?? null,
      }
    }),
  }
}

export type RepaymentInboxItem = {
  id: number
  loanId: number
  companyId: number | null
  loanDocNo: string | null
  lenderProject: LoanSummary['lenderProject']
  borrowerProject: LoanSummary['borrowerProject']
  lenderCashAccount: LoanSummary['lenderCashAccount']
  borrowerCashAccount: LoanSummary['borrowerCashAccount']
  amount: number
  plannedDate: string
  note: string | null
  approvalLevel: LoanApprovalLevel
  statusLabel: string
  outstanding: number
  submittedBy: { id: number; name: string | null } | null
  submittedAt: string | null
}

/** "Antrian Transfer" loan orders of PTs `pts`: approved cash-backed manual loans not transferred yet. */
export const loanOrderLoansWhere = (pts: readonly number[]): Where => ({
  and: [{ company: { in: [...pts] } }, { status: { equals: 'approved' } }, { cashBacked: { equals: true } }, { origin: { equals: 'manual' } }, { disbursedAt: { exists: false } }],
})
/** "Antrian Transfer" repayment orders of PTs `pts`: approved repayment requests (not executed yet). */
export const loanOrderRepaymentsWhere = (pts: readonly number[]): Where => ({ and: [{ company: { in: [...pts] } }, { status: { equals: 'approved' } }] })

/**
 * Pinjaman open item (DRMS 24/10): the loan transfer orders the user may EXECUTE (Finance of the order's PT, selected
 * PTs) — counted into the "Antrian Transfer" nav badge (web launcher + GET /me/modules for the APK) next to the expense
 * transfer queue. Read with the user's access; `count` = Payload's (stubbed in unit tests).
 */
export async function loanTransferOrderCount(payload: Pick<Payload, 'count'>, user: TypedUser): Promise<number> {
  const pts = companiesWithRole({ user }, ['pk-finance'])
  if (pts.length === 0) return 0
  const loans = await payload.count({ collection: 'project-loans', where: loanOrderLoansWhere(pts), user, overrideAccess: false })
  const reps = await payload.count({ collection: 'project-loan-repayments', where: loanOrderRepaymentsWhere(pts), user, overrideAccess: false })
  return loans.totalDocs + reps.totalDocs
}

/**
 * #11/#12 "Antrian Transfer" — transfer orders of inter-project loans: approved cash-backed manual loans not executed
 * yet ("Pencairan pinjaman") and approved repayment requests ("Pengembalian pinjaman"), in the selected PTs where the
 * caller is Finance or Direktur (the office queue roles); only Finance of the PT executes (`canExecute`). A Finance user
 * may execute an order he submitted (`selfSubmitted`, audited) — unlike an expense request's transfer, no self-guard.
 */
export async function loanTransferOrders(req: PayloadRequest, f: { companyIds?: readonly number[] | null } = {}) {
  const pts = companiesWithRole(req, ['pk-finance', 'pk-owner']).filter((c) => !f.companyIds?.length || f.companyIds.includes(c))
  if (!req.user || pts.length === 0 || !mayReadLoans(req)) return { items: [] as LoanTransferOrder[], count: 0 }
  const loansRes = await req.payload.find({
    collection: 'project-loans',
    where: loanOrderLoansWhere(pts),
    sort: 'decidedAt',
    limit: 500,
    depth: 0,
    user: req.user,
    overrideAccess: false, // caller's read scope (office roles of the PT)
    req,
  })
  const repRes = await req.payload.find({ collection: 'project-loan-repayments', where: loanOrderRepaymentsWhere(pts), sort: 'decidedAt', limit: 500, depth: 0, user: req.user, overrideAccess: false, req })
  const reps = repRes.docs as unknown as RepaymentDoc[]
  const own = loansRes.docs as unknown as LoanDoc[]
  const missing = [...new Set(reps.map((r) => relId(r.loan)!))].filter((id) => !own.some((l) => l.id === id))
  const extra = missing.length
    ? ((await req.payload.find({ collection: 'project-loans', where: { id: { in: missing } }, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: loans of readable repayments */, req })).docs as unknown as LoanDoc[])
    : []
  const loans = new Map([...own, ...extra].map((l) => [l.id, l]))
  const n = await names(req, [...loans.values()], reps.map((r) => relId(r.recordedBy)).filter((x): x is number => x !== undefined))
  const uid = userId(req)
  const todays = new Map<number, string>()
  const todayOf = async (c: number) => todays.get(c) ?? todays.set(c, await today(req, c)).get(c)!
  const project = (id: number | undefined) => (id === undefined ? null : { id, code: n.projects.get(id)?.code ?? null, name: n.projects.get(id)?.name ?? null })
  const items: LoanTransferOrder[] = []
  for (const l of own) {
    const c = relId(l.company)!
    items.push({
      kind: 'loan',
      key: `loan-${l.id}`,
      id: l.id,
      loanId: l.id,
      companyId: c,
      docNo: l.docNo ?? null,
      title: 'Pencairan pinjaman',
      amount: amountOf(l),
      date: l.loanDate,
      minDate: l.loanDate,
      today: await todayOf(c),
      dueDate: l.dueDate,
      fromAccount: accountRef(n, l.lenderCashAccount),
      toAccount: accountRef(n, l.borrowerCashAccount),
      fromProject: project(relId(l.lenderProject)),
      toProject: project(relId(l.borrowerProject)),
      // 2026-10-26: an Owner-instructed loan says which request waits for it
      note: relId(l.expenseRequest) === undefined ? null : `Instruksi Owner untuk pengajuan ${n.requests.get(relId(l.expenseRequest)!) ?? `#${relId(l.expenseRequest)}`} — pengajuan disetujui setelah transfer ini.`,
      reason: l.reason,
      submittedBy: { id: relId(l.createdBy) ?? null, name: n.users.get(relId(l.createdBy) ?? -1) ?? null },
      approvedAt: l.decidedAt ?? null,
      selfSubmitted: relId(l.createdBy) === uid,
      canExecute: hasRole(req, 'pk-finance', c),
      href: `/admin/pinjaman/detail/${l.id}`,
      anchor: `pinjaman-loan-${l.id}`,
    })
  }
  for (const r of reps) {
    const l = loans.get(relId(r.loan) ?? -1)
    if (!l) continue
    const c = relId(l.company)!
    items.push({
      kind: 'repayment',
      key: `repayment-${r.id}`,
      id: r.id,
      loanId: l.id,
      companyId: c,
      docNo: l.docNo ?? null,
      title: 'Pengembalian pinjaman',
      amount: Math.round(Number(r.amount)),
      date: r.plannedDate ?? r.repayDate,
      minDate: l.loanDate,
      today: await todayOf(c),
      dueDate: l.dueDate,
      fromAccount: accountRef(n, l.borrowerCashAccount),
      toAccount: accountRef(n, l.lenderCashAccount),
      fromProject: project(relId(l.borrowerProject)),
      toProject: project(relId(l.lenderProject)),
      note: r.note ?? null,
      reason: l.reason,
      submittedBy: { id: relId(r.recordedBy) ?? null, name: n.users.get(relId(r.recordedBy) ?? -1) ?? null },
      approvedAt: r.decidedAt ?? null,
      selfSubmitted: relId(r.recordedBy) === uid,
      canExecute: hasRole(req, 'pk-finance', c),
      href: `/admin/pinjaman/detail/${l.id}`,
      anchor: `pinjaman-repayment-${r.id}`,
    })
  }
  // planned / loan date ascending, then id
  items.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
  return { items, count: items.length }
}

export type LoanTransferOrder = {
  kind: 'loan' | 'repayment'
  key: string
  id: number
  loanId: number
  companyId: number
  docNo: string | null
  title: string
  amount: number
  date: string
  minDate: string
  today: string
  dueDate: string
  fromAccount: { id: number; name: string | null } | null
  toAccount: { id: number; name: string | null } | null
  fromProject: { id: number; code: string | null; name: string | null } | null
  toProject: { id: number; code: string | null; name: string | null } | null
  note: string | null
  reason: string
  submittedBy: { id: number | null; name: string | null }
  approvedAt: string | null
  selfSubmitted: boolean
  canExecute: boolean
  href: string
  anchor: string
}

/**
 * Create form options: borrower projects = the caller is `projects.pm` and holds pk-pm in that PT, or — 2026-10-24 #10 —
 * every open project of a PT where the caller is Finance; lender options = every open project of the same PT(s) (code +
 * name only, SYSTEM-READ: the lender is picked by name — ADR 0022 §3).
 */
export async function loanProjectOptions(req: PayloadRequest): Promise<{ borrowers: Array<{ id: number; code: string; name: string; companyId: number }>; lenders: Array<{ id: number; code: string; name: string; companyId: number }> }> {
  const uid = userId(req)
  if (uid === undefined) return { borrowers: [], lenders: [] }
  const mapped = mappedCompanies(req)
  const res = await req.payload.find({
    collection: 'projects',
    where: { and: [{ status: { not_in: ['arsip', 'dibatalkan'] } }, ...(mapped !== null ? [{ company: { in: mapped } }] : [])] },
    sort: 'code',
    depth: 0,
    pagination: false,
    select: { code: true, name: true, company: true, pm: true },
    overrideAccess: true, // SYSTEM-READ: open projects of the caller's PTs (names only) for the lender picker
    req,
  })
  const all = (res.docs as unknown as Array<{ id: number; code: string; name: string; company?: unknown; pm?: unknown }>).map((p) => ({ id: p.id, code: p.code, name: p.name, companyId: relId(p.company)!, pm: relId(p.pm) }))
  const borrowers = all.filter((p) => (p.pm === uid && hasRole(req, 'pk-pm', p.companyId)) || hasRole(req, 'pk-finance', p.companyId))
  const companies = new Set(borrowers.map((b) => b.companyId))
  const strip = ({ pm: _pm, ...rest }: (typeof all)[number]) => rest
  return { borrowers: borrowers.map(strip), lenders: all.filter((p) => companies.has(p.companyId)).map(strip) }
}
