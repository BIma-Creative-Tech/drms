import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import type { Role } from '@/access/roles'
import { REQUEST_STATUSES, REQUEST_TYPE_LABELS, REQUEST_TYPES, statusLabel, type RequestStatus, type RequestType } from '@/domain/expense/types'

import { absensiReport } from './attendance-report'
import { projectProgressVsBudget } from './progress'
import { auditLogCount, auditLogPage, AUDIT_PAGE, AUDIT_SOURCES, parseAuditFilter, type AuditFilter } from './audit-log'
import {
  cashBalances,
  cashBreakdown,
  cashFlowMonthly,
  inSequence,
  lpjSummary,
  num,
  projectBudgetByCategory,
  projectBudgets,
  reportContext,
  requestRows,
  requestSummary,
  rows,
  spending,
  vehicleCosts,
  visibleAccounts,
  type Ctx,
  type RequestFilter,
} from './kpi'
import { BUDGET_LABELS, dateRange, formatPct, lastDay, monthRange, periodLabel } from './rules'
import { costCenterScopeSql, includesManualCash, projectScopeSql, requestScopeSql, type ReportScope, type SQL } from './scope'

/**
 * F3 report catalogue (wireframes.md §5.1): one definition per report drives the screen
 * (/admin/laporan/<kode>), CSV, XLSX and PDF exports (/api/v1/reports/<kode>/<format>) and the
 * JSON endpoint (/api/v1/reports/<kode>) with the SAME filters and scope. Filters live in the query
 * string (plain GET forms). A PM's filters are intersected with the team scope (narrowScope), so
 * an out-of-scope id yields an empty report, never another team's data.
 */
export type ColType = 'text' | 'money' | 'int' | 'date' | 'datetime' | 'pct'
export type Column = { key: string; label: string; type: ColType; primary?: boolean; width?: number }
export type Cell = string | number | null
export type TableRow = { cells: Record<string, Cell>; href?: string }
export type Table = { key: string; title: string; columns: Column[]; rows: TableRow[]; totals?: Record<string, Cell | undefined>; empty?: string }
export type ReportResult = { main: Table; extra: Table[]; notes: string[]; next: string | null; count: number }
export type Format = 'csv' | 'xlsx' | 'pdf'
export type Option = { value: string; label: string }
export type FilterField = { name: string; label: string; kind: 'date' | 'month' | 'select' | 'multiselect' | 'text'; options?: Option[]; value: string | string[] }

export type ReportDef = {
  code: string
  title: string
  kpi: string
  description: string
  roles: Role[]
  formats: Format[]
  /** Paged (keyset) list reports stream CSV page by page; aggregates return every row at once. */
  paged: boolean
  pageSize: number
  run(req: PayloadRequest, scope: ReportScope, sp: URLSearchParams, page: { cursor?: string; limit: number }): Promise<ReportResult>
  /** Filter form fields with the current values + option lists (in scope). */
  filters(req: PayloadRequest, scope: ReportScope, sp: URLSearchParams): Promise<FilterField[]>
  fileStem(ctx: Ctx, sp: URLSearchParams): string
  /** Data scope of the caller; default officeScope (Finance/Owner all, PM team). */
  scope?(req: PayloadRequest): Promise<ReportScope>
}

// ---------------------------------------------------------------- shared parsing

const idOf = (sp: URLSearchParams, name: string): number | undefined => {
  const v = sp.get(name) ?? ''
  return /^\d{1,10}$/.test(v) && Number(v) > 0 ? Number(v) : undefined
}
const typeOf = (sp: URLSearchParams): RequestType | undefined => {
  const v = sp.get('jenis') ?? ''
  return (REQUEST_TYPES as readonly string[]).includes(v) ? (v as RequestType) : undefined
}
const statusesOf = (sp: URLSearchParams): RequestStatus[] => {
  const raw = sp.getAll('status').flatMap((s) => s.split(','))
  return [...new Set(raw.filter((s): s is RequestStatus => (REQUEST_STATUSES as readonly string[]).includes(s) && s !== 'draft'))]
}

/** PM filters narrow the scope; an id outside the team scope → empty scope (never other data). */
export function narrowScope(scope: ReportScope, projectId?: number, costCenterId?: number): ReportScope {
  if (!projectId && !costCenterId) return scope
  if (scope.kind === 'none' || scope.kind === 'own') return scope
  const inTeam = (ids: number[], id: number) => scope.kind === 'all' || ids.includes(id)
  const projects = projectId && inTeam(scope.kind === 'team' ? scope.projects : [], projectId) ? [projectId] : []
  const costCenters = costCenterId && inTeam(scope.kind === 'team' ? scope.costCenters : [], costCenterId) ? [costCenterId] : []
  // both given: a request has a project OR a cost center → both filters together match nothing
  if (projectId && costCenterId) return { kind: 'team', projects: [], costCenters: [] }
  return { kind: 'team', projects, costCenters }
}

const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as Array<[string, string]>).toString()

// ---------------------------------------------------------------- filter option lists (scoped)

async function projectOptions(req: PayloadRequest, scope: ReportScope): Promise<Option[]> {
  const r = await rows(req, sql`SELECT p.id, p.code, p.name FROM projects p WHERE ${projectScopeSql(scope)} ORDER BY p.code`)
  return r.map((x) => ({ value: String(x.id), label: `${x.code} ${x.name}` }))
}
async function costCenterOptions(req: PayloadRequest, scope: ReportScope): Promise<Option[]> {
  const r = await rows(req, sql`SELECT cc.id, cc.code, cc.name FROM cost_centers cc WHERE ${costCenterScopeSql(scope)} ORDER BY cc.code`)
  return r.map((x) => ({ value: String(x.id), label: `${x.code} ${x.name}` }))
}
async function categoryOptions(req: PayloadRequest): Promise<Option[]> {
  const r = await rows(req, sql`SELECT id, code, name FROM expense_categories ORDER BY code`)
  return r.map((x) => ({ value: String(x.id), label: `${x.code} ${x.name}` }))
}
async function accountOptions(req: PayloadRequest): Promise<Option[]> {
  const r = await rows(req, sql`SELECT id, name FROM cash_accounts ORDER BY name`)
  return r.map((x) => ({ value: String(x.id), label: String(x.name) }))
}
async function vehicleOptions(req: PayloadRequest): Promise<Option[]> {
  const r = await rows(req, sql`SELECT id, coalesce(plate_display, plate_no) AS plate, type FROM vehicles ORDER BY 2`)
  return r.map((x) => ({ value: String(x.id), label: `${x.plate} (${x.type})` }))
}
async function requesterOptions(req: PayloadRequest, scope: ReportScope): Promise<Option[]> {
  const r = await rows(
    req,
    sql`SELECT DISTINCT e.id, e.code, e.name FROM expense_requests er JOIN expense_requests_rels rr ON rr.parent_id = er.id AND rr.path = 'requesters'
        JOIN employees e ON e.id = rr.employees_id WHERE ${requestScopeSql(scope)} ORDER BY e.name`,
  )
  return r.map((x) => ({ value: String(x.id), label: `${x.name} (${x.code})` }))
}

