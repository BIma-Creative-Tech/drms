import { describe, expect, it } from 'vitest'

import { isLocked, lockDate, periodEnd } from '@/domain/cash/periods'
import { computeFlags, normalizeReceiptNo, normalizeVendor, type FlagInput } from '@/domain/expense/flags'
import { diffLines } from '@/domain/expense/line-audit'
import { computeLineTotal, displayUnitPrice, grandTotal, lineNeedsCompletion, normalizeLines, receiptMismatch, unlockLine, validateLines } from '@/domain/expense/lines'
import { budgetImpact, buildSnapshot, matchesAcknowledger, matchesStep, selectRule, stepsError, type RuleInput } from '@/domain/expense/rules'
import { allowedActions, assertTransition, cascadeCancellable, FINANCE_SELF_PROCESSED, mayPerform, targets, TransitionError, type ActorContext } from '@/domain/expense/state'
import { addDays, isBusinessDate, receiptsEditable, statusLabel } from '@/domain/expense/types'
import { formatRupiah } from '@/lib/money'
import { FORM_228 } from '@/seed/form-fixture'

describe('state machines (architecture §5.1 Pengajuan Baru / §5.2 Reimburse, G6)', () => {
  it('shared approval path', () => {
    for (const t of ['advance', 'reimburse'] as const) {
      expect(targets(t, 'draft', 'submit').sort()).toEqual(['pending_ack', 'pending_approval'])
      expect(targets(t, 'pending_ack', 'acknowledge')).toEqual(['pending_approval'])
      expect(targets(t, 'pending_approval', 'approve').sort()).toEqual(['approved', 'pending_approval'])
      expect(targets(t, 'pending_approval', 'reject')).toEqual(['rejected'])
      expect(targets(t, 'pending_ack', 'withdraw')).toEqual(['draft'])
    }
  })

  it('Pengajuan Baru: approved → transferred ⇄ approved (void); no receipt verification step', () => {
    expect(targets('advance', 'approved', 'transfer')).toEqual(['transferred'])
    expect(targets('advance', 'transferred', 'transfer_void')).toEqual(['approved'])
    expect(targets('advance', 'approved', 'verify_receipts')).toEqual([])
    expect(targets('advance', 'transferred', 'complete')).toEqual([]) // via LPJ/settlement (F2b)
  })

  it('Reimburse: approved → receipts_verified → transferred → completed, revision branch', () => {
    expect(targets('reimburse', 'approved', 'transfer')).toEqual([]) // needs "Nota Terverifikasi" first
    expect(targets('reimburse', 'approved', 'verify_receipts')).toEqual(['receipts_verified'])
    expect(targets('reimburse', 'receipts_verified', 'transfer')).toEqual(['transferred'])
    expect(targets('reimburse', 'transferred', 'transfer_void')).toEqual(['receipts_verified'])
    expect(targets('reimburse', 'transferred', 'complete')).toEqual(['completed'])
    expect(targets('reimburse', 'approved', 'receipt_reject')).toEqual(['receipt_revision'])
    expect(targets('reimburse', 'receipt_revision', 'receipts_resubmit').sort()).toEqual(['approved', 'pending_ack', 'pending_approval']) // E1: re-approval back to Diketahui (Direktur)
  })

  it('terminal states allow nothing; invalid transitions throw', () => {
    for (const s of ['rejected', 'cancelled', 'completed'] as const) {
      for (const a of ['submit', 'approve', 'cancel', 'transfer', 'withdraw'] as const) expect(targets('reimburse', s, a)).toEqual([])
    }
    expect(() => assertTransition('advance', 'draft', 'approve', 'approved')).toThrow(TransitionError)
    expect(() => assertTransition('advance', 'approved', 'transfer', 'transferred')).not.toThrow()
  })

  const ctx = (over: Partial<ActorContext>): ActorContext => ({
    type: 'advance',
    status: 'draft',
    roles: ['pk-staff'],
    isCreator: false,
    isRequester: false,
    hasDecision: false,
    isAcknowledger: false,
    matchesCurrentStep: false,
    alreadyDecided: false,
    ...over,
  })

  it('actor guards: own edit/submit + "Hapus draft" (D2410: no cancel on a Draft); strangers nothing', () => {
    expect(allowedActions(ctx({ isCreator: true }))).toEqual(['edit', 'submit', 'delete_draft'])
    expect(allowedActions(ctx({ isRequester: true }))).toContain('delete_draft')
    expect(allowedActions(ctx({}))).toEqual([])
    // D2410 "Hapus draft": only an own Draft without a decision; never in the flow, never for others
    expect(allowedActions(ctx({ isCreator: true, hasDecision: true }))).not.toContain('delete_draft')
    expect(allowedActions(ctx({ isCreator: true, status: 'pending_approval' }))).not.toContain('delete_draft')
    expect(allowedActions(ctx({ roles: ['pk-finance'] }))).not.toContain('delete_draft')
    expect(mayPerform(ctx({ roles: ['pk-finance'] }), 'delete_draft')).toBe(false)
    expect(mayPerform(ctx({ isRequester: true }), 'delete_draft')).toBe(true)
  })

  it('D2410 (point 13): "Batalkan" only at the Finance stage, only Finance / Direktur — also on their own request', () => {
    // no cancel row before the Finance stage (the project-cancel cascade has its own system list)
    for (const t of ['advance', 'reimburse'] as const) {
      for (const s of ['draft', 'pending_ack', 'pending_approval'] as const) {
        expect(targets(t, s, 'cancel')).toEqual([])
        expect(cascadeCancellable(t, s)).toBe(true)
        for (const roles of [['pk-staff'], ['pk-finance'], ['pk-owner'], ['pk-admin']] as const) {
          expect(allowedActions(ctx({ type: t, status: s, roles: [...roles], isCreator: true, isRequester: true }))).not.toContain('cancel')
          expect(allowedActions(ctx({ type: t, status: s, roles: [...roles] }))).not.toContain('cancel')
        }
      }
    }
    // Finance stage: Pengajuan Baru (karyawan, vendor, PT grup) "Disetujui"; Reimburse approved / receipts_verified / receipt_revision
    for (const payeeType of ['karyawan', 'vendor', 'pt_grup'] as const) {
      expect(targets('advance', 'approved', 'cancel', payeeType)).toEqual(['cancelled'])
      expect(targets('advance', payeeType === 'karyawan' ? 'transferred' : 'completed', 'cancel', payeeType)).toEqual([])
    }
    for (const s of ['approved', 'receipts_verified', 'receipt_revision'] as const) expect(targets('reimburse', s, 'cancel')).toEqual(['cancelled'])
    for (const s of ['transferred', 'receipts_complete', 'lpj_submitted', 'lpj_verified'] as const) {
      expect(targets('advance', s, 'cancel')).toEqual([])
      expect(cascadeCancellable('advance', s)).toBe(false)
    }
    // office roles only — the requester himself may not, a Finance / Direktur requester may (one action, reason in the service)
    expect(allowedActions(ctx({ status: 'approved', isRequester: true }))).not.toContain('cancel')
    expect(allowedActions(ctx({ status: 'approved', roles: ['pk-pm'], isCreator: true }))).not.toContain('cancel')
    expect(allowedActions(ctx({ status: 'approved', roles: ['pk-finance'], isRequester: true }))).toContain('cancel')
    expect(allowedActions(ctx({ status: 'approved', roles: ['pk-owner'] }))).toContain('cancel')
    expect(allowedActions(ctx({ type: 'reimburse', status: 'receipt_revision', roles: ['pk-finance'] }))).toContain('cancel')
    expect(mayPerform(ctx({ status: 'draft', isCreator: true }), 'cancel')).toBe(false)
    expect(mayPerform(ctx({ status: 'approved', roles: ['pk-finance'], isCreator: true }), 'cancel')).toBe(true)
  })

  it('D2410: Finance requester / creator may process receipts, flags, LPJ and settlement of its own request', () => {
    const fin = (over: Partial<ActorContext>) => ctx({ roles: ['pk-finance'], isCreator: true, isRequester: true, ...over })
    expect(allowedActions(fin({ type: 'reimburse', status: 'approved' }))).toEqual(expect.arrayContaining(['receipt_verify', 'receipt_reject', 'verify_receipts', 'review_flag']))
    expect(allowedActions(fin({ status: 'lpj_submitted' }))).toEqual(expect.arrayContaining(['receipt_verify', 'lpj_request_revision', 'lpj_verify', 'review_flag']))
    expect(allowedActions(fin({ status: 'lpj_verified' }))).toContain('settle')
    expect(allowedActions(fin({ status: 'completed' }))).toContain('settle_reverse')
    for (const a of FINANCE_SELF_PROCESSED) expect(mayPerform(fin({}), a)).toBe(true)
    // a non-Finance requester still does none of them; approvals stay G1
    for (const a of FINANCE_SELF_PROCESSED) expect(mayPerform(ctx({ roles: ['pk-staff'], isRequester: true }), a)).toBe(false)
    expect(allowedActions(fin({ status: 'pending_approval', matchesCurrentStep: true }))).not.toContain('approve')
  })

  it('G1: requester/creator can never approve/acknowledge even with the Owner role', () => {
    const c = ctx({ status: 'pending_approval', roles: ['pk-owner'], isRequester: true, matchesCurrentStep: true })
    expect(allowedActions(c)).not.toContain('approve')
    expect(allowedActions(c)).not.toContain('reject')
    expect(allowedActions(ctx({ status: 'pending_ack', roles: ['pk-pm'], isCreator: true, isAcknowledger: true }))).not.toContain('acknowledge')
    expect(allowedActions(ctx({ status: 'pending_approval', roles: ['pk-owner'], matchesCurrentStep: true }))).toContain('approve')
    expect(allowedActions(ctx({ status: 'pending_approval', roles: ['pk-owner'], matchesCurrentStep: true, alreadyDecided: true }))).not.toContain('approve')
  })

  it('US-04: requester withdraw only before any decision (D2410: never cancel); Finance cannot approve', () => {
    expect(allowedActions(ctx({ status: 'pending_approval', isRequester: true }))).toEqual(['withdraw'])
    const decided = allowedActions(ctx({ status: 'pending_approval', isRequester: true, hasDecision: true }))
    expect(decided).not.toContain('withdraw')
    expect(decided).not.toContain('cancel')
    expect(allowedActions(ctx({ status: 'pending_approval', roles: ['pk-finance'] }))).not.toContain('approve')
    expect(allowedActions(ctx({ status: 'approved', roles: ['pk-finance'] }))).toEqual(expect.arrayContaining(['transfer', 'cancel']))
    expect(allowedActions(ctx({ status: 'approved', roles: ['pk-pm'], isRequester: true }))).not.toContain('transfer')
  })

  it('receipt windows (T4) and labels', () => {
    expect(receiptsEditable('reimburse', 'draft')).toBe(true)
    expect(receiptsEditable('reimburse', 'pending_approval')).toBe(false)
    expect(receiptsEditable('advance', 'draft')).toBe(false)
    expect(receiptsEditable('advance', 'transferred')).toBe(true)
    expect(statusLabel('advance', 'approved')).toBe('Disetujui (Antri Transfer)')
    expect(statusLabel('reimburse', 'receipts_verified')).toBe('Nota Terverifikasi (Antri Transfer)')
  })
})

