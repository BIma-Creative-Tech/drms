/**
 * D2410 (user 2026-10-24, point 8): the status filter "Menunggu persetujuan Owner" of the request lists (Keuangan ›
 * Pengajuan Biaya, Laporan Rekap Pengajuan). `pending_owner` is a VIRTUAL filter value — not a status: the rows in
 * "Menunggu persetujuan" whose CURRENT approval level is the Owner's (snapshot step role `pk-principal`, no named user —
 * the rule of timeline.ts `requestStatusLabel` / OWNER_WAITING_LABEL). With it, the plain `pending_approval` value means
 * the other waiting rows (Direktur, legacy "Menunggu Approval"). Pure module (unit-tested); the SQL condition is in
 * status-filter-sql.ts.
 */
import { OWNER_WAITING_LABEL, STATUS_LABELS } from './types'

export const PENDING_OWNER = 'pending_owner'

/** The extra option, placed right after "Menunggu persetujuan Direktur" (`pending_approval`). */
export const PENDING_OWNER_OPTION = { value: PENDING_OWNER, label: OWNER_WAITING_LABEL } as const

/** Status options + the virtual Owner option after `pending_approval` (unchanged when that status is not offered). */
export function withPendingOwner<T extends { value: string }>(options: readonly T[], make: (o: typeof PENDING_OWNER_OPTION) => T): T[] {
  const i = options.findIndex((o) => o.value === 'pending_approval')
  if (i < 0 || options.some((o) => o.value === PENDING_OWNER)) return [...options]
  return [...options.slice(0, i + 1), make(PENDING_OWNER_OPTION), ...options.slice(i + 1)]
}

/** Filter values → plain statuses + the two waiting halves (`direktur` = pending_approval without the Owner step). */
export function splitStatusFilter(values: readonly string[]): { plain: string[]; direktur: boolean; owner: boolean } {
  return {
    plain: values.filter((v) => v !== 'pending_approval' && v !== PENDING_OWNER),
    direktur: values.includes('pending_approval'),
    owner: values.includes(PENDING_OWNER),
  }
}

/** Label of `pending_approval` in these filters (the non-Owner half). */
export const PENDING_DIREKTUR_LABEL = STATUS_LABELS.pending_approval
