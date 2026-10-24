import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { employeeIn, hasRole } from '@/access/roles'
import { resolveScope } from '@/access/scope'
import { settings } from '@/domain/companies'
import { today } from '@/domain/expense/common'
import { rows } from '@/domain/reports/kpi'

import { attendanceTypeOf, type AttendanceType, type LocationKind } from './area'
import { registeredLocations } from './eligibility'

/**
 * ADR 0032 (DRMS 24/10, user decision): what an Admin Staff may record ON BEHALF of — per PT where the caller holds
 * `pk-admin-staff` (∩ the request's PTs): every active employee of the PT except the caller's own (also employees
 * WITHOUT a user account, e.g. tukang harian: `hasAccount` false) and the registered check-in locations of the PT
 * (projects, cost centers with a point). Names, codes and points only — no money, no bank data, no phone. Used by the
 * web "Absensi · Absenkan karyawan" page and GET /api/v1/attendance/on-behalf/options (APK, cached for offline use).
 * The server re-checks every record (record.ts onBehalfActor / recordAttendance).
 * DRMS 24/10 (user decision C): a PM gets the web page too, TEAM-scoped like the APK PM on-behalf — in a PT where the
 * caller is PM (and not Admin Staff): the employees assigned today to the PM's team projects / cost centers (own
 * excluded) and only those team locations. Admin Staff stays PT-wide.
 */
export type OnBehalfOptions = {
  companies: Array<{ id: number; attendanceEnabled: boolean }>
  employees: Array<{ id: number; company: number; code: string; name: string; attendanceType: AttendanceType; hasAccount: boolean }>
  locations: Array<{ kind: LocationKind; id: number; company: number; code: string; name: string; lat: number; lng: number; radiusM: number }>
}

type EmpRow = { id: number; company_id: number; code: string | null; name: string | null; attendance_type: string | null; has_account: boolean | null }

/** PTs of `companies` where the caller is Admin Staff. */
export const adminStaffCompanies = (req: PayloadRequest, companies: readonly number[]): number[] => companies.filter((c) => hasRole(req, 'pk-admin-staff', c))

/** DRMS 24/10 (C): PTs of `companies` where the caller records as PM (team scope) — PM there and not Admin Staff. */
export const pmOnBehalfCompanies = (req: PayloadRequest, companies: readonly number[]): number[] => companies.filter((c) => hasRole(req, 'pk-pm', c) && !hasRole(req, 'pk-admin-staff', c))

/** The PM's team in PT `company`: team projects / cost centers (access/scope.ts) and the employees assigned to them on `day`. */
export async function pmTeam(req: PayloadRequest, company: number, day?: string): Promise<{ projects: number[]; costCenters: number[]; employees: number[] }> {
  const scope = await resolveScope(req, company)
  const projects = scope.teamProjects
  const costCenters = scope.teamCostCenters
  if (projects.length === 0 && costCenters.length === 0) return { projects, costCenters, employees: [] }
  const d = day ?? (await today(req, company))
  const list = (ids: readonly number[]) => (ids.length ? sql.join(ids.map((i) => sql`${i}`), sql`, `) : sql`NULL`)
  // PT-bound by the bound company_id predicate (MC2 SQL lint)
  const r = await rows<{ id: number }>(
    req,
    sql`SELECT DISTINCT e.id FROM employees e JOIN team_assignments ta ON ta.employee_id = e.id
         WHERE e.company_id = ${company} AND e.active IS NOT FALSE AND e.is_deleted IS NOT TRUE
           AND (ta.project_id IN (${list(projects)}) OR ta.cost_center_id IN (${list(costCenters)}))
           AND (ta.start_date IS NULL OR to_char(ta.start_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') <= ${d})
           AND (ta.end_date IS NULL OR to_char(ta.end_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') >= ${d})`,
  )
  return { projects, costCenters, employees: r.map((x) => Number(x.id)) }
}

export async function onBehalfOptions(req: PayloadRequest, companies: readonly number[]): Promise<OnBehalfOptions> {
  const out: OnBehalfOptions = { companies: [], employees: [], locations: [] }
  const empRow = (e: EmpRow, company: number) => ({ id: Number(e.id), company, code: e.code ?? '', name: e.name ?? '', attendanceType: attendanceTypeOf(e.attendance_type), hasAccount: e.has_account === true })
  for (const company of adminStaffCompanies(req, companies)) {
    const s = (await settings(req, company)) as { syncAttendanceEnabled?: boolean | null }
    out.companies.push({ id: company, attendanceEnabled: s.syncAttendanceEnabled === true })
    const own = employeeIn(req, company) ?? -1
    // PT-bound by the bound company_id predicate (MC2 SQL lint); never the caller's own employee
    const emps = await rows<EmpRow>(
      req,
      sql`SELECT e.id, e.company_id, e.code, e.name, e.attendance_type::text AS attendance_type,
                 EXISTS (SELECT 1 FROM company_memberships m WHERE m.employee_id = e.id AND m.company_id = e.company_id AND m.active IS NOT FALSE) AS has_account
            FROM employees e
           WHERE e.company_id = ${company} AND e.active IS NOT FALSE AND e.is_deleted IS NOT TRUE AND e.id <> ${own}
           ORDER BY e.name, e.id`,
    )
    for (const e of emps) out.employees.push(empRow(e, company))
    out.locations.push(...(await registeredLocations(req, company)))
  }
  // DRMS 24/10 (C): PM — team members (assigned today) and the team's registered locations only
  for (const company of pmOnBehalfCompanies(req, companies)) {
    const team = await pmTeam(req, company)
    const s = (await settings(req, company)) as { syncAttendanceEnabled?: boolean | null }
    out.companies.push({ id: company, attendanceEnabled: s.syncAttendanceEnabled === true })
    const own = employeeIn(req, company) ?? -1
    const ids = team.employees.filter((id) => id !== own)
    if (ids.length) {
      const emps = await rows<EmpRow>(
        req,
        sql`SELECT e.id, e.company_id, e.code, e.name, e.attendance_type::text AS attendance_type,
                   EXISTS (SELECT 1 FROM company_memberships m WHERE m.employee_id = e.id AND m.company_id = e.company_id AND m.active IS NOT FALSE) AS has_account
              FROM employees e
             WHERE e.company_id = ${company} AND e.id IN (${sql.join(
               ids.map((i) => sql`${i}`),
               sql`, `,
             )})
             ORDER BY e.name, e.id`,
      )
      for (const e of emps) out.employees.push(empRow(e, company))
    }
    out.locations.push(...(await registeredLocations(req, company)).filter((l) => (l.kind === 'project' ? team.projects : team.costCenters).includes(l.id)))
  }
  out.companies.sort((a, b) => a.id - b.id)
  return out
}
