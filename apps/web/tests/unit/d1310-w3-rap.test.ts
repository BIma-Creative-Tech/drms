import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { RAP_ADMIN_VIEWS } from '@/admin/config'
import { createBody, draftAmount, draftOf, formatDecimalInput, itemUsed, parseDecimal, parseRapDraft, patchBody, rapEditMode, rapGrandTotal, rapRealisedTotal, type RapItemView } from '@/admin/components/rap/rap-item-form'
import { itemIcon, moduleForPath, resolveModules } from '@/admin/modules/registry'
import type { Role } from '@/access/roles'
import { filterOverview, overviewTotals, rapOverRab, rapState, rapVsRab, type RapOverviewRow } from '@/domain/rap/overview'

/**
 * DRMS 13/10 Wave 3 "Proyek › RAP": pure helpers of the RAP index (domain/rap/overview.ts) and of the RAP item
 * form (admin/components/rap/rap-item-form.ts), the menu entry and the view wiring. Fictional data.
 */
const item = (over: Partial<RapItemView> = {}): RapItemView => ({
  id: 7,
  code: 'A.1',
  description: 'Galian tanah',
  kind: 'pekerjaan',
  stageId: 3,
  stageName: 'Persiapan',
  uomId: 2,
  uomCode: 'M3',
  volume: 12.5,
  unitPrice: 85_000,
  value: 1_062_500,
  realisedAmount: 0,
  weightPct: null,
  active: true,
  realised: 0,
  received: 0,
  used: 0,
  ...over,
})

const row = (over: Partial<RapOverviewRow> = {}): RapOverviewRow => ({ id: 1, code: 'P-1', name: 'Uji', kind: 'umum', status: 'berjalan', companyId: 1, items: 0, state: 'opsional', prices: true, editor: true, rapValue: null, budget: null, ...over })

describe('RAP index (overview.ts)', () => {
  it('state: ada with ≥ 1 active item, else wajib (RAB / konstruksi) or opsional', () => {
    expect(rapState(3, true)).toBe('ada')
    expect(rapState(1, false)).toBe('ada')
    expect(rapState(0, true)).toBe('wajib')
    expect(rapState(0, false)).toBe('opsional')
  })

  it('RAP vs RAB: % with 2 decimals, null without both figures; over = RAP above RAB', () => {
    expect(rapVsRab(750_000, 1_000_000)).toBe(75)
    expect(rapVsRab(1, 3)).toBe(33.33)
    expect(rapVsRab(null, 1_000_000)).toBeNull()
    expect(rapVsRab(5, 0)).toBeNull()
    expect(rapOverRab(1_000_001, 1_000_000)).toBe(true)
    expect(rapOverRab(1_000_000, 1_000_000)).toBe(false)
    expect(rapOverRab(null, 5)).toBe(false)
  })

  it('filters: PT / status / RAP state are multi-select; archived projects only when "Arsip" is ticked', () => {
    const rows = [row({ id: 1, companyId: 1, state: 'ada' }), row({ id: 2, companyId: 2, state: 'wajib' }), row({ id: 3, companyId: 1, status: 'arsip', state: 'ada' }), row({ id: 4, companyId: 2, status: 'selesai', state: 'opsional' })]
    expect(filterOverview(rows, {}).map((r) => r.id)).toEqual([1, 2, 4])
    expect(filterOverview(rows, { companies: [2] }).map((r) => r.id)).toEqual([2, 4])
    expect(filterOverview(rows, { statuses: ['arsip', 'selesai'] }).map((r) => r.id)).toEqual([3, 4])
    expect(filterOverview(rows, { states: ['wajib', 'opsional'] }).map((r) => r.id)).toEqual([2, 4])
    expect(filterOverview(rows, { companies: [1], states: ['ada'], statuses: ['berjalan', 'arsip'] }).map((r) => r.id)).toEqual([1, 3])
  })

  it('totals row: counts of every row, Σ RAP of the priced rows only, Σ RAB of readable RABs (null when none)', () => {
    const t = overviewTotals([row({ items: 4, state: 'ada', rapValue: 900, budget: 1000 }), row({ items: 2, state: 'ada', prices: false, rapValue: 999, budget: null }), row({ state: 'wajib', budget: 500 })])
    expect(t).toEqual({ projects: 3, withRap: 2, items: 6, rapValue: 900, budget: 1500 })
    expect(overviewTotals([row({ prices: false })])).toEqual({ projects: 1, withRap: 0, items: 0, rapValue: null, budget: null })
  })
})

