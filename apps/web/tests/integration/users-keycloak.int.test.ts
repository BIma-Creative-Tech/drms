import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { KeycloakAdminError, setKeycloakAdmin } from '@/auth/keycloak-admin'

import { auditRows, companyId, getTestPayload, http, installFakeKeycloak, makeUser, webSessionCookie, type TestUser } from './helpers'

/** users ↔ Keycloak (ADR 0003 §2/§5) with a fake Admin API recording every call. */
let fake: ReturnType<typeof installFakeKeycloak>
let admin: TestUser & { _strategy: string }

beforeAll(async () => {
  fake = installFakeKeycloak()
  admin = { ...(await makeUser(['pk-admin'], { label: 'kc-admin' })), _strategy: 'oidcSession' }
})

afterAll(async () => {
  setKeycloakAdmin(undefined)
  await (await getTestPayload()).destroy()
})

describe('users ↔ Keycloak', () => {
  it('admin create → Keycloak user created first with ONLY the login role pk-user, sub stored; SMTP failure is non-fatal', async () => {
    const p = await getTestPayload()
    const u = await p.create({ collection: 'users', data: { email: 'Citra@DRMS.test', name: 'Citra' }, user: admin, overrideAccess: false })
    expect(u.email).toBe('citra@drms.test')
    const kcId = u.keycloakSub as string
    expect(kcId).toMatch(/^[0-9a-f-]{36}$/)
    expect(fake.users.get(kcId)?.roles).toEqual(new Set(['pk-user'])) // ADR 0016 §2: per-PT roles are DB only
    expect(fake.calls.map((c) => c.op)).toEqual(expect.arrayContaining(['findUserByEmail', 'createUser', 'addRealmRoles', 'executeActionsEmail']))
    const rows = await auditRows('user', u.id)
    expect(rows.find((r) => r.field === 'email')?.action).toBe('create')
  })

  it('existing Keycloak user (same email) is linked, not duplicated', async () => {
    const p = await getTestPayload()
    const before = fake.calls.filter((c) => c.op === 'createUser').length
    const existing = [...fake.users.entries()].find(([, v]) => v.email === 'citra@drms.test')![0]
    fake.users.set('0e0e0e0e-1111-4222-8333-444455556666', { email: 'sari@drms.test', enabled: true, roles: new Set(['pk-owner']) })
    const u = await p.create({ collection: 'users', data: { email: 'sari@drms.test' }, user: admin, overrideAccess: false })
    expect(u.keycloakSub).toBe('0e0e0e0e-1111-4222-8333-444455556666')
    expect(fake.calls.filter((c) => c.op === 'createUser').length).toBe(before)
    expect(existing).not.toBe(u.keycloakSub)
  })

  it('role change = membership of a PT (DB only): no Keycloak call, role_change audit row (ADR 0016 §2)', async () => {
    const p = await getTestPayload()
    const u = (await p.find({ collection: 'users', where: { email: { equals: 'citra@drms.test' } }, overrideAccess: true /* SYSTEM-READ */ })).docs[0]!
    const company = await companyId()
    const m = await p.create({ collection: 'company-memberships', data: { user: u.id, company, roles: ['pk-staff', 'pk-finance'] }, user: admin, overrideAccess: false })
    const before = fake.calls.length
    await p.update({ collection: 'company-memberships', id: m.id, data: { roles: ['pk-finance'] }, user: admin, overrideAccess: false })
    expect(fake.calls.length).toBe(before)
    expect(fake.users.get(u.keycloakSub as string)?.roles).toEqual(new Set(['pk-user']))
    const rows = await auditRows('company_membership', m.id)
    expect(rows.some((r) => r.action === 'role_change' && JSON.stringify(r.new_value?.v) === '["pk-finance"]')).toBe(true)
  })

  it('MC1 transition: realm without pk-user yet → legacy marker pk-staff assigned, create still succeeds', async () => {
    const p = await getTestPayload()
    const orig = fake
    const kc = installFakeKeycloak()
    const add = (await import('@/auth/keycloak-admin')).getKeycloakAdmin()
    setKeycloakAdmin({
      ...add,
      async addRealmRoles(id: string, roles: string[]) {
        if (roles.includes('pk-user')) throw new KeycloakAdminError('keycloak realm role not found', 422)
        return add.addRealmRoles(id, roles)
      },
    })
    const u = await p.create({ collection: 'users', data: { email: 'legacy@drms.test' }, user: admin, overrideAccess: false })
    expect(kc.users.get(u.keycloakSub as string)?.roles).toEqual(new Set(['pk-staff']))
    fake = orig
    setKeycloakAdmin(undefined)
    fake = installFakeKeycloak()
  })

  it('Keycloak failure aborts the save (Keycloak-first): nothing written in DB', async () => {
    const p = await getTestPayload()
    const count = async () => (await p.count({ collection: 'users', overrideAccess: true /* SYSTEM-READ */ })).totalDocs
    const n = await count()
    setKeycloakAdmin({
      ...Object.fromEntries(Object.keys(fake).map((k) => [k, async () => { throw new Error('keycloak down') }])),
    } as never)
    await expect(p.create({ collection: 'users', data: { email: 'down@drms.test' }, user: admin, overrideAccess: false })).rejects.toThrow()
    expect(await count()).toBe(n)
    setKeycloakAdmin(null)
    await expect(p.create({ collection: 'users', data: { email: 'none@drms.test' }, user: admin, overrideAccess: false })).rejects.toMatchObject({ status: 503 })
    fake = installFakeKeycloak()
  })

  it('REST: failed DB write after Keycloak create is compensated (afterError deletes the KC user)', async () => {
    const cookie = await webSessionCookie(admin)
    // duplicate email → unique violation AFTER the Keycloak calls in beforeChange
    const p = await getTestPayload()
    await p.create({ collection: 'users', data: { email: 'dup@drms.test' }, user: admin, overrideAccess: false })
    fake.users.clear()
    const r = await http('POST', '/api/users', { headers: { Cookie: cookie, Origin: 'http://localhost:3000' }, json: { email: 'dup@drms.test' } })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(fake.calls.some((c) => c.op === 'deleteUser')).toBe(true)
    expect([...fake.users.values()].some((v) => v.email === 'dup@drms.test')).toBe(false)
  })
})