describe('lines (US-37; D3 DRMS 10/10: total = qty × harga satuan, computed)', () => {
  const lines = normalizeLines(FORM_228.lines.map((l) => ({ description: l.description, qty: l.qty, uom: l.uomCode ? 1 : null, unitPrice: l.unitPrice, total: l.total, category: 1 })))
  it('form 228 grand total = Rp 1.447.500 (2 × 338.500; total-only lines get unit price = total ÷ qty)', () => {
    expect(lines.map((l) => [l.unitPrice, l.total])).toEqual([
      [600_000, 600_000],
      [338_500, 677_000],
      [170_500, 170_500],
    ])
    expect(grandTotal(lines)).toBe(1_447_500)
    expect(formatRupiah(grandTotal(lines))).toBe('Rp 1.447.500')
    expect(validateLines(lines, { forSubmit: true })).toEqual([])
  })
  it('the client total is ignored once a unit price is given; qty empty = 1; decimals rounded half-up', () => {
    expect(normalizeLines([{ qty: 2, unitPrice: 339_000, total: 677_000 }])[0]).toMatchObject({ unitPrice: 339_000, total: 678_000 })
    expect(normalizeLines([{ qty: null, unitPrice: 150_000, total: 1 }])[0]!.total).toBe(150_000)
    expect(computeLineTotal(24.8, 24_200)).toBe(600_160) // K10: Pertamina 24,80 L × 24.200
    expect(computeLineTotal(1.005, 1_000)).toBe(1_005)
    expect(computeLineTotal(0.5, 3)).toBe(2) // 1,5 → 2 (half-up)
    expect(computeLineTotal(1.23456, 1_000)).toBeNull()
    expect(computeLineTotal(1, null)).toBeNull()
  })
  it('total-only compatibility: exact division → unit price; otherwise the line stays incomplete (cannot be sent)', () => {
    expect(normalizeLines([{ qty: 24.8, total: 250_000 }])[0]).toMatchObject({ unitPrice: null, total: null })
    const legacy = normalizeLines([{ id: 'a', qty: 24.8, total: 250_000 }], [{ id: 'a', qty: 24.8, unitPrice: null, total: 250_000 }])[0]!
    expect(legacy).toMatchObject({ unitPrice: null, total: 250_000 }) // unchanged legacy row keeps its total
    expect(validateLines([{ description: 'x', qty: 24.8, uom: 1, total: 250_000, category: 1 }], { forSubmit: true }).map((e) => e.path)).toEqual(['lines.0.unitPrice'])
    expect(receiptMismatch({ total: 678_000, receiptAmount: 677_000 })).toBe(true)
    expect(receiptMismatch({ total: 678_000, receiptAmount: null })).toBe(false)
  })
  it('unlock of a pre-D3 locked line: exact total ÷ qty → unit price; otherwise no unit price; total never changes', () => {
    const exact = { id: 'a', qty: 10, unitPrice: 59_999, total: 600_000 }
    expect(lineNeedsCompletion(exact)).toBe(true)
    expect(unlockLine(exact)).toEqual({ ...exact, unitPrice: 60_000 })
    expect(unlockLine({ qty: 7, unitPrice: 21_429, total: 150_000 })).toMatchObject({ unitPrice: null, total: 150_000 })
    expect(unlockLine({ qty: null, unitPrice: null, total: 150_000 })).toMatchObject({ unitPrice: 150_000, total: 150_000 })
    const complete = { qty: 2, unitPrice: 339_000, total: 678_000 }
    expect(lineNeedsCompletion(complete)).toBe(false)
    expect(unlockLine(complete)).toBe(complete) // same object: nothing to write
    expect(lineNeedsCompletion({ qty: 24.8, unitPrice: null, total: 250_000 })).toBe(true)
  })
  it('lump sum line accepted; display unit price = total ÷ qty when empty (legacy rows)', () => {
    expect(displayUnitPrice({ unitPrice: null, qty: null, total: 170_500 })).toBeNull()
    expect(displayUnitPrice({ unitPrice: null, qty: 2, total: 677_000 })).toBe(338_500)
    expect(displayUnitPrice({ unitPrice: 339_000, qty: 2, total: 677_000 })).toBe(339_000)
  })
  it('rejects malformed values; completeness only for submit', () => {
    expect(validateLines([], { forSubmit: true }).map((e) => e.path)).toContain('lines')
    expect(validateLines([], { forSubmit: false })).toEqual([])
    const bad = validateLines([{ description: 'x', total: 10.5, qty: 1.23456, unitPrice: -1, receiptAmount: -5, category: 1 }], { forSubmit: true }).map((e) => e.path)
    expect(bad).toEqual(expect.arrayContaining(['lines.0.total', 'lines.0.qty', 'lines.0.unitPrice', 'lines.0.uom', 'lines.0.receiptAmount']))
    expect(validateLines([{ description: 'x' }], { forSubmit: true }).map((e) => e.path)).toEqual(expect.arrayContaining(['lines.0.total', 'lines.0.unitPrice', 'lines.0.category']))
  })
})

