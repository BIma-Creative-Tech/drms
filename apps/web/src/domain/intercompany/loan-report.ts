import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { docLink } from '@/admin/doc-links'
import { reportContext, rows } from '@/domain/reports/kpi'
import type { ReportDef, ReportResult } from '@/domain/reports/registry'
import { ledgerCompanies, roleScope, type ReportScope } from '@/domain/reports/scope'
import { DEFAULT_TZ } from '@/lib/time'

import { IC_LOAN_STATUS_LABELS, IC_LOAN_STATUSES, IC_OVERDUE_LABEL, type IcLoanStatus } from './loan-rules'

/**
 * ADR 0029 §3.9 report "Pinjaman antar-PT" (Keuangan → Laporan, D8 table + CSV / XLSX / PDF): one row per loan AND side
 * of the caller's scope — a loan between two PTs the caller reads appears once as "Pemberi (piutang)" in the lender PT
 * and once as "Penerima (hutang)" in the borrower PT, so the per-PT subtotals are the PT's *Piutang antar-PT* and *Hutang
 * antar-PT* outstanding. Scope: Finance / Direktur (Owner) / Admin of the PT (`all`). Overdue is derived on the
 * borrower's clock. Raw SQL over `intercompany_loans` (never in spending(), RAP or budget figures).
 */
export const icLoanReportScope = (req: PayloadRequest): Promise<ReportScope> => roleScope(req, ['pk-finance', 'pk-owner', 'pk-admin'])

const TODAY_B = sql`to_char(now() AT TIME ZONE coalesce(nullif(cb.timezone, ''), ${DEFAULT_TZ}), 'YYYY-MM-DD')`
const OVERDUE = sql`(l.status IN ('disbursed', 'partially_repaid') AND l.amount > l.repaid_total AND l.due_date < ${TODAY_B})`
const OUTSTANDING = sql`(CASE WHEN l.status IN ('disbursed', 'partially_repaid', 'repaid') THEN l.amount - l.repaid_total ELSE 0 END)`

export type IcLoanReportFilter = { role?: 'lender' | 'borrower'; statuses?: IcLoanStatus[]; overdue?: boolean; q?: string }

type Raw = {
  id: number
  side: 'lender' | 'borrower'
  company_id: number
  doc_no: string
  instruction_date: string
  due_date: string
  status: IcLoanStatus
  amount: string
  repaid_total: string
  outstanding: string
  overdue: boolean
  days: number | null
  lcode: string
  lname: string
  bcode: string
  bname: string
}

