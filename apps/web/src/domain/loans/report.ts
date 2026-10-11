import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { docLink } from '@/admin/doc-links'
import { attendanceOfficeScope, projectScopeSql, type ReportScope, type SQL } from '@/domain/reports/scope'
import { reportContext, rows } from '@/domain/reports/kpi'
import type { ReportDef, ReportResult } from '@/domain/reports/registry'
import { DEFAULT_TZ } from '@/lib/time'

import { LOAN_KIND_LABELS, LOAN_STATUS_LABELS, LOAN_STATUSES, OVERDUE_LABEL, type LoanKind, type LoanStatus } from './rules'

/**
 * ADR 0022 §9: loan figures for the report "Pinjaman antar project", the dashboard card and the project tab. Raw SQL
 * over `project_loans` (the posted repayments are already folded into `repaid_total`, DB guard), scoped with
 * `projectScopeSql` on BOTH projects: office roles (Direktur / Admin / Finance) see their PTs, a PM the loans of his
 * team projects (as borrower or lender). Overdue ("Terlambat") is derived per PT clock.
 * Price visibility: Direktur / Admin / Finance / PM only (`loanScope` has no Staff / Operator entry).
 */

/** Admin / Direktur / Finance of the PT → all, PM → team (same builder as the attendance office scope). */
export const loanScope = (req: PayloadRequest): Promise<ReportScope> => attendanceOfficeScope(req)

/** `project_loans l` visible in the scope: borrower OR lender project in scope. */
export const loanScopeSql = (scope: ReportScope): SQL => sql`(${projectScopeSql(scope, 'pb')} OR ${projectScopeSql(scope, 'pl')})`

/** Today's business date of the loan's PT (`companies c`). */
const TODAY = sql`to_char(now() AT TIME ZONE coalesce(nullif(c.timezone, ''), ${DEFAULT_TZ}), 'YYYY-MM-DD')`
const OVERDUE = sql`(l.status::text IN ('approved', 'partially_repaid') AND l.amount > l.repaid_total AND l.due_date < ${TODAY})`
const ACTIVE = sql`l.status::text IN ('approved', 'partially_repaid', 'repaid')`

export type LoanRow = {
  id: number
  companyId: number
  docNo: string | null
  status: LoanStatus
  kind: LoanKind
  loanDate: string
  dueDate: string
  amount: number
  repaid: number
  outstanding: number
  overdue: boolean
  daysOverdue: number
  lender: { id: number; code: string; name: string }
  borrower: { id: number; code: string; name: string }
}

export type LoanReportFilter = { projectId?: number; statuses?: LoanStatus[]; overdue?: boolean; q?: string }