describe('receipt flags (US-47…US-50) — form 228 expectations', () => {
  const lines = FORM_228.lines.map((l, i) => ({ id: `L${i}`, lineNo: i + 1, total: l.total, uom: l.uomCode === 'BLN' ? 12 : l.uomCode === 'KMR' ? 3 : null, category: i === 0 ? 100 : i === 1 ? 101 : 102 }))
  const receipts = FORM_228.receipts.map((r, i) => ({ id: i + 1, lineId: `L${r.line}`, receiptDate: r.receiptDate, amount: r.amount }))
  const base: FlagInput = {
    type: 'reimburse',
    requestDate: FORM_228.requestDate,
    lines,
    receipts,
    categories: new Map([
      [100, { id: 100, name: 'BBM', allowedUoms: [1, 2] }],
      [101, { id: 101, name: 'Penginapan', allowedUoms: [3, 4] }],
      [102, { id: 102, name: 'Konsumsi', allowedUoms: [5, 6] }],
    ]),
    uomNames: new Map([[12, 'bulan']]),
    duplicates: [],
    tolerance: 1000,
    maxAgeDays: 30,
  }

  it('tolerance Rp 1.000 (Q-14): hotel Rp 124 → info; BBM and meal no diff; 21/09 receipts after 20/09; BBM "bulan"', () => {
    const flags = computeFlags(base)
    const byKind = (k: string) => flags.filter((f) => f.kind === k)
    expect(byKind('amount_diff')).toHaveLength(1)
    expect(byKind('amount_diff')[0]).toMatchObject({ lineNo: 2, level: 'info', detail: { difference: 124 } })
    expect(byKind('date_after_request').map((f) => f.receiptId).sort()).toEqual([1, 3])
    expect(byKind('uom_suspicious')).toEqual([expect.objectContaining({ lineNo: 1, level: 'warning' })])
    expect(byKind('uom_suspicious')[0]!.message).toContain('bulan')
  })

  it('tolerance 0 → hotel difference becomes a warning', () => {
    expect(computeFlags({ ...base, tolerance: 0 }).find((f) => f.kind === 'amount_diff')).toMatchObject({ level: 'warning' })
  })

  it('old receipts, Pengajuan Baru transfer date, duplicates; no activity-period flag any more', () => {
    const f1 = computeFlags({ ...base, receipts: [{ id: 9, lineId: 'L2', receiptDate: '2026-08-01', amount: 170_500 }] })
    expect(f1.map((f) => f.kind)).toContain('date_too_old')
    // owner decision 2026-10-09: "Periode kegiatan" replaced by "Tingkat urgensi" → date_out_of_period is never raised
    expect(computeFlags(base).filter((f) => f.kind === 'date_out_of_period')).toEqual([])
    const f3 = computeFlags({ ...base, type: 'advance', transferDate: '2026-10-30' })
    expect(f3.filter((f) => f.kind === 'date_too_old')).toHaveLength(3)
    expect(f3.filter((f) => f.kind === 'date_after_request')).toHaveLength(0)
    const f4 = computeFlags({ ...base, duplicates: [{ receiptId: 3, otherRequestId: 77, otherDocNo: '230/PB-DRMS/01/X/2026', via: 'fields' }] })
    expect(f4.find((f) => f.kind === 'duplicate')).toMatchObject({ receiptId: 3, relatedRequestId: 77, level: 'warning' })
  })

  it('normalisation for duplicate detection', () => {
    expect(normalizeReceiptNo('TX0101.0001.000123')).toBe('TX01010001000123')
    expect(normalizeReceiptNo(' tx 0101-0001/000123 ')).toBe('TX01010001000123')
    expect(normalizeVendor('Soto  "Mas Joko", Banjarmasin')).toBe('soto mas joko banjarmasin')
  })
})

