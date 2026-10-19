import type { PayloadRequest } from 'payload'

import { hasRoleAny } from '@/access/roles'
import { adminDashboard, financeDashboard, ownerDashboard, pmDashboard, staffDashboard } from '@/domain/reports/dashboards'
import { csvStream, downloadHeaders, ExportRefused, exportLetterhead, pdfBuffer, PDF_MAX_ROWS, prepareExport, xlsxBuffer } from '@/domain/reports/export'
import { companyRefs } from '@/domain/companies'
import { effectiveScope, PT_PARAM, ptParam, reportByCode, REPORTS, type Format, type ReportDef } from '@/domain/reports/registry'
import { officeScope, scopeCompanies, type ReportScope } from '@/domain/reports/scope'
import { BusyError } from '@/lib/heavy-gate'
import { withReqTransaction } from '@/lib/system-tx'
import { XLSX_MAX_ROWS, xlsxEnabled } from '@/lib/xlsx'

import { assertSelectedCompanies } from '../company-query'
import { HttpError, json, problem, v1 } from '../http'

/**
 * F3 dashboards & reports (wireframes §0 "Data"): the admin views and the APK read the same data.
 * - GET /dashboard/{owner,finance,pm,admin,me} — role layouts (me = Staff home: own requests).
 * - GET /reports                                — the caller's report list (web /admin/laporan; user 2026-10-19, APK).
 * - GET /reports/{code}                         — one report page as JSON (same filters as the web).
 * - GET /reports/{code}/{csv|xlsx|pdf}          — download; audited `export`; 10/min per user.
 * Scope: Finance/Owner all, PM team (filters intersected), Staff/Admin no office reports; the
 * global audit log (`audit-log`) for Owner/Admin/Finance (Q-F3-4). Reads run in one transaction.
 * MC2 (ADR 0016 §6): the scope is per PT (role IN each selected PT); query `pt` (repeatable / comma
 * list) narrows it further (a PT outside the selection → 403 COMPANY_NOT_ALLOWED, QA-MC4-14); the JSON carries `companies` (PTs covered) — > 1 PT adds a PT column and
 * a "Subtotal per PT" table; exports use the PT / group letterhead.
 */
const READ_LIMIT: [number, number] = [60, 60_000]
const EXPORT_LIMIT: [number, number] = [10, 60_000]

const dashboard = (name: string, roles: Parameters<typeof v1>[0]['roles'], load: (req: PayloadRequest) => Promise<unknown>) =>
  v1({
    path: `/dashboard/${name}`,
    method: 'get',
    roles,
    rateLimit: READ_LIMIT,
    handler: async ({ req }) => json(await withReqTransaction(req, () => load(req))),
  })

/** ADR 0023 §5: `?site=` narrows the owner / finance / PM dashboards (never widens). */
function siteQuery(req: PayloadRequest): number | undefined {
  const raw = req.searchParams.get('site')
  if (raw === null || raw === '') return undefined
  if (!/^\d{1,9}$/.test(raw)) throw new HttpError(400, 'Bad Request', { errors: [{ path: 'site', message: 'site harus id angka.' }] })
  return Number(raw)
}

export const ownerDashboardEndpoint = dashboard('owner', ['pk-owner'], (req) => ownerDashboard(req, { siteId: siteQuery(req) }))
export const financeDashboardEndpoint = dashboard('finance', ['pk-finance'], (req) => financeDashboard(req, { siteId: siteQuery(req) }))
export const pmDashboardEndpoint = dashboard('pm', ['pk-pm'], (req) => pmDashboard(req, { siteId: siteQuery(req) }))
export const adminDashboardEndpoint = dashboard('admin', ['pk-admin'], (req) => adminDashboard(req))
export const meDashboardEndpoint = dashboard('me', undefined, (req) => staffDashboard(req))

/** Report + caller scope, or 404 (unknown code) / 403 (role; a `pt` outside the caller's PTs, QA-MC4-14). */
export async function resolveReport(req: PayloadRequest, code: string | undefined): Promise<{ def: ReportDef; scope: ReportScope }> {
  const def = code ? reportByCode(code) : undefined
  if (!def) throw new HttpError(404, 'Not Found')
  if (!hasRoleAny(req, ...def.roles)) throw new HttpError(403, 'Forbidden', { detail: 'Laporan ini tidak tersedia untuk peran Anda.' })
  const pts = req.searchParams ? ptParam(req.searchParams) : null
  if (pts) await assertSelectedCompanies(req, pts, PT_PARAM)
  const scope: ReportScope = def.scope ? await def.scope(req) : await officeScope(req)
  if (scope.kind === 'none') throw new HttpError(403, 'Forbidden')
  return { def, scope }
}

