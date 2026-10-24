import type { Endpoint } from 'payload'

import { listCostCenters, listProjects, listSites, projectDetail } from '@/domain/projects/view'

import { companyQuery } from '../company-query'
import { HttpError, json, v1 } from '../http'
import { CostCenterListQuery, ProjectListQuery, SiteListQuery } from '../schemas-projects'

/**
 * DRMS 10/10 Phase C: projects for the APK "Proyek" menu and the request project picker, cost centers for the
 * Finance transfer picker (D2); ADR 0023: sites (kantor cabang). Reads only, within the caller's collection access; `?company=` narrows (MC3).
 * Registered after the P3/E4 project routes so `/projects/progress` keeps its own handler.
 */
function idParam(params: Record<string, string>): number {
  const v = params.id ?? ''
  if (!/^\d{1,10}$/.test(v)) throw new HttpError(404, 'Not Found')
  return Number(v)
}

const badRequest = (issues: Array<{ path: PropertyKey[]; message: string }>) => new HttpError(400, 'Bad Request', { errors: issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })

export const listProjectsEndpoint = v1({
  path: '/projects',
  method: 'get',
  transactional: true, // RAP sums use the request transaction handle
  handler: async ({ req }) => {
    const q = ProjectListQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) throw badRequest(q.error.issues)
    return json(await listProjects(req, { q: q.data.q, status: q.data.status, page: q.data.page, limit: q.data.limit, companies: await companyQuery(req) }))
  },
})

export const projectDetailEndpoint = v1({
  path: '/projects/:id',
  method: 'get',
  transactional: true,
  handler: async ({ req, params }) => {
    const d = await projectDetail(req, idParam(params))
    if (!d) throw new HttpError(404, 'Not Found', { detail: 'Project tidak ditemukan.' })
    return json(d)
  },
})

export const listCostCentersEndpoint = v1({
  path: '/cost-centers',
  method: 'get',
  handler: async ({ req }) => {
    const q = CostCenterListQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) throw badRequest(q.error.issues)
    return json(await listCostCenters(req, { q: q.data.q, companies: await companyQuery(req), includeInactive: q.data.active === 'all' }))
  },
})

/** ADR 0023 §6 sites — ADR 0032: removed from the product; kept for APK ≤ 0.11.1, always an empty list. */
export const listSitesEndpoint = v1({
  path: '/sites',
  method: 'get',
  handler: async ({ req }) => {
    const q = SiteListQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) throw badRequest(q.error.issues)
    return json(await listSites(req, { q: q.data.q, companies: await companyQuery(req), includeInactive: q.data.active === 'all' }))
  },
})

export const PROJECT_ENDPOINTS: Endpoint[] = [listProjectsEndpoint, projectDetailEndpoint, listCostCentersEndpoint, listSitesEndpoint]
