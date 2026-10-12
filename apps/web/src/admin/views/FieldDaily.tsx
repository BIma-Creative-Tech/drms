import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { DailyReportForm, type DrValues } from '@/admin/components/field/DailyReportForm'
import { RapImport } from '@/admin/components/field/RapImport'
import { hasRoleAny } from '@/access/roles'
import { companyById } from '@/domain/companies'
import { DAILY_FLAGS, WEATHER_LABELS, type Weather } from '@/domain/daily/rules'
import { dailyDto, listDailyReports, weeklyRecap, type DailyDoc, type DailyDto } from '@/domain/daily/service'
import { formItemsOf, formResourcesOf } from '@/domain/daily/web'
import { addDays, BACKDATE_MAX_DAYS } from '@/domain/field/rules'
import { fmtNum, longDate } from '@/domain/field/views'
import { fieldProjects, historyOf, mayCorrectIn, mayCreateIn, reportersOf, todayOf, visibleFieldDoc, visibleProject } from '@/domain/field/web'
import { loadRap } from '@/domain/rap/service'
import { withReqTransaction } from '@/lib/system-tx'
import { DEFAULT_TZ } from '@/lib/time'
import { AutoSubmit } from '@/admin/components/list/AutoSubmit'
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, parseListQuery } from '@/admin/list-query'

import { BtnLink, dateParam, FIELD_CREATORS, FIELD_READERS, FieldFrame, fieldGate, FlagPills, History, idParam, MetaRows, one, OpenAction, PhotoGallery, segmentNum, spOf } from './field-ui'
import { ptView, PtChip } from './pt'
import { Alert, dateId } from './progress-ui'
import { Bento, Card, DashHead, DataTable, EmptyState, KpiRow, KpiTile, type Col } from './viz'
import { DateInput } from '../components/DateInput'

/**
 * P3 "Laporan harian" konstruksi (owner decisions 2026-10-10; same fields as the APK): list (filters
 * project, reporter, date; newest first, cursor), input form, detail (weather, work volume per RAP item,
 * material, manpower / equipment, photos, ledger history; reporter edit ≤ 24 h, PM / Direktur
 * correction with a required reason) and the RAP page of a project (items, stage %, weekly recap
 * "Minggu ke-N", Excel template / import). Rows in the caller's read scope (collection access).
 */
const listHref = '/admin/laporan-harian'
const detailHref = (id: number) => `/admin/laporan-harian/detail/${id}`
const rapHref = (projectId: number) => `/admin/laporan-harian/rap/${projectId}`

const weatherText = (w: DailyDto['weather']) => {
  const parts = [w.morning, w.noon, w.afternoon].map((x) => (x ? WEATHER_LABELS[x as Weather] : '—'))
  return parts.every((p) => p === '—') ? '—' : parts.join(' / ')
}

