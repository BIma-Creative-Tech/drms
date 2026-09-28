import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { membershipsOf, userId, type Role } from '@/access/roles'
import { resolveScope } from '@/access/scope'

/** drizzle SQL fragment (the type is not re-exported by @payloadcms/db-postgres 3.90.1). */
export type SQL = ReturnType<typeof sql>

/**
 * Data scope of a dashboard/report read (kpi-definitions.md C5, requirements §4) PER PT (ADR 0016 §6,
 * requirements v1.2 §5): a list of per-company scopes built from the caller's SELECTED memberships and
 * the role held IN THAT PT:
 * - all  = Finance / Owner of the PT (every request of that PT, its cash ledger);
 * - team = PM of the PT: projects / cost centers of `resolveScope(req, company)` — never the cash
 *          ledger except cost-center summaries (K-15);
 * - own  = requests of the PT the user created or is a requester of (employee of that membership).
 * Every SQL fragment below is `OR` over the companies of `(x.company_id = $c AND <kind predicate>)`;
 * an empty list is FALSE — "all" never means SQL `TRUE` any more (MC2-2).
 *
 * The top-level `kind` (+ the legacy team/own fields) is a SUMMARY for UI hints (strongest kind over
 * the companies; union of the team ids). A scope WITHOUT `companies` (legacy literal such as
 * `{ kind: 'all' }`) is company-blind and is treated fail-closed: `all` matches nothing; `team`/`own`
 * keep their id predicates (ids are per PT by construction). Build scopes with the functions below.
 */
export type CompanyScope =
  | { company: number; kind: 'all' }
  | { company: number; kind: 'team'; projects: number[]; costCenters: number[] }
  | { company: number; kind: 'own'; userId: number; employeeId: number | null }

export type ScopeKind = 'all' | 'team' | 'own' | 'none'

export type ReportScope = (
  | { kind: 'all' }
  | { kind: 'team'; projects: number[]; costCenters: number[] }
  | { kind: 'own'; userId: number; employeeId: number | null }
  | { kind: 'none' }
) & { companies?: CompanyScope[] }

const RANK: Record<ScopeKind, number> = { none: 0, own: 1, team: 2, all: 3 }
const uniq = (list: Iterable<number>) => [...new Set(list)].sort((a, b) => a - b)

/** Builds a ReportScope (summary fields derived) from per-company scopes. */
export function fromCompanies(companies: CompanyScope[]): ReportScope {
  const list = [...companies].sort((a, b) => a.company - b.company)
  const kind = list.reduce<ScopeKind>((k, c) => (RANK[c.kind] > RANK[k] ? c.kind : k), 'none')
  if (kind === 'all') return { kind, companies: list }
  if (kind === 'team') {
    const teams = list.filter((c): c is Extract<CompanyScope, { kind: 'team' }> => c.kind === 'team')
    return { kind, projects: uniq(teams.flatMap((t) => t.projects)), costCenters: uniq(teams.flatMap((t) => t.costCenters)), companies: list }
  }
  if (kind === 'own') {
    const own = list.find((c): c is Extract<CompanyScope, { kind: 'own' }> => c.kind === 'own')!
    return { kind, userId: own.userId, employeeId: own.employeeId, companies: list }
  }
  return { kind: 'none', companies: [] }
}

/** Legacy literal → pseudo company scopes (company null = no company predicate; `all` → none). */
type Part = { company: number | null } & ({ kind: 'all' } | { kind: 'team'; projects: number[]; costCenters: number[] } | { kind: 'own'; userId: number; employeeId: number | null })
function parts(s: ReportScope): Part[] {
  if (s.companies) return s.companies
  if (s.kind === 'team') return [{ company: null, kind: 'team', projects: s.projects, costCenters: s.costCenters }]
  if (s.kind === 'own') return [{ company: null, kind: 'own', userId: s.userId, employeeId: s.employeeId }]
  return [] // `all` without companies: fail closed (never SQL TRUE)
}

/** Company ids covered by the scope (any kind). */
export function scopeCompanies(s: ReportScope): number[] {
  return uniq((s.companies ?? []).map((c) => c.company))
}

/** Company ids where the scope is `all` (office data: cash ledger, manual cash, queues). */
export function ledgerCompanies(s: ReportScope): number[] {
  return uniq((s.companies ?? []).filter((c) => c.kind === 'all').map((c) => c.company))
}

