import { APIError, ValidationError, type CollectionSlug, type PayloadRequest, type Where } from 'payload'

import { hasRole, relId, type Role } from '@/access/roles'
import { creatableCompanies } from '@/fields/company'
import { isDbGuardError, pgCode } from '@/lib/pg-error'

import {
  normalizeAccountNo,
  normalizeContacts,
  partnerErrorPath,
  reasonErrors,
  sameContacts,
  validateContacts,
  validatePartnerDetail,
  validateVendorBanks,
  vendorBankPatch,
  type ContactInput,
  type ContactRow,
  type FieldError,
  type PartnerDetailInput,
  type StoredVendorBank,
  type VendorBankInput,
} from './rules'
import { NOT_DELETED } from '@/domain/soft-delete/where'

/**
 * DRMS 16/10 — "Klien" / "Vendor" tabbed pages (owner 2026-10-16): load and save a client (Detail Klien · Kontak PIC ·
 * Proyek) or a vendor (Detail Vendor · Rekening · Kontak PIC) in ONE transaction (the caller — the endpoint — owns it).
 *
 * Every write goes through the existing collections with the CALLER's access (`overrideAccess: false`): clients
 * (create Admin / Direktur, update Admin / Direktur of the PT), vendors (create Admin / Finance, update Admin / Finance /
 * Direktur), vendor-bank-accounts (Admin / Finance of the vendor's PT; verification status Admin / Finance; reason on
 * number / holder / bank change and on deactivation; PT derived from the vendor), with their hooks (PT per ADR 0016,
 * audit + reason rules, the contacts hook deriving the single Kontak / No. HP columns). Nothing here bypasses them;
 * the checks below only answer earlier and name the field. Reads use the caller's access, except the SYSTEM-READ that
 * evaluates the caller's own update rule for one id.
 */

export class PartnerFormError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly errors: FieldError[] = [],
  ) {
    super(detail)
  }
}

/** Collection access, as the forms need it (kept equal to Clients / Vendors / VendorBankAccounts / Projects). */
export const CLIENT_CREATE_ROLES: readonly Role[] = ['pk-admin', 'pk-owner']
export const VENDOR_CREATE_ROLES: readonly Role[] = ['pk-admin', 'pk-finance']
export const VENDOR_BANK_ROLES: readonly Role[] = ['pk-admin', 'pk-finance']
export const PROJECT_CREATE_ROLES: readonly Role[] = ['pk-owner', 'pk-admin', 'pk-pm']

/** A PT of the form: create = the PTs the caller may create in (PT switcher selection); edit = the record's PT. */
export type PartnerCompany = { id: number; shortCode: string; name: string; canManageBankAccounts: boolean }
export type ContactView = { id: string; name: string; position: string | null; phone: string | null; email: string | null; notes: string | null; isPrimary: boolean }
export type PartnerView = { id: number; company: number | null; name: string; address: string | null; odooPartnerRef: string | null; active: boolean; contacts: ContactView[] }
export type ClientProject = { id: number; code: string | null; name: string; status: string | null }

export type ClientFormDetail = {
  client: PartnerView | null
  companies: PartnerCompany[]
  /** May the caller save this form (create: some PT allows it; edit: the collection update rule for this record). */
  canEdit: boolean
  /** The client's projects the caller can read (tab Proyek). */
  projects: ClientProject[]
  /** "+ Proyek baru" (project create rule in the client's PT; saved clients only). */
  canCreateProject: boolean
}

export type VendorBankView = { id: number; bank: number | null; bankName: string | null; accountNo: string; accountHolder: string; isDefault: boolean; verificationStatus: 'unverified' | 'verified'; active: boolean }

export type VendorFormDetail = {
  vendor: (PartnerView & { npwp: string | null }) | null
  companies: PartnerCompany[]
  canEdit: boolean
  bankAccounts: VendorBankView[]
  banks: Array<{ id: number; name: string }>
}

