import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { CorrectionDialog, type CorrField } from '@/admin/components/field/CorrectionDialog'
import { ServiceReportForm, type SvUnit } from '@/admin/components/field/ServiceReportForm'
import { companyById } from '@/domain/companies'
import { addDays, BACKDATE_MAX_DAYS, SERVICE_TYPE_LABELS, SERVICE_TYPES, UNIT_STATUS_LABELS, UNIT_STATUSES, unitClientMismatch, type ServiceType, type UnitStatus } from '@/domain/field/rules'
import { listServiceReports, serviceDto, type ServiceDoc, type ServiceDto } from '@/domain/field/service'
import { fmtNum, longDate } from '@/domain/field/views'
import { contractsOf, fieldProjects, historyOf, mayCorrectIn, mayCreateIn, reportersOf, todayOf, unitsOf, visibleFieldDoc } from '@/domain/field/web'
import { hasRoleAny } from '@/access/roles'
import { withReqTransaction } from '@/lib/system-tx'
import { DEFAULT_TZ } from '@/lib/time'
import { AutoSubmit } from '@/admin/components/list/AutoSubmit'
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, parseListQuery } from '@/admin/list-query'

import { BtnLink, dateParam, FIELD_CREATORS, FIELD_READERS, FieldFrame, fieldGate, FlagPills, History, idParam, MetaRows, one, OpenAction, PhotoGallery, segmentNum, spOf, UnitStatusPill } from './field-ui'
import { ptView, PtChip } from './pt'
import { Alert, dateId } from './progress-ui'
import { Bento, Card, DashHead, DataTable, EmptyState, KpiRow, KpiTile, type Col } from './viz'
import { DateInput } from '../components/DateInput'

/**
 * FR1 "Laporan servis unit" (ADR 0020, plan A; mockups Android-Servis + Web-Timeline): list (filters
 * project, unit, mechanic, unit status, date; newest first, cursor), detail (all fields, spare parts,
 * photo gallery, history incl. corrections; reporter edit ≤ 24 h, PM/Direktur correction with a
 * required reason) and the web input form (POST /api/v1/service-reports with photos via
 * /api/v1/media/progress-photos). Rows in the caller's read scope (collection access).
 */
