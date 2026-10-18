import type { Access, AccessArgs, FieldAccess, PayloadRequest, Where } from 'payload'

import { companiesWithRole, hasRole, hasRoleAny, isGroupAdmin, membershipsOf, relId, rolesIn, userRoles, type Role } from './roles'
import { employeesOnProjects, inIds, NO_ROWS, resolveScope, type Scope } from './scope'

/**
 * Per-role access rules → one Payload access function (requirements v1.1 §4, architecture §7.2),
 * evaluated PER PT (ADR 0016 §5): for every selected PT, the caller's roles IN THAT PT pick their
 * rules; a `true` rule means "all rows of that PT", a `Where` is AND-ed with `company = PT`; the
 * results of all PTs are OR-ed. "See all" therefore means "all rows of the PTs where I hold the
 * role". Collections without a company column use `byRoleAny` (shared masters / per-user rows).
 * Rules never use overrideAccess except inside resolveScope (SYSTEM-READ).
 */
export type RuleCtx = { req: PayloadRequest; scope: () => Promise<Scope>; companyId: number | null }
export type Rule = true | ((ctx: RuleCtx) => Where | boolean | Promise<Where | boolean>)

function combine(wheres: Where[]): Where | false {
  if (wheres.length === 0) return false
  return wheres.length === 1 ? (wheres[0] as Where) : { or: wheres }
}

async function evalRules(rules: Partial<Record<Role, Rule>>, roles: readonly Role[], ctx: RuleCtx): Promise<true | Where[]> {
  const wheres: Where[] = []
  for (const role of roles) {
    const rule = rules[role]
    if (rule === undefined) continue
    if (rule === true) return true
    const res = await rule(ctx)
    if (res === true) return true
    if (res) wheres.push(res)
  }
  return wheres
}

/** Per-PT rules on a collection with a `company` column (`companyField`, default 'company'). */
export function byRole(rules: Partial<Record<Role, Rule>>, opts: { companyField?: string } = {}): Access {
  const field = opts.companyField ?? 'company'
  return async ({ req }: AccessArgs) => {
    const all: number[] = []
    const wheres: Where[] = []
    for (const m of membershipsOf(req.user)) {
      const res = await evalRules(rules, m.roles, { req, scope: () => resolveScope(req, m.company), companyId: m.company })
      if (res === true) all.push(m.company)
      else if (res.length > 0) {
        const w = combine(res) as Where
        wheres.push({ and: [{ [field]: { equals: m.company } }, w] })
      }
    }
    if (all.length > 0) wheres.unshift({ [field]: { in: all } })
    return combine(wheres)
  }
}

/**
 * Rules evaluated with the roles held in ANY selected PT, no company filter — only for collections
 * without a company column (shared masters banks/UoM/holidays, per-user rows, app-wide texts).
 * Scope rules get the scope of every selected PT merged (union).
 */
export function byRoleAny(rules: Partial<Record<Role, Rule>>): Access {
  return async ({ req }: AccessArgs) => {
    const roles = userRoles(req)
    if (roles.length === 0) return false
    const res = await evalRules(rules, roles, { req, scope: () => resolveScope(req, null), companyId: null })
    return res === true ? true : combine(res)
  }
}

/**
 * Create access (boolean only): with `data.company` the role must be held IN that PT; without it
 * (derived-company collections, or the admin "may I create?" probe) in any selected PT — in BOTH
 * cases the company hook (`fields/company.ts`) re-checks the role in the resolved PT before the write.
 */
/** `req.context` key: roles a create must hold in the PT resolved by the company hook. */
export const PENDING_CREATE_ROLES = 'pkCreateRoles'

export function rolesAllowed(...roles: Role[]): Access {
  return ({ req, data }) => {
    const c = relId((data as { company?: unknown } | undefined)?.company)
    if (c !== undefined ? !hasRole(req, roles, c) : !hasRoleAny(req, ...roles)) return false
    // ALWAYS re-checked in the PT the company hook resolves (fields/company.ts): on a DERIVED-company
    // collection the body `company` is dropped by field access and the PT comes from the parent, so a
    // role in the named PT proves nothing (MC4 QA finding QA-MC4-01).
    req.context ??= {}
    req.context[PENDING_CREATE_ROLES] = roles
    return true
  }
}

/** `rolesAllowed` for collections WITHOUT a company column (shared masters): any selected PT. */
export function rolesAllowedAny(...roles: Role[]): Access {
  return ({ req }) => hasRoleAny(req, ...roles)
}

/**
 * Field-level access (boolean only): roles in the document's PT when known (`doc` / `data` /
 * `siblingData` carry `company`), else in any selected PT.
 */
