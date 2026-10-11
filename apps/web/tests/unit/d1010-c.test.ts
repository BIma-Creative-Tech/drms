import { describe, expect, it } from 'vitest'

import { PROJECT_TABS } from '@/admin/config'
import { parseDraft, rowValues } from '@/admin/components/lines/line-form'
import { CostCenterListQuery, ProjectListQuery } from '@/api/v1/schemas-projects'
import { ListQuery, TransferCreate } from '@/api/v1/schemas-flow'
import { revisionOnly, shownInHeader } from '@/collections/expense-request-form'
import { ExpenseRequests } from '@/collections/ExpenseRequests'
import { keepRapItems } from '@/domain/expense/drafts'
import { computeFlags, rapOverFlagSpecs } from '@/domain/expense/flags'
import { FLAG_KINDS, FLAG_LABELS } from '@/domain/expense/types'
import { plannedAmount, rapMoney, sumRapMoney } from '@/domain/rap/budget'

/** DRMS 10/10 Phase C (server + web): D4 RAP money, "Melebihi RAP" flag, D2 contract, project tabs, sidebar dedupe. */
const ctx = { user: null } as never

describe('D4: RAP plan vs realisation (pure)', () => {
  it('planned = round(volume × unit price); unpriced items have no plan', () => {
    expect(plannedAmount(12.5, 80_000)).toBe(1_000_000)
    expect(plannedAmount(0.333, 1_000)).toBe(333)
    expect(plannedAmount(10, null)).toBeNull()
  })
  it('remaining / percent / over budget', () => {
    expect(rapMoney(1_000_000, 600_000, 250_000, 100_000)).toEqual({ planned: 1_000_000, realised: 600_000, transferred: 250_000, verified: 100_000, remaining: 400_000, percent: 60, overBudget: false })
    expect(rapMoney(1_000_000, 1_100_000)).toMatchObject({ remaining: -100_000, percent: 110, overBudget: true })
    expect(rapMoney(null, 50_000)).toMatchObject({ remaining: null, percent: null, overBudget: false })
    expect(rapMoney(0, 0).percent).toBeNull()
  })
  it('sum: planned of the priced items only, over-budget item count', () => {
    const s = sumRapMoney([rapMoney(1_000_000, 1_100_000), rapMoney(500_000, 100_000, 100_000), rapMoney(null, 70_000)])
    expect(s).toMatchObject({ planned: 1_500_000, realised: 1_270_000, transferred: 100_000, remaining: 230_000, overBudgetItems: 1, overBudget: false })
    expect(sumRapMoney([rapMoney(null, 0)]).planned).toBeNull()
  })
})

describe('D4: "Melebihi RAP" flag', () => {
  it('kind rap_over_budget, warning, one per line, no Rupiah amounts in the text (Staff never sees RAP values)', () => {
    expect(FLAG_KINDS).toContain('rap_over_budget')
    expect(FLAG_LABELS.rap_over_budget).toBe('Melebihi RAP')
    const f = rapOverFlagSpecs([{ lineId: 'l2', lineNo: 2, itemId: 7, itemCode: 'A.1', itemName: 'Galian tanah' }])
    expect(f).toEqual([{ key: 'rap_over_budget:l2', kind: 'rap_over_budget', level: 'warning', lineId: 'l2', lineNo: 2, message: 'Baris 2: item RAP A.1 Galian tanah — realisasi + pengajuan ini melebihi nilai rencana RAP.', detail: { rapItemId: 7 } }])
    expect(f[0]!.message).not.toMatch(/Rp/)
  })
  it('part of computeFlags', () => {
    const flags = computeFlags({ type: 'advance', requestDate: '2026-10-11', lines: [], receipts: [], categories: new Map(), uomNames: new Map(), duplicates: [], tolerance: 1000, maxAgeDays: 30, rapOver: [{ lineId: 'x', lineNo: 1, itemId: 1, itemCode: 'B', itemName: 'Beton' }] })
    expect(flags.map((x) => x.kind)).toEqual(['rap_over_budget'])
  })
})

