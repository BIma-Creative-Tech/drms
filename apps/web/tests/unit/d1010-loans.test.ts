import { describe, expect, it } from 'vitest'

import { LoanCreate, LoanListQuery, RepaymentCreate } from '@/api/v1/schemas-loans'
import { docHref } from '@/admin/doc-links'
import { loanReportFilter } from '@/domain/loans/report'
import {
  canTransition,
  daysOverdue,
  direkturPool,
  isOverdue,
  isTerminal,
  LOAN_STATUSES,
  LOAN_TRANSITIONS,
  loanAllowedActions,
  loanInputErrors,
  mayDecide,
  mayVoidRepayment,
  outstandingOf,
  repaymentInputErrors,
  statusForRepaid,
  type LoanActorContext,
} from '@/domain/loans/rules'
import { DEFAULT_SEQUENCES, formatDocNo, patternError } from '@/domain/numbering'
import { REMINDER_EVENTS, REMINDER_RULES, reminderSettingsOf } from '@/domain/reminders/rules'
import { notificationHref } from '@/domain/notifications'

/** ADR 0022 Pinjaman antar project — pure rules (statuses, input, arithmetic, G1 pool, actions), contract, numbering. */
const TODAY = '2026-10-11'
const ok = { lenderProjectId: 1, borrowerProjectId: 2, kind: 'dana', amount: 5_000_000, reason: 'Termin belum cair', loanDate: TODAY, dueDate: '2026-11-11' }
const ctx = (over: Partial<LoanActorContext> = {}): LoanActorContext => ({ status: 'draft', isCreator: false, isBorrowerPm: false, isDirektur: false, isFinance: false, mayDecide: false, hasRepayment: false, ...over })

describe('status machine (DB guard pk_project_loans_guard mirrors it)', () => {
  it('transitions table: Draft → Menunggu → Disetujui → Sebagian kembali ⇄ Lunas; Ditolak / Dibatalkan terminal', () => {
    expect(LOAN_TRANSITIONS.draft).toEqual(['pending_approval', 'cancelled'])
    expect(LOAN_TRANSITIONS.pending_approval).toEqual(['approved', 'rejected', 'cancelled'])
    expect(canTransition('approved', 'repaid')).toBe(true)
    expect(canTransition('repaid', 'partially_repaid')).toBe(true) // void of a repayment
    expect(canTransition('partially_repaid', 'cancelled')).toBe(false) // repayment exists
    expect(canTransition('draft', 'approved')).toBe(false)
    expect(LOAN_STATUSES.filter(isTerminal)).toEqual(['rejected', 'cancelled'])
  })

  it('status from the repaid total; outstanding never negative', () => {
    expect(statusForRepaid(100, 0)).toBe('approved')
    expect(statusForRepaid(100, 40)).toBe('partially_repaid')
    expect(statusForRepaid(100, 100)).toBe('repaid')
    expect(outstandingOf(100, 40)).toBe(60)
    expect(outstandingOf(100, 120)).toBe(0)
  })

  it('overdue is derived: due date before today, outstanding > 0, approved / partially repaid only', () => {
    const l = { status: 'partially_repaid' as const, dueDate: '2026-10-01', outstanding: 10 }
    expect(isOverdue(l, TODAY)).toBe(true)
    expect(daysOverdue(l, TODAY)).toBe(10)
    expect(isOverdue({ ...l, dueDate: TODAY }, TODAY)).toBe(false) // due today = not late yet
    expect(isOverdue({ ...l, outstanding: 0 }, TODAY)).toBe(false)
    expect(isOverdue({ ...l, status: 'repaid' }, TODAY)).toBe(false)
    expect(isOverdue({ ...l, status: 'pending_approval' }, TODAY)).toBe(false)
    expect(daysOverdue({ ...l, status: 'approved', dueDate: '2026-09-30' }, '2026-10-01')).toBe(1)
  })
})

