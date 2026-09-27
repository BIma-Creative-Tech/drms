import { describe, expect, it } from 'vitest'

import { ROLE_LABELS, type Role } from '@/access/roles'
import { distinctAssignable, lacksDecisionRole, planPositions, ruleDecisionError, type PlanInput } from '@/domain/expense/decision'
import { allowedActions, targets, type ActorContext } from '@/domain/expense/state'
import { nextActor } from '@/domain/expense/timeline'
import { DEFAULT_APPROVAL_RULES } from '@/seed/data'

/**
 * E1 / ADR 0013 (pure parts): Direktur (= pk-owner) gives "Diketahui" as an approval, Finance
 * approves, PM only monitors; G1-2 skip rule; re-approval goes back to "Menunggu Diketahui".
 */
const DIR_A = 1
const DIR_B = 2
const FIN_A = 3
const FIN_B = 4
const PM = 5

const rule = (over: Partial<PlanInput['rule']> = {}): PlanInput['rule'] => ({
  acknowledge: 'required',
  acknowledgeBy: 'role',
  acknowledgeRole: 'pk-owner',
  acknowledgeUser: null,
  steps: [{ level: 1, approverRole: 'pk-finance' }],
  ...over,
})
const roles: Record<number, Role[]> = { [DIR_A]: ['pk-owner'], [DIR_B]: ['pk-owner'], [FIN_A]: ['pk-finance'], [FIN_B]: ['pk-finance'], [PM]: ['pk-pm'] }
const rolesOf = (id: number) => roles[id]

describe('ADR 0013 labels + seeded default rule', () => {
  it('pk-owner is labelled "Direktur" (G1-1: no separate role)', () => {
    expect(ROLE_LABELS['pk-owner']).toBe('Direktur')
  })
  it('default rule: Diketahui required by the Direktur role, then Finance level 1, all amounts; both seeded rules are valid', () => {
    const def = DEFAULT_APPROVAL_RULES[0]
    expect(def).toMatchObject({ acknowledge: 'required', acknowledgeBy: 'role', acknowledgeRole: 'pk-owner', minAmount: 0, maxAmount: null, active: true })
    expect(def.steps).toEqual([{ level: 1, approverRole: 'pk-finance' }])
    for (const r of DEFAULT_APPROVAL_RULES) expect(ruleDecisionError({ ...r, steps: [...r.steps] }, rolesOf)).toBeNull()
  })
})

describe('rule validation (AC-5): PM/Staff never decide, scope_manager retired, Direktur not optional', () => {
  it.each([
    ['acknowledgeRole = pk-pm', rule({ acknowledgeRole: 'pk-pm' }), /Peran "Diketahui Oleh" harus Direktur atau Finance/],
    ['acknowledgeRole = pk-staff', rule({ acknowledgeRole: 'pk-staff' }), /Peran "Diketahui Oleh"/],
    ['approverRole = pk-pm', rule({ steps: [{ level: 1, approverRole: 'pk-pm' }] }), /Peran approver level 1/],
    ['approverRole = pk-admin', rule({ steps: [{ level: 1, approverRole: 'pk-admin' }] }), /Peran approver level 1/],
    ['acknowledgeBy = scope_manager', rule({ acknowledgeBy: 'scope_manager', acknowledgeRole: null }), /PM hanya memantau/],
    ['optional Direktur', rule({ acknowledge: 'optional' }), /tidak boleh opsional/],
    ['named acknowledger is a PM', rule({ acknowledgeBy: 'user', acknowledgeRole: null, acknowledgeUser: PM }), /User "Diketahui Oleh" harus/],
    ['named approver is a PM', rule({ steps: [{ level: 1, approverUser: PM }] }), /Approver level 1 harus/],
  ])('%s → refused', (_n, r, msg) => {
    expect(ruleDecisionError(r, rolesOf)).toMatch(msg)
  })
  it('valid shapes: Direktur→Finance, Finance→Finance by name, no Diketahui at all (acknowledgeBy ignored)', () => {
    expect(ruleDecisionError(rule(), rolesOf)).toBeNull()
    expect(ruleDecisionError(rule({ acknowledgeBy: 'user', acknowledgeRole: null, acknowledgeUser: DIR_A, steps: [{ level: 1, approverUser: FIN_A }] }), rolesOf)).toBeNull()
    expect(ruleDecisionError(rule({ acknowledge: 'none', acknowledgeBy: 'scope_manager', acknowledgeRole: null }), rolesOf)).toBeNull()
  })
})

