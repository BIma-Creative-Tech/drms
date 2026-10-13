import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { relId } from '@/access/roles'
import { settings } from '@/domain/companies'
import { rows } from '@/domain/reports/kpi'

import { attendanceTypeOf, compareEligible, kindAllowedFor, type AttendanceType, type LocationKind } from './area'
import { effectiveRadiusM } from './calendar'

/**
 * DRMS 13/10 A2 (ADR 0023 amendment 2026-10-13): where may an employee check in — by attendance type, no assignment.
 * - `onsite`: every active location of the employee's PT WITH a point: sites (head office included), projects (not
 *   archived), cost centers (active).
 * - `non_onsite`: the sites of the PT only (head office "Kantor pusat" + branch offices).
 * Locations without a point are never eligible (the check-in would be refused NO_GEOFENCE). The rule itself
 * (`kindAllowedFor`) is pure (area.ts); this module reads the employee and the PT's registered locations.
 */

export type EmployeeAttendance = { id: number; company: number; type: AttendanceType; homeSite: number | null; active: boolean }

/** Attendance profile of one employee (PT, type, home site); null when it does not exist. */
export async function employeeAttendance(req: PayloadRequest, employee: number): Promise<EmployeeAttendance | null> {
  const doc = (await req.payload.findByID({
    collection: 'employees',
    id: employee,
    depth: 0,
    select: { company: true, attendanceType: true, homeSite: true, active: true } as never,
    overrideAccess: true, // SYSTEM-READ: PT + attendance type of the attendance's employee (callers resolved / checked it)
    req,
    disableErrors: true,
  })) as { id?: number; company?: unknown; attendanceType?: unknown; homeSite?: unknown; active?: boolean | null } | null
  const company = relId(doc?.company)
  if (!doc || company === undefined) return null
  return { id: employee, company, type: attendanceTypeOf(doc.attendanceType), homeSite: relId(doc.homeSite) ?? null, active: doc.active !== false }
}

/** Server rule: may `emp` check in at a location of `kind` in PT `locationCompany`? */
export function isEligible(emp: Pick<EmployeeAttendance, 'company' | 'type'>, kind: LocationKind, locationCompany: number | undefined): boolean {
  return locationCompany === emp.company && kindAllowedFor(emp.type, kind)
}

export type EligibleLocation = {
  kind: LocationKind
  id: number
  company: number
  /** The caller's employee in that PT (one employee per PT). */
  employee: number
  code: string
  name: string
  lat: number
  lng: number
  /** Own radius, else the PT default (the radius the server checks). */
  radiusM: number
  isHeadOffice: boolean
  /** "Site penempatan" of the employee. */
  home: boolean
}

type LocRow = { kind: LocationKind; id: number; code: string | null; name: string | null; lat: string | number; lng: string | number; radius_m: string | number | null; is_head_office: boolean | null }

/**
 * Registered locations of PT `company` with a point that an employee of `type` may use. Read-only, PT-bound by the
 * bound `company_id` predicate of every branch (MC2 SQL lint). Inactive sites / cost centers and archived projects
 * are left out (the check-in would be refused VALIDATION).
 */
async function locationRows(req: PayloadRequest, company: number, type: AttendanceType): Promise<LocRow[]> {
  const sites = sql`
    SELECT 'site' AS kind, s.id, s.code, s.name, s.lat, s.lng, s.radius_m, s.is_head_office
    FROM sites s
    WHERE s.company_id = ${company} AND s.active IS NOT FALSE AND s.lat IS NOT NULL AND s.lng IS NOT NULL`
  if (type === 'non_onsite') return rows<LocRow>(req, sites)
  return rows<LocRow>(
    req,
    sql`${sites}
    UNION ALL
    SELECT 'project', p.id, p.code, p.name, p.lat, p.lng, p.radius_m, FALSE
    FROM projects p
    WHERE p.company_id = ${company} AND p.status IS DISTINCT FROM 'arsip' AND p.lat IS NOT NULL AND p.lng IS NOT NULL
    UNION ALL
    SELECT 'cost_center', cc.id, cc.code, cc.name, cc.lat, cc.lng, cc.radius_m, FALSE
    FROM cost_centers cc
    WHERE cc.company_id = ${company} AND cc.active IS NOT FALSE AND cc.lat IS NOT NULL AND cc.lng IS NOT NULL`,
  )
}

/**
 * Eligible check-in locations of the given employees (each in its own PT): home site first, then the head office,
 * the other sites, projects and cost centers (by code). Used by GET /api/v1/attendance/locations (APK, cached for
 * offline use) and the web "Absensi · Absen" page; the check-in itself re-checks everything (record.ts).
 */
export async function eligibleLocations(req: PayloadRequest, employees: readonly EmployeeAttendance[]): Promise<EligibleLocation[]> {
  const out: EligibleLocation[] = []
  for (const emp of employees) {
    if (!emp.active) continue
    const s = await settings(req, emp.company)
    for (const r of await locationRows(req, emp.company, emp.type)) {
      const radius = r.radius_m === null || r.radius_m === undefined ? null : Number(r.radius_m)
      out.push({
        kind: r.kind,
        id: Number(r.id),
        company: emp.company,
        employee: emp.id,
        code: r.code ?? '',
        name: r.name ?? '',
        lat: Number(r.lat),
        lng: Number(r.lng),
        radiusM: effectiveRadiusM(radius, s.defaultGeofenceRadiusM),
        isHeadOffice: r.kind === 'site' && r.is_head_office === true,
        home: r.kind === 'site' && emp.homeSite === Number(r.id),
      })
    }
  }
  return out.sort((a, b) => a.company - b.company || compareEligible(a, b))
}
