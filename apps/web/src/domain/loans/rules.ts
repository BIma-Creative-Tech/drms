/**
 * ADR 0022 — Inter-project loan ("Pinjaman antar project", DRMS 10/10 point 15, owner D6 + Q-L1…Q-L7 2026-10-11).
 * Pure module (unit-tested, bundled into the OpenAPI generator): statuses, transitions, input validation, the
 * outstanding / overdue arithmetic and the Direktur pool (G1, ADR 0021 "Utamakan Direktur lain"). No Payload import.
 *
 * A loan is a RECORDED CLAIM of the lender on the borrower project inside one PT. ADR 0031 (DRMS 21/10, amends ADR
 * 0022 §5): money lent between two different Pusat Biaya (cash accounts) also MOVES cash — `cashBacked` — through
 * Finance's "Cairkan" (KK lender account + KM borrower account) and every repayment (the mirror pair). Goods, or two
 * projects of the same account, stay a notional claim. Origin `transfer`: the automatic loan of a transfer paid from
 * another account (lender = that account, approved and disbursed with the transfer).
 * ADR 0022/0031 amendment 2026-10-24 (DRMS 24/10 #10–#12): submitted by the borrower PM OR Finance of the PT; two
 * levels — Direktur (1) then Owner (2); money (`dana`) between two KNOWN accounts is cash-backed even when both projects
 * share ONE account (the pair is posted on it, tagged with each project). After the Owner's approval the loan is a
 * TRANSFER ORDER in Finance's "Antrian Transfer"; a repayment of a cash-backed loan is a request with the same path
 * (Direktur → Owner → transfer order → executed). A claim (`barang`) is repaid by a plain record as before.
 */

import { formatRupiah } from '@/lib/money'

export const LOAN_STATUSES = ['draft', 'pending_approval', 'approved', 'partially_repaid', 'repaid', 'rejected', 'cancelled'] as const
export type LoanStatus = (typeof LOAN_STATUSES)[number]

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Menunggu persetujuan Direktur',
  approved: 'Disetujui',
  partially_repaid: 'Sebagian kembali',
  repaid: 'Lunas',
  rejected: 'Ditolak',
  cancelled: 'Dibatalkan',
}

/** Derived (never stored): `dueDate < today AND outstanding > 0 AND status IN (approved, partially_repaid)`. */
export const OVERDUE_LABEL = 'Terlambat'

export const LOAN_KINDS = ['dana', 'barang'] as const
export type LoanKind = (typeof LOAN_KINDS)[number]
export const LOAN_KIND_LABELS: Record<LoanKind, string> = { dana: 'Dana', barang: 'Barang/material' }

/** ADR 0031: `manual` = PM / Finance submits, Direktur → Owner approve (ADR 0022, amended 2026-10-24); `transfer` = automatic, from a transfer paid from another account. */
export const LOAN_ORIGINS = ['manual', 'transfer'] as const
export type LoanOrigin = (typeof LOAN_ORIGINS)[number]
export const LOAN_ORIGIN_LABELS: Record<LoanOrigin, string> = { manual: 'Diajukan PM / Finance', transfer: 'Otomatis dari transfer' }

/**
 * 2026-10-24 (#10): who filed a manual loan — the borrower project's PM or a Finance user of the PT (frozen at create).
 * 2026-10-26 (DRMS 26/10 #1): `owner` = instructed by the final decider of an expense request whose project's cash account
 * is short ("Instruksi pinjam antar proyek"): born approved, no Direktur / Owner level, linked to the request.
 */
export const LOAN_SUBMITTER_ROLES = ['pm', 'finance', 'owner'] as const
export type LoanSubmitterRole = (typeof LOAN_SUBMITTER_ROLES)[number]
export const LOAN_SUBMITTER_LABELS: Record<LoanSubmitterRole, string> = { pm: 'PM project peminjam', finance: 'Finance', owner: 'Instruksi Owner' }

/** "Asal" of one loan: an automatic loan, else who submitted it (a legacy manual loan without role = the PM). */
export function loanOriginLabel(origin: LoanOrigin | null | undefined, submitterRole: LoanSubmitterRole | null | undefined): string {
  if (origin === 'transfer') return LOAN_ORIGIN_LABELS.transfer
  if (submitterRole === 'owner') return 'Instruksi Owner'
  return submitterRole === 'finance' ? 'Diajukan Finance' : 'Diajukan PM'
}

