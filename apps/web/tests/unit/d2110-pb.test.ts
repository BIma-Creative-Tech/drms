import { describe, expect, it } from 'vitest'

import { addDays, AUTO_LOAN_DUE_DAYS, isCashBacked, loanAllowedActions, mayVoidRepayment, type LoanActorContext } from '@/domain/loans/rules'
import { projectCashAccountValidate, PROJECT_PB_REQUIRED } from '@/collections/Projects'
import { migrations } from '@/migrations'
import { RENUMBER_GUARDED_FUNCTIONS, RENUMBER_NEUTRAL_FUNCTIONS } from '@/migrations/20261013_610000_d1310_renumber'

/** ADR 0031 (DRMS 21/10) "Pusat Biaya = akun kas": pure rules of the cash-backed inter-project loan + wiring. */

const ctx = (over: Partial<LoanActorContext> = {}): LoanActorContext => ({
  status: 'approved',
  isCreator: false,
  isBorrowerPm: false,
  isDirektur: false,
  isFinance: false,
  mayDecide: false,
  hasRepayment: false,
  ...over,
})

describe('isCashBacked: money between two different known accounts', () => {
  it.each([
    [{ kind: 'dana', lenderCashAccountId: 1, borrowerCashAccountId: 2 }, true],
    [{ kind: 'dana', lenderCashAccountId: 1, borrowerCashAccountId: 1 }, false],
    [{ kind: 'barang', lenderCashAccountId: 1, borrowerCashAccountId: 2 }, false],
    [{ kind: 'dana', lenderCashAccountId: null, borrowerCashAccountId: 2 }, false],
    [{ kind: 'dana', lenderCashAccountId: 1, borrowerCashAccountId: undefined }, false],
  ] as const)('%o → %s', (l, want) => {
    expect(isCashBacked(l)).toBe(want)
  })
})

describe('automatic loan due date', () => {
  it('transfer date + 30 days, across months / years', () => {
    expect(AUTO_LOAN_DUE_DAYS).toBe(30)
    expect(addDays('2026-10-21', 30)).toBe('2026-11-20')
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14')
  })
})

describe('loanAllowedActions with cash (ADR 0031)', () => {
  it('approved cash-backed loan: Finance disburses once; nobody repays before the disbursement', () => {
    expect(loanAllowedActions(ctx({ isFinance: true, cashBacked: true, disbursed: false }))).toEqual(['disburse'])
    expect(loanAllowedActions(ctx({ isBorrowerPm: true, cashBacked: true, disbursed: false }))).toEqual([])
    expect(loanAllowedActions(ctx({ isFinance: true, cashBacked: true, disbursed: true }))).toEqual(['repay'])
    expect(loanAllowedActions(ctx({ isBorrowerPm: true, cashBacked: true, disbursed: true }))).toEqual([])
  })

  it('a claim (no cash) keeps ADR 0022: borrower PM or Finance repay, no disbursement', () => {
    expect(loanAllowedActions(ctx({ isBorrowerPm: true }))).toEqual(['repay'])
    expect(loanAllowedActions(ctx({ isFinance: true }))).toEqual(['repay'])
  })

  it('cancel: not once disbursed, never for an automatic loan (its transfer void does it)', () => {
    expect(loanAllowedActions(ctx({ isDirektur: true, cashBacked: true, disbursed: false }))).toContain('cancel')
    expect(loanAllowedActions(ctx({ isDirektur: true, cashBacked: true, disbursed: true }))).not.toContain('cancel')
    expect(loanAllowedActions(ctx({ isDirektur: true, origin: 'transfer', cashBacked: true, disbursed: true }))).not.toContain('cancel')
  })

  it('void of a repayment that moved cash: Finance only', () => {
    expect(mayVoidRepayment({ isDirektur: true, isFinance: false, cashBacked: true })).toBe(false)
    expect(mayVoidRepayment({ isDirektur: false, isFinance: true, cashBacked: true })).toBe(true)
    expect(mayVoidRepayment({ isDirektur: true, isFinance: false, cashBacked: false })).toBe(true)
  })
})

describe('project Pusat Biaya validation', () => {
  const user = { user: { id: 1 } }
  it('required on a user create and when a user clears a stored one; legacy unmapped rows stay editable; system writes pass', () => {
    expect(projectCashAccountValidate(undefined, { operation: 'create', req: user })).toBe(PROJECT_PB_REQUIRED)
    expect(projectCashAccountValidate(null, { operation: 'update', req: user, previousValue: 3 })).toBe(PROJECT_PB_REQUIRED)
    expect(projectCashAccountValidate(null, { operation: 'update', req: user, previousValue: null })).toBe(true)
    expect(projectCashAccountValidate(undefined, { operation: 'update', req: user })).toBe(true)
    expect(projectCashAccountValidate(undefined, { operation: 'create', req: {} })).toBe(true)
    expect(projectCashAccountValidate(7, { operation: 'create', req: user })).toBe(true)
  })
})

describe('migrations wiring', () => {
  it('enum → schema → guard, in this order', () => {
    const names = migrations.map((m) => m.name)
    const i = names.indexOf('20261021_100000_d2110_pb_enums')
    expect(names.slice(i, i + 3)).toEqual(['20261021_100000_d2110_pb_enums', '20261021_100100_d2110_pb_schema', '20261021_100200_d2110_pb_guard'])
  })

  it('renumber lists: the loan guard keeps its prelude, the new trigger functions are neutral', () => {
    expect(RENUMBER_GUARDED_FUNCTIONS as readonly string[]).toContain('pk_project_loans_guard')
    expect(RENUMBER_NEUTRAL_FUNCTIONS).toEqual(expect.arrayContaining(['pk_project_loan_cash_consistency', 'pk_transfers_paid_from_loan']))
  })
})
