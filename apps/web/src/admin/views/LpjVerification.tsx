import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { relId } from '@/access/roles'
import { detail } from '@/domain/expense/dto'
import { officeQueueWhere } from '@/domain/expense/queues'
import { SETTLEMENT_TYPE_LABELS } from '@/domain/expense/settlement-rules'
import { withReqTransaction } from '@/lib/system-tx'

import { docHref } from '../doc-links'
import { ActionButton } from '../components/ActionButton'
import { KAS_STYLE } from '../components/kas/style'
import { ListToolbar, Pager } from '../components/list/ListToolbar'
import { MoneyForm } from '../components/MoneyForm'
import { ShortfallPanel } from '../components/ShortfallPanel'
import { LpjPhotoGrid } from '../components/lpj/LpjPhotoGrid'
import { pageOfFind, parseListQuery, searchWhere } from '../list-query'
import { accountsOf, PtChip, PtScopeNote, ptView } from './pt'
import { Empty, Forbidden, Shell, TableScroll, allowed, badge, docLink, num, rp, table, td, th } from './shared'

type Detail = Awaited<ReturnType<typeof detail>>

/**
 * "Verifikasi LPJ" (M06, US-21/US-22): Pengajuan Baru in "LPJ Diajukan" — per receipt valid / tolak,
 * revision request with a note, verification (verified total = Σ valid receipts) — and in
 * "LPJ Terverifikasi" the settlement: surplus → KM "Pengembalian LPJ", shortfall → transfer.
 * Owner sees the queue read-only; Finance acts (never on its own request, server-enforced).
 */
