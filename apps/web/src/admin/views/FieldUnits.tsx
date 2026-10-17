import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { hasRole, hasRoleAny } from '@/access/roles'
import { TimesheetForm, type TsProject } from '@/admin/components/field/TimesheetForm'
import { mayReadRates } from '@/domain/field/access'
import { BACKDATE_MAX_DAYS, addDays, BREAKDOWN_SUGGEST_SERVICE_HOURS, serviceTypeNames, UNIT_STATUS_LABELS, type UnitStatus } from '@/domain/field/rules'
import { listServiceReports } from '@/domain/field/service'
import { timesheetDto, type TimesheetDoc } from '@/domain/field/timesheet'
import { buildRecap, buildTimesheetMatrix, cellText, ESTIMATE_LABEL, ESTIMATE_NOTE, fmtNum, longDate, monthDays, monthLabel, monthParam, recentMonths, shortDay, type Matrix } from '@/domain/field/views'
import { contractsOf, type ContractView, fieldProjects, historyOf, mayCorrectIn, mayCreateIn, type ProjectOpt, timesheetsOf, todayOf, unitsOf, visibleFieldDoc, visibleProject, visibleUnit } from '@/domain/field/web'
import { availabilityPct } from '@/domain/field/rules'
import { companyById } from '@/domain/companies'
import { withReqTransaction } from '@/lib/system-tx'
import { DEFAULT_TZ } from '@/lib/time'
import { xlsxEnabled } from '@/lib/xlsx'
import { ListToolbar, Pager } from '@/admin/components/list/ListToolbar'
import { matchesQuery, paginate, parseListQuery } from '@/admin/list-query'

import { EditButton } from './shared'
import { BtnLink, EditLink, editModeOf, FIELD_CREATORS, FIELD_OFFICE, FIELD_READERS, FieldFrame, fieldGate, FlagPills, History, idParam, MetaRows, one, OpenAction, PhotoGallery, segmentNum, spOf, Tabs, UnitStatusPill, dateParam } from './field-ui'
import { ProjectTimeline } from './field-timeline'
import { ptOptionsOf, ptView, PtChip } from './pt'
import { Alert, dateId } from './progress-ui'
import { Bento, Card, DashHead, DataTable, EmptyState, KpiRow, KpiTile, pctText, StatusPill, type Col } from './viz'

/**
 * FR1 "Unit & kontrak" (ADR 0020, plan B; mockup Web-Timesheet): contract list (projects of kind
 * kontrak_unit), contract detail with tabs Timesheet (matrix unit × day, red = missing, orange =
 * breakdown, ⚠ = HM gap; a cell opens the timesheet or the input form), Rekap (per contract unit: HM,
 * hours, availability, missing days and — only for Direktur/Finance/Admin — the billing ESTIMATE,
 * "estimasi — bukan invoice", with the registry exports), Unit (contract units) and Timeline; the unit
 * detail (identity, owner, status, last HM, history) and the timesheet detail / web input.
 * Server-rendered with the caller's access; writes go to /api/v1 (client components).
 */
const contractHref = (id: number, q = '') => `/admin/unit-kontrak/kontrak/${id}${q}`
const unitHref = (id: number) => `/admin/unit-kontrak/unit/${id}`
const tsHref = (id: number) => `/admin/unit-kontrak/timesheet/detail/${id}`
/** UI feedback 17/10 #5: edit (reporter, 24 h) / correction (PM / Direktur) page = the input form, same layout. */
const tsEditHref = (id: number, correction = false) => `/admin/unit-kontrak/timesheet/${id}/ubah${correction ? '?koreksi=1' : ''}`
const tsNewHref = (p: { project?: number; unit?: number; date?: string }) => {
  const u = new URLSearchParams()
  if (p.project) u.set('project', String(p.project))
  if (p.unit) u.set('unit', String(p.unit))
  if (p.date) u.set('tanggal', p.date)
  const q = u.toString()
  return `/admin/unit-kontrak/timesheet/baru${q ? `?${q}` : ''}`
}
const RATE_EDITORS = ['pk-owner', 'pk-admin'] as const

function exportLinks(code: string, q: URLSearchParams): Array<{ f: string; label: string; href: string }> {
  const fmts = [
    { f: 'xlsx', label: 'Excel' },
    { f: 'pdf', label: 'PDF rekap' },
    { f: 'csv', label: 'CSV' },
  ].filter((x) => x.f !== 'xlsx' || xlsxEnabled())
  return fmts.map((x) => ({ ...x, href: `/api/v1/reports/${code}/${x.f}?${q.toString()}` }))
}

// ================================================================ contract list

