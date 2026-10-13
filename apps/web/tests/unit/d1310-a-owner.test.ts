import { describe, expect, it } from 'vitest'

import {
  effectiveRoles,
  exactRolesIn,
  exactRolesOf,
  hasExactRole,
  hasRole,
  PANEL_ROLES,
  PRINCIPAL_ROLE,
  ROLE_IMPLIES,
  ROLE_LABELS,
  ROLES,
  rolesIn,
  withCompanyContext,
  type Role,
} from '@/access/roles'
import { capabilitiesOf } from '@/api/v1/endpoints/me'
import { buildApprovalTimeline, type TimelineInput, type TimelineSnapshot } from '@/domain/expense/approval-timeline'
import { decisionText } from '@/domain/expense/decision-texts'
import {
  ADDENDUM_DECISION_ROLES,
  DECISION_ROLES,
  isDecisionRole,
  isNoApproval,
  isNoApprovalRule,
  lacksDecisionRole,
  noApprovalNote,
  OWNER_ROLE,
  planPositions,
  PRINCIPAL_NO_APPROVAL,
  PRINCIPAL_NO_APPROVAL_NOTE,
  REQUESTER_ROLE_OPTIONS,
  ruleDecisionError,
  selfApprovalNote,
} from '@/domain/expense/decision'
import { buildRequestStepper, type StepperInput } from '@/domain/expense/request-stepper'
import { rulePreview } from '@/domain/expense/rule-preview'
import { buildSnapshot, matchesStep, selectRule, type ApprovalSnapshot, type RuleInput } from '@/domain/expense/rules'
import { allowedActions, type ActorContext } from '@/domain/expense/state'
import { approvalStepLabel, decisionByOf, nextActor, OWNER_STEP_LABEL, requestStatusLabel } from '@/domain/expense/timeline'
import { OWNER_WAITING_LABEL, STATUS_LABELS } from '@/domain/expense/types'
import { approvalEmail, eventsFor } from '@/domain/notifications'
import { OWNER_RULE } from '@/migrations/20261013_610200_d1310_owner_role_data'
import { DEFAULT_APPROVAL_RULES, OWNER_RULE_NAME } from '@/seed/data'

/**
 * ADR 0025 (owner decision 2026-10-13): "Owner" (`pk-principal`) one approval level ABOVE the Direktur — pure parts:
 * role + effective/stored roles, rule resolution and the decision guards (exact roles), labels, the stepper with the
 * Owner level, the Owner's own request (zero-step), notifications wording. Fictional names only.
 */
const DIR = 11
const OWN = 12
const PM = 13
const STAFF = 14

const pmDirOwner = (over: Partial<RuleInput> = {}): RuleInput => ({
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
  steps: [
    { level: 1, approverRole: 'pk-owner' },
    { level: 2, approverRole: 'pk-principal' },
  ],
  ...over,
})
const ownerRule = (over: Partial<RuleInput> = {}): RuleInput =>
  pmDirOwner({ id: 3, name: 'Pengajuan Owner', priority: 5, requesterRoles: ['pk-principal'], acknowledge: 'none', acknowledgeBy: 'role', steps: [], ...over })
const direkturRule = (over: Partial<RuleInput> = {}): RuleInput =>
  pmDirOwner({ id: 2, name: 'Pengajuan Direktur', priority: 10, requesterRoles: ['pk-owner'], acknowledge: 'none', acknowledgeBy: 'role', steps: [{ level: 1, approverRole: 'pk-principal' }], ...over })

