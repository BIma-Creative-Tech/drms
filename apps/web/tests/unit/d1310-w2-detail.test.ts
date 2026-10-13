import type { SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Role } from '@/access/roles'
import { actionBarProps } from '@/admin/components/request/action-bar'
import { requestEditGate } from '@/collections/expense-request-form'
import type { TimelineSnapshot } from '@/domain/expense/approval-timeline'
import type { RequestDoc } from '@/domain/expense/common'
import { DIREKTUR_NO_APPROVAL } from '@/domain/expense/decision'
import { duplicateDraftInput } from '@/domain/expense/duplicate'
import { buildRequestStepper, isCurrentStep, WITHDRAWN_NOTE, type StepperInput } from '@/domain/expense/request-stepper'
import type { HistoryRow } from '@/domain/history'
import { DUPLICATED_FROM_FIELD, historyEntry } from '@/domain/history-format'

/** DRMS 13/10 Wave 2 — expense-request (Persetujuan) detail page: stepper, edit gate, duplicate, change log, config. */

let config: SanitizedConfig
beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

// ADR 0021 default: PM project ("Diketahui" = Persetujuan PM) → Direktur level 1
const PM_DIREKTUR: TimelineSnapshot = {
  acknowledge: 'required',
  acknowledgeBy: 'scope_manager',
  acknowledgerUserId: 7,
  acknowledgeRole: null,
  decisionRoles: ['pk-owner', 'pk-finance'] as Role[],
  skipped: [],
  steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: null }],
}
const signed = (cycle = 1) => [{ cycle, position: 'diajukan', level: 0, actorName: 'Sari', onBehalf: false, decision: 'signed', reason: null, decidedAt: '2026-10-12T01:00:00.000Z' }]
const pmOk = (cycle = 1) => ({ cycle, position: 'diketahui', level: 0, actorName: 'PM Uji', onBehalf: false, decision: 'acknowledged', reason: null, decidedAt: '2026-10-12T02:00:00.000Z' })
const dirOk = (cycle = 1) => ({ cycle, position: 'approval', level: 1, actorName: 'Direktur Uji', onBehalf: false, decision: 'approved', reason: 'ok', decidedAt: '2026-10-12T03:00:00.000Z' })
const trf = (kind = 'advance', status = 'posted') => ({ docNo: 'TRF/DRMS/2610/1', kind, amount: 100000, transferDate: '2026-10-12', status })

const input = (over: Partial<StepperInput> = {}): StepperInput => ({
  type: 'advance',
  status: 'pending_ack',
  approvalCycle: 1,
  currentLevel: null,
  submittedAt: '2026-10-12T01:00:00.000Z',
  snapshot: PM_DIREKTUR,
  approvals: signed(),
  transfers: [],
  requesters: 'Sari',
  createdBy: 'Sari',
  names: { 7: 'PM Uji' },
  settlement: null,
  ...over,
})
const states = (i: StepperInput) => buildRequestStepper(i).steps.map((s) => `${s.key}:${s.state}`)
const current = (i: StepperInput) => buildRequestStepper(i).currentKey

