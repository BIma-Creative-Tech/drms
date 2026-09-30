import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { hasRole, ownEmployees, relId, userId } from '@/access/roles'
import { attendanceMonth } from '@/domain/reports/attendance-report'
import { companyScopeSql, idList, inList } from '@/domain/reports/scope'
import { getRequestTx } from '@/lib/tx'

import { attendanceContext, attendanceScope, employeeCompanySql, fullCompanies, narrowAttScope, narrowAttToCompanies, teamMembers, type AttScope } from './queries'

/**
 * E6 web (S2) — read helpers of the admin views (/admin/absensi…). Same scope rules as the
 * /api/v1/attendance endpoints (attendanceScope: office roles all, PM team, Staff none → own recap
 * only); every id is a bound parameter. Callers run inside one request transaction.
 * MC2: every query is limited per PT by the AttScope parts (office PTs in full, PM PTs team only).
 */
type Row = Record<string, unknown>
async function rows<T = Row>(req: PayloadRequest, q: ReturnType<typeof sql>): Promise<T[]> {
  const tx = await getRequestTx(req)
  return ((await tx.execute(q)) as unknown as { rows: T[] }).rows
}

/** Option of the attendance filters; `companyId` = PT of the employee / location (MC2 labels). */
export type Opt = { id: number; label: string; companyId: number | null }

/** Employees the caller may open a recap of (month): office all active + with attendance; PM team members. */
export async function recapEmployees(req: PayloadRequest, scope: AttScope, from: string, to: string): Promise<Opt[]> {
  const out = new Map<number, { label: string; companyId: number | null }>()
  const teamParts = scope.parts?.filter((p) => !p.all) ?? []
  const team: AttScope | null = teamParts.length ? { kind: 'team', projects: [], costCenters: [], parts: teamParts } : null // legacy literal: nothing (MC4)
  if (team) for (const x of await teamMembers(req, team, from, to)) out.set(x.employeeId, { label: `${x.name} (${x.code})`, companyId: x.companyId ?? null })
  if (fullCompanies(scope).length > 0) {
    const r = await rows<{ id: number; code: string; name: string; company_id: number }>(
      req,
      sql`SELECT e.id, e.code, e.name, e.company_id FROM employees e
           WHERE ${employeeCompanySql(scope)}
             AND (coalesce(e.active, true) OR EXISTS (SELECT 1 FROM attendances a WHERE a.employee_id = e.id AND a.local_date BETWEEN ${from} AND ${to}))
           ORDER BY e.name, e.id`,
    )
    for (const x of r) out.set(Number(x.id), { label: `${x.name} (${x.code})`, companyId: Number(x.company_id) })
  }
  return [...out.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.label.localeCompare(b.label, 'id') || a.id - b.id)
}

/** Projects / cost centers of the scope (filters of "Tim hari ini" and the team grid). */
export async function scopeLocations(req: PayloadRequest, scope: AttScope): Promise<{ projects: Opt[]; costCenters: Opt[] }> {
  const full = fullCompanies(scope)
  const teamP = (scope.parts ?? []).filter((p) => !p.all).flatMap((p) => p.projects) // legacy literal: nothing (MC4)
  const teamC = (scope.parts ?? []).filter((p) => !p.all).flatMap((p) => p.costCenters)
  const pw = sql`((${companyScopeSql(sql`p.company_id`, full)} AND p.status::text <> 'arsip') OR ${inList(sql`p.id`, teamP)})`
  const cw = sql`((${companyScopeSql(sql`cc.company_id`, full)} AND coalesce(cc.active, true)) OR ${inList(sql`cc.id`, teamC)})`
  const p = await rows<{ id: number; code: string; name: string; company_id: number }>(req, sql`SELECT p.id, p.code, p.name, p.company_id FROM projects p WHERE ${pw} ORDER BY p.code`)
  const c = await rows<{ id: number; code: string; name: string; company_id: number }>(req, sql`SELECT cc.id, cc.code, cc.name, cc.company_id FROM cost_centers cc WHERE ${cw} ORDER BY cc.code`)
  const opt = (x: { id: number; code: string; name: string; company_id: number }) => ({ id: Number(x.id), label: `${x.code} ${x.name}`, companyId: Number(x.company_id) })
  return { projects: p.map(opt), costCenters: c.map(opt) }
}