describe('role "Owner" (pk-principal): same access as the Direktur, its own approval identity', () => {
  it('key + label; not the Direktur key', () => {
    expect(PRINCIPAL_ROLE).toBe('pk-principal')
    expect(OWNER_ROLE).toBe('pk-principal')
    expect(ROLES).toContain('pk-principal')
    expect(ROLE_LABELS['pk-principal']).toBe('Owner')
    expect(ROLE_LABELS['pk-owner']).toBe('Direktur')
    expect(PANEL_ROLES).toContain('pk-principal')
    expect(ROLE_IMPLIES['pk-principal']).toEqual(['pk-owner'])
  })
  it('effective roles = stored roles + implied ones (order kept, no duplicates)', () => {
    expect(effectiveRoles(['pk-principal'])).toEqual(['pk-principal', 'pk-owner'])
    expect(effectiveRoles(['pk-owner', 'pk-principal'])).toEqual(['pk-owner', 'pk-principal'])
    expect(effectiveRoles(['pk-finance'])).toEqual(['pk-finance'])
  })
  it('company context: access checks see the Direktur role, the approval engine the stored one — per PT', () => {
    const user = withCompanyContext({ id: OWN }, [
      { company: 1, roles: ['pk-principal'], employee: null },
      { company: 2, roles: ['pk-finance'], employee: null },
    ], null, false)
    const req = { user } as never
    expect(rolesIn(req, 1)).toEqual(['pk-principal', 'pk-owner'])
    expect(hasRole(req, 'pk-owner', 1)).toBe(true) // every byRole({ 'pk-owner': … }) map applies
    expect(hasRole(req, 'pk-owner', 2)).toBe(false) // only in the PTs where he is Owner
    expect(exactRolesIn(req, 1)).toEqual(['pk-principal'])
    expect(hasExactRole(req, 'pk-owner', 1)).toBe(false)
    expect(hasExactRole(req, 'pk-principal', 1)).toBe(true)
    expect(user.roles).toEqual(['pk-finance', 'pk-owner', 'pk-principal'])
    expect(exactRolesOf(user)).toEqual(['pk-finance', 'pk-principal'])
    // idempotent on a context's own memberships (runUnderCompany re-applies withCompanyContext)
    const again = withCompanyContext({ id: OWN }, (user as unknown as { _pkCompanies: { memberships: never[] } })._pkCompanies.memberships, [1], false)
    expect(exactRolesIn({ user: again } as never, 1)).toEqual(['pk-principal'])
    expect(rolesIn({ user: again } as never, 1)).toEqual(['pk-principal', 'pk-owner'])
  })
  it('APK capabilities from the effective roles: the Owner gets every Direktur capability (approval inbox, progress reports)', () => {
    const owner = capabilitiesOf(effectiveRoles(['pk-principal']), { fieldReportsEnabled: true })
    expect(owner).toEqual(capabilitiesOf(['pk-owner'], { fieldReportsEnabled: true }))
    expect(owner).toMatchObject({ approvalInbox: true, progressReportCreate: true, teamMonitor: false })
  })
})

