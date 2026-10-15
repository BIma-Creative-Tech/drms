import { sql } from '@payloadcms/db-postgres'
import { createLocalReq, type PayloadRequest } from 'payload'

import { companiesWithRole, hasExactRole, hasRole, membershipsOf, relId, userId, type Role } from '@/access/roles'
import { writeAudit, writeAuditDetached, type AuditRow } from '@/audit/writer'
import { assertAccount, assertOnOrAfterOpening, currentLockDate, postEntry, voidEntry, type CashEntryDoc } from '@/domain/cash/ledger'
import { failCoded } from '@/domain/coded-error'
import { companyRefs, displayNames, membersWithRole, type CompanyRef } from '@/domain/companies'
import { fail, today } from '@/domain/expense/common'
import { claimMedia } from '@/domain/expense/receipts'
import { transferMoment } from '@/domain/expense/transfers'
import { requestStatusLabel } from '@/domain/expense/timeline'
import { isBusinessDate, type RequestStatus, type RequestType } from '@/domain/expense/types'
import { fundGap } from '@/domain/fundcheck/rules'
import { auditFundInsufficient, fundCheckEnabled, fundFigures, lockFunds, refuseFunds, waitingAtFinal } from '@/domain/fundcheck/service'
import { notificationTemplate, pushEnabled } from '@/domain/notifications'
import { parseBusinessDate } from '@/domain/numbering'
import { allocateDocNo } from '@/domain/numbering-db'
import { formatRupiah } from '@/lib/money'
import { withReqTransaction } from '@/lib/system-tx'
import { getRequestTx } from '@/lib/tx'

import {
  DEFAULT_DUE_DAYS,
  daysOverdue,
  dueDateError,
  IC_LOAN_DOC_TYPE,
  IC_LOAN_NOTIFY_DEFAULTS,
  IC_LOAN_STATUS_LABELS,
  IC_OVERDUE_LABEL,
  icLoanAllowedActions,
  icLoanDestination,
  isOverdue,
  LOAN_HAS_REPAYMENTS,
  LOAN_LENDER_INSUFFICIENT,
  LOAN_REPAYMENT_EXCEEDS_OUTSTANDING,
  LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED,
  maskIcAccountNo,
  outstandingOf,
  plusDays,
  renderLoanText,
  seesIcLoanDestination,
  statusAfterRepayments,
  type IcLoanAction,
  type IcLoanEvent,
  type IcLoanStatus,
  type IcMovementKind,
} from './loan-rules'
import { asSystem, cashInSource, designatedAccount, INTERCOMPANY_NO_ACCOUNT, prepareReceiver } from './service'

/**
 * ADR 0029 §3 "Pinjaman antar-PT" — the single write path behind /api/v1/intercompany-loans. Every function runs in the
 * caller's transaction (number, loan row, movement, KK in the paying PT, the automatic KM in the receiving PT through
 * the ADR 0028 mechanism, the `intercompany_links` pair, audit rows in BOTH PTs and the notifications commit or roll
 * back together). Two-PT operations take both fund locks up front in ascending company id (ADR 0029 §1).
 *
 * Roles (§4, checked on the STORED roles for the Owner, `exactRolesIn`): instruct / cancel = the Owner (pk-principal in
 * both PTs); disbursement + its void = Finance of the LENDER (never the instruction's creator, G1); repayment + its void
 * = Finance of the BORROWER (no approval). Read: Owner / Direktur / Finance / Admin of either PT.
 */

export const IC_LOAN_READ_ROLES: readonly Role[] = ['pk-owner', 'pk-finance', 'pk-admin']
export const icLoanHref = (id: number) => `/admin/pinjaman-antar-pt/detail/${id}`

type Raw = {
  id: number
  uuid: string
  doc_no: string
  lender_company_id: number
  borrower_company_id: number
  amount: string
  instruction_date: string
  due_date: string
  reason: string
  status: IcLoanStatus
  repaid_total: string
  snapshot: Record<string, unknown> | null
  created_by_id: number
  cancel_reason: string | null
  cancelled_by_id: number | null
  cancelled_at: string | Date | null
  created_at: string | Date
}

export type IcLoan = {
  id: number
  uuid: string
  docNo: string
  lenderId: number
  borrowerId: number
  amount: number
  instructionDate: string
  dueDate: string
  reason: string
  status: IcLoanStatus
  repaidTotal: number
  snapshot: Record<string, unknown> | null
  createdBy: number
  cancelReason: string | null
  cancelledBy: number | null
  cancelledAt: string | null
  createdAt: string | null
}

const iso = (v: string | Date | null | undefined): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString())

const toLoan = (r: Raw): IcLoan => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  docNo: r.doc_no,
  lenderId: Number(r.lender_company_id),
  borrowerId: Number(r.borrower_company_id),
  amount: Number(r.amount),
  instructionDate: r.instruction_date,
  dueDate: r.due_date,
  reason: r.reason,
  status: r.status,
  repaidTotal: Number(r.repaid_total),
  snapshot: r.snapshot,
  createdBy: Number(r.created_by_id),
  cancelReason: r.cancel_reason,
  cancelledBy: r.cancelled_by_id === null ? null : Number(r.cancelled_by_id),
  cancelledAt: iso(r.cancelled_at),
  createdAt: iso(r.created_at),
})

async function rowsOf<T>(req: PayloadRequest, q: ReturnType<typeof sql>): Promise<T[]> {
  return ((await (await getRequestTx(req)).execute(q)) as unknown as { rows: T[] }).rows
}

/** PTs whose loans the caller reads (selection ∩ Owner / Direktur / Finance / Admin there). */
export function icLoanReadCompanies(req: PayloadRequest): number[] {
  return companiesWithRole(req, IC_LOAN_READ_ROLES)
}

const visible = (req: PayloadRequest, l: Pick<IcLoan, 'lenderId' | 'borrowerId'>) => {
  const pts = icLoanReadCompanies(req)
  return pts.includes(l.lenderId) || pts.includes(l.borrowerId)
}

/** The loan as the caller may read it (else 404 — no existence leak); `lock` = row lock for an action. */
export async function loadVisibleIcLoan(req: PayloadRequest, id: number, opts: { lock?: boolean } = {}): Promise<IcLoan> {
  if (!Number.isSafeInteger(id) || id <= 0) fail(404, 'Pinjaman antar-PT tidak ditemukan.')
  const r = await rowsOf<Raw>(req, sql`SELECT * FROM intercompany_loans WHERE id = ${id} ${opts.lock ? sql`FOR UPDATE` : sql``}`)
  const l = r[0] ? toLoan(r[0]) : null
  if (!l || !visible(req, l)) fail(404, 'Pinjaman antar-PT tidak ditemukan.')
  return l!
}

// ---------------------------------------------------------------- notifications (same transaction; or detached)

async function notify(req: PayloadRequest, event: IcLoanEvent, recipients: Array<{ userId: number; companyId: number }>, l: Pick<IcLoan, 'id' | 'docNo'>, vars: Record<string, string>): Promise<number> {
  const actor = userId(req)
  const seen = new Set<number>()
  const to = recipients.filter((x) => x.userId !== actor && !seen.has(x.userId) && seen.add(x.userId))
  if (to.length === 0) return 0
  const t = await notificationTemplate(req, event, IC_LOAN_NOTIFY_DEFAULTS[event])
  for (const x of to) {
    await req.payload.create({
      collection: 'notifications',
      data: {
        user: x.userId,
        event,
        title: renderLoanText(t.title, vars).slice(0, 160),
        body: renderLoanText(t.body, vars).slice(0, 1000),
        docType: IC_LOAN_DOC_TYPE,
        docId: String(l.id),
        docNo: l.docNo,
        company: x.companyId,
        pushStatus: pushEnabled() ? 'pending' : 'skipped',
      } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: in-app notification of an inter-PT loan step (ADR 0029 §6)
      req,
    })
  }
  return to.length
}

