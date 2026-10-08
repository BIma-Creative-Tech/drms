import { describe, expect, it } from 'vitest'

import { overridePromptOf } from '@/admin/components/kas/override'
import { problemExtra } from '@/api/v1/http'
import { closablePeriods, parseRupiahInput, recentPeriods } from '@/domain/cash/book'
import { CodedError } from '@/domain/coded-error'
import { shortfallAllowedActions, shortfallCeiling, shortfallCheck, type ShortfallCtx } from '@/domain/expense/settlement-rules'
import { isDbGuardError, pgCode, pgMessage } from '@/lib/pg-error'
import { CASH_MINUS_MESSAGE, groupRupiah, isImmediateRupiahError, parseRupiah } from '@/lib/rupiah-input'

/**
 * QA report 2026-10-08 — keuangan: pure rules (QA-03/QA-12 Rupiah input, QA-05 pg error unwrap,
 * QA-30 closable months, QA-04/QA-17 confirmation prompts, QA-06 / ADR 0019 tolerance + decisions).
 */
describe('QA-03 / QA-12 — shared Rupiah parser', () => {
  it('accepts digits, "Rp" prefix and dot thousands groups', () => {
    expect(parseRupiah('1250000')).toEqual({ value: 1_250_000, error: null, code: null })
    expect(parseRupiah('1.250.000').value).toBe(1_250_000)
    expect(parseRupiah('Rp 1.250.000').value).toBe(1_250_000)
    expect(parseRupiah('  rp.15.000 ').value).toBe(15_000)
    expect(parseRupiah('007').value).toBe(7)
    expect(parseRupiah('')).toEqual({ value: null, error: null, code: null })
    expect(parseRupiah('   ').value).toBeNull()
  })

  it('"1.000,50" is refused (decimal) — never 100050', () => {
    const r = parseRupiah('1.000,50')
    expect(r.value).toBeNull()
    expect(r.code).toBe('decimal')
    expect(r.error).toContain('Rupiah tanpa desimal')
    expect(parseRupiah('1000,5').code).toBe('decimal')
    expect(parseRupiah('1,000').code).toBe('decimal')
  })

  it('"-5000" is refused (minus) — never a cash-in of 5000; the cash form names "Kas keluar"', () => {
    expect(parseRupiah('-5000')).toMatchObject({ value: null, code: 'minus', error: 'Nominal tidak boleh negatif.' })
    expect(parseRupiah('-5.000', { minusMessage: CASH_MINUS_MESSAGE }).error).toBe('Gunakan jenis Kas keluar, bukan tanda minus.')
    expect(parseRupiah('5000-').code).toBe('minus')
    expect(parseRupiah('−5000').code).toBe('minus')
  })

  it('other characters, bad groups, zero and overflow are refused with a message', () => {
    expect(parseRupiah('12a00').code).toBe('char')
    expect(parseRupiah('1 000').code).toBe('char')
    expect(parseRupiah('1e6').code).toBe('char')
    expect(parseRupiah('1.50').code).toBe('group')
    expect(parseRupiah('1.0000').code).toBe('group')
    expect(parseRupiah('.500').code).toBe('group')
    expect(parseRupiah('0').code).toBe('zero')
    expect(parseRupiah('0', { allowZero: true }).value).toBe(0)
    expect(parseRupiah('99999999999999').code).toBe('big')
    expect(parseRupiah('9.999.999.999.999').value).toBe(9_999_999_999_999)
    for (const s of ['1.000,50', '-5000', '12a', '1.50', '0', '99999999999999']) expect(parseRupiah(s).error).toEqual(expect.any(String))
  })

  it('immediate vs on-blur errors; grouping; legacy parseRupiahInput keeps its contract', () => {
    expect(['decimal', 'minus', 'char', 'big'].every((c) => isImmediateRupiahError(c as never))).toBe(true)
    expect(isImmediateRupiahError('group')).toBe(false)
    expect(isImmediateRupiahError('zero')).toBe(false)
    expect(isImmediateRupiahError(null)).toBe(false)
    expect(groupRupiah(1_250_000)).toBe('1.250.000')
    expect(groupRupiah(999)).toBe('999')
    expect(parseRupiahInput('Rp 1.250.000')).toBe(1_250_000)
    expect(parseRupiahInput('1.000,50')).toBeNull()
    expect(parseRupiahInput('-5000')).toBeNull()
    expect(parseRupiahInput('0')).toBeNull()
  })
})

