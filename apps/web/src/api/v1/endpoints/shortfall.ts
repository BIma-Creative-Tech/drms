import { detail } from '@/domain/expense/dto'
import { decideShortfall, requestShortfallApproval, shortfallInbox } from '@/domain/expense/shortfall-approval'

import { companyQuery } from '../company-query'
import { HttpError, json, v1 } from '../http'
import { ShortfallApprovalRequestBody, ShortfallDecisionBody, ShortfallRejectBody } from '../schemas-shortfall'

/**
 * QA-06 / ADR 0019 — LPJ shortfall above approved + tolerance: Finance asks for the re-approval, the
 * Direktur ("Diketahui") and Finance levels decide (ADR 0013 engine). Web only (APK unchanged).
 */
const ACTION_LIMIT: [number, number] = [30, 60_000]

function idParam(params: Record<string, string>): number {
  const v = params.id ?? ''
  if (!/^\d{1,10}$/.test(v)) throw new HttpError(404, 'Not Found')
  return Number(v)
}

export const shortfallRequestEndpoint = v1({
  path: '/expense-requests/:id/lpj/shortfall-approval',
  method: 'post',
  roles: ['pk-finance'],
  body: ShortfallApprovalRequestBody,
  rateLimit: ACTION_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const id = idParam(params)
    await requestShortfallApproval(req, id, body.note)
    return json(await detail(req, id))
  },
})

const decision = (path: 'acknowledge' | 'approve') =>
  v1({
    path: `/expense-requests/:id/lpj/shortfall-approval/${path}`,
    method: 'post',
    // ADR 0021: Direktur / Finance or the PM project acknowledger — decided (403 + audit) by decideShortfall
    body: ShortfallDecisionBody,
    rateLimit: ACTION_LIMIT,
    transactional: true,
    idempotent: true,
    handler: async ({ req, body, params }) => {
      const id = idParam(params)
      await decideShortfall(req, id, path, { signatureMediaId: body.signatureMediaId })
      return json(await detail(req, id))
    },
  })

export const shortfallAcknowledgeEndpoint = decision('acknowledge')
export const shortfallApproveEndpoint = decision('approve')

export const shortfallRejectEndpoint = v1({
  path: '/expense-requests/:id/lpj/shortfall-approval/reject',
  method: 'post',
  // ADR 0021: Direktur / Finance or the PM project acknowledger — decided (403 + audit) by decideShortfall
  body: ShortfallRejectBody,
  rateLimit: ACTION_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const id = idParam(params)
    await decideShortfall(req, id, 'reject', { reason: body.reason, signatureMediaId: body.signatureMediaId })
    return json(await detail(req, id))
  },
})

/** GET /lpj-shortfall-approvals/inbox — waiting for the caller's decision (web Persetujuan). */
export const shortfallInboxEndpoint = v1({
  path: '/lpj-shortfall-approvals/inbox',
  method: 'get',
  // ADR 0021: the PM project decides "Persetujuan PM" too; the list holds only the caller's own steps
  transactional: true,
  handler: async ({ req }) => {
    const companies = await companyQuery(req)
    return json(await shortfallInbox(req, { companyIds: companies }))
  },
})

export const SHORTFALL_ENDPOINTS = [shortfallRequestEndpoint, shortfallAcknowledgeEndpoint, shortfallApproveEndpoint, shortfallRejectEndpoint, shortfallInboxEndpoint]
