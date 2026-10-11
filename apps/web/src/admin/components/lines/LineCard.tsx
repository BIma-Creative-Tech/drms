import React from 'react'

import { formatRupiah } from '@/lib/money'

/**
 * DRMS 10/10 B-2 (owner: the APK layout wins): one expense-request line as a card at ≤ 640 px — the APK line card
 * (draft_editor_screen / request_detail_screen _LineCard): "1. Uraian" with the total on the right, "Qty Satuan ×
 * Harga satuan · Kategori", "Nominal sesuai nota" + "Selisih nota" chip, "Lengkapi Qty & Harga satuan" for a
 * pre-D3 line, then receipts / flags / actions. Desktop keeps the table (custom.scss .pk-lwide / .pk-lcards).
 * Plain markup: used by the client lines editor and the server-rendered read-only "Rincian item".
 */
export type LineCardProps = {
  no: number
  description: string | null
  total: number | null
  /** "2 L × Rp 15.000" (qty unit × unit price), null when not known. */
  qtyPrice: string | null
  category: string | null
  vehicle?: string | null
  notes?: string | null
  receiptAmount: number | null
  /** "Selisih nota": receipt amount set and ≠ total (server flag or local compare). */
  mismatch: boolean
  /** Pre-D3 line in an editable request: no reproducible unit price yet. */
  needsCompletion?: boolean
  error?: string | null
  children?: React.ReactNode
  actions?: React.ReactNode
}

const rp = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatRupiah(v))

export function LineCard(p: LineCardProps) {
  const meta = [p.qtyPrice, p.category, p.vehicle ? `Kendaraan ${p.vehicle}` : null].filter(Boolean).join(' · ')
  return (
    <article className="pk-lcard" data-pk-line-card={p.no}>
      <div className="pk-lcard__head">
        <span className="pk-lcard__title">
          {p.no}. {p.description || <em style={{ fontWeight: 400, color: 'var(--pk-muted-fg)' }}>(tanpa uraian)</em>}
        </span>
        <span className="pk-lcard__total">{rp(p.total)}</span>
      </div>
      {meta ? <div className="pk-lcard__meta">{meta}</div> : null}
      {p.receiptAmount !== null ? (
        <div className="pk-lcard__meta">
          Nominal sesuai nota: <span style={{ color: 'var(--pk-fg)', fontVariantNumeric: 'tabular-nums' }}>{rp(p.receiptAmount)}</span>
        </div>
      ) : null}
      {p.mismatch || p.needsCompletion ? (
        <div className="pk-lcard__chips">
          {p.mismatch ? (
            <span className="pk-lchip pk-lchip--warn" title="Nominal sesuai nota berbeda dari total baris" data-pk-line-mismatch={p.no}>
              Selisih nota {rp(Math.abs((p.total ?? 0) - (p.receiptAmount ?? 0)))}
            </span>
          ) : null}
          {p.needsCompletion ? (
            <span className="pk-lchip pk-lchip--todo" data-pk-line-incomplete={p.no}>
              Lengkapi Qty &amp; Harga satuan
            </span>
          ) : null}
        </div>
      ) : null}
      {p.notes ? <div className="pk-lcard__meta">{p.notes}</div> : null}
      {p.error ? <div className="pk-lcard__err">{p.error}</div> : null}
      {p.children}
      {p.actions ? <div className="pk-lcard__actions">{p.actions}</div> : null}
    </article>
  )
}

export default LineCard
