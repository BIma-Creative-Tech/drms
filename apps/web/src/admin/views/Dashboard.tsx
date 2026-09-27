import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React, { Suspense } from 'react'

import { rolesOf, type Role } from '@/access/roles'
import { statusLabel, type RequestStatus, type RequestType } from '@/domain/expense/types'
import { adminDashboard, financeDashboard, ownerDashboard, pmDashboard, staffDashboard } from '@/domain/reports/dashboards'
import type { ProjectBudget } from '@/domain/reports/kpi'
import { lastDay, MONTHS_SHORT, periodLabel } from '@/domain/reports/rules'
import { delta, share, statusTone, type PipelineStage } from '@/domain/reports/viz'
import { withReqTransaction } from '@/lib/system-tx'
import { listReports } from '@/domain/progress/dto'
import { projectProgressVsBudget, type ProjectProgress } from '@/domain/reports/progress'
import { officeScope, teamScope } from '@/domain/reports/scope'

import { TeamTodayWidget } from './Absensi'
import { ChartHover } from './ChartHover'
import { dateId, ProgressCell, ProgressVsBudgetCard } from './progress-ui'
import { BudgetBadge, F3Root } from './f3-ui'
import {
  Bento,
  BulletLegend,
  BulletRows,
  Card,
  ColumnsChart,
  DashboardSkeleton,
  DashHead,
  DataTable,
  Delta,
  EmptyState,
  HBarList,
  KpiRow,
  KpiTile,
  LineChart,
  Meter,
  pctText,
  PipelineBars,
  rp,
  rpShort,
  Sparkline,
  StatusPill,
  TableView,
  VIZ_STYLE,
  type Col,
} from './viz'

/**
 * "Beranda" — replaces Payload's default dashboard (admin.components.views.dashboard, verified in
 * @payloadcms/next 3.90.1 views/Dashboard: rendered inside the default template, receives
 * initPageResult + searchParams). Layout by role, Owner > Finance > PM > Admin > Staff; further
 * roles appear as tabs (?peran=…). Redesign 2026-09-25 (user: "terlalu text based"): KPI tiles,
 * charts and card tables in a 12-column bento grid (kit: ./viz.tsx). Server-rendered; the data
 * streams behind a skeleton (Suspense); every number links to the list/report that produces it
 * (C9); a failing layout shows its own error (wireframes §0).
 */
type Layout = 'owner' | 'finance' | 'pm' | 'admin' | 'staff'
const ORDER: Array<[Layout, Role]> = [
  ['owner', 'pk-owner'],
  ['finance', 'pk-finance'],
  ['pm', 'pk-pm'],
  ['admin', 'pk-admin'],
  ['staff', 'pk-staff'],
]
const LABEL: Record<Layout, string> = { owner: 'Direktur', finance: 'Finance', pm: 'PM', admin: 'Admin', staff: 'Staff' }

const ER = '/admin/collections/expense-requests'
const where = (q: Record<string, string>) => new URLSearchParams(q).toString()
const rekapKasMonth = (period: string) => `/admin/laporan/rekap-kas?${where({ dari: period, sampai: period })}`
const statusList = (statuses: readonly string[]) => `${ER}?${where({ 'where[status][in]': statuses.join(',') })}`
const reqHref = (id: number) => `${ER}/${id}`
const WAITING = ['pending_ack', 'pending_approval']
const SR: React.CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }

export async function Dashboard(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const roles = rolesOf(req.user)
  const layouts = ORDER.filter(([, r]) => roles.includes(r)).map(([l]) => l)
  const sp = (props.searchParams ?? {}) as Record<string, string | string[] | undefined>
  const asked = typeof sp.peran === 'string' ? (sp.peran as Layout) : undefined
  const layout: Layout | undefined = asked && layouts.includes(asked) ? asked : layouts[0]
  const months: 6 | 12 = sp.bulan === '6' ? 6 : 12
  return (
    <Gutter>
      <F3Root name={`beranda-${layout ?? 'none'}`}>
        <style>{VIZ_STYLE}</style>
        <DashHead title={`Beranda${layout ? ` · ${LABEL[layout]}` : ''}`}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {layouts.length > 1 ? (
              <nav className="pk-tabs" aria-label="Tampilan peran" style={{ margin: 0 }}>
                {layouts.map((l) => (
                  <a key={l} href={`/admin?peran=${l}`} aria-current={l === layout ? 'page' : undefined} data-pk-role-tab={l}>
                    {LABEL[l]}
                  </a>
                ))}
              </nav>
            ) : null}
            {layout === 'owner' ? (
              <nav className="pk-tabs" aria-label="Rentang grafik" style={{ margin: 0 }}>
                <Link href="/admin?peran=owner&bulan=12" aria-current={months === 12 ? 'page' : undefined}>
                  12 bulan
                </Link>
                <Link href="/admin?peran=owner&bulan=6" aria-current={months === 6 ? 'page' : undefined}>
                  6 bulan
                </Link>
              </nav>
            ) : null}
          </div>
        </DashHead>
        {!layout ? (
          <EmptyState text="Akun Anda belum punya peran ProyekKas. Hubungi Admin." />
        ) : (
          <ChartHover>
            <Suspense fallback={<DashboardSkeleton />}>
              <Body layout={layout} req={req} months={months} />
            </Suspense>
          </ChartHover>
        )}
      </F3Root>
    </Gutter>
  )
}

async function Body({ layout, req, months }: { layout: Layout; req: PayloadRequest; months: 6 | 12 }) {
  try {
    switch (layout) {
      // awaited here (not rendered as <Owner/>) so a failing query is caught by this try
      case 'owner':
        return await Owner({ req, months })
      case 'finance':
        return await Finance({ req })
      case 'pm':
        return await Pm({ req })
      case 'admin':
        return await Admin({ req })
      default:
        return await Staff({ req })
    }
  } catch (err) {
    const id = String((req.context as { pkRequestId?: string }).pkRequestId ?? '')
    req.payload.logger.error({ msg: 'dashboard failed', layout, err: (err as Error).message })
    return <EmptyState text={`Data tidak dapat dimuat${id ? ` (kode permintaan ${id})` : ''}.`} />
  }
}

// ---------------------------------------------------------------- shared pieces