describe('Persetujuan #3: one stepper Diajukan → approvals → Transfer → LPJ → Selesai', () => {
  it('Pengajuan Baru, PM → Direktur, the whole happy path', () => {
    expect(states(input())).toEqual(['diajukan:done', 'diketahui:current', 'approval-1:pending', 'transfer:pending', 'lpj:pending', 'settlement:pending', 'end:pending'])
    expect(current(input({ status: 'pending_approval', currentLevel: 1, approvals: [...signed(), pmOk()] }))).toBe('approval-1')
    expect(current(input({ status: 'approved', approvals: [...signed(), pmOk(), dirOk()] }))).toBe('transfer')
    const transferred = input({ status: 'transferred', approvals: [...signed(), pmOk(), dirOk()], transfers: [trf()] })
    expect(states(transferred)).toEqual(['diajukan:done', 'diketahui:done', 'approval-1:done', 'transfer:done', 'lpj:current', 'settlement:pending', 'end:pending'])
    // actor, time and decision note per position
    const s = buildRequestStepper(transferred).steps
    expect(s.find((x) => x.key === 'approval-1')).toMatchObject({ title: 'Persetujuan Direktur', actor: 'Direktur Uji', at: '2026-10-12T03:00:00.000Z', note: 'ok' })
    expect(s.find((x) => x.key === 'diketahui')).toMatchObject({ title: 'Persetujuan PM', actor: 'PM Uji' })
    expect(current(input({ status: 'receipts_complete', transfers: [trf()] }))).toBe('lpj')
    expect(current(input({ status: 'lpj_submitted', transfers: [trf()] }))).toBe('lpj')
    expect(current(input({ status: 'lpj_verified', transfers: [trf()] }))).toBe('settlement')
    const done = buildRequestStepper(input({ status: 'completed', approvals: [...signed(), pmOk(), dirOk()], transfers: [trf()], settlement: { docNo: 'LPJ/1', status: 'settled', statusLabel: 'Disettle', settlementType: 'refund', submittedAt: null, verifiedAt: '2026-10-13', settledAt: '2026-10-13T04:00:00.000Z' } }))
    expect(done.currentKey).toBeNull()
    expect(done.steps.every((x) => x.state === 'done')).toBe(true)
    expect(done.steps.find((x) => x.key === 'settlement')?.note).toBe('sisa dana dikembalikan (kas masuk)')
  })

  it('LPJ revision is a returned step ("Dikembalikan"), highlighted as the current one', () => {
    const st = buildRequestStepper(input({ status: 'lpj_revision', transfers: [trf()], settlement: { docNo: 'LPJ/1', status: 'revision', statusLabel: 'Revisi', settlementType: null, submittedAt: null, verifiedAt: null, settledAt: null, financeNotes: 'nota kurang' } }))
    const lpj = st.steps.find((x) => x.key === 'lpj')!
    expect(lpj.state).toBe('revision')
    expect(isCurrentStep(lpj)).toBe(true)
    expect(lpj.note).toBe('LPJ/1 · LPJ dikembalikan untuk revisi: nota kurang')
  })

  it('LPJ shortfall re-approval (ADR 0019): its own step before the settlement', () => {
    const lpj = (status: string) => ({ docNo: 'LPJ/1', status: 'verified', statusLabel: 'Terverifikasi', settlementType: 'shortfall', submittedAt: null, verifiedAt: null, settledAt: null, shortfallApproval: { status, statusLabel: status, decisions: [{ actorName: 'Direktur Uji', decision: 'approved', reason: null, decidedAt: '2026-10-13T01:00:00.000Z' }] } })
    expect(states(input({ status: 'lpj_verified', transfers: [trf()], settlement: lpj('pending_ack') })).slice(-4)).toEqual(['lpj:done', 'shortfall:current', 'settlement:pending', 'end:pending'])
    const ok = buildRequestStepper(input({ status: 'lpj_verified', transfers: [trf()], settlement: lpj('approved') }))
    expect(ok.steps.find((x) => x.key === 'shortfall')).toMatchObject({ state: 'done', actor: 'Direktur Uji' })
    expect(ok.currentKey).toBe('settlement')
    expect(buildRequestStepper(input({ status: 'lpj_verified', transfers: [trf()], settlement: lpj('rejected') })).steps.find((x) => x.key === 'shortfall')?.state).toBe('rejected')
  })

  it('Reimburse: Verifikasi nota (Finance) before the transfer; Revisi Nota returned; confirmation before Selesai', () => {
    const r = (over: Partial<StepperInput>) => input({ type: 'reimburse', approvals: [...signed(), pmOk(), dirOk()], ...over })
    expect(states(r({ status: 'approved' }))).toEqual(['diajukan:done', 'diketahui:done', 'approval-1:done', 'verify-receipts:current', 'transfer:pending', 'end:pending'])
    expect(states(r({ status: 'receipt_revision' }))).toContain('verify-receipts:revision')
    expect(current(r({ status: 'receipts_verified' }))).toBe('transfer')
    const t = buildRequestStepper(r({ status: 'transferred', transfers: [trf('reimburse')] }))
    expect(t.currentKey).toBe('end')
    expect(t.steps.find((x) => x.key === 'end')?.note).toContain('mengonfirmasi')
    expect(t.steps.some((x) => x.key === 'lpj')).toBe(false)
  })

  it('zero-step Direktur-own request (ADR 0024): "Persetujuan" skipped by policy, straight to the transfer', () => {
    const snap: TimelineSnapshot = { acknowledge: 'none', acknowledgeBy: 'role', acknowledgerUserId: null, acknowledgeRole: null, decisionRoles: ['pk-owner', 'pk-finance'] as Role[], skipped: [], selfApproval: DIREKTUR_NO_APPROVAL, steps: [] }
    expect(states(input({ status: 'approved', snapshot: snap, currentLevel: 0 }))).toEqual(['diajukan:done', 'no-approval:skipped', 'transfer:current', 'lpj:pending', 'settlement:pending', 'end:pending'])
  })

  it('Finance-filed, Direktur-only rule (no PM position) and a skipped PM (requester is the PM)', () => {
    const direkturOnly: TimelineSnapshot = { ...PM_DIREKTUR, acknowledge: 'none', acknowledgeBy: 'role', acknowledgerUserId: null }
    expect(states(input({ status: 'pending_approval', currentLevel: 1, snapshot: direkturOnly }))).toEqual(['diajukan:done', 'approval-1:current', 'transfer:pending', 'lpj:pending', 'settlement:pending', 'end:pending'])
    const pmSkipped: TimelineSnapshot = { ...PM_DIREKTUR, acknowledge: 'none', skipped: [{ position: 'diketahui', level: 0, role: 'pk-pm', userId: 7, reason: 'pemohon' } as never] }
    const s = buildRequestStepper(input({ status: 'pending_approval', currentLevel: 1, snapshot: pmSkipped })).steps
    expect(s.find((x) => x.key === 'diketahui')).toMatchObject({ state: 'skipped' })
    expect(s.find((x) => x.key === 'approval-1')?.state).toBe('current')
  })

  it('rejected / cancelled: the deciding step is rejected, later ones skipped, the end names the outcome + reason', () => {
    const rej = buildRequestStepper(input({ status: 'rejected', approvals: [...signed(), { ...pmOk(), decision: 'rejected', reason: 'tidak perlu' }], rejectReason: 'tidak perlu' }))
    expect(rej.steps.map((x) => `${x.key}:${x.state}`)).toEqual(['diajukan:done', 'diketahui:rejected', 'approval-1:skipped', 'transfer:skipped', 'lpj:skipped', 'settlement:skipped', 'end:rejected'])
    expect(rej.steps.at(-1)).toMatchObject({ title: 'Ditolak', note: 'Alasan: tidak perlu' })
    expect(rej.currentKey).toBeNull()
    const cancelled = buildRequestStepper(input({ status: 'cancelled', cancelReason: 'batal proyek' }))
    expect(cancelled.steps.at(-1)).toMatchObject({ title: 'Dibatalkan', state: 'rejected', note: 'Alasan: batal proyek' })
  })

  it('Draft: never sent → "Diajukan" current; withdrawn (cycle > 0) → returned with a note; later cycles noted', () => {
    const fresh = buildRequestStepper(input({ status: 'draft', approvalCycle: 0, snapshot: null, approvals: [], submittedAt: null }))
    expect(fresh.currentKey).toBe('diajukan')
    expect(fresh.steps.find((x) => x.key === 'diajukan')?.note).toBe('belum diajukan')
    const withdrawn = buildRequestStepper(input({ status: 'draft', approvalCycle: 1 }))
    expect(withdrawn.steps[0]).toMatchObject({ key: 'diajukan', state: 'revision', note: WITHDRAWN_NOTE })
    expect(buildRequestStepper(input({ approvalCycle: 2, approvals: signed(2) })).cycleNote).toContain('Siklus persetujuan ke-2')
    expect(fresh.cycleNote).toBeNull()
  })
})

