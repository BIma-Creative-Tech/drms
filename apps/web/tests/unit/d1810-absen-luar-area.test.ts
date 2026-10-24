import { describe, expect, it } from 'vitest'

import { areaNote, selfCheckPick, type SelfCheckLocation } from '@/admin/components/absensi/AttendanceActions'

// DRMS 18/10: the selected radio's location + action (match by `type:id`). ADR 0032: no "Di luar area" entry any more —
// a Non-OnSite employee outside every registered location is told so (no pick).
const P = { lat: -2, lng: 117 }
const locations: SelfCheckLocation[] = [
  { type: 'project', id: 6, label: 'CSRBERAU CETAK SAWAH BERAU', checkIn: null, checkOut: null, lat: P.lat, lng: P.lng, radiusM: 100, nonOnsite: true },
  { type: 'cost_center', id: 2, label: 'OPS KANTOR', checkIn: null, checkOut: null, lat: P.lat - 0.01, lng: P.lng, radiusM: 100, nonOnsite: true },
]

describe('selfCheckPick', () => {
  it('regular location, then check-out, then done', () => {
    expect(selfCheckPick(locations, 'project:6').action).toBe('check_in')
    expect(selfCheckPick([{ ...locations[0]!, checkIn: '08:00' }], 'project:6').action).toBe('check_out')
    expect(selfCheckPick([{ ...locations[0]!, checkIn: '08:00', checkOut: '17:00' }], 'project:6').action).toBeNull()
    expect(selfCheckPick(locations, 'cost_center:2').loc?.label).toBe('OPS KANTOR')
  })
  it('unknown key (also an old "Di luar area" key) → no action', () => {
    expect(selfCheckPick(locations, 'site:1:luar')).toEqual({ loc: undefined, action: null })
    expect(selfCheckPick(locations, 'site:1')).toEqual({ loc: undefined, action: null })
  })
})

describe('areaNote (ADR 0032)', () => {
  it('inside a location → picked', () => {
    const r = areaNote(locations, { lat: P.lat, lng: P.lng, accuracyM: 5 })
    expect(r.pick).toBe('project:6')
    expect(r.note.tone).toBe('ok')
  })
  it('Non-OnSite outside every registered location → no pick, the refusal is announced with the nearest', () => {
    const r = areaNote(locations, { lat: P.lat + 0.2, lng: P.lng, accuracyM: 5 })
    expect(r.pick).toBeNull()
    expect(r.note.tone).toBe('warn')
    expect(r.note.text).toContain('Karyawan Non-OnSite hanya bisa absen di dalam area lokasi')
    expect(r.note.text).toContain('CSRBERAU')
  })
  it('OnSite outside → manual choice with the nearest as a hint', () => {
    const onsite = locations.map((l) => ({ ...l, nonOnsite: false }))
    const r = areaNote(onsite, { lat: P.lat + 0.2, lng: P.lng, accuracyM: 5 })
    expect(r.pick).toBeNull()
    expect(r.note.text).toContain('pilih lokasi secara manual')
  })
})
