import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { ServiceReportForm, type SvUnit } from '@/admin/components/field/ServiceReportForm'
import { companyById } from '@/domain/companies'
import { addDays, BACKDATE_MAX_DAYS, MAX_PHOTOS, serviceTypeNames, UNIT_STATUS_LABELS, UNIT_STATUSES, unitClientMismatch, type UnitStatus } from '@/domain/field/rules'
import { listServiceReports, serviceDto, type ServiceDoc, type ServiceDto } from '@/domain/field/service'
import { listServiceTypes } from '@/domain/field/service-types'
import { fmtNum, longDate } from '@/domain/field/views'
import { contractsOf, fieldProjects, historyOf, mayCorrectIn, mayCreateIn, reportersOf, todayOf, unitsOf, visibleFieldDoc } from '@/domain/field/web'
import { hasRoleAny } from '@/access/roles'
import { withReqTransaction } from '@/lib/system-tx'
import { DEFAULT_TZ } from '@/lib/time'
import { AutoSubmit } from '@/admin/components/list/AutoSubmit'
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, parseListQuery } from '@/admin/list-query'

import { PageHead } from './frame'
import { BtnLink, dateParam, EditLink, editModeOf, FIELD_CREATORS, FIELD_READERS, FieldFrame, fieldGate, FlagPills, History, idParam, MetaRows, one, OpenAction, PhotoGallery, segmentNum, spOf, UnitStatusPill } from './field-ui'
import { ptOptionsOf, ptView, PtChip } from './pt'
import { Alert, dateId } from './progress-ui'
import { Bento, Card, DataTable, EmptyState, KpiRow, KpiTile, type Col } from './viz'
import { DateInput } from '../components/DateInput'
import { ImageThumb } from '../components/media/ImageThumb'

/**
 * FR1 "Laporan servis unit" (ADR 0020, plan A; mockups Android-Servis + Web-Timeline): list (filters
 * project, unit, mechanic, unit status, date; newest first, cursor), detail (all fields, spare parts,
 * photo gallery, history incl. corrections; reporter edit ≤ 24 h, PM/Direktur correction with a
 * required reason) and the web input form (POST /api/v1/service-reports with photos via
 * /api/v1/media/progress-photos). Rows in the caller's read scope (collection access).
 *
 * DRMS owner 2026-10-17: "Jenis servis" = one or more types of the PT master `service-types` (names joined ", " in the
 * list / detail; list filter "Jenis servis"; multi-select in the form, "Ubah (24 jam)" and "Koreksi" — a type
 * deactivated since stays selectable there as "(nonaktif)" while it is on the report); no "No. part" input for spare
 * parts (the detail shows the column only for old lines that have one); ≤ 25 photos, the edit / correction pages may
 * ADD photos up to that total (never remove).
 */
const listHref = '/admin/laporan-servis'
const detailHref = (id: number) => `/admin/laporan-servis/detail/${id}`
/** UI feedback 17/10 #5: edit (reporter, 24 h) / correction (PM / Direktur) page = the input form, same layout. */
const editHref = (id: number, correction = false) => `/admin/laporan-servis/${id}/ubah${correction ? '?koreksi=1' : ''}`