describe('RAP item form (rap-item-form.ts)', () => {
  it('edit mode mirrors loadRap canEdit / needsReason', () => {
    expect(rapEditMode({ director: false, pm: false }, false, false)).toBe('read')
    expect(rapEditMode({ director: false, pm: true }, false, false)).toBe('edit')
    expect(rapEditMode({ director: false, pm: true }, true, false)).toBe('locked')
    expect(rapEditMode({ director: true, pm: false }, true, false)).toBe('reason')
    expect(rapEditMode({ director: true, pm: true }, false, true)).toBe('archived')
    expect(rapEditMode({ director: false, pm: false }, true, true)).toBe('read')
  })

  it('decimals: comma or dot, ≤ 2 decimals in the input format', () => {
    expect(parseDecimal('12,5')).toBe(12.5)
    expect(parseDecimal('12.25')).toBe(12.25)
    expect(parseDecimal(' ')).toBeNull()
    expect(parseDecimal('1.000,5')).toBeNaN()
    expect(parseDecimal('abc')).toBeNaN()
    expect(formatDecimalInput(12.5)).toBe('12,5')
    expect(formatDecimalInput(3)).toBe('3')
    expect(formatDecimalInput(null)).toBe('')
    expect(draftAmount('12,5', '85.000')).toBe(1_062_500)
    expect(draftAmount('1,25', '3')).toBe(4) // round like the server
    expect(draftAmount('', '85.000')).toBeNull()
    expect(draftAmount('2', '1,5')).toBeNull()
  })

  it('draft of an item round-trips; a new draft defaults to pekerjaan, active', () => {
    const d = draftOf(item())
    expect(d).toMatchObject({ code: 'A.1', kind: 'pekerjaan', stageId: '3', uomId: '2', volume: '12,5', unitPrice: '85.000', weightPct: '', active: 'ya' })
    const r = parseRapDraft(d, { stageRequired: true, needsReason: false })
    expect(r.errors).toEqual({})
    expect(patchBody(item(), r.values!)).toBeNull() // unchanged → no request
    expect(draftOf(null)).toMatchObject({ code: '', kind: 'pekerjaan', active: 'ya', unitPrice: '' })
    expect(draftOf(item({ unitPrice: 0, active: false })).unitPrice).toBe('0')
    expect(draftOf(item({ active: false })).active).toBe('tidak')
  })

  it('validation messages (Indonesian) for every rule of the API contract', () => {
    const bad = parseRapDraft(
      { code: '', description: 'x'.repeat(301), kind: 'alat', stageId: '', uomId: '', volume: '1,234', unitPrice: '1,5', weightPct: '101', active: 'ya', reason: '' },
      { stageRequired: true, needsReason: true },
    )
    expect(bad.values).toBeNull()
    expect(bad.errors).toEqual({
      code: 'Kode wajib diisi.',
      description: 'Uraian maksimal 300 karakter.',
      kind: 'Jenis wajib dipilih.',
      stageId: 'Tahapan wajib untuk project konstruksi.',
      uomId: 'Satuan wajib dipilih.',
      volume: 'Volume harus > 0, maks. 2 desimal (koma untuk desimal).',
      unitPrice: 'Rupiah tanpa desimal — hapus koma dan angka di belakangnya.',
      weightPct: 'Bobot 0–100, maks. 2 desimal.',
      reason: 'RAP terkunci: isi alasan perubahan (min. 3 karakter).',
    })
    expect(parseRapDraft({ ...draftOf(null), code: 'X', description: 'Y', uomId: '2', volume: '0' }, { stageRequired: false, needsReason: false }).errors.volume).toBeDefined()
    expect(parseRapDraft({ ...draftOf(null), code: 'x'.repeat(33), description: 'Y', uomId: '2', volume: '1' }, { stageRequired: false, needsReason: false }).errors.code).toBe('Kode maksimal 32 karakter.')
  })

  it('create body: stage optional outside konstruksi, empty price = unpriced, reason only when given', () => {
    const r = parseRapDraft({ ...draftOf(null), code: ' B.2 ', description: ' Semen ', kind: 'material', uomId: '4', volume: '100', unitPrice: '' }, { stageRequired: false, needsReason: false })
    expect(createBody(r.values!)).toEqual({ code: 'B.2', description: 'Semen', kind: 'material', stageId: null, uomId: 4, volume: 100, unitPrice: null, weightPct: null })
    expect(createBody(r.values!, ' karena revisi ')).toMatchObject({ reason: 'karena revisi' })
  })

  it('patch body: only changed fields, never `kind`; deactivation = active false; price only for price roles', () => {
    const base = item()
    // locked RAP (Direktur): no reason → error first
    expect(parseRapDraft({ ...draftOf(base), volume: '13' }, { stageRequired: true, needsReason: true }).errors.reason).toBeDefined()
    // a changed `kind` in the draft is never sent (fixed once created)
    const ok = parseRapDraft({ ...draftOf(base), kind: 'material', volume: '13', unitPrice: '90.000', active: 'tidak', reason: 'Revisi gambar kerja' }, { stageRequired: true, needsReason: true })
    expect(patchBody(base, ok.values!, 'Revisi gambar kerja')).toEqual({ volume: 13, unitPrice: 90_000, active: false, reason: 'Revisi gambar kerja' })
    const clear = parseRapDraft({ ...draftOf(base), unitPrice: '', stageId: '' }, { stageRequired: false, needsReason: false })
    expect(patchBody(base, clear.values!)).toEqual({ unitPrice: null, stageId: null })
    // a reader without prices never sends unitPrice (no money key in the row)
    const noMoney = item({ unitPrice: undefined, value: undefined, realisedAmount: undefined })
    const v = parseRapDraft({ ...draftOf(noMoney), description: 'Galian tanah keras' }, { stageRequired: true, needsReason: false })
    expect(patchBody(noMoney, v.values!)).toEqual({ description: 'Galian tanah keras' })
  })

  it('used items and grand totals (active priced rows only)', () => {
    expect(itemUsed(item())).toBe(false)
    expect(itemUsed(item({ realisedAmount: 1 }))).toBe(true)
    expect(itemUsed(item({ realisedAmount: undefined, realised: 2 }))).toBe(true)
    expect(itemUsed(item({ received: 1 }))).toBe(true)
    const rows = [item({ value: 100 }), item({ value: 50, active: false }), item({ value: null }), item({ value: 25, realisedAmount: 30 })]
    expect(rapGrandTotal(rows)).toBe(125)
    expect(rapGrandTotal([item({ value: undefined })])).toBeNull()
    expect(rapRealisedTotal(rows)).toBe(30)
  })
})

