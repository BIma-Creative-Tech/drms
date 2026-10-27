import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import * as R from './schemas-records'

type Helpers = {
  security: Array<Record<string, string[]>>
  deviceHeader: z.ZodObject
  idem: z.ZodObject
  res: (code: number, description: string, schema: z.ZodType, errors: number[]) => RouteConfig['responses']
}

/** D1610 (ADR 0030) row actions: soft delete, restore, project cancel. Pure (bundled by scripts/gen-openapi.mjs). */
export function registerRecordPaths(registry: OpenAPIRegistry, h: Helpers): void {
  const write = [400, 401, 403, 404, 409, 422, 426, 429]
  const body = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } })
  const projectId = z.object({ id: z.string().regex(/^\d+$/) })
  registry.registerPath({
    method: 'get',
    path: '/records/{collection}/{id}/delete-check',
    summary: 'What "Hapus" would do for the caller: the action (hapus / batalkan / nonaktifkan / pulihkan), the usage lines that block it (other rows referencing this one), the deleted state',
    security: h.security,
    request: { headers: h.deviceHeader, params: R.RecordParams },
    responses: h.res(200, 'Check', R.DeleteCheck, [401, 404, 426]),
  })
  registry.registerPath({
    method: 'post',
    path: '/records/{collection}/{id}/delete',
    summary: 'Soft delete (isDeleted = true, reason, audit `soft_delete`): masters / projects nobody references (409 IN_USE / PROJECT_IN_USE + usage), requests only as a Draft nobody ever decided on (never submitted, or withdrawn before any decision — D2410; else 409 NOT_A_DRAFT). Whoever may update the row; hard delete stays denied',
    security: h.security,
    request: { headers: h.idem, params: R.RecordParams, body: body(R.RecordReason) },
    responses: h.res(200, 'Check after the change', R.DeleteCheck, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/records/{collection}/{id}/restore',
    summary: 'Admin "Pulihkan": a soft-deleted row comes back (with the children deleted together with it), reason required, audit `restore`',
    security: h.security,
    request: { headers: h.idem, params: R.RecordParams, body: body(R.RecordReason) },
    responses: h.res(200, 'Check after the change', R.DeleteCheck, write),
  })
  registry.registerPath({
    method: 'get',
    path: '/projects/{id}/cancel-plan',
    summary: 'Dry run of "Batalkan proyek": the in-flight requests / addenda / loans cancelled with it and the documents that block it (money transferred, LPJ, repayments)',
    security: h.security,
    request: { headers: h.deviceHeader, params: projectId },
    responses: h.res(200, 'Plan', R.ProjectCancelPlan, [401, 404, 426]),
  })
  registry.registerPath({
    method: 'post',
    path: '/projects/{id}/cancel',
    summary: 'Batalkan proyek (Direktur / Admin of the PT): status Dibatalkan + cancels every cancellable in-flight document ("Proyek dibatalkan: <alasan>", normal notifications) in ONE transaction; 409 PROJECT_HAS_OPEN_DOCUMENTS with `blocking` when something cannot be cancelled',
    security: h.security,
    request: { headers: h.idem, params: projectId, body: body(R.RecordReason) },
    responses: h.res(200, 'Cancelled', R.ProjectCancelResult, write),
  })
}
