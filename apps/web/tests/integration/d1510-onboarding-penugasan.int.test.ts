import { randomUUID } from 'node:crypto'

import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setKeycloakAdmin } from '@/auth/keycloak-admin'
import { SKIP_COMPANY_DEFAULTS } from '@/domain/company-defaults'
import { ASSIGNMENT_REASON_MESSAGE, ONE_LOCATION_MESSAGE, SITE_ASSIGNMENT_MESSAGE } from '@/domain/user-onboarding/rules'

import { api, makeFlowUser, sysCreate, type FlowUser } from './flow-world'
import { addMembership, auditRows, companyId, fixturePm, getTestPayload, installFakeKeycloak, makeUser } from './helpers'

/**
 * DRMS 15/10 (owner: "mendaftarkan Data karyawan, rekening dan penugasan secara langsung tanpa harus keluar menu"):
 * team assignments in the "Pengguna" onboarding save — POST / PATCH /api/v1/user-onboarding with
 * `companies[].assignments`. Same transaction as the account + employee (a NEW employee gets them), the
 * collection rules unchanged (exactly one location, PT from the employee, reason on role / end-date change, no delete,
 * PM restrictions), locations = active records of the PT the caller can read. Fake Keycloak Admin API.
 *
 * PTs: A = #1 DRMS, B = "PT Penugasan B" (PNB…, deactivated in afterAll). adminA = Admin of A only; pmGroup = group
 * admin, Admin of A and only PM in B (the TeamAssignments PM restrictions apply to it in B).
 */
let p: Payload
let A = 0
let B = 0
const tag = randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'Q')
let adminA: FlowUser
let pmGroup: FlowUser
let fake: ReturnType<typeof installFakeKeycloak>
type Body = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const loc = { projectA: 0, closedA: 0, ccA: 0, ccA2: 0, siteA: 0, projectB: 0, teamB: 0 }
let seq = 0
const email = (label: string) => `pa-${label}-${tag.toLowerCase()}-${++seq}@example.test`
const code = () => `PA-${tag}-${++seq}`

async function userByEmail(e: string): Promise<Body | null> {
  const r = await p.find({ collection: 'users', where: { email: { equals: e } }, depth: 0, limit: 1, overrideAccess: true /* SYSTEM-READ: assertion */ })
  return (r.docs[0] as unknown as Body) ?? null
}
async function membership(user: number, company: number): Promise<Body | null> {
  const r = await p.find({ collection: 'company-memberships', where: { and: [{ user: { equals: user } }, { company: { equals: company } }] }, depth: 0, limit: 1, overrideAccess: true /* SYSTEM-READ: assertion */ })
  return (r.docs[0] as unknown as Body) ?? null
}
async function assignmentsOf(employee: number): Promise<Body[]> {
  const r = await p.find({ collection: 'team-assignments', where: { employee: { equals: employee } }, depth: 0, sort: 'id', pagination: false, overrideAccess: true /* SYSTEM-READ: assertion */ })
  return r.docs as unknown as Body[]
}
async function employeesWithCode(c: string): Promise<number> {
  return (await p.find({ collection: 'employees', where: { code: { equals: c } }, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })).totalDocs
}
const kcUserByEmail = (e: string) => [...fake.users.entries()].find(([, u]) => u.email === e)

beforeAll(async () => {
  p = await getTestPayload()
  fake = installFakeKeycloak()
  A = await companyId()
  B = (await p.create({ collection: 'companies', data: { name: `PT Penugasan B ${tag}`, shortCode: `PNB${tag}`, timezone: 'Asia/Makassar', active: true } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */, context: { [SKIP_COMPANY_DEFAULTS]: true } })).id as number
  adminA = await makeFlowUser(['pk-admin'], 'pa-admin-a', null, { signature: false, groupAdmin: false })
  pmGroup = await makeFlowUser(['pk-admin'], 'pa-pm-group', null, { signature: false, groupAdmin: true })
  await addMembership(pmGroup.id, B, ['pk-pm'])
  loc.projectA = await sysCreate('projects', { company: A, code: code(), name: `PA Gedung ${tag}`, pm: await fixturePm(A), status: 'berjalan' })
  loc.closedA = await sysCreate('projects', { company: A, code: code(), name: `PA Selesai ${tag}`, pm: await fixturePm(A), status: 'selesai' })
  loc.ccA = await sysCreate('cost-centers', { company: A, code: code(), name: `PA Ops ${tag}` })
  loc.ccA2 = await sysCreate('cost-centers', { company: A, code: code(), name: `PA Gudang ${tag}` })
  // ADR 0032: a legacy site (no new site assignment any more)
  loc.siteA = await sysCreate('sites', { company: A, code: code(), name: `PA Cabang ${tag}` })
  loc.projectB = await sysCreate('projects', { company: B, code: code(), name: `PB Lain ${tag}`, pm: await fixturePm(B), status: 'berjalan' })
  loc.teamB = await sysCreate('projects', { company: B, code: code(), name: `PB Tim ${tag}`, pm: pmGroup.id, status: 'berjalan' })
})