describe('menu + wiring', () => {
  const base = { staffOnly: false, canSee: () => true, labelOf: (_k: unknown, s: string) => s }
  const rapItems = (roles: Role[]) =>
    resolveModules({ ...base, roles })
      .find((m) => m.id === 'proyek')!
      .sections.find((s) => s.label === 'RAP')
  it('Proyek › RAP: own section for Direktur / Admin / Finance / PM; not in the Staff menu', () => {
    for (const r of ['pk-owner', 'pk-admin', 'pk-finance', 'pk-pm'] as Role[]) expect(rapItems([r])!.items.map((i) => i.href), r).toEqual(['/admin/rap', '/admin/collections/rap-items', '/admin/collections/rap-templates'])
    const staff = resolveModules({ ...base, roles: ['pk-staff'], staffOnly: true, canSee: (_k, s) => s === 'projects' })
    expect(staff.flatMap((m) => m.sections.flatMap((s) => s.items.map((i) => i.href)))).not.toContain('/admin/rap')
    expect(moduleForPath('/admin/rap')).toBe('proyek')
    expect(moduleForPath('/admin/rap/12')).toBe('proyek')
    expect(itemIcon({ href: '/admin/rap', kind: 'view', label: 'RAP proyek' }, 'project')).toBe('tReceiptItem')
  })

  it('views are exact and in the import map', () => {
    expect(RAP_ADMIN_VIEWS.rapIndex).toMatchObject({ path: '/rap', exact: true })
    expect(RAP_ADMIN_VIEWS.rapProject).toMatchObject({ path: '/rap/:id', exact: true })
    const map = readFileSync(join(process.cwd(), 'src/app/(payload)/admin/importMap.js'), 'utf8')
    for (const v of Object.values(RAP_ADMIN_VIEWS)) expect(map).toContain(`"${v.Component}"`)
  })
})
