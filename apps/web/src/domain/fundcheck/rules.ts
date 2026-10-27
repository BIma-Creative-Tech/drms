/**
 * ADR 0029 (DRMS 13/10 Phase C) "Cek dana di persetujuan Owner" — pure vocabulary and arithmetic (no Payload import:
 * unit-tested, bundled by the OpenAPI generator).
 *
 * Dana tersedia(PT) = Saldo dana(PT) − Komitmen(PT) (§1, owner 2026-10-14 "setuju" on every default):
 * - Saldo dana = Σ balance of the PT's ACTIVE cash / bank accounts (DRMS 24/10, user decision: every project is mapped
 *   to a cash account — the old site exclusion is gone, migration 20261024_500000 cleared the legacy site flags);
 * - Komitmen = approved-but-not-transferred requests + verified, unsettled LPJ shortfalls + inter-PT loans instructed with
 *   the PT as lender and not yet disbursed.
 * The SQL functions `pk_fund_balance` / `pk_fund_commitments` / `pk_fund_available` (migration 20261015_100200) are the
 * one definition; the service reads them, the DB backstop trigger uses them.
 */
import { formatRupiah } from '@/lib/money'

/** Stable problem codes (OpenAPI lists them). */
export const FUND_INSUFFICIENT = 'FUND_INSUFFICIENT'

/** Advisory-lock key of a PT's funds (service AND the DB trigger `pk_expense_fund_guard` use exactly this text). */
export const fundLockKey = (companyId: number): string => `pk:fund:${companyId}`

export type FundFigures = { companyId: number; balance: number; commitments: number; available: number }

/**
 * ADR 0031 amendment (user 2026-10-22, "PB dulu, lalu PT") — narrowed by the amendment 2026-10-26 (DRMS 26/10 #1, user
 * decision): a request of a project mapped to a Pusat Biaya (cash account) is checked against THAT account only:
 * - Dana bebas PB = balance of the account − commitments of the requests of the projects mapped to it (+ their unpaid LPJ
 *   shortfalls + approved, not yet disbursed cash-backed loans the account lends + approved repayment orders it pays) —
 *   `pk_pb_balance` / `pk_pb_commitments`;
 * - enough there → pass (Finance pays from the Pusat Biaya);
 * - else short — the 0.19.1 fallback "the PT covers it" is gone: the Owner (the final decider) instructs an inter-project
 *   loan to that account ("Instruksi pinjam antar proyek", domain/loans/owner-instruct.ts) and approves once Finance has
 *   executed its transfer; or rejects. A request without a mapped project is checked per PT only (ADR 0029, unchanged).
 * The SQL `pk_request_fund_available(company, project)` is the same rule for the DB backstop (migration 20261026_100200).
 * Finance paying an approved request from another account (automatic loan, ADR 0031 §3) is unchanged.
 */
export type PbFigures = { accountId: number; name: string; balance: number; commitments: number; available: number }

/**
 * `other_account` = the 0.19.1 route "the PT covers it, Finance pays from another account" — no longer produced since
 * 2026-10-26 (kept in the contract for older clients).
 */
export type FundRoute = 'pusat_biaya' | 'other_account' | 'pt' | 'short'

/** The figure a request is compared with (2026-10-26): its Pusat Biaya's dana bebas when mapped, else the PT's. */
export function effectiveAvailable(ptAvailable: number, pbAvailable: number | null): number {
  return pbAvailable === null ? ptAvailable : pbAvailable
}

/** Where the money of a request comes from at its approval (or that it is short). */
export function fundRoute(needed: number, ptAvailable: number, pbAvailable: number | null): FundRoute {
  if (pbAvailable !== null) return needed <= pbAvailable ? 'pusat_biaya' : 'short'
  return needed <= ptAvailable ? 'pt' : 'short'
}

/** One-line explanation of the route for the panel (web + APK). */
export function fundRouteText(route: FundRoute, pbName: string | null): string | null {
  if (route === 'pusat_biaya') return `Dana pusat biaya ${pbName ?? 'project'} cukup — Finance membayar dari akun ini.`
  return null
}

/** Shortfall of a need against the figures (0 = enough). */
export function fundGap(needed: number, available: number): number {
  return Math.max(0, needed - available)
}

/** Request statuses whose approved amount (less what was transferred) is reserved — mirrors pk_fund_commitments. */
export const COMMITTED_ADVANCE_STATUSES = ['approved'] as const
export const COMMITTED_REIMBURSE_STATUSES = ['approved', 'receipt_revision', 'receipts_verified'] as const

export function isCommitted(type: 'advance' | 'reimburse', status: string): boolean {
  return type === 'advance' ? (COMMITTED_ADVANCE_STATUSES as readonly string[]).includes(status) : (COMMITTED_REIMBURSE_STATUSES as readonly string[]).includes(status)
}

