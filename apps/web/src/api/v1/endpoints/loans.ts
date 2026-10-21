import type { Endpoint } from 'payload'

import { relId } from '@/access/roles'
import { today } from '@/domain/expense/common'
import { loanScope, loanTotals } from '@/domain/loans/report'

import { addRepayment, approveLoan, cancelLoan, createLoan, disburseLoan, editLoan, listLoans, loadVisibleLoan, loanDetail, loanInbox, loanProjectOptions, rejectLoan, submitLoan, voidRepayment, type LoanDoc } from '@/domain/loans/service'
import { withReqTransaction } from '@/lib/system-tx'

import { companyQuery } from '../company-query'
import { HttpError, json, v1 } from '../http'
import { withNamedCompany } from '../named-company'
import { LoanCreate, LoanDecision, LoanDisburse, LoanListQuery, LoanReason, LoanReject, LoanUpdate, RepaymentCreate } from '../schemas-loans'

/**
 * ADR 0022 Pinjaman antar project. Mutations: transactional + Idempotency-Key (mandatory for the APK), 30/min per
 * user like the addendum. Role checks live in the domain service (borrower PM creates; Direktur decides, G1;
 * ADR 0031: Finance disburses a cash-backed loan; borrower PM / Finance repay — Finance only when cash moves;
 * Direktur / Finance void).
 */
const WRITE_LIMIT: [number, number] = [30, 60_000]

function idParam(params: Record<string, string>, key = 'id'): number {
  const v = params[key] ?? ''
  if (!/^\d{1,10}$/.test(v)) throw new HttpError(404, 'Not Found')
  return Number(v)
}

type Req = Parameters<typeof loanDetail>[0]
// user 2026-10-19 (APK phase 3): `today` = business date of the loan's PT (repayment date max)
const detail = async (req: Req, doc: LoanDoc, status = 200) => json({ ...(await loanDetail(req, doc)), today: await today(req, relId(doc.company)) }, status)

export const listLoansEndpoint = v1({
  path: '/project-loans',
  method: 'get',
  handler: async ({ req }) => {
    const q = LoanListQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) throw new HttpError(400, 'Bad Request', { errors: q.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) })
    const companyIds = await companyQuery(req)
    return json(
      await withReqTransaction(req, async () => {
        const page = await listLoans(req, { projectId: q.data.project, role: q.data.role, status: q.data.status, overdue: q.data.overdue !== undefined, q: q.data.q, page: q.data.page, limit: q.data.limit, companyIds })
        if (q.data.summary === undefined) return page
        // user 2026-10-19 (APK Pinjaman list): the web LoanList tiles
        const t = await loanTotals(req, await loanScope(req))
        const totals = { pending: t.pending, amount: t.amount, repaid: t.repaid, outstanding: t.outstanding, overdueCount: t.overdueCount, overdue: t.overdue }
        return { ...page, summary: { totals, inboxCount: (await loanInbox(req)).items.length, canCreate: (await loanProjectOptions(req)).borrowers.length > 0 } }
      }),
    )
  },
})

/** Loans waiting for the caller's decision (Direktur) — web inbox + APK. */
export const loanInboxEndpoint = v1({
  path: '/project-loans/inbox',
  method: 'get',
  handler: async ({ req }) => {
    const companyIds = await companyQuery(req)
    return json(await withReqTransaction(req, () => loanInbox(req, { companyIds })))
  },
})

export const loanOptionsEndpoint = v1({
  path: '/project-loans/options',
  method: 'get',
  handler: async ({ req }) => json(await withReqTransaction(req, () => loanProjectOptions(req))),
})

export const getLoanEndpoint = v1({
  path: '/project-loans/:id',
  method: 'get',
  handler: async ({ req, params }) => {
    const id = idParam(params)
    return withReqTransaction(req, async () => detail(req, await loadVisibleLoan(req, id)))
  },
})

export const createLoanEndpoint = v1({
  path: '/project-loans',
  method: 'post',
  body: LoanCreate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  // MC4: optional body `company` = the borrower project's PT; PM IN that PT (borrower-PM check in the service)
  handler: async ({ req, body }) =>
    withNamedCompany(req, body.company, { roles: ['pk-pm'], refs: [{ collection: 'projects', id: body.borrowerProjectId, path: 'borrowerProjectId' }] }, async () =>
      detail(
        req,
        await createLoan(req, {
          borrowerProjectId: body.borrowerProjectId,
          lenderProjectId: body.lenderProjectId,
          kind: body.kind,
          amount: body.amount,
          reason: body.reason,
          loanDate: body.loanDate,
          dueDate: body.dueDate,
          submit: body.submit === true,
        }),
        201,
      ),
    ),
})

export const updateLoanEndpoint = v1({
  path: '/project-loans/:id',
  method: 'patch',
  body: LoanUpdate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => detail(req, await editLoan(req, idParam(params), body)),
})

export const submitLoanEndpoint = v1({
  path: '/project-loans/:id/submit',
  method: 'post',
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, params }) => detail(req, await submitLoan(req, idParam(params))),
})

export const cancelLoanEndpoint = v1({
  path: '/project-loans/:id/cancel',
  method: 'post',
  body: LoanReason,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => detail(req, await cancelLoan(req, idParam(params), body.reason)),
})

export const approveLoanEndpoint = v1({
  path: '/project-loans/:id/approve',
  method: 'post',
  body: LoanDecision,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => detail(req, await approveLoan(req, idParam(params), { signatureMediaId: body.signatureMediaId ?? null })),
})

export const rejectLoanEndpoint = v1({
  path: '/project-loans/:id/reject',
  method: 'post',
  body: LoanReject,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => detail(req, await rejectLoan(req, idParam(params), body.reason, { signatureMediaId: body.signatureMediaId ?? null })),
})

export const addRepaymentEndpoint = v1({
  path: '/project-loans/:id/repayments',
  method: 'post',
  body: RepaymentCreate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => detail(req, await addRepayment(req, idParam(params), { amount: body.amount, repayDate: body.repayDate, note: body.note ?? null, confirmOverdraft: body.confirmOverdraft === true }), 201),
})

/** ADR 0031 "Cairkan": Finance posts the KK / KM of an approved cash-backed loan (once). */
export const disburseLoanEndpoint = v1({
  path: '/project-loans/:id/disburse',
  method: 'post',
  body: LoanDisburse,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) =>
    detail(req, await disburseLoan(req, idParam(params), { disburseDate: body.disburseDate, note: body.note ?? null, proofMediaId: body.proofMediaId ?? null, confirmOverdraft: body.confirmOverdraft === true })),
})

export const voidRepaymentEndpoint = v1({
  path: '/project-loans/:id/repayments/:rid/void',
  method: 'post',
  body: LoanReason,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => detail(req, await voidRepayment(req, idParam(params), idParam(params, 'rid'), body.reason)),
})

/** Order matters: `/project-loans/inbox` and `/options` before `/project-loans/:id`. */
export const LOAN_ENDPOINTS: Endpoint[] = [
  listLoansEndpoint,
  loanInboxEndpoint,
  loanOptionsEndpoint,
  getLoanEndpoint,
  createLoanEndpoint,
  updateLoanEndpoint,
  submitLoanEndpoint,
  cancelLoanEndpoint,
  approveLoanEndpoint,
  rejectLoanEndpoint,
  disburseLoanEndpoint,
  addRepaymentEndpoint,
  voidRepaymentEndpoint,
]