const prevOf = <T,>(xs: T[]) => (xs.length > 1 ? xs[xs.length - 2]! : null)
const lastOf = <T,>(xs: T[]) => xs[xs.length - 1]!
const short = (period: string) => periodLabel(period)
/** '2026-09-25' → '25 Sep' (full date in the title). */
const dayMonth = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS_SHORT[Number(date.slice(5, 7)) - 1] ?? ''}`

function PipelineCard({ id, pipeline, title, sub, span, i }: { id: string; pipeline: { stages: PipelineStage[]; exit: PipelineStage; total: number }; title: string; sub: string; span: 4 | 5 | 6; i: number }) {
  const row = (s: PipelineStage) => ({ key: s.key, label: s.label, count: s.count, sum: s.sum, href: statusList(s.statuses) })
  return (
    <Card id={id} title={title} sub={sub} span={span} i={i} action={{ href: ER, label: 'Semua pengajuan' }}>
      <PipelineBars id={id} stages={pipeline.stages.map(row)} exit={row(pipeline.exit)} empty="Belum ada pengajuan yang diajukan." />
      <TableView>
        <table className="pk-t" data-pk-table={`${id}-data`}>
          <thead>
            <tr>
              <th scope="col">Tahap</th>
              <th scope="col" className="n">
                Pengajuan
              </th>
              <th scope="col" className="n">
                Grand total
              </th>
            </tr>
          </thead>
          <tbody>
            {[...pipeline.stages, pipeline.exit].map((s) => (
              <tr key={s.key}>
                <td>{s.label}</td>
                <td className="n">{s.count}</td>
                <td className="n">{rp(s.sum)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableView>
    </Card>
  )
}

type Categories = Awaited<ReturnType<typeof ownerDashboard>>['viz']['categories']

function CategoryCard({ id, c, span, i, sub }: { id: string; c: Categories; span: 4 | 5 | 6; i: number; sub: string }) {
  return (
    <Card
      id={id}
      title="Komposisi biaya per kategori"
      sub={sub}
      span={span}
      i={i}
      action={{ href: '/admin/laporan/pengeluaran-kategori', label: 'Laporan' }}
      foot={c.includesManual ? 'Dicairkan (K-17): transfer pengajuan + kas keluar manual.' : 'Dicairkan (K-17): transfer pengajuan, tanpa kas manual.'}
    >
      <HBarList
        id={id}
        fmt={rpShort}
        exact={rp}
        empty="Belum ada biaya yang dicairkan di rentang ini."
        items={c.items.map((it, k) => ({
          key: `${k}-${it.label}`,
          label: it.label,
          value: it.total,
          cls: it.other ? 'mute' : 's1',
          extra: pctText(share(it.total, c.total)),
          href: it.categoryId ? `/admin/laporan/pengeluaran-kategori?${where({ kategori: String(it.categoryId) })}` : undefined,
        }))}
      />
      <TableView>
        <table className="pk-t" data-pk-table={`${id}-data`}>
          <thead>
            <tr>
              <th scope="col">Kategori</th>
              <th scope="col" className="n">
                Dicairkan
              </th>
              <th scope="col" className="n">
                Porsi
              </th>
            </tr>
          </thead>
          <tbody>
            {c.items.map((it, k) => (
              <tr key={k}>
                <td>{it.label}</td>
                <td className="n">{rp(it.total)}</td>
                <td className="n">{pctText(share(it.total, c.total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableView>
    </Card>
  )
}

function TrendCard({ id, rows, title, sub, span, i }: { id: string; rows: Array<{ period: string; count: number; sum: number }>; title: string; sub: string; span: 5 | 6 | 7; i: number }) {
  return (
    <Card id={id} title={title} sub={sub} span={span} i={i}>
      <LineChart
        id={id}
        rows={rows.map((r) => ({ period: r.period, value: r.count, extra: rp(r.sum) }))}
        fmt={(v) => String(v)}
        label="pengajuan"
        aria={`${title}: ${rows.map((r) => `${short(r.period)} ${r.count}`).join(', ')}`}
        empty="Belum ada pengajuan di rentang ini."
      />
      <TableView>
        <table className="pk-t" data-pk-table={`${id}-data`}>
          <thead>
            <tr>
              <th scope="col">Bulan</th>
              <th scope="col" className="n">
                Pengajuan
              </th>
              <th scope="col" className="n">
                Grand total
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.period}>
                <td>{short(r.period)}</td>
                <td className="n">{r.count}</td>
                <td className="n">{rp(r.sum)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableView>
    </Card>
  )
}

function CashFlowCard({ id, rows, title, sub, foot, span, i, withKoreksi }: { id: string; rows: Array<{ period: string; masuk: number; keluar: number; koreksi?: number }>; title: string; sub: string; foot?: React.ReactNode; span: 7 | 8 | 12; i: number; withKoreksi?: boolean }) {
  return (
    <Card id={id} title={title} sub={sub} span={span} i={i} foot={foot} action={{ href: '/admin/laporan/rekap-kas', label: 'Rekap Kas' }}>
      <ColumnsChart
        id={id}
        rows={rows.map((r) => ({ period: r.period, values: [r.masuk, r.keluar] }))}
        series={[
          { key: 'in', label: 'Masuk', cls: 'in' },
          { key: 'out', label: 'Keluar', cls: 'out' },
        ]}
        hrefOf={rekapKasMonth}
        aria={`${title}: ${rows.map((r) => `${short(r.period)} masuk ${rp(r.masuk)}, keluar ${rp(r.keluar)}`).join('; ')}`}
        empty="Belum ada transaksi kas di rentang ini."
      />
      <TableView>
        <table className="pk-t" data-pk-table={`${id}-data`}>
          <thead>
            <tr>
              <th scope="col">Bulan</th>
              <th scope="col" className="n">
                Masuk
              </th>
              <th scope="col" className="n">
                Keluar
              </th>
              <th scope="col" className="n">
                Selisih
              </th>
              {withKoreksi ? (
                <th scope="col" className="n">
                  Koreksi void
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.period}>
                <td>
                  <a href={rekapKasMonth(r.period)}>{short(r.period)}</a>
                </td>
                <td className="n">{rp(r.masuk)}</td>
                <td className="n">{rp(r.keluar)}</td>
                <td className="n">{rp(r.masuk - r.keluar)}</td>
                {withKoreksi ? <td className="n">{rp(r.koreksi ?? 0)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </TableView>
    </Card>
  )
}

function bulletRows(projects: ProjectBudget[], limit: number) {
  return [...projects]
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || a.code.localeCompare(b.code))
    .slice(0, limit)
    .map((p) => ({
      key: String(p.id),
      label: `${p.code} ${p.name}`,
      sub: p.budget ? `RAB ${rpShort(p.budget)} · komitmen ${rpShort(p.committed)}` : 'Tanpa RAB',
      budget: p.budget,
      committed: p.committed,
      realized: p.realized,
      pct: p.pct,
      pctRealized: p.pctRealized,
      badge: <BudgetBadge tone={p.tone} />,
      href: `/admin/laporan/anggaran-project?project=${p.id}`,
      attrs: { 'data-pk-bullet': p.code },
    }))
}

function ProjectTable({ projects, pm, progress }: { projects: ProjectBudget[]; pm?: boolean; progress?: Map<number, ProjectProgress> }) {
  return (
    <table className="pk-t" data-pk-table="projects">
      <thead>
        <tr>
          <th scope="col">Project</th>
          <th scope="col" className="n">
            RAB
          </th>
          <th scope="col" className="n">
            Komitmen
          </th>
          <th scope="col" className="n">
            %
          </th>
          <th scope="col">Status</th>
          {pm ? null : (
            <th scope="col" className="n">
              Dicairkan
            </th>
          )}
          {pm ? null : (
            <th scope="col" className="n">
              Realisasi
            </th>
          )}
          <th scope="col">Progress fisik</th>
        </tr>
      </thead>
      <tbody>
        {projects.map((p) => (
          <tr key={p.id} data-pk-project={p.code}>
            <td>
              <a href={`/admin/laporan/anggaran-project?project=${p.id}`}>
                {p.code} {p.name}
              </a>
            </td>
            <td className="n">{rp(p.budget)}</td>
            <td className="n">{rp(p.committed)}</td>
            <td className="n" data-pk-kpi="k08">
              {p.pct === null ? '—' : p.pct.toFixed(2).replace('.', ',')}
            </td>
            <td>
              <BudgetBadge tone={p.tone} />
            </td>
            {pm ? null : <td className="n">{rp(p.disbursedNet)}</td>}
            {pm ? null : <td className="n">{rp(p.realized)}</td>}
            <td>
              <ProgressCell p={progress?.get(p.id)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BudgetCard({ id, projects, warnPct, span, i, pm, progress }: { id: string; projects: ProjectBudget[]; warnPct: number; span: 7 | 8 | 12; i: number; pm?: boolean; progress?: Map<number, ProjectProgress> }) {
  const limit = 8
  return (
    <Card
      id={id}
      title="Realisasi vs RAB per project"
      sub="Komitmen & realisasi terhadap RAB, urut % komitmen tertinggi"
      span={span}
      i={i}
      action={{ href: '/admin/laporan/anggaran-project', label: 'Laporan anggaran' }}
      foot={projects.length > limit ? `Menampilkan ${limit} dari ${projects.length} project — semua ada di tabel angka.` : 'Warna status dari Komitmen (K-08); progress fisik (K-09) di tabel angka dan kartu progress.'}
    >
      <div id="anggaran" />
      {projects.length > 0 ? <BulletLegend warnPct={warnPct} /> : null}
      <BulletRows id={id} rows={bulletRows(projects, limit)} warnPct={warnPct} empty={pm ? 'Anda belum ditetapkan sebagai PM project mana pun. Hubungi Direktur/Admin.' : 'Belum ada project.'} />
      {projects.length > 0 ? (
        <TableView>
          <ProjectTable projects={projects} pm={pm} progress={progress} />
        </TableView>
      ) : null}
    </Card>
  )
}

type InboxItem = Awaited<ReturnType<typeof ownerDashboard>>['viz']['inbox'][number]

function InboxCard({ id, items, count, span, i }: { id: string; items: InboxItem[]; count: number; span: 6 | 7 | 12; i: number }) {
  const cols: Col<InboxItem>[] = [
    {
      key: 'no',
      label: 'Pengajuan',
      cell: (r) => (
        <>
          <a href={reqHref(r.id)}>{r.docNo ?? `#${r.id}`}</a>
          <span className="sub">{r.title}</span>
        </>
      ),
    },
    { key: 'scope', label: 'Project / pusat biaya', sec: true, cell: (r) => r.scopeName || '—' },
    { key: 'step', label: 'Tindakan', cell: (r) => <StatusPill tone={r.overWarn ? 'warn' : 'wait'} label={`${r.step === 'approve' ? 'Approval' : 'Diketahui'}${r.overWarn ? ' · anggaran' : ''}`} /> },
    { key: 'amt', label: 'Grand total', num: true, cell: (r) => rp(r.grandTotal) },
  ]
  return (
    <Card id={id} title="Menunggu tindakan saya" sub={count > items.length ? `${items.length} dari ${count}, terlama dulu` : 'Terlama dulu'} span={span} i={i} action={{ href: '/admin/persetujuan', label: 'Buka Persetujuan' }}>
      <DataTable id={id} cols={cols} rows={items} rowKey={(r) => r.id} caption="Pengajuan yang menunggu Diketahui/Approval saya" empty={<EmptyState text="Tidak ada pengajuan yang menunggu Anda. ✓" />} />
    </Card>
  )
}

