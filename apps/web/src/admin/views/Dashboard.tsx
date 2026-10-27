import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React, { Suspense } from 'react'

import { rolesOf, type Role } from '@/access/roles'
import { PENDING_OWNER } from '@/domain/expense/status-filter'
import { statusLabel, type RequestStatus, type RequestType } from '@/domain/expense/types'
import { adminDashboard, financeDashboard, ownerDashboard, pmDashboard, staffDashboard } from '@/domain/reports/dashboards'
import type { ProjectBudget } from '@/domain/reports/kpi'
import { lastDay, MONTHS_SHORT, periodLabel } from '@/domain/reports/rules'
import { delta, share, statusTone, type PipelineStage } from '@/domain/reports/viz'
import { resolveDisplayName } from '@/domain/user-display-name'
import { formatNumber } from '@/lib/money'
import { withReqTransaction } from '@/lib/system-tx'
import { listReports } from '@/domain/progress/dto'
import { projectProgressVsBudget, type ProjectProgress } from '@/domain/reports/progress'
import { officeScope, teamScope } from '@/domain/reports/scope'
import { PageHeader, SoftBadge, type Tone } from '@/admin/components/ui/nexus'
import { Icon as Glyph } from '@/admin/modules/Icon'

import { docHref } from '../doc-links'

import { TeamTodayWidget } from './Absensi'
import { LoanCard } from './dashboard-loans'
import { IntercompanyCard } from './dashboard-intercompany'
import { RapMissingCard, RapMonitorCard } from './dashboard-rap'
import { SlaTransferCard } from './dashboard-sla'
import { ChartHover } from './ChartHover'
import { PageTemplate } from './frame'
import { dateId, ProgressCell, ProgressVsBudgetCard } from './progress-ui'
import { PtScopeNote, ptView } from './pt'
import { PerPt } from './pt-breakdown'
import { BudgetBadge, F3Root } from './f3-ui'
import {
  Bento,
  BulletLegend,
  BulletRows,
  Card,
  ColumnsChart,
  DashboardSkeleton,
  DataTable,
  Delta,
  EmptyState,
  HBarList,
  KpiRow,
  KpiTile,
  LineChart,
  Meter,
  MetricRow,
  moneyValue,
  pctText,
  PipelineBars,
  ProgressRows,
  QuickActions,
  rp,
  rpShort,
  Segmented,
  Sparkline,
  StatusPill,
  TableView,
  VIZ_STYLE,
  type Col,
  type QuickAction,
} from './viz'

/**
 * Dashboard module (/admin/dashboard, custom root view wrapped in PageTemplate — the admin home
 * /admin is the Odoo-style module launcher since 2026-09-27, ./Launcher.tsx). Formerly "Beranda"
 * = Payload's dashboard view; receives initPageResult + searchParams either way. Layout by role, Owner > Finance > PM > Admin > Staff; further
 * roles appear as tabs (?peran=…). Redesign 2026-09-25 (user: "terlalu text based"): KPI tiles,
 * charts and card tables in a 12-column bento grid (kit: ./viz.tsx). Server-rendered; the data
 * streams behind a skeleton (Suspense); every number links to the list/report that produces it
 * (C9); a failing layout shows its own error (wireframes §0).
 * D2510 (ADR 0033, Nexus): page header = kit PageHeader with the role / range tabs as segmented controls; Finance in
 * the Corporate-Finance style (hero "Saldo kas total" with a mini card per cash account, budget progress, quick
 * actions), the other roles in the CRM style (KPI row, metric rows, card tables with soft badges). Same data and links.
 */
type Layout = 'owner' | 'finance' | 'pm' | 'admin' | 'adminstaff' | 'staff' | 'operator'
const ORDER: Array<[Layout, Role]> = [
  ['owner', 'pk-owner'],
  ['finance', 'pk-finance'],
  ['pm', 'pk-pm'],
  ['admin', 'pk-admin'],
  // ADR 0032: Admin Staff (attendance administration of the PT)
  ['adminstaff', 'pk-admin-staff'],
  ['staff', 'pk-staff'],
  ['operator', 'pk-operator'],
]
const LABEL: Record<Layout, string> = { owner: 'Direktur', finance: 'Finance', pm: 'PM', admin: 'Admin', adminstaff: 'Admin Staff', staff: 'Staff', operator: 'Operator/Anggota' }

const ER = '/admin/collections/expense-requests'
const where = (q: Record<string, string>) => new URLSearchParams(q).toString()
const rekapKasMonth = (period: string) => `/admin/laporan/rekap-kas?${where({ dari: period, sampai: period })}`
// DRMS 13/10 Umum #4: the list's own multi-select filters (PkListView) — the ticks show in its filter bar. D2410: the
// list's `pending_approval` is the non-Owner half → a link counting every waiting request also ticks `pending_owner`
const statusList = (statuses: readonly string[]) => `${ER}?${where({ 'f.status': (statuses.includes('pending_approval') ? [...statuses, PENDING_OWNER] : statuses).join(',') })}`
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
  // ADR 0028 (owner 2026-10-14): Direktur cash-flow card "tanpa antar-PT" (both legs of intercompany payments left out)
  const withoutIc = sp.antarpt === 'tanpa'
  return (
    <Gutter>
      <F3Root name={`beranda-${layout ?? 'none'}`}>
        <style>{VIZ_STYLE}</style>
        <PageHeader
          title={`Dashboard${layout ? ` · ${LABEL[layout]}` : ''}`}
          sub="Ringkasan per peran"
          icon="home"
          mod="dashboard"
          actions={
            layouts.length > 1 || layout === 'owner' ? (
              <>
                {layouts.length > 1 ? (
                  <Segmented label="Tampilan peran">
                    {layouts.map((l) => (
                      <a key={l} href={`/admin/dashboard?peran=${l}`} aria-current={l === layout ? 'page' : undefined} data-pk-role-tab={l}>
                        {LABEL[l]}
                      </a>
                    ))}
                  </Segmented>
                ) : null}
                {layout === 'owner' ? (
                  <Segmented label="Rentang grafik">
                    <Link href="/admin/dashboard?peran=owner&bulan=12" aria-current={months === 12 ? 'page' : undefined}>
                      12 bulan
                    </Link>
                    <Link href="/admin/dashboard?peran=owner&bulan=6" aria-current={months === 6 ? 'page' : undefined}>
                      6 bulan
                    </Link>
                  </Segmented>
                ) : null}
              </>
            ) : undefined
          }
        />
        {!layout ? (
          <EmptyState text="Akun Anda belum punya peran RR Teams. Hubungi Admin." />
        ) : (
          <ChartHover>
            <Suspense fallback={<DashboardSkeleton />}>
              <Body layout={layout} req={req} months={months} withoutIc={withoutIc} />
            </Suspense>
          </ChartHover>
        )}
      </F3Root>
    </Gutter>
  )
}