function where(scope: ReportScope, f: LoanReportFilter): SQL {
  const parts: SQL[] = [loanScopeSql(scope), sql`l.status::text <> 'draft'`]
  if (f.projectId) parts.push(sql`(l.borrower_project_id = ${f.projectId} OR l.lender_project_id = ${f.projectId})`)
  if (f.statuses?.length) parts.push(sql`l.status::text IN (${sql.join(f.statuses.map((s) => sql`${s}`), sql`, `)})`)
  if (f.overdue) parts.push(OVERDUE)
  for (const t of (f.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5)) {
    const like = `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    parts.push(sql`(l.doc_no ILIKE ${like} OR l.reason ILIKE ${like} OR pb.code ILIKE ${like} OR pb.name ILIKE ${like} OR pl.code ILIKE ${like} OR pl.name ILIKE ${like})`)
  }
  return sql.join(parts, sql` AND `)
}

const FROM = sql`project_loans l JOIN companies c ON c.id = l.company_id JOIN projects pb ON pb.id = l.borrower_project_id JOIN projects pl ON pl.id = l.lender_project_id`

type Raw = { id: number; company_id: number; doc_no: string | null; status: string; kind: string; loan_date: string; due_date: string; amount: string; repaid_total: string; overdue: boolean; days: number | null; lid: number; lcode: string; lname: string; bid: number; bcode: string; bname: string }

const toRow = (r: Raw): LoanRow => {
  const amount = Number(r.amount)
  const repaid = Number(r.repaid_total)
  const status = r.status as LoanStatus
  const active = status === 'approved' || status === 'partially_repaid' || status === 'repaid'
  return {
    id: Number(r.id),
    companyId: Number(r.company_id),
    docNo: r.doc_no,
    status,
    kind: r.kind as LoanKind,
    loanDate: r.loan_date,
    dueDate: r.due_date,
    amount,
    repaid,
    outstanding: active ? amount - repaid : status === 'pending_approval' ? amount : 0,
    overdue: r.overdue,
    daysOverdue: r.overdue ? Number(r.days ?? 0) : 0,
    lender: { id: Number(r.lid), code: r.lcode, name: r.lname },
    borrower: { id: Number(r.bid), code: r.bcode, name: r.bname },
  }
}

/** Submitted loans (no Draft) of the scope, newest first; keyset on id. */
export async function loanRows(req: PayloadRequest, scope: ReportScope, f: LoanReportFilter, page: { after?: number; limit: number }): Promise<LoanRow[]> {
  const r = await rows<Raw>(
    req,
    sql`SELECT l.id, l.company_id, l.doc_no, l.status::text AS status, l.kind::text AS kind, l.loan_date, l.due_date, l.amount, l.repaid_total,
               ${OVERDUE} AS overdue, (${TODAY}::date - l.due_date::date) AS days,
               pl.id AS lid, pl.code AS lcode, pl.name AS lname, pb.id AS bid, pb.code AS bcode, pb.name AS bname
          FROM ${FROM}
         WHERE ${where(scope, f)} ${page.after ? sql`AND l.id < ${page.after}` : sql``}
         ORDER BY l.id DESC LIMIT ${page.limit}`,
  )
  return r.map(toRow)
}

export type LoanTotals = { count: number; amount: number; repaid: number; outstanding: number; overdue: number; overdueCount: number; pending: number; byCompany: Array<{ companyId: number; count: number; amount: number; repaid: number; outstanding: number }> }

/** Totals over ALL pages of the same filter (approved and later count in the money figures). */
export async function loanTotals(req: PayloadRequest, scope: ReportScope, f: LoanReportFilter = {}): Promise<LoanTotals> {
  const r = await rows<{ company_id: number; n: number; amount: string | null; repaid: string | null; outstanding: string | null; overdue: string | null; overdue_n: number; pending: number }>(
    req,
    sql`SELECT l.company_id, count(*)::int AS n,
               coalesce(sum(l.amount) FILTER (WHERE ${ACTIVE}), 0) AS amount,
               coalesce(sum(l.repaid_total) FILTER (WHERE ${ACTIVE}), 0) AS repaid,
               coalesce(sum(l.amount - l.repaid_total) FILTER (WHERE ${ACTIVE}), 0) AS outstanding,
               coalesce(sum(l.amount - l.repaid_total) FILTER (WHERE ${OVERDUE}), 0) AS overdue,
               (count(*) FILTER (WHERE ${OVERDUE}))::int AS overdue_n,
               (count(*) FILTER (WHERE l.status::text = 'pending_approval'))::int AS pending
          FROM ${FROM}
         WHERE ${where(scope, f)}
         GROUP BY l.company_id ORDER BY l.company_id`,
  )
  const byCompany = r.map((x) => ({ companyId: Number(x.company_id), count: Number(x.n), amount: Number(x.amount), repaid: Number(x.repaid), outstanding: Number(x.outstanding) }))
  const sum = (k: keyof (typeof r)[number]) => r.reduce((a, x) => a + Number(x[k] ?? 0), 0)
  return { count: sum('n'), amount: sum('amount'), repaid: sum('repaid'), outstanding: sum('outstanding'), overdue: sum('overdue'), overdueCount: sum('overdue_n'), pending: sum('pending'), byCompany }
}

export type ProjectLoanFigures = {
  projectId: number
  companyId: number
  code: string
  name: string
  borrowed: number
  lent: number
  outstandingBorrowed: number
  outstandingLent: number
  overdueBorrowed: number
  overdueCount: number
}

/**
 * ADR 0022 §9 per-project summary: Σ amount as borrower / lender (approved and later), outstanding both ways, overdue
 * outstanding as borrower and the number of overdue loans (either side). Projects in the scope only.
 */
export async function projectLoanFigures(req: PayloadRequest, scope: ReportScope, opts: { projectId?: number } = {}): Promise<ProjectLoanFigures[]> {
  const r = await rows<{ id: number; company_id: number; code: string; name: string; borrowed: string; lent: string; ob: string; ol: string; od: string; odn: number }>(
    req,
    sql`WITH lo AS (
          SELECT l.borrower_project_id, l.lender_project_id, l.amount, l.repaid_total, ${OVERDUE} AS overdue
            FROM project_loans l JOIN companies c ON c.id = l.company_id
           WHERE ${ACTIVE})
        SELECT p.id, p.company_id, p.code, p.name,
               coalesce(sum(lo.amount) FILTER (WHERE lo.borrower_project_id = p.id), 0) AS borrowed,
               coalesce(sum(lo.amount) FILTER (WHERE lo.lender_project_id = p.id), 0) AS lent,
               coalesce(sum(lo.amount - lo.repaid_total) FILTER (WHERE lo.borrower_project_id = p.id), 0) AS ob,
               coalesce(sum(lo.amount - lo.repaid_total) FILTER (WHERE lo.lender_project_id = p.id), 0) AS ol,
               coalesce(sum(lo.amount - lo.repaid_total) FILTER (WHERE lo.borrower_project_id = p.id AND lo.overdue), 0) AS od,
               (count(*) FILTER (WHERE lo.overdue))::int AS odn
          FROM projects p JOIN lo ON lo.borrower_project_id = p.id OR lo.lender_project_id = p.id
         WHERE ${projectScopeSql(scope, 'p')} ${opts.projectId ? sql`AND p.id = ${opts.projectId}` : sql``}
         GROUP BY p.id, p.company_id, p.code, p.name
         ORDER BY (coalesce(sum(lo.amount - lo.repaid_total) FILTER (WHERE lo.borrower_project_id = p.id), 0)
                 + coalesce(sum(lo.amount - lo.repaid_total) FILTER (WHERE lo.lender_project_id = p.id), 0)) DESC, p.code`,
  )
  return r.map((x) => ({
    projectId: Number(x.id),
    companyId: Number(x.company_id),
    code: x.code,
    name: x.name,
    borrowed: Number(x.borrowed),
    lent: Number(x.lent),
    outstandingBorrowed: Number(x.ob),
    outstandingLent: Number(x.ol),
    overdueBorrowed: Number(x.od),
    overdueCount: Number(x.odn),
  }))
}

// ---------------------------------------------------------------- report definition

const idOf = (sp: URLSearchParams, name: string): number | undefined => {
  const v = sp.get(name) ?? ''
  return /^\d{1,10}$/.test(v) && Number(v) > 0 ? Number(v) : undefined
}
const statusesOf = (sp: URLSearchParams): LoanStatus[] => [...new Set(sp.getAll('status').flatMap((s) => s.split(',')).filter((s): s is LoanStatus => (LOAN_STATUSES as readonly string[]).includes(s) && s !== 'draft'))]

/** Report filter of the query string (`project`, `status` multi, `terlambat=ya`, `q`). */
export function loanReportFilter(sp: URLSearchParams): LoanReportFilter {
  return { projectId: idOf(sp, 'project'), statuses: statusesOf(sp), overdue: sp.get('terlambat') === 'ya', q: (sp.get('q') ?? '').slice(0, 100) }
}

export const loanHref = (id: number) => `/admin/pinjaman/detail/${id}`

export const pinjamanReport: ReportDef = {
  code: 'pinjaman-antar-project',
  title: 'Pinjaman antar project',
  kpi: 'ADR 0022',
  description: 'Pinjaman antar project per dokumen (pemberi, peminjam, nilai, sudah kembali, sisa, jatuh tempo, terlambat) + ringkasan per project.',
  roles: ['pk-finance', 'pk-owner', 'pk-pm', 'pk-admin'],
  formats: ['csv', 'xlsx', 'pdf'],
  paged: true,
  pageSize: 100,
  scope: loanScope,
  async run(req, scope, sp, page): Promise<ReportResult> {
    const f = loanReportFilter(sp)
    const after = page.cursor ? Number(Buffer.from(page.cursor, 'base64url').toString('utf8')) : undefined
    const list = await loanRows(req, scope, f, { after: Number.isSafeInteger(after) && after! > 0 ? after : undefined, limit: page.limit + 1 })
    const shown = list.slice(0, page.limit)
    const totals = await loanTotals(req, scope, f)
    const perProject = await projectLoanFigures(req, scope, { projectId: f.projectId })
    const last = shown.at(-1)
    return {
      main: {
        key: 'pinjaman',
        title: 'Pinjaman antar project',
        columns: [
          { key: 'nomor', label: 'Nomor', type: 'text', primary: true },
          { key: 'tanggal', label: 'Tanggal', type: 'date' },
          { key: 'pemberi', label: 'Project pemberi', type: 'text', primary: true },
          { key: 'peminjam', label: 'Project peminjam', type: 'text', primary: true },
          { key: 'jenis', label: 'Jenis', type: 'text' },
          { key: 'nilai', label: 'Nilai (Rp)', type: 'money', primary: true },
          { key: 'kembali', label: 'Sudah kembali (Rp)', type: 'money' },
          { key: 'sisa', label: 'Sisa (Rp)', type: 'money', primary: true },
          { key: 'jatuhTempo', label: 'Jatuh tempo', type: 'date' },
          { key: 'status', label: 'Status', type: 'text', primary: true },
          { key: 'hariTerlambat', label: 'Hari terlambat', type: 'int' },
        ],
        rows: shown.map((x) => ({
          cells: {
            nomor: x.docNo ?? `#${x.id}`,
            tanggal: x.loanDate,
            pemberi: `${x.lender.code} ${x.lender.name}`,
            peminjam: `${x.borrower.code} ${x.borrower.name}`,
            jenis: LOAN_KIND_LABELS[x.kind],
            nilai: x.amount,
            kembali: x.repaid,
            sisa: x.outstanding,
            jatuhTempo: x.dueDate,
            status: x.overdue ? `${LOAN_STATUS_LABELS[x.status]} · ${OVERDUE_LABEL}` : LOAN_STATUS_LABELS[x.status],
            hariTerlambat: x.overdue ? x.daysOverdue : null,
          },
          href: loanHref(x.id),
          links: docLink('nomor', 'project_loan', x.id),
          company: x.companyId,
        })),
        totals: { nomor: `TOTAL disetujui (${totals.count} pinjaman)`, nilai: totals.amount, kembali: totals.repaid, sisa: totals.outstanding },
        empty: 'Tidak ada pinjaman antar project untuk filter ini.',
      },
      extra: [
        {
          key: 'per-project',
          title: 'Ringkasan per project',
          columns: [
            { key: 'project', label: 'Project', type: 'text', primary: true },
            { key: 'diterima', label: 'Pinjaman diterima (Rp)', type: 'money' },
            { key: 'sisaDiterima', label: 'Sisa diterima (Rp)', type: 'money', primary: true },
            { key: 'diberikan', label: 'Pinjaman diberikan (Rp)', type: 'money' },
            { key: 'sisaDiberikan', label: 'Sisa diberikan (Rp)', type: 'money', primary: true },
            { key: 'terlambat', label: 'Terlambat (Rp)', type: 'money' },
            { key: 'nTerlambat', label: 'Jumlah terlambat', type: 'int' },
          ],
          rows: perProject.map((p) => ({
            cells: { project: `${p.code} ${p.name}`, diterima: p.borrowed, sisaDiterima: p.outstandingBorrowed, diberikan: p.lent, sisaDiberikan: p.outstandingLent, terlambat: p.overdueBorrowed, nTerlambat: p.overdueCount },
            href: `/admin/collections/projects/${p.projectId}/pinjaman`,
            company: p.companyId,
          })),
          empty: 'Belum ada pinjaman yang disetujui.',
        },
      ],
      notes: [
        'Pinjaman = klaim tercatat antara project dalam satu PT (tanpa transaksi kas). Nilai, sudah kembali dan sisa dihitung sejak disetujui Direktur; Menunggu persetujuan menampilkan nilai yang diajukan.',
        `${OVERDUE_LABEL} = jatuh tempo lewat (tanggal PT) dan masih ada sisa. Draft tidak ditampilkan.`,
      ],
      next: list.length > page.limit && last ? Buffer.from(String(last.id)).toString('base64url') : null,
      count: totals.count,
      companyTotals: totals.byCompany.map((x) => ({ company: x.companyId, cells: { nomor: `${x.count} pinjaman`, nilai: x.amount, kembali: x.repaid, sisa: x.outstanding } })),
    }
  },
  async filters(req, scope, sp) {
    const projects = await rows<{ id: number; code: string; name: string }>(req, sql`SELECT p.id, p.code, p.name FROM projects p WHERE ${projectScopeSql(scope, 'p')} ORDER BY p.code, p.company_id`)
    return [
      { name: 'q', label: 'Cari', kind: 'text', value: sp.get('q') ?? '' },
      { name: 'project', label: 'Project', kind: 'select', options: projects.map((p) => ({ value: String(p.id), label: `${p.code} ${p.name}` })), value: sp.get('project') ?? '' },
      { name: 'status', label: 'Status', kind: 'multiselect', options: LOAN_STATUSES.filter((s) => s !== 'draft').map((s) => ({ value: s, label: LOAN_STATUS_LABELS[s] })), value: statusesOf(sp) },
      { name: 'terlambat', label: 'Terlambat saja', kind: 'select', options: [{ value: 'ya', label: 'Ya' }], value: sp.get('terlambat') ?? '' },
    ]
  },
  fileStem(ctx) {
    return `pinjaman-antar-project_${ctx.today}`
  },
}

/** Dashboard card data: totals + top 5 projects by outstanding (ADR 0022 §9). */
export async function loanDashboard(req: PayloadRequest) {
  const scope = await loanScope(req)
  const totals = await loanTotals(req, scope)
  const projects = (await projectLoanFigures(req, scope)).slice(0, 5)
  const ctx = await reportContext(req)
  return { totals, projects, today: ctx.today, scopeKind: scope.kind }
}