export function fieldRoles(...roles: Role[]): FieldAccess {
  return ({ req, doc, data, siblingData }) => {
    const c = relId((doc as { company?: unknown } | undefined)?.company) ?? relId((data as { company?: unknown } | undefined)?.company) ?? relId((siblingData as { company?: unknown } | undefined)?.company)
    return c !== undefined ? rolesIn(req, c).some((r) => roles.includes(r)) : hasRoleAny(req, ...roles)
  }
}

export const fieldNever: FieldAccess = () => false

/** Every member (any role) of the row's PT — replaces `anyRole` on per-PT masters. */
export const anyMember: Access = byRole({ 'pk-staff': true, 'pk-pm': true, 'pk-finance': true, 'pk-owner': true, 'pk-admin': true })

// ---- reusable scope rules --------------------------------------------------------------------

/** Records whose `field` (a project relationship) is in the user's team projects. */
export const teamProjects =
  (field = 'project'): Rule =>
  async ({ scope }) =>
    inIds(field, (await scope()).teamProjects)

/** Records whose `field` (a project relationship) is in the user's assigned projects. */
export const assignedProjects =
  (field = 'project'): Rule =>
  async ({ scope }) =>
    inIds(field, (await scope()).assignedProjects)

export const teamCostCenters =
  (field = 'costCenter'): Rule =>
  async ({ scope }) =>
    inIds(field, (await scope()).teamCostCenters)

export const assignedCostCenters =
  (field = 'costCenter'): Rule =>
  async ({ scope }) =>
    inIds(field, (await scope()).assignedCostCenters)

/** ADR 0023: records whose `field` (a site relationship) is in the user's team sites. */
export const teamSites =
  (field = 'site'): Rule =>
  async ({ scope }) =>
    inIds(field, (await scope()).teamSites)

/** D1810 (owner 2026-10-18): records whose `field` (an employees relationship) is a member of one of the user's team projects. */
export const teamProjectEmployees =
  (field = 'employee'): Rule =>
  async ({ req, scope }) =>
    inIds(field, await employeesOnProjects(req, (await scope()).teamProjects))

/** Combines rules for one role with OR (e.g. PM: team projects OR team cost centers). */
export function anyOf(...rules: Rule[]): Rule {
  return async (ctx) => {
    const wheres: Where[] = []
    for (const r of rules) {
      if (r === true) return true
      const res = await r(ctx)
      if (res === true) return true
      if (res) wheres.push(res)
    }
    return combine(wheres)
  }
}

/** Records owned by the current user through `field` (a users relationship). */
export const ownUser =
  (field: string): Rule =>
  ({ req }) => {
    const id = (req.user as { id?: unknown } | null)?.id
    return typeof id === 'number' ? { [field]: { equals: id } } : false
  }

/** Records owned by the current user's employee (of that PT) through `field` (an employees relationship). */
export const ownEmployee =
  (field: string): Rule =>
  async ({ scope }) => {
    const s = await scope()
    // QA-28: nothing in scope → an empty list (NO_ROWS), not a 403
    return s.employeeIds.length === 0 ? NO_ROWS : s.employeeIds.length === 1 ? { [field]: { equals: s.employeeIds[0] } } : { [field]: { in: s.employeeIds } }
  }

/**
 * Rows of USERS that belong to the caller's PTs (ADR 0016 §5 for per-user collections): `field`
 * (a users relationship, or `id` on `users`) in the users with a membership in a selected PT where
 * the caller holds one of `roles`, plus accounts without any membership yet (onboarding: an Admin
 * creates the account, then assigns it to a PT). Group admins see every user.
 */
export const usersOfMyCompanies =
  (field: string, roles: readonly Role[]): Rule =>
  async ({ req }) => {
    if (isGroupAdmin(req)) return true
    const companies = companiesWithRole(req, roles)
    if (companies.length === 0) return false
    const all = await req.payload.find({
      collection: 'company-memberships',
      depth: 0,
      pagination: false,
      select: { user: true, company: true },
      overrideAccess: true, // SYSTEM-READ: access rule (users of the caller's PTs)
      req,
    })
    const mine = new Set<number>()
    const anyMembership = new Set<number>()
    for (const m of all.docs as unknown as Array<{ user: unknown; company: unknown }>) {
      const u = relId(m.user)
      if (u === undefined) continue
      anyMembership.add(u)
      if (companies.includes(relId(m.company) ?? -1)) mine.add(u)
    }
    const or: Where[] = []
    if (mine.size > 0) or.push({ [field]: { in: [...mine] } })
    if (anyMembership.size > 0) or.push({ [field]: { not_in: [...anyMembership] } })
    else or.push({ [field]: { exists: true } })
    return combine(or)
  }