/** ADR 0031 + 2026-10-24 (#11): an approved cash-backed loan whose transfer order Finance has not executed yet. */
export const AWAITING_DISBURSEMENT_LABEL = 'Disetujui – menunggu transfer Finance'

/**
 * 2026-10-24 (#10): approval levels of a manual loan and of a repayment request — 1 Direktur (`pk-owner`), 2 Owner
 * (`pk-principal`), both as STORED roles (the Owner's implied Direktur role never decides level 1).
 */
export const LOAN_APPROVAL_LEVELS = [1, 2] as const
export type LoanApprovalLevel = (typeof LOAN_APPROVAL_LEVELS)[number]
export const LOAN_LAST_LEVEL: LoanApprovalLevel = 2
export const LOAN_LEVEL_LABELS: Record<LoanApprovalLevel, string> = { 1: 'Direktur', 2: 'Owner' }
export const levelOf = (v: unknown): LoanApprovalLevel => (Number(v) === 2 ? 2 : 1)

/** "Menunggu persetujuan Direktur" / "Menunggu persetujuan Owner". */
export const pendingLabel = (level: unknown): string => `Menunggu persetujuan ${LOAN_LEVEL_LABELS[levelOf(level)]}`

/** Status text of a loan: the level while pending, "menunggu transfer Finance" while its transfer order waits. */
export function loanStatusLabel(l: { status: LoanStatus; approvalLevel?: unknown; awaitingDisbursement?: boolean }): string {
  if (l.status === 'pending_approval') return pendingLabel(l.approvalLevel)
  if (l.status === 'approved' && l.awaitingDisbursement) return AWAITING_DISBURSEMENT_LABEL
  return LOAN_STATUS_LABELS[l.status]
}

/**
 * ADR 0031, amended 2026-10-24 (#11): does a loan move cash? Money (`dana`) between two KNOWN Pusat Biaya accounts —
 * also when both projects share the SAME account (the KK / KM pair is posted on it, tagged with each project, so every
 * project cash book shows the loan). Goods, or a project without an account, stay a notional claim (ADR 0022 §5 option B).
 */
export function isCashBacked(l: { kind: LoanKind; lenderCashAccountId: number | null | undefined; borrowerCashAccountId: number | null | undefined }): boolean {
  return l.kind === 'dana' && typeof l.lenderCashAccountId === 'number' && typeof l.borrowerCashAccountId === 'number'
}

/** Default due date of an automatic loan: loan date + 30 days (Q-L4: a due date is always set). */
export const AUTO_LOAN_DUE_DAYS = 30

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const LOAN_ACTIONS = ['edit', 'submit', 'cancel', 'approve', 'reject', 'disburse', 'repay'] as const
export type LoanAction = (typeof LOAN_ACTIONS)[number]

/** G1 exception recorded on the loan (ADR 0022 §4, Q-L5): the creator PM is the PT's only Direktur — level 1 only. */
export const LOAN_G1_EXCEPTIONS = ['direktur_self'] as const
export type LoanG1Exception = (typeof LOAN_G1_EXCEPTIONS)[number]
export const DIREKTUR_SELF_NOTE = 'Disetujui Direktur pembuat karena satu-satunya Direktur PT'
export const SAME_PM_NOTE = 'PM peminjam = PM pemberi'

/** Status transitions performed by the service (DB trigger `pk_project_loans_guard` mirrors them). */
export const LOAN_TRANSITIONS: Readonly<Record<LoanStatus, readonly LoanStatus[]>> = {
  draft: ['pending_approval', 'cancelled'],
  pending_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['partially_repaid', 'repaid', 'cancelled'],
  partially_repaid: ['repaid', 'approved'],
  repaid: ['partially_repaid', 'approved'],
  rejected: [],
  cancelled: [],
}

export const isTerminal = (s: LoanStatus): boolean => LOAN_TRANSITIONS[s].length === 0
export const canTransition = (from: LoanStatus, to: LoanStatus): boolean => from === to || LOAN_TRANSITIONS[from].includes(to)

