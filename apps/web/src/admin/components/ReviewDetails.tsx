import React from 'react'

import type { detail } from '@/domain/expense/dto'
import { isContentEditable } from '@/domain/expense/types'
import { formatRupiah } from '@/lib/money'

import { formatQty } from './lines/line-form'
import { LineCard } from './lines/LineCard'

type Detail = Awaited<ReturnType<typeof detail>>

/**
 * S3e (US-26, US-59, S-05): what a decider sees before deciding — every line with its receipts
 * (thumbnail through the authorized media endpoint /api/v1/media/receipts/{id}/file: it re-checks the
 * caller's read access of the owning request; no public URL) and the validation flags PER LINE, plus
 * receipt totals and the difference per line (US-07). Used by the Persetujuan inbox (expandable per
 * row) and by the request detail panel for every reader who is not the requester/creator (Direktur,
 * Finance, PM monitoring, Admin). Pure server-rendered markup (no actions — decisions stay in the
 * inbox, flag review in the Finance work views).
 *
 * DRMS 10/10 B-2: at ≤ 640 px every line is an APK-style card (LineCard) instead of the wide table.
 *
 * Flag count definition (shared with the decision rows `approvals.openFlags`): flags with status
 * "Terbuka", both levels (peringatan + info); "Sudah diperiksa" and "Tidak berlaku lagi" are shown
 * but not counted.
 */
const rp = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatRupiah(v))
// Fixed layout + wrapping (DRMS 10/10 C-int): at 1280 px the main column is ~730 px wide — every column, the
// "Nota & flag" one included, has to fit without a horizontal scroll. The scroll stays only as a fallback below
// TABLE_MIN (between the card breakpoint 640 px and ~1100 px).
const cell: React.CSSProperties = { padding: '4px 6px', borderBottom: '1px solid var(--theme-elevation-100)', verticalAlign: 'top', textAlign: 'left', overflowWrap: 'break-word' }
const numCell: React.CSSProperties = { ...cell, padding: '4px 4px', textAlign: 'right', overflowWrap: 'normal' }
const TABLE_MIN = 680
/** Column widths (%), in the order No · Uraian · Kategori · Qty · Harga satuan · Total · Nominal sesuai nota · Nota & flag. */
const COLS = [4.5, 16, 10, 7.5, 13, 13.5, 13.5, 22] as const
const pill = (tone: 'warn' | 'muted' | 'ok' | 'bad'): React.CSSProperties => ({
  display: 'inline-block',
  padding: '0 6px',
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 600,
  marginRight: 4,
  color: tone === 'muted' ? 'var(--theme-elevation-800)' : '#FFFFFF', // ≥ 4.5:1 on every --pk-tone-*
  background: tone === 'warn' ? 'var(--pk-tone-warn)' : tone === 'ok' ? 'var(--pk-tone-ok)' : tone === 'bad' ? 'var(--pk-tone-bad)' : 'var(--theme-elevation-150)',
})
const RECEIPT_STATUS: Record<string, { text: string; tone: 'ok' | 'bad' | 'muted' }> = {
  valid: { text: 'valid', tone: 'ok' },
  rejected: { text: 'ditolak', tone: 'bad' },
  pending: { text: 'belum diverifikasi', tone: 'muted' },
}

/** Open flags counted like approvals.openFlags (both levels). Exported for unit tests. */
export function openFlagCounts(flags: Array<{ status: string; level: string }>): { warning: number; info: number; total: number } {
  const open = flags.filter((f) => f.status === 'open')
  const warning = open.filter((f) => f.level === 'warning').length
  return { warning, info: open.length - warning, total: open.length }
}

function Flags({ flags }: { flags: Detail['flags'] }) {
  if (flags.length === 0) return null
  return (
    <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12 }}>
      {flags.map((f) => (
        <li key={f.id} data-pk-review-flag={f.id} data-pk-flag-status={f.status}>
          <span style={pill(f.status !== 'open' ? 'muted' : f.level === 'warning' ? 'warn' : 'muted')}>{f.level === 'warning' ? 'Peringatan' : 'Info'}</span>
          <strong>{f.kindLabel}</strong>: {f.message}
          {f.status === 'reviewed' ? <em> — sudah diperiksa Finance{f.reviewNote ? `: ${f.reviewNote}` : ''}</em> : null}
        </li>
      ))}
    </ul>
  )
}

