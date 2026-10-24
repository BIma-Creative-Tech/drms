import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import * as P from './schemas-projects'

type Helpers = {
  security: Array<Record<string, string[]>>
  deviceHeader: z.ZodObject
  res: (code: number, description: string, schema: z.ZodType, errors: number[]) => RouteConfig['responses']
}

/** DRMS 10/10 Phase C: project list / detail + cost-center picker; ADR 0023 site list. Pure (bundled by scripts/gen-openapi.mjs). */
export function registerProjectPaths(registry: OpenAPIRegistry, h: Helpers): void {
  registry.registerPath({
    method: 'get',
    path: '/projects',
    summary:
      'DRMS 10/10: projects in the caller\'s read scope (Staff: assigned = the projects they can submit to; PM: team; Direktur/Finance/Admin: all of the selected PTs), paged (page/limit), search q (kode/nama), status filter (default: not arsip); RAP plan vs realisation for the price roles only',
    security: h.security,
    request: { headers: h.deviceHeader, query: P.ProjectListQuery },
    responses: h.res(200, 'Page', P.ProjectList, [400, 401, 403, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/projects/{id}',
    summary: 'DRMS 10/10: one visible project (else 404) — PM, client, default cost center (D2), RAP summary (D4, money for the price roles only)',
    security: h.security,
    request: { headers: h.deviceHeader, params: z.object({ id: z.string().regex(/^\d+$/) }) },
    responses: h.res(200, 'Project', P.ProjectDetail, [401, 404, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/cost-centers',
    summary: 'DRMS 10/10 D2: cost centers the caller may read (Finance: all of the selected PTs) — picker of the transfer cost center; active only unless active=all',
    security: h.security,
    request: { headers: h.deviceHeader, query: P.CostCenterListQuery },
    responses: h.res(200, 'Cost centers', P.CostCenterList, [400, 401, 403, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/sites',
    summary:
      'ADR 0023 sites — ADR 0032: sites are removed from the product; the endpoint stays for APK ≤ 0.11.1 and always answers an empty list',
    security: h.security,
    request: { headers: h.deviceHeader, query: P.SiteListQuery },
    responses: h.res(200, 'Sites', P.SiteList, [400, 401, 403, 426]),
  })
}