/** Holders of `role` (stored) in `companyId`, tagged with that PT (notification label). */
async function holders(req: PayloadRequest, role: Role, companyId: number): Promise<Array<{ userId: number; companyId: number }>> {
  return (await membersWithRole(req, role, companyId)).map((u) => ({ userId: u, companyId }))
}

/** A notification that must survive the refusal of the operation (own transaction, like writeAuditDetached). */
async function notifyDetached(req: PayloadRequest, fn: (r: PayloadRequest) => Promise<unknown>): Promise<void> {
  try {
    const r = await createLocalReq({ req: { headers: req.headers }, user: req.user ?? undefined, context: {} }, req.payload)
    await withReqTransaction(r, async () => {
      await fn(r)
    })
  } catch (err) {
    req.payload.logger.error({ msg: 'detached loan notification failed', err: (err as Error).message })
  }
}

async function refsOf(req: PayloadRequest, ids: number[]): Promise<Map<number, CompanyRef>> {
  return new Map((await companyRefs(req, ids)).map((c) => [c.id, c]))
}

function baseVars(l: IcLoan, refs: Map<number, CompanyRef>): Record<string, string> {
  return {
    docNo: l.docNo,
    lender: refs.get(l.lenderId)?.shortCode ?? `#${l.lenderId}`,
    borrower: refs.get(l.borrowerId)?.shortCode ?? `#${l.borrowerId}`,
    amount: formatRupiah(l.amount),
    dueDate: l.dueDate,
    outstanding: formatRupiah(outstandingOf(l)),
  }
}

/** Audit rows of a loan step in BOTH PTs (the loan belongs to both; ADR 0016 amendment). */
async function auditBoth(req: PayloadRequest, l: Pick<IcLoan, 'id' | 'docNo' | 'lenderId' | 'borrowerId'>, row: Omit<AuditRow, 'docType' | 'docId' | 'docNo' | 'companyId'>): Promise<void> {
  await writeAudit(req, [
    { ...row, docType: IC_LOAN_DOC_TYPE, docId: String(l.id), docNo: l.docNo, companyId: l.lenderId },
    { ...row, docType: IC_LOAN_DOC_TYPE, docId: String(l.id), docNo: l.docNo, companyId: l.borrowerId },
  ])
}

// ---------------------------------------------------------------- read side

type MovementRaw = {
  id: number
  kind: IcMovementKind
  from_company_id: number
  to_company_id: number
  from_cash_account_id: number
  to_cash_account_id: number
  amount: string
  transfer_date: string
  transfer_at: string | Date | null
  bank_ref: string
  proof_id: number | null
  status: 'posted' | 'void'
  void_reason: string | null
  voided_by_id: number | null
  voided_at: string | Date | null
  executed_by_id: number
  created_at: string | Date
  link_id: number | null
  kk_id: number | null
  kk_no: string | null
  km_id: number | null
  km_no: string | null
  from_name: string | null
  to_name: string | null
  to_no: string | null
}

async function movementsOf(req: PayloadRequest, loanId: number): Promise<MovementRaw[]> {
  return rowsOf<MovementRaw>(
    req,
    sql`SELECT m.*, x.id AS link_id, x.source_cash_entry_id AS kk_id, kk.entry_no AS kk_no, x.target_cash_entry_id AS km_id, km.entry_no AS km_no,
               fa.name AS from_name, ta.name AS to_name, ta.account_no AS to_no
          FROM intercompany_loan_transfers m
          LEFT JOIN intercompany_links x ON x.source_doc_type = CASE m.kind WHEN 'disbursement' THEN 'intercompany_loan_disbursement' ELSE 'intercompany_loan_repayment' END AND x.source_doc_id = m.id
          LEFT JOIN cash_entries kk ON kk.id = x.source_cash_entry_id
          LEFT JOIN cash_entries km ON km.id = x.target_cash_entry_id
          LEFT JOIN cash_accounts fa ON fa.id = m.from_cash_account_id
          LEFT JOIN cash_accounts ta ON ta.id = m.to_cash_account_id
         WHERE m.loan_id = ${loanId} ORDER BY m.id`,
  )
}

export type IcLoanSummary = {
  id: number
  uuid: string
  docNo: string
  status: IcLoanStatus
  statusLabel: string
  overdue: boolean
  overdueLabel: string | null
  daysOverdue: number
  lender: CompanyRef | null
  borrower: CompanyRef | null
  amount: number
  repaidTotal: number
  outstanding: number
  instructionDate: string
  dueDate: string
  reason: string
  createdBy: { id: number; name: string | null }
  createdAt: string | null
  /** The caller's side: lender (piutang), borrower (hutang) or both (the Owner / a user of both PTs). */
  side: 'lender' | 'borrower' | 'both'
}

function summaryOf(req: PayloadRequest, l: IcLoan, refs: Map<number, CompanyRef>, names: Map<number, string>, todayStr: string): IcLoanSummary {
  const pts = icLoanReadCompanies(req)
  const lenderSide = pts.includes(l.lenderId)
  const borrowerSide = pts.includes(l.borrowerId)
  const overdue = isOverdue(l, todayStr)
  return {
    id: l.id,
    uuid: l.uuid,
    docNo: l.docNo,
    status: l.status,
    statusLabel: IC_LOAN_STATUS_LABELS[l.status],
    overdue,
    overdueLabel: overdue ? IC_OVERDUE_LABEL : null,
    daysOverdue: daysOverdue(l, todayStr),
    lender: refs.get(l.lenderId) ?? null,
    borrower: refs.get(l.borrowerId) ?? null,
    amount: l.amount,
    repaidTotal: l.repaidTotal,
    outstanding: outstandingOf(l),
    instructionDate: l.instructionDate,
    dueDate: l.dueDate,
    reason: l.reason,
    createdBy: { id: l.createdBy, name: names.get(l.createdBy) ?? null },
    createdAt: l.createdAt,
    side: lenderSide && borrowerSide ? 'both' : lenderSide ? 'lender' : 'borrower',
  }
}

/** Actor flags of the caller on a loan (§4; Owner = STORED pk-principal in both PTs). */
function actorOf(req: PayloadRequest, l: IcLoan) {
  return {
    owner: hasExactRole(req, 'pk-principal', l.lenderId) && hasExactRole(req, 'pk-principal', l.borrowerId),
    financeLender: hasRole(req, 'pk-finance', l.lenderId),
    financeBorrower: hasRole(req, 'pk-finance', l.borrowerId),
    creator: userId(req) === l.createdBy,
  }
}