describe('QA-05 — pg error codes through the drizzle wrapper', () => {
  const pg = Object.assign(new Error('cash_entries: entry date … before the opening balance date'), { code: '42501' })
  const wrapped = Object.assign(new Error('Failed query: insert into "cash_entries" …'), { cause: pg })

  it('reads the SQLSTATE of the error or of its cause', () => {
    expect(pgCode(pg)).toBe('42501')
    expect(pgCode(wrapped)).toBe('42501')
    expect(pgCode({ cause: { cause: { code: '23514' } } })).toBe('23514')
    expect(pgCode(new Error('x'))).toBeUndefined()
    expect(pgCode({ code: 'ECONNREFUSED' })).toBeUndefined()
    expect(pgCode({ code: 'ECONNREFUSED', cause: { code: '23505' } })).toBe('23505')
    expect(pgCode(null)).toBeUndefined()
  })

  it('guard codes → 409 class; other SQLSTATEs are not guards; messages from the cause', () => {
    expect(isDbGuardError(wrapped)).toBe(true)
    for (const c of ['42501', '23505', '23514', 'P0001']) expect(isDbGuardError({ cause: { code: c } })).toBe(true)
    expect(isDbGuardError({ cause: { code: '40001' } })).toBe(false)
    expect(isDbGuardError(new Error('boom'))).toBe(false)
    expect(pgMessage(wrapped)).toContain('opening balance date')
    expect(pgMessage(pg)).toContain('opening balance date')
  })
})

describe('QA-04 / QA-06 / QA-17 — coded refusals carry plain figures only', () => {
  it('problemExtra keeps scalars, drops RFC 9457 members and objects', () => {
    expect(problemExtra({ balance: 100, after: -50, cashAccountId: 3, status: 200, title: 'x', code: 'y', detail: 'z', nested: { a: 1 }, list: [1], ok: true, n: null })).toEqual({
      balance: 100,
      after: -50,
      cashAccountId: 3,
      ok: true,
      n: null,
    })
    expect(problemExtra(null)).toEqual({})
    expect(problemExtra([1, 2])).toEqual({})
    expect(problemExtra({ 'bad key': 1, ['x'.repeat(50)]: 2 })).toEqual({})
  })

  it('CodedError is a public 409 with code and extras', () => {
    const e = new CodedError(409, 'Saldo akan minus', 'CASH_OVERDRAFT_CONFIRM_REQUIRED', { balance: 10, after: -5 })
    expect(e.status).toBe(409)
    expect(e.isPublic).toBe(true)
    expect(e.pkCode).toBe('CASH_OVERDRAFT_CONFIRM_REQUIRED')
    expect(e.pkExtra).toEqual({ balance: 10, after: -5 })
  })

  it('confirmation prompts: overdraft with amounts, unverified account with the destination; others → null', () => {
    const o = overridePromptOf(409, { code: 'CASH_OVERDRAFT_CONFIRM_REQUIRED', balance: 15_000_000, after: -985_000_000 })
    expect(o?.flag).toBe('confirmOverdraft')
    expect(o?.lines[0]).toBe('Saldo saat ini Rp 15.000.000; sesudah transaksi ini -Rp 985.000.000.')
    const u = overridePromptOf(409, { code: 'BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED', bankName: 'Mandiri', accountNo: '123', accountHolder: 'Budi' })
    expect(u?.flag).toBe('confirmUnverifiedAccount')
    expect(u?.lines[0]).toContain('Mandiri · 123 · Budi')
    expect(overridePromptOf(409, { code: 'SHORTFALL_REAPPROVAL_REQUIRED' })).toBeNull()
    expect(overridePromptOf(400, { code: 'CASH_OVERDRAFT_CONFIRM_REQUIRED' })).toBeNull()
    expect(overridePromptOf(409, null)).toBeNull()
    expect(overridePromptOf(409, { code: 'CASH_OVERDRAFT_CONFIRM_REQUIRED', title: 'Saldo minus' })?.lines[0]).toBe('Saldo minus')
  })
})

