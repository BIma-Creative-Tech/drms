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
}
