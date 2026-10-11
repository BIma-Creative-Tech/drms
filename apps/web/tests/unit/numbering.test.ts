import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SEQUENCES,
  formatDocNo,
  localDateInTz,
  parseBusinessDate,
  patternError,
  periodKey,
  validatePattern,
} from '@/domain/numbering'

const EXPENSE_REQUEST_SEQUENCE = DEFAULT_SEQUENCES.find((s) => s.docType === 'expense_request')!

describe('numbering (ADR 0007)', () => {
  it('D5 default: first PB number for 2026-09-23 is PB/DRMS/2609/0229 (paper series continues, PT code inside)', () => {
    const d = parseBusinessDate('2026-09-23')
    expect(formatDocNo(EXPENSE_REQUEST_SEQUENCE, EXPENSE_REQUEST_SEQUENCE.startAt, d, 'DRMS')).toBe('PB/DRMS/2609/0229')
  })

  it('still reproduces the paper form number 228/PB-DRMS/20/IX/2026 with the old client pattern (admin-configurable)', () => {
    expect(formatDocNo({ pattern: '{seq}/PB-{COMPANY}/{DD}/{MM_ROMAN}/{YYYY}', padding: 0 }, 228, parseBusinessDate('2026-09-20'), 'DRMS')).toBe('228/PB-DRMS/20/IX/2026')
  })

  it('evaluates date tokens in Asia/Makassar, not UTC', () => {
    // 2026-09-22T16:30Z = 2026-09-23 00:30 WITA
    expect(localDateInTz(new Date('2026-09-22T16:30:00Z'), 'Asia/Makassar')).toEqual({ year: 2026, month: 9, day: 23 })
    expect(localDateInTz(new Date('2026-09-22T15:59:59Z'), 'Asia/Makassar')).toEqual({ year: 2026, month: 9, day: 22 })
  })

  it('pads and supports YY/MM tokens', () => {
    const d = parseBusinessDate('2026-01-05')
    expect(formatDocNo({ pattern: 'TRF/{YY}{MM}/{seq}', padding: 4 }, 7, d, 'DRMS')).toBe('TRF/2601/0007')
    expect(formatDocNo({ pattern: '{seq}/{MM_ROMAN}', padding: 0 }, 1, parseBusinessDate('2026-12-01'), 'X')).toBe('1/XII')
  })

  it('period keys per reset policy', () => {
    const d = parseBusinessDate('2026-09-23')
    expect(periodKey('never', d)).toBe('ALL')
    expect(periodKey('yearly', d)).toBe('2026')
    expect(periodKey('monthly', d)).toBe('2026-09')
  })

  it('rejects unsafe patterns and inputs', () => {
    expect(() => validatePattern('PB/{YYYY}', 'never')).toThrow()
    expect(() => validatePattern('{seq}', 'yearly')).toThrow()
    expect(() => validatePattern('{seq}/{YYYY}', 'monthly')).toThrow()
    expect(() => validatePattern(EXPENSE_REQUEST_SEQUENCE.pattern, 'never')).not.toThrow()
    expect(() => parseBusinessDate('2026-13-01')).toThrow()
    expect(() => parseBusinessDate('2026-02-30')).toThrow()
    expect(patternError('{seq}/{FOO}', 'never')).toMatch(/Token tidak dikenal/)
    expect(() => formatDocNo(EXPENSE_REQUEST_SEQUENCE, 0, parseBusinessDate('2026-09-23'), 'DRMS')).toThrow()
  })

  it('ships ADR 0007 defaults: PB never resets and starts at 229; others monthly TRF/KM/KK/LPJ/LP/ADD/SV/LH', () => {
    expect(EXPENSE_REQUEST_SEQUENCE).toMatchObject({ resetPolicy: 'never', startAt: 229, padding: 4 })
    for (const s of DEFAULT_SEQUENCES) expect(patternError(s.pattern, s.resetPolicy)).toBeNull()
    expect(DEFAULT_SEQUENCES.map((s) => s.docCode).sort()).toEqual(['ADD', 'KK', 'KM', 'LH', 'LP', 'LPJ', 'PB', 'SV', 'TRF'])
    // FR1 (ADR 0020): Laporan servis unit, monthly; D5: with the PT short code
    expect(formatDocNo(DEFAULT_SEQUENCES.find((s) => s.docType === 'service_report')!, 7, parseBusinessDate('2026-10-10'), 'DRMS')).toBe('SV/DRMS/2610/0007')
    expect(formatDocNo(DEFAULT_SEQUENCES.find((s) => s.docType === 'cash_out')!, 1, parseBusinessDate('2026-09-23'), 'DRMS')).toBe('KK/DRMS/2609/0001')
  })
})
