import type { PayloadRequest } from 'payload'
import React from 'react'

import { detail } from '@/domain/expense/dto'
import { formatRupiah } from '@/lib/money'

import { Badge, NX_TABLE } from '../views/page-ui'
import { ActionButton } from './ActionButton'
import { DocSummaryProvider } from './feedback/DocContext'
import { expenseRequestSummary } from './feedback/summaries'
import { ImageThumb } from './media/ImageThumb'
import { mediaThumbSource } from './media/media-url'
import { TableScroll } from './TableScroll'
import { Panel } from './ui/nexus'

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
 * DRMS 24/10: the popups name the request (DocSummaryProvider per request) and, for Valid / Tolak, the receipt.
 * D2510 (ADR 0033): one Nexus card, each request an item card, receipts in the custom-view table, soft badges.
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
const RECEIPT_STATUS: Record<string, { text: string; tone: 'ok' | 'bad' | 'muted' }> = {
  valid: { text: 'valid', tone: 'ok' },
  rejected: { text: 'ditolak', tone: 'bad' },
  pending: { text: 'menunggu', tone: 'muted' },
}

type Flag = Detail['flags'][number]

function FlagItem({ d, f, canReview }: { d: Detail; f: Flag; canReview: boolean }) {
  return (
    <li data-pk-flag={f.id}>
      <Badge tone={f.status === 'reviewed' ? 'muted' : f.level === 'warning' ? 'warn' : 'muted'}>{f.kindLabel}</Badge> {f.message}
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
  const body = (
    <section id={`reimburse-${d.id}`} className="pk-nx-item" data-pk-receipt-review={d.id}>
      <div className="pk-nx-item__head">
        <div className="pk-nx-item__main">
          <strong>
            <a href={`/admin/collections/expense-requests/${d.id}`}>{d.docNo ?? `#${d.id}`}</a>
          </strong>{' '}
          — {d.title} <Badge tone="muted">{d.statusLabel}</Badge>
          <span className="pk-nx-sub">Rekening: {d.bank ? `${d.bank.bankName ?? ''} · ${d.bank.accountHolder ?? ''} · ${d.bank.accountNo ?? ''}` : '—'}</span>
        </div>
        <div className="pk-nx-item__figs">
          Disetujui <strong>{rp(d.approvedAmount)}</strong> · {active.length} nota · {pending} belum valid · {openWarnings} flag peringatan terbuka
        </div>
      </div>
      {requestFlags.length > 0 ? (
        <ul className="pk-nx-flags">
          {requestFlags.map((f) => (
            <FlagItem key={f.id} d={d} f={f} canReview={canReview} />
          ))}
        </ul>
      ) : null}
      {d.lines.map((l) => {
        const rs = active.filter((r) => r.lineId === l.id)
        return (
          <div key={l.id}>
            <div className="pk-nx-strong">
              Baris {l.no}: {l.description ?? '—'} · {rp(l.total)} · nota {rp(rs.reduce((s, r) => s + r.amount, 0))}
            </div>
            {rs.length === 0 ? (
              <span className="pk-nx-sub" data-tone="bad">
                Belum ada nota untuk baris ini.
              </span>
            ) : (
              <TableScroll label="Nota per baris">
                <table className={`${NX_TABLE} is-full`}>
                  <thead>
                    <tr>
                      <th>Foto</th>
                      <th>Nota</th>
                      <th>Tanggal</th>
                      <th className="n">Nominal</th>
                      <th>Status</th>
                      <th>Flag</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rs.map((r) => {
                      const st = RECEIPT_STATUS[r.status] ?? RECEIPT_STATUS.pending!
                      const flags = d.flags.filter((f) => f.receiptId === r.id)
                      // DRMS 24/10: Valid / Tolak name the receipt in their popups
                      const receipt = `nota ${r.receiptNo ?? r.vendorName}`
                      const receiptSummary = [['Pengajuan', d.docNo ?? `#${d.id}`], ['Baris', `${l.no}. ${l.description ?? '—'}`], ['Vendor / toko', r.vendorName], ['No. nota', r.receiptNo], ['Tanggal nota', r.receiptDate], ['Nominal', rp(r.amount)]] as const
                      return (
                        <tr key={r.id} data-pk-receipt={r.id}>
                          <td>
                            {r.imageId ? (
                              <ImageThumb src={mediaThumbSource('receipts', r.imageId)} group={`receipts-${d.id}`} title={`Nota ${r.receiptNo ?? r.id} · baris ${l.no} · ${rp(r.amount)}`} caption={`${r.vendorName} · ${r.receiptDate}`} alt={`Nota ${r.receiptNo ?? r.id}`} size={80} data-pk-receipt-thumb={r.id} />
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            {r.vendorName}
                            <span className="pk-nx-sub">No. {r.receiptNo ?? '—'}</span>
                          </td>
                          <td>{r.receiptDate}</td>
                          <td className="n">{rp(r.amount)}</td>
                          <td>
                            <Badge tone={st.tone}>{st.text}</Badge>
                          </td>
                          <td>
                            {flags.length === 0 ? (
                              '—'
                            ) : (
                              <ul className="pk-nx-flags">
                                {flags.map((f) => (
                                  <FlagItem key={f.id} d={d} f={f} canReview={canReview} />
                                ))}
                              </ul>
                            )}
                          </td>
                          <td>
                            <div className="pk-nx-acts">
                            {canVerify && r.status !== 'valid' ? <ActionButton url={`${base}/receipts/${r.id}/verify`} label="Valid" object={receipt} summary={receiptSummary} testId="receipt-valid" /> : null}
                            {canReject && r.status !== 'rejected' ? (
                              <ActionButton
                                url={`${base}/receipts/${r.id}/reject`}
                                label="Tolak"
                                object={receipt}
                                summary={receiptSummary}
                                prompt={{ field: 'reason', message: 'Alasan nota ditolak (wajib). Pengajuan kembali ke pemohon sebagai "Revisi Nota":', minLength: 3 }}
                                testId="receipt-reject"
                              />
                            ) : null}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </div>
        )
      })}
      {canVerifyAll ? (
        <div className="pk-nx-acts">
          <ActionButton
            url={`${base}/verify-receipts`}
            label="Verifikasi semua nota"
            variant="primary"
            confirm='Semua nota valid dan flag sudah diperiksa? Status menjadi "Nota Terverifikasi (Antri Transfer)".'
            testId="verify-receipts"
          />
          {pending > 0 || openWarnings > 0 ? (
            <span className="pk-nx-muted">
              Syarat: semua nota valid ({pending} belum) dan semua flag peringatan ditandai diperiksa ({openWarnings} terbuka).
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  )
  return <DocSummaryProvider {...expenseRequestSummary(d)}>{body}</DocSummaryProvider>
}

export function ReimburseReceiptReview({ data }: { data: ReimburseReview }) {
  return (
    <Panel id="verifikasi-nota" icon="tReceipt" title={`Verifikasi nota Reimburse (${data.review.length})`} data-pk-section="reimburse-review">
      <p className="pk-nx-lead">
        Reimburse yang sudah disetujui diverifikasi notanya dulu. Setelah <strong>Verifikasi semua nota</strong>, status menjadi{' '}
        <strong>Nota Terverifikasi (Antri Transfer)</strong> dan pengajuan muncul di tabel transfer di bawah.
      </p>
      {data.review.length === 0 ? <p className="pk-nx-empty">Tidak ada nota Reimburse yang menunggu verifikasi.</p> : null}
      {data.review.length > 0 ? (
        <div className="pk-nx-items">
          {data.review.map((d) => (
            <RequestReview key={d.id} d={d} />
          ))}
        </div>
      ) : null}
      {data.revision.length > 0 ? (
        <div className="pk-nx-subsec">
          <h3 className="pk-nx-subsec__title">Menunggu revisi nota pemohon ({data.revision.length})</h3>
          <ul className="pk-nx-flags">
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
        </div>
      ) : null}
    </Panel>
  )
}

export default ReimburseReceiptReview
