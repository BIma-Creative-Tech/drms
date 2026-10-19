import type { Endpoint } from 'payload'

import { hasRole, membershipsOf } from '@/access/roles'
import { today } from '@/domain/expense/common'
import { FUND_VIEW_ROLES, fundAvailability } from '@/domain/fundcheck/service'
import { icLoanPositions, icLoanReportScope } from '@/domain/intercompany/loan-report'
import { IC_LOAN_STATUSES, type IcLoanStatus } from '@/domain/intercompany/loan-rules'
import {
  cancelIcLoan,
  disburseIcLoan,
  icLenderOptions,
  icLoanDetail,
  icLoanQueue,
  instructIcLoan,
  listIcLoans,
  loadVisibleIcLoan,
  repayIcLoan,
  voidIcDisbursement,
  voidIcRepayment,
} from '@/domain/intercompany/loans'
import { withReqTransaction } from '@/lib/system-tx'

import { assertSelectedCompanies, companyQuery } from '../company-query'
import { HttpError, json, v1 } from '../http'
import { FundAvailabilityQuery, IcLenderQuery, IcLoanCreate, IcLoanDisburse, IcLoanListQuery, IcLoanReason, IcLoanRepay, IcLoanVoidDisbursement } from '../schemas-icloans'

/**
 * ADR 0029 "Pinjaman antar-PT" (+ the fund availability of a PT). Mutations: transactional + Idempotency-Key (mandatory
 * for the APK), 30/min per user. Role checks live in the domain service (Owner instructs / cancels — stored pk-principal
 * in BOTH PTs; Finance of the lender disburses (G1: not the creator) and voids it; Finance of the borrower repays and
 * voids a repayment). Reads: Owner / Direktur / Finance / Admin of either PT (else 404).
 */
const WRITE_LIMIT: [number, number] = [30, 60_000]

function idParam(params: Record<string, string>, key = 'id'): number {
  const v = params[key] ?? ''
  if (!/^\d{1,10}$/.test(v)) throw new HttpError(404, 'Not Found')
  return Number(v)
}

function bad(issues: Array<{ path: PropertyKey[]; message: string }>): never {
  throw new HttpError(400, 'Bad Request', { errors: issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) })
}

type Req = Parameters<typeof icLoanDetail>[0]
// user 2026-10-19 (APK phase 3): business dates of both PTs (disbursement / repayment date max)
const detail = async (req: Req, id: number, status = 200) => {
  const d = await icLoanDetail(req, await loadVisibleIcLoan(req, id))
  return json({ ...d, lenderToday: await today(req, d.lender?.id), borrowerToday: await today(req, d.borrower?.id) }, status)
}

/** PTs where the caller is Owner (STORED pk-principal) — as admin/views/IntercompanyLoans.tsx ownerPts. */
const ownerPts = (req: Req): number[] =>
  membershipsOf(req.user, { all: true })
    .filter((m) => (m.exactRoles ?? m.roles).includes('pk-principal'))
    .map((m) => m.company)

export const listIcLoansEndpoint = v1({
  path: '/intercompany-loans',
  method: 'get',
  handler: async ({ req }) => {
    const q = IcLoanListQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) bad(q.error.issues)
    const status = (q.data!.status ?? '').split(',').filter((s): s is IcLoanStatus => (IC_LOAN_STATUSES as readonly string[]).includes(s))
    const companyIds = await companyQuery(req)
    return json(
      await withReqTransaction(req, async () => {
        const page = await listIcLoans(req, { companyIds, role: q.data!.role, status, overdue: q.data!.overdue !== undefined, q: q.data!.q, page: q.data!.page, limit: q.data!.limit })
        if (q.data!.summary === undefined) return page
        // user 2026-10-19 (APK Pinjaman antar-PT list): the web IcLoanList tiles
        const positions = await icLoanPositions(req, await icLoanReportScope(req))
        const sum = (k: 'receivable' | 'payable' | 'overdue') => positions.reduce((s, x) => s + x[k], 0)
        return { ...page, summary: { receivable: sum('receivable'), payable: sum('payable'), overdue: sum('overdue'), queueCount: (await icLoanQueue(req)).count, canInstruct: ownerPts(req).length > 1 } }
      }),
    )
  },
})

