import { isoDateInTz } from '@/lib/time'

/**
 * Item 11 (DRMS 10/10): transfer SLA = final approval (`expense_requests.approved_at`) → bank transfer
 * (`transfers.transfer_at`, date + time of the proof). Target per PT: `companies.transfer_sla_hours`
 * (default 24). Pure math here (unit-tested); SQL in the report / queue / dashboard callers.
 * A transfer recorded without a time (old client, `transfer_at` NULL) uses the time it was RECORDED
 * (`created_at`, an upper bound) and is marked `timeKnown: false`.
 */
export const DEFAULT_TRANSFER_SLA_HOURS = 24

const HOUR = 3_600_000

/** Hours from `from` to `to` (negative = data error, kept so it is visible). */
export const hoursBetween = (from: Date, to: Date): number => (to.getTime() - from.getTime()) / HOUR

/** Nearest-rank percentile (p in 0..100) of `values`; null for none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? null
}

/** "YYYY-MM" of an instant in the PT zone (report month of a transfer). */
export const monthInTz = (at: Date, timeZone: string): string => isoDateInTz(at, timeZone).slice(0, 7)

export type SlaItem = { approvedAt: Date; transferAt: Date | null; recordedAt: Date; slaHours: number }
export type SlaMeasure = { hours: number; late: boolean; timeKnown: boolean; effectiveAt: Date }

export function measure(i: SlaItem): SlaMeasure {
  const effectiveAt = i.transferAt ?? i.recordedAt
  const hours = hoursBetween(i.approvedAt, effectiveAt)
  return { hours, late: hours > i.slaHours, timeKnown: i.transferAt !== null, effectiveAt }
}

export type SlaSummary = { count: number; avgHours: number | null; p90Hours: number | null; withinSla: number; pctWithin: number | null; late: number }

export function summarize(measures: readonly SlaMeasure[]): SlaSummary {
  const hours = measures.map((m) => m.hours)
  const late = measures.filter((m) => m.late).length
  const count = measures.length
  return {
    count,
    avgHours: count ? hours.reduce((a, b) => a + b, 0) / count : null,
    p90Hours: percentile(hours, 90),
    withinSla: count - late,
    late,
    pctWithin: count ? ((count - late) / count) * 100 : null,
  }
}

/** Queue age of an approved request not yet transferred (badge "Umur sejak disetujui"). */
export function queueAge(approvedAt: Date | null, now: Date, slaHours: number): { hours: number; over: boolean } | null {
  if (!approvedAt) return null
  const hours = hoursBetween(approvedAt, now)
  return { hours, over: hours > slaHours }
}

/** "3 jam", "1 hr 4 jam", "< 1 jam" (badge / report text). */
export function formatHours(h: number | null): string {
  if (h === null || !Number.isFinite(h)) return '—'
  if (h < 0) return `${h.toFixed(1)} jam`
  if (h < 1) return '< 1 jam'
  const whole = Math.floor(h)
  if (whole < 24) return `${whole} jam`
  const days = Math.floor(whole / 24)
  const rest = whole % 24
  return rest ? `${days} hr ${rest} jam` : `${days} hr`
}
