import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import { companyFilterParam } from './schemas'
import * as L from './schemas-loans'

type Helpers = {
  security: Array<Record<string, string[]>>
  deviceHeader: z.ZodObject
  idem: z.ZodObject
  res: (code: number, description: string, schema: z.ZodType, errors: number[]) => RouteConfig['responses']
}

/** ADR 0022 Pinjaman antar project paths. Pure (bundled by scripts/gen-openapi.mjs). */
export function registerLoanPaths(registry: OpenAPIRegistry, h: Helpers): void {
  const idParam = z.object({ id: z.string().regex(/^\d+$/) })
  const write = [400, 401, 403, 404, 409, 422, 426, 429]
  const body = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } })
  registry.registerPath({
    method: 'get',
    path: '/project-loans',
    summary: 'Inter-project loans, newest first, numbered pages (Direktur/Admin/Finance: their PTs; PM: loans of team projects + own; Staff: empty)',
    security: h.security,
    request: { headers: h.deviceHeader, query: L.LoanListQuery },
    responses: h.res(200, 'Loans', L.LoanList, [400, 401, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/project-loans/inbox',
    summary: 'Loans waiting for the caller\'s decision (Direktur pool; the creator only under direktur_self); ?company= narrows',
    security: h.security,
    request: { headers: h.deviceHeader, query: z.object({ company: companyFilterParam }) },
    responses: h.res(200, 'Inbox', L.LoanInbox, [401, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/project-loans/options',
    summary: 'Create form options: borrower projects of the caller (PM) and lender projects of the same PT',
    security: h.security,
    request: { headers: h.deviceHeader },
    responses: h.res(200, 'Options', L.LoanOptions, [401, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/project-loans/{id}',
    summary: 'Loan detail: repayments, Direktur decision, allowed actions, notes (PM peminjam = PM pemberi, direktur_self)',
    security: h.security,
    request: { headers: h.deviceHeader, params: idParam },
    responses: h.res(200, 'Loan', L.LoanDetail, [401, 404, 426]),
  })
  registry.registerPath({
    method: 'post',
    path: '/project-loans',
    summary: 'Create a Draft (PM of the borrower project only; others 403 + access_denied audit). Same PT only (400 COMPANY_MISMATCH); submit:true submits at once',
    security: h.security,
    request: { headers: h.idem, body: body(L.LoanCreate) },
    responses: h.res(201, 'Loan', L.LoanDetail, write),
  })
  registry.registerPath({
    method: 'patch',
    path: '/project-loans/{id}',
    summary: 'Edit a Draft (creator PM)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.LoanUpdate) },
    responses: h.res(200, 'Loan', L.LoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/project-loans/{id}/submit',
    summary: 'Submit a Draft: number PJ/{COMPANY}/{YY}{MM}/#### issued, Direktur pool resolved (G1) → Menunggu persetujuan Direktur; 409 NO_DIREKTUR without an active Direktur',
    security: h.security,
    request: { headers: h.idem, params: idParam },
    responses: h.res(200, 'Loan', L.LoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/project-loans/{id}/cancel',
    summary: 'Cancel (reason required): creator in Draft / Menunggu; a Direktur after approval while no repayment is posted',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.LoanReason) },
    responses: h.res(200, 'Loan', L.LoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/project-loans/{id}/approve',
    summary: 'Direktur "Setujui" (one level). No cash entry is created (notional allocation, ADR 0022 §5)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.LoanDecision) },
    responses: h.res(200, 'Loan', L.LoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/project-loans/{id}/reject',
    summary: 'Direktur "Tolak" (reason required)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.LoanReject) },
    responses: h.res(200, 'Loan', L.LoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/project-loans/{id}/disburse',
    summary: 'ADR 0031 "Cairkan" (Finance): an approved cash-backed loan (money between two different Pusat Biaya) → KK on the lender account + KM on the borrower account, once',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.LoanDisburse) },
    responses: h.res(200, 'Loan', L.LoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/project-loans/{id}/repayments',
    summary: 'Record a repayment (borrower PM or Finance; Finance only — after the disbursement — when the loan moves cash; no approval; amount ≤ outstanding) → Sebagian kembali / Lunas',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.RepaymentCreate) },
    responses: h.res(201, 'Loan', L.LoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/project-loans/{id}/repayments/{rid}/void',
    summary: 'Void a posted repayment (Direktur or Finance, reason required); the loan status moves back',
    security: h.security,
    request: { headers: h.idem, params: z.object({ id: z.string().regex(/^\d+$/), rid: z.string().regex(/^\d+$/) }), body: body(L.LoanReason) },
    responses: h.res(200, 'Loan', L.LoanDetail, write),
  })
}
