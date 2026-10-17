import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { hasRoleAny } from '@/access/roles'
import { ActivityForm } from '@/admin/components/field/ActivityForm'
import { companyById } from '@/domain/companies'
import { activityDto, activityDtos, listActivities, openPos, type ActivityDoc, type ActivityDto } from '@/domain/field/aftersales'
import { mayReadRates } from '@/domain/field/access'
import { ACTIVITY_KIND_LABELS, ACTIVITY_KINDS, addDays, BACKDATE_MAX_DAYS, OPEN_PO_STATUSES, PO_STATUS_LABELS, PO_STATUSES, type ActivityKind, type PoStatus } from '@/domain/field/rules'
import { scopedFind } from '@/domain/field/service'
import { aftersalesWeek, fmtNum, followUpTodo, itemsText, longDate, shortDay, weekRange } from '@/domain/field/views'
import { clientsOf, fieldProjects, historyOf, mayCorrectIn, mayCreateIn, reportersOf, todayOf, visibleFieldDoc } from '@/domain/field/web'
import { withReqTransaction } from '@/lib/system-tx'
import { DEFAULT_TZ } from '@/lib/time'
import { xlsxEnabled } from '@/lib/xlsx'
import { AutoSubmit } from '@/admin/components/list/AutoSubmit'
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, parseListQuery } from '@/admin/list-query'

import { BtnLink, dateParam, EditLink, editModeOf, FIELD_CREATORS, FIELD_OFFICE, FIELD_READERS, FieldFrame, fieldGate, FlagPills, History, idParam, MetaRows, one, OpenAction, PhotoGallery, segmentNum, spOf } from './field-ui'
import { ptCodes, ptOptionsOf, ptView, PtChip } from './pt'
import { Alert, dateId } from './progress-ui'
import { Bento, Card, DashHead, DataTable, EmptyState, KpiRow, KpiTile, rp, StatusPill, type Col } from './viz'
import { DateInput } from '../components/DateInput'

/**
 * FR1 aftersales spare parts (ADR 0020, plan A2; mockups Web-Aftersales + Android-Aftersales): weekly
 * recap (KPI PO in / delivered / open POs / value for Direktur-Finance-Admin; per customer; "Perlu
 * ditindaklanjuti" = open POs with age + due follow-ups; the week's activities), the activity list with
 * filters, the activity detail (deliveries of a PO, history, edit/correction) and the quick web input.
 * Values (Rp) only for the rate roles; a reporter also sees the value they entered on the detail
 * (ADR 0020 §7) — never as a list/recap column.
 */
const recapHref = '/admin/aftersales'
const listHref = '/admin/aftersales/aktivitas'
const detailHref = (id: number) => `/admin/aftersales/aktivitas/detail/${id}`
/** UI feedback 17/10 #5: edit (reporter, 24 h) / correction (PM / Direktur) page = the input form, same layout. */
const editHref = (id: number, correction = false) => `/admin/aftersales/aktivitas/${id}/ubah${correction ? '?koreksi=1' : ''}`
const newHref = (p: Record<string, string | number | undefined>) => {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v !== undefined) u.set(k, String(v))
  const q = u.toString()
  return `/admin/aftersales/aktivitas/baru${q ? `?${q}` : ''}`
}
const KIND_SHORT: Record<ActivityKind, string> = { penawaran: 'Penawaran', po_masuk: 'PO', pengiriman: 'Kirim', penagihan: 'Tagih', kunjungan: 'Kunjungan', lainnya: 'Lainnya' }
const kindTone = (k: string) => (k === 'po_masuk' ? 'progress' : k === 'pengiriman' ? 'ok' : k === 'penawaran' ? 'warn' : 'none') as 'progress' | 'ok' | 'warn' | 'none'

const anyRates = (req: PayloadRequest, companies: readonly number[]) => companies.some((c) => mayReadRates(req, c))

// ================================================================ weekly recap

