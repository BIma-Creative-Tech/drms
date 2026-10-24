import { sql } from '@payloadcms/db-postgres'
import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { ADMIN_STAFF_VISIBLE_COLLECTIONS } from '@/access/panel-visibility'
import { isAdminStaffOnly, PANEL_ROLES, ROLE_LABELS, ROLES, withCompanyContext } from '@/access/roles'
import { ROLE_SHORT } from '@/admin/components/access/role-matrix'
import { LOCATION_KIND_LABEL, LOCATION_KINDS } from '@/admin/components/users/user-onboarding-form'
import { ITEM_ICONS, MODULES } from '@/admin/modules/registry'
import { meCapabilities } from '@/api/v1/endpoints/me'
import { AttendanceCheckBody, AttendanceOnBehalfBody } from '@/api/v1/schemas-attendance'
import { SyncAttendancePayload, SyncOnBehalfPayload } from '@/api/v1/schemas-sync'
import { Attendances } from '@/collections/Attendances'
import { CashAccounts } from '@/collections/CashAccounts'
import { Employees } from '@/collections/Employees'
import { Projects } from '@/collections/Projects'
import { Sites } from '@/collections/Sites'
import { TeamAssignments } from '@/collections/TeamAssignments'
import { locationScopeSql, type AttScope } from '@/domain/attendance/queries'
import { LOCATION_COLLECTION, locationOf, SITE_REMOVED } from '@/domain/attendance/record'
import { effectiveScope } from '@/domain/reports/registry'
import { fromCompanies } from '@/domain/reports/scope'
import { planSiteAssignment } from '@/migrations/20261024_200000_d2410_site_assignments'

/**
 * ADR 0032 (DRMS 24/10, user decisions) — pure parts: sites gone from the navigation and the forms (hidden legacy
 * columns, no create), attendance locations without a site (old APK payloads still parse), the PM team scope without
 * sites, no report site filter, the plan of the site-assignment migration, the new role Admin Staff (roles, labels,
 * panel, menu, capabilities, attendance source) and the on-behalf body.
 */
const q = (s: ReturnType<typeof sql>) => new PgDialect().sqlToQuery(s)
type AnyField = Field & { name?: string; admin?: { hidden?: boolean }; access?: { create?: (a: unknown) => unknown; update?: (a: unknown) => unknown }; options?: Array<{ value: string; label: string }> }
const fieldOf = (fields: readonly Field[], name: string): AnyField => {
  const flat = (fs: readonly Field[]): AnyField[] => fs.flatMap((f) => [f as AnyField, ...((f as { fields?: Field[] }).fields ? flat((f as { fields: Field[] }).fields) : [])])
  return flat(fields).find((f) => f.name === name)!
}

describe('sites removed from the product (ADR 0032 §1)', () => {
  it('no Site menu item / icon; the master is hidden and closed for create', () => {
    const items = MODULES.flatMap((m) => m.sections.flatMap((s) => s.items))
    expect(items.some((i) => 'collection' in i && i.collection === 'sites')).toBe(false)
    expect(ITEM_ICONS['/collections/sites']).toBeUndefined()
    expect(Sites.admin?.hidden).toBe(true)
    expect((Sites.access!.create as (a: unknown) => unknown)({ req: { user: { id: 1 } } })).toBe(false)
  })

  it('the site columns of employees / projects / cash accounts / team assignments are hidden and not writable over HTTP', () => {
    for (const [c, name] of [
      [Employees, 'homeSite'],
      [Projects, 'site'],
      [CashAccounts, 'site'],
      [TeamAssignments, 'site'],
    ] as const) {
      const f = fieldOf(c.fields, name)
      expect(f, `${c.slug}.${name}`).toBeDefined()
      expect(f.admin?.hidden, `${c.slug}.${name}`).toBe(true)
      expect(f.access?.create?.({}), `${c.slug}.${name}`).toBe(false)
      expect(f.access?.update?.({}), `${c.slug}.${name}`).toBe(false)
    }
    expect(Employees.admin?.defaultColumns).not.toContain('homeSite')
    expect(Projects.admin?.defaultColumns).not.toContain('site')
    expect(TeamAssignments.admin?.defaultColumns).not.toContain('site')
    expect(Attendances.admin?.defaultColumns).not.toContain('site')
  })

  it('a new assignment in the Pengguna form is a project or a cost center; a legacy site row keeps a label', () => {
    expect(LOCATION_KINDS.map((k) => k.value)).toEqual(['project', 'costCenter'])
    expect(LOCATION_KIND_LABEL.site).toBe('Site (lama)')
  })

  it('old APK payloads still parse (site_id), the web body refuses it; a site location is history only', () => {
    const base = { lat: -1, lng: 116, is_mocked: false, selfie_media_id: 9 }
    expect(SyncAttendancePayload.safeParse({ ...base, site_id: 3 }).success).toBe(true)
    expect(SyncOnBehalfPayload.safeParse({ ...base, site_id: 3, employee_id: 2, kind: 'check_in', reason: 'tidak punya HP' }).success).toBe(true)
    expect(AttendanceCheckBody.safeParse({ lat: -1, lng: 116, selfie_media_id: 9, site_id: 3 }).success).toBe(false)
    expect(AttendanceCheckBody.safeParse({ lat: -1, lng: 116, selfie_media_id: 9, project_id: 3 }).success).toBe(true)
    expect(locationOf({ site_id: 6 })).toEqual({ type: 'site', id: 6 })
    expect(LOCATION_COLLECTION.site).toBe('sites')
    expect(SITE_REMOVED).toContain('Site tidak lagi dipakai sebagai lokasi absen')
  })

  it('PM team scope: projects / cost centers only (no site predicate); the office part = the whole PT', () => {
    const pm: AttScope = { kind: 'team', projects: [7], costCenters: [3], parts: [{ company: 2, all: false, projects: [7], costCenters: [3] }] }
    const r = q(locationScopeSql(pm, 'a'))
    expect(r.sql).not.toContain('site_id')
    expect(r.params).toEqual([2, 7, 3])
    const office: AttScope = { kind: 'all', parts: [{ company: 1, all: true, projects: [], costCenters: [] }] }
    expect(q(locationScopeSql(office, 'ta')).sql).toBe('(ta.company_id = $1)')
  })

  it('reports: the `site` parameter is ignored (only `pt` narrows)', () => {
    const team = fromCompanies([{ company: 2, kind: 'team', projects: [7], costCenters: [] }])
    expect(effectiveScope(team, new URLSearchParams('site=11'))).toEqual(team)
  })
})

