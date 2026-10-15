import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import * as U from './schemas-users'

type Helpers = {
  security: Array<Record<string, string[]>>
  res: (code: number, description: string, schema: z.ZodType, errors: number[]) => RouteConfig['responses']
}

/** DRMS 13/10 Wave 3 "Pengguna" tabbed onboarding (ADR 0003 revision 2026-10-13). Pure (bundled by scripts/gen-openapi.mjs). */
export function registerUserOnboardingPaths(registry: OpenAPIRegistry, h: Helpers): void {
  const params = z.object({ userId: z.string().regex(/^\d+$/) })
  const body = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } })
  const write = [400, 401, 403, 404, 409, 413, 429, 502, 503]
  registry.registerPath({
    method: 'post',
    path: '/user-onboarding',
    summary:
      'Create an account with its access per PT, employee per PT, bank accounts and team assignments (DRMS 15/10; written after the employee, so a new employee gets them) in ONE transaction (Admin of every PT named / group admin). Keycloak first: a NEW Keycloak user gets a temporary password (UPDATE_PASSWORD at the first login), returned once; an existing Keycloak account with the email is linked. Any failure rolls the DB back and compensates Keycloak (new user deleted); Keycloak refusing / unreachable → 502 KEYCLOAK_FAILED, not configured → 503. Errors name the field: errors[].path = user.* / companies.<i>.* / reason',
    security: h.security,
    request: { body: body(U.UserOnboardingCreate) },
    responses: h.res(201, 'Created', U.UserOnboardingResult, write),
  })
  registry.registerPath({
    method: 'get',
    path: '/user-onboarding/{userId}',
    summary: 'Form data of one account: identity (+ whether the caller may change it), per PT of the caller (Admin PTs ∩ PT selection) the membership, linked employee, its bank accounts, selectable employees, team assignments and the selectable locations of a new assignment (active projects / cost centers / sites of the PT, caller\'s read access); active banks',
    security: h.security,
    request: { params },
    responses: h.res(200, 'Detail', U.UserOnboardingDetail, [401, 403, 404]),
  })
  registry.registerPath({
    method: 'patch',
    path: '/user-onboarding/{userId}',
    summary:
      'Edit in ONE transaction: changed identity fields (Keycloak-first; accounts only in the caller\'s Admin PTs), roles per PT (empty = membership inactive), employee per PT (link / create / update / unlink), bank accounts (create / update, never deleted), team assignments (create; role / end date of saved ones; never deleted). Collection rules apply unchanged (reason on deactivation, bank-account changes and assignment role / end-date changes, verification by Admin/Finance, one assignment location of the employee\'s PT, a PM caller only for its team and never role pm). Unknown / unreadable / foreign-PT assignment or location ids: 404 / 400 on the item. Own account: no self-deactivation, no removal of the own Admin role',
    security: h.security,
    request: { params, body: body(U.UserOnboardingUpdate) },
    responses: h.res(200, 'Saved', U.UserOnboardingResult, write),
  })
}
