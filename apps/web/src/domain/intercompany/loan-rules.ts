/**
 * ADR 0029 §3 "Pinjaman antar-PT" (`PJA/{LENDER}/{YY}{MM}/{seq}`) — pure vocabulary, transitions and arithmetic (no
 * Payload import: unit-tested, bundled by the OpenAPI generator). The Owner instructs (his instruction is the decision,
 * no further approval); Finance of the LENDER executes the disbursement (KK in the lender, automatic KM in the borrower,
 * paired in `intercompany_links` — the ADR 0028 mechanism); Finance of the BORROWER records repayments (no approval,
 * partial allowed, fund-checked, the Owner is notified). No interest; due date required (default 30 days); overdue is
 * derived (daily reminder). DB guards: migration 20261015_100200 (pk_icl_guard, pk_icl_transfer_guard, pk_icl_consistency).
 */

export const IC_LOAN_DOC_TYPE = 'intercompany_loan' as const

export const IC_LOAN_STATUSES = ['instructed', 'disbursed', 'partially_repaid', 'repaid', 'cancelled'] as const
export type IcLoanStatus = (typeof IC_LOAN_STATUSES)[number]

export const IC_LOAN_STATUS_LABELS: Record<IcLoanStatus, string> = {
  instructed: 'Menunggu pencairan',
  disbursed: 'Dicairkan',
  partially_repaid: 'Sebagian dikembalikan',
  repaid: 'Lunas',
  cancelled: 'Dibatalkan',
}

/** Label of a stored status (`IC_LOAN_STATUS_LABELS`, the single source); an unknown code is returned as is. */
export function icLoanStatusLabel(status: string): string {
  return (IC_LOAN_STATUS_LABELS as Record<string, string | undefined>)[status] ?? status
}

/** Derived "Terlambat" (ADR 0029 §3.3). */
export const IC_OVERDUE_LABEL = 'Terlambat'

/** '1234567890' → '••••7890'; none → null (ADR 0028 §2: the receiving account is shown masked). */
export function maskIcAccountNo(no: string | null | undefined): string | null {
  return no ? `••••${no.slice(-4)}` : null
}

/** `destination` of the queue item and of the loan detail: the borrower's designated receiving account, masked. */
export type IcLoanDestination = { bankName: string | null; accountNoMasked: string | null; accountHolder: string }

export function icLoanDestination(acc: { bankName: string | null; accountNo: string | null; accountHolder: string } | null): IcLoanDestination | null {
  return acc ? { bankName: acc.bankName, accountNoMasked: maskIcAccountNo(acc.accountNo), accountHolder: acc.accountHolder } : null
}

/**
 * Who reads `destination`: the readers of the disbursement queue item — Finance of the LENDER (the instruction's
 * creator included: the queue shows it to him with `canDisburse` false) while the loan waits for its disbursement.
 * Afterwards the movement's `toAccount` shows the account actually paid.
 */
export function seesIcLoanDestination(status: IcLoanStatus, financeOfLender: boolean): boolean {
  return financeOfLender && status === 'instructed'
}

export const IC_MOVEMENT_KINDS = ['disbursement', 'repayment'] as const
export type IcMovementKind = (typeof IC_MOVEMENT_KINDS)[number]

/** Stable problem codes (OpenAPI lists them). */
export const LOAN_LENDER_INSUFFICIENT = 'LOAN_LENDER_INSUFFICIENT'
export const LOAN_HAS_REPAYMENTS = 'LOAN_HAS_REPAYMENTS'
export const LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED = 'LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED'
export const LOAN_REPAYMENT_EXCEEDS_OUTSTANDING = 'LOAN_REPAYMENT_EXCEEDS_OUTSTANDING'

/** Sanity bound of the amount (Rp 1 T, DB CHECK intercompany_loans_amount). */
export const MAX_IC_LOAN_AMOUNT = 1_000_000_000_000
/** Owner 2026-10-14: due date required, default instruction date + 30 days. */
export const DEFAULT_DUE_DAYS = 30
export const REASON_MIN = 3
export const REASON_MAX = 1000

/** Loan statuses after a movement (ADR 0029 §3.3; mirror of pk_icl_guard / pk_icl_consistency). */
export function statusAfterRepayments(amount: number, repaid: number): Exclude<IcLoanStatus, 'instructed' | 'cancelled'> {
  if (repaid <= 0) return 'disbursed'
  return repaid >= amount ? 'repaid' : 'partially_repaid'
}

/** Allowed status moves (pk_icl_guard). */
export const IC_LOAN_MOVES: Readonly<Record<IcLoanStatus, readonly IcLoanStatus[]>> = {
  instructed: ['disbursed', 'cancelled'],
  disbursed: ['instructed', 'partially_repaid', 'repaid'],
  partially_repaid: ['disbursed', 'repaid'],
  repaid: ['partially_repaid', 'disbursed'],
  cancelled: [],
}

export function canMove(from: IcLoanStatus, to: IcLoanStatus): boolean {
  return from === to ? from !== 'cancelled' : IC_LOAN_MOVES[from].includes(to)
}

/** Outstanding = amount − posted repayments while disbursed; the instructed amount is not owed yet. */
export function outstandingOf(l: { status: IcLoanStatus; amount: number; repaidTotal: number }): number {
  return l.status === 'disbursed' || l.status === 'partially_repaid' || l.status === 'repaid' ? Math.max(0, l.amount - l.repaidTotal) : 0
}

/** Days between two business dates (b − a). */
export function daysBetweenDates(a: string, b: string): number {
  const toUtc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000)
}

