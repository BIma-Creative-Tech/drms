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

/** ADR 0022 Pinjaman antar project paths (2026-10-24: Direktur → Owner, transfer orders). Pure (bundled by scripts/gen-openapi.mjs). */
export function registerLoanPaths(registry: OpenAPIRegistry, h: Helpers): void {
  const idParam = z.object({ id: z.string().regex(/^\d+$/) })
  const ridParam = z.object({ id: z.string().regex(/^\d+$/), rid: z.string().regex(/^\d+$/) })
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
    summary: 'Loans waiting for the caller\'s decision at their level — Direktur (1) / Owner (2), G1 (the creator only under direktur_self, level 1) — plus repayment requests (`repayments`); ?company= narrows',
    security: h.security,
    request: { headers: h.deviceHeader, query: z.object({ company: companyFilterParam }) },
    responses: h.res(200, 'Inbox', L.LoanInbox, [401, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/project-loans/options',
    summary: 'Create form options: borrower projects of the caller (PM; Finance: every open project of its PTs) and lender projects of the same PT',
    security: h.security,
    request: { headers: h.deviceHeader },
    responses: h.res(200, 'Options', L.LoanOptions, [401, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/project-loans/transfer-orders',
    summary: '2026-10-24 (#11/#12) "Antrian Transfer": approved cash-backed loans not transferred yet + approved repayment requests, in the selected PTs where the caller is Finance / Direktur (only Finance executes); ?company= narrows',
    security: h.security,
    request: { headers: h.deviceHeader, query: z.object({ company: companyFilterParam }) },
    responses: h.res(200, 'Transfer orders', L.LoanTransferOrders, [401, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/project-loans/{id}',
    summary: 'Loan detail: repayments (with their row actions), Direktur / Owner decisions, allowed actions, notes (PM peminjam = PM pemberi, direktur_self)',
    security: h.security,
    request: { headers: h.deviceHeader, params: idParam },
    responses: h.res(200, 'Loan', L.LoanDetail, [401, 404, 426]),
  })
  registry.registerPath({
    method: 'post',
    path: '/project-loans',
    summary: 'Create a Draft (PM of the borrower project or Finance of its PT; others 403 + access_denied audit). Same PT only (400 COMPANY_MISMATCH); submit:true submits at once',
    security: h.security,
    request: { headers: h.idem, body: body(L.LoanCreate) },
    responses: h.res(201, 'Loan', L.LoanDetail, write),
  })
  registry.registerPath({
    method: 'patch',
    path: '/project-loans/{id}',
    summary: 'Edit a Draft (creator: borrower PM / Finance)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.LoanUpdate) },
    responses: h.res(200, 'Loan', L.LoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/project-loans/{id}/submit',
    summary: 'Submit a Draft: number PJ/{COMPANY}/{YY}{MM}/#### issued, both pools resolved (G1) → Menunggu persetujuan Direktur (level 1); 409 NO_DIREKTUR / NO_OWNER (no active Owner other than the creator) / SAME_PERSON',
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
    summary: '"Setujui" at the current level: Direktur (level 1) → waits for the Owner; Owner (level 2) → Disetujui (a cash-backed loan becomes a transfer order). 403 wrong level / G1; 409 NO_OWNER at level 1 without an Owner left',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.LoanDecision) },
    responses: h.res(200, 'Loan', L.LoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/project-loans/{id}/reject',
    summary: '"Tolak" at the current level (Direktur or Owner, reason required)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.LoanReject) },
    responses: h.res(200, 'Loan', L.LoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/project-loans/{id}/disburse',
    summary: 'ADR 0031 "Cairkan" (Finance) — kept for older APKs: the same execution as /execute',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.LoanDisburse) },
    responses: h.res(200, 'Loan', L.LoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/project-loans/{id}/execute',
    summary: '2026-10-24 (#11) Finance executes the loan\'s transfer order: KK lender account (lender project) + KM borrower account (borrower project), one transaction, once; the submitter (Finance) may execute it (audited)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.LoanExecute) },
    responses: h.res(200, 'Loan', L.LoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/project-loans/{id}/repayments',
    summary: 'Repayment (borrower PM or Finance). Claim: recorded at once (no approval, ≤ outstanding) → Sebagian kembali / Lunas. Cash-backed (2026-10-24 #12): a REQUEST (≤ repayableAmount, planned date) → Direktur → Owner → transfer order',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.RepaymentCreate) },
    responses: h.res(201, 'Loan', L.LoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/project-loans/{id}/repayments/{rid}/void',
    summary: 'Void a posted repayment (Direktur or Finance, reason required); the loan status moves back',
    security: h.security,
    request: { headers: h.idem, params: ridParam, body: body(L.LoanReason) },
    responses: h.res(200, 'Loan', L.LoanDetail, write),
  })
  const repaymentPath = (action: string, summary: string, schema: z.ZodType) =>
    registry.registerPath({
      method: 'post',
      path: `/project-loans/{id}/repayments/{rid}/${action}`,
      summary,
      security: h.security,
      request: { headers: h.idem, params: ridParam, body: body(schema) },
      responses: h.res(200, 'Loan', L.LoanDetail, write),
    })
  repaymentPath('approve', '2026-10-24 (#12) "Setujui" a repayment request at its level (Direktur 1 → Owner 2; G1: never the submitter); the Owner\'s approval makes it a transfer order', L.LoanDecision)
  repaymentPath('reject', '"Tolak" a repayment request at its level (reason required)', L.LoanReject)
  repaymentPath('cancel', 'Cancel a repayment request (reason): the submitter while pending; Finance / the submitter once approved, before its execution', L.LoanReason)
  repaymentPath('execute', 'Finance executes an approved repayment order: KK borrower account (borrower project) + KM lender account (lender project); the repayment is posted and the loan Sebagian kembali / Lunas', L.LoanExecute)
}
