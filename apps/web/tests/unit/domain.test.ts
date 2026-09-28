import { describe, expect, it } from 'vitest'

import { byRole } from '@/access/policies'
import { withCompanyContext } from '@/access/roles'
import { compareVersions } from '@/api/v1/http'
import { assertNoRemoteSource } from '@/collections/media/factory'
import { formatPlate, normalizePlate, PLATE_RE } from '@/domain/plates'
import { resetRateLimits, takeToken } from '@/lib/rate-limit'
import { startOfLocalDay, tzOffsetMinutes } from '@/lib/time'

describe('remote-URL upload guard (spike h)', () => {
  it('rejects any url in the input and creates without a file', () => {
    expect(() => assertNoRemoteSource({ operation: 'create', data: { url: 'http://169.254.169.254/latest', filename: 'x.jpg' }, hasFile: false })).toThrow(/URL/)
    expect(() => assertNoRemoteSource({ operation: 'create', data: { url: 'https://example.com/a.jpg' }, hasFile: true })).toThrow(/URL/)
    expect(() => assertNoRemoteSource({ operation: 'create', data: { filename: 'x.jpg' }, hasFile: false })).toThrow(/multipart/)
    expect(() => assertNoRemoteSource({ operation: 'update', data: { url: 'http://x' }, hasFile: false })).toThrow(/URL/)
    expect(() => assertNoRemoteSource({ operation: 'create', data: {}, hasFile: true })).not.toThrow()
  })
})

describe('vehicle plates (US-51)', () => {
  it('normalises and formats DA 1234 XY', () => {
    expect(normalizePlate(' da 1234-xy ')).toBe('DA1234XY')
    expect(formatPlate('DA1234XY')).toBe('DA 1234 XY')
    expect(formatPlate('B1')).toBe('B 1')
    expect(PLATE_RE.test('DA1234XY')).toBe(true)
    expect(PLATE_RE.test('DA1234XYXX')).toBe(false)
    expect(PLATE_RE.test('1234')).toBe(false)
  })
})

describe('company timezone helpers', () => {
  it('Asia/Makassar = UTC+8, local midnight = 16:00Z previous day', () => {
    expect(tzOffsetMinutes(new Date('2026-09-23T00:00:00Z'), 'Asia/Makassar')).toBe(480)
    expect(startOfLocalDay(new Date('2026-09-23T03:00:00Z'), 'Asia/Makassar').toISOString()).toBe('2026-09-22T16:00:00.000Z')
    expect(startOfLocalDay(new Date('2026-09-22T16:30:00Z'), 'Asia/Makassar').toISOString()).toBe('2026-09-22T16:00:00.000Z')
    expect(startOfLocalDay(new Date('2026-09-22T15:59:00Z'), 'Asia/Makassar').toISOString()).toBe('2026-09-21T16:00:00.000Z')
  })
})

describe('app rate limit (token bucket)', () => {
  it('allows `limit` per window, then refills', () => {
    resetRateLimits()
    const t0 = 1_000_000
    for (let i = 0; i < 3; i++) expect(takeToken('k', 3, 60_000, t0)).toBe(true)
    expect(takeToken('k', 3, 60_000, t0)).toBe(false)
    expect(takeToken('k', 3, 60_000, t0 + 20_000)).toBe(true)
    expect(takeToken('other', 3, 60_000, t0)).toBe(true)
  })
})

describe('APK minimum version (426)', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1)
    expect(compareVersions('1.2.0', '1.2')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1)
  })
})

describe('byRole access union (requirements §4)', () => {
  // ADR 0016: roles of the (only) membership in company #1; rules are evaluated per PT
  const req = (roles: string[]) => ({ user: withCompanyContext({ id: 7 }, [{ company: 1, roles: roles as never, employee: null }], null, false), context: {}, payload: {} }) as never
  it('no role → false; any true rule → true; Where rules are OR-ed', async () => {
    const access = byRole({
      'pk-admin': true,
      'pk-pm': () => ({ project: { in: [1] } }),
      'pk-staff': () => ({ createdBy: { equals: 7 } }),
    })
    expect(await access({ req: req([]) })).toBe(false)
    expect(await access({ req: req(['pk-finance']) })).toBe(false)
    expect(await access({ req: req(['pk-staff', 'pk-admin']) })).toEqual({ company: { in: [1] } })
    expect(await access({ req: req(['pk-pm']) })).toEqual({ and: [{ company: { equals: 1 } }, { project: { in: [1] } }] })
    expect(await access({ req: req(['pk-pm', 'pk-staff']) })).toEqual({
      and: [{ company: { equals: 1 } }, { or: [{ project: { in: [1] } }, { createdBy: { equals: 7 } }] }],
    })
  })
  it('ignores unknown role strings (e.g. Keycloak default roles)', async () => {
    const access = byRole({ 'pk-admin': true })
    expect(await access({ req: req(['offline_access', 'admin', 'default-roles-drms']) })).toBe(false)
  })
})
