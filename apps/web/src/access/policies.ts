import type { Access, AccessArgs, FieldAccess, PayloadRequest, Where } from 'payload'

import { hasRoleAny, userRoles, type Role } from './roles'
import { inIds, resolveScope, type Scope } from './scope'

/**
 * Per-role access rules → one Payload access function (requirements v1.1 §4, architecture §7.2).
 * Permissions of several roles are the UNION: any `true` wins, `Where`s are OR-ed, no match = false.
 * Rules never use overrideAccess except inside resolveScope (SYSTEM-READ).
 */
export type Rule = true | ((ctx: { req: PayloadRequest; scope: () => Promise<Scope> }) => Where | boolean | Promise<Where | boolean>)

export function byRole(rules: Partial<Record<Role, Rule>>): Access {
  return async ({ req }: AccessArgs) => {
    const roles = userRoles(req)
    if (roles.length === 0) return false
    const wheres: Where[] = []
    const scope = () => resolveScope(req)
    for (const role of roles) {
      const rule = rules[role]
      if (rule === undefined) continue
      if (rule === true) return true
      const res = await rule({ req, scope })
      if (res === true) return true
      if (res) wheres.push(res)
    }
    if (wheres.length === 0) return false
    return wheres.length === 1 ? (wheres[0] as Where) : { or: wheres }
  }
}

/** Boolean-only variant (create access cannot use `Where`). */
export function rolesAllowed(...roles: Role[]): Access {
  return ({ req }) => hasRoleAny(req, ...roles)
}

/** Field-level access (boolean only). */
export function fieldRoles(...roles: Role[]): FieldAccess {
  return ({ req }) => hasRoleAny(req, ...roles)
}

export const fieldNever: FieldAccess = () => false

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
    if (wheres.length === 0) return false
    return wheres.length === 1 ? (wheres[0] as Where) : { or: wheres }
  }
}

/** Records owned by the current user through `field` (a users relationship). */
export const ownUser =
  (field: string): Rule =>
  ({ req }) => {
    const id = (req.user as { id?: unknown } | null)?.id
    return typeof id === 'number' ? { [field]: { equals: id } } : false
  }

/** Records owned by the current user's employee through `field` (an employees relationship). */
export const ownEmployee =
  (field: string): Rule =>
  async ({ scope }) => {
    const s = await scope()
    return s.employeeId === null ? false : { [field]: { equals: s.employeeId } }
  }
