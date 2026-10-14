import { describe, expect, it } from 'vitest'

import { recapDay, type AttendanceFact } from '@/domain/attendance/aggregate'
import {
  ATTENDANCE_TYPE_LABEL,
  ATTENDANCE_TYPES,
  attendanceTypeOf,
  compareEligible,
  DEFAULT_ATTENDANCE_TYPE,
  detectArea,
  geofenceRequired,
  haversineM,
  insideGeofence,
  OUTSIDE_AREA_FLAG,
  OUTSIDE_AREA_LABEL,
  pickContaining,
} from '@/domain/attendance/area'
import * as legacy from '@/domain/sync/attendance'

/**
 * DRMS 13/10 A2 (ADR 0023 amendment 2026-10-13; Non-OnSite rule owner 2026-10-14): attendance type OnSite / Non-OnSite
 * — the geofence rule, the Non-OnSite resolution ("Di luar area"), the automatic area detection (pure, shared by
 * server and web client) and the recap stamp. Points are fictional.
 */
const P = { lat: -2.21, lng: 113.91 }
const loc = (key: string, lat: number | null, lng: number | null, radiusM: number | null) => ({ key, lat, lng, radiusM })

describe('attendance type', () => {
  it('two types, OnSite is the default (existing employees keep every location they could use before)', () => {
    expect(ATTENDANCE_TYPES).toEqual(['onsite', 'non_onsite'])
    expect(DEFAULT_ATTENDANCE_TYPE).toBe('onsite')
    expect(ATTENDANCE_TYPE_LABEL).toEqual({ onsite: 'Karyawan OnSite', non_onsite: 'Karyawan Non-OnSite' })
    expect(attendanceTypeOf('non_onsite')).toBe('non_onsite')
    for (const v of ['onsite', null, undefined, '', 'x']) expect(attendanceTypeOf(v)).toBe('onsite')
  })

  it('OnSite needs the fix inside the location; Non-OnSite has no location restriction', () => {
    expect(geofenceRequired('onsite')).toBe(true)
    expect(geofenceRequired('non_onsite')).toBe(false)
    expect(OUTSIDE_AREA_LABEL).toBe('Di luar area')
  })
})

describe('Non-OnSite resolution (pickContaining)', () => {
  const cands = [
    { key: 'site:1', lat: P.lat, lng: P.lng, radiusM: 100 },
    { key: 'project:7', lat: P.lat - 0.0004, lng: P.lng, radiusM: 120 },
  ]
  it('the requested location when the fix is inside it, even if another one is nearer', () => {
    expect(pickContaining('site:1', cands, { lat: P.lat - 0.0003, lng: P.lng })!.key).toBe('site:1')
  })
  it('else the nearest registered location containing the fix (the request named another / none)', () => {
    expect(pickContaining('cost_center:9', cands, { lat: P.lat - 0.0003, lng: P.lng })!.key).toBe('project:7')
    expect(pickContaining(null, cands, { lat: P.lat - 0.0001, lng: P.lng })!.key).toBe('site:1')
  })
  it('outside every registered location → null ("Di luar area")', () => {
    expect(pickContaining('site:1', cands, { lat: P.lat + 0.05, lng: P.lng })).toBeNull()
    expect(pickContaining('site:1', [], { lat: P.lat, lng: P.lng })).toBeNull()
  })
})

describe('recap stamp "Di luar area"', () => {
  it('the stamp and the day carry it; inside stamps stay unchanged (no extra key)', () => {
    const base = { employeeId: 1, localDate: '2026-10-14', source: 'self' as const, recordedByName: null, corrected: false, schedule: null, offline: false }
    const loc = { type: 'site' as const, id: 3, code: 'HO', name: 'Kantor Pusat' }
    const facts: AttendanceFact[] = [
      { ...base, id: 10, kind: 'check_in', time: new Date('2026-10-14T00:05:00Z'), location: loc, flags: [] },
      { ...base, id: 11, kind: 'check_out', time: new Date('2026-10-14T09:00:00Z'), location: loc, flags: [OUTSIDE_AREA_FLAG], outsideArea: true },
    ]
    const d = recapDay({ date: '2026-10-14', facts, holidayName: null, fallbackSchedule: null, today: '2026-10-14', timeZone: 'Asia/Makassar' })
    expect(d.locations).toHaveLength(1)
    expect(d.locations[0]!.checkIn).toEqual({ id: 10, time: '2026-10-14T00:05:00.000Z', source: 'self', corrected: false })
    expect(d.locations[0]!.checkOut).toMatchObject({ id: 11, outsideArea: true })
    expect(d.flags).toContain(OUTSIDE_AREA_FLAG)
    expect(d.status).toBe('selesai')
  })
})

