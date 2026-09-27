import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Role } from '@/access/roles'
import { seed } from '@/seed/seed'
import { parseUatUsers, seedUat, UAT_FIXTURE, type UatReport } from '@/seed/uat-seed'

import { auditRows, getTestPayload, installFakeKeycloak, makeUser, webSessionCookie } from './helpers'
import { api, uploadMedia, type FlowUser } from './flow-world'

/**
 * UAT seed (src/seed/uat.ts): creates users/employees/bank account/project/assignments on top of
 * the base seed, never overwrites a real OPS-PB manager, is a no-op on re-run, and leaves staging
 * ready for a Staff request on OPS-PB whose "Diketahui" is the Direktur's approval (ADR 0013), then Finance.
 * Fictional ".test" accounts with random Keycloak ids (no Keycloak call is made).
 */
const USERS = parseUatUsers(
  JSON.stringify([
    { email: 'staff.uji@proyekkas.test', name: 'Staff Uji', role: 'pk-staff', keycloakSub: randomUUID() },
    { email: 'pm.uji@proyekkas.test', name: 'PM Uji', role: 'pk-pm', keycloakSub: randomUUID() },
    { email: 'finance.uji@proyekkas.test', name: 'Finance Uji', role: 'pk-finance', keycloakSub: randomUUID() },
    { email: 'owner.uji@proyekkas.test', name: 'Direktur Uji', role: 'pk-owner', keycloakSub: randomUUID() },
    // ADR 0013: a second Finance user so "another Finance decides" / the G1-2 fallback is testable.
    { email: 'finance2.uji@proyekkas.test', name: 'Finance Uji 2', role: 'pk-finance', keycloakSub: randomUUID() },
  ]),
)

let ccId: number
let originalManager: number | null = null
let realManager: number
let kc: ReturnType<typeof installFakeKeycloak>

