import type { PayloadRequest } from 'payload'

import { employeeIn, hasRole, relId } from '@/access/roles'
import { resolveScope } from '@/access/scope'
import { adminCreatePrefill } from '@/domain/employee-user-link'

/**
 * ADR 0023 (sites = kantor cabang of a PT) — small shared helpers. The attendance rules live in
 * domain/attendance/record.ts, the report predicate in domain/reports/scope.ts.
 */

type CostCenterSeed = { company?: unknown; code?: string | null; name?: string | null; lat?: number | null; lng?: number | null; radiusM?: number | null }

/** Request-local cache of the cost center named by `?costCenter=` (one read per form build). */
async function seedOf(req: PayloadRequest, id: number): Promise<CostCenterSeed | null> {
  req.context ??= {}
  const cache = (req.context.pkSiteSeed ??= new Map<number, Promise<CostCenterSeed | null>>()) as Map<number, Promise<CostCenterSeed | null>>
  if (!cache.has(id)) {
    cache.set(
      id,
      req.payload
        // the caller's own read access (Admin / Direktur read every cost center of their PTs); nothing visible → no prefill
        .findByID({ collection: 'cost-centers', id, depth: 0, user: req.user, overrideAccess: false, req, disableErrors: true })
        .then((d) => (d as CostCenterSeed | null) ?? null)
        .catch(() => null),
    )
  }
  return cache.get(id)!
}

export type SiteSeedField = 'company' | 'code' | 'name' | 'lat' | 'lng' | 'radiusM' | 'costCenter'

/**
 * "Buat site dari pusat biaya" (ADR 0023 Q-S2): `defaultValue` of the site create form opened as
 * /admin/collections/sites/create?costCenter=<id> — PT, kode, nama and titik copied from that (operational) cost
 * center, which becomes the site's default cost center. Only on that admin create route (adminCreatePrefill); API
 * creates are unaffected. The company hook re-checks the PT of every reference on save.
 */
export function siteFromCostCenterDefault(field: SiteSeedField) {
  return async ({ req }: { req: PayloadRequest }): Promise<unknown> => {
    const id = adminCreatePrefill(req, 'sites', 'costCenter')
    if (id === undefined) return undefined
    const cc = await seedOf(req, id)
    if (!cc) return undefined
    if (field === 'costCenter') return id
    if (field === 'company') return relId(cc.company)
    const v = cc[field]
    return v === null || v === undefined ? undefined : v
  }
}

/** Link of the cost-center form: opens the site create form pre-filled from that cost center. */
export const siteFromCostCenterHref = (costCenterId: number | string) => `/admin/collections/sites/create?costCenter=${encodeURIComponent(String(costCenterId))}`

/** Per-caller flags of the sites of one PT (APK / web location pickers, ADR 0023 §6). */
export type SiteFlags = { home: number | null; assigned: Set<number>; team: Set<number> }

/**
 * ADR 0023 Q-S5, per PT: `home` = home site of the caller's employee there; `assigned` = sites of the employee's
 * team assignments active on `localDate` (start/end inclusive, same comparison as the check-in rule); `team` = sites
 * where the caller may record PM on-behalf (holds pk-pm there and has the site in the team scope). The server
 * re-checks everything at the check-in (domain/attendance/record.ts) — these are UI hints.
 */
export async function siteFlagsFor(req: PayloadRequest, company: number, localDate: string): Promise<SiteFlags> {
  const out: SiteFlags = { home: null, assigned: new Set(), team: new Set() }
  if (hasRole(req, 'pk-pm', company)) for (const s of (await resolveScope(req, company)).teamSites) out.team.add(s)
  const employee = employeeIn(req, company)
  if (employee === undefined) return out
  const emp = (await req.payload.findByID({ collection: 'employees', id: employee, depth: 0, select: { homeSite: true } as never, overrideAccess: true /* SYSTEM-READ: the caller's own employee */, req, disableErrors: true })) as {
    homeSite?: unknown
  } | null
  out.home = relId(emp?.homeSite) ?? null
  const res = await req.payload.find({
    collection: 'team-assignments',
    where: { and: [{ employee: { equals: employee } }, { site: { exists: true } }] },
    depth: 0,
    pagination: false,
    select: { site: true, startDate: true, endDate: true } as never,
    overrideAccess: true, // SYSTEM-READ: the caller's own site assignments
    req,
  })
  for (const a of res.docs as Array<{ site?: unknown; startDate?: string | null; endDate?: string | null }>) {
    const start = a.startDate ? a.startDate.slice(0, 10) : null
    const end = a.endDate ? a.endDate.slice(0, 10) : null
    const site = relId(a.site)
    if (site !== undefined && (!start || start <= localDate) && (!end || end >= localDate)) out.assigned.add(site)
  }
  return out
}