describe('G1-2 position plan (skip rule, 409 when no independent decision)', () => {
  const plan = (excluded: number[], ackHolders = [DIR_A], stepHolders: number[][] = [[FIN_A]], r = rule()) =>
    planPositions({ rule: r, excluded: new Set(excluded), ackHolders, stepHolders })

  it('independent Direktur + Finance → both positions, nothing skipped', () => {
    expect(plan([PM])).toEqual({ ok: true, plan: { ackRequired: true, ackUserId: null, steps: [{ level: 1, approverRole: 'pk-finance', approverUserId: null }], skipped: [] } })
  })
  it('the only Direktur is the requester → "Diketahui" skipped (recorded), Finance decides alone', () => {
    const r = plan([DIR_A])
    expect(r).toMatchObject({ ok: true, plan: { ackRequired: false, steps: [{ level: 1 }], skipped: [{ position: 'diketahui', level: 0, role: 'pk-owner', reason: 'pemohon/pembuat adalah satu-satunya Direktur' }] } })
  })
  it('a second Direktur exists → not skipped (the other Direktur decides)', () => {
    expect(plan([DIR_A], [DIR_A, DIR_B])).toMatchObject({ ok: true, plan: { ackRequired: true, skipped: [] } })
  })
  it('the only Finance is the creator → approval skipped, steps empty (Direktur alone)', () => {
    expect(plan([FIN_A])).toMatchObject({ ok: true, plan: { ackRequired: true, steps: [], skipped: [{ position: 'approval', level: 1, role: 'pk-finance', reason: 'pemohon/pembuat adalah satu-satunya Finance' }] } })
  })
  it('requester = only Direktur, creator = only Finance → 409 (no independent decision)', () => {
    expect(plan([DIR_A, FIN_A])).toMatchObject({ ok: false, error: expect.stringMatching(/Tidak ada pihak independen/) })
  })
  it('nobody holds the Direktur role → 409 (configuration), never a silent skip', () => {
    expect(plan([], [])).toMatchObject({ ok: false, error: expect.stringMatching(/Tidak ada pengguna aktif untuk posisi "Diketahui Oleh" \(peran Direktur\)/) })
  })
  it('one person holding Direktur AND Finance cannot fill both positions → 409', () => {
    expect(plan([], [DIR_A], [[DIR_A]])).toMatchObject({ ok: false, error: expect.stringMatching(/orang yang berbeda/) })
  })
  it('two Finance levels: a skipped level 1 renumbers level 2 to 1', () => {
    const r = rule({ steps: [{ level: 1, approverUser: FIN_A }, { level: 2, approverRole: 'pk-finance' }] })
    expect(plan([FIN_A], [DIR_A], [[FIN_A], [FIN_A, FIN_B]], r)).toMatchObject({
      ok: true,
      plan: { steps: [{ level: 1, approverRole: 'pk-finance', approverUserId: null }], skipped: [{ position: 'approval', level: 1, userId: FIN_A, reason: 'user yang ditetapkan adalah pemohon/pembuat' }] },
    })
  })
  it('distinctAssignable: exact matching', () => {
    expect(distinctAssignable([[1, 2], [1]])).toBe(true)
    expect(distinctAssignable([[1], [1]])).toBe(false)
  })
})

describe('PM monitors only (service guard) + re-approval via "Menunggu Diketahui"', () => {
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
    ...over,
  })
  it('lacksDecisionRole only on ADR 0013 snapshots (legacy snapshots keep their old guards, AC-8)', () => {
    const snap = { decisionRoles: ['pk-owner', 'pk-finance'] as Role[] }
    expect(lacksDecisionRole(snap, ['pk-pm'])).toBe(true)
    expect(lacksDecisionRole(snap, ['pk-admin', 'pk-staff'])).toBe(true)
    expect(lacksDecisionRole(snap, ['pk-owner'])).toBe(false)
    expect(lacksDecisionRole(snap, ['pk-finance', 'pk-pm'])).toBe(false)
    expect(lacksDecisionRole({}, ['pk-pm'])).toBe(false)
  })
  it('a caller without a decision role gets no acknowledge/approve/reject even if matched', () => {
    const acts = allowedActions(ctx({ lacksDecisionRole: true }))
    expect(acts).not.toContain('acknowledge')
    expect(acts).not.toContain('reject')
    expect(allowedActions(ctx({ status: 'pending_approval', isAcknowledger: false, matchesCurrentStep: true, lacksDecisionRole: true }))).not.toContain('approve')
    expect(allowedActions(ctx({ roles: ['pk-owner'] }))).toEqual(expect.arrayContaining(['acknowledge', 'reject']))
  })
  it('state table: receipts_resubmit may go back to pending_ack (AC-7)', () => {
    expect(targets('reimburse', 'receipt_revision', 'receipts_resubmit')).toEqual(expect.arrayContaining(['approved', 'pending_ack', 'pending_approval']))
  })
  it('timeline: Direktur approves "Diketahui", then Finance level 1', () => {
    const snapshot = { acknowledge: 'required' as const, acknowledgeBy: 'role' as const, acknowledgerUserId: null, acknowledgeRole: 'pk-owner' as const, steps: [{ level: 1, approverRole: 'pk-finance' as const, approverUserId: null }], decisionRoles: ['pk-owner', 'pk-finance'] as Role[] }
    const base = { type: 'advance' as const, currentLevel: 0, snapshot, requesters: 'A', names: {} }
    expect(nextActor({ ...base, status: 'pending_ack' })).toEqual({ who: 'Direktur', what: 'setujui (Diketahui) atau tolak' })
    expect(nextActor({ ...base, status: 'pending_approval', currentLevel: 1 })?.who).toBe('Finance — approval level 1')
  })
})