export async function FieldContracts(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_READERS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const d = await withReqTransaction(req, async () => {
    const projects = await fieldProjects(req, ['kontrak_unit'], gate.companies)
    const today = await todayOf(req, gate.companies[0])
    const month = today.slice(0, 7)
    const contracts = await contractsOf(req, projects.map((p) => p.id))
    const ts = await timesheetsOf(req, { projectIds: projects.map((p) => p.id), from: `${month}-01`, to: today })
    const units = await unitsOf(req, gate.companies, { activeOnly: true })
    return { projects, today, month, contracts, ts, units, pt: await ptView(req) }
  })
  // DRMS 10/10 D8: search (kode / nama) + pagination of the contract list
  const lq = parseListQuery(props.searchParams)
  const allRows = d.projects.filter((p) => matchesQuery([p.code, p.name], lq.q)).map((p) => {
    const cs = d.contracts.filter((c) => c.projectId === p.id)
    const m = buildTimesheetMatrix({ month: d.month, today: d.today, contracts: cs, timesheets: d.ts.filter((t) => t.projectId === p.id) })
    const activeToday = cs.filter((c) => c.active && c.startDate <= d.today && (c.endDate === null || c.endDate >= d.today))
    const filledToday = new Set(d.ts.filter((t) => t.projectId === p.id && t.reportDate === d.today).map((t) => t.unitId))
    return { p, units: activeToday.length, filledToday: activeToday.filter((c) => filledToday.has(c.unitId)).length, m }
  })
  const page = paginate(allRows, lq.page, lq.per)
  const rows = page.items
  const creator = hasRoleAny(req, ...FIELD_CREATORS)
  const office = hasRoleAny(req, ...FIELD_OFFICE)
  const cols: Col<(typeof rows)[number]>[] = [
    {
      key: 'k',
      label: 'Kontrak',
      cell: (r) => (
        <>
          {d.pt.multi ? <PtChip pt={d.pt.ref(r.p.companyId)} /> : null} <b>{r.p.code}</b> {r.p.name}
          <span className="sub">{r.p.status === 'arsip' || r.p.status === 'dibatalkan' ? r.p.status : `${r.units} unit aktif hari ini`}</span>
        </>
      ),
    },
    { key: 'today', label: 'Hari ini', cell: (r) => (r.units === 0 ? '—' : <StatusPill tone={r.filledToday === r.units ? 'ok' : r.filledToday === 0 ? 'bad' : 'warn'} label={`${r.filledToday} dari ${r.units} diisi`} />) },
    { key: 'miss', label: 'Belum diisi (bln ini)', num: true, cell: (r) => <span className={r.m.totals.missing ? 'nw' : undefined}>{r.m.totals.missing ? <b style={{ color: 'var(--pk-tone-bad-text)' }}>{r.m.totals.missing} hari</b> : '0'}</span> },
    { key: 'work', label: 'Jam kerja (bln ini)', num: true, sec: true, cell: (r) => fmtNum(r.m.totals.work) },
    { key: 'gap', label: 'Selisih HM', num: true, sec: true, cell: (r) => (r.m.totals.gaps ? `⚠ ${r.m.totals.gaps}` : '0') },
    {
      key: 'act',
      label: 'Aksi',
      cell: (r) => (
        <span className="pk-rowacts">
          <OpenAction href={contractHref(r.p.id)} name={`kontrak ${r.p.code}`} />
          {creator && mayCreateIn(req, r.p.companyId) && r.units > 0 ? (
            <Link className="pk-row-act" href={tsNewHref({ project: r.p.id })} prefetch={false} aria-label={`Isi timesheet ${r.p.code}`} data-pk-row-action="timesheet">
              <span>+ Timesheet</span>
            </Link>
          ) : null}
        </span>
      ),
    },
  ]
  const heavy = d.units.filter((u) => u.kind === 'alat_berat')
  const unitCols: Col<(typeof heavy)[number]>[] = [
    {
      key: 'u',
      label: 'Unit',
      cell: (u) => (
        <>
          <b>{u.label}</b>
          <span className="sub">{[u.type, u.brandModel].filter(Boolean).join(' · ') || '—'}</span>
        </>
      ),
    },
    { key: 'own', label: 'Pemilik', sec: true, cell: (u) => (u.owner === 'pelanggan' ? `Pelanggan · ${u.client?.name ?? '—'}` : 'Milik sendiri') },
    { key: 'st', label: 'Status', cell: (u) => <UnitStatusPill status={u.status} /> },
    { key: 'hm', label: 'HM terakhir', num: true, cell: (u) => fmtNum(u.lastHourMeter) },
    { key: 'act', label: 'Aksi', cell: (u) => <OpenAction href={unitHref(u.id)} name={`unit ${u.label}`} /> },
  ]
  return (
    <FieldFrame props={props} name="unit-kontrak">
      <DashHead title="Unit & kontrak" note={`Kontrak sewa unit (project berjenis kontrak unit) · ${monthLabel(d.month)} s/d ${dateId(d.today)}`}>
        <div className="pk-kact">
          {creator ? (
            <BtnLink href={tsNewHref({})} primary icon="add" attr="timesheet-baru">
              Isi timesheet
            </BtnLink>
          ) : null}
          <BtnLink href="/admin/laporan-servis" attr="laporan-servis">
            Laporan servis
          </BtnLink>
          {office ? (
            <BtnLink href="/admin/laporan/rekap-timesheet-kontrak" attr="rekap-kontrak">
              Rekap semua kontrak
            </BtnLink>
          ) : null}
        </div>
      </DashHead>
      <Bento label="Unit & kontrak">
        <Card id="contracts" title="Kontrak unit" sub={`${page.total} kontrak · klik Buka untuk matriks timesheet, rekap dan unit`}>
          {d.projects.length > 0 ? <ListToolbar id="unit-kontrak" action="/admin/unit-kontrak" query={lq} label="Cari kontrak" search={{ placeholder: 'Kode atau nama project…' }} /> : null}
          <DataTable id="contracts" paged={false} cols={cols} rows={rows} rowKey={(r) => r.p.id} rowAttrs={(r) => ({ 'data-pk-row': r.p.code })} caption="Kontrak unit" empty={<EmptyState text={d.projects.length ? 'Tidak ada kontrak yang cocok.' : 'Belum ada project berjenis kontrak unit dalam cakupan Anda.'} />} />
          {page.total > 0 ? <Pager id="unit-kontrak" path="/admin/unit-kontrak" sp={props.searchParams} page={page} unit="kontrak" /> : null}
        </Card>
        <Card id="units" title="Unit alat berat" sub="Status dari laporan servis terakhir · HM dari timesheet/servis">
          <DataTable id="units" cols={unitCols} rows={heavy} rowKey={(u) => u.id} rowAttrs={(u) => ({ 'data-pk-row': u.label })} caption="Unit alat berat" empty={<EmptyState text="Belum ada unit alat berat (master Unit & Kendaraan)." />} />
        </Card>
      </Bento>
    </FieldFrame>
  )
}

// ================================================================ contract detail (tabs)

type Tab = 'timesheet' | 'rekap' | 'unit' | 'timeline'

