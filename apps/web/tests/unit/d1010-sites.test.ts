import { sql } from '@payloadcms/db-postgres'
import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import { describe, expect, it } from 'vitest'

import { ITEM_ICONS, MODULES } from '@/admin/modules/registry'
import { locationScopeSql, homeSiteScopeSql, narrowAttScope, narrowAttToSite, type AttScope } from '@/domain/attendance/queries'
import { LOCATION_COLLECTION, LOCATION_FIELD, locationOf } from '@/domain/attendance/record'
import { siteFromCostCenterHref } from '@/domain/sites'
import { attendanceReportScope } from '@/domain/reports/attendance-report'
import { narrowScope, siteParam } from '@/domain/reports/registry'
import { cashBySite } from '@/domain/reports/sites'
import { cashScopeSql, costCenterScopeSql, fromCompanies, ledgerScopeSql, narrowToSite, projectScopeSql, requestScopeSql, scopeSites, type ReportScope } from '@/domain/reports/scope'
import { siteOptions } from '@/fields/company'
import { AttendanceCheckBody } from '@/api/v1/schemas-attendance'
import { SyncAttendancePayload, SyncOnBehalfPayload } from '@/api/v1/schemas-sync'

/**
 * ADR 0023 (sites = kantor cabang per PT) — pure parts: location resolution (site / project / cost center), the
 * "exactly one location" contract, the site narrowing of report and attendance scopes (only narrows, PT-bound),
 * per-site cash, the master's place in the admin navigation.
 */
const q = (s: ReturnType<typeof sql>) => new PgDialect().sqlToQuery(s)

describe('location resolution', () => {
  it('locationOf: project → cost center → site; collection + payload field per type', () => {
    expect(locationOf({ project_id: 4 })).toEqual({ type: 'project', id: 4 })
    expect(locationOf({ cost_center_id: 5 })).toEqual({ type: 'cost_center', id: 5 })
    expect(locationOf({ site_id: 6 })).toEqual({ type: 'site', id: 6 })
    expect(LOCATION_COLLECTION).toEqual({ project: 'projects', cost_center: 'cost-centers', site: 'sites' })
    expect(LOCATION_FIELD.site).toBe('site_id')
  })

  it('payload schemas: exactly one of project_id / cost_center_id / site_id (sync self + on-behalf + web)', () => {
    const base = { lat: -1, lng: 116, is_mocked: false, selfie_media_id: 9 }
    expect(SyncAttendancePayload.safeParse({ ...base, site_id: 3 }).success).toBe(true)
    expect(SyncAttendancePayload.safeParse({ ...base, project_id: 3 }).success).toBe(true) // old APK payload
    expect(SyncAttendancePayload.safeParse({ ...base, site_id: 3, project_id: 4 }).success).toBe(false)
    expect(SyncAttendancePayload.safeParse({ ...base, site_id: 3, cost_center_id: 4 }).success).toBe(false)
    expect(SyncAttendancePayload.safeParse(base).success).toBe(false)
    const ob = { ...base, employee_id: 2, kind: 'check_in', reason: 'tidak punya HP' }
    expect(SyncOnBehalfPayload.safeParse({ ...ob, site_id: 3 }).success).toBe(true)
    expect(SyncOnBehalfPayload.safeParse({ ...ob, site_id: 3, project_id: 1 }).success).toBe(false)
    const web = { lat: -1, lng: 116, selfie_media_id: 9 }
    expect(AttendanceCheckBody.safeParse({ ...web, site_id: 3 }).success).toBe(true)
    expect(AttendanceCheckBody.safeParse({ ...web, site_id: 3, project_id: 1 }).success).toBe(false)
  })
})

describe('attendance scope + site', () => {
  const office: AttScope = { kind: 'all', parts: [{ company: 1, all: true, projects: [], costCenters: [] }] }
  const pm: AttScope = { kind: 'team', projects: [7], costCenters: [], parts: [{ company: 2, all: false, projects: [7], costCenters: [], sites: [11] }] }

  it('a PM part matches its team sites as site check-ins only (project rows of the site stay project rules)', () => {
    const r = q(locationScopeSql(pm, 'a'))
    expect(r.sql).toMatch(/a\.site_id IN/)
    expect(r.sql).toContain('a.project_id IS NULL AND a.cost_center_id IS NULL')
    expect(r.params).toEqual(expect.arrayContaining([2, 7, 11]))
    // assignments: a site assignment row is a site location
    expect(q(locationScopeSql(pm, 'ta')).sql).toMatch(/ta\.site_id IN/)
  })

  it('narrowAttToSite only ADDS a site predicate per PT (never widens); legacy literal fails closed', () => {
    const n = narrowAttToSite(office, 11)
    expect(n.parts).toEqual([{ company: 1, all: true, projects: [], costCenters: [], onlySites: [11] }])
    const r = q(locationScopeSql(n, 'a'))
    expect(r.sql).toMatch(/a\.company_id = \$\d+ AND a\.site_id IN/)
    expect(narrowAttToSite(office, undefined)).toBe(office)
    expect(narrowAttToSite({ kind: 'all' }, 11).parts).toEqual([])
    // project filter + site filter: both apply
    const both = narrowAttScope(n, 7)
    expect(both.parts![0]).toMatchObject({ projects: [7], onlySites: [11] })
  })

  it('home-site employees: office part all home-site employees of the PT, PM part only its team sites', () => {
    expect(q(homeSiteScopeSql(office)).sql).toContain('e.home_site_id IS NOT NULL')
    const r = q(homeSiteScopeSql(pm))
    expect(r.sql).toMatch(/e\.home_site_id IN/)
    expect(r.params).toEqual([2, 11])
    // project / cost-center filter (narrowAttScope) drops the team sites → no home-site members
    expect(q(homeSiteScopeSql(narrowAttScope(pm, 7))).sql).toMatch(/FALSE/)
  })

  it('attendance report scope: PM team sites + report site filter carry over', () => {
    const rs = fromCompanies([{ company: 2, kind: 'team', projects: [7], costCenters: [], sites: [11], onlySites: [11] }])
    expect(attendanceReportScope(rs).parts).toEqual([{ company: 2, all: false, projects: [7], costCenters: [], sites: [11], onlySites: [11] }])
  })
})