describe('input rules', () => {
  it('a valid Draft has no errors', () => expect(loanInputErrors(ok, TODAY)).toEqual([]))

  it('amount, reason, projects, dates', () => {
    const paths = (o: Record<string, unknown>) => loanInputErrors({ ...ok, ...o }, TODAY).map((e) => e.path)
    expect(paths({ amount: 0 })).toEqual(['amount'])
    expect(paths({ amount: 1.5 })).toEqual(['amount'])
    expect(paths({ amount: 1_000_000_000_001 })).toEqual(['amount'])
    expect(paths({ reason: ' a ' })).toEqual(['reason'])
    expect(paths({ lenderProjectId: 2 })).toEqual(['lenderProjectId'])
    expect(paths({ lenderProjectId: undefined })).toEqual(['lenderProjectId'])
    expect(paths({ kind: 'jasa' })).toEqual(['kind'])
    expect(paths({ loanDate: '2026-10-12' })).toEqual(['loanDate'])
    expect(paths({ loanDate: '2026-02-30' })).toEqual(['loanDate'])
    expect(paths({ dueDate: undefined })).toEqual(['dueDate'])
    expect(paths({ dueDate: '2026-10-10' })).toEqual(['dueDate'])
    expect(paths({ dueDate: TODAY })).toEqual([])
  })

  it('repayment: > 0, ≤ outstanding, between the loan date and today', () => {
    const loan = { loanDate: '2026-10-01', outstanding: 3_000_000 }
    const paths = (o: Record<string, unknown>) => repaymentInputErrors({ amount: 1_000_000, repayDate: TODAY, ...o }, loan, TODAY).map((e) => e.path)
    expect(paths({})).toEqual([])
    expect(paths({ amount: 3_000_000 })).toEqual([])
    expect(paths({ amount: 3_000_001 })).toEqual(['amount'])
    expect(paths({ amount: -1 })).toEqual(['amount'])
    expect(paths({ repayDate: '2026-09-30' })).toEqual(['repayDate'])
    expect(paths({ repayDate: '2026-10-12' })).toEqual(['repayDate'])
    expect(paths({ note: 'x'.repeat(501) })).toEqual(['note'])
  })
})

describe('G1 pool (ADR 0022 §4, ADR 0021 "Utamakan Direktur lain")', () => {
  it('creator not a Direktur → every Direktur decides', () => expect(direkturPool(5, [9, 7])).toEqual({ pool: [7, 9], exception: null }))
  it('creator is a Direktur and another exists → only the others, no exception', () => expect(direkturPool(7, [7, 9])).toEqual({ pool: [9], exception: null }))
  it('creator is the ONLY Direktur → himself, recorded direktur_self', () => expect(direkturPool(7, [7])).toEqual({ pool: [7], exception: 'direktur_self' }))
  it('no Direktur → empty pool (submit 409)', () => expect(direkturPool(7, [])).toEqual({ pool: [], exception: null }))
  it('decision time: Direktur role required; the creator only under direktur_self', () => {
    expect(mayDecide({ callerId: 1, creatorId: 2, callerIsDirektur: true, g1Exception: null })).toBe(true)
    expect(mayDecide({ callerId: 1, creatorId: 2, callerIsDirektur: false, g1Exception: null })).toBe(false)
    expect(mayDecide({ callerId: 2, creatorId: 2, callerIsDirektur: true, g1Exception: null })).toBe(false)
    expect(mayDecide({ callerId: 2, creatorId: 2, callerIsDirektur: true, g1Exception: 'direktur_self' })).toBe(true)
  })
})

