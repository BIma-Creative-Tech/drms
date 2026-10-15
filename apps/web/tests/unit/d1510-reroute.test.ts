import { describe, expect, it } from 'vitest'

import type { Role } from '@/access/roles'
import { DECISION_ROLES, PRINCIPAL_NO_APPROVAL } from '@/domain/expense/decision'
import { buildRequestStepper, type StepperInput } from '@/domain/expense/request-stepper'
import type { ApprovalSnapshot, RuleInput } from '@/domain/expense/rules'
import { MSG_PROJECT_WITHOUT_PM, resolveSelectAndSnapshot, SnapshotRefused, type SnapshotSource } from '@/domain/expense/snapshot-plan'
import { requestStatusLabel } from '@/domain/expense/timeline'
import type { HistoryRow } from '@/domain/history'
import { historyEntry } from '@/domain/history-format'
import { defaultText, fixedText, renderTemplate, type NotifyDoc } from '@/domain/notifications'
import {
  alignedRuleInput,
  canonicalJson,
  firstStepText,
  flowText,
  isDirekturAckSnapshot,
  isTargetShape,
  legacyShapeOf,
  legacyShapeWarning,
  MIGRATION,
  planRequest,
  planSummary,
  REROUTE_NOTE,
  rerouteNoteOf,
  RULE_RENAMES,
  ruleAlignmentOf,
  shapeText,
  statusAfter,
  TARGET_STEP_ROLES,
  type Candidate,
  type RuleRow,
} from '@/reroute/plan'
import { DEFAULT_APPROVAL_RULES, DIREKTUR_RULE_NAME, OWNER_RULE_NAME } from '@/seed/data'

/**
 * d1510 — owner decision 2026-10-15: default rules → PM project → Direktur → Owner (Finance only transfers); in-flight
 * requests the Direktur has not decided re-routed to what a submit TODAY produces. Pure parts: the shape matcher, the
 * aligned rule, the request plan (same snapshot code as a submit, in-memory facts), texts, stepper and notification of
 * a re-routed request. Fictional names only.
 */
const OLD_DEFAULT = RULE_RENAMES[0]!.from
const NEW_DEFAULT = RULE_RENAMES[0]!.to

const row = (over: Partial<RuleRow> = {}): RuleRow => ({
  id: 2,
  companyId: 1,
  name: OLD_DEFAULT,
  active: true,
  docType: 'expense_request',
  acknowledge: 'required',
  acknowledgeBy: 'role',
  acknowledgeRole: 'pk-owner',
  acknowledgeUser: null,
  requesterRoles: [],
  payeeType: 'any',
  steps: [
    { level: 1, role: 'pk-principal', user: null },
    { level: 2, role: 'pk-finance', user: null },
  ],
  ...over,
})