type TeamWaiting = Awaited<ReturnType<typeof pmDashboard>>['teamWaiting']
type TeamWaitingRow = TeamWaiting['items'][number]

/** S3e (US-17, S-01): PM monitoring card — team requests waiting for the Direktur / Finance, oldest first. */
function TeamWaitingCard({ id, data, span, i }: { id: string; data: TeamWaiting; span: 6 | 7 | 12; i: number }) {
  const cols: Col<TeamWaitingRow>[] = [
    {
      key: 'no',
      label: 'Pengajuan',
      cell: (r) => (
        <>
          <a href={reqHref(r.id)}>{r.docNo ?? `#${r.id}`}</a>
          <span className="sub">
            {r.title}
            {r.requesters ? ` · ${r.requesters}` : ''}
          </span>
        </>
      ),
    },
    { key: 'scope', label: 'Project / pusat biaya', sec: true, cell: (r) => r.scopeName || '—' },
    { key: 'who', label: 'Menunggu', cell: (r) => <StatusPill tone={r.days !== null && r.days > 3 ? 'warn' : 'wait'} label={r.waitingFor === 'direktur' ? 'Direktur' : 'Finance'} /> },
    { key: 'age', label: 'Lama', num: true, cell: (r) => (r.days === null ? '—' : <span title={r.submittedDate ?? ''}>{r.days} hari</span>) },
    { key: 'amt', label: 'Grand total', num: true, cell: (r) => rp(r.grandTotal) },
  ]
  return (
    <Card
      id={id}
      title="Pengajuan tim menunggu keputusan"
      sub={data.count > data.items.length ? `${data.items.length} dari ${data.count}, terlama dulu · Anda memantau, Direktur/Finance memutuskan` : 'Terlama dulu · Anda memantau, Direktur/Finance memutuskan'}
      span={span}
      i={i}
      action={{ href: statusList(WAITING), label: 'Lihat semua' }}
    >
      <DataTable id={id} cols={cols} rows={data.items} rowKey={(r) => r.id} caption="Pengajuan tim yang menunggu Direktur atau Finance" empty={<EmptyState text="Tidak ada pengajuan tim yang menunggu keputusan. ✓" />} />
    </Card>
  )
}

type CashRow = Awaited<ReturnType<typeof ownerDashboard>>['viz']['recentCash'][number]
const SOURCE: Record<string, string> = { transfer: 'Transfer', settlement_refund: 'Pengembalian LPJ', manual: 'Manual', reversal: 'Jurnal balik', opening: 'Saldo awal' }

function RecentCashCard({ id, rows, span, i }: { id: string; rows: CashRow[]; span: 6 | 8 | 12; i: number }) {
  const cols: Col<CashRow>[] = [
    { key: 'date', label: 'Tanggal', sort: 'descending', cell: (r) => <span className="nw" title={r.entryDate}>{dayMonth(r.entryDate)}</span> },
    {
      key: 'desc',
      label: 'Transaksi',
      cell: (r) => (
        <>
          <a href={`/admin/collections/cash-entries/${r.id}`}>{r.entryNo ?? `#${r.id}`}</a>
          <span className="sub">{r.requestDocNo ? `${r.requestDocNo} · ${r.label}` : r.label || SOURCE[r.sourceType]}</span>
        </>
      ),
    },
    { key: 'acc', label: 'Akun', sec: true, cell: (r) => r.account },
    { key: 'src', label: 'Sumber', sec: true, cell: (r) => (r.status === 'void' ? <StatusPill tone="bad" label="Void" /> : (SOURCE[r.sourceType] ?? r.sourceType)) },
    {
      key: 'amt',
      label: 'Nominal',
      num: true,
      cell: (r) => (
        <span className="amt nw">
          <span className={`dir ${r.direction}`} aria-hidden>
            {r.direction === 'in' ? '+' : '−'}
          </span>
          <span style={SR}>{r.direction === 'in' ? 'masuk ' : 'keluar '}</span>
          {rp(r.amount)}
        </span>
      ),
    },
  ]
  return (
    <Card id={id} title="Transaksi kas terbaru" sub="Buku kas, termasuk void & jurnal balik" span={span} i={i} action={{ href: '/admin/kas', label: 'Buku kas' }}>
      <DataTable
        id={id}
        cols={cols}
        rows={rows}
        rowKey={(r) => r.id}
        rowAttrs={(r) => ({ className: r.status === 'void' ? 'void' : undefined })}
        caption="Transaksi kas terbaru"
        empty={<EmptyState text="Belum ada transaksi kas." action={{ href: '/admin/kas/baru', label: 'Catat kas masuk/keluar' }} />}
      />
    </Card>
  )
}

function Swatch({ cls }: { cls: string }) {
  return <i className={cls} style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, margin: '0 4px 0 0' }} aria-hidden />
}

const progressMap = (k: { projects: ProjectProgress[] }) => new Map(k.projects.map((p) => [p.id, p]))

/** E4 (US-31): latest progress reports of the PM's team (replaces the F5 placeholder). */
function LatestProgressReports({ rows }: { rows: Awaited<ReturnType<typeof listReports>>['items'] }) {
  if (rows.length === 0) return <EmptyState text="Belum ada laporan progress project tim." action={{ href: '/admin/progress', label: 'Progress project' }} />
  return (
    <div data-pk-list="latest-progress">
      <DataTable
        id="latest-progress"
        caption="Laporan progress terbaru"
        rows={rows}
        rowKey={(r) => r.id}
        empty={null}
        cols={[
          { key: 'd', label: 'Tanggal', cell: (r) => <span className="nw">{dateId(r.reportDate)}</span> },
          {
            key: 'n',
            label: 'Laporan',
            cell: (r) => (
              <>
                <a href={`/admin/progress/laporan/${r.id}`}>{r.docNo ?? `#${r.id}`}</a>
                <span className="sub">
                  {r.project.code} · {r.stage.name}
                </span>
              </>
            ),
          },
          { key: 'p', label: 'Tahapan', num: true, cell: (r) => `${pctText(r.pctBefore)} → ${pctText(r.pctAfter)}` },
        ]}
      />
    </div>
  )
}