const named = (v: unknown, k: string): string | null => (v && typeof v === 'object' && k in v && (v as Record<string, unknown>)[k] ? String((v as Record<string, unknown>)[k]) : null)

/** "2 L × Rp 339.000" — Qty Satuan × Harga satuan (APK line card meta). */
function qtyPrice(l: Detail['lines'][number]): string {
  const uom = named(l.uom, 'name') ?? named(l.uom, 'code')
  const price = l.unitPrice ?? l.unitPriceDisplay
  return `${formatQty(l.qty ?? 1)}${uom ? ` ${uom}` : ''}${price === null ? '' : ` × ${rp(price)}`}`
}

function Receipt({ r, d, lineNo }: { r: Detail['receipts'][number]; d: Detail; lineNo: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 4 }} data-pk-review-receipt={r.id}>
      {r.imageId ? (
        <a href={`/api/v1/media/receipts/${r.imageId}/file`} target="_blank" rel="noopener noreferrer" title="Buka foto nota (ukuran penuh)" data-pk-lightbox={`receipts-${d.id}`} data-pk-lightbox-title={`Nota ${r.receiptNo ?? r.id} · baris ${lineNo} · ${rp(r.amount)}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API file, not a static asset */}
          <img src={`/api/v1/media/receipts/${r.imageId}/file?variant=thumb`} alt={`Foto nota ${r.receiptNo ?? r.id}, baris ${lineNo}`} loading="lazy" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 4 }} />
        </a>
      ) : null}
      <div style={{ minWidth: 0 }}>
        {r.vendorName} · No. {r.receiptNo ?? '—'} · {r.receiptDate}
        <div>
          <strong>{rp(r.amount)}</strong> <span style={pill(RECEIPT_STATUS[r.status]?.tone ?? 'muted')}>{RECEIPT_STATUS[r.status]?.text ?? r.status}</span>
        </div>
      </div>
    </div>
  )
}

export function ReviewDetails({ d, title = 'Rincian untuk pemeriksa' }: { d: Detail; title?: string }) {
  const editable = isContentEditable(d.status)
  const receipts = d.receipts.filter((r) => r.status !== 'removed')
  const counts = openFlagCounts(d.flags)
  const requestFlags = d.flags.filter((f) => !f.lineId || !d.lines.some((l) => l.id === f.lineId))
  const needsReceipts = d.type === 'reimburse' || receipts.length > 0
  const receiptTotal = receipts.filter((r) => r.status !== 'rejected').reduce((s, r) => s + r.amount, 0)
  return (
    <div data-pk-review={d.id} style={{ fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline', margin: '4px 0 6px' }}>
        <strong>{title}</strong>
        <span data-pk-open-flags={counts.total}>
          Flag terbuka: {counts.total} ({counts.warning} peringatan, {counts.info} info)
        </span>
        {needsReceipts ? (
          <span>
            · Total nota {rp(receiptTotal)} dari grand total {rp(d.grandTotal)}
            {receiptTotal !== d.grandTotal ? ` (selisih ${rp(d.grandTotal - receiptTotal)})` : ''}
          </span>
        ) : (
          <span>· Nota menyusul setelah dana ditransfer (Pengajuan Baru).</span>
        )}
      </div>
      <div className="pk-lwide" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: TABLE_MIN, tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 12 }} data-pk-review-table>
          <colgroup>
            {COLS.map((w, i) => (
              <col key={i} style={{ width: `${w}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={cell}>No</th>
              <th style={cell}>Uraian</th>
              <th style={cell}>Kategori</th>
              <th style={numCell}>Qty</th>
              <th style={numCell}>Harga satuan</th>
              <th style={numCell}>Total</th>
              <th style={numCell}>Nominal sesuai nota</th>
              <th style={cell}>Nota &amp; flag</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => {
              const rs = receipts.filter((r) => r.lineId === l.id)
              const sum = rs.filter((r) => r.status !== 'rejected').reduce((s, r) => s + r.amount, 0)
              const fl = d.flags.filter((f) => f.lineId === l.id)
              return (
                <tr key={l.id} data-pk-review-line={l.no}>
                  <td style={cell}>{l.no}</td>
                  <td style={cell}>
                    {l.description ?? '—'}
                    {l.vehicle && 'plateDisplay' in l.vehicle && l.vehicle.plateDisplay ? <div style={{ fontSize: 11 }}>Kendaraan {String(l.vehicle.plateDisplay)}</div> : null}
                    {l.notes ? <div style={{ fontSize: 11 }}>{l.notes}</div> : null}
                    {/* D4: RAP item of the line + live "Melebihi RAP" (only for the RAP viewers, DTO) */}
                    {l.rapItem ? (
                      <div style={{ fontSize: 11 }} data-pk-line-rap={l.no}>
                        RAP {[named(l.rapItem, 'code'), named(l.rapItem, 'name')].filter(Boolean).join(' ')}
                      </div>
                    ) : null}
                    {l.rapOverBudget ? (
                      <div>
                        <span style={pill('warn')} data-pk-line-over-rap={l.no} title="Realisasi item RAP ini + pengajuan ini melebihi rencana RAP">
                          Melebihi RAP
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td style={cell}>{l.category && 'name' in l.category ? String(l.category.name ?? '') : '—'}</td>
                  <td style={numCell}>
                    {l.qty ?? '—'} {l.uom && 'code' in l.uom ? String(l.uom.code ?? '') : ''}
                  </td>
                  <td style={numCell}>{rp(l.unitPrice ?? l.unitPriceDisplay)}</td>
                  <td style={{ ...numCell, fontWeight: 600 }}>{rp(l.total)}</td>
                  <td style={numCell} data-pk-receipt-amount={l.no}>
                    {rp(l.receiptAmount)}
                    {/* D3: "Nominal sesuai nota" ≠ total → awareness for Finance (flag receipt_amount_mismatch below) */}
                    {l.receiptMismatch ? (
                      <div>
                        <span style={pill('warn')} data-pk-line-mismatch={l.no} title="Nominal sesuai nota berbeda dari total baris">
                          Selisih nota {rp(Math.abs(l.total - (l.receiptAmount ?? 0)))}
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td style={cell}>
                    {rs.length === 0 ? <span style={{ color: 'var(--theme-elevation-600)' }}>{needsReceipts ? 'Belum ada nota.' : '—'}</span> : null}
                    {rs.map((r) => (
                      <Receipt key={r.id} r={r} d={d} lineNo={l.no} />
                    ))}
                    {rs.length > 0 ? (
                      <div style={{ fontSize: 11 }}>
                        Nota {rp(sum)}
                        {sum !== l.total ? ` · selisih ${rp(l.total - sum)}` : ' · sesuai'}
                      </div>
                    ) : null}
                    <Flags flags={fl} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="pk-lcards" data-pk-review-cards>
        {d.lines.map((l) => {
          const rs = receipts.filter((r) => r.lineId === l.id)
          const sum = rs.filter((r) => r.status !== 'rejected').reduce((s, r) => s + r.amount, 0)
          return (
            <LineCard
              key={l.id}
              no={l.no}
              description={l.description}
              total={l.total}
              qtyPrice={qtyPrice(l)}
              category={named(l.category, 'name')}
              vehicle={named(l.vehicle, 'plateDisplay')}
              rap={l.rapItem ? [named(l.rapItem, 'code'), named(l.rapItem, 'name')].filter(Boolean).join(' ') : null}
              overBudget={l.rapOverBudget}
              notes={l.notes}
              receiptAmount={l.receiptAmount}
              mismatch={l.receiptMismatch}
              needsCompletion={editable && l.unitPrice === null}
            >
              {rs.length > 0 ? (
                <div style={{ marginTop: 4 }}>
                  {rs.map((r) => (
                    <Receipt key={r.id} r={r} d={d} lineNo={l.no} />
                  ))}
                  <div style={{ fontSize: 11 }}>
                    Nota {rp(sum)}
                    {sum !== l.total ? ` · selisih ${rp(l.total - sum)}` : ' · sesuai'}
                  </div>
                </div>
              ) : needsReceipts ? (
                <div className="pk-lcard__meta">Belum ada nota.</div>
              ) : null}
              <Flags flags={d.flags.filter((f) => f.lineId === l.id)} />
            </LineCard>
          )
        })}
      </div>
      {requestFlags.length > 0 ? (
        <div style={{ marginTop: 6 }}>
          <strong style={{ fontSize: 12 }}>Flag pengajuan</strong>
          <Flags flags={requestFlags} />
        </div>
      ) : null}
    </div>
  )
}

export default ReviewDetails
