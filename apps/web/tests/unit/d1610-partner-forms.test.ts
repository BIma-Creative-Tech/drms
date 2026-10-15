import { APIError, ValidationError, type PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'

import {
  buildBody,
  canManageBanks,
  CLIENT_TABS,
  draftFromDetail,
  errorTarget,
  formUrl,
  initialCompany,
  mapErrors,
  newBank,
  newContact,
  removeContact,
  setDefaultBank,
  setPrimary,
  tabHasError,
  VENDOR_TABS,
  type Draft,
} from '@/admin/components/partners/partner-form'
import { moduleForPath, MODULES, resolveModules } from '@/admin/modules/registry'
import { partnerFormHref, projectForClientHref } from '@/admin/partner-routes'
import { customEditOf } from '@/admin/pk-list/edit-view'
import { withCompanyContext } from '@/access/roles'
import { ClientFormCreate, ClientFormUpdate, VendorFormCreate, VendorFormUpdate } from '@/api/v1/schemas-partners'
import { projectFromClientDefault } from '@/domain/partners/project-prefill'
import {
  BANK_REASON_MESSAGE,
  CONTACT_EMAIL_MESSAGE,
  CONTACT_NAME_MESSAGE,
  DEACTIVATE_REASON_MESSAGE,
  legacyContactOf,
  normalizeContacts,
  NPWP_MESSAGE,
  partnerErrorPath,
  primaryContact,
  reasonErrors,
  sameContacts,
  validateContacts,
  validatePartnerDetail,
  validateVendorBanks,
  vendorBankPatch,
  type StoredVendorBank,
} from '@/domain/partners/rules'
import { partnerWriteError, type ClientFormDetail, type VendorFormDetail } from '@/domain/partners/service'
import { contactsHook } from '@/fields/contacts'

/**
 * DRMS 16/10 — "Klien" / "Vendor" tabbed pages: the pure rules (contacts, detail, vendor bank rows, reason), the
 * collection hook deriving the single Kontak / No. HP columns, the form state (draft → body → errors), the routes of
 * the list / row action / menu and the project prefill of "+ Proyek baru".
 */

const PT = { id: 3, shortCode: 'DRMS', name: 'PT DRMS', canManageBankAccounts: true }

describe('rules: contacts', () => {
  it('normalize: trims, empty → null, email lower case, exactly ONE primary (first flagged, else the first row)', () => {
    expect(normalizeContacts([{ name: ' Budi ', phone: ' ', email: 'Budi@X.test ' }, { name: 'Sari', isPrimary: true }, { name: 'Tono', isPrimary: true }])).toEqual([
      { name: 'Budi', position: null, phone: null, email: 'budi@x.test', notes: null, isPrimary: false },
      { name: 'Sari', position: null, phone: null, email: null, notes: null, isPrimary: true },
      { name: 'Tono', position: null, phone: null, email: null, notes: null, isPrimary: false },
    ])
    expect(normalizeContacts([{ id: 'abc', name: 'A' }, { name: 'B' }]).map((r) => [r.id, r.isPrimary])).toEqual([
      ['abc', true],
      [undefined, false],
    ])
    expect(normalizeContacts([])).toEqual([])
    expect(normalizeContacts(undefined)).toEqual([])
  })

  it('the single Kontak / No. HP columns = the primary contact', () => {
    const rows = normalizeContacts([{ name: 'A', phone: '0811' }, { name: 'B', phone: '0822', isPrimary: true }])
    expect(primaryContact(rows)?.name).toBe('B')
    expect(legacyContactOf(rows)).toEqual({ contact: 'B', phone: '0822' })
    expect(legacyContactOf([])).toEqual({ contact: null, phone: null })
  })

  it('same rows ignore row ids; order, content and primary count', () => {
    const a = normalizeContacts([{ id: 'x', name: 'A' }, { name: 'B' }])
    expect(sameContacts(a, normalizeContacts([{ name: 'A' }, { id: 'y', name: 'B' }]))).toBe(true)
    expect(sameContacts(a, normalizeContacts([{ name: 'B' }, { name: 'A' }]))).toBe(false)
    expect(sameContacts(a, normalizeContacts([{ name: 'A' }, { name: 'B', isPrimary: true }]))).toBe(false)
  })

  it('validate: name required, lengths, email format, at most 20 rows', () => {
    expect(validateContacts([{ name: ' ' }, { name: 'A', email: 'bukan-email' }, { name: 'B', email: 'b@x.test', phone: '1'.repeat(33) }])).toEqual([
      { path: 'contacts.0.name', message: CONTACT_NAME_MESSAGE },
      { path: 'contacts.1.email', message: CONTACT_EMAIL_MESSAGE },
      { path: 'contacts.2.phone', message: 'Maksimal 32 karakter.' },
    ])
    expect(validateContacts(Array.from({ length: 21 }, (_, i) => ({ name: `K${i}` }))).map((e) => e.path)).toEqual(['contacts'])
    expect(validateContacts(undefined)).toEqual([])
  })
})

describe('rules: detail, vendor bank rows, reason, error paths', () => {
  it('name required on create (and when sent); NPWP format for vendors only', () => {
    expect(validatePartnerDetail('client', {}, 'create')).toEqual([{ path: 'client.name', message: 'Nama wajib diisi.' }])
    expect(validatePartnerDetail('client', { address: 'x' }, 'update')).toEqual([])
    expect(validatePartnerDetail('vendor', { name: ' ' }, 'update').map((e) => e.path)).toEqual(['vendor.name'])
    expect(validatePartnerDetail('vendor', { name: 'V', npwp: '12-ab' }, 'create')).toEqual([{ path: 'vendor.npwp', message: NPWP_MESSAGE }])
    expect(validatePartnerDetail('vendor', { name: 'V', npwp: '01.234.567.8-901.000' }, 'create')).toEqual([])
  })

  it('bank rows: a new row needs bank, number, holder; digits only (5–34) after normalizing; one row per id', () => {
    expect(validateVendorBanks([{}]).map((e) => e.path)).toEqual(['bankAccounts.0.bank', 'bankAccounts.0.accountNo', 'bankAccounts.0.accountHolder'])
    expect(validateVendorBanks([{ bank: 1, accountNo: '12a45', accountHolder: 'A' }])).toEqual([{ path: 'bankAccounts.0.accountNo', message: 'Nomor rekening hanya angka (5–34 digit).' }])
    expect(validateVendorBanks([{ bank: 1, accountNo: '123.456-78 9', accountHolder: 'A' }])).toEqual([])
    expect(validateVendorBanks([{ id: 4, active: false }, { id: 4, isDefault: true }]).map((e) => e.path)).toEqual(['bankAccounts.1'])
    expect(validateVendorBanks([{ id: 4, accountHolder: ' ' }]).map((e) => e.path)).toEqual(['bankAccounts.0.accountHolder'])
  })

  const stored: StoredVendorBank = { id: 9, vendor: 2, bank: 1, accountNo: '1234567', accountHolder: 'CV Maju', isDefault: false, verificationStatus: 'unverified', active: true }

  it('bank patch: only sent + changed fields (number normalized)', () => {
    expect(vendorBankPatch(stored, { id: 9, accountNo: '123-4567', isDefault: true })).toEqual({ isDefault: true })
    expect(vendorBankPatch(stored, { id: 9, accountNo: '7654321', verificationStatus: 'verified', active: false })).toEqual({ accountNo: '7654321', verificationStatus: 'verified', active: false })
  })

  it('reason (same rules as the collections): deactivation, number / holder / bank change, bank deactivation', () => {
    expect(reasonErrors({ storedActive: true, active: false })).toEqual([{ path: 'reason', message: DEACTIVATE_REASON_MESSAGE }])
    expect(reasonErrors({ storedActive: true, active: false, reason: 'tutup' })).toEqual([])
    expect(reasonErrors({ banks: [{ stored, input: { id: 9, accountHolder: 'PT Maju' } }] })).toEqual([{ path: 'reason', message: BANK_REASON_MESSAGE }])
    expect(reasonErrors({ banks: [{ stored, input: { id: 9, active: false } }] })).toEqual([{ path: 'reason', message: DEACTIVATE_REASON_MESSAGE }])
    expect(reasonErrors({ banks: [{ stored, input: { id: 9, isDefault: true, verificationStatus: 'verified' } }] })).toEqual([])
    expect(reasonErrors({ storedActive: undefined, active: false })).toEqual([]) // create
  })

  it('collection error paths → body paths', () => {
    expect(partnerErrorPath('vendor', 'changeReason')).toBe('reason')
    expect(partnerErrorPath('client', 'contacts.2.email')).toBe('contacts.2.email')
    expect(partnerErrorPath('client', 'phone')).toBe('contacts')
    expect(partnerErrorPath('vendor', 'npwp')).toBe('vendor.npwp')
    expect(partnerErrorPath('bankAccounts.1', 'accountNo')).toBe('bankAccounts.1.accountNo')
    expect(partnerErrorPath('client', undefined)).toBe('client')
  })

  it('partnerWriteError: ValidationError / APIError / pg guard', () => {
    const v = new ValidationError({ collection: 'clients', errors: [{ path: 'contacts.0.name', message: 'Wajib.' }, { path: 'changeReason', message: 'Alasan wajib diisi saat menonaktifkan data.' }] })
    expect(partnerWriteError(v, 'client')).toMatchObject({ status: 400, errors: [{ path: 'contacts.0.name' }, { path: 'reason' }] })
    expect(partnerWriteError(new APIError('Anda bukan Admin PT ini.', 403, null, true), 'bankAccounts.0')).toMatchObject({ status: 403, errors: [{ path: 'bankAccounts.0', message: 'Anda bukan Admin PT ini.' }] })
    expect(partnerWriteError(Object.assign(new Error('x'), { cause: { code: '23514' } }), 'vendor')).toMatchObject({ status: 409 })
    expect(partnerWriteError(Object.assign(new Error('x'), { cause: { code: '23503' } }), 'bankAccounts.1')).toMatchObject({ status: 400, errors: [{ path: 'bankAccounts.1' }] })
    expect(partnerWriteError(new Error('boom'), 'vendor')).toBeNull()
  })
})

describe('collection hook: Kontak PIC ↔ single Kontak / No. HP columns', () => {
  const run = (data: Record<string, unknown>, operation: 'create' | 'update', phone = true) => contactsHook({ phone })({ data, operation } as never) as Record<string, unknown>

  it('a write with contacts derives the single columns from the primary row', () => {
    const d = run({ contacts: [{ name: 'A', phone: '0811' }, { name: ' B ', phone: '0822', isPrimary: true }] }, 'update')
    expect(d.contact).toBe('B')
    expect(d.phone).toBe('0822')
    expect((d.contacts as Array<{ isPrimary: boolean }>).map((r) => r.isPrimary)).toEqual([false, true])
    const cleared = run({ contacts: [] }, 'update')
    expect([cleared.contact, cleared.phone]).toEqual([null, null])
    // vendors: no phone column
    expect(run({ contacts: [{ name: 'C', phone: '1' }] }, 'update', false)).not.toHaveProperty('phone')
  })

  it('a create with only the single columns (seed, import) becomes the primary row; an update without contacts is left alone', () => {
    expect(run({ contact: 'Pak Andi', phone: '0812' }, 'create').contacts).toEqual([{ name: 'Pak Andi', position: null, phone: '0812', email: null, notes: null, isPrimary: true }])
    expect(run({ contact: 'Pak Andi' }, 'update')).not.toHaveProperty('contacts')
    expect(run({ name: 'X' }, 'create')).not.toHaveProperty('contacts')
  })
})

const clientDetail = (over: Partial<ClientFormDetail> = {}): ClientFormDetail => ({
  client: {
    id: 5,
    company: 3,
    name: 'PT Klien',
    address: null,
    odooPartnerRef: null,
    active: true,
    contacts: [
      { id: 'r1', name: 'Budi', position: 'Direktur', phone: '0811', email: null, notes: null, isPrimary: true },
      { id: 'r2', name: 'Sari', position: null, phone: null, email: 'sari@x.test', notes: null, isPrimary: false },
    ],
  },
  companies: [PT],
  canEdit: true,
  projects: [{ id: 7, code: 'P-1', name: 'Gedung', status: 'berjalan' }],
  canCreateProject: true,
  ...over,
})

const vendorDetail = (over: Partial<VendorFormDetail> = {}): VendorFormDetail => ({
  vendor: { id: 8, company: 3, name: 'CV Maju', npwp: null, address: 'Jl. A', odooPartnerRef: null, active: true, contacts: [] },
  companies: [PT],
  canEdit: true,
  bankAccounts: [{ id: 21, bank: 1, bankName: 'BCA', accountNo: '1234567', accountHolder: 'CV Maju', isDefault: true, verificationStatus: 'unverified', active: true }],
  banks: [{ id: 1, name: 'BCA' }],
  ...over,
})

describe('form state: draft → body', () => {
  it('tabs: Klien = Detail · Kontak PIC · Proyek; Vendor = Detail · Rekening · Kontak PIC', () => {
    expect(CLIENT_TABS.map((t) => t.label)).toEqual(['Detail Klien', 'Kontak PIC', 'Proyek'])
    expect(VENDOR_TABS.map((t) => t.label)).toEqual(['Detail Vendor', 'Rekening', 'Kontak PIC'])
    expect(formUrl('client', null)).toBe('/api/v1/client-form')
    expect(formUrl('vendor', 8)).toBe('/api/v1/vendor-form/8')
  })

  it('PT of a new record: the drawer\'s initial PT when allowed, else the only PT, else none', () => {
    const two = [PT, { ...PT, id: 4, shortCode: 'CS1' }]
    expect(initialCompany(two, 4)).toBe(4)
    expect(initialCompany(two, 99)).toBeNull()
    expect(initialCompany([PT], null)).toBe(3)
    expect(draftFromDetail({ client: null, companies: two, canEdit: true, projects: [], canCreateProject: false }, 4).company).toBe(4)
  })

  it('create: every detail field + non-blank contacts; blank new rows dropped', () => {
    const d = draftFromDetail({ client: null, companies: [PT], canEdit: true, projects: [], canCreateProject: false })
    const draft: Draft = { ...d, name: ' PT Baru ', contacts: [{ ...newContact('n1', true), name: 'Andi', email: 'andi@x.test' }, newContact('n2', false)] }
    const { body, order, changed } = buildBody('client', { client: null, companies: [PT], canEdit: true, projects: [], canCreateProject: false }, draft, 'create')
    expect(body).toEqual({ client: { company: 3, name: 'PT Baru', address: null }, contacts: [{ name: 'Andi', position: null, phone: null, email: 'andi@x.test', notes: null, isPrimary: true }] })
    expect(order.contacts).toEqual(['n1'])
    expect(changed).toBe(true)
  })

  it('edit: nothing changed → no body; one contact field changed → the whole list (row ids kept)', () => {
    const det = clientDetail()
    const d = draftFromDetail(det)
    expect(buildBody('client', det, d, 'update')).toMatchObject({ body: {}, changed: false, needsReason: false })
    const d2 = { ...d, contacts: d.contacts.map((c) => (c.id === 'r2' ? { ...c, phone: '0899' } : c)) }
    const r = buildBody('client', det, d2, 'update')
    expect(r.body).toEqual({
      contacts: [
        { id: 'r1', name: 'Budi', position: 'Direktur', phone: '0811', email: null, notes: null, isPrimary: true },
        { id: 'r2', name: 'Sari', position: null, phone: '0899', email: 'sari@x.test', notes: null, isPrimary: false },
      ],
    })
    // removing a row and deactivating → contacts + active false, reason needed
    const d3 = { ...d, active: false, contacts: removeContact(d.contacts, 'cr1') }
    const r3 = buildBody('client', det, d3, 'update')
    expect(r3.body.client).toEqual({ active: false })
    expect((r3.body.contacts as Array<{ isPrimary: boolean }>)[0]!.isPrimary).toBe(true)
    expect(r3.needsReason).toBe(true)
  })

  it('primary / default are exclusive; removing the primary hands it to the first row', () => {
    const rows = [newContact('a', true), newContact('b', false), newContact('c', false)]
    expect(setPrimary(rows, 'b').map((r) => r.isPrimary)).toEqual([false, true, false])
    expect(removeContact(rows, 'a').map((r) => [r.key, r.isPrimary])).toEqual([
      ['b', true],
      ['c', false],
    ])
    const banks = [{ ...newBank('x', 'A'), isDefault: true }, newBank('y', 'A')]
    expect(setDefaultBank(banks, 'y', true).map((b) => b.isDefault)).toEqual([false, true])
    expect(setDefaultBank(banks, 'x', false).map((b) => b.isDefault)).toEqual([false, false])
  })

  it('vendor: new bank row + changed holder of a saved one (reason needed); untouched new row dropped', () => {
    const det = vendorDetail()
    const d = draftFromDetail(det)
    const draft: Draft = { ...d, banks: [{ ...d.banks[0]!, accountHolder: 'CV Maju Jaya' }, { ...newBank('n1', 'CV Maju'), bank: 1, accountNo: '9876543' }, newBank('n2', 'CV Maju')] }
    const r = buildBody('vendor', det, draft, 'update')
    expect(r.body).toEqual({ bankAccounts: [{ id: 21, accountHolder: 'CV Maju Jaya' }, { bank: 1, accountNo: '9876543', accountHolder: 'CV Maju', isDefault: false, verificationStatus: 'unverified', active: true }] })
    expect(r.order.banks).toEqual(['b21', 'n1'])
    expect(r.needsReason).toBe(true)
    const verifyOnly = buildBody('vendor', det, { ...d, banks: [{ ...d.banks[0]!, verificationStatus: 'verified' }] }, 'update')
    expect(verifyOnly).toMatchObject({ body: { bankAccounts: [{ id: 21, verificationStatus: 'verified' }] }, needsReason: false })
    // create sends npwp and the PT
    const c = buildBody('vendor', { ...det, vendor: null, bankAccounts: [] }, { ...draftFromDetail({ ...det, vendor: null, bankAccounts: [] }), name: 'CV Baru', npwp: '01.234.567.8-901.000' }, 'create')
    expect(c.body.vendor).toEqual({ company: 3, name: 'CV Baru', address: null, npwp: '01.234.567.8-901.000' })
  })

  it('bank rights: Admin / Finance of the draft\'s PT, and only when the form is editable', () => {
    const det = vendorDetail()
    expect(canManageBanks(det, { company: 3 })).toBe(true)
    expect(canManageBanks({ ...det, companies: [{ ...PT, canManageBankAccounts: false }] }, { company: 3 })).toBe(false)
    expect(canManageBanks(det, { company: null })).toBe(false)
    expect(canManageBanks({ ...det, canEdit: false }, { company: 3 })).toBe(false)
  })
})

describe('form state: server errors → fields + tab', () => {
  const order = { contacts: ['n1', 'cr2'], banks: ['b21', 'n4'] }

  it('maps body paths to draft keys and their tab', () => {
    expect(errorTarget('client', 'client.name', order)).toEqual({ key: 'd.name', tab: 'detail' })
    expect(errorTarget('vendor', 'vendor', order)).toEqual({ key: 'd', tab: 'detail' })
    expect(errorTarget('client', 'contacts.1.email', order)).toEqual({ key: 'contact.cr2.email', tab: 'kontak' })
    expect(errorTarget('client', 'contacts', order)).toEqual({ key: 'contacts', tab: 'kontak' })
    expect(errorTarget('vendor', 'bankAccounts.1.accountNo', order)).toEqual({ key: 'bank.n4.accountNo', tab: 'rekening' })
    expect(errorTarget('vendor', 'bankAccounts', order)).toEqual({ key: 'banks', tab: 'rekening' })
    expect(errorTarget('vendor', 'reason', order)).toEqual({ key: 'reason', tab: null })
  })

  it('first tab with an error opens; messages of one key are joined; tab dots', () => {
    const { byKey, tab } = mapErrors('vendor', { errors: [{ path: 'bankAccounts.0.accountNo', message: 'A' }, { path: 'bankAccounts.0.accountNo', message: 'B' }, { path: 'vendor.name', message: 'C' }] }, order)
    expect(tab).toBe('rekening')
    expect(byKey.get('bank.b21.accountNo')).toBe('A; B')
    expect(tabHasError('detail', byKey.keys())).toBe(true)
    expect(tabHasError('kontak', byKey.keys())).toBe(false)
    expect(mapErrors('client', null, order).byKey.size).toBe(0)
  })
})

describe('entry points: list, row action, menu, "+ Proyek baru"', () => {
  const admin = withCompanyContext({ id: 1 }, [{ company: 3, roles: ['pk-admin'], employee: null }], null, false)
  const pm = withCompanyContext({ id: 2 }, [{ company: 3, roles: ['pk-pm'], employee: null }], null, false)

  it('clients / vendors open the tabbed pages for every reader; the "Aksi" column stays; users unchanged', () => {
    const c = customEditOf('clients', pm)!
    expect(c).toMatchObject({ createHref: '/admin/klien/baru', hideRowActions: false })
    expect(c.rowHref(12)).toBe('/admin/klien/12')
    expect(customEditOf('vendors', admin)!.rowHref('9')).toBe('/admin/vendor/9')
    expect(customEditOf('users', admin)).toMatchObject({ createHref: '/admin/pengguna/baru', hideRowActions: true })
    expect(customEditOf('vendor-bank-accounts', admin)).toBeNull()
    expect(partnerFormHref('vendors', 'baru')).toBe('/admin/vendor/baru')
    expect(partnerFormHref('projects', 3)).toBeNull()
    expect(projectForClientHref(5)).toBe('/admin/collections/projects/create?client=5')
  })

  it('the pages belong to Proyek / Master Data; "+ Klien baru" for Admin / Direktur, "+ Vendor baru" for Admin / Finance', () => {
    expect(moduleForPath('/admin/klien/12')).toBe('proyek')
    expect(moduleForPath('/admin/klien/baru')).toBe('proyek')
    expect(moduleForPath('/admin/vendor/3')).toBe('master')
    const base = { canSee: () => true, canManage: () => true, labelOf: (_k: 'collection' | 'global', s: string) => s }
    const hrefs = (roles: Array<'pk-admin' | 'pk-owner' | 'pk-finance' | 'pk-pm'>) =>
      resolveModules({ ...base, roles, staffOnly: false }, MODULES).flatMap((m) => m.sections.flatMap((s) => s.items.map((i) => i.href)))
    expect(hrefs(['pk-owner'])).toContain('/admin/klien/baru')
    expect(hrefs(['pk-owner'])).not.toContain('/admin/vendor/baru')
    expect(hrefs(['pk-finance'])).toContain('/admin/vendor/baru')
    expect(hrefs(['pk-finance'])).not.toContain('/admin/klien/baru')
    expect(hrefs(['pk-pm'])).not.toContain('/admin/klien/baru')
  })

  it('"+ Proyek baru": client + its PT as server defaults, only on the project create route and for a readable client', async () => {
    const req = (url: string, doc: unknown) => ({ url, context: {}, user: { id: 1 }, payload: { findByID: async () => doc } }) as unknown as PayloadRequest
    const r = req('http://x/admin/collections/projects/create?client=5', { id: 5, company: 3 })
    expect(await projectFromClientDefault('client')({ req: r })).toBe(5)
    expect(await projectFromClientDefault('company')({ req: r })).toBe(3)
    expect(await projectFromClientDefault('client')({ req: req('http://x/admin/collections/projects/create?client=5', null) })).toBeUndefined()
    expect(await projectFromClientDefault('client')({ req: req('http://x/api/projects?client=5', { id: 5, company: 3 }) })).toBeUndefined()
    expect(await projectFromClientDefault('company')({ req: req('http://x/admin/collections/projects/create', { id: 5, company: 3 }) })).toBeUndefined()
  })
})

describe('request schemas', () => {
  it('strict bodies; company only on create; contacts at most 20', () => {
    expect(ClientFormCreate.safeParse({ client: { name: 'A', company: 3 }, contacts: [{ name: 'B', isPrimary: true }] }).success).toBe(true)
    expect(ClientFormUpdate.safeParse({ client: { company: 3 } }).success).toBe(false)
    expect(ClientFormCreate.safeParse({ client: { name: 'A', odooPartnerRef: 'x' } }).success).toBe(false)
    expect(VendorFormCreate.safeParse({ vendor: { name: 'V' }, bankAccounts: [{ bank: 1, accountNo: '123456', accountHolder: 'V' }] }).success).toBe(true)
    expect(VendorFormUpdate.safeParse({ bankAccounts: [{ id: 2, verificationStatus: 'verified' }], reason: 'cek' }).success).toBe(true)
    const many = VendorFormUpdate.safeParse({ contacts: Array.from({ length: 21 }, () => ({ name: 'x' })) })
    expect(many.success).toBe(false)
  })
})