export type ClientFormInput = { client?: PartnerDetailInput; contacts?: ContactInput[]; reason?: string }
export type VendorFormInput = { vendor?: PartnerDetailInput; contacts?: ContactInput[]; bankAccounts?: VendorBankInput[]; reason?: string }

type Row = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const optText = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

// ---- reads ---------------------------------------------------------------------------------------------------

/** One document with the caller's read access (unreadable / foreign PT / unknown = null). */
async function readAsCaller(req: PayloadRequest, collection: CollectionSlug, id: number): Promise<Row | null> {
  try {
    return (await req.payload.findByID({ collection, id, depth: 0, user: req.user, req, overrideAccess: false, disableErrors: true })) as unknown as Row | null
  } catch (err) {
    if (err instanceof APIError && (err.status === 403 || err.status === 404)) return null
    throw err
  }
}

/** D1610 (ADR 0030): a soft-deleted client / vendor opens read-only (found by id) and is never saved until an Admin restores it. */
const isDeletedRow = (doc: Row | null): boolean => doc?.isDeleted === true
const DELETED_MESSAGE = 'Data ini sudah dihapus. Admin perlu memulihkannya ("Pulihkan" di daftar) sebelum data dapat diubah.'

/** The collection's own `update` rule evaluated for ONE record (true / false / a per-PT where). */
export async function canUpdateDoc(req: PayloadRequest, collection: 'clients' | 'vendors', id: number): Promise<boolean> {
  const access = req.payload.collections[collection].config.access.update
  const res = await access({ req, id })
  if (res === true) return true
  if (!res) return false
  const n = await req.payload.count({ collection, where: { and: [res as Where, { id: { equals: id } }] }, overrideAccess: true /* SYSTEM-READ: evaluates the caller's update rule for this id */, req })
  return n.totalDocs > 0
}

async function companyInfo(req: PayloadRequest, ids: readonly number[]): Promise<PartnerCompany[]> {
  if (!ids.length) return []
  const res = await req.payload.find({ collection: 'companies', where: { id: { in: [...ids] } }, sort: 'shortCode', pagination: false, select: { shortCode: true, name: true }, user: req.user, req, depth: 0, overrideAccess: false })
  const byId = new Map((res.docs as unknown as Row[]).map((c) => [c.id as number, c]))
  return ids
    .map((id) => {
      const c = byId.get(id)
      return { id, shortCode: c ? str(c.shortCode) : `PT ${id}`, name: c ? str(c.name) : '', canManageBankAccounts: hasRole(req, VENDOR_BANK_ROLES, id) }
    })
    .sort((a, b) => a.shortCode.localeCompare(b.shortCode))
}

export function contactsOf(doc: Row): ContactView[] {
  const rows = Array.isArray(doc.contacts) ? (doc.contacts as Row[]) : []
  return rows.map((r) => ({ id: str(r.id), name: str(r.name), position: strOrNull(r.position), phone: strOrNull(r.phone), email: strOrNull(r.email), notes: strOrNull(r.notes), isPrimary: r.isPrimary === true }))
}

function partnerView(id: number, doc: Row): PartnerView {
  return { id, company: relId(doc.company) ?? null, name: str(doc.name), address: strOrNull(doc.address), odooPartnerRef: strOrNull(doc.odooPartnerRef), active: doc.active !== false, contacts: contactsOf(doc) }
}

