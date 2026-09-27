/**
 * Pure shaping helpers of the dashboard charts (Beranda redesign 2026-09-25). No Payload import:
 * unit-tested (tests/unit/f3-dashboard-viz.test.ts) and bundled into the OpenAPI generator.
 * Queries live in kpi.ts; this module only groups/folds rows the queries return.
 */
import type { RequestStatus, RequestType } from '@/domain/expense/types'

// ---------------------------------------------------------------- request pipeline (K-13)

/**
 * Ordered stages of the request life cycle (ordinal: swapping them changes the meaning). Every
 * non-draft status belongs to exactly one stage; rejected/cancelled are the "keluar" exit, shown
 * apart from the ordered stages. Draft is never counted (K-13: `status <> 'draft'`).
 */
export const PIPELINE_STAGES = [
  { key: 'ack', label: 'Menunggu Diketahui', statuses: ['pending_ack'] },
  { key: 'approval', label: 'Menunggu Approval', statuses: ['pending_approval'] },
  { key: 'queue', label: 'Antri transfer', statuses: ['approved', 'receipt_revision', 'receipts_verified'] },
  { key: 'lpj', label: 'Ditransfer / proses LPJ', statuses: ['transferred', 'receipts_complete', 'lpj_submitted', 'lpj_revision'] },
  { key: 'done', label: 'Selesai', statuses: ['lpj_verified', 'completed'] },
] as const satisfies ReadonlyArray<{ key: string; label: string; statuses: readonly RequestStatus[] }>

export const PIPELINE_EXIT = { key: 'exit' as const, label: 'Ditolak / dibatalkan', statuses: ['rejected', 'cancelled'] as readonly RequestStatus[] }

export type PipelineStageKey = (typeof PIPELINE_STAGES)[number]['key'] | 'exit'
export type PipelineStage = { key: PipelineStageKey; label: string; count: number; sum: number; statuses: RequestStatus[] }

/** Folds per-status counts (any order, any type) into the ordered stages + the exit bucket. */
export function pipelineFromStatus(rows: ReadonlyArray<{ status: string; count: number; sum: number }>): { stages: PipelineStage[]; exit: PipelineStage; total: number } {
  const stage = (s: { key: PipelineStageKey; label: string; statuses: readonly RequestStatus[] }): PipelineStage => {
    const hit = rows.filter((r) => (s.statuses as readonly string[]).includes(r.status))
    return { key: s.key, label: s.label, statuses: [...s.statuses], count: hit.reduce((a, r) => a + r.count, 0), sum: hit.reduce((a, r) => a + r.sum, 0) }
  }
  const stages = PIPELINE_STAGES.map(stage)
  const exit = stage(PIPELINE_EXIT)
  return { stages, exit, total: stages.reduce((a, s) => a + s.count, 0) + exit.count }
}

// ---------------------------------------------------------------- categorical folding

/**
 * Keeps the `n` largest items (already sorted desc by `value`) and folds the tail into one
 * "Lainnya" item — never more bars than a reader can compare, never a generated 9th colour.
 */
export function topWithOther<T extends { label: string; value: number }>(items: readonly T[], n: number, otherLabel = 'Lainnya'): Array<{ label: string; value: number; other: boolean; item: T | null }> {
  const sorted = [...items].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
  const head = sorted.slice(0, n).map((i) => ({ label: i.label, value: i.value, other: false, item: i }))
  const tail = sorted.slice(n)
  if (tail.length === 0) return head
  return [...head, { label: `${otherLabel} (${tail.length})`, value: tail.reduce((s, i) => s + i.value, 0), other: true, item: null }]
}

// ---------------------------------------------------------------- deltas

/** Signed change vs the previous period; `pct` null when the base is 0 (no meaningful ratio). */
export function delta(current: number, previous: number): { diff: number; pct: number | null; dir: 'up' | 'down' | 'flat' } {
  const diff = current - previous
  const pct = previous !== 0 ? Math.round((diff / Math.abs(previous)) * 1000) / 10 : null
  return { diff, pct, dir: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' }
}

/** Share (0–100, 1 decimal) of `part` in `whole`; null when whole ≤ 0. */
export function share(part: number, whole: number): number | null {
  if (!whole || whole <= 0) return null
  return Math.round((part / whole) * 1000) / 10
}

// ---------------------------------------------------------------- request status → pill

export type PillTone = 'wait' | 'progress' | 'ok' | 'warn' | 'bad' | 'none'

/** Visual tone of a request status pill (always shown with its text label + icon, never colour alone). */
export function statusTone(status: RequestStatus | string): PillTone {
  switch (status) {
    case 'pending_ack':
    case 'pending_approval':
      return 'wait'
    case 'approved':
    case 'receipts_verified':
    case 'transferred':
    case 'receipts_complete':
    case 'lpj_submitted':
      return 'progress'
    case 'lpj_verified':
    case 'completed':
      return 'ok'
    case 'receipt_revision':
    case 'lpj_revision':
      return 'warn'
    case 'rejected':
    case 'cancelled':
      return 'bad'
    default:
      return 'none'
  }
}

/** Requests of the given types grouped per status (API/Staff helper). */
export type StatusCount = { type: RequestType; status: RequestStatus; count: number; sum: number }
