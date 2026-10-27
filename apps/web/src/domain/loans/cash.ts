import type { PayloadRequest } from 'payload'

import { postEntry, voidEntry, type CashEntryDoc } from '@/domain/cash/ledger'

/**
 * ADR 0031 (DRMS 21/10 #5, amends ADR 0022 §5): the cash legs of an inter-project loan that moves money between two
 * Pusat Biaya (cash accounts of one PT) — `sourceType: 'project_loan'`, linked by `projectLoan` (+ `projectLoanRepayment`).
 * - disbursement (Finance "Cairkan", or the automatic loan of a transfer paid from another account): KK on the LENDER
 *   account + KM on the BORROWER account;
 * - repayment: the mirror pair (KK borrower, KM lender).
 * Same PT on both sides → the PT's "Dana tersedia" (ADR 0029) is unchanged unless one side is a site account. Each
 * posting takes the PT fund lock and the overdraft check of its own account (ledger.postEntry). The DB re-checks the pair
 * at commit (`pk_project_loan_cash_check`, migration 20261021_100200). Voided only through the loan (`viaProjectLoan`).
 * 2026-10-24 (DRMS 24/10 #11/#12): each leg is tagged with the project of ITS side — KK lender account / lender project
 * + KM borrower account / borrower project (a repayment: KK borrower / borrower project + KM lender / lender project), so
 * each project's cash book shows the loan; an automatic loan has no lender project (its lender leg stays untagged). Both
 * projects on ONE account: the pair is posted on that account (KM first, so the account never dips below 0 for it).
 */

export type LoanLegs = { kk: CashEntryDoc; km: CashEntryDoc }

export type LegInput = {
  loanId: number
  repaymentId?: number | null
  /** The account the money leaves (KK). */
  fromAccountId: number
  /** The account the money arrives on (KM). */
  toAccountId: number
  amount: number
  date: string
  description: string
  /** Borrower project — tagged on the borrower-side leg (KM of a disbursement, KK of a repayment: project cash flow). */
  borrowerProjectId?: number | null
  /** 2026-10-24: lender project — tagged on the lender-side leg (KK of a disbursement, KM of a repayment); none for an automatic loan. */
  lenderProjectId?: number | null
  /** QA-04: the KK may make the paying account negative (audited by postEntry). */
  confirmOverdraft?: boolean
  proofId?: number | null
}

/** Posts the KK then the KM of one loan movement (both or nothing — same transaction as the caller). */
export async function postLoanLegs(req: PayloadRequest, input: LegInput): Promise<LoanLegs> {
  const repayment = input.repaymentId ?? null
  const base = {
    entryDate: input.date,
    amount: input.amount,
    description: input.description.slice(0, 1000),
    sourceType: 'project_loan' as const,
    projectLoanId: input.loanId,
    projectLoanRepaymentId: repayment,
    proofId: input.proofId ?? null,
  }
  // each project is tagged on ITS side: disbursement KK lender / KM borrower, repayment KK borrower / KM lender
  const borrower = input.borrowerProjectId ?? null
  const lender = input.lenderProjectId ?? null
  const out = () => postEntry(req, { ...base, direction: 'out', cashAccountId: input.fromAccountId, projectId: repayment !== null ? borrower : lender, confirmOverdraft: input.confirmOverdraft === true })
  const inn = () => postEntry(req, { ...base, direction: 'in', cashAccountId: input.toAccountId, projectId: repayment === null ? borrower : lender })
  if (input.fromAccountId === input.toAccountId) {
    // one shared account: the money arrives before it leaves (the pair nets to 0 on that account)
    const km = await inn()
    return { kk: await out(), km }
  }
  const kk = await out()
  return { kk, km: await inn() }
}

/** Posted `project_loan` legs of a loan's disbursement (repaymentId null) or of one repayment. */
export async function loanLegs(req: PayloadRequest, loanId: number, repaymentId: number | null): Promise<CashEntryDoc[]> {
  const res = await req.payload.find({
    collection: 'cash-entries',
    where: {
      and: [
        { projectLoan: { equals: loanId } },
        { sourceType: { equals: 'project_loan' } },
        { status: { equals: 'posted' } },
        repaymentId === null ? { projectLoanRepayment: { exists: false } } : { projectLoanRepayment: { equals: repaymentId } },
      ],
    },
    depth: 0,
    pagination: false,
    sort: 'id',
    overrideAccess: true, // SYSTEM-READ: cash legs of a loan the caller acts on (checked by the loan service)
    req,
  })
  return res.docs as unknown as CashEntryDoc[]
}

/** Reverses the posted legs of a disbursement / repayment (reason on both; reversal date rule of voidEntry). */
export async function voidLoanLegs(req: PayloadRequest, loanId: number, repaymentId: number | null, reason: string): Promise<number> {
  const legs = await loanLegs(req, loanId, repaymentId)
  for (const e of legs) await voidEntry(req, e.id, reason, { viaProjectLoan: true })
  return legs.length
}

/** Entry numbers of the posted legs (detail views): { kk, km } of the disbursement or of one repayment. */
export async function legNumbers(req: PayloadRequest, loanId: number, repaymentId: number | null): Promise<{ kk: string | null; km: string | null }> {
  const legs = await loanLegs(req, loanId, repaymentId)
  return { kk: legs.find((e) => e.direction === 'out')?.entryNo ?? null, km: legs.find((e) => e.direction === 'in')?.entryNo ?? null }
}
