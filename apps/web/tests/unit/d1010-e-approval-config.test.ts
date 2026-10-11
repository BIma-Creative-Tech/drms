import { describe, expect, it } from 'vitest'

import type { Role } from '@/access/roles'
import { buildApprovalTimeline, g1ExceptionText, type TimelineInput, type TimelineSnapshot } from '@/domain/expense/approval-timeline'
import {
  DIREKTUR_NO_APPROVAL,
  isNoApproval,
  NO_APPROVAL_NOTE,
  ruleDecisionError,
  selfApprovalNote,
  zeroStepRuleError,
} from '@/domain/expense/decision'
import { previewInputFromForm, requesterText, rulePreview } from '@/domain/expense/rule-preview'
import { buildSnapshot, requesterRolesMatch, selectRule, stepsError, type RequestFacts, type RuleInput } from '@/domain/expense/rules'
import { nextActor, requestStatusLabel, timeline } from '@/domain/expense/timeline'
import { NO_APPROVAL_STATUS_LABELS } from '@/domain/expense/types'
import { eventsFor } from '@/domain/notifications'
import { DEFAULT_APPROVAL_RULES, DIREKTUR_RULE_NAME } from '@/seed/data'
import { DIREKTUR_RULE } from '@/migrations/20261013_300000_d1010_approval_config_data'

/**
 * ADR 0024 (owner decision 2026-10-11): configurable approval rules ("Peran pemohon", zero-step rule for
 * the Direktur only) and the audited Direktur no-approval exception — pure parts.
 */
const rule = (over: Partial<RuleInput> = {}): RuleInput => ({
  id: 1,
  name: 'Default — PM project lalu Direktur (semua nominal)',
  docType: 'expense_request',
  requestType: 'any',
  minAmount: 0,
  maxAmount: null,
  priority: 100,
  acknowledge: 'required',
  acknowledgeBy: 'scope_manager',
  acknowledgeRole: null,
  steps: [{ level: 1, approverRole: 'pk-owner' }],
  ...over,
})
const direkturRule = (over: Partial<RuleInput> = {}): RuleInput =>
  rule({ id: 2, name: 'Pengajuan Direktur', priority: 10, requesterRoles: ['pk-owner'], acknowledge: 'none', acknowledgeBy: 'role', steps: [], ...over })
const facts = (requesterRoles?: Role[][], over: Partial<RequestFacts> = {}): RequestFacts => ({ type: 'advance', grandTotal: 1_000_000, categoryIds: [], projectId: 5, requesterRoles, ...over })
const noRoles = () => undefined

describe('zero-step rule guardrail (validation; the DB trigger approval_rules_zero_step says the same)', () => {
  it('allowed only for Peran pemohon = exactly Direktur, expense requests, no "Diketahui"', () => {
    expect(zeroStepRuleError(direkturRule())).toBeNull()
    expect(ruleDecisionError(direkturRule(), noRoles)).toBeNull()
  })
  it.each([
    ['no requester role (= everybody)', direkturRule({ requesterRoles: [] }), /hanya boleh untuk Peran pemohon = Direktur/],
    ['Staff', direkturRule({ requesterRoles: ['pk-staff'] }), /hanya boleh untuk Peran pemohon = Direktur/],
    ['PM', direkturRule({ requesterRoles: ['pk-pm'] }), /hanya boleh untuk Peran pemohon = Direktur/],
    ['Finance', direkturRule({ requesterRoles: ['pk-finance'] }), /hanya boleh untuk Peran pemohon = Direktur/],
    ['Direktur + Staff', direkturRule({ requesterRoles: ['pk-owner', 'pk-staff'] }), /hanya boleh untuk Peran pemohon = Direktur/],
    ['with "Diketahui"', direkturRule({ acknowledge: 'required', acknowledgeBy: 'role', acknowledgeRole: 'pk-owner' }), /tidak memakai "Diketahui Oleh"/],
  ])('refused: %s', (_n, r, msg) => {
    expect(ruleDecisionError(r, noRoles)).toMatch(msg)
  })
  it('Addendum RAB: never zero steps, never a requester role', () => {
    expect(zeroStepRuleError(direkturRule(), 'budget_addendum')).toMatch(/Addendum RAB harus punya minimal 1 level/)
    expect(ruleDecisionError(rule({ acknowledgeBy: 'role', acknowledgeRole: 'pk-owner', steps: [{ level: 1, approverRole: 'pk-finance' }], requesterRoles: ['pk-pm'] }), noRoles, 'budget_addendum')).toMatch(/Peran pemohon hanya untuk aturan Pengajuan biaya/)
  })
  it('stepsError accepts zero steps only when asked; buildSnapshot only for the Direktur rule', () => {
    expect(stepsError([])).toMatch(/minimal 1 level/)
    expect(stepsError([], { allowEmpty: true })).toBeNull()
    expect(buildSnapshot(direkturRule(), null).steps).toEqual([])
    expect(() => buildSnapshot(direkturRule({ requesterRoles: ['pk-staff'] }), null)).toThrow(/minimal 1 level/)
  })
  it('a rule with levels may carry any requester roles (normal approval)', () => {
    expect(ruleDecisionError(rule({ requesterRoles: ['pk-staff', 'pk-pm'] }), noRoles)).toBeNull()
  })
})

