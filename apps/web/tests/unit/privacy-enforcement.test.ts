import { describe, expect, it } from 'vitest'

import { buildOpenApiDocument } from '@/api/v1/openapi'
import { MediaSelfies } from '@/collections/media'
import { compareAppVersions, parseAppVersion } from '@/lib/app-min-version'
import {
  assertSelfieUploadAllowed,
  PRIVACY_ACK_REQUIRED,
  PRIVACY_ACK_REQUIRED_DETAIL,
  PRIVACY_CHECKED_KEY,
  PRIVACY_ENFORCEMENT_FROM_APK,
  PrivacyAckRequiredError,
  privacyEnforcementActive,
} from '@/legal/privacy-enforcement'

/**
 * ADR 0018, owner decision 2026-10-05: the server refuses attendance captures without the current privacy
 * acknowledgement only while "Versi APK minimum" ≥ 0.3.3. Pure parts: strict version parsing, the threshold,
 * the error shape and the OpenAPI documentation of the code. DB behaviour: tests/integration/privacy-enforcement.
 */
describe('version parsing (strict x.y.z)', () => {
  it('parses digits only', () => {
    expect(parseAppVersion('0.3.3')).toEqual([0, 3, 3])
    expect(parseAppVersion('10.0.12')).toEqual([10, 0, 12])
  })

  it.each([null, undefined, '', ' ', '0.3', '0.3.3.1', '0.3.3-beta', '0.3.3+4', ' 0.3.3', '0.3.3 ', 'v0.3.3', '0.3.x', 'abc', '1234567890.0.0', 3, {}])(
    'unreadable %j → null',
    (v) => {
      expect(parseAppVersion(v)).toBeNull()
    },
  )

  it('compares part by part numerically', () => {
    const v = (s: string) => parseAppVersion(s)!
    expect(compareAppVersions(v('0.3.10'), v('0.3.3'))).toBe(1)
    expect(compareAppVersions(v('0.3.3'), v('0.3.10'))).toBe(-1)
    expect(compareAppVersions(v('0.3.3'), v('0.3.3'))).toBe(0)
    expect(compareAppVersions(v('0.4.0'), v('0.3.99'))).toBe(1)
    expect(compareAppVersions(v('1.0.0'), v('0.99.99'))).toBe(1)
    expect(compareAppVersions(v('0.2.99'), v('0.3.0'))).toBe(-1)
  })
})

describe('privacyEnforcementActive (threshold 0.3.3)', () => {
  it('threshold is the first APK with the notice screen', () => {
    expect(PRIVACY_ENFORCEMENT_FROM_APK).toBe('0.3.3')
  })

  it.each([
    ['0.3.3', true],
    ['0.3.4', true],
    ['0.3.10', true],
    ['0.4.0', true],
    ['1.0.0', true],
    ['0.3.2', false],
    ['0.2.10', false],
    ['0.0.0', false],
  ])('%s → %s', (min, on) => {
    expect(privacyEnforcementActive(min)).toBe(on)
  })

  it.each([null, undefined, '', '0.3', '0.3.3-rc1', 'garbage', ' 0.4.0', 33])('missing / garbage %j → not enforced', (min) => {
    expect(privacyEnforcementActive(min)).toBe(false)
  })
})

describe('refusal shape', () => {
  it('Payload REST refusal: public 403 with the stable code and the Indonesian text', () => {
    const e = new PrivacyAckRequiredError()
    expect(e.status).toBe(403)
    expect(e.isPublic).toBe(true)
    expect(e.pkCode).toBe(PRIVACY_ACK_REQUIRED)
    expect(e.message).toBe(PRIVACY_ACK_REQUIRED_DETAIL)
    expect(PRIVACY_ACK_REQUIRED_DETAIL).toMatch(/pemberitahuan privasi/)
    expect(PRIVACY_ACK_REQUIRED_DETAIL).toMatch(/Saya mengerti/)
  })

  it('selfie collection guard: no user (system) and an already checked /api/v1 request pass without a DB read', async () => {
    const noDb = { payload: new Proxy({}, { get: () => { throw new Error('no DB expected') } }) }
    await expect(assertSelfieUploadAllowed({ ...noDb, user: null, context: {} } as never)).resolves.toBeUndefined()
    await expect(assertSelfieUploadAllowed({ ...noDb, user: { id: 5 }, context: { [PRIVACY_CHECKED_KEY]: true } } as never)).resolves.toBeUndefined()
  })

  it('media-selfies create runs the guard first (beforeOperation)', () => {
    expect(MediaSelfies.hooks?.beforeOperation?.length).toBeGreaterThan(0)
  })
})

describe('OpenAPI documents PRIVACY_ACK_REQUIRED', () => {
  const doc = JSON.stringify(buildOpenApiDocument('test'))
  it('sync error codes, sync description, media upload and Problem.code', () => {
    expect(doc.split(PRIVACY_ACK_REQUIRED).length - 1).toBeGreaterThanOrEqual(4)
    const d = buildOpenApiDocument('test') as unknown as { paths: Record<string, Record<string, { summary?: string; description?: string }>> }
    expect(d.paths['/media/{kind}']!.post!.summary).toMatch(/PRIVACY_ACK_REQUIRED/)
    expect(d.paths['/sync/batch']!.post!.description).toMatch(/PRIVACY_ACK_REQUIRED/)
  })
})