describe('approval rules (US-34, Q-31 default Owner-only, G2)', () => {
  const rule = (over: Partial<RuleInput>): RuleInput => ({
    id: 1,
    name: 'r',
    docType: 'expense_request',
    requestType: 'any',
    minAmount: 0,
    maxAmount: null,
    acknowledge: 'required',
    steps: [{ level: 1, approverRole: 'pk-owner' }],
    ...over,
  })
  const rules = [rule({ id: 1, priority: 100 }), rule({ id: 2, priority: 50, minAmount: 10_000_001, steps: [{ level: 1, approverRole: 'pk-owner' }, { level: 2, approverRole: 'pk-owner' }] })]
  const facts = (grandTotal: number) => ({ type: 'reimburse' as const, grandTotal, categoryIds: [], projectId: null, costCenterId: 5 })

  it('amount bands: ≤ 10 juta → default rule; > 10 juta → two levels', () => {
    expect(selectRule(rules, facts(1_447_500))?.id).toBe(1)
    expect(selectRule(rules, facts(10_000_000))?.id).toBe(1)
    expect(selectRule(rules, facts(10_000_001))?.id).toBe(2)
    expect(selectRule([rules[0]!, { ...rules[1]!, active: false }], facts(20_000_000))?.id).toBe(1)
    expect(selectRule([rule({ requestType: 'advance' })], facts(1))).toBeNull()
  })

  it('specific rules win over generic ones at the same priority', () => {
    const specific = rule({ id: 9, costCenter: 5 })
    expect(selectRule([rule({ id: 8 }), specific], facts(1))?.id).toBe(9)
  })

  it('snapshot + step matching', () => {
    const s = buildSnapshot(rules[1]!, 42)
    expect(s.steps.map((x) => x.level)).toEqual([1, 2])
    expect(matchesStep(s.steps[0], { id: 1, roles: ['pk-owner'] })).toBe(true)
    expect(matchesStep(s.steps[0], { id: 1, roles: ['pk-pm', 'pk-finance'] })).toBe(false)
    expect(matchesStep({ level: 1, approverRole: 'pk-owner', approverUserId: 7 }, { id: 1, roles: ['pk-owner'] })).toBe(false)
    expect(matchesAcknowledger(s, { id: 42, roles: [] })).toBe(true)
    expect(matchesAcknowledger(s, { id: 43, roles: ['pk-owner'] })).toBe(false)
    expect(stepsError([{ level: 2, approverRole: 'pk-owner' }])).toMatch(/berurutan/)
    expect(stepsError([{ level: 1 }])).toMatch(/peran atau user/)
  })

  it('US-26 budget impact; cost centers without budget (Q-24)', () => {
    expect(budgetImpact(100_000_000, 80_000_000, 10_000_000)).toEqual({ before: 80, after: 90 })
    expect(budgetImpact(null, 1, 1)).toEqual({ before: null, after: null })
  })
})

