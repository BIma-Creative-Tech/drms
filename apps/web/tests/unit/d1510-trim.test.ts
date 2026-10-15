import { describe, expect, it } from 'vitest'

import type { Role } from '@/access/roles'
import type { ApprovalSnapshot } from '@/domain/expense/rules'
import type { HistoryRow } from '@/domain/history'
import { canonicalJson } from '@/reroute/plan'
import {
  PM_LEGACY_DECIDED,
  PM_LEGACY_KEPT,
  planTrim,
  pmNoteOf,
  TRIM_FIELD,
  TRIM_MIGRATION,
  TRIM_NOTE,
  trimNoteOf,
  trimSummary,
  trimValue,
  undecidedFinanceLevels,
  waitingText,
  type TrimCandidate,
  type TrimDecision,
} from '@/reroute/trim-plan'

/**
 * d1510 in-flight trim (owner decision 2026-10-15, migration 20261015_210000): Finance never approves — undecided
 * Finance levels are dropped (case 1), replaced by an Owner level when the snapshot has none (case 2), a request whose
 * Owner already approved goes "Disetujui" (case 3), an old flow is never sent back to the PM (case 4). Pure planner.
 * Fictional ids only.
 */
const DIREKTUR = 10
const OWNER = 20
const OWNER2 = 21
const STAFF = 30

const step = (level: number, approverRole: Role | null, approverUserId: number | null = null) => ({ level, approverRole, approverUserId })

function snap(steps: ApprovalSnapshot['steps'], over: Partial<ApprovalSnapshot> = {}): ApprovalSnapshot {
  return {
    ruleId: 2,
    ruleName: 'Default — Direktur lalu Finance (semua nominal)',
    acknowledge: 'required',
    acknowledgeBy: 'role',
    acknowledgerUserId: null,
    acknowledgeRole: 'pk-owner',
    signDiajukan: 'required',
    signDibuat: 'required',
    steps,
    decisionRoles: ['pk-owner', 'pk-finance', 'pk-principal'],
    skipped: [],
    selfApproval: null,
    ...over,
  }
}

const ack: TrimDecision = { position: 'diketahui', level: 0, decision: 'acknowledged', actor: DIREKTUR }
const approved = (level: number, actor: number): TrimDecision => ({ position: 'approval', level, decision: 'approved', actor })

function cand(over: Partial<TrimCandidate> = {}): TrimCandidate {
  return {
    id: 38,
    companyId: 1,
    docNo: 'PB/UJI/2610/0004',
    title: 'Uji',
    status: 'pending_approval',
    cycle: 1,
    currentLevel: 1,
    ruleId: 2,
    ruleName: 'Default — Direktur lalu Finance (semua nominal)',
    snapshot: snap([step(1, 'pk-principal'), step(2, 'pk-finance')]),
    g1Exception: null,
    decisions: [ack],
    excluded: [STAFF],
    owners: [OWNER, OWNER2],
    ...over,
  }
}

describe('undecidedFinanceLevels', () => {
  it('all Finance levels while "Diketahui" waits; from the current level on otherwise', () => {
    const s = snap([step(1, 'pk-finance'), step(2, 'pk-principal'), step(3, 'pk-finance')])
    expect(undecidedFinanceLevels(s, 'pending_ack', 0)).toEqual([1, 3])
    expect(undecidedFinanceLevels(s, 'pending_approval', 1)).toEqual([1, 3])
    expect(undecidedFinanceLevels(s, 'pending_approval', 2)).toEqual([3])
    expect(undecidedFinanceLevels(s, 'pending_approval', null)).toEqual([1, 3])
  })
})

