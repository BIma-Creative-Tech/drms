import type { PayloadRequest } from 'payload'

import { hasRole } from '@/access/roles'
import { adminDashboard, financeDashboard, ownerDashboard, pmDashboard, staffDashboard } from '@/domain/reports/dashboards'
import { csvStream, downloadHeaders, ExportRefused, pdfBuffer, prepareExport, xlsxBuffer } from '@/domain/reports/export'
import { reportByCode, type Format, type ReportDef } from '@/domain/reports/registry'
import { officeScope, type ReportScope } from '@/domain/reports/scope'
import { BusyError } from '@/lib/heavy-gate'
import { withReqTransaction } from '@/lib/system-tx'
import { xlsxEnabled } from '@/lib/xlsx'

import { HttpError, json, problem, v1 } from '../http'

/**
 * F3 dashboards & reports (wireframes §0 "Data"): the admin views and the APK read the same data.
 * - GET /dashboard/{owner,finance,pm,admin,me} — role layouts (me = Staff home: own requests).
 * - GET /reports/{code}                         — one report page as JSON (same filters as the web).
 * - GET /reports/{code}/{csv|xlsx|pdf}          — download; audited `export`; 10/min per user.
 * Scope: Finance/Owner all, PM team (filters intersected), Staff/Admin no office reports; the
 * global audit log (`audit-log`) for Owner/Admin/Finance (Q-F3-4). Reads run in one transaction.
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

export const ownerDashboardEndpoint = dashboard('owner', ['pk-owner'], (req) => ownerDashboard(req))
export const financeDashboardEndpoint = dashboard('finance', ['pk-finance'], (req) => financeDashboard(req))
export const pmDashboardEndpoint = dashboard('pm', ['pk-pm'], (req) => pmDashboard(req))
export const adminDashboardEndpoint = dashboard('admin', ['pk-admin'], (req) => adminDashboard(req))
export const meDashboardEndpoint = dashboard('me', undefined, (req) => staffDashboard(req))

/** Report + caller scope, or 404 (unknown code) / 403 (role). */
export async function resolveReport(req: PayloadRequest, code: string | undefined): Promise<{ def: ReportDef; scope: ReportScope }> {
  const def = code ? reportByCode(code) : undefined
  if (!def) throw new HttpError(404, 'Not Found')
  if (!hasRole(req, ...def.roles)) throw new HttpError(403, 'Forbidden', { detail: 'Laporan ini tidak tersedia untuk peran Anda.' })
  const scope: ReportScope = def.code === 'audit-log' ? { kind: 'all' } : def.scope ? await def.scope(req) : await officeScope(req)
  if (scope.kind === 'none') throw new HttpError(403, 'Forbidden')
  return { def, scope }
}

export const reportJsonEndpoint = v1({
  path: '/reports/:code',
  method: 'get',
  rateLimit: READ_LIMIT,
  handler: async ({ req, params }) => {
    const { def, scope } = await resolveReport(req, params.code)
    const sp = req.searchParams
    const cursor = sp.get('cursor') ?? undefined
    if (cursor !== undefined && !/^[A-Za-z0-9_-]{1,200}$/.test(cursor)) throw new HttpError(400, 'Bad Request', { detail: 'cursor tidak valid.' })
    const res = await withReqTransaction(req, () => def.run(req, scope, sp, { cursor, limit: def.pageSize }))
    const table = (t: typeof res.main) => ({ key: t.key, title: t.title, columns: t.columns, rows: t.rows.map((r) => r.cells), totals: t.totals ?? null })
    return json({
      code: def.code,
      title: def.title,
      kpi: def.kpi,
      scope: scope.kind,
      count: res.count,
      nextCursor: res.next,
      main: table(res.main),
      extra: res.extra.map(table),
      notes: res.notes,
      formats: def.formats.filter((f) => f !== 'xlsx' || xlsxEnabled()),
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
  reportJsonEndpoint,
  reportExportEndpoint,
]