/** Disbursement queue of the lender's Finance ("Pencairan pinjaman antar-PT"); ?company= narrows. */
export const icLoanQueueEndpoint = v1({
  path: '/intercompany-loans/queue',
  method: 'get',
  handler: async ({ req }) => {
    const companyIds = await companyQuery(req)
    return json(await withReqTransaction(req, () => icLoanQueue(req, { companyIds })))
  },
})

/** Lender list of the instruction form (Owner of the borrower PT; every other PT where the caller is Owner). */
export const icLendersEndpoint = v1({
  path: '/intercompany-loans/lenders',
  method: 'get',
  rateLimit: [60, 60_000],
  handler: async ({ req }) => {
    const q = IcLenderQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) bad(q.error.issues)
    return json(await withReqTransaction(req, () => icLenderOptions(req, q.data!.borrower, q.data!.amount ?? null)))
  },
})

export const getIcLoanEndpoint = v1({
  path: '/intercompany-loans/:id',
  method: 'get',
  handler: async ({ req, params }) => {
    const id = idParam(params)
    return withReqTransaction(req, () => detail(req, id))
  },
})

export const createIcLoanEndpoint = v1({
  path: '/intercompany-loans',
  method: 'post',
  body: IcLoanCreate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body }) => {
    const l = await instructIcLoan(req, { borrowerCompanyId: body.borrowerCompanyId, lenderCompanyId: body.lenderCompanyId, amount: body.amount, dueDate: body.dueDate ?? null, reason: body.reason, requestIds: body.requestIds ?? [] })
    return detail(req, l.id, 201)
  },
})

export const cancelIcLoanEndpoint = v1({
  path: '/intercompany-loans/:id/cancel',
  method: 'post',
  body: IcLoanReason,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const l = await cancelIcLoan(req, idParam(params), body.reason)
    return detail(req, l.id)
  },
})

export const disburseIcLoanEndpoint = v1({
  path: '/intercompany-loans/:id/disburse',
  method: 'post',
  body: IcLoanDisburse,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const r = await disburseIcLoan(req, idParam(params), body)
    return detail(req, r.loan.id)
  },
})

export const voidIcDisbursementEndpoint = v1({
  path: '/intercompany-loans/:id/disbursement/void',
  method: 'post',
  body: IcLoanVoidDisbursement,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const l = await voidIcDisbursement(req, idParam(params), body.reason, { confirmBorrowerShortfall: body.confirmBorrowerShortfall === true })
    return detail(req, l.id)
  },
})

export const repayIcLoanEndpoint = v1({
  path: '/intercompany-loans/:id/repayments',
  method: 'post',
  body: IcLoanRepay,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const r = await repayIcLoan(req, idParam(params), body)
    return detail(req, r.loan.id, 201)
  },
})

export const voidIcRepaymentEndpoint = v1({
  path: '/intercompany-loans/:id/repayments/:mid/void',
  method: 'post',
  body: IcLoanReason,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const l = await voidIcRepayment(req, idParam(params), idParam(params, 'mid'), body.reason)
    return detail(req, l.id)
  },
})

/**
 * GET /fund-availability?company= (ADR 0029 §6): "Dana tersedia" of one PT — Finance / Direktur / Owner of THAT PT
 * within the caller's selection (else 403 / COMPANY_NOT_ALLOWED).
 */
export const fundAvailabilityEndpoint = v1({
  path: '/fund-availability',
  method: 'get',
  rateLimit: [60, 60_000],
  handler: async ({ req }) => {
    const q = FundAvailabilityQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) bad(q.error.issues)
    const company = q.data!.company
    await assertSelectedCompanies(req, [company], 'company')
    if (!hasRole(req, FUND_VIEW_ROLES, company)) throw new HttpError(403, 'Forbidden', { detail: 'Ketersediaan dana hanya untuk Finance, Direktur atau Owner PT ini.' })
    return json(await withReqTransaction(req, () => fundAvailability(req, company)))
  },
})

/** Order matters: `/intercompany-loans/queue` and `/lenders` before `/intercompany-loans/:id`. */
export const INTERCOMPANY_LOAN_ENDPOINTS: Endpoint[] = [
  listIcLoansEndpoint,
  icLoanQueueEndpoint,
  icLendersEndpoint,
  getIcLoanEndpoint,
  createIcLoanEndpoint,
  cancelIcLoanEndpoint,
  disburseIcLoanEndpoint,
  voidIcDisbursementEndpoint,
  repayIcLoanEndpoint,
  voidIcRepaymentEndpoint,
  fundAvailabilityEndpoint,
]
