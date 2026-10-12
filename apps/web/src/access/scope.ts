import type { PayloadRequest, Where } from 'payload'

import { DEFAULT_TZ, startOfLocalDay } from '@/lib/time'

import { membershipsOf, relId, userId } from './roles'

/**
 * Scope data of the current user (architecture §7.1) PER PT (ADR 0016 §5), resolved once per
 * request and PT and cached in `req.context.pkScope`:
 * - team      = projects of the PT with `pm = user`, or active `team-assignments` (roleInProject = pm)
 *               of the user's employee IN THAT PT; cost centers with `manager = user` or a pm assignment;
 * - assigned  = projects / cost centers of any active `team-assignments` of that employee.
 * - sites (ADR 0023): team = sites of a pm-role site assignment + sites of the team projects (on-behalf, Q-S5);
 *   assigned = sites of any active site assignment + the employee's home site ("Site penempatan") + team sites.
 * `companyId = null` = union over every selected PT (collections without a company column).
 */
export type Scope = {
  userId: number
  companyId: number | null
  /** Employee of the membership (first one for the union scope). */
  employeeId: number | null
  employeeIds: number[]
  teamProjects: number[]
  assignedProjects: number[]
  teamCostCenters: number[]
  assignedCostCenters: number[]
  teamSites: number[]
  assignedSites: number[]
}

const EMPTY: Omit<Scope, 'userId' | 'companyId'> = {
  employeeId: null,
  employeeIds: [],
  teamProjects: [],
  assignedProjects: [],
  teamCostCenters: [],
  assignedCostCenters: [],
  teamSites: [],
  assignedSites: [],
}

type AssignmentRow = { project?: unknown; costCenter?: unknown; site?: unknown; roleInProject?: unknown }

const sortU = (s: Iterable<number>) => [...new Set(s)].sort((a, b) => a - b)

export async function resolveScope(req: PayloadRequest, companyId: number | null = null): Promise<Scope> {
  const uid = userId(req)
  if (uid === undefined) return { userId: -1, companyId, ...EMPTY }
  const key = `${uid}:${companyId ?? '*'}`
  req.context ??= {}
  const cache = (req.context.pkScope ??= {}) as Record<string, Scope>
  if (cache[key]) return cache[key]

  const members = membershipsOf(req.user, { all: companyId !== null }).filter((m) => companyId === null || m.company === companyId)
  const companies = members.map((m) => m.company)
  const employeeIds = sortU(members.map((m) => m.employee).filter((e): e is number => typeof e === 'number'))
  if (companies.length === 0) {
    const s: Scope = { userId: uid, companyId, ...EMPTY }
    cache[key] = s
    return s
  }
  const now = new Date()
  const today = startOfLocalDay(now, process.env.TZ || DEFAULT_TZ)
  const inCompany: Where = { company: { in: companies } }

  // SYSTEM-READ (overrideAccess): access functions must not recurse into access control.
  const [pmProjects, managedCostCenters, assignments, homes] = await Promise.all([
    req.payload.find({
      collection: 'projects',
      where: { and: [{ pm: { equals: uid } }, inCompany] },
      depth: 0,
      pagination: false,
      select: { code: true },
      overrideAccess: true, // SYSTEM-READ: scope resolution
      req,
    }),
    req.payload.find({
      collection: 'cost-centers',
      where: { and: [{ manager: { equals: uid } }, inCompany] },
      depth: 0,
      pagination: false,
      select: { code: true },
      overrideAccess: true, // SYSTEM-READ: scope resolution
      req,
    }),
    employeeIds.length === 0
      ? Promise.resolve({ docs: [] as AssignmentRow[] })
      : req.payload.find({
          collection: 'team-assignments',
          where: {
            and: [
              { employee: { in: employeeIds } },
              { or: [{ startDate: { exists: false } }, { startDate: { less_than_equal: now.toISOString() } }] },
              { or: [{ endDate: { exists: false } }, { endDate: { greater_than_equal: today.toISOString() } }] },
            ],
          },
          depth: 0,
          pagination: false,
          select: { project: true, costCenter: true, site: true, roleInProject: true },
          overrideAccess: true, // SYSTEM-READ: scope resolution
          req,
        }),
    // ADR 0023: home site ("Site penempatan") of the user's employee(s)
    employeeIds.length === 0
      ? Promise.resolve({ docs: [] as Array<{ homeSite?: unknown }> })
      : req.payload.find({
          collection: 'employees',
          where: { id: { in: employeeIds } },
          depth: 0,
          pagination: false,
          select: { homeSite: true },
          overrideAccess: true, // SYSTEM-READ: scope resolution
          req,
        }),
  ])

  const team = new Set<number>(pmProjects.docs.map((d) => d.id as number))
  const assigned = new Set<number>()
  const teamCc = new Set<number>(managedCostCenters.docs.map((d) => d.id as number))
  const assignedCc = new Set<number>()
  const teamSite = new Set<number>()
  const assignedSite = new Set<number>()
  for (const e of homes.docs as Array<{ homeSite?: unknown }>) {
    const h = relId(e.homeSite)
    if (h !== undefined) assignedSite.add(h)
  }
  for (const a of assignments.docs as AssignmentRow[]) {
    const p = relId(a.project)
    const c = relId(a.costCenter)
    const st = relId(a.site)
    if (st !== undefined) {
      assignedSite.add(st)
      if (a.roleInProject === 'pm') teamSite.add(st)
    }
    if (p !== undefined) {
      assigned.add(p)
      if (a.roleInProject === 'pm') team.add(p)
    }
    if (c !== undefined) {
      assignedCc.add(c)
      if (a.roleInProject === 'pm') teamCc.add(c)
    }
  }
  // ADR 0023 Q-S5: the PM of a project of a site may record on-behalf at that site
  if (team.size > 0) {
    const ofTeam = await req.payload.find({
      collection: 'projects',
      where: { and: [{ id: { in: [...team] } }, { site: { exists: true } }] },
      depth: 0,
      pagination: false,
      select: { site: true },
      overrideAccess: true, // SYSTEM-READ: scope resolution
      req,
    })
    for (const d of ofTeam.docs as Array<{ site?: unknown }>) {
      const st = relId(d.site)
      if (st !== undefined) teamSite.add(st)
    }
  }
  const scope: Scope = {
    userId: uid,
    companyId,
    employeeId: employeeIds[0] ?? null,
    employeeIds,
    teamProjects: sortU(team),
    assignedProjects: sortU([...assigned, ...team]),
    teamCostCenters: sortU(teamCc),
    assignedCostCenters: sortU([...assignedCc, ...teamCc]),
    teamSites: sortU(teamSite),
    assignedSites: sortU([...assignedSite, ...teamSite]),
  }
  cache[key] = scope
  return scope
}

/**
 * A `Where` no row matches (ids are serial, never 0). QA-28: a role that HAS a scoped read rule but
 * nothing in scope (staff without assignments, PM without a team) reads an EMPTY list — `false` made
 * Payload answer 403, which broke relationship pickers (e.g. "Pusat biaya" on the staff request form
 * → 403 on /api/cost-centers). Roles without any rule are still refused (403) by `byRole`.
 */
export const NO_ROWS: Where = { id: { equals: 0 } }

/** `{ field: { in: ids } }`, or `NO_ROWS` when there is nothing in scope (never an empty IN). */
export function inIds(field: string, ids: readonly number[]): Where {
  return ids.length > 0 ? { [field]: { in: [...ids] } } : NO_ROWS
}
