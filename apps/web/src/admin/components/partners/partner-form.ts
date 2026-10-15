import type { ClientFormDetail, ContactView, PartnerCompany, VendorBankView, VendorFormDetail } from '@/domain/partners/service'

/**
 * DRMS 16/10 — "Klien" / "Vendor" tabbed pages: pure state of the client form (unit-tested; no React). One draft per
 * page (detail + Kontak PIC rows + — vendor — bank-account rows) and ONE body to `POST /api/v1/{client,vendor}-form`
 * (create) or `PATCH …/{id}` (only what changed; the contact list is sent whole when it changed). Server errors
 * (`errors[].path` = body paths with array indexes) are mapped back to the draft keys and their tab.
 */

export type PartnerKind = 'client' | 'vendor'
export type TabId = 'detail' | 'kontak' | 'rekening' | 'proyek'

export const CLIENT_TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'detail', label: 'Detail Klien' },
  { id: 'kontak', label: 'Kontak PIC' },
  { id: 'proyek', label: 'Proyek' },
]

export const VENDOR_TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'detail', label: 'Detail Vendor' },
  { id: 'rekening', label: 'Rekening' },
  { id: 'kontak', label: 'Kontak PIC' },
]

export const tabsOf = (kind: PartnerKind) => (kind === 'client' ? CLIENT_TABS : VENDOR_TABS)

/** Project status labels (Projects PROJECT_STATUSES — inlined: this module is bundled into the browser). */
export const PROJECT_STATUS_LABELS: Readonly<Record<string, string>> = { perencanaan: 'Perencanaan', berjalan: 'Berjalan', ditunda: 'Ditunda', selesai: 'Selesai', arsip: 'Arsip' }

export type ContactDraft = { key: string; id?: string; name: string; position: string; phone: string; email: string; notes: string; isPrimary: boolean }
export type BankDraft = { key: string; id?: number; bank: number | null; accountNo: string; accountHolder: string; isDefault: boolean; verificationStatus: 'unverified' | 'verified'; active: boolean }
export type Draft = { company: number | null; name: string; npwp: string; address: string; active: boolean; contacts: ContactDraft[]; banks: BankDraft[]; reason: string }

type Detail = ClientFormDetail | VendorFormDetail
const recordOf = (d: Detail) => ('client' in d ? d.client : d.vendor)

const contactDraft = (c: ContactView): ContactDraft => ({ key: `c${c.id}`, id: c.id, name: c.name, position: c.position ?? '', phone: c.phone ?? '', email: c.email ?? '', notes: c.notes ?? '', isPrimary: c.isPrimary })
const bankDraft = (b: VendorBankView): BankDraft => ({ key: `b${b.id}`, id: b.id, bank: b.bank, accountNo: b.accountNo, accountHolder: b.accountHolder, isDefault: b.isDefault, verificationStatus: b.verificationStatus, active: b.active })

/**
 * The PT of a new record: `initial` when it is one of the form's PTs (e.g. a drawer opened from a form of that PT),
 * else the only PT; null = the user picks.
 */
export function initialCompany(companies: readonly PartnerCompany[], initial?: number | null): number | null {
  if (initial != null && companies.some((c) => c.id === initial)) return initial
  return companies.length === 1 ? companies[0]!.id : null
}

export function draftFromDetail(detail: Detail, initial?: number | null): Draft {
  const r = recordOf(detail)
  return {
    company: r ? r.company : initialCompany(detail.companies, initial),
    name: r?.name ?? '',
    npwp: r && 'npwp' in r ? (r.npwp ?? '') : '',
    address: r?.address ?? '',
    active: r?.active ?? true,
    contacts: (r?.contacts ?? []).map(contactDraft),
    banks: 'bankAccounts' in detail ? detail.bankAccounts.map(bankDraft) : [],
    reason: '',
  }
}

/** A new contact row (the first one of the record becomes the primary). */
export function newContact(key: string, primary: boolean): ContactDraft {
  return { key, name: '', position: '', phone: '', email: '', notes: '', isPrimary: primary }
}

/** A new bank-account row (holder prefilled with the vendor's name). */
export function newBank(key: string, holder: string): BankDraft {
  return { key, bank: null, accountNo: '', accountHolder: holder, isDefault: false, verificationStatus: 'unverified', active: true }
}

