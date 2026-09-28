import React from 'react'

import { PtChip, type PtView } from './pt'

/**
 * Per-PT breakdown under a combined KPI (MC2-4, ADR 0016 D3/§6, wireframe mc/wireframes.md §5):
 * "Gabungan Rp 61.400.000 — DRMS 48.250.000 · CS1 13.150.000". Only with > 1 PT selected and more
 * than one row. The rows are the typed `byCompany` / `…ByCompany` fields of the backend dashboard
 * payloads (`mc2-contract.md` §2) — a renamed field is a compile error, never a silently empty row.
 */
export type PtRow = { companyId: number }

/** Rows sorted by PT code; Σ of the value (the combined total the tile already shows). */
export function breakdown<R extends PtRow>(pt: Pick<PtView, 'ref'>, rows: readonly R[], value: (r: R) => number) {
  const list = rows.map((r) => ({ id: r.companyId, code: pt.ref(r.companyId)?.shortCode ?? `#${r.companyId}`, value: value(r), row: r })).sort((a, b) => a.code.localeCompare(b.code))
  return { list, total: list.reduce((s, x) => s + x.value, 0) }
}

export function PerPt<R extends PtRow>({
  pt,
  rows,
  value = () => 0,
  fmt = String,
  render,
  label,
}: {
  pt: PtView
  rows: readonly R[]
  /** Number shown per PT (Σ = the combined tile value). */
  value?: (r: R) => number
  fmt?: (n: number) => string
  /** Custom cell (e.g. "4/6"); default = the formatted value. */
  render?: (r: R) => React.ReactNode
  label: string
}) {
  if (!pt.multi || rows.length < 2) return null
  const { list } = breakdown(pt, rows, value)
  return (
    <ul className="pk-perpt" aria-label={`${label} per PT`} data-pk-per-pt={label}>
      {list.map((x) => (
        <li key={x.id}>
          <PtChip pt={pt.ref(x.id)} />
          <span className="pk-perpt__v">{render ? render(x.row) : fmt(x.value)}</span>
        </li>
      ))}
    </ul>
  )
}