export async function FieldContractDetail(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_READERS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const sp = spOf(props)
  const id = segmentNum(props, 2)
  const office = hasRoleAny(req, ...FIELD_OFFICE)
  const tabRaw = one(sp.tab)
  const tab: Tab = tabRaw === 'rekap' && office ? 'rekap' : tabRaw === 'unit' ? 'unit' : tabRaw === 'timeline' ? 'timeline' : 'timesheet'
  const d = await withReqTransaction(req, async () => {
    const project = id ? await visibleProject(req, id) : null
    if (!project || project.kind !== 'kontrak_unit' || !gate.companies.includes(project.companyId)) return null
    const today = await todayOf(req, project.companyId)
    const month = monthParam(one(sp.bulan), today)
    const contracts = await contractsOf(req, [project.id])
    const ts = tab === 'timesheet' || tab === 'rekap' ? await timesheetsOf(req, { projectIds: [project.id], from: `${month}-01`, to: monthDays(month).at(-1)! }) : []
    const units = tab === 'unit' ? await unitsOf(req, [project.companyId], { ids: contracts.map((c) => c.unitId) }) : []
    return { project, today, month, contracts, ts, units }
  })
  const back = (
    <BtnLink href="/admin/unit-kontrak" icon="arrowLeft">
      Unit & kontrak
    </BtnLink>
  )
  if (!d) {
    return (
      <FieldFrame props={props} name="kontrak-detail">
        <DashHead title="Kontrak tidak ditemukan" note="Project bukan kontrak unit, tidak dalam cakupan Anda, atau laporan lapangan PT-nya belum aktif.">
          {back}
        </DashHead>
      </FieldFrame>
    )
  }
  const { project, today, month, contracts } = d
  const m = buildTimesheetMatrix({ month, today, contracts, timesheets: d.ts })
  const creator = mayCreateIn(req, project.companyId) && project.status !== 'arsip' && project.status !== 'dibatalkan'
  const q = (t: Tab, extra: Record<string, string> = {}) => `?${new URLSearchParams({ tab: t, ...(t === 'timesheet' || t === 'rekap' ? { bulan: month } : {}), ...extra }).toString()}`
  const activeNow = contracts.filter((c) => c.active && c.startDate <= today && (c.endDate === null || c.endDate >= today))
  const tabs = [
    { key: 'timesheet', label: 'Timesheet', href: contractHref(project.id, q('timesheet')) },
    ...(office ? [{ key: 'rekap', label: 'Rekap', href: contractHref(project.id, q('rekap')) }] : []),
    { key: 'unit', label: `Unit (${contracts.filter((c) => c.active).length})`, href: contractHref(project.id, q('unit')) },
    { key: 'timeline', label: 'Timeline', href: contractHref(project.id, q('timeline')) },
  ]
  const exportQ = new URLSearchParams({ bulan: month, project: String(project.id) })
  return (
    <FieldFrame props={props} name="kontrak-detail">
      <DashHead title={`${project.code} ${project.name}`} note={<>Kontrak unit · {activeNow.length} unit aktif hari ini{project.status === 'arsip' ? ' · diarsipkan' : project.status === 'dibatalkan' ? ' · dibatalkan' : ''}</>}>
        <div className="pk-kact">
          {back}
          {creator ? (
            <BtnLink href={tsNewHref({ project: project.id })} primary icon="add" attr="timesheet-baru">
              Isi timesheet
            </BtnLink>
          ) : null}
          {creator ? (
            <BtnLink href={`/admin/laporan-servis/baru?project=${project.id}`} icon="add" attr="servis-baru">
              Laporan servis
            </BtnLink>
          ) : null}
        </div>
      </DashHead>
      <Tabs label="Bagian kontrak" tabs={tabs} current={tab} />
      {tab === 'timesheet' || tab === 'rekap' ? <MonthBar base={contractHref(project.id)} tab={tab} month={month} today={today} exports={office ? exportLinks('rekap-timesheet-kontrak', exportQ) : []} /> : null}
      {tab === 'timesheet' ? <MatrixCard m={m} today={today} projectId={project.id} creator={creator} /> : null}
      {tab === 'rekap' ? <RecapCard m={m} contracts={contracts} today={today} req={req} companyId={project.companyId} /> : null}
      {tab === 'unit' ? <ContractUnitsCard req={req} project={project} contracts={contracts} units={d.units} today={today} /> : null}
      {tab === 'timeline' ? <ProjectTimeline req={req} project={project} sp={sp} base={contractHref(project.id)} /> : null}
    </FieldFrame>
  )
}

