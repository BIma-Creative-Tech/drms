import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { mayReadRates } from '@/domain/field/access'
import { ACTIVITY_KIND_LABELS, addDays, availabilityPct, billingEstimate, contractDaysInMonth, daysBetween, PO_STATUS_LABELS, round2, type ActivityKind, type PoStatus, type RateBasis } from '@/domain/field/rules'

import { reportContext, rows } from './kpi'
import type { Column, FilterField, Option, ReportDef, Table } from './registry'
import { dateRange, firstDay, lastDay, PERIOD_RE, periodLabel } from './rules'
import { attendanceOfficeScope, projectScopeSql, scopeCompanies, type ReportScope } from './scope'

/**
 * FR1 recaps (ADR 0020 §8, plan B/A2): registry reports with the same filters/scope on screen, JSON,
 * CSV/XLSX/PDF. Scope: Admin/Direktur/Finance all projects of their PTs, PM team projects
 * (attendanceOfficeScope). Contract rates, billing ESTIMATES and aftersales values only for rows of
 * PTs where the caller is Direktur/Finance/Admin (else the cells are empty and the columns are
 * omitted when no row may show them). The billing estimate is NOT an invoice.
 */
const idOf = (sp: URLSearchParams, name: string): number | undefined => {
  const v = sp.get(name) ?? ''
  return /^\d{1,10}$/.test(v) && Number(v) > 0 ? Number(v) : undefined
}
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const sel = (name: string, label: string, sp: URLSearchParams, options: Option[]): FilterField => ({ name, label, kind: 'select', options, value: sp.get(name) ?? '' })

function monthOf(sp: URLSearchParams, today: string): string {
  const m = sp.get('bulan') ?? ''
  return PERIOD_RE.test(m) && m <= today.slice(0, 7) ? m : today.slice(0, 7)
}

async function kindProjects(req: PayloadRequest, scope: ReportScope, kind: 'kontrak_unit' | 'aftersales'): Promise<Option[]> {
  const multi = scopeCompanies(scope).length > 1
  const r = await rows(req, sql`SELECT p.id, p.company_id, p.code, p.name, c.short_code FROM projects p JOIN companies c ON c.id = p.company_id WHERE ${projectScopeSql(scope)} AND p.kind = ${kind} ORDER BY p.code, p.company_id`)
  return r.map((x) => ({ value: String(x.id), label: `${multi ? `[${x.short_code}] ` : ''}${x.code} ${x.name}` }))
}

// ================================================================ rekap-timesheet-kontrak

type ContractAgg = {
  id: number
  company_id: number
  project_id: number
  code: string
  pname: string
  unit_code: string | null
  plate: string | null
  type: string | null
  start_date: string
  end_date: string | null
  rate_basis: RateBasis
  rate: string | number | null
  min_hours: string | number | null
  days: number
  work: string | number | null
  standby: string | number | null
  breakdown: string | number | null
  hm_used: string | number | null
  gaps: number
}