describe('rule selection with "Peran pemohon" + priority', () => {
  const rules = [rule(), direkturRule()]
  it('every requester must hold one of the roles; empty condition = everybody', () => {
    expect(requesterRolesMatch(['pk-owner'], [['pk-owner']])).toBe(true)
    expect(requesterRolesMatch(['pk-owner'], [['pk-owner'], ['pk-staff']])).toBe(false)
    expect(requesterRolesMatch(['pk-owner'], [[]])).toBe(false) // employee without an account
    expect(requesterRolesMatch(['pk-owner'], undefined)).toBe(false)
    expect(requesterRolesMatch([], [['pk-staff']])).toBe(true)
    expect(requesterRolesMatch(null, undefined)).toBe(true)
  })
  it('Direktur requester → "Pengajuan Direktur" (priority 10 before the default 100)', () => {
    expect(selectRule(rules, facts([['pk-owner']]))?.name).toBe('Pengajuan Direktur')
    expect(selectRule(rules, facts([['pk-owner', 'pk-finance']]))?.name).toBe('Pengajuan Direktur')
  })
  it('Staff / PM / mixed / unknown requester roles → the default rule (unchanged flow)', () => {
    for (const r of [[['pk-staff']], [['pk-pm']], [['pk-owner'], ['pk-staff']], [[]]] as Role[][][]) expect(selectRule(rules, facts(r))?.name).toBe(rule().name)
    expect(selectRule(rules, facts(undefined))?.name).toBe(rule().name)
  })
  it('priority wins over the requester condition; same priority → the more specific (requester role) rule', () => {
    expect(selectRule([rule({ priority: 5 }), direkturRule()], facts([['pk-owner']]))?.name).toBe(rule().name)
    expect(selectRule([rule({ priority: 10 }), direkturRule()], facts([['pk-owner']]))?.name).toBe('Pengajuan Direktur')
  })
  it('an inactive Direktur rule is never chosen', () => {
    expect(selectRule([rule(), direkturRule({ active: false })], facts([['pk-owner']]))?.name).toBe(rule().name)
  })
  it('seed + data migration: one "Pengajuan Direktur" rule, valid, before the default', () => {
    expect(DIREKTUR_RULE_NAME).toBe(DIREKTUR_RULE)
    const d = DEFAULT_APPROVAL_RULES.find((r) => r.name === DIREKTUR_RULE_NAME)!
    expect(d).toMatchObject({ docType: 'expense_request', priority: 10, requesterRoles: ['pk-owner'], acknowledge: 'none', steps: [], active: true })
    for (const r of DEFAULT_APPROVAL_RULES) {
      const shape = { ...r, steps: [...r.steps], requesterRoles: 'requesterRoles' in r ? [...r.requesterRoles] : [] } as unknown as RuleInput
      expect(ruleDecisionError(shape, noRoles, r.docType)).toBeNull()
    }
    expect(DEFAULT_APPROVAL_RULES[0].name).toBe('Default — PM project lalu Direktur (semua nominal)')
  })
})

