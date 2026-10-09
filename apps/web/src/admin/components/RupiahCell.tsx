import React from 'react'

import { formatRupiah } from '@/lib/money'

/**
 * List cell of every Rupiah amount (number fields labelled "… (Rp)", src/admin/display-cells.ts): "Rp 250.000"
 * like the custom views, instead of Payload's raw "250000". Server component: plain text, no wrap.
 */
export function rupiahText(value: unknown): string {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) ? formatRupiah(n) : '—'
}

export function RupiahCell({ cellData }: { cellData?: unknown }) {
  return <span className="pk-rp-cell">{rupiahText(cellData)}</span>
}

export default RupiahCell
