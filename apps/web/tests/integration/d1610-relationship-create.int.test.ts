import { randomUUID } from 'node:crypto'

import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'

import { api, makeFlowUser, type FlowUser } from './flow-world'
import { companyId, getTestPayload } from './helpers'

/**
 * DRMS 16/10 (b): the "+ <Klien|Vendor|Karyawan> baru" drawers of the relationship pickers
 * (admin/components/relationship/CreatableRelationshipField.tsx) — the saves they make, as the roles that see the "+":
 * Klien / Vendor through the tabbed form's endpoint with the parent form's PT, then picked by the parent form (project,
 * vendor bank account); Karyawan through Payload's REST create of the plain employee form with `initialData.company`
 * (no user account). Roles without the create right (the "+" is hidden for them) are refused by the server too.
 * PT A = #1 DRMS (the only active PT here).
 */
let p: Payload
let A = 0
const tag = randomUUID().slice(0, 6).toUpperCase()
let adminA: FlowUser
let financeA: FlowUser
let direkturA: FlowUser
let pmA: FlowUser
type Body = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(async () => {
  p = await getTestPayload()
  A = await companyId()
  adminA = await makeFlowUser(['pk-admin'], 'rc-admin-a', null, { signature: false, groupAdmin: false })
  financeA = await makeFlowUser(['pk-finance'], 'rc-finance-a', null, { signature: false })
  direkturA = await makeFlowUser(['pk-owner'], 'rc-direktur-a', null, { signature: false })
  pmA = await makeFlowUser(['pk-pm'], 'rc-pm-a', null, { signature: false })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  await p.destroy()
})

describe('"+ Klien baru" on the project form', () => {
  it('the drawer saves the client in the project PT; the new id is a valid project client', async () => {
    const r = await api('POST', '/api/v1/client-form', direkturA, { client: { company: A, name: `Klien Drawer ${tag}` }, contacts: [{ name: 'PIC Drawer' }] })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const clientId = (r.body as Body).id as number
    const project = await api('POST', '/api/projects', direkturA, { code: `RC-${tag}`, name: `Proyek Drawer ${tag}`, status: 'berjalan', pm: pmA.id, client: clientId })
    expect(project.status, JSON.stringify(project.body)).toBe(201)
    expect((project.body as Body).doc).toMatchObject({ client: expect.anything(), company: expect.anything() })
    const saved = (await p.findByID({ collection: 'projects', id: (project.body as Body).doc.id, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })) as unknown as Body
    expect([saved.client, saved.company]).toEqual([clientId, A])
  })

  it('PM / Finance (no "+" for them) cannot create a client', async () => {
    for (const u of [pmA, financeA]) expect((await api('POST', '/api/v1/client-form', u, { client: { company: A, name: `Klien Tolak ${tag}` } })).status).toBe(403)
  })
})

describe('"+ Vendor baru" on the vendor bank account / payment forms', () => {
  it('Finance creates the vendor in the drawer; its account can then name it', async () => {
    const r = await api('POST', '/api/v1/vendor-form', financeA, { vendor: { company: A, name: `Vendor Drawer ${tag}` } })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const vendorId = (r.body as Body).id as number
    const bank = (await p.create({ collection: 'banks', data: { code: `RC${tag}`, name: `Bank RC ${tag}` }, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */ })).id as number
    const acc = await api('POST', '/api/vendor-bank-accounts', financeA, { vendor: vendorId, bank, accountNo: `7${String(Date.now() % 1e9).padStart(9, '0')}`, accountHolder: `Vendor Drawer ${tag}` })
    expect(acc.status, JSON.stringify(acc.body)).toBe(201)
    expect((acc.body as Body).doc.company).toBe(A)
  })
})

describe('"+ Karyawan baru" (Pemohon, penugasan, rekening karyawan)', () => {
  it('Admin: the plain employee form with initialData.company creates the employee in that PT and no user account', async () => {
    const users = (await p.count({ collection: 'users', overrideAccess: true /* SYSTEM-READ: assertion */ })).totalDocs
    const r = await api('POST', '/api/employees', adminA, { company: A, code: `RC-${tag}`, name: `Karyawan Drawer ${tag}` })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const e = (await p.findByID({ collection: 'employees', id: (r.body as Body).doc.id, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })) as unknown as Body
    expect(e.company).toBe(A)
    expect((await p.count({ collection: 'users', overrideAccess: true /* SYSTEM-READ: assertion */ })).totalDocs).toBe(users)
  })

  it('Finance / PM / Direktur (no "+" for them) cannot create an employee', async () => {
    for (const u of [financeA, pmA, direkturA]) expect((await api('POST', '/api/employees', u, { company: A, code: `RCX-${tag}`, name: `Karyawan Tolak ${tag}` })).status).toBe(403)
  })
})
