import { describe, expect, it } from 'vitest'

import { SyncBatch, SyncDraftUpsertPayload } from '@/api/v1/schemas-sync'
import { buildOpenApiDocument } from '@/api/v1/openapi'
import { judgeTime } from '@/domain/sync/clock'
import { assetLinks } from '@/lib/assetlinks'
import { parseCertFingerprints, parseEnv } from '@/lib/env'

/** F4 pure parts: time trust (ADR 0010 decision 7), App Links, env, sync contract schema. */
const received = new Date('2026-09-21T04:05:11Z')
const clock = { boot_id: 'b-7f3e', last_server_time: '2026-09-20T23:30:02Z', last_server_elapsed_ms: 70_202_000 }

describe('judgeTime (ADR 0010 example A)', () => {
  it('same boot → estimated = last_server_time + Δelapsed; 3 min 20 s skew is below the 5 min threshold', () => {
    const v = judgeTime({ offline: true, device_time: '2026-09-21T07:58:31+08:00', elapsed_ms: 71_711_000 }, clock, received)
    expect(v).toEqual({ timeTrust: 'estimated', estimatedTime: '2026-09-20T23:55:11.000Z', flags: ['OFFLINE'] })
  })

  it('skew above 5 min → CLOCK_SKEW', () => {
    const v = judgeTime({ offline: true, device_time: '2026-09-21T09:58:31+08:00', elapsed_ms: 71_711_000 }, clock, received)
    expect(v.flags).toEqual(['OFFLINE', 'CLOCK_SKEW'])
    expect(v.timeTrust).toBe('estimated')
  })

  it('other boot, missing reference, elapsed before the reference or an estimate in the future → device_only', () => {
    const base = { offline: true, device_time: '2026-09-21T07:58:31+08:00', elapsed_ms: 71_711_000 }
    expect(judgeTime({ ...base, boot_id: 'other' }, clock, received).timeTrust).toBe('device_only')
    expect(judgeTime(base, { boot_id: 'b-7f3e' }, received).timeTrust).toBe('device_only')
    expect(judgeTime({ ...base, elapsed_ms: 1 }, clock, received).timeTrust).toBe('device_only')
    expect(judgeTime({ ...base, elapsed_ms: 70_202_000 + 86_400_000 }, clock, received).timeTrust).toBe('device_only')
  })

  it('device clock far in the future without a reference → CLOCK_SKEW; online item → server time', () => {
    expect(judgeTime({ offline: true, device_time: '2026-09-21T06:00:00Z', elapsed_ms: 5 }, { boot_id: 'x' }, received).flags).toEqual(['OFFLINE', 'CLOCK_SKEW'])
    expect(judgeTime({ offline: false, device_time: '2020-01-01T00:00:00Z', elapsed_ms: 5 }, clock, received)).toEqual({
      timeTrust: 'server',
      estimatedTime: received.toISOString(),
      flags: [],
    })
  })
})

describe('Android App Links', () => {
  const FP = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89'

  it('fingerprints: comma separated, trimmed, upper-cased, deduplicated; malformed → null', () => {
    expect(parseCertFingerprints('')).toEqual([])
    expect(parseCertFingerprints(undefined)).toEqual([])
    expect(parseCertFingerprints(` ${FP.toLowerCase()}, ${FP} ,`)).toEqual([FP])
    expect(parseCertFingerprints('AB:CD')).toBeNull()
    expect(parseCertFingerprints(FP.replace(/:/g, ''))).toBeNull()
  })

  it('statement list shape; none without fingerprints', () => {
    expect(assetLinks('id.co.drms.proyekkas', [])).toEqual([])
    expect(assetLinks('id.co.drms.proyekkas', [FP])).toEqual([
      { relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'id.co.drms.proyekkas', sha256_cert_fingerprints: [FP] } },
    ])
  })

  it('env: default package, invalid fingerprint / package fail at boot (names only)', () => {
    const base = {
      DATABASE_URL: 'postgres://u:p@h:5432/d',
      PAYLOAD_SECRET: 'x'.repeat(40),
      APP_URL: 'https://drms-kas.staging.bimacreative.tech',
      OIDC_ISSUER: 'https://auth.bimacreative.tech/realms/drms-staging',
      OIDC_WEB_CLIENT_ID: 'proyekkas-web',
      OIDC_WEB_CLIENT_SECRET: 'y'.repeat(20),
      OIDC_MOBILE_CLIENT_ID: 'proyekkas-mobile',
    }
    const env = parseEnv(base)
    expect(env.ANDROID_APP_PACKAGE).toBe('id.co.drms.proyekkas')
    expect(env.ANDROID_APP_CERT_SHA256).toEqual([])
    expect(parseEnv({ ...base, ANDROID_APP_CERT_SHA256: FP }).ANDROID_APP_CERT_SHA256).toEqual([FP])
    expect(() => parseEnv({ ...base, ANDROID_APP_CERT_SHA256: 'nope' })).toThrow(/ANDROID_APP_CERT_SHA256/)
    expect(() => parseEnv({ ...base, ANDROID_APP_PACKAGE: 'Bad Package' })).toThrow(/ANDROID_APP_PACKAGE/)
  })
})

