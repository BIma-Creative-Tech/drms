import type { Where } from 'payload'

/**
 * T1 expense requests (requirements v1.1 §7 T1, architecture §5.1/§5.2) — shared vocabulary.
 * Pure module: no Payload import (unit-tested, bundled into the OpenAPI generator).
 */

export const REQUEST_TYPES = ['advance', 'reimburse'] as const
export type RequestType = (typeof REQUEST_TYPES)[number]

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  advance: 'Pengajuan Baru',
  reimburse: 'Reimburse',
}

/**
 * DRMS 13/10 Wave 4 (ADR 0027) "Jenis penerima": who receives the money. `karyawan` (default, every request before
 * ADR 0027) = the requester's employee bank account; `vendor` = "Pembayaran vendor": a vendor's bank account, the
 * vendor's invoice is the proof, no LPJ (transfer → Selesai). A vendor payment is always type `advance` (paid after
 * approval, before any receipt) — the server sets it.
 */
export const PAYEE_TYPES = ['karyawan', 'vendor'] as const
export type PayeeType = (typeof PAYEE_TYPES)[number]

export const PAYEE_TYPE_LABELS: Record<PayeeType, string> = {
  karyawan: 'Karyawan',
  vendor: 'Vendor',
}

/** Kind label of a vendor payment (list "Jenis", PDF title, APK). */
export const VENDOR_PAYMENT_LABEL = 'Pembayaran vendor'

export function isPayeeType(v: unknown): v is PayeeType {
  return (PAYEE_TYPES as readonly unknown[]).includes(v)
}

/** Stored / legacy value → payee type (rows before ADR 0027 have none = karyawan). */
export function payeeOf(v: unknown): PayeeType {
  return v === 'vendor' ? 'vendor' : 'karyawan'
}

/** "Jenis" shown for a request: Pengajuan Baru / Reimburse, or "Pembayaran vendor" (ADR 0027). */
export function requestKindLabel(type: RequestType, payeeType?: unknown): string {
  return payeeOf(payeeType) === 'vendor' ? VENDOR_PAYMENT_LABEL : REQUEST_TYPE_LABELS[type]
}

/**
 * ADR 0027 duplicate-invoice key: upper case, only letters and digits ("inv/2026-01 " = "INV202601"). Same rule as the
 * SQL function `pk_invoice_key` behind the unique index `expense_requests_vendor_invoice_uq`.
 */