/** Statuses from the Direktur's approval on: they count in every loan figure (borrowed / lent / outstanding). */
export const LOAN_ACTIVE: readonly LoanStatus[] = ['approved', 'partially_repaid', 'repaid']
/** Statuses that accept a repayment. */
export const LOAN_REPAYABLE: readonly LoanStatus[] = ['approved', 'partially_repaid']

/** Sanity bound (Rp 1 triliun), same as the addendum addition — not a business limit. */
export const MAX_LOAN_AMOUNT = 1_000_000_000_000
export const REASON_MIN = 3
export const REASON_MAX = 1000
export const NOTE_MAX = 500

const DATE = /^\d{4}-\d{2}-\d{2}$/
export const isDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v

export type LoanInput = {
  lenderProjectId?: unknown
  borrowerProjectId?: unknown
  kind?: unknown
  amount?: unknown
  reason?: unknown
  loanDate?: unknown
  dueDate?: unknown
}

export type FieldError = { path: string; message: string }

/** ADR 0022 §1: input rules of a Draft (create / edit / again at submit). `today` = PT business date. */
export function loanInputErrors(input: LoanInput, today: string): FieldError[] {
  const errors: FieldError[] = []
  const lender = input.lenderProjectId
  const borrower = input.borrowerProjectId
  if (typeof lender !== 'number' || !Number.isSafeInteger(lender) || lender <= 0) errors.push({ path: 'lenderProjectId', message: 'Project pemberi pinjaman wajib dipilih.' })
  if (typeof borrower !== 'number' || !Number.isSafeInteger(borrower) || borrower <= 0) errors.push({ path: 'borrowerProjectId', message: 'Project peminjam wajib dipilih.' })
  else if (lender === borrower) errors.push({ path: 'lenderProjectId', message: 'Project pemberi dan peminjam harus berbeda.' })
  if (input.kind !== undefined && !(LOAN_KINDS as readonly unknown[]).includes(input.kind)) errors.push({ path: 'kind', message: 'Jenis pinjaman harus Dana atau Barang/material.' })
  const a = input.amount
  if (typeof a !== 'number' || !Number.isSafeInteger(a) || a <= 0) errors.push({ path: 'amount', message: 'Nilai pinjaman wajib diisi (bilangan bulat Rupiah > 0).' })
  else if (a > MAX_LOAN_AMOUNT) errors.push({ path: 'amount', message: 'Nilai pinjaman terlalu besar.' })
  const r = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (r.length < REASON_MIN) errors.push({ path: 'reason', message: `Alasan wajib diisi (min. ${REASON_MIN} karakter).` })
  else if (r.length > REASON_MAX) errors.push({ path: 'reason', message: `Alasan maks. ${REASON_MAX} karakter.` })
  const ld = input.loanDate
  if (!isDate(ld)) errors.push({ path: 'loanDate', message: 'Tanggal pinjaman wajib diisi (YYYY-MM-DD).' })
  else if (ld > today) errors.push({ path: 'loanDate', message: 'Tanggal pinjaman tidak boleh di masa depan.' })
  const dd = input.dueDate
  if (!isDate(dd)) errors.push({ path: 'dueDate', message: 'Jatuh tempo wajib diisi (YYYY-MM-DD).' })
  else if (isDate(ld) && dd < ld) errors.push({ path: 'dueDate', message: 'Jatuh tempo tidak boleh sebelum tanggal pinjaman.' })
  return errors
}

/** ADR 0022 §7: a repayment (amount ≤ outstanding, date between the loan date and today). */
export function repaymentInputErrors(input: { amount?: unknown; repayDate?: unknown; note?: unknown }, loan: { loanDate: string; outstanding: number }, today: string): FieldError[] {
  const errors: FieldError[] = []
  const a = input.amount
  if (typeof a !== 'number' || !Number.isSafeInteger(a) || a <= 0) errors.push({ path: 'amount', message: 'Nominal pengembalian wajib diisi (bilangan bulat Rupiah > 0).' })
  else if (a > loan.outstanding) errors.push({ path: 'amount', message: `Nominal pengembalian melebihi sisa pinjaman (${formatRupiah(loan.outstanding)}).` })
  const d = input.repayDate
  if (!isDate(d)) errors.push({ path: 'repayDate', message: 'Tanggal pengembalian wajib diisi (YYYY-MM-DD).' })
  else if (d < loan.loanDate) errors.push({ path: 'repayDate', message: 'Tanggal pengembalian tidak boleh sebelum tanggal pinjaman.' })
  else if (d > today) errors.push({ path: 'repayDate', message: 'Tanggal pengembalian tidak boleh di masa depan.' })
  if (input.note !== undefined && input.note !== null && (typeof input.note !== 'string' || input.note.trim().length > NOTE_MAX)) errors.push({ path: 'note', message: `Catatan maks. ${NOTE_MAX} karakter.` })
  return errors
}

