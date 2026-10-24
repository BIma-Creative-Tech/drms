import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { employeeIn, hasRole } from '@/access/roles'
import { settings } from '@/domain/companies'
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
 */
export type OnBehalfOptions = {
  companies: Array<{ id: number; attendanceEnabled: boolean }>
  employees: Array<{ id: number; company: number; code: string; name: string; attendanceType: AttendanceType; hasAccount: boolean }>
  locations: Array<{ kind: LocationKind; id: number; company: number; code: string; name: string; lat: number; lng: number; radiusM: number }>
}

type EmpRow = { id: number; company_id: number; code: string | null; name: string | null; attendance_type: string | null; has_account: boolean | null }

/** PTs of `companies` where the caller is Admin Staff. */
export const adminStaffCompanies = (req: PayloadRequest, companies: readonly number[]): number[] => companies.filter((c) => hasRole(req, 'pk-admin-staff', c))

export async function onBehalfOptions(req: PayloadRequest, companies: readonly number[]): Promise<OnBehalfOptions> {
  const out: OnBehalfOptions = { companies: [], employees: [], locations: [] }
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
    for (const e of emps) {
      out.employees.push({ id: Number(e.id), company, code: e.code ?? '', name: e.name ?? '', attendanceType: attendanceTypeOf(e.attendance_type), hasAccount: e.has_account === true })
    }
    out.locations.push(...(await registeredLocations(req, company)))
  }
  return out
}