describe('shape matcher: only the two replaced shapes, only under the seeded names', () => {
  it('ADR 0013 + Owner (prod since 0.11.0) and pre-Owner ADR 0013 are recognised', () => {
    expect(legacyShapeOf(row())).toBe('adr0013_owner')
    expect(legacyShapeOf(row({ steps: [{ level: 1, role: 'pk-finance', user: null }] }))).toBe('adr0013')
    expect(shapeText(row())).toBe('Direktur (Diketahui) → Owner → Finance')
  })
  it('anything an Admin changed is another shape', () => {
    for (const r of [
      row({ acknowledgeBy: 'scope_manager', acknowledgeRole: null }),
      row({ acknowledgeRole: 'pk-principal' }),
      row({ acknowledge: 'optional' }),
      row({ acknowledgeBy: 'user', acknowledgeRole: null, acknowledgeUser: 5 }),
      row({ steps: [{ level: 1, role: 'pk-finance', user: null }, { level: 2, role: 'pk-finance', user: null }] }),
      row({ steps: [{ level: 1, role: null, user: 9 }] }),
      row({ steps: [{ level: 1, role: 'pk-principal', user: null }, { level: 3, role: 'pk-finance', user: null }] }),
      row({ requesterRoles: ['pk-staff'] }),
      row({ payeeType: 'vendor' }),
      row({ steps: [] }),
      row({ docType: 'budget_addendum' }),
    ]) {
      expect(legacyShapeOf(r), JSON.stringify(r)).toBeNull()
    }
  })
  it('alignment: seeded name + replaced shape → align (id kept, renamed); seeded name + other shape → skip; other names → untouched', () => {
    expect(ruleAlignmentOf(row())).toMatchObject({ action: 'align', shape: 'adr0013_owner', to: NEW_DEFAULT })
    expect(ruleAlignmentOf(row({ name: RULE_RENAMES[1]!.from, active: false, steps: [{ level: 1, role: 'pk-finance', user: null }] }))).toMatchObject({
      action: 'align',
      shape: 'adr0013',
      to: RULE_RENAMES[1]!.to,
    })
    expect(ruleAlignmentOf(row({ steps: [{ level: 1, role: 'pk-owner', user: null }] }))).toMatchObject({ action: 'skip', reason: expect.stringContaining('diubah Admin') })
    expect(ruleAlignmentOf(row({ name: 'Aturan khusus Admin' }))).toBeNull()
    expect(ruleAlignmentOf(row({ name: NEW_DEFAULT, acknowledgeBy: 'scope_manager', acknowledgeRole: null }))).toBeNull() // already aligned → idempotent
    expect(legacyShapeWarning(row({ name: 'Uji — Direktur lalu Finance' }))).toMatch(/masih "Diketahui" Direktur/)
    expect(legacyShapeWarning(row({ name: 'Uji — Direktur lalu Finance', active: false }))).toBeNull()
    expect(legacyShapeWarning(row())).toBeNull()
  })
  it('target names and shape = the current seed (DEFAULT_APPROVAL_RULES)', () => {
    for (const r of RULE_RENAMES) {
      const seed = DEFAULT_APPROVAL_RULES.find((x) => x.name === r.to)
      expect(seed, r.to).toBeDefined()
      expect(seed).toMatchObject({ acknowledge: 'required', acknowledgeBy: 'scope_manager', acknowledgeRole: null })
      expect(seed!.steps.map((s) => s.approverRole)).toEqual([...TARGET_STEP_ROLES])
    }
    const target = row({ name: NEW_DEFAULT, acknowledgeBy: 'scope_manager', acknowledgeRole: null, steps: TARGET_STEP_ROLES.map((role, i) => ({ level: i + 1, role, user: null })) })
    expect(isTargetShape(target)).toBe(true)
    expect(isTargetShape(row())).toBe(false)
    expect(shapeText(target)).toBe('PM project → Direktur → Owner')
  })
})

// ---------------------------------------------------------------- the request plan (in-memory facts)

