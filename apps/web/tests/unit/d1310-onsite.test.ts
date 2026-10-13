import { describe, expect, it } from 'vitest'

import {
  ATTENDANCE_TYPE_LABEL,
  ATTENDANCE_TYPES,
  attendanceTypeOf,
  compareEligible,
  DEFAULT_ATTENDANCE_TYPE,
  detectArea,
  haversineM,
  insideGeofence,
  kindAllowedFor,
  NOT_ELIGIBLE_NON_ONSITE,
} from '@/domain/attendance/area'
import { isEligible } from '@/domain/attendance/eligibility'
import * as legacy from '@/domain/sync/attendance'

/**
 * DRMS 13/10 A2 (ADR 0023 amendment 2026-10-13): attendance type OnSite / Non-OnSite — the eligibility rule and the
 * automatic area detection (pure, shared by server and web client). Points are fictional.
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

  it('OnSite: site, project and cost center; Non-OnSite: sites (head office + branches) only', () => {
    expect(['site', 'project', 'cost_center'].map((k) => kindAllowedFor('onsite', k as never))).toEqual([true, true, true])
    expect(['site', 'project', 'cost_center'].map((k) => kindAllowedFor('non_onsite', k as never))).toEqual([true, false, false])
    expect(NOT_ELIGIBLE_NON_ONSITE).toContain('tidak termasuk area absen untuk karyawan Non-OnSite')
  })

  it('server rule: same PT AND an allowed kind (another PT is never eligible, whatever the type)', () => {
    expect(isEligible({ company: 1, type: 'onsite' }, 'project', 1)).toBe(true)
    expect(isEligible({ company: 1, type: 'onsite' }, 'project', 2)).toBe(false)
    expect(isEligible({ company: 1, type: 'onsite' }, 'site', undefined)).toBe(false)
    expect(isEligible({ company: 1, type: 'non_onsite' }, 'site', 1)).toBe(true)
    expect(isEligible({ company: 1, type: 'non_onsite' }, 'cost_center', 1)).toBe(false)
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