async function Body({ layout, req, months, withoutIc }: { layout: Layout; req: PayloadRequest; months: 6 | 12; withoutIc?: boolean }) {
  try {
    switch (layout) {
      // awaited here (not rendered as <Owner/>) so a failing query is caught by this try
      case 'owner':
        return await Owner({ req, months, withoutIc })
      case 'finance':
        return await Finance({ req })
      case 'pm':
        return await Pm({ req })
      case 'admin':
        return await Admin({ req })
      case 'adminstaff':
        return AdminStaff()
      case 'operator':
        return await Operator({ req })
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
    <Card id={id} icon="tStatusUp" title={title} sub={sub} span={span} i={i} action={{ href: ER, label: 'Semua pengajuan' }}>
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
                <td className="n">{formatNumber(s.count)}</td>
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
      icon="tCategory2"
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
    <Card id={id} icon="tGraph" title={title} sub={sub} span={span} i={i}>
      <LineChart
        id={id}
        rows={rows.map((r) => ({ period: r.period, value: r.count, extra: rp(r.sum) }))}
        fmt={(v) => formatNumber(v)}
        label="pengajuan"
        aria={`${title}: ${rows.map((r) => `${short(r.period)} ${formatNumber(r.count)}`).join(', ')}`}
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
                <td className="n">{formatNumber(r.count)}</td>
                <td className="n">{rp(r.sum)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableView>
    </Card>
  )
}

/** ADR 0028: cash-flow rows without the legs of intercompany payments ("tanpa antar-PT"; no elimination otherwise). */
function withoutIntercompany<T extends { masuk: number; keluar: number; masukAntarPt?: number; keluarAntarPt?: number }>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r, masuk: r.masuk - (r.masukAntarPt ?? 0), keluar: r.keluar - (r.keluarAntarPt ?? 0) }))
}

function CashFlowCard({ id, rows, title, sub, foot, span, i, withKoreksi }: { id: string; rows: Array<{ period: string; masuk: number; keluar: number; koreksi?: number }>; title: string; sub: string; foot?: React.ReactNode; span: 7 | 8 | 12; i: number; withKoreksi?: boolean }) {
  return (
    <Card id={id} icon="tMoneyChange" title={title} sub={sub} span={span} i={i} foot={foot} action={{ href: '/admin/laporan/rekap-kas', label: 'Rekap Kas' }}>
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
      icon="tChartSquare"
      title="Realisasi vs RAB per project"
      sub="Komitmen & realisasi terhadap RAB, urut % komitmen tertinggi"
      span={span}
      i={i}
      action={{ href: '/admin/laporan/anggaran-project', label: 'Laporan anggaran' }}
      foot={projects.length > limit ? `Menampilkan ${limit} dari ${formatNumber(projects.length)} project — semua ada di tabel angka.` : 'Warna status dari Komitmen (K-08); progress fisik (K-09) di tabel angka dan kartu progress.'}
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
    { key: 'step', label: 'Tindakan', cell: (r) => <StatusPill tone={r.overWarn ? 'warn' : 'wait'} label={`${r.stepLabel ?? (r.step === 'approve' ? 'Approval' : 'Diketahui')}${r.overWarn ? ' · anggaran' : ''}`} /> },
    { key: 'amt', label: 'Grand total', num: true, cell: (r) => rp(r.grandTotal) },
  ]
  return (
    <Card id={id} icon="approval" title="Menunggu tindakan saya" sub={count > items.length ? `${formatNumber(items.length)} dari ${formatNumber(count)}, terlama dulu` : 'Terlama dulu'} span={span} i={i} action={{ href: '/admin/persetujuan', label: 'Buka Persetujuan' }}>
      <DataTable id={id} cols={cols} rows={items} rowKey={(r) => r.id} caption="Pengajuan yang menunggu Diketahui/Approval saya" empty={<EmptyState text="Tidak ada pengajuan yang menunggu Anda. ✓" />} />
    </Card>
  )
}

type TeamWaiting = Awaited<ReturnType<typeof pmDashboard>>['teamWaiting']
type TeamWaitingRow = TeamWaiting['items'][number]

/** S3e (US-17, S-01): PM card — team requests waiting for the PM project / Direktur / Finance, oldest first. */
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
    { key: 'who', label: 'Menunggu', cell: (r) => <StatusPill tone={r.days !== null && r.days > 3 ? 'warn' : 'wait'} label={r.waitingFor === 'pm' ? 'PM project' : r.waitingFor === 'direktur' ? 'Direktur' : r.waitingFor === 'owner' ? 'Owner' : 'Finance'} /> },
    { key: 'age', label: 'Lama', num: true, cell: (r) => (r.days === null ? '—' : <span title={r.submittedDate ?? ''}>{r.days} hari</span>) },
    { key: 'amt', label: 'Grand total', num: true, cell: (r) => rp(r.grandTotal) },
  ]
  return (
    <Card
      id={id}
      icon="tTimer1"
      title="Pengajuan tim menunggu keputusan"
      sub={data.count > data.items.length ? `${formatNumber(data.items.length)} dari ${formatNumber(data.count)}, terlama dulu · PM project lalu Direktur memutuskan` : 'Terlama dulu · PM project lalu Direktur memutuskan'}
      span={span}
      i={i}
      action={{ href: statusList(WAITING), label: 'Lihat semua' }}
    >
      {data.count > 0 ? (
        <div style={{ margin: '0 0 16px' }}>
          <MetricRow
            label="Pengajuan tim menunggu per tahap"
            cols={4}
            items={[
              { key: 'pm', label: 'PM project', value: formatNumber(data.pm), tone: 'primary' },
              { key: 'direktur', label: 'Direktur', value: formatNumber(data.direktur), tone: 'info' },
              { key: 'owner', label: 'Owner', value: formatNumber(data.owner), tone: 'warn' },
              { key: 'finance', label: 'Finance', value: formatNumber(data.finance), tone: 'ok' },
            ]}
          />
        </div>
      ) : null}
      <DataTable id={id} cols={cols} rows={data.items} rowKey={(r) => r.id} caption="Pengajuan tim yang menunggu PM project, Direktur atau Finance" empty={<EmptyState text="Tidak ada pengajuan tim yang menunggu keputusan. ✓" />} />
    </Card>
  )
}

type CashRow = Awaited<ReturnType<typeof ownerDashboard>>['viz']['recentCash'][number]
const SOURCE: Record<string, string> = { transfer: 'Transfer', settlement_refund: 'Pengembalian LPJ', manual: 'Manual', reversal: 'Jurnal balik', opening: 'Saldo awal', intercompany: 'Antar PT', project_loan: 'Pinjaman antar project' }