/** Status of an approved loan from its repaid total (§2): 0 → Disetujui, 0 < x < amount → Sebagian kembali, = amount → Lunas. */
export function statusForRepaid(amount: number, repaidTotal: number): Extract<LoanStatus, 'approved' | 'partially_repaid' | 'repaid'> {
  if (repaidTotal <= 0) return 'approved'
  return repaidTotal >= amount ? 'repaid' : 'partially_repaid'
}

export const outstandingOf = (amount: number, repaidTotal: number): number => Math.max(0, amount - repaidTotal)

/** Overdue ("Terlambat"), derived: due date before today, something still owed, approved / partially repaid. */
export function isOverdue(l: { status: LoanStatus; dueDate: string | null | undefined; outstanding: number }, today: string): boolean {
  return LOAN_REPAYABLE.includes(l.status) && l.outstanding > 0 && typeof l.dueDate === 'string' && l.dueDate < today
}

/** Whole days past the due date (0 when not overdue). */
export function daysOverdue(l: { status: LoanStatus; dueDate: string | null | undefined; outstanding: number }, today: string): number {
  if (!isOverdue(l, today)) return 0
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${l.dueDate}T00:00:00Z`)) / 86_400_000)
}

/**
 * ADR 0022 §4 (G1, ADR 0021 "Utamakan Direktur lain"): who decides a loan created by `creatorId`, given the PT's
 * active Direktur (`pk-owner`) accounts. Creator not a Direktur → every Direktur. Creator is a Direktur and another
 * one exists → only the others (no exception). Creator is the ONLY Direktur → himself, recorded as `direktur_self`.
 * No Direktur at all → empty pool (submit answers 409).
 */
export function direkturPool(creatorId: number, direkturIds: readonly number[]): { pool: number[]; exception: LoanG1Exception | null } {
  const all = [...new Set(direkturIds)].sort((a, b) => a - b)
  if (!all.includes(creatorId)) return { pool: all, exception: null }
  const others = all.filter((x) => x !== creatorId)
  if (others.length > 0) return { pool: others, exception: null }
  return { pool: [creatorId], exception: 'direktur_self' }
}

/** Decision pool at decision time: the PT's Direktur minus the creator, unless the loan carries `direktur_self`. */
export function mayDecide(c: { callerId: number; creatorId: number; callerIsDirektur: boolean; g1Exception: LoanG1Exception | null | undefined }): boolean {
  if (!c.callerIsDirektur) return false
  if (c.callerId !== c.creatorId) return true
  return c.g1Exception === 'direktur_self'
}

export type PoolError = 'NO_DIREKTUR' | 'NO_OWNER' | 'SAME_PERSON'

/**
 * 2026-10-24 (#10, G1): both decision pools of a submit. Level 1 = `direkturPool` (the narrow `direktur_self` stays as
 * it is); level 2 = the PT's active Owner minus the creator (never an exception: a PT without an Owner, or whose only
 * Owner filed the loan, refuses the submit — like an expense request, ADR 0026). One person never holds both levels
 * (one decision position per person, DB index): a single Direktur who is also the single Owner → `SAME_PERSON`.
 */
export function decisionPools(creatorId: number, direkturIds: readonly number[], ownerIds: readonly number[]): { direktur: number[]; owner: number[]; exception: LoanG1Exception | null; error: PoolError | null } {
  const d = direkturPool(creatorId, direkturIds)
  const owner = [...new Set(ownerIds)].filter((x) => x !== creatorId).sort((a, b) => a - b)
  const error: PoolError | null = d.pool.length === 0 ? 'NO_DIREKTUR' : owner.length === 0 ? 'NO_OWNER' : d.pool.every((x) => owner.every((o) => o === x)) ? 'SAME_PERSON' : null
  return { direktur: d.pool, owner, exception: d.exception, error }
}

export const POOL_ERROR_MESSAGES: Record<PoolError, string> = {
  NO_DIREKTUR: 'PT ini belum punya Direktur aktif untuk menyetujui pinjaman. Hubungi Admin.',
  NO_OWNER: 'PT ini belum punya Owner aktif untuk persetujuan level Owner (Direktur → Owner). Pengajuan tidak dapat dikirim. Hubungi Admin.',
  SAME_PERSON: 'Persetujuan Direktur dan Owner harus oleh dua orang berbeda: Direktur satu-satunya juga Owner satu-satunya PT ini. Hubungi Admin.',
}

/**
 * 2026-10-24 (#10): may the caller decide the CURRENT level? Level 1 = `mayDecide` (stored Direktur, G1 incl.
 * `direktur_self`) — but not when the caller is the last Owner who could still take level 2 (`ownerPool` given);
 * level 2 = a stored Owner who is neither the creator (G1, no exception) nor the decider of level 1 (`priorDeciders`).
 */
export function mayDecideLevel(c: {
  level: LoanApprovalLevel
  callerId: number
  creatorId: number
  callerIsDirektur: boolean
  callerIsOwner: boolean
  g1Exception?: LoanG1Exception | null
  priorDeciders?: readonly number[]
  ownerPool?: readonly number[]
}): boolean {
  if (c.level === 2) return c.callerIsOwner && c.callerId !== c.creatorId && !(c.priorDeciders ?? []).includes(c.callerId)
  if (!mayDecide({ callerId: c.callerId, creatorId: c.creatorId, callerIsDirektur: c.callerIsDirektur, g1Exception: c.g1Exception })) return false
  return c.ownerPool === undefined || c.ownerPool.some((x) => x !== c.callerId && x !== c.creatorId)
}

export type LoanActorContext = {
  status: LoanStatus
  isCreator: boolean
  /** Caller = `projects.pm` of the borrower project and holds pk-pm in the loan's PT. */
  isBorrowerPm: boolean
  /** Caller holds pk-owner in the loan's PT. */
  isDirektur: boolean
  /** Caller holds pk-finance in the loan's PT. */
  isFinance: boolean
  /** Caller may decide (Direktur pool, G1). */
  mayDecide: boolean
  /** A posted repayment exists. */
  hasRepayment: boolean
  /** ADR 0031: the loan moves cash (money between two different Pusat Biaya accounts). */
  cashBacked?: boolean
  /** ADR 0031: Finance posted the disbursement (or the automatic loan was paid with its transfer). */
  disbursed?: boolean
  /** ADR 0031: `transfer` = automatic loan (cancelled only through its transfer's void). */
  origin?: LoanOrigin
  /** 2026-10-24 (#12): outstanding minus the repayment requests not executed yet (undefined = no reservation known). */
  repayableAmount?: number
}

/** Actions the caller may take now (UI + service guard; the DB re-checks G1 and the transitions). */
export function loanAllowedActions(c: LoanActorContext): LoanAction[] {
  const out: LoanAction[] = []
  const auto = c.origin === 'transfer'
  // 2026-10-24 (#10): the creator files while still borrower PM or Finance of the PT
  if (c.status === 'draft' && c.isCreator && (c.isBorrowerPm || c.isFinance)) out.push('edit', 'submit')
  if (c.isCreator && (c.status === 'draft' || c.status === 'pending_approval')) out.push('cancel')
  // ADR 0031: a disbursed loan is settled by repayments (its cash cannot be "un-lent"); an automatic one goes with its transfer
  else if (c.isDirektur && c.status === 'approved' && !c.hasRepayment && !auto && !(c.cashBacked && c.disbursed)) out.push('cancel')
  if (c.status === 'pending_approval' && c.mayDecide) out.push('approve', 'reject')
  // 2026-10-24 (#11): Finance executes the transfer order (Antrian Transfer; `disburse` kept for older APKs)
  if (c.status === 'approved' && c.cashBacked && !c.disbursed && c.isFinance) out.push('disburse')
  // #12: a cash-backed loan is repaid by a REQUEST (borrower PM / Finance → Direktur → Owner → transfer order), after the
  // disbursement and while something is not yet requested; a claim is recorded as before (Q-L7)
  const room = c.repayableAmount === undefined || c.repayableAmount > 0
  if (LOAN_REPAYABLE.includes(c.status) && (c.isBorrowerPm || c.isFinance) && (!c.cashBacked || (c.disbursed && room))) out.push('repay')
  return out
}

/**
 * Void of a posted repayment (ADR 0022 §7): Direktur or Finance of the PT, reason required. ADR 0031: a repayment that
 * moved cash is reversed in the cash book → Finance only.
 */
export const mayVoidRepayment = (c: Pick<LoanActorContext, 'isDirektur' | 'isFinance' | 'cashBacked'>): boolean => (c.cashBacked ? c.isFinance : c.isDirektur || c.isFinance)

// ---------------------------------------------------------------- 2026-10-24 (#12): repayment requests of a cash-backed loan

/**
 * `posted` = executed (cash moved) or, for a claim, recorded — the code every existing row and report already uses
 * (existing rows ARE executed repayments: no data change). A cash-backed repayment is inserted `pending_approval`.
 */
export const REPAYMENT_STATUSES = ['pending_approval', 'approved', 'posted', 'void', 'rejected', 'cancelled'] as const
export type RepaymentStatus = (typeof REPAYMENT_STATUSES)[number]

export const REPAYMENT_STATUS_LABELS: Record<RepaymentStatus, string> = {
  pending_approval: 'Menunggu persetujuan',
  approved: 'Disetujui – menunggu transfer Finance',
  posted: 'Tercatat',
  void: 'Dibatalkan (void)',
  rejected: 'Ditolak',
  cancelled: 'Dibatalkan',
}

/** Status text of a repayment (the level while pending). */
export const repaymentStatusLabel = (status: RepaymentStatus, level?: unknown): string => (status === 'pending_approval' ? pendingLabel(level) : REPAYMENT_STATUS_LABELS[status])

/** Transitions of a repayment (DB trigger `pk_project_loan_repayments_guard` mirrors them). */
export const REPAYMENT_TRANSITIONS: Readonly<Record<RepaymentStatus, readonly RepaymentStatus[]>> = {
  pending_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['posted', 'cancelled'],
  posted: ['void'],
  void: [],
  rejected: [],
  cancelled: [],
}

/** Requests that reserve part of the outstanding amount (not executed yet). */
export const REPAYMENT_OPEN: readonly RepaymentStatus[] = ['pending_approval', 'approved']

export const REPAYMENT_ACTIONS = ['approve', 'reject', 'cancel', 'execute', 'void'] as const
export type RepaymentAction = (typeof REPAYMENT_ACTIONS)[number]

export type RepaymentActorContext = {
  status: RepaymentStatus
  /** Caller recorded / submitted the repayment. */
  isCreator: boolean
  isDirektur: boolean
  isFinance: boolean
  /** Caller may decide the current level (`mayDecideLevel`). */
  mayDecide: boolean
  cashBacked: boolean
}

/**
 * Row actions of a repayment: decide the current level; the submitter cancels while pending; an approved order is
 * executed by Finance (the submitter may execute his own: no Finance self-guard on loans, audited) or cancelled by
 * Finance / the submitter; a posted one is voided (`mayVoidRepayment`).
 */
export function repaymentAllowedActions(c: RepaymentActorContext): RepaymentAction[] {
  const out: RepaymentAction[] = []
  if (c.status === 'pending_approval') {
    if (c.mayDecide) out.push('approve', 'reject')
    if (c.isCreator) out.push('cancel')
  } else if (c.status === 'approved') {
    if (c.isFinance) out.push('execute')
    if (c.isFinance || c.isCreator) out.push('cancel')
  } else if (c.status === 'posted' && mayVoidRepayment(c)) out.push('void')
  return out
}

/** Σ of the requests not executed yet (they reserve the outstanding amount). */
export const reservedOf = (rows: ReadonlyArray<{ status: RepaymentStatus; amount: number | string }>): number =>
  rows.filter((r) => REPAYMENT_OPEN.includes(r.status)).reduce((s, r) => s + Math.round(Number(r.amount)), 0)

/** #12: a repayment REQUEST — amount ≤ outstanding not yet requested, planned date ≥ the loan date (may be in the future). */
export function repaymentRequestErrors(input: { amount?: unknown; repayDate?: unknown; note?: unknown }, loan: { loanDate: string; repayable: number }): FieldError[] {
  const errors: FieldError[] = []
  const a = input.amount
  if (typeof a !== 'number' || !Number.isSafeInteger(a) || a <= 0) errors.push({ path: 'amount', message: 'Nominal pengembalian wajib diisi (bilangan bulat Rupiah > 0).' })
  else if (a > loan.repayable) errors.push({ path: 'amount', message: `Nominal pengembalian melebihi sisa pinjaman yang belum diajukan (${formatRupiah(loan.repayable)}).` })
  const d = input.repayDate
  if (!isDate(d)) errors.push({ path: 'repayDate', message: 'Rencana tanggal pengembalian wajib diisi (YYYY-MM-DD).' })
  else if (d < loan.loanDate) errors.push({ path: 'repayDate', message: 'Rencana tanggal pengembalian tidak boleh sebelum tanggal pinjaman.' })
  if (input.note !== undefined && input.note !== null && (typeof input.note !== 'string' || input.note.trim().length > NOTE_MAX)) errors.push({ path: 'note', message: `Catatan maks. ${NOTE_MAX} karakter.` })
  return errors
}

/** #11 / #12: execution date of a transfer order — not before the loan date, not in the future. */
export function executeDateError(date: unknown, c: { minDate: string; today: string }): FieldError | null {
  if (!isDate(date)) return { path: 'executeDate', message: 'Tanggal transfer harus YYYY-MM-DD.' }
  if (date > c.today) return { path: 'executeDate', message: 'Tanggal transfer tidak boleh di masa depan.' }
  if (date < c.minDate) return { path: 'executeDate', message: 'Tanggal transfer tidak boleh sebelum tanggal pinjaman.' }
  return null
}

// ---------------------------------------------------------------- 2026-10-26 (DRMS 26/10 #1): "Instruksi pinjam antar proyek"

/**
 * Lender candidate of an instruction: an open project of the request's PT (not the borrower) with its cash account and
 * that account's dana bebas. Not eligible: no account, an inactive account, the borrower's own account (no money would
 * move), or dana bebas below the minimum amount (= the shortfall).
 */
export type LenderCandidateReason = 'no_account' | 'inactive_account' | 'same_account' | 'insufficient'

export const LENDER_REASON_TEXTS: Record<LenderCandidateReason, string> = {
  no_account: 'Project ini belum punya akun kas (pusat biaya).',
  inactive_account: 'Akun kas project ini tidak aktif.',
  same_account: 'Akun kas sama dengan project peminjam — tidak ada dana yang berpindah.',
  insufficient: 'Dana bebas akun kas kurang dari kekurangan pengajuan.',
}

export function lenderCandidateReason(c: { accountId: number | null; accountActive: boolean; borrowerAccountId: number; available: number; minAmount: number }): LenderCandidateReason | null {
  if (c.accountId === null) return 'no_account'
  if (!c.accountActive) return 'inactive_account'
  if (c.accountId === c.borrowerAccountId) return 'same_account'
  if (c.available < c.minAmount) return 'insufficient'
  return null
}

/** Amount of an instruction: whole Rupiah, at least the shortfall (`min`), at most the lender account's dana bebas (`max`). */
export function instructAmountError(amount: unknown, c: { min: number; max: number }): FieldError | null {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) return { path: 'amount', message: 'Nilai pinjaman wajib diisi (bilangan bulat Rupiah > 0).' }
  if (amount < c.min) return { path: 'amount', message: `Nilai pinjaman minimal ${formatRupiah(c.min)} (kekurangan dana akun kas pengajuan).` }
  if (amount > c.max) return { path: 'amount', message: `Nilai pinjaman melebihi dana bebas akun kas pemberi (${formatRupiah(c.max)}).` }
  if (amount > MAX_LOAN_AMOUNT) return { path: 'amount', message: 'Nilai pinjaman terlalu besar.' }
  return null
}

/** Reason stored on the loan: the instructor's note + the request it covers. */
export const instructedLoanReason = (note: string, requestNo: string): string => `${note.trim()} (instruksi Owner untuk pengajuan ${requestNo})`.slice(0, REASON_MAX)