describe('sync contract schema', () => {
  const item = { client_uuid: '0192f5c8-1a2b-7c3d-8e4f-5a6b7c8d9e01', type: 'expense_request.draft_upsert', schema_version: 1, offline: true, device_time: '2026-09-21T07:58:31+08:00', elapsed_ms: 1, payload: {} }
  const batch = { batch_id: '0192f7a1-6c1e-7b3a-9d10-1f2e3a4b5c6d', device_id: '5b0c2f7e-2d1a-4e0b-8f5e-7a9d3c1b2e44', clock: { device_time: '2026-09-21T12:05:10+08:00', elapsed_ms: 2, boot_id: 'b' }, items: [item] }

  it('envelope per ADR 0010: strict, 1..50 items, schema_version 1, attendance types accepted', () => {
    expect(SyncBatch.safeParse(batch).success).toBe(true)
    expect(SyncBatch.safeParse({ ...batch, items: [{ ...item, type: 'attendance.check_in' }] }).success).toBe(true)
    expect(SyncBatch.safeParse({ ...batch, items: [] }).success).toBe(false)
    expect(SyncBatch.safeParse({ ...batch, items: Array(51).fill(item) }).success).toBe(false)
    expect(SyncBatch.safeParse({ ...batch, items: [{ ...item, schema_version: 2 }] }).success).toBe(false)
    expect(SyncBatch.safeParse({ ...batch, extra: 1 }).success).toBe(false)
    expect(SyncBatch.safeParse({ ...batch, items: [{ ...item, device_time: '2026-09-21 07:58' }] }).success).toBe(false)
  })

  it('draft payload: integer rupiah, strict keys', () => {
    expect(SyncDraftUpsertPayload.safeParse({ kind: 'reimburse', title: 'x', lines: [{ total: 1.5 }] }).success).toBe(false)
    expect(SyncDraftUpsertPayload.safeParse({ kind: 'reimburse', title: 'x', grand_total: 5 }).success).toBe(false)
    expect(SyncDraftUpsertPayload.safeParse({ kind: 'advance', title: 'x', lines: [{ client_uuid: item.client_uuid, total: 1000 }] }).success).toBe(true)
  })

  it('OpenAPI documents /sync/batch (bearer only) and the public /app/config', () => {
    const doc = buildOpenApiDocument('0.0.0') as unknown as { paths: Record<string, Record<string, { security?: unknown[] }>>; components: { schemas: Record<string, unknown> } }
    expect(doc.paths['/sync/batch']?.post?.security).toEqual([{ bearer: [] }])
    expect(doc.paths['/app/config']?.get?.security).toBeUndefined()
    expect(Object.keys(doc.components.schemas)).toEqual(expect.arrayContaining(['SyncBatch', 'SyncBatchResponse', 'SyncResult', 'SyncDraftUpsertPayload', 'SyncDraftDeletePayload', 'SyncDraftCopy', 'AppConfig']))
  })
})