/** Rows (loan × side in scope), newest first. */
export async function icLoanReportRows(req: PayloadRequest, scope: ReportScope, f: IcLoanReportFilter): Promise<Raw[]> {
  const pts = ledgerCompanies(scope)
  if (pts.length === 0) return []
  const ids = sql.join(
    pts.map((c) => sql`${c}`),
    sql`, `,
  )
  const parts: Array<ReturnType<typeof sql>> = [sql`TRUE`]
  if (f.statuses?.length) parts.push(sql`l.status IN (${sql.join(f.statuses.map((s) => sql`${s}`), sql`, `)})`)
  if (f.overdue) parts.push(OVERDUE)
  for (const t of (f.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5)) {
    const like = `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    parts.push(sql`(l.doc_no ILIKE ${like} OR l.reason ILIKE ${like} OR cl.short_code ILIKE ${like} OR cb.short_code ILIKE ${like})`)
  }
  const sides = [
    ...(f.role !== 'borrower' ? [sql`SELECT 'lender' AS side, l.lender_company_id AS company_id, l.* FROM intercompany_loans l WHERE l.lender_company_id IN (${ids})`] : []),
    ...(f.role !== 'lender' ? [sql`SELECT 'borrower' AS side, l.borrower_company_id AS company_id, l.* FROM intercompany_loans l WHERE l.borrower_company_id IN (${ids})`] : []),
  ]
  return rows<Raw>(
    req,
    sql`SELECT l.id, l.side, l.company_id, l.doc_no, l.instruction_date, l.due_date, l.status, l.amount, l.repaid_total, ${OUTSTANDING} AS outstanding,
               ${OVERDUE} AS overdue, (${TODAY_B}::date - l.due_date::date) AS days,
               cl.short_code AS lcode, cl.name AS lname, cb.short_code AS bcode, cb.name AS bname
          FROM (${sql.join(sides, sql` UNION ALL `)}) l
          JOIN companies cl ON cl.id = l.lender_company_id JOIN companies cb ON cb.id = l.borrower_company_id
         WHERE ${sql.join(parts, sql` AND `)}
         ORDER BY l.id DESC, l.side`,
  )
}

/** Per-PT outstanding (dashboard card "Hutang / piutang antar-PT"): piutang = as lender, hutang = as borrower. */
export async function icLoanPositions(req: PayloadRequest, scope: ReportScope): Promise<Array<{ companyId: number; receivable: number; payable: number; overdue: number; instructed: number }>> {
  const r = await icLoanReportRows(req, scope, {})
  const out = new Map<number, { companyId: number; receivable: number; payable: number; overdue: number; instructed: number }>()
  for (const x of r) {
    const c = Number(x.company_id)
    const acc = out.get(c) ?? { companyId: c, receivable: 0, payable: 0, overdue: 0, instructed: 0 }
    const o = Number(x.outstanding)
    if (x.side === 'lender') acc.receivable += o
    else acc.payable += o
    if (x.overdue) acc.overdue += o
    if (x.status === 'instructed' && x.side === 'lender') acc.instructed += Number(x.amount)
    out.set(c, acc)
  }
  return [...out.values()].sort((a, b) => a.companyId - b.companyId)
}

const statusesOf = (sp: URLSearchParams): IcLoanStatus[] => [...new Set(sp.getAll('status').flatMap((s) => s.split(',')).filter((s): s is IcLoanStatus => (IC_LOAN_STATUSES as readonly string[]).includes(s)))]

export function icLoanReportFilter(sp: URLSearchParams): IcLoanReportFilter {
  const peran = sp.get('peran')
  return { role: peran === 'pemberi' ? 'lender' : peran === 'penerima' ? 'borrower' : undefined, statuses: statusesOf(sp), overdue: sp.get('terlambat') === 'ya', q: (sp.get('q') ?? '').slice(0, 100) }
}

export const icLoanHrefOf = (id: number) => `/admin/pinjaman-antar-pt/detail/${id}`

export const pinjamanAntarPtReport: ReportDef = {
  code: 'pinjaman-antar-pt',
  title: 'Pinjaman antar-PT',
  kpi: 'ADR 0029',
  description: 'Pinjaman antar-PT (PJA) per dokumen dan sisi PT: pemberi (piutang antar-PT) / penerima (hutang antar-PT), nilai, sudah kembali, sisa, jatuh tempo, terlambat.',
  roles: ['pk-finance', 'pk-owner', 'pk-admin'],
  formats: ['csv', 'xlsx', 'pdf'],
  paged: false,
  pageSize: 1000,
  scope: icLoanReportScope,
  async run(req, scope, sp): Promise<ReportResult> {
    const f = icLoanReportFilter(sp)
    const list = await icLoanReportRows(req, scope, f)
    const byPt = new Map<number, { receivable: number; payable: number; overdue: number }>()
    for (const x of list) {
      const acc = byPt.get(Number(x.company_id)) ?? { receivable: 0, payable: 0, overdue: 0 }
      if (x.side === 'lender') acc.receivable += Number(x.outstanding)
      else acc.payable += Number(x.outstanding)
      if (x.overdue) acc.overdue += Number(x.outstanding)
      byPt.set(Number(x.company_id), acc)
    }
    const codeOf = new Map(list.flatMap((x) => [[Number(x.company_id), x.side === 'lender' ? x.lcode : x.bcode] as [number, string]]))
    return {
      main: {
        key: 'pinjaman-antar-pt',
        title: 'Pinjaman antar-PT',
        columns: [
          { key: 'nomor', label: 'Nomor', type: 'text', primary: true },
          { key: 'tanggal', label: 'Tanggal perintah', type: 'date' },
          { key: 'pemberi', label: 'PT pemberi', type: 'text', primary: true },
          { key: 'penerima', label: 'PT peminjam', type: 'text', primary: true },
          { key: 'peran', label: 'Peran', type: 'text' },
          { key: 'nilai', label: 'Nilai (Rp)', type: 'money', primary: true },
          { key: 'kembali', label: 'Sudah kembali (Rp)', type: 'money' },
          { key: 'piutang', label: 'Piutang antar-PT (Rp)', type: 'money', primary: true },
          { key: 'hutang', label: 'Hutang antar-PT (Rp)', type: 'money', primary: true },
          { key: 'jatuhTempo', label: 'Jatuh tempo', type: 'date' },
          { key: 'status', label: 'Status', type: 'text', primary: true },
          { key: 'hariTerlambat', label: 'Hari terlambat', type: 'int' },
        ],
        rows: list.map((x) => ({
          cells: {
            nomor: x.doc_no,
            tanggal: x.instruction_date,
            pemberi: `${x.lcode} ${x.lname}`,
            penerima: `${x.bcode} ${x.bname}`,
            peran: x.side === 'lender' ? 'Pemberi (piutang)' : 'Peminjam (hutang)',
            nilai: Number(x.amount),
            kembali: Number(x.repaid_total),
            piutang: x.side === 'lender' ? Number(x.outstanding) : 0,
            hutang: x.side === 'borrower' ? Number(x.outstanding) : 0,
            jatuhTempo: x.due_date,
            status: x.overdue ? `${IC_LOAN_STATUS_LABELS[x.status]} · ${IC_OVERDUE_LABEL}` : IC_LOAN_STATUS_LABELS[x.status],
            hariTerlambat: x.overdue ? Number(x.days ?? 0) : null,
          },
          href: icLoanHrefOf(Number(x.id)),
          links: docLink('nomor', 'intercompany_loan', Number(x.id)),
          company: Number(x.company_id),
        })),
        totals: { nomor: `TOTAL (${list.length} baris)`, piutang: list.reduce((s, x) => s + (x.side === 'lender' ? Number(x.outstanding) : 0), 0), hutang: list.reduce((s, x) => s + (x.side === 'borrower' ? Number(x.outstanding) : 0), 0) },
        empty: 'Tidak ada pinjaman antar-PT untuk filter ini.',
      },
      extra: [
        {
          key: 'posisi-pt',
          title: 'Posisi per PT (sisa)',
          columns: [
            { key: 'pt', label: 'PT', type: 'text', primary: true },
            { key: 'piutang', label: 'Piutang antar-PT (Rp)', type: 'money', primary: true },
            { key: 'hutang', label: 'Hutang antar-PT (Rp)', type: 'money', primary: true },
            { key: 'terlambat', label: 'Terlambat (Rp)', type: 'money' },
          ],
          rows: [...byPt.entries()].sort(([a], [b]) => a - b).map(([c, v]) => ({ cells: { pt: codeOf.get(c) ?? `#${c}`, piutang: v.receivable, hutang: v.payable, terlambat: v.overdue } })),
          empty: 'Belum ada pinjaman antar-PT.',
        },
      ],
      notes: [
        'Pinjaman antar-PT = uang nyata antar PT grup (KK di PT pembayar + KM otomatis "Antar PT" di PT penerima, ADR 0029). Tanpa bunga; bukan biaya — tidak masuk realisasi, RAP, maupun anggaran project.',
        `Sisa dihitung sejak dicairkan; "Menunggu pencairan" belum menjadi piutang / hutang. ${IC_OVERDUE_LABEL} = jatuh tempo lewat (tanggal PT peminjam) dan masih ada sisa.`,
      ],
      next: null,
      count: list.length,
    }
  },
  async filters(_req, _scope, sp) {
    return [
      { name: 'q', label: 'Cari', kind: 'text', value: sp.get('q') ?? '' },
      { name: 'peran', label: 'Peran PT', kind: 'select', options: [{ value: 'pemberi', label: 'Pemberi (piutang)' }, { value: 'penerima', label: 'Peminjam (hutang)' }], value: sp.get('peran') ?? '' },
      { name: 'status', label: 'Status', kind: 'multiselect', options: IC_LOAN_STATUSES.map((s) => ({ value: s, label: IC_LOAN_STATUS_LABELS[s] })), value: statusesOf(sp) },
      { name: 'terlambat', label: 'Terlambat saja', kind: 'select', options: [{ value: 'ya', label: 'Ya' }], value: sp.get('terlambat') ?? '' },
    ]
  },
  fileStem(ctx) {
    return `pinjaman-antar-pt_${ctx.today}`
  },
}

/** Dashboard card data: per-PT positions + the PT's "Dana tersedia" (Owner / Direktur dashboards, §3.9). */
export async function icLoanDashboard(req: PayloadRequest) {
  const scope = await icLoanReportScope(req)
  const ctx = await reportContext(req)
  return { positions: await icLoanPositions(req, scope), today: ctx.today }
}