/** Form data of a client (`id` null = a new one). Reads run with the caller's access. */
export async function loadClientForm(req: PayloadRequest, id: number | null): Promise<ClientFormDetail> {
  if (id === null) {
    const ids = creatableCompanies(req.user, CLIENT_CREATE_ROLES)
    if (!ids.length) throw new PartnerFormError(403, 'Hanya Admin atau Direktur PT yang dapat membuat klien (periksa pilihan PT).')
    return { client: null, companies: await companyInfo(req, ids), canEdit: true, projects: [], canCreateProject: false }
  }
  const doc = await readAsCaller(req, 'clients', id)
  if (!doc) throw new PartnerFormError(404, 'Klien tidak ditemukan atau bukan klien PT Anda.')
  const client = partnerView(id, doc)
  const [companies, canEdit, projects] = await Promise.all([
    companyInfo(req, client.company !== null ? [client.company] : []),
    isDeletedRow(doc) ? false : canUpdateDoc(req, 'clients', id),
    req.payload.find({ collection: 'projects', where: { client: { equals: id } }, sort: 'code', pagination: false, select: { code: true, name: true, status: true }, user: req.user, req, depth: 0, overrideAccess: false }),
  ])
  return {
    client,
    companies,
    canEdit,
    projects: (projects.docs as unknown as Row[]).map((p) => ({ id: p.id as number, code: strOrNull(p.code), name: str(p.name), status: strOrNull(p.status) })),
    canCreateProject: client.company !== null && hasRole(req, PROJECT_CREATE_ROLES, client.company),
  }
}

async function activeBanks(req: PayloadRequest): Promise<Array<{ id: number; name: string }>> {
  const res = await req.payload.find({ collection: 'banks', where: { active: { not_equals: false } }, sort: 'name', pagination: false, select: { name: true }, user: req.user, req, depth: 0, overrideAccess: false })
  return (res.docs as unknown as Row[]).map((b) => ({ id: b.id as number, name: str(b.name) }))
}

function bankView(a: Row, bankName: ReadonlyMap<number, string>): VendorBankView {
  const bank = relId(a.bank) ?? null
  return {
    id: a.id as number,
    bank,
    bankName: bank !== null ? (bankName.get(bank) ?? null) : null,
    accountNo: str(a.accountNo),
    accountHolder: str(a.accountHolder),
    isDefault: a.isDefault === true,
    verificationStatus: a.verificationStatus === 'verified' ? 'verified' : 'unverified',
    active: a.active !== false,
  }
}

/** Form data of a vendor (`id` null = a new one). Reads run with the caller's access. */
export async function loadVendorForm(req: PayloadRequest, id: number | null): Promise<VendorFormDetail> {
  if (id === null) {
    const ids = creatableCompanies(req.user, VENDOR_CREATE_ROLES)
    if (!ids.length) throw new PartnerFormError(403, 'Hanya Admin atau Finance PT yang dapat membuat vendor (periksa pilihan PT).')
    const [companies, banks] = await Promise.all([companyInfo(req, ids), activeBanks(req)])
    return { vendor: null, companies, canEdit: true, bankAccounts: [], banks }
  }
  const doc = await readAsCaller(req, 'vendors', id)
  if (!doc) throw new PartnerFormError(404, 'Vendor tidak ditemukan atau bukan vendor PT Anda.')
  const vendor = { ...partnerView(id, doc), npwp: strOrNull(doc.npwp) }
  const [companies, canEdit, banks, accounts] = await Promise.all([
    companyInfo(req, vendor.company !== null ? [vendor.company] : []),
    isDeletedRow(doc) ? false : canUpdateDoc(req, 'vendors', id),
    activeBanks(req),
    req.payload.find({ collection: 'vendor-bank-accounts', where: { vendor: { equals: id } }, sort: 'id', pagination: false, select: { vendor: true, bank: true, accountNo: true, accountHolder: true, isDefault: true, verificationStatus: true, active: true }, user: req.user, req, depth: 0, overrideAccess: false }),
  ])
  const bankName = new Map(banks.map((b) => [b.id, b.name]))
  return { vendor, companies, canEdit, banks, bankAccounts: (accounts.docs as unknown as Row[]).map((a) => bankView(a, bankName)) }
}

// ---- save ------------------------------------------------------------------------------------------------------

/**
 * Collection / DB error of one write → the body path it belongs to. Errors of nested Payload operations already rolled
 * the transaction back (killTransaction) — nothing continues after them.
 */