describe('Persetujuan #7: Edit → Simpan gate', () => {
  it('new = create (edit mode); existing = editable only with update permission AND Draft / Revisi Nota', () => {
    expect(requestEditGate({ status: 'draft' })).toBe('create')
    expect(requestEditGate({ id: '', status: 'draft', hasSavePermission: true })).toBe('create')
    expect(requestEditGate({ id: 5, status: 'draft', hasSavePermission: true })).toBe('editable')
    expect(requestEditGate({ id: 5, status: 'receipt_revision', hasSavePermission: true })).toBe('editable')
    expect(requestEditGate({ id: 5, status: 'draft', hasSavePermission: false })).toBe('locked') // someone else's draft
    for (const status of ['pending_ack', 'pending_approval', 'approved', 'transferred', 'completed', 'rejected', 'cancelled']) {
      expect(requestEditGate({ id: 5, status, hasSavePermission: true }), status).toBe('locked')
    }
  })
})

describe('Persetujuan #12: duplicate = a clean Draft', () => {
  const src = {
    id: 9,
    docNo: 'PB/DRMS/2610/7',
    type: 'reimburse',
    status: 'completed',
    title: 'Solar genset',
    project: { id: 3 },
    costCenter: 4,
    company: 1,
    neededDate: '2026-10-01',
    urgencyLevel: 2,
    notes: 'catatan',
    requesters: [{ id: 11 }, 12],
    createdBy: 5,
    bankAccount: 21,
    bankSnapshot: { bankName: 'BCA', accountNo: '123', accountHolder: 'Sari' },
    lines: [{ id: 'l1', description: 'Solar', qty: 2, uom: 1, unitPrice: 50000, total: 100000, receiptAmount: 99000, notes: 'n', category: { id: 8 }, vehicle: 6, rapItem: 30 }],
    grandTotal: 100000,
    approvedAmount: 100000,
    transferredTotal: 100000,
    verifiedReceiptsTotal: 99000,
    approvalRule: 2,
    approvalSnapshot: { steps: [] },
    approvalCycle: 1,
    currentLevel: 1,
    submittedAt: '2026-10-01T00:00:00.000Z',
    resubmitOf: 1,
    rejectReason: 'x',
    cancelReason: 'y',
    g1Exception: 'direktur_no_approval',
    clientUuid: 'u-1',
    syncRev: 4,
    attachments: [40, 41],
    createdAt: '2026-10-01T00:00:00.000Z',
  } as unknown as RequestDoc

  it('copies PT scope, title, urgency, notes, requesters, account and lines — nothing of the workflow', () => {
    const d = duplicateDraftInput(src)
    expect(d).toEqual({
      type: 'reimburse',
      title: 'Solar genset',
      projectId: 3,
      urgencyLevelId: 2,
      notes: 'catatan',
      requesterIds: [11, 12],
      bankAccountId: 21,
      lines: [{ description: 'Solar', qty: 2, uomId: 1, unitPrice: 50000, total: 100000, receiptAmount: null, notes: 'n', categoryId: 8, vehicleId: 6, rapItemId: 30 }],
    })
    // no number, status, approvals, snapshot, transfers, receipts' amounts, attachments, offline key, needed date, legacy cost center
    for (const k of ['docNo', 'status', 'approvalSnapshot', 'approvalRule', 'transferredTotal', 'attachmentIds', 'clientUuid', 'neededDate', 'costCenterId', 'resubmitOf']) expect(d, k).not.toHaveProperty(k)
  })

  it('Payload duplicate is off (menu + REST route); the action bar + duplicate endpoint replace it', () => {
    const er = config.collections.find((c) => c.slug === 'expense-requests')!
    expect(er.disableDuplicate).toBe(true)
    expect(er.endpoints === false ? [] : (er.endpoints ?? []).map((e) => e.path)).not.toContain('/:id/duplicate')
    const edit = er.admin.components?.edit as { beforeDocumentControls?: unknown[]; SaveButton?: unknown }
    expect(edit.beforeDocumentControls).toEqual(['@/admin/components/request/RequestActionBar#RequestActionBar'])
    expect(edit.SaveButton).toBe('@/admin/components/RequestSaveButton#RequestSaveButton')
  })
})