describe('allowed actions (server-driven buttons, web = APK)', () => {
  it('creator PM: edit / submit / cancel in Draft, cancel while waiting; nothing after the decision', () => {
    expect(loanAllowedActions(ctx({ isCreator: true, isBorrowerPm: true }))).toEqual(['edit', 'submit', 'cancel'])
    expect(loanAllowedActions(ctx({ isCreator: true, isBorrowerPm: false }))).toEqual(['cancel']) // no longer PM: may only cancel
    expect(loanAllowedActions(ctx({ isCreator: true, isFinance: true }))).toEqual(['edit', 'submit', 'cancel']) // 2026-10-24: Finance files too
    expect(loanAllowedActions(ctx({ status: 'pending_approval', isCreator: true, isBorrowerPm: true }))).toEqual(['cancel'])
    expect(loanAllowedActions(ctx({ status: 'approved', isCreator: true, isBorrowerPm: true }))).toEqual(['repay'])
  })
  it('Direktur: approve / reject while waiting; cancel an approved loan only without repayment', () => {
    expect(loanAllowedActions(ctx({ status: 'pending_approval', isDirektur: true, mayDecide: true }))).toEqual(['approve', 'reject'])
    expect(loanAllowedActions(ctx({ status: 'pending_approval', isDirektur: true, mayDecide: false }))).toEqual([])
    expect(loanAllowedActions(ctx({ status: 'approved', isDirektur: true }))).toEqual(['cancel'])
    expect(loanAllowedActions(ctx({ status: 'approved', isDirektur: true, hasRepayment: true }))).toEqual([])
  })
  it('Finance: repayments while approved / partially repaid; void by Direktur / Finance only', () => {
    expect(loanAllowedActions(ctx({ status: 'partially_repaid', isFinance: true }))).toEqual(['repay'])
    expect(loanAllowedActions(ctx({ status: 'repaid', isFinance: true }))).toEqual([])
    expect(mayVoidRepayment({ isDirektur: false, isFinance: true })).toBe(true)
    expect(mayVoidRepayment({ isDirektur: false, isFinance: false })).toBe(false)
  })
})

describe('contract, numbering, reminders, links', () => {
  it('create body: strict, integer Rupiah, dates YYYY-MM-DD, kind dana | barang', () => {
    expect(LoanCreate.safeParse({ borrowerProjectId: 2, lenderProjectId: 1, amount: 5, reason: 'abc', dueDate: TODAY }).success).toBe(true)
    expect(LoanCreate.safeParse({ borrowerProjectId: 2, lenderProjectId: 1, amount: 5, reason: 'abc', dueDate: '11-10-2026' }).success).toBe(false)
    expect(LoanCreate.safeParse({ borrowerProjectId: 2, lenderProjectId: 1, amount: 5, reason: 'abc', dueDate: TODAY, kind: 'jasa' }).success).toBe(false)
    expect(LoanCreate.safeParse({ borrowerProjectId: 2, lenderProjectId: 1, amount: 5, reason: 'abc', dueDate: TODAY, cashAccountId: 1 }).success).toBe(false)
    expect(RepaymentCreate.safeParse({ amount: 0 }).success).toBe(false)
    expect(LoanListQuery.parse({ page: '2', limit: '10', overdue: '1' })).toMatchObject({ page: 2, limit: 10, overdue: '1' })
  })

  it('PJ/{COMPANY}/{YY}{MM}/{seq}, monthly, 4 digits', () => {
    const s = DEFAULT_SEQUENCES.find((x) => x.docType === 'project_loan')!
    expect(s).toMatchObject({ docCode: 'PJ', resetPolicy: 'monthly', padding: 4, startAt: 1 })
    expect(patternError(s.pattern, s.resetPolicy)).toBeNull()
    expect(formatDocNo(s, 1, { year: 2026, month: 10, day: 11 }, 'DRMS')).toBe('PJ/DRMS/2610/0001')
  })

  it('reminder rule loan_overdue: on by default, switchable per PT', () => {
    expect(REMINDER_RULES).toContain('loan_overdue')
    expect(REMINDER_EVENTS.loan_overdue).toBe('project_loan.overdue')
    expect(reminderSettingsOf({}, 'Asia/Makassar').loanOverdue.enabled).toBe(true)
    expect(reminderSettingsOf({ reminderLoanOverdueEnabled: false }, 'Asia/Makassar').loanOverdue.enabled).toBe(false)
  })

  it('document links (12b) and notification links open the loan detail', () => {
    expect(docHref('project_loan', 7)).toBe('/admin/pinjaman/detail/7')
    expect(notificationHref('project_loan', '7')).toBe('/admin/pinjaman/detail/7')
  })

  it('report filter: project, statuses (no draft), overdue, search', () => {
    const f = loanReportFilter(new URLSearchParams('project=3&status=approved,draft&status=repaid&terlambat=ya&q=PJ'))
    expect(f).toEqual({ projectId: 3, statuses: ['approved', 'repaid'], overdue: true, q: 'PJ' })
  })
})