/** Commitment of one request: approved − transferred, never negative (mirror of the SQL). */
export function requestCommitment(r: { type: 'advance' | 'reimburse'; status: string; approvedAmount?: number | null; transferredTotal?: number | null }): number {
  return isCommitted(r.type, r.status) ? Math.max(0, (r.approvedAmount ?? 0) - (r.transferredTotal ?? 0)) : 0
}

/**
 * Indonesian message of the refusal (409 FUND_INSUFFICIENT) with the three figures. With a Pusat Biaya (2026-10-26): its
 * dana bebas only, and the way out is the Owner's inter-project loan instruction.
 */
export function fundInsufficientMessage(code: string, f: { available: number; needed: number; pbName?: string | null }): string {
  const gap = fundGap(f.needed, f.available)
  if (f.pbName) return `Dana bebas akun kas ${f.pbName} tidak cukup: tersedia ${formatRupiah(f.available)}, dibutuhkan ${formatRupiah(f.needed)}, kurang ${formatRupiah(gap)}. ${PB_WAY_OUT}`
  return `Dana PT ${code} tidak cukup: tersedia ${formatRupiah(f.available)}, dibutuhkan ${formatRupiah(f.needed)}, kurang ${formatRupiah(gap)}. Tolak, atau minta Owner memerintahkan pinjaman antar-PT.`
}

/** 2026-10-26: what the final decider can do while the project's cash account is short. */
export const PB_WAY_OUT = 'Tolak, atau Owner menginstruksikan pinjaman antar proyek ke akun ini lalu menyetujui setelah Finance mentransfernya.'

/** Text of the disabled "Setujui" (web panel, APK decision sheet). */
export function blockedDecisionText(gap: number, pbName?: string | null): string {
  if (pbName) return `Dana bebas akun kas ${pbName} tidak cukup — kurang ${formatRupiah(gap)}. ${PB_WAY_OUT}`
  return `Dana PT tidak cukup — kurang ${formatRupiah(gap)}. Tolak, atau perintahkan pinjaman antar-PT.`
}

/** 2026-10-26: the disabled "Setujui" while the instructed inter-project loan waits for Finance's transfer. */
export function awaitingLoanText(docNo: string | null, gap: number, pbName: string): string {
  return `Dana bebas akun kas ${pbName} kurang ${formatRupiah(gap)}. Pinjaman ${docNo ?? 'antar proyek'} menunggu transfer Finance — setujui setelah transfer dieksekusi.`
}

/** Where a request stands for the fund check (detail panel `fundCheck.status`). */
export type FundCheckStatus = 'ok' | 'insufficient' | 'not_applicable'

/**
 * Does the request's NEXT decision make it `approved` (the step the fund check runs at)? `pending_approval` at the
 * snapshot's last level, or `pending_ack` when the snapshot has no approval level ("Diketahui" is final, ADR 0013
 * G1-2). A Draft is checked at submit only for a no-approval (Owner's own) request — the caller passes `ownerDraft`.
 */
export function finalStepWaiting(r: { status: string; currentLevel?: number | null; lastLevel: number | null; ownerDraft?: boolean }): boolean {
  if (r.status === 'draft') return r.ownerDraft === true
  if (r.lastLevel === null) return false
  if (r.status === 'pending_approval') return (r.currentLevel ?? 1) >= r.lastLevel
  if (r.status === 'pending_ack') return r.lastLevel === 0
  return false
}

/** The panel is shown for a waiting request (any step: the Direktur sees it read-only) or an Owner's own Draft. */
export function panelApplies(r: { status: string; ownerDraft?: boolean }): boolean {
  return r.status === 'pending_ack' || r.status === 'pending_approval' || (r.status === 'draft' && r.ownerDraft === true)
}

/** Default texts of the fund-check notification (editable as a `notification-templates` row of the same event). */
export const FUND_SHORTFALL_EVENT = 'expense.fund_shortfall'
export const FUND_SHORTFALL_DEFAULT = {
  title: 'Dana PT {company} tidak cukup: {docNo}',
  body: 'Dibutuhkan {needed}, tersedia {available}, kurang {gap}. Perintahkan pinjaman antar-PT atau tolak.',
} as const
/** 2026-10-26: the same moment for a request of a mapped project (its cash account short) — own event, own template. */
export const FUND_SHORTFALL_PB_EVENT = 'expense.fund_shortfall_account'
export const FUND_SHORTFALL_PB_DEFAULT = {
  title: 'Dana akun kas {account} tidak cukup: {docNo}',
  body: 'Dibutuhkan {needed}, dana bebas {available}, kurang {gap}. Instruksikan pinjaman antar proyek atau tolak.',
} as const

export function renderFundText(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(company|docNo|needed|available|gap|title|account)\}/g, (_, k: string) => vars[k] ?? '')
}