export function normalizeInvoiceNo(v: string | null | undefined): string {
  // strip first, then upper case — the order of the SQL function (non-ASCII letters never become ASCII ones)
  return (v ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

/** Statuses that never take part in an LPJ (vendor payments, ADR 0027) — DB-guarded too. */
export const VENDOR_FORBIDDEN_STATUSES: readonly RequestStatus[] = ['receipt_revision', 'receipts_verified', 'transferred', 'receipts_complete', 'lpj_submitted', 'lpj_revision', 'lpj_verified']

/**
 * One Postgres enum for both request types. LPJ values (lpj_*, receipts_complete) are declared now
 * as extension points for F2b (T5) so that F2b needs no enum migration for them.
 */
export const REQUEST_STATUSES = [
  'draft',
  'pending_ack',
  'pending_approval',
  'approved',
  'receipt_revision',
  'receipts_verified',
  'transferred',
  'receipts_complete',
  'lpj_submitted',
  'lpj_revision',
  'lpj_verified',
  'completed',
  'rejected',
  'cancelled',
] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

/**
 * THE status wording (DRMS 10/10 integration, Lead review b) — select options, list cells, chips, the
 * workflow panel, PDF, notifications and the APK fallback (apps/mobile request_status.dart) all read it.
 * The waiting steps use the ADR 0021 wording (Staff → PM project → Direktur → Finance transfer); requests
 * submitted under an older approval snapshot get LEGACY_WAITING_LABELS through timeline.ts requestStatusLabel.
 */
export const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: 'Draft',
  pending_ack: 'Menunggu persetujuan PM',
  pending_approval: 'Menunggu persetujuan Direktur',
  approved: 'Disetujui',
  receipt_revision: 'Revisi Nota',
  receipts_verified: 'Nota Terverifikasi (Antri Transfer)',
  transferred: 'Ditransfer',
  receipts_complete: 'Nota Lengkap',
  lpj_submitted: 'LPJ Diajukan',
  lpj_revision: 'LPJ Revisi',
  lpj_verified: 'LPJ Terverifikasi',
  completed: 'Selesai',
  rejected: 'Ditolak',
  cancelled: 'Dibatalkan',
}

/** Waiting labels of requests whose approval snapshot is NOT the ADR 0021 PM → Direktur flow (ADR 0013 / earlier). */
export const LEGACY_WAITING_LABELS = {
  ackDirektur: 'Menunggu Diketahui (Direktur)',
  ack: 'Menunggu Diketahui',
  approval: 'Menunggu Approval',
} as const

/**
 * ADR 0024: "Disetujui" of a Direktur's own request without approval (snapshot `direktur_no_approval`) —
 * nobody approved it, it went straight to Finance. Web + API + APK (request_status.dart) use these texts.
 */
export const NO_APPROVAL_STATUS_LABELS: Record<RequestType, string> = {
  advance: 'Tanpa persetujuan (Antri Transfer)',
  reimburse: 'Tanpa persetujuan (Verifikasi Nota)',
}

/** Type-specific display label (Pengajuan Baru "Disetujui (Antri Transfer)", US-19). */
export function statusLabel(type: RequestType, status: RequestStatus): string {
  if (type === 'advance' && status === 'approved') return 'Disetujui (Antri Transfer)'
  return STATUS_LABELS[status]
}

/**
 * Statuses in which the request CONTENT (header, lines, requesters) may change. Everything else is
 * "locked": the DB freezes the content (trigger pk_expense_requests_guard + deferred
 * pk_expense_frozen_check comparing content_hash). Must equal the SQL function pk_expense_editable().
 */
export const CONTENT_EDITABLE: readonly RequestStatus[] = ['draft', 'receipt_revision']

export function isContentEditable(status: RequestStatus): boolean {
  return CONTENT_EDITABLE.includes(status)
}

/** Statuses in which receipts may be added/edited/removed (T4). Must equal SQL pk_receipts_editable(). */
export function receiptsEditable(type: RequestType, status: RequestStatus): boolean {
  if (type === 'reimburse') return status === 'draft' || status === 'receipt_revision'
  return status === 'transferred' || status === 'receipts_complete' || status === 'lpj_revision'
}

/** Requests whose amount counts as "committed" budget (US-26 % before → after). */
export const BUDGET_COMMITTED: readonly RequestStatus[] = [
  'approved',
  'receipt_revision',
  'receipts_verified',
  'transferred',
  'receipts_complete',
  'lpj_submitted',
  'lpj_revision',
  'lpj_verified',
  'completed',
]

/** Requests that no longer count for duplicate-receipt detection (US-50). */
export const INACTIVE_FOR_DUPLICATES: readonly RequestStatus[] = ['cancelled', 'rejected']

export const APPROVAL_POSITIONS = ['diajukan', 'dibuat', 'diketahui', 'approval'] as const
export type ApprovalPosition = (typeof APPROVAL_POSITIONS)[number]

export const APPROVAL_DECISIONS = ['signed', 'acknowledged', 'approved', 'rejected'] as const
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number]

export const FLAG_KINDS = ['amount_diff', 'date_after_request', 'date_too_old', 'date_out_of_period', 'uom_suspicious', 'duplicate', 'receipt_amount_mismatch', 'rap_over_budget'] as const
export type FlagKind = (typeof FLAG_KINDS)[number]

export const FLAG_LABELS: Record<FlagKind, string> = {
  amount_diff: 'Selisih nominal nota vs baris',
  date_after_request: 'Tanggal nota setelah tanggal pengajuan',
  date_too_old: 'Nota terlalu lama',
  date_out_of_period: 'Tanggal nota di luar periode kegiatan (lama)',
  uom_suspicious: 'Satuan tidak wajar',
  duplicate: 'Nota ganda',
  // D3 (DRMS 10/10): "Nominal sesuai nota" of a line ≠ its total (qty × harga satuan) — awareness for Finance
  receipt_amount_mismatch: 'Selisih nota',
  // D4 (DRMS 10/10): the line's RAP item is (or would be) above its planned amount — warning for PM / Direktur, not blocking
  rap_over_budget: 'Melebihi RAP',
}

export type FlagLevel = 'info' | 'warning'

/** 'YYYY-MM-DD' business date (company TZ, no time) — stored as text, compared lexically. */
export const BUSINESS_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export function isBusinessDate(v: unknown): v is string {
  if (typeof v !== 'string' || !BUSINESS_DATE_RE.test(v)) return false
  const [y, m, d] = v.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** Adds `days` (may be negative) to a business date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/**
 * US-19: requests ready to be transferred — Pengajuan Baru "Disetujui (Antri Transfer)" + Reimburse "Nota
 * Terverifikasi". ONE definition for the view title, the nav badge and the API count (S3e, S-07:
 * the badge used to add Reimburse still waiting for receipt verification).
 */
export const TRANSFER_QUEUE_WHERE: Where = {
  or: [
    { and: [{ type: { equals: 'advance' } }, { status: { equals: 'approved' } }] },
    { and: [{ type: { equals: 'reimburse' } }, { status: { equals: 'receipts_verified' } }] },
  ],
}
