import { describe, expect, it } from 'vitest'

import type { Role } from '@/access/roles'
import { selfApprovalAllowed } from '@/domain/expense/common'
import { DIREKTUR_VIA_PM, DIREKTUR_VIA_PM_SELF, planPositions, ruleDecisionError, selfApprovalNote, type PlanInput } from '@/domain/expense/decision'
import type { ApprovalSnapshot } from '@/domain/expense/rules'
import { allowedActions, mayPerform, type ActorContext } from '@/domain/expense/state'
import { ackStepLabel, approvalStepLabel, decisionByOf, nextActor, requestStatusLabel, timeline } from '@/domain/expense/timeline'
import { approvalEmail } from '@/domain/notifications'

/**
 * ADR 0021 (owner decision 2026-10-10), pure parts: Staff → PM project ("Diketahui" = Persetujuan PM,
 * `acknowledgeBy: scope_manager`) → Direktur (level 1) → Finance transfer; the narrow G1 exception
 * `direktur_via_pm` (a Direktur's request filed by the PM project); snapshot-aware labels.
 */
const PM = 5
const DIR_A = 1
const DIR_B = 2
const STAFF = 7

const pmRule = (over: Partial<PlanInput['rule']> = {}): PlanInput['rule'] => ({
  acknowledge: 'required',
  acknowledgeBy: 'scope_manager',
  acknowledgeRole: null,
  acknowledgeUser: null,
  steps: [{ level: 1, approverRole: 'pk-owner' }],
  ...over,
})

const pmSnap: ApprovalSnapshot = {
  ruleId: 1,
  ruleName: 'Default — PM project lalu Direktur (semua nominal)',
  acknowledge: 'required',
  acknowledgeBy: 'scope_manager',
  acknowledgerUserId: PM,
  acknowledgeRole: null,
  signDiajukan: 'required',
  signDibuat: 'required',
  steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: null }],
  decisionRoles: ['pk-owner', 'pk-finance'],
  skipped: [],
}
const oldSnap: ApprovalSnapshot = { ...pmSnap, acknowledgeBy: 'role', acknowledgeRole: 'pk-owner', acknowledgerUserId: null, steps: [{ level: 1, approverRole: 'pk-finance', approverUserId: null }] }

describe('rule validation (ADR 0021)', () => {
  const rolesOf = (): Role[] => []
  it('PM project → Direktur is valid for expense requests', () => {
    expect(ruleDecisionError(pmRule(), rolesOf, 'expense_request')).toBeNull()
  })
  it('scope_manager is refused for Addendum RAB and when optional', () => {
    expect(ruleDecisionError(pmRule(), rolesOf, 'budget_addendum')).toMatch(/Addendum RAB tetap Direktur lalu Finance/)
    expect(ruleDecisionError(pmRule({ acknowledge: 'optional' }), rolesOf)).toMatch(/tidak boleh opsional/)
  })
  it('steps still only Direktur / Finance', () => {
    expect(ruleDecisionError(pmRule({ steps: [{ level: 1, approverRole: 'pk-pm' }] }), rolesOf)).toMatch(/Peran approver level 1/)
  })
})

describe('position plan (PM project = the resolved acknowledger)', () => {
  const plan = (excluded: number[], extra: Partial<PlanInput> = {}) =>
    planPositions({ rule: pmRule(), excluded: new Set(excluded), ackHolders: [PM], stepHolders: [[DIR_A]], ...extra })

  it('Staff request: PM then Direktur, the PM is the named acknowledger', () => {
    expect(plan([STAFF])).toEqual({ ok: true, plan: { ackRequired: true, ackUserId: PM, steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: null }], skipped: [] } })
  })
  it('PM files for himself → the PM step is skipped (recorded), the Direktur decides', () => {
    expect(plan([PM])).toMatchObject({ ok: true, plan: { ackRequired: false, steps: [{ level: 1 }], skipped: [{ position: 'diketahui', level: 0, role: null, userId: PM, reason: 'PM project adalah pemohon/pembuat' }] } })
  })
  it('Direktur filing alone with a single Direktur → the Direktur step would be skipped (snapshotForRule answers 409)', () => {
    expect(plan([DIR_A])).toMatchObject({ ok: true, plan: { ackRequired: true, skipped: [{ position: 'approval', role: 'pk-owner' }] } })
  })
  it('direktur_via_pm: creator PM kept for "Diketahui", requester Direktur kept for the Direktur step', () => {
    const excluded = [PM, DIR_A]
    expect(plan(excluded)).toMatchObject({ ok: false }) // without the exception: nobody independent
    expect(plan(excluded, { ackExcluded: new Set([DIR_A]), stepExcluded: new Set([PM]) })).toEqual({
      ok: true,
      plan: { ackRequired: true, ackUserId: PM, steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: null }], skipped: [] },
    })
  })
  it('another Direktur exists: the exception is not needed for the Direktur step', () => {
    expect(plan([PM, DIR_A], { stepHolders: [[DIR_A, DIR_B]], ackExcluded: new Set([DIR_A]) })).toMatchObject({ ok: true, plan: { ackRequired: true, skipped: [] } })
  })
})