const sel = (name: string, label: string, sp: URLSearchParams, options: Option[]): FilterField => ({ name, label, kind: 'select', options, value: sp.get(name) ?? '' })
const typeOptions: Option[] = REQUEST_TYPES.map((t) => ({ value: t, label: REQUEST_TYPE_LABELS[t] }))

async function dateFields(req: PayloadRequest, sp: URLSearchParams): Promise<FilterField[]> {
  const ctx = await reportContext(req)
  const r = dateRange(sp.get('dari'), sp.get('sampai'), ctx.today)
  return [
    { name: 'dari', label: 'Dari', kind: 'date', value: r.from },
    { name: 'sampai', label: 'Sampai', kind: 'date', value: r.to },
  ]
}

function filterLine(label: string, value: string | undefined, options?: Option[]): string | null {
  if (!value) return null
  return `${label}: ${options?.find((o) => o.value === value)?.label ?? value}`
}

/** Human-readable active filters (export title rows, PDF header). */
export function describeFilters(fields: FilterField[]): string[] {
  const out: string[] = []
  for (const f of fields) {
    if (Array.isArray(f.value)) {
      if (f.value.length) out.push(`${f.label}: ${f.value.map((v) => f.options?.find((o) => o.value === v)?.label ?? v).join(', ')}`)
    } else {
      const l = filterLine(f.label, f.value, f.options)
      if (l) out.push(l)
    }
  }
  return out
}

// ================================================================ rekap-kas (K-01, K-02a)

const rekapKas: ReportDef = {
  code: 'rekap-kas',
  title: 'Rekap Kas',
  kpi: 'K-01, K-02a',
  description: 'Saldo per akun dan arus kas per bulan (masuk/keluar, koreksi void). Angka resmi buku kas.',
  roles: ['pk-finance', 'pk-owner'],
  formats: ['csv', 'xlsx', 'pdf'],
  paged: false,
  pageSize: 36,
  async run(req, _scope, sp) {
    const ctx = await reportContext(req)
    const m = monthRange(sp.get('dari'), sp.get('sampai'), ctx.today)
    const f = { from: m.from, to: m.to, accountId: idOf(sp, 'akun'), projectId: idOf(sp, 'project'), costCenterId: idOf(sp, 'pusat') }
    const flows = await cashFlowMonthly(req, f, 'book')
    const withBalance = !f.projectId && !f.costCenterId
    const columns: Column[] = [
      { key: 'bulan', label: 'Bulan', type: 'text', primary: true },
      ...(withBalance ? [{ key: 'awal', label: 'Saldo awal (Rp)', type: 'money' as const }] : []),
      { key: 'masuk', label: 'Masuk (Rp)', type: 'money' },
      { key: 'keluar', label: 'Keluar (Rp)', type: 'money' },
      { key: 'selisih', label: 'Selisih (Rp)', type: 'money', primary: true },
      { key: 'koreksi', label: 'Koreksi void (Rp)', type: 'money' },
      ...(withBalance ? [{ key: 'akhir', label: 'Saldo akhir (Rp)', type: 'money' as const }] : []),
    ]
    const main: Table = {
      key: 'bulanan',
      title: 'Arus kas per bulan (K-02a, semua baris termasuk void dan jurnal balik)',
      columns,
      rows: flows.map((x) => ({
        cells: { bulan: periodLabel(x.period), awal: x.openingBalance, masuk: x.masuk, keluar: x.keluar, selisih: x.net, koreksi: x.koreksi, akhir: x.closingBalance },
        href: `/admin/laporan/buku-kas?${qs({ dari: `${x.period}-01`, sampai: lastDay(x.period), akun: f.accountId, project: f.projectId, pusat: f.costCenterId })}`,
      })),
      totals: {
        bulan: 'TOTAL',
        masuk: flows.reduce((s, x) => s + x.masuk, 0),
        keluar: flows.reduce((s, x) => s + x.keluar, 0),
        selisih: flows.reduce((s, x) => s + x.net, 0),
        koreksi: flows.reduce((s, x) => s + x.koreksi, 0),
      },
      empty: 'Belum ada transaksi kas di rentang ini.',
    }
    const asOf = lastDay(m.to) < ctx.today ? lastDay(m.to) : ctx.today
    const bal = await cashBalances(req, asOf, f.accountId)
    const acc = visibleAccounts(bal.accounts)
    const breakdown = await cashBreakdown(req, f)
    const SRC: Record<string, string> = { transfer: 'Transfer pengajuan', settlement_refund: 'Pengembalian LPJ', manual: 'Manual', reversal: 'Jurnal balik (void)', opening: 'Saldo awal' }
    return {
      main,
      extra: [
        {
          key: 'saldo',
          title: `Saldo per akun per ${fmtDate(asOf)} (K-01)`,
          columns: [
            { key: 'akun', label: 'Akun', type: 'text', primary: true },
            { key: 'status', label: 'Status', type: 'text' },
            { key: 'saldo', label: 'Saldo (Rp)', type: 'money', primary: true },
          ],
          rows: acc.map((a) => ({ cells: { akun: a.name, status: a.active ? 'aktif' : 'nonaktif', saldo: a.balance } })),
          totals: { akun: 'TOTAL', saldo: acc.reduce((s, a) => s + a.balance, 0) },
          empty: 'Belum ada akun kas. Admin/Finance menambah di Master Data › Akun kas/bank.',
        },
        {
          key: 'rincian',
          title: 'Rincian masuk per sumber dan keluar per jenis (rentang yang sama)',
          columns: [
            { key: 'arah', label: 'Arah', type: 'text', primary: true },
            { key: 'jenis', label: 'Sumber / jenis', type: 'text', primary: true },
            { key: 'n', label: 'Transaksi', type: 'int' },
            { key: 'nominal', label: 'Nominal (Rp)', type: 'money', primary: true },
          ],
          rows: breakdown.map((b) => ({
            cells: { arah: b.direction === 'in' ? 'Masuk' : 'Keluar', jenis: b.direction === 'in' && b.sourceType === 'manual' ? `Manual — ${b.sourceName ?? 'tanpa sumber'}` : (SRC[b.sourceType] ?? b.sourceType), n: b.count, nominal: b.amount },
          })),
          empty: 'Tidak ada transaksi.',
        },
      ],
      notes: [
        'Dasar: buku kas (K-02a). Transaksi yang di-void tetap tercatat dan jurnal baliknya menetralkan; kolom "Koreksi void" = selisih pasangan void pada bulan itu.',
        'Bulan yang sudah tutup buku tidak berubah; void atas transaksi bulan tertutup dicatat di bulan berjalan (ADR 0005 §4).',
      ],
      next: null,
      count: flows.length,
    }
  },
  async filters(req, _scope, sp) {
    const ctx = await reportContext(req)
    const m = monthRange(sp.get('dari'), sp.get('sampai'), ctx.today)
    return [
      { name: 'dari', label: 'Dari bulan', kind: 'month', value: m.from },
      { name: 'sampai', label: 'Sampai bulan', kind: 'month', value: m.to },
      sel('akun', 'Akun kas', sp, await accountOptions(req)),
      sel('project', 'Project', sp, await projectOptions(req, { kind: 'all' })),
      sel('pusat', 'Pusat biaya', sp, await costCenterOptions(req, { kind: 'all' })),
    ]
  },
  fileStem(ctx, sp) {
    const m = monthRange(sp.get('dari'), sp.get('sampai'), ctx.today)
    return `rekap-kas_${m.from}_${m.to}`
  },
}