describe('detectArea (auto-detect, nearest match)', () => {
  it('one geofence contains the fix → that location; the nearest is reported too', () => {
    const d = detectArea([loc('far', -1.2, 116.8, 100), loc('p', P.lat, P.lng, 100)], { lat: P.lat - 0.0002, lng: P.lng, accuracyM: 5 })
    expect(d.inside.map((m) => m.key)).toEqual(['p'])
    expect(d.inside[0]!.distanceM).toBe(22)
    expect(d.nearest!.key).toBe('p')
  })

  it('overlapping geofences → all containing ones, nearest first; equal distance keeps the list order', () => {
    const d = detectArea([loc('p', P.lat, P.lng, 100), loc('cc', P.lat - 0.0004, P.lng, 120)], { lat: P.lat - 0.0003, lng: P.lng, accuracyM: 5 })
    expect(d.inside.map((m) => m.key)).toEqual(['cc', 'p'])
    const tie = detectArea([loc('home', P.lat, P.lng, 100), loc('twin', P.lat, P.lng, 100)], { lat: P.lat, lng: P.lng })
    expect(tie.inside.map((m) => m.key)).toEqual(['home', 'twin'])
  })

  it('outside every geofence → nothing inside, the nearest as a hint; locations without a point are ignored', () => {
    const d = detectArea([loc('nopoint', null, null, 100), loc('p', P.lat, P.lng, 100)], { lat: P.lat - 0.0012, lng: P.lng, accuracyM: 8 })
    expect(d.inside).toEqual([])
    expect(d.nearest).toMatchObject({ key: 'p', distanceM: 133 })
    expect(detectArea([loc('nopoint', null, null, null)], { lat: 0, lng: 0 }).nearest).toBeNull()
  })

  it('same distance / accuracy allowance (capped 50 m) as the server check', () => {
    const near = { lat: P.lat - 0.0012, lng: P.lng } // 133 m
    expect(detectArea([loc('p', P.lat, P.lng, 100)], { ...near, accuracyM: 40 }).inside).toHaveLength(1)
    expect(detectArea([loc('p', P.lat, P.lng, 100)], { ...near, accuracyM: 2000 }).inside).toHaveLength(1) // 133 ≤ 150
    expect(detectArea([loc('p', P.lat, P.lng, 100)], { lat: P.lat - 0.0016, lng: P.lng, accuracyM: 2000 }).inside).toHaveLength(0) // 178 > 150
    expect(insideGeofence(133, 100, 40)).toBe(true)
    // the sync helpers re-export the same functions (one implementation)
    expect(legacy.haversineM).toBe(haversineM)
    expect(legacy.insideGeofence).toBe(insideGeofence)
  })
})

describe('eligible list order', () => {
  it('home site, head office, other sites, projects, cost centers; then by code', () => {
    const rows = [
      { kind: 'cost_center' as const, code: 'CC-1' },
      { kind: 'project' as const, code: 'P-2' },
      { kind: 'site' as const, code: 'CAB-2' },
      { kind: 'project' as const, code: 'P-1' },
      { kind: 'site' as const, code: 'HO', isHeadOffice: true },
      { kind: 'site' as const, code: 'CAB-9', home: true },
    ]
    expect([...rows].sort(compareEligible).map((r) => r.code)).toEqual(['CAB-9', 'HO', 'CAB-2', 'P-1', 'P-2', 'CC-1'])
  })
})