function MonthBar({ base, tab, month, today, exports }: { base: string; tab: Tab; month: string; today: string; exports: Array<{ f: string; label: string; href: string }> }) {
  return (
    <form className="pk-filter" method="get" action={base} role="search" aria-label="Pilih bulan" data-pk-filter="bulan">
      <input type="hidden" name="tab" value={tab} />
      <label>
        Bulan
        <select name="bulan" defaultValue={month}>
          {recentMonths(today, 18).map((mo) => (
            <option key={mo} value={mo}>
              {monthLabel(mo)}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="pk-kbtn primary">
        Tampilkan
      </button>
      {exports.length ? (
        <span className="pk-kact" data-pk-exports style={{ marginLeft: 'auto' }}>
          {exports.map((x) => (
            <a key={x.f} className="pk-kbtn" href={x.href} data-pk-export={x.f}>
              {x.label}
            </a>
          ))}
        </span>
      ) : null}
    </form>
  )
}

function MatrixCard({ m, today, projectId, creator }: { m: Matrix; today: string; projectId: number; creator: boolean }) {
  return (
    <Bento label="Matriks timesheet">
      <KpiRow cols={4}>
        <KpiTile id="mx-work" icon="clock" label="Jam kerja" value={fmtNum(m.totals.work)} kpi="mx-work" i={0}>
          <p className="pk-kpi-x">
            standby <b>{fmtNum(m.totals.standby)}</b> · breakdown <b>{fmtNum(m.totals.breakdown)}</b>
          </p>
        </KpiTile>
        <KpiTile id="mx-filled" icon="check" label="Timesheet diisi" value={String(m.totals.filled)} kpi="mx-filled" i={1}>
          <p className="pk-kpi-x">{m.rows.length} unit kontrak</p>
        </KpiTile>
        <KpiTile id="mx-missing" icon="inbox" label="Hari belum diisi" value={String(m.totals.missing)} kpi="mx-missing" i={2}>
          <p className="pk-kpi-x">s/d {dateId(today < m.days[m.days.length - 1]! ? today : m.days[m.days.length - 1]!)}</p>
        </KpiTile>
        <KpiTile id="mx-avail" icon="target" label="Ketersediaan" value={pctText(availabilityPct(m.totals.work, m.totals.standby, m.totals.breakdown))} kpi="mx-avail" i={3}>
          <p className="pk-kpi-x">{m.totals.gaps ? `⚠ ${m.totals.gaps} selisih HM` : 'tanpa selisih HM'}</p>
        </KpiTile>
      </KpiRow>
      <Card id="matrix" title={`Jam kerja per hari · ${monthLabel(m.month)}`} sub="Angka = jam kerja · klik sel untuk detail atau isi timesheet">
        <p className="pk-mxlegend" aria-hidden>
          <span>
            <i className="missing" />
            belum diisi
          </span>
          <span>
            <i className="breakdown" />
            ada breakdown
          </span>
          <span>⚠ selisih HM</span>
          <span>
            <i className="today" />
            hari ini
          </span>
          <span>— di luar periode kontrak</span>
        </p>
        {m.rows.length === 0 ? (
          <EmptyState text="Belum ada unit kontrak di bulan ini." action={undefined} />
        ) : (
          <div className="pk-mxw" role="region" aria-label="Matriks timesheet, geser ke samping" tabIndex={0}>
            <table className="pk-mx" data-pk-matrix={m.month}>
              <caption className="pk-sr">Matriks timesheet {monthLabel(m.month)}: baris = unit, kolom = tanggal</caption>
              <thead>
                <tr>
                  <th scope="col" className="u">
                    Unit
                  </th>
                  {m.days.map((day) => (
                    <th key={day} scope="col" id={`hari-${day}`} title={longDate(day)} className={shortDay(day).startsWith('Min') ? 'we' : undefined}>
                      {Number(day.slice(8))}
                    </th>
                  ))}
                  <th scope="col" className="t">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {m.rows.map((r) => (
                  <tr key={r.contract.id} data-pk-row={r.contract.label}>
                    <th scope="row" className="u">
                      <Link href={unitHref(r.contract.unitId)} prefetch={false}>
                        {r.contract.label}
                      </Link>
                      <small>{r.contract.type ?? ''}</small>
                    </th>
                    {r.cells.map((c) => {
                      const label = cellText(c, r.contract.label)
                      const cls = `c ${c.state}${c.date === today ? ' today' : ''}`
                      if (c.ts)
                        return (
                          <td key={c.date} className={cls} data-pk-cell={c.state}>
                            <Link href={tsHref(c.ts.id)} prefetch={false} aria-label={label} title={label}>
                              {fmtNum(c.ts.workHours, 1)}
                              {c.hmGap ? (
                                <span className="gap" aria-hidden>
                                  ⚠
                                </span>
                              ) : null}
                            </Link>
                          </td>
                        )
                      if (c.state === 'missing' && creator)
                        return (
                          <td key={c.date} className={cls} data-pk-cell="missing">
                            <Link href={tsNewHref({ project: projectId, unit: r.contract.unitId, date: c.date })} prefetch={false} aria-label={`${label} — isi timesheet`} title={`${label} — isi timesheet`}>
                              +
                            </Link>
                          </td>
                        )
                      return (
                        <td key={c.date} className={cls} data-pk-cell={c.state}>
                          <span title={label}>
                            <span className="pk-sr">{label}</span>
                            <span aria-hidden>{c.state === 'off' ? '—' : c.state === 'missing' ? '!' : ''}</span>
                          </span>
                        </td>
                      )
                    })}
                    <td className="t">{fmtNum(r.work)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="u">Total</td>
                  {m.days.map((day) => {
                    const v = m.rows.reduce((a, r) => a + (r.cells.find((c) => c.date === day)?.ts?.workHours ?? 0), 0)
                    return <td key={day}>{v ? fmtNum(v, 1) : ''}</td>
                  })}
                  <td className="t">{fmtNum(m.totals.work)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </Bento>
  )
}

function RecapCard({ m, contracts, today, req, companyId }: { m: Matrix; contracts: ContractView[]; today: string; req: PayloadRequest; companyId: number }) {
  const terms = new Map(contracts.filter((c) => c.terms).map((c) => [c.id, c.terms!]))
  const r = buildRecap(m, terms)
  const rates = mayReadRates(req, companyId) && r.rows.some((x) => x.estimate !== null)
  const until = today < m.days[m.days.length - 1]! ? today : m.days[m.days.length - 1]!
  type Row = (typeof r.rows)[number]
  const cols: Col<Row>[] = [
    {
      key: 'u',
      label: 'Unit',
      cell: (x) => (
        <>
          <b>{x.contract.label}</b>
          <span className="sub">
            {dateId(x.contract.startDate)} – {x.contract.endDate ? dateId(x.contract.endDate) : 'berjalan'}
          </span>
        </>
      ),
    },
    { key: 'hm', label: 'HM awal → akhir', num: true, cell: (x) => (x.hmStart === null ? '—' : `${fmtNum(x.hmStart)} → ${fmtNum(x.hmEnd)}`) },
    { key: 'w', label: 'Jam kerja', num: true, cell: (x) => fmtNum(x.work) },
    { key: 's', label: 'Standby', num: true, cell: (x) => fmtNum(x.standby) },
    { key: 'b', label: 'Breakdown', num: true, cell: (x) => (x.breakdown > 0 ? <b style={{ color: 'var(--pk-tone-warn-text)' }}>{fmtNum(x.breakdown)}</b> : '0') },
    { key: 'a', label: 'Ketersediaan', num: true, cell: (x) => pctText(x.availability) },
    { key: 'm', label: 'Hari belum diisi', num: true, cell: (x) => (x.missing > 0 ? <b style={{ color: 'var(--pk-tone-bad-text)' }}>{x.missing}</b> : '0') },
    ...(rates
      ? ([
          { key: 'rate', label: 'Tarif', num: true, cell: (x: Row) => x.rateText ?? '—' },
          {
            key: 'est',
            label: 'Estimasi tagihan',
            num: true,
            cell: (x: Row) =>
              x.estimate ? (
                <b data-pk-estimate={x.estimate.amount}>
                  {`Rp ${fmtNum(x.estimate.amount, 0)}`}
                  {x.estimateNote ? '*' : ''}
                </b>
              ) : (
                '—'
              ),
          },
        ] as Col<Row>[])
      : []),
  ]
  const notes = r.rows.filter((x) => x.estimateNote).map((x) => `${x.contract.label}: ${x.estimateNote}`)
  return (
    <Bento label="Rekap kontrak">
      <Card id="recap" title={`Rekap ${monthLabel(m.month)} (s/d ${dateId(until)})`} sub={rates ? undefined : 'Tarif dan estimasi tagihan hanya untuk Direktur, Finance, dan Admin.'}>
        {rates ? (
          <p style={{ margin: '0 0 10px' }}>
            <span className="pk-est" data-pk-estimate-label>
              {ESTIMATE_LABEL} · terlihat Direktur/Finance/Admin
            </span>
          </p>
        ) : null}
        <DataTable id="recap" cols={cols} rows={r.rows} rowKey={(x) => x.contract.id} rowAttrs={(x) => ({ 'data-pk-row': x.contract.label })} caption={`Rekap timesheet ${monthLabel(m.month)}`} empty={<EmptyState text="Belum ada unit kontrak di bulan ini." />} />
        {r.rows.length ? (
          <dl className="pk-dl" style={{ marginTop: 14 }} data-pk-recap-totals>
            <dt>Total jam kerja</dt>
            <dd>
              <b>{fmtNum(r.totals.work)}</b> · standby {fmtNum(r.totals.standby)} · breakdown {fmtNum(r.totals.breakdown)} · hari belum diisi {r.totals.missing}
            </dd>
            {rates && r.totals.estimate !== null ? (
              <>
                <dt>Total estimasi</dt>
                <dd>
                  <b data-pk-estimate-total={r.totals.estimate}>Rp {fmtNum(r.totals.estimate, 0)}</b> ({ESTIMATE_LABEL.toLowerCase()})
                </dd>
              </>
            ) : null}
          </dl>
        ) : null}
        <div className="pk-card-f">
          {notes.map((n) => (
            <p key={n} style={{ margin: '0 0 4px' }}>
              * {n}
            </p>
          ))}
          <p style={{ margin: 0 }}>
            Ketersediaan = (jam kerja + standby) / (jam kerja + standby + breakdown). Hari belum diisi dihitung s/d hari ini untuk hari yang tercakup kontrak.
            {rates ? ` Per jam = tarif × maks(jam kerja, minimum jam); per bulan = tarif × hari kontrak / hari dalam bulan. ${ESTIMATE_NOTE}` : ''}
          </p>
        </div>
      </Card>
    </Bento>
  )
}

function ContractUnitsCard({ req, project, contracts, units, today }: { req: PayloadRequest; project: ProjectOpt; contracts: ContractView[]; units: Awaited<ReturnType<typeof unitsOf>>; today: string }) {
  const byId = new Map(units.map((u) => [u.id, u]))
  const editor = hasRole(req, [...RATE_EDITORS], project.companyId)
  const rates = mayReadRates(req, project.companyId)
  type Row = ContractView
  const cols: Col<Row>[] = [
    {
      key: 'u',
      label: 'Unit',
      cell: (c) => (
        <>
          <b>{c.label}</b>
          <span className="sub">{byId.get(c.unitId)?.brandModel ?? c.type ?? ''}</span>
        </>
      ),
    },
    { key: 'p', label: 'Periode', cell: (c) => <span className="nw">{`${dateId(c.startDate)} – ${c.endDate ? dateId(c.endDate) : 'berjalan'}`}</span> },
    { key: 'a', label: 'Kontrak', cell: (c) => <StatusPill tone={!c.active ? 'none' : c.startDate <= today && (c.endDate === null || c.endDate >= today) ? 'ok' : 'wait'} label={!c.active ? 'nonaktif' : c.startDate > today ? 'belum mulai' : c.endDate !== null && c.endDate < today ? 'selesai' : 'aktif'} /> },
    { key: 's', label: 'Status unit', cell: (c) => <UnitStatusPill status={byId.get(c.unitId)?.status} /> },
    { key: 'hm', label: 'HM terakhir', num: true, sec: true, cell: (c) => fmtNum(byId.get(c.unitId)?.lastHourMeter ?? null) },
    ...(rates ? [{ key: 'r', label: 'Tarif', num: true, cell: (c: Row) => (c.terms ? `Rp ${fmtNum(c.terms.rate, 0)}/${c.terms.rateBasis === 'per_bulan' ? 'bulan' : 'jam'}${c.terms.rateBasis === 'per_jam' && c.terms.minHoursPerMonth ? ` · min ${fmtNum(c.terms.minHoursPerMonth)} jam` : ''}` : '—') }] : []),
    {
      key: 'act',
      label: 'Aksi',
      cell: (c) => (
        <span className="pk-rowacts">
          <OpenAction href={unitHref(c.unitId)} name={`unit ${c.label}`} />
          {editor ? <EditButton href={`/admin/collections/contract-units/${c.id}`} name={`unit kontrak ${c.label}`} /> : null}
        </span>
      ),
    },
  ]
  return (
    <Bento label="Unit kontrak">
      <Card id="contract-units" title="Unit dalam kontrak" sub="Satu unit tidak boleh aktif di dua kontrak pada tanggal yang sama">
        {editor ? (
          <p className="pk-kact" style={{ margin: '0 0 12px' }}>
            <BtnLink href="/admin/collections/contract-units/create" icon="add" attr="contract-unit-baru">
              Tambah unit ke kontrak
            </BtnLink>
            <span className="pk-note">Pilih project {project.code} di formulir; tarif hanya terlihat Direktur/Finance/Admin.</span>
          </p>
        ) : null}
        <DataTable id="contract-units" cols={cols} rows={contracts} rowKey={(c) => c.id} rowAttrs={(c) => ({ 'data-pk-row': c.label })} caption="Unit dalam kontrak" empty={<EmptyState text="Belum ada unit di kontrak ini." />} />
      </Card>
    </Bento>
  )
}

// ================================================================ unit detail

export async function FieldUnitDetail(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_READERS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const id = segmentNum(props, 2)
  const d = await withReqTransaction(req, async () => {
    const unit = id ? await visibleUnit(req, id) : null
    if (!unit || !gate.companies.includes(unit.companyId)) return null
    const today = await todayOf(req, unit.companyId)
    const from = addDays(today, -120)
    const [services, ts] = await Promise.all([listServiceReports(req, { unitId: unit.id, limit: 60 }), timesheetsOf(req, { unitId: unit.id, from, to: today, limit: 200 })])
    // contracts of this unit in projects the caller may read
    const projects = await fieldProjects(req, ['kontrak_unit'], [unit.companyId], { includeArchived: true })
    const contracts = (await contractsOf(req, projects.map((p) => p.id))).filter((c) => c.unitId === unit.id)
    return { unit, today, services: services.items, ts, contracts, projects }
  })
  const back = (
    <BtnLink href="/admin/unit-kontrak" icon="arrowLeft">
      Unit & kontrak
    </BtnLink>
  )
  if (!d) {
    return (
      <FieldFrame props={props} name="unit-detail">
        <DashHead title="Unit tidak ditemukan">{back}</DashHead>
      </FieldFrame>
    )
  }
  const { unit, services, ts, contracts, projects, today } = d
  const pname = new Map(projects.map((p) => [p.id, p]))
  const current = contracts.find((c) => c.active && c.startDate <= today && (c.endDate === null || c.endDate >= today)) ?? null
  type H = { key: string; date: string; kind: 'servis' | 'timesheet'; title: string; detail: string; href: string; flags: readonly string[] }
  const hist: H[] = [
    ...services.map((s) => ({
      key: `sv-${s.id}`,
      date: s.reportDate,
      kind: 'servis' as const,
      title: `${s.docNo ?? `Servis #${s.id}`} · ${serviceTypeNames(s.serviceTypes, s.serviceType)} · ${UNIT_STATUS_LABELS[s.unitStatusAfter as UnitStatus] ?? s.unitStatusAfter}`,
      detail: [s.action.length > 100 ? `${s.action.slice(0, 99)}…` : s.action, s.hourMeter !== null ? `HM ${fmtNum(s.hourMeter)}` : null, s.reporter.name].filter(Boolean).join(' · '),
      href: `/admin/laporan-servis/detail/${s.id}`,
      flags: s.flags,
    })),
    ...ts.map((t) => ({
      key: `ts-${t.id}`,
      date: t.reportDate,
      kind: 'timesheet' as const,
      title: `Timesheet · ${fmtNum(t.workHours)} jam kerja${t.breakdownHours > 0 ? ` · breakdown ${fmtNum(t.breakdownHours)}` : ''}`,
      detail: `HM ${fmtNum(t.hmStart)} → ${fmtNum(t.hmEnd)} · ${pname.get(t.projectId)?.code ?? ''}`,
      href: tsHref(t.id),
      flags: t.flags,
    })),
  ].sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? 1 : -1))
  const editor = hasRole(req, ['pk-admin', 'pk-owner'], unit.companyId)
  const creator = mayCreateIn(req, unit.companyId)
  return (
    <FieldFrame props={props} name="unit-detail">
      <DashHead title={unit.label} note={[unit.type, unit.brandModel].filter(Boolean).join(' · ') || (unit.kind === 'alat_berat' ? 'Alat berat' : 'Kendaraan')}>
        <div className="pk-kact">
          {back}
          {creator ? (
            <BtnLink href={`/admin/laporan-servis/baru?unit=${unit.id}${current ? `&project=${current.projectId}` : ''}`} icon="add" primary attr="servis-baru">
              Laporan servis
            </BtnLink>
          ) : null}
          {creator && current ? (
            <BtnLink href={tsNewHref({ project: current.projectId, unit: unit.id })} icon="add" attr="timesheet-baru">
              Timesheet
            </BtnLink>
          ) : null}
          {editor ? (
            <BtnLink href={`/admin/collections/vehicles/${unit.id}`} icon="edit" attr="unit-ubah">
              Ubah data unit
            </BtnLink>
          ) : null}
        </div>
      </DashHead>
      <Bento label="Unit">
        <KpiRow cols={3}>
          <KpiTile id="u-status" icon="check" label="Status" value={<UnitStatusPill status={unit.status} />} kpi="unit-status" i={0}>
            <p className="pk-kpi-x">dari laporan servis terakhir</p>
          </KpiTile>
          <KpiTile id="u-hm" icon="clock" label="HM terakhir" value={fmtNum(unit.lastHourMeter)} kpi="unit-hm" i={1}>
            <p className="pk-kpi-x">{unit.lastHourMeterAt ? `per ${dateId(unit.lastHourMeterAt.slice(0, 10))}` : 'belum ada laporan'}</p>
          </KpiTile>
          <KpiTile id="u-contract" icon="doc" label="Kontrak sekarang" value={current ? (pname.get(current.projectId)?.code ?? `#${current.projectId}`) : '—'} kpi="unit-contract" i={2}>
            <p className="pk-kpi-x">{current ? `sejak ${dateId(current.startDate)}` : unit.owner === 'pelanggan' ? 'unit milik pelanggan' : 'tidak sedang disewa'}</p>
          </KpiTile>
        </KpiRow>
        <Card id="unit-identity" title="Identitas" span={5} i={3}>
          <dl className="pk-dl">
            <dt>Kode unit</dt>
            <dd>{unit.unitCode ?? '—'}</dd>
            <dt>No. polisi</dt>
            <dd>{unit.plate ?? '—'}</dd>
            <dt>Jenis</dt>
            <dd>{unit.kind === 'alat_berat' ? 'Alat berat' : 'Kendaraan'}{unit.type ? ` · ${unit.type}` : ''}</dd>
            <dt>Merek / model</dt>
            <dd>{unit.brandModel ?? '—'}</dd>
            <dt>No. seri</dt>
            <dd>{unit.serialNo ?? '—'}</dd>
            <dt>Pemilik</dt>
            <dd>{unit.owner === 'pelanggan' ? `Pelanggan · ${unit.client?.name ?? '—'}` : 'Milik sendiri (armada)'}</dd>
            <dt>Aktif</dt>
            <dd>{unit.active ? 'Ya' : 'Tidak'}</dd>
          </dl>
          {contracts.length ? (
            <>
              <h3 style={{ fontSize: 13, margin: '16px 0 6px', color: 'var(--pk-muted-fg)' }}>Kontrak</h3>
              <ul className="pk-hist">
                {contracts.map((c) => (
                  <li key={c.id}>
                    <Link href={contractHref(c.projectId)} prefetch={false}>
                      {pname.get(c.projectId)?.label ?? `Project #${c.projectId}`}
                    </Link>
                    <small>
                      {dateId(c.startDate)} – {c.endDate ? dateId(c.endDate) : 'berjalan'}
                      {c.active ? '' : ' · nonaktif'}
                    </small>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>
        <Card id="unit-history" title="Riwayat unit" sub="Laporan servis + timesheet (120 hari terakhir) · terbaru di atas" span={7} i={4}>
          {hist.length === 0 ? (
            <EmptyState text="Belum ada laporan untuk unit ini." />
          ) : (
            <div className="pk-ftl">
              <section>
                <ul>
                  {hist.slice(0, 80).map((h) => (
                    <li key={h.key} data-pk-unit-history={h.kind}>
                      <span className={`pk-tag ${h.kind}`}>{h.kind === 'servis' ? 'Servis' : 'Timesheet'}</span>
                      <div className="b">
                        <strong>
                          {shortDay(h.date)} {dateId(h.date).split(' ').slice(1).join(' ')} · {h.title}
                        </strong>
                        <span>
                          {h.detail}
                          {h.flags.includes('HM_GAP') ? ' · ⚠ selisih HM' : ''}
                          {h.flags.includes('CORRECTED') ? ' · dikoreksi' : ''}
                        </span>
                      </div>
                      <OpenAction href={h.href} name={`${h.title} ${dateId(h.date)}`} />
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </Card>
      </Bento>
    </FieldFrame>
  )
}

// ================================================================ timesheet: web input

/** "Aturan" card of the input AND the edit page (UI feedback 17/10 #5: same layout). */
function TimesheetRules() {
  return (
    <Card id="timesheet-help" title="Aturan" span={4}>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
        <li>Unit harus aktif di kontrak pada tanggal tersebut.</li>
        <li>HM akhir ≥ HM awal. HM awal berbeda dari HM akhir sebelumnya → ditandai <b>selisih HM</b> untuk PM.</li>
        <li>Jam kerja + standby + breakdown maks. 24; breakdown wajib alasan.</li>
        <li>Foto meter HM wajib (1 foto).</li>
        <li>Tanggal paling lama {BACKDATE_MAX_DAYS} hari ke belakang.</li>
      </ul>
    </Card>
  )
}

export async function FieldTimesheetNew(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_CREATORS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const sp = spOf(props)
  const d = await withReqTransaction(req, async () => {
    const companies = gate.companies.filter((c) => mayCreateIn(req, c))
    const projects = await fieldProjects(req, ['kontrak_unit'], companies)
    const contracts = await contractsOf(req, projects.map((p) => p.id))
    const units = await unitsOf(req, companies, { ids: contracts.map((c) => c.unitId) })
    const today = await todayOf(req, companies[0])
    return { projects, contracts, units, today }
  })
  const hm = new Map(d.units.map((u) => [u.id, u.lastHourMeter]))
  // DRMS UI 17/10 #4: project labels tagged `[CS1]` while several PTs are selected
  const tsProjects: TsProject[] = ptOptionsOf(d.projects, await ptView(req))
    .map((p) => ({
      projectId: p.id,
      label: p.label,
      companyId: p.companyId,
      units: d.contracts.filter((c) => c.projectId === p.id).map((c) => ({ contractUnitId: c.id, unitId: c.unitId, label: c.label, startDate: c.startDate, endDate: c.endDate, active: c.active, lastHm: hm.get(c.unitId) ?? null })),
    }))
    .filter((p) => p.units.some((u) => u.active))
  const initialProject = idParam(sp.project)
  return (
    <FieldFrame props={props} name="timesheet-baru">
      <DashHead title="Isi timesheet unit" note="Satu timesheet per unit per hari · HM awal otomatis dari HM akhir sebelumnya · bisa diedit pelapor 24 jam, setelah itu koreksi oleh PM/Direktur">
        <div className="pk-kact">
          <BtnLink href={initialProject ? contractHref(initialProject) : '/admin/unit-kontrak'} icon="arrowLeft">
            Kembali
          </BtnLink>
        </div>
      </DashHead>
      <Bento>
        <Card id="timesheet-form" title="Timesheet harian" span={8}>
          {tsProjects.length === 0 ? (
            <EmptyState text="Tidak ada kontrak unit dengan unit aktif yang dapat Anda laporkan (Staff: project yang ditugaskan; PM: project tim)." />
          ) : (
            <TimesheetForm projects={tsProjects} today={d.today} minDate={addDays(d.today, -BACKDATE_MAX_DAYS)} initialProject={initialProject} initialUnit={idParam(sp.unit)} initialDate={dateParam(sp.tanggal)} />
          )}
        </Card>
        <TimesheetRules />
      </Bento>
    </FieldFrame>
  )
}

// ================================================================ timesheet: detail

export async function FieldTimesheetDetail(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_READERS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const sp = spOf(props)
  const id = segmentNum(props, 3)
  const d = await withReqTransaction(req, async () => {
    const doc = id ? await visibleFieldDoc<TimesheetDoc>(req, 'unit_timesheet', id) : null
    if (!doc) return null
    const t = await timesheetDto(req, doc)
    const history = await historyOf(req, 'unit_timesheet', t.id)
    const co = t.companyId ? await companyById(req, t.companyId).catch(() => null) : null
    return { t, history, tz: co?.timezone || process.env.TZ || DEFAULT_TZ }
  })
  const back = (
    <BtnLink href="/admin/unit-kontrak" icon="arrowLeft">
      Unit & kontrak
    </BtnLink>
  )
  if (!d) {
    return (
      <FieldFrame props={props} name="timesheet-detail">
        <DashHead title="Timesheet tidak ditemukan">{back}</DashHead>
      </FieldFrame>
    )
  }
  const { t, history, tz } = d
  const corrector = mayCorrectIn(req, t.companyId)
  const unitName = t.unit.label ?? `Unit #${t.unit.id}`
  return (
    <FieldFrame props={props} name="timesheet-detail">
      <DashHead title={`Timesheet ${unitName} · ${dateId(t.reportDate)}`} note={`${t.project.code ?? ''} ${t.project.name ?? ''} · ${longDate(t.reportDate)}`}>
        <div className="pk-kact">
          <BtnLink href={contractHref(t.project.id, `?tab=timesheet&bulan=${t.reportDate.slice(0, 7)}`)} icon="arrowLeft">
            Matriks kontrak
          </BtnLink>
          <BtnLink href={unitHref(t.unit.id)}>Unit</BtnLink>
          {t.editable ? (
            <EditLink href={tsEditHref(t.id)} action="timesheet-edit" primary>
              Ubah (24 jam)
            </EditLink>
          ) : null}
          {corrector ? (
            <EditLink href={tsEditHref(t.id, true)} action="timesheet-correct">
              Koreksi
            </EditLink>
          ) : null}
        </div>
      </DashHead>
      {one(sp.baru) === '1' ? (
        <Alert tone="ok" attr="created">
          <p>Timesheet tersimpan.</p>
        </Alert>
      ) : one(sp.disimpan) === '1' ? (
        <Alert tone="ok" attr="saved">
          <p>Perubahan tersimpan dan tercatat di riwayat.</p>
        </Alert>
      ) : null}
      {t.flags.length ? (
        <Alert tone="info" attr="flags">
          <p>
            Tanda: <FlagPills flags={t.flags} />
            {t.flags.includes('HM_GAP') ? ' — HM awal tidak sama dengan HM akhir timesheet sebelumnya unit ini; periksa dan koreksi bila salah ketik.' : ''}
          </p>
        </Alert>
      ) : null}
      {t.suggestServiceReport ? (
        <Alert tone="info" attr="suggest-service">
          <p>
            Breakdown ≥ {BREAKDOWN_SUGGEST_SERVICE_HOURS} jam — buat laporan servis untuk unit ini.{' '}
            <Link className="pk-kbtn sm" href={`/admin/laporan-servis/baru?project=${t.project.id}&unit=${t.unit.id}`} prefetch={false}>
              Buat laporan servis
            </Link>
          </p>
        </Alert>
      ) : null}
      <Bento label="Timesheet">
        <KpiRow cols={3}>
          <KpiTile id="t-hm" icon="clock" label="HM awal → akhir" value={`${fmtNum(t.hmStart)} → ${fmtNum(t.hmEnd)}`} kpi="ts-hm" i={0}>
            <p className="pk-kpi-x">
              selisih <b>{fmtNum(t.hmUsed)}</b> jam
            </p>
          </KpiTile>
          <KpiTile id="t-hours" icon="target" label="Jam kerja" value={fmtNum(t.workHours)} kpi="ts-work" i={1}>
            <p className="pk-kpi-x">
              standby <b>{fmtNum(t.standbyHours)}</b> · breakdown <b>{fmtNum(t.breakdownHours)}</b> · ketersediaan {pctText(availabilityPct(t.workHours, t.standbyHours, t.breakdownHours))}
            </p>
          </KpiTile>
          <KpiTile id="t-fuel" icon="wallet" label="BBM" value={t.fuelLiters === null ? '—' : `${fmtNum(t.fuelLiters)} L`} kpi="ts-fuel" i={2}>
            <p className="pk-kpi-x">operator {t.operatorName ?? '—'}</p>
          </KpiTile>
        </KpiRow>
        <Card id="ts-body" title="Rincian" span={7} i={3}>
          <dl className="pk-dl">
            <dt>Unit</dt>
            <dd>
              <Link href={unitHref(t.unit.id)} prefetch={false}>
                {unitName}
              </Link>
            </dd>
            <dt>Kontrak</dt>
            <dd>
              <Link href={contractHref(t.project.id)} prefetch={false}>
                {t.project.code} {t.project.name}
              </Link>
            </dd>
            <dt>Alasan breakdown</dt>
            <dd>{t.breakdownReason ?? '—'}</dd>
            <dt>Lokasi</dt>
            <dd>{t.location ?? '—'}</dd>
            <dt>Catatan</dt>
            <dd className="pk-pre">{t.notes ?? '—'}</dd>
          </dl>
        </Card>
        <Card id="ts-meta" title="Pelaporan" span={5} i={4}>
          <MetaRows d={t} tz={tz} />
        </Card>
        <Card id="ts-photo" title="Foto meter HM" span={5} i={5}>
          <PhotoGallery photos={t.hmPhoto ? [t.hmPhoto] : []} label={`meter HM ${unitName}`} empty="Tanpa foto HM." />
        </Card>
        <Card id="ts-history" title="Riwayat & koreksi" span={7} i={6}>
          <History entries={history} tz={tz} />
        </Card>
      </Bento>
    </FieldFrame>
  )
}


// ================================================================ timesheet: edit / correction (UI feedback 17/10 #5)

/**
 * `/unit-kontrak/timesheet/:id/ubah` — the reporter's edit within 24 h, `?koreksi=1` the PM / Direktur correction: the
 * input form (`TimesheetForm`, same sections, order and "Aturan" card) with contract, date and unit disabled, the stored
 * values and HM photo, and "Alasan" last. Who may open it = who saw the former dialog; the API re-checks everything.
 */
export async function FieldTimesheetEdit(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_READERS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const mode = editModeOf(spOf(props))
  const id = segmentNum(props, 2)
  const d = await withReqTransaction(req, async () => {
    const doc = id ? await visibleFieldDoc<TimesheetDoc>(req, 'unit_timesheet', id) : null
    if (!doc) return null
    const t = await timesheetDto(req, doc)
    return { t, today: await todayOf(req, t.companyId) }
  })
  const back = (id2: number | null) => (
    <BtnLink href={id2 ? tsHref(id2) : '/admin/unit-kontrak'} icon="arrowLeft">
      {id2 ? 'Kembali ke timesheet' : 'Unit & kontrak'}
    </BtnLink>
  )
  if (!d) {
    return (
      <FieldFrame props={props} name="timesheet-ubah">
        <DashHead title="Timesheet tidak ditemukan">{back(null)}</DashHead>
      </FieldFrame>
    )
  }
  const { t } = d
  const unitName = t.unit.label ?? `Unit #${t.unit.id}`
  const allowed = mode === 'edit' ? t.editable : mayCorrectIn(req, t.companyId)
  const title = `${mode === 'edit' ? 'Ubah' : 'Koreksi'} timesheet ${unitName} · ${dateId(t.reportDate)}`
  if (!allowed || t.companyId === null) {
    return (
      <FieldFrame props={props} name="timesheet-ubah">
        <DashHead title={title}>{back(t.id)}</DashHead>
        <Alert tone="bad" attr="not-editable">
          <p>{mode === 'edit' ? 'Timesheet ini tidak dapat diubah lagi: hanya pelapor, dalam 24 jam sejak dibuat. Setelah itu koreksi oleh PM project / Direktur.' : 'Koreksi timesheet hanya oleh PM project (tim) atau Direktur.'}</p>
        </Alert>
      </FieldFrame>
    )
  }
  const project: TsProject = {
    projectId: t.project.id,
    label: `${t.project.code ?? ''} ${t.project.name ?? ''}`.trim(),
    companyId: t.companyId,
    units: [{ contractUnitId: t.contractUnitId ?? 0, unitId: t.unit.id, label: unitName, startDate: t.reportDate, endDate: t.reportDate, active: true, lastHm: null }],
  }
  return (
    <FieldFrame props={props} name="timesheet-ubah">
      <DashHead title={title} note={mode === 'edit' ? 'Pelapor, dalam 24 jam sejak dibuat · hanya isian yang berubah yang dikirim · tercatat di riwayat' : 'Koreksi PM project / Direktur dengan alasan · timesheet ditandai “dikoreksi” dan HM terakhir unit dihitung ulang'}>
        <div className="pk-kact">{back(t.id)}</div>
      </DashHead>
      <Bento>
        <Card id="timesheet-form" title={mode === 'edit' ? 'Ubah timesheet (24 jam)' : 'Koreksi timesheet'} span={8}>
          <TimesheetForm
            mode={mode}
            report={{
              id: t.id,
              projectId: t.project.id,
              unitId: t.unit.id,
              reportDate: t.reportDate,
              hmStart: t.hmStart,
              hmEnd: t.hmEnd,
              workHours: t.workHours,
              standbyHours: t.standbyHours,
              breakdownHours: t.breakdownHours,
              breakdownReason: t.breakdownReason,
              fuelLiters: t.fuelLiters,
              operatorName: t.operatorName,
              location: t.location,
              notes: t.notes,
              hmPhoto: t.hmPhoto ? { id: t.hmPhoto.id, url: t.hmPhoto.url, thumbUrl: t.hmPhoto.thumbUrl } : null,
            }}
            projects={[project]}
            today={d.today}
            minDate={t.reportDate}
          />
        </Card>
        <TimesheetRules />
      </Bento>
    </FieldFrame>
  )
}
