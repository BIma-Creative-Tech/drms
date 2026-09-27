import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { hasRole, relId, userId } from '@/access/roles'
import { attendanceMonth } from '@/domain/reports/attendance-report'
import { idList } from '@/domain/reports/scope'
import { getRequestTx } from '@/lib/tx'

import { attendanceContext, attendanceScope, teamMembers, type AttScope } from './queries'

/**
 * E6 web (S2) — read helpers of the admin views (/admin/absensi…). Same scope rules as the
 * /api/v1/attendance endpoints (attendanceScope: office roles all, PM team, Staff none → own recap
 * only); every id is a bound parameter. Callers run inside one request transaction.
 */
type Row = Record<string, unknown>
async function rows<T = Row>(req: PayloadRequest, q: ReturnType<typeof sql>): Promise<T[]> {
  const tx = await getRequestTx(req)
  return ((await tx.execute(q)) as unknown as { rows: T[] }).rows
}

export type Opt = { id: number; label: string }

/** Employees the caller may open a recap of (month): office all active + with attendance; PM team members. */
export async function recapEmployees(req: PayloadRequest, scope: AttScope, from: string, to: string): Promise<Opt[]> {
  if (scope.kind === 'team') {
    const m = await teamMembers(req, scope, from, to)
    return m.map((x) => ({ id: x.employeeId, label: `${x.name} (${x.code})` })).sort((a, b) => a.label.localeCompare(b.label, 'id'))
  }
  const r = await rows<{ id: number; code: string; name: string }>(
    req,
    sql`SELECT e.id, e.code, e.name FROM employees e
         WHERE coalesce(e.active, true) OR EXISTS (SELECT 1 FROM attendances a WHERE a.employee_id = e.id AND a.local_date BETWEEN ${from} AND ${to})
         ORDER BY e.name, e.id`,
  )
  return r.map((x) => ({ id: Number(x.id), label: `${x.name} (${x.code})` }))
}

/** Projects / cost centers of the scope (filters of "Tim hari ini" and the team grid). */
export async function scopeLocations(req: PayloadRequest, scope: AttScope): Promise<{ projects: Opt[]; costCenters: Opt[] }> {
  const pw = scope.kind === 'all' ? sql`p.status::text <> 'arsip'` : scope.projects.length ? sql`p.id IN (${idList(scope.projects)})` : sql`FALSE`
  const cw = scope.kind === 'all' ? sql`coalesce(cc.active, true)` : scope.costCenters.length ? sql`cc.id IN (${idList(scope.costCenters)})` : sql`FALSE`
  const p = await rows<{ id: number; code: string; name: string }>(req, sql`SELECT p.id, p.code, p.name FROM projects p WHERE ${pw} ORDER BY p.code`)
  const c = await rows<{ id: number; code: string; name: string }>(req, sql`SELECT cc.id, cc.code, cc.name FROM cost_centers cc WHERE ${cw} ORDER BY cc.code`)
  return { projects: p.map((x) => ({ id: Number(x.id), label: `${x.code} ${x.name}` })), costCenters: c.map((x) => ({ id: Number(x.id), label: `${x.code} ${x.name}` })) }
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

/** Can the caller correct (T10) attendance of `employeeId`? Mirrors corrections.ts (server re-checks). */
export function mayCorrect(req: PayloadRequest, scope: AttScope | null, employeeId: number): boolean {
  if (!scope) return false
  const own = relId((req.user as { employee?: unknown } | null)?.employee)
  if (own === employeeId) return false
  return hasRole(req, 'pk-admin') || (hasRole(req, 'pk-pm') && scope.kind === 'team')
}

/** Team month grid (all members of the scope/filters), same aggregation as the M13 report. */
export async function teamMonth(req: PayloadRequest, scope: AttScope, month: string) {
  return attendanceMonth(req, scope, month)
}

export { attendanceContext, attendanceScope, userId }