// ================================================================ buku-kas (ledger rows)

const SOURCE_TYPES = ['transfer', 'settlement_refund', 'manual', 'reversal', 'opening'] as const
const SOURCE_LABELS: Record<string, string> = { transfer: 'Transfer pengajuan', settlement_refund: 'Pengembalian LPJ', manual: 'Manual', reversal: 'Jurnal balik', opening: 'Saldo awal' }

function ledgerWhere(sp: URLSearchParams, ctx: Ctx): SQL {
  const r = dateRange(sp.get('dari'), sp.get('sampai'), ctx.today)
  const w: SQL[] = [sql`ce.entry_date BETWEEN ${r.from} AND ${r.to}`]
  const acc = idOf(sp, 'akun')
  if (acc) w.push(sql`ce.cash_account_id = ${acc}`)
  const arah = sp.get('arah')
  if (arah === 'in' || arah === 'out') w.push(sql`ce.direction = ${arah}`)
  const src = sp.get('sumber') ?? ''
  if ((SOURCE_TYPES as readonly string[]).includes(src)) w.push(sql`ce.source_type = ${src}`)
  const st = sp.get('status')
  if (st === 'posted' || st === 'void') w.push(sql`ce.status = ${st}`)
  const p = idOf(sp, 'project')
  if (p) w.push(sql`ce.project_id = ${p}`)
  const c = idOf(sp, 'pusat')
  if (c) w.push(sql`ce.cost_center_id = ${c}`)
  return sql.join(w, sql` AND `)
}

const bukuKas: ReportDef = {
  code: 'buku-kas',
  title: 'Buku Kas',
  kpi: 'baris buku kas',
  description: 'Daftar transaksi kas per baris (KM/KK, void dan jurnal balik), terbaru di atas.',
  roles: ['pk-finance', 'pk-owner'],
  formats: ['csv', 'xlsx'],
  paged: true,
  pageSize: 100,
  async run(req, _scope, sp, page) {
    const ctx = await reportContext(req)
    const where = ledgerWhere(sp, ctx)
    const cur = page.cursor ? Buffer.from(page.cursor, 'base64url').toString('utf8').split('|') : null
    const after = cur && /^\d{4}-\d{2}-\d{2}$/.test(cur[0] ?? '') && /^\d{1,10}$/.test(cur[1] ?? '') ? sql`AND (ce.entry_date, ce.id) < (${cur[0]}, ${Number(cur[1])})` : sql``
    const r = await rows(
      req,
      sql`SELECT ce.id, ce.entry_no, ce.entry_date, ce.direction::text AS direction, ce.amount::text AS amount, ce.source_type::text AS source_type, ce.status::text AS status,
            a.name AS account, coalesce(cat.code || ' ' || cat.name, src.name) AS kategori,
            coalesce(p.code || ' ' || p.name, cc.code || ' ' || cc.name) AS lingkup, coalesce(v.plate_display, v.plate_no) AS vehicle,
            er.doc_no AS request_no, er.id AS request_id, ce.description, ce.void_reason, orig.entry_no AS reversal_of
          FROM cash_entries ce JOIN cash_accounts a ON a.id = ce.cash_account_id
          LEFT JOIN expense_categories cat ON cat.id = ce.category_id LEFT JOIN cash_in_sources src ON src.id = ce.cash_in_source_id
          LEFT JOIN projects p ON p.id = ce.project_id LEFT JOIN cost_centers cc ON cc.id = ce.cost_center_id
          LEFT JOIN vehicles v ON v.id = ce.vehicle_id LEFT JOIN expense_requests er ON er.id = ce.expense_request_id
          LEFT JOIN cash_entries orig ON orig.id = ce.reversal_of_id
          WHERE ${where} ${after}
          ORDER BY ce.entry_date DESC, ce.id DESC LIMIT ${page.limit + 1}`,
    )
    const list = r.slice(0, page.limit)
    const tot = await rows(
      req,
      sql`SELECT count(*)::int AS n, coalesce(sum(ce.amount) FILTER (WHERE ce.direction = 'in'), 0)::text AS tin, coalesce(sum(ce.amount) FILTER (WHERE ce.direction = 'out'), 0)::text AS tout FROM cash_entries ce WHERE ${where}`,
    )
    const last = list.at(-1)
    return {
      main: {
        key: 'transaksi',
        title: 'Transaksi kas',
        columns: [
          { key: 'tanggal', label: 'Tanggal', type: 'date', primary: true },
          { key: 'nomor', label: 'Nomor', type: 'text', primary: true },
          { key: 'akun', label: 'Akun', type: 'text' },
          { key: 'sumber', label: 'Jenis', type: 'text' },
          { key: 'kategori', label: 'Kategori / sumber', type: 'text' },
          { key: 'lingkup', label: 'Project / pusat biaya', type: 'text' },
          { key: 'kendaraan', label: 'Kendaraan', type: 'text' },
          { key: 'pengajuan', label: 'Pengajuan', type: 'text' },
          { key: 'keterangan', label: 'Keterangan', type: 'text', width: 40 },
          { key: 'masuk', label: 'Masuk (Rp)', type: 'money', primary: true },
          { key: 'keluar', label: 'Keluar (Rp)', type: 'money', primary: true },
          { key: 'status', label: 'Status', type: 'text' },
        ],
        rows: list.map((x) => ({
          cells: {
            tanggal: String(x.entry_date),
            nomor: (x.entry_no as string | null) ?? `#${x.id}`,
            akun: String(x.account),
            sumber: SOURCE_LABELS[String(x.source_type)] ?? String(x.source_type),
            kategori: (x.kategori as string | null) ?? '',
            lingkup: (x.lingkup as string | null) ?? '',
            kendaraan: (x.vehicle as string | null) ?? '',
            pengajuan: (x.request_no as string | null) ?? '',
            keterangan: [(x.description as string | null) ?? '', x.reversal_of ? `(jurnal balik ${x.reversal_of})` : ''].filter(Boolean).join(' '),
            masuk: x.direction === 'in' ? num(x.amount) : null,
            keluar: x.direction === 'out' ? num(x.amount) : null,
            status: x.status === 'void' ? `void${x.void_reason ? `: ${x.void_reason}` : ''}` : 'posted',
          },
          href: x.request_id ? `/admin/collections/expense-requests/${x.request_id}` : `/admin/collections/cash-entries/${x.id}`,
        })),
        totals: { tanggal: 'TOTAL (semua halaman)', masuk: num(tot[0]?.tin), keluar: num(tot[0]?.tout) },
        empty: 'Tidak ada data untuk filter ini.',
      },
      extra: [],
      notes: ['Nomor rekening tujuan tidak ditampilkan di laporan ini.'],
      next: r.length > page.limit && last ? Buffer.from(`${last.entry_date}|${last.id}`).toString('base64url') : null,
      count: num(tot[0]?.n),
    }
  },
  async filters(req, _scope, sp) {
    return [
      ...(await dateFields(req, sp)),
      sel('akun', 'Akun kas', sp, await accountOptions(req)),
      sel('arah', 'Arah', sp, [
        { value: 'in', label: 'Masuk' },
        { value: 'out', label: 'Keluar' },
      ]),
      sel(
        'sumber',
        'Jenis',
        sp,
        SOURCE_TYPES.map((s) => ({ value: s, label: SOURCE_LABELS[s]! })),
      ),
      sel('status', 'Status', sp, [
        { value: 'posted', label: 'posted' },
        { value: 'void', label: 'void' },
      ]),
      sel('project', 'Project', sp, await projectOptions(req, { kind: 'all' })),
      sel('pusat', 'Pusat biaya', sp, await costCenterOptions(req, { kind: 'all' })),
    ]
  },
  fileStem(ctx, sp) {
    const r = dateRange(sp.get('dari'), sp.get('sampai'), ctx.today)
    return `buku-kas_${r.from}_${r.to}`
  },
}