/** GET /intercompany-loans/{id} — the loan, its movements, the linked requests, notes and the caller's actions. */
export async function icLoanDetail(req: PayloadRequest, l: IcLoan) {
  const refs = await refsOf(req, [l.lenderId, l.borrowerId])
  const mv = await movementsOf(req, l.id)
  const userIds = [l.createdBy, l.cancelledBy, ...mv.flatMap((m) => [m.executed_by_id, m.voided_by_id])].filter((x): x is number => typeof x === 'number').map(Number)
  const names = await displayNames(req, [...new Set(userIds)])
  const todayStr = await today(req, l.borrowerId)
  const borrowerSide = hasRole(req, IC_LOAN_READ_ROLES, l.borrowerId)
  const reqs = await rowsOf<{ id: number; doc_no: string | null; title: string; status: RequestStatus; type: RequestType; grand_total: string | null; created_by_id: number | null; approval_snapshot: unknown; current_level: number | null }>(
    req,
    sql`SELECT e.id, e.doc_no, e.title, e.status::text AS status, e.type::text AS type, e.grand_total, e.created_by_id, e.approval_snapshot, e.current_level
          FROM intercompany_loan_requests x JOIN expense_requests e ON e.id = x.request_id WHERE x.loan_id = ${l.id} ORDER BY e.id`,
  )
  const ownRequest = reqs.some((r) => r.created_by_id !== null && Number(r.created_by_id) === l.createdBy)
  const dropped = reqs.filter((r) => r.status === 'cancelled' || r.status === 'rejected')
  const a = actorOf(req, l)
  const allowed: IcLoanAction[] = icLoanAllowedActions(l.status, l.repaidTotal, a)
  let repaySeq = 0
  const movements = mv.map((m) => {
    const payerSide = hasRole(req, IC_LOAN_READ_ROLES, Number(m.from_company_id))
    const receiverSide = hasRole(req, IC_LOAN_READ_ROLES, Number(m.to_company_id))
    const seq = m.kind === 'repayment' && m.status === 'posted' ? ++repaySeq : null
    return {
      id: Number(m.id),
      kind: m.kind,
      label: m.kind === 'disbursement' ? 'Pencairan' : seq ? `Pengembalian ke-${seq}` : 'Pengembalian',
      seq,
      amount: Number(m.amount),
      transferDate: m.transfer_date,
      transferAt: iso(m.transfer_at),
      bankRef: payerSide ? m.bank_ref : null,
      status: m.status,
      voidReason: m.void_reason,
      fromCompanyId: Number(m.from_company_id),
      toCompanyId: Number(m.to_company_id),
      // the paying PT's account by name for its own people; the receiving account masked (ADR 0028 §2)
      fromAccount: payerSide ? { id: Number(m.from_cash_account_id), name: m.from_name } : null,
      toAccount: { name: receiverSide ? m.to_name : null, accountNoMasked: maskIcAccountNo(m.to_no) },
      // KK / KM numbers (counterpart numbers are shown, like ADR 0028); ids only for the Kas roles of that entry's PT
      kk: m.kk_id ? { id: hasRole(req, ['pk-finance', 'pk-owner', 'pk-admin'], Number(m.from_company_id)) ? Number(m.kk_id) : null, entryNo: m.kk_no } : null,
      km: m.km_id ? { id: hasRole(req, ['pk-finance', 'pk-owner', 'pk-admin'], Number(m.to_company_id)) ? Number(m.km_id) : null, entryNo: m.km_no } : null,
      proofId: payerSide && m.proof_id !== null ? Number(m.proof_id) : null,
      executedBy: { id: Number(m.executed_by_id), name: names.get(Number(m.executed_by_id)) ?? null },
      voidedBy: m.voided_by_id ? { id: Number(m.voided_by_id), name: names.get(Number(m.voided_by_id)) ?? null } : null,
      voidedAt: iso(m.voided_at),
      createdAt: iso(m.created_at),
    }
  })
  const lenderAccount = await designatedAccount(req, l.lenderId)
  // the queue item's destination, for the queue item's readers (Finance of the lender while it waits) — a disbursement
  // form opened from a notification needs no queue
  const destination = seesIcLoanDestination(l.status, a.financeLender) ? icLoanDestination(await designatedAccount(req, l.borrowerId)) : null
  return {
    ...summaryOf(req, l, refs, names, todayStr),
    snapshot: l.snapshot,
    cancelReason: l.cancelReason,
    cancelledAt: l.cancelledAt,
    cancelledBy: l.cancelledBy ? { id: l.cancelledBy, name: names.get(l.cancelledBy) ?? null } : null,
    ownRequest,
    ownRequestNote: ownRequest ? 'Pinjaman untuk pengajuan Owner sendiri — pencairan oleh Finance PT pemberi (orang kedua yang independen).' : null,
    droppedRequestNote:
      dropped.length > 0 && l.status === 'instructed' ? `Pengajuan terkait ${dropped.map((r) => r.doc_no ?? `#${r.id}`).join(', ')} dibatalkan / ditolak — batalkan perintah bila tidak diperlukan.` : null,
    lenderHasReceivingAccount: lenderAccount !== null,
    destination,
    // linked requests of the borrower PT: number for everyone who reads the loan; title / status for the borrower's people
    requests: reqs.map((r) => ({
      id: Number(r.id),
      docNo: r.doc_no,
      title: borrowerSide ? r.title : null,
      status: borrowerSide ? r.status : null,
      statusLabel: borrowerSide ? requestStatusLabel(r.type, r.status, (r.approval_snapshot ?? null) as never, r.current_level === null ? null : Number(r.current_level)) : null,
      grandTotal: borrowerSide ? Number(r.grand_total ?? 0) : null,
    })),
    movements,
    allowedActions: allowed,
    disburseBlockedByG1: l.status === 'instructed' && a.financeLender && a.creator,
  }
}

export type IcLoanFilter = { companyIds?: readonly number[]; role?: 'lender' | 'borrower'; status?: readonly IcLoanStatus[]; overdue?: boolean; q?: string; page: number; limit: number }

