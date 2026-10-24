import type { OpenAPIRegistry, RouteConfig } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import * as L from './schemas-icloans'

type Helpers = {
  security: Array<Record<string, string[]>>
  deviceHeader: z.ZodObject
  idem: z.ZodObject
  res: (code: number, description: string, schema: z.ZodType, errors: number[]) => RouteConfig['responses']
}

/** ADR 0029 "Pinjaman antar-PT" + fund availability paths. Pure (bundled by scripts/gen-openapi.mjs). */
export function registerIcLoanPaths(registry: OpenAPIRegistry, h: Helpers): void {
  const idParam = z.object({ id: z.string().regex(/^\d+$/) })
  const write = [400, 401, 403, 404, 409, 422, 426, 429]
  const body = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } })
  registry.registerPath({
    method: 'get',
    path: '/fund-availability',
    summary:
      'ADR 0029 §1 "Dana tersedia" of one PT = Σ balance of its ACTIVE accounts − commitments (approved-not-transferred requests, unpaid LPJ shortfalls, loans instructed with this PT as lender). Finance / Direktur / Owner of that PT within the selection (else 403 / COMPANY_NOT_ALLOWED)',
    security: h.security,
    request: { headers: h.deviceHeader, query: L.FundAvailabilityQuery },
    responses: h.res(200, 'Availability', L.FundAvailability, [400, 401, 403, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/intercompany-loans',
    summary: 'Inter-PT loans (PJA) of the caller\'s PTs as lender or borrower (Owner / Direktur / Finance / Admin of either PT), newest first, numbered pages',
    security: h.security,
    request: { headers: h.deviceHeader, query: L.IcLoanListQuery },
    responses: h.res(200, 'Loans', L.IcLoanList, [400, 401, 403, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/intercompany-loans/queue',
    summary: '"Pencairan pinjaman antar-PT": instructed loans whose LENDER is a PT where the caller is Finance (?company= narrows); count = badge. canDisburse false for the instruction\'s creator (G1)',
    security: h.security,
    request: { headers: h.deviceHeader, query: z.object({ company: L.IcLoanListQuery.shape.company }) },
    responses: h.res(200, 'Queue', L.IcLoanQueue, [400, 401, 403, 426]),
  })
  registry.registerPath({
    method: 'get',
    path: '/intercompany-loans/lenders',
    summary:
      'Instruction form (Owner of the borrower PT, else 403): the borrower\'s availability + requests waiting at their final decision (gap per request, gapAll), and every other active PT where the caller is Owner with its "Dana tersedia" and `sufficient` (available ≥ amount); short PTs are shown disabled',
    security: h.security,
    request: { headers: h.deviceHeader, query: L.IcLenderQuery },
    responses: h.res(200, 'Lenders', L.IcLenderOptions, [400, 401, 403, 426, 429]),
  })
  registry.registerPath({
    method: 'get',
    path: '/intercompany-loans/{id}',
    summary:
      'Loan detail: movements (Pencairan / Pengembalian ke-n with KK / KM numbers), linked requests, notes, allowed actions and — for Finance of the lender while instructed, like the queue item — the borrower\'s receiving account `destination` (masked) (404 for a user of neither PT)',
    security: h.security,
    request: { headers: h.deviceHeader, params: idParam },
    responses: h.res(200, 'Loan', L.IcLoanDetail, [401, 404, 426]),
  })
  registry.registerPath({
    method: 'post',
    path: '/intercompany-loans',
    summary:
      'Owner instruction "Perintahkan pinjaman antar-PT" (pk-principal STORED in both PTs, else 403 + access_denied): number PJA/{LENDER}/{YY}{MM}/#### → status instructed (the amount is reserved in the lender\'s commitments). Borrower without designated receiving account → 400 code INTERCOMPANY_NO_ACCOUNT; amount > the lender\'s "Dana tersedia" → 409 code LOAN_LENDER_INSUFFICIENT (lenderCompanyId, available, needed, gap); due date default + 30 days, ≥ today; linked requests of the borrower PT only. Notified: Finance of the lender (icloan.instructed) + Finance / Direktur of both PTs',
    security: h.security,
    request: { headers: h.idem, body: body(L.IcLoanCreate) },
    responses: h.res(201, 'Loan', L.IcLoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/intercompany-loans/{id}/cancel',
    summary: 'Owner: cancel the instruction (reason) while waiting for the disbursement; the reservation is released (icloan.cancelled)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.IcLoanReason) },
    responses: h.res(200, 'Loan', L.IcLoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/intercompany-loans/{id}/disburse',
    summary:
      'Finance of the LENDER executes the disbursement (never the instruction\'s creator: 403, G1; DB-checked). Re-check of the lender: "Dana tersedia" + this loan\'s reservation ≥ amount, else 409 code LOAN_LENDER_INSUFFICIENT (the instruction stays, the Owner gets icloan.lender_insufficient). Source account of the lender: active, opening date, lock date (409 "Periode … sudah ditutup"), overdraft → 409 CASH_OVERDRAFT_CONFIRM_REQUIRED unless confirmOverdraft. Borrower: designated account (409 INTERCOMPANY_NO_ACCOUNT), its period of the date closed → 409 INTERCOMPANY_PERIOD_CLOSED. Writes KK (source intercompany) in the lender + automatic KM "Antar PT" in the borrower, paired in intercompany_links; status disbursed; icloan.disbursed to the Owner and the borrower\'s Finance + Direktur (the Owner then approves the short requests again — no automatic approval)',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.IcLoanDisburse) },
    responses: h.res(200, 'Loan', L.IcLoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/intercompany-loans/{id}/disbursement/void',
    summary:
      'Finance of the LENDER voids the disbursement (reason) while no repayment is posted (else 409 code LOAN_HAS_REPAYMENTS): both legs reversed (a closed period never blocks), back to instructed. Borrower "Dana tersedia" < 0 afterwards → 409 code LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED (borrowerCompanyId, available, after, amount) unless confirmBorrowerShortfall (audited); approved requests stay approved',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.IcLoanVoidDisbursement) },
    responses: h.res(200, 'Loan', L.IcLoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/intercompany-loans/{id}/repayments',
    summary:
      'Finance of the BORROWER records a repayment (no approval, partial allowed): amount ≤ outstanding (else 409 code LOAN_REPAYMENT_EXCEEDS_OUTSTANDING), ≤ the borrower\'s "Dana tersedia" (else 409 code FUND_INSUFFICIENT), date not before the disbursement; destination = the lender\'s designated account (none → 409 INTERCOMPANY_NO_ACCOUNT); lock dates of both PTs. KK in the borrower + automatic KM in the lender; status partially_repaid / repaid; icloan.repaid to the Owner and the lender\'s Finance + Direktur',
    security: h.security,
    request: { headers: h.idem, params: idParam, body: body(L.IcLoanRepay) },
    responses: h.res(201, 'Loan', L.IcLoanDetail, write),
  })
  registry.registerPath({
    method: 'post',
    path: '/intercompany-loans/{id}/repayments/{mid}/void',
    summary: 'Finance of the BORROWER voids a posted repayment (reason): both legs reversed, the loan status recomputed',
    security: h.security,
    request: { headers: h.idem, params: z.object({ id: z.string().regex(/^\d+$/), mid: z.string().regex(/^\d+$/) }), body: body(L.IcLoanReason) },
    responses: h.res(200, 'Loan', L.IcLoanDetail, write),
  })
}
