import type { SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { groupDigits, previewQuery } from '@/admin/components/bank-preview-query'
import { collect, keyAction, step, swipeAction } from '@/admin/components/lightbox/gallery'
import { docHref } from '@/admin/doc-links'
import { draftOnly, isDraftForm, linesEditable, PLACEHOLDERS, submittedOnly, whenSet } from '@/collections/expense-request-form'
import { buildApprovalTimeline, g1ExceptionText, type TimelineInput, type TimelineSnapshot } from '@/domain/expense/approval-timeline'
import { decisionText } from '@/domain/expense/decision-texts'

/** DRMS 10/10 Phase A (web, expense request screens): pure logic of the new form / detail pieces. */

const PM_FLOW: TimelineSnapshot = {
  acknowledge: 'required',
  acknowledgeBy: 'scope_manager',
  acknowledgerUserId: 7,
  acknowledgeRole: null,
  decisionRoles: ['pk-owner', 'pk-finance'],
  steps: [{ level: 1, approverRole: 'pk-owner', approverUserId: null }],
}

const base = (over: Partial<TimelineInput> = {}): TimelineInput => ({
  type: 'advance',
  status: 'pending_ack',
  approvalCycle: 1,
  currentLevel: null,
  submittedAt: '2026-10-11T02:00:00.000Z',
  snapshot: PM_FLOW,
  approvals: [
    { cycle: 1, position: 'diajukan', level: 0, actorName: 'Sari', onBehalf: false, decision: 'signed', reason: null, decidedAt: '2026-10-11T02:00:00.000Z' },
    { cycle: 1, position: 'dibuat', level: 0, actorName: 'Sari', onBehalf: false, decision: 'signed', reason: null, decidedAt: '2026-10-11T02:00:00.000Z' },
  ],
  transfers: [],
  requesters: 'Sari',
  createdBy: 'Sari',
  names: { 7: 'Pak Budi' },
  ...over,
})

const states = (i: TimelineInput) => buildApprovalTimeline(i).map((s) => `${s.key}:${s.state}`)

describe('approval timeline (9c, mirrors APK turn_timeline.dart)', () => {
  it('PM project → Direktur → Transfer Finance, PM has the turn; planned approver named', () => {
    const steps = buildApprovalTimeline(base())
    expect(steps.map((s) => s.title)).toEqual(['Diajukan', 'Persetujuan PM', 'Persetujuan Direktur', 'Transfer Finance'])
    expect(states(base())).toEqual(['diajukan:done', 'diketahui:current', 'approval-1:pending', 'transfer:pending'])
    expect(steps[1]).toMatchObject({ role: 'PM project', planned: 'Pak Budi', actor: null })
    expect(steps[2]).toMatchObject({ role: 'Direktur', planned: 'Direktur' })
    expect(steps[0]).toMatchObject({ actor: 'Sari', note: null })
  })

  it('PM approved → Direktur current → approved → transfer current (queue) → done with TRF number', () => {
    const pm = { cycle: 1, position: 'diketahui', level: 0, actorName: 'Pak Budi', onBehalf: false, decision: 'acknowledged', reason: null, decidedAt: '2026-10-11T03:00:00.000Z' }
    expect(states(base({ status: 'pending_approval', currentLevel: 1, approvals: [...base().approvals, pm] }))).toEqual(['diajukan:done', 'diketahui:done', 'approval-1:current', 'transfer:pending'])
    const dir = { cycle: 1, position: 'approval', level: 1, actorName: 'Bu Dewi', onBehalf: false, decision: 'approved', reason: null, decidedAt: '2026-10-11T04:00:00.000Z' }
    const approved = base({ status: 'approved', currentLevel: 1, approvals: [...base().approvals, pm, dir] })
    expect(states(approved)).toEqual(['diajukan:done', 'diketahui:done', 'approval-1:done', 'transfer:current'])
    expect(buildApprovalTimeline(approved)[2]).toMatchObject({ actor: 'Bu Dewi', at: '2026-10-11T04:00:00.000Z' })
    const transferred = buildApprovalTimeline({ ...approved, status: 'transferred', transfers: [{ docNo: 'TRF/2610/0001', kind: 'advance', amount: 100, transferDate: '2026-10-12', status: 'posted' }] })
    expect(transferred[3]).toMatchObject({ state: 'done', at: '2026-10-12', note: 'TRF/2610/0001' })
  })

  it('rejected by the PM: the rejection with reason, later steps skipped', () => {
    const rej = { cycle: 1, position: 'diketahui', level: 0, actorName: 'Pak Budi', onBehalf: true, decision: 'rejected', reason: 'Tidak sesuai RAB', decidedAt: '2026-10-11T03:00:00.000Z' }
    const steps = buildApprovalTimeline(base({ status: 'rejected', approvals: [...base().approvals, rej] }))
    expect(steps.map((s) => s.state)).toEqual(['done', 'rejected', 'skipped', 'skipped'])
    expect(steps[1]).toMatchObject({ actor: 'Pak Budi (diwakili)', note: 'Tidak sesuai RAB' })
  })

  it('a skipped "Diketahui" (PM = requester) shows the G1-2 reason; older cycles are ignored', () => {
    const snap: TimelineSnapshot = { ...PM_FLOW, acknowledge: 'none', skipped: [{ position: 'diketahui', level: 0, role: null, userId: 7, reason: 'PM project adalah pemohon/pembuat' }] }
    const old = { cycle: 0, position: 'diketahui', level: 0, actorName: 'X', onBehalf: false, decision: 'rejected', reason: 'lama', decidedAt: null }
    const steps = buildApprovalTimeline(base({ status: 'pending_approval', currentLevel: 1, snapshot: snap, approvals: [...base().approvals, old] }))
    expect(steps[1]).toMatchObject({ key: 'diketahui', state: 'skipped', planned: 'Pak Budi' })
    expect(steps[1]!.note).toContain('PM project adalah pemohon/pembuat')
    expect(steps[2]!.state).toBe('current')
  })

  it('draft: requester has the turn, the rest waits (rule chosen at submit); creator ≠ requester noted', () => {
    const steps = buildApprovalTimeline(base({ status: 'draft', snapshot: null, approvals: [], submittedAt: null, createdBy: 'Admin Kantor' }))
    expect(steps.map((s) => s.state)).toEqual(['current', 'pending', 'pending', 'pending', 'pending']) // ADR 0026: … Direktur → Owner → Transfer
    expect(steps[0]!.note).toBe('belum diajukan · dibuat oleh Admin Kantor')
  })

  it('ADR 0013 snapshot: Direktur "Diketahui" then Finance approval; reimburse transfer waits for receipt verification', () => {
    const snap: TimelineSnapshot = { acknowledge: 'required', acknowledgeBy: 'role', acknowledgerUserId: null, acknowledgeRole: 'pk-owner', decisionRoles: ['pk-owner', 'pk-finance'], steps: [{ level: 1, approverRole: 'pk-finance', approverUserId: null }] }
    const steps = buildApprovalTimeline(base({ type: 'reimburse', status: 'approved', snapshot: snap }))
    expect(steps.map((s) => s.title)).toEqual(['Diajukan', 'Persetujuan Direktur (Diketahui)', 'Approval Finance', 'Transfer Finance'])
    expect(steps[3]).toMatchObject({ state: 'pending', note: 'setelah nota diverifikasi Finance' })
  })

  it('G1 exception as readable text, never the code', () => {
    expect(g1ExceptionText('direktur_via_pm')).toMatch(/^Pengajuan Direktur — diajukan oleh PM/)
    expect(g1ExceptionText('direktur_via_pm_self')).toMatch(/satu-satunya Direktur PT/)
    expect(g1ExceptionText(null)).toBeNull()
  })
})

describe('decision texts (9d, shared by inbox + detail bar)', () => {
  const t = (over: Partial<Parameters<typeof decisionText>[0]>) => decisionText({ step: 'acknowledge', docNo: 'PB/1', grandTotal: 1250000, decisionFlow: true, decisionBy: 'pm', finalStep: false, ...over })
  it('PM / Direktur / legacy / final step wording', () => {
    expect(t({})).toEqual({ label: 'Setujui', confirm: 'Setujui PB/1 sebesar Rp 1.250.000 sebagai PM project? Pengajuan diteruskan ke Direktur.' })
    expect(t({ decisionBy: 'direktur' }).confirm).toBe('Setujui PB/1 sebesar Rp 1.250.000 sebagai Direktur (Diketahui)?')
    expect(t({ decisionBy: 'other', decisionFlow: false })).toEqual({ label: 'Diketahui', confirm: 'Tandai PB/1 sudah diketahui?' })
    expect(t({ step: 'approve', decisionBy: 'direktur', finalStep: true }).confirm).toBe('Setujui PB/1 sebesar Rp 1.250.000 sebagai Direktur? Pengajuan diteruskan ke Finance untuk transfer.')
    expect(t({ step: 'approve', decisionBy: 'finance', finalStep: true }).confirm).toBe('Setujui PB/1 sebesar Rp 1.250.000?')
  })
})

describe('expense request form conditions + placeholders (8d, 8i, 9a)', () => {
  const ctx = { user: null } as never
  it('draft vs submitted', () => {
    expect(isDraftForm(undefined)).toBe(true)
    expect(isDraftForm({ status: 'draft' })).toBe(true)
    expect(isDraftForm({ status: 'pending_ack' })).toBe(false)
    expect(submittedOnly({ status: 'draft' }, {}, ctx)).toBe(false)
    expect(submittedOnly({ status: 'approved' }, {}, ctx)).toBe(true)
    expect(draftOnly({}, {}, ctx)).toBe(true)
    expect(linesEditable({ status: 'receipt_revision' })).toBe(true)
    expect(linesEditable({ status: 'pending_approval' })).toBe(false)
    expect(whenSet('docNo')({ docNo: '' }, {}, ctx)).toBe(false)
    expect(whenSet('docNo')({ docNo: 'PB/1' }, {}, ctx)).toBe(true)
    expect(whenSet('grandTotal')({ grandTotal: 0 }, {}, ctx)).toBe(true)
  })

  let config: SanitizedConfig
  beforeAll(async () => {
    process.env.PK_SKIP_ENV_CHECK = 'true'
    config = await (await import('@/payload.config')).default
  })
  type F = { name?: string; type: string; label?: unknown; fields?: F[]; access?: unknown; admin?: { placeholder?: unknown; hidden?: boolean; condition?: (d: unknown, s: unknown, o: unknown) => boolean; components?: { Field?: unknown } } }
  const flat = (fs: F[]): F[] => fs.flatMap((f) => [f, ...(f.fields ? flat(f.fields) : [])])
  const fields = () => flat(config.collections.find((c) => c.slug === 'expense-requests')!.fields as F[])
  const byName = (n: string) => fields().find((f) => f.name === n)!

  it('every editable select / relationship of the request form has its own placeholder (no "Pilih nilai")', () => {
    const editable = fields().filter((f) => (f.type === 'select' || f.type === 'relationship') && !f.admin?.hidden && !(f.admin as { readOnly?: boolean } | undefined)?.readOnly && f.name !== 'company')
    // D2: the requester no longer picks a cost center (read-only legacy field); D4: the line's RAP item
    // ADR 0027: Jenis penerima, Vendor, Rekening vendor; ADR 0028: PT penerima
    expect(editable.map((f) => f.name).sort()).toEqual(['bankAccount', 'category', 'payeeCompany', 'payeeType', 'project', 'rapItem', 'requesters', 'type', 'uom', 'urgencyLevel', 'vehicle', 'vendor', 'vendorBankAccount'])
    for (const f of editable) expect(f.admin?.placeholder, f.name).toBe(PLACEHOLDERS[f.name as keyof typeof PLACEHOLDERS])
    expect((config.i18n.translations as { id?: { general?: { selectValue?: string } } }).id?.general?.selectValue).toBe('Pilih…')
  })

  it('create/draft hides system fields; dates use the picker, money the Rupiah input; APK labels', () => {
    const draft = { status: 'draft' }
    for (const n of ['approvalRule', 'submittedAt', 'resubmitOf', 'cancelReason', 'rejectReason', 'approvedAmount', 'transferredTotal', 'verifiedReceiptsTotal', 'docNo']) {
      const f = byName(n)
      expect(f.admin?.condition?.(draft, {}, { user: { id: 1, roles: ['pk-admin'] } }), n).toBe(false)
    }
    // DRMS 13/10 Persetujuan #6: the approval snapshot JSON is not on the page (stepper + "Log perubahan" instead)
    for (const n of ['g1Exception', 'bankSnapshot', 'currentLevel', 'source', 'approvalSnapshot']) expect(byName(n).admin?.hidden, n).toBe(true)
    // status: no condition (schema drift, see below) — the sidebar component renders nothing on a Draft form
    expect(byName('status').admin?.condition).toBeUndefined()
    expect(byName('status').admin?.components?.Field).toBe('@/admin/components/RequestStatusField#RequestStatusField')
    expect(byName('neededDate').admin?.components?.Field).toBe('@/admin/components/BusinessDateField#BusinessDateField')
    expect(byName('unitPrice').admin?.components?.Field).toBe('@/admin/components/RupiahNumberField#RupiahNumberField')
    expect(byName('total').admin?.components?.Field).toBe('@/admin/components/RupiahNumberField#RupiahNumberField')
    expect(byName('qty').admin?.components?.Field).toBeUndefined()
    expect(byName('requesters').label).toBe('Pemohon')
    expect(byName('lines').admin?.condition?.({ status: 'pending_approval' }, {}, {})).toBe(false)
    expect(byName('bankAccount').admin?.condition?.({ status: 'pending_ack' }, {}, {})).toBe(false)
    // input order of the APK draft editor (DRMS 13/10 #10: the grand total is the lines table footer, no preview field)
    const order = (config.collections.find((c) => c.slug === 'expense-requests')!.fields as F[]).filter((f) => f.name && ['type', 'title', 'project', 'costCenter', 'neededDate', 'urgencyLevel', 'requesters', 'bankAccount', 'notes', 'attachments', 'lines', 'linesTotalPreview'].includes(f.name)).map((f) => f.name)
    expect(order).toEqual(['type', 'title', 'project', 'costCenter', 'neededDate', 'urgencyLevel', 'requesters', 'bankAccount', 'notes', 'attachments', 'lines'])
  })

  it('no required column has admin.condition (the Postgres adapter would drop its NOT NULL → schema drift)', () => {
    const misses: string[] = []
    for (const c of config.collections) {
      for (const f of flat(c.fields as F[])) {
        if ((f as { required?: boolean }).required && f.admin?.condition && f.type !== 'ui') misses.push(`${c.slug}.${f.name}`)
      }
    }
    expect(misses).toEqual([])
  })

  it('every business date field of the app uses the date picker', () => {
    const misses: string[] = []
    for (const c of config.collections) {
      for (const f of flat(c.fields as F[])) {
        const v = (f as { validate?: { toString(): string } }).validate?.toString() ?? ''
        if (f.type === 'text' && /isBusinessDate|YYYY-MM-DD/.test(v) && f.admin?.components?.Field !== '@/admin/components/BusinessDateField#BusinessDateField') misses.push(`${c.slug}.${f.name}`)
      }
    }
    expect(misses).toEqual([])
  })
})

describe('bank preview query (8e), totals preview, doc links (12b), lightbox helpers (12c)', () => {
  it('previewQuery: picker value while draft, snapshot after submit', () => {
    expect(previewQuery({ requestId: null, accountId: null, draft: true })).toBeNull()
    expect(previewQuery({ requestId: null, accountId: 5, draft: true })).toBe('/api/v1/bank-account-preview?account=5')
    expect(previewQuery({ requestId: 9, accountId: 5, draft: true, reveal: true })).toBe('/api/v1/bank-account-preview?request=9&account=5&reveal=1')
    expect(previewQuery({ requestId: 9, accountId: 5, draft: false })).toBe('/api/v1/bank-account-preview?request=9')
    expect(previewQuery({ requestId: null, accountId: 5, draft: false })).toBeNull()
    expect(groupDigits('1234567890')).toBe('1234 5678 90')
  })

  it('docHref maps numbered documents to their detail', () => {
    expect(docHref('transfer', '12')).toBe('/admin/collections/transfers/12')
    expect(docHref('settlement', 3)).toBe('/admin/collections/settlements/3')
    expect(docHref('progress_report', '4')).toBe('/admin/progress/laporan/4')
    expect(docHref('cash_entry', 'x1')).toBeNull()
    expect(docHref('user', '1')).toBeNull()
    expect(docHref(null, '1')).toBeNull()
  })

  it('lightbox navigation wraps; keys and swipes map to actions', () => {
    expect(step(0, 3, -1)).toBe(2)
    expect(step(2, 3, 1)).toBe(0)
    expect(step(0, 0, 1)).toBe(0)
    expect(keyAction('ArrowRight')).toBe('next')
    expect(keyAction('ArrowLeft')).toBe('prev')
    expect(keyAction('z')).toBe('zoom')
    expect(keyAction('Escape')).toBeNull()
    expect(swipeAction(-80, 10)).toBe('next')
    expect(swipeAction(80, 10)).toBe('prev')
    expect(swipeAction(30, 0)).toBeNull()
    expect(swipeAction(60, 80)).toBeNull()
    expect(collect([{ href: 'a', title: 'A' }, { href: 'b', title: 'B' }], 'b')).toEqual({ items: [{ src: 'a', title: 'A' }, { src: 'b', title: 'B' }], index: 1 })
  })
})
