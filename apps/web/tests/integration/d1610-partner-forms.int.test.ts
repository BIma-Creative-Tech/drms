import { randomUUID } from 'node:crypto'

import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { SKIP_COMPANY_DEFAULTS } from '@/domain/company-defaults'
import { resetRateLimits } from '@/lib/rate-limit'

import { api, makeFlowUser, type FlowUser } from './flow-world'
import { auditRows, companyId, fixturePm, getTestPayload, sqlAs } from './helpers'

/**
 * DRMS 16/10 — "Klien" / "Vendor" tabbed pages: GET / POST / PATCH /api/v1/client-form and /api/v1/vendor-form.
 * One transaction for the record + its Kontak PIC (+ the vendor's bank accounts), the existing collection rules
 * (create / update roles per PT, bank accounts Admin / Finance, verification, reason on deactivation and on a changed
 * account number / holder / bank), the single Kontak / No. HP columns derived from the primary contact, audit rows,
 * the PT scoping and the client's projects tab.
 *
 * PTs: A = #1 DRMS, B = "PT Mitra B" (PMB…, deactivated in afterAll). adminA / financeA / direkturA / pmA = that role in
 * A only; adminB = Admin of B only.
 */
let p: Payload
let A = 0
let B = 0
let bank = 0
const tag = randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'Q')
let adminA: FlowUser
let financeA: FlowUser
let direkturA: FlowUser
let pmA: FlowUser
let adminB: FlowUser
type Body = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

let seq = 0
const name = (label: string) => `${label} ${tag}-${++seq}`
const accountNo = () => `5${String(Date.now() % 1e9).padStart(9, '0')}${++seq}`

async function doc(collection: 'clients' | 'vendors' | 'vendor-bank-accounts', id: number): Promise<Body> {
  return (await p.findByID({ collection, id, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })) as unknown as Body
}
async function countByName(collection: 'clients' | 'vendors', n: string): Promise<number> {
  return (await p.count({ collection, where: { name: { equals: n } }, overrideAccess: true /* SYSTEM-READ: assertion */ })).totalDocs
}