/** GET /intercompany-loans — loans of the caller's PTs (either side), newest first, numbered pages. */
export async function listIcLoans(req: PayloadRequest, f: IcLoanFilter) {
  const pts = icLoanReadCompanies(req).filter((c) => !f.companyIds?.length || f.companyIds.includes(c))
  const empty = { items: [] as IcLoanSummary[], page: f.page, totalPages: 0, totalDocs: 0, limit: f.limit }
  if (pts.length === 0) return empty
  const ids = sql.join(
    pts.map((c) => sql`${c}`),
    sql`, `,
  )
  const parts = [f.role === 'lender' ? sql`l.lender_company_id IN (${ids})` : f.role === 'borrower' ? sql`l.borrower_company_id IN (${ids})` : sql`(l.lender_company_id IN (${ids}) OR l.borrower_company_id IN (${ids}))`]
  if (f.status?.length) parts.push(sql`l.status IN (${sql.join(f.status.map((s) => sql`${s}`), sql`, `)})`)
  if (f.overdue) parts.push(sql`l.status IN ('disbursed', 'partially_repaid') AND l.amount > l.repaid_total AND l.due_date < to_char(now() AT TIME ZONE coalesce(nullif(cb.timezone, ''), 'Asia/Makassar'), 'YYYY-MM-DD')`)
  for (const t of (f.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5)) {
    const like = `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    parts.push(sql`(l.doc_no ILIKE ${like} OR l.reason ILIKE ${like} OR cl.short_code ILIKE ${like} OR cb.short_code ILIKE ${like})`)
  }
  const where = sql.join(parts, sql` AND `)
  const from = sql`intercompany_loans l JOIN companies cl ON cl.id = l.lender_company_id JOIN companies cb ON cb.id = l.borrower_company_id`
  const total = Number((await rowsOf<{ n: number }>(req, sql`SELECT count(*)::int AS n FROM ${from} WHERE ${where}`))[0]?.n ?? 0)
  const rows = await rowsOf<Raw>(req, sql`SELECT l.* FROM ${from} WHERE ${where} ORDER BY l.id DESC LIMIT ${f.limit} OFFSET ${(f.page - 1) * f.limit}`)
  const loans = rows.map(toLoan)
  const refs = await refsOf(req, loans.flatMap((l) => [l.lenderId, l.borrowerId]))
  const names = await displayNames(req, [...new Set(loans.map((l) => l.createdBy))])
  const todayStr = await today(req)
  return { items: loans.map((l) => summaryOf(req, l, refs, names, todayStr)), page: f.page, totalPages: Math.ceil(total / f.limit), totalDocs: total, limit: f.limit }
}

/**
 * "Pencairan pinjaman antar-PT" queue (§3.5; second tab of the transfer queue, APK Finance section): instructed loans
 * whose LENDER is a PT where the caller is Finance (selection, `companyIds` narrows). `canDisburse` false for the
 * instruction's creator (G1).
 */
export async function icLoanQueue(req: PayloadRequest, f: { companyIds?: readonly number[] } = {}) {
  const pts = companiesWithRole(req, ['pk-finance']).filter((c) => !f.companyIds?.length || f.companyIds.includes(c))
  if (pts.length === 0) return { items: [], count: 0 }
  const rows = await rowsOf<Raw>(
    req,
    sql`SELECT * FROM intercompany_loans WHERE status = 'instructed' AND lender_company_id IN (${sql.join(
      pts.map((c) => sql`${c}`),
      sql`, `,
    )}) ORDER BY instruction_date, id`,
  )
  const loans = rows.map(toLoan)
  const refs = await refsOf(req, loans.flatMap((l) => [l.lenderId, l.borrowerId]))
  const names = await displayNames(req, [...new Set(loans.map((l) => l.createdBy))])
  const todayStr = await today(req)
  const uid = userId(req)
  const items = []
  for (const l of loans) {
    // every item is instructed with a lender where the caller is Finance: seesIcLoanDestination holds by construction
    const acc = await designatedAccount(req, l.borrowerId)
    items.push({
      ...summaryOf(req, l, refs, names, todayStr),
      canDisburse: uid !== l.createdBy,
      g1Note: uid === l.createdBy ? 'Anda yang memerintahkan pinjaman ini — pencairan oleh Finance lain (G1).' : null,
      // the destination: the borrower's designated receiving account (masked, ADR 0028 §2)
      destination: icLoanDestination(acc),
    })
  }
  return { items, count: items.length }
}

/** Nav / tab badge: instructed loans waiting for the caller's (lender) Finance PTs. */
export async function icLoanQueueCount(req: PayloadRequest, f: { companyIds?: readonly number[] } = {}): Promise<number> {
  const pts = companiesWithRole(req, ['pk-finance']).filter((c) => !f.companyIds?.length || f.companyIds.includes(c))
  if (pts.length === 0) return 0
  const r = await rowsOf<{ n: number }>(
    req,
    sql`SELECT count(*)::int AS n FROM intercompany_loans WHERE status = 'instructed' AND lender_company_id IN (${sql.join(
      pts.map((c) => sql`${c}`),
      sql`, `,
    )})`,
  )
  return Number(r[0]?.n ?? 0)
}

/** PTs where the caller is Owner (STORED pk-principal) — every PT of the group for the Owner of the group. */
function ownerCompanies(req: PayloadRequest): number[] {
  return membershipsOf(req.user, { all: true })
    .filter((m) => (m.exactRoles ?? m.roles).includes('pk-principal'))
    .map((m) => m.company)
}

async function activeCompanies(req: PayloadRequest, ids: readonly number[]): Promise<number[]> {
  if (ids.length === 0) return []
  const r = await rowsOf<{ id: number }>(
    req,
    sql`SELECT id FROM companies WHERE active IS NOT FALSE AND id IN (${sql.join(
      ids.map((c) => sql`${c}`),
      sql`, `,
    )}) ORDER BY id`,
  )
  return r.map((x) => Number(x.id))
}

/**
 * GET /intercompany-loans/lenders?borrower=&amount= (§3.4, Owner only): the borrower PT's availability and the requests
 * waiting at their final decision (the "Hitung untuk semua" default), and every OTHER active PT where the caller is
 * Owner with its "Dana tersedia" (same §1 definition), `sufficient` = available ≥ amount, and whether it designated a
 * receiving account (a repayment needs it).
 */
export async function icLenderOptions(req: PayloadRequest, borrowerId: number, amount: number | null) {
  if (!hasExactRole(req, 'pk-principal', borrowerId)) fail(403, 'Hanya Owner yang memerintahkan pinjaman antar-PT.')
  const refs = await refsOf(req, ownerCompanies(req))
  const bf = await fundFigures(req, borrowerId)
  const waiting = await waitingAtFinal(req, borrowerId)
  const bAcc = await designatedAccount(req, borrowerId)
  const lenders = []
  for (const c of await activeCompanies(req, ownerCompanies(req).filter((x) => x !== borrowerId))) {
    const f = await fundFigures(req, c)
    const acc = await designatedAccount(req, c)
    lenders.push({
      company: refs.get(c) ?? { id: c, shortCode: `#${c}`, name: '' },
      balance: f.balance,
      commitments: f.commitments,
      available: f.available,
      sufficient: amount === null ? f.available > 0 : f.available >= amount,
      hasReceivingAccount: acc !== null,
      warning: acc ? null : 'Pengembalian belum dapat dicatat sampai PT ini menetapkan rekening penerimaan antar-PT.',
    })
  }
  const needAll = waiting.reduce((s, w) => s + w.needed, 0)
  return {
    borrower: {
      company: (await refsOf(req, [borrowerId])).get(borrowerId) ?? null,
      balance: bf.balance,
      commitments: bf.commitments,
      available: bf.available,
      fundCheckEnabled: await fundCheckEnabled(req, borrowerId),
      hasReceivingAccount: bAcc !== null,
      waiting: waiting.map((w) => ({ ...w, gap: fundGap(w.needed, bf.available) })),
      /** "Hitung untuk semua pengajuan yang menunggu": Σ needed − available (≥ 0). */
      gapAll: fundGap(needAll, bf.available),
    },
    defaultDueDate: plusDays(await today(req, borrowerId), DEFAULT_DUE_DAYS),
    lenders: lenders.sort((a, b) => Number(b.sufficient) - Number(a.sufficient) || b.available - a.available),
  }
}

// ---------------------------------------------------------------- instruction / cancel (Owner)

export type InstructInput = { borrowerCompanyId: number; lenderCompanyId: number; amount: number; dueDate?: string | null; reason: string; requestIds?: number[] }

async function denied(req: PayloadRequest, field: string, reason: string, value: Record<string, unknown>, companyId?: number): Promise<void> {
  await writeAuditDetached(req, [{ action: 'access_denied', docType: IC_LOAN_DOC_TYPE, field, newValue: value, reason, ...(companyId !== undefined ? { companyId } : {}) }])
}

/**
 * POST /intercompany-loans (§3.4): the Owner's instruction. Checks in one transaction with both fund locks: the
 * Owner in both PTs (stored role), two different active PTs, the borrower's designated receiving account (400
 * INTERCOMPANY_NO_ACCOUNT), amount ≤ the lender's "Dana tersedia" (409 LOAN_LENDER_INSUFFICIENT with the figure), linked
 * requests of the borrower PT that are not cancelled / rejected. Effect: `PJA/{LENDER}/…` number, status `instructed`
 * (the amount enters the lender's Komitmen = the "perintah transfer kas keluar" sitting in its Finance queue).
 */
