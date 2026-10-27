import { randomUUID } from 'node:crypto'

import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { KeycloakPasswordPolicyError, setKeycloakAdmin, getKeycloakAdmin } from '@/auth/keycloak-admin'
import { SKIP_COMPANY_DEFAULTS } from '@/domain/company-defaults'

import { api, makeFlowUser, type FlowUser } from './flow-world'
import { addMembership, auditRows, companyId, getTestPayload, installFakeKeycloak, makeUser, sqlAs } from './helpers'

/**
 * DRMS 13/10 Wave 3 — "Pengguna" tabbed onboarding: POST / PATCH / GET /api/v1/user-onboarding.
 * One transaction for account + access per PT + employee + bank accounts, Keycloak first with compensation, the
 * temporary password, the existing permission rules (Admin of the PT, Users update access, bank-account reason)
 * and the PT scoping. Fake Keycloak Admin API (helpers.installFakeKeycloak) — never a real Keycloak.
 *
 * PTs: A = #1 DRMS, B = "PT Onboarding B" (OBB…, deactivated in afterAll). adminA = Admin of A only; group = group
 * admin (Admin of A); staffA = Staff of A; adminB = Admin of B only.
 */
let p: Payload
let A = 0
let B = 0
let bank = 0
const tag = randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'Q')
let adminA: FlowUser
let group: FlowUser
let staffA: FlowUser
let adminB: FlowUser
let fake: ReturnType<typeof installFakeKeycloak>
type Body = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

let seq = 0
const email = (label: string) => `ob-${label}-${tag.toLowerCase()}-${++seq}@example.test`
const code = () => `OB-${tag}-${++seq}`

async function userByEmail(e: string): Promise<Body | null> {
  const r = await p.find({ collection: 'users', where: { email: { equals: e } }, depth: 0, limit: 1, overrideAccess: true /* SYSTEM-READ: assertion */ })
  return (r.docs[0] as unknown as Body) ?? null
}
async function membership(user: number, company: number): Promise<Body | null> {
  const r = await p.find({ collection: 'company-memberships', where: { and: [{ user: { equals: user } }, { company: { equals: company } }] }, depth: 0, limit: 1, overrideAccess: true /* SYSTEM-READ: assertion */ })
  return (r.docs[0] as unknown as Body) ?? null
}
const kcUserByEmail = (e: string) => [...fake.users.entries()].find(([, u]) => u.email === e)

beforeAll(async () => {
  p = await getTestPayload()
  fake = installFakeKeycloak()
  A = await companyId()
  B = (await p.create({ collection: 'companies', data: { name: `PT Onboarding B ${tag}`, shortCode: `OBB${tag}`, timezone: 'Asia/Makassar', active: true } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */, context: { [SKIP_COMPANY_DEFAULTS]: true } })).id as number
  bank = (await p.create({ collection: 'banks', data: { code: `OBK${tag}`, name: `Bank Uji ${tag}` }, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */ })).id as number
  adminA = await makeFlowUser(['pk-admin'], 'ob-admin-a', null, { signature: false, groupAdmin: false })
  group = await makeFlowUser(['pk-admin'], 'ob-group', null, { signature: false, groupAdmin: true })
  staffA = await makeFlowUser(['pk-staff'], 'ob-staff-a', null, { signature: false })
  adminB = await makeFlowUser(['pk-admin'], 'ob-admin-b', null, { signature: false, groupAdmin: false, company: B })
})

