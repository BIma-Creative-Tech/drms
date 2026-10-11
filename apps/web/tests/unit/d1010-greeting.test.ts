import type { TypedUser } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { withCompanyContext } from '@/access/roles'
import { loadNavUser, navUser } from '@/admin/shell/modules-server'
import { employeeCandidates, FALLBACK_DISPLAY_NAME, pickDisplayName, resolveDisplayName } from '@/domain/user-display-name'

/** DRMS 10/10 WA-14: greet by NAME, never by email (launcher, dashboard, avatar menu, /me displayName). */
describe('pickDisplayName (pure rule)', () => {
  it('users.name → employee name → email local part → "Pengguna"', () => {
    expect(pickDisplayName({ name: '  Sari Dewi ', email: 'sari@x.test' }, 'Pegawai')).toBe('Sari Dewi')
    expect(pickDisplayName({ name: '', email: 'sari@x.test' }, ' Sari Karyawan ')).toBe('Sari Karyawan')
    expect(pickDisplayName({ name: null, email: 'budi.santoso@x.test' }, '')).toBe('budi.santoso')
    expect(pickDisplayName({ name: '   ', email: '' })).toBe(FALLBACK_DISPLAY_NAME)
    expect(pickDisplayName(null)).toBe('Pengguna')
  })
  it('never returns the full email', () => {
    expect(pickDisplayName({ email: 'a.b@c.test' })).not.toContain('@')
  })
})

describe('employeeCandidates: selected PTs first (ascending id), then the other memberships', () => {
  it('orders by selection, then PT id, de-duplicated', () => {
    const u = withCompanyContext(
      { id: 1 },
      [
        { company: 3, roles: ['pk-staff'], employee: 30 },
        { company: 1, roles: ['pk-staff'], employee: 10 },
        { company: 2, roles: ['pk-staff'], employee: null },
        { company: 4, roles: ['pk-staff'], employee: 40 },
      ],
      [4, 3],
      false,
    )
    expect(employeeCandidates(u)).toEqual([30, 40, 10])
  })
  it('a user without a company context uses its derived employee', () => {
    expect(employeeCandidates({ id: 1, employee: 9 })).toEqual([9])
    expect(employeeCandidates({ id: 1 })).toEqual([])
  })
})

describe('resolveDisplayName', () => {
  const user = (name: string | null, employee: number | null) => withCompanyContext({ id: 5, email: 'dedi.direktur@drms.test', name }, [{ company: 1, roles: ['pk-owner'], employee }], null, false)

  it('users.name wins without any lookup', async () => {
    const find = vi.fn()
    expect(await resolveDisplayName({ find } as never, user('Dedi', 7))).toBe('Dedi')
    expect(find).not.toHaveBeenCalled()
  })
  it('empty name → linked employee name of the selected PT (SYSTEM-READ of own employee ids only)', async () => {
    const find = vi.fn().mockResolvedValue({ docs: [{ id: 7, name: 'Dedi Kurniawan' }] })
    expect(await resolveDisplayName({ find } as never, user('', 7))).toBe('Dedi Kurniawan')
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ collection: 'employees', where: { id: { in: [7] } }, overrideAccess: true }))
  })
  it('no employee / failing lookup → email local part', async () => {
    expect(await resolveDisplayName({ find: vi.fn() } as never, user(null, null))).toBe('dedi.direktur')
    expect(await resolveDisplayName({ find: vi.fn().mockRejectedValue(new Error('db')) } as never, user(null, 7))).toBe('dedi.direktur')
  })
  it('navUser / loadNavUser use the resolved name (initials from it)', async () => {
    const find = vi.fn().mockResolvedValue({ docs: [{ id: 7, name: 'Dedi Kurniawan' }] })
    const nu = await loadNavUser({ find } as never, user(null, 7) as unknown as TypedUser)
    expect(nu).toMatchObject({ name: 'Dedi Kurniawan', initials: 'DK', email: 'dedi.direktur@drms.test' })
    expect(navUser({ id: 1, roles: ['pk-staff'], email: 'x.y@z.test' } as unknown as TypedUser).name).toBe('x.y')
  })
})
