import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { relId } from '@/access/roles'
import { settings } from '@/domain/companies'
import { rows } from '@/domain/reports/kpi'

import { attendanceTypeOf, compareEligible, type AttendanceType, type LocationKind } from './area'
import { effectiveRadiusM } from './calendar'

/**
 * DRMS 13/10 A2, ADR 0032 (DRMS 24/10): the registered check-in locations of an employee's PT, no assignment. Every
 * active location of the PT WITH a point — projects (not archived / cancelled / deleted) and cost centers (active); no
 * site any more — for both types: an OnSite employee must be inside the one chosen; a Non-OnSite employee inside any
 * of them (the containing one is picked; outside all → refused). Locations without a point never match a fix.
 */

export type EmployeeAttendance = { id: number; company: number; type: AttendanceType; active: boolean }

/** Attendance profile of one employee (PT, type); null when it does not exist. */
export async function employeeAttendance(req: PayloadRequest, employee: number): Promise<EmployeeAttendance | null> {
  const doc = (await req.payload.findByID({
    collection: 'employees',
    id: employee,
    depth: 0,
    select: { company: true, attendanceType: true, active: true } as never,
    overrideAccess: true, // SYSTEM-READ: PT + attendance type of the attendance's employee (callers resolved / checked it)
    req,
    disableErrors: true,
  })) as { id?: number; company?: unknown; attendanceType?: unknown; active?: boolean | null } | null
  const company = relId(doc?.company)
  if (!doc || company === undefined) return null
  return { id: employee, company, type: attendanceTypeOf(doc.attendanceType), active: doc.active !== false }
}

export type EligibleLocation = {
  kind: LocationKind
  id: number
  company: number
  /** The employee in that PT (one employee per PT). */
  employee: number
  code: string
  name: string
  lat: number
  lng: number
  /** Own radius, else the PT default (the radius the server checks). */
  radiusM: number
}

type LocRow = { kind: LocationKind; id: number; code: string | null; name: string | null; lat: string | number; lng: string | number; radius_m: string | number | null }

/**
 * Registered locations of PT `company` with a point. Read-only, PT-bound by the bound `company_id` predicate of every
 * branch (MC2 SQL lint). Inactive cost centers and archived / cancelled projects are left out (refused VALIDATION).
 */
async function locationRows(req: PayloadRequest, company: number): Promise<LocRow[]> {
  return rows<LocRow>(
    req,
    sql`
    SELECT 'project' AS kind, p.id, p.code, p.name, p.lat, p.lng, p.radius_m
    FROM projects p
    WHERE p.company_id = ${company} AND coalesce(p.status::text, '') NOT IN ('arsip', 'dibatalkan') AND p.is_deleted IS NOT TRUE AND p.lat IS NOT NULL AND p.lng IS NOT NULL
    UNION ALL
    SELECT 'cost_center', cc.id, cc.code, cc.name, cc.lat, cc.lng, cc.radius_m
    FROM cost_centers cc
    WHERE cc.company_id = ${company} AND cc.active IS NOT FALSE AND cc.lat IS NOT NULL AND cc.lng IS NOT NULL`,
  )
}

/**
 * Registered check-in locations of the given employees (each in its own PT): projects, then cost centers (by code).
 * Used by GET /api/v1/attendance/locations (APK, cached for offline use), the web "Absensi · Absen" / "Absenkan" pages
 * and the Non-OnSite resolution of record.ts.
 */
export async function eligibleLocations(req: PayloadRequest, employees: readonly EmployeeAttendance[]): Promise<EligibleLocation[]> {
  const out: EligibleLocation[] = []
  for (const emp of employees) {
    if (!emp.active) continue
    for (const l of await registeredLocations(req, emp.company)) out.push({ ...l, employee: emp.id })
  }
  return out.sort((a, b) => a.company - b.company || compareEligible(a, b))
}

/**
 * The registered check-in locations of PT `company` (projects, then cost centers; with a point, effective radius). The
 * same list for every employee of the PT — ADR 0032: the Admin Staff on-behalf pages (web + APK) offer it.
 */
export async function registeredLocations(req: PayloadRequest, company: number): Promise<Array<Omit<EligibleLocation, 'employee'>>> {
  const s = await settings(req, company)
  const out: Array<Omit<EligibleLocation, 'employee'>> = []
  for (const r of await locationRows(req, company)) {
    const radius = r.radius_m === null || r.radius_m === undefined ? null : Number(r.radius_m)
    out.push({
      kind: r.kind,
      id: Number(r.id),
      company,
      code: r.code ?? '',
      name: r.name ?? '',
      lat: Number(r.lat),
      lng: Number(r.lng),
      radiusM: effectiveRadiusM(radius, s.defaultGeofenceRadiusM),
    })
  }
  return out.sort(compareEligible)
}