describe('Persetujuan #5/#6: page structure', () => {
  type F = { name?: string; type: string; admin?: { position?: string; hidden?: boolean; condition?: (d: unknown, s: unknown, c: unknown) => boolean; components?: { Field?: unknown } } }
  const fields = () => config.collections.find((c) => c.slug === 'expense-requests')!.fields as F[]
  it('right column = the stepper only; no PDF / totals / approval rule / snapshot fields on the page', () => {
    expect(fields().some((f) => f.name === 'pdfLinks')).toBe(false)
    const sidebar = fields().filter((f) => f.admin?.position === 'sidebar')
    const ctx = { user: { id: 1, roles: ['pk-admin', 'pk-finance'] } }
    const shown = sidebar.filter((f) => !f.admin?.hidden && (f.admin?.condition?.({ status: 'approved', approvedAmount: 1, transferredTotal: 1, verifiedReceiptsTotal: 1, createdBy: 1, requestDate: '2026-10-01' }, {}, ctx) ?? true))
    // `status` renders nothing (RequestStatusField); the stepper is the only visible sidebar item
    expect(shown.map((f) => f.name)).toEqual(['requestStepper', 'status'])
    expect(sidebar.find((f) => f.name === 'requestStepper')?.admin?.components?.Field).toBe('@/admin/components/request/StepperField#StepperField')
    expect(fields().find((f) => f.name === 'approvalSnapshot')?.admin?.hidden).toBe(true)
  })

  it('action bar: decision, Finance flow link, Cetak (menu for office), Duplikat', () => {
    const d = (over: Record<string, unknown> = {}) => ({ id: 4, type: 'advance', docNo: 'PB/1', allowedActions: [] as string[], ...over }) as never
    const decision = { step: 'approve' as const, label: 'Setujui', confirm: 'Setujui?', canReject: true, stepLabel: 'Persetujuan Direktur' }
    const staff = actionBarProps({ d: d(), office: false, canDuplicate: true, decision: null })
    expect(staff).toEqual({ id: 4, decision: null, flowLinks: [], pdfs: [{ href: '/api/v1/expense-requests/4/pdf', label: 'PDF Pengajuan Biaya' }], canDuplicate: true })
    const fin = actionBarProps({ d: d({ allowedActions: ['transfer'] }), office: true, canDuplicate: false, decision })
    expect(fin.pdfs.map((p) => p.href)).toEqual(['/api/v1/expense-requests/4/pdf', '/api/v1/expense-requests/4/pdf?variant=internal'])
    expect(fin.flowLinks).toEqual([{ href: '/admin/antrian-transfer', label: 'Catat transfer', testId: 'transfer' }])
    expect(fin).toMatchObject({ decision, canDuplicate: false })
    expect(actionBarProps({ d: d({ type: 'reimburse', allowedActions: ['verify_receipts'] }), office: true, canDuplicate: true, decision: null }).flowLinks[0]).toMatchObject({ label: 'Verifikasi nota', testId: 'receipt-review' })
    // a Draft has no number → nothing to print
    expect(actionBarProps({ d: d({ docNo: null }), office: true, canDuplicate: true, decision: null }).pdfs).toEqual([])
  })

  it('"Log perubahan" rows: labels, status labels, the duplicate source, line fields', () => {
    const row = (over: Partial<HistoryRow>): HistoryRow => ({ id: 1, serverTime: '2026-10-13T01:15:00.000Z', docType: 'expense_request', docId: '4', docNo: 'PB/1', action: 'update', field: null, lineNo: null, oldValue: null, newValue: null, statusFrom: null, statusTo: null, reason: null, userId: 5, userName: 'Sari', userRoles: null, source: 'web', appVersion: null, deviceId: null, ...over })
    expect(historyEntry(row({ action: 'status_change', statusFrom: 'draft', statusTo: 'pending_ack' }), 'Asia/Makassar')).toMatchObject({ at: '13/10/2026 09:15 WITA', who: 'Sari', action: 'status', change: 'Draft → Menunggu persetujuan PM', doc: 'Pengajuan' })
    expect(historyEntry(row({ action: 'create', field: DUPLICATED_FROM_FIELD, newValue: { id: 9, docNo: 'PB/DRMS/2610/7' } }), 'Asia/Makassar')).toMatchObject({ field: 'Disalin dari', change: 'PB/DRMS/2610/7' })
    expect(historyEntry(row({ field: 'lines.total', lineNo: 2, oldValue: 1000, newValue: 2000, reason: 'nota' }), 'Asia/Makassar')).toMatchObject({ field: 'Rincian item · Total (baris 2)', change: '1000 → 2000', reason: 'nota' })
    expect(historyEntry(row({ docType: 'transfer', docNo: 'TRF/1', action: 'void', userName: null, userId: null, source: 'job' }), 'Asia/Makassar')).toMatchObject({ doc: 'Transfer TRF/1', who: 'sistem (job)', action: 'void' })
  })
})
