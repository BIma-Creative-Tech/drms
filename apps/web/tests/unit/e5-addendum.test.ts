import { describe, expect, it } from 'vitest'

import { addendumAllowedActions, addendumInputErrors, ADDENDUM_TRANSITIONS, isTerminal, newBudget, pctOf, type AddendumActorContext } from '@/domain/addendum/rules'
import { ruleDecisionError } from '@/domain/expense/decision'
import { selectRule, type RuleInput } from '@/domain/expense/rules'
import { ADDENDUM_DEFAULT_RULE_NAME as MIGRATION_RULE_NAME } from '@/migrations/20260926_114555_e5_budget_addenda'
import { ADDENDUM_DEFAULT_RULE_NAME, DEFAULT_APPROVAL_RULES } from '@/seed/data'

/** E5 Addendum RAB (T12, US-18/US-30): pure rules. */
const ctx = (over: Partial<AddendumActorContext> = {}): AddendumActorContext => ({
  status: 'draft',
  isCreator: false,
  isTeamPm: false,
  isAcknowledger: false,
  matchesCurrentStep: false,
  hasDecision: false,
  alreadyDecided: false,
  ...over,
})

describe('input (US-18: nominal & reason required)', () => {
  it('accepts an integer Rupiah > 0 and a reason ≥ 3 chars', () => {
    expect(addendumInputErrors({ addition: 5_000_000, reason: 'Tambah pagar' })).toEqual([])
  })
  it.each([0, -1, 1.5, Number.NaN, '100', null, undefined])('refuses addition %s', (a) => {
    expect(addendumInputErrors({ addition: a, reason: 'Tambah pagar' }).map((e) => e.path)).toEqual(['addition'])
  })
  it('refuses a missing/short reason', () => {
    expect(addendumInputErrors({ addition: 1, reason: '  ab ' }).map((e) => e.path)).toEqual(['reason'])
    expect(addendumInputErrors({ addition: 1 }).map((e) => e.path)).toEqual(['reason'])
  })
})

describe('budget arithmetic', () => {
  it('new RAB = CURRENT budget + addition; % of RAB with 2 decimals, null without RAB', () => {
    expect(newBudget(100_000_000, 7_500_000)).toBe(107_500_000)
    expect(newBudget(null, 1)).toBe(1)
    expect(pctOf(85_000_000, 100_000_000)).toBe(85)
    expect(pctOf(1, 3)).toBe(33.33)
    expect(pctOf(1, 0)).toBeNull()
  })
})

describe('state machine + allowed actions', () => {
  it('terminal states have no transitions; approved only from a pending state', () => {
    expect(isTerminal('approved') && isTerminal('rejected') && isTerminal('cancelled')).toBe(true)
    expect(ADDENDUM_TRANSITIONS.draft).not.toContain('approved')
    expect(ADDENDUM_TRANSITIONS.pending_approval).toContain('approved')
  })
  it('creator PM edits/submits/cancels a draft; loses edit when no longer PM of the team', () => {
    expect(addendumAllowedActions(ctx({ isCreator: true, isTeamPm: true }))).toEqual(['edit', 'submit', 'cancel'])
    expect(addendumAllowedActions(ctx({ isCreator: true, isTeamPm: false }))).toEqual(['cancel'])
  })
  it('Direktur acknowledges at pending_ack, Finance approves at pending_approval; never the creator (G1) nor twice', () => {
    expect(addendumAllowedActions(ctx({ status: 'pending_ack', isAcknowledger: true }))).toEqual(['acknowledge', 'reject'])
    expect(addendumAllowedActions(ctx({ status: 'pending_ack', isAcknowledger: true, isCreator: true }))).toEqual(['cancel'])
    expect(addendumAllowedActions(ctx({ status: 'pending_approval', matchesCurrentStep: true }))).toEqual(['approve', 'reject'])
    expect(addendumAllowedActions(ctx({ status: 'pending_approval', matchesCurrentStep: true, alreadyDecided: true }))).toEqual([])
    expect(addendumAllowedActions(ctx({ status: 'pending_approval', isCreator: true, hasDecision: true }))).toEqual([])
    expect(addendumAllowedActions(ctx({ status: 'approved', matchesCurrentStep: true }))).toEqual([])
  })
})

describe('rule engine for docType budget_addendum', () => {
  const base: RuleInput = { id: 1, name: 'x', docType: 'expense_request', requestType: 'any', minAmount: 0, acknowledge: 'required', acknowledgeBy: 'role', acknowledgeRole: 'pk-owner', steps: [{ level: 1, approverRole: 'pk-finance' }] }
  const facts = { docType: 'budget_addendum' as const, type: null, grandTotal: 1_000_000, categoryIds: [], projectId: 5, costCenterId: null }
  it('matches only budget_addendum rules with requestType any', () => {
    const add: RuleInput = { ...base, id: 2, docType: 'budget_addendum' }
    expect(selectRule([base, add], facts)?.id).toBe(2)
    expect(selectRule([{ ...add, requestType: 'advance' }], facts)).toBeNull()
    expect(selectRule([base, add], { ...facts, docType: undefined, type: 'advance' })?.id).toBe(1)
  })
  it('seeded default = Direktur then Finance, same name as the migration, valid under ADR 0013', () => {
    const r = DEFAULT_APPROVAL_RULES.find((x) => x.docType === 'budget_addendum')!
    expect(r.name).toBe(ADDENDUM_DEFAULT_RULE_NAME)
    expect(MIGRATION_RULE_NAME).toBe(ADDENDUM_DEFAULT_RULE_NAME)
    expect(r).toMatchObject({ acknowledge: 'required', acknowledgeBy: 'role', acknowledgeRole: 'pk-owner', steps: [{ level: 1, approverRole: 'pk-finance' }], active: true })
    expect(ruleDecisionError({ ...r, steps: [...r.steps] }, () => [])).toBeNull()
  })
})
