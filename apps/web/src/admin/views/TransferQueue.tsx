import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { hasRole, relId } from '@/access/roles'
import { voidableTransfers } from '@/domain/cash/book'
import { transferQueue } from '@/domain/expense/queues'
import { approvedByCaller } from '@/domain/expense/transfers'
import { REQUEST_TYPE_LABELS, REQUEST_TYPES } from '@/domain/expense/types'
import { withReqTransaction } from '@/lib/system-tx'

import { ReasonAction } from '../components/kas/ReasonAction'
import { KAS_STYLE } from '../components/kas/style'
import { ListToolbar, Pager } from '../components/list/ListToolbar'
import { matchesQuery, paginate, parseListQuery } from '../list-query'
import { MoneyForm } from '../components/MoneyForm'
import { ReimburseReceiptReview, loadReimburseReview } from '../components/ReimburseReceiptReview'
import { accountsOf, itemCompany, PtChip, PtScopeNote, ptView } from './pt'
import { Empty, Forbidden, Shell, TableScroll, allowed, badge, docLink, num, rp, table, td, th } from './shared'

/**
 * "Antrian Transfer" (M05, US-19/US-20): Uang Muka "Disetujui (Antri Transfer)" and Reimburse
 * "Nota Terverifikasi (Antri Transfer)", sorted by needed date, open flags shown. Finance records
 * the transfer (cash account, bank reference, proof); the amount is the approved amount (G3).
 */