const listHref = '/admin/laporan-servis'
const detailHref = (id: number) => `/admin/laporan-servis/detail/${id}`

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
    status: (UNIT_STATUSES as readonly string[]).includes(status ?? '') ? (status as UnitStatus) : undefined,
    from: dateParam(sp.dari),
    to: dateParam(sp.sampai),
    before: idParam(sp.sebelum),
  }
  // DRMS 10/10 D8: text search + page size (shared list query; the cursor stays `sebelum`)
  const lq = parseListQuery(props.searchParams)
  const d = await withReqTransaction(req, async () => {
    const page = await listServiceReports(req, { projectId: q.project, unitId: q.unit, reporterId: q.reporter, status: q.status, from: q.from, to: q.to, limit: lq.per, after: q.before, companyIds: gate.companies, q: lq.q })
    const projects = await fieldProjects(req, ['kontrak_unit', 'aftersales'], gate.companies, { includeArchived: true })
    const units = await unitsOf(req, gate.companies)
    const reporters = await reportersOf(req, 'service-reports')
    return { page, projects, units, reporters, pt: await ptView(req) }
  })
  const filtered = Boolean(q.project || q.unit || q.reporter || q.status || q.from || q.to || lq.q)
  const keep = (extra: Record<string, string>) => {
    const u = new URLSearchParams()
    if (q.project) u.set('project', String(q.project))
    if (q.unit) u.set('unit', String(q.unit))
    if (q.reporter) u.set('mekanik', String(q.reporter))
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
            {SERVICE_TYPE_LABELS[r.serviceType as ServiceType] ?? r.serviceType} · {r.action}
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
          <span className="pk-thumbs">
            {r.photos.slice(0, 3).map((p) => (
              // eslint-disable-next-line @next/next/no-img-element -- authenticated API thumbnail
              <img key={p.id} src={p.thumbUrl} alt="" loading="lazy" width={36} height={28} />
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
      <DashHead title="Laporan servis unit" note="Terbaru di atas · servis, perbaikan, inspeksi dan pemasangan unit · status unit ikut laporan terakhir">
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
      </DashHead>
      <form className="pk-filter" method="get" action={listHref} role="search" aria-label="Filter laporan servis" data-pk-filter="laporan-servis">
        <label className="pk-filter__search">
          Cari
          <input type="search" name="q" defaultValue={lq.q} placeholder="Nomor, keluhan, tindakan…" maxLength={100} autoComplete="off" data-pk-search="laporan-servis" />
        </label>
        <label>
          Project
          <select name="project" defaultValue={q.project ? String(q.project) : ''}>
            <option value="">Semua project</option>
            {d.projects.map((p) => (
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
            {d.units.map((u) => (
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
    return { projects, contracts, units, today }
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
      <DashHead title="Laporan servis unit" note="Nomor SV dibuat otomatis · bisa diedit pelapor 24 jam, setelah itu koreksi oleh PM/Direktur">
        <div className="pk-kact">
          <BtnLink href={listHref} icon="arrowLeft">
            Laporan servis
          </BtnLink>
        </div>
      </DashHead>
      <Bento>
        <Card id="service-form" title="Laporan baru" span={8}>
          {d.projects.length === 0 ? (
            <EmptyState text="Tidak ada project kontrak unit / aftersales yang dapat Anda laporkan (Staff: project yang ditugaskan; PM: project tim)." />
          ) : (
            <ServiceReportForm projects={d.projects.map((p) => ({ id: p.id, label: p.label, companyId: p.companyId, kind: p.kind }))} units={units} unitsByProject={unitsByProject} today={d.today} minDate={addDays(d.today, -BACKDATE_MAX_DAYS)} initialProject={idParam(sp.project)} initialUnit={idParam(sp.unit)} />
          )}
        </Card>
        <Card id="service-help" title="Aturan" span={4}>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
            <li>HM tidak boleh lebih kecil dari HM terakhir unit (salah ketik: koreksi oleh PM/Direktur).</li>
            <li>Status unit setelah servis mengubah status unit; “Menunggu part” memberi notifikasi ke PM.</li>
            <li>Sparepart hanya dicatat (tanpa stok).</li>
            <li>Maks. 10 foto sebelum/sesudah.</li>
            <li>Laporan tidak bisa dihapus.</li>
          </ul>
        </Card>
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
        <DashHead title="Laporan tidak ditemukan">{back}</DashHead>
      </FieldFrame>
    )
  }
  const { r, history, tz } = d
  const fields: CorrField[] = [
    { name: 'hourMeter', label: 'HM saat servis', kind: 'decimal', value: r.hourMeter },
    { name: 'startTime', label: 'Jam mulai', kind: 'time', value: r.startTime },
    { name: 'endTime', label: 'Jam selesai', kind: 'time', value: r.endTime },
    { name: 'serviceType', label: 'Jenis servis', kind: 'select', value: r.serviceType, options: SERVICE_TYPES.map((t) => ({ value: t, label: SERVICE_TYPE_LABELS[t] })) },
    { name: 'unitStatusAfter', label: 'Status unit setelah servis', kind: 'select', value: r.unitStatusAfter, options: UNIT_STATUSES.map((t) => ({ value: t, label: UNIT_STATUS_LABELS[t] })) },
    { name: 'helpers', label: 'Helper', kind: 'text', value: r.helpers, max: 200 },
    { name: 'complaint', label: 'Keluhan', kind: 'textarea', value: r.complaint, max: 2000 },
    { name: 'action', label: 'Tindakan / pekerjaan', kind: 'textarea', value: r.action, max: 4000, required: true },
    { name: 'spareparts', label: 'Sparepart', kind: 'lines', value: r.spareparts as Array<{ name: string; qty: number }>, withNote: true },
    { name: 'notes', label: 'Catatan', kind: 'textarea', value: r.notes, max: 2000 },
  ]
  const unitName = r.unit.label ?? `Unit #${r.unit.id}`
  const parts = r.spareparts as Array<{ name: string; partNo?: string | null; qty: number; uom?: string | null; note?: string | null }>
  return (
    <FieldFrame props={props} name="servis-detail">
      <DashHead title={r.docNo ?? `Laporan servis #${r.id}`} note={`${longDate(r.reportDate)} · ${unitName} · ${r.project.code ?? ''} ${r.project.name ?? ''}`}>
        <div className="pk-kact">
          {back}
          <BtnLink href={`/admin/unit-kontrak/unit/${r.unit.id}`}>Unit</BtnLink>
          {r.editable ? (
            <CorrectionDialog url={`/api/v1/service-reports/${r.id}`} mode="edit" buttonLabel="Ubah (24 jam)" title="Ubah laporan servis" description="Anda pelapor dan masih dalam 24 jam. Hanya isian yang berubah yang dikirim." fields={fields} testId="service-edit" />
          ) : null}
          {mayCorrectIn(req, r.companyId) ? (
            <CorrectionDialog
              url={`/api/v1/service-reports/${r.id}/corrections`}
              mode="correction"
              buttonLabel="Koreksi"
              title="Koreksi laporan servis"
              description="Koreksi oleh PM project / Direktur, kapan saja, dengan alasan. Laporan ditandai “dikoreksi”; status & HM terakhir unit dihitung ulang."
              fields={fields}
              testId="service-correct"
            />
          ) : null}
        </div>
      </DashHead>
      {one(sp.baru) === '1' ? (
        <Alert tone="ok" attr="created">
          <p>Laporan servis tersimpan{r.unitStatusAfter === 'menunggu_part' ? ' — PM project diberi notifikasi unit menunggu part' : ''}.</p>
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
          <KpiTile id="s-type" icon="doc" label="Jenis servis" value={SERVICE_TYPE_LABELS[r.serviceType as ServiceType] ?? r.serviceType} kpi="service-type" i={1} />
          <KpiTile id="s-hm" icon="clock" label="HM saat servis" value={fmtNum(r.hourMeter)} kpi="service-hm" i={2}>
            <p className="pk-kpi-x">{r.startTime || r.endTime ? `${r.startTime ?? '—'} – ${r.endTime ?? '—'}` : 'jam tidak diisi'}</p>
          </KpiTile>
          <KpiTile id="s-parts" icon="inbox" label="Sparepart / foto" value={`${parts.length} / ${r.photos.length}`} kpi="service-parts" i={3}>
            <p className="pk-kpi-x">foto maks. 10</p>
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
            cols={[
              { key: 'n', label: 'Nama', cell: (p) => p.name },
              { key: 'pn', label: 'No. part', cell: (p) => p.partNo ?? '—' },
              { key: 'q', label: 'Jumlah', num: true, cell: (p) => fmtNum(p.qty, 3) },
              { key: 'u', label: 'Satuan', cell: (p) => p.uom ?? '—' },
              { key: 'k', label: 'Keterangan', sec: true, cell: (p) => p.note ?? '—' },
            ]}
            empty={<EmptyState text="Tanpa sparepart." />}
          />
        </Card>
        <Card id="service-photos" title="Foto sebelum / sesudah" sub={r.photos.length ? 'Klik foto untuk ukuran penuh (tab baru)' : undefined} span={7} i={7}>
          <PhotoGallery photos={r.photos} label={`laporan ${r.docNo ?? r.id}`} empty="Laporan ini tanpa foto." />
        </Card>
        <Card id="service-history" title="Riwayat & koreksi" span={5} i={8}>
          <History entries={history} tz={tz} />
        </Card>
      </Bento>
    </FieldFrame>
  )
}