const STAFF = 10
const PM = 20
const DIR = 30
const DIR2 = 31
const OWNER = 40
const FIN = 50
type M = { roles: Role[]; active: boolean; emp?: number }
const members: Record<number, M> = {
  [STAFF]: { roles: ['pk-staff'], active: true, emp: 100 },
  [PM]: { roles: ['pk-pm'], active: true, emp: 200 },
  [DIR]: { roles: ['pk-owner'], active: true, emp: 300 },
  [DIR2]: { roles: ['pk-owner'], active: true },
  [OWNER]: { roles: ['pk-principal'], active: true, emp: 400 },
  [FIN]: { roles: ['pk-finance'], active: true },
}
const ruleInput = (over: Partial<RuleInput>): RuleInput => ({
  id: 0,
  name: '',
  active: true,
  docType: 'expense_request',
  requestType: 'any',
  minAmount: 0,
  maxAmount: null,
  priority: 100,
  requesterRoles: [],
  payeeType: 'any',
  acknowledge: 'none',
  acknowledgeBy: 'role',
  acknowledgeRole: null,
  acknowledgeUser: null,
  signDiajukan: 'required',
  signDibuat: 'required',
  steps: [],
  ...over,
})
const OLD_RULE = ruleInput({ id: 2, name: OLD_DEFAULT, acknowledge: 'required', acknowledgeRole: 'pk-owner', steps: [{ level: 1, approverRole: 'pk-principal' }, { level: 2, approverRole: 'pk-finance' }] })
const RULES: RuleInput[] = [
  alignedRuleInput(OLD_RULE, NEW_DEFAULT),
  ruleInput({ id: 10, name: DIREKTUR_RULE_NAME, priority: 10, requesterRoles: ['pk-owner'], steps: [{ level: 1, approverRole: 'pk-principal' }] }),
  ruleInput({ id: 21, name: OWNER_RULE_NAME, priority: 5, requesterRoles: ['pk-principal'] }),
]
const src: SnapshotSource = {
  activeRules: async () => RULES,
  usersOfEmployees: async (emps) =>
    Object.entries(members)
      .filter(([, m]) => m.emp !== undefined && emps.includes(m.emp))
      .map(([u]) => Number(u))
      .sort((a, b) => a - b),
  rolesOfUsersIn: async (ids) => new Map(ids.filter((id) => members[id]).map((id) => [id, { roles: members[id]!.roles, active: members[id]!.active }])),
  membersWithRole: async (role) =>
    Object.entries(members)
      .filter(([, m]) => m.active && m.roles.includes(role))
      .map(([u]) => Number(u)),
  scopeManagerOf: async (s) => (s.projectId === 1 ? PM : null),
}
const OLD_SNAP: ApprovalSnapshot = {
  ruleId: 2,
  ruleName: OLD_DEFAULT,
  acknowledge: 'required',
  acknowledgeBy: 'role',
  acknowledgerUserId: null,
  acknowledgeRole: 'pk-owner',
  signDiajukan: 'required',
  signDibuat: 'required',
  steps: [
    { level: 1, approverRole: 'pk-principal', approverUserId: null },
    { level: 2, approverRole: 'pk-finance', approverUserId: null },
  ],
  decisionRoles: [...DECISION_ROLES],
  skipped: [],
}
const cand = (over: Partial<Candidate> & { emp?: number; creator?: number; project?: number | null } = {}): Candidate => {
  const { emp = 100, creator = STAFF, project = 1, ...rest } = over
  return {
    id: 7,
    companyId: 1,
    docNo: 'PB/UJI/2610/0007',
    title: 'Material',
    status: 'pending_ack',
    cycle: 1,
    currentLevel: 0,
    ruleId: 2,
    ruleName: OLD_DEFAULT,
    snapshot: OLD_SNAP,
    g1Exception: null,
    decisions: 0,
    facts: { companyId: 1, type: 'advance', grandTotal: 750_000, categoryIds: [3], projectId: project, costCenterId: null, creatorId: creator, requesterEmployeeIds: [emp], payeeType: 'karyawan' },
    ...rest,
  }
}
const names = new Map([[PM, 'PM Uji']])