export async function TransferQueue(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!allowed(req, ['pk-finance', 'pk-owner'])) return <Forbidden props={props} title="Antrian Transfer" roles={['pk-finance', 'pk-owner']} />
  const pt = await ptView(req)
  // DRMS 10/10 D8: search / PT / jenis + pagination of both tables (URL state; `hal2` = recorded transfers)
  const lq = parseListQuery(props.searchParams, ['pt', 'jenis'])
  const ptId = pt.multi && pt.selected.includes(Number(lq.filters.pt)) ? Number(lq.filters.pt) : undefined
  const { all, page, items, review, done, donePage, mine } = await withReqTransaction(req, async () => {
    const q = await transferQueue(req, ptId ? { companyIds: [ptId] } : undefined)
    const page = paginate(
      q.filter((r) => (!lq.filters.jenis || r.type === lq.filters.jenis) && matchesQuery([r.docNo, r.title, r.scope, r.statusLabel, r.bank?.bankName, r.bank?.accountHolder], lq.q)),
      lq.page,
      lq.per,
    )
    const doneAll = (await voidableTransfers(req)).filter(
      (t) => (!ptId || t.companyId === ptId) && (!lq.filters.jenis || t.requestType === lq.filters.jenis) && matchesQuery([t.transferNo, t.requestNo, t.requestTitle], lq.q),
    )
    const donePage = paginate(doneAll, parseListQuery(props.searchParams, [], { pageKey: 'hal2' }).page, lq.per)
    // MC2: every queue item carries its PT (`company`, mc2-contract §3) — it also picks the cash
    // accounts offered in each transfer form (never an account of another PT).
    return { all: q.length, page, items: page.items, review: await loadReimburseReview(req), done: donePage.items, donePage, mine: await approvedByCaller(req, page.items.map((x) => x.id)) }
  })
  const canTransfer = allowed(req, ['pk-finance'])
  const accounts = canTransfer
    ? (
        await req.payload.find({ collection: 'cash-accounts', where: { active: { not_equals: false } }, depth: 0, pagination: false, sort: 'name', select: { name: true, company: true }, user: req.user, overrideAccess: false, req })
      ).docs.map((a) => ({ id: a.id as number, name: a.name as string, company: relId((a as { company?: unknown }).company) ?? null }))
    : []
  return (
    <Shell props={props} title={`Antrian Transfer (${all})`}>
      <PtScopeNote pt={pt} />
      <ReimburseReceiptReview data={review} />
      <h2>Siap ditransfer ({page.total})</h2>
      <ListToolbar
        id="antrian-transfer"
        action="/admin/antrian-transfer"
        query={lq}
        label="Cari dan saring antrian transfer"
        search={{ placeholder: 'Nomor, judul, pemilik rekening…' }}
        filters={[
          pt.multi ? { key: 'pt', label: 'PT', all: 'Semua PT', options: pt.selected.map((id) => ({ value: String(id), label: pt.ref(id)?.shortCode ?? `#${id}` })) } : null,
          { key: 'jenis', label: 'Jenis', options: REQUEST_TYPES.map((t) => ({ value: t, label: REQUEST_TYPE_LABELS[t] })) },
        ]}
      />
      {items.length === 0 ? (
        <Empty text={all === 0 ? 'Antrian transfer kosong.' : 'Tidak ada pengajuan yang cocok dengan pencarian / filter.'} />
      ) : (
        // Wide (6 columns + the transfer form): stacked cards ≤ 640px (custom.scss .pk-rtable), one
        // <tbody> per item so the item row and its form stay one card; a plain table on wider screens.
        <table style={table} className="pk-rtable" data-pk-table="transfer-queue">
          <thead>
            <tr>
              {pt.multi ? <th style={th}>PT</th> : null}
              <th style={th}>Dibutuhkan</th>
              <th style={th}>Nomor / Judul</th>
              <th style={th}>Jenis</th>
              <th style={th}>Rekening tujuan</th>
              <th style={{ ...th, textAlign: 'right' }}>Nominal disetujui</th>
              <th style={th}>Flag terbuka</th>
            </tr>
          </thead>
          {items.map((r) => (
            <tbody key={r.id} data-pk-queue-item={r.id}>
              <tr>
                {pt.multi ? (
                  <td style={td} data-label="PT">
                    <PtChip pt={pt.ref(itemCompany(r))} />
                  </td>
                ) : null}
                <td style={td} data-label="Dibutuhkan">
                  {r.neededDate ?? '—'}
                </td>
                <td style={td} data-label="Nomor / Judul" data-span="full" data-primary>
                  {docLink(r.id, r.docNo ?? `#${r.id}`)}
                  <div>{r.title}</div>
                  <div style={{ fontSize: 12 }}>{r.scope}</div>
                </td>
                <td style={td} data-label="Jenis">
                  {r.statusLabel}
                </td>
                <td style={{ ...td, overflowWrap: 'anywhere' }} data-label="Rekening tujuan" data-span="full">
                  {r.bank ? `${r.bank.bankName ?? ''} · ${r.bank.accountHolder ?? ''} · ${r.bank.accountNo ?? ''}` : '—'}
                  {/* QA-17: verification state of the employee account; unverified → the transfer asks for a confirmation */}
                  <div style={{ marginTop: 2 }}>
                    <span style={badge(r.bankVerification === 'verified' ? 'ok' : 'warn')} data-pk-bank-verification={r.bankVerification}>
                      {r.bankVerification === 'verified' ? 'Terverifikasi' : 'Belum diverifikasi'}
                    </span>
                  </div>
                </td>
                <td style={num} data-label="Nominal disetujui">
                  {rp(r.approvedAmount)}
                </td>
                <td style={td} data-label="Flag terbuka">
                  {r.flags.warning + r.flags.info > 0 ? <span style={badge(r.flags.warning ? 'warn' : 'muted')}>{r.flags.warning + r.flags.info}</span> : '—'}
                </td>
              </tr>
              {canTransfer && hasRole(req, 'pk-finance', itemCompany(r)) ? (
                <tr>
                  <td style={td} />
                  <td style={td} colSpan={pt.multi ? 6 : 5}>
                    {mine.has(r.id) ? (
                      // ADR 0013 O-2: allowed (audited), but made visible before the money moves.
                      <div role="note" data-pk-self-approved={r.id} style={{ margin: '0 0 6px', padding: '6px 8px', borderLeft: '3px solid var(--pk-tone-warn)', background: 'var(--theme-elevation-50)', fontSize: 13 }}>
                        <span style={badge('warn')}>Perhatian</span> <strong>Anda juga yang menyetujui</strong> pengajuan ini. Bila ada Finance lain, sebaiknya transfer dicatat oleh orang lain (pemisahan tugas).
                      </div>
                    ) : null}
                    <MoneyForm
                      url={`/api/v1/expense-requests/${r.id}/transfer`}
                      submitLabel="Catat transfer"
                      cashAccounts={accountsOf(accounts, itemCompany(r))}
                      bankRef="required"
                      proof={{ kind: 'transfer-proofs', required: true }}
                      amountText={`Transfer ${rp(r.approvedAmount)}`}
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          ))}
        </table>
      )}
      {items.length > 0 ? <Pager id="antrian-transfer" path="/admin/antrian-transfer" sp={props.searchParams} page={page} unit="pengajuan" /> : null}
      <style>{KAS_STYLE}</style>
      {/* E2 (US-24, T8): recorded transfers that can still be voided (request "Sudah Ditransfer"). */}
      <h2 id="transfer-tercatat" style={{ marginTop: 32 }}>
        Transfer tercatat — dapat dibatalkan ({donePage.total})
      </h2>
      <p style={{ fontSize: 13, color: 'var(--pk-muted-fg)', margin: '0 0 8px' }}>
        Void transfer membuat jurnal balik untuk KK-nya (KK asli tetap tampil sebagai Void) dan mengembalikan pengajuan ke antrian: Uang Muka → Disetujui, Reimburse → Nota
        Terverifikasi.
      </p>
      {done.length === 0 ? (
        <Empty text="Tidak ada transfer yang bisa dibatalkan." />
      ) : (
        <TableScroll label="Transfer tercatat">
          <table style={table} data-pk-table="voidable-transfers">
            <thead>
              <tr>
                {pt.multi ? <th style={th}>PT</th> : null}
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
                  {pt.multi ? (
                    <td style={td}>
                      <PtChip pt={pt.ref(t.companyId)} />
                    </td>
                  ) : null}
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
                      {hasRole(req, 'pk-finance', t.companyId) ? (
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
                      ) : (
                        <span style={{ fontSize: 12 }}>Void: Finance PT ini</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {done.length > 0 ? <Pager id="transfer-tercatat" path="/admin/antrian-transfer" sp={props.searchParams} page={donePage} pageKey="hal2" unit="transfer" /> : null}
    </Shell>
  )
}

export default TransferQueue