describe('rule resolution + decision guards (exact roles)', () => {
  it('decision roles: Direktur, Finance, Owner — Addendum RAB stays Direktur/Finance', () => {
    expect(DECISION_ROLES).toEqual(['pk-owner', 'pk-finance', 'pk-principal'])
    expect(ADDENDUM_DECISION_ROLES).toEqual(['pk-owner', 'pk-finance'])
    expect(isDecisionRole('pk-principal')).toBe(true)
    expect(REQUESTER_ROLE_OPTIONS).toContain('pk-principal')
  })
  it('the default shape PM project → Direktur → Owner is valid; an Owner level on an Addendum RAB rule is refused', () => {
    expect(ruleDecisionError(pmDirOwner(), () => undefined)).toBeNull()
    expect(ruleDecisionError(direkturRule(), () => undefined)).toBeNull()
    const addendum = pmDirOwner({ acknowledgeBy: 'role', acknowledgeRole: 'pk-owner', steps: [{ level: 1, approverRole: 'pk-principal' }] })
    expect(ruleDecisionError(addendum, () => undefined, 'budget_addendum')).toMatch(/ADR 0025/)
    // a named approver must hold a decision role (stored roles)
    expect(ruleDecisionError(pmDirOwner({ steps: [{ level: 1, approverUser: OWN }] }), (id) => (id === OWN ? (['pk-principal'] as Role[]) : undefined))).toBeNull()
  })
  it('step matching uses the STORED role: the Owner never decides the Direktur level, the Direktur never the Owner level', () => {
    const dirStep = { level: 1, approverRole: 'pk-owner' as Role, approverUserId: null }
    const ownStep = { level: 2, approverRole: 'pk-principal' as Role, approverUserId: null }
    expect(matchesStep(dirStep, { id: OWN, roles: ['pk-principal'] })).toBe(false)
    expect(matchesStep(ownStep, { id: OWN, roles: ['pk-principal'] })).toBe(true)
    expect(matchesStep(ownStep, { id: DIR, roles: ['pk-owner'] })).toBe(false)
    expect(matchesStep(dirStep, { id: DIR, roles: ['pk-owner'] })).toBe(true)
  })
  it('in-flight snapshots (decision roles without the Owner) keep their deciders: the Owner lacks a decision role there', () => {
    expect(lacksDecisionRole({ decisionRoles: ['pk-owner', 'pk-finance'] }, ['pk-principal'])).toBe(true)
    expect(lacksDecisionRole({ decisionRoles: [...DECISION_ROLES] }, ['pk-principal'])).toBe(false)
    expect(lacksDecisionRole({ decisionRoles: ['pk-owner', 'pk-finance'] }, ['pk-owner'])).toBe(false)
  })
  it('allowedActions: effective roles give the Owner no decision unless he matches the current step', () => {
    const ctx: ActorContext = { type: 'advance', status: 'pending_approval', roles: ['pk-principal', 'pk-owner'], isCreator: false, isRequester: false, hasDecision: true, isAcknowledger: false, matchesCurrentStep: false, alreadyDecided: false }
    expect(allowedActions(ctx)).not.toContain('approve')
    expect(allowedActions({ ...ctx, matchesCurrentStep: true })).toEqual(expect.arrayContaining(['approve', 'reject']))
  })
  it('position plan: Direktur and Owner levels need two different people (distinct-person rule)', () => {
    const plan = (stepHolders: number[][], excluded: number[] = [STAFF]) => planPositions({ rule: pmDirOwner(), excluded: new Set(excluded), ackHolders: [PM], stepHolders })
    expect(plan([[DIR], [OWN]])).toEqual({
      ok: true,
      plan: {
        ackRequired: true,
        ackUserId: PM,
        steps: [
          { level: 1, approverRole: 'pk-owner', approverUserId: null },
          { level: 2, approverRole: 'pk-principal', approverUserId: null },
        ],
        skipped: [],
      },
    })
    // one person holding both Direktur and Owner (and nobody else) cannot fill both levels
    expect(plan([[DIR], [DIR]])).toMatchObject({ ok: false, error: expect.stringMatching(/orang yang berbeda/) })
    // no Owner in the PT yet → configuration problem (409 at submit)
    expect(plan([[DIR], []])).toMatchObject({ ok: false, error: expect.stringMatching(/Approval level 2 \(peran Owner\)/) })
    // the Owner as requester/creator → his level would be skipped (snapshotForRule refuses it: MSG_OWNER_STEP_SKIPPED)
    expect(plan([[DIR], [OWN]], [OWN])).toMatchObject({ ok: true, plan: { skipped: [{ position: 'approval', level: 2, role: 'pk-principal' }] } })
  })
  it('rule selection: Owner requester → "Pengajuan Owner", Direktur requester → "Pengajuan Direktur" (→ Owner), Staff → default', () => {
    const rules = [pmDirOwner(), direkturRule(), ownerRule()]
    const facts = (requesterRoles: Role[][]) => ({ type: 'advance' as const, grandTotal: 1_000_000, categoryIds: [], projectId: 5, requesterRoles })
    expect(selectRule(rules, facts([['pk-principal']]))?.name).toBe('Pengajuan Owner')
    expect(selectRule(rules, facts([['pk-owner']]))?.name).toBe('Pengajuan Direktur')
    expect(selectRule(rules, facts([['pk-staff']]))?.name).toBe(pmDirOwner().name)
  })
  it('the Owner\'s own request rule: zero steps, exception principal_no_approval', () => {
    expect(isNoApprovalRule(ownerRule())).toBe(true)
    expect(isNoApprovalRule(ownerRule({ requesterRoles: ['pk-owner'] }))).toBe(false)
    expect(isNoApprovalRule(direkturRule())).toBe(false)
    expect(buildSnapshot(ownerRule(), null).steps).toEqual([])
    expect(isNoApproval({ selfApproval: PRINCIPAL_NO_APPROVAL })).toBe(true)
    expect(noApprovalNote({ selfApproval: PRINCIPAL_NO_APPROVAL })).toBe(PRINCIPAL_NO_APPROVAL_NOTE)
    expect(selfApprovalNote(PRINCIPAL_NO_APPROVAL)).toBe('Tanpa persetujuan — pengajuan Owner (kebijakan PT)')
  })
  it('seed = data migration: "Pengajuan Owner" + an Owner level on every seeded expense rule; Addendum RAB untouched', () => {
    expect(OWNER_RULE).toBe(OWNER_RULE_NAME)
    for (const r of DEFAULT_APPROVAL_RULES) {
      const steps = r.steps as ReadonlyArray<{ level: number; approverRole: string }>
      if (r.docType === 'budget_addendum') expect(steps.some((s) => s.approverRole === 'pk-principal')).toBe(false)
      else if (r.name === OWNER_RULE_NAME) expect(steps).toEqual([])
      else expect(steps.at(-1)?.approverRole).toBe('pk-principal')
    }
  })
})

