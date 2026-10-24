import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LoanExecute, LoanInbox, LoanTransferOrders, RepaymentCreate } from '@/api/v1/schemas-loans'
import {
  decisionPools,
  executeDateError,
  levelOf,
  loanOriginLabel,
  loanStatusLabel,
  mayDecideLevel,
  pendingLabel,
  POOL_ERROR_MESSAGES,
  REPAYMENT_STATUSES,
  REPAYMENT_TRANSITIONS,
  repaymentAllowedActions,
  repaymentRequestErrors,
  repaymentStatusLabel,
  reservedOf,
  type RepaymentActorContext,
} from '@/domain/loans/rules'
import { migrations } from '@/migrations'
import { RENUMBER_GUARDED_FUNCTIONS } from '@/migrations/20261013_610000_d1310_renumber'

/**
 * DRMS 24/10 #10–#12 (ADR 0022 / 0031 amendment 2026-10-24) — pure rules: two decision levels (Direktur → Owner, G1),
 * labels per level, repayment requests (statuses, row actions, reservation, planned date), execution date, contract and
 * migration wiring. Fictional data only.
 */

describe('decision pools at submit (G1)', () => {
  it('creator not a decider: every Direktur, every Owner', () => {
    expect(decisionPools(5, [9, 7], [3])).toEqual({ direktur: [7, 9], owner: [3], exception: null, error: null })
  })
  it('creator is the only Direktur → direktur_self at level 1 only; the Owner level is never the creator', () => {
    expect(decisionPools(7, [7], [3])).toEqual({ direktur: [7], owner: [3], exception: 'direktur_self', error: null })
    expect(decisionPools(3, [7], [3]).error).toBe('NO_OWNER') // the only Owner filed it
  })
  it('no Owner / no Direktur → refused with a clear message', () => {
    expect(decisionPools(5, [7], []).error).toBe('NO_OWNER')
    expect(decisionPools(5, [], [3]).error).toBe('NO_DIREKTUR')
    expect(POOL_ERROR_MESSAGES.NO_OWNER).toMatch(/belum punya Owner aktif/)
  })
  it('one person cannot hold both levels: the single Direktur who is also the single Owner → SAME_PERSON', () => {
    expect(decisionPools(5, [7], [7]).error).toBe('SAME_PERSON')
    expect(decisionPools(5, [7, 8], [7]).error).toBeNull()
    expect(decisionPools(5, [7], [7, 8]).error).toBeNull()
  })
})

describe('mayDecideLevel', () => {
  const base = { callerId: 1, creatorId: 2, callerIsDirektur: false, callerIsOwner: false, g1Exception: null }
  it('level 1: stored Direktur, not the creator (unless direktur_self), not the last Owner for level 2', () => {
    expect(mayDecideLevel({ ...base, level: 1, callerIsDirektur: true })).toBe(true)
    expect(mayDecideLevel({ ...base, level: 1, callerIsOwner: true })).toBe(false) // the Owner's implied Direktur role
    expect(mayDecideLevel({ ...base, level: 1, callerId: 2, callerIsDirektur: true })).toBe(false)
    expect(mayDecideLevel({ ...base, level: 1, callerId: 2, callerIsDirektur: true, g1Exception: 'direktur_self' })).toBe(true)
    expect(mayDecideLevel({ ...base, level: 1, callerIsDirektur: true, callerIsOwner: true, ownerPool: [1] })).toBe(false)
    expect(mayDecideLevel({ ...base, level: 1, callerIsDirektur: true, callerIsOwner: true, ownerPool: [1, 4] })).toBe(true)
  })
  it('level 2: stored Owner, never the creator (no exception), never the level-1 decider', () => {
    expect(mayDecideLevel({ ...base, level: 2, callerIsOwner: true })).toBe(true)
    expect(mayDecideLevel({ ...base, level: 2, callerIsDirektur: true })).toBe(false)
    expect(mayDecideLevel({ ...base, level: 2, callerId: 2, callerIsOwner: true, g1Exception: 'direktur_self' })).toBe(false)
    expect(mayDecideLevel({ ...base, level: 2, callerIsOwner: true, priorDeciders: [1] })).toBe(false)
  })
})

describe('labels per level / origin', () => {
  it('"Menunggu persetujuan Direktur" / "… Owner"; awaiting transfer; origin by submitter', () => {
    expect(pendingLabel(1)).toBe('Menunggu persetujuan Direktur')
    expect(pendingLabel(2)).toBe('Menunggu persetujuan Owner')
    expect(levelOf(null)).toBe(1) // legacy / unset = level 1
    expect(loanStatusLabel({ status: 'pending_approval', approvalLevel: 2 })).toBe('Menunggu persetujuan Owner')
    expect(loanStatusLabel({ status: 'approved', awaitingDisbursement: true })).toBe('Disetujui – menunggu transfer Finance')
    expect(loanStatusLabel({ status: 'approved' })).toBe('Disetujui')
    expect(loanOriginLabel('manual', 'finance')).toBe('Diajukan Finance')
    expect(loanOriginLabel('manual', null)).toBe('Diajukan PM')
    expect(loanOriginLabel('transfer', null)).toBe('Otomatis dari transfer')
  })
})

