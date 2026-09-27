import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { buildOpenApiDocument } from '@/api/v1/openapi'
import { narrowScope } from '@/domain/reports/registry'
import { addMonths, budgetPct, budgetTone, dateRange, daysBetween, formatPct, monthRange, niceMax, periodRange, shortRupiah } from '@/domain/reports/rules'
import { budgetImpact } from '@/domain/expense/rules'
import { csvCell, csvLine, CSV_BOM } from '@/lib/csv'
import { BusyError, heavySlotsInUse, withHeavySlot } from '@/lib/heavy-gate'
import { parseEnv } from '@/lib/env'
import { sheetData, writeXlsx, xlsxCell, xlsxEnabled } from '@/lib/xlsx'

/** F3 pure parts: KPI rules (kpi-definitions.md), CSV/XLSX export encoding, shared render gate. */

describe('K-08 budget % and colour (Komitmen basis, Q-F3-2)', () => {
  it('same rounding as the approval screen budgetImpact()', () => {
    for (const [c, b] of [
      [43_500_000, 50_000_000],
      [1, 3],
      [10_000_000, 50_000_000],
      [123_457, 999_999],
    ] as const) {
      expect(budgetPct(c, b)).toBe(budgetImpact(b, 0, c).after)
    }
    expect(budgetPct(10_000_000, 50_000_000)).toBe(20) // KPI doc test case 2: 20,00 %
    expect(budgetPct(5, 0)).toBeNull()
    expect(budgetPct(5, null)).toBeNull()
  })

  it('thresholds use ">" (85 → Aman, 85.01 → Waspada, 100 → Waspada, 100.01 → Lewat RAB)', () => {
    expect(budgetTone(85, 85, 100)).toBe('ok')
    expect(budgetTone(85.01, 85, 100)).toBe('warn')
    expect(budgetTone(100, 85, 100)).toBe('warn')
    expect(budgetTone(100.01, 85, 100)).toBe('over')
    expect(budgetTone(null, 85, 100)).toBe('none')
  })
})

