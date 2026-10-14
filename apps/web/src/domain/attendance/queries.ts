import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { membershipsOf, relId, type Role } from '@/access/roles'
import { resolveScope } from '@/access/scope'
import { settings, today } from '@/domain/expense/common'
import { companyScopeSql, idList, inList, type SQL } from '@/domain/reports/scope'
import { DEFAULT_TZ } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

import type { AttendanceFact, LocationRef, TeamMember } from './aggregate'
import { OUTSIDE_AREA_FLAG } from './area'
import { parseSnapshot, snapshotOf, type ScheduleSnapshot } from './schedule'

/**
 * E6 read side (recap, team today, report): parameterised SQL on the request transaction. Every
 * id/date is a bound parameter (sql`${v}`), never concatenated. The effective time of an
 * attendance = the NEWEST attendance-corrections row (T10), else `attendance_time`.
 */

/**
 * Attendance data scope (requirements v1.1 §4 "Absensi") PER PT (ADR 0016 §5/§6): Admin R/U, Owner R,
 * Finance R (upah) of a PT → every attendance of THAT PT; PM of a PT → the team projects/cost centers
 * there; Staff → own only (endpoints /attendance/me).
 * `parts` = one entry per PT (`all` = whole PT, else the team ids), each SQL predicate is
 * `(x.company_id = <PT> AND …)`. The top-level kind/ids are a summary (UI hints). MC4: a literal
 * WITHOUT `parts` is legacy and matches NOTHING (fail closed for `all` AND `team`).
 */
/**
 * ADR 0023: `sites` = team sites of a PM part (site check-ins, site assignments, home-site employees of those sites);
 * `onlySites` = the UI / report site filter — narrows every row of the part to those sites (an attendance by its
 * server-filled `site_id`, an assignment by its site or its project's site, a home-site employee by the home site).
 */
export type AttPart = { company: number; all: boolean; projects: number[]; costCenters: number[]; sites?: number[]; onlySites?: number[] }
export type AttScope = ({ kind: 'all' } | { kind: 'team'; projects: number[]; costCenters: number[] }) & { parts?: AttPart[] }

const OFFICE_ATT: readonly Role[] = ['pk-admin', 'pk-owner', 'pk-finance']

/** Builds the summary AttScope from per-PT parts (null when nothing is in scope). */
export function attScopeOf(parts: AttPart[]): AttScope | null {
  if (parts.length === 0) return null
  const list = [...parts].sort((a, b) => a.company - b.company)
  if (list.some((p) => p.all)) return { kind: 'all', parts: list }
  const u = (x: number[]) => [...new Set(x)].sort((a, b) => a - b)
  return { kind: 'team', projects: u(list.flatMap((p) => p.projects)), costCenters: u(list.flatMap((p) => p.costCenters)), parts: list }
}

export async function attendanceScope(req: PayloadRequest): Promise<AttScope | null> {
  const parts: AttPart[] = []
  for (const m of membershipsOf(req.user)) {
    if (m.roles.some((r) => OFFICE_ATT.includes(r))) parts.push({ company: m.company, all: true, projects: [], costCenters: [] })
    else if (m.roles.includes('pk-pm')) {
      const s = await resolveScope(req, m.company)
      parts.push({ company: m.company, all: false, projects: s.teamProjects, costCenters: s.teamCostCenters, sites: s.teamSites })
    }
  }
  return attScopeOf(parts)
}

/**
 * ADR 0023 §5: narrows every part to the site `siteId` (UI / report filter "Site") — never widens: it only adds a
 * predicate; a site of another PT matches nothing (its rows never carry that PT's company). Undefined = unchanged.
 */
export function narrowAttToSite(scope: AttScope, siteId?: number): AttScope {
  if (!siteId) return scope
  if (!scope.parts) return { kind: 'team', projects: [], costCenters: [], parts: [] } // legacy literal: fail closed (MC4)
  return { ...scope, parts: scope.parts.map((p) => ({ ...p, onlySites: [siteId] })) }
}

/** PTs of the scope visible in full (office roles). */
export const fullCompanies = (scope: AttScope): number[] => (scope.parts ?? []).filter((p) => p.all).map((p) => p.company)