/** Overdue (derived): due date before today (borrower TZ), outstanding > 0, disbursed / partially repaid. */
export function isOverdue(l: { status: IcLoanStatus; dueDate: string; amount: number; repaidTotal: number }, today: string): boolean {
  return (l.status === 'disbursed' || l.status === 'partially_repaid') && l.amount > l.repaidTotal && l.dueDate < today
}

export function daysOverdue(l: { status: IcLoanStatus; dueDate: string; amount: number; repaidTotal: number }, today: string): number {
  return isOverdue(l, today) ? daysBetweenDates(l.dueDate, today) : 0
}

/** Adds `days` to a business date. */
export function plusDays(date: string, days: number): string {
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + days))
  return d.toISOString().slice(0, 10)
}

/** Field errors of an instruction body (beyond the schema): due date ≥ instruction date. */
export function dueDateError(instructionDate: string, dueDate: string): string | null {
  return dueDate < instructionDate ? 'Jatuh tempo tidak boleh sebelum tanggal perintah.' : null
}

/** Actions the detail offers (UI hint; the server re-checks each). */
export const IC_LOAN_ACTIONS = ['cancel', 'disburse', 'void_disbursement', 'repay', 'void_repayment'] as const
export type IcLoanAction = (typeof IC_LOAN_ACTIONS)[number]

export type IcLoanActor = {
  /** STORED pk-principal in both PTs (the Owner). */
  owner: boolean
  financeLender: boolean
  financeBorrower: boolean
  /** The caller created the instruction (G1: never the disbursement). */
  creator: boolean
}

/** ADR 0029 §4 role table → the actions of the caller on a loan in `status`. */
export function icLoanAllowedActions(status: IcLoanStatus, repaidTotal: number, a: IcLoanActor): IcLoanAction[] {
  const out: IcLoanAction[] = []
  if (status === 'instructed' && a.owner) out.push('cancel')
  if (status === 'instructed' && a.financeLender && !a.creator) out.push('disburse')
  if (status === 'disbursed' && repaidTotal === 0 && a.financeLender) out.push('void_disbursement')
  if ((status === 'disbursed' || status === 'partially_repaid') && a.financeBorrower) out.push('repay')
  if ((status === 'partially_repaid' || status === 'repaid') && a.financeBorrower) out.push('void_repayment')
  return out
}

/** Accounting labels of the four legs (ADR 0029 §3.9; Rekap Kas lines, Buku Kas counterpart). */
export const IC_LOAN_LEG_LABELS = {
  given: 'Pinjaman antar-PT diberikan',
  received: 'Pinjaman antar-PT diterima',
  repaid_in: 'Pengembalian pinjaman antar-PT diterima',
  repaid_out: 'Pembayaran hutang antar-PT',
} as const
export type IcLoanLeg = keyof typeof IC_LOAN_LEG_LABELS

/** Leg of a cash entry of a loan link: KK of a disbursement (lender) = given, … */
export function legOf(docType: 'intercompany_loan_disbursement' | 'intercompany_loan_repayment', side: 'source' | 'target'): IcLoanLeg {
  if (docType === 'intercompany_loan_disbursement') return side === 'source' ? 'given' : 'received'
  return side === 'source' ? 'repaid_out' : 'repaid_in'
}

/** Notification events of a loan (doc type `intercompany_loan`, deep link to the loan). */
export type IcLoanEvent = 'icloan.instructed' | 'icloan.lender_insufficient' | 'icloan.disbursed' | 'icloan.disbursement_voided' | 'icloan.repaid' | 'icloan.cancelled' | 'icloan.overdue'

/** Default texts (editable as `notification-templates` rows of the same event). Placeholders below. */
export const IC_LOAN_NOTIFY_DEFAULTS: Record<IcLoanEvent, { title: string; body: string }> = {
  'icloan.instructed': { title: 'Perintah pinjaman antar-PT: {docNo}', body: 'Owner memerintahkan PT {lender} meminjamkan {amount} ke PT {borrower} (jatuh tempo {dueDate}). Finance PT {lender} mencairkan dari Antrian Transfer.' },
  'icloan.lender_insufficient': { title: 'Dana PT {lender} tidak cukup: {docNo}', body: 'Pencairan pinjaman {docNo} ({amount}) ditolak: dana tersedia PT {lender} {available}. Batalkan dan perintahkan dari PT lain, atau tunggu.' },
  'icloan.disbursed': { title: 'Dana pinjaman antar-PT masuk: {docNo}', body: 'Dana pinjaman {docNo} {amount} dari PT {lender} masuk di PT {borrower}.{requests}' },
  'icloan.disbursement_voided': { title: 'Pencairan pinjaman antar-PT dibatalkan: {docNo}', body: 'Pencairan pinjaman {docNo} {amount} (PT {lender} → PT {borrower}) di-void; dana tersedia PT {borrower} sekarang {available}.' },
  'icloan.repaid': { title: 'Pengembalian pinjaman antar-PT: {docNo}', body: 'PT {borrower} mengembalikan {payment} untuk pinjaman {docNo} ke PT {lender}. Sisa {outstanding}.' },
  'icloan.cancelled': { title: 'Perintah pinjaman dibatalkan: {docNo}', body: 'Perintah pinjaman {docNo} (PT {lender} → PT {borrower}, {amount}) dibatalkan Owner.' },
  'icloan.overdue': { title: 'Pinjaman antar-PT terlambat: {docNo}', body: 'Pinjaman {docNo} (PT {lender} → PT {borrower}) lewat jatuh tempo {dueDate} ({days} hari). Sisa {outstanding}.' },
}

export function renderLoanText(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{([a-zA-Z]+)\}/g, (_, k: string) => vars[k] ?? '')
}
