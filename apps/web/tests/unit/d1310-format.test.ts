import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { numberText, rupiahText } from '@/admin/components/RupiahCell'
import { isPlainNumberField, isRupiahField, NUMBER_CELL, RUPIAH_CELL } from '@/admin/display-cells'
import { rp, rpShort } from '@/admin/views/viz'
import { repaymentInputErrors } from '@/domain/loans/rules'
import { shortRupiah } from '@/domain/reports/rules'
import { RUPIAH_MARK, rupiahField } from '@/fields/common'
import { formatNumber, formatRupiah, rupiahOrDash } from '@/lib/money'

/**
 * DRMS 13/10 #10: one id-ID number format (thousands '.', decimals ',') for text and tables —
 * formatNumber / formatRupiah (src/lib/money.ts), the Payload list cells (src/admin/display-cells.ts)
 * and the compact form kept for chart axes only.
 */

describe('formatNumber / formatRupiah', () => {
  it('groups thousands with "." and writes decimals with ","', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(999)).toBe('999')
    expect(formatNumber(1000)).toBe('1.000')
    expect(formatNumber(1234567)).toBe('1.234.567')
    expect(formatNumber(-12500)).toBe('-12.500')
    expect(formatNumber(1031.5, 2)).toBe('1.031,5')
    expect(formatNumber(7.25, 1)).toBe('7,3')
    expect(formatNumber(12.004, 2)).toBe('12')
    expect(formatNumber(2.5)).toBe('3') // counts round
    expect(formatNumber(-0.001, 2)).toBe('0') // no "-0"
    expect(formatNumber(Number.NaN)).toBe('—')
  })

  it('Rupiah stays "Rp 1.447.500" (integer), the optional form reads "—"', () => {
    expect(formatRupiah(1447500)).toBe('Rp 1.447.500')
    expect(formatRupiah(-5000)).toBe('-Rp 5.000')
    expect(rupiahOrDash(null)).toBe('—')
    expect(rupiahOrDash(undefined)).toBe('—')
    expect(rupiahOrDash(12_500_000)).toBe('Rp 12.500.000')
    // the custom views' rp is the same helper
    expect(rp(12_500_000)).toBe('Rp 12.500.000')
  })

  it('the compact form (chart axes / bar labels only) uses the same separators', () => {
    expect(shortRupiah(12_345_000_000_000)).toBe('12.345 M')
    expect(shortRupiah(1_447_500)).toBe('1,4 jt')
    expect(shortRupiah(950)).toBe('950')
    expect(rpShort(-12_500_000)).toBe('−Rp 12,5 jt')
  })

  it('loan repayment error names the outstanding amount in Rupiah', () => {
    const loan = { loanDate: '2026-10-01', outstanding: 2_500_000 }
    const e = repaymentInputErrors({ amount: 3_000_000, repayDate: '2026-10-10' }, loan, '2026-10-13').find((x) => x.path === 'amount')
    expect(e?.message).toBe('Nominal pengembalian melebihi sisa pinjaman (Rp 2.500.000).')
  })
})

describe('Payload list cells: Rupiah by marker, other numbers with separators', () => {
  let config: SanitizedConfig
  beforeAll(async () => {
    process.env.PK_SKIP_ENV_CHECK = 'true'
    config = await (await import('@/payload.config')).default
  })
  const cellOf = (slug: string, name: string) =>
    (config.collections.find((c) => c.slug === slug)!.flattenedFields.find((f) => f.name === name) as { admin?: { components?: { Cell?: unknown } } }).admin?.components?.Cell

  it('rupiahField() carries the marker; detection no longer needs a "(Rp)" label', () => {
    expect(rupiahField('x', 'Nominal').custom).toEqual(RUPIAH_MARK)
    expect(isRupiahField({ name: 'x', type: 'number', label: 'Nominal', custom: { ...RUPIAH_MARK } })).toBe(true)
    expect(isRupiahField({ name: 'x', type: 'number', label: 'Nominal (Rp)' })).toBe(true)
    expect(isRupiahField({ name: 'x', type: 'number', label: 'Jumlah' })).toBe(false)
    expect(isPlainNumberField({ name: 'x', type: 'number', label: 'Jumlah' })).toBe(true)
    expect(isPlainNumberField({ name: 'lat', type: 'number', label: 'Latitude' })).toBe(false)
  })

  it('the three raw money fields now use the Rupiah cell', () => {
    expect(cellOf('approval-rules', 'maxAmount')).toBe(RUPIAH_CELL)
    expect(cellOf('approval-rules', 'minAmount')).toBe(RUPIAH_CELL)
    expect(cellOf('expense-line-snapshots', 'grandTotal')).toBe(RUPIAH_CELL)
    expect(cellOf('receipts', 'taxAmount')).toBe(RUPIAH_CELL)
  })

  it('counts / quantities use the number cell; coordinates keep the raw cell', () => {
    expect(cellOf('daily-reports', 'workerCount')).toBe(NUMBER_CELL)
    expect(cellOf('rap-items', 'volume')).toBe(NUMBER_CELL)
    expect(cellOf('approvals', 'level')).toBe(NUMBER_CELL)
    expect(cellOf('projects', 'lat')).toBeUndefined()
  })

  it('cell text', () => {
    expect(rupiahText(250000)).toBe('Rp 250.000')
    expect(numberText(12000)).toBe('12.000')
    expect(numberText('7.5')).toBe('7,5')
    expect(numberText([1000, 2])).toBe('1.000, 2')
    expect(numberText(null)).toBe('—')
  })

  it('the import map resolves the number cell', () => {
    const map = readFileSync(join(process.cwd(), 'src/app/(payload)/admin/importMap.js'), 'utf8')
    expect(map).toContain(`"${NUMBER_CELL}"`)
    expect(map).toContain(`"${RUPIAH_CELL}"`)
  })
})
