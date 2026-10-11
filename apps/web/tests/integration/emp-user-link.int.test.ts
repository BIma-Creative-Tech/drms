import { randomUUID } from 'node:crypto'

import { createLocalReq, type Payload } from 'payload'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { EmployeeLinksPanel, employeeLinksOf } from '@/admin/components/users/EmployeeLinksPanel'
import { SKIP_COMPANY_DEFAULTS } from '@/domain/company-defaults'
import { LINK_FORBIDDEN_MESSAGE, userAccountOptions } from '@/domain/employee-user-link'

import { api, makeFlowUser, sysCreate, type FlowUser } from './flow-world'
import { addMembership, auditRows, companyId, getTestPayload, makeUser, withContext, type TestUser } from './helpers'

/**
 * Owner decision 2026-10-10 — "Akun pengguna" on the employee form. The field is VIRTUAL: the link
 * stays on company-memberships.employee (unique (company, employee), same-PT trigger), written through
 * the membership collection (its access + audit) in the employee's transaction.
 *
 * PTs: A = #1 DRMS, B = "PT Tautan B" (EUB…, deactivated in afterAll). adminA = Admin of A only (not group admin), ownerA =
 * Direktur of A, adminB = Admin of B only. Accounts acc1..acc4 = Operator/Staff of A without employee,
 * accOff = inactive membership in A, accB = member of B only.
 */
let p: Payload
let A = 0
let B = 0
const tag = randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'Q')
let adminA: FlowUser
let ownerA: FlowUser
let adminB: FlowUser
let acc1: TestUser
let acc2: TestUser
let acc3: TestUser
let acc4: TestUser
let accOff: TestUser
let accB: TestUser
type Body = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function membership(user: number, company: number): Promise<{ id: number; employee: number | null }> {
  const r = await p.find({ collection: 'company-memberships', where: { and: [{ user: { equals: user } }, { company: { equals: company } }] }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })
  const m = r.docs[0] as unknown as { id: number; employee?: number | null }
  return { id: m.id, employee: m.employee ?? null }
}
const linkOf = async (user: number, company = A) => (await membership(user, company)).employee

let seq = 0
const code = () => `EUL-${tag}-${++seq}`

async function createAs(user: FlowUser, data: Record<string, unknown>) {
  return (await p.create({ collection: 'employees', data: { company: A, code: code(), name: `Karyawan ${tag} ${seq}`, ...data } as never, depth: 0, user, overrideAccess: false })) as unknown as Body
}
async function updateAs(user: FlowUser, id: number, data: Record<string, unknown>) {
  return (await p.update({ collection: 'employees', id, data: data as never, depth: 0, user, overrideAccess: false })) as unknown as Body
}
/** status + field errors of a rejected Local API call */
async function rejected(fn: () => Promise<unknown>): Promise<{ status: number; errors: Array<[string, string]> }> {
  try {
    await fn()
  } catch (e) {
    const err = e as { status?: number; data?: { errors?: Array<{ path: string; message: string }> } }
    return { status: err.status ?? 0, errors: (err.data?.errors ?? []).map((x) => [x.path, x.message]) }
  }
  throw new Error('expected a rejection')
}