describe('site-assignment migration plan (ADR 0032 §3)', () => {
  it('matching active projects → convert (first on the row, the rest added); none → end a running row, keep an ended one', () => {
    expect(planSiteAssignment({ running: true }, [5])).toEqual({ kind: 'convert', projects: [5] })
    expect(planSiteAssignment({ running: false }, [5, 6])).toEqual({ kind: 'convert', projects: [5, 6] })
    expect(planSiteAssignment({ running: true }, [])).toEqual({ kind: 'end' })
    expect(planSiteAssignment({ running: false }, [])).toEqual({ kind: 'keep' })
  })
})

describe('role Admin Staff (ADR 0032 §5)', () => {
  it('a per-PT role with its label, panel access and matrix short code', () => {
    expect(ROLES).toContain('pk-admin-staff')
    expect(ROLE_LABELS['pk-admin-staff']).toBe('Admin Staff')
    expect(PANEL_ROLES).toContain('pk-admin-staff')
    expect(ROLE_SHORT['pk-admin-staff']).toBe('AdmS')
  })

  it('restricted panel only while no other business role is held', () => {
    const user = (roles: string[]) => withCompanyContext({ id: 1 }, [{ company: 1, roles: roles as never, employee: null }], null, false)
    expect(isAdminStaffOnly(user(['pk-admin-staff']))).toBe(true)
    expect(isAdminStaffOnly(user(['pk-admin-staff', 'pk-operator']))).toBe(true)
    expect(isAdminStaffOnly(user(['pk-admin-staff', 'pk-staff']))).toBe(false)
    expect(isAdminStaffOnly(user(['pk-staff']))).toBe(false)
    expect(ADMIN_STAFF_VISIBLE_COLLECTIONS).toEqual(expect.arrayContaining(['attendances', 'attendance-corrections', 'employees']))
    expect(ADMIN_STAFF_VISIBLE_COLLECTIONS).not.toContain('employee-bank-accounts')
    expect(ADMIN_STAFF_VISIBLE_COLLECTIONS).not.toContain('expense-requests')
  })

  it('menu: "Absenkan karyawan" for the role; Tim hari ini / Jadwal / Laporan include it', () => {
    const items = MODULES.flatMap((m) => m.sections.flatMap((s) => s.items)) as Array<{ view?: string; roles?: readonly string[] }>
    expect(items.find((i) => i.view === '/absensi/absenkan')?.roles).toEqual(['pk-admin-staff'])
    for (const v of ['/absensi', '/absensi/jadwal', '/laporan']) expect(items.find((i) => i.view === v)?.roles, v).toContain('pk-admin-staff')
    expect(ITEM_ICONS['/absensi/absenkan']).toBeDefined()
  })

  it('/me capabilities: on-behalf for PM or Admin Staff; the Admin Staff flag', () => {
    const user = (roles: string[]) => withCompanyContext({ id: 1 }, [{ company: 1, roles: roles as never, employee: null }], null, false)
    const cap = (roles: string[]) => meCapabilities({ user: user(roles) } as never, roles as never, { company: 1 })
    expect(cap(['pk-admin-staff'])).toMatchObject({ attendanceOnBehalf: true, attendanceAdminStaff: true, approvalInbox: false, intercompanyPayment: false })
    expect(cap(['pk-pm'])).toMatchObject({ attendanceOnBehalf: true, attendanceAdminStaff: false })
    expect(cap(['pk-staff'])).toMatchObject({ attendanceOnBehalf: false, attendanceAdminStaff: false })
  })

  it('attendance source `admin` ("Diabsenkan oleh Admin Staff")', () => {
    const source = fieldOf(Attendances.fields, 'source')
    expect(source.options?.map((o) => o.value)).toEqual(['self', 'pm', 'admin'])
    expect(source.options?.find((o) => o.value === 'admin')?.label).toBe('Diabsenkan oleh Admin Staff')
  })

  it('web on-behalf body: employee, kind, exactly one location, reason (3–500), no site', () => {
    const ok = { employee_id: 4, kind: 'check_in', project_id: 7, lat: -1, lng: 116, selfie_media_id: 9, reason: 'tukang harian' }
    expect(AttendanceOnBehalfBody.safeParse(ok).success).toBe(true)
    expect(AttendanceOnBehalfBody.safeParse({ ...ok, reason: 'x' }).success).toBe(false)
    expect(AttendanceOnBehalfBody.safeParse({ ...ok, reason: undefined }).success).toBe(false)
    expect(AttendanceOnBehalfBody.safeParse({ ...ok, cost_center_id: 3 }).success).toBe(false)
    expect(AttendanceOnBehalfBody.safeParse({ ...ok, project_id: undefined, site_id: 3 }).success).toBe(false)
    expect(AttendanceOnBehalfBody.safeParse({ ...ok, kind: 'lembur' }).success).toBe(false)
  })
})