describe('guards: the PM decides only as acknowledger; the narrow exception', () => {
  const ctx = (over: Partial<ActorContext>): ActorContext => ({
    type: 'advance',
    status: 'pending_ack',
    roles: ['pk-pm'],
    isCreator: false,
    isRequester: false,
    hasDecision: false,
    isAcknowledger: true,
    matchesCurrentStep: false,
    alreadyDecided: false,
    lacksDecisionRole: false,
    ...over,
  })
  it('the PM acknowledger may acknowledge / reject', () => {
    expect(allowedActions(ctx({}))).toEqual(expect.arrayContaining(['acknowledge', 'reject']))
    expect(mayPerform(ctx({}), 'acknowledge')).toBe(true)
  })
  it('a PM who is not the acknowledger lacks the decision role → nothing, 403 first', () => {
    const c = ctx({ isAcknowledger: false, lacksDecisionRole: true })
    expect(allowedActions(c)).not.toContain('acknowledge')
    expect(mayPerform(c, 'reject')).toBe(false)
  })
  it('creator PM: refused without the exception, allowed with it (at "Diketahui" only)', () => {
    expect(allowedActions(ctx({ isCreator: true }))).not.toContain('acknowledge')
    expect(allowedActions(ctx({ isCreator: true, selfApprovalAllowed: true }))).toEqual(expect.arrayContaining(['acknowledge', 'reject']))
    expect(mayPerform(ctx({ isCreator: true, selfApprovalAllowed: true }), 'acknowledge')).toBe(true)
  })
  it('selfApprovalAllowed: creator-PM at pending_ack (both variants); requester-Direktur at pending_approval only under _self; snapshot AND column', () => {
    const c = { isCreator: false, isRequester: false, isAcknowledger: false, matchesCurrentStep: false }
    for (const exc of [DIREKTUR_VIA_PM, DIREKTUR_VIA_PM_SELF]) {
      const snap = { ...pmSnap, selfApproval: exc }
      const doc = (status: 'pending_ack' | 'pending_approval', g1Exception: string | null = exc) => ({ status, approvalSnapshot: snap, g1Exception })
      expect(selfApprovalAllowed(doc('pending_ack'), { ...c, isCreator: true, isAcknowledger: true })).toBe(true)
      expect(selfApprovalAllowed(doc('pending_ack', null), { ...c, isCreator: true, isAcknowledger: true })).toBe(false)
      expect(selfApprovalAllowed(doc('pending_ack'), { ...c, isRequester: true, isAcknowledger: true })).toBe(false)
      expect(selfApprovalAllowed(doc('pending_approval'), { ...c, isCreator: true, matchesCurrentStep: true })).toBe(false)
      expect(selfApprovalAllowed(doc('pending_approval'), { ...c, isRequester: true, matchesCurrentStep: false })).toBe(false)
    }
    expect(selfApprovalAllowed({ status: 'pending_ack', approvalSnapshot: pmSnap, g1Exception: DIREKTUR_VIA_PM }, { ...c, isCreator: true, isAcknowledger: true })).toBe(false)
    // owner answer 2026-10-11 ("Utamakan Direktur lain"): the requester approves only as the PT's only Direktur
    const viaPm = { status: 'pending_approval' as const, approvalSnapshot: { ...pmSnap, selfApproval: DIREKTUR_VIA_PM }, g1Exception: DIREKTUR_VIA_PM }
    expect(selfApprovalAllowed(viaPm, { ...c, isRequester: true, matchesCurrentStep: true })).toBe(false)
    const self = { status: 'pending_approval' as const, approvalSnapshot: { ...pmSnap, selfApproval: DIREKTUR_VIA_PM_SELF }, g1Exception: DIREKTUR_VIA_PM_SELF }
    expect(selfApprovalAllowed(self, { ...c, isRequester: true, matchesCurrentStep: true })).toBe(true)
    // snapshot and column must agree
    expect(selfApprovalAllowed({ ...self, g1Exception: DIREKTUR_VIA_PM }, { ...c, isRequester: true, matchesCurrentStep: true })).toBe(false)
  })
  it('notes per variant', () => {
    expect(selfApprovalNote(DIREKTUR_VIA_PM)).toBe('Pengajuan Direktur — diajukan oleh PM (kebijakan owner 2026-10-10)')
    expect(selfApprovalNote(DIREKTUR_VIA_PM_SELF)).toMatch(/satu-satunya Direktur PT/)
    expect(selfApprovalNote(null)).toBeNull()
  })
})