const NO_APPROVAL: TimelineSnapshot = {
  acknowledge: 'none',
  acknowledgeBy: 'role',
  acknowledgerUserId: null,
  acknowledgeRole: null,
  decisionRoles: ['pk-owner', 'pk-finance'],
  skipped: [],
  selfApproval: DIREKTUR_NO_APPROVAL,
  steps: [],
}
const tl = (over: Partial<TimelineInput> = {}): TimelineInput => ({
  type: 'advance',
  status: 'approved',
  approvalCycle: 1,
  currentLevel: 0,
  submittedAt: '2026-10-11T02:00:00.000Z',
  snapshot: NO_APPROVAL,
  approvals: [
    { cycle: 1, position: 'diajukan', level: 0, actorName: 'Bu Dewi', onBehalf: false, decision: 'signed', reason: null, decidedAt: '2026-10-11T02:00:00.000Z' },
    { cycle: 1, position: 'dibuat', level: 0, actorName: 'Bu Dewi', onBehalf: false, decision: 'signed', reason: null, decidedAt: '2026-10-11T02:00:00.000Z' },
  ],
  transfers: [],
  requesters: 'Bu Dewi',
  createdBy: 'Bu Dewi',
  names: {},
  ...over,
})

describe('labels / timeline of a request without approval (web = APK turn_timeline.dart)', () => {
  it('notes and marker', () => {
    expect(isNoApproval(NO_APPROVAL)).toBe(true)
    expect(isNoApproval({ selfApproval: 'direktur_via_pm' })).toBe(false)
    expect(selfApprovalNote(DIREKTUR_NO_APPROVAL)).toBe('Tanpa persetujuan — pengajuan Direktur (kebijakan PT)')
    expect(g1ExceptionText(DIREKTUR_NO_APPROVAL)).toBe(NO_APPROVAL_NOTE)
    // legacy ADR 0021 wording stays for requests already submitted under it
    expect(selfApprovalNote('direktur_via_pm')).toBe('Pengajuan Direktur — diajukan oleh PM (kebijakan owner 2026-10-10)')
  })
  it('status: never "Disetujui" — "Tanpa persetujuan (Antri Transfer)" / "(Verifikasi Nota)"', () => {
    const snap = { acknowledgeBy: 'role' as const, acknowledgeRole: null, steps: [], decisionRoles: ['pk-owner', 'pk-finance'] as Role[], selfApproval: DIREKTUR_NO_APPROVAL }
    expect(requestStatusLabel('advance', 'approved', snap, 0)).toBe('Tanpa persetujuan (Antri Transfer)')
    expect(requestStatusLabel('reimburse', 'approved', snap, 0)).toBe('Tanpa persetujuan (Verifikasi Nota)')
    expect(NO_APPROVAL_STATUS_LABELS).toEqual({ advance: 'Tanpa persetujuan (Antri Transfer)', reimburse: 'Tanpa persetujuan (Verifikasi Nota)' })
    expect(requestStatusLabel('advance', 'transferred', snap, 0)).toBe('Ditransfer')
    // the status path never shows a waiting step
    expect(timeline('advance', 'approved', { skipAck: true, snapshot: snap }).map((s) => s.status)).toEqual(['draft', 'approved', 'transferred', 'receipts_complete', 'lpj_submitted', 'lpj_verified', 'completed'])
    expect(nextActor({ type: 'advance', status: 'approved', currentLevel: 0, snapshot: { ...snap, acknowledge: 'none', acknowledgerUserId: null }, requesters: 'Bu Dewi', names: {} })).toEqual({ who: 'Finance', what: 'catat transfer pengajuan baru (Antrian Transfer)' })
  })
  it('timeline: Diajukan → Persetujuan (dilewati, kebijakan PT) → Transfer Finance (current in the queue)', () => {
    const steps = buildApprovalTimeline(tl())
    expect(steps.map((s) => [s.key, s.title, s.state])).toEqual([
      ['diajukan', 'Diajukan', 'done'],
      ['no-approval', 'Persetujuan', 'skipped'],
      ['transfer', 'Transfer Finance', 'current'],
    ])
    expect(steps[1]).toMatchObject({ role: 'Direktur (pemohon)', note: 'Tanpa persetujuan — pengajuan Direktur (kebijakan PT)', actor: null })
    const r = buildApprovalTimeline(tl({ type: 'reimburse' }))
    expect(r[2]).toMatchObject({ state: 'pending', note: 'setelah nota diverifikasi Finance' })
  })
})

