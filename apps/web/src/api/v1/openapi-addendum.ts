import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import * as D from './schemas-addendum'

type Helpers = {
  security: Array<Record<string, string[]>>
  deviceHeader: z.ZodObject
  idem: z.ZodObject
  res: (code: number, description: string, schema: z.ZodType, errors: number[]) => RouteConfig['responses']
}

/** E5 Addendum RAB paths (T12, US-18/US-30). Pure (bundled by scripts/gen-openapi.mjs). */
export function registerAddendumPaths(registry: OpenAPIRegistry, h: Helpers): void {
  const idParam = z.object({ id: z.string().regex(/^\d+$/) })
  const write = [400, 401, 403, 404, 409, 422, 426, 429]
  registry.registerPath({
    method: 'get',
    path: '/budget-addenda',
    summary: 'Addendum RAB list, newest first (PM: team projects + own; Direktur/Finance: all; others: empty)',
    security: h.security,
    request: { headers: h.deviceHeader, query: D.AddendumListQuery },
    responses: h.res(200, 'Addenda', D.AddendumList, [400, 401, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/budget-addenda/inbox',
    summary: 'Addenda waiting for the caller: Direktur "Setujui" (step acknowledge) or Finance approval (step approve), with RAB impact',
    security: h.security,
    request: { headers: h.deviceHeader },
    responses: h.res(200, 'Inbox', D.AddendumInbox, [401, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/budget-addenda/{id}',
    summary: 'Addendum detail: RAB impact, decision timeline, allowed actions',
    security: h.security,
    request: { headers: h.deviceHeader, params: idParam },
    responses: h.res(200, 'Addendum', D.AddendumDetail, [401, 404, 426]),
  })
  registry.registerPath({
    method: 'post',
    path: '/budget-addenda',
    summary: 'US-18 create an addendum (PM of the project team only; other callers 403 + access_denied audit). Nominal > 0 and reason required; submit:true submits at once',
    security: h.security,
    request: { headers: h.idem, body: { content: { 'application/json': { schema: D.AddendumCreate } } } },
    responses: h.res(201, 'Addendum', D.AddendumDetail, write),
  })
  registry.registerPath({
    method: 'patch',
    path: '/budget-addenda/{id}',
    summary: 'Edit a Draft (creator PM)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: { content: { 'application/json': { schema: D.AddendumUpdate } } } },
    responses: h.res(200, 'Addendum', D.AddendumDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/budget-addenda/{id}/submit',
    summary: 'Submit a Draft: approval rule (docType budget_addendum) snapshotted, number ADD/YYMM/#### allocated → Menunggu Direktur',
    security: h.security,
    request: { headers: h.idem, params: idParam },
    responses: h.res(200, 'Addendum', D.AddendumDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/budget-addenda/{id}/cancel',
    summary: 'Cancel (creator, before any decision; reason required)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: { content: { 'application/json': { schema: D.AddendumReason } } } },
    responses: h.res(200, 'Addendum', D.AddendumDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/budget-addenda/{id}/acknowledge',
    summary: 'Direktur "Setujui" (Diketahui = approval, ADR 0013) → Menunggu Finance (or approved when no Finance level remains)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: { content: { 'application/json': { schema: D.AddendumDecision } } } },
    responses: h.res(200, 'Addendum', D.AddendumDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/budget-addenda/{id}/approve',
    summary: 'Finance approval; the last level sets projects.budget = current RAB + addition in the same transaction (audited before → after)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: { content: { 'application/json': { schema: D.AddendumDecision } } } },
    responses: h.res(200, 'Addendum', D.AddendumDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/budget-addenda/{id}/reject',
    summary: 'Reject at the Direktur or Finance step (reason required)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: { content: { 'application/json': { schema: D.AddendumReject } } } },
    responses: h.res(200, 'Addendum', D.AddendumDetail, write),
  })
}
