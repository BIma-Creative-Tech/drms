import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { voidableTransfers } from '@/domain/cash/book'
import { transferQueue } from '@/domain/expense/queues'
import { approvedByCaller } from '@/domain/expense/transfers'
import { withReqTransaction } from '@/lib/system-tx'

import { ReasonAction } from '../components/kas/ReasonAction'
import { KAS_STYLE } from '../components/kas/style'
import { MoneyForm } from '../components/MoneyForm'
import { ReimburseReceiptReview, loadReimburseReview } from '../components/ReimburseReceiptReview'
import { Empty, Forbidden, Shell, allowed, badge, docLink, num, rp, table, td, th } from './shared'

/**
 * "Antrian Transfer" (M05, US-19/US-20): Uang Muka "Disetujui (Antri Transfer)" and Reimburse
 * "Nota Terverifikasi (Antri Transfer)", sorted by needed date, open flags shown. Finance records
 * the transfer (cash account, bank reference, proof); the amount is the approved amount (G3).
 */
export async function TransferQueue(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!allowed(req, ['pk-finance', 'pk-owner'])) return <Forbidden props={props} title="Antrian Transfer" roles={['pk-finance', 'pk-owner']} />
  const { items, review, done, mine } = await withReqTransaction(req, async () => {
    const q = await transferQueue(req)
    return { items: q, review: await loadReimburseReview(req), done: await voidableTransfers(req), mine: await approvedByCaller(req, q.map((x) => x.id)) }
  })
  const canTransfer = allowed(req, ['pk-finance'])
  const accounts = canTransfer
    ? (
        await req.payload.find({ collection: 'cash-accounts', where: { active: { not_equals: false } }, depth: 0, pagination: false, sort: 'name', user: req.user, overrideAccess: false, req })
      ).docs.map((a) => ({ id: a.id as number, name: a.name as string }))
    : []
  return (
    <Shell props={props} title={`Antrian Transfer (${items.length})`}>
      <ReimburseReceiptReview data={review} />
      <h2>Siap ditransfer ({items.length})</h2>
      {items.length === 0 ? (
        <Empty text="Antrian transfer kosong." />
      ) : (
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Dibutuhkan</th>
              <th style={th}>Nomor / Judul</th>
              <th style={th}>Jenis</th>
              <th style={th}>Rekening tujuan</th>
              <th style={{ ...th, textAlign: 'right' }}>Nominal disetujui</th>
              <th style={th}>Flag terbuka</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <React.Fragment key={r.id}>
                <tr>
                  <td style={td}>{r.neededDate ?? '—'}</td>
                  <td style={td}>
                    {docLink(r.id, r.docNo ?? `#${r.id}`)}
                    <div>{r.title}</div>
                    <div style={{ fontSize: 12 }}>{r.scope}</div>
                  </td>
                  <td style={td}>{r.statusLabel}</td>
                  <td style={td}>{r.bank ? `${r.bank.bankName ?? ''} · ${r.bank.accountHolder ?? ''} · ${r.bank.accountNo ?? ''}` : '—'}</td>
                  <td style={num}>{rp(r.approvedAmount)}</td>
                  <td style={td}>{r.flags.warning + r.flags.info > 0 ? <span style={badge(r.flags.warning ? 'warn' : 'muted')}>{r.flags.warning + r.flags.info}</span> : '—'}</td>
                </tr>
                {canTransfer ? (
                  <tr>
                    <td style={td} />
                    <td style={td} colSpan={5}>
                      {mine.has(r.id) ? (
                        // ADR 0013 O-2: allowed (audited), but made visible before the money moves.
                        <div role="note" data-pk-self-approved={r.id} style={{ margin: '0 0 6px', padding: '6px 8px', borderLeft: '3px solid var(--pk-tone-warn)', background: 'var(--theme-elevation-50)', fontSize: 13 }}>
                          <span style={badge('warn')}>Perhatian</span> <strong>Anda juga yang menyetujui</strong> pengajuan ini. Bila ada Finance lain, sebaiknya transfer dicatat oleh orang lain (pemisahan tugas).
                        </div>
                      ) : null}
                      <MoneyForm
                        url={`/api/v1/expense-requests/${r.id}/transfer`}
                        submitLabel="Catat transfer"
                        cashAccounts={accounts}
                        bankRef="required"
                        proof={{ kind: 'transfer-proofs', required: true }}
                        amountText={`Transfer ${rp(r.approvedAmount)}`}
                      />
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
      <style>{KAS_STYLE}</style>
      {/* E2 (US-24, T8): recorded transfers that can still be voided (request "Sudah Ditransfer"). */}
      <h2 id="transfer-tercatat" style={{ marginTop: 32 }}>
        Transfer tercatat — dapat dibatalkan ({done.length})
      </h2>
      <p style={{ fontSize: 13, color: 'var(--pk-muted-fg)', margin: '0 0 8px' }}>
        Void transfer membuat jurnal balik untuk KK-nya (KK asli tetap tampil sebagai Void) dan mengembalikan pengajuan ke antrian: Uang Muka → Disetujui, Reimburse → Nota
        Terverifikasi.
      </p>
      {done.length === 0 ? (
        <Empty text="Tidak ada transfer yang bisa dibatalkan." />
      ) : (
        <table style={table} data-pk-table="voidable-transfers">
          <thead>
            <tr>
              <th style={th}>Tanggal</th>
              <th style={th}>Transfer</th>
              <th style={th}>Pengajuan</th>
              <th style={{ ...th, textAlign: 'right' }}>Nominal</th>
              {canTransfer ? <th style={th}>Aksi</th> : null}
            </tr>
          </thead>
          <tbody>
            {done.map((t) => (
              <tr key={t.transferId} data-pk-transfer={t.transferNo}>
                <td style={td}>{t.transferDate}</td>
                <td style={td}>{t.transferNo}</td>
                <td style={td}>
                  {docLink(t.requestId, t.requestNo ?? `#${t.requestId}`)}
                  <div>{t.requestTitle}</div>
                  <div style={{ fontSize: 12 }}>{t.requestType === 'advance' ? 'Uang Muka' : 'Reimburse'}</div>
                </td>
                <td style={num}>{rp(t.amount)}</td>
                {canTransfer ? (
                  <td style={td}>
                    <ReasonAction
                      url={`/api/v1/expense-requests/${t.requestId}/transfers/${t.transferId}/void`}
                      label="Void transfer"
                      title={`Void transfer ${t.transferNo}?`}
                      description={
                        <>
                          KK transfer ini dibalik dengan jurnal balik (saldo akun kembali), transfer ditandai Void, dan pengajuan {t.requestNo ?? ''} kembali ke{' '}
                          <strong>{t.requestType === 'advance' ? 'Disetujui (Antri Transfer)' : 'Nota Terverifikasi (Antri Transfer)'}</strong> untuk ditransfer ulang.
                        </>
                      }
                      confirmLabel="Void transfer"
                      testId={`void-transfer-${t.transferId}`}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  )
}

export default TransferQueue