export function partnerWriteError(err: unknown, prefix: string): PartnerFormError | null {
  if (err instanceof PartnerFormError) return err
  if (err instanceof ValidationError) {
    const list = ((err.data as { errors?: Array<{ path?: string; message?: string }> } | undefined)?.errors ?? []).map((e) => ({ path: partnerErrorPath(prefix, e.path), message: e.message ?? 'Tidak valid.' }))
    const status = (err as { status?: number }).status === 403 ? 403 : 400
    return new PartnerFormError(status, [...new Set(list.map((e) => e.message))].join(' ') || 'Data tidak valid.', list.length ? list : [{ path: prefix, message: 'Data tidak valid.' }])
  }
  if (err instanceof APIError && err.status < 500) {
    const message = err.isPublic ? err.message : err.status === 403 ? 'Anda tidak berhak mengubah data ini.' : err.status === 404 ? 'Data tidak ditemukan.' : 'Ditolak.'
    const status = err.status === 403 || err.status === 404 || err.status === 409 ? err.status : 400
    return new PartnerFormError(status, message, [{ path: prefix, message }])
  }
  // QA-05: drizzle wraps the pg error — pgCode unwraps it. 23503 = a referenced row (bank …) does not exist.
  if (pgCode(err) === '23503') return new PartnerFormError(400, 'Data terkait tidak ditemukan.', [{ path: prefix, message: 'Data terkait tidak ditemukan.' }])
  if (isDbGuardError(err)) {
    const message = 'Ditolak oleh aturan integritas data (mis. data dari PT lain).'
    return new PartnerFormError(409, message, [{ path: prefix, message }])
  }
  return null
}

async function at<T>(prefix: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw partnerWriteError(err, prefix) ?? err
  }
}

function fail(status: number, errors: FieldError[]): never {
  throw new PartnerFormError(status, [...new Set(errors.map((e) => e.message))].slice(0, 3).join(' '), errors)
}

/** PT of a new record: the one named (must allow the create) or the caller's only creatable PT. */
function companyForCreate(req: PayloadRequest, requested: number | undefined, roles: readonly Role[], at: 'client' | 'vendor'): number {
  const ids = creatableCompanies(req.user, roles)
  if (requested === undefined) {
    if (ids.length === 1) return ids[0]!
    fail(ids.length === 0 ? 403 : 400, [{ path: `${at}.company`, message: ids.length === 0 ? 'Anda tidak berhak membuat data ini di PT yang dipilih.' : 'Pilih PT.' }])
  }
  if (!ids.includes(requested)) fail(403, [{ path: `${at}.company`, message: 'Anda tidak berhak membuat data ini di PT ini (atau PT tidak dipilih di pemilih PT).' }])
  return requested
}

/** The detail fields of the write (trimmed; '' → null); `undefined` = not part of the save. */
function detailData(d: PartnerDetailInput | undefined, keys: ReadonlyArray<'name' | 'npwp' | 'address' | 'active'>): Row {
  const out: Row = {}
  if (!d) return out
  for (const k of keys) {
    const v = d[k]
    if (v === undefined) continue
    out[k] = typeof v === 'boolean' ? v : k === 'name' ? String(v ?? '').trim() : optText(v as string | null)
  }
  return out
}

/** Fields of `next` that differ from the stored document. */
function changed(current: Row, next: Row): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(next)) if (JSON.stringify(current[k] ?? null) !== JSON.stringify(v ?? null)) out[k] = v
  return out
}

/** Contacts of the write: undefined = unchanged (not sent, or the same rows as stored). */
function contactsData(input: ContactInput[] | undefined, stored: Row | null): ContactRow[] | undefined {
  if (input === undefined) return undefined
  const rows = normalizeContacts(input)
  if (stored && sameContacts(normalizeContacts(contactsOf(stored)), rows)) return undefined
  if (!stored && rows.length === 0) return undefined
  return rows
}

export type SaveResult = { id: number; created: boolean }