describe('planTrim — case 1: waiting before the Finance level', () => {
  it('prod shape PB/DRMS/2610/0004: ack Direktur done → L1 Owner waiting → L2 Finance dropped; status / level / decisions kept', () => {
    const p = planTrim(cand())!
    expect(p).toMatchObject({ kind: 'trim', newStatus: 'pending_approval', newLevel: 1, dropped: [2], replaced: null, waiting: 'Persetujuan Owner', pm: PM_LEGACY_DECIDED })
    expect(p.newSnapshot!.steps).toEqual([step(1, 'pk-principal')])
    expect(p.newSnapshot!.decisionRoles).toEqual(['pk-owner', 'pk-principal'])
    expect(p.newFlow).toBe('Direktur (Diketahui) → Owner')
    expect(p.oldFlow).toBe('Direktur (Diketahui) → Owner → Finance')
    // nothing else of the snapshot changes
    const rest = (x: ApprovalSnapshot) => canonicalJson({ ...x, steps: null, decisionRoles: null })
    expect(rest(p.newSnapshot!)).toBe(rest(p.oldSnapshot))
  })

  it('still waiting for the Direktur ("Diketahui", 200000 left it alone): Finance dropped, pending_ack kept, PM not added', () => {
    const p = planTrim(cand({ status: 'pending_ack', currentLevel: 0, decisions: [] }))!
    expect(p).toMatchObject({ kind: 'trim', newStatus: 'pending_ack', newLevel: 0, waiting: 'Diketahui Direktur', pm: PM_LEGACY_KEPT })
    expect(p.newSnapshot!.steps).toEqual([step(1, 'pk-principal')])
  })

  it('pending_ack on an ADR 0013 snapshot (no Owner level): the Finance level becomes the Owner\'s, status kept', () => {
    const p = planTrim(cand({ status: 'pending_ack', currentLevel: 0, decisions: [], snapshot: snap([step(1, 'pk-finance')], { decisionRoles: ['pk-owner', 'pk-finance'] }) }))!
    expect(p).toMatchObject({ kind: 'trim', replaced: 1, newStatus: 'pending_ack' })
    expect(p.newSnapshot!.steps).toEqual([step(1, 'pk-principal')])
    expect(p.newSnapshot!.decisionRoles).toEqual(['pk-owner', 'pk-principal'])
  })

  it('PM project → Direktur → Finance (ADR 0021 before the Owner): Finance becomes Owner; no PM note', () => {
    const s = snap([step(1, 'pk-owner'), step(2, 'pk-finance')], { acknowledgeBy: 'scope_manager', acknowledgeRole: null, acknowledgerUserId: 5 })
    const p = planTrim(cand({ snapshot: s, decisions: [{ ...ack, actor: 5 }] }), new Map([[5, 'PM Uji']]))!
    expect(p).toMatchObject({ kind: 'trim', replaced: 2, pm: null, waiting: 'Persetujuan Direktur' })
    expect(p.newFlow).toBe('PM project (PM Uji) → Direktur → Owner')
  })

  it('a decided Finance level is never touched (only the undecided ones go)', () => {
    const s = snap([step(1, 'pk-finance'), step(2, 'pk-principal'), step(3, 'pk-finance')])
    const p = planTrim(cand({ snapshot: s, currentLevel: 2, decisions: [ack, approved(1, 40)] }))!
    expect(p).toMatchObject({ kind: 'trim', dropped: [3], newLevel: 2 })
    expect(p.newSnapshot!.steps).toEqual([step(1, 'pk-finance'), step(2, 'pk-principal')])
    expect(p.newSnapshot!.decisionRoles).toContain('pk-finance') // a Finance level remains in the snapshot
  })

  it('no undecided Finance level → null (not this migration\'s business)', () => {
    expect(planTrim(cand({ snapshot: snap([step(1, 'pk-owner'), step(2, 'pk-principal')]) }))).toBeNull()
    expect(planTrim(cand({ snapshot: snap([step(1, 'pk-finance'), step(2, 'pk-principal')]), currentLevel: 2, decisions: [ack, approved(1, 40)] }))).toBeNull()
    expect(planTrim(cand({ status: 'approved' }))).toBeNull()
    expect(planTrim(cand({ status: 'draft' }))).toBeNull()
    expect(planTrim(cand({ snapshot: null }))).toBeNull()
  })
})