function RecentCashCard({ id, rows, span, i }: { id: string; rows: CashRow[]; span: 6 | 8 | 12; i: number }) {
  const cols: Col<CashRow>[] = [
    { key: 'date', label: 'Tanggal', sort: 'descending', cell: (r) => <span className="nw" title={r.entryDate}>{dayMonth(r.entryDate)}</span> },
    {
      key: 'desc',
      label: 'Transaksi',
      cell: (r) => (
        <>
          <a href={`/admin/collections/cash-entries/${r.id}`}>{r.entryNo ?? `#${r.id}`}</a>
          <span className="sub">
            {r.requestDocNo && r.requestId ? (
              <>
                <a href={reqHref(r.requestId)}>{r.requestDocNo}</a> · {r.label}
              </>
            ) : (
              r.label || SOURCE[r.sourceType]
            )}
          </span>
        </>
      ),
    },
    { key: 'acc', label: 'Akun', sec: true, cell: (r) => r.account },
    // ADR 0028: the paying PT's KK (source type `transfer`) of an intercompany payment is "Antar PT" too (counterpart set)
    { key: 'src', label: 'Sumber', sec: true, cell: (r) => (r.status === 'void' ? <StatusPill tone="bad" label="Void" /> : r.intercompany ? SOURCE.intercompany : (SOURCE[r.sourceType] ?? r.sourceType)) },
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
    <Card id={id} icon="tReceiptText" title="Transaksi kas terbaru" sub="Buku kas, termasuk void & jurnal balik" span={span} i={i} action={{ href: '/admin/kas', label: 'Buku kas' }}>
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

const BUDGET_TONE: Record<ProjectBudget['tone'], Tone> = { ok: 'ok', warn: 'warn', over: 'bad', none: 'neutral' }

/**
 * D2510 Finance "spending limit" block from the K-09 rows (projectProgressVsBudget, same data as the progress card):
 * Σ komitmen vs Σ RAB of the projects with a RAB, then the projects with the highest % anggaran, each a Progress bar
 * coloured by its K-08 budget tone with the physical progress underneath.
 */
function BudgetProgressCard({ id, data, span, i, limit = 5 }: { id: string; data: { projects: ProjectProgress[] }; span: 4 | 5 | 6; i: number; limit?: number }) {
  const withRab = data.projects.filter((p) => p.budget)
  const budget = withRab.reduce((s, p) => s + (p.budget ?? 0), 0)
  const committed = withRab.reduce((s, p) => s + p.committed, 0)
  const top = [...withRab].sort((a, b) => (b.budgetPct ?? -1) - (a.budgetPct ?? -1) || a.code.localeCompare(b.code)).slice(0, limit)
  const all = share(committed, budget)
  return (
    <Card
      id={id}
      icon="tChartSquare"
      title="Anggaran project"
      sub="Komitmen terhadap RAB (K-08) · progress fisik (K-09)"
      span={span}
      i={i}
      action={{ href: '/admin/laporan/anggaran-project', label: 'Laporan anggaran' }}
      foot={withRab.length > limit ? `Menampilkan ${limit} dari ${formatNumber(withRab.length)} project ber-RAB, % anggaran tertinggi dulu.` : undefined}
    >
      {withRab.length > 0 ? (
        <div style={{ margin: '0 0 18px' }} data-pk-budget-total>
          <p className="pk-metric-v">{moneyValue(rp(committed))}</p>
          <p className="pk-metric-x" style={{ margin: '2px 0 10px' }}>
            komitmen dari RAB <b>{rp(budget)}</b>
          </p>
          <ProgressRows
            id={`${id}-total`}
            empty=""
            aria={() => `Komitmen ${pctText(all)} dari RAB`}
            items={[{ key: 'all', label: `${formatNumber(withRab.length)} project ber-RAB`, value: all, right: <b>{pctText(all)}</b>, tone: (all ?? 0) > 100 ? 'bad' : 'primary' }]}
          />
        </div>
      ) : null}
      <ProgressRows
        id={id}
        empty="Belum ada project ber-RAB."
        aria={(it) => `${String(it.label)}: ${pctText(it.value)} anggaran`}
        items={top.map((p) => ({
          key: String(p.id),
          label: `${p.code} ${p.name}`,
          value: p.budgetPct,
          right: (
            <>
              <b>{pctText(p.budgetPct)}</b> anggaran
            </>
          ),
          tone: BUDGET_TONE[p.budgetTone],
          sub: `Progress fisik ${p.stagesComplete ? pctText(p.progressPct) : '— (tahapan belum 100%)'} · ${p.toneLabel}`,
          href: `/admin/laporan/anggaran-project?project=${p.id}`,
          attrs: { 'data-pk-budget-project': p.code },
        }))}
      />
    </Card>
  )
}

// ---------------------------------------------------------------- Owner (wireframe §1)

async function Owner({ req, months, withoutIc }: { req: PayloadRequest; months: 6 | 12; withoutIc?: boolean }) {
  const d = await withReqTransaction(req, () => ownerDashboard(req, { months }))
  // MC2: per-PT rows of the payload (`mc2-contract.md` §2, typed — Σ byCompany = combined total)
  const pt = await ptView(req)
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
      <PtScopeNote pt={pt} />
      <p className="pk-note" style={{ margin: '-8px 0 16px' }}>
        Per {d.asOf} (WITA) · grafik {d.cashFlow.months} bulan terakhir · warna anggaran dari Komitmen.{pt.multi ? ' Angka besar = gabungan PT tempat Anda Direktur; rincian per PT di bawahnya.' : ''}
      </p>
      <Bento label="Ringkasan Direktur">
        <KpiRow>
          {/* DRMS 13/10 #10: KPI tiles show the full Rupiah value (compact form only on chart axes/labels) */}
          <KpiTile id="cash" hero icon="wallet" label="Saldo kas total" value={rp(d.cash.total)} title={rp(d.cash.total)} kpi="k01-total" href={rekapKasMonth(d.month)} more="Rekap Kas" i={0}>
            {balPrev ? <Delta d={delta(d.cash.total, balPrev.balance)} good="up" vs={`vs akhir ${short(balPrev.period)}`} /> : null}
            <Sparkline label="Saldo akhir bulan" values={bal.map((b) => ({ label: short(b.period), value: b.balance }))} />
            <p className="pk-kpi-x" data-pk-kpi="k02b-month">
              Bulan ini <b>+{rp(d.cash.monthIn)}</b> / <b>−{rp(d.cash.monthOut)}</b>
            </p>
            <PerPt pt={pt} rows={d.cash.byCompany} value={(r) => r.total} fmt={rp} label="Saldo kas" />
          </KpiTile>
          <KpiTile id="approvals" icon="clock" label="Pengajuan menunggu" value={formatNumber(a.count)} title={`${formatNumber(a.count)} pengajuan`} kpi="k10-count" href={statusList(WAITING)} more="Lihat pengajuan" i={1}>
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
                  Diketahui <b>{formatNumber(a.pendingAck.count)}</b> · <Swatch cls="o3" />
                  Approval <b>{formatNumber(a.pendingApproval.count)}</b>
                </p>
              </>
            ) : null}
            <p className="pk-kpi-x" data-pk-kpi="k10-mine">
              <b>{formatNumber(a.waitingForMe)}</b> menunggu saya{a.oldestDays !== null ? ` · tertua ${a.oldestDays} hari` : ''}
            </p>
            <PerPt pt={pt} rows={a.byCompany} value={(r) => r.count} label="Pengajuan menunggu" />
          </KpiTile>
          <KpiTile id="disbursed" icon="send" label="Pencairan bulan ini" value={rp(disb.net)} title={rp(disb.net)} kpi="k05-month" href="/admin/laporan/pengeluaran-kategori" more="Pengeluaran per kategori" i={2}>
            <p className="pk-kpi-x">Dicairkan bersih</p>
            {disbPrev ? <Delta d={delta(disb.net, disbPrev.net)} vs={`vs ${short(disbPrev.period)}`} /> : null}
            <Sparkline label="Pencairan bersih per bulan" values={v.disbursed.map((x) => ({ label: short(x.period), value: x.net }))} />
          </KpiTile>
          <KpiTile id="budget" icon="target" label="Realisasi vs anggaran" value={pctText(realPct)} title={`${pctText(realPct)} dari RAB`} kpi="k06-pct" href="#anggaran" more="Anggaran project" i={3}>
            <p className="pk-kpi-x">
              <b>{rp(bt.realized)}</b> dari RAB {rp(bt.budget)}
            </p>
            <Meter value={bt.realized} max={bt.budget} />
            <p className="pk-kpi-x">
              Komitmen {pctText(comPct)} · {formatNumber(bt.projects)} project ber-RAB
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
            {/* per PT: colour counts with THAT PT's thresholds — no combined percentage (wireframe §5 rule 2) */}
            <PerPt pt={pt} rows={d.budget.byCompany} value={(r) => r.running} label="Project berjalan" render={(r) => `${formatNumber(r.running)} berjalan · ${formatNumber(r.over)} merah · ${formatNumber(r.warn)} kuning`} />
          </KpiTile>
        </KpiRow>

        <CashFlowCard
          id="owner-cashflow"
          rows={withoutIc ? withoutIntercompany(d.cashFlow.rows) : d.cashFlow.rows}
          title="Arus kas bulanan"
          sub={withoutIc ? 'Masuk vs keluar tanpa transfer antar-PT, tanpa transaksi yang di-void (K-02b)' : 'Masuk vs keluar, tanpa transaksi yang di-void (K-02b)'}
          span={8}
          i={4}
          foot={
            <>
              Grafik operasional: void dan jurnal baliknya disembunyikan. Laporan resmi = Rekap Kas.{' '}
              {/* ADR 0028: consolidated view — intercompany legs are counted ("Antar PT") unless left out here */}
              <a href={`/admin/dashboard?peran=owner&bulan=${months}${withoutIc ? '' : '&antarpt=tanpa'}`} data-pk-toggle="antarpt">
                {withoutIc ? 'Tampilkan termasuk antar-PT' : 'Tampilkan tanpa antar-PT'}
              </a>
            </>
          }
        />
        <PipelineCard id="owner-pipeline" pipeline={v.pipeline} title="Status pengajuan" sub="Posisi semua pengajuan saat ini" span={4} i={5} />

        <BudgetCard id="owner-budget" projects={d.projects} warnPct={v.warnPct} span={7} i={6} progress={progressMap(k09)} />
        <CategoryCard id="owner-categories" c={v.categories} span={5} i={7} sub={`Dicairkan ${short(v.categories.from.slice(0, 7))} – sekarang`} />

        <SlaTransferCard data={d.sla} span={12} i={8} />
        {/* DRMS 10/10 point 2–4 (D4): RAP realisation per project, items over plan → the project's RAP tab */}
        <RapMonitorCard data={d.rapMonitoring} span={12} i={8} />
        {/* ADR 0022 §9: inter-project loans — outstanding / overdue per project, loans waiting for the Direktur */}
        <LoanCard data={d.loans} span={12} i={8} />
        {/* ADR 0029 §3.9: "Dana tersedia per PT" + "Hutang / piutang antar-PT" */}
        <IntercompanyCard data={d.intercompany} codeOf={(id) => pt.ref(id)?.shortCode ?? `#${id}`} span={12} i={8} />
        {/* D4 (owner 2026-10-11): projects with a RAB but no RAP yet — requests blocked until a PM fills the RAP */}
        <RapMissingCard data={d.rapMissing} span={12} i={9} />
        <TrendCard id="owner-trend" rows={v.requestTrend} title="Tren pengajuan" sub="Jumlah pengajuan per bulan (tanggal pengajuan)" span={6} i={8} />
        <Card id="accounts" icon="tWallet3" title="Saldo per akun" sub="Akun nonaktif bersaldo 0 disembunyikan" span={3} i={9}>
          <HBarList
            id="owner-accounts"
            fmt={rpShort}
            exact={rp}
            empty="Belum ada akun kas."
            items={[...d.cash.accounts]
              .sort((x, y) => y.balance - x.balance)
              .map((acc) => ({ key: String(acc.id), label: `${pt.multi ? `[${pt.ref(acc.companyId)?.shortCode ?? acc.companyId}] ` : ''}${acc.name}${acc.active ? '' : ' (nonaktif)'}`, value: Math.max(0, acc.balance), href: `/admin/laporan/rekap-kas?akun=${acc.id}`, attrs: { 'data-pk-account': String(acc.id) } }))}
          />
        </Card>
        <Card id="completeness" icon="tClipboardText" title="Kelengkapan nota/LPJ" span={3} i={10} action={{ href: '/admin/laporan/kelengkapan', label: 'Laporan' }}>
          <p className="pk-kpi-v" style={{ fontSize: 22, margin: 0 }} data-pk-kpi="k12g">
            {formatNumber(d.completeness.ratioDone)} / {formatNumber(d.completeness.ratioTotal)}
          </p>
          <p className="pk-kpi-x">pengajuan baru bulan ini sudah LPJ</p>
          <Meter value={d.completeness.ratioDone} max={Math.max(1, d.completeness.ratioTotal)} />
          <p className="pk-kpi-x" data-pk-kpi="k12b">
            {d.completeness.overdue > 0 ? <StatusPill tone="bad" label={`${d.completeness.overdue} LPJ terlambat`} /> : <StatusPill tone="ok" label="Tidak ada LPJ terlambat" />}
          </p>
          <div style={{ marginTop: 14 }}>
            <MetricRow
              label="Kelengkapan nota/LPJ"
              items={[
                { key: 'without-lpj', label: 'Belum LPJ', value: formatNumber(d.completeness.withoutLpj), sub: 'pengajuan baru belum LPJ', tone: d.completeness.withoutLpj > 0 ? 'warn' : 'ok', kpi: 'k12a' },
                { key: 'reimburse', label: 'Nota reimburse', value: formatNumber(d.completeness.reimburseToVerify), sub: 'menunggu verifikasi', tone: 'info', kpi: 'k12e' },
                { key: 'warnings', label: 'Flag', value: formatNumber(d.completeness.openWarnings), sub: 'flag peringatan terbuka', tone: d.completeness.openWarnings > 0 ? 'bad' : 'ok', kpi: 'k12f' },
              ]}
            />
          </div>
          <PerPt pt={pt} rows={d.completeness.byCompany} label="Kelengkapan LPJ" render={(r) => `${formatNumber(r.ratioDone)}/${formatNumber(r.ratioTotal)} · ${formatNumber(r.overdue)} terlambat`} />
        </Card>

        <ProgressVsBudgetCard id="owner-progress" data={k09} i={11}  pt={pt} />
        <InboxCard id="owner-inbox" items={v.inbox} count={a.waitingForMe} span={6} i={11} />
        <RecentCashCard id="owner-recent-cash" rows={v.recentCash} span={6} i={12} />

        <Card id="top-realized" icon="tStatusUp" title="Project dengan realisasi tertinggi" sub="% realisasi terverifikasi terhadap RAB" span={6} i={13} action={{ href: '/admin/laporan/anggaran-project', label: 'Semua project' }}>
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
              { key: 'rab', label: 'RAB', num: true, sec: true, cell: (p) => rp(p.budget ?? 0) },
              { key: 'real', label: 'Realisasi', num: true, cell: (p) => rp(p.realized) },
              { key: 'pct', label: '% RAB', num: true, sort: 'descending', cell: (p) => pctText(p.pctRealized) },
              { key: 'st', label: 'Status', cell: (p) => <BudgetBadge tone={p.tone} /> },
            ]}
          />
        </Card>
        <Card id="cost-centers" icon="tBuilding3" title="Pusat biaya bulan ini" sub="K-15, per pusat biaya (akun kas)" span={3} i={14}>
          <HBarList
            id="owner-cost-centers"
            fmt={rpShort}
            exact={rp}
            empty="Belum ada biaya pusat biaya bulan ini."
            items={[...d.costCenters]
              .sort((x, y) => y.total - x.total)
              .map((c) => ({ key: String(c.id), label: c.name, value: Math.max(0, c.total), href: `/admin/laporan/rekap-kas?${where({ akun: String(c.id), dari: d.month, sampai: d.month })}`, attrs: { 'data-pk-cost-center': String(c.id) } }))}
          />
        </Card>
        <Card id="transfer-queue" icon="tMoneySend" title="Antrian transfer" sub="Lihat saja (Finance yang memproses)" span={3} i={15} action={{ href: '/admin/antrian-transfer', label: 'Antrian' }}>
          <p className="pk-kpi-v" style={{ fontSize: 22, margin: 0 }} data-pk-kpi="k11-count">
            {formatNumber(d.transferQueue.count)} · {rp(d.transferQueue.sum)}
          </p>
          <p className="pk-kpi-x" style={{ marginTop: 8 }}>
            {d.transferQueue.overdue > 0 ? <StatusPill tone="warn" label={`${d.transferQueue.overdue} lewat tanggal dibutuhkan`} /> : <StatusPill tone="ok" label="Tidak ada yang lewat tanggal" />}
          </p>
          <PerPt pt={pt} rows={d.transferQueue.byCompany} value={(r) => r.count} label="Antrian transfer" render={(r) => `${formatNumber(r.count)} · ${rp(r.sum)}`} />
        </Card>
      </Bento>
    </>
  )
}