/** One save of the Klien page. MUST run inside one DB transaction on `req` (the endpoint's). `id` null = create. */
export async function saveClientForm(req: PayloadRequest, input: ClientFormInput, id: number | null): Promise<SaveResult> {
  if (!req.transactionID) throw new Error('saveClientForm needs a transaction on req')
  const mode = id === null ? 'create' : 'update'
  let current: Row | null = null
  if (id !== null) {
    current = await readAsCaller(req, 'clients', id)
    if (!current) throw new PartnerFormError(404, 'Klien tidak ditemukan atau bukan klien PT Anda.')
    if (isDeletedRow(current)) throw new PartnerFormError(409, DELETED_MESSAGE)
    if (!(await canUpdateDoc(req, 'clients', id))) fail(403, [{ path: 'client', message: 'Anda tidak berhak mengubah klien ini (Admin / Direktur PT).' }])
  }
  const company = id === null ? companyForCreate(req, input.client?.company, CLIENT_CREATE_ROLES, 'client') : null
  const errors = [
    ...validatePartnerDetail('client', input.client, mode),
    ...validateContacts(input.contacts),
    ...reasonErrors({ reason: input.reason, storedActive: current ? current.active !== false : undefined, active: input.client?.active }),
  ]
  if (errors.length) fail(400, errors)
  if (input.reason && input.reason.trim()) req.context.auditReason = input.reason.trim()

  const detail = detailData(input.client, ['name', 'address', 'active'])
  const contacts = contactsData(input.contacts, current)
  if (id === null) {
    const data = { ...detail, ...(contacts !== undefined ? { contacts } : {}), company }
    const doc = await at('client', () => req.payload.create({ collection: 'clients', data: data as never, depth: 0, user: req.user, req, overrideAccess: false }))
    return { id: doc.id as number, created: true }
  }
  const patch = { ...changed(current!, detail), ...(contacts !== undefined ? { contacts } : {}) }
  if (Object.keys(patch).length) await at('client', () => req.payload.update({ collection: 'clients', id, data: patch as never, depth: 0, user: req.user, req, overrideAccess: false }))
  return { id, created: false }
}

/** Saved bank accounts named in the body, read with the caller's access (unreadable = not found). */
async function storedBanks(req: PayloadRequest, rows: readonly VendorBankInput[]): Promise<Map<number, StoredVendorBank>> {
  const ids = [...new Set(rows.flatMap((b) => (b.id !== undefined ? [b.id] : [])))]
  if (!ids.length) return new Map()
  // D1610: an explicit id list skips the central read rule → a soft-deleted account is reported like a missing one
  const res = await req.payload.find({ collection: 'vendor-bank-accounts', where: { and: [{ id: { in: ids } }, NOT_DELETED] }, depth: 0, pagination: false, select: { vendor: true, bank: true, accountNo: true, accountHolder: true, isDefault: true, verificationStatus: true, active: true }, user: req.user, req, overrideAccess: false })
  return new Map(
    (res.docs as unknown as Row[]).map((a) => {
      const v = bankView(a, new Map())
      return [v.id, { id: v.id, vendor: relId(a.vendor) ?? null, bank: v.bank, accountNo: v.accountNo, accountHolder: v.accountHolder, isDefault: v.isDefault, verificationStatus: v.verificationStatus, active: v.active }]
    }),
  )
}