describe('periods (C2/C3)', () => {
  it('month arithmetic, ranges, defaults', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-09', -11)).toBe('2025-10')
    expect(periodRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(monthRange(undefined, undefined, '2026-09-24')).toEqual({ from: '2025-10', to: '2026-09' })
    expect(monthRange('2020-01', '2026-09', '2026-09-24')).toEqual({ from: '2023-10', to: '2026-09' }) // max 36
    expect(dateRange(undefined, undefined, '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(dateRange('2026-09-30', '2026-09-01', '2026-09-24')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(dateRange('2026-13-01', 'x', '2026-09-24')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(daysBetween('2026-09-15', '2026-09-24')).toBe(9)
  })

  it('display helpers', () => {
    expect(formatPct(87)).toBe('87,00')
    expect(shortRupiah(12_000_000)).toBe('12 jt')
    expect(shortRupiah(1_447_500)).toBe('1,4 jt')
    expect(shortRupiah(950_000)).toBe('950 rb')
    expect(niceMax(12_300_000)).toBe(20_000_000)
    expect(niceMax(0)).toBe(1)
  })
})

describe('scope narrowing (C5: empty scope = nothing, PM filters intersected)', () => {
  it('office: filter becomes a one-id scope; PM: out-of-team id → empty', () => {
    expect(narrowScope({ kind: 'all' }, 7)).toEqual({ kind: 'team', projects: [7], costCenters: [] })
    expect(narrowScope({ kind: 'team', projects: [1, 2], costCenters: [5] }, 2)).toEqual({ kind: 'team', projects: [2], costCenters: [] })
    expect(narrowScope({ kind: 'team', projects: [1, 2], costCenters: [5] }, 9)).toEqual({ kind: 'team', projects: [], costCenters: [] })
    expect(narrowScope({ kind: 'team', projects: [1], costCenters: [5] }, undefined, 5)).toEqual({ kind: 'team', projects: [], costCenters: [5] })
    expect(narrowScope({ kind: 'all' }, 1, 5)).toEqual({ kind: 'team', projects: [], costCenters: [] })
    expect(narrowScope({ kind: 'all' })).toEqual({ kind: 'all' })
  })
})

describe('CSV (UTF-8 BOM, ";", CRLF, RFC 4180, formula injection)', () => {
  it('numbers stay numbers, text is quoted when needed, formulas are neutralised', () => {
    expect(CSV_BOM).toBe('﻿')
    expect(csvLine([1447500, 'Kas Kecil', null, '2026-09-20'])).toBe('1447500;Kas Kecil;;2026-09-20\r\n')
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('Soto "Mas Joko"')).toBe('"Soto ""Mas Joko"""')
    expect(csvCell('baris\nbaru')).toBe('"baris\nbaru"')
    for (const f of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx']) expect(csvCell(f).replace(/^"|"$/g, '').startsWith("'")).toBe(true)
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(csvCell(-5000)).toBe('-5000') // a negative NUMBER is data, not text
  })
})

describe('XLSX (write-excel-file 4.1.1)', () => {
  it('cell typing: amounts #,##0 numbers, dates real dates from Date.UTC, text as String', () => {
    expect(xlsxCell(1447500, 'money')).toEqual({ value: 1447500, type: Number, format: '#,##0' })
    expect(xlsxCell('2026-09-20', 'date')).toEqual({ value: new Date(Date.UTC(2026, 8, 20)), type: Date, format: 'dd/mm/yyyy' })
    expect(xlsxCell('2026-09-20 14:05:00', 'datetime')).toEqual({ value: new Date(Date.UTC(2026, 8, 20, 14, 5)), type: Date, format: 'dd/mm/yyyy hh:mm' })
    expect(xlsxCell('=1+1', 'text')).toEqual({ value: '=1+1', type: String })
    expect(xlsxCell(null, 'money')).toBeNull()
    const data = sheetData({ name: 'x', title: ['Rekap', 'PT Uji'], columns: [{ label: 'A', type: 'text' }], rows: [['a']], totals: ['T'] })
    expect(data).toHaveLength(2 + 1 + 1 + 1 + 1)
  })

  it('writes a valid workbook: numeric amounts, #,##0 and dd/mm/yyyy formats, formula-looking text as shared string', async () => {
    const buf = await writeXlsx([
      {
        name: 'Rekap Kas',
        title: ['Rekap Kas', 'PT Fiktif'],
        columns: [
          { label: 'Tanggal', type: 'date' },
          { label: 'Keterangan', type: 'text' },
          { label: 'Nominal (Rp)', type: 'money' },
        ],
        rows: [
          ['2026-09-01', '=HYPERLINK("http://evil")', 1447500],
          ['2026-09-02', 'BBM', 600000],
        ],
        totals: ['TOTAL', null, 2047500],
      },
    ])
    const files = unzipSync(new Uint8Array(buf))
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!)
    const styles = strFromU8(files['xl/styles.xml']!)
    const strings = strFromU8(files['xl/sharedStrings.xml']!)
    expect(sheet).toContain('<v>1447500</v>')
    expect(sheet).toContain('<v>46266</v>') // 2026-09-01 as Excel serial (no TZ shift)
    expect(sheet).not.toMatch(/<f>/) // no formula cell
    expect(strings).toContain('<t>=HYPERLINK("http://evil")</t>') // plain text in the shared-string table
    expect(styles).toContain('formatCode="#,##0"')
    expect(styles).toContain('formatCode="dd/mm/yyyy"')
  })

  it('EXPORT_XLSX_ENABLED switch (default on; env schema accepts true/false only)', () => {
    const prev = process.env.EXPORT_XLSX_ENABLED
    delete process.env.EXPORT_XLSX_ENABLED
    expect(xlsxEnabled()).toBe(true)
    process.env.EXPORT_XLSX_ENABLED = 'false'
    expect(xlsxEnabled()).toBe(false)
    if (prev === undefined) delete process.env.EXPORT_XLSX_ENABLED
    else process.env.EXPORT_XLSX_ENABLED = prev
    const base = {
      DATABASE_URL: 'postgres://u:p@h/db',
      PAYLOAD_SECRET: 'x'.repeat(32),
      APP_URL: 'http://localhost:3000',
      OIDC_ISSUER: 'http://kc/realms/r',
      OIDC_WEB_CLIENT_ID: 'w',
      OIDC_WEB_CLIENT_SECRET: 'x'.repeat(16),
      OIDC_MOBILE_CLIENT_ID: 'm',
      AUTH_COOKIE_INSECURE: 'true',
      NODE_ENV: 'test',
    }
    expect(parseEnv(base).EXPORT_XLSX_ENABLED).toBe(true)
    expect(parseEnv({ ...base, EXPORT_XLSX_ENABLED: 'false' }).EXPORT_XLSX_ENABLED).toBe(false)
    expect(() => parseEnv({ ...base, EXPORT_XLSX_ENABLED: 'no' })).toThrow(/EXPORT_XLSX_ENABLED/)
  })
})

describe('shared heavy-render gate (PDF + XLSX: 2 concurrent, wait → BusyError)', () => {
  it('third caller waits and times out while two slots are held', async () => {
    let release!: () => void
    const hold = new Promise<void>((r) => (release = r))
    const a = withHeavySlot(() => hold)
    const b = withHeavySlot(() => hold)
    expect(heavySlotsInUse()).toBe(2)
    await expect(withHeavySlot(async () => 1, 50)).rejects.toBeInstanceOf(BusyError)
    const c = withHeavySlot(async () => 'c', 1000)
    release()
    await Promise.all([a, b])
    expect(await c).toBe('c')
    expect(heavySlotsInUse()).toBe(0)
  })
})

describe('OpenAPI contract (F3 paths)', () => {
  it('documents dashboards and reports', () => {
    const doc = buildOpenApiDocument('0.0.0') as { paths: Record<string, unknown> }
    for (const p of ['/dashboard/owner', '/dashboard/finance', '/dashboard/pm', '/dashboard/admin', '/dashboard/me', '/reports/{code}', '/reports/{code}/{format}']) {
      expect(doc.paths[p], p).toBeTruthy()
    }
  })
})