/** "Utama" is exclusive: marking one row unmarks the others. */
export function setPrimary(rows: readonly ContactDraft[], key: string): ContactDraft[] {
  return rows.map((r) => ({ ...r, isPrimary: r.key === key }))
}

/** Removing a contact row keeps a primary: the first remaining row takes over when the primary goes. */
export function removeContact(rows: readonly ContactDraft[], key: string): ContactDraft[] {
  const out = rows.filter((r) => r.key !== key)
  if (out.length && !out.some((r) => r.isPrimary)) out[0] = { ...out[0]!, isPrimary: true }
  return out
}

/** "Rekening default" is exclusive: marking one row unmarks the others. */
export function setDefaultBank(rows: readonly BankDraft[], key: string, on: boolean): BankDraft[] {
  return rows.map((r) => (r.key === key ? { ...r, isDefault: on } : on ? { ...r, isDefault: false } : r))
}

/** May the caller add / change bank rows for the draft's PT (Admin / Finance of that PT)? */
export function canManageBanks(detail: VendorFormDetail, draft: Pick<Draft, 'company'>): boolean {
  return detail.canEdit !== false && detail.companies.some((c) => c.id === draft.company && c.canManageBankAccounts)
}

const opt = (v: string): string | null => (v.trim() === '' ? null : v.trim())
const blankContact = (c: ContactDraft) => c.id === undefined && [c.name, c.position, c.phone, c.email, c.notes].every((v) => v.trim() === '')

type ContactBody = { id?: string; name: string; position: string | null; phone: string | null; email: string | null; notes: string | null; isPrimary: boolean }
const contactBody = (c: ContactDraft): ContactBody => ({ ...(c.id !== undefined ? { id: c.id } : {}), name: c.name.trim(), position: opt(c.position), phone: opt(c.phone), email: opt(c.email), notes: opt(c.notes), isPrimary: c.isPrimary })
const sameContact = (a: ContactBody, b: ContactView) => a.name === b.name && a.position === b.position && a.phone === b.phone && (a.email ?? null) === (b.email ?? null) && a.notes === b.notes && a.isPrimary === b.isPrimary

function bankPart(stored: readonly VendorBankView[], b: BankDraft): Record<string, unknown> | null {
  if (b.id === undefined) {
    if (b.bank === null && b.accountNo.trim() === '') return null // untouched new row (the holder is prefilled)
    return { ...(b.bank !== null ? { bank: b.bank } : {}), accountNo: b.accountNo.trim(), accountHolder: b.accountHolder.trim(), isDefault: b.isDefault, verificationStatus: b.verificationStatus, active: b.active }
  }
  const s = stored.find((x) => x.id === b.id)
  if (!s) return null
  const out: Record<string, unknown> = {}
  if (b.bank !== s.bank && b.bank !== null) out.bank = b.bank
  if (b.accountNo.trim() !== s.accountNo) out.accountNo = b.accountNo.trim()
  if (b.accountHolder.trim() !== s.accountHolder) out.accountHolder = b.accountHolder.trim()
  if (b.isDefault !== s.isDefault) out.isDefault = b.isDefault
  if (b.verificationStatus !== s.verificationStatus) out.verificationStatus = b.verificationStatus
  if (b.active !== s.active) out.active = b.active
  return Object.keys(out).length ? { id: b.id, ...out } : null
}

/** Index maps of a sent body, to place the server's `contacts.<i>` / `bankAccounts.<j>` errors. */
export type BodyOrder = { contacts: string[]; banks: string[] }
export type Body = Record<string, unknown>

/**
 * The body of one save + its index order. Create: every detail field, the non-blank contact rows, the filled bank
 * rows. Edit: only changed detail fields, the whole contact list when anything in it changed, the changed bank rows.
 * `needsReason`: deactivation, a changed number / holder / bank or a deactivated bank account (collection rules).
 */