afterAll(async () => {
  setKeycloakAdmin(undefined)
  // the other files assume the single-active-company default (writes without `company`)
  if (B) await p.update({ collection: 'companies', id: B, data: { active: false, changeReason: 'uji penugasan onboarding selesai' } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

/** State shared by the create → edit flow below. */
const flow = { userId: 0, employee: 0, asgProject: 0, asgSecond: 0 }

describe('POST /api/v1/user-onboarding — account + employee + assignments in one save', () => {
  it('a NEW employee gets its assignments in the same transaction; detail lists them and the PT\'s active locations', async () => {
    const e = email('rina')
    const empCode = code()
    const r = await api('POST', '/api/v1/user-onboarding', adminA, {
      user: { email: e, name: 'Rina Penugasan' },
      companies: [
        {
          company: A,
          roles: ['pk-staff'],
          employee: { code: empCode, name: 'Rina Penugasan' },
          assignments: [
            { project: loc.projectA, roleInProject: 'staff', startDate: '2026-10-15' },
            { costCenter: loc.ccA2, roleInProject: 'mandor' },
          ],
        },
      ],
    })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const b = r.body as Body
    const u = (await userByEmail(e))!
    const m = (await membership(u.id, A))!
    expect(m.employee).toBeTruthy()
    const rows = await assignmentsOf(m.employee)
    expect(rows.map((x) => [x.project ?? null, x.costCenter ?? null, x.roleInProject, x.company])).toEqual([
      [loc.projectA, null, 'staff', A],
      [null, loc.ccA2, 'mandor', A],
    ])
    expect(String(rows[0]!.startDate).slice(0, 10)).toBe('2026-10-15')

    const cA = (b.detail.companies as Body[]).find((c) => c.id === A)!
    expect(cA.canManageAssignments).toBe(true)
    expect((cA.assignments as Body[]).map((x) => x.kind).sort()).toEqual(['costCenter', 'project'])
    const projects = (cA.assignmentChoices.projects as Body[]).map((x) => x.id)
    expect(projects).toContain(loc.projectA)
    expect(projects).not.toContain(loc.closedA) // selesai / arsip: no new assignment
    expect(projects).not.toContain(loc.projectB) // another PT
    expect((cA.assignmentChoices.costCenters as Body[]).map((x) => x.id)).toContain(loc.ccA)
    // ADR 0032: no site choice any more (the key stays for APK ≤ 0.11.1)
    expect(cA.assignmentChoices.sites).toEqual([])

    // audit by the collection (withAudit), by the Admin, in the SAME transaction as the account
    const userRows = await auditRows('user', u.id)
    const asgRows = await auditRows('team_assignment', rows[0]!.id)
    expect(asgRows.some((x) => x.action === 'create')).toBe(true)
    expect(asgRows.every((x) => x.user_id === String(adminA.id))).toBe(true)
    expect(new Set([...userRows, ...asgRows].map((x) => x.tx_id)).size).toBe(1)

    Object.assign(flow, { userId: u.id as number, employee: m.employee as number, asgProject: rows[0]!.id as number, asgSecond: rows[1]!.id as number })
  })

  it('two locations in one row → 400 on the location, nothing written, Keycloak untouched', async () => {
    const e = email('two')
    const before = fake.calls.length
    const r = await api('POST', '/api/v1/user-onboarding', adminA, {
      user: { email: e, name: 'Dua Lokasi' },
      companies: [{ company: A, roles: ['pk-staff'], employee: { code: code(), name: 'Dua Lokasi' }, assignments: [{ project: loc.projectA, costCenter: loc.ccA, roleInProject: 'staff' }] }],
    })
    expect(r.status).toBe(400)
    expect((r.body as Body).errors).toEqual([{ path: 'companies.0.assignments.0.location', message: ONE_LOCATION_MESSAGE }])
    expect(await userByEmail(e)).toBeNull()
    expect(fake.calls.length).toBe(before)
    // ADR 0032: a site (old APK) → refused on the location
    const s = await api('POST', '/api/v1/user-onboarding', adminA, {
      user: { email: email('site'), name: 'Site Lama' },
      companies: [{ company: A, roles: ['pk-staff'], employee: { code: code(), name: 'Site Lama' }, assignments: [{ site: loc.siteA, roleInProject: 'staff' }] }],
    })
    expect(s.status).toBe(400)
    expect((s.body as Body).errors).toEqual([{ path: 'companies.0.assignments.0.location', message: SITE_ASSIGNMENT_MESSAGE }])
  })

  it('a project of another PT (or unknown, or closed) → refused on the project; account + employee rolled back, Keycloak compensated', async () => {
    for (const [project, message] of [
      [loc.projectB, 'Project tidak ditemukan di PT ini.'],
      [999999999, 'Project tidak ditemukan di PT ini.'],
      [loc.closedA, 'Project sudah selesai / diarsipkan — pilih project lain.'],
    ] as const) {
      const e = email('foreign')
      const empCode = code()
      const r = await api('POST', '/api/v1/user-onboarding', adminA, {
        user: { email: e, name: 'Proyek Asing' },
        companies: [{ company: A, roles: ['pk-staff'], employee: { code: empCode, name: 'Proyek Asing' }, assignments: [{ project, roleInProject: 'staff' }] }],
      })
      expect(r.status, JSON.stringify(r.body)).toBe(400)
      expect((r.body as Body).errors).toEqual([{ path: 'companies.0.assignments.0.project', message }])
      // written after the account and the employee → all rolled back, the Keycloak user deleted again
      expect(await userByEmail(e)).toBeNull()
      expect(await employeesWithCode(empCode)).toBe(0)
      expect(fake.calls.some((c) => c.op === 'createUser' && c.args[0] === e)).toBe(true)
      expect(kcUserByEmail(e)).toBeUndefined()
    }
  })

  it('assignments without an employee of the PT → 400 before anything is written', async () => {
    const r = await api('POST', '/api/v1/user-onboarding', adminA, { user: { email: email('noemp'), name: 'Tanpa Karyawan' }, companies: [{ company: A, roles: ['pk-staff'], assignments: [{ project: loc.projectA, roleInProject: 'staff' }] }] })
    expect(r.status).toBe(400)
    expect(((r.body as Body).errors as Body[])[0]?.path).toBe('companies.0.assignments.0')
  })
})

describe('PATCH /api/v1/user-onboarding/{id} — add and end assignments', () => {
  it('adds an assignment and ends another with the reason; audited with it', async () => {
    expect(flow.userId).toBeGreaterThan(0)
    const r = await api('PATCH', `/api/v1/user-onboarding/${flow.userId}`, adminA, {
      reason: 'pindah ke pusat biaya',
      companies: [
        {
          company: A,
          roles: ['pk-staff'],
          assignments: [
            { id: flow.asgProject, roleInProject: 'staff', endDate: '2026-10-31' },
            { costCenter: loc.ccA, roleInProject: 'pm', startDate: '2026-11-01' },
          ],
        },
      ],
    })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const rows = await assignmentsOf(flow.employee)
    expect(rows).toHaveLength(3)
    const ended = rows.find((x) => x.id === flow.asgProject)!
    expect(String(ended.endDate).slice(0, 10)).toBe('2026-10-31')
    expect(rows.find((x) => x.costCenter === loc.ccA)).toMatchObject({ roleInProject: 'pm', company: A })
    const audit = await auditRows('team_assignment', flow.asgProject)
    expect(audit.find((x) => x.field === 'endDate' && x.action === 'update')?.reason).toBe('pindah ke pusat biaya')
    const cA = ((r.body as Body).detail.companies as Body[]).find((c) => c.id === A)!
    expect((cA.assignments as Body[]).find((x) => x.id === flow.asgProject)?.endDate?.slice(0, 10)).toBe('2026-10-31')
  })

  it('changing a role without a reason → 400 on reason, nothing of the save written (all-or-nothing)', async () => {
    const before = await assignmentsOf(flow.employee)
    const r = await api('PATCH', `/api/v1/user-onboarding/${flow.userId}`, adminA, {
      companies: [{ company: A, roles: ['pk-staff', 'pk-finance'], assignments: [{ id: flow.asgSecond, roleInProject: 'staff' }, { project: loc.projectA, roleInProject: 'staff' }] }],
    })
    expect(r.status).toBe(400)
    expect((r.body as Body).errors).toEqual([{ path: 'reason', message: ASSIGNMENT_REASON_MESSAGE }])
    expect((await membership(flow.userId, A))!.roles).toEqual(['pk-staff'])
    const after = await assignmentsOf(flow.employee)
    expect(after).toHaveLength(before.length)
    expect(after.find((x) => x.id === flow.asgSecond)?.roleInProject).toBe('mandor')
  })

  it('saved rows: unknown id → 404; another employee\'s row → 400; location / start cannot change; no delete through here', async () => {
    const unknown = await api('PATCH', `/api/v1/user-onboarding/${flow.userId}`, adminA, { reason: 'uji', companies: [{ company: A, roles: ['pk-staff'], assignments: [{ id: 999999999, roleInProject: 'staff' }] }] })
    expect(unknown.status).toBe(404)
    expect(((unknown.body as Body).errors as Body[])[0]?.path).toBe('companies.0.assignments.0')

    const other = await api('POST', '/api/v1/user-onboarding', adminA, { user: { email: email('other'), name: 'Lain' }, companies: [{ company: A, roles: ['pk-staff'], employee: { code: code(), name: 'Lain' } }] })
    expect(other.status, JSON.stringify(other.body)).toBe(201)
    const foreignRow = await api('PATCH', `/api/v1/user-onboarding/${(other.body as Body).userId}`, adminA, { reason: 'uji', companies: [{ company: A, roles: ['pk-staff'], assignments: [{ id: flow.asgSecond, roleInProject: 'staff', endDate: '2026-12-31' }] }] })
    expect(foreignRow.status).toBe(400)
    expect((foreignRow.body as Body).errors).toEqual([{ path: 'companies.0.assignments.0', message: 'Penugasan ini bukan milik karyawan PT ini.' }])

    const move = await api('PATCH', `/api/v1/user-onboarding/${flow.userId}`, adminA, { reason: 'uji', companies: [{ company: A, roles: ['pk-staff'], assignments: [{ id: flow.asgSecond, project: loc.projectA, roleInProject: 'mandor' }] }] })
    expect(move.status).toBe(400)
    expect(((move.body as Body).errors as Body[])[0]?.path).toBe('companies.0.assignments.0')
    const second = (await assignmentsOf(flow.employee)).find((x) => x.id === flow.asgSecond)!
    expect(second).toMatchObject({ costCenter: loc.ccA2, roleInProject: 'mandor' })
    expect(second.endDate ?? null).toBeNull()
  })
})

describe('PM caller: the TeamAssignments restrictions stay', () => {
  it('a PM (group admin, PM only in B) sees its team projects, cannot assign role PM nor a project outside its team', async () => {
    const empB = await sysCreate('employees', { company: B, code: code(), name: 'Karyawan B' })
    const target = await makeUser(['pk-staff'], { company: B, employee: empB, label: 'pa-target-b' })

    const g = await api('GET', `/api/v1/user-onboarding/${target.id}`, pmGroup)
    expect(g.status, JSON.stringify(g.body)).toBe(200)
    const cB = ((g.body as Body).companies as Body[]).find((c) => c.id === B)!
    expect(cB).toMatchObject({ canManageEmployees: false, canManageAssignments: true })
    // the caller's own read access: its team project only (no system read of the PT's projects)
    expect((cB.assignmentChoices.projects as Body[]).map((x) => x.id)).toEqual([loc.teamB])

    const pmRole = await api('PATCH', `/api/v1/user-onboarding/${target.id}`, pmGroup, { companies: [{ company: B, roles: ['pk-staff'], assignments: [{ project: loc.teamB, roleInProject: 'pm' }] }] })
    expect(pmRole.status).toBe(403)
    expect((pmRole.body as Body).errors).toEqual([{ path: 'companies.0.assignments.0', message: 'PM tidak dapat menetapkan peran PM.' }])

    const notTeam = await api('PATCH', `/api/v1/user-onboarding/${target.id}`, pmGroup, { companies: [{ company: B, roles: ['pk-staff'], assignments: [{ project: loc.projectB, roleInProject: 'staff' }] }] })
    expect(notTeam.status).toBe(400)
    expect(((notTeam.body as Body).errors as Body[])[0]?.path).toBe('companies.0.assignments.0.project')
    expect(await assignmentsOf(empB)).toHaveLength(0)

    const ok = await api('PATCH', `/api/v1/user-onboarding/${target.id}`, pmGroup, { companies: [{ company: B, roles: ['pk-staff'], assignments: [{ project: loc.teamB, roleInProject: 'staff' }] }] })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect((await assignmentsOf(empB)).map((x) => [x.project, x.roleInProject, x.company])).toEqual([[loc.teamB, 'staff', B]])
  })
})