export const rekapTimesheetKontrak: ReportDef = {
  code: 'rekap-timesheet-kontrak',
  title: 'Rekap Timesheet Kontrak Unit',
  kpi: 'FR1',
  description: 'Per unit kontrak per bulan: HM, jam kerja/standby/breakdown, ketersediaan, hari tanpa timesheet, dan estimasi tagihan (Direktur/Finance/Admin) — estimasi, bukan invoice.',
  roles: ['pk-owner', 'pk-finance', 'pk-pm', 'pk-admin'],
  formats: ['csv', 'xlsx', 'pdf'],
  paged: false,
  pageSize: 500,
  scope: attendanceOfficeScope,
  async run(req, scope, sp) {
    const ctx = await reportContext(req)
    const month = monthOf(sp, ctx.today)
    const from = firstDay(month)
    const to = lastDay(month)
    const projectId = idOf(sp, 'project')
    const r = await rows<ContractAgg>(
      req,
      sql`SELECT cu.id, cu.company_id, cu.project_id, p.code, p.name AS pname, v.unit_code, coalesce(v.plate_display, v.plate_no) AS plate, v.type,
                 cu.start_date, cu.end_date, cu.rate_basis::text AS rate_basis, cu.rate, cu.min_hours_per_month AS min_hours,
                 count(t.id)::int AS days, sum(t.work_hours) AS work, sum(t.standby_hours) AS standby, sum(t.breakdown_hours) AS breakdown,
                 sum(t.hm_end - t.hm_start) AS hm_used, count(t.id) FILTER (WHERE t.flags ? 'HM_GAP')::int AS gaps
            FROM contract_units cu
            JOIN projects p ON p.id = cu.project_id
            JOIN vehicles v ON v.id = cu.unit_id
            LEFT JOIN unit_timesheets t ON t.contract_unit_id = cu.id AND t.report_date >= ${from} AND t.report_date <= ${to}
           WHERE ${projectScopeSql(scope)} AND p.kind = 'kontrak_unit'
             AND cu.start_date <= ${to} AND coalesce(cu.end_date, '9999-12-31') >= ${from}
             ${projectId !== undefined ? sql`AND p.id = ${projectId}` : sql``}
           GROUP BY cu.id, p.code, p.name, v.unit_code, v.plate_display, v.plate_no, v.type
          HAVING bool_or(coalesce(cu.active, true)) OR count(t.id) > 0
           ORDER BY p.code, v.unit_code NULLS LAST, cu.id`,
    )
    const until = to < ctx.today ? to : ctx.today
    const anyRates = r.some((x) => mayReadRates(req, Number(x.company_id)))
    const columns: Column[] = [
      { key: 'project', label: 'Project', type: 'text', primary: true },
      { key: 'unit', label: 'Unit', type: 'text', primary: true },
      { key: 'kontrak', label: 'Periode kontrak', type: 'text' },
      { key: 'hariKontrak', label: 'Hari kontrak', type: 'int' },
      { key: 'hariTs', label: 'Hari timesheet', type: 'int' },
      { key: 'tanpaTs', label: 'Hari tanpa timesheet', type: 'int', primary: true },
      { key: 'hm', label: 'Total HM', type: 'int' },
      { key: 'kerja', label: 'Jam kerja', type: 'int', primary: true },
      { key: 'standby', label: 'Jam standby', type: 'int' },
      { key: 'breakdown', label: 'Jam breakdown', type: 'int' },
      { key: 'pctAvail', label: 'Ketersediaan (%)', type: 'pct', primary: true },
      { key: 'selisihHm', label: 'Selisih HM (hari)', type: 'int' },
      ...(anyRates
        ? [
            { key: 'dasar', label: 'Dasar tarif', type: 'text' as const },
            { key: 'tarif', label: 'Tarif (Rp)', type: 'money' as const },
            { key: 'jamTagih', label: 'Jam ditagih', type: 'int' as const },
            { key: 'estimasi', label: 'Estimasi tagihan (Rp)', type: 'money' as const, primary: true },
          ]
        : []),
    ]
    const tableRows = r.map((x) => {
      const company = Number(x.company_id)
      const work = round2(n(x.work))
      const standby = round2(n(x.standby))
      const breakdown = round2(n(x.breakdown))
      const span = contractDaysInMonth({ startDate: x.start_date, endDate: x.end_date }, month)
      const covered = span.from && span.to && span.from <= until ? daysBetween(span.from, span.to < until ? span.to : until) + 1 : 0
      const rates = mayReadRates(req, company)
      const est = rates && x.rate !== null ? billingEstimate({ rateBasis: x.rate_basis, rate: n(x.rate), minHoursPerMonth: x.min_hours === null ? null : n(x.min_hours), startDate: x.start_date, endDate: x.end_date }, month, work) : null
      return {
        company,
        href: `/admin/unit-kontrak/kontrak/${x.project_id}?tab=timesheet&bulan=${month}`,
        cells: {
          project: `${x.code} ${x.pname}`,
          unit: [x.unit_code, x.plate].filter(Boolean).join(' · ') || x.type || `#${x.id}`,
          kontrak: `${x.start_date} – ${x.end_date ?? 'berjalan'}`,
          hariKontrak: span.contractDays,
          hariTs: x.days,
          tanpaTs: Math.max(0, covered - x.days),
          hm: round2(n(x.hm_used)),
          kerja: work,
          standby,
          breakdown,
          pctAvail: availabilityPct(work, standby, breakdown),
          selisihHm: x.gaps,
          ...(anyRates
            ? { dasar: rates ? (x.rate_basis === 'per_bulan' ? 'per bulan' : 'per jam') : null, tarif: rates ? n(x.rate) : null, jamTagih: est?.billableHours ?? null, estimasi: est?.amount ?? null }
            : {}),
        },
      }
    })
    const sum = (k: string) => round2(tableRows.reduce((a, t) => a + (typeof t.cells[k as keyof typeof t.cells] === 'number' ? (t.cells[k as keyof typeof t.cells] as number) : 0), 0))
    const main: Table = {
      key: 'unit',
      title: `Timesheet kontrak ${periodLabel(month)}`,
      columns,
      rows: tableRows,
      totals: { project: 'TOTAL', hariTs: sum('hariTs'), tanpaTs: sum('tanpaTs'), hm: sum('hm'), kerja: sum('kerja'), standby: sum('standby'), breakdown: sum('breakdown'), ...(anyRates ? { estimasi: sum('estimasi') } : {}) },
      empty: 'Belum ada unit kontrak aktif di bulan ini dalam cakupan Anda.',
    }
    const detail = await rows(
      req,
      sql`SELECT t.id, t.company_id, t.report_date, p.code, v.unit_code, coalesce(v.plate_display, v.plate_no) AS plate, t.hm_start, t.hm_end, t.work_hours, t.standby_hours, t.breakdown_hours,
                 t.breakdown_reason, t.operator_name, t.flags
            FROM unit_timesheets t JOIN projects p ON p.id = t.project_id JOIN vehicles v ON v.id = t.unit_id
           WHERE ${projectScopeSql(scope)} AND t.report_date >= ${from} AND t.report_date <= ${to}
             ${projectId !== undefined ? sql`AND p.id = ${projectId}` : sql``}
           ORDER BY t.report_date, p.code, v.unit_code NULLS LAST, t.id`,
    )
    const extra: Table = {
      key: 'harian',
      title: 'Rincian timesheet harian',
      columns: [
        { key: 'tanggal', label: 'Tanggal', type: 'date', primary: true },
        { key: 'project', label: 'Project', type: 'text' },
        { key: 'unit', label: 'Unit', type: 'text', primary: true },
        { key: 'hmAwal', label: 'HM awal', type: 'int' },
        { key: 'hmAkhir', label: 'HM akhir', type: 'int' },
        { key: 'kerja', label: 'Kerja', type: 'int' },
        { key: 'standby', label: 'Standby', type: 'int' },
        { key: 'breakdown', label: 'Breakdown', type: 'int' },
        { key: 'alasan', label: 'Alasan breakdown', type: 'text', width: 30 },
        { key: 'operator', label: 'Operator', type: 'text' },
        { key: 'tanda', label: 'Tanda', type: 'text' },
      ],
      rows: detail.map((x) => ({
        company: Number(x.company_id),
        href: `/admin/unit-kontrak/timesheet/detail/${x.id}`,
        cells: {
          tanggal: String(x.report_date),
          project: String(x.code),
          unit: [x.unit_code, x.plate].filter(Boolean).join(' · '),
          hmAwal: n(x.hm_start),
          hmAkhir: n(x.hm_end),
          kerja: n(x.work_hours),
          standby: n(x.standby_hours),
          breakdown: n(x.breakdown_hours),
          alasan: (x.breakdown_reason as string | null) ?? null,
          operator: (x.operator_name as string | null) ?? null,
          tanda: Array.isArray(x.flags) ? (x.flags as string[]).join(', ') : null,
        },
      })),
      empty: 'Belum ada timesheet.',
    }
    return {
      main,
      extra: [extra],
      notes: [
        `Periode ${periodLabel(month)}; hari tanpa timesheet dihitung s/d ${until} untuk hari yang tercakup kontrak.`,
        'Ketersediaan = (jam kerja + standby) / (jam kerja + standby + breakdown).',
        ...(anyRates
          ? ['ESTIMASI, BUKAN INVOICE: per jam = tarif × maks(jam kerja, minimum jam; minimum diprorata bila kontrak tidak sebulan penuh); per bulan = tarif × hari kontrak / hari dalam bulan. Invoice resmi dibuat di luar aplikasi.']
          : ['Tarif dan estimasi tagihan hanya terlihat oleh Direktur, Finance, dan Admin.']),
      ],
      next: null,
      count: tableRows.length,
    }
  },
  async filters(req, scope, sp) {
    const ctx = await reportContext(req)
    return [{ name: 'bulan', label: 'Bulan', kind: 'month', value: monthOf(sp, ctx.today) }, sel('project', 'Project', sp, await kindProjects(req, scope, 'kontrak_unit'))]
  },
  fileStem(ctx, sp) {
    return `rekap-timesheet-kontrak_${monthOf(sp, ctx.today)}`
  },
}

