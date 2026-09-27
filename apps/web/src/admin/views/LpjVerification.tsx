import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { detail } from '@/domain/expense/dto'
import { SETTLEMENT_TYPE_LABELS } from '@/domain/expense/settlement-rules'
import { withReqTransaction } from '@/lib/system-tx'

import { ActionButton } from '../components/ActionButton'
import { MoneyForm } from '../components/MoneyForm'
import { Empty, Forbidden, Shell, allowed, badge, docLink, num, rp, table, td, th } from './shared'

type Detail = Awaited<ReturnType<typeof detail>>

/**
 * "Verifikasi LPJ" (M06, US-21/US-22): Uang Muka in "LPJ Diajukan" — per receipt valid / tolak,
 * revision request with a note, verification (verified total = Σ valid receipts) — and in
 * "LPJ Terverifikasi" the settlement: surplus → KM "Pengembalian LPJ", shortfall → transfer.
 * Owner sees the queue read-only; Finance acts (never on its own request, server-enforced).
 */
export async function LpjVerification(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!allowed(req, ['pk-finance', 'pk-owner'])) return <Forbidden props={props} title="Verifikasi LPJ" roles={['pk-finance', 'pk-owner']} />
  const finance = allowed(req, ['pk-finance'])
  const { submitted, verified, accounts } = await withReqTransaction(req, async () => {
    const res = await req.payload.find({
      collection: 'expense-requests',
      where: { and: [{ type: { equals: 'advance' } }, { status: { in: ['lpj_submitted', 'lpj_verified'] } }] },
      sort: 'updatedAt',
      limit: 100,
      depth: 0,
      user: req.user,
      overrideAccess: false,
      req,
    })
    const all: Detail[] = []
    for (const d of res.docs) all.push(await detail(req, d.id as number))
    const acc = finance
      ? (await req.payload.find({ collection: 'cash-accounts', where: { active: { not_equals: false } }, depth: 0, pagination: false, sort: 'name', user: req.user, overrideAccess: false, req })).docs.map((a) => ({ id: a.id as number, name: a.name as string }))
      : []
    return { submitted: all.filter((d) => d.status === 'lpj_submitted'), verified: all.filter((d) => d.status === 'lpj_verified'), accounts: acc }
  })
  const base = (id: number) => `/api/v1/expense-requests/${id}`
  return (
    <Shell props={props} title={`Verifikasi LPJ (${submitted.length + verified.length})`}>
      <h2>LPJ diajukan ({submitted.length})</h2>
      {submitted.length === 0 ? <Empty text="Tidak ada LPJ yang menunggu verifikasi." /> : null}
      {submitted.map((d) => (
        <section key={d.id} style={{ border: '1px solid var(--theme-elevation-150)', borderRadius: 4, padding: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong>{docLink(d.id, d.docNo ?? `#${d.id}`)}</strong> — {d.title} · LPJ {d.settlement?.docNo ?? ''} · kiriman ke-{d.settlement?.submitCount ?? 1}
              <div style={{ fontSize: 12 }}>Uraian penggunaan: {d.settlement?.usageNotes ?? '—'}</div>
            </div>
            <div>
              Ditransfer <strong>{rp(d.transferredTotal)}</strong> · Nota <strong>{rp(d.settlement?.receiptsTotal)}</strong> · Selisih{' '}
              <strong>{rp(d.settlement?.difference)}</strong>
            </div>
          </div>
          {d.flags.length > 0 ? (
            <ul style={{ margin: '8px 0', paddingLeft: 18, fontSize: 12 }}>
              {d.flags.map((f) => (
                <li key={f.id} data-pk-flag={f.id}>
                  <span style={badge(f.status === 'reviewed' ? 'muted' : f.level === 'warning' ? 'warn' : 'muted')}>{f.kindLabel}</span> baris {f.lineNo ?? '—'}: {f.message}
                  {f.status === 'reviewed' ? <em> (sudah diperiksa{f.reviewNote ? `: ${f.reviewNote}` : ''})</em> : null}
                  {/* S3e (US-21, S-08): Finance marks the flag reviewed (audit flag_reviewed), same endpoint as the Reimburse review. */}
                  {finance && f.status === 'open' && d.allowedActions.includes('review_flag') ? (
                    <>
                      {' '}
                      <ActionButton url={`${base(d.id)}/flags/${f.id}/review`} label="Tandai flag diperiksa" prompt={{ field: 'note', message: 'Catatan pemeriksaan (opsional):' }} testId="lpj-flag-review" />
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <table style={{ ...table, marginTop: 8 }}>
            <thead>
              <tr>
                <th style={th}>Foto</th>
                <th style={th}>Baris</th>
                <th style={th}>Nota</th>
                <th style={th}>Tanggal</th>
                <th style={{ ...th, textAlign: 'right' }}>Nominal</th>
                <th style={th}>Status</th>
                <th style={th}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {d.receipts
                .filter((r) => r.status !== 'removed')
                .map((r) => (
                  <tr key={r.id}>
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
                    <td style={td}>{r.lineNo ?? '—'}</td>
                    <td style={td}>
                      {r.vendorName}
                      <div style={{ fontSize: 12 }}>No. {r.receiptNo ?? '—'}</div>
                    </td>
                    <td style={td}>{r.receiptDate}</td>
                    <td style={num}>{rp(r.amount)}</td>
                    <td style={td}>
                      <span style={badge(r.status === 'valid' ? 'ok' : r.status === 'rejected' ? 'bad' : 'muted')}>{r.status === 'valid' ? 'valid' : r.status === 'rejected' ? 'ditolak' : 'menunggu'}</span>
                    </td>
                    <td style={td}>
                      {finance && d.allowedActions.includes('receipt_verify') ? (
                        <>
                          {r.status !== 'valid' ? <ActionButton url={`${base(d.id)}/receipts/${r.id}/verify`} label="Valid" /> : null}
                          {r.status !== 'rejected' ? <ActionButton url={`${base(d.id)}/receipts/${r.id}/reject`} label="Tolak" prompt={{ field: 'reason', message: 'Alasan nota ditolak (wajib):', minLength: 3 }} /> : null}
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {finance ? (
            <div style={{ marginTop: 8 }}>
              {d.allowedActions.includes('lpj_verify') ? (
                <ActionButton url={`${base(d.id)}/lpj/verify`} label="Verifikasi LPJ" variant="primary" confirm="Verifikasi LPJ? Total terverifikasi = jumlah nota valid." />
              ) : null}
              {d.allowedActions.includes('lpj_request_revision') ? (
                <ActionButton url={`${base(d.id)}/lpj/request-revision`} label="Minta revisi" prompt={{ field: 'note', message: 'Catatan revisi untuk pemohon (wajib, minimal 3 karakter):', minLength: 3 }} />
              ) : null}
            </div>
          ) : null}
        </section>
      ))}

      <h2>Menunggu penyelesaian selisih ({verified.length})</h2>
      {verified.length === 0 ? <Empty text="Tidak ada LPJ terverifikasi yang menunggu penyelesaian." /> : null}
      {verified.map((d) => {
        const s = d.settlement!
        const amount = Math.abs(s.difference ?? 0)
        return (
          <section key={d.id} style={{ border: '1px solid var(--theme-elevation-150)', borderRadius: 4, padding: 12, marginBottom: 16 }}>
            <div>
              <strong>{docLink(d.id, d.docNo ?? `#${d.id}`)}</strong> — {d.title} · LPJ {s.docNo}
            </div>
            <div style={{ margin: '6px 0' }}>
              Ditransfer {rp(s.transferredTotal)} · Nota terverifikasi {rp(s.verifiedReceiptsTotal)} · Selisih {rp(s.difference)} —{' '}
              <strong>{s.settlementType ? SETTLEMENT_TYPE_LABELS[s.settlementType] : '—'}</strong>
            </div>
            {finance && d.allowedActions.includes('settle') ? (
              s.settlementType === 'shortfall' ? (
                <MoneyForm
                  url={`${base(d.id)}/settle`}
                  submitLabel="Transfer kekurangan & selesaikan"
                  cashAccounts={accounts}
                  bankRef="required"
                  proof={{ kind: 'transfer-proofs', required: true }}
                  amountText={`Transfer ${rp(amount)} ke ${d.bank?.bankName ?? ''} ${d.bank?.accountNo ?? ''}`}
                />
              ) : (
                <MoneyForm
                  url={`${base(d.id)}/settle`}
                  submitLabel="Catat pengembalian & selesaikan"
                  cashAccounts={accounts}
                  bankRef="none"
                  proof={{ kind: 'attachments', required: false }}
                  amountText={`Kas masuk ${rp(amount)} (Pengembalian LPJ)`}
                />
              )
            ) : null}
          </section>
        )
      })}
    </Shell>
  )
}

export default LpjVerification