describe('labels (snapshot-aware)', () => {
  it('status labels: PM step / Direktur step; ADR 0013 snapshots keep "Menunggu Diketahui (Direktur)"', () => {
    expect(requestStatusLabel('advance', 'pending_ack', pmSnap, 0)).toBe('Menunggu persetujuan PM')
    expect(requestStatusLabel('advance', 'pending_approval', pmSnap, 1)).toBe('Menunggu persetujuan Direktur')
    expect(requestStatusLabel('advance', 'pending_ack', oldSnap, 0)).toBe('Menunggu Diketahui (Direktur)')
    expect(requestStatusLabel('advance', 'pending_approval', oldSnap, 1)).toBe('Menunggu Approval')
    // no snapshot (list rows, reminders) = the ONE wording of types.ts (ADR 0021)
    expect(requestStatusLabel('advance', 'pending_ack', null, null)).toBe('Menunggu persetujuan PM')
    expect(requestStatusLabel('advance', 'pending_approval', null, null)).toBe('Menunggu persetujuan Direktur')
    expect(requestStatusLabel('advance', 'approved', pmSnap, 1)).toBe('Disetujui (Antri Transfer)')
  })
  it('inbox step labels + who decides', () => {
    expect(ackStepLabel(pmSnap)).toBe('Persetujuan PM')
    expect(approvalStepLabel(pmSnap, 1)).toBe('Persetujuan Direktur')
    expect(ackStepLabel(oldSnap)).toBe('Persetujuan Direktur (Diketahui)')
    expect(approvalStepLabel(oldSnap, 1)).toBe('Approval level 1')
    expect(decisionByOf(pmSnap, 'acknowledge', 0)).toBe('pm')
    expect(decisionByOf(pmSnap, 'approve', 1)).toBe('direktur')
    expect(decisionByOf(oldSnap, 'acknowledge', 0)).toBe('direktur')
    expect(decisionByOf(oldSnap, 'approve', 1)).toBe('finance')
  })
  it('timeline + "Tahapan saat ini": PM project first, then the Direktur', () => {
    const steps = timeline('advance', 'pending_ack', { snapshot: pmSnap, currentLevel: 0 })
    expect(steps.find((s) => s.status === 'pending_ack')).toMatchObject({ label: 'Menunggu persetujuan PM', state: 'current' })
    expect(steps.find((s) => s.status === 'pending_approval')?.label).toBe('Menunggu persetujuan Direktur')
    const base = { type: 'advance' as const, currentLevel: 0, snapshot: pmSnap, requesters: 'A', names: { [PM]: 'PM Uji' } }
    expect(nextActor({ ...base, status: 'pending_ack' })).toEqual({ who: 'PM Uji (PM project)', what: 'setujui sebagai PM project atau tolak' })
    expect(nextActor({ ...base, status: 'pending_approval', currentLevel: 1 })?.who).toBe('Direktur — approval level 1')
  })
  it('approval email: "sebagai PM project" for the PM step', () => {
    const doc = { id: 1, docNo: 'X/1', type: 'advance' as const, status: 'pending_ack' as const, title: 't', approvalSnapshot: pmSnap }
    expect(approvalEmail(doc, 'expense.pending_ack', undefined).text).toContain('persetujuan Anda sebagai PM project')
    expect(approvalEmail({ ...doc, approvalSnapshot: oldSnap }, 'expense.pending_ack', undefined).text).toContain('sebagai Direktur (Diketahui)')
  })
})
