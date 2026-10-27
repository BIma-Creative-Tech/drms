import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { hasRole, relId } from '@/access/roles'
import { voidableTransfers } from '@/domain/cash/book'
import { NO_APPROVAL_NOTE, PRINCIPAL_NO_APPROVAL_NOTE } from '@/domain/expense/decision'
import { transferQueue } from '@/domain/expense/queues'
import { approvedByCaller } from '@/domain/expense/transfers'
import { REQUEST_TYPE_LABELS, REQUEST_TYPES } from '@/domain/expense/types'
import { withReqTransaction } from '@/lib/system-tx'

import { docHref } from '../doc-links'
import { DocSummaryProvider } from '../components/feedback/DocContext'
import { ReasonAction } from '../components/kas/ReasonAction'
import { KAS_STYLE } from '../components/kas/style'
import { ListToolbar, Pager } from '../components/list/ListToolbar'
import { allowedValues, idValues, matchesQuery, paginate, parseListQuery } from '../list-query'
import { ClickableRow } from '../components/list/ClickableRow'
import { MoneyForm } from '../components/MoneyForm'
import { ReimburseReceiptReview, loadReimburseReview } from '../components/ReimburseReceiptReview'
import { SlaAgeBadge } from '../components/SlaAgeBadge'
import { Panel } from '../components/ui/nexus'
import { accountsOf, itemCompany, PtChip, PtScopeNote, ptView } from './pt'
import { IcLoanQueueSection } from './IntercompanyLoans'
import { LoanTransferOrderSection } from './Loans'
import { Badge, Empty, Forbidden, NX_TABLE, Shell, TableScroll, allowed, docLink, rp } from './shared'

/**
 * "Antrian Transfer" (M05, US-19/US-20): Pengajuan Baru "Disetujui (Antri Transfer)" and Reimburse
 * "Nota Terverifikasi (Antri Transfer)", sorted by needed date, open flags shown. Finance records
 * the transfer (cash account, bank reference, proof); the amount is the approved amount (G3).
 * DRMS 24/10 #11/#12: + "Transfer pinjaman antar project" (approved loans / repayment requests of inter-project loans).
 * DRMS 24/10: the transfer / cancel / void popups name the request (number, title, account, amount).
 */