describe('planRequest: the snapshot a submit TODAY produces', () => {
  it('Staff request → PM project first (pending_ack), then Direktur, then Owner; same snapshot as a fresh submit', async () => {
    const p = await planRequest(src, cand(), names)
    expect(p).toMatchObject({ action: 'reroute', newRuleId: 2, newRuleName: NEW_DEFAULT, newStatus: 'pending_ack', newLevel: 0, firstStep: 'Persetujuan PM (PM Uji)' })
    expect(p.newSnapshot).toEqual({
      ruleId: 2,
      ruleName: NEW_DEFAULT,
      acknowledge: 'required',
      acknowledgeBy: 'scope_manager',
      acknowledgerUserId: PM,
      acknowledgeRole: null,
      signDiajukan: 'required',
      signDibuat: 'required',
      steps: [
        { level: 1, approverRole: 'pk-owner', approverUserId: null },
        { level: 2, approverRole: 'pk-principal', approverUserId: null },
      ],
      decisionRoles: ['pk-owner', 'pk-finance', 'pk-principal'],
      skipped: [],
    })
    expect(p.newSnapshot).toEqual((await resolveSelectAndSnapshot(src, cand().facts)).snapshot)
    expect(p.oldFlow).toBe('Direktur (Diketahui) → Owner → Finance')
    expect(p.newFlow).toBe('PM project (PM Uji) → Direktur → Owner')
  })
  it('the PM files his own request → PM step skipped exactly as at submit (G1-2) → waits for the Direktur', async () => {
    const p = await planRequest(src, cand({ emp: 200, creator: PM }), names)
    expect(p).toMatchObject({ action: 'reroute', newStatus: 'pending_approval', newLevel: 1, firstStep: 'Persetujuan Direktur' })
    expect(p.newSnapshot).toMatchObject({
      acknowledge: 'none',
      acknowledgeBy: 'scope_manager',
      acknowledgerUserId: null,
      skipped: [{ position: 'diketahui', level: 0, role: null, userId: PM, reason: 'PM project adalah pemohon/pembuat' }],
      steps: [
        { level: 1, approverRole: 'pk-owner', approverUserId: null },
        { level: 2, approverRole: 'pk-principal', approverUserId: null },
      ],
    })
    expect(p.newFlow).toBe('Direktur → Owner [PM project dilewati — PM project adalah pemohon/pembuat]')
  })
  it('the PM as creator for a Staff requester → also skipped (creator = PM)', async () => {
    expect(await planRequest(src, cand({ creator: PM }), names)).toMatchObject({ action: 'reroute', newStatus: 'pending_approval', firstStep: 'Persetujuan Direktur' })
  })
  it('a Direktur\'s own request → the rule a submit picks by priority ("Pengajuan Direktur" → Owner)', async () => {
    const p = await planRequest(src, cand({ emp: 300, creator: DIR }), names)
    expect(p).toMatchObject({ action: 'reroute', newRuleId: 10, newRuleName: DIREKTUR_RULE_NAME, newStatus: 'pending_approval', newLevel: 1, firstStep: 'Persetujuan Owner' })
    expect(p.newSnapshot!.steps).toEqual([{ level: 1, approverRole: 'pk-principal', approverUserId: null }])
  })
  it('kept: the Owner\'s own request (no approval — manual), a refused submit (no PM), a decided / delegated / new-model / later request', async () => {
    const own = await planRequest(src, cand({ emp: 400, creator: OWNER }))
    expect(own).toMatchObject({ action: 'keep', reason: expect.stringContaining('keputusan manual') })
    expect(own.newSnapshot).toBeNull()
    expect((await planRequest(src, cand({ project: 2 }))).reason).toContain(MSG_PROJECT_WITHOUT_PM)
    expect((await planRequest(src, cand({ decisions: 1 }))).reason).toMatch(/sudah ada keputusan/)
    expect((await planRequest(src, cand({ status: 'pending_approval' }))).reason).toMatch(/sudah lewat Direktur/)
    expect((await planRequest(src, cand({ g1Exception: 'direktur_via_pm' }))).action).toBe('keep')
    expect((await planRequest(src, cand({ snapshot: { ...OLD_SNAP, acknowledgeDelegatedTo: 'owner' } }))).action).toBe('keep')
    const fresh = (await resolveSelectAndSnapshot(src, cand().facts)).snapshot
    expect((await planRequest(src, cand({ snapshot: fresh }))).reason).toMatch(/bukan "Diketahui" Direktur/)
  })
  it('a refused submit is a SnapshotRefused (HTTP 409 at submit)', async () => {
    await expect(resolveSelectAndSnapshot(src, cand({ project: 2 }).facts)).rejects.toBeInstanceOf(SnapshotRefused)
    await expect(resolveSelectAndSnapshot(src, cand({ emp: 400, creator: STAFF }).facts)).rejects.toThrow(/dibuat dan dikirim sendiri oleh Owner/)
  })
  it('Owner\'s own request under the zero-step rule = principal_no_approval (the case the migration leaves to a person)', async () => {
    expect((await resolveSelectAndSnapshot(src, cand({ emp: 400, creator: OWNER }).facts)).snapshot.selfApproval).toBe(PRINCIPAL_NO_APPROVAL)
  })
  it('plan summary lists rules and requests (dry-run text)', async () => {
    const text = planSummary(
      { rules: [ruleAlignmentOf(row())!, ruleAlignmentOf(row({ id: 3, steps: [] }))!], warnings: ['w'], requests: [await planRequest(src, cand(), names), await planRequest(src, cand({ decisions: 1 }))] },
      new Map([[1, 'UJI']]),
    )
    expect(text).toContain('Aturan diselaraskan: 1; dibiarkan (diubah Admin): 1')
    expect(text).toContain(`[UBAH] UJI aturan #2 "${OLD_DEFAULT}" (Direktur (Diketahui) → Owner → Finance) → "${NEW_DEFAULT}"`)
    expect(text).toContain('Pengajuan dialihkan: 1; tetap alur lama: 1')
    expect(text).toContain('[ALIH] UJI PB/UJI/2610/0007 (pending_ack) Direktur (Diketahui) → Owner → Finance  ⇒  PM project (PM Uji) → Direktur → Owner')
    expect(text).toContain('PERINGATAN: w')
  })
})

