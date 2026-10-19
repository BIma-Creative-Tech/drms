import { describe, expect, it } from 'vitest'

import { collectionAllowed, fieldAllowed } from '@/api/v1/endpoints/data-forms'

/**
 * User 2026-10-19 (phase 5 fix): Payload's sanitizePermissions collapses a document whose operations and fields are
 * all allowed into the bare `true` (an Admin on a cost center of their PT) — the APK form then showed no "Ubah" and
 * PATCH answered 403. `{ permission: true, where }` (no id) also counts as allowed.
 */
describe('data form permissions', () => {
  it('collapsed `true` = every operation and every field', () => {
    expect(collectionAllowed(true, 'update')).toBe(true)
    expect(collectionAllowed(true, 'create')).toBe(true)
    expect(fieldAllowed(true, ['name'], 'update')).toBe(true)
    expect(fieldAllowed(true, ['group', 'x'], 'create')).toBe(true)
  })

  it('object form: true / {permission} / missing', () => {
    const perms = {
      create: { permission: true, where: { company: { in: [1] } } },
      update: true,
      fields: { name: true, company: { create: true }, group: { fields: { a: { update: { permission: true } } } } },
    } as never
    expect(collectionAllowed(perms, 'create')).toBe(true)
    expect(collectionAllowed(perms, 'update')).toBe(true)
    expect(collectionAllowed(perms, 'delete')).toBe(false)
    expect(fieldAllowed(perms, ['name'], 'update')).toBe(true)
    expect(fieldAllowed(perms, ['company'], 'create')).toBe(true)
    expect(fieldAllowed(perms, ['company'], 'update')).toBe(false)
    expect(fieldAllowed(perms, ['group', 'a'], 'update')).toBe(true)
    expect(fieldAllowed(perms, ['other'], 'update')).toBe(false)
  })
})