describe('repayment requests (#12)', () => {
  const rc = (over: Partial<RepaymentActorContext> = {}): RepaymentActorContext => ({ status: 'pending_approval', isCreator: false, isDirektur: false, isFinance: false, mayDecide: false, cashBacked: true, ...over })
  it('statuses: posted = executed (existing rows), transitions mirrored by the DB guard', () => {
    expect(REPAYMENT_STATUSES).toEqual(['pending_approval', 'approved', 'posted', 'void', 'rejected', 'cancelled'])
    expect(REPAYMENT_TRANSITIONS.pending_approval).toEqual(['approved', 'rejected', 'cancelled'])
    expect(REPAYMENT_TRANSITIONS.approved).toEqual(['posted', 'cancelled'])
    expect(REPAYMENT_TRANSITIONS.posted).toEqual(['void'])
    expect(repaymentStatusLabel('pending_approval', 2)).toBe('Menunggu persetujuan Owner')
    expect(repaymentStatusLabel('approved')).toBe('Disetujui – menunggu transfer Finance')
  })
  it('row actions: decide at the level, submitter cancels while pending, Finance executes (also its own) / cancels once approved, void once posted', () => {
    expect(repaymentAllowedActions(rc({ mayDecide: true }))).toEqual(['approve', 'reject'])
    expect(repaymentAllowedActions(rc({ isCreator: true }))).toEqual(['cancel'])
    expect(repaymentAllowedActions(rc({ status: 'approved', isFinance: true, isCreator: true }))).toEqual(['execute', 'cancel'])
    expect(repaymentAllowedActions(rc({ status: 'approved', isCreator: true }))).toEqual(['cancel'])
    expect(repaymentAllowedActions(rc({ status: 'approved', isDirektur: true }))).toEqual([])
    expect(repaymentAllowedActions(rc({ status: 'posted', isFinance: true }))).toEqual(['void'])
    expect(repaymentAllowedActions(rc({ status: 'posted', isDirektur: true }))).toEqual([]) // cash moved: Finance only
    expect(repaymentAllowedActions(rc({ status: 'posted', isDirektur: true, cashBacked: false }))).toEqual(['void'])
    expect(repaymentAllowedActions(rc({ status: 'rejected', isFinance: true, isCreator: true }))).toEqual([])
  })
  it('open requests reserve the outstanding amount; a request: amount ≤ the rest, planned date ≥ loan date (future allowed)', () => {
    expect(reservedOf([{ status: 'pending_approval', amount: 100 }, { status: 'approved', amount: '50' }, { status: 'posted', amount: 70 }, { status: 'rejected', amount: 9 }])).toBe(150)
    const loan = { loanDate: '2026-10-01', repayable: 1_000 }
    expect(repaymentRequestErrors({ amount: 1_000, repayDate: '2026-12-31' }, loan)).toEqual([])
    expect(repaymentRequestErrors({ amount: 1_001, repayDate: '2026-10-02' }, loan)[0]).toMatchObject({ path: 'amount' })
    expect(repaymentRequestErrors({ amount: 10, repayDate: '2026-09-30' }, loan)[0]).toMatchObject({ path: 'repayDate' })
    expect(repaymentRequestErrors({ amount: 10, repayDate: '30-09-2026' }, loan)[0]).toMatchObject({ path: 'repayDate' })
  })
  it('execution date: between the loan date and today', () => {
    expect(executeDateError('2026-10-24', { minDate: '2026-10-01', today: '2026-10-24' })).toBeNull()
    expect(executeDateError('2026-10-25', { minDate: '2026-10-01', today: '2026-10-24' })?.message).toMatch(/masa depan/)
    expect(executeDateError('2026-09-30', { minDate: '2026-10-01', today: '2026-10-24' })?.message).toMatch(/sebelum tanggal pinjaman/)
  })
})

describe('contract', () => {
  it('execute body: strict, optional date / note / proof / overdraft confirmation', () => {
    expect(LoanExecute.safeParse({}).success).toBe(true)
    expect(LoanExecute.safeParse({ executeDate: '2026-10-24', note: 'BCA', proofMediaId: 3, confirmOverdraft: true }).success).toBe(true)
    expect(LoanExecute.safeParse({ executeDate: '24-10-2026' }).success).toBe(false)
    expect(LoanExecute.safeParse({ cashAccountId: 1 }).success).toBe(false) // the accounts are frozen at the approval
    expect(RepaymentCreate.safeParse({ amount: 5, repayDate: '2027-01-31' }).success).toBe(true) // planned date in the future
  })
  it('inbox carries repayment requests; transfer orders carry both kinds', () => {
    expect(LoanInbox.shape.repayments).toBeDefined()
    expect(LoanTransferOrders.shape.items.element.shape.kind.options).toEqual(['loan', 'repayment'])
  })
})

describe('migrations wiring (20261024_4x0000_d2410_*)', () => {
  it('enums → schema → data (in-flight) → guards, in this order, after the PB fund migration', () => {
    const names = migrations.map((m) => m.name)
    const i = names.indexOf('20261024_400000_d2410_loan_enums')
    expect(i).toBeGreaterThan(names.indexOf('20261022_100000_d2210_pb_fund'))
    expect(names.slice(i, i + 4)).toEqual(['20261024_400000_d2410_loan_enums', '20261024_400100_d2410_loan_schema', '20261024_400200_d2410_loan_data', '20261024_400300_d2410_loan_guard'])
  })
  it('the loan guard keeps its renumber prelude; the approvals G1 trigger knows both loan doc types', () => {
    expect(RENUMBER_GUARDED_FUNCTIONS as readonly string[]).toContain('pk_project_loans_guard')
    const src = readFileSync(join(process.cwd(), 'src/migrations/20261024_400300_d2410_loan_guard.ts'), 'utf8')
    expect(src).toContain('withPrelude(LOANS_GUARD_NEW)')
    expect(src).toContain("NEW.doc_type::text = 'project_loan_repayment'")
    expect(src).toContain("'pk-principal'")
  })
})
