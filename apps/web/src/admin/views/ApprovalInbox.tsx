import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { selfApprovalNote } from '@/domain/expense/decision'
import { decisionText, REJECT_PROMPT } from '@/domain/expense/decision-texts'
import { approvalInbox } from '@/domain/expense/queues'
import { REQUEST_TYPE_LABELS, REQUEST_TYPES } from '@/domain/expense/types'
import { withReqTransaction } from '@/lib/system-tx'

import { ActionButton } from '../components/ActionButton'
import { ProjectLoanInstruct } from '../components/request/ProjectLoanInstruct'
import { Panel } from '../components/ui/nexus'
import { ListToolbar, Pager } from '../components/list/ListToolbar'
import { allowedValues, idValues, matchesQuery, paginate, parseListQuery } from '../list-query'
import { ClickableRow } from '../components/list/ClickableRow'
import { AddendumInboxSection } from './Addendum'
import { LoanInboxSection } from './Loans'
import { ShortfallInboxSection } from './ShortfallInbox'
import { itemCompany, PtChip, PtScopeNote, ptView } from './pt'
import { Badge, Empty, NX_TABLE, Shell, TableScroll, docLink, rp } from './shared'

/**
 * "Persetujuan" (M04, US-26/US-42/US-59): requests waiting for the logged-in user's "Diketahui"
 * (ADR 0021: "Persetujuan PM" of the request's PM project; ADR 0013 snapshots: the Direktur's approval,
 * "Persetujuan Direktur (Diketahui)") or an approval level (ADR 0021: "Persetujuan Direktur") — only those the rule snapshot assigns to them (G2) and never their own (G1). Budget
 * impact % before → after (red above company-settings.budgetWarnPct, default 85 %; cost centers
 * "tanpa anggaran", Q-24) and open validation flags. Actions call /api/v1 (profile signature, US-43).
 * The "Flag" column counts OPEN flags of both levels — the same number stored with the decision (S3e, S-05).
 * DRMS 13/10 Persetujuan #1: no expandable "Rincian baris, nota & flag" row any more — the whole row opens the
 * request detail (lines, receipts and per-line flags in ReviewDetails there); the buttons in the row still decide.
 */
const STEPS = ['acknowledge', 'approve'] as const