// ---------------------------------------------------------------- Finance (wireframe §2)

async function Finance({ req }: { req: PayloadRequest }) {
  const d = await withReqTransaction(req, () => financeDashboard(req))
  const pt = await ptView(req)
  const k09 = await withReqTransaction(req, async () => projectProgressVsBudget(req, await officeScope(req)))
  const v = d.viz
  const flows = d.cashFlow.rows
  const cur = lastOf(flows)
  const prev = prevOf(flows)
  const balPrev = prevOf(v.balanceTrend)
  type Q = (typeof v.transferTop)[number]
  type A = (typeof d.advancesWithoutLpj)[number]
  const ptTag = (companyId: number) => (pt.multi ? `[${pt.ref(companyId)?.shortCode ?? companyId}] ` : '')
  const accounts = [...d.accounts].sort((x, y) => y.balance - x.balance)
  // Corporate Finance "Quick Actions": pages Finance already reaches from this dashboard (no new links)
  const quick: QuickAction[] = [
    { key: 'kas-baru', href: '/admin/kas/baru', label: '+ Kas masuk / keluar', icon: 'add', primary: true },
    { key: 'antrian-transfer', href: '/admin/antrian-transfer', label: 'Antrian Transfer', icon: 'tMoneySend' },
    { key: 'verifikasi-lpj', href: '/admin/verifikasi-lpj', label: 'Verifikasi LPJ', icon: 'tReceiptSearch' },
    { key: 'buku-kas', href: '/admin/kas', label: 'Buku kas', icon: 'tBook' },
    { key: 'rekap-kas', href: '/admin/laporan/rekap-kas', label: 'Rekap Kas', icon: 'tChart' },
    { key: 'laporan', href: '/admin/laporan', label: 'Laporan', icon: 'report' },
    { key: 'pengajuan', href: `${ER}/create`, label: 'Buat pengajuan', icon: 'tNoteAdd' },
  ]
  return (
    <>
      <PtScopeNote pt={pt} />
      <p className="pk-note" style={{ margin: '-8px 0 16px' }}>
        Per {d.asOf} (WITA) · buku kas termasuk koreksi void.{pt.multi ? ' Angka besar = gabungan PT tempat Anda Finance.' : ''}
      </p>
      <Bento label="Ringkasan Finance">
        {/* Corporate Finance hero: total cash reserves + one mini card per cash account (Akun Kas) */}
        <Card id="accounts" icon="tWallet3" title="Saldo kas total" sub={`Per akun kas · masuk/keluar ${short(cur.period)}; akun nonaktif bersaldo 0 disembunyikan`} span={8} i={0} className="pk-hero" action={{ href: '/admin/laporan/rekap-kas', label: 'Rekap Kas' }}>
          <div className="pk-hero-top" data-pk-tile="cash">
            <div>
              <p className="pk-hero-v" data-pk-kpi="k01-total" title={rp(d.cashTotal)}>
                {moneyValue(rp(d.cashTotal))}
              </p>
              {balPrev ? <Delta d={delta(d.cashTotal, balPrev.balance)} good="up" vs={`vs akhir ${short(balPrev.period)}`} /> : null}
            </div>
            <Sparkline label="Saldo akhir bulan" values={v.balanceTrend.map((b) => ({ label: short(b.period), value: b.balance }))} />
          </div>
          <PerPt pt={pt} rows={d.cashByCompany} value={(r) => r.total} fmt={rp} label="Saldo kas" />
          {accounts.length === 0 ? (
            <EmptyState text="Belum ada akun kas." />
          ) : (
            <ul className="pk-accs" aria-label="Saldo per akun kas" data-pk-chart="finance-accounts" style={{ marginTop: 16 }}>
              {accounts.map((acc) => (
                <li key={acc.id} className="pk-acc" data-pk-account={String(acc.id)}>
                  <div className="pk-acc-h">
                    <span className="qi" aria-hidden>
                      <Glyph name="tWallet3" size={18} />
                    </span>
                    <p className="pk-acc-n">
                      {ptTag(acc.companyId)}
                      {acc.name}
                    </p>
                    <a className="pk-acc-m" href={`/admin/laporan/rekap-kas?akun=${acc.id}`} aria-label={`Rekap Kas ${acc.name}`} title="Rekap Kas akun ini">
                      <span aria-hidden>⋮</span>
                    </a>
                  </div>
                  <p className="pk-acc-v" title={rp(acc.balance)}>
                    {moneyValue(rp(acc.balance))}
                  </p>
                  <p className="pk-acc-x">
                    Masuk <b>{rp(acc.monthIn)}</b> · keluar <b>{rp(acc.monthOut)}</b>
                  </p>
                  <span>
                    <SoftBadge tone={acc.active ? 'ok' : 'neutral'}>{acc.active ? 'Aktif' : 'Nonaktif'}</SoftBadge>
                  </span>
                </li>
              ))}
            </ul>
          )}
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
                    <td>
                      {pt.multi ? `[${pt.ref(acc.companyId)?.shortCode ?? acc.companyId}] ` : ''}
                      {acc.name}
                    </td>
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
        <div className="pk-stack s4">
          <Card id="quick" icon="grid" title="Aksi cepat" span={12} i={1}>
            <QuickActions label="Aksi cepat Finance" items={quick} />
          </Card>
          <Card id="period-close" icon="tArchiveTick" title="Tutup buku" span={12} i={2} action={{ href: '/admin/tutup-buku', label: 'Tutup buku' }}>
            <p className="pk-kpi-x" data-pk-kpi="last-closed" style={{ fontSize: 14 }}>
              {d.lastClosedPeriod ? (
                <>
                  Bulan terakhir ditutup: <b>{d.lastClosedPeriod}</b>
                </>
              ) : (
                'Belum pernah tutup buku.'
              )}
            </p>
            <PerPt pt={pt} rows={d.lastClosedByCompany} label="Tutup buku" render={(r) => r.period ?? 'belum pernah'} />
            <p className="pk-kpi-x">Bulan yang bisa ditutup: {d.nextClosable} (bulan lampau saja).</p>
          </Card>
        </div>

        <KpiRow cols={5}>
          <KpiTile id="transfer-queue" icon="send" label="Antrian transfer" value={formatNumber(d.transferQueue.count)} title={`${formatNumber(d.transferQueue.count)} pengajuan`} kpi="k11-count" href="/admin/antrian-transfer" more="Antrian Transfer" i={1}>
            <p className="pk-kpi-x">
              <b>{rp(d.transferQueue.sum)}</b>
            </p>
            <p className="pk-kpi-x" data-pk-kpi="k11-overdue">
              {d.transferQueue.overdue > 0 ? <StatusPill tone="warn" label={`${d.transferQueue.overdue} lewat tanggal dibutuhkan`} /> : <StatusPill tone="ok" label="Tepat waktu" />}
            </p>
            <PerPt pt={pt} rows={d.transferQueue.byCompany} value={(r) => r.count} label="Antrian transfer" render={(r) => `${formatNumber(r.count)} · ${rp(r.sum)}`} />
          </KpiTile>
          <KpiTile id="lpj-verify" icon="check" label="Menunggu verifikasi" value={formatNumber(d.lpjToVerify + d.reimburseToVerify.count)} title={`${d.lpjToVerify} LPJ, ${d.reimburseToVerify.count} nota reimburse`} href="/admin/verifikasi-lpj" more="Verifikasi LPJ" i={2}>
            <p className="pk-kpi-x" data-pk-kpi="k12c">
              <b>{formatNumber(d.lpjToVerify)}</b> LPJ
            </p>
            <p className="pk-kpi-x" data-pk-kpi="k12e">
              <b>{formatNumber(d.reimburseToVerify.count)}</b> nota reimburse · {formatNumber(d.reimburseToVerify.warnings)} flag
            </p>
            <PerPt pt={pt} rows={d.completenessByCompany} label="Menunggu verifikasi" render={(r) => `${formatNumber(r.lpjToVerify)} LPJ · ${formatNumber(r.reimburseToVerify)} nota`} />
          </KpiTile>
          <KpiTile id="month-in" icon="down" label={`Kas masuk ${short(cur.period)}`} value={rp(cur.masuk)} title={rp(cur.masuk)} kpi="k02a-in" href={rekapKasMonth(cur.period)} more="Rekap Kas" i={3}>
            {prev ? <Delta d={delta(cur.masuk, prev.masuk)} vs={`vs ${short(prev.period)}`} /> : null}
            <Sparkline label="Kas masuk per bulan" values={flows.map((f) => ({ label: short(f.period), value: f.masuk }))} />
          </KpiTile>
          <KpiTile id="month-out" icon="up" label={`Kas keluar ${short(cur.period)}`} value={rp(cur.keluar)} title={rp(cur.keluar)} kpi="k02a-out" href={rekapKasMonth(cur.period)} more="Rekap Kas" i={4}>
            <p className="pk-kpi-x">
              Selisih <b>{rp(cur.masuk - cur.keluar)}</b>
            </p>
            {prev ? <Delta d={delta(cur.keluar, prev.keluar)} vs={`vs ${short(prev.period)}`} /> : null}
            <Sparkline label="Kas keluar per bulan" values={flows.map((f) => ({ label: short(f.period), value: f.keluar }))} />
          </KpiTile>
          <KpiTile id="lpj-settle" icon="scale" label="Selisih LPJ" value={formatNumber(d.lpjToSettle.count)} title={`${formatNumber(d.lpjToSettle.count)} LPJ`} kpi="k12d" href="/admin/verifikasi-lpj" more="Selesaikan" i={5}>
            <p className="pk-kpi-x">
              pengembalian <b>{rp(d.lpjToSettle.refund)}</b>
            </p>
            <p className="pk-kpi-x">
              kekurangan <b>{rp(d.lpjToSettle.shortfall)}</b>
            </p>
          </KpiTile>
        </KpiRow>

        <CashFlowCard id="finance-cashflow" rows={flows} withKoreksi title="Arus kas bulanan" sub="Buku kas 6 bulan, termasuk koreksi void (K-02a)" span={8} i={6} />
        <BudgetProgressCard id="finance-budget" data={k09} span={4} i={7} />

        <Card id="finance-queue" icon="tMoneySend" title="Menunggu tindakan saya: transfer" sub="Tanggal dibutuhkan terdekat dulu" span={7} i={8} action={{ href: '/admin/antrian-transfer', label: 'Antrian Transfer' }}>
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

        <Card id="advances-without-lpj" icon="tReceiptSearch" title="Pengajuan baru belum LPJ" sub={`Terlambat bila > ${d.lpjDueDays} hari sejak transfer pertama`} span={7} i={10} action={{ href: '/admin/laporan/kelengkapan', label: 'Laporan' }}>
          <DataTable<A>
            id="advances-without-lpj"
            caption="Pengajuan baru belum LPJ"
            rows={d.advancesWithoutLpj.slice(0, 8)}
            rowKey={(r) => r.id}
            rowAttrs={(r) => ({ 'data-pk-overdue': r.overdue ? 'yes' : 'no' })}
            empty={<EmptyState text="Semua pengajuan baru sudah ber-LPJ. ✓" />}
            cols={[
              { key: 'no', label: 'Nomor', cell: (r) => <a href={reqHref(r.id)}>{r.docNo ?? `#${r.id}`}</a> },
              { key: 'who', label: 'Pemohon', sec: true, cell: (r) => r.requesters || '—' },
              { key: 'amt', label: 'Nominal', num: true, cell: (r) => rp(r.transferredTotal) },
              { key: 'age', label: 'Umur', num: true, sort: 'descending', cell: (r) => (r.overdue ? <StatusPill tone="bad" label={`${r.ageDays ?? '—'} hr terlambat`} /> : `${r.ageDays ?? '—'} hr`) },
            ]}
          />
        </Card>
        <Card id="finance-disbursed" icon="tCardSend" title="Pencairan bersih per bulan" sub="Transfer − pengembalian LPJ (K-05)" span={5} i={11}>
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

        <ProgressVsBudgetCard id="finance-progress" data={k09} i={12}  pt={pt} />
        <RecentCashCard id="finance-recent-cash" rows={v.recentCash} span={8} i={12} />
        <CategoryCard id="finance-categories" c={v.categories} span={4} i={13} sub="Dicairkan 6 bulan terakhir" />

        <SlaTransferCard data={d.sla} span={12} i={14} />
        <LoanCard data={d.loans} span={12} i={14} />
      </Bento>
    </>
  )
}

