import type { CollectionSlug } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Role } from '@/access/roles'

import { ALL_ROLES, getTestPayload, makeUser, type TestUser } from './helpers'

/**
 * Negative authorization per role for masters (requirements v1.1 §4, architecture §7.2/§7.4),
 * through the Local API with overrideAccess:false (the path every request handler must use).
 */
type U = TestUser & { _strategy: string }
const users = {} as Record<Role, U>
let otherPm: U
let staffEmp: number
let otherEmp: number
let teamProject: number
let otherProject: number
let assignedCc: number
let otherCc: number
let catId: number
let bankId: number
let ownAccount: number
let otherAccount: number

const asWeb = (u: TestUser): U => ({ ...u, _strategy: 'oidcSession' })

beforeAll(async () => {
  const p = await getTestPayload()
  // SYSTEM-WRITE: fixtures
  const sysCreate = async (collection: CollectionSlug, data: Record<string, unknown>) =>
    (await p.create({ collection, data: data as never, overrideAccess: true, depth: 0 })).id as number
  staffEmp = await sysCreate('employees', { code: 'Z-STAFF', name: 'Staff Satu' })
  otherEmp = await sysCreate('employees', { code: 'Z-OTHER', name: 'Staff Dua' })
  const pmEmp = await sysCreate('employees', { code: 'Z-PM', name: 'PM Satu' })
  for (const r of ALL_ROLES) users[r] = asWeb(await makeUser([r], { employee: r === 'pk-staff' ? staffEmp : r === 'pk-pm' ? pmEmp : undefined }))
  otherPm = asWeb(await makeUser(['pk-pm'], { label: 'other-pm' }))
  teamProject = await sysCreate('projects', { code: 'Z-P1', name: 'Team project', pm: users['pk-pm'].id })
  otherProject = await sysCreate('projects', { code: 'Z-P2', name: 'Other project', pm: otherPm.id })
  assignedCc = await sysCreate('cost-centers', { code: 'Z-CC1', name: 'CC assigned' })
  otherCc = await sysCreate('cost-centers', { code: 'Z-CC2', name: 'CC other' })
  await sysCreate('team-assignments', { employee: staffEmp, project: teamProject, roleInProject: 'staff' })
  await sysCreate('team-assignments', { employee: staffEmp, costCenter: assignedCc, roleInProject: 'staff' })
  // ended assignment must not grant scope
  await sysCreate('team-assignments', { employee: staffEmp, project: otherProject, roleInProject: 'staff', startDate: '2025-01-01T00:00:00.000Z', endDate: '2025-02-01T00:00:00.000Z' })
  catId = await sysCreate('expense-categories', { code: 'Z-CAT', name: 'Kat' })
  bankId = await sysCreate('banks', { code: 'Z-BANK', name: 'Bank Z' })
  ownAccount = await sysCreate('employee-bank-accounts', { employee: staffEmp, bank: bankId, accountNo: '11111', accountHolder: 'Staff Satu' })
  otherAccount = await sysCreate('employee-bank-accounts', { employee: otherEmp, bank: bankId, accountNo: '22222', accountHolder: 'Staff Dua' })
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

async function canCreate(user: U, collection: CollectionSlug, data: Record<string, unknown>): Promise<boolean> {
  const p = await getTestPayload()
  try {
    await p.create({ collection, data: data as never, user, overrideAccess: false, depth: 0 })
    return true
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 403) return false
    // 400 = access check passed, data validation failed afterwards (e.g. a unique docType already
    // created by another suite sharing the DB) → the role IS allowed to create.
    if (status === 400) return true
    throw e
  }
}

let n = 0
const uniq = () => `N${++n}`

/** requirements v1.1 §4 → roles allowed to CREATE (everyone else must get 403). */
const CREATE_MATRIX: Array<[CollectionSlug, Role[], () => Record<string, unknown>]> = [
  ['uoms', ['pk-admin', 'pk-finance'], () => ({ code: uniq(), name: 'x' })],
  ['banks', ['pk-admin', 'pk-finance'], () => ({ code: uniq(), name: 'x' })],
  ['cash-in-sources', ['pk-admin', 'pk-finance'], () => ({ code: uniq(), name: 'x' })],
  ['cash-accounts', ['pk-admin', 'pk-finance'], () => ({ name: uniq(), kind: 'bank' })],
  ['expense-categories', ['pk-admin', 'pk-finance'], () => ({ code: uniq(), name: 'x' })],
  ['vendors', ['pk-admin', 'pk-finance'], () => ({ name: uniq() })],
  ['clients', ['pk-admin', 'pk-owner'], () => ({ name: uniq() })],
  ['cost-centers', ['pk-admin', 'pk-owner'], () => ({ code: uniq(), name: 'x' })],
  ['vehicles', ['pk-admin'], () => ({ plateNo: `DA ${1000 + n++} ZZ`, type: 'Truk' })],
  ['employees', ['pk-admin'], () => ({ code: uniq(), name: 'x' })],
  ['employee-bank-accounts', ['pk-admin', 'pk-finance'], () => ({ employee: otherEmp, bank: bankId, accountNo: String(900000 + n++), accountHolder: 'x' })],
  ['projects', ['pk-owner'], () => ({ code: uniq(), name: 'x' })],
  ['project-stages', ['pk-owner'], () => ({ project: teamProject, name: 'x', weightPct: 1, sequence: 1 })],
  ['stage-templates', ['pk-admin', 'pk-owner'], () => ({ name: uniq(), items: [{ name: 'a', weightPct: 100, sequence: 1 }] })],
  ['budget-lines', ['pk-owner'], () => ({ project: otherProject, category: catId, amount: 1 })],
  ['work-schedules', ['pk-admin'], () => ({ name: uniq(), startTime: '08:00', endTime: '17:00' })],
  ['holidays', ['pk-admin'], () => ({ date: `2031-01-${String((n++ % 27) + 1).padStart(2, '0')}`, name: 'x' })],
  ['approval-rules', ['pk-admin'], () => ({ name: uniq(), minAmount: 0 })],
  ['notification-templates', ['pk-admin'], () => ({ event: `z.${uniq().toLowerCase()}`, title: 'x', body: 'x' })],
  ['document-sequences', ['pk-admin'], () => ({ docType: 'progress_report', docCode: 'LP', pattern: 'LP/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1, timezone: 'Asia/Makassar' })],
  ['devices', [], () => ({ deviceId: crypto.randomUUID(), user: users['pk-staff'].id, platform: 'android' })],
  ['audit-logs', [], () => ({ eventId: 'x', docType: 'x', action: 'create' })],
  ['web-sessions', [], () => ({ idHash: uniq(), user: users['pk-staff'].id, expiresAt: new Date().toISOString() })],
]

describe('create access per role (403 for everyone not in the matrix)', () => {
  for (const [slug, allowed, data] of CREATE_MATRIX) {
    it(`${slug}: only ${allowed.join(', ') || 'nobody (system writes only)'}`, async () => {
      for (const role of ALL_ROLES) {
        expect(await canCreate(users[role], slug, data()), `${role} → ${slug}`).toBe(allowed.includes(role))
      }
    })
  }
})

describe('delete is forbidden for every role on every collection (G4)', () => {
  it('REST-equivalent Local API delete → 403', async () => {
    const p = await getTestPayload()
    const all = users['pk-admin']
    for (const c of p.config.collections) {
      if (c.slug.startsWith('payload-')) continue
      const any = await p.find({ collection: c.slug as CollectionSlug, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
      const id = any.docs[0]?.id
      if (id === undefined) continue
      for (const role of ALL_ROLES) {
        await expect(
          p.delete({ collection: c.slug as CollectionSlug, id, user: role === 'pk-admin' ? all : users[role], overrideAccess: false }),
          `${role} delete ${c.slug}`,
        ).rejects.toMatchObject({ status: 403 })
      }
    }
  })
})

describe('read scopes (own / team / assigned / all)', () => {
  const ids = async (user: U, collection: CollectionSlug) => {
    const p = await getTestPayload()
    const r = await p.find({ collection, user, overrideAccess: false, depth: 0, limit: 1000 })
    return r.docs.map((d) => d.id as number)
  }

  it('projects: staff sees assigned only (ended assignment ignored), PM sees team only', async () => {
    expect(await ids(users['pk-staff'], 'projects')).toEqual([teamProject])
    expect(await ids(users['pk-pm'], 'projects')).toEqual([teamProject])
    expect(await ids(otherPm, 'projects')).toEqual([otherProject])
    const fin = await ids(users['pk-finance'], 'projects')
    expect(fin).toEqual(expect.arrayContaining([teamProject, otherProject]))
  })

  it('cost-centers: staff sees assigned only; finance all', async () => {
    expect(await ids(users['pk-staff'], 'cost-centers')).toEqual([assignedCc])
    expect(await ids(users['pk-finance'], 'cost-centers')).toEqual(expect.arrayContaining([assignedCc, otherCc]))
  })

  it('employee bank accounts: staff only own, PM none of others, finance all', async () => {
    expect(await ids(users['pk-staff'], 'employee-bank-accounts')).toEqual([ownAccount])
    expect(await ids(users['pk-pm'], 'employee-bank-accounts')).toEqual([])
    expect(await ids(users['pk-finance'], 'employee-bank-accounts')).toEqual(expect.arrayContaining([ownAccount, otherAccount]))
  })

  it('finance-only masters are invisible to staff and PM (403 or empty)', async () => {
    const p = await getTestPayload()
    for (const slug of ['cash-accounts', 'cash-in-sources', 'approval-rules', 'audit-logs', 'web-sessions', 'document-sequences'] as CollectionSlug[]) {
      for (const role of ['pk-staff', 'pk-pm'] as Role[]) {
        await expect(p.find({ collection: slug, user: users[role], overrideAccess: false, depth: 0 }), `${role} ${slug}`).rejects.toMatchObject({ status: 403 })
      }
    }
  })

  it('users: non-admin/owner see only themselves', async () => {
    expect(await ids(users['pk-staff'], 'users')).toEqual([users['pk-staff'].id])
    expect((await ids(users['pk-owner'], 'users')).length).toBeGreaterThan(5)
  })
})

describe('update scopes and protected fields', () => {
  it('PM updates team project operational fields, but not budget/status/pm; not other projects', async () => {
    const p = await getTestPayload()
    const pm = users['pk-pm']
    const res = await p.update({ collection: 'projects', id: teamProject, data: { address: 'Jl. PM', budget: 999, status: 'arsip', pm: otherPm.id }, user: pm, overrideAccess: false, depth: 0 })
    expect(res.address).toBe('Jl. PM')
    expect(res.budget ?? null).toBeNull()
    expect(res.status).toBe('perencanaan')
    expect(res.pm).toBe(pm.id)
    // Payload answers 403 when the update Where excludes the document (architecture §7.4: 404/403/empty)
    await expect(p.update({ collection: 'projects', id: otherProject, data: { address: 'x' }, user: pm, overrideAccess: false })).rejects.toMatchObject({ status: 403 })
  })

  it('PM cannot assign the PM role or assign to other projects (escalation guard)', async () => {
    const p = await getTestPayload()
    const pm = users['pk-pm']
    await expect(
      p.create({ collection: 'team-assignments', data: { employee: otherEmp, project: teamProject, roleInProject: 'pm' }, user: pm, overrideAccess: false }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      p.create({ collection: 'team-assignments', data: { employee: otherEmp, project: otherProject, roleInProject: 'staff' }, user: pm, overrideAccess: false }),
    ).rejects.toMatchObject({ status: 403 })
    const ok = await p.create({ collection: 'team-assignments', data: { employee: otherEmp, project: teamProject, roleInProject: 'staff' }, user: pm, overrideAccess: false })
    expect(ok.id).toBeGreaterThan(0)
  })

  it('finance cannot edit vehicles; owner can; nobody edits progressPct', async () => {
    const p = await getTestPayload()
    const v = await p.create({ collection: 'vehicles', data: { plateNo: 'KT 77 AB', type: 'Truk' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    await expect(p.update({ collection: 'vehicles', id: v.id, data: { brandModel: 'x' }, user: users['pk-finance'], overrideAccess: false })).rejects.toMatchObject({ status: 403 })
    expect((await p.update({ collection: 'vehicles', id: v.id, data: { brandModel: 'Hino' }, user: users['pk-owner'], overrideAccess: false })).brandModel).toBe('Hino')
    const st = await p.create({ collection: 'project-stages', data: { project: teamProject, name: 'S', weightPct: 10, sequence: 1 }, user: users['pk-owner'], overrideAccess: false })
    // E4: an explicit different progressPct is refused (403), not silently dropped; other fields still editable
    await expect(p.update({ collection: 'project-stages', id: st.id, data: { progressPct: 90, name: 'S2' }, user: users['pk-owner'], overrideAccess: false })).rejects.toMatchObject({ status: 403 })
    const upd = await p.update({ collection: 'project-stages', id: st.id, data: { name: 'S2' }, user: users['pk-owner'], overrideAccess: false })
    expect(upd.progressPct).toBe(0)
  })

  it('users.roles can only be changed by admin (and admin changes go to Keycloak)', async () => {
    const p = await getTestPayload()
    await expect(p.update({ collection: 'users', id: users['pk-staff'].id, data: { roles: ['pk-admin'] }, user: users['pk-staff'], overrideAccess: false })).rejects.toMatchObject({ status: 403 })
    await expect(p.update({ collection: 'users', id: users['pk-staff'].id, data: { roles: ['pk-admin'] }, user: users['pk-owner'], overrideAccess: false })).rejects.toMatchObject({ status: 403 })
  })
})