export type CorrectionRow = { id: number; attendanceId: number; kind: 'check_in' | 'check_out'; localDate: string; oldTime: string; newTime: string; reason: string; by: string; at: string }

/** T10 history of an employee in a date range, limited to the caller's read access (collection rules). */
export async function correctionHistory(req: PayloadRequest, employeeId: number, from: string, to: string): Promise<CorrectionRow[]> {
  const res = await req.payload.find({
    collection: 'attendance-corrections',
    where: { and: [{ employee: { equals: employeeId } }, { localDate: { greater_than_equal: from } }, { localDate: { less_than_equal: to } }] },
    sort: '-id',
    limit: 200,
    depth: 1,
    user: req.user,
    overrideAccess: false,
    req,
  })
  return res.docs.map((d) => {
    const x = d as unknown as { id: number; attendance: unknown; kind: 'check_in' | 'check_out'; localDate: string; oldTime: string; newTime: string; reason: string; correctedBy?: { name?: string | null; id?: number } | number | null; correctedAt: string }
    // Staff cannot read other users (depth 1 → id only): show the role instead of an internal id.
    const by = typeof x.correctedBy === 'object' && x.correctedBy?.name ? x.correctedBy.name : 'PM tim / Admin'
    return { id: x.id, attendanceId: relId(x.attendance) ?? 0, kind: x.kind, localDate: x.localDate, oldTime: x.oldTime, newTime: x.newTime, reason: x.reason, by, at: x.correctedAt }
  })
}

/** Selfie state per attendance id: true = file present (not removed by retention). */
export async function selfieState(req: PayloadRequest, attendanceIds: number[]): Promise<Map<number, boolean>> {
  if (attendanceIds.length === 0) return new Map()
  const r = await rows<{ id: number; ok: boolean }>(
    req,
    sql`SELECT a.id, (m.id IS NOT NULL AND m.removed_at IS NULL) AS ok FROM attendances a LEFT JOIN media_selfies m ON m.id = a.selfie_id WHERE a.id IN (${idList(attendanceIds)})`,
  )
  return new Map(r.map((x) => [Number(x.id), x.ok === true]))
}

/**
 * Can the caller correct (T10) attendance of `employeeId` (of PT `companyId`)? Mirrors corrections.ts
 * (server re-checks): never the own employee (any PT); Admin OF THE EMPLOYEE'S PT, or PM there with a
 * team scope. Without `companyId`: any PT of the scope. A scope without PT parts → false (MC4).
 */
export function mayCorrect(req: PayloadRequest, scope: AttScope | null, employeeId: number, companyId?: number): boolean {
  if (!scope) return false
  if (ownEmployees(req).includes(employeeId) || relId((req.user as { employee?: unknown } | null)?.employee) === employeeId) return false
  if (!scope.parts) return false // legacy literal without PT parts: fail closed (MC4)
  const pts = companyId !== undefined ? [companyId] : scope.parts.map((p) => p.company)
  return pts.some((c) => hasRole(req, 'pk-admin', c) || (hasRole(req, 'pk-pm', c) && scope.parts!.some((p) => p.company === c && !p.all)))
}

/** Team month grid (all members of the scope/filters), same aggregation as the M13 report. */
export async function teamMonth(req: PayloadRequest, scope: AttScope, month: string) {
  return attendanceMonth(req, scope, month)
}

export { attendanceContext, attendanceScope, narrowAttScope, narrowAttToCompanies, userId }