export async function instructIcLoan(req: PayloadRequest, input: InstructInput): Promise<IcLoan> {
  const L = input.lenderCompanyId
  const B = input.borrowerCompanyId
  if (!(hasExactRole(req, 'pk-principal', L) && hasExactRole(req, 'pk-principal', B))) {
    await denied(req, 'instruct', 'perintah pinjaman antar-PT hanya oleh Owner di kedua PT (ADR 0029 §3.4)', { lenderCompanyId: L, borrowerCompanyId: B })
    fail(403, 'Hanya Owner (di PT pemberi dan PT peminjam) yang dapat memerintahkan pinjaman antar-PT.')
  }
  if (L === B) fail(400, 'PT pemberi dan PT peminjam harus berbeda.', [{ path: 'lenderCompanyId', message: 'Pilih PT lain sebagai pemberi.' }])
  if ((await activeCompanies(req, [L, B])).length !== 2) fail(400, 'PT pemberi atau peminjam tidak ditemukan / nonaktif.')
  const instructionDate = await today(req, L)
  const dueDate = input.dueDate ?? plusDays(instructionDate, DEFAULT_DUE_DAYS)
  if (!isBusinessDate(dueDate)) fail(400, 'Jatuh tempo harus YYYY-MM-DD.', [{ path: 'dueDate', message: 'Tanggal tidak valid.' }])
  const dueErr = dueDateError(instructionDate, dueDate)
  if (dueErr) fail(400, dueErr, [{ path: 'dueDate', message: dueErr }])
  await lockFunds(req, [L, B])
  const refs = await refsOf(req, [L, B])
  if (!(await designatedAccount(req, B))) {
    failCoded(400, INTERCOMPANY_NO_ACCOUNT, `PT ${refs.get(B)?.shortCode ?? 'peminjam'} belum menetapkan rekening penerimaan antar-PT — pinjaman tidak dapat diterima.`, { payeeCompanyId: B }, [
      { path: 'borrowerCompanyId', message: 'PT peminjam belum menetapkan rekening penerimaan antar-PT.' },
    ])
  }
  const lf = await fundFigures(req, L)
  if (input.amount > lf.available) {
    await auditFundInsufficient(req, { docType: IC_LOAN_DOC_TYPE, docId: 0, docNo: null }, 'instruct', { ...lf, needed: input.amount }, L)
    failCoded(409, LOAN_LENDER_INSUFFICIENT, `Dana tersedia PT ${refs.get(L)?.shortCode ?? 'pemberi'} ${formatRupiah(lf.available)} — kurang untuk pinjaman ${formatRupiah(input.amount)}. Pilih PT lain atau kurangi nilainya.`, {
      lenderCompanyId: L,
      available: lf.available,
      needed: input.amount,
      gap: fundGap(input.amount, lf.available),
    })
  }
  const requestIds = [...new Set(input.requestIds ?? [])]
  if (requestIds.length) {
    const found = await rowsOf<{ id: number; company_id: number; status: string; created_by_id: number | null }>(
      req,
      sql`SELECT id, company_id, status::text AS status, created_by_id FROM expense_requests WHERE id IN (${sql.join(
        requestIds.map((i) => sql`${i}`),
        sql`, `,
      )})`,
    )
    const bad = requestIds.filter((id) => {
      const r = found.find((x) => Number(x.id) === id)
      return !r || Number(r.company_id) !== B || r.status === 'cancelled' || r.status === 'rejected'
    })
    if (bad.length) fail(400, 'Pengajuan terkait harus pengajuan PT peminjam yang belum dibatalkan / ditolak.', bad.map((id) => ({ path: 'requestIds', message: `Pengajuan #${id} tidak valid.` })))
  }
  const bf = await fundFigures(req, B)
  const linkedNeed = requestIds.length
    ? Number(
        (
          await rowsOf<{ s: string }>(
            req,
            sql`SELECT coalesce(sum(grand_total), 0)::text AS s FROM expense_requests WHERE id IN (${sql.join(
              requestIds.map((i) => sql`${i}`),
              sql`, `,
            )})`,
          )
        )[0]?.s ?? 0,
      )
    : 0
  const snapshot = { borrowerAvailable: bf.available, borrowerBalance: bf.balance, borrowerCommitments: bf.commitments, borrowerGap: fundGap(linkedNeed, bf.available), lenderAvailable: lf.available, lenderBalance: lf.balance, lenderCommitments: lf.commitments }
  const { docNo } = await allocateDocNo(req, IC_LOAN_DOC_TYPE, { companyId: L, date: parseBusinessDate(instructionDate), audit: false })
  const uid = userId(req)!
  const ins = await rowsOf<Raw>(
    req,
    sql`INSERT INTO intercompany_loans (doc_no, lender_company_id, borrower_company_id, amount, instruction_date, due_date, reason, status, repaid_total, snapshot, created_by_id)
        VALUES (${docNo}, ${L}, ${B}, ${input.amount}, ${instructionDate}, ${dueDate}, ${input.reason.trim()}, 'instructed', 0, ${JSON.stringify(snapshot)}::jsonb, ${uid})
        RETURNING *`,
  )
  const l = toLoan(ins[0]!)
  for (const rid of requestIds) await (await getRequestTx(req)).execute(sql`INSERT INTO intercompany_loan_requests (loan_id, request_id) VALUES (${l.id}, ${rid})`)
  const own = requestIds.length
    ? (await rowsOf<{ n: number }>(req, sql`SELECT count(*)::int AS n FROM intercompany_loan_requests x JOIN expense_requests e ON e.id = x.request_id WHERE x.loan_id = ${l.id} AND e.created_by_id = ${uid}`))[0]!.n > 0
    : false
  await writeAudit(req, [{ action: 'number_issued', docType: IC_LOAN_DOC_TYPE, docId: String(l.id), docNo, field: 'docNo', newValue: docNo, companyId: L }])
  await auditBoth(req, l, {
    action: 'create',
    field: 'intercompanyLoan',
    newValue: { lenderCompanyId: L, borrowerCompanyId: B, amount: l.amount, instructionDate, dueDate, requestIds, snapshot, ownRequest: own },
    reason: l.reason,
  })
  const vars = baseVars(l, refs)
  await notify(
    req,
    'icloan.instructed',
    [...(await holders(req, 'pk-finance', L)), ...(await holders(req, 'pk-owner', L)), ...(await holders(req, 'pk-finance', B)), ...(await holders(req, 'pk-owner', B))],
    l,
    vars,
  )
  return l
}

/** POST /intercompany-loans/{id}/cancel — the Owner, reason, only while `instructed`; the reservation is released. */
export async function cancelIcLoan(req: PayloadRequest, id: number, reason: string): Promise<IcLoan> {
  const l = await loadVisibleIcLoan(req, id, { lock: true })
  if (!actorOf(req, l).owner) {
    await denied(req, 'cancel', 'perintah pinjaman dibatalkan hanya oleh Owner (ADR 0029 §3.4)', { loanId: l.id }, l.lenderId)
    fail(403, 'Hanya Owner yang dapat membatalkan perintah pinjaman antar-PT.')
  }
  if (l.status !== 'instructed') fail(409, `Perintah hanya dapat dibatalkan selama menunggu pencairan (status: ${IC_LOAN_STATUS_LABELS[l.status]}).`)
  const r = await rowsOf<Raw>(
    req,
    sql`UPDATE intercompany_loans SET status = 'cancelled', cancel_reason = ${reason.trim()}, cancelled_by_id = ${userId(req) ?? null}, cancelled_at = now(), updated_at = now() WHERE id = ${l.id} RETURNING *`,
  )
  const out = toLoan(r[0]!)
  await auditBoth(req, out, { action: 'status_change', field: 'status', oldValue: 'instructed', newValue: 'cancelled', statusFrom: 'instructed', statusTo: 'cancelled', reason })
  const refs = await refsOf(req, [l.lenderId, l.borrowerId])
  await notify(req, 'icloan.cancelled', [...(await holders(req, 'pk-finance', l.lenderId)), ...(await holders(req, 'pk-finance', l.borrowerId)), ...(await holders(req, 'pk-owner', l.borrowerId))], out, baseVars(out, refs))
  return out
}

// ---------------------------------------------------------------- money movements (Finance)

export type MovementInput = { cashAccountId: number; bankRef: string; proofMediaId: number; transferAt?: string; transferDate?: string; confirmOverdraft?: boolean }

