import { describe, expect, it } from 'vitest'

import { isLocked, lockDate, periodEnd } from '@/domain/cash/periods'
import { computeFlags, normalizeReceiptNo, normalizeVendor, type FlagInput } from '@/domain/expense/flags'
import { diffLines } from '@/domain/expense/line-audit'
import { displayUnitPrice, grandTotal, validateLines } from '@/domain/expense/lines'
import { budgetImpact, buildSnapshot, matchesAcknowledger, matchesStep, selectRule, stepsError, type RuleInput } from '@/domain/expense/rules'
import { allowedActions, assertTransition, targets, TransitionError, type ActorContext } from '@/domain/expense/state'
import { addDays, isBusinessDate, receiptsEditable, statusLabel } from '@/domain/expense/types'
import { formatRupiah } from '@/lib/money'
import { FORM_228 } from '@/seed/form-fixture'

describe('state machines (architecture §5.1 Uang Muka / §5.2 Reimburse, G6)', () => {
  it('shared approval path', () => {
    for (const t of ['advance', 'reimburse'] as const) {
      expect(targets(t, 'draft', 'submit').sort()).toEqual(['pending_ack', 'pending_approval'])
      expect(targets(t, 'pending_ack', 'acknowledge')).toEqual(['pending_approval'])
      expect(targets(t, 'pending_approval', 'approve').sort()).toEqual(['approved', 'pending_approval'])
      expect(targets(t, 'pending_approval', 'reject')).toEqual(['rejected'])
      expect(targets(t, 'pending_ack', 'withdraw')).toEqual(['draft'])
    }
  })

  it('Uang Muka: approved → transferred ⇄ approved (void); no receipt verification step', () => {
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

  it('actor guards: own edit/submit/cancel; strangers nothing', () => {
    expect(allowedActions(ctx({ isCreator: true }))).toEqual(expect.arrayContaining(['edit', 'submit', 'cancel']))
    expect(allowedActions(ctx({}))).toEqual([])
  })

  it('G1: requester/creator can never approve/acknowledge even with the Owner role', () => {
    const c = ctx({ status: 'pending_approval', roles: ['pk-owner'], isRequester: true, matchesCurrentStep: true })
    expect(allowedActions(c)).not.toContain('approve')
    expect(allowedActions(c)).not.toContain('reject')
    expect(allowedActions(ctx({ status: 'pending_ack', roles: ['pk-pm'], isCreator: true, isAcknowledger: true }))).not.toContain('acknowledge')
    expect(allowedActions(ctx({ status: 'pending_approval', roles: ['pk-owner'], matchesCurrentStep: true }))).toContain('approve')
    expect(allowedActions(ctx({ status: 'pending_approval', roles: ['pk-owner'], matchesCurrentStep: true, alreadyDecided: true }))).not.toContain('approve')
  })

  it('US-04: requester withdraw/cancel only before any decision; Finance cannot approve', () => {
    expect(allowedActions(ctx({ status: 'pending_approval', isRequester: true }))).toEqual(expect.arrayContaining(['withdraw', 'cancel']))
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

describe('lines (US-37, Q-05 answered: total primary, unit price informational)', () => {
  const lines = FORM_228.lines.map((l) => ({ description: l.description, qty: l.qty, uom: l.uomCode ? 1 : null, unitPrice: l.unitPrice, total: l.total, category: 1 }))
  it('form 228 grand total = Rp 1.447.500 even though 2 × 339.000 ≠ 677.000', () => {
    expect(grandTotal(lines)).toBe(1_447_500)
    expect(formatRupiah(grandTotal(lines))).toBe('Rp 1.447.500')
    expect(validateLines(lines, { forSubmit: true })).toEqual([])
  })
  it('lump sum line accepted; display unit price = total ÷ qty when empty', () => {
    expect(displayUnitPrice({ unitPrice: null, qty: null, total: 170_500 })).toBeNull()
    expect(displayUnitPrice({ unitPrice: null, qty: 2, total: 677_000 })).toBe(338_500)
    expect(displayUnitPrice({ unitPrice: 339_000, qty: 2, total: 677_000 })).toBe(339_000)
  })
  it('rejects malformed values; completeness only for submit', () => {
    expect(validateLines([], { forSubmit: true }).map((e) => e.path)).toContain('lines')
    expect(validateLines([], { forSubmit: false })).toEqual([])
    const bad = validateLines([{ description: 'x', total: 10.5, qty: 1.23456, unitPrice: -1, category: 1 }], { forSubmit: true }).map((e) => e.path)
    expect(bad).toEqual(expect.arrayContaining(['lines.0.total', 'lines.0.qty', 'lines.0.unitPrice', 'lines.0.uom']))
    expect(validateLines([{ description: 'x' }], { forSubmit: true }).map((e) => e.path)).toEqual(expect.arrayContaining(['lines.0.total', 'lines.0.category']))
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

  it('old receipts, activity period, Uang Muka transfer date, duplicates', () => {
    const f1 = computeFlags({ ...base, receipts: [{ id: 9, lineId: 'L2', receiptDate: '2026-08-01', amount: 170_500 }] })
    expect(f1.map((f) => f.kind)).toContain('date_too_old')
    const f2 = computeFlags({ ...base, periodFrom: '2026-09-20', periodTo: '2026-09-20' })
    expect(f2.filter((f) => f.kind === 'date_out_of_period').map((f) => f.receiptId).sort()).toEqual([1, 3])
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
