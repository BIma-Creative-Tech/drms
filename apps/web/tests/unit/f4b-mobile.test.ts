import { describe, expect, it } from 'vitest'

import { buildOpenApiDocument } from '@/api/v1/openapi'
import { DeviceRegister } from '@/api/v1/schemas'
import { integrityRisk } from '@/domain/devices'
import { ACCURACY_ALLOWANCE_CAP_M, attendanceTimeOf, haversineM, insideGeofence, localDateString } from '@/domain/sync/attendance'
import { SyncAttendancePayload } from '@/api/v1/schemas-sync'
import { parseEnv } from '@/lib/env'

/** F4b pure parts: device integrity signals (ADR 0010 decision 10), push flag guard (ADR 0011). */
const base = {
  DATABASE_URL: 'postgres://u:p@h:5432/d',
  PAYLOAD_SECRET: 'x'.repeat(40),
  APP_URL: 'https://drms-kas.staging.bimacreative.tech',
  OIDC_ISSUER: 'https://auth.bimacreative.tech/realms/drms-staging',
  OIDC_WEB_CLIENT_ID: 'proyekkas-web',
  OIDC_WEB_CLIENT_SECRET: 'y'.repeat(20),
  OIDC_MOBILE_CLIENT_ID: 'proyekkas-mobile',
}
const clean = { rooted: false, emulator: false, developerMode: false, adbEnabled: false }

describe('device integrity (ADR 0010 decision 10)', () => {
  it('risk = rooted, emulator or a mocked GPS fix; developer options / USB debugging alone are not a risk', () => {
    expect(integrityRisk(clean)).toBe(false)
    expect(integrityRisk({ ...clean, developerMode: true, adbEnabled: true })).toBe(false)
    expect(integrityRisk({ ...clean, mockLocation: null })).toBe(false)
    expect(integrityRisk({ ...clean, rooted: true })).toBe(true)
    expect(integrityRisk({ ...clean, emulator: true })).toBe(true)
    expect(integrityRisk({ ...clean, mockLocation: true })).toBe(true)
  })

  it('register body: integrity optional, strict, booleans only', () => {
    const id = '5b0c2f7e-2d1a-4e0b-8f5e-7a9d3c1b2e44'
    expect(DeviceRegister.safeParse({ deviceId: id, platform: 'android' }).success).toBe(true)
    expect(DeviceRegister.safeParse({ deviceId: id, platform: 'android', integrity: clean }).success).toBe(true)
    expect(DeviceRegister.safeParse({ deviceId: id, platform: 'android', integrity: { ...clean, mockLocation: null } }).success).toBe(true)
    expect(DeviceRegister.safeParse({ deviceId: id, platform: 'android', integrity: { ...clean, rooted: 'yes' } }).success).toBe(false)
    expect(DeviceRegister.safeParse({ deviceId: id, platform: 'android', integrity: { ...clean, extra: true } }).success).toBe(false)
    expect(DeviceRegister.safeParse({ deviceId: id, platform: 'android', integrity: { rooted: false } }).success).toBe(false)
  })

  it('OpenAPI documents DeviceIntegrity and the Problem code (DEVICE_REVOKED)', () => {
    const doc = buildOpenApiDocument('0.0.0') as unknown as { components: { schemas: Record<string, { properties?: Record<string, unknown> }> } }
    expect(doc.components.schemas.DeviceIntegrity).toBeDefined()
    expect(Object.keys(doc.components.schemas.Problem?.properties ?? {})).toContain('code')
    expect(Object.keys(doc.components.schemas.Device?.properties ?? {})).toEqual(expect.arrayContaining(['integrityRisk', 'integrityCheckedAt']))
  })
})

describe('PUSH_FCM_ENABLED (ADR 0011, Q-44)', () => {
  it('defaults to false; true is refused at boot while no FCM dispatcher exists; junk is refused', () => {
    expect(parseEnv(base).PUSH_FCM_ENABLED).toBe(false)
    expect(parseEnv({ ...base, PUSH_FCM_ENABLED: 'false' }).PUSH_FCM_ENABLED).toBe(false)
    expect(() => parseEnv({ ...base, PUSH_FCM_ENABLED: 'true' })).toThrow(/PUSH_FCM_ENABLED/)
    expect(() => parseEnv({ ...base, PUSH_FCM_ENABLED: 'yes' })).toThrow(/PUSH_FCM_ENABLED/)
  })
})

describe('attendance rules (F4 slice, ADR 0010 decision 8)', () => {
  it('haversine: 0.001° latitude ≈ 111 m; symmetric; same point 0', () => {
    const d = haversineM(-2.21, 113.91, -2.211, 113.91)
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(112)
    expect(haversineM(-2.211, 113.91, -2.21, 113.91)).toBeCloseTo(d, 6)
    expect(haversineM(-2.21, 113.91, -2.21, 113.91)).toBe(0)
  })

  it('geofence: radius + GPS accuracy, the accuracy allowance is capped at 50 m', () => {
    expect(ACCURACY_ALLOWANCE_CAP_M).toBe(50)
    expect(insideGeofence(100, 100, null)).toBe(true)
    expect(insideGeofence(101, 100, 0)).toBe(false)
    expect(insideGeofence(140, 100, 45)).toBe(true)
    expect(insideGeofence(151, 100, 2000)).toBe(false)
    expect(insideGeofence(150, 100, -5)).toBe(false)
  })

  it('time that counts: server online, estimate offline, else device clock flagged', () => {
    const recv = new Date('2026-09-21T04:05:11Z')
    expect(attendanceTimeOf({ timeTrust: 'server', estimatedTime: null, flags: [] }, '2026-09-21T12:00:00+08:00', recv)).toEqual({ time: recv, flags: [] })
    expect(attendanceTimeOf({ timeTrust: 'estimated', estimatedTime: '2026-09-20T23:55:11.000Z', flags: ['OFFLINE'] }, '2026-09-21T07:58:31+08:00', recv).time.toISOString()).toBe('2026-09-20T23:55:11.000Z')
    expect(attendanceTimeOf({ timeTrust: 'device_only', estimatedTime: null, flags: ['OFFLINE'] }, '2026-09-21T07:58:31+08:00', recv)).toEqual({ time: new Date('2026-09-20T23:58:31.000Z'), flags: ['DEVICE_TIME_ONLY'] })
  })

  it('local date in the company timezone (WITA): 23:55 UTC is the next day', () => {
    expect(localDateString(new Date('2026-09-20T23:55:11Z'), 'Asia/Makassar')).toBe('2026-09-21')
    expect(localDateString(new Date('2026-09-20T15:59:59Z'), 'Asia/Makassar')).toBe('2026-09-20')
  })

  it('payload: strict, project + coordinates + own selfie id; fictional example of ADR 0010 A', () => {
    const ok = { project_id: 7, lat: -2.213579, lng: 113.913542, accuracy_m: 12.5, is_mocked: false, selfie_media_id: 3, camera_lens: 'front' }
    expect(SyncAttendancePayload.safeParse(ok).success).toBe(true)
    expect(SyncAttendancePayload.safeParse({ ...ok, lat: 91 }).success).toBe(false)
    expect(SyncAttendancePayload.safeParse({ ...ok, employee_id: 4 }).success).toBe(false)
    expect(SyncAttendancePayload.safeParse({ ...ok, camera_lens: 'back' }).success).toBe(false)
    const { is_mocked: _omit, ...noMock } = ok
    expect(SyncAttendancePayload.safeParse(noMock).success).toBe(false)
  })
})