const SNAP: TimelineSnapshot & Pick<ApprovalSnapshot, 'steps'> = {
  acknowledge: 'required',
  acknowledgeBy: 'scope_manager',
  acknowledgerUserId: PM,
  acknowledgeRole: null,
  decisionRoles: [...DECISION_ROLES],
  skipped: [],
  steps: [
    { level: 1, approverRole: 'pk-owner', approverUserId: null },
    { level: 2, approverRole: 'pk-principal', approverUserId: null },
  ],
}
const LABEL_SNAP = { ...SNAP, selfApproval: null }

describe('labels: "Persetujuan Owner" / "Menunggu persetujuan Owner"', () => {
  it('step labels, status labels and who decides follow the level\'s role', () => {
    expect(approvalStepLabel(LABEL_SNAP, 1)).toBe('Persetujuan Direktur')
    expect(approvalStepLabel(LABEL_SNAP, 2)).toBe(OWNER_STEP_LABEL)
    expect(OWNER_STEP_LABEL).toBe('Persetujuan Owner')
    expect(requestStatusLabel('advance', 'pending_approval', LABEL_SNAP, 1)).toBe(STATUS_LABELS.pending_approval)
    expect(requestStatusLabel('advance', 'pending_approval', LABEL_SNAP, 2)).toBe(OWNER_WAITING_LABEL)
    expect(OWNER_WAITING_LABEL).toBe('Menunggu persetujuan Owner')
    // "Pengajuan Direktur": no "Diketahui", the Owner is level 1
    const dirRequest = { ...LABEL_SNAP, acknowledge: 'none' as const, acknowledgeBy: 'role' as const, acknowledgerUserId: null, steps: [{ level: 1, approverRole: 'pk-principal' as Role, approverUserId: null }] }
    expect(requestStatusLabel('reimburse', 'pending_approval', dirRequest, 1)).toBe('Menunggu persetujuan Owner')
    expect(decisionByOf(LABEL_SNAP, 'approve', 1)).toBe('direktur')
    expect(decisionByOf(LABEL_SNAP, 'approve', 2)).toBe('owner')
  })
  it('decision texts: the Direktur level hands over, the Owner level is the last decision before Finance', () => {
    const base = { step: 'approve' as const, docNo: 'PB/1', grandTotal: 1_250_000, decisionFlow: true }
    expect(decisionText({ ...base, decisionBy: 'direktur', finalStep: false }).confirm).toBe('Setujui PB/1 sebesar Rp 1.250.000 sebagai Direktur? Pengajuan diteruskan ke level persetujuan berikutnya.')
    expect(decisionText({ ...base, decisionBy: 'owner', finalStep: true }).confirm).toBe('Setujui PB/1 sebesar Rp 1.250.000 sebagai Owner? Pengajuan diteruskan ke Finance untuk transfer.')
  })
  it('next actor: "Owner — Persetujuan Owner"', () => {
    expect(nextActor({ type: 'advance', status: 'pending_approval', currentLevel: 2, snapshot: SNAP, requesters: 'Sari', names: {} })).toEqual({
      who: 'Owner — Persetujuan Owner',
      what: 'setujui atau tolak (keputusan terakhir sebelum transfer Finance)',
    })
  })
  it('rule editor preview names the Owner level', () => {
    const p = rulePreview({ docType: 'expense_request', requesterRoles: ['pk-owner'], acknowledge: 'none', acknowledgeBy: 'role', acknowledgeRole: null, hasAcknowledgeUser: false, steps: [{ level: 1, approverRole: 'pk-principal', hasUser: false }] })
    expect(p.example).toBe('Contoh: pengajuan oleh Direktur → Level 1: Owner → Finance: transfer (antrian transfer; Reimburse: verifikasi nota dulu). (Direktur tidak pernah memutuskan pengajuannya sendiri — G1.)')
    expect(p.error).toBeNull()
  })
})