describe('periods (ADR 0005 §6) and dates', () => {
  it('lock date = last day of the latest closed period', () => {
    expect(periodEnd('2026-02')).toBe('2026-02-28')
    expect(periodEnd('2028-02')).toBe('2028-02-29')
    expect(lockDate(['2026-07', '2026-08'])).toBe('2026-08-31')
    expect(isLocked('2026-08-31', ['2026-08'])).toBe(true)
    expect(isLocked('2026-09-01', ['2026-08'])).toBe(false)
    expect(lockDate([])).toBeNull()
  })
  it('business dates', () => {
    expect(isBusinessDate('2026-09-20')).toBe(true)
    expect(isBusinessDate('2026-02-30')).toBe(false)
    expect(addDays('2026-09-20', -30)).toBe('2026-08-21')
  })
})

describe('per-line audit diff (§8 T1, line_no)', () => {
  it('added / changed / removed with line numbers', () => {
    const prev = [{ id: 'a', description: 'x', total: 1 }, { id: 'b', description: 'y', total: 2 }]
    const next = [{ id: 'a', description: 'x', total: 5 }, { id: 'c', description: 'z', total: 3 }]
    const d = diffLines(prev, next)
    expect(d).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'changed', lineNo: 1, field: 'lines.total', oldValue: 1, newValue: 5 }),
        expect.objectContaining({ kind: 'added', lineNo: 2 }),
        expect.objectContaining({ kind: 'removed', lineNo: 2, field: 'lines' }),
      ]),
    )
  })
})