/** Date of a movement (date + time of the bank proof in the PAYING PT's zone), not in the future. */
async function movementDate(req: PayloadRequest, payer: number, input: Pick<MovementInput, 'transferAt' | 'transferDate'>): Promise<{ date: string; at: Date | null }> {
  const todayDate = await today(req, payer)
  const at = await transferMoment(req, payer, input)
  const date = at?.date ?? input.transferDate ?? todayDate
  if (!isBusinessDate(date)) fail(400, 'Tanggal transfer harus YYYY-MM-DD.', [{ path: 'transferDate', message: 'Tanggal tidak valid.' }])
  if (date > todayDate) fail(400, 'Tanggal transfer tidak boleh di masa depan.', [{ path: 'transferDate', message: 'Tidak boleh di masa depan.' }])
  return { date, at: at?.instant ?? null }
}

/**
 * Paying side of a movement (§3.5 step 3): an ACTIVE account of the paying PT WITHOUT a site (the pool of §1), the
 * opening date, the paying PT's lock date (409 "Periode … sudah ditutup").
 */
async function preparePayer(req: PayloadRequest, payer: number, cashAccountId: number, date: string): Promise<void> {
  const account = await assertAccount(req, cashAccountId, payer)
  if (relId((account as { site?: unknown }).site) !== undefined) {
    fail(400, 'Akun site (kas kecil / rekening kantor cabang) tidak dipakai untuk pinjaman antar-PT — pilih rekening kantor pusat.', [{ path: 'cashAccountId', message: 'Akun site tidak dapat dipakai.' }])
  }
  assertOnOrAfterOpening(account, date, 'transferDate')
  const lock = await currentLockDate(req, payer)
  if (lock && date <= lock) fail(409, `Periode ${date.slice(0, 7)} sudah ditutup (tutup buku s/d ${lock}).`)
}

/**
 * The bank proof is an unclaimed `media-transfer-proofs` upload of the caller — checked BEFORE the movement row (its
 * foreign key) is written; `claimMedia` links it to the KK afterwards (same rules: 400 / 403 / 409).
 */
async function assertProofUsable(req: PayloadRequest, mediaId: number): Promise<void> {
  const m = (await req.payload.findByID({ collection: 'media-transfer-proofs', id: mediaId, depth: 0, overrideAccess: true /* SYSTEM-READ: ownership checked below */, req, disableErrors: true })) as {
    uploadedBy?: unknown
    ownerDocId?: string | null
  } | null
  if (!m) fail(400, 'Bukti transfer tidak ditemukan.', [{ path: 'proofMediaId', message: 'Unggah bukti transfer.' }])
  if (relId(m!.uploadedBy) !== userId(req)) fail(403, 'File bukan unggahan Anda.')
  if (m!.ownerDocId) fail(409, 'File sudah dipakai di dokumen lain.')
}

/** Writes movement → KK (payer) → system KM (receiver) → link; claims the proof (owner: the KK). */
async function postMovement(
  req: PayloadRequest,
  l: IcLoan,
  kind: IcMovementKind,
  input: MovementInput & { amount: number; date: string; at: Date | null },
  refs: Map<number, CompanyRef>,
): Promise<{ movementId: number; kk: CashEntryDoc; km: CashEntryDoc; linkId: number }> {
  const payer = kind === 'disbursement' ? l.lenderId : l.borrowerId
  const receiver = kind === 'disbursement' ? l.borrowerId : l.lenderId
  const payerCode = refs.get(payer)?.shortCode ?? `#${payer}`
  const receiverCode = refs.get(receiver)?.shortCode ?? `#${receiver}`
  const prepared = await prepareReceiver(req, { targetId: receiver, sourceId: payer, date: input.date, noun: kind === 'disbursement' ? 'Pinjaman antar-PT' : 'Pengembalian pinjaman antar-PT' })
  await assertProofUsable(req, input.proofMediaId)
  const uid = userId(req)!
  const mv = await rowsOf<{ id: number }>(
    req,
    sql`INSERT INTO intercompany_loan_transfers (loan_id, kind, from_company_id, to_company_id, from_cash_account_id, to_cash_account_id, amount, transfer_date, transfer_at, bank_ref, proof_id, status, executed_by_id)
        VALUES (${l.id}, ${kind}, ${payer}, ${receiver}, ${input.cashAccountId}, ${prepared.account.id}, ${input.amount}, ${input.date}, ${input.at ? input.at.toISOString() : null}, ${input.bankRef.trim()}, ${input.proofMediaId}, 'posted', ${uid})
        RETURNING id`,
  )
  const movementId = Number(mv[0]!.id)
  // ADR 0028 §5 rule: a description never quotes a number of the OTHER PT (the PJA number belongs to the lender)
  const kk = await postEntry(req, {
    direction: 'out',
    entryDate: input.date,
    cashAccountId: input.cashAccountId,
    amount: input.amount,
    description: (kind === 'disbursement' ? `Pinjaman antar-PT ke ${receiverCode} — ${l.docNo}` : `Pembayaran pinjaman antar-PT ke ${receiverCode}`).slice(0, 1000),
    sourceType: 'intercompany',
    confirmOverdraft: input.confirmOverdraft === true,
  })
  const why = kind === 'disbursement' ? `Kas masuk otomatis pinjaman antar-PT dari PT ${payerCode} (ADR 0029)` : `Kas masuk otomatis pengembalian pinjaman antar-PT dari PT ${payerCode} (ADR 0029)`
  const km = await asSystem(req, why, async () =>
    postEntry(
      req,
      {
        direction: 'in',
        entryDate: input.date,
        cashAccountId: prepared.account.id,
        amount: input.amount,
        cashInSourceId: await cashInSource(req, receiver),
        description: (kind === 'disbursement' ? `Pinjaman antar-PT dari ${payerCode}` : `Pengembalian pinjaman antar-PT dari ${payerCode} — ${l.docNo}`).slice(0, 1000),
        sourceType: 'intercompany',
      },
      { systemCompany: true },
    ),
  )
  const link = await rowsOf<{ id: number }>(
    req,
    sql`INSERT INTO intercompany_links (source_company_id, target_company_id, source_doc_type, source_doc_id, source_transfer_id, source_cash_entry_id,
                                        target_cash_account_id, target_cash_entry_id, amount, status, created_by_id)
        VALUES (${payer}, ${receiver}, ${kind === 'disbursement' ? 'intercompany_loan_disbursement' : 'intercompany_loan_repayment'}, ${movementId}, NULL, ${kk.id},
                ${prepared.account.id}, ${km.id}, ${input.amount}, 'posted', ${uid})
        RETURNING id`,
  )
  await claimMedia(req, 'media-transfer-proofs', input.proofMediaId, kk.id, { ownerType: 'cash_entry' })
  return { movementId, kk, km, linkId: Number(link[0]!.id) }
}

/**
 * POST /intercompany-loans/{id}/disburse (§3.5, Finance of the LENDER): G1 (executor ≠ the instruction's creator: 403,
 * audited; DB-checked), both fund locks, the lender re-check `Dana tersedia + own reservation ≥ amount` (else 409
 * LOAN_LENDER_INSUFFICIENT, the instruction stays and the Owner is told), paying-side and receiving-side checks, then
 * movement → KK lender (`intercompany`) → KM borrower (system) → link → `disbursed`; audit in both PTs; the Owner and
 * the borrower's Finance + Direktur get `icloan.disbursed` with the linked requests now ready for the Owner's approval.
 */
