import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { hasRole } from '@/access/roles'
import { resolveScope } from '@/access/scope'
import { StageEditor } from '@/admin/components/progress/StageEditor'
import { listAddenda } from '@/domain/addendum/service'
import { settings } from '@/domain/expense/common'
import { listReports, reportDto, type ReportDto } from '@/domain/progress/dto'
import { loadVisibleReport } from '@/domain/progress/reports'
import { loadStageSet, requireVisibleProject } from '@/domain/progress/stages'
import { projectProgressVsBudget, type ProjectProgress } from '@/domain/reports/progress'
import { officeScope } from '@/domain/reports/scope'
import { withReqTransaction } from '@/lib/system-tx'
import { DEFAULT_TZ } from '@/lib/time'

import { ChartHover } from './ChartHover'
import { Frame } from './frame'
import { Alert, dateId, dateTimeId, ProgressLegend, ProgressTable, ProgressTonePill, ProgressVsBudgetRows } from './progress-ui'
import { Bento, Card, DashHead, DataTable, EmptyState, KpiRow, KpiTile, pctText, rp, StatusPill, TableView, type Col } from './viz'

/**
 * E4 web (plan fase1-golive §E4, US-10/US-12/US-29/US-31): project progress overview (K-09
 * progress fisik vs anggaran), project detail (stages, stage editor G11, timeline per stage), progress
 * report list (filters project/stage/date, newest first) and report detail with the photo gallery.
 * Server-rendered with the CALLER's access (PM: team projects; Direktur/Finance: all); writes go to
 * /api/v1 from client components. Staff/Admin: no menu entry and a "no access" page.
 */
const READERS = ['pk-owner', 'pk-finance', 'pk-pm'] as const
const projectHref = (id: number) => `/admin/progress/project/${id}`
const reportHref = (id: number) => `/admin/progress/laporan/${id}`

function Denied({ props, title }: { props: AdminViewServerProps; title: string }) {
  return (
    <Frame props={props} name="progress-denied">
      <DashHead title={title} />
      <Alert tone="bad" attr="denied">
        <p>Halaman ini hanya untuk Direktur, Finance dan PM.</p>
      </Alert>
    </Frame>
  )
}

const segmentId = (props: AdminViewServerProps, index: number): number => {
  const seg = ((props.params as { segments?: string[] } | undefined)?.segments ?? [])[index] ?? ''
  return /^\d{1,10}$/.test(seg) ? Number(seg) : 0
}

async function tzOf(req: PayloadRequest): Promise<string> {
  return (await settings(req)).timezone || process.env.TZ || DEFAULT_TZ
}

// ================================================================ overview (K-09, US-12)