beforeAll(async () => {
  p = await getTestPayload()
  A = await companyId()
  B = (await p.create({ collection: 'companies', data: { name: `PT Mitra B ${tag}`, shortCode: `PMB${tag}`, timezone: 'Asia/Makassar', active: true } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */, context: { [SKIP_COMPANY_DEFAULTS]: true } })).id as number
  bank = (await p.create({ collection: 'banks', data: { code: `PFB${tag}`, name: `Bank Mitra ${tag}` }, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */ })).id as number
  adminA = await makeFlowUser(['pk-admin'], 'pf-admin-a', null, { signature: false, groupAdmin: false })
  financeA = await makeFlowUser(['pk-finance'], 'pf-finance-a', null, { signature: false })
  direkturA = await makeFlowUser(['pk-owner'], 'pf-direktur-a', null, { signature: false })
  pmA = await makeFlowUser(['pk-pm'], 'pf-pm-a', null, { signature: false })
  adminB = await makeFlowUser(['pk-admin'], 'pf-admin-b', null, { signature: false, groupAdmin: false, company: B })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  // the other files assume the single-active-company default (writes without `company`)
  if (B) await p.update({ collection: 'companies', id: B, data: { active: false, changeReason: 'uji form klien / vendor selesai' } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
  await p.destroy()
})

describe('Klien — POST / GET / PATCH /api/v1/client-form', () => {
  it('creates the client with its contact persons in ONE transaction; the single Kontak / No. HP = the primary contact; audited', async () => {
    const n = name('PT Klien Uji')
    const r = await api('POST', '/api/v1/client-form', adminA, {
      client: { name: n, address: 'Jl. Contoh 1' },
      contacts: [
        { name: 'Budi Uji', position: 'Direktur', phone: '0811000111' },
        { name: 'Sari Uji', phone: '0811000222', email: 'Sari@Example.test', isPrimary: true },
      ],
    })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const b = r.body as Body
    expect(b.created).toBe(true)
    expect(r.headers.get('cache-control')).toBe('no-store')
    const c = await doc('clients', b.id)
    expect(c).toMatchObject({ name: n, company: A, contact: 'Sari Uji', phone: '0811000222', address: 'Jl. Contoh 1' })
    expect((c.contacts as Body[]).map((x) => [x.name, x.isPrimary, x.email ?? null])).toEqual([
      ['Budi Uji', false, null],
      ['Sari Uji', true, 'sari@example.test'],
    ])
    // the detail of the response = what the form shows
    expect(b.detail.client.contacts).toHaveLength(2)
    expect(b.detail.companies.map((x: Body) => x.id)).toEqual([A])
    expect(b.detail.canEdit).toBe(true)
    expect(b.detail.canCreateProject).toBe(true)
    const rows = await auditRows('client', b.id)
    expect(rows.find((x) => x.field === 'contacts')?.action).toBe('create')
    expect(rows.every((x) => x.user_id === String(adminA.id))).toBe(true)
  })

  it('validation before anything is written: no name, a contact without name / with a bad email → 400 with field paths', async () => {
    const r = await api('POST', '/api/v1/client-form', adminA, { client: { name: ' ' }, contacts: [{ name: '' }, { name: 'X', email: 'bukan-email' }] })
    expect(r.status).toBe(400)
    expect(((r.body as Body).errors as Body[]).map((e) => e.path)).toEqual(['client.name', 'contacts.0.name', 'contacts.1.email'])
  })

  it('PATCH: contacts replaced as a whole (ids kept), deactivation needs a reason; refused → nothing saved', async () => {
    const n = name('PT Klien Ubah')
    const created = (await api('POST', '/api/v1/client-form', adminA, { client: { name: n }, contacts: [{ name: 'Andi' }, { name: 'Bayu' }] })).body as Body
    const [andi, bayu] = created.detail.client.contacts as Body[]
    // deactivate + change contacts without a reason → 400 on reason, contacts unchanged too
    const noReason = await api('PATCH', `/api/v1/client-form/${created.id}`, adminA, { client: { active: false }, contacts: [{ id: bayu!.id, name: 'Bayu', isPrimary: true }] })
    expect(noReason.status).toBe(400)
    expect(((noReason.body as Body).errors as Body[]).map((e) => e.path)).toEqual(['reason'])
    expect(((await doc('clients', created.id)).contacts as Body[]).length).toBe(2)
    // with the reason → saved in one go
    const ok = await api('PATCH', `/api/v1/client-form/${created.id}`, adminA, { client: { active: false }, contacts: [{ id: bayu!.id, name: 'Bayu', phone: '0812', isPrimary: true }, { name: 'Citra' }], reason: 'klien tutup' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    const c = await doc('clients', created.id)
    expect(c.active).toBe(false)
    expect((c.contacts as Body[]).map((x) => [x.name, x.isPrimary])).toEqual([
      ['Bayu', true],
      ['Citra', false],
    ])
    expect((c.contacts as Body[])[0]!.id).toBe(bayu!.id)
    expect((c.contacts as Body[]).some((x) => x.id === andi!.id)).toBe(false)
    expect([c.contact, c.phone]).toEqual(['Bayu', '0812'])
    const rows = await auditRows('client', created.id)
    expect(rows.find((x) => x.action === 'deactivate')?.reason).toBe('klien tutup')
    expect(rows.filter((x) => x.field === 'contacts' && x.action === 'update').at(-1)?.reason).toBe('klien tutup')
    // unchanged list → nothing written (no new audit row)
    const before = (await auditRows('client', created.id)).length
    const same = await api('PATCH', `/api/v1/client-form/${created.id}`, adminA, { contacts: (ok.body as Body).detail.client.contacts })
    expect(same.status).toBe(200)
    expect((await auditRows('client', created.id)).length).toBe(before)
  })

  it('permissions: Finance cannot create (403), PM reads read-only (canEdit false) and cannot save (403), another PT → 404', async () => {
    expect((await api('GET', '/api/v1/client-form', financeA)).status).toBe(403)
    expect((await api('POST', '/api/v1/client-form', financeA, { client: { name: name('X') } })).status).toBe(403)
    const created = (await api('POST', '/api/v1/client-form', direkturA, { client: { name: name('PT Klien Direktur') } })).body as Body
    expect(created.id).toBeGreaterThan(0)
    const g = await api('GET', `/api/v1/client-form/${created.id}`, pmA)
    expect(g.status).toBe(200)
    expect((g.body as Body).canEdit).toBe(false)
    const w = await api('PATCH', `/api/v1/client-form/${created.id}`, pmA, { client: { name: 'Diubah PM' } })
    expect(w.status).toBe(403)
    expect((await doc('clients', created.id)).name).not.toBe('Diubah PM')
    expect((await api('GET', `/api/v1/client-form/${created.id}`, adminB)).status).toBe(404)
    expect((await api('PATCH', `/api/v1/client-form/${created.id}`, adminB, { client: { name: 'X' } })).status).toBe(404)
    // a PT the caller does not hold the create role in → 403 naming the field
    const foreign = await api('POST', '/api/v1/client-form', adminA, { client: { company: B, name: name('Asing') } })
    expect(foreign.status).toBe(403)
    expect(((foreign.body as Body).errors as Body[])[0]?.path).toBe('client.company')
    expect((await api('GET', '/api/v1/client-form/abc', adminA)).status).toBe(404)
    expect((await api('GET', '/api/v1/client-form/1', null)).status).toBe(401)
  })

  it('tab Proyek: the client\'s projects the caller can read; "+ Proyek baru" for Direktur / Admin / PM of the PT', async () => {
    const created = (await api('POST', '/api/v1/client-form', adminA, { client: { name: name('PT Klien Proyek') } })).body as Body
    const project = await p.create({ collection: 'projects', data: { company: A, code: `PF-${tag}-${++seq}`, name: 'Proyek Klien Uji', pm: await fixturePm(A), client: created.id, status: 'berjalan' } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    const g = await api('GET', `/api/v1/client-form/${created.id}`, adminA)
    expect(((g.body as Body).projects as Body[]).map((x) => x.id)).toEqual([project.id])
    expect((g.body as Body).canCreateProject).toBe(true)
    // the PM sees only its team's projects (not this one) but may start a project for the client
    const gp = await api('GET', `/api/v1/client-form/${created.id}`, pmA)
    expect((gp.body as Body).projects).toEqual([])
    expect((gp.body as Body).canCreateProject).toBe(true)
    const gf = await api('GET', `/api/v1/client-form/${created.id}`, financeA)
    expect((gf.body as Body).canCreateProject).toBe(false)
  })

  it('a create with only the single Kontak / No. HP (seed, import) becomes the primary contact', async () => {
    const c = await p.create({ collection: 'clients', data: { company: A, name: name('PT Klien Lama'), contact: 'Pak Lama', phone: '0813' } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture (import path) */ })
    expect(((await doc('clients', c.id as number)).contacts as Body[]).map((x) => [x.name, x.phone, x.isPrimary])).toEqual([['Pak Lama', '0813', true]])
  })
})

describe('Vendor — POST / GET / PATCH /api/v1/vendor-form', () => {
  it('creates vendor + contacts + bank accounts in ONE transaction (the accounts get the new vendor and its PT)', async () => {
    const n = name('CV Vendor Uji')
    const no = accountNo()
    const r = await api('POST', '/api/v1/vendor-form', financeA, {
      vendor: { name: n, npwp: '01.234.567.8-901.000' },
      contacts: [{ name: 'Dodi Uji', phone: '0815' }],
      bankAccounts: [{ bank, accountNo: `${no.slice(0, 3)}-${no.slice(3)}`, accountHolder: n, isDefault: true, verificationStatus: 'verified' }],
    })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const b = r.body as Body
    const v = await doc('vendors', b.id)
    expect(v).toMatchObject({ name: n, company: A, contact: 'Dodi Uji', npwp: '01.234.567.8-901.000' })
    const acc = await p.find({ collection: 'vendor-bank-accounts', where: { vendor: { equals: b.id } }, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })
    expect(acc.docs).toHaveLength(1)
    expect(acc.docs[0]).toMatchObject({ accountNo: no, company: A, isDefault: true, verificationStatus: 'verified' })
    expect(b.detail.bankAccounts[0].accountNo).toBe(no)
    expect(b.detail.companies[0].canManageBankAccounts).toBe(true)
    // one transaction: vendor + account audit rows share the tx id
    const vRows = await auditRows('vendor', b.id)
    const aRows = await auditRows('vendor_bank_account', acc.docs[0]!.id as number)
    expect(new Set([...vRows, ...aRows].map((x) => x.tx_id)).size).toBe(1)
  })

  it('a failing bank row (unknown bank) rolls the whole save back — no vendor either', async () => {
    const n = name('CV Gagal')
    const r = await api('POST', '/api/v1/vendor-form', adminA, { vendor: { name: n }, contacts: [{ name: 'X' }], bankAccounts: [{ bank: 999999, accountNo: accountNo(), accountHolder: n }] })
    expect(r.status, JSON.stringify(r.body)).toBeGreaterThanOrEqual(400)
    expect(r.status).toBeLessThan(500)
    expect(((r.body as Body).errors as Body[]).every((e) => String(e.path).startsWith('bankAccounts.0'))).toBe(true)
    expect(await countByName('vendors', n)).toBe(0)
    // pure validation: a non-digit account number never reaches the DB
    const bad = await api('POST', '/api/v1/vendor-form', adminA, { vendor: { name: n }, bankAccounts: [{ bank, accountNo: '12ab5', accountHolder: n }] })
    expect(bad.status).toBe(400)
    expect(((bad.body as Body).errors as Body[]).map((e) => e.path)).toEqual(['bankAccounts.0.accountNo'])
  })

  it('PATCH: a changed account number needs the reason (VendorBankAccounts rule) — refused → contacts not saved either; with it → audited', async () => {
    const n = name('CV Vendor Ubah')
    const created = (await api('POST', '/api/v1/vendor-form', adminA, { vendor: { name: n }, bankAccounts: [{ bank, accountNo: accountNo(), accountHolder: n }] })).body as Body
    const accId = created.detail.bankAccounts[0].id as number
    const newNo = accountNo()
    const r1 = await api('PATCH', `/api/v1/vendor-form/${created.id}`, adminA, { contacts: [{ name: 'Eko' }], bankAccounts: [{ id: accId, accountNo: newNo }] })
    expect(r1.status).toBe(400)
    expect(((r1.body as Body).errors as Body[]).map((e) => e.path)).toEqual(['reason'])
    expect((await doc('vendors', created.id)).contacts ?? []).toEqual([])
    const r2 = await api('PATCH', `/api/v1/vendor-form/${created.id}`, adminA, { contacts: [{ name: 'Eko' }], bankAccounts: [{ id: accId, accountNo: newNo }, { bank, accountNo: accountNo(), accountHolder: n, isDefault: true }], reason: 'rekening diganti' })
    expect(r2.status, JSON.stringify(r2.body)).toBe(200)
    expect((await doc('vendor-bank-accounts', accId)).accountNo).toBe(newNo)
    expect(((r2.body as Body).detail.bankAccounts as Body[]).length).toBe(2)
    const rows = await auditRows('vendor_bank_account', accId)
    expect(rows.find((x) => x.field === 'accountNo' && x.action === 'update')?.reason).toBe('rekening diganti')
    expect((await doc('vendors', created.id)).contact).toBe('Eko')
  })

  it('Direktur edits the vendor but not its bank accounts (Admin / Finance); a foreign account is refused; PM read-only', async () => {
    const n = name('CV Vendor Hak')
    const created = (await api('POST', '/api/v1/vendor-form', financeA, { vendor: { name: n }, bankAccounts: [{ bank, accountNo: accountNo(), accountHolder: n }] })).body as Body
    const other = (await api('POST', '/api/v1/vendor-form', financeA, { vendor: { name: name('CV Lain') }, bankAccounts: [{ bank, accountNo: accountNo(), accountHolder: 'Lain' }] })).body as Body
    const d1 = await api('PATCH', `/api/v1/vendor-form/${created.id}`, direkturA, { vendor: { address: 'Jl. Direktur 2' } })
    expect(d1.status, JSON.stringify(d1.body)).toBe(200)
    expect((d1.body as Body).detail.companies[0].canManageBankAccounts).toBe(false)
    const d2 = await api('PATCH', `/api/v1/vendor-form/${created.id}`, direkturA, { vendor: { address: 'Jl. Tidak' }, bankAccounts: [{ bank, accountNo: accountNo(), accountHolder: n }] })
    expect(d2.status).toBe(403)
    expect(((d2.body as Body).errors as Body[])[0]?.path).toBe('bankAccounts')
    expect((await doc('vendors', created.id)).address).toBe('Jl. Direktur 2')
    const foreign = await api('PATCH', `/api/v1/vendor-form/${created.id}`, financeA, { bankAccounts: [{ id: other.detail.bankAccounts[0].id, isDefault: true }] })
    expect(foreign.status).toBe(400)
    expect(((foreign.body as Body).errors as Body[])[0]).toEqual({ path: 'bankAccounts.0', message: 'Rekening ini bukan milik vendor ini.' })
    const g = await api('GET', `/api/v1/vendor-form/${created.id}`, pmA)
    expect(g.status).toBe(200)
    expect((g.body as Body).canEdit).toBe(false)
    expect((await api('PATCH', `/api/v1/vendor-form/${created.id}`, pmA, { vendor: { name: 'X' } })).status).toBe(403)
    expect((await api('GET', `/api/v1/vendor-form/${created.id}`, adminB)).status).toBe(404)
    expect((await api('GET', '/api/v1/vendor-form', direkturA)).status).toBe(403)
    const nf = await api('GET', '/api/v1/vendor-form', financeA)
    expect(nf.status).toBe(200)
    expect(((nf.body as Body).banks as Body[]).some((x) => x.id === bank)).toBe(true)
  })

  it('DB: the app role may rewrite the contact rows (array) of a vendor', async () => {
    const r = await sqlAs('app', "SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = current_user AND table_name = 'vendors_contacts' ORDER BY 1")
    expect(r.rows.map((x) => x.privilege_type)).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
  })
})