export async function FieldDailyList(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_READERS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const sp = spOf(props)
  const q = { project: idParam(sp.project), reporter: idParam(sp.pelapor), from: dateParam(sp.dari), to: dateParam(sp.sampai), before: idParam(sp.sebelum) }
  // DRMS 10/10 D8: text search + page size (shared list query; the cursor stays `sebelum`)
  const lq = parseListQuery(props.searchParams)
  const d = await withReqTransaction(req, async () => {
    const page = await listDailyReports(req, { projectId: q.project, reporterId: q.reporter, from: q.from, to: q.to, limit: lq.per, after: q.before, companyIds: gate.companies, q: lq.q })
    const projects = await fieldProjects(req, ['konstruksi'], gate.companies, { includeArchived: true })
    const reporters = await reportersOf(req, 'daily-reports')
    return { page, projects, reporters, pt: await ptView(req) }
  })
  const filtered = Boolean(q.project || q.reporter || q.from || q.to || lq.q)
  const keep = (extra: Record<string, string>) => {
    const u = new URLSearchParams()
    if (q.project) u.set('project', String(q.project))
    if (q.reporter) u.set('pelapor', String(q.reporter))
    if (q.from) u.set('dari', q.from)
    if (q.to) u.set('sampai', q.to)
    if (lq.q) u.set('q', lq.q)
    if (lq.per !== DEFAULT_PAGE_SIZE) u.set('per', String(lq.per))
    for (const [k, v] of Object.entries(extra)) u.set(k, v)
    return `${listHref}?${u.toString()}`
  }
  const creator = hasRoleAny(req, ...FIELD_CREATORS) && gate.companies.some((c) => mayCreateIn(req, c))
  const cols: Col<DailyDto>[] = [
    { key: 'date', label: 'Tanggal', sort: 'descending', cell: (r) => <span className="nw">{dateId(r.reportDate)}</span> },
    {
      key: 'no',
      label: 'Laporan',
      cell: (r) => (
        <>
          <b>{r.docNo ?? `#${r.id}`}</b> {r.flags.includes(DAILY_FLAGS.corrected) ? <small>(dikoreksi)</small> : null}
          <span className="sub">
            {r.work.length} item pekerjaan · {r.workerCount} pekerja · cuaca {weatherText(r.weather)}
          </span>
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
    { key: 'fl', label: 'Tanda', cell: (r) => (r.flags.length ? <FlagPills flags={r.flags} /> : '—') },
    { key: 'ph', label: 'Foto', sec: true, num: true, cell: (r) => r.photos.length || '—' },
    { key: 'by', label: 'Pelapor', sec: true, cell: (r) => r.reporter.name ?? '—' },
    { key: 'act', label: 'Aksi', cell: (r) => <OpenAction href={detailHref(r.id)} name={`laporan harian ${r.docNo ?? r.id}`} /> },
  ]
  return (
    <FieldFrame props={props} name="laporan-harian">
      <DashHead title="Laporan harian" note="Project konstruksi · volume pekerjaan per item RAP menggerakkan progress tahapan · terbaru di atas">
        <div className="pk-kact">
          {creator ? (
            <BtnLink href="/admin/laporan-harian/baru" primary icon="add" attr="harian-baru">
              Laporan harian baru
            </BtnLink>
          ) : null}
          {q.project ? <BtnLink href={rapHref(q.project)}>RAP & rekap</BtnLink> : null}
        </div>
      </DashHead>
      <form className="pk-filter" method="get" action={listHref} role="search" aria-label="Filter laporan harian" data-pk-filter="laporan-harian">
        <label className="pk-filter__search">
          Cari
          <input type="search" name="q" defaultValue={lq.q} placeholder="Nomor, kendala, catatan…" maxLength={100} autoComplete="off" data-pk-search="laporan-harian" />
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
          <select name="per" defaultValue={String(lq.per)} data-pk-page-size="laporan-harian">
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
      <Bento label="Daftar laporan harian">
        {d.projects.length ? (
          <Card id="daily-projects" title="RAP per project" sub="Item RAP, progress tahapan, rekap mingguan">
            <ul className="pk-chips" aria-label="Project konstruksi">
              {d.projects.map((p) => (
                <li key={p.id}>
                  <Link className="pk-chip" href={rapHref(p.id)} prefetch={false} data-pk-rap={p.id}>
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        <Card id="daily-reports" title="Laporan" sub={`${d.page.items.length}${d.page.nextCursor ? '+' : ''} laporan${filtered ? ' (terfilter)' : ''}`}>
          <DataTable
            id="daily-reports"
            cols={cols}
            rows={d.page.items}
            rowKey={(r) => r.id}
            rowAttrs={(r) => ({ 'data-pk-row': r.docNo ?? String(r.id) })}
            caption="Laporan harian"
            empty={<EmptyState text={filtered ? 'Tidak ada laporan untuk filter ini.' : 'Belum ada laporan harian.'} action={filtered ? { href: listHref, label: 'Hapus filter' } : undefined} />}
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

export async function FieldDailyNew(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_CREATORS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const sp = spOf(props)
  const d = await withReqTransaction(req, async () => {
    const companies = gate.companies.filter((c) => mayCreateIn(req, c))
    const projects = await fieldProjects(req, ['konstruksi'], companies)
    return {
      projects,
      items: await formItemsOf(req, projects),
      resources: await formResourcesOf(req, companies),
      today: await todayOf(req, companies[0]),
    }
  })
  return (
    <FieldFrame props={props} name="harian-baru">
      <DashHead title="Laporan harian" note="Nomor LH dibuat otomatis · satu laporan per project per hari · bisa diedit pelapor 24 jam, setelah itu koreksi oleh PM/Direktur">
        <div className="pk-kact">
          <BtnLink href={listHref} icon="arrowLeft">
            Laporan harian
          </BtnLink>
        </div>
      </DashHead>
      <Bento>
        <Card id="daily-form" title="Laporan baru" span={8}>
          {d.projects.length === 0 ? (
            <EmptyState text="Tidak ada project konstruksi yang dapat Anda laporkan (Staff: project yang ditugaskan; PM: project tim)." />
          ) : (
            <DailyReportForm
              mode="create"
              projects={d.projects.map((p) => ({ id: p.id, label: p.label, companyId: p.companyId }))}
              itemsByProject={d.items}
              resourcesByCompany={d.resources}
              today={d.today}
              minDate={addDays(d.today, -BACKDATE_MAX_DAYS)}
              initialProject={idParam(sp.project)}
            />
          )}
        </Card>
        <Card id="daily-help" title="Aturan" span={4}>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
            <li>Isi volume pekerjaan hari ini per item RAP — progress tahapan dihitung otomatis dari realisasi.</li>
            <li>Material (masuk / terpakai) dicatat untuk stok, tidak dihitung ke progress.</li>
            <li>Melebihi volume RAP boleh, tetapi wajib catatan; PM project diberi notifikasi.</li>
            <li>Maks. 10 foto. Laporan tidak bisa dihapus.</li>
          </ul>
        </Card>
      </Bento>
    </FieldFrame>
  )
}

// ================================================================ detail (+ edit / correction)

function valuesOf(r: DailyDto): DrValues {
  return {
    weather: { morning: (r.weather.morning as Weather | null) ?? null, noon: (r.weather.noon as Weather | null) ?? null, afternoon: (r.weather.afternoon as Weather | null) ?? null },
    rainHours: r.rainHours,
    stopHours: r.stopHours,
    work: Object.fromEntries(r.work.map((w) => [w.item.id, w.qty])),
    materials: Object.fromEntries(r.materials.map((m) => [m.item.id, { received: m.received, used: m.used }])),
    manpower: Object.fromEntries(r.manpower.map((m) => [m.resourceTypeId, m.count])),
    equipment: Object.fromEntries(r.equipment.map((m) => [m.resourceTypeId, { count: m.count, hours: m.hours ?? null }])),
    issues: r.issues,
    notes: r.notes,
  }
}

const ORIGIN_LABELS: Record<string, string> = { report: 'laporan', edit: 'ubah pelapor', correction: 'koreksi' }
const KIND_LABELS: Record<string, string> = { work: 'pekerjaan', material_in: 'material masuk', material_used: 'material terpakai' }

export async function FieldDailyDetail(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_READERS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const sp = spOf(props)
  const id = segmentNum(props, 2)
  const want = one(sp.ubah) === '1' ? 'edit' : one(sp.koreksi) === '1' ? 'correction' : null
  const d = await withReqTransaction(req, async () => {
    const doc = id ? await visibleFieldDoc<DailyDoc>(req, 'daily_report', id) : null
    if (!doc) return null
    const r = await dailyDto(req, doc, { history: true })
    const co = r.companyId ? await companyById(req, r.companyId).catch(() => null) : null
    const form =
      want && r.companyId
        ? {
            items: await formItemsOf(req, [{ id: r.project.id, companyId: r.companyId }]),
            resources: await formResourcesOf(req, [r.companyId]),
            today: await todayOf(req, r.companyId),
          }
        : null
    return { r, form, history: await historyOf(req, 'daily_report', r.id), tz: co?.timezone || process.env.TZ || DEFAULT_TZ }
  })
  const back = (
    <BtnLink href={listHref} icon="arrowLeft">
      Laporan harian
    </BtnLink>
  )
  if (!d) {
    return (
      <FieldFrame props={props} name="harian-detail">
        <DashHead title="Laporan tidak ditemukan">{back}</DashHead>
      </FieldFrame>
    )
  }
  const { r, form, history, tz } = d
  const canCorrect = mayCorrectIn(req, r.companyId)
  const mode = want === 'edit' && r.editable ? 'edit' : want === 'correction' && canCorrect ? 'correction' : null
  if (mode && form) {
    return (
      <FieldFrame props={props} name={`harian-${mode}`}>
        <DashHead title={`${mode === 'edit' ? 'Ubah' : 'Koreksi'} ${r.docNo ?? `laporan #${r.id}`}`} note={`${longDate(r.reportDate)} · ${r.project.code ?? ''} ${r.project.name ?? ''}`}>
          <div className="pk-kact">
            <BtnLink href={detailHref(r.id)} icon="arrowLeft">
              Batal
            </BtnLink>
          </div>
        </DashHead>
        <Bento>
          <Card id="daily-form" title={mode === 'edit' ? 'Ubah (24 jam)' : 'Koreksi'} sub={mode === 'correction' ? 'Selisih dicatat sebagai koreksi dengan alasan; laporan ditandai “dikoreksi”.' : 'Selisih volume dicatat di riwayat.'} span={12}>
            <DailyReportForm
              mode={mode}
              projects={[{ id: r.project.id, label: `${r.project.code ?? ''} ${r.project.name ?? ''}`.trim(), companyId: r.companyId! }]}
              itemsByProject={form.items}
              resourcesByCompany={form.resources}
              today={form.today}
              minDate={r.reportDate}
              report={{ id: r.id, projectId: r.project.id, reportDate: r.reportDate, values: valuesOf(r), photoCount: r.photos.length }}
            />
          </Card>
        </Bento>
      </FieldFrame>
    )
  }
  const ledger = r.ledger ?? []
  return (
    <FieldFrame props={props} name="harian-detail">
      <DashHead title={r.docNo ?? `Laporan harian #${r.id}`} note={`${longDate(r.reportDate)} · ${r.project.code ?? ''} ${r.project.name ?? ''}`}>
        <div className="pk-kact">
          {back}
          <BtnLink href={rapHref(r.project.id)}>RAP project</BtnLink>
          {r.editable ? (
            <BtnLink href={`${detailHref(r.id)}?ubah=1`} attr="daily-edit">
              Ubah (24 jam)
            </BtnLink>
          ) : null}
          {canCorrect ? (
            <BtnLink href={`${detailHref(r.id)}?koreksi=1`} attr="daily-correct">
              Koreksi
            </BtnLink>
          ) : null}
        </div>
      </DashHead>
      {one(sp.baru) === '1' || one(sp.disimpan) === '1' ? (
        <Alert tone="ok" attr="created">
          <p>
            Laporan harian tersimpan — progress tahapan dihitung ulang
            {r.flags.includes(DAILY_FLAGS.overRap) ? '; volume melebihi RAP, PM project diberi notifikasi' : ''}.
          </p>
        </Alert>
      ) : null}
      {r.flags.length ? (
        <Alert tone="info" attr="flags">
          <p>
            Tanda: <FlagPills flags={r.flags} />
          </p>
        </Alert>
      ) : null}
      <Bento label="Laporan harian">
        <KpiRow cols={4}>
          <KpiTile id="d-work" icon="check" label="Item pekerjaan" value={String(r.work.length)} kpi="daily-work" i={0} />
          <KpiTile id="d-men" icon="users" label="Pekerja" value={String(r.workerCount)} kpi="daily-workers" i={1}>
            <p className="pk-kpi-x">{r.equipment.reduce((s, e) => s + e.count, 0)} alat</p>
          </KpiTile>
          <KpiTile id="d-weather" icon="clock" label="Cuaca pagi / siang / sore" value={weatherText(r.weather)} kpi="daily-weather" i={2}>
            <p className="pk-kpi-x">
              hujan {fmtNum(r.rainHours ?? 0)} jam · berhenti {fmtNum(r.stopHours ?? 0)} jam
            </p>
          </KpiTile>
          <KpiTile id="d-photo" icon="inbox" label="Foto" value={String(r.photos.length)} kpi="daily-photos" i={3}>
            <p className="pk-kpi-x">maks. 10</p>
          </KpiTile>
        </KpiRow>
        <Card id="daily-work" title="Volume pekerjaan" span={7} i={4}>
          <DataTable
            id="daily-work"
            caption="Volume pekerjaan"
            rows={r.work}
            rowKey={(w) => w.item.id}
            cols={[
              { key: 'c', label: 'Kode', cell: (w) => <b>{w.item.code}</b> },
              { key: 'd', label: 'Uraian', cell: (w) => w.item.description },
              { key: 'q', label: 'Volume', num: true, cell: (w) => `${fmtNum(w.qty)} ${w.item.uom}` },
            ]}
            empty={<EmptyState text="Tanpa volume pekerjaan." />}
          />
        </Card>
        <Card id="daily-meta" title="Rincian" span={5} i={5}>
          <dl className="pk-dl" style={{ marginBottom: 12 }}>
            <dt>Kendala</dt>
            <dd className="pk-pre">{r.issues ?? '—'}</dd>
            <dt>Catatan</dt>
            <dd className="pk-pre">{r.notes ?? '—'}</dd>
            <dt>Tenaga</dt>
            <dd>{r.manpower.length ? r.manpower.map((m) => `${m.name} ${m.count}`).join(', ') : '—'}</dd>
            <dt>Alat</dt>
            <dd>{r.equipment.length ? r.equipment.map((m) => `${m.name} ${m.count}${m.hours ? ` (${fmtNum(m.hours)} jam)` : ''}`).join(', ') : '—'}</dd>
          </dl>
          <MetaRows d={r} tz={tz} />
        </Card>
        {r.materials.length ? (
          <Card id="daily-material" title="Material" sub="Tidak dihitung ke progress" span={7} i={6}>
            <DataTable
              id="daily-material"
              caption="Material"
              rows={r.materials}
              rowKey={(m) => m.item.id}
              cols={[
                { key: 'c', label: 'Kode', cell: (m) => <b>{m.item.code}</b> },
                { key: 'd', label: 'Uraian', cell: (m) => m.item.description },
                { key: 'i', label: 'Masuk', num: true, cell: (m) => `${fmtNum(m.received)} ${m.item.uom}` },
                { key: 'u', label: 'Terpakai', num: true, cell: (m) => `${fmtNum(m.used)} ${m.item.uom}` },
              ]}
              empty={<EmptyState text="Tanpa material." />}
            />
          </Card>
        ) : null}
        <Card id="daily-photos" title="Foto" span={7} i={7}>
          <PhotoGallery photos={r.photos} label={`laporan ${r.docNo ?? r.id}`} empty="Laporan ini tanpa foto." />
        </Card>
        <Card id="daily-ledger" title="Riwayat volume" sub="Tidak pernah dihapus: perubahan dicatat sebagai selisih" span={5} i={8}>
          <DataTable
            id="daily-ledger"
            caption="Riwayat volume"
            rows={ledger}
            rowKey={(l) => l.id}
            cols={[
              { key: 'i', label: 'Item', cell: (l) => `${l.item.code} · ${KIND_LABELS[l.kind] ?? l.kind}` },
              { key: 'q', label: 'Selisih', num: true, cell: (l) => `${l.qty > 0 ? '+' : ''}${fmtNum(l.qty)}` },
              { key: 'o', label: 'Asal', sec: true, cell: (l) => `${ORIGIN_LABELS[l.origin] ?? l.origin}${l.by.name ? ` · ${l.by.name}` : ''}${l.reason ? ` — ${l.reason}` : ''}` },
            ]}
            empty={<EmptyState text="Belum ada volume." />}
          />
        </Card>
        <Card id="daily-history" title="Riwayat & koreksi" span={5} i={9}>
          <History entries={history} tz={tz} />
        </Card>
      </Bento>
    </FieldFrame>
  )
}

// ================================================================ RAP of a project

export async function FieldDailyRap(props: AdminViewServerProps) {
  const gate = await fieldGate(props, FIELD_READERS)
  if (!gate.ok) return gate.page
  const req = props.initPageResult.req as PayloadRequest
  const id = segmentNum(props, 2)
  const d = await withReqTransaction(req, async () => {
    const p = id ? await visibleProject(req, id) : null
    if (!p || p.kind !== 'konstruksi') return null
    return { p, rap: await loadRap(req, p.id), recap: await weeklyRecap(req, p.id) }
  })
  const back = (
    <BtnLink href={listHref} icon="arrowLeft">
      Laporan harian
    </BtnLink>
  )
  if (!d) {
    return (
      <FieldFrame props={props} name="harian-rap">
        <DashHead title="Project konstruksi tidak ditemukan">{back}</DashHead>
      </FieldFrame>
    )
  }
  const { p, rap, recap } = d
  const work = rap.items.filter((i) => i.kind === 'pekerjaan')
  const material = rap.items.filter((i) => i.kind === 'material')
  const prices = rap.totals !== null
  const weeks = recap.weeks.slice(-8)
  type Item = (typeof rap.items)[number]
  const itemCols: Col<Item>[] = [
    { key: 'c', label: 'Kode', cell: (i) => <b>{i.code}</b> },
    {
      key: 'd',
      label: 'Uraian',
      cell: (i) => (
        <>
          {i.description} {i.active ? null : <small>(nonaktif)</small>}
          <span className="sub">{i.stage?.name ?? '—'}</span>
        </>
      ),
    },
    { key: 'v', label: 'Volume RAP', num: true, cell: (i) => `${fmtNum(i.volume)} ${i.uom.code}` },
    ...(prices ? [{ key: 'p', label: 'Harga satuan', num: true, sec: true, cell: (i: Item) => (i.unitPrice === null || i.unitPrice === undefined ? '—' : `Rp ${fmtNum(i.unitPrice)}`) }] : []),
    { key: 'r', label: 'Realisasi', num: true, cell: (i) => `${fmtNum(i.realised)} ${i.uom.code}` },
    { key: 'pc', label: '%', num: true, cell: (i) => <span className={i.overRap ? 'pk-bad' : undefined}>{fmtNum(i.pct ?? 0)}%{i.overRap ? ' ⚠' : ''}</span> },
  ]
  return (
    <FieldFrame props={props} name="harian-rap">
      <DashHead title={`RAP · ${p.label}`} note={rap.locked ? 'RAP terkunci (sudah ada realisasi): perubahan hanya oleh Direktur/Admin dengan alasan' : 'Progress tahapan dihitung dari realisasi volume pekerjaan'}>
        <div className="pk-kact">
          {back}
          <BtnLink href={`${listHref}?project=${p.id}`}>Laporan project ini</BtnLink>
          <a className="pk-kbtn" href={`/api/v1/projects/${p.id}/rap.xlsx`} data-pk-link="rap-download">
            Unduh RAP (.xlsx)
          </a>
          <a className="pk-kbtn" href="/api/v1/rap/template.xlsx" data-pk-link="rap-template">
            Template kosong
          </a>
        </div>
      </DashHead>
      <Bento label="RAP project">
        <KpiRow cols={4}>
          <KpiTile id="r-items" icon="doc" label="Item pekerjaan / material" value={`${work.filter((i) => i.active).length} / ${material.filter((i) => i.active).length}`} kpi="rap-items" i={0} />
          <KpiTile id="r-stages" icon="check" label="Tahapan dari RAP" value={String(rap.stages.filter((s) => s.progressMode === 'rap').length)} kpi="rap-stages" i={1}>
            <p className="pk-kpi-x">dari {rap.stages.length} tahapan</p>
          </KpiTile>
          <KpiTile id="r-over" icon="clock" label="Melebihi RAP" value={String(work.filter((i) => i.overRap).length)} kpi="rap-over" i={2} />
          {rap.totals ? (
            <KpiTile id="r-value" icon="inbox" label="Nilai RAP" value={`Rp ${fmtNum(rap.totals.rapValue ?? 0)}`} kpi="rap-value" i={3}>
              <p className="pk-kpi-x">{rap.totals.budget !== null ? `RAB Rp ${fmtNum(rap.totals.budget)}${rap.totals.overBudget ? ' — melebihi RAB' : ''}` : 'RAB belum diisi'}</p>
            </KpiTile>
          ) : (
            <KpiTile id="r-locked" icon="inbox" label="Status RAP" value={rap.locked ? 'Terkunci' : 'Terbuka'} kpi="rap-locked" i={3} />
          )}
        </KpiRow>
        <Card id="rap-stages" title="Progress tahapan" span={5} i={4}>
          <DataTable
            id="rap-stages"
            caption="Tahapan"
            rows={rap.stages}
            rowKey={(s) => s.id}
            cols={[
              { key: 'n', label: 'Tahapan', cell: (s) => s.name },
              { key: 'w', label: 'Bobot', num: true, cell: (s) => `${fmtNum(s.weightPct)}%` },
              { key: 'p', label: 'Progress', num: true, cell: (s) => `${fmtNum(s.progressPct)}%` },
              { key: 'm', label: 'Sumber', sec: true, cell: (s) => (s.progressMode === 'rap' ? `RAP (${s.basis === 'value' ? 'bobot nilai' : 'rata'})` : 'manual') },
            ]}
            empty={<EmptyState text="Belum ada tahapan." />}
          />
        </Card>
        <Card id="rap-recap" title="Rekap mingguan" sub={`Minggu ke-1 = minggu ${longDate(recap.project.startDate)}`} span={7} i={5}>
          <DataTable
            id="rap-recap"
            caption="Rekap mingguan"
            rows={weeks}
            rowKey={(w) => w.week}
            cols={[
              { key: 'w', label: 'Minggu', cell: (w) => <b>Minggu ke-{w.week}</b> },
              { key: 'r', label: 'Rentang', sec: true, cell: (w) => `${dateId(w.from)} – ${dateId(w.to)}` },
              { key: 'n', label: 'Laporan', num: true, cell: (w) => w.reports },
              { key: 'm', label: 'Hari-orang', num: true, cell: (w) => w.workerDays },
              { key: 'h', label: 'Hujan / berhenti', num: true, sec: true, cell: (w) => `${fmtNum(w.rainHours)} / ${fmtNum(w.stopHours)} jam` },
            ]}
            empty={<EmptyState text="Belum ada laporan harian." />}
          />
        </Card>
        <Card id="rap-work" title="Item pekerjaan" i={6}>
          <DataTable id="rap-work" caption="Item pekerjaan" rows={work} rowKey={(i) => i.id} rowAttrs={(i) => ({ 'data-pk-rap-item': i.code })} cols={itemCols} empty={<EmptyState text="RAP masih kosong — unggah Excel RAP di bawah." />} />
        </Card>
        {material.length ? (
          <Card id="rap-material" title="Material" sub="Masuk / terpakai / stok dari laporan harian" i={7}>
            <DataTable
              id="rap-material"
              caption="Material"
              rows={material}
              rowKey={(i) => i.id}
              cols={[
                { key: 'c', label: 'Kode', cell: (i) => <b>{i.code}</b> },
                { key: 'd', label: 'Uraian', cell: (i) => i.description },
                { key: 'v', label: 'RAP', num: true, cell: (i) => `${fmtNum(i.volume)} ${i.uom.code}` },
                { key: 'i', label: 'Masuk', num: true, cell: (i) => fmtNum(i.received) },
                { key: 'u', label: 'Terpakai', num: true, cell: (i) => fmtNum(i.used) },
                { key: 's', label: 'Stok', num: true, cell: (i) => fmtNum(i.stock ?? 0) },
              ]}
              empty={<EmptyState text="Tanpa material." />}
            />
          </Card>
        ) : null}
        {rap.canEdit ? (
          <Card id="rap-import" title="Impor RAP dari Excel" sub="Pratinjau dulu, lalu simpan. Item yang tidak ada di file dinonaktifkan." i={8}>
            <RapImport projectId={p.id} needsReason={rap.needsReason} />
          </Card>
        ) : null}
      </Bento>
    </FieldFrame>
  )
}