describe('report scope + site filter (ADR 0023 §5)', () => {
  const office: ReportScope = fromCompanies([{ company: 1, kind: 'all' }])
  const team: ReportScope = fromCompanies([{ company: 2, kind: 'team', projects: [7, 8], costCenters: [3] }])

  it('siteParam parses one positive id', () => {
    expect(siteParam(new URLSearchParams('site=12'))).toBe(12)
    expect(siteParam(new URLSearchParams('site=0'))).toBeNull()
    expect(siteParam(new URLSearchParams('site=x'))).toBeNull()
    expect(siteParam(new URLSearchParams(''))).toBeNull()
  })

  it('narrowToSite keeps kind + PT parts and adds onlySites; unchanged without a site', () => {
    const n = narrowToSite(team, 11)
    expect(n.kind).toBe('team')
    expect(n.companies).toEqual([{ company: 2, kind: 'team', projects: [7, 8], costCenters: [3], onlySites: [11] }])
    expect(scopeSites(n)).toEqual([11])
    expect(narrowToSite(team, null)).toBe(team)
  })

  it('every helper ANDs the site predicate inside the PT-bound part (requests, projects, cash, ledger, accounts, cost centers)', () => {
    const n = narrowToSite(office, 11)
    const req = q(requestScopeSql(n)).sql
    expect(req).toMatch(/er\.company_id = \$1 AND TRUE AND er\.project_id IN \(SELECT sp\.id FROM projects sp WHERE sp\.site_id IN/)
    expect(q(projectScopeSql(n)).sql).toMatch(/p\.site_id IN/)
    expect(q(cashScopeSql(n)).sql).toContain('ce.cash_account_id IN (SELECT sa.id FROM cash_accounts sa')
    expect(q(ledgerScopeSql(n)).sql).toContain('ce.cash_account_id IN (SELECT sa.id FROM cash_accounts sa')
    expect(q(ledgerScopeSql(n, 'a')).sql).toMatch(/a\.site_id IN/)
    expect(q(costCenterScopeSql(n)).sql).toContain('SELECT sc.cost_center_id FROM sites sc')
    // without a site filter the helpers are unchanged (company only)
    expect(q(ledgerScopeSql(office)).sql).not.toContain('site')
    expect(q(requestScopeSql(office)).sql).not.toContain('site')
  })

  it('PM project filter keeps the site filter (both apply, never widened)', () => {
    const n = narrowScope(narrowToSite(team, 11), 7)
    expect(n.companies).toEqual([{ company: 2, kind: 'team', projects: [7], costCenters: [], onlySites: [11] }])
    const outside = narrowScope(narrowToSite(team, 11), 99)
    expect(outside.companies).toEqual([{ company: 2, kind: 'team', projects: [], costCenters: [], onlySites: [11] }])
  })
})

describe('per-site cash (Q-S7)', () => {
  it('Σ balance of the accounts flagged with each site + one "Tanpa site" row; nothing without sites', () => {
    const acc = (id: number, siteId: number | null, balance: number) => ({ id, companyId: 1, siteId, name: `A${id}`, kind: 'cash', active: true, opening: 0, totalIn: 0, totalOut: 0, balance })
    const sites = [
      { id: 11, companyId: 1, code: 'BPN', name: 'Cabang Balikpapan', active: true },
      { id: 12, companyId: 1, code: 'KDI', name: 'Cabang Kendari', active: true },
    ]
    const rows = cashBySite(sites, [acc(1, 11, 100), acc(2, 11, 50), acc(3, null, 1000)])
    expect(rows).toEqual([
      { siteId: 11, companyId: 1, code: 'BPN', name: 'Cabang Balikpapan', balance: 150, accounts: 2 },
      { siteId: 12, companyId: 1, code: 'KDI', name: 'Cabang Kendari', balance: 0, accounts: 0 },
      { siteId: null, companyId: null, code: '—', name: 'Tanpa site', balance: 1000, accounts: 1 },
    ])
    expect(cashBySite([], [acc(1, null, 5)])).toEqual([])
  })
})

describe('admin: master + pickers', () => {
  it('sites live in Master Data (D9 landing tile with its own glyph); picker = active sites of the PT', () => {
    const master = MODULES.find((m) => m.id === 'master')!
    expect(master.sections.flatMap((s) => s.items).some((i) => 'collection' in i && i.collection === 'sites')).toBe(true)
    expect(ITEM_ICONS['/collections/sites']).toBeDefined()
    expect(siteOptions({ data: { company: 3 } })).toEqual({ and: [{ company: { equals: 3 } }, { active: { not_equals: false } }] })
    expect(siteOptions({ data: {} })).toEqual({ active: { not_equals: false } })
    expect(siteFromCostCenterHref(42)).toBe('/admin/collections/sites/create?costCenter=42')
  })
})
