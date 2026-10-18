import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi'
import type { z } from 'zod'

import * as A from './schemas-account'

type Helpers = {
  security: Array<Record<string, string[]>>
  res: (code: number, description: string, schema: z.ZodType, errors: number[]) => RouteConfig['responses']
}

/** User 2026-10-19: APK "Profil & tanda tangan" and "Keamanan akun" (same rules as the web pages). Pure (bundled by scripts/gen-openapi.mjs). */
export function registerAccountPaths(registry: OpenAPIRegistry, h: Helpers): void {
  registry.registerPath({
    method: 'get',
    path: '/me/account',
    summary: 'Own account (name, email, phone, display name, profile signature) — the web "Profil & tanda tangan" page. Only the signature is self-service.',
    security: h.security,
    responses: h.res(200, 'Own account', A.MeAccount, [401, 426, 429]),
  })
  registry.registerPath({
    method: 'put',
    path: '/me/signature',
    summary:
      'Set or remove the own profile signature (F2c): the media must be a media-signatures row the caller uploaded, else 403. Same guard as the web form (users.selfProfileGuard); audited by the users collection.',
    security: h.security,
    request: { body: { content: { 'application/json': { schema: A.MeSignatureBody } } } },
    responses: h.res(200, 'Updated account', A.MeAccount, [400, 401, 403, 413, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/me/security',
    summary: 'Own 2FA status from Keycloak (ADR 0017, metadata only) + the web page that changes it. Read-only.',
    security: h.security,
    responses: h.res(200, '2FA status', A.MeSecurity, [401, 426, 429]),
  })
}