export async function LpjVerification(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!allowed(req, ['pk-finance', 'pk-owner'])) return <Forbidden props={props} title="Verifikasi LPJ" roles={['pk-finance', 'pk-owner']} />
  const finance = allowed(req, ['pk-finance'])
  const pt = await ptView(req)
  // DRMS 10/10 D8: search (nomor / judul) + PT / tahap filters, paged in the database (URL state)
  const lq = parseListQuery(props.searchParams, ['pt', 'tahap'])
  const ptId = pt.multi && pt.selected.includes(Number(lq.filters.pt)) ? Number(lq.filters.pt) : undefined
  const statuses = lq.filters.tahap === 'lpj_submitted' || lq.filters.tahap === 'lpj_verified' ? [lq.filters.tahap] : ['lpj_submitted', 'lpj_verified']
  const text = searchWhere(['docNo', 'title'], lq.q)
  const { submitted, verified, accounts, companyOf, page } = await withReqTransaction(req, async () => {
    const res = await req.payload.find({
      collection: 'expense-requests',
      // MC2: PTs where the caller is Finance / Direktur only (mc2-contract §3)
      where: officeQueueWhere(req, { and: [{ type: { equals: 'advance' } }, { status: { in: statuses } }, ...(text ? [text as never] : [])] }, ptId ? { companyIds: [ptId] } : undefined),
      sort: 'updatedAt',
      limit: lq.per,
      page: lq.page,
      depth: 0,
      user: req.user,
      overrideAccess: false,
      req,
    })
    const all: Detail[] = []
    for (const d of res.docs) all.push(await detail(req, d.id as number))
    // MC2-4: PT per request (settlement forms offer only cash accounts of that PT)
    const companyOf = new Map(res.docs.map((d) => [d.id as number, relId((d as { company?: unknown }).company) ?? null]))
    const acc = finance
      ? (await req.payload.find({ collection: 'cash-accounts', where: { active: { not_equals: false } }, depth: 0, pagination: false, sort: 'name', select: { name: true, company: true }, user: req.user, overrideAccess: false, req })).docs.map((a) => ({
          id: a.id as number,
          name: a.name as string,
          company: relId((a as { company?: unknown }).company) ?? null,
        }))
      : []
    return { submitted: all.filter((d) => d.status === 'lpj_submitted'), verified: all.filter((d) => d.status === 'lpj_verified'), accounts: acc, companyOf, page: pageOfFind(res) }
  })
  const base = (id: number) => `/api/v1/expense-requests/${id}`
  return (
    <Shell props={props} title={`Verifikasi LPJ (${page.total})`}>
      <PtScopeNote pt={pt} />
      <ListToolbar
        id="verifikasi-lpj"
        action="/admin/verifikasi-lpj"
        query={lq}
        label="Cari dan saring LPJ"
        search={{ placeholder: 'Nomor atau judul pengajuan…' }}
        filters={[
          pt.multi ? { key: 'pt', label: 'PT', all: 'Semua PT', options: pt.selected.map((id) => ({ value: String(id), label: pt.ref(id)?.shortCode ?? `#${id}` })) } : null,
          { key: 'tahap', label: 'Tahap', options: [{ value: 'lpj_submitted', label: 'LPJ diajukan' }, { value: 'lpj_verified', label: 'Menunggu penyelesaian selisih' }] },
        ]}
      />
      <h2>LPJ diajukan ({submitted.length})</h2>
      {submitted.length === 0 ? <Empty text="Tidak ada LPJ yang menunggu verifikasi." /> : null}
      {submitted.map((d) => (
        <section key={d.id} style={{ border: '1px solid var(--theme-elevation-150)', borderRadius: 4, padding: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              {pt.multi ? (
                <>
                  <PtChip pt={pt.ref(companyOf.get(d.id))} />{' '}
                </>
              ) : null}
              <strong>{docLink(d.id, d.docNo ?? `#${d.id}`)}</strong> — {d.title} · LPJ {d.settlement ? <a href={docHref('settlement', d.settlement.id)!}>{d.settlement.docNo ?? `#${d.settlement.id}`}</a> : ''} · kiriman ke-{d.settlement?.submitCount ?? 1}
              <div style={{ fontSize: 12 }}>Uraian penggunaan: {d.settlement?.usageNotes ?? '—'}</div>
              {/* point 13: LPJ photos of the requester (lightbox) */}
              {d.settlement?.photos.length ? <LpjPhotoGrid ids={d.settlement.photos} group={`lpj-photos-${d.id}`} label={`Foto LPJ ${d.settlement.docNo ?? ''}`.trim()} /> : null}
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
          <div className="pk-lwide">
          <TableScroll label="Nota LPJ">
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
                          <a href={`/api/v1/media/receipts/${r.imageId}/file`} target="_blank" rel="noopener noreferrer" data-pk-lightbox={`lpj-${d.id}`} data-pk-lightbox-title={`Nota ${r.receiptNo ?? r.id} · ${rp(r.amount)}`}>
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
          </TableScroll>
          </div>
          {/* Phase C polish: at ≤ 640 px every receipt is a card like the request line cards (LineCard, APK layout) */}
          <div className="pk-lcards" data-pk-lpj-cards={d.id}>
            {d.receipts
              .filter((r) => r.status !== 'removed')
              .map((r) => (
                <article key={r.id} className="pk-lcard" data-pk-lpj-receipt={r.id}>
                  <div className="pk-lcard__head">
                    <span className="pk-lcard__title">
                      {r.vendorName}
                      {r.lineNo ? <span style={{ fontWeight: 400, color: 'var(--pk-muted-fg)' }}> · baris {r.lineNo}</span> : null}
                    </span>
                    <span className="pk-lcard__total">{rp(r.amount)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 4 }}>
                    {r.imageId ? (
                      <a href={`/api/v1/media/receipts/${r.imageId}/file`} target="_blank" rel="noopener noreferrer" data-pk-lightbox={`lpj-${d.id}`} data-pk-lightbox-title={`Nota ${r.receiptNo ?? r.id} · ${rp(r.amount)}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API file, not a static asset */}
                        <img src={`/api/v1/media/receipts/${r.imageId}/file?variant=thumb`} alt={`Nota ${r.receiptNo ?? r.id}`} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4 }} />
                      </a>
                    ) : null}
                    <div style={{ minWidth: 0 }}>
                      <div className="pk-lcard__meta">
                        No. {r.receiptNo ?? '—'} · {r.receiptDate}
                      </div>
                      <div className="pk-lcard__chips" style={{ marginTop: 4 }}>
                        <span style={badge(r.status === 'valid' ? 'ok' : r.status === 'rejected' ? 'bad' : 'muted')}>{r.status === 'valid' ? 'valid' : r.status === 'rejected' ? 'ditolak' : 'menunggu'}</span>
                      </div>
                    </div>
                  </div>
                  {finance && d.allowedActions.includes('receipt_verify') ? (
                    <div className="pk-lcard__actions">
                      {r.status !== 'valid' ? <ActionButton url={`${base(d.id)}/receipts/${r.id}/verify`} label="Valid" /> : null}
                      {r.status !== 'rejected' ? <ActionButton url={`${base(d.id)}/receipts/${r.id}/reject`} label="Tolak" prompt={{ field: 'reason', message: 'Alasan nota ditolak (wajib):', minLength: 3 }} /> : null}
                    </div>
                  ) : null}
                </article>
              ))}
          </div>
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
              {pt.multi ? (
                <>
                  <PtChip pt={pt.ref(companyOf.get(d.id))} />{' '}
                </>
              ) : null}
              <strong>{docLink(d.id, d.docNo ?? `#${d.id}`)}</strong> — {d.title} · LPJ <a href={docHref('settlement', s.id)!}>{s.docNo ?? `#${s.id}`}</a>
            </div>
            {s.photos.length ? <LpjPhotoGrid ids={s.photos} group={`lpj-photos-${d.id}`} label={`Foto LPJ ${s.docNo ?? ''}`.trim()} size={56} /> : null}
            <div style={{ margin: '6px 0' }}>
              Ditransfer {rp(s.transferredTotal)} · Nota terverifikasi {rp(s.verifiedReceiptsTotal)} · Selisih {rp(s.difference)} —{' '}
              <strong>{s.settlementType ? SETTLEMENT_TYPE_LABELS[s.settlementType] : '—'}</strong>
            </div>
            {/* QA-06 / ADR 0019: above approved + tolerance → re-approval first (Finance asks; Direktur → Finance decide) */}
            {s.settlementType === 'shortfall' && s.shortfallApproval && s.shortfallApproval.settleAllowed === false ? (
              <ShortfallPanel requestId={d.id} sa={s.shortfallApproval} canRequest={finance && d.allowedActions.includes('settle')} />
            ) : finance && d.allowedActions.includes('settle') ? (
              s.settlementType === 'shortfall' ? (
                <MoneyForm
                  url={`${base(d.id)}/settle`}
                  submitLabel="Transfer kekurangan & selesaikan"
                  cashAccounts={accountsOf(accounts, companyOf.get(d.id) ?? null)}
                  bankRef="required"
                  proof={{ kind: 'transfer-proofs', required: true }}
                  amountText={`Transfer ${rp(amount)} ke ${d.bank?.bankName ?? ''} ${d.bank?.accountNo ?? ''}`}
                />
              ) : (
                <MoneyForm
                  url={`${base(d.id)}/settle`}
                  submitLabel="Catat pengembalian & selesaikan"
                  cashAccounts={accountsOf(accounts, companyOf.get(d.id) ?? null)}
                  bankRef="none"
                  proof={{ kind: 'attachments', required: false }}
                  amountText={`Kas masuk ${rp(amount)} (Pengembalian LPJ)`}
                  precheckUrl={`${base(d.id)}/settle/precheck`}
                />
              )
            ) : null}
          </section>
        )
      })}
      <style>{KAS_STYLE}</style>
      <Pager id="verifikasi-lpj" path="/admin/verifikasi-lpj" sp={props.searchParams} page={page} unit="LPJ" />
    </Shell>
  )
}

export default LpjVerification