afterAll(async () => {
  setKeycloakAdmin(undefined)
  // the other files assume the single-active-company default (writes without `company`)
  if (B) await p.update({ collection: 'companies', id: B, data: { active: false, changeReason: 'uji onboarding pengguna selesai' } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

describe('POST /api/v1/user-onboarding — one save', () => {
  it('creates account + access + employee + bank account in one transaction; Keycloak user with a TEMPORARY password', async () => {
    const e = email('rina')
    const empCode = code()
    const r = await api('POST', '/api/v1/user-onboarding', adminA, {
      user: { email: e.toUpperCase(), name: 'Rina Uji', phone: '0811000001' },
      companies: [{ company: A, roles: ['pk-staff', 'pk-pm'], employee: { code: empCode, name: 'Rina Uji', position: 'Pengawas' }, bankAccounts: [{ bank, accountNo: '123.456.7890', accountHolder: 'Rina Uji', isDefault: true }] }],
    })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const b = r.body as Body
    expect(b.created).toBe(true)
    expect(b.linkedExistingAccount).toBe(false)
    expect(b.temporaryPassword).toMatch(/^[A-Za-z2-9!@#$%*?\-+=]{14}$/)
    expect(b.temporaryPassword).toMatch(/[!@#$%*?\-+=]/) // realm policy specialChars(1)
    expect(r.headers.get('cache-control')).toBe('no-store')

    // Keycloak: created with the temporary password (UPDATE_PASSWORD), no execute-actions mail
    const kc = kcUserByEmail(e)!
    expect(kc).toBeDefined()
    expect(kc[1].password).toEqual({ value: b.temporaryPassword, temporary: true })
    expect(fake.calls.some((c) => c.op === 'resetPassword' && c.args[0] === kc[0] && c.args[1] === true)).toBe(true)
    expect(fake.calls.some((c) => c.op === 'executeActionsEmail' && c.args[0] === kc[0])).toBe(false)
    expect(JSON.stringify(fake.calls)).not.toContain(b.temporaryPassword)

    // DB: everything linked
    const u = (await userByEmail(e))!
    expect(u.keycloakSub).toBe(kc[0])
    expect(u.id).toBe(b.userId)
    const m = (await membership(u.id, A))!
    expect(m.roles).toEqual(['pk-pm', 'pk-staff'])
    expect(m.active).toBe(true)
    const emp = (await p.findByID({ collection: 'employees', id: m.employee, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })) as unknown as Body
    expect(emp).toMatchObject({ code: empCode, name: 'Rina Uji', position: 'Pengawas', company: A })
    const acc = await p.find({ collection: 'employee-bank-accounts', where: { employee: { equals: emp.id } }, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })
    expect(acc.docs).toHaveLength(1)
    expect(acc.docs[0]).toMatchObject({ accountNo: '1234567890', verificationStatus: 'unverified', isDefault: true })

    // the detail of the response = what the form shows
    const cA = (b.detail.companies as Body[]).find((c) => c.id === A)!
    expect(cA.membership.roles).toEqual(['pk-pm', 'pk-staff'])
    expect(cA.employee.code).toBe(empCode)
    expect(cA.bankAccounts[0].accountNo).toBe('1234567890')
    expect(b.detail.user.identityEditable).toBe(true)

    // audit: the same rows as the separate pages produce, by the Admin, in ONE transaction; the password only as a fact
    const userRows = await auditRows('user', u.id)
    expect(userRows.find((x) => x.field === 'email')?.action).toBe('create')
    const pw = userRows.find((x) => x.field === 'password')!
    expect(pw.action).toBe('update')
    expect(pw.new_value).toBeNull()
    expect(JSON.stringify(userRows)).not.toContain(b.temporaryPassword)
    const memRows = await auditRows('company_membership', m.id)
    const empRows = await auditRows('employee', emp.id)
    const accRows = await auditRows('employee_bank_account', acc.docs[0]!.id as number)
    for (const rows of [userRows, memRows, empRows, accRows]) {
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((x) => x.user_id === String(adminA.id))).toBe(true)
    }
    expect(new Set([...userRows, ...memRows, ...empRows, ...accRows].map((x) => x.tx_id)).size).toBe(1)
  })

  it('an existing Keycloak account with the email is linked: no temporary password, password untouched', async () => {
    const e = email('linked')
    const kcId = randomUUID()
    fake.users.set(kcId, { email: e, enabled: true, roles: new Set(['pk-user']) })
    const r = await api('POST', '/api/v1/user-onboarding', adminA, { user: { email: e, name: 'Sudah Ada' }, companies: [{ company: A, roles: ['pk-staff'] }] })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body).toMatchObject({ temporaryPassword: null, linkedExistingAccount: true })
    expect(fake.users.get(kcId)?.password).toBeUndefined()
    expect((await userByEmail(e))!.keycloakSub).toBe(kcId)
  })

  it('validation before anything is written: no PT / new employee without code → 400 with field paths, no Keycloak call', async () => {
    const before = fake.calls.length
    const none = await api('POST', '/api/v1/user-onboarding', adminA, { user: { email: email('none'), name: 'X' }, companies: [{ company: A, roles: [] }] })
    expect(none.status).toBe(400)
    expect((none.body as Body).errors).toEqual([{ path: 'companies', message: 'Pilih minimal satu PT dan peran.' }])
    const noCode = await api('POST', '/api/v1/user-onboarding', adminA, { user: { email: email('nocode'), name: 'X' }, companies: [{ company: A, roles: ['pk-staff'], employee: { name: 'X' } }] })
    expect(noCode.status).toBe(400)
    expect((noCode.body as Body).errors).toEqual([{ path: 'companies.0.employee.code', message: 'Kode karyawan wajib diisi.' }])
    expect(fake.calls.length).toBe(before)
  })
})

describe('transaction rollback + Keycloak compensation', () => {
  it('a collection rule failing AFTER Keycloak (duplicate employee code) → nothing in the DB, Keycloak user deleted', async () => {
    const taken = code()
    await p.create({ collection: 'employees', data: { company: A, code: taken, name: 'Pemilik kode' } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    const e = email('rollback')
    const users = (await p.count({ collection: 'users', overrideAccess: true /* SYSTEM-READ */ })).totalDocs
    const r = await api('POST', '/api/v1/user-onboarding', adminA, { user: { email: e, name: 'Gagal' }, companies: [{ company: A, roles: ['pk-staff'], employee: { code: taken, name: 'Gagal' } }] })
    expect(r.status, JSON.stringify(r.body)).toBe(400)
    expect((r.body as Body).errors).toEqual([{ path: 'companies.0.employee.code', message: `Kode "${taken}" sudah dipakai di PT ini. Pilih kode lain.` }])
    expect(await userByEmail(e)).toBeNull()
    expect((await p.count({ collection: 'users', overrideAccess: true /* SYSTEM-READ */ })).totalDocs).toBe(users)
    // Keycloak was written first (create + temporary password) and compensated
    const created = fake.calls.filter((c) => c.op === 'createUser' && c.args[0] === e)
    expect(created).toHaveLength(1)
    expect(kcUserByEmail(e)).toBeUndefined()
    expect(fake.calls.some((c) => c.op === 'deleteUser')).toBe(true)
  })

  it('a DB guard at the bank account (unknown bank) → 400, account + membership + employee rolled back', async () => {
    const e = email('nobank')
    const c = code()
    const r = await api('POST', '/api/v1/user-onboarding', adminA, { user: { email: e, name: 'Tanpa bank' }, companies: [{ company: A, roles: ['pk-staff'], employee: { code: c, name: 'Tanpa bank' }, bankAccounts: [{ bank: 999999, accountNo: '12345678', accountHolder: 'X' }] }] })
    expect(r.status, JSON.stringify(r.body)).toBeGreaterThanOrEqual(400)
    expect(r.status).toBeLessThan(500)
    expect(((r.body as Body).errors as Body[]).every((x) => String(x.path).startsWith('companies.0.bankAccounts.0'))).toBe(true)
    expect(await userByEmail(e)).toBeNull()
    expect((await p.find({ collection: 'employees', where: { code: { equals: c } }, depth: 0, overrideAccess: true /* SYSTEM-READ */ })).totalDocs).toBe(0)
    expect(kcUserByEmail(e)).toBeUndefined()
  })

  it('Keycloak refusing the temporary password (policy) → 502 KEYCLOAK_FAILED, Keycloak user deleted, nothing saved', async () => {
    const real = getKeycloakAdmin()
    setKeycloakAdmin({ ...real, resetPassword: async () => { throw new KeycloakPasswordPolicyError('invalidPasswordMinLengthMessage', 20) } })
    const e = email('policy')
    try {
      const r = await api('POST', '/api/v1/user-onboarding', adminA, { user: { email: e, name: 'Kebijakan' }, companies: [{ company: A, roles: ['pk-staff'] }] })
      expect(r.status).toBe(502)
      expect((r.body as Body).code).toBe('KEYCLOAK_FAILED')
    } finally {
      setKeycloakAdmin(real)
    }
    expect(await userByEmail(e)).toBeNull()
    expect(kcUserByEmail(e)).toBeUndefined()
  })

  it('edit: deactivation + a failing bank row → rolled back, Keycloak enabled flag restored', async () => {
    const u = await makeKcUser('deact')
    const r = await api('PATCH', `/api/v1/user-onboarding/${u.id}`, adminA, {
      user: { active: false },
      reason: 'keluar',
      companies: [{ company: A, roles: ['pk-staff'], employee: { code: code(), name: 'Deakt' }, bankAccounts: [{ bank, accountNo: 'abc', accountHolder: 'X' }] }],
    })
    expect(r.status).toBe(400)
    expect(((r.body as Body).errors as Body[])[0]?.path).toBe('companies.0.bankAccounts.0.accountNo')
    // pure validation answered before Keycloak — nothing to compensate
    expect(fake.users.get(u.keycloakSub)?.enabled).toBe(true)
    // now a failure AFTER the Keycloak update (unknown bank → DB/relationship error)
    const r2 = await api('PATCH', `/api/v1/user-onboarding/${u.id}`, adminA, {
      user: { active: false },
      reason: 'keluar',
      companies: [{ company: A, roles: ['pk-staff'], employee: { code: code(), name: 'Deakt' }, bankAccounts: [{ bank: 999999, accountNo: '12345678', accountHolder: 'X' }] }],
    })
    expect(r2.status).toBeGreaterThanOrEqual(400)
    expect(r2.status).toBeLessThan(500)
    expect(fake.calls.some((c) => c.op === 'updateUser' && c.args[0] === u.keycloakSub && (c.args[1] as Body).enabled === false)).toBe(true)
    expect(fake.users.get(u.keycloakSub)?.enabled).toBe(true) // compensation: enabled again
    expect((await userByEmail(u.email))!.active).toBe(true)
  })
})

/** An account created through the endpoint (Keycloak fake), member of A as Staff. */
async function makeKcUser(label: string, extra: Body = {}): Promise<{ id: number; email: string; keycloakSub: string }> {
  const e = email(label)
  const r = await api('POST', '/api/v1/user-onboarding', group, { user: { email: e, name: `Uji ${label}` }, companies: [{ company: A, roles: ['pk-staff'] }], ...extra })
  if (r.status !== 201) throw new Error(`makeKcUser ${r.status} ${JSON.stringify(r.body)}`)
  const u = (await userByEmail(e))!
  return { id: u.id as number, email: e, keycloakSub: u.keycloakSub as string }
}

describe('permissions + PT scoping', () => {
  it('only Admins of a PT / group admins: Staff → 403 on every route', async () => {
    const u = await makeKcUser('perm')
    expect((await api('POST', '/api/v1/user-onboarding', staffA, { user: { email: email('s'), name: 'S' }, companies: [{ company: A, roles: ['pk-staff'] }] })).status).toBe(403)
    expect((await api('GET', `/api/v1/user-onboarding/${u.id}`, staffA)).status).toBe(403)
    expect((await api('PATCH', `/api/v1/user-onboarding/${u.id}`, staffA, { user: { name: 'X' } })).status).toBe(403)
    expect((await api('GET', `/api/v1/user-onboarding/${u.id}`, null)).status).toBe(401)
  })

  it('a PT the caller does not administer → 403 naming the item, nothing written (Keycloak untouched)', async () => {
    const e = email('foreign')
    const before = fake.calls.length
    const r = await api('POST', '/api/v1/user-onboarding', adminA, { user: { email: e, name: 'Asing' }, companies: [{ company: A, roles: ['pk-staff'] }, { company: B, roles: ['pk-staff'] }] })
    expect(r.status).toBe(403)
    expect((r.body as Body).errors).toEqual([{ path: 'companies.1.company', message: 'Anda bukan Admin PT ini.' }])
    expect(await userByEmail(e)).toBeNull()
    expect(fake.calls.length).toBe(before)
  })

  it('GET: Admin of A reads only accounts of A (+ unassigned); the form lists only the caller\'s PTs', async () => {
    const onlyB = await makeUser(['pk-staff'], { label: 'ob-only-b', company: B })
    expect((await api('GET', `/api/v1/user-onboarding/${onlyB.id}`, adminA)).status).toBe(404)
    const own = await makeKcUser('scoped')
    const g = await api('GET', `/api/v1/user-onboarding/${own.id}`, adminA)
    expect(g.status).toBe(200)
    expect(((g.body as Body).companies as Body[]).map((c) => c.id)).toEqual([A])
    const g2 = await api('GET', `/api/v1/user-onboarding/${own.id}`, group)
    expect(((g2.body as Body).companies as Body[]).map((c) => c.id)).toEqual(expect.arrayContaining([A, B]))
  })

  it('account also active in a foreign PT: identity is read-only for the PT Admin (403), access in own PT still editable', async () => {
    const u = await makeKcUser('cross')
    await addMembership(u.id, B, ['pk-staff'])
    const g = await api('GET', `/api/v1/user-onboarding/${u.id}`, adminA)
    expect((g.body as Body).user.identityEditable).toBe(false)
    const id = await api('PATCH', `/api/v1/user-onboarding/${u.id}`, adminA, { user: { name: 'Diubah' } })
    expect(id.status).toBe(403)
    expect(((id.body as Body).errors as Body[])[0]?.path).toBe('user')
    const roles = await api('PATCH', `/api/v1/user-onboarding/${u.id}`, adminA, { companies: [{ company: A, roles: ['pk-staff', 'pk-pm'] }] })
    expect(roles.status, JSON.stringify(roles.body)).toBe(200)
    expect((await membership(u.id, A))!.roles).toEqual(['pk-pm', 'pk-staff'])
    // the Admin of B cannot touch A's membership through B's account either
    expect((await api('PATCH', `/api/v1/user-onboarding/${u.id}`, adminB, { companies: [{ company: A, roles: [] }] })).status).toBe(403)
  })

  it('own account: no self-deactivation, no removal of the own Admin role', async () => {
    const off = await api('PATCH', `/api/v1/user-onboarding/${adminA.id}`, adminA, { user: { active: false }, reason: 'uji' })
    expect(off.status).toBe(400)
    expect((off.body as Body).errors).toEqual([{ path: 'user.active', message: 'Anda tidak dapat menonaktifkan akun Anda sendiri.' }])
    const demote = await api('PATCH', `/api/v1/user-onboarding/${adminA.id}`, adminA, { companies: [{ company: A, roles: ['pk-staff'] }] })
    expect(demote.status).toBe(400)
    expect(((demote.body as Body).errors as Body[])[0]?.path).toBe('companies.0.roles')
    expect((await membership(adminA.id, A))!.roles).toEqual(['pk-admin'])
  })
})

describe('PATCH /api/v1/user-onboarding/{id} — edit flow', () => {
  it('roles, employee link + fields, bank accounts; collection reason rules apply (bank number change needs a reason)', async () => {
    const u = await makeKcUser('edit')
    // link a NEW employee + a bank account + a second PT (group admin may grant B access)
    const empCode = code()
    const r1 = await api('PATCH', `/api/v1/user-onboarding/${u.id}`, group, {
      user: { phone: '0812999' },
      companies: [
        { company: A, roles: ['pk-staff', 'pk-finance'], employee: { code: empCode, name: 'Edit Uji' }, bankAccounts: [{ bank, accountNo: '55556666', accountHolder: 'Edit Uji' }] },
        { company: B, roles: ['pk-staff'] },
      ],
    })
    expect(r1.status, JSON.stringify(r1.body)).toBe(200)
    const mA = (await membership(u.id, A))!
    expect(mA.roles).toEqual(['pk-finance', 'pk-staff'])
    expect(mA.employee).toBeTruthy()
    expect((await membership(u.id, B))!.roles).toEqual(['pk-staff'])
    expect((await userByEmail(u.email))!.phone).toBe('0812999')
    const cA = ((r1.body as Body).detail.companies as Body[]).find((c) => c.id === A)!
    const accId = cA.bankAccounts[0].id as number

    // changing the account number without a reason → 400 on `reason` (EmployeeBankAccounts rule), nothing saved
    const r2 = await api('PATCH', `/api/v1/user-onboarding/${u.id}`, group, { companies: [{ company: A, roles: ['pk-staff'], employee: { id: mA.employee, position: 'Kasir' }, bankAccounts: [{ id: accId, accountNo: '77778888' }] }] })
    expect(r2.status).toBe(400)
    expect(((r2.body as Body).errors as Body[]).map((x) => x.path)).toContain('reason')
    expect((await membership(u.id, A))!.roles).toEqual(['pk-finance', 'pk-staff']) // the role change rolled back too
    const emp = (await p.findByID({ collection: 'employees', id: mA.employee, depth: 0, overrideAccess: true /* SYSTEM-READ */ })) as unknown as Body
    expect(emp.position ?? null).toBeNull()

    // with the reason → saved, audited with it; verification by the Admin (Admin/Finance field rule)
    const r3 = await api('PATCH', `/api/v1/user-onboarding/${u.id}`, group, { reason: 'rekening diganti', companies: [{ company: A, roles: ['pk-staff'], employee: { id: mA.employee, position: 'Kasir' }, bankAccounts: [{ id: accId, accountNo: '77778888', verificationStatus: 'verified' }] }] })
    expect(r3.status, JSON.stringify(r3.body)).toBe(200)
    const acc = (await p.findByID({ collection: 'employee-bank-accounts', id: accId, depth: 0, overrideAccess: true /* SYSTEM-READ */ })) as unknown as Body
    expect(acc).toMatchObject({ accountNo: '77778888', verificationStatus: 'verified' })
    const rows = await auditRows('employee_bank_account', accId)
    expect(rows.find((x) => x.field === 'accountNo' && x.action === 'update')?.reason).toBe('rekening diganti')
    expect((await auditRows('company_membership', mA.id)).some((x) => x.action === 'role_change' && x.reason === 'rekening diganti')).toBe(true)

    // no role left in B = membership inactive (matrix rule); unlink the employee of A (record stays)
    const r4 = await api('PATCH', `/api/v1/user-onboarding/${u.id}`, group, { companies: [{ company: B, roles: [] }, { company: A, roles: ['pk-staff'], employee: null }] })
    expect(r4.status, JSON.stringify(r4.body)).toBe(200)
    expect((await membership(u.id, B))!.active).toBe(false)
    expect((await membership(u.id, A))!.employee ?? null).toBeNull()
    expect(await p.findByID({ collection: 'employees', id: mA.employee, depth: 0, overrideAccess: true /* SYSTEM-READ */ })).toBeTruthy()
  })

  it('linking an employee already linked to another account → 409 on the employee, nothing saved', async () => {
    const one = await makeKcUser('link1')
    const two = await makeKcUser('link2')
    const r = await api('PATCH', `/api/v1/user-onboarding/${one.id}`, adminA, { companies: [{ company: A, roles: ['pk-staff'], employee: { code: code(), name: 'Satu' } }] })
    expect(r.status).toBe(200)
    const empId = (await membership(one.id, A))!.employee as number
    const clash = await api('PATCH', `/api/v1/user-onboarding/${two.id}`, adminA, { companies: [{ company: A, roles: ['pk-staff', 'pk-pm'], employee: { id: empId } }] })
    expect(clash.status).toBe(409)
    expect(((clash.body as Body).errors as Body[])[0]?.path).toBe('companies.0.employee')
    expect((await membership(two.id, A))!.roles).toEqual(['pk-staff'])
  })

  it('deactivation with reason: Keycloak disabled + sessions ended (existing cascade), audited deactivate', async () => {
    const u = await makeKcUser('leave')
    const noReason = await api('PATCH', `/api/v1/user-onboarding/${u.id}`, adminA, { user: { active: false } })
    expect(noReason.status).toBe(400)
    expect(((noReason.body as Body).errors as Body[]).map((x) => x.path)).toContain('reason')
    expect(fake.users.get(u.keycloakSub)?.enabled).toBe(true) // compensated
    const r = await api('PATCH', `/api/v1/user-onboarding/${u.id}`, adminA, { user: { active: false }, reason: 'karyawan keluar' })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(fake.users.get(u.keycloakSub)?.enabled).toBe(false)
    expect(fake.calls.some((c) => c.op === 'logoutUser' && c.args[0] === u.keycloakSub)).toBe(true)
    const rows = await auditRows('user', u.id)
    expect(rows.find((x) => x.action === 'deactivate')?.reason).toBe('karyawan keluar')
    const s = await sqlAs('app', 'SELECT count(*)::int AS n FROM audit_logs WHERE doc_type = $1 AND doc_id = $2 AND action = $3', ['user', String(u.id), 'session_revoked'])
    expect(s.rows[0].n).toBe(1)
  })

  it('unknown / unreadable id → 404', async () => {
    expect((await api('PATCH', '/api/v1/user-onboarding/999999999', adminA, { user: { name: 'X' } })).status).toBe(404)
    expect((await api('GET', '/api/v1/user-onboarding/abc', adminA)).status).toBe(404)
  })
})

describe('POST /api/v1/user-onboarding/{id}/reset-password — DRMS 27/10', () => {
  it('new TEMPORARY password in Keycloak, returned once, audited as a fact; old password replaced', async () => {
    const u = await makeKcUser('reset')
    const before = fake.users.get(u.keycloakSub)!.password!.value
    const r = await api('POST', `/api/v1/user-onboarding/${u.id}/reset-password`, adminA)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const b = r.body as Body
    expect(b.userId).toBe(u.id)
    expect(b.temporaryPassword).toMatch(/^[A-Za-z2-9!@#$%*?\-+=]{14}$/)
    expect(b.temporaryPassword).not.toBe(before)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(fake.users.get(u.keycloakSub)!.password).toEqual({ value: b.temporaryPassword, temporary: true })
    const rows = (await auditRows('user', u.id)).filter((x) => x.field === 'password')
    expect(rows).toHaveLength(2) // create + reset
    expect(rows[1]).toMatchObject({ action: 'update', new_value: null, user_id: String(adminA.id) })
    expect(rows[1]!.reason).toContain('direset')
    expect(JSON.stringify(rows)).not.toContain(b.temporaryPassword)
  })

  it('refused: Staff 403, own account 400, foreign-PT account 403, inactive 409, unknown 404 — Keycloak untouched', async () => {
    const u = await makeKcUser('reset-deny')
    const n = fake.calls.filter((c) => c.op === 'resetPassword').length
    expect((await api('POST', `/api/v1/user-onboarding/${u.id}/reset-password`, staffA)).status).toBe(403)
    expect((await api('POST', `/api/v1/user-onboarding/${adminA.id}/reset-password`, adminA)).status).toBe(400)
    expect((await api('POST', `/api/v1/user-onboarding/${u.id}/reset-password`, adminB)).status).toBe(404)
    expect((await api('POST', '/api/v1/user-onboarding/999999999/reset-password', adminA)).status).toBe(404)
    const cross = await makeKcUser('reset-cross')
    await addMembership(cross.id, B, ['pk-staff'])
    expect((await api('POST', `/api/v1/user-onboarding/${cross.id}/reset-password`, adminA)).status).toBe(403)
    const off = await makeKcUser('reset-off')
    expect((await api('PATCH', `/api/v1/user-onboarding/${off.id}`, adminA, { user: { active: false }, reason: 'keluar' })).status).toBe(200)
    expect((await api('POST', `/api/v1/user-onboarding/${off.id}/reset-password`, adminA)).status).toBe(409)
    expect(fake.calls.filter((c) => c.op === 'resetPassword').length).toBe(n + 2) // only the two makeKcUser creates
  })

  it('Keycloak refusing → 502 KEYCLOAK_FAILED, no audit row (rolled back)', async () => {
    const u = await makeKcUser('reset-kc')
    const real = getKeycloakAdmin()
    setKeycloakAdmin({ ...real, resetPassword: async () => { throw new KeycloakPasswordPolicyError('invalidPasswordHistoryMessage', 20) } })
    try {
      const r = await api('POST', `/api/v1/user-onboarding/${u.id}/reset-password`, adminA)
      expect(r.status).toBe(502)
      expect((r.body as Body).code).toBe('KEYCLOAK_FAILED')
    } finally {
      setKeycloakAdmin(real)
    }
    expect((await auditRows('user', u.id)).filter((x) => x.field === 'password')).toHaveLength(1) // the create only
  })
})
