import type { Payload, TypedUser } from 'payload'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { F2NavLinks } from '@/admin/components/F2NavLinks'
import { E2_ADMIN_VIEWS } from '@/admin/config'
import type { Role } from '@/access/roles'
import { bookWhere, canEdit, canVoid, closablePeriods, minPostingDate, parseBookQuery, parseRupiahInput, periodState, recentPeriods, voidHint } from '@/domain/cash/book'

/**
 * E2 (fase1-golive §E2): pure rules of the Kas views + menu visibility per role. The server
 * re-checks every rule (ledger.ts); these are the UI hints and the query parsing.
 */
const payload = { count: async () => ({ totalDocs: 0 }) } as unknown as Payload
async function nav(roles: Role[]): Promise<string> {
  const el = await F2NavLinks({ payload, user: { id: 5, roles, collection: 'users' } as unknown as TypedUser })
  return el ? renderToString(el) : ''
}

describe('E2 menu: Kas + Tutup buku only for Finance and Direktur (pk-owner)', () => {
  it.each([['pk-finance'], ['pk-owner']] as Array<[Role]>)('%s sees Kas and Tutup buku', async (r) => {
    const html = await nav([r])
    expect(html).toContain('data-pk-nav-link="kas"')
    expect(html).toContain('href="/admin/kas"')
    expect(html).toContain('href="/admin/tutup-buku"')
  })
  it.each([['pk-pm'], ['pk-staff'], ['pk-admin']] as Array<[Role]>)('%s does not see them', async (r) => {
    const html = await nav([r])
    expect(html).not.toContain('/admin/kas')
    expect(html).not.toContain('/admin/tutup-buku')
  })
  it('PM + Staff together still no menu', async () => {
    expect(await nav(['pk-pm', 'pk-staff'])).not.toContain('/admin/kas')
  })
  it('views are registered with exact paths (no prefix capture of /kas/baru)', () => {
    expect(E2_ADMIN_VIEWS.kasBook).toMatchObject({ path: '/kas', exact: true })
    expect(E2_ADMIN_VIEWS.kasNew.path).toBe('/kas/baru')
    expect(E2_ADMIN_VIEWS.kasEdit.path).toBe('/kas/:id/ubah')
    expect(E2_ADMIN_VIEWS.periodClose.path).toBe('/tutup-buku')
  })
})

describe('E2 book query (server-side Zod)', () => {
  it('parses valid filters', () => {
    expect(parseBookQuery({ akun: '3', periode: '2026-08', project: '7', pusat: '', arah: 'keluar', status: 'void', hal: '2' })).toEqual({ akun: 3, periode: '2026-08', project: 7, arah: 'keluar', status: 'void', hal: 2 })
  })
  it('drops invalid values one by one (never passed on)', () => {
    expect(parseBookQuery({ akun: '3; DROP', periode: '2026-8', project: '-1', arah: 'semua', status: 'deleted', hal: '0' })).toEqual({ hal: 1 })
    expect(parseBookQuery({ akun: ['4', '5'] })).toEqual({ akun: 4, hal: 1 })
    expect(parseBookQuery(undefined)).toEqual({ hal: 1 })
  })
  it('builds the where', () => {
    expect(bookWhere({ hal: 1 })).toBeUndefined()
    expect(bookWhere({ hal: 1, akun: 2, arah: 'masuk', status: 'posted' })).toEqual({ and: [{ cashAccount: { equals: 2 } }, { direction: { equals: 'in' } }, { status: { equals: 'posted' } }] })
  })
})

describe('E2 row actions mirror ledger.ts', () => {
  const e = (over: Record<string, unknown> = {}) => ({ sourceType: 'manual' as const, status: 'posted' as const, entryDate: '2026-09-10', ...over })
  it('edit: manual + posted + open period only', () => {
    expect(canEdit(e(), null)).toBe(true)
    expect(canEdit(e(), '2026-08-31')).toBe(true)
    expect(canEdit(e({ entryDate: '2026-08-31' }), '2026-08-31')).toBe(false)
    expect(canEdit(e({ status: 'void' }), null)).toBe(false)
    expect(canEdit(e({ sourceType: 'transfer' }), null)).toBe(false)
  })
  it('void: posted manual/opening; transfer/reversal/refund get a hint instead', () => {
    expect(canVoid(e())).toBe(true)
    expect(canVoid(e({ sourceType: 'opening' }))).toBe(true)
    expect(canVoid(e({ status: 'void' }))).toBe(false)
    for (const s of ['transfer', 'reversal', 'settlement_refund'] as const) {
      expect(canVoid(e({ sourceType: s }))).toBe(false)
      expect(voidHint(e({ sourceType: s }))).toBeTruthy()
    }
    expect(voidHint(e({ status: 'void' }))).toBeNull()
  })
})

describe('E2 periods', () => {
  it('closable months: after the lock month up to last month, oldest first', () => {
    expect(closablePeriods('2026-09-26', '2026-06-30')).toEqual(['2026-07', '2026-08'])
    expect(closablePeriods('2026-09-26', '2026-08-31')).toEqual([])
    expect(closablePeriods('2026-01-05', '2025-11-30')).toEqual(['2025-12'])
    const none = closablePeriods('2026-09-26', null)
    expect(none).toHaveLength(12)
    expect(none[0]).toBe('2025-09')
    expect(none.at(-1)).toBe('2026-08')
  })
  it('recent periods, state, first open posting date', () => {
    expect(recentPeriods('2026-02-10', 3)).toEqual(['2026-02', '2026-01', '2025-12'])
    expect(periodState('2026-08', '2026-09-26', '2026-08-31')).toBe('closed')
    expect(periodState('2026-09', '2026-09-26', '2026-08-31')).toBe('current')
    expect(periodState('2026-07', '2026-09-26', '2026-06-30')).toBe('open')
    expect(minPostingDate('2026-08-31')).toBe('2026-09-01')
    expect(minPostingDate('2025-12-31')).toBe('2026-01-01')
    expect(minPostingDate(null)).toBeNull()
  })
  it('Rupiah text input', () => {
    expect(parseRupiahInput('Rp 1.250.000')).toBe(1_250_000)
    expect(parseRupiahInput('0')).toBeNull()
    expect(parseRupiahInput('')).toBeNull()
    expect(parseRupiahInput('99999999999999')).toBeNull()
  })
})
