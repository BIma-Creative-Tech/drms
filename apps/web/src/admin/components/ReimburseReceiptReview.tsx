import type { PayloadRequest } from 'payload'
import React from 'react'

import { detail } from '@/domain/expense/dto'
import { formatRupiah } from '@/lib/money'

import { ActionButton } from './ActionButton'

type Detail = Awaited<ReturnType<typeof detail>>

/**
 * Finance receipt verification of Reimburse (US-39, Q-12 default: after approval, before transfer),
 * rendered in the "Antrian Transfer" view above the transfer table. Reimburse "Disetujui" → per
 * receipt Valid / Tolak (reason; the request goes back to the requester as "Revisi Nota"), open
 * flags "sudah diperiksa", then "Verifikasi semua nota" → "Nota Terverifikasi (Antri Transfer)",
 * which is the only status in which the transfer form appears (state machine: transfer from
 * receipts_verified only). Buttons follow the DTO `allowedActions` (UI hint; the service guard
 * is authoritative) and call the existing /api/v1 endpoints with an Idempotency-Key.
 * No DefaultTemplate import here → server-renderable in integration tests.
 */
export type ReimburseReview = { review: Detail[]; revision: Detail[] }

/** Reimburse requests visible to the caller in "Disetujui" (to verify) and "Revisi Nota" (waiting). Call inside a transaction. */
export async function loadReimburseReview(req: PayloadRequest): Promise<ReimburseReview> {
  const res = await req.payload.find({
    collection: 'expense-requests',
    where: { and: [{ type: { equals: 'reimburse' } }, { status: { in: ['approved', 'receipt_revision'] } }] },
    sort: 'neededDate',
    limit: 100,
    depth: 0,
    user: req.user,
    overrideAccess: false,
    req,
  })
  const all: Detail[] = []
  for (const d of res.docs) all.push(await detail(req, d.id as number))
  return { review: all.filter((d) => d.status === 'approved'), revision: all.filter((d) => d.status === 'receipt_revision') }
}

