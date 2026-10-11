import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { selfApprovalNote } from '@/domain/expense/decision'
import { detail } from '@/domain/expense/dto'
import { approvalInbox } from '@/domain/expense/queues'
import { REQUEST_TYPE_LABELS, REQUEST_TYPES } from '@/domain/expense/types'
import { withReqTransaction } from '@/lib/system-tx'

import { ActionButton } from '../components/ActionButton'
import { ListToolbar, Pager } from '../components/list/ListToolbar'
import { matchesQuery, paginate, parseListQuery } from '../list-query'
import { ReviewDetails } from '../components/ReviewDetails'
import { AddendumInboxSection } from './Addendum'
import { ShortfallInboxSection } from './ShortfallInbox'
import { itemCompany, PtChip, PtScopeNote, ptView } from './pt'
import { Empty, Shell, TableScroll, badge, docLink, num, rp, table, td, th } from './shared'

/**
 * "Persetujuan" (M04, US-26/US-42/US-59): requests waiting for the logged-in user's "Diketahui"
 * (ADR 0021: "Persetujuan PM" of the request's PM project; ADR 0013 snapshots: the Direktur's approval,
 * "Persetujuan Direktur (Diketahui)") or an approval level (ADR 0021: "Persetujuan Direktur") — only those the rule snapshot assigns to them (G2) and never their own (G1). Budget
 * impact % before → after (red above company-settings.budgetWarnPct, default 85 %; cost centers
 * "tanpa anggaran", Q-24) and open validation flags. Actions call /api/v1 (profile signature, US-43).
 * S3e (S-05): each row expands to the lines, receipt photos and per-line flags (ReviewDetails); the
 * "Flag" column counts OPEN flags of both levels — the same number stored with the decision.
 */