// ================================================================ pengeluaran-kategori (K-17)

const pengeluaranKategori: ReportDef = {
  code: 'pengeluaran-kategori',
  title: 'Pengeluaran per Kategori',
  kpi: 'K-17, K-06',
  description: 'Dana dicairkan atau realisasi terverifikasi per kategori (dari baris item) atau per project/pusat biaya, plus kas keluar manual.',
  roles: ['pk-finance', 'pk-owner', 'pk-pm'],
  formats: ['csv', 'xlsx', 'pdf'],
  paged: false,
  pageSize: 500,
  async run(req, scope, sp) {
    const ctx = await reportContext(req)
    const r = dateRange(sp.get('dari'), sp.get('sampai'), ctx.today)
    const basis = sp.get('dasar') === 'realisasi' ? 'realisasi' : 'dicairkan'
    const group = sp.get('grup') === 'lingkup' ? 'lingkup' : 'kategori'
    const projectId = idOf(sp, 'project')
    const costCenterId = idOf(sp, 'pusat')
    const s = await spending(req, scope, { from: r.from, to: r.to, basis, group, type: typeOf(sp), projectId, costCenterId, categoryId: idOf(sp, 'kategori') })
    const items = s.items
    const total = s.total
    const manualShown = s.includesManual
    return {
      main: {
        key: 'pengeluaran',
        title: `${basis === 'dicairkan' ? 'Dicairkan' : 'Realisasi terverifikasi'} per ${group === 'kategori' ? 'kategori' : 'project / pusat biaya'}`,
        columns: [
          { key: 'label', label: group === 'kategori' ? 'Kategori' : 'Project / pusat biaya', type: 'text', primary: true },
          { key: 'n', label: 'Pengajuan', type: 'int' },
          { key: 'req', label: basis === 'dicairkan' ? 'Dicairkan (Rp)' : 'Realisasi (Rp)', type: 'money' },
          ...(manualShown ? [{ key: 'manual', label: 'Kas manual (Rp)', type: 'money' as const }] : []),
          { key: 'total', label: 'Total (Rp)', type: 'money', primary: true },
          { key: 'share', label: '% total', type: 'pct' },
        ],
        rows: items.map((i) => ({
          cells: { label: i.label, n: i.requestCount, req: i.fromRequests, manual: i.fromManual, total: i.total, share: total > 0 ? Math.round((i.total / total) * 1000) / 10 : 0 },
          href:
            group === 'kategori' && /^\d+$/.test(i.key)
              ? `/admin/laporan/rekap-pengajuan?${qs({ dari: r.from, sampai: r.to, kategori: i.key, jenis: typeOf(sp), project: projectId, pusat: costCenterId })}`
              : undefined,
        })),
        totals: { label: 'TOTAL', n: null, req: items.reduce((a, i) => a + i.fromRequests, 0), manual: items.reduce((a, i) => a + i.fromManual, 0), total, share: total > 0 ? 100 : 0 },
        empty: 'Tidak ada data untuk filter ini.',
      },
      extra: [],
      notes: [
        'Kategori dihitung dari baris item pengajuan (US-25). "Pengajuan" = banyak pengajuan berbeda; satu pengajuan bisa muncul di beberapa kategori.',
        basis === 'dicairkan'
          ? 'Dicairkan: pengajuan yang ditransfer dalam rentang (tanggal transfer). Selisih LPJ (pengembalian/kekurangan) tampil di dasar Realisasi, bukan di sini.'
          : 'Realisasi: Uang Muka = nota valid saat LPJ diverifikasi; Reimburse = total baris saat nota diverifikasi (tanggal verifikasi WITA).',
        manualShown ? 'Kas manual = kas keluar manual (posted, bukan jurnal balik) per tanggal transaksi.' : 'Tanpa kas manual (cakupan tim PM atau filter jenis pengajuan).',
      ],
      next: null,
      count: items.length,
    }
  },
  async filters(req, scope, sp) {
    return [
      ...(await dateFields(req, sp)),
      sel('dasar', 'Dasar', sp, [
        { value: 'dicairkan', label: 'Dicairkan' },
        { value: 'realisasi', label: 'Realisasi terverifikasi' },
      ]),
      sel('grup', 'Kelompok', sp, [
        { value: 'kategori', label: 'Kategori' },
        { value: 'lingkup', label: 'Project / pusat biaya' },
      ]),
      sel('jenis', 'Jenis', sp, typeOptions),
      sel('project', 'Project', sp, await projectOptions(req, scope)),
      sel('pusat', 'Pusat biaya', sp, await costCenterOptions(req, scope)),
      sel('kategori', 'Kategori', sp, await categoryOptions(req)),
    ]
  },
  fileStem(ctx, sp) {
    const r = dateRange(sp.get('dari'), sp.get('sampai'), ctx.today)
    return `pengeluaran-kategori_${r.from}_${r.to}`
  },
}