async function one(collection: 'users' | 'employees' | 'cost-centers' | 'projects' | 'employee-bank-accounts' | 'banks' | 'expense-categories', field: string, value: unknown) {
  const p = await getTestPayload()
  const r = await p.find({ collection, where: { [field]: { equals: value } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: test */ })
  return r.docs[0] as unknown as Record<string, unknown> & { id: number }
}

async function setManager(manager: number | null) {
  const p = await getTestPayload()
  await p.update({ collection: 'cost-centers', id: ccId, data: { manager }, depth: 0, overrideAccess: true /* SYSTEM-WRITE: test fixture */ })
}

const sum = (r: UatReport, k: keyof UatReport[string]) => Object.values(r).reduce((n, v) => n + v[k], 0)

beforeAll(async () => {
  const p = await getTestPayload()
  kc = installFakeKeycloak()
  await seed(p)
  const cc = await one('cost-centers', 'code', UAT_FIXTURE.costCenterCode)
  ccId = cc.id
  originalManager = (cc.manager as number | null) ?? null
  realManager = (await makeUser(['pk-pm'], { label: 'real-manager' })).id
})

afterAll(async () => {
  await setManager(originalManager) // other files set their own manager; leave OPS-PB as found
  await (await getTestPayload()).destroy()
})

describe('UAT seed', () => {
  it('first run creates everything but keeps an existing OPS-PB manager; no Keycloak call', async () => {
    const p = await getTestPayload()
    await setManager(realManager)
    const r = await seedUat(p, USERS)
    expect(r).toMatchObject({
      employees: { created: 5, linked: 0, skipped: 0 },
      users: { created: 5, linked: 0, skipped: 0 },
      'cost-centers.manager': { created: 0, linked: 0, skipped: 1 },
      'employee-bank-accounts': { created: 1, linked: 0, skipped: 0 },
      projects: { created: 1, linked: 0, skipped: 0 },
      'team-assignments': { created: 3, linked: 0, skipped: 0 },
    })
    expect((await one('cost-centers', 'id', ccId)).manager).toBe(realManager)
    expect(kc.calls).toEqual([])

    const pm = await one('users', 'email', 'pm.uji@proyekkas.test')
    const staff = await one('users', 'email', 'staff.uji@proyekkas.test')
    const staffEmp = await one('employees', 'code', 'UJI-STAFF')
    expect(staff).toMatchObject({ name: 'Staff Uji', roles: ['pk-staff'], active: true, employee: staffEmp.id, keycloakSub: USERS[0]!.keycloakSub })
    expect(staffEmp.name).toBe('Staff Uji')
    for (const code of ['UJI-PM', 'UJI-FIN', 'UJI-OWN', 'UJI-FIN-2']) expect(await one('employees', 'code', code)).toBeDefined()
    expect(await one('projects', 'code', 'UJI-PRJ')).toMatchObject({ name: 'Proyek Uji', pm: pm.id, budget: 50_000_000, status: 'berjalan' })
    const mandiri = await one('banks', 'code', 'MANDIRI')
    expect(await one('employee-bank-accounts', 'accountNo', '9990001112223')).toMatchObject({ employee: staffEmp.id, bank: mandiri.id, accountHolder: 'Staff Uji', isDefault: true })
    const audit = await auditRows('user', staff.id)
    expect(audit.length).toBeGreaterThan(0)
    expect(audit.every((a) => a.source === 'system' && a.user_id === null)).toBe(true)
  })

  it('manager is filled only while empty; a third run is a complete no-op', async () => {
    const p = await getTestPayload()
    await setManager(null)
    const second = await seedUat(p, USERS)
    expect(second['cost-centers.manager']).toEqual({ created: 0, linked: 1, skipped: 0 })
    expect(sum(second, 'created')).toBe(0)
    const pm = await one('users', 'email', 'pm.uji@proyekkas.test')
    expect((await one('cost-centers', 'id', ccId)).manager).toBe(pm.id)

    const third = await seedUat(p, USERS)
    expect(sum(third, 'created')).toBe(0)
    expect(sum(third, 'linked')).toBe(0)
    expect(sum(third, 'skipped')).toBe(5 + 5 + 1 + 1 + 1 + 3)
  })

  it('rejects inconsistent input against the DB (same email, other Keycloak id) without writing', async () => {
    const p = await getTestPayload()
    const clash = USERS.map((u) => (u.role === 'pk-finance' ? { ...u, keycloakSub: randomUUID() } : u))
    await expect(seedUat(p, clash)).rejects.toThrow(/email already belongs to another account/)
  })

  it('Staff Uji can submit a request on OPS-PB; Direktur Uji approves ("Diketahui"), PM Uji cannot (ADR 0013), Finance Uji approves', async () => {
    const asFlow = async (email: string): Promise<FlowUser> => {
      const u = await one('users', 'email', email)
      const f = { id: u.id, email, keycloakSub: '', roles: u.roles as Role[], employee: u.employee as number, collection: 'users', cookie: '', _strategy: 'oidcSession' } as FlowUser
      f.cookie = await webSessionCookie(f)
      const p = await getTestPayload()
      const sig = await uploadMedia('media-signatures', f) // the UAT user draws it in the app
      await p.update({ collection: 'users', id: u.id, data: { signature: sig }, depth: 0, overrideAccess: true /* SYSTEM-WRITE: test fixture */, context: { skipKeycloakSync: true } })
      return f
    }
    const staff = await asFlow('staff.uji@proyekkas.test')
    const pm = await asFlow('pm.uji@proyekkas.test')
    const direktur = await asFlow('owner.uji@proyekkas.test')
    const finance = await asFlow('finance.uji@proyekkas.test')
    const account = await one('employee-bank-accounts', 'accountNo', '9990001112223')
    const ksm = await one('expense-categories', 'code', 'KSM')
    const E = '/api/v1/expense-requests'
    const c = await api('POST', E, staff, {
      type: 'advance',
      title: 'Uji konsumsi lapangan',
      costCenterId: ccId,
      requesterIds: [staff.employee],
      bankAccountId: account.id,
      neededDate: '2026-09-30',
      lines: [{ description: 'Makan siang tim', total: 150_000, categoryId: ksm.id }],
    })
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const s = await api('POST', `${E}/${c.body.id}/submit`, staff, {})
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect(s.body).toMatchObject({ status: 'pending_ack', approvalRule: { acknowledgeRole: 'pk-owner' } })
    expect((await api('POST', `${E}/${c.body.id}/acknowledge`, pm, {})).status).toBe(403)
    const ack = await api('POST', `${E}/${c.body.id}/acknowledge`, direktur, {})
    expect(ack.status, JSON.stringify(ack.body)).toBe(200)
    expect(ack.body.status).toBe('pending_approval')
    const ok = await api('POST', `${E}/${c.body.id}/approve`, finance, {})
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('approved')
  })
})