// ================================================================ rekap-aftersales

/** Monday of the week of `today` (business dates). */
export function weekStart(today: string): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 // 0 = Monday
  return addDays(today, -dow)
}

function rangeOf(sp: URLSearchParams, today: string): { from: string; to: string } {
  if (!sp.get('dari') && !sp.get('sampai')) return { from: weekStart(today), to: today }
  return dateRange(sp.get('dari'), sp.get('sampai'), today)
}

type ClientAgg = {
  client_id: number
  company_id: number
  name: string
  penawaran: number
  po: number
  pengiriman: number
  penagihan: number
  kunjungan: number
  lainnya: number
  terkirim: number
  sebagian: number
  belum: number
  batal: number
  nilai_po: string | number | null
}

export const rekapAftersales: ReportDef = {
  code: 'rekap-aftersales',
  title: 'Rekap Aftersales',
  kpi: 'FR1',
  description: 'Per pelanggan: penawaran, PO masuk vs terkirim vs belum kirim, pengiriman, penagihan, kunjungan; PO terbuka dengan umurnya; follow-up penawaran jatuh tempo. Nilai hanya untuk Direktur/Finance/Admin.',
  roles: ['pk-owner', 'pk-finance', 'pk-pm', 'pk-admin'],
  formats: ['csv', 'xlsx', 'pdf'],
  paged: false,
  pageSize: 500,
  scope: attendanceOfficeScope,
  async run(req, scope, sp) {
    const ctx = await reportContext(req)
    const { from, to } = rangeOf(sp, ctx.today)
    const projectId = idOf(sp, 'project')
    const pFilter = projectId !== undefined ? sql`AND p.id = ${projectId}` : sql``
    const r = await rows<ClientAgg>(
      req,
      sql`SELECT a.client_id, a.company_id, c.name,
                 count(*) FILTER (WHERE a.kind = 'penawaran')::int AS penawaran,
                 count(*) FILTER (WHERE a.kind = 'po_masuk')::int AS po,
                 count(*) FILTER (WHERE a.kind = 'pengiriman')::int AS pengiriman,
                 count(*) FILTER (WHERE a.kind = 'penagihan')::int AS penagihan,
                 count(*) FILTER (WHERE a.kind = 'kunjungan')::int AS kunjungan,
                 count(*) FILTER (WHERE a.kind = 'lainnya')::int AS lainnya,
                 count(*) FILTER (WHERE a.kind = 'po_masuk' AND a.po_status = 'terkirim')::int AS terkirim,
                 count(*) FILTER (WHERE a.kind = 'po_masuk' AND a.po_status = 'sebagian')::int AS sebagian,
                 count(*) FILTER (WHERE a.kind = 'po_masuk' AND a.po_status = 'belum_kirim')::int AS belum,
                 count(*) FILTER (WHERE a.kind = 'po_masuk' AND a.po_status = 'batal')::int AS batal,
                 sum(a.value) FILTER (WHERE a.kind = 'po_masuk' AND a.po_status <> 'batal') AS nilai_po
            FROM aftersales_activities a JOIN projects p ON p.id = a.project_id JOIN clients c ON c.id = a.client_id
           WHERE ${projectScopeSql(scope)} AND a.activity_date >= ${from} AND a.activity_date <= ${to} ${pFilter}
           GROUP BY a.client_id, a.company_id, c.name
           ORDER BY c.name, a.client_id`,
    )
    const anyValues = r.some((x) => mayReadRates(req, Number(x.company_id)))
    const main: Table = {
      key: 'pelanggan',
      title: `Aktivitas aftersales ${from} s/d ${to}`,
      columns: [
        { key: 'pelanggan', label: 'Pelanggan', type: 'text', primary: true },
        { key: 'penawaran', label: 'Penawaran', type: 'int' },
        { key: 'po', label: 'PO masuk', type: 'int', primary: true },
        { key: 'terkirim', label: 'PO terkirim', type: 'int', primary: true },
        { key: 'sebagian', label: 'PO sebagian', type: 'int' },
        { key: 'belum', label: 'PO belum kirim', type: 'int', primary: true },
        { key: 'batal', label: 'PO batal', type: 'int' },
        { key: 'pengiriman', label: 'Pengiriman', type: 'int' },
        { key: 'penagihan', label: 'Penagihan', type: 'int' },
        { key: 'kunjungan', label: 'Kunjungan', type: 'int' },
        ...(anyValues ? [{ key: 'nilai', label: 'Nilai PO (Rp)', type: 'money' as const, primary: true }] : []),
      ],
      rows: r.map((x) => ({
        company: Number(x.company_id),
        href: `/admin/aftersales/aktivitas?pelanggan=${x.client_id}&dari=${from}&sampai=${to}`,
        cells: {
          pelanggan: x.name,
          penawaran: x.penawaran,
          po: x.po,
          terkirim: x.terkirim,
          sebagian: x.sebagian,
          belum: x.belum,
          batal: x.batal,
          pengiriman: x.pengiriman,
          penagihan: x.penagihan,
          kunjungan: x.kunjungan,
          ...(anyValues ? { nilai: mayReadRates(req, Number(x.company_id)) && x.nilai_po !== null ? n(x.nilai_po) : null } : {}),
        },
      })),
      totals: {
        pelanggan: 'TOTAL',
        penawaran: r.reduce((a, x) => a + x.penawaran, 0),
        po: r.reduce((a, x) => a + x.po, 0),
        terkirim: r.reduce((a, x) => a + x.terkirim, 0),
        belum: r.reduce((a, x) => a + x.belum, 0),
        pengiriman: r.reduce((a, x) => a + x.pengiriman, 0),
      },
      empty: 'Belum ada aktivitas aftersales di rentang ini.',
    }
    const open = await rows(
      req,
      sql`SELECT a.id, a.company_id, a.activity_date, a.doc_no, a.po_status::text AS po_status, a.value, c.name AS client, p.code,
                 (SELECT count(*) FROM aftersales_activities d WHERE d.relates_to_id = a.id AND d.kind = 'pengiriman' AND d.company_id = a.company_id)::int AS deliveries
            FROM aftersales_activities a JOIN projects p ON p.id = a.project_id JOIN clients c ON c.id = a.client_id
           WHERE ${projectScopeSql(scope)} AND a.kind = 'po_masuk' AND a.po_status IN ('belum_kirim', 'sebagian') ${pFilter}
           ORDER BY a.activity_date, a.id`,
    )
    const due = await rows(
      req,
      sql`SELECT a.id, a.company_id, a.activity_date, a.follow_up_date, a.doc_no, c.name AS client, p.code
            FROM aftersales_activities a JOIN projects p ON p.id = a.project_id JOIN clients c ON c.id = a.client_id
           WHERE ${projectScopeSql(scope)} AND a.kind = 'penawaran' AND a.follow_up_date IS NOT NULL AND a.follow_up_date <= ${ctx.today}
             AND a.follow_up_date >= ${addDays(ctx.today, -60)} ${pFilter}
           ORDER BY a.follow_up_date, a.id`,
    )
    const openValues = open.some((x) => mayReadRates(req, Number(x.company_id)))
    return {
      main,
      extra: [
        {
          key: 'po-terbuka',
          title: `PO terbuka per ${ctx.today} (belum kirim / sebagian)`,
          columns: [
            { key: 'tanggal', label: 'Tanggal PO', type: 'date', primary: true },
            { key: 'pelanggan', label: 'Pelanggan', type: 'text', primary: true },
            { key: 'noPo', label: 'No. PO', type: 'text' },
            { key: 'project', label: 'Project', type: 'text' },
            { key: 'status', label: 'Status', type: 'text', primary: true },
            { key: 'kirim', label: 'Pengiriman', type: 'int' },
            { key: 'umur', label: 'Umur (hari)', type: 'int', primary: true },
            ...(openValues ? [{ key: 'nilai', label: 'Nilai (Rp)', type: 'money' as const }] : []),
          ],
          rows: open.map((x) => ({
            company: Number(x.company_id),
            href: `/admin/aftersales/aktivitas/detail/${x.id}`,
            ...(x.doc_no ? { links: { noPo: `/admin/aftersales/aktivitas/detail/${x.id}` } } : {}),
            cells: {
              tanggal: String(x.activity_date),
              pelanggan: String(x.client),
              noPo: (x.doc_no as string | null) ?? null,
              project: String(x.code),
              status: PO_STATUS_LABELS[x.po_status as PoStatus] ?? String(x.po_status),
              kirim: Number(x.deliveries),
              umur: Math.max(0, daysBetween(String(x.activity_date), ctx.today)),
              ...(openValues ? { nilai: mayReadRates(req, Number(x.company_id)) && x.value !== null ? n(x.value) : null } : {}),
            },
          })),
          empty: 'Tidak ada PO terbuka.',
        },
        {
          key: 'follow-up',
          title: 'Penawaran dengan follow-up jatuh tempo (60 hari terakhir)',
          columns: [
            { key: 'followUp', label: 'Follow-up', type: 'date', primary: true },
            { key: 'pelanggan', label: 'Pelanggan', type: 'text', primary: true },
            { key: 'noPenawaran', label: 'No. penawaran', type: 'text' },
            { key: 'tanggal', label: 'Tanggal penawaran', type: 'date' },
            { key: 'project', label: 'Project', type: 'text' },
          ],
          rows: due.map((x) => ({
            company: Number(x.company_id),
            href: `/admin/aftersales/aktivitas/detail/${x.id}`,
            ...(x.doc_no ? { links: { noPenawaran: `/admin/aftersales/aktivitas/detail/${x.id}` } } : {}),
            cells: { followUp: String(x.follow_up_date), pelanggan: String(x.client), noPenawaran: (x.doc_no as string | null) ?? null, tanggal: String(x.activity_date), project: String(x.code) },
          })),
          empty: 'Tidak ada follow-up jatuh tempo.',
        },
      ],
      notes: [
        `Rentang ${from} s/d ${to} (default: minggu berjalan, Senin s/d hari ini). Status PO = status saat ini dari PO yang masuk di rentang ini.`,
        `Jenis aktivitas: ${Object.values(ACTIVITY_KIND_LABELS).join(', ')}.`,
        anyValues || openValues ? 'Nilai PO hanya terlihat oleh Direktur, Finance, dan Admin.' : 'Nilai (Rp) hanya terlihat oleh Direktur, Finance, dan Admin.',
      ],
      next: null,
      count: r.length,
    }
  },
  async filters(req, scope, sp) {
    const ctx = await reportContext(req)
    const rg = rangeOf(sp, ctx.today)
    return [
      { name: 'dari', label: 'Dari', kind: 'date', value: rg.from },
      { name: 'sampai', label: 'Sampai', kind: 'date', value: rg.to },
      sel('project', 'Project', sp, await kindProjects(req, scope, 'aftersales')),
    ]
  },
  fileStem(ctx, sp) {
    const rg = rangeOf(sp, ctx.today)
    return `rekap-aftersales_${rg.from}_${rg.to}`
  },
}

export type { ActivityKind }