// ================================================================ anggaran-project (K-07/K-08, K-05, K-06)

const anggaranProject: ReportDef = {
  code: 'anggaran-project',
  title: 'Anggaran Project',
  kpi: 'K-07, K-08, K-05, K-06, K-09',
  description: 'RAB vs Komitmen vs Dicairkan vs Realisasi per project; per kategori bila project punya RAB kategori.',
  roles: ['pk-finance', 'pk-owner', 'pk-pm'],
  formats: ['csv', 'xlsx', 'pdf'],
  paged: false,
  pageSize: 500,
  async run(req, scope, sp) {
    const ctx = await reportContext(req)
    const projectId = idOf(sp, 'project')
    const list = await projectBudgets(req, scope, { projectId, includeArchived: sp.get('arsip') === 'ya' })
    // E4 (US-12): K-09 progress fisik per project, same scope/filters (replaces the F5 placeholder).
    const k09 = await projectProgressVsBudget(req, scope, { projectId, includeArchived: sp.get('arsip') === 'ya' })
    const progress = new Map(k09.projects.map((p) => [p.id, p]))
    const extra: Table[] = []
    if (projectId && list.length === 1) {
      const cats = await projectBudgetByCategory(req, scope, projectId)
      extra.push({
        key: 'kategori',
        title: `Per kategori — ${list[0]!.code} ${list[0]!.name}`,
        columns: [
          { key: 'kategori', label: 'Kategori', type: 'text', primary: true },
          { key: 'rab', label: 'RAB kategori (Rp)', type: 'money' },
          { key: 'komitmen', label: 'Komitmen (Rp)', type: 'money', primary: true },
          { key: 'pct', label: '%', type: 'pct', primary: true },
          { key: 'ket', label: 'Keterangan', type: 'text' },
        ],
        rows: cats.map((c) => ({ cells: { kategori: c.code ? `${c.code} ${c.name}` : c.name, rab: c.rab, komitmen: c.committed, pct: c.pct, ket: c.outsideRab ? 'di luar RAB kategori' : '' } })),
        empty: 'Project ini belum punya RAB per kategori.',
      })
    }
    const sum = (k: 'committed' | 'disbursedNet' | 'realized') => list.reduce((s, p) => s + p[k], 0)
    return {
      main: {
        key: 'project',
        title: 'Anggaran per project (warna dari Komitmen)',
        columns: [
          { key: 'project', label: 'Project', type: 'text', primary: true },
          { key: 'statusProject', label: 'Status project', type: 'text' },
          { key: 'rab', label: 'RAB (Rp)', type: 'money' },
          { key: 'komitmen', label: 'Komitmen (Rp)', type: 'money' },
          { key: 'pct', label: '% komitmen', type: 'pct', primary: true },
          { key: 'status', label: 'Status anggaran', type: 'text', primary: true },
          { key: 'dicairkan', label: 'Dicairkan bersih (Rp)', type: 'money' },
          { key: 'pctDicairkan', label: '% dicairkan', type: 'pct' },
          { key: 'realisasi', label: 'Realisasi (Rp)', type: 'money' },
          { key: 'pctRealisasi', label: '% realisasi', type: 'pct' },
          { key: 'progress', label: 'Progress fisik', type: 'pct' },
          { key: 'progressStatus', label: 'Progress vs anggaran (K-09)', type: 'text' },
        ],
        rows: list.map((p) => ({
          cells: {
            project: `${p.code} ${p.name}`,
            statusProject: p.status,
            rab: p.budget,
            komitmen: p.committed,
            pct: p.pct,
            status: BUDGET_LABELS[p.tone],
            dicairkan: p.disbursedNet,
            pctDicairkan: p.pctDisbursed,
            realisasi: p.realized,
            pctRealisasi: p.pctRealized,
            progress: progress.get(p.id)?.stagesComplete ? progress.get(p.id)!.progressPct : null,
            progressStatus: progress.get(p.id)?.toneLabel ?? '',
          },
          href: `/admin/laporan/anggaran-project?${qs({ project: p.id })}`,
        })),
        totals: { project: 'TOTAL', rab: list.reduce((s, p) => s + (p.budget ?? 0), 0), komitmen: sum('committed'), dicairkan: sum('disbursedNet'), realisasi: sum('realized') },
        empty: scope.kind === 'team' ? 'Anda belum ditetapkan sebagai PM project mana pun. Hubungi Direktur/Admin.' : 'Belum ada project.',
      },
      extra,
      notes: [
        `Status anggaran: Aman ≤ ${ctx.budgetWarnPct}% · Waspada > ${ctx.budgetWarnPct}% s/d ≤ ${ctx.budgetOverPct}% · Lewat RAB > ${ctx.budgetOverPct}% · Tanpa RAB (Komitmen, sama dengan layar persetujuan).`,
        'Komitmen = pengajuan yang sudah disetujui dan sesudahnya. Dicairkan bersih = transfer − pengembalian LPJ. Realisasi = biaya terverifikasi Finance.',
        `Progress fisik = Σ(bobot × % tahapan) dari laporan progress. K-09 selisih = % komitmen − % progress fisik: Sesuai ≤ ${k09.warnGapPct}% · Perlu perhatian ≤ ${k09.badGapPct}% · Anggaran mendahului progress > ${k09.badGapPct}% (tanpa RAB / tahapan belum 100% = tidak dinilai).`,
      ],
      next: null,
      count: list.length,
    }
  },
  async filters(req, scope, sp) {
    return [
      sel('project', 'Project', sp, await projectOptions(req, scope)),
      sel('arsip', 'Termasuk arsip', sp, [{ value: 'ya', label: 'Ya' }]),
    ]
  },
  fileStem(ctx) {
    return `anggaran-project_${ctx.today}`
  },
}

