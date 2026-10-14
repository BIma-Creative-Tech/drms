import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'

import { DEFAULT_APPROVAL_RULES } from '@/seed/data'
import { seed } from '@/seed/seed'
import { parseUatUsers, seedUat, UAT_FIXTURE, type UatReport } from '@/seed/uat-seed'

import { auditRows, companyId, getTestPayload, installFakeKeycloak, makeUser, webSessionCookie, withContext } from './helpers'
import { api, sysRapItem, uploadMedia, type FlowUser } from './flow-world'

/**
 * UAT seed (src/seed/uat.ts): creates users/employees/bank account/project/assignments on top of
 * the base seed, never overwrites a real OPS-PB manager, is a no-op on re-run, and leaves staging
 * ready for a Staff request on OPS-PB under the seeded default rule (ADR 0021): "Diketahui" = the PM project
 * (the cost center's manager, PM Uji), then the Direktur; Finance only transfers.
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
    // ADR 0026: the Owner — last approval level of the default rule (above the Direktur)
    { email: 'principal.uji@proyekkas.test', name: 'Owner Uji', role: 'pk-principal', keycloakSub: randomUUID() },
  ]),
)

let ccId: number
let originalManager: number | null = null
let realManager: number
let kc: ReturnType<typeof installFakeKeycloak>

async function one(collection: 'users' | 'employees' | 'cost-centers' | 'projects' | 'employee-bank-accounts' | 'banks' | 'expense-categories', field: string, value: unknown) {
  const p = await getTestPayload()
  // ADR 0016: masters are per PT (the UAT runs in company #1 DRMS; codes repeat in other PTs)
  const perPt = ['employees', 'cost-centers', 'projects', 'employee-bank-accounts', 'expense-categories'].includes(collection)
  const where = perPt ? { and: [{ company: { equals: await companyId() } }, { [field]: { equals: value } }] } : { [field]: { equals: value } }
  const r = await p.find({ collection, where, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: test */ })
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
      employees: { created: 6, linked: 0, skipped: 0 },
      users: { created: 6, linked: 0, skipped: 0 },
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
    expect(staff).toMatchObject({ name: 'Staff Uji', active: true, keycloakSub: USERS[0]!.keycloakSub })
    // ADR 0016: role + employee link = membership of company #1 (DRMS)
    const m = (await p.find({ collection: 'company-memberships', where: { user: { equals: staff.id } }, depth: 0, overrideAccess: true /* SYSTEM-READ: test */ })).docs
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ company: await companyId(), roles: ['pk-staff'], employee: staffEmp.id, active: true })
    expect(staffEmp.name).toBe('Staff Uji')
    for (const code of ['UJI-PM', 'UJI-FIN', 'UJI-OWN', 'UJI-FIN-2', 'UJI-OWNER']) expect(await one('employees', 'code', code)).toBeDefined()
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
    expect(sum(third, 'skipped')).toBe(6 + 6 + 1 + 1 + 1 + 3)
  })

  it('rejects inconsistent input against the DB (same email, other Keycloak id) without writing', async () => {
    const p = await getTestPayload()
    const clash = USERS.map((u) => (u.role === 'pk-finance' ? { ...u, keycloakSub: randomUUID() } : u))
    await expect(seedUat(p, clash)).rejects.toThrow(/email already belongs to another account/)
  })

  it('Staff Uji can submit a request on the UAT project; PM Uji approves (Persetujuan PM), then Direktur Uji (ADR 0021), then Owner Uji (ADR 0026); Finance Uji does not approve', async () => {
    const asFlow = async (email: string): Promise<FlowUser> => {
      const u = await one('users', 'email', email)
      const f = { ...(await withContext({ id: u.id as number, email, keycloakSub: '', collection: 'users' as const })), cookie: '', _strategy: 'oidcSession' } as FlowUser
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
    const owner = await asFlow('principal.uji@proyekkas.test')
    const account = await one('employee-bank-accounts', 'accountNo', '9990001112223')
    const ksm = await one('expense-categories', 'code', 'KSM')
    const E = '/api/v1/expense-requests'
    // ADR 0021: the staging rule after the Admin's change (= the seeded default shape), scoped to the UAT project so
    // that rules other files leave in the shared DB (ADR 0013 fallbacks, form 228) cannot win. DRMS 10/10 D2: requests
    // are project requests (was: on the cost center OPS-PB).
    const p = await getTestPayload()
    const projectId = (await one('projects', 'code', UAT_FIXTURE.project.code)).id
    const seeded = (await p.find({ collection: 'approval-rules', where: { name: { equals: DEFAULT_APPROVAL_RULES[0].name } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })).docs[0]
    expect(seeded).toMatchObject({ acknowledge: 'required', acknowledgeBy: 'scope_manager' })
    const uatRule = await p.create({
      collection: 'approval-rules',
      data: { ...DEFAULT_APPROVAL_RULES[0], steps: [...DEFAULT_APPROVAL_RULES[0].steps], name: 'UAT — PM project lalu Direktur (UJI-PRJ)', project: projectId, priority: 0 } as never,
      overrideAccess: true, // SYSTEM-WRITE: fixture
    })
    onTestFinished(async () => {
      // shared DB: other files (form 228) use OPS-PB with their own rule
      await p.update({ collection: 'approval-rules', id: uatRule.id, data: { active: false, changeReason: 'uji selesai' } as never, overrideAccess: true /* SYSTEM-WRITE: fixture cleanup */ })
    })
    const c = await api('POST', E, staff, {
      type: 'advance',
      title: 'Uji konsumsi lapangan',
      projectId,
      requesterIds: [staff.employee],
      bankAccountId: account.id,
      neededDate: '2026-09-30',
      // D4 (2026-10-11): the UAT project has a RAB → it needs a RAP item (the seed creates none — a PM fills it)
      lines: [{ description: 'Makan siang tim', total: 150_000, categoryId: ksm.id, rapItemId: await sysRapItem(projectId) }],
    })
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const s = await api('POST', `${E}/${c.body.id}/submit`, staff, {})
    expect(s.status, JSON.stringify(s.body)).toBe(200)
    expect(s.body).toMatchObject({ status: 'pending_ack', statusLabel: 'Menunggu persetujuan PM', approvalRule: { acknowledgeBy: 'scope_manager', acknowledgerUserId: pm.id } })
    expect((await api('POST', `${E}/${c.body.id}/acknowledge`, direktur, {})).status).toBe(403)
    const ack = await api('POST', `${E}/${c.body.id}/acknowledge`, pm, {})
    expect(ack.status, JSON.stringify(ack.body)).toBe(200)
    expect(ack.body).toMatchObject({ status: 'pending_approval', statusLabel: 'Menunggu persetujuan Direktur' })
    expect((await api('POST', `${E}/${c.body.id}/approve`, finance, {})).status).toBe(403)
    const dir = await api('POST', `${E}/${c.body.id}/approve`, direktur, {})
    expect(dir.status, JSON.stringify(dir.body)).toBe(200)
    // ADR 0026: Direktur → Owner (the Owner does not take the Direktur step and the Direktur not the Owner's)
    expect(dir.body).toMatchObject({ status: 'pending_approval', currentLevel: 2, statusLabel: 'Menunggu persetujuan Owner' })
    expect((await api('POST', `${E}/${c.body.id}/approve`, direktur, {})).status).toBe(403)
    const ok = await api('POST', `${E}/${c.body.id}/approve`, owner, {})
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.status).toBe('approved')
  })
})