/** One save of the Vendor page. MUST run inside one DB transaction on `req` (the endpoint's). `id` null = create. */
export async function saveVendorForm(req: PayloadRequest, input: VendorFormInput, id: number | null): Promise<SaveResult> {
  if (!req.transactionID) throw new Error('saveVendorForm needs a transaction on req')
  const mode = id === null ? 'create' : 'update'
  let current: Row | null = null
  if (id !== null) {
    current = await readAsCaller(req, 'vendors', id)
    if (!current) throw new PartnerFormError(404, 'Vendor tidak ditemukan atau bukan vendor PT Anda.')
    if (isDeletedRow(current)) throw new PartnerFormError(409, DELETED_MESSAGE)
  }
  const company = id === null ? companyForCreate(req, input.vendor?.company, VENDOR_CREATE_ROLES, 'vendor') : (relId(current!.company) ?? null)
  const rows = input.bankAccounts ?? []

  // the vendor's own fields (detail + contacts) need its update rule; bank rows alone need the bank-account rule only
  const detail = detailData(input.vendor, ['name', 'npwp', 'address', 'active'])
  const contacts = contactsData(input.contacts, current)
  const patch: Row = { ...(current ? changed(current, detail) : detail), ...(contacts !== undefined ? { contacts } : {}) }
  if (id !== null && Object.keys(patch).length && !(await canUpdateDoc(req, 'vendors', id))) fail(403, [{ path: 'vendor', message: 'Anda tidak berhak mengubah vendor ini (Admin / Finance / Direktur PT).' }])
  if (rows.length && (company === null || !hasRole(req, VENDOR_BANK_ROLES, company))) {
    fail(403, [{ path: 'bankAccounts', message: 'Rekening vendor hanya dapat ditambah / diubah oleh Admin atau Finance PT ini.' }])
  }

  const saved = await storedBanks(req, rows)
  const errors = [...validatePartnerDetail('vendor', input.vendor, mode), ...validateContacts(input.contacts), ...validateVendorBanks(rows)]
  rows.forEach((b, j) => {
    if (b.id === undefined) return
    const s = saved.get(b.id)
    if (!s) errors.push({ path: `bankAccounts.${j}`, message: 'Rekening tidak ditemukan.' })
    else if (s.vendor !== id) errors.push({ path: `bankAccounts.${j}`, message: 'Rekening ini bukan milik vendor ini.' })
  })
  if (!errors.length) {
    const pairs = rows.flatMap((b) => (b.id !== undefined && saved.has(b.id) ? [{ stored: saved.get(b.id)!, input: b }] : []))
    errors.push(...reasonErrors({ reason: input.reason, storedActive: current ? current.active !== false : undefined, active: input.vendor?.active, banks: pairs }))
  }
  if (errors.length) fail(errors.some((e) => e.message === 'Rekening tidak ditemukan.') ? 404 : 400, errors)
  if (input.reason && input.reason.trim()) req.context.auditReason = input.reason.trim()

  // 1. the vendor
  let vid: number
  if (id === null) {
    const doc = await at('vendor', () => req.payload.create({ collection: 'vendors', data: { ...patch, company } as never, depth: 0, user: req.user, req, overrideAccess: false }))
    vid = doc.id as number
  } else {
    vid = id
    if (Object.keys(patch).length) await at('vendor', () => req.payload.update({ collection: 'vendors', id: vid, data: patch as never, depth: 0, user: req.user, req, overrideAccess: false }))
  }

  // 2. its bank accounts (after the vendor: a NEW vendor's id is used; PT derived from the vendor)
  for (const [j, b] of rows.entries()) {
    const bat = `bankAccounts.${j}`
    if (b.id === undefined) {
      const row: Row = { vendor: vid, bank: b.bank, accountNo: normalizeAccountNo(String(b.accountNo ?? '').trim()), accountHolder: String(b.accountHolder ?? '').trim(), isDefault: b.isDefault === true, active: b.active !== false }
      if (b.verificationStatus !== undefined) row.verificationStatus = b.verificationStatus
      await at(bat, () => req.payload.create({ collection: 'vendor-bank-accounts', data: row as never, depth: 0, user: req.user, req, overrideAccess: false }))
      continue
    }
    const bankId = b.id
    const p = vendorBankPatch(saved.get(bankId)!, b)
    if (Object.keys(p).length) await at(bat, () => req.payload.update({ collection: 'vendor-bank-accounts', id: bankId, data: p as never, depth: 0, user: req.user, req, overrideAccess: false }))
  }
  return { id: vid, created: id === null }
}
