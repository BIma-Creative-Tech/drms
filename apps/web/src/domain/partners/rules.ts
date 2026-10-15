/**
 * DRMS 16/10 — "Klien" / "Vendor" tabbed forms (owner 2026-10-16: "tab dapat mengakomodir penambahan record yang
 * disesuaikan tabnya"): pure rules of ONE save (unit-tested). The collections stay the guards (Clients / Vendors /
 * VendorBankAccounts hooks + access, run with the caller's access by service.ts); these checks only answer earlier and
 * name the field (paths follow the request body: `client.*` / `vendor.*`, `contacts.<i>.*`, `bankAccounts.<j>.*`,
 * `reason`). No Payload import — also used by the collection hook (fields/contacts.ts) and the web form.
 */

export type FieldError = { path: string; message: string }

/** One "Kontak PIC" row as sent (`id` = the stored array row id; omitted = a new row). */
export type ContactInput = { id?: string; name?: string; position?: string | null; phone?: string | null; email?: string | null; notes?: string | null; isPrimary?: boolean }
/** One "Kontak PIC" row as stored (array field `contacts` of clients / vendors). */
export type ContactRow = { id?: string; name: string; position: string | null; phone: string | null; email: string | null; notes: string | null; isPrimary: boolean }

export const CONTACT_LIMITS = { name: 128, position: 128, phone: 32, email: 254, notes: 500 } as const
export const MAX_CONTACTS = 20
export const MAX_BANK_ROWS = 20

export const CONTACT_NAME_MESSAGE = 'Nama kontak wajib diisi.'
export const CONTACT_EMAIL_MESSAGE = 'Email kontak tidak valid.'
export const PARTNER_NAME_MESSAGE = 'Nama wajib diisi.'
export const NPWP_MESSAGE = 'NPWP hanya angka, titik dan minus (15–20 karakter).'
export const DEACTIVATE_REASON_MESSAGE = 'Alasan wajib diisi saat menonaktifkan data.'
/** Same text as the collection rule (VendorBankAccounts reasonOnChange). */
export const BANK_REASON_MESSAGE = 'Alasan wajib diisi saat mengubah data rekening.'
export const ACCOUNT_NO_MESSAGE = 'Nomor rekening hanya angka (5–34 digit).'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NPWP = /^[0-9.-]{15,20}$/
const ACCOUNT_NO = /^[0-9]{5,34}$/

const clean = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

/** Account number as the collection stores it (VendorBankAccounts beforeValidate): spaces, dots, dashes removed. */
export function normalizeAccountNo(v: string): string {
  return v.replace(/[\s.-]/g, '')
}

/** Email of a contact: empty = none; otherwise one address. */
export function contactEmailValid(v: unknown): boolean {
  const t = clean(v)
  return t === null || (t.length <= CONTACT_LIMITS.email && EMAIL.test(t))
}

/**
 * Rows as stored: strings trimmed ('' → null), and exactly ONE primary ("Utama") while there is any row — the first
 * row flagged primary keeps it, none flagged → the first row. Order and row ids are kept.
 */
export function normalizeContacts(rows: readonly ContactInput[] | null | undefined): ContactRow[] {
  const out: ContactRow[] = (rows ?? []).map((r) => ({
    ...(typeof r.id === 'string' && r.id !== '' ? { id: r.id } : {}),
    name: clean(r.name) ?? '',
    position: clean(r.position),
    phone: clean(r.phone),
    email: clean(r.email)?.toLowerCase() ?? null,
    notes: clean(r.notes),
    isPrimary: r.isPrimary === true,
  }))
  const first = out.findIndex((r) => r.isPrimary)
  out.forEach((r, i) => (r.isPrimary = i === (first < 0 ? 0 : first)))
  return out
}

/** The primary contact of normalized rows (null = no contact). */
export function primaryContact(rows: readonly ContactRow[]): ContactRow | null {
  return rows.find((r) => r.isPrimary) ?? rows[0] ?? null
}

