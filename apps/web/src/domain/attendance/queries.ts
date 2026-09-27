import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { hasRole, relId } from '@/access/roles'
import { resolveScope } from '@/access/scope'
import { settings, today } from '@/domain/expense/common'
import { idList, inList, type SQL } from '@/domain/reports/scope'
import { DEFAULT_TZ } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

import type { AttendanceFact, LocationRef, TeamMember } from './aggregate'
import { parseSnapshot, snapshotOf, type ScheduleSnapshot } from './schedule'

/**
 * E6 read side (recap, team today, report): parameterised SQL on the request transaction. Every
 * id/date is a bound parameter (sql`${v}`), never concatenated. The effective time of an
 * attendance = the NEWEST attendance-corrections row (T10), else `attendance_time`.
 */

/**
 * Attendance data scope (requirements v1.1 §4 "Absensi"): Admin R/U, Owner R all, Finance R (upah)
 * → all; PM → team projects/cost centers; Staff → own only (endpoints /attendance/me).
 */
export type AttScope = { kind: 'all' } | { kind: 'team'; projects: number[]; costCenters: number[] }

export async function attendanceScope(req: PayloadRequest): Promise<AttScope | null> {
  if (hasRole(req, 'pk-admin', 'pk-owner', 'pk-finance')) return { kind: 'all' }
  if (hasRole(req, 'pk-pm')) {
    const s = await resolveScope(req)
    return { kind: 'team', projects: s.teamProjects, costCenters: s.teamCostCenters }
  }
  return null
}

/** Row filter on a table alias with project_id / cost_center_id columns. */
export function locationScopeSql(scope: AttScope, alias: 'a' | 'ta'): SQL {
  if (scope.kind === 'all') return sql`TRUE`
  const p = alias === 'a' ? sql`a.project_id` : sql`ta.project_id`
  const c = alias === 'a' ? sql`a.cost_center_id` : sql`ta.cost_center_id`
  return sql`(${inList(p, scope.projects)} OR ${inList(c, scope.costCenters)})`
}

export type AttCtx = { today: string; timeZone: string; defaultScheduleId: number | null }

export async function attendanceContext(req: PayloadRequest): Promise<AttCtx> {
  const s = (await settings(req)) as { timezone?: string | null; defaultWorkSchedule?: unknown }
  return { today: await today(req), timeZone: s.timezone || process.env.TZ || DEFAULT_TZ, defaultScheduleId: relId(s.defaultWorkSchedule) ?? null }
}

type FactRow = {
  id: number
  employee_id: number
  kind: 'check_in' | 'check_out'
  local_date: string
  effective_time: string | Date
  project_id: number | null
  project_code: string | null
  project_name: string | null
  cost_center_id: number | null
  cc_code: string | null
  cc_name: string | null
  source: 'self' | 'pm' | null
  recorded_by_name: string | null
  corrected: boolean
  schedule: unknown
  flags: unknown
  offline: boolean | null
}

async function rows<T>(req: PayloadRequest, q: SQL): Promise<T[]> {
  const tx = await getRequestTx(req)
  return ((await tx.execute(q)) as unknown as { rows: T[] }).rows
}

/** SQL of the effective facts (shared with the reconciliation test of the attendance report). */
export function factsSql(f: { from: string; to: string; employeeIds?: number[]; scope: AttScope }): SQL {
  const emp = f.employeeIds ? (f.employeeIds.length ? sql`a.employee_id IN (${idList(f.employeeIds)})` : sql`FALSE`) : sql`TRUE`
  return sql`
    SELECT a.id, a.employee_id, a.kind, a.local_date,
           coalesce(c.new_time, a.attendance_time) AS effective_time,
           a.project_id, p.code AS project_code, p.name AS project_name,
           a.cost_center_id, cc.code AS cc_code, cc.name AS cc_name,
           a.source, CASE WHEN ru.id IS NULL THEN NULL ELSE coalesce(ru.name, 'PM #' || ru.id) END AS recorded_by_name,
           (c.new_time IS NOT NULL) AS corrected, a.schedule, a.flags, a.offline
    FROM attendances a
    LEFT JOIN LATERAL (SELECT new_time FROM attendance_corrections x WHERE x.attendance_id = a.id ORDER BY x.id DESC LIMIT 1) c ON TRUE
    LEFT JOIN projects p ON p.id = a.project_id
    LEFT JOIN cost_centers cc ON cc.id = a.cost_center_id
    LEFT JOIN users ru ON ru.id = a.recorded_by_id
    WHERE a.local_date BETWEEN ${f.from} AND ${f.to} AND ${emp} AND ${locationScopeSql(f.scope, 'a')}
    ORDER BY a.employee_id, a.local_date, effective_time, a.id`
}

export async function loadFacts(req: PayloadRequest, f: { from: string; to: string; employeeIds?: number[]; scope: AttScope }): Promise<AttendanceFact[]> {
  const r = await rows<FactRow>(req, factsSql(f))
  return r.map((x) => {
    const location: LocationRef =
      x.project_id !== null
        ? { type: 'project', id: x.project_id, code: x.project_code ?? '', name: x.project_name ?? '' }
        : { type: 'cost_center', id: x.cost_center_id as number, code: x.cc_code ?? '', name: x.cc_name ?? '' }
    return {
      id: x.id,
      employeeId: x.employee_id,
      kind: x.kind,
      localDate: x.local_date,
      time: new Date(x.effective_time),
      location,
      source: x.source === 'pm' ? 'pm' : 'self',
      recordedByName: x.recorded_by_name,
      corrected: x.corrected === true,
      schedule: parseSnapshot(x.schedule),
      flags: Array.isArray(x.flags) ? x.flags.filter((v): v is string => typeof v === 'string') : [],
      offline: x.offline === true,
    }
  })
}