// ---------------------------------------------------------------- Owner (wireframe §1)

async function Owner({ req, months }: { req: PayloadRequest; months: 6 | 12 }) {
  const d = await withReqTransaction(req, () => ownerDashboard(req, { months }))
  const k09 = await withReqTransaction(req, async () => projectProgressVsBudget(req, await officeScope(req)))
  const v = d.viz
  const bal = v.balanceTrend
  const balPrev = prevOf(bal)
  const disb = lastOf(v.disbursed)
  const disbPrev = prevOf(v.disbursed)
  const bt = v.budgetTotals
  const realPct = share(bt.realized, bt.budget)
  const comPct = share(bt.committed, bt.budget)
  const topRealized = [...d.projects]
    .filter((p) => p.pctRealized !== null)
    .sort((a, b) => (b.pctRealized ?? 0) - (a.pctRealized ?? 0))
    .slice(0, 5)
  const a = d.approvals
  return (
    <>
      <p className="pk-note" style={{ margin: '-8px 0 16px' }}>
        Per {d.asOf} (WITA) · grafik {d.cashFlow.months} bulan terakhir · warna anggaran dari Komitmen.
      </p>
      <Bento label="Ringkasan Direktur">
        <KpiRow>
          <KpiTile id="cash" hero icon="wallet" label="Saldo kas total" value={rpShort(d.cash.total)} title={rp(d.cash.total)} kpi="k01-total" href={rekapKasMonth(d.month)} more="Rekap Kas" i={0}>
            <p className="pk-kpi-x">{rp(d.cash.total)}</p>
            {balPrev ? <Delta d={delta(d.cash.total, balPrev.balance)} good="up" vs={`vs akhir ${short(balPrev.period)}`} /> : null}
            <Sparkline label="Saldo akhir bulan" values={bal.map((b) => ({ label: short(b.period), value: b.balance }))} />
            <p className="pk-kpi-x" data-pk-kpi="k02b-month">
              Bulan ini <b>+{rpShort(d.cash.monthIn)}</b> / <b>−{rpShort(d.cash.monthOut)}</b>
            </p>
          </KpiTile>
          <KpiTile id="approvals" icon="clock" label="Pengajuan menunggu" value={`${a.count}`} title={`${a.count} pengajuan`} kpi="k10-count" href={statusList(WAITING)} more="Lihat pengajuan" i={1}>
            <p className="pk-kpi-x" data-pk-kpi="k10-sum">
              {a.count === 0 ? 'Tidak ada yang menunggu ✓' : <b>{rp(a.sum)}</b>}
            </p>
            {a.count > 0 ? (
              <>
                <div className="pk-split" aria-hidden>
                  {a.pendingAck.count > 0 ? <span className="o1" style={{ flex: a.pendingAck.count }} /> : null}
                  {a.pendingApproval.count > 0 ? <span className="o2" style={{ flex: a.pendingApproval.count }} /> : null}
                </div>
                <p className="pk-kpi-x">
                  <Swatch cls="o1" />
                  Diketahui <b>{a.pendingAck.count}</b> · <Swatch cls="o3" />
                  Approval <b>{a.pendingApproval.count}</b>
                </p>
              </>
            ) : null}
            <p className="pk-kpi-x" data-pk-kpi="k10-mine">
              <b>{a.waitingForMe}</b> menunggu saya{a.oldestDays !== null ? ` · tertua ${a.oldestDays} hari` : ''}
            </p>
          </KpiTile>
          <KpiTile id="disbursed" icon="send" label="Pencairan bulan ini" value={rpShort(disb.net)} title={rp(disb.net)} kpi="k05-month" href="/admin/laporan/pengeluaran-kategori" more="Pengeluaran per kategori" i={2}>
            <p className="pk-kpi-x">{rp(disb.net)} dicairkan bersih</p>
            {disbPrev ? <Delta d={delta(disb.net, disbPrev.net)} vs={`vs ${short(disbPrev.period)}`} /> : null}
            <Sparkline label="Pencairan bersih per bulan" values={v.disbursed.map((x) => ({ label: short(x.period), value: x.net }))} />
          </KpiTile>
          <KpiTile id="budget" icon="target" label="Realisasi vs anggaran" value={pctText(realPct)} title={`${pctText(realPct)} dari RAB`} kpi="k06-pct" href="#anggaran" more="Anggaran project" i={3}>
            <p className="pk-kpi-x">
              <b>{rpShort(bt.realized)}</b> dari RAB {rpShort(bt.budget)}
            </p>
            <Meter value={bt.realized} max={bt.budget} />
            <p className="pk-kpi-x">
              Komitmen {pctText(comPct)} · {bt.projects} project ber-RAB
            </p>
            <p className="pk-kpi-x" data-pk-kpi="k08-running">
              {d.budget.running} berjalan: <BudgetBadge tone="over" /> {d.budget.over} <BudgetBadge tone="warn" /> {d.budget.warn} <BudgetBadge tone="ok" /> {d.budget.ok}
              {d.budget.none ? (
                <>
                  {' '}
                  <BudgetBadge tone="none" /> {d.budget.none}
                </>
              ) : null}
            </p>
          </KpiTile>
        </KpiRow>

        <CashFlowCard id="owner-cashflow" rows={d.cashFlow.rows} title="Arus kas bulanan" sub="Masuk vs keluar, tanpa transaksi yang di-void (K-02b)" span={8} i={4} foot="Grafik operasional: void dan jurnal baliknya disembunyikan. Laporan resmi = Rekap Kas." />
        <PipelineCard id="owner-pipeline" pipeline={v.pipeline} title="Status pengajuan" sub="Posisi semua pengajuan saat ini" span={4} i={5} />

        <BudgetCard id="owner-budget" projects={d.projects} warnPct={v.warnPct} span={7} i={6} progress={progressMap(k09)} />
        <CategoryCard id="owner-categories" c={v.categories} span={5} i={7} sub={`Dicairkan ${short(v.categories.from.slice(0, 7))} – sekarang`} />

        <TrendCard id="owner-trend" rows={v.requestTrend} title="Tren pengajuan" sub="Jumlah pengajuan per bulan (tanggal pengajuan)" span={6} i={8} />
        <Card id="accounts" title="Saldo per akun" sub="Akun nonaktif bersaldo 0 disembunyikan" span={3} i={9}>
          <HBarList
            id="owner-accounts"
            fmt={rpShort}
            exact={rp}
            empty="Belum ada akun kas."
            items={[...d.cash.accounts]
              .sort((x, y) => y.balance - x.balance)
              .map((acc) => ({ key: String(acc.id), label: `${acc.name}${acc.active ? '' : ' (nonaktif)'}`, value: Math.max(0, acc.balance), href: `/admin/laporan/rekap-kas?akun=${acc.id}`, attrs: { 'data-pk-account': String(acc.id) } }))}
          />
        </Card>
        <Card id="completeness" title="Kelengkapan nota/LPJ" span={3} i={10} action={{ href: '/admin/laporan/kelengkapan', label: 'Laporan' }}>
          <p className="pk-kpi-v" style={{ fontSize: 22, margin: 0 }} data-pk-kpi="k12g">
            {d.completeness.ratioDone} / {d.completeness.ratioTotal}
          </p>
          <p className="pk-kpi-x">uang muka bulan ini sudah LPJ</p>
          <Meter value={d.completeness.ratioDone} max={Math.max(1, d.completeness.ratioTotal)} />
          <p className="pk-kpi-x" data-pk-kpi="k12b">
            {d.completeness.overdue > 0 ? <StatusPill tone="bad" label={`${d.completeness.overdue} LPJ terlambat`} /> : <StatusPill tone="ok" label="Tidak ada LPJ terlambat" />}
          </p>
          <p className="pk-kpi-x" data-pk-kpi="k12a">
            <b>{d.completeness.withoutLpj}</b> uang muka belum LPJ
          </p>
          <p className="pk-kpi-x" data-pk-kpi="k12e">
            <b>{d.completeness.reimburseToVerify}</b> nota reimburse menunggu verifikasi
          </p>
          <p className="pk-kpi-x" data-pk-kpi="k12f">
            <b>{d.completeness.openWarnings}</b> flag peringatan terbuka
          </p>
        </Card>

        <ProgressVsBudgetCard id="owner-progress" data={k09} i={11} />
        <InboxCard id="owner-inbox" items={v.inbox} count={a.waitingForMe} span={6} i={11} />
        <RecentCashCard id="owner-recent-cash" rows={v.recentCash} span={6} i={12} />

        <Card id="top-realized" title="Project dengan realisasi tertinggi" sub="% realisasi terverifikasi terhadap RAB" span={6} i={13} action={{ href: '/admin/laporan/anggaran-project', label: 'Semua project' }}>
          <DataTable
            id="top-realized"
            caption="Project dengan realisasi tertinggi"
            rows={topRealized}
            rowKey={(p) => p.id}
            empty={<EmptyState text="Belum ada project ber-RAB dengan realisasi." />}
            cols={[
              {
                key: 'p',
                label: 'Project',
                cell: (p) => (
                  <a href={`/admin/laporan/anggaran-project?project=${p.id}`}>
                    {p.code} {p.name}
                  </a>
                ),
              },
              { key: 'rab', label: 'RAB', num: true, sec: true, cell: (p) => rpShort(p.budget ?? 0) },
              { key: 'real', label: 'Realisasi', num: true, cell: (p) => rpShort(p.realized) },
              { key: 'pct', label: '% RAB', num: true, sort: 'descending', cell: (p) => pctText(p.pctRealized) },
              { key: 'st', label: 'Status', cell: (p) => <BudgetBadge tone={p.tone} /> },
            ]}
          />
        </Card>
        <Card id="cost-centers" title="Pusat biaya bulan ini" sub="K-15, per pusat biaya" span={3} i={14}>
          <HBarList
            id="owner-cost-centers"
            fmt={rpShort}
            exact={rp}
            empty="Belum ada biaya pusat biaya bulan ini."
            items={[...d.costCenters]
              .sort((x, y) => y.total - x.total)
              .map((c) => ({ key: String(c.id), label: `${c.code} ${c.name}`, value: Math.max(0, c.total), href: `/admin/laporan/rekap-kas?${where({ pusat: String(c.id), dari: d.month, sampai: d.month })}`, attrs: { 'data-pk-cost-center': String(c.id) } }))}
          />
        </Card>
        <Card id="transfer-queue" title="Antrian transfer" sub="Lihat saja (Finance yang memproses)" span={3} i={15} action={{ href: '/admin/antrian-transfer', label: 'Antrian' }}>
          <p className="pk-kpi-v" style={{ fontSize: 22, margin: 0 }} data-pk-kpi="k11-count">
            {d.transferQueue.count} · {rpShort(d.transferQueue.sum)}
          </p>
          <p className="pk-kpi-x">{rp(d.transferQueue.sum)}</p>
          <p className="pk-kpi-x" style={{ marginTop: 8 }}>
            {d.transferQueue.overdue > 0 ? <StatusPill tone="warn" label={`${d.transferQueue.overdue} lewat tanggal dibutuhkan`} /> : <StatusPill tone="ok" label="Tidak ada yang lewat tanggal" />}
          </p>
        </Card>
      </Bento>
    </>
  )
}

