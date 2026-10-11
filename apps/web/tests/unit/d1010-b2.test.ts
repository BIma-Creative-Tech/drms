import { describe, expect, it } from 'vitest'

import { draftOf, draftTotal, formatQty, parseDraft, parseQty, relValue, rowValues } from '@/admin/components/lines/line-form'
import { editableInput, linesEditable } from '@/collections/expense-request-form'
import { computeFlags, type FlagInput } from '@/domain/expense/flags'
import { FLAG_LABELS, REQUEST_TYPE_LABELS } from '@/domain/expense/types'

/** DRMS 10/10 Phase B-2 (web): D1 label, D3 lines dialog + "Selisih nota" flag, read-only header (item 3). */
describe('D1: request type label', () => {
  it('advance = "Pengajuan Baru" (internal value unchanged), reimburse = "Reimburse"', () => {
    expect(REQUEST_TYPE_LABELS).toEqual({ advance: 'Pengajuan Baru', reimburse: 'Reimburse' })
  })
})

describe('D3: "Selisih nota" flag (receipt_amount_mismatch)', () => {
  const base: FlagInput = {
    type: 'advance',
    requestDate: '2026-10-11',
    lines: [],
    receipts: [],
    categories: new Map(),
    uomNames: new Map(),
    duplicates: [],
    tolerance: 1000,
    maxAgeDays: 30,
  }
  it('raised per line when the receipt amount differs from the total: line no., total, nota, difference', () => {
    const flags = computeFlags({
      ...base,
      lines: [
        { id: 'a', lineNo: 1, total: 600_160, receiptAmount: 600_000 },
        { id: 'b', lineNo: 2, total: 678_000, receiptAmount: 650_000 },
        { id: 'c', lineNo: 3, total: 50_000, receiptAmount: 50_000 },
        { id: 'd', lineNo: 4, total: 10_000, receiptAmount: null },
      ],
    }).filter((f) => f.kind === 'receipt_amount_mismatch')
    expect(flags.map((f) => [f.lineNo, f.level])).toEqual([
      [1, 'info'], // Rp 160 ≤ tolerance
      [2, 'warning'],
    ])
    expect(flags[1]!.message).toBe('Baris 2: total Rp 678.000, nominal nota Rp 650.000, selisih Rp 28.000 (nota lebih kecil).')
    expect(flags[1]!.detail).toEqual({ lineTotal: 678_000, receiptAmount: 650_000, difference: 28_000, tolerance: 1000 })
    expect(FLAG_LABELS.receipt_amount_mismatch).toBe('Selisih nota')
  })
})

describe('D3: line dialog helpers (LinesTableField)', () => {
  it('qty with decimal comma; formatted back with comma', () => {
    expect(parseQty('24,8')).toBe(24.8)
    expect(parseQty('1.5')).toBe(1.5)
    expect(parseQty('')).toBeNull()
    expect(Number.isNaN(parseQty('1,2,3') as number)).toBe(true)
    expect(formatQty(24.8)).toBe('24,8')
    expect(formatQty(2)).toBe('2')
  })
  it('live total = qty × harga satuan; requires every field the submit needs', () => {
    expect(draftTotal({ qty: '24,8', unitPrice: '24.200' })).toBe(600_160)
    expect(draftTotal({ qty: '', unitPrice: '1.000' })).toBeNull()
    const ok = parseDraft({ description: ' Solar ', qty: '20', uom: '3', unitPrice: '10.000', receiptAmount: '199.500', category: '7', vehicle: '9', notes: '' }, { requiresVehicle: true })
    expect(ok.values).toEqual({ description: 'Solar', qty: 20, uom: 3, unitPrice: 10_000, total: 200_000, receiptAmount: 199_500, category: 7, vehicle: 9, notes: '' })
    const bad = parseDraft({ description: '', qty: '0', uom: '', unitPrice: '1,5', receiptAmount: '-1', category: '', vehicle: '', notes: '' }, { requiresVehicle: true })
    expect(Object.keys(bad.errors).sort()).toEqual(['category', 'description', 'qty', 'receiptAmount', 'unitPrice', 'uom', 'vehicle'])
    expect(bad.values).toBeNull()
  })
  it('form state row ↔ dialog draft (relationship values in any Payload shape)', () => {
    expect(relValue({ value: 5 })).toBe(5)
    expect(relValue({ id: '6' })).toBe(6)
    const fields = { 'lines.0.description': { value: 'Semen' }, 'lines.0.qty': { value: 2 }, 'lines.0.uom': { value: 1 }, 'lines.0.unitPrice': { value: 1_250_000 }, 'lines.0.total': { value: 2_500_000 }, 'lines.0.category': { value: { id: 4 } } }
    const row = rowValues(fields, 'lines', 0)
    expect(row).toMatchObject({ description: 'Semen', qty: 2, uom: 1, unitPrice: 1_250_000, total: 2_500_000, receiptAmount: null, category: 4, vehicle: null })
    expect(draftOf(row)).toMatchObject({ qty: '2', unitPrice: '1.250.000', receiptAmount: '', category: '4' })
    expect(draftOf(null).qty).toBe('1')
  })
})

describe('item 3: header inputs only while the content is editable', () => {
  it('new / Draft / Revisi Nota editable; submitted statuses show the read-only summary instead', () => {
    expect(['', 'draft', 'receipt_revision'].map((s) => linesEditable({ status: s || null }))).toEqual([true, true, true])
    expect(['pending_ack', 'approved', 'transferred', 'lpj_submitted', 'completed'].some((s) => linesEditable({ status: s }))).toBe(false)
    const c = editableInput('project')
    const ctx = {} as never
    expect(c({ status: 'draft' }, {}, ctx)).toBe(true)
    expect(c({ status: 'receipt_revision', project: null }, {}, ctx)).toBe(false)
    expect(c({ status: 'receipt_revision', project: 3 }, {}, ctx)).toBe(true)
    expect(c({ status: 'approved', project: 3 }, {}, ctx)).toBe(false)
  })
})