// ---------------------------------------------------------------- PM (wireframe §3, monitoring)

async function Pm({ req }: { req: PayloadRequest }) {
  const d = await withReqTransaction(req, () => pmDashboard(req))
  const pt = await ptView(req)
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
          {/* S3e (US-17, S-01): who the team's requests are waiting for (ADR 0021: the PM project first, then the Direktur). */}
          <KpiTile
            id="team-waiting"
            icon="inbox"
            label="Pengajuan tim menunggu keputusan"
            value={formatNumber(d.teamWaiting.count)}
            title={`${formatNumber(d.teamWaiting.count)} pengajuan tim menunggu PM/Direktur/Owner/Finance`}
            kpi="k10-team"
            href={statusList(WAITING)}
            more="Lihat pengajuan"
            i={0}
          >
            <p className="pk-kpi-x">
              PM <b>{formatNumber(d.teamWaiting.pm)}</b> · Direktur <b>{formatNumber(d.teamWaiting.direktur)}</b> · Owner <b>{formatNumber(d.teamWaiting.owner)}</b> · Finance <b>{formatNumber(d.teamWaiting.finance)}</b>
            </p>
            <p className="pk-kpi-x">{d.teamWaiting.oldestDays !== null ? `tertua ${d.teamWaiting.oldestDays} hari` : 'Tidak ada yang menunggu ✓'}</p>
          </KpiTile>
          <KpiTile
            id="team-month"
            icon="users"
            label="Pengajuan tim bulan ini"
            value={formatNumber(d.teamMonth.count)}
            title={`${formatNumber(d.teamMonth.count)} pengajuan, ${rp(d.teamMonth.sum)}`}
            kpi="k13-month"
            href={`${ER}?${where({ 'f.requestDate.dari': monthStart, 'f.requestDate.sampai': lastDay(d.month) })}`}
            more="Lihat pengajuan"
            i={1}
          >
            <p className="pk-kpi-x">
              <b>{rp(d.teamMonth.sum)}</b> · {formatNumber(d.teamMonth.waiting)} menunggu persetujuan
            </p>
            {trendPrev ? <Delta d={delta(d.teamMonth.count, trendPrev.count)} money={false} vs={`pengajuan vs ${short(trendPrev.period)}`} /> : null}
            <Sparkline label="Pengajuan tim per bulan" fmt={formatNumber} values={v.requestTrend.map((x) => ({ label: short(x.period), value: x.count }))} />
          </KpiTile>
          <KpiTile id="team-lpj" icon="doc" label="LPJ tim" value={formatNumber(d.lpj.withoutLpj)} title={`${formatNumber(d.lpj.withoutLpj)} pengajuan baru belum LPJ`} kpi="k12a" href="/admin/laporan/kelengkapan" more="Laporan Kelengkapan" i={2}>
            <p className="pk-kpi-x">pengajuan baru belum LPJ</p>
            <p className="pk-kpi-x" data-pk-kpi="k12b">
              {d.lpj.overdue > 0 ? <StatusPill tone="bad" label={`${d.lpj.overdue} terlambat`} /> : <StatusPill tone="ok" label="Tidak ada yang terlambat" />}
            </p>
          </KpiTile>
          <KpiTile id="team-budget" icon="target" label="Realisasi anggaran project saya" value={pctText(realPct)} title={`${pctText(realPct)} dari RAB`} href="#anggaran" more="Per project" i={3}>
            <p className="pk-kpi-x">
              <b>{rp(bt.realized)}</b> dari RAB {rp(bt.budget)}
            </p>
            <Meter value={bt.realized} max={bt.budget} />
            <p className="pk-kpi-x">
              Komitmen {pctText(share(bt.committed, bt.budget))} · {formatNumber(bt.projects)} project ber-RAB
            </p>
          </KpiTile>
        </KpiRow>

        {/* D4 (owner 2026-10-11): nudge — team projects with a RAB but no RAP (requests cannot be submitted yet) */}
        <RapMissingCard data={d.rapMissing} span={12} i={4} />
        <ProgressVsBudgetCard id="pm-progress" data={k09} i={4} pm  pt={pt} />
        <BudgetCard id="pm-budget" projects={d.projects} warnPct={v.warnPct} span={7} i={4} pm progress={progressMap(k09)} />
        <PipelineCard id="pm-pipeline" pipeline={v.pipeline} title="Status pengajuan tim" sub="Posisi pengajuan tim saat ini" span={5} i={5} />

        <TrendCard id="pm-trend" rows={v.requestTrend} title="Tren pengajuan tim" sub="Jumlah pengajuan per bulan, 6 bulan" span={7} i={6} />
        <CategoryCard id="pm-categories" c={v.categories} span={5} i={7} sub="Dicairkan 6 bulan terakhir, tim Anda" />

        {/* ADR 0021: the PM project approves its requests first ("Persetujuan PM") */}
        <InboxCard id="pm-inbox" items={v.inbox} count={d.waitingForMe} span={12} i={8} />
        <TeamWaitingCard id="pm-waiting" data={d.teamWaiting} span={6} i={8} />
        <LoanCard data={d.loans} span={6} i={8} />
        <Card id="team-latest" icon="tDocumentText" title="Pengajuan tim terbaru" span={6} i={9} action={{ href: ER, label: 'Lihat semua' }}>
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

        <Card id="pm-cost-centers" icon="tBuilding3" title="Pusat biaya project saya bulan ini" sub="K-15, per akun kas, tanpa kas manual kantor" span={6} i={10}>
          <HBarList
            id="pm-cost-centers"
            fmt={rpShort}
            exact={rp}
            empty="Project Anda belum dipetakan ke pusat biaya (akun kas)."
            items={[...d.costCenters]
              .sort((x, y) => y.total - x.total)
              .map((c) => ({ key: String(c.id), label: c.name, value: Math.max(0, c.total), href: `/admin/laporan/rekap-pengajuan?${where({ pusat: String(c.id), dari: monthStart, sampai: lastDay(d.month) })}`, attrs: { 'data-pk-cost-center': String(c.id) } }))}
          />
        </Card>
        <Card id="f5" icon="attendance" title="Lapangan" sub="Kehadiran tim hari ini · laporan progress terbaru" span={6} i={11}>
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
        <KpiTile id="master-gaps" icon="users" label="User tanpa karyawan/peran" value={formatNumber(g.usersIncomplete)} kpi="users-incomplete" href={`/admin/collections/users?${where({ 'where[employee][exists]': 'false' })}`} more="Lengkapi" i={0}>
          <p className="pk-kpi-x">{g.usersIncomplete === 0 ? <StatusPill tone="ok" label="Lengkap" /> : <StatusPill tone="warn" label="Perlu dilengkapi" />}</p>
        </KpiTile>
        <KpiTile id="projects-without-pm" icon="target" label="Project tanpa PM" value={formatNumber(g.projectsWithoutPm)} kpi="projects-without-pm" href={`/admin/collections/projects?${where({ 'where[pm][exists]': 'false' })}`} more="Tetapkan PM" i={1}>
          <p className="pk-kpi-x">{g.projectsWithoutPm === 0 ? <StatusPill tone="ok" label="Lengkap" /> : <StatusPill tone="warn" label="Perlu PM" />}</p>
        </KpiTile>
        {/* ADR 0031: a project without Pusat Biaya (cash account) cannot be paid — Finance's transfer is refused */}
        <KpiTile
          id="projects-without-pusat-biaya"
          icon="scale"
          label="Project tanpa pusat biaya"
          value={formatNumber(g.projectsWithoutPusatBiaya)}
          kpi="projects-without-pusat-biaya"
          href={`/admin/collections/projects?${where({ 'where[cashAccount][exists]': 'false', 'where[status][not_in]': 'arsip,dibatalkan,selesai' })}`}
          more="Petakan"
          i={2}
        >
          <p className="pk-kpi-x">{g.projectsWithoutPusatBiaya === 0 ? <StatusPill tone="ok" label="Lengkap" /> : <StatusPill tone="warn" label="Perlu pusat biaya (akun kas)" />}</p>
        </KpiTile>
      </KpiRow>
      <Card id="latest-audit" icon="tShieldSearch" title="Audit log terbaru" sub="30 hari terakhir" span={12} i={3} action={{ href: '/admin/audit-log', label: 'Audit Log lengkap' }}>
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
            {
              key: 'd',
              label: 'Dokumen',
              sec: true,
              // DRMS 10/10 12b: numbered documents link to their detail
              cell: (a) => {
                const href = docHref(a.docType, a.docId)
                const text = a.docNo ?? a.docId ?? ''
                return href && text ? (
                  <>
                    {a.docType} <a href={href}>{text}</a>
                  </>
                ) : (
                  `${a.docType} ${text}`
                )
              },
            },
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
  const hello = await resolveDisplayName(req.payload, req.user)
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
      <div className="pk-dash-bar">
        <span className="pk-note" style={{ fontSize: 14 }} data-pk-greeting>
          Halo, {hello}
        </span>
        <a className="pk-btn primary" href={`${ER}/create`} data-pk-action="new-request">
          + Buat pengajuan
        </a>
        <a className="pk-btn" href={`/admin/collections/users/${user?.id ?? ''}`}>
          Profil &amp; tanda tangan
        </a>
      </div>
      <Bento label="Ringkasan pengajuan saya">
        <KpiRow>
          <KpiTile id="my-actions" icon="inbox" label="Perlu tindakan saya" value={formatNumber(d.actions.length)} href="#pk-card-my-actions" more="Lihat daftar" i={0}>
            <p className="pk-kpi-x">{d.actions.length === 0 ? 'Tidak ada yang perlu Anda kerjakan ✓' : 'draft, revisi, nota atau LPJ'}</p>
          </KpiTile>
          <KpiTile id="my-process" icon="clock" label="Sedang diproses" value={formatNumber(inProcess)} href={ER} more="Pengajuan saya" i={1}>
            <p className="pk-kpi-x">
              menunggu persetujuan <b>{formatNumber(st('ack') + st('approval'))}</b>
            </p>
          </KpiTile>
          <KpiTile id="my-month" icon="doc" label={`Pengajuan ${short(cur.period)}`} value={formatNumber(cur.count)} title={`${formatNumber(cur.count)} pengajuan, ${rp(cur.sum)}`} i={2}>
            <p className="pk-kpi-x">
              <b>{rp(cur.sum)}</b>
            </p>
            {prev ? <Delta d={delta(cur.count, prev.count)} money={false} vs={`vs ${short(prev.period)}`} /> : null}
          </KpiTile>
          <KpiTile id="my-done" icon="check" label="Selesai" value={formatNumber(st('done'))} i={3}>
            <p className="pk-kpi-x">{formatNumber(v.pipeline.exit.count)} ditolak/dibatalkan</p>
          </KpiTile>
        </KpiRow>

        <Card id="my-actions" icon="tTaskSquare" title="Perlu tindakan saya" sub="Terbaru dulu" span={7} i={4}>
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

        <Card id="my-requests" icon="tDocumentText" title="Pengajuan saya" sub="10 terbaru" span={7} i={6} action={{ href: ER, label: 'Lihat semua' }}>
          <DataTable<Own> id="my-requests" caption="Pengajuan saya" rows={d.latest} rowKey={(r) => r.id} cols={ownCols(false)} empty={<EmptyState text="Anda belum punya pengajuan." action={{ href: `${ER}/create`, label: '+ Buat pengajuan' }} />} />
        </Card>
        <Card id="my-trend" icon="tChart" title="Nilai pengajuan saya per bulan" sub="6 bulan, tanpa draft" span={5} i={7}>
          <ColumnsChart
            id="my-trend"
            rows={v.requestTrend.map((x) => ({ period: x.period, values: [x.sum] }))}
            series={[{ key: 'sum', label: 'Grand total', cls: 's1' }]}
            aria={`Nilai pengajuan saya per bulan: ${v.requestTrend.map((x) => `${short(x.period)} ${rp(x.sum)} (${formatNumber(x.count)})`).join(', ')}`}
            empty="Belum ada pengajuan dalam 6 bulan terakhir."
          />
          <TableView>
            <table className="pk-t" data-pk-table="my-trend-data">
              <tbody>
                {v.requestTrend.map((x) => (
                  <tr key={x.period}>
                    <td>{short(x.period)}</td>
                    <td className="n">{formatNumber(x.count)}</td>
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

/**
 * Operator/Anggota (owner decision 2026-10-09): attendance-only role, so its dashboard offers just the
 * two things it may do — see `access/panel-visibility.ts` (OPERATOR_VISIBLE_COLLECTIONS) and
 * `admin/modules/registry.ts` for the matching nav restriction.
 */
async function Operator({ req }: { req: PayloadRequest }) {
  const user = req.user as { id: number; name?: string | null; email?: string } | null
  const hello = await resolveDisplayName(req.payload, req.user)
  return (
    <Bento label="Absensi">
      <Card id="operator-absen" icon="attendance" title="Absen" sub={`Halo, ${hello}`} span={12}>
        <QuickActions
          label="Aksi absensi"
          items={[
            { key: 'absen', href: '/admin/absensi/absen', label: 'Absen sekarang', icon: 'tCamera', primary: true },
            { key: 'rekap', href: '/admin/absensi/rekap', label: 'Rekap absensi saya', icon: 'tCalendar' },
            { key: 'profil', href: `/admin/collections/users/${user?.id ?? ''}`, label: 'Profil', icon: 'tUser' },
          ]}
        />
      </Card>
    </Bento>
  )
}

/**
 * ADR 0032: Admin Staff — attendance administration of the PT: the team board, on-behalf check-in / check-out (also for
 * employees without an account), the monthly recap with corrections, the schedules (read).
 */
function AdminStaff() {
  return (
    <Bento label="Absensi">
      <Card id="adminstaff-absensi" icon="attendance" title="Absensi PT" sub="Admin Staff: kehadiran seluruh karyawan PT" span={12}>
        <QuickActions
          label="Aksi Admin Staff"
          items={[
            { key: 'absenkan', href: '/admin/absensi/absenkan', label: 'Absenkan karyawan', icon: 'tUserTag', primary: true },
            { key: 'tim', href: '/admin/absensi', label: 'Tim hari ini', icon: 'tPeople' },
            { key: 'rekap', href: '/admin/absensi/rekap', label: 'Rekap bulanan', icon: 'tCalendar' },
            { key: 'jadwal', href: '/admin/absensi/jadwal', label: 'Jadwal & hari libur', icon: 'tCalendarEdit' },
          ]}
        />
      </Card>
    </Bento>
  )
}

/** `/admin/dashboard` (admin/config.ts F3_ADMIN_VIEWS.dashboardPage): Dashboard inside the default template. */
export function DashboardPage(props: AdminViewServerProps) {
  return (
    <PageTemplate props={props}>
      <Dashboard {...props} />
    </PageTemplate>
  )
}

export default Dashboard
