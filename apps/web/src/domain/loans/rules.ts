/**
 * ADR 0022 — Inter-project loan ("Pinjaman antar project", DRMS 10/10 point 15, owner D6 + Q-L1…Q-L7 2026-10-11).
 * Pure module (unit-tested, bundled into the OpenAPI generator): statuses, transitions, input validation, the
 * outstanding / overdue arithmetic and the Direktur pool (G1, ADR 0021 "Utamakan Direktur lain"). No Payload import.
 *
 * A loan is a RECORDED CLAIM of the lender project on the borrower project inside one PT (notional allocation,
 * ADR 0022 §5 option B): no cash entry is ever written for a loan or a repayment.
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

export const LOAN_ACTIONS = ['edit', 'submit', 'cancel', 'approve', 'reject', 'repay'] as const
export type LoanAction = (typeof LOAN_ACTIONS)[number]

/** G1 exception recorded on the loan (ADR 0022 §4, Q-L5): the creator PM is the PT's only Direktur. */
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
}

/** Actions the caller may take now (UI + service guard; the DB re-checks G1 and the transitions). */
export function loanAllowedActions(c: LoanActorContext): LoanAction[] {
  const out: LoanAction[] = []
  if (c.status === 'draft' && c.isCreator && c.isBorrowerPm) out.push('edit', 'submit')
  if (c.isCreator && (c.status === 'draft' || c.status === 'pending_approval')) out.push('cancel')
  else if (c.isDirektur && c.status === 'approved' && !c.hasRepayment) out.push('cancel')
  if (c.status === 'pending_approval' && c.mayDecide) out.push('approve', 'reject')
  if (LOAN_REPAYABLE.includes(c.status) && (c.isBorrowerPm || c.isFinance)) out.push('repay')
  return out
}

/** Void of a posted repayment (ADR 0022 §7): Direktur or Finance of the PT, reason required. */
export const mayVoidRepayment = (c: Pick<LoanActorContext, 'isDirektur' | 'isFinance'>): boolean => c.isDirektur || c.isFinance
