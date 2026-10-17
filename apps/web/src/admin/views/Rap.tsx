import Link from 'next/link'
import type { AdminViewServerProps, PayloadRequest } from 'payload'
import React from 'react'

import { hasRoleAny, relId } from '@/access/roles'
import { ClickableRow } from '@/admin/components/list/ClickableRow'
import { ListToolbar, Pager } from '@/admin/components/list/ListToolbar'
import { RapExcelTools } from '@/admin/components/rap/RapExcelTools'
import { RapItemsEditor } from '@/admin/components/rap/RapItemsEditor'
import { loadRapEditor, rapItemView } from '@/admin/components/rap/rap-editor-data'
import { allowedValues, filterValues, idValues, matchesQuery, paginate, parseListQuery } from '@/admin/list-query'
import { PROJECT_STATUSES } from '@/collections/Projects'
import { kindOf, PROJECT_KIND_LABELS, type ProjectKind } from '@/domain/field/rules'
import { filterOverview, overviewTotals, RAP_STATE_LABELS, RAP_STATES, rapOverRab, rapVsRab, type RapOverviewRow, type RapState } from '@/domain/rap/overview'
import { loadRapOverview } from '@/domain/rap/overview-load'
import { loadRap, rapTemplatesFor } from '@/domain/rap/service'
import { formatNumber } from '@/lib/money'
import { withReqTransaction } from '@/lib/system-tx'

import { Frame } from './frame'
import { NoAccess } from './NoAccess'
import { Alert } from './progress-ui'
import { foreignPtParam, PtChip, PtScopeNote, ptView } from './pt'
import { PtNotAllowed } from './shared'
import { Card, DashHead, EmptyState, KpiRow, KpiTile, rp, StatusPill } from './viz'

/**
 * DRMS 13/10 Wave 3 — "Proyek › RAP", its own sub-menu under Proyek (client: "Form RAP + upload, submenu sendiri di
 * bawah Proyek"):
 * - `/admin/rap` (RapIndex): every project the caller may read with its RAP state (ada / belum, wajib when the
 *   project has a RAB or is konstruksi), filters PT / status / RAP + search (D8 toolbar, multi-select), numbered pages,
 *   clickable rows, totals row at the bottom. RAP total only for the RAP price roles of the project, RAB only where
 *   the RAB field is readable (domain/rap/overview.ts).
 * - `/admin/rap/:id` (RapProject): the items of one project with "+ Tambah item" / "Ubah" (RapItemsEditor → the
 *   existing /api/v1 RAP item endpoints), grand total row, and below it the Excel upload / template tools folded in
 *   "Impor / template Excel (opsional)" (RapExcelTools, UI feedback 17/10 #3) for the RAP editors — same order and
 *   rules as the project's RAP tab (loadRap: visibility, prices, lock; rap-editor-data loadRapEditor).
 * Readers = every project role (Staff sees items and quantities, never money); the menu entry is for the office
 * roles and the PM (the Staff menu stays the project list, owner 2026-10-11). The server re-checks every write.
 */
const READERS = ['pk-owner', 'pk-admin', 'pk-finance', 'pk-pm', 'pk-staff'] as const
const BASE = '/admin/rap'
export const rapHref = (projectId: number) => `${BASE}/${projectId}`

const STATUS_LABEL: Record<string, string> = Object.fromEntries(PROJECT_STATUSES.map((s) => [s.value, s.label]))
const STATE_TONE: Record<RapState, 'ok' | 'bad' | 'none'> = { ada: 'ok', wajib: 'bad', opsional: 'none' }
const pctText = (v: number | null) => (v === null ? '—' : `${formatNumber(v, 2)}%`)
const sp = (props: AdminViewServerProps) => props.searchParams as Record<string, string | string[] | undefined> | undefined
const req = (props: AdminViewServerProps) => props.initPageResult.req as PayloadRequest

function StateCell({ r }: { r: RapOverviewRow }) {
  return <StatusPill tone={STATE_TONE[r.state]} label={r.state === 'ada' ? `Ada · ${r.items} item` : r.state === 'wajib' ? 'Belum ada (wajib)' : 'Belum ada'} />
}

// ================================================================ index