// ---------------------------------------------------------------- Finance (wireframe §2)

async function Finance({ req }: { req: PayloadRequest }) {
  const d = await withReqTransaction(req, () => financeDashboard(req))
  const k09 = await withReqTransaction(req, async () => projectProgressVsBudget(req, await officeScope(req)))
  const v = d.viz
  const flows = d.cashFlow.rows
  const cur = lastOf(flows)
  const prev = prevOf(flows)
  const balPrev = prevOf(v.balanceTrend)
  type Q = (typeof v.transferTop)[number]
  type A = (typeof d.advancesWithoutLpj)[number]
  return (
    <>
      <p className="pk-note" style={{ margin: '-8px 0 16px' }}>
        Per {d.asOf} (WITA) · buku kas termasuk koreksi void.
      </p>
      <Bento label="Ringkasan Finance">
        <KpiRow cols={6}>
          <KpiTile id="cash" icon="wallet" label="Saldo kas total" value={rpShort(d.cashTotal)} title={rp(d.cashTotal)} kpi="k01-total" href="#pk-card-accounts" more="Saldo per akun" i={0}>
            <p className="pk-kpi-x">{rp(d.cashTotal)}</p>
            {balPrev ? <Delta d={delta(d.cashTotal, balPrev.balance)} good="up" vs={`vs akhir ${short(balPrev.period)}`} /> : null}
            <Sparkline label="Saldo akhir bulan" values={v.balanceTrend.map((b) => ({ label: short(b.period), value: b.balance }))} />
          </KpiTile>
          <KpiTile id="transfer-queue" icon="send" label="Antrian transfer" value={`${d.transferQueue.count}`} title={`${d.transferQueue.count} pengajuan`} kpi="k11-count" href="/admin/antrian-transfer" more="Antrian Transfer" i={1}>
            <p className="pk-kpi-x">
              <b>{rp(d.transferQueue.sum)}</b>
            </p>
            <p className="pk-kpi-x" data-pk-kpi="k11-overdue">
              {d.transferQueue.overdue > 0 ? <StatusPill tone="warn" label={`${d.transferQueue.overdue} lewat tanggal dibutuhkan`} /> : <StatusPill tone="ok" label="Tepat waktu" />}
            </p>
          </KpiTile>
          <KpiTile id="lpj-verify" icon="check" label="Menunggu verifikasi" value={`${d.lpjToVerify + d.reimburseToVerify.count}`} title={`${d.lpjToVerify} LPJ, ${d.reimburseToVerify.count} nota reimburse`} href="/admin/verifikasi-lpj" more="Verifikasi LPJ" i={2}>
            <p className="pk-kpi-x" data-pk-kpi="k12c">
              <b>{d.lpjToVerify}</b> LPJ
            </p>
            <p className="pk-kpi-x" data-pk-kpi="k12e">
              <b>{d.reimburseToVerify.count}</b> nota reimburse · {d.reimburseToVerify.warnings} flag
            </p>
          </KpiTile>
          <KpiTile id="month-in" icon="down" label={`Kas masuk ${short(cur.period)}`} value={rpShort(cur.masuk)} title={rp(cur.masuk)} kpi="k02a-in" href={rekapKasMonth(cur.period)} more="Rekap Kas" i={3}>
            <p className="pk-kpi-x">{rp(cur.masuk)}</p>
            {prev ? <Delta d={delta(cur.masuk, prev.masuk)} vs={`vs ${short(prev.period)}`} /> : null}
            <Sparkline label="Kas masuk per bulan" values={flows.map((f) => ({ label: short(f.period), value: f.masuk }))} />
          </KpiTile>
          <KpiTile id="month-out" icon="up" label={`Kas keluar ${short(cur.period)}`} value={rpShort(cur.keluar)} title={rp(cur.keluar)} kpi="k02a-out" href={rekapKasMonth(cur.period)} more="Rekap Kas" i={4}>
            <p className="pk-kpi-x">
              {rp(cur.keluar)} · selisih <b>{rpShort(cur.masuk - cur.keluar)}</b>
            </p>
            {prev ? <Delta d={delta(cur.keluar, prev.keluar)} vs={`vs ${short(prev.period)}`} /> : null}
            <Sparkline label="Kas keluar per bulan" values={flows.map((f) => ({ label: short(f.period), value: f.keluar }))} />
          </KpiTile>
          <KpiTile id="lpj-settle" icon="scale" label="Selisih LPJ" value={`${d.lpjToSettle.count}`} title={`${d.lpjToSettle.count} LPJ`} kpi="k12d" href="/admin/verifikasi-lpj" more="Selesaikan" i={5}>
            <p className="pk-kpi-x">
              pengembalian <b>{rp(d.lpjToSettle.refund)}</b>
            </p>
            <p className="pk-kpi-x">
              kekurangan <b>{rp(d.lpjToSettle.shortfall)}</b>
            </p>
          </KpiTile>
        </KpiRow>

        <CashFlowCard id="finance-cashflow" rows={flows} withKoreksi title="Arus kas bulanan" sub="Buku kas 6 bulan, termasuk koreksi void (K-02a)" span={8} i={6} />
        <Card id="accounts" title="Saldo per akun" sub={`Masuk/keluar ${short(cur.period)} di tabel angka`} span={4} i={7}>
          <HBarList
            id="finance-accounts"
            fmt={rpShort}
            exact={rp}
            empty="Belum ada akun kas."
            items={[...d.accounts]
              .sort((x, y) => y.balance - x.balance)
              .map((acc) => ({ key: String(acc.id), label: `${acc.name}${acc.active ? '' : ' (nonaktif)'}`, value: Math.max(0, acc.balance), href: `/admin/laporan/rekap-kas?akun=${acc.id}`, attrs: { 'data-pk-account': String(acc.id) } }))}
          />
          <TableView>
            <table className="pk-t" data-pk-table="accounts">
              <thead>
                <tr>
                  <th scope="col">Akun</th>
                  <th scope="col" className="n">
                    Saldo
                  </th>
                  <th scope="col" className="n">
                    Masuk
                  </th>
                  <th scope="col" className="n">
                    Keluar
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.accounts.map((acc) => (
                  <tr key={acc.id}>
                    <td>{acc.name}</td>
                    <td className="n">{rp(acc.balance)}</td>
                    <td className="n">{rp(acc.monthIn)}</td>
                    <td className="n">{rp(acc.monthOut)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="n">{rp(d.cashTotal)}</td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </TableView>
        </Card>

        <Card id="finance-queue" title="Menunggu tindakan saya: transfer" sub="Tanggal dibutuhkan terdekat dulu" span={7} i={8} action={{ href: '/admin/antrian-transfer', label: 'Antrian Transfer' }}>
          <DataTable<Q>
            id="finance-queue"
            caption="Antrian transfer teratas"
            rows={v.transferTop}
            rowKey={(r) => r.id}
            empty={<EmptyState text="Antrian transfer kosong. ✓" />}
            cols={[
              {
                key: 'no',
                label: 'Pengajuan',
                cell: (r) => (
                  <>
                    <a href={reqHref(r.id)}>{r.docNo ?? `#${r.id}`}</a>
                    <span className="sub">{r.title}</span>
                  </>
                ),
              },
              { key: 'scope', label: 'Project / pusat biaya', sec: true, cell: (r) => r.scopeName || '—' },
              { key: 'need', label: 'Dibutuhkan', sort: 'ascending', cell: (r) => (r.overdue ? <StatusPill tone="warn" label={`${r.neededDate ?? ''} lewat`} /> : (r.neededDate ?? '—')) },
              { key: 'amt', label: 'Nominal', num: true, cell: (r) => rp(r.amount) },
            ]}
          />
        </Card>
        <PipelineCard id="finance-pipeline" pipeline={v.pipeline} title="Status pengajuan" sub="Posisi semua pengajuan saat ini" span={5} i={9} />

        <Card id="advances-without-lpj" title="Uang muka belum LPJ" sub={`Terlambat bila > ${d.lpjDueDays} hari sejak transfer pertama`} span={7} i={10} action={{ href: '/admin/laporan/kelengkapan', label: 'Laporan' }}>
          <DataTable<A>
            id="advances-without-lpj"
            caption="Uang muka belum LPJ"
            rows={d.advancesWithoutLpj.slice(0, 8)}
            rowKey={(r) => r.id}
            rowAttrs={(r) => ({ 'data-pk-overdue': r.overdue ? 'yes' : 'no' })}
            empty={<EmptyState text="Semua uang muka sudah ber-LPJ. ✓" />}
            cols={[
              { key: 'no', label: 'Nomor', cell: (r) => <a href={reqHref(r.id)}>{r.docNo ?? `#${r.id}`}</a> },
              { key: 'who', label: 'Pemohon', sec: true, cell: (r) => r.requesters || '—' },
              { key: 'amt', label: 'Nominal', num: true, cell: (r) => rp(r.transferredTotal) },
              { key: 'age', label: 'Umur', num: true, sort: 'descending', cell: (r) => (r.overdue ? <StatusPill tone="bad" label={`${r.ageDays ?? '—'} hr terlambat`} /> : `${r.ageDays ?? '—'} hr`) },
            ]}
          />
        </Card>
        <Card id="finance-disbursed" title="Pencairan bersih per bulan" sub="Transfer − pengembalian LPJ (K-05)" span={5} i={11}>
          <ColumnsChart
            id="finance-disbursed"
            rows={v.disbursed.map((x) => ({ period: x.period, values: [x.net] }))}
            series={[{ key: 'net', label: 'Dicairkan bersih', cls: 's1' }]}
            aria={`Pencairan bersih per bulan: ${v.disbursed.map((x) => `${short(x.period)} ${rp(x.net)}`).join(', ')}`}
            empty="Belum ada pencairan di rentang ini."
          />
          <TableView>
            <table className="pk-t" data-pk-table="finance-disbursed-data">
              <tbody>
                {v.disbursed.map((x) => (
                  <tr key={x.period}>
                    <td>{short(x.period)}</td>
                    <td className="n">{rp(x.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableView>
        </Card>

        <ProgressVsBudgetCard id="finance-progress" data={k09} i={12} />
        <RecentCashCard id="finance-recent-cash" rows={v.recentCash} span={8} i={12} />
        <CategoryCard id="finance-categories" c={v.categories} span={4} i={13} sub="Dicairkan 6 bulan terakhir" />

        <Card id="period-close" title="Tutup buku" span={6} i={14} action={{ href: '/admin/tutup-buku', label: 'Tutup buku' }}>
          <p className="pk-kpi-x" data-pk-kpi="last-closed" style={{ fontSize: 14 }}>
            {d.lastClosedPeriod ? (
              <>
                Bulan terakhir ditutup: <b>{d.lastClosedPeriod}</b>
              </>
            ) : (
              'Belum pernah tutup buku.'
            )}
          </p>
          <p className="pk-kpi-x">Bulan yang bisa ditutup: {d.nextClosable} (bulan lampau saja).</p>
        </Card>
        <Card id="quick" title="Aksi cepat" span={6} i={15}>
          <div className="pk-actions" style={{ margin: 0 }}>
            <Link className="pk-btn primary" href="/admin/kas/baru">
              + Kas masuk / keluar
            </Link>
            <Link className="pk-btn" href="/admin/laporan">
              Laporan
            </Link>
            <a className="pk-btn" href={`${ER}/create`}>
              Buat pengajuan
            </a>
          </div>
        </Card>
      </Bento>
    </>
  )
}

// ---------------------------------------------------------------- PM (wireframe §3, monitoring)

async function Pm({ req }: { req: PayloadRequest }) {
  const d = await withReqTransaction(req, () => pmDashboard(req))
  const k09 = await withReqTransaction(req, async () => projectProgressVsBudget(req, await teamScope(req)))
  const latestReports = await withReqTransaction(req, async () => (await listReports(req, { projectId: undefined, limit: 5 })).items)
  const v = d.viz
  const monthStart = `${d.month}-01`
  const trendPrev = prevOf(v.requestTrend)
  const bt = v.budgetTotals
  const realPct = share(bt.realized, bt.budget)
  type R = (typeof d.latest)[number]
  return (
    <>
      <p className="pk-note" style={{ margin: '-8px 0 16px' }}>
        Per {d.asOf} (WITA) · hanya project/pusat biaya tim Anda.
      </p>
      <Bento label="Ringkasan PM">
        <KpiRow>
          {/* S3e (US-17, ADR 0013, S-01): the PM monitors — who the team's requests are waiting for (never "me"). */}
          <KpiTile
            id="team-waiting"
            icon="inbox"
            label="Pengajuan tim menunggu keputusan"
            value={`${d.teamWaiting.count}`}
            title={`${d.teamWaiting.count} pengajuan tim menunggu Direktur/Finance`}
            kpi="k10-team"
            href={statusList(WAITING)}
            more="Lihat pengajuan"
            i={0}
          >
            <p className="pk-kpi-x">
              Direktur <b>{d.teamWaiting.direktur}</b> · Finance <b>{d.teamWaiting.finance}</b>
            </p>
            <p className="pk-kpi-x">{d.teamWaiting.oldestDays !== null ? `tertua ${d.teamWaiting.oldestDays} hari` : 'Tidak ada yang menunggu ✓'}</p>
          </KpiTile>
          <KpiTile
            id="team-month"
            icon="users"
            label="Pengajuan tim bulan ini"
            value={`${d.teamMonth.count}`}
            title={`${d.teamMonth.count} pengajuan, ${rp(d.teamMonth.sum)}`}
            kpi="k13-month"
            href={`${ER}?${where({ 'where[requestDate][greater_than_equal]': monthStart, 'where[requestDate][less_than_equal]': lastDay(d.month) })}`}
            more="Lihat pengajuan"
            i={1}
          >
            <p className="pk-kpi-x">
              <b>{rp(d.teamMonth.sum)}</b> · {d.teamMonth.waiting} menunggu persetujuan
            </p>
            {trendPrev ? <Delta d={delta(d.teamMonth.count, trendPrev.count)} money={false} vs={`pengajuan vs ${short(trendPrev.period)}`} /> : null}
            <Sparkline label="Pengajuan tim per bulan" values={v.requestTrend.map((x) => ({ label: short(x.period), value: x.count }))} />
          </KpiTile>
          <KpiTile id="team-lpj" icon="doc" label="LPJ tim" value={`${d.lpj.withoutLpj}`} title={`${d.lpj.withoutLpj} uang muka belum LPJ`} kpi="k12a" href="/admin/laporan/kelengkapan" more="Laporan Kelengkapan" i={2}>
            <p className="pk-kpi-x">uang muka belum LPJ</p>
            <p className="pk-kpi-x" data-pk-kpi="k12b">
              {d.lpj.overdue > 0 ? <StatusPill tone="bad" label={`${d.lpj.overdue} terlambat`} /> : <StatusPill tone="ok" label="Tidak ada yang terlambat" />}
            </p>
          </KpiTile>
          <KpiTile id="team-budget" icon="target" label="Realisasi anggaran project saya" value={pctText(realPct)} title={`${pctText(realPct)} dari RAB`} href="#anggaran" more="Per project" i={3}>
            <p className="pk-kpi-x">
              <b>{rpShort(bt.realized)}</b> dari RAB {rpShort(bt.budget)}
            </p>
            <Meter value={bt.realized} max={bt.budget} />
            <p className="pk-kpi-x">
              Komitmen {pctText(share(bt.committed, bt.budget))} · {bt.projects} project ber-RAB
            </p>
          </KpiTile>
        </KpiRow>

        <ProgressVsBudgetCard id="pm-progress" data={k09} i={4} pm />
        <BudgetCard id="pm-budget" projects={d.projects} warnPct={v.warnPct} span={7} i={4} pm progress={progressMap(k09)} />
        <PipelineCard id="pm-pipeline" pipeline={v.pipeline} title="Status pengajuan tim" sub="Posisi pengajuan tim saat ini" span={5} i={5} />

        <TrendCard id="pm-trend" rows={v.requestTrend} title="Tren pengajuan tim" sub="Jumlah pengajuan per bulan, 6 bulan" span={7} i={6} />
        <CategoryCard id="pm-categories" c={v.categories} span={5} i={7} sub="Dicairkan 6 bulan terakhir, tim Anda" />

        <TeamWaitingCard id="pm-waiting" data={d.teamWaiting} span={6} i={8} />
        <Card id="team-latest" title="Pengajuan tim terbaru" span={6} i={9} action={{ href: ER, label: 'Lihat semua' }}>
          <DataTable<R>
            id="team-latest"
            caption="Pengajuan tim terbaru"
            rows={d.latest}
            rowKey={(r) => r.id}
            empty={<EmptyState text="Belum ada pengajuan tim." />}
            cols={[
              {
                key: 'no',
                label: 'Nomor',
                sort: 'descending',
                cell: (r) => (
                  <>
                    <a href={reqHref(r.id)}>{r.docNo ?? `#${r.id}`}</a>
                    <span className="sub">{r.title}</span>
                  </>
                ),
              },
              { key: 'who', label: 'Pemohon', sec: true, cell: (r) => r.requesters || '—' },
              { key: 'st', label: 'Status', cell: (r) => <StatusPill tone={statusTone(r.status)} label={statusLabel(r.type, r.status)} /> },
              { key: 'amt', label: 'Grand total', num: true, cell: (r) => rp(r.grandTotal) },
            ]}
          />
        </Card>

        <Card id="pm-cost-centers" title="Pusat biaya saya bulan ini" sub="K-15, tanpa kas manual kantor" span={6} i={10}>
          <HBarList
            id="pm-cost-centers"
            fmt={rpShort}
            exact={rp}
            empty="Anda tidak memegang pusat biaya."
            items={[...d.costCenters]
              .sort((x, y) => y.total - x.total)
              .map((c) => ({ key: String(c.id), label: `${c.code} ${c.name}`, value: Math.max(0, c.total), href: `/admin/laporan/rekap-pengajuan?${where({ pusat: String(c.id), dari: monthStart, sampai: lastDay(d.month) })}`, attrs: { 'data-pk-cost-center': String(c.id) } }))}
          />
        </Card>
        <Card id="f5" title="Lapangan" sub="Kehadiran tim hari ini · laporan progress terbaru" span={6} i={11}>
          <div style={{ display: 'grid', gap: 8 }}>
            <TeamTodayWidget req={req} />
            <LatestProgressReports rows={latestReports} />
          </div>
        </Card>
      </Bento>
    </>
  )
}

// ---------------------------------------------------------------- Admin (wireframe §4a)

async function Admin({ req }: { req: PayloadRequest }) {
  const d = await withReqTransaction(req, () => adminDashboard(req))
  const g = d.gaps
  type AuditRow = (typeof d.latestAudit)[number]
  return (
    <Bento label="Ringkasan Admin">
      <KpiRow cols={3}>
        <KpiTile id="master-gaps" icon="users" label="User tanpa karyawan/peran" value={`${g.usersIncomplete}`} kpi="users-incomplete" href={`/admin/collections/users?${where({ 'where[employee][exists]': 'false' })}`} more="Lengkapi" i={0}>
          <p className="pk-kpi-x">{g.usersIncomplete === 0 ? <StatusPill tone="ok" label="Lengkap" /> : <StatusPill tone="warn" label="Perlu dilengkapi" />}</p>
        </KpiTile>
        <KpiTile id="projects-without-pm" icon="target" label="Project tanpa PM" value={`${g.projectsWithoutPm}`} kpi="projects-without-pm" href={`/admin/collections/projects?${where({ 'where[pm][exists]': 'false' })}`} more="Tetapkan PM" i={1}>
          <p className="pk-kpi-x">{g.projectsWithoutPm === 0 ? <StatusPill tone="ok" label="Lengkap" /> : <StatusPill tone="warn" label="Perlu PM" />}</p>
        </KpiTile>
        <KpiTile
          id="cost-centers-without-manager"
          icon="scale"
          label="Pusat biaya tanpa penanggung jawab"
          value={`${g.costCentersWithoutManager}`}
          kpi="cost-centers-without-manager"
          href={`/admin/collections/cost-centers?${where({ 'where[manager][exists]': 'false' })}`}
          more="Tetapkan"
          i={2}
        >
          <p className="pk-kpi-x">{g.costCentersWithoutManager === 0 ? <StatusPill tone="ok" label="Lengkap" /> : <StatusPill tone="warn" label="Perlu penanggung jawab" />}</p>
        </KpiTile>
      </KpiRow>
      <Card id="latest-audit" title="Audit log terbaru" sub="30 hari terakhir" span={12} i={3} action={{ href: '/admin/audit-log', label: 'Audit Log lengkap' }}>
        <DataTable<AuditRow>
          id="latest-audit"
          caption="Audit log terbaru"
          rows={d.latestAudit}
          rowKey={(a) => a.id}
          empty={<EmptyState text="Belum ada aktivitas." />}
          cols={[
            { key: 't', label: 'Waktu (WITA)', sort: 'descending', cell: (a) => a.localTime },
            { key: 'u', label: 'User', cell: (a) => a.userName ?? (a.userId === null ? 'sistem' : `user#${a.userId}`) },
            { key: 'a', label: 'Aksi', cell: (a) => <StatusPill tone="none" label={a.action} /> },
            { key: 'd', label: 'Dokumen', sec: true, cell: (a) => `${a.docType} ${a.docNo ?? a.docId ?? ''}` },
          ]}
        />
      </Card>
    </Bento>
  )
}

// ---------------------------------------------------------------- Staff (wireframe §4, Q-F3-6)

async function Staff({ req }: { req: PayloadRequest }) {
  const d = await withReqTransaction(req, () => staffDashboard(req))
  const v = d.viz
  const user = req.user as { id: number; name?: string | null; email?: string } | null
  const hint: Record<string, string> = {
    draft: 'belum diajukan',
    receipt_revision: 'perbaiki nota',
    transferred: 'unggah nota & kirim LPJ / konfirmasi selesai',
    receipts_complete: 'kirim LPJ',
    lpj_revision: 'perbaiki LPJ',
  }
  const st = (k: string) => v.pipeline.stages.find((s) => s.key === k)?.count ?? 0
  const inProcess = st('ack') + st('approval') + st('queue') + st('lpj')
  const cur = lastOf(v.requestTrend)
  const prev = prevOf(v.requestTrend)
  type Own = (typeof d.latest)[number]
  const ownCols = (withHint: boolean): Col<Own>[] => [
    {
      key: 'no',
      label: 'Pengajuan',
      cell: (r) => (
        <>
          <a href={reqHref(r.id)}>{r.docNo ?? `Draft "${r.title}"`}</a>
          <span className="sub">{withHint ? (hint[r.status] ?? r.title) : r.title}</span>
        </>
      ),
    },
    { key: 'st', label: 'Status', cell: (r) => <StatusPill tone={statusTone(r.status as RequestStatus)} label={statusLabel(r.type as RequestType, r.status as RequestStatus)} /> },
    withHint ? { key: 'age', label: 'Umur', num: true, cell: (r) => `${r.ageDays} hr` } : { key: 'amt', label: 'Nominal', num: true, cell: (r) => rp(r.grandTotal) },
  ]
  return (
    <>
      <div className="pk-actions" style={{ margin: '-8px 0 16px' }}>
        <span style={{ marginRight: 'auto', color: 'var(--pk-muted-fg)' }}>Halo, {user?.name || user?.email}</span>
        <a className="pk-btn primary" href={`${ER}/create`} data-pk-action="new-request">
          + Buat pengajuan
        </a>
        <a className="pk-btn" href={`/admin/collections/users/${user?.id ?? ''}`}>
          Profil &amp; tanda tangan
        </a>
      </div>
      <Bento label="Ringkasan pengajuan saya">
        <KpiRow>
          <KpiTile id="my-actions" icon="inbox" label="Perlu tindakan saya" value={`${d.actions.length}`} href="#pk-card-my-actions" more="Lihat daftar" i={0}>
            <p className="pk-kpi-x">{d.actions.length === 0 ? 'Tidak ada yang perlu Anda kerjakan ✓' : 'draft, revisi, nota atau LPJ'}</p>
          </KpiTile>
          <KpiTile id="my-process" icon="clock" label="Sedang diproses" value={`${inProcess}`} href={ER} more="Pengajuan saya" i={1}>
            <p className="pk-kpi-x">
              menunggu persetujuan <b>{st('ack') + st('approval')}</b>
            </p>
          </KpiTile>
          <KpiTile id="my-month" icon="doc" label={`Pengajuan ${short(cur.period)}`} value={`${cur.count}`} title={`${cur.count} pengajuan, ${rp(cur.sum)}`} i={2}>
            <p className="pk-kpi-x">
              <b>{rp(cur.sum)}</b>
            </p>
            {prev ? <Delta d={delta(cur.count, prev.count)} money={false} vs={`vs ${short(prev.period)}`} /> : null}
          </KpiTile>
          <KpiTile id="my-done" icon="check" label="Selesai" value={`${st('done')}`} i={3}>
            <p className="pk-kpi-x">{v.pipeline.exit.count} ditolak/dibatalkan</p>
          </KpiTile>
        </KpiRow>

        <Card id="my-actions" title="Perlu tindakan saya" sub="Terbaru dulu" span={7} i={4}>
          <div data-pk-list="my-actions">
            <DataTable<Own>
              id="my-actions-table"
              caption="Pengajuan yang perlu tindakan saya"
              rows={d.actions}
              rowKey={(r) => r.id}
              cols={ownCols(true)}
              empty={<EmptyState text="Tidak ada yang perlu Anda kerjakan. ✓" action={{ href: `${ER}/create`, label: '+ Buat pengajuan' }} />}
            />
          </div>
        </Card>
        <PipelineCard id="my-pipeline" pipeline={v.pipeline} title="Status pengajuan saya" sub="Semua pengajuan yang pernah diajukan" span={5} i={5} />

        <Card id="my-requests" title="Pengajuan saya" sub="10 terbaru" span={7} i={6} action={{ href: ER, label: 'Lihat semua' }}>
          <DataTable<Own> id="my-requests" caption="Pengajuan saya" rows={d.latest} rowKey={(r) => r.id} cols={ownCols(false)} empty={<EmptyState text="Anda belum punya pengajuan." action={{ href: `${ER}/create`, label: '+ Buat pengajuan' }} />} />
        </Card>
        <Card id="my-trend" title="Nilai pengajuan saya per bulan" sub="6 bulan, tanpa draft" span={5} i={7}>
          <ColumnsChart
            id="my-trend"
            rows={v.requestTrend.map((x) => ({ period: x.period, values: [x.sum] }))}
            series={[{ key: 'sum', label: 'Grand total', cls: 's1' }]}
            aria={`Nilai pengajuan saya per bulan: ${v.requestTrend.map((x) => `${short(x.period)} ${rp(x.sum)} (${x.count})`).join(', ')}`}
            empty="Belum ada pengajuan dalam 6 bulan terakhir."
          />
          <TableView>
            <table className="pk-t" data-pk-table="my-trend-data">
              <tbody>
                {v.requestTrend.map((x) => (
                  <tr key={x.period}>
                    <td>{short(x.period)}</td>
                    <td className="n">{x.count}</td>
                    <td className="n">{rp(x.sum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableView>
        </Card>
      </Bento>
    </>
  )
}

export default Dashboard
