import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import { companyFilterParam } from './schemas'
import * as S from './schemas-shortfall'

type Helpers = {
  security: Array<Record<string, string[]>>
  idem: z.ZodObject
  res: (code: number, description: string, schema: z.ZodType, errors: number[]) => RouteConfig['responses']
  detail: z.ZodType
}

/** QA-06 / ADR 0019: LPJ shortfall above approved + tolerance → re-approval (web only). Pure (bundled by scripts/gen-openapi.mjs). */
export function registerShortfallPaths(registry: OpenAPIRegistry, h: Helpers): void {
  const idParam = z.object({ id: z.string().regex(/^\d+$/) })
  const write = [400, 401, 403, 404, 409, 422, 429]
  const post = (path: string, summary: string, body: z.ZodType) =>
    registry.registerPath({
      method: 'post',
      path,
      summary,
      security: h.security,
      request: { headers: h.idem, params: idParam, body: { content: { 'application/json': { schema: body } } } },
      responses: h.res(200, 'Request detail (settlement.shortfallApproval updated)', h.detail, write),
    })
  post(
    '/expense-requests/{id}/lpj/shortfall-approval',
    'Finance (D2410: also the requester/creator — audited self_processed): ask the re-approval of the NEW total of a verified LPJ whose shortfall exceeds approved + tolerance — approval rule of the request for that total (ADR 0013: Direktur "Diketahui" → Finance); within tolerance / running / already approved → 409',
    S.ShortfallApprovalRequestBody,
  )
  post('/expense-requests/{id}/lpj/shortfall-approval/acknowledge', 'Direktur: approve the shortfall ("Diketahui", signature required); G1/G2 as request decisions', S.ShortfallDecisionBody)
  post('/expense-requests/{id}/lpj/shortfall-approval/approve', 'Finance level of the snapshot: approve the shortfall (signature required); last level → approved, settle allowed', S.ShortfallDecisionBody)
  post('/expense-requests/{id}/lpj/shortfall-approval/reject', 'Direktur / Finance step: reject the shortfall (reason required); settle stays refused', S.ShortfallRejectBody)
  registry.registerPath({
    method: 'get',
    path: '/lpj-shortfall-approvals/inbox',
    summary: 'LPJ shortfall re-approvals waiting for the caller (Direktur "Diketahui" / Finance level); ?company= narrows',
    security: h.security,
    request: { query: z.object({ company: companyFilterParam }) },
    responses: h.res(200, 'Inbox', S.ShortfallInbox, [400, 401, 403]),
  })
}