export async function ApprovalInbox(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const pt = await ptView(req)
  // DRMS 10/10 D8: search / PT / jenis / langkah + pagination (URL state); the inbox is a bounded worklist
  // DRMS 13/10 Persetujuan #2 / Umum #4: PT, jenis and langkah are multi-select (`?jenis=advance,reimburse`); PTs ⊆ selection
  const lq = parseListQuery(props.searchParams, ['pt', 'jenis', 'langkah'])
  const ptIds = pt.multi ? idValues(lq, 'pt').filter((id) => pt.selected.includes(id)) : []
  const jenis = allowedValues(lq, 'jenis', REQUEST_TYPES)
  const langkah = allowedValues(lq, 'langkah', STEPS)
  const { all, page, budgetWarnPct } = await withReqTransaction(req, async () => {
    const inbox = await approvalInbox(req, ptIds.length ? { companyIds: ptIds } : undefined)
    const matched = inbox.items.filter(
      (r) => (!jenis.length || jenis.includes(r.type as (typeof jenis)[number])) && (!langkah.length || langkah.includes(r.step as (typeof langkah)[number])) && matchesQuery([r.docNo, r.title, r.scope, r.requesters, r.typeLabel, r.stepLabel], lq.q),
    )
    const page = paginate(matched, lq.page, lq.per)
    return { all: inbox.items.length, page, budgetWarnPct: inbox.budgetWarnPct }
  })
  const items = page.items
  return (
    <Shell
      props={props}
      title="Persetujuan"
      sub={
        <>
          Pengajuan yang menunggu keputusan Anda. Merah = anggaran project sesudah disetujui melebihi {pt.multi ? 'ambang PT pengajuan' : `${budgetWarnPct}%`}.{pt.multi ? ' Keputusan selalu memakai peran Anda di PT dokumen.' : ''}
        </>
      }
    >
      <PtScopeNote pt={pt} />
      <Panel id="pengajuan" icon="tReceiptText" title="Pengajuan" note={`(${page.total})`} data-pk-inbox="requests">
      {all > 0 || lq.q || ptIds.length ? (
        <ListToolbar
          id="persetujuan"
          action="/admin/persetujuan"
          query={lq}
          label="Cari dan saring persetujuan"
          search={{ placeholder: 'Nomor, judul, pemohon, project…' }}
          filters={[
            pt.multi ? { key: 'pt', label: 'PT', all: 'Semua PT', multi: true, options: pt.selected.map((id) => ({ value: String(id), label: pt.ref(id)?.shortCode ?? `#${id}` })) } : null,
            { key: 'jenis', label: 'Jenis', multi: true, options: REQUEST_TYPES.map((t) => ({ value: t, label: REQUEST_TYPE_LABELS[t] })) },
            { key: 'langkah', label: 'Langkah', multi: true, options: [{ value: 'acknowledge', label: 'Persetujuan pertama (PM / Diketahui)' }, { value: 'approve', label: 'Persetujuan berikutnya' }] },
          ]}
        />
      ) : null}
      {items.length === 0 ? (
        <Empty text={all === 0 ? 'Tidak ada pengajuan yang menunggu keputusan Anda.' : 'Tidak ada pengajuan yang cocok dengan pencarian / filter.'} />
      ) : (
        <TableScroll label="Daftar persetujuan">
          <table className={NX_TABLE}>
            <thead>
              <tr>
                {pt.multi ? <th>PT</th> : null}
                <th>Nomor / Judul</th>
                <th>Jenis</th>
                <th>Project / Pusat biaya</th>
                <th>Pemohon</th>
                <th className="n">Grand total</th>
                <th>Dampak anggaran</th>
                <th>Flag</th>
                <th>Langkah</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <ClickableRow key={r.id} href={`/admin/collections/expense-requests/${r.id}`} data-pk-inbox-item={r.id}>
                  {pt.multi ? (
                    <td>
                      <PtChip pt={pt.ref(itemCompany(r))} />
                    </td>
                  ) : null}
                  <td>
                    <span className="pk-nx-strong">{docLink(r.id, r.docNo ?? `#${r.id}`)}</span>
                    <div>{r.title}</div>
                  </td>
                  <td>{r.typeLabel}</td>
                  <td>{r.scope || '—'}</td>
                  <td>{r.requesters || '—'}</td>
                  <td className="n">{rp(r.grandTotal)}</td>
                  <td>
                    {r.budget.pctBefore === null ? (
                      <Badge tone="muted">tanpa anggaran</Badge>
                    ) : (
                      <Badge tone={r.budget.overWarn ? 'bad' : 'ok'}>
                        {r.budget.pctBefore}% → {r.budget.pctAfter}%
                      </Badge>
                    )}
                  </td>
                  <td>
                    {r.flags.warning > 0 ? <Badge tone="warn">{r.flags.warning} peringatan</Badge> : null}{' '}
                    {r.flags.info > 0 ? <Badge tone="muted">{r.flags.info} info</Badge> : null}
                    {r.flags.warning + r.flags.info === 0 ? '—' : null}
                  </td>
                  <td>
                    {r.stepLabel}
                    {r.selfApproval ? <span className="pk-nx-sub">{selfApprovalNote(r.selfApproval)}</span> : null}
                  </td>
                  <td>
                    <div className="pk-nx-acts">
                    {(() => {
                      // ADR 0013/0021 labels + confirmations, shared with the request detail (decision-texts.ts)
                      const t = decisionText({ step: r.step, docNo: r.docNo, grandTotal: r.grandTotal, decisionFlow: r.decisionFlow, decisionBy: r.decisionBy, finalStep: r.finalStep })
                      // ADR 0029 §2: the PT's available funds are short (fund check on) → "Setujui" disabled here; the detail explains + offers the loan
                      // DRMS 26/10 #1: the project's cash account is short → "Instruksi pinjam antar proyek" in the row (same dialog as the detail)
                      if (r.fundShort) {
                        const why = r.projectLoanPending
                          ? `Pinjaman ${r.projectLoanPending.docNo ?? `#${r.projectLoanPending.id}`} menunggu transfer Finance — setujui setelah transfer dieksekusi.`
                          : r.instructProjectLoan
                            ? 'Dana bebas akun kas project kurang — instruksikan pinjaman antar proyek atau tolak.'
                            : 'Dana tersedia kurang — lihat rincian, tolak atau perintahkan pinjaman antar-PT.'
                        return (
                          <>
                            <button type="button" className="btn btn--style-primary btn--size-small btn--disabled pk-pbtn" disabled title={why} data-pk-action={`${r.step}-blocked`}>
                              {t.label}
                            </button>
                            <a href={`/admin/collections/expense-requests/${r.id}`} className="pk-nx-badge-link" data-pk-fund-short={r.id}>
                              <Badge tone="bad" title={why}>
                                Dana kurang {rp(r.fundShort)}
                              </Badge>
                            </a>
                            {r.projectLoanPending ? (
                              <span className="pk-nx-sub" data-pk-project-loan-pending={r.id}>
                                {why}
                              </span>
                            ) : null}
                            {r.instructProjectLoan ? <ProjectLoanInstruct requestId={r.id} docNo={r.docNo} buttonClassName="btn btn--style-secondary btn--size-small pk-pbtn" /> : null}
                          </>
                        )
                      }
                      return <ActionButton url={`/api/v1/expense-requests/${r.id}/${r.step}`} label={t.label} variant="primary" confirm={t.confirm} {...inboxDoc(r)} />
                    })()}
                    <ActionButton url={`/api/v1/expense-requests/${r.id}/reject`} label="Tolak" prompt={REJECT_PROMPT} {...inboxDoc(r)} />
                    </div>
                  </td>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {items.length > 0 ? <Pager id="persetujuan" path="/admin/persetujuan" sp={props.searchParams} page={page} unit="pengajuan" /> : null}
      </Panel>
      {/* E5: Addendum RAB waiting for the caller (Direktur "Setujui" / Finance approval). */}
      <AddendumInboxSection req={req} />
      {/* QA-06 / ADR 0019: LPJ shortfall above approved + tolerance (Direktur → Finance). */}
      <ShortfallInboxSection req={req} />
      {/* ADR 0022: inter-project loans waiting for the Direktur (G1 pool). */}
      <LoanInboxSection req={req} />
    </Shell>
  )
}

/** DRMS 24/10: the request as named in the decision popups (number, title, requester, project, total). */
function inboxDoc(r: Awaited<ReturnType<typeof approvalInbox>>['items'][number]) {
  const docNo = r.docNo ?? `#${r.id}`
  return { object: docNo, summary: [[r.typeLabel, docNo], ['Judul', r.title], ['Pemohon', r.requesters || null], ['Proyek / pusat biaya', r.scope || null], ['Total', rp(r.grandTotal)], ['Langkah', r.stepLabel]] as const }
}

export default ApprovalInbox