/**
 * Narrows to one project / cost center PER PT (filters of the web views and the report): an office
 * PT keeps the id bound to its company (`company_id = PT AND project_id = id` → an id of another PT
 * matches nothing); a PM PT only when the id is in its team. The UI must use this, never build a
 * company-less `{ kind: 'team' }` literal from a user-supplied id.
 */
export function narrowAttScope(scope: AttScope, projectId?: number, costCenterId?: number): AttScope {
  if (!projectId && !costCenterId) return scope
  if (!scope.parts) return { kind: 'team', projects: [], costCenters: [], parts: [] } // legacy literal: fail closed (MC4)
  const parts = scope.parts.map((p) => ({
    company: p.company,
    all: false,
    projects: projectId && (p.all || p.projects.includes(projectId)) ? [projectId] : [],
    costCenters: costCenterId && (p.all || p.costCenters.includes(costCenterId)) ? [costCenterId] : [],
    ...(p.onlySites ? { onlySites: p.onlySites } : {}),
  }))
  return { kind: 'team', projects: projectId ? [projectId] : [], costCenters: costCenterId ? [costCenterId] : [], parts }
}

/**
 * Narrows the scope to the PTs `companyIds` (UI PT filter of the attendance views): never widens,
 * foreign ids are ignored. Empty / null = unchanged; nothing left = an empty scope (matches nothing).
 */
export function narrowAttToCompanies(scope: AttScope, companyIds?: readonly number[] | null): AttScope {
  if (!scope.parts) return { kind: 'team', projects: [], costCenters: [], parts: [] } // legacy literal: fail closed (MC4)
  if (!companyIds?.length) return scope
  return attScopeOf(scope.parts.filter((p) => companyIds.includes(p.company))) ?? { kind: 'team', projects: [], costCenters: [], parts: [] }
}

/**
 * Row filter on a table alias with company_id / project_id / cost_center_id / site_id columns (`a` attendances,
 * `ta` team assignments). ADR 0023: a site location = `site_id` without project / cost center (attendance rows of a
 * project also carry the project's site); `onlySites` narrows by the row's site (assignment: its site or its project's).
 */
export function locationScopeSql(scope: AttScope, alias: 'a' | 'ta'): SQL {
  const col = (c: string) => sql.raw(`${alias}.${c}`)
  const siteLoc = (sites: number[]) => (alias === 'a' ? sql`(${inList(col('site_id'), sites)} AND ${col('project_id')} IS NULL AND ${col('cost_center_id')} IS NULL)` : inList(col('site_id'), sites))
  const loc = (p: AttPart) => sql`(${inList(col('project_id'), p.projects)} OR ${inList(col('cost_center_id'), p.costCenters)} OR ${siteLoc(p.sites ?? [])})`
  const only = (sites: number[]) =>
    alias === 'a' ? inList(col('site_id'), sites) : sql`(${inList(col('site_id'), sites)} OR ${col('project_id')} IN (SELECT sp.id FROM projects sp WHERE ${inList(sql`sp.site_id`, sites)}))`
  if (!scope.parts) return sql`FALSE` // legacy literal without PT parts: fail closed (MC4)
  const out = scope.parts.map((p) => {
    const base = p.all ? sql`${col('company_id')} = ${p.company}` : sql`(${col('company_id')} = ${p.company} AND ${loc(p)})`
    return p.onlySites ? sql`(${base} AND ${only(p.onlySites)})` : base
  })
  return out.length ? sql`(${sql.join(out, sql` OR `)})` : sql`FALSE`
}

/**
 * ADR 0023 Q-S5: employees whose home site ("Site penempatan") is a location of the scope — expected at that site
 * without an assignment row. Office part: every home-site employee of the PT (narrowed by `onlySites`); PM part:
 * home-site employees of the team sites.
 */
