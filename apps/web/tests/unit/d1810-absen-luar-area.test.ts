import { describe, expect, it } from 'vitest'

import { areaNote, outsideAreaLine, selfCheckPick, type SelfCheckLocation } from '@/admin/components/absensi/AttendanceActions'

// DRMS 18/10: the selected radio's location + action (match by `type:id`). ADR 0032: no "Di luar area" entry any more;
// DRMS 26/10: a Non-OnSite employee outside every registered location may still check in / out — the nearest location
// (or the open check-in of the day) is picked and the note says it is recorded "Di luar area".
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

describe('areaNote (ADR 0032, DRMS 26/10)', () => {
  it('inside a location → picked', () => {
    const r = areaNote(locations, { lat: P.lat, lng: P.lng, accuracyM: 5 })
    expect(r.pick).toBe('project:6')
    expect(r.note.tone).toBe('ok')
  })
  it('Non-OnSite outside every registered location → the nearest is picked, "Di luar area" is announced (no refusal)', () => {
    const r = areaNote(locations, { lat: P.lat + 0.2, lng: P.lng, accuracyM: 5 })
    expect(r.pick).toBe('project:6')
    expect(r.note.tone).toBe('warn')
    expect(r.note.outside).toBe(true)
    expect(r.note.text).toContain('Di luar lokasi terdaftar — absen dicatat "Di luar area"')
    expect(r.note.text).toContain('ref. CSRBERAU')
    expect(r.note.text).not.toContain('hanya bisa absen')
  })
  it('Non-OnSite outside with an open check-in today → that location is picked (the check-out closes the pair)', () => {
    const open = [locations[0]!, { ...locations[1]!, checkIn: '08:00' }]
    const r = areaNote(open, { lat: P.lat + 0.2, lng: P.lng, accuracyM: 5 })
    expect(r.pick).toBe('cost_center:2')
    expect(selfCheckPick(open, r.pick!).action).toBe('check_out')
    expect(r.note.outside).toBe(true)
  })
  it('OnSite outside → manual choice with the nearest as a hint', () => {
    const onsite = locations.map((l) => ({ ...l, nonOnsite: false }))
    const r = areaNote(onsite, { lat: P.lat + 0.2, lng: P.lng, accuracyM: 5 })
    expect(r.pick).toBeNull()
    expect(r.note.text).toContain('pilih lokasi secara manual')
    expect(r.note.outside).toBeUndefined()
  })
})

describe('outsideAreaLine (result popup, DRMS 26/10)', () => {
  it('a "Di luar area" result names the reference location and the distance', () => {
    expect(outsideAreaLine({ outsideArea: true, location: { type: 'project', id: 6 }, distanceM: 2210 }, locations)).toBe('Tercatat "Di luar area" (ref. CSRBERAU CETAK SAWAH BERAU, 2210 m).')
    expect(outsideAreaLine({ outsideArea: true, location: { type: 'site', id: 1 } }, locations)).toBe('Tercatat "Di luar area".')
  })
  it('a normal result → no line', () => {
    expect(outsideAreaLine({ outsideArea: false, location: { type: 'project', id: 6 }, distanceM: 3 }, locations)).toBeUndefined()
    expect(outsideAreaLine(null, locations)).toBeUndefined()
  })
})