/** One single-company scope per PT of the scope (per-PT breakdown), ordered by company id. */
export function splitScope(s: ReportScope): Array<{ company: number; scope: ReportScope }> {
  return (s.companies ?? []).map((c) => ({ company: c.company, scope: fromCompanies([c]) }))
}

/** Narrows the scope to `companyIds` (report parameter `pt`): never widens. Empty/null = unchanged. */
export function narrowToCompanies(s: ReportScope, companyIds: readonly number[] | null | undefined): ReportScope {
  if (!companyIds || companyIds.length === 0 || !s.companies) return s
  return fromCompanies(s.companies.filter((c) => companyIds.includes(c.company)))
}

// ---------------------------------------------------------------- builders

type MRef = { company: number; roles: Role[]; employee: number | null }
const selected = (req: PayloadRequest): MRef[] => membershipsOf(req.user) as MRef[]
const holds = (m: MRef, roles: readonly Role[]) => m.roles.some((r) => roles.includes(r))

async function teamOf(req: PayloadRequest, company: number): Promise<CompanyScope> {
  const s = await resolveScope(req, company)
  return { company, kind: 'team', projects: s.teamProjects, costCenters: s.teamCostCenters }
}

/**
 * Office scope of the caller, per selected PT: Finance/Owner of that PT → all, else PM of that PT →
 * team, else nothing in that PT. "All" = the PTs where the caller holds the role (ADR 0016 §5/§6).
 */
export async function officeScope(req: PayloadRequest): Promise<ReportScope> {
  const out: CompanyScope[] = []
  for (const m of selected(req)) {
    if (holds(m, ['pk-finance', 'pk-owner'])) out.push({ company: m.company, kind: 'all' })
    else if (holds(m, ['pk-pm'])) out.push(await teamOf(req, m.company))
  }
  return fromCompanies(out)
}

/**
 * Attendance report scope (S3e, requirements §4 "Admin R/U absensi", S-23): Finance / Owner / Admin
 * of the PT → all, PM of the PT → team. Admin sees attendance only — never the finance reports.
 */
export async function attendanceOfficeScope(req: PayloadRequest): Promise<ReportScope> {
  const out: CompanyScope[] = []
  for (const m of selected(req)) {
    if (holds(m, ['pk-admin', 'pk-finance', 'pk-owner'])) out.push({ company: m.company, kind: 'all' })
    else if (holds(m, ['pk-pm'])) out.push(await teamOf(req, m.company))
  }
  return fromCompanies(out)
}

/**
 * Audit-log scope (K-16, requirements v1.2 §5 "Audit log global"): the selected PTs where the caller
 * is Owner/Admin/Finance (`all`). Rows without a PT (shared masters, accounts) are added by the
 * audit-log query for Admin/Owner (audit-log.ts).
 */
export async function auditScope(req: PayloadRequest): Promise<ReportScope> {
  return fromCompanies(selected(req).filter((m) => holds(m, ['pk-owner', 'pk-admin', 'pk-finance'])).map((m) => ({ company: m.company, kind: 'all' as const })))
}

/** `all` in every selected PT where the caller holds one of `roles` (role dashboards: Owner, Finance). */
export async function roleScope(req: PayloadRequest, roles: readonly Role[]): Promise<ReportScope> {
  return fromCompanies(selected(req).filter((m) => holds(m, roles)).map((m) => ({ company: m.company, kind: 'all' as const })))
}

/** Team scope of the caller (PM dashboard): PTs where the caller is PM, even with an office role. */
export async function teamScope(req: PayloadRequest): Promise<ReportScope> {
  const out: CompanyScope[] = []
  for (const m of selected(req)) if (holds(m, ['pk-pm'])) out.push(await teamOf(req, m.company))
  return fromCompanies(out)
}

/** Own requests per selected PT (Staff home): created by the caller or naming the PT's employee. */
export async function ownScope(req: PayloadRequest): Promise<ReportScope> {
  const uid = userId(req)
  if (uid === undefined) return { kind: 'none', companies: [] }
  return fromCompanies(selected(req).map((m) => ({ company: m.company, kind: 'own' as const, userId: uid, employeeId: m.employee })))
}