export async function FieldServiceList(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_READERS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const sp = spOf(props)
  const status = one(sp.status)
  const q = {
    project: idParam(sp.project),
    unit: idParam(sp.unit),
    reporter: idParam(sp.mekanik),
    serviceType: idParam(sp.jenis),
    status: (UNIT_STATUSES as readonly string[]).includes(status ?? '') ? (status as UnitStatus) : undefined,
    from: dateParam(sp.dari),
    to: dateParam(sp.sampai),
    before: idParam(sp.sebelum),
  }
  // DRMS 10/10 D8: text search + page size (shared list query; the cursor stays `sebelum`)
  const lq = parseListQuery(props.searchParams)
  const d = await withReqTransaction(req, async () => {
    const page = await listServiceReports(req, { projectId: q.project, unitId: q.unit, reporterId: q.reporter, status: q.status, serviceTypeId: q.serviceType, from: q.from, to: q.to, limit: lq.per, after: q.before, companyIds: gate.companies, q: lq.q })
    const projects = await fieldProjects(req, ['kontrak_unit', 'aftersales'], gate.companies, { includeArchived: true })
    const units = await unitsOf(req, gate.companies)
    const reporters = await reportersOf(req, 'service-reports')
    const types = await listServiceTypes(req, { companyIds: gate.companies, includeInactive: true })
    return { page, projects, units, reporters, types, pt: await ptView(req) }
  })
  const filtered = Boolean(q.project || q.unit || q.reporter || q.serviceType || q.status || q.from || q.to || lq.q)
  const keep = (extra: Record<string, string>) => {
    const u = new URLSearchParams()
    if (q.project) u.set('project', String(q.project))
    if (q.unit) u.set('unit', String(q.unit))
    if (q.reporter) u.set('mekanik', String(q.reporter))
    if (q.serviceType) u.set('jenis', String(q.serviceType))
    if (q.status) u.set('status', q.status)
    if (q.from) u.set('dari', q.from)
    if (q.to) u.set('sampai', q.to)
    if (lq.q) u.set('q', lq.q)
    if (lq.per !== DEFAULT_PAGE_SIZE) u.set('per', String(lq.per))
    for (const [k, v] of Object.entries(extra)) u.set(k, v)
    return `${listHref}?${u.toString()}`
  }
  const creator = hasRoleAny(req, ...FIELD_CREATORS) && gate.companies.some((c) => mayCreateIn(req, c))
  const cols: Col<ServiceDto>[] = [
    { key: 'date', label: 'Tanggal', sort: 'descending', cell: (r) => <span className="nw">{dateId(r.reportDate)}</span> },
    {
      key: 'no',
      label: 'Laporan',
      cell: (r) => (
        <>
          <b>{r.docNo ?? `#${r.id}`}</b> {r.flags.includes('CORRECTED') ? <small>(dikoreksi)</small> : null}
          <span className="sub" title={r.action}>
            {serviceTypeNames(r.serviceTypes, r.serviceType)} · {r.action}
          </span>
        </>
      ),
    },
    {
      key: 'unit',
      label: 'Unit',
      cell: (r) => (
        <>
          {r.unit.label ?? `#${r.unit.id}`}
          <span className="sub">{r.hourMeter !== null ? `HM ${fmtNum(r.hourMeter)}` : 'tanpa HM'}</span>
        </>
      ),
    },
    {
      key: 'proj',
      label: 'Project',
      sec: true,
      cell: (r) => (
        <>
          {d.pt.multi ? <PtChip pt={d.pt.ref(r.companyId)} /> : null} {r.project.code} {r.project.name}
        </>
      ),
    },
    { key: 'st', label: 'Status unit', cell: (r) => <UnitStatusPill status={r.unitStatusAfter} /> },
    {
      key: 'ph',
      label: 'Foto',
      sec: true,
      cell: (r) =>
        r.photos.length === 0 ? (
          '—'
        ) : (
          // D2510 (web 0.21.1): real previews (lightbox group = the report)
          <span className="pk-thumbs" data-pk-report-thumbs={r.id}>
            {r.photos.slice(0, 3).map((p, i) => (
              <ImageThumb key={p.id} src={{ href: p.url, thumb: p.thumbUrl, fallback: 'full' }} size={36} group={`service-list-${r.id}`} title={`Foto ${i + 1} laporan servis ${r.docNo ?? r.id}`} caption={dateId(r.reportDate)} data-pk-photo={p.id} />
            ))}
            {r.photos.length > 3 ? <small>+{r.photos.length - 3}</small> : null}
          </span>
        ),
    },
    { key: 'by', label: 'Mekanik', sec: true, cell: (r) => r.reporter.name ?? '—' },
    { key: 'act', label: 'Aksi', cell: (r) => <OpenAction href={detailHref(r.id)} name={`laporan servis ${r.docNo ?? r.id}`} /> },
  ]
  return (
    <FieldFrame props={props} name="laporan-servis">
      <PageHead props={props} title="Laporan servis unit" note="Terbaru di atas · servis, perbaikan, inspeksi dan pemasangan unit · status unit ikut laporan terakhir">
        <div className="pk-kact">
          {creator ? (
            <BtnLink href="/admin/laporan-servis/baru" primary icon="add" attr="servis-baru">
              Laporan servis baru
            </BtnLink>
          ) : null}
          <BtnLink href="/admin/unit-kontrak" attr="unit-kontrak">
            Unit & kontrak
          </BtnLink>
        </div>
      </PageHead>
      <form className="pk-filter" method="get" action={listHref} role="search" aria-label="Filter laporan servis" data-pk-filter="laporan-servis">
        <label className="pk-filter__search">
          Cari
          <input type="search" name="q" defaultValue={lq.q} placeholder="Nomor, keluhan, tindakan…" maxLength={100} autoComplete="off" data-pk-search="laporan-servis" />
        </label>
        <label>
          Project
          <select name="project" defaultValue={q.project ? String(q.project) : ''}>
            <option value="">Semua project</option>
            {ptOptionsOf(d.projects, d.pt).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Unit
          <select name="unit" defaultValue={q.unit ? String(q.unit) : ''}>
            <option value="">Semua unit</option>
            {ptOptionsOf(d.units, d.pt).map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mekanik
          <select name="mekanik" defaultValue={q.reporter ? String(q.reporter) : ''}>
            <option value="">Semua</option>
            {d.reporters.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Jenis servis
          <select name="jenis" defaultValue={q.serviceType ? String(q.serviceType) : ''}>
            <option value="">Semua</option>
            {ptOptionsOf(
              d.types.map((t) => ({ id: t.id, companyId: t.companyId, label: `${t.name}${t.active ? '' : ' (nonaktif)'}` })),
              d.pt,
            ).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status unit
          <select name="status" defaultValue={q.status ?? ''}>
            <option value="">Semua</option>
            {UNIT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {UNIT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
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
          Per halaman
          <select name="per" defaultValue={String(lq.per)} data-pk-page-size="laporan-servis">
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
      <Bento label="Daftar laporan servis">
        <Card id="service-reports" title="Laporan" sub={`${d.page.items.length}${d.page.nextCursor ? '+' : ''} laporan${filtered ? ' (terfilter)' : ''}`}>
          <DataTable
            id="service-reports"
            cols={cols}
            rows={d.page.items}
            rowKey={(r) => r.id}
            rowAttrs={(r) => ({ 'data-pk-row': r.docNo ?? String(r.id) })}
            caption="Laporan servis"
            empty={<EmptyState text={filtered ? 'Tidak ada laporan untuk filter ini.' : 'Belum ada laporan servis.'} action={filtered ? { href: listHref, label: 'Hapus filter' } : undefined} />}
          />
          <nav className="pk-actions" aria-label="Halaman laporan" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
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

// ================================================================ web input

/** "Aturan" card of the input AND the edit page (UI feedback 17/10 #5: same layout). */
function ServiceRules() {
  return (
    <Card id="service-help" title="Aturan" span={4}>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
        <li>HM tidak boleh lebih kecil dari HM terakhir unit (salah ketik: koreksi oleh PM/Direktur).</li>
        <li>Status unit setelah servis mengubah status unit; “Menunggu part” memberi notifikasi ke PM.</li>
        <li>Sparepart hanya dicatat (tanpa stok).</li>
        <li>Jenis servis boleh lebih dari satu (daftar diatur Admin/Direktur di Master Data).</li>
        <li>Maks. 25 foto sebelum/sesudah.</li>
        <li>Laporan tidak bisa dihapus.</li>
      </ul>
    </Card>
  )
}

export async function FieldServiceNew(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_CREATORS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const sp = spOf(props)
  const d = await withReqTransaction(req, async () => {
    const companies = gate.companies.filter((c) => mayCreateIn(req, c))
    const projects = await fieldProjects(req, ['kontrak_unit', 'aftersales'], companies)
    const contracts = await contractsOf(req, projects.filter((p) => p.kind === 'kontrak_unit').map((p) => p.id))
    const units = await unitsOf(req, companies, { activeOnly: true })
    const today = await todayOf(req, companies[0])
    // DRMS owner 2026-10-17: active "Jenis servis" of the PTs the caller may report in
    const serviceTypes = (await listServiceTypes(req, { companyIds: companies })).map((t) => ({ id: t.id, companyId: t.companyId, name: t.name }))
    return { projects, contracts, units, today, serviceTypes, pt: await ptView(req) }
  })
  const unitsByProject: Record<string, number[]> = {}
  for (const p of d.projects) {
    unitsByProject[String(p.id)] =
      p.kind === 'kontrak_unit'
        ? [...new Set(d.contracts.filter((c) => c.projectId === p.id).map((c) => c.unitId))]
        : d.units.filter((u) => u.companyId === p.companyId && !unitClientMismatch({ owner: u.owner, client: u.client?.id ?? null }, p.clientId)).map((u) => u.id)
  }
  const units: SvUnit[] = d.units.map((u) => ({
    id: u.id,
    label: u.label,
    sub: [u.type, u.owner === 'pelanggan' ? `milik ${u.client?.name ?? 'pelanggan'}` : 'milik sendiri', u.serialNo ? `SN ${u.serialNo}` : null, UNIT_STATUS_LABELS[u.status]].filter(Boolean).join(' · '),
    lastHm: u.lastHourMeter,
    status: u.status,
  }))
  return (
    <FieldFrame props={props} name="servis-baru">
      <PageHead props={props} title="Laporan servis unit" note="Nomor SV dibuat otomatis · bisa diedit pelapor 24 jam, setelah itu koreksi oleh PM/Direktur">
        <div className="pk-kact">
          <BtnLink href={listHref} icon="arrowLeft">
            Laporan servis
          </BtnLink>
        </div>
      </PageHead>
      <Bento>
        <Card id="service-form" title="Laporan baru" span={8}>
          {d.projects.length === 0 ? (
            <EmptyState text="Tidak ada project kontrak unit / aftersales yang dapat Anda laporkan (Staff: project yang ditugaskan; PM: project tim)." />
          ) : (
            <ServiceReportForm projects={ptOptionsOf(d.projects, d.pt).map((p) => ({ id: p.id, label: p.label, companyId: p.companyId, kind: p.kind }))} units={units} unitsByProject={unitsByProject} serviceTypes={d.serviceTypes} today={d.today} minDate={addDays(d.today, -BACKDATE_MAX_DAYS)} initialProject={idParam(sp.project)} initialUnit={idParam(sp.unit)} />
          )}
        </Card>
        <ServiceRules />
      </Bento>
    </FieldFrame>
  )
}

// ================================================================ detail

export async function FieldServiceDetail(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_READERS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const sp = spOf(props)
  const id = segmentNum(props, 2)
  const d = await withReqTransaction(req, async () => {
    const doc = id ? await visibleFieldDoc<ServiceDoc>(req, 'service_report', id) : null
    if (!doc) return null
    const r = await serviceDto(req, doc)
    const co = r.companyId ? await companyById(req, r.companyId).catch(() => null) : null
    return { r, history: await historyOf(req, 'service_report', r.id), tz: co?.timezone || process.env.TZ || DEFAULT_TZ }
  })
  const back = (
    <BtnLink href={listHref} icon="arrowLeft">
      Laporan servis
    </BtnLink>
  )
  if (!d) {
    return (
      <FieldFrame props={props} name="servis-detail">
        <PageHead props={props} title="Laporan tidak ditemukan">{back}</PageHead>
      </FieldFrame>
    )
  }
  const { r, history, tz } = d
  const unitName = r.unit.label ?? `Unit #${r.unit.id}`
  const parts = r.spareparts as Array<{ name: string; partNo?: string | null; qty: number; uom?: string | null; note?: string | null }>
  // "No. part" is no longer entered (DRMS owner 2026-10-17): the column only for old lines that carry one
  const withPartNo = parts.some((p) => typeof p.partNo === 'string' && p.partNo.trim() !== '')
  const partCols: Col<(typeof parts)[number] & { i: number }>[] = [
    { key: 'n', label: 'Nama', cell: (p) => p.name },
    ...(withPartNo ? [{ key: 'pn', label: 'No. part', cell: (p: (typeof parts)[number]) => p.partNo || '—' }] : []),
    { key: 'q', label: 'Jumlah', num: true, cell: (p) => fmtNum(p.qty, 3) },
    { key: 'u', label: 'Satuan', cell: (p) => p.uom ?? '—' },
    { key: 'k', label: 'Keterangan', sec: true, cell: (p) => p.note ?? '—' },
  ]
  return (
    <FieldFrame props={props} name="servis-detail">
      <PageHead props={props} title={r.docNo ?? `Laporan servis #${r.id}`} note={`${longDate(r.reportDate)} · ${unitName} · ${r.project.code ?? ''} ${r.project.name ?? ''}`}>
        <div className="pk-kact">
          {back}
          <BtnLink href={`/admin/unit-kontrak/unit/${r.unit.id}`}>Unit</BtnLink>
          {r.editable ? (
            <EditLink href={editHref(r.id)} action="service-edit" primary>
              Ubah (24 jam)
            </EditLink>
          ) : null}
          {mayCorrectIn(req, r.companyId) ? (
            <EditLink href={editHref(r.id, true)} action="service-correct">
              Koreksi
            </EditLink>
          ) : null}
        </div>
      </PageHead>
      {one(sp.baru) === '1' ? (
        <Alert tone="ok" attr="created">
          <p>Laporan servis tersimpan{r.unitStatusAfter === 'menunggu_part' ? ' — PM project diberi notifikasi unit menunggu part' : ''}.</p>
        </Alert>
      ) : one(sp.disimpan) === '1' ? (
        <Alert tone="ok" attr="saved">
          <p>Perubahan tersimpan dan tercatat di riwayat.</p>
        </Alert>
      ) : null}
      {r.flags.length ? (
        <Alert tone="info" attr="flags">
          <p>
            Tanda: <FlagPills flags={r.flags} />
          </p>
        </Alert>
      ) : null}
      <Bento label="Laporan servis">
        <KpiRow cols={4}>
          <KpiTile id="s-status" icon="check" label="Status unit setelah servis" value={<UnitStatusPill status={r.unitStatusAfter} />} kpi="service-status" i={0} />
          <KpiTile id="s-type" icon="doc" label="Jenis servis" value={serviceTypeNames(r.serviceTypes, r.serviceType)} kpi="service-type" i={1} />
          <KpiTile id="s-hm" icon="clock" label="HM saat servis" value={fmtNum(r.hourMeter)} kpi="service-hm" i={2}>
            <p className="pk-kpi-x">{r.startTime || r.endTime ? `${r.startTime ?? '—'} – ${r.endTime ?? '—'}` : 'jam tidak diisi'}</p>
          </KpiTile>
          <KpiTile id="s-parts" icon="inbox" label="Sparepart / foto" value={`${parts.length} / ${r.photos.length}`} kpi="service-parts" i={3}>
            <p className="pk-kpi-x">foto maks. {MAX_PHOTOS.service_report}</p>
          </KpiTile>
        </KpiRow>
        <Card id="service-body" title="Pekerjaan" span={7} i={4}>
          <dl className="pk-dl">
            <dt>Keluhan</dt>
            <dd className="pk-pre" data-pk-field="complaint">
              {r.complaint ?? '—'}
            </dd>
            <dt>Tindakan</dt>
            <dd className="pk-pre" data-pk-field="action">
              {r.action}
            </dd>
            <dt>Mekanik</dt>
            <dd>{r.reporter.name ?? '—'}</dd>
            <dt>Helper</dt>
            <dd>{r.helpers ?? '—'}</dd>
            <dt>Catatan</dt>
            <dd className="pk-pre">{r.notes ?? '—'}</dd>
          </dl>
        </Card>
        <Card id="service-meta" title="Rincian" span={5} i={5}>
          <dl className="pk-dl" style={{ marginBottom: 12 }}>
            <dt>Unit</dt>
            <dd>
              <Link href={`/admin/unit-kontrak/unit/${r.unit.id}`} prefetch={false}>
                {unitName}
              </Link>
              {r.unit.owner === 'pelanggan' ? ' · milik pelanggan' : ''}
            </dd>
            <dt>Project</dt>
            <dd>
              {r.project.code} {r.project.name}
            </dd>
          </dl>
          <MetaRows d={r} tz={tz} />
        </Card>
        <Card id="service-parts" title="Sparepart dipakai" sub="Catatan saja — tanpa stok" i={6}>
          <DataTable
            id="service-parts"
            caption="Sparepart"
            rows={parts.map((p, i) => ({ ...p, i }))}
            rowKey={(p) => p.i}
            cols={partCols}
            empty={<EmptyState text="Tanpa sparepart." />}
          />
        </Card>
        <Card id="service-photos" title="Foto sebelum / sesudah" sub={r.photos.length ? 'Klik foto untuk ukuran penuh (tab baru)' : undefined} span={7} i={7}>
          <PhotoGallery photos={r.photos} label={`laporan ${r.docNo ?? r.id}`} empty="Laporan ini tanpa foto." caption={`${longDate(r.reportDate)} · ${unitName}`} />
        </Card>
        <Card id="service-history" title="Riwayat & koreksi" span={5} i={8}>
          <History entries={history} tz={tz} />
        </Card>
      </Bento>
    </FieldFrame>
  )
}

// ================================================================ edit / correction (UI feedback 17/10 #5)

/**
 * `/laporan-servis/:id/ubah` — the reporter's edit within 24 h, `?koreksi=1` the PM / Direktur correction: the input
 * form (`ServiceReportForm`, same sections, order and "Aturan" card) with project, unit and date disabled, the stored
 * values and photos, and "Alasan" last. Who may open it = who saw the former dialog (`editable` / `mayCorrectIn`);
 * the API re-checks everything (24 h window, team / role, HM_DECREASED, audit).
 */
export async function FieldServiceEdit(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_READERS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const mode = editModeOf(spOf(props))
  const id = segmentNum(props, 1)
  const d = await withReqTransaction(req, async () => {
    const doc = id ? await visibleFieldDoc<ServiceDoc>(req, 'service_report', id) : null
    if (!doc) return null
    const r = await serviceDto(req, doc)
    // options: the ACTIVE types of the report's PT + the attached ones deactivated since ("(nonaktif)", may stay selected)
    const types = r.companyId ? await listServiceTypes(req, { companyIds: [r.companyId] }) : []
    return { r, types, today: await todayOf(req, r.companyId) }
  })
  const back = (id2: number | null) => (
    <BtnLink href={id2 ? detailHref(id2) : listHref} icon="arrowLeft">
      {id2 ? 'Kembali ke laporan' : 'Laporan servis'}
    </BtnLink>
  )
  if (!d) {
    return (
      <FieldFrame props={props} name="servis-ubah">
        <PageHead props={props} title="Laporan tidak ditemukan">{back(null)}</PageHead>
      </FieldFrame>
    )
  }
  const { r, types, today } = d
  const allowed = mode === 'edit' ? r.editable : mayCorrectIn(req, r.companyId)
  const title = `${mode === 'edit' ? 'Ubah' : 'Koreksi'} ${r.docNo ?? `laporan servis #${r.id}`}`
  if (!allowed || r.companyId === null) {
    return (
      <FieldFrame props={props} name="servis-ubah">
        <PageHead props={props} title={title}>{back(r.id)}</PageHead>
        <Alert tone="bad" attr="not-editable">
          <p>{mode === 'edit' ? 'Laporan ini tidak dapat diubah lagi: hanya pelapor, dalam 24 jam sejak dibuat. Setelah itu koreksi oleh PM project / Direktur.' : 'Koreksi laporan servis hanya oleh PM project (tim) atau Direktur.'}</p>
        </Alert>
      </FieldFrame>
    )
  }
  const companyId = r.companyId
  const serviceTypes = [
    ...types.map((t) => ({ id: t.id, companyId, name: t.name })),
    ...r.serviceTypes.filter((t) => !types.some((x) => x.id === t.id)).map((t) => ({ id: t.id, companyId, name: `${t.name} (nonaktif)` })),
  ]
  const unitName = r.unit.label ?? `Unit #${r.unit.id}`
  const unit: SvUnit = {
    id: r.unit.id,
    label: unitName,
    sub: [r.unit.type, r.unit.owner === 'pelanggan' ? 'milik pelanggan' : r.unit.owner === 'sendiri' ? 'milik sendiri' : null].filter(Boolean).join(' · '),
    // no client-side "HM below the last reading" hint here: the unit's last HM may be this very report (server re-checks)
    lastHm: null,
    status: r.unitStatusAfter,
  }
  return (
    <FieldFrame props={props} name="servis-ubah">
      <PageHead props={props} title={title} note={mode === 'edit' ? 'Pelapor, dalam 24 jam sejak dibuat · hanya isian yang berubah yang dikirim · tercatat di riwayat' : 'Koreksi PM project / Direktur dengan alasan · laporan ditandai “dikoreksi”; status & HM terakhir unit dihitung ulang'}>
        <div className="pk-kact">{back(r.id)}</div>
      </PageHead>
      <Bento>
        <Card id="service-form" title={mode === 'edit' ? 'Ubah laporan (24 jam)' : 'Koreksi laporan'} span={8}>
          <ServiceReportForm
            mode={mode}
            report={{
              id: r.id,
              projectId: r.project.id,
              unitId: r.unit.id,
              reportDate: r.reportDate,
              hourMeter: r.hourMeter,
              startTime: r.startTime,
              endTime: r.endTime,
              serviceTypeIds: r.serviceTypes.map((t) => t.id),
              complaint: r.complaint,
              action: r.action,
              helpers: r.helpers,
              unitStatusAfter: r.unitStatusAfter as UnitStatus,
              spareparts: r.spareparts as Array<{ name: string; partNo?: string | null; qty: number; uom?: string | null; note?: string | null }>,
              notes: r.notes,
              photos: r.photos.map((p) => ({ id: p.id, url: p.url, thumbUrl: p.thumbUrl })),
            }}
            projects={[{ id: r.project.id, label: `${r.project.code ?? ''} ${r.project.name ?? ''}`.trim(), companyId, kind: r.project.kind ?? 'kontrak_unit' }]}
            units={[unit]}
            unitsByProject={{ [String(r.project.id)]: [r.unit.id] }}
            serviceTypes={serviceTypes}
            today={today}
            minDate={r.reportDate}
          />
        </Card>
        <ServiceRules />
      </Bento>
    </FieldFrame>
  )
}