describe('planTrim — case 2: waiting at a Finance level, no Owner level', () => {
  it('ADR 0013 shape after the Direktur\'s "Diketahui": L1 Finance → L1 Owner (owner kind = notify the Owners)', () => {
    const p = planTrim(cand({ snapshot: snap([step(1, 'pk-finance')], { decisionRoles: ['pk-owner', 'pk-finance'] }) }))!
    expect(p).toMatchObject({ kind: 'owner', replaced: 1, dropped: [], newStatus: 'pending_approval', newLevel: 1, waiting: 'Persetujuan Owner', pm: PM_LEGACY_DECIDED })
    expect(p.newSnapshot!.steps).toEqual([step(1, 'pk-principal')])
    expect(p.newSnapshot!.decisionRoles).toEqual(['pk-owner', 'pk-principal'])
  })

  it('two Finance levels (> Rp 10 juta): the first becomes Owner, the second is dropped', () => {
    const p = planTrim(cand({ snapshot: snap([step(1, 'pk-finance'), step(2, 'pk-finance')]) }))!
    expect(p).toMatchObject({ kind: 'owner', replaced: 1, dropped: [2] })
    expect(p.newSnapshot!.steps).toEqual([step(1, 'pk-principal')])
  })

  it('a waiting Finance level BEFORE the Owner level: dropped, the Owner level moves up and waits', () => {
    const p = planTrim(cand({ snapshot: snap([step(1, 'pk-finance'), step(2, 'pk-principal')]) }))!
    expect(p).toMatchObject({ kind: 'owner', replaced: null, dropped: [1], newLevel: 1, waiting: 'Persetujuan Owner' })
    expect(p.newSnapshot!.steps).toEqual([step(1, 'pk-principal')])
  })

  it('kept when the PT has no active Owner, or every Owner is a requester / creator / already decided (G1)', () => {
    const s = snap([step(1, 'pk-finance')])
    expect(planTrim(cand({ snapshot: s, owners: [] }))).toMatchObject({ kind: 'keep', reason: expect.stringContaining('tidak ada Owner aktif') })
    expect(planTrim(cand({ snapshot: s, owners: [STAFF] }))).toMatchObject({ kind: 'keep', reason: expect.stringContaining('G1') })
    expect(planTrim(cand({ snapshot: s, owners: [DIREKTUR] }))).toMatchObject({ kind: 'keep', reason: expect.stringContaining('G1') })
    expect(planTrim(cand({ snapshot: s, owners: [DIREKTUR, OWNER] }))).toMatchObject({ kind: 'owner' })
  })
})

describe('planTrim — case 3: Finance waiting after the Owner approved', () => {
  it('nothing undecided left → final ("Disetujui"), level = the Owner\'s (last) level', () => {
    const p = planTrim(cand({ currentLevel: 2, decisions: [ack, approved(1, OWNER)] }))!
    expect(p).toMatchObject({ kind: 'final', newStatus: 'approved', newLevel: 1, dropped: [2], waiting: 'Disetujui — antrian transfer Finance' })
    expect(p.newSnapshot!.steps).toEqual([step(1, 'pk-principal')])
  })

  it('kept when the last remaining level has no approval in this cycle', () => {
    expect(planTrim(cand({ currentLevel: 2, decisions: [ack] }))).toMatchObject({ kind: 'keep', reason: expect.stringContaining('periksa manual') })
  })
})

describe('planTrim — never touched', () => {
  it('G1 exceptions, a rejection, non-contiguous levels', () => {
    expect(planTrim(cand({ g1Exception: 'direktur_via_pm' }))).toMatchObject({ kind: 'keep', reason: expect.stringContaining('G1') })
    expect(planTrim(cand({ snapshot: snap([step(1, 'pk-principal'), step(2, 'pk-finance')], { selfApproval: 'direktur_via_pm_self' }) }))).toMatchObject({ kind: 'keep' })
    expect(planTrim(cand({ decisions: [ack, { position: 'approval', level: 1, decision: 'rejected', actor: OWNER }] }))).toMatchObject({ kind: 'keep' })
    expect(planTrim(cand({ snapshot: snap([step(1, 'pk-principal'), step(3, 'pk-finance')]) }))).toMatchObject({ kind: 'keep', reason: expect.stringContaining('berurutan') })
  })
})