export async function TransferQueue(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!allowed(req, ['pk-finance', 'pk-owner'])) return <Forbidden props={props} title="Antrian Transfer" roles={['pk-finance', 'pk-owner']} />
  const pt = await ptView(req)
  // DRMS 10/10 D8: search / PT / jenis + pagination of both tables (URL state; `hal2` = recorded transfers)
  // DRMS 13/10 Umum #4: PT and jenis are multi-select (`?pt=1,3&jenis=advance,reimburse`); PTs ⊆ the selection
  const lq = parseListQuery(props.searchParams, ['pt', 'jenis'])
  const ptIds = pt.multi ? idValues(lq, 'pt').filter((id) => pt.selected.includes(id)) : []
  const jenis = allowedValues(lq, 'jenis', REQUEST_TYPES)
  const { all, page, items, review, done, donePage, mine } = await withReqTransaction(req, async () => {
    const q = await transferQueue(req, ptIds.length ? { companyIds: ptIds } : undefined)
    const page = paginate(
      q.filter((r) => (!jenis.length || jenis.includes(r.type as (typeof jenis)[number])) && matchesQuery([r.docNo, r.title, r.scope, r.statusLabel, r.bank?.bankName, r.bank?.accountHolder], lq.q)),
      lq.page,
      lq.per,
    )
    const doneAll = (await voidableTransfers(req)).filter(
      (t) => (!ptIds.length || (t.companyId !== null && ptIds.includes(t.companyId))) && (!jenis.length || jenis.includes(t.requestType as (typeof jenis)[number])) && matchesQuery([t.transferNo, t.requestNo, t.requestTitle], lq.q),
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
      <Panel id="siap-transfer" icon="tMoneySend" title={`Siap ditransfer (${page.total})`} data-pk-queue="requests">
      <ListToolbar
        id="antrian-transfer"
        action="/admin/antrian-transfer"
        query={lq}
        label="Cari dan saring antrian transfer"
        search={{ placeholder: 'Nomor, judul, pemilik rekening…' }}
        filters={[
          pt.multi ? { key: 'pt', label: 'PT', all: 'Semua PT', multi: true, options: pt.selected.map((id) => ({ value: String(id), label: pt.ref(id)?.shortCode ?? `#${id}` })) } : null,
          { key: 'jenis', label: 'Jenis', multi: true, options: REQUEST_TYPES.map((t) => ({ value: t, label: REQUEST_TYPE_LABELS[t] })) },
        ]}
      />
      {items.length === 0 ? (
        <Empty text={all === 0 ? 'Antrian transfer kosong.' : 'Tidak ada pengajuan yang cocok dengan pencarian / filter.'} />
      ) : (
        // Wide (6 columns + the transfer form): stacked cards ≤ 640px (custom.scss .pk-rtable), one
        // <tbody> per item so the item row and its form stay one card; a plain table on wider screens.
        // Full width (unlike the other custom tables): the transfer form row below each item needs the room.
        <table className={`${NX_TABLE} is-full pk-rtable`} data-pk-table="transfer-queue">
          <thead>
            <tr>
              {pt.multi ? <th>PT</th> : null}
              <th>Dibutuhkan</th>
              <th>Nomor / Judul</th>
              <th>Jenis</th>
              <th>Rekening tujuan</th>
              <th className="n">Nominal disetujui</th>
              <th>Flag terbuka</th>
            </tr>
          </thead>
          {items.map((r) => (
            <tbody key={r.id} data-pk-queue-item={r.id}>
              {/* DRMS 13/10 Umum #7: the item row opens the request; the transfer form row below stays a plain row */}
              <ClickableRow href={`/admin/collections/expense-requests/${r.id}`}>
                {pt.multi ? (
                  <td data-label="PT">
                    <PtChip pt={pt.ref(itemCompany(r))} />
                  </td>
                ) : null}
                <td data-label="Dibutuhkan">
                  {r.neededDate ?? '—'}
                  {/* item 11: age since the final approval vs the PT's transfer SLA */}
                  <div className="pk-nx-chips">
                    <SlaAgeBadge sla={r.sla} />
                  </div>
                </td>
                <td data-label="Nomor / Judul" data-span="full" data-primary>
                  <span className="pk-nx-strong">{docLink(r.id, r.docNo ?? `#${r.id}`)}</span>
                  <div>{r.title}</div>
                  <span className="pk-nx-sub">{r.scope}</span>
                  {/* ADR 0031: the project's Pusat Biaya (cash account) — default source of the transfer */}
                  <span className="pk-nx-sub" data-tone={r.pusatBiayaMissing ? 'warn' : undefined} data-pk-queue-cost-center={r.id}>
                    Pusat biaya: {r.pusatBiaya ? r.pusatBiaya.name : r.pusatBiayaMissing ? 'project belum dipetakan' : 'dipilih Finance (tanpa project)'}
                  </span>
                </td>
                <td data-label="Jenis">
                  {r.statusLabel}
                  {/* ADR 0024 / 0026: a Direktur's (legacy) / the Owner's own request reached the queue without any approval — Finance is the only check */}
                  {r.noApproval ? (
                    <div className="pk-nx-chips">
                      <Badge tone="warn" data-pk-queue-no-approval={r.id} title={r.noApprovalBy === 'owner' ? PRINCIPAL_NO_APPROVAL_NOTE : NO_APPROVAL_NOTE}>
                        Tanpa persetujuan ({r.noApprovalBy === 'owner' ? 'Owner' : 'Direktur'})
                      </Badge>
                    </div>
                  ) : null}
                  {/* ADR 0027: vendor payment — paid to the vendor's account, done with this transfer (no LPJ) */}
                  {r.payeeType === 'vendor' ? (
                    <div className="pk-nx-chips">
                      <Badge tone="muted" data-pk-queue-vendor={r.id} title="Pembayaran vendor: selesai setelah transfer (invoice = bukti, tanpa LPJ)">
                        Pembayaran vendor{r.vendorName ? `: ${r.vendorName}` : ''}
                      </Badge>
                    </div>
                  ) : null}
                  {/* ADR 0028: payment to another PT of the group — its Kas Masuk is posted with this transfer (no LPJ) */}
                  {r.payeeType === 'pt_grup' ? (
                    <div className="pk-nx-chips">
                      <Badge tone="muted" data-pk-queue-intercompany={r.id} title="Pembayaran antar-PT: selesai setelah transfer; kas masuk di PT penerima tercatat otomatis (periode PT penerima harus terbuka)">
                        Antar PT{r.payeeCompany ? `: ${r.payeeCompany.shortCode}` : ''}
                      </Badge>
                    </div>
                  ) : null}
                </td>
                <td className="pk-nx-wrap" data-label="Rekening tujuan" data-span="full">
                  {r.bank ? `${r.bank.bankName ?? ''} · ${r.bank.accountHolder ?? ''} · ${r.bank.accountNo ?? ''}` : '—'}
                  {/* QA-17: verification state of the employee account; unverified → the transfer asks for a confirmation */}
                  <div className="pk-nx-chips">
                    <Badge tone={r.bankVerification === 'verified' ? 'ok' : 'warn'} data-pk-bank-verification={r.bankVerification}>
                      {r.payeeType === 'pt_grup' ? 'Rekening penerimaan antar-PT' : r.bankVerification === 'verified' ? 'Terverifikasi' : 'Belum diverifikasi'}
                    </Badge>
                  </div>
                </td>
                <td className="n" data-label="Nominal disetujui">
                  {rp(r.approvedAmount)}
                </td>
                <td data-label="Flag terbuka">
                  {r.flags.warning + r.flags.info > 0 ? <Badge tone={r.flags.warning ? 'warn' : 'muted'}>{r.flags.warning + r.flags.info}</Badge> : r.flags.receiptMismatch ? null : '—'}
                  {/* D3 (DRMS 10/10): lines whose "Nominal sesuai nota" ≠ total — awareness before the money moves */}
                  {r.flags.receiptMismatch ? (
                    <div className="pk-nx-chips">
                      <a href={`${docHref('expense_request', r.id) ?? '#'}#review`} className="pk-nx-badge-link">
                        <Badge tone="warn" data-pk-queue-mismatch={r.id} title="Nominal sesuai nota berbeda dari total baris — lihat rincian pengajuan">
                          Selisih nota ({r.flags.receiptMismatch})
                        </Badge>
                      </a>
                    </div>
                  ) : null}
                </td>
              </ClickableRow>
              {canTransfer && hasRole(req, 'pk-finance', itemCompany(r)) ? (
                <tr className="pk-nx-subrow">
                  <td />
                  <td colSpan={pt.multi ? 6 : 5}>
                    {mine.has(r.id) ? (
                      // ADR 0013 O-2: allowed (audited), but made visible before the money moves.
                      <div role="note" className="pk-nx-callout" data-tone="warn" data-pk-self-approved={r.id}>
                        <Badge tone="warn">Perhatian</Badge> <strong>Anda juga yang menyetujui</strong> pengajuan ini. Bila ada Finance lain, sebaiknya transfer dicatat oleh orang lain (pemisahan tugas).
                      </div>
                    ) : null}
                    <DocSummaryProvider {...queueDoc(r)}>
                      <MoneyForm
                        url={`/api/v1/expense-requests/${r.id}/transfer`}
                        submitLabel="Catat transfer"
                        cashAccounts={accountsOf(accounts, itemCompany(r))}
                        bankRef="required"
                        proof={{ kind: 'transfer-proofs', required: true }}
                        amountText={`Transfer ${rp(r.approvedAmount)}`}
                        pusatBiaya={r.pusatBiaya}
                        pusatBiayaMissing={r.pusatBiayaMissing}
                      />
                    </DocSummaryProvider>
                    {/* D1810: Finance cancels an approved request instead of transferring it (e.g. the amount really approved in
                        the field differs) — reason mandatory, the server re-checks role + status (state.ts `cancel`). */}
                    <div className="pk-nx-gap" data-pk-queue-cancel={r.id}>
                      <ReasonAction
                        url={`/api/v1/expense-requests/${r.id}/cancel`}
                        label="Batalkan pengajuan"
                        title={`Batalkan pengajuan ${r.docNo ?? ''}?`}
                        description={
                          <>
                            Nominal disetujui di sistem: <strong>{rp(r.approvedAmount)}</strong>. Pengajuan dibatalkan (tidak dihapus), keluar dari antrian transfer, dan pemohon
                            mendapat notifikasi. Bila nominal yang di-ACC di lapangan berbeda, pemohon mengajukan ulang (Duplikat) dengan nominal yang benar.
                          </>
                        }
                        fieldLabel="Alasan pembatalan"
                        confirmLabel="Batalkan pengajuan"
                        summary={queueDoc(r).summary}
                        variant="secondary"
                        testId={`cancel-request-${r.id}`}
                      />
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          ))}
        </table>
      )}
      {items.length > 0 ? <Pager id="antrian-transfer" path="/admin/antrian-transfer" sp={props.searchParams} page={page} unit="pengajuan" /> : null}
      </Panel>
      <style>{KAS_STYLE}</style>
      {/* DRMS 24/10 #11/#12: transfer orders of inter-project loans (disbursements + repayments approved by the Owner) */}
      <LoanTransferOrderSection req={req} companyIds={ptIds.length ? ptIds : undefined} />
      {/* ADR 0029 §3.5: "Pencairan pinjaman antar-PT" — instructed loans whose lender is a PT where the caller is Finance */}
      <IcLoanQueueSection req={req} />
      {/* E2 (US-24, T8): recorded transfers that can still be voided (request "Sudah Ditransfer"). */}
      <Panel id="transfer-tercatat" icon="tCardSend" title={`Transfer tercatat — dapat dibatalkan (${donePage.total})`}>
      <p className="pk-nx-lead">
        Void transfer membuat jurnal balik untuk KK-nya (KK asli tetap tampil sebagai Void) dan mengembalikan pengajuan ke antrian: Pengajuan Baru → Disetujui, Reimburse → Nota
        Terverifikasi.
      </p>
      {done.length === 0 ? (
        <Empty text="Tidak ada transfer yang bisa dibatalkan." />
      ) : (
        <TableScroll label="Transfer tercatat">
          <table className={NX_TABLE} data-pk-table="voidable-transfers">
            <thead>
              <tr>
                {pt.multi ? <th>PT</th> : null}
                <th>Tanggal</th>
                <th>Transfer</th>
                <th>Pengajuan</th>
                <th className="n">Nominal</th>
                {canTransfer ? <th>Aksi</th> : null}
              </tr>
            </thead>
            <tbody>
              {done.map((t) => (
                <ClickableRow key={t.transferId} href={docHref('transfer', t.transferId)!} data-pk-transfer={t.transferNo}>
                  {pt.multi ? (
                    <td>
                      <PtChip pt={pt.ref(t.companyId)} />
                    </td>
                  ) : null}
                  <td>{t.transferDate}</td>
                  <td>
                    <a href={docHref('transfer', t.transferId)!}>{t.transferNo}</a>
                  </td>
                  <td>
                    {docLink(t.requestId, t.requestNo ?? `#${t.requestId}`)}
                    <div>{t.requestTitle}</div>
                    <span className="pk-nx-sub">{REQUEST_TYPE_LABELS[t.requestType as keyof typeof REQUEST_TYPE_LABELS] ?? t.requestType}</span>
                  </td>
                  <td className="n">{rp(t.amount)}</td>
                  {canTransfer ? (
                    <td>
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
                        summary={[['Transfer', t.transferNo], ['Tanggal', t.transferDate], ['Pengajuan', t.requestNo ?? `#${t.requestId}`], ['Judul', t.requestTitle], ['Nominal', rp(t.amount)]]}
                        testId={`void-transfer-${t.transferId}`}
                      />
                      ) : (
                        <span className="pk-nx-sub">Void: Finance PT ini</span>
                      )}
                    </td>
                  ) : null}
                </ClickableRow>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {done.length > 0 ? <Pager id="transfer-tercatat" path="/admin/antrian-transfer" sp={props.searchParams} page={donePage} pageKey="hal2" unit="transfer" /> : null}
      </Panel>
    </Shell>
  )
}

type QueueItem = Awaited<ReturnType<typeof transferQueue>>[number]

/** DRMS 24/10: the queue item as named in the popups (transfer, cancel). */
function queueDoc(r: QueueItem) {
  const docNo = r.docNo ?? `#${r.id}`
  return {
    object: docNo,
    summary: [
      ['Pengajuan', docNo],
      ['Judul', r.title],
      ['Lingkup', r.scope],
      ['Rekening tujuan', r.bank ? [r.bank.bankName, r.bank.accountHolder, r.bank.accountNo].filter(Boolean).join(' · ') : null],
      ['Nominal disetujui', rp(r.approvedAmount)],
    ] as const,
  }
}

export default TransferQueue