export function homeSiteScopeSql(scope: AttScope, alias = 'e'): SQL {
  const col = (c: string) => sql.raw(`${alias}.${c}`)
  if (!scope.parts) return sql`FALSE`
  const out = scope.parts.map((p) => {
    const sites = p.all ? null : (p.sites ?? [])
    const base = sites === null ? sql`${col('home_site_id')} IS NOT NULL` : inList(col('home_site_id'), sites)
    return sql`(${col('company_id')} = ${p.company} AND ${base}${p.onlySites ? sql` AND ${inList(col('home_site_id'), p.onlySites)}` : sql``})`
  })
  return out.length ? sql`(${sql.join(out, sql` OR `)})` : sql`FALSE`
}

/** Employees of the office PTs of the scope (`e.company_id IN …`). */
export function employeeCompanySql(scope: AttScope, col: SQL = sql`e.company_id`): SQL {
  return companyScopeSql(col, fullCompanies(scope))
}

export type AttCtx = { today: string; timeZone: string; defaultScheduleId: number | null }

/** Today / TZ / default schedule of `companyId` (default: the context PT). */
export async function attendanceContext(req: PayloadRequest, companyId?: number | null): Promise<AttCtx> {
  const s = (await settings(req, companyId)) as { timezone?: string | null; defaultWorkSchedule?: unknown }
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
  site_id: number | null
  site_code: string | null
  site_name: string | null
  source: 'self' | 'pm' | null
  recorded_by_name: string | null
  corrected: boolean
  schedule: unknown
  flags: unknown
  offline: boolean | null
  outside_area: boolean | null
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
           a.site_id, st.code AS site_code, st.name AS site_name,
           a.source, CASE WHEN ru.id IS NULL THEN NULL ELSE coalesce(ru.name, 'PM #' || ru.id) END AS recorded_by_name,
           (c.new_time IS NOT NULL) AS corrected, a.schedule, a.flags, a.offline, a.outside_area
    FROM attendances a
    LEFT JOIN LATERAL (SELECT new_time FROM attendance_corrections x WHERE x.attendance_id = a.id ORDER BY x.id DESC LIMIT 1) c ON TRUE
    LEFT JOIN projects p ON p.id = a.project_id
    LEFT JOIN cost_centers cc ON cc.id = a.cost_center_id
    LEFT JOIN sites st ON st.id = a.site_id
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
        : x.cost_center_id !== null
          ? { type: 'cost_center', id: x.cost_center_id, code: x.cc_code ?? '', name: x.cc_name ?? '' }
          : { type: 'site', id: x.site_id as number, code: x.site_code ?? '', name: x.site_name ?? '' }
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
      // DRMS 13/10 A2: "Di luar area" (Non-OnSite outside every registered location) as a flag of the fact / day
      flags: [...(Array.isArray(x.flags) ? x.flags.filter((v): v is string => typeof v === 'string') : []), ...(x.outside_area === true ? [OUTSIDE_AREA_FLAG] : [])],
      offline: x.offline === true,
      ...(x.outside_area === true ? { outsideArea: true } : {}),
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

/**
 * CURRENT schedule per employee (own, else the default schedule of the employee's home site — ADR 0023 §3 —, else
 * the default schedule of the EMPLOYEE's PT; `defaultScheduleId` only when that PT has none set) — for days without
 * a check-in snapshot (ADR 0016 §6).
 */
export async function currentSchedules(req: PayloadRequest, employeeIds: number[], defaultScheduleId: number | null): Promise<Map<number, ScheduleSnapshot | null>> {
  if (employeeIds.length === 0) return new Map()
  const r = await rows<ScheduleRow>(
    req,
    sql`SELECT e.id AS employee_id, ws.id, ws.name, ws.start_time, ws.end_time, ws.late_tolerance_min, ws.active,
               ws.work_days_mon AS mon, ws.work_days_tue AS tue, ws.work_days_wed AS wed, ws.work_days_thu AS thu,
               ws.work_days_fri AS fri, ws.work_days_sat AS sat, ws.work_days_sun AS sun
        FROM employees e
        JOIN companies co ON co.id = e.company_id
        LEFT JOIN sites hs ON hs.id = e.home_site_id
        LEFT JOIN work_schedules ws ON ws.id = coalesce(e.work_schedule_id, hs.default_work_schedule_id, co.default_work_schedule_id, ${defaultScheduleId}::int) AND ws.company_id = e.company_id
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

export type EmployeeRef = { id: number; companyId: number; code: string; name: string; active: boolean }

/** Employee reference (callers check the scope / own employee before; `companyId` = its PT). */
export async function employeeRef(req: PayloadRequest, id: number): Promise<EmployeeRef | null> {
  const r = await rows<EmployeeRef & { company_id: number }>(req, sql`SELECT id, company_id, code, name, coalesce(active, true) AS active FROM employees WHERE id = ${id}`)
  return r[0] ? { id: Number(r[0].id), companyId: Number(r[0].company_id), code: r[0].code, name: r[0].name, active: r[0].active } : null
}

type MemberRow = {
  employee_id: number
  company_id: number
  code: string
  name: string
  project_id: number | null
  project_code: string | null
  project_name: string | null
  cost_center_id: number | null
  cc_code: string | null
  cc_name: string | null
  site_id: number | null
  site_code: string | null
  site_name: string | null
}

const memberLocation = (x: Pick<MemberRow, 'project_id' | 'project_code' | 'project_name' | 'cost_center_id' | 'cc_code' | 'cc_name' | 'site_id' | 'site_code' | 'site_name'>): LocationRef =>
  x.project_id !== null
    ? { type: 'project', id: Number(x.project_id), code: x.project_code ?? '', name: x.project_name ?? '' }
    : x.cost_center_id !== null
      ? { type: 'cost_center', id: Number(x.cost_center_id), code: x.cc_code ?? '', name: x.cc_name ?? '' }
      : { type: 'site', id: Number(x.site_id), code: x.site_code ?? '', name: x.site_name ?? '' }

/**
 * Employees with a team assignment active on `date` (start/end inclusive, compared on the stored
 * UTC date like the check-in rule) at a location of the scope; inactive employees are left out. ADR 0023: plus the
 * employees whose home site is a site of the scope (location = that site, no assignment row needed).
 */
export async function teamMembers(req: PayloadRequest, scope: AttScope, fromDate: string, toDate: string = fromDate, employeeId?: number): Promise<TeamMember[]> {
  const r = await rows<MemberRow>(
    req,
    sql`SELECT * FROM (
          SELECT ta.employee_id, e.company_id, e.code, e.name, ta.project_id, p.code AS project_code, p.name AS project_name,
                 ta.cost_center_id, cc.code AS cc_code, cc.name AS cc_name, ta.site_id, st.code AS site_code, st.name AS site_name, ta.id AS ord
          FROM team_assignments ta
          JOIN employees e ON e.id = ta.employee_id
          LEFT JOIN projects p ON p.id = ta.project_id
          LEFT JOIN cost_centers cc ON cc.id = ta.cost_center_id
          LEFT JOIN sites st ON st.id = ta.site_id
          WHERE coalesce(e.active, true)
            AND (ta.start_date IS NULL OR to_char(ta.start_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') <= ${toDate})
            AND (ta.end_date IS NULL OR to_char(ta.end_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') >= ${fromDate})
            AND ${employeeId === undefined ? sql`TRUE` : sql`ta.employee_id = ${employeeId}`}
            AND ${locationScopeSql(scope, 'ta')}
          UNION ALL
          SELECT e.id, e.company_id, e.code, e.name, NULL, NULL, NULL, NULL, NULL, NULL, hs.id, hs.code, hs.name, 0
          FROM employees e
          JOIN sites hs ON hs.id = e.home_site_id
          WHERE coalesce(e.active, true)
            AND ${employeeId === undefined ? sql`TRUE` : sql`e.id = ${employeeId}`}
            AND ${homeSiteScopeSql(scope, 'e')}
        ) m
        ORDER BY m.name, m.ord`,
  )
  const by = new Map<number, TeamMember>()
  for (const x of r) {
    const m = by.get(x.employee_id) ?? { employeeId: x.employee_id, companyId: Number(x.company_id), code: x.code, name: x.name, locations: [] }
    const loc = memberLocation(x)
    if (!m.locations.some((l) => l.type === loc.type && l.id === loc.id)) m.locations.push(loc)
    by.set(x.employee_id, m)
  }
  return [...by.values()]
}