const rp = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatRupiah(v))
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const th: React.CSSProperties = { textAlign: 'left', borderBottom: '2px solid var(--theme-elevation-150)', padding: '6px 8px', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { borderBottom: '1px solid var(--theme-elevation-100)', padding: '6px 8px', verticalAlign: 'top' }
const num: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap' }
const badge = (tone: 'ok' | 'warn' | 'bad' | 'muted'): React.CSSProperties => ({
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 600,
  color: tone === 'muted' ? 'var(--theme-elevation-800)' : '#FFFFFF', // ≥ 4.5:1 on every --pk-tone-* (src/theme/tokens.ts)
  background: tone === 'ok' ? 'var(--pk-tone-ok)' : tone === 'warn' ? 'var(--pk-tone-warn)' : tone === 'bad' ? 'var(--pk-tone-bad)' : 'var(--theme-elevation-150)',
})
const RECEIPT_STATUS: Record<string, { text: string; tone: 'ok' | 'bad' | 'muted' }> = {
  valid: { text: 'valid', tone: 'ok' },
  rejected: { text: 'ditolak', tone: 'bad' },
  pending: { text: 'menunggu', tone: 'muted' },
}

type Flag = Detail['flags'][number]

function FlagItem({ d, f, canReview }: { d: Detail; f: Flag; canReview: boolean }) {
  return (
    <li style={{ marginBottom: 4 }} data-pk-flag={f.id}>
      <span style={badge(f.status === 'reviewed' ? 'muted' : f.level === 'warning' ? 'warn' : 'muted')}>{f.kindLabel}</span> {f.message}
      {f.status === 'reviewed' ? <em> (sudah diperiksa{f.reviewNote ? `: ${f.reviewNote}` : ''})</em> : null}
      {canReview && f.status === 'open' ? (
        <>
          {' '}
          <ActionButton
            url={`/api/v1/expense-requests/${d.id}/flags/${f.id}/review`}
            label="Tandai flag diperiksa"
            prompt={{ field: 'note', message: 'Catatan pemeriksaan (opsional):' }}
            testId="flag-review"
          />
        </>
      ) : null}
    </li>
  )
}

function RequestReview({ d }: { d: Detail }) {
  const base = `/api/v1/expense-requests/${d.id}`
  const canVerify = d.allowedActions.includes('receipt_verify')
  const canReject = d.allowedActions.includes('receipt_reject')
  const canReview = d.allowedActions.includes('review_flag')
  const canVerifyAll = d.allowedActions.includes('verify_receipts')
  const active = d.receipts.filter((r) => r.status !== 'removed')
  const pending = active.filter((r) => r.status !== 'valid').length
  const openWarnings = d.flags.filter((f) => f.status === 'open' && f.level === 'warning').length
  const requestFlags = d.flags.filter((f) => f.receiptId === null)
  return (
    <section
      id={`reimburse-${d.id}`}
      data-pk-receipt-review={d.id}
      style={{ border: '1px solid var(--theme-elevation-150)', borderRadius: 4, padding: 12, marginBottom: 16 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong>
            <a href={`/admin/collections/expense-requests/${d.id}`}>{d.docNo ?? `#${d.id}`}</a>
          </strong>{' '}
          — {d.title} <span style={badge('muted')}>{d.statusLabel}</span>
          <div style={{ fontSize: 12 }}>
            Rekening: {d.bank ? `${d.bank.bankName ?? ''} · ${d.bank.accountHolder ?? ''} · ${d.bank.accountNo ?? ''}` : '—'}
          </div>
        </div>
        <div>
          Disetujui <strong>{rp(d.approvedAmount)}</strong> · {active.length} nota · {pending} belum valid · {openWarnings} flag peringatan terbuka
        </div>
      </div>
      {requestFlags.length > 0 ? (
        <ul style={{ margin: '8px 0', paddingLeft: 18, fontSize: 12 }}>
          {requestFlags.map((f) => (
            <FlagItem key={f.id} d={d} f={f} canReview={canReview} />
          ))}
        </ul>
      ) : null}
      {d.lines.map((l) => {
        const rs = active.filter((r) => r.lineId === l.id)
        return (
          <div key={l.id} style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 600 }}>
              Baris {l.no}: {l.description ?? '—'} · {rp(l.total)} · nota {rp(rs.reduce((s, r) => s + r.amount, 0))}
            </div>
            {rs.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--theme-error-500)' }}>Belum ada nota untuk baris ini.</div>
            ) : (
              <table style={{ ...table, marginTop: 4 }}>
                <thead>
                  <tr>
                    <th style={th}>Foto</th>
                    <th style={th}>Nota</th>
                    <th style={th}>Tanggal</th>
                    <th style={{ ...th, textAlign: 'right' }}>Nominal</th>
                    <th style={th}>Status</th>
                    <th style={th}>Flag</th>
                    <th style={th}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {rs.map((r) => {
                    const st = RECEIPT_STATUS[r.status] ?? RECEIPT_STATUS.pending!
                    const flags = d.flags.filter((f) => f.receiptId === r.id)
                    return (
                      <tr key={r.id} data-pk-receipt={r.id}>
                        <td style={td}>
                          {r.imageId ? (
                            <a href={`/api/v1/media/receipts/${r.imageId}/file`} target="_blank" rel="noopener noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API file, not a static asset */}
                              <img src={`/api/v1/media/receipts/${r.imageId}/file?variant=thumb`} alt={`Nota ${r.receiptNo ?? r.id}`} style={{ width: 80, height: 80, objectFit: 'cover' }} />
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={td}>
                          {r.vendorName}
                          <div style={{ fontSize: 12 }}>No. {r.receiptNo ?? '—'}</div>
                        </td>
                        <td style={td}>{r.receiptDate}</td>
                        <td style={num}>{rp(r.amount)}</td>
                        <td style={td}>
                          <span style={badge(st.tone)}>{st.text}</span>
                        </td>
                        <td style={td}>
                          {flags.length === 0 ? (
                            '—'
                          ) : (
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                              {flags.map((f) => (
                                <FlagItem key={f.id} d={d} f={f} canReview={canReview} />
                              ))}
                            </ul>
                          )}
                        </td>
                        <td style={td}>
                          {canVerify && r.status !== 'valid' ? <ActionButton url={`${base}/receipts/${r.id}/verify`} label="Valid" testId="receipt-valid" /> : null}
                          {canReject && r.status !== 'rejected' ? (
                            <ActionButton
                              url={`${base}/receipts/${r.id}/reject`}
                              label="Tolak"
                              prompt={{ field: 'reason', message: 'Alasan nota ditolak (wajib). Pengajuan kembali ke pemohon sebagai "Revisi Nota":', minLength: 3 }}
                              testId="receipt-reject"
                            />
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
      {canVerifyAll ? (
        <div style={{ marginTop: 10 }}>
          <ActionButton
            url={`${base}/verify-receipts`}
            label="Verifikasi semua nota"
            variant="primary"
            confirm='Semua nota valid dan flag sudah diperiksa? Status menjadi "Nota Terverifikasi (Antri Transfer)".'
            testId="verify-receipts"
          />
          {pending > 0 || openWarnings > 0 ? (
            <span style={{ fontSize: 12 }}>
              Syarat: semua nota valid ({pending} belum) dan semua flag peringatan ditandai diperiksa ({openWarnings} terbuka).
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export function ReimburseReceiptReview({ data }: { data: ReimburseReview }) {
  return (
    <div data-pk-section="reimburse-review">
      <h2>Verifikasi nota Reimburse ({data.review.length})</h2>
      <p style={{ marginTop: 0, fontSize: 13 }}>
        Reimburse yang sudah disetujui diverifikasi notanya dulu. Setelah <strong>Verifikasi semua nota</strong>, status menjadi{' '}
        <strong>Nota Terverifikasi (Antri Transfer)</strong> dan pengajuan muncul di tabel transfer di bawah.
      </p>
      {data.review.length === 0 ? <p style={{ color: 'var(--theme-elevation-600)' }}>Tidak ada nota Reimburse yang menunggu verifikasi.</p> : null}
      {data.review.map((d) => (
        <RequestReview key={d.id} d={d} />
      ))}
      {data.revision.length > 0 ? (
        <>
          <h3>Menunggu revisi nota pemohon ({data.revision.length})</h3>
          <ul style={{ fontSize: 13 }}>
            {data.revision.map((d) => (
              <li key={d.id}>
                <a href={`/admin/collections/expense-requests/${d.id}`}>{d.docNo ?? `#${d.id}`}</a> — {d.title} ·{' '}
                {d.receipts
                  .filter((r) => r.status === 'rejected')
                  .map((r) => `${r.vendorName} ${rp(r.amount)}`)
                  .join(', ') || 'nota ditolak'}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}

export default ReimburseReceiptReview