const signed = [{ cycle: 1, position: 'diajukan', level: 0, actorName: 'Sari', onBehalf: false, decision: 'signed', reason: null, decidedAt: '2026-10-13T01:00:00.000Z' }]
const pmOk = { cycle: 1, position: 'diketahui', level: 0, actorName: 'PM Uji', onBehalf: false, decision: 'acknowledged', reason: null, decidedAt: '2026-10-13T02:00:00.000Z' }
const dirOk = { cycle: 1, position: 'approval', level: 1, actorName: 'Direktur Uji', onBehalf: false, decision: 'approved', reason: null, decidedAt: '2026-10-13T03:00:00.000Z' }
const ownOk = { cycle: 1, position: 'approval', level: 2, actorName: 'Owner Uji', onBehalf: false, decision: 'approved', reason: null, decidedAt: '2026-10-13T04:00:00.000Z' }
const input = (over: Partial<StepperInput> = {}): StepperInput => ({
  type: 'advance',
  status: 'pending_approval',
  approvalCycle: 1,
  currentLevel: 2,
  submittedAt: '2026-10-13T01:00:00.000Z',
  snapshot: SNAP,
  approvals: [...signed, pmOk, dirOk],
  transfers: [],
  requesters: 'Sari',
  createdBy: 'Sari',
  names: { [PM]: 'PM Uji' },
  settlement: null,
  ...over,
})

describe('stepper with the Owner level: Diajukan → PM → Direktur → Owner → Transfer', () => {
  it('waiting for the Owner', () => {
    const s = buildRequestStepper(input())
    expect(s.steps.map((x) => `${x.key}:${x.title}:${x.state}`)).toEqual([
      'diajukan:Diajukan:done',
      'diketahui:Persetujuan PM:done',
      'approval-1:Persetujuan Direktur:done',
      'approval-2:Persetujuan Owner:current',
      'transfer:Transfer Finance:pending',
      'lpj:Nota & LPJ:pending',
      'settlement:Penyelesaian LPJ:pending',
      'end:Selesai:pending',
    ])
    expect(s.steps.find((x) => x.key === 'approval-2')).toMatchObject({ role: 'Owner', planned: 'Owner' })
    expect(s.currentKey).toBe('approval-2')
  })
  it('approved by the Owner → the Finance transfer queue is current', () => {
    const s = buildRequestStepper(input({ status: 'approved', currentLevel: 2, approvals: [...signed, pmOk, dirOk, ownOk] }))
    expect(s.steps.find((x) => x.key === 'approval-2')).toMatchObject({ state: 'done', actor: 'Owner Uji' })
    expect(s.currentKey).toBe('transfer')
  })
  it('the Owner\'s own request: Diajukan → Persetujuan (dilewati, "pengajuan Owner") → Transfer Finance', () => {
    const own: TimelineSnapshot = { acknowledge: 'none', acknowledgeBy: 'role', acknowledgerUserId: null, acknowledgeRole: null, decisionRoles: [...DECISION_ROLES], skipped: [], selfApproval: PRINCIPAL_NO_APPROVAL, steps: [] }
    const steps = buildApprovalTimeline({ ...input({ status: 'approved', currentLevel: 0, snapshot: own, approvals: signed }) } as TimelineInput)
    expect(steps.map((x) => [x.key, x.state])).toEqual([
      ['diajukan', 'done'],
      ['no-approval', 'skipped'],
      ['transfer', 'current'],
    ])
    expect(steps[1]).toMatchObject({ role: 'Owner (pemohon)', note: PRINCIPAL_NO_APPROVAL_NOTE })
    expect(requestStatusLabel('advance', 'approved', { ...own, selfApproval: PRINCIPAL_NO_APPROVAL }, 0)).toBe('Tanpa persetujuan (Antri Transfer)')
  })
})

describe('notifications at the Owner level', () => {
  const doc = (currentLevel: number) =>
    ({ id: 1, docNo: 'PB/1', type: 'advance', status: 'pending_approval', title: 'x', currentLevel, approvalSnapshot: { ...SNAP, ruleId: 1, ruleName: 'Default', signDiajukan: 'required', signDibuat: 'required' } }) as never
  it('Direktur approves level 1 → the Owner level waits: "pending_approval" to the level holders (stored Owner role)', () => {
    expect(eventsFor({ status: 'pending_approval', currentLevel: 1 }, doc(2))).toEqual([{ event: 'expense.pending_approval', to: 'approval' }])
  })
  it('approval e-mail names the Owner', () => {
    expect(approvalEmail(doc(2), 'expense.pending_approval', undefined).text).toContain('menunggu persetujuan Anda sebagai Owner')
    expect(approvalEmail(doc(1), 'expense.pending_approval', undefined).text).toContain('menunggu approval Anda')
  })
})
