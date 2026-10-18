import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi'
import type { z } from 'zod'

import * as C from './schemas-companies'

type Helpers = {
  security: Array<Record<string, string[]>>
  res: (code: number, description: string, schema: z.ZodType, errors: number[]) => RouteConfig['responses']
}

/** MC2-4: web PT switcher. Pure (bundled by scripts/gen-openapi.mjs). */
export function registerCompanyPaths(registry: OpenAPIRegistry, h: Helpers): void {
  registry.registerPath({
    method: 'post',
    path: '/me/companies',
    summary:
      'Web PT switcher: store the READ selection in the HttpOnly cookie pk-company-ids (__Host- on https). Only narrows the active memberships; a foreign PT → 403 COMPANY_NOT_ALLOWED. The APK sends X-Company-Ids per request instead.',
    security: h.security,
    request: { body: { content: { 'application/json': { schema: C.MeCompaniesBody } } } },
    responses: h.res(200, 'Selection stored (Set-Cookie)', C.MeCompaniesResult, [400, 401, 403, 409, 413, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/me/modules',
    summary:
      'Web launcher modules of the caller for the selected PTs (X-Company-Ids): same visibility as /admin (Payload permissions, admin.hidden, view roles, PT features) with badges. APK menu 1:1 with the web; menu only, every route re-checks.',
    security: h.security,
    responses: h.res(200, 'Visible modules (registry order)', C.MeModules, [401, 426, 429]),
  })
}