beforeAll(async () => {
  p = await getTestPayload()
  A = await companyId()
  B = (await p.create({ collection: 'companies', data: { name: `PT Tautan B ${tag}`, shortCode: `EUB${tag}`, timezone: 'Asia/Makassar', active: true } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */, context: { [SKIP_COMPANY_DEFAULTS]: true } })).id as number
  adminA = await makeFlowUser(['pk-admin'], 'eul-admin-a', null, { signature: false, groupAdmin: false })
  ownerA = await makeFlowUser(['pk-owner'], 'eul-owner-a', null, { signature: false })
  adminB = await makeFlowUser(['pk-admin'], 'eul-admin-b', null, { signature: false, groupAdmin: false, company: B })
  acc1 = await makeUser(['pk-operator'], { label: 'eul-acc1' })
  acc2 = await makeUser(['pk-staff'], { label: 'eul-acc2' }) // Staff reads employees (Operator does not)
  acc3 = await makeUser(['pk-operator'], { label: 'eul-acc3' })
  acc4 = await makeUser(['pk-staff'], { label: 'eul-acc4' })
  accOff = await makeUser(['pk-operator'], { label: 'eul-off' })
  const off = await membership(accOff.id, A)
  await p.update({ collection: 'company-memberships', id: off.id, data: { active: false }, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  accB = await makeUser(['pk-operator'], { label: 'eul-accb', company: B })
})

afterAll(async () => {
  // the other files assume the single-active-company default (writes without `company`)
  if (B) await p.update({ collection: 'companies', id: B, data: { active: false, changeReason: 'uji akun pengguna selesai' } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

describe('create with "Akun pengguna"', () => {
  it('links the membership in the same save, audited as a membership change by the Admin', async () => {
    const emp = await createAs(adminA, { userAccount: acc1.id })
    expect(emp.userAccount).toBe(acc1.id)
    const m = await membership(acc1.id, A)
    expect(m.employee).toBe(emp.id)
    const rows = await auditRows('company_membership', m.id)
    const link = rows.find((r) => r.field === 'employee' && r.new_value?.v === emp.id)
    expect(link, JSON.stringify(rows)).toBeDefined()
    expect(link!.user_id).toBe(String(adminA.id))
    expect(link!.reason).toMatch(/Akun pengguna diatur dari data karyawan/)
    // the virtual field is never an employee audit field
    expect((await auditRows('employee', emp.id)).some((r) => r.field === 'userAccount')).toBe(false)
  })

  it('a create without an account changes no membership', async () => {
    const emp = await createAs(adminA, {})
    expect(emp.userAccount ?? null).toBeNull()
    expect((await p.find({ collection: 'company-memberships', where: { employee: { equals: emp.id } }, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })).totalDocs).toBe(0)
  })

  it('an account without access to the PT → 400 on the field and NO employee is created', async () => {
    const c = `EUL-${tag}-NOACC`
    const r = await rejected(() => p.create({ collection: 'employees', data: { company: A, code: c, name: 'Tanpa akses', userAccount: accB.id } as never, depth: 0, user: adminA, overrideAccess: false }))
    expect(r).toEqual({ status: 400, errors: [['userAccount', 'Akun ini belum punya akses di PT ini — tambahkan aksesnya di Akses PT dulu.']] })
    expect((await p.find({ collection: 'employees', where: { code: { equals: c } }, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })).totalDocs).toBe(0)
  })

  it('system writes (seed/import, no user) may link too', async () => {
    const id = await sysCreate('employees', { company: A, code: code(), name: 'Sistem', userAccount: acc4.id })
    expect(await linkOf(acc4.id)).toBe(id)
    await p.update({ collection: 'employees', id, data: { userAccount: null } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture reset */ })
    expect(await linkOf(acc4.id)).toBeNull()
  })
})

describe('update', () => {
  let emp: Body
  let other: Body
  beforeAll(async () => {
    emp = await createAs(adminA, { userAccount: acc2.id })
    other = await createAs(adminA, { name: `Lain ${tag}`, userAccount: acc3.id })
  })

  it('afterRead shows the linked account to the PT Admin (id / populated) and the person themself; not to the Direktur', async () => {
    expect((await p.findByID({ collection: 'employees', id: emp.id, depth: 0, user: adminA, overrideAccess: false })).userAccount).toBe(acc2.id)
    const deep = await p.findByID({ collection: 'employees', id: emp.id, depth: 1, user: adminA, overrideAccess: false })
    expect((deep.userAccount as { id?: number } | null)?.id).toBe(acc2.id)
    const self = await withContext(acc2)
    expect((await p.findByID({ collection: 'employees', id: emp.id, depth: 0, user: { ...self, collection: 'users' }, overrideAccess: false })).userAccount).toBe(acc2.id)
    const asOwner = await p.findByID({ collection: 'employees', id: emp.id, depth: 0, user: ownerA, overrideAccess: false })
    expect(asOwner.userAccount).toBeUndefined()
    // a list resolves every row (one batched membership query)
    const list = await p.find({ collection: 'employees', where: { id: { in: [emp.id, other.id] } }, depth: 0, user: adminA, overrideAccess: false })
    expect(Object.fromEntries(list.docs.map((d) => [d.id, d.userAccount]))).toEqual({ [emp.id]: acc2.id, [other.id]: acc3.id })
  })

  it('a save without the field (or with the same account) keeps the link — incl. the Direktur editing other fields', async () => {
    await updateAs(adminA, emp.id, { position: 'Teknisi' })
    expect(await linkOf(acc2.id)).toBe(emp.id)
    await updateAs(adminA, emp.id, { position: 'Teknisi 2', userAccount: acc2.id })
    expect(await linkOf(acc2.id)).toBe(emp.id)
    await updateAs(ownerA, emp.id, { position: 'Teknisi 3' })
    expect(await linkOf(acc2.id)).toBe(emp.id)
  })

  it('changing the account clears the old membership and links the new one (both audited)', async () => {
    const before = await membership(acc2.id, A)
    const doc = await updateAs(adminA, emp.id, { userAccount: acc4.id })
    expect(doc.userAccount).toBe(acc4.id)
    expect(await linkOf(acc2.id)).toBeNull()
    expect(await linkOf(acc4.id)).toBe(emp.id)
    expect((await auditRows('company_membership', before.id)).some((r) => r.field === 'employee' && r.new_value?.v === null && r.user_id === String(adminA.id))).toBe(true)
  })

  it('an account already linked to another employee → 400 naming that employee; nothing changes', async () => {
    const r = await rejected(() => updateAs(adminA, emp.id, { userAccount: acc3.id }))
    expect(r).toEqual({ status: 400, errors: [['userAccount', `Akun ini sudah tertaut ke karyawan ${other.code} ${other.name}.`]] })
    expect(await linkOf(acc4.id)).toBe(emp.id)
    expect(await linkOf(acc3.id)).toBe(other.id)
  })

  it('inactive access in the PT / no access → 400; nothing changes', async () => {
    expect(await rejected(() => updateAs(adminA, emp.id, { userAccount: accOff.id }))).toEqual({ status: 400, errors: [['userAccount', 'Akses akun ini di PT ini nonaktif — aktifkan dulu di Akses PT.']] })
    expect((await rejected(() => updateAs(adminA, emp.id, { userAccount: accB.id }))).errors[0]?.[0]).toBe('userAccount')
    expect(await linkOf(acc4.id)).toBe(emp.id)
    expect(await linkOf(accOff.id)).toBeNull()
  })

  it('a caller who may not update the PT memberships (Direktur) → 403 on the field; nothing written', async () => {
    const r = await rejected(() => updateAs(ownerA, emp.id, { position: 'Diubah Direktur', userAccount: acc2.id }))
    expect(r).toEqual({ status: 403, errors: [['userAccount', LINK_FORBIDDEN_MESSAGE]] })
    expect(await linkOf(acc4.id)).toBe(emp.id)
    expect(await linkOf(acc2.id)).toBeNull()
    expect((await p.findByID({ collection: 'employees', id: emp.id, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })).position).not.toBe('Diubah Direktur')
    // Admin of another PT cannot even update the employee
    await expect(updateAs(adminB, emp.id, { userAccount: acc2.id })).rejects.toMatchObject({ status: 403 })
  })

  it('REST (admin form path): field error 400 / 403 with the path, success sets the link', async () => {
    const bad = await api('PATCH', `/api/employees/${emp.id}?depth=0`, adminA, { userAccount: accB.id })
    expect(bad.status).toBe(400)
    expect((bad.body as Body).errors[0].data.errors[0]).toMatchObject({ path: 'userAccount' })
    const denied = await api('PATCH', `/api/employees/${emp.id}?depth=0`, ownerA, { userAccount: acc2.id })
    expect(denied.status).toBe(403)
    expect((denied.body as Body).errors[0].data.errors[0]).toMatchObject({ path: 'userAccount', message: LINK_FORBIDDEN_MESSAGE })
    const good = await api('PATCH', `/api/employees/${emp.id}?depth=0`, adminA, { userAccount: acc2.id })
    expect(good.status, JSON.stringify(good.body)).toBe(200)
    expect((good.body as Body).doc.userAccount).toBe(acc2.id)
    expect(await linkOf(acc2.id)).toBe(emp.id)
    expect(await linkOf(acc4.id)).toBeNull()
  })

  it('clearing the field unlinks', async () => {
    const doc = await updateAs(adminA, emp.id, { userAccount: null })
    expect(doc.userAccount ?? null).toBeNull()
    expect(await linkOf(acc2.id)).toBeNull()
  })

  it('picker: free accounts of the PT + the linked one; never linked-elsewhere, inactive or other-PT accounts', async () => {
    await updateAs(adminA, emp.id, { userAccount: acc2.id })
    const req = await createLocalReq({ user: adminA as never }, p)
    const where = await userAccountOptions({ data: { company: A }, id: emp.id, req } as never)
    const ids = (await p.find({ collection: 'users', where, depth: 0, pagination: false, user: adminA, overrideAccess: false })).docs.map((u) => u.id)
    expect(ids).toEqual(expect.arrayContaining([acc2.id, acc4.id]))
    for (const x of [acc3.id, accOff.id, accB.id]) expect(ids).not.toContain(x)
    // create form: same without a current one; no PT chosen with several PTs → nothing
    const createWhere = await userAccountOptions({ data: { company: A }, id: undefined, req } as never)
    const createIds = (await p.find({ collection: 'users', where: createWhere, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: assertion */ })).docs.map((u) => u.id)
    expect(createIds).toContain(acc4.id)
    expect(createIds).not.toContain(acc2.id)
    const multi = await makeUser(['pk-admin'], { label: 'eul-multi', groupAdmin: false })
    await addMembership(multi.id, B, ['pk-staff'])
    const multiReq = await createLocalReq({ user: { ...(await withContext(multi)), collection: 'users' } as never }, p)
    expect(await userAccountOptions({ data: {}, id: undefined, req: multiReq } as never)).toEqual({ id: { equals: 0 } })
  })
})

describe('user form "Karyawan per PT"', () => {
  it('lists the memberships the viewer may read: linked employee ("Buka") or "Belum tertaut" + "Buat karyawan" (prefilled)', async () => {
    const both = await makeUser(['pk-operator'], { label: 'eul-panel' })
    await addMembership(both.id, B, ['pk-operator'])
    const emp = await createAs(adminA, { userAccount: both.id })
    const req = await createLocalReq({ user: adminA as never }, p)
    const rows = await employeeLinksOf(req, both.id)
    // adminA is Admin of A only: the B membership row is not readable for them
    expect(rows.map((r) => [r.company, r.employee?.id ?? null, r.canCreate])).toEqual([[A, emp.id, true]])
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null, await EmployeeLinksPanel({ req, id: both.id } as never)))
    expect(html).toContain('Karyawan per PT')
    expect(html).toContain(`href="/admin/collections/employees/${emp.id}"`)
    expect(html).toMatch(/aria-label="Buka karyawan [^"]+"/)

    const reqB = await createLocalReq({ user: adminB as never }, p)
    const rowsB = await employeeLinksOf(reqB, both.id)
    expect(rowsB.map((r) => [r.company, r.employee, r.canCreate])).toEqual([[B, null, true]])
    const htmlB = renderToStaticMarkup(React.createElement(React.Fragment, null, await EmployeeLinksPanel({ req: reqB, id: both.id } as never)))
    expect(htmlB).toContain('Belum tertaut')
    expect(htmlB).toContain(`href="/admin/collections/employees/create?company=${B}&amp;user=${both.id}"`)
    expect(htmlB).toMatch(/aria-label="Buat karyawan untuk akun ini di PT [^"]+"/)

    // a new account (no id yet) → hint only
    const htmlNew = renderToStaticMarkup(React.createElement(React.Fragment, null, await EmployeeLinksPanel({ req, id: undefined } as never)))
    expect(htmlNew).toContain('Simpan pengguna ini dulu')
  })
})