export async function loadHolidays(req: PayloadRequest, from: string, to: string): Promise<Map<string, string>> {
  const r = await rows<{ date: string; name: string }>(req, sql`SELECT date, name FROM holidays WHERE date BETWEEN ${from} AND ${to}`)
  return new Map(r.map((x) => [x.date, x.name]))
}

type ScheduleRow = {
  employee_id: number
  id: number | null
  name: string | null
  start_time: string | null
  end_time: string | null
  late_tolerance_min: string | number | null
  active: boolean | null
  mon: boolean | null
  tue: boolean | null
  wed: boolean | null
  thu: boolean | null
  fri: boolean | null
  sat: boolean | null
  sun: boolean | null
}

/** CURRENT schedule per employee (own, else company default) — for days without a check-in snapshot. */
export async function currentSchedules(req: PayloadRequest, employeeIds: number[], defaultScheduleId: number | null): Promise<Map<number, ScheduleSnapshot | null>> {
  if (employeeIds.length === 0) return new Map()
  const r = await rows<ScheduleRow>(
    req,
    sql`SELECT e.id AS employee_id, ws.id, ws.name, ws.start_time, ws.end_time, ws.late_tolerance_min, ws.active,
               ws.work_days_mon AS mon, ws.work_days_tue AS tue, ws.work_days_wed AS wed, ws.work_days_thu AS thu,
               ws.work_days_fri AS fri, ws.work_days_sat AS sat, ws.work_days_sun AS sun
        FROM employees e
        LEFT JOIN work_schedules ws ON ws.id = coalesce(e.work_schedule_id, ${defaultScheduleId}::int)
        WHERE e.id IN (${idList(employeeIds)})`,
  )
  return new Map(
    r.map((x) => [
      x.employee_id,
      x.id === null
        ? null
        : snapshotOf({
            id: x.id,
            name: x.name,
            startTime: x.start_time,
            endTime: x.end_time,
            lateToleranceMin: x.late_tolerance_min === null ? null : Number(x.late_tolerance_min),
            active: x.active,
            workDays: { mon: x.mon, tue: x.tue, wed: x.wed, thu: x.thu, fri: x.fri, sat: x.sat, sun: x.sun },
          }),
    ]),
  )
}

export type EmployeeRef = { id: number; code: string; name: string; active: boolean }

export async function employeeRef(req: PayloadRequest, id: number): Promise<EmployeeRef | null> {
  const r = await rows<EmployeeRef>(req, sql`SELECT id, code, name, coalesce(active, true) AS active FROM employees WHERE id = ${id}`)
  return r[0] ?? null
}

type MemberRow = {
  employee_id: number
  code: string
  name: string
  project_id: number | null
  project_code: string | null
  project_name: string | null
  cost_center_id: number | null
  cc_code: string | null
  cc_name: string | null
}

/**
 * Employees with a team assignment active on `date` (start/end inclusive, compared on the stored
 * UTC date like the check-in rule) at a location of the scope; inactive employees are left out.
 */
export async function teamMembers(req: PayloadRequest, scope: AttScope, fromDate: string, toDate: string = fromDate, employeeId?: number): Promise<TeamMember[]> {
  const r = await rows<MemberRow>(
    req,
    sql`SELECT ta.employee_id, e.code, e.name, ta.project_id, p.code AS project_code, p.name AS project_name,
               ta.cost_center_id, cc.code AS cc_code, cc.name AS cc_name
        FROM team_assignments ta
        JOIN employees e ON e.id = ta.employee_id
        LEFT JOIN projects p ON p.id = ta.project_id
        LEFT JOIN cost_centers cc ON cc.id = ta.cost_center_id
        WHERE coalesce(e.active, true)
          AND (ta.start_date IS NULL OR to_char(ta.start_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') <= ${toDate})
          AND (ta.end_date IS NULL OR to_char(ta.end_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') >= ${fromDate})
          AND ${employeeId === undefined ? sql`TRUE` : sql`ta.employee_id = ${employeeId}`}
          AND ${locationScopeSql(scope, 'ta')}
        ORDER BY e.name, ta.id`,
  )
  const by = new Map<number, TeamMember>()
  for (const x of r) {
    const m = by.get(x.employee_id) ?? { employeeId: x.employee_id, code: x.code, name: x.name, locations: [] }
    const loc: LocationRef =
      x.project_id !== null
        ? { type: 'project', id: x.project_id, code: x.project_code ?? '', name: x.project_name ?? '' }
        : { type: 'cost_center', id: x.cost_center_id as number, code: x.cc_code ?? '', name: x.cc_name ?? '' }
    if (!m.locations.some((l) => l.type === loc.type && l.id === loc.id)) m.locations.push(loc)
    by.set(x.employee_id, m)
  }
  return [...by.values()]
}
