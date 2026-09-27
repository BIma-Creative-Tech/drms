import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { hasRole, userId } from '@/access/roles'
import { resolveScope } from '@/access/scope'

/** drizzle SQL fragment (the type is not re-exported by @payloadcms/db-postgres 3.90.1). */
export type SQL = ReturnType<typeof sql>

/**
 * Data scope of a dashboard/report read (kpi-definitions.md C5, requirements §4):
 * - all  = Finance / Owner (every request, the cash ledger);
 * - team = PM: projects / cost centers of `resolveScope()` (pm of project, manager of cost center,
 *          active pm team assignments) — never the cash ledger except cost-center summaries (K-15);
 * - own  = Staff: requests the user created or is a requester of.
 * An EMPTY team scope matches nothing (never "all"): every SQL fragment below becomes FALSE.
 * All ids are bound parameters (sql`${id}`), never string-concatenated.
 */
export type ReportScope =
  | { kind: 'all' }
  | { kind: 'team'; projects: number[]; costCenters: number[] }
  | { kind: 'own'; userId: number; employeeId: number | null }
  | { kind: 'none' }

/** Office scope of the caller: Finance/Owner → all, else PM → team, else none. */
export async function officeScope(req: PayloadRequest): Promise<ReportScope> {
  if (hasRole(req, 'pk-finance', 'pk-owner')) return { kind: 'all' }
  if (hasRole(req, 'pk-pm')) {
    const s = await resolveScope(req)
    return { kind: 'team', projects: s.teamProjects, costCenters: s.teamCostCenters }
  }
  return { kind: 'none' }
}

/**
 * Attendance report scope (S3e, requirements §4 "Admin R/U absensi", S-23): Finance / Owner / Admin
 * → all, PM → team. Admin sees attendance only — never the finance reports (officeScope → none).
 */
export async function attendanceOfficeScope(req: PayloadRequest): Promise<ReportScope> {
  if (hasRole(req, 'pk-admin')) return { kind: 'all' }
  return officeScope(req)
}

/** Team scope of the caller (PM dashboard), even when the user also holds an office role. */
export async function teamScope(req: PayloadRequest): Promise<ReportScope> {
  const s = await resolveScope(req)
  return { kind: 'team', projects: s.teamProjects, costCenters: s.teamCostCenters }
}

export async function ownScope(req: PayloadRequest): Promise<ReportScope> {
  const uid = userId(req)
  if (uid === undefined) return { kind: 'none' }
  const s = await resolveScope(req)
  return { kind: 'own', userId: uid, employeeId: s.employeeId }
}

export const idList = (ids: readonly number[]): SQL =>
  sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  )

/** `col IN (…)` or FALSE for an empty list. */
export function inList(col: SQL, ids: readonly number[]): SQL {
  return ids.length > 0 ? sql`${col} IN (${idList(ids)})` : sql`FALSE`
}

/** Row filter on `expense_requests er` for the scope. */
export function requestScopeSql(s: ReportScope): SQL {
  switch (s.kind) {
    case 'all':
      return sql`TRUE`
    case 'team':
      return sql`(${inList(sql`er.project_id`, s.projects)} OR ${inList(sql`er.cost_center_id`, s.costCenters)})`
    case 'own':
      return s.employeeId === null
        ? sql`(er.created_by_id = ${s.userId})`
        : sql`(er.created_by_id = ${s.userId} OR EXISTS (SELECT 1 FROM expense_requests_rels rr WHERE rr.parent_id = er.id AND rr.path = 'requesters' AND rr.employees_id = ${s.employeeId}))`
    default:
      return sql`FALSE`
  }
}

/** Row filter on `cash_entries ce` (project / cost center of the entry) for the scope. */
export function cashScopeSql(s: ReportScope): SQL {
  switch (s.kind) {
    case 'all':
      return sql`TRUE`
    case 'team':
      return sql`(${inList(sql`ce.project_id`, s.projects)} OR ${inList(sql`ce.cost_center_id`, s.costCenters)})`
    default:
      return sql`FALSE`
  }
}

/** Projects visible in the scope (`projects p`). */
export function projectScopeSql(s: ReportScope): SQL {
  if (s.kind === 'all') return sql`TRUE`
  if (s.kind === 'team') return inList(sql`p.id`, s.projects)
  return sql`FALSE`
}

/** Cost centers visible in the scope (`cost_centers cc`). */
export function costCenterScopeSql(s: ReportScope): SQL {
  if (s.kind === 'all') return sql`TRUE`
  if (s.kind === 'team') return inList(sql`cc.id`, s.costCenters)
  return sql`FALSE`
}

/** Manual cash entries are part of office reports only (PM: "tanpa kas manual"). */
export const includesManualCash = (s: ReportScope) => s.kind === 'all'
