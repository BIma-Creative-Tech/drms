import { describe, expect, it } from 'vitest'

import { selfCheckPick, type SelfCheckLocation } from '@/admin/components/absensi/AttendanceActions'

// DRMS 18/10: a Non-OnSite user selecting "Di luar area" got a disabled camera + "Sudah selesai hari ini"
const locations: SelfCheckLocation[] = [
  { type: 'project', id: 6, label: 'CSRBERAU CETAK SAWAH BERAU', checkIn: null, checkOut: null, lat: -2, lng: 117, radiusM: 100 },
  { type: 'site', id: 1, label: 'Di luar area (ref. NSPKYDRMS)', checkIn: null, checkOut: null, outsideArea: true, nonOnsite: true },
]

describe('selfCheckPick', () => {
  it('finds the "Di luar area" entry by its :luar key', () => {
    const r = selfCheckPick(locations, 'site:1:luar')
    expect(r.loc?.outsideArea).toBe(true)
    expect(r.action).toBe('check_in')
  })
  it('regular location, then check-out, then done', () => {
    expect(selfCheckPick(locations, 'project:6').action).toBe('check_in')
    const inOnly = [{ ...locations[1], checkIn: '08:00' }]
    expect(selfCheckPick(inOnly, 'site:1:luar').action).toBe('check_out')
    expect(selfCheckPick([{ ...inOnly[0], checkOut: '17:00' }], 'site:1:luar').action).toBeNull()
  })
  it('unknown key → no action', () => {
    expect(selfCheckPick(locations, 'site:1')).toEqual({ loc: undefined, action: null })
  })
})