export async function ApprovalInbox(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const pt = await ptView(req)
  // DRMS 10/10 D8: search / PT / jenis / langkah + pagination (URL state); the inbox is a bounded worklist
  const lq = parseListQuery(props.searchParams, ['pt', 'jenis', 'langkah'])
  const ptId = pt.multi && pt.selected.includes(Number(lq.filters.pt)) ? Number(lq.filters.pt) : undefined
  const { all, page, budgetWarnPct, details } = await withReqTransaction(req, async () => {
    const inbox = await approvalInbox(req, ptId ? { companyIds: [ptId] } : undefined)
    const matched = inbox.items.filter(
      (r) => (!lq.filters.jenis || r.type === lq.filters.jenis) && (!lq.filters.langkah || r.step === lq.filters.langkah) && matchesQuery([r.docNo, r.title, r.scope, r.requesters, r.typeLabel, r.stepLabel], lq.q),
    )
    const page = paginate(matched, lq.page, lq.per)
    // S3e (US-26/US-59, S-05): lines, receipts and per-line flags for each waiting request (of this page).
    const map = new Map<number, Awaited<ReturnType<typeof detail>>>()
    for (const it of page.items) map.set(it.id, await detail(req, it.id))
    return { all: inbox.items.length, page, budgetWarnPct: inbox.budgetWarnPct, details: map }
  })
  const items = page.items
  const cols = pt.multi ? 10 : 9
  return (
    <Shell props={props} title="Persetujuan">
      <PtScopeNote pt={pt} />
      <p style={{ marginTop: 0 }}>
        Pengajuan yang menunggu keputusan Anda. Merah = anggaran project sesudah disetujui melebihi {pt.multi ? 'ambang PT pengajuan' : `${budgetWarnPct}%`}.{pt.multi ? ' Keputusan selalu memakai peran Anda di PT dokumen.' : ''}
      </p>
      {all > 0 || lq.q || ptId ? (
        <ListToolbar
          id="persetujuan"
          action="/admin/persetujuan"
          query={lq}
          label="Cari dan saring persetujuan"
          search={{ placeholder: 'Nomor, judul, pemohon, project…' }}
          filters={[
            pt.multi ? { key: 'pt', label: 'PT', all: 'Semua PT', options: pt.selected.map((id) => ({ value: String(id), label: pt.ref(id)?.shortCode ?? `#${id}` })) } : null,
            { key: 'jenis', label: 'Jenis', options: REQUEST_TYPES.map((t) => ({ value: t, label: REQUEST_TYPE_LABELS[t] })) },
            { key: 'langkah', label: 'Langkah', options: [{ value: 'acknowledge', label: 'Persetujuan pertama (PM / Diketahui)' }, { value: 'approve', label: 'Persetujuan berikutnya' }] },
          ]}
        />
      ) : null}
      {items.length === 0 ? (
        <Empty text={all === 0 ? 'Tidak ada pengajuan yang menunggu keputusan Anda.' : 'Tidak ada pengajuan yang cocok dengan pencarian / filter.'} />
      ) : (
        <TableScroll label="Daftar persetujuan">
          <table style={table}>
            <thead>
              <tr>
                {pt.multi ? <th style={th}>PT</th> : null}
                <th style={th}>Nomor / Judul</th>
                <th style={th}>Jenis</th>
                <th style={th}>Project / Pusat biaya</th>
                <th style={th}>Diajukan oleh</th>
                <th style={{ ...th, textAlign: 'right' }}>Grand total</th>
                <th style={th}>Dampak anggaran</th>
                <th style={th}>Flag</th>
                <th style={th}>Langkah</th>
                <th style={th}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <React.Fragment key={r.id}>
                <tr data-pk-inbox-item={r.id}>
                  {pt.multi ? (
                    <td style={td}>
                      <PtChip pt={pt.ref(itemCompany(r))} />
                    </td>
                  ) : null}
                  <td style={td}>
                    {docLink(r.id, r.docNo ?? `#${r.id}`)}
                    <div>{r.title}</div>
                  </td>
                  <td style={td}>{r.typeLabel}</td>
                  <td style={td}>{r.scope || '—'}</td>
                  <td style={td}>{r.requesters || '—'}</td>
                  <td style={num}>{rp(r.grandTotal)}</td>
                  <td style={td}>
                    {r.budget.pctBefore === null ? (
                      <span style={badge('muted')}>tanpa anggaran</span>
                    ) : (
                      <span style={badge(r.budget.overWarn ? 'bad' : 'ok')}>
                        {r.budget.pctBefore}% → {r.budget.pctAfter}%
                      </span>
                    )}
                  </td>
                  <td style={td}>
                    {r.flags.warning > 0 ? <span style={badge('warn')}>{r.flags.warning} peringatan</span> : null}{' '}
                    {r.flags.info > 0 ? <span style={badge('muted')}>{r.flags.info} info</span> : null}
                    {r.flags.warning + r.flags.info === 0 ? '—' : null}
                  </td>
                  <td style={td}>
                    {r.stepLabel}
                    {r.selfApproval ? <div style={{ fontSize: 11 }}>{selfApprovalNote(r.selfApproval)}</div> : null}
                  </td>
                  <td style={td}>
                    {r.step === 'acknowledge' ? (
                      // ADR 0013: "Diketahui" is the Direktur's approval → "Setujui"; ADR 0021: the PM project's
                      // approval (then the Direktur) → "Setujui … sebagai PM project?" (legacy PM step: "Diketahui").
                      <ActionButton
                        url={`/api/v1/expense-requests/${r.id}/acknowledge`}
                        label={r.decisionFlow ? 'Setujui' : 'Diketahui'}
                        variant="primary"
                        confirm={
                          r.decisionBy === 'pm'
                            ? `Setujui ${r.docNo} sebesar ${rp(r.grandTotal)} sebagai PM project? Pengajuan diteruskan ke Direktur.`
                            : r.decisionFlow
                              ? `Setujui ${r.docNo} sebesar ${rp(r.grandTotal)} sebagai Direktur (Diketahui)?`
                              : `Tandai ${r.docNo} sudah diketahui?`
                        }
                      />
                    ) : (
                      <ActionButton
                        url={`/api/v1/expense-requests/${r.id}/approve`}
                        label="Setujui"
                        variant="primary"
                        confirm={
                          r.decisionBy === 'direktur' && r.finalStep
                            ? `Setujui ${r.docNo} sebesar ${rp(r.grandTotal)} sebagai Direktur? Pengajuan diteruskan ke Finance untuk transfer.`
                            : `Setujui ${r.docNo} sebesar ${rp(r.grandTotal)}?`
                        }
                      />
                    )}
                    <ActionButton url={`/api/v1/expense-requests/${r.id}/reject`} label="Tolak" prompt={{ field: 'reason', message: 'Alasan penolakan (wajib, minimal 3 karakter):', minLength: 3 }} />
                  </td>
                </tr>
                {details.get(r.id) ? (
                  <tr>
                    <td style={{ ...td, paddingTop: 0 }} colSpan={cols}>
                      <details data-pk-inbox-details={r.id}>
                        <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                          Rincian baris, nota &amp; flag ({details.get(r.id)!.lines.length} baris, {details.get(r.id)!.receipts.filter((x) => x.status !== 'removed').length} nota)
                        </summary>
                        <ReviewDetails d={details.get(r.id)!} title={`Rincian ${r.docNo ?? `#${r.id}`}`} />
                      </details>
                    </td>
                  </tr>
                ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {items.length > 0 ? <Pager id="persetujuan" path="/admin/persetujuan" sp={props.searchParams} page={page} unit="pengajuan" /> : null}
      {/* E5: Addendum RAB waiting for the caller (Direktur "Setujui" / Finance approval). */}
      <AddendumInboxSection req={req} />
      {/* QA-06 / ADR 0019: LPJ shortfall above approved + tolerance (Direktur → Finance). */}
      <ShortfallInboxSection req={req} />
    </Shell>
  )
}

export default ApprovalInbox