describe('notifications of a request without approval', () => {
  const doc = (status: 'pending_approval' | 'approved', type: 'advance' | 'reimburse' = 'advance') =>
    ({ id: 1, type, status, title: 'x', project: 5, approvalSnapshot: { ...NO_APPROVAL, ruleId: 2, ruleName: 'Pengajuan Direktur', signDiajukan: 'required', signDibuat: 'required' } }) as never
  it('the transient "Menunggu persetujuan" is silent (nobody decides)', () => {
    expect(eventsFor({ status: 'draft' }, doc('pending_approval'))).toEqual([])
  })
  it('"Disetujui": requesters, Finance (transfer queue / receipt verification) and the team PM', () => {
    expect(eventsFor({ status: 'pending_approval' }, doc('approved'))).toEqual([
      { event: 'expense.approved', to: 'people' },
      { event: 'expense.transfer_queue', to: 'finance' },
      { event: 'expense.team_submitted', to: 'pm' },
    ])
    expect(eventsFor({ status: 'pending_approval' }, doc('approved', 'reimburse')).map((e) => e.event)).toContain('expense.receipts_to_verify')
  })
})

describe('Aturan approval editor: explanation + preview', () => {
  it('Direktur zero-step rule → "Contoh: pengajuan oleh Direktur → langsung ke Finance"', () => {
    const p = rulePreview({ docType: 'expense_request', requesterRoles: ['pk-owner'], acknowledge: 'none', acknowledgeBy: 'role', acknowledgeRole: null, hasAcknowledgeUser: false, steps: [] })
    expect(p.example).toBe('Contoh: pengajuan oleh Direktur → langsung ke Finance (Tanpa persetujuan — langsung ke antrian transfer Finance).')
    expect(p).toMatchObject({ noApproval: true, error: null })
  })
  it('zero steps for Staff → the same refusal as the server', () => {
    const p = rulePreview({ docType: 'expense_request', requesterRoles: ['pk-staff'], acknowledge: 'none', acknowledgeBy: 'role', acknowledgeRole: null, hasAcknowledgeUser: false, steps: [] })
    expect(p.error).toBe(zeroStepRuleError({ steps: [], requesterRoles: ['pk-staff'], acknowledge: 'none' }))
  })
  it('default rule → PM project → Direktur → Finance transfer, for everybody', () => {
    const p = rulePreview({ docType: 'expense_request', requesterRoles: [], acknowledge: 'required', acknowledgeBy: 'scope_manager', acknowledgeRole: null, hasAcknowledgeUser: false, steps: [{ level: 1, approverRole: 'pk-owner', hasUser: false }] })
    expect(p.example).toBe('Contoh: pengajuan oleh siapa saja → Persetujuan: PM project (manajer pusat biaya bila tanpa project) → Level 1: Direktur → Finance: transfer (antrian transfer; Reimburse: verifikasi nota dulu).')
    expect(p.error).toBeNull()
    expect(requesterText(['pk-staff', 'pk-pm'])).toBe('Staff lapangan atau Project Manager')
  })
  it('reads the Payload form state (array rows)', () => {
    const f = { docType: { value: 'expense_request' }, requesterRoles: { value: ['pk-owner'] }, acknowledge: { value: 'none' }, acknowledgeBy: { value: 'role' }, steps: { value: 1 }, 'steps.0.level': { value: 1 }, 'steps.0.approverRole': { value: 'pk-finance' } }
    expect(previewInputFromForm(f)).toMatchObject({ requesterRoles: ['pk-owner'], acknowledge: 'none', steps: [{ level: 1, approverRole: 'pk-finance', hasUser: false }] })
  })
})