describe('case 4 note, texts, stepper note, audit value, summary', () => {
  it('pmNoteOf: no note with a PM step or no "Diketahui"; decided vs still waiting', () => {
    expect(pmNoteOf(snap([], { acknowledgeBy: 'scope_manager', acknowledgeRole: null }), [])).toBeNull()
    expect(pmNoteOf(snap([], { acknowledge: 'none' }), [])).toBeNull()
    expect(pmNoteOf(snap([step(1, 'pk-owner')], { acknowledge: 'none' }), [approved(1, DIREKTUR)])).toBeNull()
    expect(pmNoteOf(snap([]), [ack])).toBe(PM_LEGACY_DECIDED)
    expect(pmNoteOf(snap([]), [])).toBe(PM_LEGACY_KEPT)
    expect(pmNoteOf(snap([step(1, 'pk-owner')], { acknowledgeRole: 'pk-principal' }), [approved(1, DIREKTUR)])).toBe(PM_LEGACY_DECIDED)
  })

  it('waitingText', () => {
    const s = snap([step(1, 'pk-owner'), step(2, 'pk-principal'), step(3, 'pk-finance', 7)])
    expect(waitingText(s, 'pending_approval', 1)).toBe('Persetujuan Direktur')
    expect(waitingText(s, 'pending_approval', 2)).toBe('Persetujuan Owner')
    expect(waitingText(s, 'pending_approval', 3, new Map([[7, 'Fin Uji']]))).toBe('Approval level 3 (Fin Uji)')
    expect(waitingText(s, 'pending_approval', 9)).toBe('tanpa level')
    expect(waitingText(s, 'pending_ack', 0)).toBe('Diketahui Direktur')
    expect(waitingText({ ...s, acknowledgeBy: 'scope_manager', acknowledgerUserId: 5 }, 'pending_ack', 0, new Map([[5, 'PM Uji']]))).toBe('Persetujuan PM (PM Uji)')
    expect(waitingText({ ...s, acknowledgeBy: 'user', acknowledgerUserId: 5 }, 'pending_ack', 0)).toBe('Diketahui user #5')
    expect(waitingText(s, 'approved', 2)).toBe('Disetujui — antrian transfer Finance')
  })

  it('trimNoteOf: the note (+ case 4) while the request carries the trimmed snapshot; null after a later change', () => {
    const p = planTrim(cand())!
    const row = (newValue: unknown): HistoryRow => ({ action: 'update', field: TRIM_FIELD, newValue }) as unknown as HistoryRow
    const hist = [row(trimValue(p, 'new'))]
    expect(trimNoteOf(hist, p.newSnapshot)).toBe(`${TRIM_NOTE} · ${PM_LEGACY_DECIDED}`)
    expect(trimNoteOf(hist, p.oldSnapshot)).toBeNull()
    expect(trimNoteOf([row({ ...trimValue(p, 'new'), kind: 'revert' })], p.newSnapshot)).toBeNull()
    expect(trimNoteOf([row({ ...trimValue(p, 'new'), migration: 'other' })], p.newSnapshot)).toBeNull()
    const noPm = planTrim(cand({ snapshot: snap([step(1, 'pk-principal'), step(2, 'pk-finance')], { acknowledge: 'none' }), decisions: [] }))!
    expect(trimNoteOf([row(trimValue(noPm, 'new'))], noPm.newSnapshot)).toBe(TRIM_NOTE)
  })

  it('trimValue: old = what down restores, new = tagged with the migration', () => {
    const p = planTrim(cand())!
    expect(trimValue(p, 'old')).toMatchObject({ status: 'pending_approval', currentLevel: 1, cycle: 1, snapshot: p.oldSnapshot })
    expect(trimValue(p, 'new', { fund: { available: 1 } })).toMatchObject({ migration: TRIM_MIGRATION, kind: 'trim', kasus: 'trim', decisions: 1, pm: PM_LEGACY_DECIDED, fund: { available: 1 } })
  })

  it('trimSummary lists every request with its outcome', () => {
    const plans = [planTrim(cand())!, planTrim(cand({ id: 39, docNo: null, g1Exception: 'direktur_via_pm' }))!, planTrim(cand({ id: 40, currentLevel: 2, decisions: [ack, approved(1, OWNER)] }))!]
    const t = trimSummary({ plans, skippedByReroute: [41, 42] }, new Map([[1, 'UJI']]))
    expect(t).toContain('dipotong 1, Finance → Owner 0, langsung Disetujui 1, tetap 1')
    expect(t).toContain('2 pengajuan lain dialihkan dulu')
    expect(t).toContain('[POTONG] UJI PB/UJI/2610/0004 (pending_approval L1) Direktur (Diketahui) → Owner → Finance  ⇒  Direktur (Diketahui) → Owner')
    expect(t).toContain('[TETAP] UJI #39')
    expect(t).toContain('[SETUJU]')
    expect(trimSummary({ plans: [], skippedByReroute: [] })).toContain(': 0')
  })
})