describe('texts and helpers', () => {
  it('candidate snapshot, status after, first step, canonical JSON', () => {
    expect(isDirekturAckSnapshot(OLD_SNAP)).toBe(true)
    expect(isDirekturAckSnapshot({ ...OLD_SNAP, acknowledgeBy: 'scope_manager' })).toBe(false)
    expect(isDirekturAckSnapshot({ ...OLD_SNAP, selfApproval: 'direktur_via_pm' })).toBe(false)
    expect(isDirekturAckSnapshot(null)).toBe(false)
    expect(statusAfter({ ...OLD_SNAP, acknowledge: 'none' })).toEqual({ status: 'pending_approval', currentLevel: 1 })
    expect(statusAfter(OLD_SNAP)).toEqual({ status: 'pending_ack', currentLevel: 0 })
    expect(firstStepText(OLD_SNAP)).toBe('Diketahui Direktur')
    expect(firstStepText({ ...OLD_SNAP, acknowledge: 'none', steps: [{ level: 1, approverRole: 'pk-finance', approverUserId: null }] })).toBe('Approval Finance')
    expect(flowText({ ...OLD_SNAP, acknowledge: 'none', steps: [] })).toBe('tanpa persetujuan')
    expect(canonicalJson({ b: 1, a: [{ d: null, c: 'x' }] })).toBe(canonicalJson({ a: [{ c: 'x', d: null }], b: 1 }))
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }))
  })
  it('stepper note while the request carries the re-routed snapshot; "Log perubahan" row label', () => {
    const snap = { ...OLD_SNAP, acknowledgeBy: 'scope_manager' as const }
    const h = (newValue: unknown) => [{ action: 'update', field: 'approvalRule', newValue }]
    expect(rerouteNoteOf(h({ migration: MIGRATION, kind: 'reroute', snapshot: snap }), { ...snap })).toBe(REROUTE_NOTE)
    expect(rerouteNoteOf(h({ migration: MIGRATION, kind: 'reroute', snapshot: snap }), OLD_SNAP)).toBeNull() // re-approved since
    expect(rerouteNoteOf(h({ migration: MIGRATION, kind: 'revert', snapshot: snap }), snap)).toBeNull()
    expect(rerouteNoteOf([], snap)).toBeNull()
    expect(REROUTE_NOTE).toBe('Alur persetujuan diperbarui ke aturan terbaru (keputusan owner 2026-10-15)')
    const entry = historyEntry(
      {
        id: 1,
        serverTime: '2026-10-15T08:00:00.000Z',
        docType: 'expense_request',
        docId: '7',
        docNo: 'PB/UJI/2610/0007',
        action: 'update',
        field: 'approvalRule',
        lineNo: null,
        oldValue: { alur: 'Direktur (Diketahui) → Owner → Finance' },
        newValue: { alur: 'PM project (PM Uji) → Direktur → Owner' },
        statusFrom: null,
        statusTo: null,
        reason: REROUTE_NOTE,
        userId: null,
        userName: null,
        userRoles: null,
        source: 'system',
        appVersion: null,
        deviceId: null,
      } satisfies HistoryRow,
      'Asia/Makassar',
    )
    expect(entry).toMatchObject({ field: 'Alur persetujuan', who: 'sistem', reason: REROUTE_NOTE })
    expect(entry.change).toContain('Direktur (Diketahui) → Owner → Finance')
  })
})

// ---------------------------------------------------------------- stepper + notification of a re-routed request

const stepperOf = (snapshot: ApprovalSnapshot, over: Partial<StepperInput> = {}) =>
  buildRequestStepper({
    type: 'advance',
    status: 'pending_ack',
    approvalCycle: 1,
    currentLevel: 0,
    submittedAt: '2026-10-14T01:00:00.000Z',
    snapshot,
    approvals: [{ cycle: 1, position: 'diajukan', level: 0, actorName: 'Sari', onBehalf: false, decision: 'signed', reason: null, decidedAt: '2026-10-14T01:00:00.000Z' }],
    transfers: [],
    requesters: 'Sari',
    createdBy: 'Sari',
    names: { [PM]: 'PM Uji' },
    settlement: null,
    ...over,
  })