export async function ProgressOverview(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!hasRole(req, ...READERS)) return <Denied props={props} title="Progress project" />
  const sp = (props.searchParams ?? {}) as Record<string, string | undefined>
  const archived = sp.arsip === 'ya'
  const d = await withReqTransaction(req, async () => projectProgressVsBudget(req, await officeScope(req), { includeArchived: archived }))
  const rows = [...d.projects].sort((a, b) => (b.gap ?? -999) - (a.gap ?? -999) || a.code.localeCompare(b.code))
  const count = (t: ProjectProgress['tone']) => rows.filter((p) => p.tone === t).length
  const measured = rows.filter((p) => p.stagesComplete)
  const avg = measured.length ? measured.reduce((s, p) => s + p.progressPct, 0) / measured.length : null
  const isPm = !hasRole(req, 'pk-owner', 'pk-finance')
  return (
    <Frame props={props} name="progress">
      <ChartHover>
        <DashHead title="Progress project" note={`Per ${dateId(d.asOf)} (WITA) · progress fisik (Σ bobot × % tahapan) dibandingkan % anggaran terpakai (komitmen terhadap RAB)${isPm ? ' · project tim Anda' : ''}`}>
          <div className="pk-kact">
            <Link className="pk-kbtn" href="/admin/progress/laporan" data-pk-link="laporan-progress">
              Laporan progress
            </Link>
            <Link className="pk-kbtn" href={archived ? '/admin/progress' : '/admin/progress?arsip=ya'}>
              {archived ? 'Sembunyikan arsip' : 'Tampilkan arsip'}
            </Link>
          </div>
        </DashHead>
        <Bento label="Ringkasan progress">
          <KpiRow cols={4}>
            <KpiTile id="progress-avg" icon="target" label="Rata-rata progress fisik" value={pctText(avg)} kpi="progress-avg" i={0}>
              <p className="pk-kpi-x">{measured.length} dari {rows.length} project dengan tahapan 100%</p>
            </KpiTile>
            <KpiTile id="progress-ok" icon="check" label="Sesuai" value={String(count('ok'))} kpi="k09-ok" i={1}>
              <p className="pk-kpi-x">
                <StatusPill tone="ok" label={`selisih ≤ ${d.warnGapPct}%`} />
              </p>
            </KpiTile>
            <KpiTile id="progress-warn" icon="clock" label="Perlu perhatian" value={String(count('warn'))} kpi="k09-warn" i={2}>
              <p className="pk-kpi-x">
                <StatusPill tone="warn" label={`selisih ≤ ${d.badGapPct}%`} />
              </p>
            </KpiTile>
            <KpiTile id="progress-bad" icon="scale" label="Anggaran mendahului progress" value={String(count('bad'))} kpi="k09-bad" i={3}>
              <p className="pk-kpi-x">
                <StatusPill tone="bad" label={`selisih > ${d.badGapPct}%`} />
              </p>
            </KpiTile>
          </KpiRow>
          <Card
            id="progress-vs-budget"
            title="Progress fisik vs anggaran per project"
            sub="K-09 · urut selisih terbesar dulu · klik project untuk tahapan & laporan"
            foot={`Selisih = % anggaran − % progress fisik. Ambang di pengaturan perusahaan (kuning > ${d.warnGapPct}%, merah > ${d.badGapPct}%). Project tanpa RAB atau tahapan belum 100% tidak dinilai.`}
          >
            {rows.length > 0 ? <ProgressLegend warn={d.warnGapPct} bad={d.badGapPct} /> : null}
            <ProgressVsBudgetRows id="progress-vs-budget" rows={rows} hrefOf={(p) => projectHref(p.id)} empty={isPm ? 'Anda belum ditetapkan sebagai PM project mana pun.' : 'Belum ada project.'} />
            {rows.length > 0 ? (
              <TableView>
                <ProgressTable rows={rows} hrefOf={(p) => projectHref(p.id)} />
              </TableView>
            ) : null}
          </Card>
        </Bento>
      </ChartHover>
    </Frame>
  )
}

// ================================================================ project detail (stages, editor, timeline)

type StageRow = Awaited<ReturnType<typeof loadStageSet>>['stages'][number]