// ================================================================ rekap-pengajuan (K-13)

function requestFilter(sp: URLSearchParams, ctx: Ctx): RequestFilter {
  const r = dateRange(sp.get('dari'), sp.get('sampai'), ctx.today)
  return {
    from: r.from,
    to: r.to,
    type: typeOf(sp),
    statuses: statusesOf(sp),
    projectId: idOf(sp, 'project'),
    costCenterId: idOf(sp, 'pusat'),
    categoryId: idOf(sp, 'kategori'),
    requesterId: idOf(sp, 'pemohon'),
  }
}

const rekapPengajuan: ReportDef = {
  code: 'rekap-pengajuan',
  title: 'Rekap Pengajuan',
  kpi: 'K-13',
  description: 'Pengajuan (non-draft) per status, jenis, kategori dan periode tanggal pengajuan.',
  roles: ['pk-finance', 'pk-owner', 'pk-pm'],
  formats: ['csv', 'xlsx'],
  paged: true,
  pageSize: 100,
  async run(req, scope, sp, page) {
    const ctx = await reportContext(req)
    const f = requestFilter(sp, ctx)
    const eff = scope
    const after = page.cursor ? Number(Buffer.from(page.cursor, 'base64url').toString('utf8')) : undefined
    const list = await requestRows(req, eff, f, { after: Number.isSafeInteger(after) && after! > 0 ? after : undefined, limit: page.limit + 1 })
    const summary = await requestSummary(req, eff, f)
    const shown = list.slice(0, page.limit)
    const last = shown.at(-1)
    return {
      main: {
        key: 'pengajuan',
        title: 'Pengajuan',
        columns: [
          { key: 'nomor', label: 'Nomor', type: 'text', primary: true },
          { key: 'tanggal', label: 'Tanggal', type: 'date' },
          { key: 'jenis', label: 'Jenis', type: 'text' },
          { key: 'judul', label: 'Judul', type: 'text', width: 36 },
          { key: 'lingkup', label: 'Project / pusat biaya', type: 'text' },
          { key: 'pemohon', label: 'Pemohon', type: 'text' },
          { key: 'status', label: 'Status', type: 'text', primary: true },
          { key: 'grandTotal', label: 'Grand total (Rp)', type: 'money', primary: true },
          { key: 'disetujui', label: 'Disetujui (Rp)', type: 'money' },
          { key: 'dicairkan', label: 'Dicairkan (Rp)', type: 'money' },
          { key: 'realisasi', label: 'Realisasi (Rp)', type: 'money' },
          { key: 'flag', label: 'Flag terbuka', type: 'int' },
        ],
        rows: shown.map((x) => ({
          cells: {
            nomor: x.docNo ?? `#${x.id}`,
            tanggal: x.requestDate,
            jenis: REQUEST_TYPE_LABELS[x.type],
            judul: x.title,
            lingkup: x.scopeName,
            pemohon: x.requesters,
            status: statusLabel(x.type, x.status),
            grandTotal: x.grandTotal,
            disetujui: x.approvedAmount,
            dicairkan: x.disbursed,
            realisasi: x.realized,
            flag: x.openFlags,
          },
          href: `/admin/collections/expense-requests/${x.id}`,
        })),
        totals: { nomor: `TOTAL ${summary.total.count} pengajuan`, grandTotal: summary.total.sum },
        empty: 'Tidak ada data untuk filter ini.',
      },
      extra: [
        {
          key: 'status',
          title: 'Per status',
          columns: [
            { key: 'jenis', label: 'Jenis', type: 'text', primary: true },
            { key: 'status', label: 'Status', type: 'text', primary: true },
            { key: 'n', label: 'Jumlah', type: 'int', primary: true },
            { key: 's', label: 'Grand total (Rp)', type: 'money' },
          ],
          rows: summary.byStatus.map((x) => ({ cells: { jenis: REQUEST_TYPE_LABELS[x.type], status: statusLabel(x.type, x.status), n: x.count, s: x.sum } })),
          totals: { jenis: 'TOTAL', n: summary.total.count, s: summary.total.sum },
        },
        {
          key: 'kategori',
          title: 'Per kategori (dari baris item)',
          columns: [
            { key: 'kategori', label: 'Kategori', type: 'text', primary: true },
            { key: 'n', label: 'Pengajuan', type: 'int' },
            { key: 's', label: 'Nominal baris (Rp)', type: 'money', primary: true },
          ],
          rows: summary.byCategory.map((x) => ({ cells: { kategori: x.code ? `${x.code} ${x.name}` : x.name, n: x.count, s: x.sum } })),
          totals: { kategori: 'TOTAL', s: summary.byCategory.reduce((a, x) => a + x.sum, 0) },
        },
      ],
      notes: ['Draft tidak dihitung. Periode = tanggal pengajuan. Jumlah per kategori = pengajuan berbeda yang punya ≥ 1 baris kategori itu (bisa lebih dari total pengajuan).'],
      next: list.length > page.limit && last ? Buffer.from(String(last.id)).toString('base64url') : null,
      count: summary.total.count,
    }
  },
  async filters(req, scope, sp) {
    return [
      ...(await dateFields(req, sp)),
      sel('jenis', 'Jenis', sp, typeOptions),
      {
        name: 'status',
        label: 'Status',
        kind: 'multiselect',
        options: REQUEST_STATUSES.filter((s) => s !== 'draft').map((s) => ({ value: s, label: statusLabel('reimburse', s) })),
        value: statusesOf(sp),
      },
      sel('project', 'Project', sp, await projectOptions(req, scope)),
      sel('pusat', 'Pusat biaya', sp, await costCenterOptions(req, scope)),
      sel('kategori', 'Kategori', sp, await categoryOptions(req)),
      sel('pemohon', 'Pemohon', sp, await requesterOptions(req, scope)),
    ]
  },
  fileStem(ctx, sp) {
    const r = dateRange(sp.get('dari'), sp.get('sampai'), ctx.today)
    return `rekap-pengajuan_${r.from}_${r.to}`
  },
}

