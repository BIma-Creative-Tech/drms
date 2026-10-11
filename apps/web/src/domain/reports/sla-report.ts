import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { formatHours, measure, monthInTz, summarize, type SlaMeasure } from '@/domain/expense/sla'
import { REQUEST_TYPE_LABELS, type RequestType } from '@/domain/expense/types'
import { docLink } from '@/admin/doc-links'
import { DEFAULT_TZ } from '@/lib/time'

import { reportContext, rows } from './kpi'
import type { Column, ReportDef, ReportResult, TableRow } from './registry'
import { firstDay, formatPct, lastDay, monthRange, periodLabel } from './rules'
import { fromCompanies, officeScope, requestScopeSql, type ReportScope } from './scope'

/**
 * Item 11 (DRMS 10/10) "SLA transfer": final approval (`approved_at`) → bank transfer (`transfer_at`,
 * date + time of the proof) per PT and month (month of the transfer in the PT zone): count, average,
 * P90, % within the PT's `transfer_sla_hours`, plus the late transfers with links. Posted Uang Muka /
 * Reimburse transfers only (LPJ shortfall transfers are no approval → transfer step). A transfer without
 * a recorded time (old client) is measured to the time it was recorded and marked.
 * Scope: Finance / Direktur of the PT (no PM team view: SLA is an office KPI).
 */
export async function slaScope(req: PayloadRequest): Promise<ReportScope> {
  const s = await officeScope(req)
  return fromCompanies((s.companies ?? []).filter((c) => c.kind === 'all'))
}

type Raw = {
  transfer_id: number
  transfer_no: string | null
  transfer_at: string | null
  created_at: string
  request_id: number
  request_no: string | null
  title: string
  type: RequestType
  approved_at: string
  approved_local: string
  company_id: number
  sla_hours: number | string | null
  timezone: string | null
}

export type SlaRow = Raw & { m: SlaMeasure; month: string; slaHours: number }

/** Posted advance/reimburse transfers whose transfer date lies in [from, to], with their SLA measure. */
export async function slaRows(req: PayloadRequest, scope: ReportScope, from: string, to: string): Promise<SlaRow[]> {
  const r = await rows<Raw>(
    req,
    sql`SELECT t.id AS transfer_id, t.doc_no AS transfer_no, t.transfer_at, t.created_at, er.id AS request_id, er.doc_no AS request_no, er.title,
               er.type::text AS type, er.approved_at, to_char(er.approved_at AT TIME ZONE coalesce(c.timezone, ${DEFAULT_TZ}), 'YYYY-MM-DD HH24:MI') AS approved_local, t.company_id, c.transfer_sla_hours AS sla_hours, c.timezone
          FROM transfers t
          JOIN expense_requests er ON er.id = t.request_id
          JOIN companies c ON c.id = t.company_id
         WHERE t.status = 'posted' AND t.kind IN ('advance', 'reimburse') AND er.approved_at IS NOT NULL
           AND t.transfer_date >= ${from} AND t.transfer_date <= ${to} AND ${requestScopeSql(scope)}
         ORDER BY t.company_id, coalesce(t.transfer_at, t.created_at), t.id`,
  )
  return r.map((x) => {
    const slaHours = Number(x.sla_hours ?? 24)
    const m = measure({ approvedAt: new Date(x.approved_at), transferAt: x.transfer_at ? new Date(x.transfer_at) : null, recordedAt: new Date(x.created_at), slaHours })
    return { ...x, m, slaHours, month: monthInTz(m.effectiveAt, x.timezone || process.env.TZ || DEFAULT_TZ) }
  })
}