/**
 * The single "Kontak" / "No. HP" columns (kept: list columns, APK masters, Odoo mirror) = the primary contact's name and
 * phone.
 */
export function legacyContactOf(rows: readonly ContactRow[]): { contact: string | null; phone: string | null } {
  const p = primaryContact(rows)
  return { contact: p ? p.name.slice(0, CONTACT_LIMITS.name) || null : null, phone: p?.phone ?? null }
}

/** Same rows (content + order; row ids ignored)? Used to send / audit `contacts` only when something changed. */
export function sameContacts(a: readonly ContactRow[], b: readonly ContactRow[]): boolean {
  const strip = (rows: readonly ContactRow[]) => JSON.stringify(rows.map((r) => [r.name, r.position, r.phone, r.email, r.notes, r.isPrimary]))
  return strip(a) === strip(b)
}

/** Field checks of the contact rows (name required, lengths, email format, row limit). */
export function validateContacts(rows: readonly ContactInput[] | undefined, prefix = 'contacts'): FieldError[] {
  const errors: FieldError[] = []
  if (!rows) return errors
  if (rows.length > MAX_CONTACTS) errors.push({ path: prefix, message: `Maksimal ${MAX_CONTACTS} kontak PIC.` })
  rows.forEach((r, i) => {
    const at = `${prefix}.${i}`
    if (!clean(r.name)) errors.push({ path: `${at}.name`, message: CONTACT_NAME_MESSAGE })
    for (const k of ['name', 'position', 'phone', 'notes'] as const) {
      const v = clean(r[k])
      if (v && v.length > CONTACT_LIMITS[k]) errors.push({ path: `${at}.${k}`, message: `Maksimal ${CONTACT_LIMITS[k]} karakter.` })
    }
    if (!contactEmailValid(r.email)) errors.push({ path: `${at}.email`, message: CONTACT_EMAIL_MESSAGE })
  })
  return errors
}

/** Detail fields of a client / vendor as sent (`company` on create only). */
export type PartnerDetailInput = { company?: number; name?: string; npwp?: string | null; address?: string | null; active?: boolean }

/** Detail checks of one save (`at` = `client` / `vendor`). Name required (create, or when sent). NPWP format (vendors). */
export function validatePartnerDetail(at: 'client' | 'vendor', d: PartnerDetailInput | undefined, mode: 'create' | 'update'): FieldError[] {
  const errors: FieldError[] = []
  if ((mode === 'create' || d?.name !== undefined) && !clean(d?.name)) errors.push({ path: `${at}.name`, message: PARTNER_NAME_MESSAGE })
  const npwp = clean(d?.npwp)
  if (at === 'vendor' && npwp && !NPWP.test(npwp)) errors.push({ path: 'vendor.npwp', message: NPWP_MESSAGE })
  return errors
}

/** One vendor bank-account row as sent (`id` = existing account of this vendor; omitted = new). */
export type VendorBankInput = { id?: number; bank?: number; accountNo?: string; accountHolder?: string; isDefault?: boolean; verificationStatus?: 'unverified' | 'verified'; active?: boolean }
/** A stored vendor bank account, as the rules need it. */
export type StoredVendorBank = { id: number; vendor: number | null; bank: number | null; accountNo: string; accountHolder: string; isDefault: boolean; verificationStatus: 'unverified' | 'verified'; active: boolean }