describe('QA-30 — Tutup buku starts at the books start (earliest opening-balance date)', () => {
  it('closable months never before the go-live month; lock date still moves forward', () => {
    expect(closablePeriods('2026-10-08', null)).toHaveLength(12)
    expect(closablePeriods('2026-10-08', null, 12, '2026-10-01')).toEqual([])
    expect(closablePeriods('2026-12-08', null, 12, '2026-10-01')).toEqual(['2026-10', '2026-11'])
    expect(closablePeriods('2026-12-08', null, 12, '2026-10-15')).toEqual(['2026-10', '2026-11'])
    expect(closablePeriods('2026-12-08', '2026-10-31', 12, '2026-10-01')).toEqual(['2026-11'])
    expect(closablePeriods('2026-12-08', '2026-06-30', 12, '2025-01-01')).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])
  })

  it('listed months: from the books start, the current month always shown', () => {
    expect(recentPeriods('2026-10-08', 13, '2026-10-01')).toEqual(['2026-10'])
    expect(recentPeriods('2026-12-08', 13, '2026-10-01')).toEqual(['2026-12', '2026-11', '2026-10'])
    expect(recentPeriods('2026-10-08', 13, '2027-01-01')).toEqual(['2026-10'])
    expect(recentPeriods('2026-10-08', 3)).toEqual(['2026-10', '2026-09', '2026-08'])
  })
})

describe('QA-06 / ADR 0019 — shortfall tolerance and re-approval rule', () => {
  it('ceiling = approved + ⌊approved × tol / 100⌋ (default 10 %, clamped 0–100)', () => {
    expect(shortfallCeiling(1_350_000, 10)).toBe(1_485_000)
    expect(shortfallCeiling(1_350_000, 0)).toBe(1_350_000)
    expect(shortfallCeiling(1_350_000, null)).toBe(1_485_000)
    expect(shortfallCeiling(1_000_001, 10)).toBe(1_100_001)
    expect(shortfallCeiling(1_000, 150)).toBe(2_000)
    expect(shortfallCeiling(1_000, -5)).toBe(1_000)
    expect(shortfallCeiling(999, 7.5)).toBe(1_073)
  })

  it('QA report case: +7.5 % within 10 % → allowed; with tolerance 5 % → re-approval; approved total covers', () => {
    const base = { approvedAmount: 1_350_000, transferredTotal: 1_350_000, shortfall: 101_000 }
    expect(shortfallCheck({ ...base, tolerancePct: 10 })).toMatchObject({ totalAfter: 1_451_000, ceiling: 1_485_000, aboveTolerance: false, allowed: true })
    expect(shortfallCheck({ ...base, tolerancePct: 5 })).toMatchObject({ ceiling: 1_417_500, aboveTolerance: true, covered: false, allowed: false })
    expect(shortfallCheck({ ...base, tolerancePct: 5, approval: { status: 'approved', amount: 1_451_000 } })).toMatchObject({ covered: true, allowed: true })
    expect(shortfallCheck({ ...base, tolerancePct: 5, approval: { status: 'approved', amount: 1_450_000 } }).allowed).toBe(false)
    for (const status of ['pending_ack', 'pending_approval', 'rejected'] as const) expect(shortfallCheck({ ...base, tolerancePct: 5, approval: { status, amount: 9e9 } }).allowed).toBe(false)
    expect(shortfallCheck({ ...base, shortfall: 0, tolerancePct: 0 }).allowed).toBe(true)
  })

  it('decisions: Direktur acknowledges, Finance approves; G1, one position per person, ADR 0013 roles', () => {
    const ctx = (over: Partial<ShortfallCtx>): ShortfallCtx => ({ status: 'pending_ack', selfInvolved: false, isAcknowledger: false, matchesCurrentStep: false, alreadyDecided: false, lacksDecisionRole: false, ...over })
    expect(shortfallAllowedActions(ctx({ isAcknowledger: true }))).toEqual(['acknowledge', 'reject'])
    expect(shortfallAllowedActions(ctx({ status: 'pending_approval', matchesCurrentStep: true }))).toEqual(['approve', 'reject'])
    expect(shortfallAllowedActions(ctx({ status: 'pending_approval', isAcknowledger: true }))).toEqual([])
    expect(shortfallAllowedActions(ctx({ isAcknowledger: true, selfInvolved: true }))).toEqual([])
    expect(shortfallAllowedActions(ctx({ isAcknowledger: true, alreadyDecided: true }))).toEqual([])
    expect(shortfallAllowedActions(ctx({ isAcknowledger: true, lacksDecisionRole: true }))).toEqual([])
    for (const status of ['approved', 'rejected', null] as const) expect(shortfallAllowedActions(ctx({ status, isAcknowledger: true, matchesCurrentStep: true }))).toEqual([])
  })
})
