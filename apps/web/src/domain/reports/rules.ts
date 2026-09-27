/**
 * F3 dashboard/report rules (kpi-definitions.md). Pure module: no Payload import (unit-tested,
 * bundled into the OpenAPI generator).
 */
import { isBusinessDate } from '@/domain/expense/types'

// ---------------------------------------------------------------- K-08 budget colour

export type BudgetTone = 'none' | 'ok' | 'warn' | 'over'

export const BUDGET_LABELS: Record<BudgetTone, string> = {
  none: 'Tanpa RAB',
  ok: 'Aman',
  warn: 'Waspada',
  over: 'Lewat RAB',
}

/** K-08: round(committed / budget × 100, 2) — identical to budgetImpact() of the approval screen. */
export function budgetPct(committed: number, budget: number | null | undefined): number | null {
  if (!budget || budget <= 0) return null
  return Math.round((committed / budget) * 10000) / 100
}

/**
 * K-08 colour on the Komitmen basis (Q-F3-2, user 2026-09-24): Aman ≤ warn · Waspada > warn and
 * ≤ over · Lewat RAB > over · Tanpa RAB when the project has no budget. ">" like the approval screen.
 */
export function budgetTone(pct: number | null, warnPct: number, overPct: number): BudgetTone {
  if (pct === null) return 'none'
  if (pct > overPct) return 'over'
  if (pct > warnPct) return 'warn'
  return 'ok'
}

// ---------------------------------------------------------------- K-09 progress vs budget (US-12)

export type ProgressTone = 'none' | 'ok' | 'warn' | 'bad'

export const PROGRESS_LABELS: Record<ProgressTone, string> = {
  none: 'Belum bisa dihitung',
  ok: 'Sesuai',
  warn: 'Perlu perhatian',
  bad: 'Anggaran mendahului progress',
}

/** K-09: selisih = K-08 (% anggaran, Komitmen) − progress fisik (%); 2 decimals. null = not computable. */
export function progressGap(budgetPctValue: number | null, progressPct: number | null): number | null {
  if (budgetPctValue === null || progressPct === null) return null
  return Math.round((budgetPctValue - progressPct) * 100) / 100
}

/**
 * K-09 colour (US-12, settings progressWarnGapPct default 0 / progressBadGapPct default 8):
 * green selisih ≤ warn · yellow ≤ bad · red > bad · none without RAB or complete stage weights.
 */
export function progressTone(gap: number | null, warnGapPct: number, badGapPct: number): ProgressTone {
  if (gap === null) return 'none'
  if (gap > badGapPct) return 'bad'
  if (gap > warnGapPct) return 'warn'
  return 'ok'
}

// ---------------------------------------------------------------- periods (C2/C3)

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** 'YYYY-MM' shifted by `delta` months. */
export function addMonths(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number]
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** Inclusive list of periods from..to (max `cap` entries, newest kept). */
export function periodRange(from: string, to: string, cap = 36): string[] {
  const out: string[] = []
  for (let p = from; p <= to; p = addMonths(p, 1)) out.push(p)
  return out.slice(-cap)
}

export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number]
  return `${MONTHS_SHORT[m - 1]} ${y}`
}

export function firstDay(period: string): string {
  return `${period}-01`
}

export function lastDay(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/** Whole days between two business dates (b − a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (d: string) => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number]
    return Date.UTC(y, m - 1, day)
  }
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000)
}

/** Validated inclusive date range (C3); default = the month of `today`. `from > to` → swapped. */
export function dateRange(from: unknown, to: unknown, today: string): { from: string; to: string } {
  const month = today.slice(0, 7)
  let f = isBusinessDate(from) ? from : firstDay(month)
  let t = isBusinessDate(to) ? to : lastDay(month)
  if (f > t) [f, t] = [t, f]
  return { from: f, to: t }
}

/** Validated month range for K-02 (default: 12 months up to the current month, max 36). */
export function monthRange(from: unknown, to: unknown, today: string, defaultMonths = 12): { from: string; to: string } {
  const current = today.slice(0, 7)
  let t = typeof to === 'string' && PERIOD_RE.test(to) ? to : current
  let f = typeof from === 'string' && PERIOD_RE.test(from) ? from : addMonths(t, -(defaultMonths - 1))
  if (f > t) [f, t] = [t, f]
  if (periodRange(f, t, 10_000).length > 36) f = addMonths(t, -35)
  return { from: f, to: t }
}

// ---------------------------------------------------------------- display

export function formatPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  const [i, d] = v.toFixed(2).split('.')
  return `${i},${d}`
}

/** Short Rupiah for chart axes: 12.000.000 → '12 jt', 950.000 → '950 rb'. */
export function shortRupiah(v: number): string {
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1_000_000_000) return `${sign}${trim1(a / 1_000_000_000)} M`
  if (a >= 1_000_000) return `${sign}${trim1(a / 1_000_000)} jt`
  if (a >= 1_000) return `${sign}${trim1(a / 1_000)} rb`
  return `${sign}${a}`
}

function trim1(v: number): string {
  const s = (Math.round(v * 10) / 10).toFixed(1)
  return (s.endsWith('.0') ? s.slice(0, -2) : s).replace('.', ',')
}

/** "Nice" axis maximum ≥ v (1/2/2.5/5 × 10^n). */
export function niceMax(v: number): number {
  if (v <= 0) return 1
  const exp = Math.floor(Math.log10(v))
  const base = 10 ** exp
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= v) return m * base
  return 10 * base
}
