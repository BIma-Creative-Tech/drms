import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { disbursedInRange, num, rows, type AccountBalance } from './kpi'
import { firstDay, lastDay } from './rules'
import { companyScopeSql, narrowToSite, projectScopeSql, scopeCompanies, siteScopeSql, type ReportScope } from './scope'

/**
 * ADR 0023 §5 (owner Q-S7): per-site view of the dashboards — sites of the scope's PTs with the cash balance of the
 * accounts flagged with the site, and (Direktur) running projects, attendance today and net disbursement this month
 * of the site's projects. Every number reuses the scope helpers with `narrowToSite` (only narrows), so a PM's or a
 * PT-narrowed scope never shows more than its own data. Empty when the PTs have no site (cards hidden).
 */
export type SiteOption = { id: number; companyId: number; code: string; name: string; active: boolean }

/** Sites of the scope's PTs (dashboard / report "Site" filter options), active first. */
export async function scopeSiteOptions(req: PayloadRequest, scope: ReportScope): Promise<SiteOption[]> {
  const r = await rows(req, sql`SELECT s.id, s.company_id, s.code, s.name, coalesce(s.active, true) AS active FROM sites s WHERE ${siteScopeSql(scope)} ORDER BY coalesce(s.active, true) DESC, s.code, s.id`)
  return r.map((x) => ({ id: num(x.id), companyId: num(x.company_id), code: String(x.code), name: String(x.name), active: x.active !== false }))
}

export type SiteCash = { siteId: number | null; companyId: number | null; code: string; name: string; balance: number; accounts: number }

/**
 * K-01 per site: Σ balance of the visible accounts flagged with each site, plus one "Tanpa site" row (accounts without
 * a site flag) when there is anything there. Σ rows = total of `accounts`.
 */
export function cashBySite(sites: readonly SiteOption[], accounts: readonly AccountBalance[]): SiteCash[] {
  if (sites.length === 0) return []
  // an inactive site is listed only while accounts still carry its flag
  const out: SiteCash[] = sites.filter((s) => s.active || accounts.some((a) => a.siteId === s.id)).map((s) => {
    const own = accounts.filter((a) => a.siteId === s.id)
    return { siteId: s.id, companyId: s.companyId, code: s.code, name: s.name, balance: own.reduce((t, a) => t + a.balance, 0), accounts: own.length }
  })
  const known = new Set(sites.map((s) => s.id))
  const rest = accounts.filter((a) => a.siteId === null || !known.has(a.siteId))
  if (rest.length) out.push({ siteId: null, companyId: null, code: '—', name: 'Tanpa site', balance: rest.reduce((t, a) => t + a.balance, 0), accounts: rest.length })
  return out
}

export type SiteSummary = SiteCash & { projectsRunning: number; attendanceToday: number; disbursedMonth: number }

/** Direktur "per site" breakdown: running projects, people checked in today (any location of the site), net disbursed this month. */
export async function siteSummaries(req: PayloadRequest, scope: ReportScope, sites: readonly SiteOption[], cash: readonly SiteCash[], ctx: { today: string; month: string }): Promise<SiteSummary[]> {
  const out: SiteSummary[] = []
  for (const s of sites.filter((x) => x.active)) {
    const narrowed = narrowToSite(scope, s.id)
    const [p] = await rows(req, sql`SELECT count(*)::int AS n FROM projects p WHERE ${projectScopeSql(narrowed)} AND p.status::text = 'berjalan'`)
    const [a] = await rows(
      req,
      sql`SELECT count(DISTINCT a.employee_id)::int AS n FROM attendances a
          WHERE a.site_id = ${s.id} AND a.kind = 'check_in' AND a.local_date = ${ctx.today} AND ${companyScopeSql(sql`a.company_id`, scopeCompanies(scope))}`,
    )
    const d = await disbursedInRange(req, narrowed, firstDay(ctx.month), lastDay(ctx.month))
    const c = cash.find((x) => x.siteId === s.id)
    out.push({ siteId: s.id, companyId: s.companyId, code: s.code, name: s.name, balance: c?.balance ?? 0, accounts: c?.accounts ?? 0, projectsRunning: num(p?.n), attendanceToday: num(a?.n), disbursedMonth: d.net })
  }
  return out
}
