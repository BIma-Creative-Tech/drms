import { describe, expect, it } from 'vitest'

import { RapImportCommit, DailyReportCreate } from '@/api/v1/schemas-daily'
import { SyncDailyReportPayload, SyncItemTypeEnum } from '@/api/v1/schemas-sync'
import { weekNo, weekRangeOf } from '@/domain/daily/rules'
import { isQty, isQty0, itemPct, normUom, stagePct, stockOf } from '@/domain/rap/rules'
import { buildRapWorkbook, parseRapWorkbook } from '@/domain/rap/workbook'

/** P3 konstruksi RAP + Laporan Harian (owner decisions 2026-10-10): pure rules, Excel round trip, contract. */
describe('P3 RAP rules', () => {
  it('quantities: > 0 (RAP volume) / ≥ 0 (report value), max. 2 decimals', () => {
    expect(isQty(1.25)).toBe(true)
    expect(isQty(0)).toBe(false)
    expect(isQty(1.255)).toBe(false)
    expect(isQty0(0)).toBe(true)
    expect(isQty0(-1)).toBe(false)
  })

  it('item % = min(realised / volume, 1) — over-RAP volume is capped', () => {
    expect(itemPct(50, 200)).toBe(25)
    expect(itemPct(250, 200)).toBe(100)
    expect(itemPct(-5, 200)).toBe(0)
    expect(itemPct(5, 0)).toBe(0)
  })

  it('stage %: value-weighted when every active work item is priced, else equal; inactive items ignored', () => {
    const a = { volume: 100, realised: 100, unitPrice: 1000, active: true } // value 100 000, done
    const b = { volume: 100, realised: 0, unitPrice: 3000, active: true } // value 300 000, not started
    expect(stagePct([a, b])).toEqual({ pct: 25, basis: 'value' })
    expect(stagePct([a, { ...b, unitPrice: null }])).toEqual({ pct: 50, basis: 'equal' })
    expect(stagePct([a, { ...b, active: false }])).toEqual({ pct: 100, basis: 'value' })
    expect(stagePct([])).toEqual({ pct: 0, basis: 'none' })
  })

  it('stock = received − used; uom aliases', () => {
    expect(stockOf(10, 12.5)).toBe(-2.5)
    expect(normUom('m³')).toBe('M3')
    expect(normUom(' sak ')).toBe('SAK')
    expect(normUom('Orang Hari')).toBe('OH')
  })
})

describe('P3 "Minggu ke-N" (Mon–Sun from the project start)', () => {
  it('week 1 = the Mon–Sun week of the start date', () => {
    // 2026-10-07 is a Wednesday → week 1 = 2026-10-05 … 2026-10-11
    expect(weekNo('2026-10-07', '2026-10-05')).toBe(1)
    expect(weekNo('2026-10-07', '2026-10-11')).toBe(1)
    expect(weekNo('2026-10-07', '2026-10-12')).toBe(2)
    expect(weekNo('2026-10-07', '2026-11-01')).toBe(4)
    expect(weekRangeOf('2026-10-07', 1)).toEqual({ from: '2026-10-05', to: '2026-10-11' })
    expect(weekRangeOf('2026-10-07', 3)).toEqual({ from: '2026-10-19', to: '2026-10-25' })
  })
})

describe('P3 RAP Excel', () => {
  const rows = [
    { code: 'A.1', description: 'Galian tanah pondasi', stageName: 'Pekerjaan tanah', kind: 'pekerjaan' as const, uomCode: 'M3', volume: 120.5, unitPrice: 85000, weightPct: null },
    { code: 'B.1', description: 'Semen 50 kg', stageName: 'Struktur', kind: 'material' as const, uomCode: 'SAK', volume: 300, unitPrice: null, weightPct: null },
  ]

  it('template round trip: what we write is what we read', () => {
    const parsed = parseRapWorkbook(buildRapWorkbook(['M3', 'SAK'], rows))
    expect(parsed.issues).toEqual([])
    expect(parsed.rows.map(({ row: _r, ...x }) => x)).toEqual(rows)
  })

  it('an empty template is an error, not an empty RAP', () => {
    expect(parseRapWorkbook(buildRapWorkbook(['M3'])).issues[0]?.message).toMatch(/Tidak ada baris/)
  })

  it('row errors: duplicate code, bad kind, volume with 3 decimals', () => {
    const bad = [rows[0]!, { ...rows[0]!, volume: 1.234 }, { ...rows[1]!, kind: 'alat' as never }]
    const { issues } = parseRapWorkbook(buildRapWorkbook(['M3', 'SAK'], bad))
    expect(issues.some((i) => i.row === 3 && i.column === 'kode')).toBe(true) // A.1 twice
    expect(issues.some((i) => i.row === 3 && i.column === 'volume')).toBe(true) // 1.234
    expect(issues.some((i) => i.row === 4 && i.column === 'jenis')).toBe(true)
  })

  it('garbage bytes → a readable message', () => {
    expect(parseRapWorkbook(new Uint8Array([1, 2, 3])).issues[0]?.message).toMatch(/xlsx/)
  })
})

describe('P3 contract', () => {
  it('daily_report.upsert is a sync item type; payload is strict', () => {
    expect(SyncItemTypeEnum.options).toContain('daily_report.upsert')
    expect(SyncDailyReportPayload.safeParse({ project_id: 1, work: [{ rap_item_id: 2, qty: 3.5 }] }).success).toBe(true)
    expect(SyncDailyReportPayload.safeParse({ project_id: 1, work: [{ rap_item_id: 2, qty: 3.555 }] }).success).toBe(false)
    expect(SyncDailyReportPayload.safeParse({ project_id: 1, bogus: true }).success).toBe(false)
  })

  it('create body: weather enum, ≤ 10 photos, hours 0–24', () => {
    expect(DailyReportCreate.safeParse({ projectId: 1, weather: { morning: 'hujan' }, rainHours: 2.5 }).success).toBe(true)
    expect(DailyReportCreate.safeParse({ projectId: 1, weather: { morning: 'salju' } }).success).toBe(false)
    expect(DailyReportCreate.safeParse({ projectId: 1, rainHours: 25 }).success).toBe(false)
    expect(DailyReportCreate.safeParse({ projectId: 1, photoIds: Array.from({ length: 11 }, (_, i) => i + 1) }).success).toBe(false)
  })

  it('import commit needs the preview sha256', () => {
    expect(RapImportCommit.safeParse({ fileHash: 'a'.repeat(64) }).success).toBe(true)
    expect(RapImportCommit.safeParse({ fileHash: 'xyz' }).success).toBe(false)
  })
})