export function buildBody(kind: PartnerKind, detail: Detail, draft: Draft, mode: 'create' | 'update'): { body: Body; order: BodyOrder; changed: boolean; needsReason: boolean } {
  const r = recordOf(detail)
  const at = kind
  const body: Body = {}
  const order: BodyOrder = { contacts: [], banks: [] }
  let needsReason = false

  const d: Record<string, unknown> = {}
  if (mode === 'create') {
    if (draft.company !== null) d.company = draft.company
    d.name = draft.name.trim()
    d.address = opt(draft.address)
    if (kind === 'vendor') d.npwp = opt(draft.npwp)
    if (!draft.active) d.active = false
  } else if (r) {
    if (draft.name.trim() !== r.name) d.name = draft.name.trim()
    if (opt(draft.address) !== r.address) d.address = opt(draft.address)
    if (kind === 'vendor' && 'npwp' in r && opt(draft.npwp) !== r.npwp) d.npwp = opt(draft.npwp)
    if (draft.active !== r.active) {
      d.active = draft.active
      if (!draft.active) needsReason = true
    }
  }
  if (mode === 'create' || Object.keys(d).length) body[at] = d

  const rows = draft.contacts.filter((c) => !blankContact(c))
  const sent = rows.map(contactBody)
  const stored = r?.contacts ?? []
  const contactsChanged = mode === 'create' ? sent.length > 0 : sent.length !== stored.length || sent.some((c, i) => !sameContact(c, stored[i]!))
  if (contactsChanged) {
    body.contacts = sent
    order.contacts = rows.map((c) => c.key)
  }

  if (kind === 'vendor' && 'bankAccounts' in detail) {
    const banks: Array<Record<string, unknown>> = []
    for (const b of draft.banks) {
      const part = bankPart(detail.bankAccounts, b)
      if (!part) continue
      banks.push(part)
      order.banks.push(b.key)
      if (b.id !== undefined && ('accountNo' in part || 'accountHolder' in part || 'bank' in part || part.active === false)) needsReason = true
    }
    if (banks.length) body.bankAccounts = banks
  }
  if (draft.reason.trim()) body.reason = draft.reason.trim()
  const changed = mode === 'create' || Object.keys(body).some((k) => k !== 'reason')
  return { body, order, changed, needsReason }
}

/** Draft key of one server error path + the tab that shows it. */
export function errorTarget(kind: PartnerKind, path: string, order: BodyOrder): { key: string; tab: TabId | null } {
  if (path === 'reason') return { key: 'reason', tab: null }
  const cm = /^contacts\.(\d+)(?:\.(.*))?$/.exec(path)
  if (cm) return { key: `contact.${order.contacts[Number(cm[1])] ?? '?'}${cm[2] ? `.${cm[2]}` : ''}`, tab: 'kontak' }
  if (path === 'contacts') return { key: 'contacts', tab: 'kontak' }
  const bm = /^bankAccounts\.(\d+)(?:\.(.*))?$/.exec(path)
  if (bm) return { key: `bank.${order.banks[Number(bm[1])] ?? '?'}${bm[2] ? `.${bm[2]}` : ''}`, tab: 'rekening' }
  if (path === 'bankAccounts') return { key: 'banks', tab: 'rekening' }
  const dm = new RegExp(`^${kind}(?:\\.(.*))?$`).exec(path)
  if (dm) return { key: dm[1] ? `d.${dm[1]}` : 'd', tab: 'detail' }
  return { key: path, tab: null }
}

/** Errors of a refused save by draft key (several messages of one key joined) + the first tab with an error. */
export function mapErrors(kind: PartnerKind, data: unknown, order: BodyOrder): { byKey: Map<string, string>; tab: TabId | null } {
  const errs = ((data ?? {}) as { errors?: Array<{ path?: unknown; message?: unknown }> }).errors ?? []
  const byKey = new Map<string, string>()
  let tab: TabId | null = null
  for (const e of errs) {
    if (typeof e.path !== 'string') continue
    const t = errorTarget(kind, e.path, order)
    const msg = typeof e.message === 'string' && e.message ? e.message : 'Tidak valid.'
    byKey.set(t.key, byKey.has(t.key) ? `${byKey.get(t.key)}; ${msg}` : msg)
    tab ??= t.tab
  }
  return { byKey, tab }
}

/** Does the tab hold an error key? (dot on the tab) */
export function tabHasError(t: TabId, keys: Iterable<string>): boolean {
  for (const k of keys) {
    if (t === 'detail' && (k === 'd' || k.startsWith('d.'))) return true
    if (t === 'kontak' && (k === 'contacts' || k.startsWith('contact.'))) return true
    if (t === 'rekening' && (k === 'banks' || k.startsWith('bank.'))) return true
  }
  return false
}

/** API paths of the form. */
export function formUrl(kind: PartnerKind, id: number | null): string {
  const base = kind === 'client' ? '/api/v1/client-form' : '/api/v1/vendor-form'
  return id === null ? base : `${base}/${id}`
}