// ---------------------------------------------------------------- SQL helpers

export const idList = (ids: readonly number[]): SQL =>
  sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  )

/** `col IN (…)` or FALSE for an empty list. */
export function inList(col: SQL, ids: readonly number[]): SQL {
  return ids.length > 0 ? sql`${col} IN (${idList(ids)})` : sql`FALSE`
}

/** Company predicate `col IN (companies)` (FALSE when empty) — the helper raw SQL uses (lint: tests/unit/mc2-sql-lint). */
export function companyScopeSql(col: SQL, companyIds: readonly number[]): SQL {
  return inList(col, companyIds)
}

/** OR over the parts of `(companyCol = c AND pred(part))`; FALSE when there is none. */
function orCompanies(s: ReportScope, companyCol: SQL, pred: (p: Part) => SQL | null): SQL {
  const out: SQL[] = []
  for (const p of parts(s)) {
    const x = pred(p)
    if (!x) continue
    out.push(p.company === null ? sql`(${x})` : sql`(${companyCol} = ${p.company} AND ${x})`)
  }
  return out.length ? sql`(${sql.join(out, sql` OR `)})` : sql`FALSE`
}

/** Row filter on `expense_requests er` for the scope. */
export function requestScopeSql(s: ReportScope): SQL {
  return orCompanies(s, sql`er.company_id`, (p) => {
    if (p.kind === 'all') return sql`TRUE`
    if (p.kind === 'team') return sql`(${inList(sql`er.project_id`, p.projects)} OR ${inList(sql`er.cost_center_id`, p.costCenters)})`
    return p.employeeId === null
      ? sql`er.created_by_id = ${p.userId}`
      : sql`(er.created_by_id = ${p.userId} OR EXISTS (SELECT 1 FROM expense_requests_rels rr WHERE rr.parent_id = er.id AND rr.path = 'requesters' AND rr.employees_id = ${p.employeeId}))`
  })
}

const ALIAS = /^[a-z][a-z0-9_]{0,15}$/
const aliasCol = (alias: string, column: string): SQL => {
  if (!ALIAS.test(alias)) throw new Error(`invalid SQL alias ${alias}`)
  return sql.raw(`${alias}.${column}`)
}

/** Row filter on `cash_entries ce` (project / cost center of the entry) for the scope. */
export function cashScopeSql(s: ReportScope, alias = 'ce'): SQL {
  return orCompanies(s, aliasCol(alias, 'company_id'), (p) => {
    if (p.kind === 'all') return sql`TRUE`
    if (p.kind === 'team') return sql`(${inList(aliasCol(alias, 'project_id'), p.projects)} OR ${inList(aliasCol(alias, 'cost_center_id'), p.costCenters)})`
    return null
  })
}

/** Ledger / manual-cash rows: only PTs with an office (`all`) scope — PM: "tanpa kas manual". */
export function ledgerScopeSql(s: ReportScope, alias = 'ce'): SQL {
  return companyScopeSql(aliasCol(alias, 'company_id'), ledgerCompanies(s))
}

/** Projects visible in the scope (`projects p`). */
export function projectScopeSql(s: ReportScope, alias = 'p'): SQL {
  return orCompanies(s, aliasCol(alias, 'company_id'), (p) => (p.kind === 'all' ? sql`TRUE` : p.kind === 'team' ? inList(aliasCol(alias, 'id'), p.projects) : null))
}

/** Cost centers visible in the scope (`cost_centers cc`). */
export function costCenterScopeSql(s: ReportScope, alias = 'cc'): SQL {
  return orCompanies(s, aliasCol(alias, 'company_id'), (p) => (p.kind === 'all' ? sql`TRUE` : p.kind === 'team' ? inList(aliasCol(alias, 'id'), p.costCenters) : null))
}

/** Per-PT masters of the scope's PTs (categories, accounts, vehicles, sources): `alias.company_id IN …`. */
export function masterScopeSql(s: ReportScope, alias: string): SQL {
  return companyScopeSql(aliasCol(alias, 'company_id'), scopeCompanies(s))
}

/** Manual cash entries are part of office reports only (PM: "tanpa kas manual"): any `all` PT. */
export const includesManualCash = (s: ReportScope) => ledgerCompanies(s).length > 0
