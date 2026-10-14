/**
 * Display texts of audit history rows (domain/history.ts): the "Riwayat" document tab (RiwayatView) and the
 * "Log perubahan" section of the expense-request page (DRMS 13/10 Persetujuan #6) read the same labels.
 * Pure module (unit-tested): no Payload import.
 */
import { fieldLabel } from '@/lib/field-labels'
import { formatServerTime } from '@/pdf/format'

import { STATUS_LABELS, type RequestStatus } from './expense/types'
import type { HistoryRow } from './history'

export const ACTION_LABELS: Record<string, string> = {
  create: 'dibuat',
  update: 'diubah',
  status_change: 'status',
  void: 'void',
  sign: 'tanda tangan',
  acknowledge: 'disetujui (Diketahui)', // ADR 0021: PM project; ADR 0013: Direktur (pre-E1 rows: PM "Diketahui")
  approve: 'disetujui',
  approval_policy_exception: 'pengecualian G1 (pengajuan Direktur via PM)',
  reject: 'ditolak',
  verify: 'diverifikasi',
  number_issued: 'nomor terbit',
  flag_raised: 'flag muncul',
  flag_reviewed: 'flag diperiksa',
  export: 'PDF/ekspor',
  print: 'cetak',
  view_sensitive: 'dilihat (sensitif)',
  delete_attempt: 'percobaan hapus',
  acknowledge_delegated: 'Diketahui dilimpahkan',
  access_denied: 'aksi ditolak (hak akses)',
  approval_skipped: 'posisi dilewati (tidak berlaku — pemohon)',
  privacy_ack: 'pemberitahuan privasi dibaca',
  // DRMS 13/10 Wave 4: one-time renumbering (ADR 0007 amendment 2026-10-13)
  renumbered: 'nomor diubah',
}

export const DOC_LABELS: Record<string, string> = { expense_request: 'Pengajuan', receipt: 'Nota', transfer: 'Transfer', settlement: 'LPJ', cash_entry: 'Kas' }

/** DRMS 13/10 Wave 4: fields of a `renumbered` row — the document number, or a cash-entry description that quoted one. */
const RENUMBER_FIELDS: Readonly<Record<string, string>> = { docNo: 'Nomor diubah', entryNo: 'Nomor diubah', description: 'Keterangan (nomor diubah)' }

/** DRMS 13/10 Persetujuan #12: audit field of the duplicate endpoint (on the NEW draft; value = the source request). */
export const DUPLICATED_FROM_FIELD = 'duplicated_from'

/** One audit value as short text (JSON for objects, cut at 160 characters). */
export function showValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 160 ? `${s.slice(0, 157)}…` : s
}

/** Actor of a row: the user's name, else the job / system / user id. */
export function actorText(r: Pick<HistoryRow, 'userName' | 'userId' | 'source'>): string {
  return r.userName ?? (r.source === 'job' ? 'sistem (job)' : r.userId ? `user#${r.userId}` : 'sistem')
}

const statusText = (docType: string, s: string | null) => (s === null ? '—' : docType === 'expense_request' ? (STATUS_LABELS[s as RequestStatus] ?? s) : s)

export type HistoryEntry = {
  id: number
  /** Server time in the PT time zone ("13/10/2026 09:15 WITA"). */
  at: string
  who: string
  /** "Pengajuan", "Nota KW-12", "Transfer TRF/…" … */
  doc: string
  action: string
  /** Field (with line number) or null. */
  field: string | null
  /** "lama → baru" or the status change. */
  change: string
  reason: string | null
}

/** A history row as the change log shows it (labels in Bahasa Indonesia, status codes as their labels). */
export function historyEntry(r: HistoryRow, tz: string): HistoryEntry {
  // DRMS 13/10 Wave 4: "Nomor diubah: PB/X/2610/0003 → PB/X/2610/0001" (the change log prints `field: change`)
  const renumberField = r.action === 'renumbered' && r.field !== null && Object.hasOwn(RENUMBER_FIELDS, r.field) ? RENUMBER_FIELDS[r.field] : undefined
  const field =
    renumberField ??
    (r.field === DUPLICATED_FROM_FIELD ? 'Disalin dari' : r.field ? `${fieldLabel(r.field) ?? r.field}${r.lineNo ? ` (baris ${r.lineNo})` : ''}` : r.lineNo ? `baris ${r.lineNo}` : null)
  const dup = r.field === DUPLICATED_FROM_FIELD ? (r.newValue as { docNo?: unknown; id?: unknown } | null) : null
  const change =
    r.statusFrom || r.statusTo
      ? `${statusText(r.docType, r.statusFrom)} → ${statusText(r.docType, r.statusTo)}`
      : dup
        ? String(dup.docNo ?? (dup.id !== undefined ? `#${String(dup.id)}` : '—'))
        : r.oldValue === null && r.newValue === null
          ? '—'
          : `${showValue(r.oldValue)} → ${showValue(r.newValue)}`
  return {
    id: r.id,
    at: formatServerTime(r.serverTime, tz),
    who: actorText(r),
    doc: [DOC_LABELS[r.docType] ?? r.docType, r.docType !== 'expense_request' ? r.docNo : null].filter(Boolean).join(' '),
    action: ACTION_LABELS[r.action] ?? r.action,
    field,
    change,
    reason: r.reason,
  }
}