// ================================================================ kelengkapan (K-12)

const kelengkapan: ReportDef = {
  code: 'kelengkapan',
  title: 'Kelengkapan Nota/LPJ',
  kpi: 'K-12',
  description: 'Uang muka belum LPJ (dan yang terlambat), LPJ menunggu, nota reimburse menunggu, flag peringatan terbuka.',
  roles: ['pk-finance', 'pk-owner', 'pk-pm'],
  formats: ['csv', 'xlsx'],
  paged: false,
  pageSize: 2000,
  async run(req, scope, sp) {
    const ctx = await reportContext(req)
    const r = dateRange(sp.get('dari'), sp.get('sampai'), ctx.today)
    const eff = narrowScope(scope, idOf(sp, 'project'), idOf(sp, 'pusat'))
    const s = await lpjSummary(req, eff, r.from, r.to)
    return {
      main: {
        key: 'belum-lpj',
        title: `Uang muka belum LPJ (terlambat bila > ${ctx.lpjDueDays} hari sejak transfer pertama)`,
        columns: [
          { key: 'nomor', label: 'Nomor', type: 'text', primary: true },
          { key: 'judul', label: 'Judul', type: 'text', width: 36 },
          { key: 'pemohon', label: 'Pemohon', type: 'text' },
          { key: 'lingkup', label: 'Project / pusat biaya', type: 'text' },
          { key: 'status', label: 'Status', type: 'text' },
          { key: 'nominal', label: 'Ditransfer (Rp)', type: 'money', primary: true },
          { key: 'transfer', label: 'Transfer pertama', type: 'date' },
          { key: 'umur', label: 'Umur (hari)', type: 'int', primary: true },
          { key: 'terlambat', label: 'LPJ terlambat', type: 'text', primary: true },
        ],
        rows: s.rows.map((a) => ({
          cells: {
            nomor: a.docNo ?? `#${a.id}`,
            judul: a.title,
            pemohon: a.requesters,
            lingkup: a.scopeName,
            status: statusLabel('advance', a.status as RequestStatus),
            nominal: a.transferredTotal,
            transfer: a.firstTransfer,
            umur: a.ageDays,
            terlambat: a.overdue ? 'Ya' : 'Tidak',
          },
          href: `/admin/collections/expense-requests/${a.id}`,
        })),
        totals: { nomor: 'TOTAL', nominal: s.withoutLpj.sum },
        empty: 'Semua uang muka sudah ber-LPJ. ✓',
      },
      extra: [
        {
          key: 'ringkasan',
          title: 'Ringkasan',
          columns: [
            { key: 'indikator', label: 'Indikator', type: 'text', primary: true },
            { key: 'jumlah', label: 'Jumlah', type: 'int', primary: true },
            { key: 'nominal', label: 'Nominal (Rp)', type: 'money' },
          ],
          rows: [
            { cells: { indikator: 'K-12a Uang muka belum LPJ', jumlah: s.withoutLpj.count, nominal: s.withoutLpj.sum } },
            { cells: { indikator: `K-12b LPJ terlambat (> ${ctx.lpjDueDays} hari)`, jumlah: s.overdue.count, nominal: s.overdue.sum } },
            { cells: { indikator: 'K-12c LPJ menunggu verifikasi', jumlah: s.lpjToVerify, nominal: null }, href: '/admin/verifikasi-lpj' },
            { cells: { indikator: 'K-12d LPJ menunggu penyelesaian selisih (pengembalian)', jumlah: s.lpjToSettle.count, nominal: s.lpjToSettle.refund } },
            { cells: { indikator: 'K-12d … kekurangan yang harus ditransfer', jumlah: null, nominal: s.lpjToSettle.shortfall } },
            { cells: { indikator: 'K-12e Nota reimburse menunggu verifikasi', jumlah: s.reimburseToVerify, nominal: null }, href: '/admin/antrian-transfer' },
            { cells: { indikator: 'K-12f Flag peringatan terbuka', jumlah: s.openWarnings, nominal: null } },
            { cells: { indikator: `K-12g Uang muka ditransfer ${fmtDate(r.from)}–${fmtDate(r.to)} yang sudah LPJ`, jumlah: s.ratio.done, nominal: null } },
            { cells: { indikator: `K-12g … dari total uang muka ditransfer`, jumlah: s.ratio.total, nominal: null } },
          ],
        },
      ],
      notes: ['Umur dihitung dari tanggal transfer uang muka pertama (hari kalender, WITA). Batas diatur di Setting perusahaan › Batas LPJ.'],
      next: null,
      count: s.rows.length,
    }
  },
  async filters(req, scope, sp) {
    return [...(await dateFields(req, sp)), sel('project', 'Project', sp, await projectOptions(req, scope)), sel('pusat', 'Pusat biaya', sp, await costCenterOptions(req, scope))]
  },
  fileStem(ctx) {
    return `kelengkapan_${ctx.today}`
  },
}

// ================================================================ biaya-kendaraan (K-14)

const biayaKendaraan: ReportDef = {
  code: 'biaya-kendaraan',
  title: 'Biaya per Kendaraan',
  kpi: 'K-14',
  description: 'Baris pengajuan yang sudah ditransfer + kas keluar manual per kendaraan (versi dasar; nota terverifikasi di F5).',
  roles: ['pk-finance', 'pk-owner', 'pk-pm'],
  formats: ['csv', 'xlsx'],
  paged: false,
  pageSize: 2000,
  async run(req, scope, sp) {
    const ctx = await reportContext(req)
    const r = dateRange(sp.get('dari'), sp.get('sampai'), ctx.today)
    const v = await vehicleCosts(req, scope, { from: r.from, to: r.to, vehicleId: idOf(sp, 'kendaraan'), categoryId: idOf(sp, 'kategori') })
    return {
      main: {
        key: 'kendaraan',
        title: 'Biaya per kendaraan',
        columns: [
          { key: 'plat', label: 'Plat', type: 'text', primary: true },
          { key: 'jenis', label: 'Jenis', type: 'text' },
          { key: 'pengajuan', label: 'Dari pengajuan (Rp)', type: 'money' },
          ...(v.includesManual ? [{ key: 'manual', label: 'Dari kas manual (Rp)', type: 'money' as const }] : []),
          { key: 'total', label: 'Total (Rp)', type: 'money', primary: true },
          { key: 'rincian', label: 'Rincian per kategori', type: 'text', width: 40 },
        ],
        rows: v.vehicles.map((x) => ({
          cells: {
            plat: x.plate,
            jenis: x.type,
            pengajuan: x.fromRequests,
            manual: x.fromManual,
            total: x.total,
            rincian: x.categories.map((c) => `${c.name} ${c.fromRequests + c.fromManual}`).join('; '),
          },
        })),
        totals: { plat: 'TOTAL', pengajuan: v.vehicles.reduce((s, x) => s + x.fromRequests, 0), manual: v.vehicles.reduce((s, x) => s + x.fromManual, 0), total: v.vehicles.reduce((s, x) => s + x.total, 0) },
        empty: 'Tidak ada biaya kendaraan untuk filter ini.',
      },
      extra: [],
      notes: [
        'Dari pengajuan = total baris yang menyebut kendaraan, pengajuan minimal "Ditransfer", periode = tanggal transfer pertama (Q-F3-8).',
        v.includesManual ? 'Dari kas manual = kas keluar manual dengan kendaraan (posted), periode = tanggal transaksi.' : 'Tanpa kas manual (cakupan tim PM).',
        'Laporan kendaraan berbasis nota terverifikasi tersedia di F5.',
      ],
      next: null,
      count: v.vehicles.length,
    }
  },
  async filters(req, _scope, sp) {
    return [...(await dateFields(req, sp)), sel('kendaraan', 'Kendaraan', sp, await vehicleOptions(req)), sel('kategori', 'Kategori', sp, await categoryOptions(req))]
  },
  fileStem(ctx, sp) {
    const r = dateRange(sp.get('dari'), sp.get('sampai'), ctx.today)
    return `biaya-kendaraan_${r.from}_${r.to}`
  },
}