/** Field checks of the bank rows: a new row needs bank, number and holder; the number is digits only (5–34). */
export function validateVendorBanks(rows: readonly VendorBankInput[] | undefined, prefix = 'bankAccounts'): FieldError[] {
  const errors: FieldError[] = []
  if (!rows) return errors
  if (rows.length > MAX_BANK_ROWS) errors.push({ path: prefix, message: `Maksimal ${MAX_BANK_ROWS} rekening per simpan.` })
  const seen = new Set<number>()
  rows.forEach((b, j) => {
    const at = `${prefix}.${j}`
    if (b.id !== undefined) {
      if (seen.has(b.id)) errors.push({ path: at, message: 'Rekening yang sama dua kali dalam satu simpan.' })
      seen.add(b.id)
      if (b.accountHolder !== undefined && !clean(b.accountHolder)) errors.push({ path: `${at}.accountHolder`, message: 'Atas nama wajib diisi.' })
    } else {
      if (b.bank === undefined) errors.push({ path: `${at}.bank`, message: 'Bank wajib dipilih.' })
      if (!clean(b.accountNo)) errors.push({ path: `${at}.accountNo`, message: 'Nomor rekening wajib diisi.' })
      if (!clean(b.accountHolder)) errors.push({ path: `${at}.accountHolder`, message: 'Atas nama wajib diisi.' })
    }
    const no = clean(b.accountNo)
    if (no && !ACCOUNT_NO.test(normalizeAccountNo(no))) errors.push({ path: `${at}.accountNo`, message: ACCOUNT_NO_MESSAGE })
  })
  return errors
}

/** Changes of a saved bank account (only fields present in the row and different from the stored value). */
export function vendorBankPatch(stored: StoredVendorBank, b: VendorBankInput): Partial<Omit<StoredVendorBank, 'id' | 'vendor'>> {
  const out: Partial<Omit<StoredVendorBank, 'id' | 'vendor'>> = {}
  if (b.bank !== undefined && b.bank !== stored.bank) out.bank = b.bank
  if (b.accountNo !== undefined && normalizeAccountNo(b.accountNo.trim()) !== stored.accountNo) out.accountNo = normalizeAccountNo(b.accountNo.trim())
  if (b.accountHolder !== undefined && b.accountHolder.trim() !== stored.accountHolder) out.accountHolder = b.accountHolder.trim()
  if (b.isDefault !== undefined && b.isDefault !== stored.isDefault) out.isDefault = b.isDefault
  if (b.verificationStatus !== undefined && b.verificationStatus !== stored.verificationStatus) out.verificationStatus = b.verificationStatus
  if (b.active !== undefined && b.active !== stored.active) out.active = b.active
  return out
}

/**
 * The reason the collections ask for, answered before anything is written: deactivating the client / vendor
 * (reasonOnDeactivate) and, per saved bank account, a changed number / holder / bank or a deactivation
 * (VendorBankAccounts reasonOnChange + reasonOnDeactivate). `storedActive` = the partner's stored flag (update).
 */
export function reasonErrors(args: { reason?: string; storedActive?: boolean; active?: boolean; banks?: ReadonlyArray<{ stored: StoredVendorBank; input: VendorBankInput }> }): FieldError[] {
  if ((args.reason ?? '').trim().length >= 3) return []
  if (args.storedActive === true && args.active === false) return [{ path: 'reason', message: DEACTIVATE_REASON_MESSAGE }]
  for (const { stored, input } of args.banks ?? []) {
    const p = vendorBankPatch(stored, input)
    if (p.accountNo !== undefined || p.accountHolder !== undefined || p.bank !== undefined) return [{ path: 'reason', message: BANK_REASON_MESSAGE }]
    if (stored.active && p.active === false) return [{ path: 'reason', message: DEACTIVATE_REASON_MESSAGE }]
  }
  return []
}

/**
 * Path of a collection field error inside the body: `changeReason` → `reason`; a contact row → `contacts.<i>.<f>`
 * (the rows are written in body order); the derived `contact` / `phone` columns → `contacts`; anything else →
 * `<prefix>.<field>`.
 */
export function partnerErrorPath(prefix: string, field: string | undefined): string {
  if (field === 'changeReason') return 'reason'
  if (field && (field === 'contacts' || field.startsWith('contacts.'))) return field
  if (field === 'contact' || field === 'phone') return 'contacts'
  return field ? `${prefix}.${field}` : prefix
}
