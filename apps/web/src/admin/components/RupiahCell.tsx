import React from 'react'

import { formatNumber, formatRupiah } from '@/lib/money'

const toNumber = (value: unknown): number => (typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN)

/**
 * List cell of every Rupiah amount (number fields made by rupiahField() or labelled "… (Rp)",
 * src/admin/display-cells.ts): "Rp 250.000" like the custom views, instead of Payload's raw "250000".
 * Server component: plain text, no wrap.
 */
export function rupiahText(value: unknown): string {
  const n = toNumber(value)
  return Number.isFinite(n) ? formatRupiah(n) : '—'
}

export function RupiahCell({ cellData }: { cellData?: unknown }) {
  return <span className="pk-rp-cell">{rupiahText(cellData)}</span>
}

/**
 * DRMS 13/10 #10: every other number in the lists (counts, quantities, hours, %) — thousands '.',
 * decimals ',' (≤ 2): 12000 → "12.000", 7.5 → "7,5". A hasMany number field lists its values.
 */
export function numberText(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.map(numberText).join(', ') : '—'
  const n = toNumber(value)
  return Number.isFinite(n) ? formatNumber(n, 2) : '—'
}

export function NumberCell({ cellData }: { cellData?: unknown }) {
  return <span className="pk-num-cell">{numberText(cellData)}</span>
}

export default RupiahCell