export async function ProjectProgressView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!hasRole(req, ...READERS)) return <Denied props={props} title="Progress project" />
  const id = segmentId(props, 2)
  const d = await withReqTransaction(req, async () => {
    const project = id ? await requireVisibleProject(req, id).catch(() => null) : null
    if (!project) return null
    const full = (await req.payload.findByID({ collection: 'projects', id, depth: 0, user: req.user, overrideAccess: false, req })) as { id: number; code: string; name: string; status: string; budget?: number | null }
    const set = await loadStageSet(req, id)
    const k09 = (await projectProgressVsBudget(req, await officeScope(req), { projectId: id, includeArchived: true })).projects[0]
    const reports = await listReports(req, { projectId: id, limit: 100 })
    const addenda = await listAddenda(req, { projectId: id, limit: 5 })
    const teamPm = hasRole(req, 'pk-pm') && (await resolveScope(req)).teamProjects.includes(id)
    const templates = hasRole(req, 'pk-owner')
      ? ((await req.payload.find({ collection: 'stage-templates', where: { active: { equals: true } }, depth: 0, pagination: false, select: { name: true }, user: req.user, overrideAccess: false, req }).catch(() => ({ docs: [] }))).docs as Array<{ id: number; name: string }>)
      : []
    return { project: full, set, k09, reports: reports.items, addenda: addenda.items, teamPm, templates, tz: await tzOf(req) }
  })
  if (!d) {
    return (
      <Frame props={props} name="progress-project">
        <DashHead title="Project tidak ditemukan">
          <Link className="pk-kbtn" href="/admin/progress">
            ← Progress project
          </Link>
        </DashHead>
      </Frame>
    )
  }
  const { project, set, k09, reports, addenda, teamPm, templates } = d
  const owner = hasRole(req, 'pk-owner')
  const canEdit = (owner || teamPm) && project.status !== 'arsip'
  const byStage = new Map<number, ReportDto[]>()
  for (const r of reports) byStage.set(r.stage.id, [...(byStage.get(r.stage.id) ?? []), r])
  const active = set.stages.filter((s) => s.active)
  return (
    <Frame props={props} name="progress-project">
      <ChartHover>
        <DashHead title={`${project.code} ${project.name}`} note={`Progress fisik ${pctText(set.progressPct, 2)} · total bobot ${pctText(set.weightSum, 2)}${set.complete ? '' : ' (belum 100%: laporan progress ditolak sampai lengkap)'}`}>
          <div className="pk-kact">
            <Link className="pk-kbtn" href="/admin/progress">
              ← Progress project
            </Link>
            <Link className="pk-kbtn" href={`/admin/progress/laporan?project=${project.id}`}>
              Laporan project ini
            </Link>
            {teamPm ? (
              <Link className="pk-kbtn primary" href={`/admin/addendum/baru?project=${project.id}`} data-pk-link="addendum-baru">
                + Ajukan addendum RAB
              </Link>
            ) : null}
          </div>
        </DashHead>
        <Bento label="Progress project">
          <KpiRow cols={4}>
            <KpiTile id="p-progress" icon="target" label="Progress fisik" value={pctText(set.progressPct)} kpi="project-progress" i={0}>
              <div className="pk-meter" role="presentation">
                <span style={{ width: `${Math.min(100, set.progressPct)}%` }} />
              </div>
              <p className="pk-kpi-x">{active.length} tahapan aktif</p>
            </KpiTile>
            <KpiTile id="p-budget" icon="wallet" label="% anggaran terpakai" value={pctText(k09?.budgetPct ?? null)} kpi="project-budget-pct" i={1}>
              <p className="pk-kpi-x">
                Komitmen <b>{rp(k09?.committed ?? 0)}</b> dari RAB {rp(project.budget ?? null)}
              </p>
            </KpiTile>
            <KpiTile id="p-k09" icon="scale" label="Status K-09" value={k09?.gap === null || !k09 ? '—' : `${k09.gap > 0 ? '+' : ''}${pctText(k09.gap)}`} kpi="project-gap" i={2}>
              <p className="pk-kpi-x">{k09 ? <ProgressTonePill p={k09} /> : null}</p>
            </KpiTile>
            <KpiTile id="p-reports" icon="doc" label="Laporan progress" value={String(reports.length)} kpi="project-reports" href={`/admin/progress/laporan?project=${project.id}`} more="Daftar laporan" i={3}>
              <p className="pk-kpi-x">terakhir {dateId(reports[0]?.reportDate)}</p>
            </KpiTile>
          </KpiRow>

          <Card id="stages" title="Tahapan & progress" sub="Bobot × progress tahapan = progress fisik project" span={canEdit ? 5 : 12} i={4}>
            <StageBars stages={active} />
          </Card>
          {canEdit ? (
            <Card id="stage-editor" title="Editor tahapan" sub={owner ? 'Direktur: tambah, nonaktifkan, ubah nama/urutan/bobot' : 'PM: ubah nama, urutan dan bobot'} span={7} i={5}>
              <StageEditor projectId={project.id} stages={active.map((s) => ({ id: s.id, name: s.name, weightPct: s.weightPct, sequence: s.sequence, progressPct: s.progressPct }))} canAddRemove={owner} templates={templates} />
            </Card>
          ) : null}

          <Card id="timeline" title="Timeline progress per tahapan" sub="Laporan terbaru di atas · % tahapan sebelum → sesudah" span={8} i={6} action={{ href: `/admin/progress/laporan?project=${project.id}`, label: 'Semua laporan' }}>
            {active.length === 0 ? (
              <EmptyState text="Belum ada tahapan." />
            ) : (
              <div style={{ display: 'grid', gap: 18 }}>
                {active.map((s) => (
                  <section key={s.id} aria-labelledby={`tl-${s.id}`} data-pk-timeline-stage={s.id}>
                    <h3 id={`tl-${s.id}`} style={{ fontSize: 14, margin: '0 0 8px' }}>
                      {s.name} <span style={{ fontWeight: 400, color: 'var(--pk-muted-fg)' }}>· bobot {pctText(s.weightPct)} · {pctText(s.progressPct)}</span>
                    </h3>
                    {(byStage.get(s.id) ?? []).length === 0 ? (
                      <p className="pk-note" style={{ margin: 0 }}>
                        Belum ada laporan.
                      </p>
                    ) : (
                      <ol className="pk-tl">
                        {(byStage.get(s.id) ?? []).slice(0, 6).map((r) => (
                          <li key={r.id}>
                            <div className="when">
                              {dateId(r.reportDate)} · {r.reporter.name ?? '—'}
                              {r.offline ? ' · offline' : ''}
                            </div>
                            <p className="what">
                              <a href={reportHref(r.id)}>{r.docNo ?? `#${r.id}`}</a> · <b>{pctText(r.pctBefore)}</b> → <b>{pctText(r.pctAfter)}</b> · {r.work.length > 90 ? `${r.work.slice(0, 90)}…` : r.work}
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                ))}
              </div>
            )}
          </Card>
          <Card id="project-addenda" title="Addendum RAB" sub={`RAB sekarang ${rp(project.budget ?? null)}`} span={4} i={7} action={{ href: `/admin/addendum?project=${project.id}`, label: 'Semua' }}>
            {addenda.length === 0 ? (
              <EmptyState text="Belum ada addendum." action={teamPm ? { href: `/admin/addendum/baru?project=${project.id}`, label: '+ Ajukan addendum RAB' } : undefined} />
            ) : (
              <ul className="pk-hbars">
                {addenda.map((a) => (
                  <li key={a.id}>
                    <a className="pk-hbar" href={`/admin/addendum/detail/${a.id}`} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                      <span className="l">
                        {a.docNo ?? 'Draft'} · +{rp(a.addition)}
                      </span>
                      <span className="v">
                        <StatusPill tone={a.status === 'approved' ? 'ok' : a.status === 'rejected' ? 'bad' : a.status === 'cancelled' || a.status === 'draft' ? 'none' : 'wait'} label={a.statusLabel} />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Bento>
      </ChartHover>
    </Frame>
  )
}

function StageBars({ stages }: { stages: StageRow[] }) {
  if (stages.length === 0) return <EmptyState text="Belum ada tahapan. Direktur menambahkan tahapan (total bobot 100%)." />
  return (
    <ol className="pk-stages" data-pk-chart="stages">
      {stages.map((s, i) => (
        <li
          key={s.id}
          className={`pk-stage${s.progressPct >= 100 ? ' done' : ''}`}
          tabIndex={0}
          data-tip={JSON.stringify({ t: s.name, r: [['progress', pctText(s.progressPct, 2), 's1'], ['bobot', pctText(s.weightPct, 2)], ['kontribusi', pctText((s.weightPct * s.progressPct) / 100, 2)]] })}
          data-pk-stage={s.name}
        >
          <span className="n" aria-hidden>
            {s.progressPct >= 100 ? '✓' : i + 1}
          </span>
          <span className="nm">
            {s.name}
            <small>
              bobot {pctText(s.weightPct)} · kontribusi {pctText((s.weightPct * s.progressPct) / 100)}
            </small>
          </span>
          <span className="pc">{pctText(s.progressPct)}</span>
          <span className="bar" aria-hidden>
            <i style={{ width: `${Math.min(100, s.progressPct)}%` }} />
          </span>
        </li>
      ))}
    </ol>
  )
}

// ================================================================ report list (US-31)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function ProgressReportList(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!hasRole(req, ...READERS)) return <Denied props={props} title="Laporan progress" />
  const sp = (props.searchParams ?? {}) as Record<string, string | undefined>
  const num = (v: string | undefined) => (v && /^\d{1,10}$/.test(v) ? Number(v) : undefined)
  const q = { project: num(sp.project), stage: num(sp.tahap), from: sp.dari && DATE_RE.test(sp.dari) ? sp.dari : undefined, to: sp.sampai && DATE_RE.test(sp.sampai) ? sp.sampai : undefined, before: num(sp.sebelum) }
  const d = await withReqTransaction(req, async () => {
    const page = await listReports(req, { projectId: q.project, stageId: q.stage, from: q.from, to: q.to, limit: 25, after: q.before })
    const projects = (await req.payload.find({ collection: 'projects', sort: 'code', depth: 0, pagination: false, select: { code: true, name: true }, user: req.user, overrideAccess: false, req }).catch(() => ({ docs: [] }))).docs as Array<{ id: number; code: string; name: string }>
    const stages = q.project
      ? ((await req.payload.find({ collection: 'project-stages', where: { project: { equals: q.project } }, sort: 'sequence', depth: 0, pagination: false, select: { name: true }, user: req.user, overrideAccess: false, req }).catch(() => ({ docs: [] }))).docs as Array<{ id: number; name: string }>)
      : []
    return { page, projects, stages }
  })
  const filtered = Boolean(q.project || q.stage || q.from || q.to)
  const keep = (extra: Record<string, string>) => {
    const u = new URLSearchParams()
    if (q.project) u.set('project', String(q.project))
    if (q.stage) u.set('tahap', String(q.stage))
    if (q.from) u.set('dari', q.from)
    if (q.to) u.set('sampai', q.to)
    for (const [k, v] of Object.entries(extra)) u.set(k, v)
    return `/admin/progress/laporan?${u.toString()}`
  }
  const cols: Col<ReportDto>[] = [
    { key: 'date', label: 'Tanggal', sort: 'descending', cell: (r) => <span className="nw">{dateId(r.reportDate)}</span> },
    {
      key: 'no',
      label: 'Laporan',
      cell: (r) => (
        <>
          <a href={reportHref(r.id)} data-pk-report={r.docNo ?? r.id}>
            {r.docNo ?? `#${r.id}`}
          </a>
          <span className="sub" title={r.work}>
            {r.work}
          </span>
        </>
      ),
    },
    {
      key: 'proj',
      label: 'Project / tahapan',
      cell: (r) => (
        <>
          <a href={projectHref(r.project.id)}>{r.project.code}</a> {r.project.name}
          <span className="sub">{r.stage.name}</span>
        </>
      ),
    },
    {
      key: 'pct',
      label: 'Tahapan',
      num: true,
      cell: (r) => (
        <span className="nw">
          {pctText(r.pctBefore)} → <b>{pctText(r.pctAfter)}</b>
        </span>
      ),
    },
    { key: 'ppct', label: 'Project', num: true, sec: true, cell: (r) => pctText(r.projectPctAfter) },
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
              // eslint-disable-next-line @next/next/no-img-element -- authenticated API thumbnail, not a static asset
              <img key={p.id} src={p.thumbUrl} alt="" loading="lazy" width={36} height={28} />
            ))}
            {r.photos.length > 3 ? <small>+{r.photos.length - 3}</small> : null}
          </span>
        ),
    },
    {
      key: 'by',
      label: 'Pelapor',
      sec: true,
      cell: (r) => (
        <>
          {r.reporter.name ?? '—'}
          {r.offline ? <span className="sub">offline · {r.source ?? ''}</span> : <span className="sub">{r.source ?? ''}</span>}
        </>
      ),
    },
  ]
  return (
    <Frame props={props} name="laporan-progress">
      <DashHead title="Laporan progress" note="Terbaru di atas · PM melihat project timnya, Direktur/Finance semua project · laporan dibuat dari aplikasi Android">
        <div className="pk-kact">
          <Link className="pk-kbtn" href="/admin/progress">
            Progress project
          </Link>
        </div>
      </DashHead>
      <form className="pk-filter" method="get" action="/admin/progress/laporan" role="search" aria-label="Filter laporan progress" data-pk-filter="laporan-progress">
        <label>
          Project
          <select name="project" defaultValue={q.project ? String(q.project) : ''}>
            <option value="">Semua project</option>
            {d.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tahapan
          <select name="tahap" defaultValue={q.stage ? String(q.stage) : ''} disabled={!q.project}>
            <option value="">{q.project ? 'Semua tahapan' : 'Pilih project dulu'}</option>
            {d.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Dari
          <input type="date" name="dari" defaultValue={q.from ?? ''} />
        </label>
        <label>
          Sampai
          <input type="date" name="sampai" defaultValue={q.to ?? ''} />
        </label>
        <button type="submit" className="pk-kbtn primary">
          Terapkan
        </button>
        {filtered ? (
          <Link className="pk-kbtn" href="/admin/progress/laporan">
            Reset
          </Link>
        ) : null}
      </form>
      <Bento label="Daftar laporan progress">
        <Card id="reports" title="Laporan" sub={`${d.page.items.length}${d.page.nextCursor ? '+' : ''} laporan${filtered ? ' (terfilter)' : ''}`}>
          <DataTable
            id="progress-reports"
            cols={cols}
            rows={d.page.items}
            rowKey={(r) => r.id}
            rowAttrs={(r) => ({ 'data-pk-row': r.docNo ?? String(r.id) })}
            caption="Laporan progress"
            empty={<EmptyState text={filtered ? 'Tidak ada laporan untuk filter ini.' : 'Belum ada laporan progress.'} action={filtered ? { href: '/admin/progress/laporan', label: 'Hapus filter' } : undefined} />}
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
    </Frame>
  )
}

// ================================================================ report detail + gallery

export async function ProgressReportDetail(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!hasRole(req, ...READERS)) return <Denied props={props} title="Laporan progress" />
  const id = segmentId(props, 2)
  const d = await withReqTransaction(req, async () => {
    const doc = id ? await loadVisibleReport(req, id).catch(() => null) : null
    return doc ? { r: await reportDto(req, doc), tz: await tzOf(req) } : null
  })
  const back = (
    <Link className="pk-kbtn" href="/admin/progress/laporan">
      ← Laporan progress
    </Link>
  )
  if (!d) {
    return (
      <Frame props={props} name="laporan-progress-detail">
        <DashHead title="Laporan tidak ditemukan">{back}</DashHead>
      </Frame>
    )
  }
  const { r, tz } = d
  const trust: Record<string, string> = { server: 'jam server (online)', estimated: 'perkiraan server (offline)', device_only: 'jam HP saja (offline)' }
  return (
    <Frame props={props} name="laporan-progress-detail">
      <DashHead title={r.docNo ?? `Laporan #${r.id}`} note={`${dateId(r.reportDate)} · ${r.project.code} ${r.project.name} · ${r.stage.name}`}>
        <div className="pk-kact">
          {back}
          <Link className="pk-kbtn" href={projectHref(r.project.id)}>
            Project
          </Link>
        </div>
      </DashHead>
      {r.flags.length > 0 || r.timeTrust === 'device_only' ? (
        <Alert tone="info" attr="flags">
          <p>
            Tanda: {r.flags.join(', ') || '—'} · sumber waktu {trust[r.timeTrust]}.
          </p>
        </Alert>
      ) : null}
      <Bento label="Laporan progress">
        <KpiRow cols={3}>
          <KpiTile id="r-stage" icon="target" label={`Tahapan ${r.stage.name}`} value={`${pctText(r.pctBefore)} → ${pctText(r.pctAfter)}`} kpi="report-stage" i={0}>
            <div className="pk-meter" role="presentation">
              <span style={{ width: `${Math.min(100, r.pctAfter)}%` }} />
            </div>
            <p className="pk-kpi-x">bobot tahapan {pctText(r.stage.weightPct)}</p>
          </KpiTile>
          <KpiTile id="r-project" icon="scale" label="Progress project" value={`${pctText(r.projectPctBefore)} → ${pctText(r.projectPctAfter)}`} kpi="report-project" i={1}>
            <p className="pk-kpi-x">{r.projectPctAfter !== null && r.projectPctBefore !== null ? `naik ${(r.projectPctAfter - r.projectPctBefore).toFixed(2).replace('.', ',')} poin` : '—'}</p>
          </KpiTile>
          <KpiTile id="r-photos" icon="doc" label="Foto" value={`${r.photos.length} / 5`} kpi="report-photos" i={2}>
            <p className="pk-kpi-x">diperkecil ≤ 1600 px, tanpa lokasi EXIF</p>
          </KpiTile>
        </KpiRow>
        <Card id="report-body" title="Pekerjaan & kendala" span={7} i={3}>
          <h3 style={{ fontSize: 13, margin: '0 0 4px', color: 'var(--pk-muted-fg)' }}>Pekerjaan</h3>
          <p className="pk-pre" data-pk-field="work">
            {r.work}
          </p>
          <h3 style={{ fontSize: 13, margin: '14px 0 4px', color: 'var(--pk-muted-fg)' }}>Kendala</h3>
          <p className="pk-pre" data-pk-field="issues">
            {r.issues ?? '—'}
          </p>
        </Card>
        <Card id="report-meta" title="Rincian" span={5} i={4}>
          <dl className="pk-dl">
            <dt>Pelapor</dt>
            <dd>{r.reporter.name ?? '—'}</dd>
            <dt>Diterima server</dt>
            <dd>{dateTimeId(r.receivedAt, tz)}</dd>
            <dt>Sumber</dt>
            <dd>
              {r.source ?? '—'}
              {r.offline ? ' · dibuat offline' : ''} · {trust[r.timeTrust]}
            </dd>
            <dt>Bisa diedit</dt>
            <dd>{r.editableUntil ? `s/d ${dateTimeId(r.editableUntil, tz)} (pelapor, dengan alasan)` : '—'}</dd>
          </dl>
        </Card>
        <Card id="report-photos" title="Foto" sub={r.photos.length ? 'Klik foto untuk ukuran penuh (tab baru)' : undefined} i={5}>
          {r.photos.length === 0 ? (
            <EmptyState text="Laporan ini tanpa foto." />
          ) : (
            <ul className="pk-gallery" data-pk-gallery={r.id}>
              {r.photos.map((p, i) => (
                <li key={p.id}>
                  <a href={p.url} target="_blank" rel="noopener noreferrer" aria-label={`Foto ${i + 1} dari ${r.photos.length}, buka ukuran penuh`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API thumbnail */}
                    <img src={p.thumbUrl} alt={`Foto ${i + 1} laporan ${r.docNo ?? r.id}`} loading="lazy" width={p.width ?? undefined} height={p.height ?? undefined} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Bento>
    </Frame>
  )
}

