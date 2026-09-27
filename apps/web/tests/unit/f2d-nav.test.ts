import type { TypedUser } from 'payload'
import { describe, expect, it } from 'vitest'

import { isStaffOnly, type Role } from '@/access/roles'
import { profileHref, resolveModules } from '@/admin/modules/registry'
import { navUser } from '@/admin/shell/modules-server'

/**
 * F2d (UAT): every panel role that signs reaches its own profile ("Profil & tanda tangan") — Owner
 * included (approvals need the profile signature, US-43). Since the Odoo-style navigation the link
 * sits in the avatar menu of the top bar (ModuleBar, data-pk-nav-link="profile", not role-gated);
 * "+ Buat pengajuan" is an item of Keuangan › Pengajuan (registry role rule).
 */
const nav = (roles: Role[]) => resolveModules({ roles, staffOnly: isStaffOnly({ roles }), canSee: () => true, labelOf: (_, s) => s })
const keys = (roles: Role[]) => nav(roles).flatMap((m) => m.sections.flatMap((s) => s.items.map((i) => i.navKey)))

describe('profile link for every signing role', () => {
  it.each([['pk-staff'], ['pk-pm'], ['pk-finance'], ['pk-admin'], ['pk-owner']] as Array<[Role]>)('%s → own profile', (role) => {
    const u = navUser({ id: 42, roles: [role], collection: 'users' } as unknown as TypedUser)
    expect(profileHref(u)).toBe('/admin/collections/users/42')
  })

  it('Owner: own profile, no "Buat pengajuan", sees Antrian Transfer', () => {
    expect(profileHref(navUser({ id: 7, roles: ['pk-owner'] } as unknown as TypedUser))).toBe('/admin/collections/users/7')
    expect(keys(['pk-owner'])).not.toContain('buat-pengajuan')
    expect(keys(['pk-owner'])).toContain('antrian-transfer')
  })

  it('creators keep "+ Buat pengajuan"', () => {
    for (const r of ['pk-staff', 'pk-pm', 'pk-finance', 'pk-admin'] as Role[]) {
      const item = nav([r])
        .flatMap((m) => m.sections.flatMap((s) => s.items))
        .find((i) => i.navKey === 'buat-pengajuan')
      expect(item?.href).toBe('/admin/collections/expense-requests/create')
      expect(item?.label).toBe('+ Buat pengajuan')
    }
  })
})
