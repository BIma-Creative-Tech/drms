import type { Where } from 'payload'

/**
 * T1 expense requests (requirements v1.1 §7 T1, architecture §5.1/§5.2) — shared vocabulary.
 * Pure module: no Payload import (unit-tested, bundled into the OpenAPI generator).
 */

export const REQUEST_TYPES = ['advance', 'reimburse'] as const
export type RequestType = (typeof REQUEST_TYPES)[number]

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  advance: 'Uang Muka',
  reimburse: 'Reimburse',
}

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

export const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: 'Draft',
  pending_ack: 'Menunggu Diketahui (Direktur)',
  pending_approval: 'Menunggu Approval',
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

/** Type-specific display label (Uang Muka "Disetujui (Antri Transfer)", US-19). */
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

export const FLAG_KINDS = ['amount_diff', 'date_after_request', 'date_too_old', 'date_out_of_period', 'uom_suspicious', 'duplicate'] as const
export type FlagKind = (typeof FLAG_KINDS)[number]

export const FLAG_LABELS: Record<FlagKind, string> = {
  amount_diff: 'Selisih nominal nota vs baris',
  date_after_request: 'Tanggal nota setelah tanggal pengajuan',
  date_too_old: 'Nota terlalu lama',
  date_out_of_period: 'Tanggal nota di luar periode kegiatan',
  uom_suspicious: 'Satuan tidak wajar',
  duplicate: 'Nota ganda',
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
 * US-19: requests ready to be transferred — Uang Muka "Disetujui (Antri Transfer)" + Reimburse "Nota
 * Terverifikasi". ONE definition for the view title, the nav badge and the API count (S3e, S-07:
 * the badge used to add Reimburse still waiting for receipt verification).
 */
export const TRANSFER_QUEUE_WHERE: Where = {
  or: [
    { and: [{ type: { equals: 'advance' } }, { status: { equals: 'approved' } }] },
    { and: [{ type: { equals: 'reimburse' } }, { status: { equals: 'receipts_verified' } }] },
  ],
}
