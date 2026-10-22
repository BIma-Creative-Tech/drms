/**
 * ADR 0029 (DRMS 13/10 Phase C) "Cek dana di persetujuan Owner" — pure vocabulary and arithmetic (no Payload import:
 * unit-tested, bundled by the OpenAPI generator).
 *
 * Dana tersedia(PT) = Saldo dana(PT) − Komitmen(PT) (§1, owner 2026-10-14 "setuju" on every default):
 * - Saldo dana = Σ balance of the PT's ACTIVE cash / bank accounts WITHOUT a site (every site-flagged account — kas kecil
 *   and rekening kantor cabang — is excluded);
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
 * ADR 0031 amendment (user 2026-10-22, "PB dulu, lalu PT"): a request of a project mapped to a Pusat Biaya (cash account)
 * is checked against that account first:
 * - Dana bebas PB = balance of the account − commitments of the requests of the projects mapped to it (+ their unpaid LPJ
 *   shortfalls + approved, not yet disbursed cash-backed loans the account lends) — `pk_pb_balance` / `pk_pb_commitments`;
 * - enough there → pass (Finance pays from the Pusat Biaya);
 * - else enough in the PT (ADR 0029 figure) → pass, Finance pays from another account of the PT (automatic loan);
 * - else short (inter-PT loan or reject). A request without a mapped project is checked per PT only.
 * The SQL `pk_request_fund_available(company, project)` is the same rule for the DB backstop.
 */
export type PbFigures = { accountId: number; name: string; balance: number; commitments: number; available: number }

export type FundRoute = 'pusat_biaya' | 'other_account' | 'pt' | 'short'

/** The figure a request is compared with: the larger of the PT's and its Pusat Biaya's available funds. */
export function effectiveAvailable(ptAvailable: number, pbAvailable: number | null): number {
  return pbAvailable === null ? ptAvailable : Math.max(ptAvailable, pbAvailable)
}

/** Where the money of a request comes from at its approval (or that it is short). */
export function fundRoute(needed: number, ptAvailable: number, pbAvailable: number | null): FundRoute {
  if (pbAvailable !== null && needed <= pbAvailable) return 'pusat_biaya'
  if (needed <= ptAvailable) return pbAvailable === null ? 'pt' : 'other_account'
  return 'short'
}

/** One-line explanation of the route for the panel (web + APK). */
export function fundRouteText(route: FundRoute, pbName: string | null, pbGap: number): string | null {
  const pb = pbName ?? 'project'
  if (route === 'pusat_biaya') return `Dana pusat biaya ${pb} cukup — Finance membayar dari akun ini.`
  if (route === 'other_account')
    return `Dana pusat biaya ${pb} kurang ${formatRupiah(pbGap)}, tetapi dana PT cukup — Finance membayar dari akun lain di PT ini (tercatat sebagai pinjaman antar project otomatis).`
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

/** Indonesian message of the refusal (409 FUND_INSUFFICIENT) with the three figures. */
export function fundInsufficientMessage(code: string, f: { available: number; needed: number; pbName?: string | null }): string {
  const gap = fundGap(f.needed, f.available)
  const who = f.pbName ? `Dana pusat biaya ${f.pbName} maupun dana PT ${code}` : `Dana PT ${code}`
  return `${who} tidak cukup: tersedia ${formatRupiah(f.available)}, dibutuhkan ${formatRupiah(f.needed)}, kurang ${formatRupiah(gap)}. Tolak, atau minta Owner memerintahkan pinjaman antar-PT.`
}

/** Text of the disabled "Setujui" (web panel, APK decision sheet). */
export function blockedDecisionText(gap: number, pbName?: string | null): string {
  const who = pbName ? `Dana pusat biaya ${pbName} maupun dana PT` : 'Dana PT'
  return `${who} tidak cukup — kurang ${formatRupiah(gap)}. Tolak, atau perintahkan pinjaman antar-PT.`
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

export function renderFundText(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(company|docNo|needed|available|gap|title)\}/g, (_, k: string) => vars[k] ?? '')
}
