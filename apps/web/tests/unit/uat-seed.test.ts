import { describe, expect, it } from 'vitest'

import { parseUatUsers } from '@/seed/uat-seed'

// Fictional test accounts (".test" domain) — the real list is passed at run time via UAT_USERS.
const valid = [
  { email: 'Staff.Uji@Proyekkas.test ', name: 'Staff Uji', role: 'pk-staff', keycloakSub: '4b117d94-7854-49de-973b-964e0fc9a926' },
  { email: 'pm.uji@proyekkas.test', name: 'PM Uji', role: 'pk-pm', keycloakSub: '74782f69-8989-42dc-bb1b-a85a75b2ca28' },
]

describe('UAT_USERS parsing', () => {
  it('accepts a valid list and normalises emails', () => {
    const r = parseUatUsers(JSON.stringify(valid))
    expect(r.map((u) => u.email)).toEqual(['staff.uji@proyekkas.test', 'pm.uji@proyekkas.test'])
  })

  it('rejects missing, non-JSON, wrong-shape, bad role/sub/email, duplicates and missing staff/pm — without echoing input', () => {
    expect(() => parseUatUsers(undefined)).toThrow(/UAT_USERS is required/)
    expect(() => parseUatUsers('  ')).toThrow(/UAT_USERS is required/)
    expect(() => parseUatUsers('[{secret')).toThrow(/not valid JSON/)
    const bad = (list: unknown) => () => parseUatUsers(JSON.stringify(list))
    expect(bad({})).toThrow(/invalid/)
    expect(bad([{ ...valid[0], role: 'pk-admin' }, valid[1]])).toThrow(/0\.role/)
    expect(bad([{ ...valid[0], keycloakSub: 'not-a-uuid' }, valid[1]])).toThrow(/0\.keycloakSub/)
    expect(bad([{ ...valid[0], email: 'nope' }, valid[1]])).toThrow(/0\.email/)
    expect(bad([{ ...valid[0], extra: 1 }, valid[1]])).toThrow(/invalid/)
    expect(bad([valid[0], { ...valid[1], role: 'pk-staff' }])).toThrow(/duplicate role/)
    expect(bad([valid[0], { ...valid[1], keycloakSub: valid[0]!.keycloakSub }])).toThrow(/duplicate keycloakSub/)
    expect(bad([valid[0], { ...valid[1], role: 'pk-owner' }])).toThrow(/pk-pm user is required/)
    // ADR 0013: up to two Finance / two Direktur (pk-owner) users; a third one is refused
    const fin = (n: number) => ({ email: `fin${n}@proyekkas.test`, name: `Fin ${n}`, role: 'pk-finance', keycloakSub: `00000000-0000-4000-8000-00000000000${n}` })
    expect(parseUatUsers(JSON.stringify([...valid, fin(1), fin(2)]))).toHaveLength(4)
    expect(bad([...valid, fin(1), fin(2), fin(3)])).toThrow(/4\.role: duplicate role \(max 2 × pk-finance\)/)
    let msg = ''
    try {
      parseUatUsers(JSON.stringify([{ ...valid[0], keycloakSub: 'secret-value' }, valid[1]]))
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).not.toContain('secret-value')
  })
})