describe('D4: line RAP item (dialog + old clients)', () => {
  const d = { description: 'Semen', qty: '2', uom: '1', unitPrice: '60.000', receiptAmount: '', category: '4', vehicle: '', notes: '', rapItem: '' }
  it('required when the project has a RAP; kept in the row values', () => {
    expect(parseDraft(d, { rapRequired: true }).errors).toEqual({ rapItem: 'Item RAP wajib dipilih.' })
    expect(parseDraft({ ...d, rapItem: '9' }, { rapRequired: true }).values).toMatchObject({ rapItem: 9, total: 120_000 })
    expect(parseDraft(d).values).toMatchObject({ rapItem: null })
    expect(rowValues({ 'lines.0.rapItem': { value: { id: 9 } } }, 'lines', 0).rapItem).toBe(9)
  })
  it('a line without rapItemId (APK ≤ 0.7) keeps its stored item; null clears; new lines stay as sent', () => {
    const stored = [{ id: 'a', rapItemId: 5 }, { id: 'b', rapItemId: 6 }]
    expect(keepRapItems([{ id: 'a' }, { id: 'b', rapItemId: null }, { description: 'baru' }], stored)).toEqual([{ id: 'a', rapItemId: 5 }, { id: 'b', rapItemId: null }, { description: 'baru' }])
  })
  it('the line array has the rapItem relationship (rap-items)', () => {
    const lines = ExpenseRequests.fields.find((f) => 'name' in f && f.name === 'lines') as { fields: Array<{ type: string; fields?: Array<{ name?: string; relationTo?: string }> }> }
    const all = lines.fields.flatMap((f) => (f.type === 'row' ? (f.fields ?? []) : [f as { name?: string; relationTo?: string }]))
    expect(all.find((f) => f.name === 'rapItem')?.relationTo).toBe('rap-items')
  })
})

describe('D2 contract', () => {
  it('the requester cost center is not writable (ignored); transfer takes costCenterId; list takes project / q / page', () => {
    const cc = ExpenseRequests.fields.find((f) => 'name' in f && f.name === 'costCenter') as { access?: { create?: (a: unknown) => boolean; update?: (a: unknown) => boolean } }
    expect(cc.access?.create?.({} as never)).toBe(false)
    expect(cc.access?.update?.({} as never)).toBe(false)
    expect(TransferCreate.safeParse({ cashAccountId: 1, bankRef: 'X', proofMediaId: 2, costCenterId: 3 }).success).toBe(true)
    expect(ListQuery.parse({ project: '12', q: 'semen', page: '2' })).toMatchObject({ project: 12, q: 'semen', page: 2 })
    expect(ProjectListQuery.parse({})).toMatchObject({ page: 1, limit: 20 })
    expect(ProjectListQuery.safeParse({ status: 'berjalan,selesai' }).success).toBe(true)
    expect(ProjectListQuery.safeParse({ status: 'hapus' }).success).toBe(false)
    expect(CostCenterListQuery.safeParse({ active: 'all' }).success).toBe(true)
  })
})

describe('point 7 + polish: project tabs, request sidebar', () => {
  it('project detail tabs Proyek / RAP / Pengajuan', () => {
    expect(PROJECT_TABS.default.tab.label).toBe('Proyek')
    expect([PROJECT_TABS.rap.tab.label, PROJECT_TABS.rap.path, PROJECT_TABS.pengajuan.tab.label, PROJECT_TABS.pengajuan.path]).toEqual(['RAP', '/rap', 'Pengajuan', '/pengajuan'])
  })
  it('the sidebar no longer repeats the header (Nomor, Grand total, …); "Alasan perubahan" only in Revisi Nota', () => {
    expect(shownInHeader({ status: 'approved' }, {}, ctx)).toBe(false)
    expect(revisionOnly({ status: 'draft' }, {}, ctx)).toBe(false)
    expect(revisionOnly({ status: 'receipt_revision' }, {}, ctx)).toBe(true)
    const cond = (name: string) => (ExpenseRequests.fields.find((f) => 'name' in f && f.name === name) as { admin?: { condition?: (d: unknown, s: unknown, c: unknown) => boolean } }).admin?.condition
    for (const n of ['docNo', 'grandTotal', 'submittedAt', 'approvedAt']) expect(cond(n)?.({ status: 'pending_ack', [n]: 'x' }, {}, ctx), n).toBe(false)
    for (const n of ['createdBy', 'requestDate']) {
      expect(cond(n)?.({ status: 'draft', [n]: 1 }, {}, ctx), n).toBe(false)
      expect(cond(n)?.({ status: 'approved', [n]: 1 }, {}, ctx), n).toBe(false)
      expect(cond(n)?.({ status: 'receipt_revision', [n]: 1 }, {}, ctx), n).toBe(true)
    }
  })
})