/** 'YYYY-MM-DD HH:MM' in the PT zone (report `datetime` cells). */
const localDateTime = (at: Date, tz: string) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at)
  const g = (t: string) => p.find((v) => v.type === t)?.value ?? '00'
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`
}

const hoursCell = (h: number | null) => (h === null ? null : Math.round(h * 10) / 10)

export function slaTables(list: SlaRow[], range: { from: string; to: string }): ReportResult {
  const groups = new Map<string, SlaRow[]>()
  for (const x of list) {
    const k = `${x.company_id}|${x.month}`
    groups.set(k, [...(groups.get(k) ?? []), x])
  }
  const columns: Column[] = [
    { key: 'bulan', label: 'Bulan', type: 'text', primary: true },
    { key: 'sla', label: 'SLA (jam)', type: 'text' },
    { key: 'jumlah', label: 'Jumlah transfer', type: 'int', primary: true },
    { key: 'rata', label: 'Rata-rata (jam)', type: 'text', primary: true },
    { key: 'p90', label: 'P90 (jam)', type: 'text' },
    { key: 'pctTepat', label: '% dalam SLA', type: 'pct', primary: true },
    { key: 'terlambat', label: 'Terlambat', type: 'int', primary: true },
  ]
  const summaryRows: TableRow[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, xs]) => {
      const s = summarize(xs.map((x) => x.m))
      const x0 = xs[0]!
      return {
        cells: { bulan: periodLabel(x0.month), sla: String(x0.slaHours), jumlah: s.count, rata: String(hoursCell(s.avgHours) ?? '—').replace('.', ','), p90: String(hoursCell(s.p90Hours) ?? '—').replace('.', ','), pctTepat: s.pctWithin, terlambat: s.late },
        company: x0.company_id,
      }
    })
  const late = list.filter((x) => x.m.late)
  const all = summarize(list.map((x) => x.m))
  return {
    main: {
      key: 'sla-bulan',
      title: `SLA transfer per bulan (${periodLabel(range.from.slice(0, 7))} – ${periodLabel(range.to.slice(0, 7))})`,
      columns,
      rows: summaryRows,
      totals: { bulan: 'TOTAL', jumlah: all.count, rata: String(hoursCell(all.avgHours) ?? '—').replace('.', ','), p90: String(hoursCell(all.p90Hours) ?? '—').replace('.', ','), pctTepat: all.pctWithin, terlambat: all.late },
      empty: 'Belum ada transfer pengajuan yang disetujui di periode ini.',
    },
    extra: [
      {
        key: 'terlambat',
        title: `Transfer melewati SLA (${late.length})`,
        columns: [
          { key: 'pengajuan', label: 'Pengajuan', type: 'text', primary: true },
          { key: 'judul', label: 'Judul', type: 'text', width: 32 },
          { key: 'jenis', label: 'Jenis', type: 'text' },
          { key: 'transfer', label: 'Transfer', type: 'text', primary: true },
          { key: 'disetujui', label: 'Disetujui', type: 'datetime' },
          { key: 'ditransfer', label: 'Ditransfer', type: 'datetime' },
          { key: 'durasi', label: 'Durasi', type: 'text', primary: true },
          { key: 'sla', label: 'SLA (jam)', type: 'int' },
          { key: 'catatan', label: 'Catatan', type: 'text' },
        ],
        rows: late.map((x) => ({
          cells: {
            pengajuan: x.request_no ?? `#${x.request_id}`,
            judul: x.title,
            jenis: REQUEST_TYPE_LABELS[x.type] ?? x.type,
            transfer: x.transfer_no ?? `#${x.transfer_id}`,
            disetujui: x.approved_local,
            ditransfer: localDateTime(x.m.effectiveAt, x.timezone || process.env.TZ || DEFAULT_TZ),
            durasi: formatHours(x.m.hours),
            sla: x.slaHours,
            catatan: x.m.timeKnown ? '' : 'Jam transfer tidak diketahui (waktu pencatatan)',
          },
          href: `/admin/collections/expense-requests/${x.request_id}`,
          // DRMS 10/10 12b: the request AND the TRF number open their documents
          links: { ...docLink('pengajuan', 'expense_request', x.request_id), ...docLink('transfer', 'transfer', x.transfer_id) },
          company: x.company_id,
        })),
        empty: 'Semua transfer dalam SLA. ✓',
      },
    ],
    notes: [
      'Durasi = disetujui final (server) → tanggal & jam transfer sesuai bukti; bulan = bulan transfer (zona PT). SLA per PT di Perusahaan (PT) › Operasional › SLA transfer.',
      'Hanya transfer Uang Muka / Reimburse yang masih berlaku (void tidak dihitung); P90 = 90% transfer selesai dalam durasi ini.',
      ...(list.some((x) => !x.m.timeKnown) ? ['Transfer lama tanpa jam (dicatat sebelum jam transfer wajib) diukur sampai waktu pencatatannya.'] : []),
    ],
    next: null,
    count: list.length,
  }
}

export const slaTransferReport: ReportDef = {
  code: 'sla-transfer',
  title: 'SLA Transfer',
  kpi: 'K-11b',
  description: 'Waktu dari pengajuan disetujui sampai ditransfer, per PT per bulan: jumlah, rata-rata, P90, % dalam SLA, daftar yang terlambat.',
  roles: ['pk-finance', 'pk-owner'],
  formats: ['csv', 'xlsx'],
  paged: false,
  pageSize: 5000,
  scope: slaScope,
  async run(req, scope, sp) {
    const ctx = await reportContext(req)
    const r = monthRange(sp.get('dari'), sp.get('sampai'), ctx.today, 3)
    const list = await slaRows(req, scope, firstDay(r.from), lastDay(r.to))
    return slaTables(list, { from: firstDay(r.from), to: lastDay(r.to) })
  },
  async filters(req, _scope, sp) {
    const ctx = await reportContext(req)
    const r = monthRange(sp.get('dari'), sp.get('sampai'), ctx.today, 3)
    return [
      { name: 'dari', label: 'Dari bulan', kind: 'month', value: r.from },
      { name: 'sampai', label: 'Sampai bulan', kind: 'month', value: r.to },
    ]
  },
  fileStem(ctx, sp) {
    const r = monthRange(sp.get('dari'), sp.get('sampai'), ctx.today, 3)
    return `sla-transfer_${r.from}_${r.to}`
  },
}

/** Dashboard KPI (Direktur / Finance): this month's SLA summary over the caller's office PTs. */
export async function slaThisMonth(req: PayloadRequest): Promise<{ month: string; count: number; pctWithin: number | null; avgHours: number | null; late: number; slaHours: number[]; text: string }> {
  const ctx = await reportContext(req)
  const scope = await slaScope(req)
  const list = await slaRows(req, scope, firstDay(ctx.month), lastDay(ctx.month))
  const s = summarize(list.map((x) => x.m))
  return { month: ctx.month, count: s.count, pctWithin: s.pctWithin, avgHours: s.avgHours, late: s.late, slaHours: [...new Set(list.map((x) => x.slaHours))], text: s.pctWithin === null ? '—' : `${formatPct(s.pctWithin)}%` }
}