describe('stepper renders the re-routed flow: "Persetujuan PM" → "Persetujuan Direktur" → "Persetujuan Owner"', () => {
  it('waiting for the PM', async () => {
    const p = await planRequest(src, cand(), names)
    const s = stepperOf(p.newSnapshot!)
    expect(s.steps.map((x) => `${x.key}:${x.title}:${x.state}`)).toEqual([
      'diajukan:Diajukan:done',
      'diketahui:Persetujuan PM:current',
      'approval-1:Persetujuan Direktur:pending',
      'approval-2:Persetujuan Owner:pending',
      'transfer:Transfer Finance:pending',
      'lpj:Nota & LPJ:pending',
      'settlement:Penyelesaian LPJ:pending',
      'end:Selesai:pending',
    ])
    expect(s.steps.find((x) => x.key === 'diketahui')).toMatchObject({ role: 'PM project', planned: 'PM Uji' })
    expect(requestStatusLabel('advance', 'pending_ack', p.newSnapshot!, 0)).toBe('Menunggu persetujuan PM')
  })
  it('PM step skipped (PM = pemohon/pembuat) → the Direktur is current', async () => {
    const p = await planRequest(src, cand({ emp: 200, creator: PM }), names)
    const s = stepperOf(p.newSnapshot!, { status: 'pending_approval', currentLevel: 1 })
    expect(s.steps.slice(0, 4).map((x) => `${x.key}:${x.title}:${x.state}`)).toEqual([
      'diajukan:Diajukan:done',
      'diketahui:Persetujuan PM:skipped',
      'approval-1:Persetujuan Direktur:current',
      'approval-2:Persetujuan Owner:pending',
    ])
    expect(s.steps.find((x) => x.key === 'diketahui')!.note).toBe('(tidak berlaku — pemohon) — PM project adalah pemohon/pembuat')
    expect(requestStatusLabel('advance', 'pending_approval', p.newSnapshot!, 1)).toBe('Menunggu persetujuan Direktur')
  })
  it('the old snapshot (before the re-route) still renders "Persetujuan Direktur (Diketahui)" → Owner → Finance', () => {
    const s = stepperOf(OLD_SNAP)
    expect(s.steps.slice(1, 4).map((x) => `${x.key}:${x.title}`)).toEqual(['diketahui:Persetujuan Direktur (Diketahui)', 'approval-1:Persetujuan Owner', 'approval-2:Approval Finance (level 2)'])
  })
  it('notification of the new first approver = the one a submit sends ("Persetujuan PM: …" / Direktur default text)', async () => {
    const p = await planRequest(src, cand(), names)
    const doc: NotifyDoc = { id: 7, docNo: 'PB/UJI/2610/0007', type: 'advance', status: 'pending_ack', title: 'Material', grandTotal: 750_000, currentLevel: 0, approvalSnapshot: p.newSnapshot }
    const t = fixedText('expense.pending_ack', doc)!
    expect(renderTemplate(t.title, doc)).toBe('Persetujuan PM: PB/UJI/2610/0007')
    expect(renderTemplate(t.body, doc)).toBe('PB/UJI/2610/0007 menunggu persetujuan Anda sebagai PM project: Pengajuan Baru "Material" Rp 750.000.')
    const skipped = await planRequest(src, cand({ emp: 200, creator: PM }), names)
    const doc2: NotifyDoc = { ...doc, status: 'pending_approval', currentLevel: 1, approvalSnapshot: skipped.newSnapshot }
    expect(fixedText('expense.pending_approval', doc2)).toBeNull() // Direktur level → the template / default text
    expect(renderTemplate(defaultText('expense.pending_approval').title, doc2)).toBe('Menunggu Approval: PB/UJI/2610/0007')
    const owner = await planRequest(src, cand({ emp: 300, creator: DIR }), names)
    expect(fixedText('expense.pending_approval', { ...doc2, approvalSnapshot: owner.newSnapshot })!.title).toBe('Persetujuan Owner: {docNo}')
  })
})
