import React from 'react'

import { PtChip, type PtView } from './pt'

/**
 * Per-PT breakdown under a combined KPI (MC2-4, ADR 0016 D3/§6, wireframe mc/wireframes.md §5):
 * "Gabungan Rp 61.400.000 — DRMS 48.250.000 · CS1 13.150.000". Only with > 1 PT selected and more
 * than one row. The rows come from the backend dashboard payloads (`byCompany`, `cashByCompany`,
 * `completenessByCompany` …, feat/mc2-backend `mc2-contract.md`). They are read defensively
 * (`unknown` → rows) so this view renders the single-PT layout until the backend payload carries them.
 */
export type PtRow = { companyId: number } & Record<string, unknown>

export function ptRows(v: unknown): PtRow[] {
  if (!Array.isArray(v)) return []
  return v.filter((r): r is PtRow => !!r && typeof r === 'object' && typeof (r as { companyId?: unknown }).companyId === 'number')
}

/** First numeric field of a row among `keys` (payload shapes differ per KPI: total / count / sum). */
export function rowNumber(r: PtRow, keys: readonly string[]): number | null {
  for (const k of keys) if (typeof r[k] === 'number') return r[k] as number
  return null
}

/** Rows sorted by PT code; Σ of the value (the combined total the tile already shows). */
export function breakdown(pt: Pick<PtView, 'ref'>, rows: readonly PtRow[], keys: readonly string[]) {
  const list = rows
    .map((r) => ({ id: r.companyId, code: pt.ref(r.companyId)?.shortCode ?? `#${r.companyId}`, value: rowNumber(r, keys), row: r }))
    .sort((a, b) => a.code.localeCompare(b.code))
  return { list, total: list.reduce((s, x) => s + (x.value ?? 0), 0) }
}

export function PerPt({
  pt,
  data,
  keys = ['total', 'count', 'sum'],
  fmt,
  render,
  label,
}: {
  pt: PtView
  data: unknown
  keys?: readonly string[]
  fmt?: (n: number) => string
  /** Custom cell (e.g. "4/6"); default = the formatted number. */
  render?: (r: PtRow) => React.ReactNode
  label: string
}) {
  const rows = ptRows(data)
  if (!pt.multi || rows.length < 2) return null
  const { list } = breakdown(pt, rows, keys)
  return (
    <ul className="pk-perpt" aria-label={`${label} per PT`} data-pk-per-pt={label}>
      {list.map((x) => (
        <li key={x.id}>
          <PtChip pt={pt.ref(x.id)} />
          <span className="pk-perpt__v">{render ? render(x.row) : x.value === null ? '—' : fmt ? fmt(x.value) : String(x.value)}</span>
        </li>
      ))}
    </ul>
  )
}