/** User 2026-10-19 (APK ↔ web parity, phase 4): the web "Laporan" index — reports of the caller's roles. */
export const reportIndexEndpoint = v1({
  path: '/reports',
  method: 'get',
  rateLimit: READ_LIMIT,
  handler: async ({ req }) =>
    json({
      items: REPORTS.filter((r) => hasRoleAny(req, ...r.roles)).map((r) => ({
        code: r.code,
        title: r.title,
        description: r.description,
        kpi: r.kpi,
        paged: r.paged,
        formats: r.formats.filter((f) => f !== 'xlsx' || xlsxEnabled()),
      })),
    }),
})

export const reportJsonEndpoint = v1({
  path: '/reports/:code',
  method: 'get',
  rateLimit: READ_LIMIT,
  handler: async ({ req, params }) => {
    const { def, scope } = await resolveReport(req, params.code)
    const sp = req.searchParams
    const cursor = sp.get('cursor') ?? undefined
    if (cursor !== undefined && !/^[A-Za-z0-9_-]{1,200}$/.test(cursor)) throw new HttpError(400, 'Bad Request', { detail: 'cursor tidak valid.' })
    // phase 4 (APK): the filter form, letterhead and export limits of the web page (filters without the cursor)
    const filterSp = new URLSearchParams([...sp.entries()].filter(([k]) => k !== 'cursor'))
    const { res, filters, letterhead } = await withReqTransaction(req, async () => ({
      res: await def.run(req, scope, sp, { cursor, limit: def.pageSize }),
      filters: await def.filters(req, scope, filterSp),
      letterhead: await exportLetterhead(req, def, scope, filterSp),
    }))
    // `rowLinks` (phase 4): the web row / cell links (admin hrefs) — the APK opens its own screen where it has one
    const table = (t: typeof res.main) => ({
      key: t.key,
      title: t.title,
      columns: t.columns,
      rows: t.rows.map((r) => r.cells),
      totals: t.totals ?? null,
      rowLinks: t.rows.map((r) => (r.href || r.links ? { ...(r.href ? { _row: r.href } : {}), ...(r.links ?? {}) } : null)),
      empty: t.empty ?? null,
    })
    return json({
      code: def.code,
      title: def.title,
      kpi: def.kpi,
      scope: scope.kind,
      companies: await companyRefs(req, scopeCompanies(effectiveScope(scope, sp))),
      count: res.count,
      nextCursor: res.next,
      main: table(res.main),
      extra: res.extra.map(table),
      notes: res.notes,
      formats: def.formats.filter((f) => f !== 'xlsx' || xlsxEnabled()),
      description: def.description,
      filters,
      letterhead: { kind: letterhead.kind, name: letterhead.name, companies: letterhead.companies },
      rowCount: def.paged ? res.count : res.main.rows.length,
      limits: { xlsx: XLSX_MAX_ROWS, pdf: PDF_MAX_ROWS },
    })
  },
})

export const reportExportEndpoint = v1({
  path: '/reports/:code/:format',
  method: 'get',
  rateLimit: EXPORT_LIMIT,
  handler: async ({ req, params }) => {
    const format = params.format as Format
    if (!['csv', 'xlsx', 'pdf'].includes(format)) throw new HttpError(404, 'Not Found')
    const { def, scope } = await resolveReport(req, params.code)
    if (!def.formats.includes(format) || (format === 'xlsx' && !xlsxEnabled())) throw new HttpError(404, 'Not Found', { detail: 'Format ini tidak tersedia untuk laporan ini.' })
    const sp = req.searchParams
    let prepared
    try {
      prepared = await prepareExport(req, def, scope, sp, format)
    } catch (err) {
      if (err instanceof ExportRefused) return problem(err.status, err.status === 413 ? 'Content Too Large' : 'Bad Request', { detail: err.detail })
      throw err
    }
    if (format === 'csv') return new Response(csvStream(req, prepared, scope, sp), { status: 200, headers: downloadHeaders(prepared) })
    try {
      const buf = format === 'xlsx' ? await xlsxBuffer(prepared) : await pdfBuffer(req, prepared)
      return new Response(new Uint8Array(buf), { status: 200, headers: downloadHeaders(prepared, buf.length) })
    } catch (err) {
      if (err instanceof BusyError) {
        const res = problem(503, 'Service Unavailable', { detail: 'Pembuat file sedang sibuk, coba lagi.' })
        res.headers.set('Retry-After', '10')
        return res
      }
      throw err
    }
  },
})

export const REPORT_ENDPOINTS = [
  ownerDashboardEndpoint,
  financeDashboardEndpoint,
  pmDashboardEndpoint,
  adminDashboardEndpoint,
  meDashboardEndpoint,
  reportIndexEndpoint,
  reportJsonEndpoint,
  reportExportEndpoint,
]