export async function FieldAftersalesRecap(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_OFFICE)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const sp = spOf(props)
  const projectId = idParam(sp.project)
  const d = await withReqTransaction(req, async () => {
    const today = await todayOf(req, gate.companies[0])
    const week = weekRange(one(sp.minggu), today)
    const projects = await fieldProjects(req, ['aftersales'], gate.companies, { includeArchived: true })
    const acts = await listActivities(req, { projectId, from: week.from, to: week.to, limit: 2000, companyIds: gate.companies })
    const open = await openPos(req, { projectId, companyIds: gate.companies, asOf: today })
    const fuDocs = await scopedFind<ActivityDoc>(
      req,
      'aftersales-activities',
      [{ kind: { equals: 'penawaran' } }, { followUpDate: { greater_than_equal: addDays(today, -60) } }, { followUpDate: { less_than_equal: addDays(today, 7) } }, { company: { in: gate.companies } }, ...(projectId ? [{ project: { equals: projectId } }] : [])],
      200,
      'followUpDate',
    )
    const followUps = await activityDtos(req, fuDocs)
    return { today, week, projects, acts: acts.items, open: open.items, followUps, pt: await ptView(req) }
  })
  const rates = anyRates(req, gate.companies)
  const w = aftersalesWeek(d.acts.map((a) => ({ id: a.id, activityDate: a.activityDate, kind: a.kind as ActivityKind, client: a.client, docNo: a.docNo, poStatus: (a.poStatus ?? null) as PoStatus | null, value: a.value, valueVisible: a.valueVisible && rates, followUpDate: a.followUpDate })))
  const todo = followUpTodo(
    d.open.map((p) => ({ id: p.id, docNo: p.docNo, client: p.client, activityDate: p.activityDate, poStatus: p.poStatus, ageDays: p.ageDays, items: p.items })),
    d.followUps.filter((f) => f.followUpDate).map((f) => ({ id: f.id, docNo: f.docNo, client: f.client, followUpDate: f.followUpDate!, items: f.items })),
    d.today,
  )
  const creator = hasRoleAny(req, ...FIELD_CREATORS) && gate.companies.some((c) => mayCreateIn(req, c))
  const weeks = Array.from({ length: 10 }, (_, i) => weekRange(addDays(d.today, -7 * i), d.today))
  const exportQ = new URLSearchParams({ dari: d.week.from, sampai: d.week.to < d.today ? d.week.to : d.today, ...(projectId ? { project: String(projectId) } : {}) })
  type CRow = (typeof w.clients)[number]
  const cols: Col<CRow>[] = [
    { key: 'c', label: 'Pelanggan', cell: (c) => <b>{c.name}</b> },
    { key: 'q', label: 'Penawaran', num: true, cell: (c) => c.penawaran },
    { key: 'po', label: 'PO', num: true, cell: (c) => c.po },
    { key: 't', label: 'Terkirim', num: true, cell: (c) => c.terkirim },
    { key: 'b', label: 'Belum', num: true, cell: (c) => (c.belum ? <b style={{ color: 'var(--pk-tone-warn-text)' }}>{c.belum}</b> : '0') },
    { key: 'k', label: 'Kirim / tagih', num: true, sec: true, cell: (c) => `${c.pengiriman} / ${c.penagihan}` },
    ...(rates ? [{ key: 'v', label: 'Nilai PO', num: true, cell: (c: CRow) => (c.value === null ? '—' : rp(c.value)) }] : []),
    { key: 'a', label: 'Aksi', cell: (c) => <OpenAction href={`${listHref}?pelanggan=${c.clientId}&dari=${d.week.from}&sampai=${d.week.to}`} name={`aktivitas ${c.name}`} label="Aktivitas" /> },
  ]
  return (
    <FieldFrame props={props} name="aftersales">
      <DashHead title={`Aftersales sparepart · Minggu ${d.week.label}`} note="PO masuk vs terkirim vs belum kirim per pelanggan · status PO = status saat ini">
        <div className="pk-kact">
          {creator ? (
            <BtnLink href={newHref({})} primary icon="add" attr="aktivitas-baru">
              Catat aktivitas
            </BtnLink>
          ) : null}
          <BtnLink href={listHref} attr="aktivitas">
            Daftar aktivitas
          </BtnLink>
        </div>
      </DashHead>
      <form className="pk-filter" method="get" action={recapHref} role="search" aria-label="Pilih minggu" data-pk-filter="aftersales">
        <label>
          Minggu
          <select name="minggu" defaultValue={d.week.from}>
            {weeks.map((x) => (
              <option key={x.from} value={x.from}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        {d.projects.length > 1 ? (
          <label>
            Project
            <select name="project" defaultValue={projectId ? String(projectId) : ''}>
              <option value="">Semua project</option>
              {ptOptionsOf(d.projects, d.pt).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="pk-kbtn primary">
          Tampilkan
        </button>
        <span className="pk-kact" data-pk-exports style={{ marginLeft: 'auto' }}>
          {[
            { f: 'xlsx', label: 'Excel' },
            { f: 'pdf', label: 'PDF' },
            { f: 'csv', label: 'CSV' },
          ]
            .filter((x) => x.f !== 'xlsx' || xlsxEnabled())
            .map((x) => (
              <a key={x.f} className="pk-kbtn" href={`/api/v1/reports/rekap-aftersales/${x.f}?${exportQ.toString()}`} data-pk-export={x.f}>
                {x.label}
              </a>
            ))}
        </span>
      </form>
      <Bento label="Rekap aftersales">
        <KpiRow cols={4}>
          <KpiTile id="as-po" icon="inbox" label="PO masuk" value={String(w.kpi.po)} kpi="as-po" i={0}>
            <p className="pk-kpi-x">minggu ini</p>
          </KpiTile>
          <KpiTile id="as-done" icon="check" label="Terkirim" value={String(w.kpi.terkirim)} kpi="as-delivered" i={1}>
            <p className="pk-kpi-x">dari PO minggu ini · belum {w.kpi.belum}</p>
          </KpiTile>
          <KpiTile id={d.open.length ? 'as-open-alert' : 'as-open'} icon="clock" label="PO terbuka (semua minggu)" value={String(d.open.length)} kpi="as-open" href="#pk-card-todo" more="Tindak lanjut" i={2}>
            <p className="pk-kpi-x">{d.open.length ? `tertua ${Math.max(...d.open.map((p) => p.ageDays))} hari` : 'semua PO terkirim'}</p>
          </KpiTile>
          {rates ? (
            <KpiTile id="as-value" icon="wallet" label="Nilai PO minggu ini" value={w.kpi.value === null ? '—' : rp(w.kpi.value)} title={w.kpi.value === null ? undefined : rp(w.kpi.value)} kpi="as-value" i={3}>
              <p className="pk-kpi-x">Direktur/Finance/Admin</p>
            </KpiTile>
          ) : (
            <KpiTile id="as-acts" icon="doc" label="Aktivitas minggu ini" value={String(d.acts.length)} kpi="as-acts" i={3}>
              <p className="pk-kpi-x">semua jenis</p>
            </KpiTile>
          )}
        </KpiRow>
        <Card id="as-clients" title="Rekap per pelanggan" sub={`${d.week.label}`} span={7} i={4}>
          <DataTable id="as-clients" cols={cols} rows={w.clients} rowKey={(c) => c.clientId} rowAttrs={(c) => ({ 'data-pk-row': c.name })} caption="Rekap aftersales per pelanggan" empty={<EmptyState text="Belum ada aktivitas minggu ini." />} />
        </Card>
        <Card id="todo" title="Perlu ditindaklanjuti" sub="PO terbuka (tertua dulu) · follow-up penawaran ≤ 7 hari" span={5} i={5}>
          {todo.length === 0 ? (
            <EmptyState text="Tidak ada PO terbuka atau follow-up jatuh tempo." />
          ) : (
            <ul className="pk-todo" data-pk-todo>
              {todo.slice(0, 20).map((t) => (
                <li key={t.key} className={t.tone === 'muted' ? undefined : t.tone} data-pk-todo-kind={t.kind}>
                  <div className="b">
                    <strong>{t.title}</strong>
                    <span>{t.detail}</span>
                  </div>
                  <OpenAction href={detailHref(t.id)} name={t.title} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card id="as-week" title="Aktivitas minggu ini" sub="Terbaru di atas" action={{ href: `${listHref}?dari=${d.week.from}&sampai=${d.week.to}`, label: 'Lihat semua' }} i={6}>
          <ActivityTable rows={[...d.acts].sort((a, b) => (a.activityDate === b.activityDate ? b.id - a.id : a.activityDate < b.activityDate ? 1 : -1))} rates={false} pt={d.pt} short />
        </Card>
      </Bento>
    </FieldFrame>
  )
}

function ActivityTable({ rows, rates, pt, short }: { rows: ActivityDto[]; rates: boolean; pt: Awaited<ReturnType<typeof ptView>>; short?: boolean }) {
  const cols: Col<ActivityDto>[] = [
    { key: 'd', label: 'Tanggal', cell: (a) => <span className="nw">{short ? shortDay(a.activityDate) : dateId(a.activityDate)}</span> },
    { key: 'k', label: 'Jenis', cell: (a) => <StatusPill tone={kindTone(a.kind)} label={KIND_SHORT[a.kind as ActivityKind] ?? a.kind} /> },
    {
      key: 'c',
      label: 'Pelanggan · dokumen · item',
      cell: (a) => (
        <>
          {pt.multi ? <PtChip pt={pt.ref(a.companyId)} /> : null} <b>{a.client.name ?? '—'}</b>
          {a.docNo ? ` · ${a.docNo}` : ''}
          <span className="sub">{[itemsText(a.items as Array<{ name: string; qty: number; uom?: string | null }>), a.relatesTo ? `untuk ${a.relatesTo.docNo ?? `PO #${a.relatesTo.id}`}` : null].filter(Boolean).join(' · ') || '—'}</span>
        </>
      ),
    },
    { key: 'st', label: 'Status PO', sec: true, cell: (a) => (a.kind === 'po_masuk' && a.poStatus ? <StatusPill tone={a.poStatus === 'terkirim' ? 'ok' : a.poStatus === 'batal' ? 'none' : 'warn'} label={PO_STATUS_LABELS[a.poStatus as PoStatus]} /> : '—') },
    ...(rates ? [{ key: 'v', label: 'Nilai', num: true, cell: (a: ActivityDto) => (a.valueVisible && a.value !== null ? rp(a.value) : '—') }] : []),
    { key: 'by', label: 'Pelapor', sec: true, cell: (a) => a.reporter.name ?? '—' },
    { key: 'act', label: 'Aksi', cell: (a) => <OpenAction href={detailHref(a.id)} name={`aktivitas ${ACTIVITY_KIND_LABELS[a.kind as ActivityKind]} ${a.docNo ?? a.id}`} /> },
  ]
  return <DataTable id="activities" cols={cols} rows={rows} rowKey={(a) => a.id} rowAttrs={(a) => ({ 'data-pk-row': a.docNo ?? String(a.id), 'data-pk-kind': a.kind })} caption="Aktivitas aftersales" empty={<EmptyState text="Belum ada aktivitas." />} />
}

// ================================================================ activity list

export async function FieldActivityList(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_READERS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const sp = spOf(props)
  const kind = one(sp.jenis)
  const po = one(sp.status)
  const q = {
    project: idParam(sp.project),
    client: idParam(sp.pelanggan),
    reporter: idParam(sp.pelapor),
    kind: (ACTIVITY_KINDS as readonly string[]).includes(kind ?? '') ? (kind as ActivityKind) : undefined,
    poStatus: (PO_STATUSES as readonly string[]).includes(po ?? '') ? (po as PoStatus) : undefined,
    from: dateParam(sp.dari),
    to: dateParam(sp.sampai),
    before: idParam(sp.sebelum),
  }
  // DRMS 10/10 D8: text search + page size (shared list query; the cursor stays `sebelum`)
  const lq = parseListQuery(props.searchParams)
  const d = await withReqTransaction(req, async () => {
    const page = await listActivities(req, { projectId: q.project, clientId: q.client, reporterId: q.reporter, kind: q.kind, poStatus: q.poStatus, from: q.from, to: q.to, limit: lq.per, after: q.before, companyIds: gate.companies, q: lq.q })
    const projects = await fieldProjects(req, ['aftersales'], gate.companies, { includeArchived: true })
    const clients = await clientsOf(req, gate.companies)
    const reporters = await reportersOf(req, 'aftersales-activities')
    return { page, projects, clients, reporters, pt: await ptView(req) }
  })
  const filtered = Boolean(q.project || q.client || q.reporter || q.kind || q.poStatus || q.from || q.to || lq.q)
  const keep = (extra: Record<string, string>) => {
    const u = new URLSearchParams()
    if (q.project) u.set('project', String(q.project))
    if (q.client) u.set('pelanggan', String(q.client))
    if (q.reporter) u.set('pelapor', String(q.reporter))
    if (q.kind) u.set('jenis', q.kind)
    if (q.poStatus) u.set('status', q.poStatus)
    if (q.from) u.set('dari', q.from)
    if (q.to) u.set('sampai', q.to)
    if (lq.q) u.set('q', lq.q)
    if (lq.per !== DEFAULT_PAGE_SIZE) u.set('per', String(lq.per))
    for (const [k, v] of Object.entries(extra)) u.set(k, v)
    return `${listHref}?${u.toString()}`
  }
  const creator = hasRoleAny(req, ...FIELD_CREATORS) && gate.companies.some((c) => mayCreateIn(req, c))
  const office = hasRoleAny(req, ...FIELD_OFFICE)
  return (
    <FieldFrame props={props} name="aktivitas-aftersales">
      <DashHead title="Aktivitas aftersales" note="Penawaran, PO masuk, pengiriman, penagihan, kunjungan · terbaru di atas">
        <div className="pk-kact">
          {creator ? (
            <BtnLink href={newHref({})} primary icon="add" attr="aktivitas-baru">
              Catat aktivitas
            </BtnLink>
          ) : null}
          {office ? (
            <BtnLink href={recapHref} attr="rekap-aftersales">
              Rekap mingguan
            </BtnLink>
          ) : null}
          <BtnLink href={`${listHref}?jenis=po_masuk&status=belum_kirim`} attr="po-terbuka">
            PO belum kirim
          </BtnLink>
        </div>
      </DashHead>
      <form className="pk-filter" method="get" action={listHref} role="search" aria-label="Filter aktivitas" data-pk-filter="aktivitas">
        <label className="pk-filter__search">
          Cari
          <input type="search" name="q" defaultValue={lq.q} placeholder="No. dokumen, penerima, catatan…" maxLength={100} autoComplete="off" data-pk-search="aktivitas" />
        </label>
        <label>
          Dari
          <DateInput type="date" name="dari" defaultValue={q.from ?? ''} />
        </label>
        <label>
          Sampai
          <DateInput type="date" name="sampai" defaultValue={q.to ?? ''} />
        </label>
        <label>
          Pelanggan
          <select name="pelanggan" defaultValue={q.client ? String(q.client) : ''}>
            <option value="">Semua</option>
            {ptOptionsOf(
              d.clients.map((c) => ({ ...c, label: c.name })),
              d.pt,
            ).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Jenis
          <select name="jenis" defaultValue={q.kind ?? ''}>
            <option value="">Semua</option>
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {ACTIVITY_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status PO
          <select name="status" defaultValue={q.poStatus ?? ''}>
            <option value="">Semua</option>
            {PO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PO_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {d.projects.length > 1 ? (
          <label>
            Project
            <select name="project" defaultValue={q.project ? String(q.project) : ''}>
              <option value="">Semua</option>
              {ptOptionsOf(d.projects, d.pt).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {d.reporters.length > 1 ? (
          <label>
            Pelapor
            <select name="pelapor" defaultValue={q.reporter ? String(q.reporter) : ''}>
              <option value="">Semua</option>
              {d.reporters.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Per halaman
          <select name="per" defaultValue={String(lq.per)} data-pk-page-size="aktivitas">
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="pk-kbtn primary">
          Terapkan
        </button>
        {filtered ? (
          <Link className="pk-kbtn" href={listHref} prefetch={false}>
            Reset
          </Link>
        ) : null}
        <AutoSubmit />
      </form>
      <Bento label="Daftar aktivitas">
        <Card id="activities" title="Aktivitas" sub={`${d.page.items.length}${d.page.nextCursor ? '+' : ''} aktivitas${filtered ? ' (terfilter)' : ''}`}>
          <ActivityTable rows={d.page.items} rates={anyRates(req, gate.companies)} pt={d.pt} />
          <nav className="pk-actions" aria-label="Halaman aktivitas" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            {q.before ? (
              <a className="pk-kbtn sm" href={keep({})} rel="first">
                ← Terbaru
              </a>
            ) : null}
            {d.page.nextCursor ? (
              <a className="pk-kbtn sm" href={keep({ sebelum: String(d.page.nextCursor) })} rel="next">
                Lebih lama →
              </a>
            ) : null}
          </nav>
        </Card>
      </Bento>
    </FieldFrame>
  )
}

// ================================================================ quick input

/** "Aturan" card of the input AND the edit page (UI feedback 17/10 #5: same layout). */
function ActivityRules() {
  return (
    <Card id="activity-help" title="Aturan" span={4}>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
        <li>Pengiriman wajib mengacu ke PO masuk pelanggan yang sama; “sudah terkirim semua” menutup PO.</li>
        <li>Penawaran dengan tanggal follow-up memunculkan pengingat ke pelapor dan PM.</li>
        <li>Nilai (Rp) opsional, hanya terlihat oleh Direktur/Finance/Admin dan pelapor.</li>
        <li>Aktivitas tidak bisa dihapus.</li>
      </ul>
    </Card>
  )
}

export async function FieldActivityNew(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_CREATORS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const sp = spOf(props)
  const d = await withReqTransaction(req, async () => {
    const companies = gate.companies.filter((c) => mayCreateIn(req, c))
    const projects = await fieldProjects(req, ['aftersales'], companies)
    const clients = await clientsOf(req, [...new Set(projects.map((p) => p.companyId))])
    const today = await todayOf(req, companies[0])
    return { projects, clients, today, pt: await ptView(req) }
  })
  const kind = one(sp.jenis)
  return (
    <FieldFrame props={props} name="aktivitas-baru">
      <DashHead title="Catat aktivitas aftersales" note="Satu baris per aktivitas · bisa diedit pelapor 24 jam, setelah itu koreksi oleh PM/Direktur">
        <div className="pk-kact">
          <BtnLink href={listHref} icon="arrowLeft">
            Aktivitas aftersales
          </BtnLink>
        </div>
      </DashHead>
      <Bento>
        <Card id="activity-form" title="Aktivitas baru" span={8}>
          {d.projects.length === 0 ? (
            <EmptyState text="Tidak ada project aftersales yang dapat Anda laporkan (Staff: project yang ditugaskan; PM: project tim)." />
          ) : (
            <ActivityForm
              projects={ptOptionsOf(d.projects, d.pt).map((p) => ({ id: p.id, label: p.label, companyId: p.companyId, clientId: p.clientId }))}
              clients={d.clients}
              ptCodes={d.pt.multi ? ptCodes(d.pt) : undefined}
              today={d.today}
              minDate={addDays(d.today, -BACKDATE_MAX_DAYS)}
              initial={{ project: idParam(sp.project), client: idParam(sp.pelanggan), kind: (ACTIVITY_KINDS as readonly string[]).includes(kind ?? '') ? (kind as ActivityKind) : undefined, relatesTo: idParam(sp.po) }}
            />
          )}
        </Card>
        <ActivityRules />
      </Bento>
    </FieldFrame>
  )
}

// ================================================================ detail

export async function FieldActivityDetail(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_READERS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const sp = spOf(props)
  const id = segmentNum(props, 3)
  const d = await withReqTransaction(req, async () => {
    const doc = id ? await visibleFieldDoc<ActivityDoc>(req, 'aftersales_activity', id) : null
    if (!doc) return null
    const a = await activityDto(req, doc)
    const related = a.kind === 'po_masuk' ? await activityDtos(req, await scopedFind<ActivityDoc>(req, 'aftersales-activities', [{ relatesTo: { equals: a.id } }], 100, 'activityDate')) : []
    const co = a.companyId ? await companyById(req, a.companyId).catch(() => null) : null
    return { a, related, history: await historyOf(req, 'aftersales_activity', a.id), tz: co?.timezone || process.env.TZ || DEFAULT_TZ, today: await todayOf(req, a.companyId) }
  })
  const back = (
    <BtnLink href={listHref} icon="arrowLeft">
      Aktivitas aftersales
    </BtnLink>
  )
  if (!d) {
    return (
      <FieldFrame props={props} name="aktivitas-detail">
        <DashHead title="Aktivitas tidak ditemukan">{back}</DashHead>
      </FieldFrame>
    )
  }
  const { a, related, history, tz, today } = d
  const kind = a.kind as ActivityKind
  const rates = mayReadRates(req, a.companyId)
  const showValue = a.valueVisible
  const open = kind === 'po_masuk' && a.poStatus !== null && OPEN_PO_STATUSES.includes(a.poStatus as PoStatus)
  const creator = mayCreateIn(req, a.companyId ?? 0)
  const items = a.items as Array<{ name: string; partNo?: string | null; qty: number; uom?: string | null }>
  return (
    <FieldFrame props={props} name="aktivitas-detail">
      <DashHead title={`${ACTIVITY_KIND_LABELS[kind]}${a.docNo ? ` · ${a.docNo}` : ''}`} note={`${longDate(a.activityDate)} · ${a.client.name ?? '—'} · ${a.project.code ?? ''} ${a.project.name ?? ''}`}>
        <div className="pk-kact">
          {back}
          {open && creator ? (
            <BtnLink href={newHref({ project: a.project.id, pelanggan: a.client.id, jenis: 'pengiriman', po: a.id })} primary icon="add" attr="catat-pengiriman">
              Catat pengiriman
            </BtnLink>
          ) : null}
          {a.editable ? (
            <EditLink href={editHref(a.id)} action="activity-edit" primary>
              Ubah (24 jam)
            </EditLink>
          ) : null}
          {mayCorrectIn(req, a.companyId) ? (
            <EditLink href={editHref(a.id, true)} action="activity-correct">
              Koreksi
            </EditLink>
          ) : null}
        </div>
      </DashHead>
      {one(sp.baru) === '1' ? (
        <Alert tone="ok" attr="created">
          <p>Aktivitas tersimpan.</p>
        </Alert>
      ) : one(sp.disimpan) === '1' ? (
        <Alert tone="ok" attr="saved">
          <p>Perubahan tersimpan dan tercatat di riwayat.</p>
        </Alert>
      ) : null}
      {a.flags.length ? (
        <Alert tone="info" attr="flags">
          <p>
            Tanda: <FlagPills flags={a.flags} />
          </p>
        </Alert>
      ) : null}
      <Bento label="Aktivitas aftersales">
        <KpiRow cols={showValue ? 4 : 3}>
          <KpiTile id="a-kind" icon="doc" label="Jenis" value={ACTIVITY_KIND_LABELS[kind]} kpi="activity-kind" i={0}>
            <p className="pk-kpi-x">{a.docNo ?? 'tanpa no. dokumen'}</p>
          </KpiTile>
          <KpiTile id="a-client" icon="users" label="Pelanggan" value={a.client.name ?? '—'} kpi="activity-client" i={1} />
          <KpiTile
            id="a-po"
            icon="inbox"
            label={kind === 'po_masuk' ? 'Status PO' : 'PO terkait'}
            value={kind === 'po_masuk' ? (a.poStatus ? <StatusPill tone={a.poStatus === 'terkirim' ? 'ok' : a.poStatus === 'batal' ? 'none' : 'warn'} label={PO_STATUS_LABELS[a.poStatus as PoStatus]} /> : '—') : (a.relatesTo?.docNo ?? (a.relatesTo ? `PO #${a.relatesTo.id}` : '—'))}
            kpi="activity-po"
            i={2}
          >
            <p className="pk-kpi-x">{kind === 'po_masuk' ? `umur ${Math.max(0, Math.round((Date.parse(today) - Date.parse(a.activityDate)) / 86_400_000))} hari · ${related.filter((r) => r.kind === 'pengiriman').length} pengiriman` : a.relatesTo?.activityDate ? `PO tanggal ${dateId(a.relatesTo.activityDate)}` : ''}</p>
          </KpiTile>
          {showValue ? (
            <KpiTile id="a-value" icon="wallet" label="Nilai" value={a.value === null ? '—' : rp(a.value)} kpi="activity-value" i={3}>
              <p className="pk-kpi-x">{rates ? 'Direktur/Finance/Admin' : 'diisi oleh Anda'}</p>
            </KpiTile>
          ) : null}
        </KpiRow>
        <Card id="activity-items" title="Item" span={7} i={4}>
          <DataTable
            id="activity-items"
            caption="Item"
            rows={items.map((x, i) => ({ ...x, i }))}
            rowKey={(x) => x.i}
            cols={[
              { key: 'n', label: 'Nama', cell: (x) => x.name },
              { key: 'p', label: 'No. part', cell: (x) => x.partNo ?? '—' },
              { key: 'q', label: 'Jumlah', num: true, cell: (x) => fmtNum(x.qty, 3) },
              { key: 'u', label: 'Satuan', cell: (x) => x.uom ?? '—' },
            ]}
            empty={<EmptyState text="Tanpa item." />}
          />
          <dl className="pk-dl" style={{ marginTop: 14 }}>
            {kind === 'penawaran' ? (
              <>
                <dt>Follow-up</dt>
                <dd>{a.followUpDate ? longDate(a.followUpDate) : '—'}</dd>
              </>
            ) : null}
            {kind === 'pengiriman' ? (
              <>
                <dt>Penerima</dt>
                <dd>{a.receiver ?? '—'}</dd>
              </>
            ) : null}
            {a.relatesTo ? (
              <>
                <dt>Untuk PO</dt>
                <dd>
                  <Link href={detailHref(a.relatesTo.id)} prefetch={false}>
                    {a.relatesTo.docNo ?? `PO #${a.relatesTo.id}`}
                  </Link>
                </dd>
              </>
            ) : null}
            <dt>Catatan</dt>
            <dd className="pk-pre">{a.notes ?? '—'}</dd>
          </dl>
        </Card>
        <Card id="activity-meta" title="Pelaporan" span={5} i={5}>
          <MetaRows d={a} tz={tz} />
        </Card>
        {kind === 'po_masuk' ? (
          <Card id="activity-related" title="Pengiriman & penagihan PO ini" span={7} i={6}>
            <ActivityTable rows={related} rates={false} pt={{ multi: false, selected: [], labels: new Map(), ref: () => null }} />
          </Card>
        ) : null}
        <Card id="activity-photos" title="Foto bukti" span={kind === 'po_masuk' ? 5 : 7} i={7}>
          <PhotoGallery photos={a.photos} label={`aktivitas ${a.docNo ?? a.id}`} empty="Tanpa foto." />
        </Card>
        <Card id="activity-history" title="Riwayat & koreksi" span={kind === 'po_masuk' ? 12 : 5} i={8}>
          <History entries={history} tz={tz} />
        </Card>
      </Bento>
    </FieldFrame>
  )
}

// ================================================================ edit / correction (UI feedback 17/10 #5)

/**
 * `/aftersales/aktivitas/:id/ubah` — the reporter's edit within 24 h, `?koreksi=1` the PM / Direktur correction: the
 * quick-input form (`ActivityForm`, same fields, order and "Aturan" card) with project, customer, date, kind and PO
 * disabled, the stored values and photos, "Status PO" (correction of a PO masuk) and "Alasan" last. Who may open it =
 * who saw the former dialog; the API re-checks everything.
 */
export async function FieldActivityEdit(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_READERS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const mode = editModeOf(spOf(props))
  const id = segmentNum(props, 2)
  const d = await withReqTransaction(req, async () => {
    const doc = id ? await visibleFieldDoc<ActivityDoc>(req, 'aftersales_activity', id) : null
    if (!doc) return null
    const a = await activityDto(req, doc)
    return { a, today: await todayOf(req, a.companyId) }
  })
  const back = (id2: number | null) => (
    <BtnLink href={id2 ? detailHref(id2) : listHref} icon="arrowLeft">
      {id2 ? 'Kembali ke aktivitas' : 'Aktivitas aftersales'}
    </BtnLink>
  )
  if (!d) {
    return (
      <FieldFrame props={props} name="aktivitas-ubah">
        <DashHead title="Aktivitas tidak ditemukan">{back(null)}</DashHead>
      </FieldFrame>
    )
  }
  const { a } = d
  const kind = a.kind as ActivityKind
  const allowed = mode === 'edit' ? a.editable : mayCorrectIn(req, a.companyId)
  const title = `${mode === 'edit' ? 'Ubah' : 'Koreksi'} ${ACTIVITY_KIND_LABELS[kind]}${a.docNo ? ` · ${a.docNo}` : ''}`
  if (!allowed || a.companyId === null) {
    return (
      <FieldFrame props={props} name="aktivitas-ubah">
        <DashHead title={title}>{back(a.id)}</DashHead>
        <Alert tone="bad" attr="not-editable">
          <p>{mode === 'edit' ? 'Aktivitas ini tidak dapat diubah lagi: hanya pelapor, dalam 24 jam sejak dibuat. Setelah itu koreksi oleh PM project / Direktur.' : 'Koreksi aktivitas hanya oleh PM project (tim) atau Direktur.'}</p>
        </Alert>
      </FieldFrame>
    )
  }
  const companyId = a.companyId
  return (
    <FieldFrame props={props} name="aktivitas-ubah">
      <DashHead title={title} note={mode === 'edit' ? 'Pelapor, dalam 24 jam sejak dibuat · hanya isian yang berubah yang dikirim · tercatat di riwayat' : 'Koreksi PM project / Direktur dengan alasan · PO yang dibatalkan tidak dapat dibuka lagi'}>
        <div className="pk-kact">{back(a.id)}</div>
      </DashHead>
      <Bento>
        <Card id="activity-form" title={mode === 'edit' ? 'Ubah aktivitas (24 jam)' : 'Koreksi aktivitas'} span={8}>
          <ActivityForm
            mode={mode}
            activity={{
              id: a.id,
              projectId: a.project.id,
              clientId: a.client.id,
              kind,
              activityDate: a.activityDate,
              docNo: a.docNo,
              items: a.items as Array<{ name: string; partNo?: string | null; qty: number; uom?: string | null }>,
              value: a.valueVisible ? a.value : null,
              valueVisible: a.valueVisible,
              followUpDate: a.followUpDate,
              receiver: a.receiver,
              relatesTo: a.relatesTo ? { id: a.relatesTo.id, label: a.relatesTo.docNo ?? `PO #${a.relatesTo.id}` } : null,
              poStatus: (a.poStatus as PoStatus | null) ?? null,
              notes: a.notes,
              photos: a.photos.map((p) => ({ id: p.id, url: p.url, thumbUrl: p.thumbUrl })),
            }}
            projects={[{ id: a.project.id, label: `${a.project.code ?? ''} ${a.project.name ?? ''}`.trim(), companyId, clientId: a.client.id }]}
            clients={[{ id: a.client.id, name: a.client.name ?? `Pelanggan #${a.client.id}`, companyId }]}
            today={d.today}
            minDate={a.activityDate}
          />
        </Card>
        <ActivityRules />
      </Bento>
    </FieldFrame>
  )
}