// ================================================================ audit-log (K-16)

const show = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v))

const auditLog: ReportDef = {
  code: 'audit-log',
  title: 'Audit Log',
  kpi: 'K-16',
  description: 'Log aktivitas (hanya baca): siapa, kapan, apa, dari mana.',
  roles: ['pk-owner', 'pk-admin', 'pk-finance'],
  formats: ['csv', 'xlsx'],
  paged: true,
  pageSize: AUDIT_PAGE,
  async run(req, _scope, sp, page) {
    const ctx = await reportContext(req)
    const f: AuditFilter = parseAuditFilter(sp, ctx.today)
    const [p, count] = await inSequence(() => auditLogPage(req, f, page), () => auditLogCount(req, f))
    return {
      main: {
        key: 'audit',
        title: 'Aktivitas',
        columns: [
          { key: 'waktu', label: 'Waktu (WITA)', type: 'datetime', primary: true },
          { key: 'user', label: 'User', type: 'text', primary: true },
          { key: 'peran', label: 'Peran', type: 'text' },
          { key: 'aksi', label: 'Aksi', type: 'text', primary: true },
          { key: 'jenis', label: 'Jenis dokumen', type: 'text' },
          { key: 'dokumen', label: 'Dokumen', type: 'text', primary: true },
          { key: 'field', label: 'Field', type: 'text' },
          { key: 'lama', label: 'Nilai lama', type: 'text', width: 30 },
          { key: 'baru', label: 'Nilai baru', type: 'text', width: 30 },
          { key: 'alasan', label: 'Alasan', type: 'text' },
          { key: 'sumber', label: 'Sumber', type: 'text' },
          { key: 'versi', label: 'Versi app', type: 'text' },
          { key: 'ip', label: 'IP', type: 'text' },
          { key: 'perangkat', label: 'ID perangkat', type: 'text' },
          { key: 'requestId', label: 'Request ID', type: 'text' },
        ],
        rows: p.rows.map((x) => ({
          cells: {
            waktu: x.localTime,
            user: x.userName ?? (x.userId === null ? 'sistem' : `user#${x.userId}`),
            peran: x.userRoles ?? '',
            aksi: x.action,
            jenis: x.docType,
            dokumen: x.docNo ?? x.docId ?? '',
            field: [x.field, x.lineNo !== null ? `baris ${x.lineNo}` : null].filter(Boolean).join(' · '),
            lama: x.statusFrom ?? show(x.oldValue),
            baru: x.statusTo ?? show(x.newValue),
            alasan: x.reason ?? '',
            sumber: x.source ?? '',
            versi: x.appVersion ?? '',
            ip: x.ip ?? '',
            perangkat: x.deviceId ?? '',
            requestId: x.requestId ?? '',
          },
          href: x.docType === 'expense_request' && x.docId && /^\d+$/.test(x.docId) ? `/admin/collections/expense-requests/${x.docId}/riwayat` : undefined,
        })),
        empty: 'Tidak ada aktivitas untuk filter ini.',
      },
      extra: [],
      notes: [`Rentang ${fmtDate(f.from)}–${fmtDate(f.to)} (WITA). Hanya baca; membuka dan mengekspor log dicatat sebagai aktivitas "export".`],
      next: p.next,
      count,
    }
  },
  async filters(req, _scope, sp) {
    const ctx = await reportContext(req)
    const f = parseAuditFilter(sp, ctx.today)
    const { auditFilterOptions } = await import('./audit-log')
    const { AUDIT_ACTIONS } = await import('@/audit/writer')
    const o = await auditFilterOptions(req)
    return [
      { name: 'dari', label: 'Dari', kind: 'date', value: f.from },
      { name: 'sampai', label: 'Sampai', kind: 'date', value: f.to },
      sel('user', 'User', sp, o.users),
      sel('jenis', 'Jenis dokumen', sp, o.docTypes),
      sel(
        'aksi',
        'Aksi',
        sp,
        AUDIT_ACTIONS.map((a) => ({ value: a, label: a })),
      ),
      { name: 'nodok', label: 'No. dokumen (awalan)', kind: 'text', value: sp.get('nodok') ?? '' },
      sel(
        'sumber',
        'Sumber',
        sp,
        AUDIT_SOURCES.map((s) => ({ value: s, label: s })),
      ),
    ]
  },
  fileStem(ctx, sp) {
    const f = parseAuditFilter(sp, ctx.today)
    return `audit-log_${f.from}_${f.to}`
  },
}

export const REPORTS: ReportDef[] = [rekapKas, bukuKas, pengeluaranKategori, anggaranProject, rekapPengajuan, kelengkapan, biayaKendaraan, absensiReport]
export const AUDIT_REPORT = auditLog
export const ALL_REPORTS: ReportDef[] = [...REPORTS, auditLog]
export const REPORT_CODES = ALL_REPORTS.map((r) => r.code)

export function reportByCode(code: string): ReportDef | undefined {
  return ALL_REPORTS.find((r) => r.code === code)
}

export { formatPct, includesManualCash }