export async function RapIndex(props: AdminViewServerProps) {
  const r = req(props)
  if (!hasRoleAny(r, ...READERS)) return <NoAccess props={props} />
  if (foreignPtParam(r, props.searchParams)) return <PtNotAllowed props={props} title="RAP proyek" />
  const lq = parseListQuery(sp(props), ['pt', 'status', 'rap'])
  const pt = await ptView(r)
  const all = await withReqTransaction(r, () => loadRapOverview(r))
  const rows = filterOverview(all, {
    companies: idValues(lq, 'pt').filter((c) => pt.selected.includes(c)),
    statuses: allowedValues(
      lq,
      'status',
      PROJECT_STATUSES.map((s) => s.value),
    ),
    states: allowedValues(lq, 'rap', RAP_STATES),
  }).filter((x) => matchesQuery([x.code, x.name], lq.q))
  const page = paginate(rows, lq.page, lq.per)
  const totals = overviewTotals(rows)
  // money columns only when the caller sees money of at least one project (Staff: never)
  const money = all.some((x) => x.prices || x.budget !== null)
  const missing = all.filter((x) => x.state === 'wajib' && x.status !== 'arsip' && x.status !== 'selesai' && x.status !== 'dibatalkan').length
  const cols = 4 + (pt.multi ? 1 : 0) // PT?, Project, Jenis, Status, RAP
  return (
    <Frame props={props} name="rap">
      <DashHead title="RAP proyek" note="Rencana anggaran pelaksanaan per project · klik baris untuk membuka dan mengisi RAP">
        <PtScopeNote pt={pt} />
      </DashHead>
      {missing > 0 ? (
        <Alert tone="bad" attr="rap-missing-count">
          <p>
            <b>{missing} project ber-RAB belum punya RAP</b> — pengajuan project tersebut baru bisa dikirim setelah RAP terisi. Saring <Link href={`${BASE}?rap=wajib`}>Belum ada RAP (wajib)</Link>.
          </p>
        </Alert>
      ) : null}
      <Card id="rap-projects" title="Daftar RAP project" sub={money ? 'Total RAP = Σ volume × harga satuan item aktif · dibandingkan dengan RAB project' : 'Status RAP per project'}>
        <ListToolbar
          id="rap"
          action={BASE}
          query={lq}
          label="Cari dan saring RAP project"
          search={{ placeholder: 'Kode atau nama project…' }}
          filters={[
            pt.multi ? { key: 'pt', label: 'PT', multi: true, options: pt.selected.map((id) => ({ value: String(id), label: pt.ref(id)?.shortCode ?? `#${id}`, title: pt.ref(id)?.name ?? undefined })) } : null,
            { key: 'status', label: 'Status project', multi: true, all: 'Semua (tanpa arsip)', options: PROJECT_STATUSES.map((s) => ({ value: s.value, label: s.label })) },
            { key: 'rap', label: 'RAP', multi: true, options: RAP_STATES.map((s) => ({ value: s, label: RAP_STATE_LABELS[s] })) },
          ]}
        />
        {page.items.length === 0 ? (
          <EmptyState text={all.length === 0 ? 'Belum ada project yang dapat Anda buka.' : 'Tidak ada project yang cocok dengan pencarian / filter.'} />
        ) : (
          <div className="pk-tw">
            <table className="pk-t" data-pk-table="rap-projects">
              <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>RAP per project</caption>
              <thead>
                <tr>
                  {pt.multi ? <th scope="col">PT</th> : null}
                  <th scope="col" aria-sort="ascending">
                    Project
                  </th>
                  <th scope="col">Jenis</th>
                  <th scope="col">Status</th>
                  <th scope="col">RAP</th>
                  {money ? (
                    <>
                      <th scope="col" className="n">
                        Total RAP
                      </th>
                      <th scope="col" className="n">
                        RAB
                      </th>
                      <th scope="col" className="n">
                        RAP / RAB
                      </th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {page.items.map((x) => {
                  const pct = x.prices ? rapVsRab(x.rapValue, x.budget) : null
                  return (
                    <ClickableRow key={x.id} href={rapHref(x.id)} data-pk-rap-project={x.code} data-pk-rap-state={x.state}>
                      {pt.multi ? (
                        <td>
                          <PtChip pt={pt.ref(x.companyId)} />
                        </td>
                      ) : null}
                      <td>
                        <a href={rapHref(x.id)}>
                          <b>{x.code}</b>
                        </a>
                        <span className="sub">{x.name}</span>
                      </td>
                      <td>{PROJECT_KIND_LABELS[kindOf(x.kind) as ProjectKind] ?? x.kind}</td>
                      <td>{STATUS_LABEL[x.status ?? ''] ?? '—'}</td>
                      <td>
                        <StateCell r={x} />
                      </td>
                      {money ? (
                        <>
                          <td className="n">{x.prices ? rp(x.rapValue) : '—'}</td>
                          <td className="n">{rp(x.budget)}</td>
                          <td className="n">
                            {pctText(pct)}
                            {x.prices && rapOverRab(x.rapValue, x.budget) ? (
                              <>
                                {' '}
                                <StatusPill tone="warn" label="Melebihi RAB" />
                              </>
                            ) : null}
                          </td>
                        </>
                      ) : null}
                    </ClickableRow>
                  )
                })}
              </tbody>
              {/* client (DRMS 13/10): totals at the bottom of the table — over every filtered row, not just this page */}
              <tfoot>
                <tr data-pk-rap-totals>
                  <th scope="row" colSpan={cols} style={{ textAlign: 'left', borderTop: '2px solid var(--pk-border)', padding: 10 }}>
                    Total {totals.projects} project · {totals.withRap} punya RAP · {totals.items} item aktif
                  </th>
                  {money ? (
                    <>
                      <td className="n" style={{ borderTop: '2px solid var(--pk-border)', fontWeight: 700 }}>
                        {rp(totals.rapValue)}
                      </td>
                      <td className="n" style={{ borderTop: '2px solid var(--pk-border)', fontWeight: 700 }}>
                        {rp(totals.budget)}
                      </td>
                      <td className="n" style={{ borderTop: '2px solid var(--pk-border)' }} />
                    </>
                  ) : null}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <Pager id="rap" path={BASE} sp={sp(props)} page={page} unit="project" />
      </Card>
    </Frame>
  )
}

// ================================================================ one project

export async function RapProject(props: AdminViewServerProps) {
  const r = req(props)
  if (!hasRoleAny(r, ...READERS)) return <NoAccess props={props} />
  const seg = (props.params?.segments as string[] | undefined) ?? []
  const raw = seg[1] ?? ''
  const id = /^\d{1,10}$/.test(raw) ? Number(raw) : NaN
  const data = Number.isSafeInteger(id)
    ? await withReqTransaction(r, async () => {
        const p = (await r.payload.findByID({ collection: 'projects', id, depth: 0, select: { code: true, name: true, kind: true, status: true, company: true }, user: r.user, overrideAccess: false /* caller's read scope */, req: r }).catch(() => null)) as {
          code?: string
          name?: string
          kind?: string | null
          status?: string | null
          company?: unknown
        } | null
        if (!p) return null
        const company = relId(p.company) ?? -1
        const rap = await loadRap(r, id)
        const editor = await loadRapEditor(r, { id, company, status: p.status }, rap)
        const templates = rap.canEdit && rap.items.length === 0 ? await rapTemplatesFor(r, id) : []
        return { p, company, rap, editor, templates }
      }).catch(() => null)
    : null
  if (!data) {
    return (
      <Frame props={props} name="rap-project">
        <DashHead title="RAP project">
          <Link className="pk-kbtn" href={BASE}>
            ← Semua RAP
          </Link>
        </DashHead>
        <EmptyState text="Project tidak ditemukan atau tidak dapat Anda buka." />
      </Frame>
    )
  }
  const { p, rap, editor, templates } = data
  const pt = await ptView(r)
  const { mode } = editor
  const prices = rap.totals !== null
  const path = rapHref(id)
  const q = sp(props)
  const lq = parseListQuery(q, ['tahap', 'status'])
  const tahap = filterValues(lq, 'tahap')
  const statuses = allowedValues(lq, 'status', ['aktif', 'nonaktif', 'terpakai'] as const)
  const items = rap.items
    .map(rapItemView)
    .filter(
      (i) =>
        // default: active items + deactivated items that carry realisation (as the project tab)
        (statuses.length === 0 ? i.active || (i.realisedAmount ?? 0) > 0 || i.realised > 0 : statuses.some((s) => (s === 'aktif' ? i.active : s === 'nonaktif' ? !i.active : (i.realisedAmount ?? 0) > 0 || i.realised + i.received + i.used > 0))) &&
        (tahap.length === 0 || tahap.includes(String(i.stageId ?? ''))) &&
        matchesQuery([i.code, i.description, i.stageName ?? ''], lq.q),
    )
  const t = rap.totals
  const b = rap.budget
  const kind = kindOf(p.kind)
  return (
    <Frame props={props} name="rap-project">
      <DashHead
        title={`RAP · ${p.code ?? ''} ${p.name ?? ''}`.trim()}
        note={
          <>
            {pt.multi ? (
              <>
                <PtChip pt={pt.ref(data.company)} />{' '}
              </>
            ) : null}
            {PROJECT_KIND_LABELS[kind as ProjectKind] ?? kind} · {STATUS_LABEL[p.status ?? ''] ?? '—'} · {rap.drivesProgress ? 'tahapan wajib; pekerjaan menggerakkan progress tahapan' : 'rencana biaya; tahapan opsional, progress tetap manual'}
          </>
        }
      >
        <div className="pk-kact">
          <Link className="pk-kbtn" href={BASE} data-pk-link="rap-index">
            ← Semua RAP
          </Link>
          <Link className="pk-kbtn" href={`/admin/collections/projects/${id}/rap`} data-pk-link="rap-project-tab">
            Buka project
          </Link>
          {kind === 'konstruksi' ? (
            <Link className="pk-kbtn" href={`/admin/laporan-harian/rap/${id}`}>
              RAP &amp; laporan harian
            </Link>
          ) : null}
        </div>
      </DashHead>
      {rap.items.filter((i) => i.active).length === 0 && rap.rapRequired ? (
        <Alert tone="bad" attr="rap-missing">
          <p>
            <b>Project belum punya RAP.</b> Project ini punya RAB (atau konstruksi), jadi wajib punya RAP: pengajuannya baru bisa dikirim setelah RAP terisi.
          </p>
        </Alert>
      ) : null}
      {mode === 'reason' ? (
        <Alert tone="info" attr="rap-locked">
          <p>RAP terkunci karena sudah ada realisasi laporan harian. Sebagai Direktur/Admin Anda tetap dapat mengubahnya — setiap perubahan wajib disertai alasan (tercatat di audit).</p>
        </Alert>
      ) : null}
      {prices && t ? (
        <KpiRow cols={4}>
          <KpiTile id="rap-total" icon="target" label="Total RAP" value={rp(t.rapValue)} kpi="rap-total" i={0}>
            <p className="pk-kpi-x">{rap.items.filter((i) => i.active).length} item aktif</p>
          </KpiTile>
          <KpiTile id="rap-rab" icon="wallet" label="RAB project" value={rp(t.budget)} kpi="rap-rab" i={1}>
            <p className="pk-kpi-x">{t.overBudget ? <StatusPill tone="warn" label="RAP melebihi RAB" /> : `RAP ${pctText(rapVsRab(t.rapValue, t.budget))} dari RAB`}</p>
          </KpiTile>
          <KpiTile id="rap-realised" icon="check" label="Realisasi (disetujui)" value={rp(b?.realised ?? 0)} kpi="rap-realised" i={2}>
            <p className="pk-kpi-x">{pctText(b?.percent ?? null)} dari rencana</p>
          </KpiTile>
          <KpiTile id="rap-remaining" icon="send" label="Sisa RAP" value={rp(b?.remaining ?? null)} kpi="rap-remaining" i={3}>
            <p className="pk-kpi-x">{b && b.overBudgetItems > 0 ? <StatusPill tone="warn" label={`${b.overBudgetItems} item melebihi RAP`} /> : 'Tidak ada item melebihi RAP'}</p>
          </KpiTile>
        </KpiRow>
      ) : (
        <p className="pk-note" data-pk-rap-no-money>
          Nilai RAP hanya untuk Direktur, Admin, Finance dan PM project. Anda melihat item dan volume rencana.
        </p>
      )}
      <Card id="rap-items" title="Item RAP" sub={mode === 'edit' || mode === 'reason' ? 'Tambah atau ubah item lewat formulir; item tidak pernah dihapus (nonaktifkan bila tidak dipakai)' : 'Rincian item RAP project'}>
        <ListToolbar
          id="rap-items"
          action={path}
          query={lq}
          label="Cari dan saring item RAP"
          search={{ placeholder: 'Kode, uraian, tahapan…' }}
          pageSize={false}
          filters={[
            { key: 'tahap', label: 'Tahapan', multi: true, options: rap.stages.map((s) => ({ value: String(s.id), label: s.name })) },
            {
              key: 'status',
              label: 'Status',
              multi: true,
              all: 'Aktif + terpakai',
              options: [
                { value: 'aktif', label: 'Aktif' },
                { value: 'nonaktif', label: 'Nonaktif' },
                { value: 'terpakai', label: 'Sudah terpakai' },
              ],
            },
          ]}
        />
        <RapItemsEditor projectId={id} items={items} stages={editor.stages} uoms={editor.uoms} prices={prices} mode={mode} stageRequired={rap.drivesProgress} drivesProgress={rap.drivesProgress} />
        {/* UI feedback 17/10 #3: the form first; Excel / template folded below it (same order as the project's RAP tab) */}
        {rap.canEdit ? <RapExcelTools projectId={id} hasItems={rap.items.length > 0} templates={templates} needsReason={rap.needsReason} stageRequired={rap.drivesProgress} /> : null}
      </Card>
    </Frame>
  )
}