export async function disburseIcLoan(req: PayloadRequest, id: number, input: MovementInput) {
  const l = await loadVisibleIcLoan(req, id, { lock: true })
  if (!hasRole(req, 'pk-finance', l.lenderId)) fail(403, 'Pencairan pinjaman antar-PT dicatat Finance PT pemberi.')
  if (l.status !== 'instructed') fail(409, `Pinjaman tidak menunggu pencairan (status: ${IC_LOAN_STATUS_LABELS[l.status]}).`)
  if (userId(req) === l.createdBy) {
    await denied(req, 'disburse', 'pencairan oleh pembuat perintah pinjaman (G1, ADR 0029 §4)', { loanId: l.id }, l.lenderId)
    fail(403, 'Anda yang memerintahkan pinjaman ini — pencairan harus dicatat Finance lain (G1).')
  }
  if (!input.bankRef.trim()) fail(400, 'Nomor referensi bank wajib diisi.', [{ path: 'bankRef', message: 'Wajib.' }])
  await lockFunds(req, [l.lenderId, l.borrowerId])
  const refs = await refsOf(req, [l.lenderId, l.borrowerId])
  // re-check the lender: its own reservation is part of the commitments — add it back
  const lf = await fundFigures(req, l.lenderId)
  const availableForThis = lf.available + l.amount
  if (availableForThis < l.amount) {
    await auditFundInsufficient(req, { docType: IC_LOAN_DOC_TYPE, docId: l.id, docNo: l.docNo }, 'disburse', { ...lf, available: availableForThis, needed: l.amount }, l.lenderId)
    const vars = { ...baseVars(l, refs), available: formatRupiah(availableForThis) }
    const owners = [...(await holders(req, 'pk-principal', l.lenderId)), ...(await holders(req, 'pk-principal', l.borrowerId))]
    await notifyDetached(req, (r) => notify(r, 'icloan.lender_insufficient', owners, l, vars))
    failCoded(409, LOAN_LENDER_INSUFFICIENT, `Dana tersedia PT ${refs.get(l.lenderId)?.shortCode ?? 'pemberi'} ${formatRupiah(availableForThis)} — kurang untuk pencairan ${formatRupiah(l.amount)}. Perintah tetap menunggu; Owner diberi tahu.`, {
      lenderCompanyId: l.lenderId,
      available: availableForThis,
      needed: l.amount,
      gap: fundGap(l.amount, availableForThis),
    })
  }
  const { date, at } = await movementDate(req, l.lenderId, input)
  await preparePayer(req, l.lenderId, input.cashAccountId, date)
  const posted = await postMovement(req, l, 'disbursement', { ...input, amount: l.amount, date, at }, refs)
  const r = await rowsOf<Raw>(req, sql`UPDATE intercompany_loans SET status = 'disbursed', updated_at = now() WHERE id = ${l.id} RETURNING *`)
  const out = toLoan(r[0]!)
  await auditBoth(req, out, {
    action: 'status_change',
    field: 'status',
    oldValue: 'instructed',
    newValue: { status: 'disbursed', movementId: posted.movementId, kkId: posted.kk.id, kkNo: posted.kk.entryNo, kmId: posted.km.id, kmNo: posted.km.entryNo, amount: l.amount, transferDate: date },
    statusFrom: 'instructed',
    statusTo: 'disbursed',
  })
  // linked requests now covered (still waiting at their final decision) — the Owner approves again (owner 2026-10-14)
  const linked = await rowsOf<{ doc_no: string | null; id: number }>(
    req,
    sql`SELECT e.id, e.doc_no FROM intercompany_loan_requests x JOIN expense_requests e ON e.id = x.request_id WHERE x.loan_id = ${l.id} AND e.status::text IN ('pending_ack', 'pending_approval') ORDER BY e.id`,
  )
  const vars = { ...baseVars(out, refs), requests: linked.length ? ` ${linked.map((x) => x.doc_no ?? `#${x.id}`).join(', ')} siap disetujui.` : '' }
  await notify(req, 'icloan.disbursed', [...(await holders(req, 'pk-principal', l.borrowerId)), ...(await holders(req, 'pk-finance', l.borrowerId)), ...(await holders(req, 'pk-owner', l.borrowerId))], out, vars)
  return { loan: out, kk: posted.kk, km: posted.km }
}

/**
 * POST /intercompany-loans/{id}/disbursement/void (§3.7, Finance of the LENDER): only while NO repayment is posted (409
 * LOAN_HAS_REPAYMENTS); reverses the lender KK and the borrower KM (ledger date rule — a closed period never blocks),
 * link + movement `void`, the loan back to `instructed`. When the borrower's "Dana tersedia" AFTER the reversal is < 0
 * the void needs `confirmBorrowerShortfall` (409 LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED with the figures);
 * approved requests stay approved; the Owner and the borrower's Finance are told.
 */
export async function voidIcDisbursement(req: PayloadRequest, id: number, reason: string, opts: { confirmBorrowerShortfall?: boolean } = {}) {
  const l = await loadVisibleIcLoan(req, id, { lock: true })
  if (!hasRole(req, 'pk-finance', l.lenderId)) fail(403, 'Pencairan pinjaman antar-PT dibatalkan oleh Finance PT pemberi.')
  if (l.status === 'partially_repaid' || l.status === 'repaid' || l.repaidTotal > 0) {
    failCoded(409, LOAN_HAS_REPAYMENTS, 'Pinjaman sudah punya pengembalian — batalkan pengembaliannya dulu (Finance PT peminjam), atau catat pengembalian sisa.', { loanId: l.id, repaidTotal: l.repaidTotal })
  }
  if (l.status !== 'disbursed') fail(409, `Pinjaman belum dicairkan (status: ${IC_LOAN_STATUS_LABELS[l.status]}).`)
  await lockFunds(req, [l.lenderId, l.borrowerId])
  const mv = (await movementsOf(req, l.id)).find((m) => m.kind === 'disbursement' && m.status === 'posted')
  if (!mv || !mv.link_id || !mv.kk_id || !mv.km_id) fail(409, 'Pencairan tidak ditemukan.')
  const bf = await fundFigures(req, l.borrowerId)
  const after = bf.available - l.amount
  const refs = await refsOf(req, [l.lenderId, l.borrowerId])
  if (after < 0 && opts.confirmBorrowerShortfall !== true) {
    failCoded(
      409,
      LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED,
      `Dana tersedia PT ${refs.get(l.borrowerId)?.shortCode ?? 'peminjam'} menjadi ${formatRupiah(after)} sesudah pencairan dibatalkan (dana sudah terpakai / dijanjikan). Konfirmasi untuk tetap membatalkan.`,
      { borrowerCompanyId: l.borrowerId, available: bf.available, after, amount: l.amount },
    )
  }
  const why = `Pencairan pinjaman ${l.docNo} dibatalkan: ${reason}`.slice(0, 1000)
  const kk = await asSystem(req, why, () => voidEntry(req, Number(mv!.kk_id), why, { viaIntercompany: true }))
  const km = await asSystem(req, why, () => voidEntry(req, Number(mv!.km_id), why, { viaIntercompany: true }))
  const tx = await getRequestTx(req)
  const uid = userId(req) ?? null
  await tx.execute(sql`UPDATE intercompany_links SET status = 'void', void_reason = ${why}, voided_by_id = ${uid}, voided_at = now() WHERE id = ${mv!.link_id}`)
  await tx.execute(sql`UPDATE intercompany_loan_transfers SET status = 'void', void_reason = ${reason.trim()}, voided_by_id = ${uid}, voided_at = now() WHERE id = ${mv!.id}`)
  const r = await rowsOf<Raw>(req, sql`UPDATE intercompany_loans SET status = 'instructed', updated_at = now() WHERE id = ${l.id} RETURNING *`)
  const out = toLoan(r[0]!)
  await auditBoth(req, out, {
    action: 'void',
    field: 'status',
    oldValue: 'disbursed',
    newValue: { status: 'instructed', movementId: Number(mv!.id), kkReversalNo: kk.reversal.entryNo, kmReversalNo: km.reversal.entryNo, borrowerAvailableAfter: after, borrowerShortfallConfirmed: after < 0 },
    statusFrom: 'disbursed',
    statusTo: 'instructed',
    reason,
  })
  const vars = { ...baseVars(out, refs), available: formatRupiah(after) }
  await notify(req, 'icloan.disbursement_voided', [...(await holders(req, 'pk-principal', l.borrowerId)), ...(await holders(req, 'pk-finance', l.borrowerId)), ...(await holders(req, 'pk-owner', l.borrowerId))], out, vars)
  return out
}

/**
 * POST /intercompany-loans/{id}/repayments (§3.6, Finance of the BORROWER, no approval): amount ≤ outstanding (409
 * LOAN_REPAYMENT_EXCEEDS_OUTSTANDING), date not before the disbursement, `amount ≤ Dana tersedia(borrower)` (409
 * FUND_INSUFFICIENT — repaying must not strand the borrower's approved requests), destination = the LENDER's designated
 * receiving account (none → 409 INTERCOMPANY_NO_ACCOUNT), lock dates of both PTs. Partial repayments allowed; the
 * status follows `repaid_total`. The Owner and the lender's Finance + Direktur are told (`icloan.repaid`).
 */
export async function repayIcLoan(req: PayloadRequest, id: number, input: MovementInput & { amount: number }) {
  const l = await loadVisibleIcLoan(req, id, { lock: true })
  if (!hasRole(req, 'pk-finance', l.borrowerId)) fail(403, 'Pengembalian pinjaman antar-PT dicatat Finance PT peminjam.')
  if (l.status !== 'disbursed' && l.status !== 'partially_repaid') fail(409, `Pinjaman tidak dalam status dicairkan (status: ${IC_LOAN_STATUS_LABELS[l.status]}).`)
  const outstanding = outstandingOf(l)
  if (input.amount > outstanding) {
    failCoded(409, LOAN_REPAYMENT_EXCEEDS_OUTSTANDING, `Pengembalian ${formatRupiah(input.amount)} melebihi sisa pinjaman ${formatRupiah(outstanding)}.`, { outstanding, amount: input.amount }, [{ path: 'amount', message: `Maksimal ${formatRupiah(outstanding)}.` }])
  }
  if (!input.bankRef.trim()) fail(400, 'Nomor referensi bank wajib diisi.', [{ path: 'bankRef', message: 'Wajib.' }])
  await lockFunds(req, [l.lenderId, l.borrowerId])
  const { date, at } = await movementDate(req, l.borrowerId, input)
  const disb = (await movementsOf(req, l.id)).find((m) => m.kind === 'disbursement' && m.status === 'posted')
  if (disb && date < disb.transfer_date) fail(400, `Tanggal pengembalian tidak boleh sebelum tanggal pencairan (${disb.transfer_date}).`, [{ path: 'transferDate', message: 'Sebelum tanggal pencairan.' }])
  if (!(await designatedAccount(req, l.lenderId))) {
    const refs0 = await refsOf(req, [l.lenderId])
    failCoded(409, INTERCOMPANY_NO_ACCOUNT, `PT ${refs0.get(l.lenderId)?.shortCode ?? 'pemberi'} belum menetapkan rekening penerimaan antar-PT — pengembalian belum dapat dicatat.`, { payeeCompanyId: l.lenderId })
  }
  const bf = await fundFigures(req, l.borrowerId)
  if (input.amount > bf.available) await refuseFunds(req, { docType: IC_LOAN_DOC_TYPE, docId: l.id, docNo: l.docNo }, 'repay', bf, input.amount)
  await preparePayer(req, l.borrowerId, input.cashAccountId, date)
  const refs = await refsOf(req, [l.lenderId, l.borrowerId])
  const posted = await postMovement(req, l, 'repayment', { ...input, date, at }, refs)
  const repaid = l.repaidTotal + input.amount
  const status = statusAfterRepayments(l.amount, repaid)
  const r = await rowsOf<Raw>(req, sql`UPDATE intercompany_loans SET repaid_total = ${repaid}, status = ${status}, updated_at = now() WHERE id = ${l.id} RETURNING *`)
  const out = toLoan(r[0]!)
  await auditBoth(req, out, {
    action: 'update',
    field: 'repaidTotal',
    oldValue: l.repaidTotal,
    newValue: { repaidTotal: repaid, status, movementId: posted.movementId, amount: input.amount, kkNo: posted.kk.entryNo, kmNo: posted.km.entryNo, transferDate: date },
    statusFrom: l.status,
    statusTo: status,
  })
  const vars = { ...baseVars(out, refs), payment: formatRupiah(input.amount) }
  await notify(
    req,
    'icloan.repaid',
    [...(await holders(req, 'pk-principal', l.lenderId)), ...(await holders(req, 'pk-principal', l.borrowerId)), ...(await holders(req, 'pk-finance', l.lenderId)), ...(await holders(req, 'pk-owner', l.lenderId))],
    out,
    vars,
  )
  return { loan: out, kk: posted.kk, km: posted.km }
}

/** POST /intercompany-loans/{id}/repayments/{mid}/void (§3.7, Finance of the BORROWER): reverses both legs; status recomputed. */
export async function voidIcRepayment(req: PayloadRequest, id: number, movementId: number, reason: string) {
  const l = await loadVisibleIcLoan(req, id, { lock: true })
  if (!hasRole(req, 'pk-finance', l.borrowerId)) fail(403, 'Pengembalian pinjaman antar-PT dibatalkan oleh Finance PT peminjam.')
  const mv = (await movementsOf(req, l.id)).find((m) => Number(m.id) === movementId && m.kind === 'repayment')
  if (!mv) fail(404, 'Pengembalian tidak ditemukan.')
  if (mv!.status !== 'posted') fail(409, 'Pengembalian sudah dibatalkan.')
  if (!mv!.link_id || !mv!.kk_id || !mv!.km_id) fail(409, 'Pengembalian tidak lengkap.')
  await lockFunds(req, [l.lenderId, l.borrowerId])
  const why = `Pengembalian pinjaman ${l.docNo} dibatalkan: ${reason}`.slice(0, 1000)
  await asSystem(req, why, () => voidEntry(req, Number(mv!.kk_id), why, { viaIntercompany: true }))
  await asSystem(req, why, () => voidEntry(req, Number(mv!.km_id), why, { viaIntercompany: true }))
  const tx = await getRequestTx(req)
  const uid = userId(req) ?? null
  await tx.execute(sql`UPDATE intercompany_links SET status = 'void', void_reason = ${why}, voided_by_id = ${uid}, voided_at = now() WHERE id = ${mv!.link_id}`)
  await tx.execute(sql`UPDATE intercompany_loan_transfers SET status = 'void', void_reason = ${reason.trim()}, voided_by_id = ${uid}, voided_at = now() WHERE id = ${mv!.id}`)
  const repaid = Math.max(0, l.repaidTotal - Number(mv!.amount))
  const status = statusAfterRepayments(l.amount, repaid)
  const r = await rowsOf<Raw>(req, sql`UPDATE intercompany_loans SET repaid_total = ${repaid}, status = ${status}, updated_at = now() WHERE id = ${l.id} RETURNING *`)
  const out = toLoan(r[0]!)
  await auditBoth(req, out, { action: 'void', field: 'repaidTotal', oldValue: l.repaidTotal, newValue: { repaidTotal: repaid, status, movementId }, statusFrom: l.status, statusTo: status, reason })
  return out
}

// ---------------------------------------------------------------- overdue (reminder job)

/** Overdue loans of a BORROWER PT on `date` (§3.8): disbursed / partially repaid, outstanding > 0, due before `date`. */
export async function overdueIcLoans(req: PayloadRequest, borrowerId: number, date: string): Promise<IcLoan[]> {
  const r = await rowsOf<Raw>(
    req,
    sql`SELECT * FROM intercompany_loans WHERE borrower_company_id = ${borrowerId} AND status IN ('disbursed', 'partially_repaid') AND amount > repaid_total AND due_date < ${date} ORDER BY due_date, id`,
  )
  return r.map(toLoan)
}

export { baseVars as icLoanVars }
