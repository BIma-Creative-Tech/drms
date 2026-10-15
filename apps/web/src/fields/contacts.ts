import type { ArrayField, CollectionBeforeValidateHook, TextField } from 'payload'

import { CONTACT_EMAIL_MESSAGE, CONTACT_LIMITS, contactEmailValid, legacyContactOf, MAX_CONTACTS, normalizeContacts, sameContacts, type ContactInput } from '@/domain/partners/rules'

/**
 * DRMS 16/10 "Kontak PIC" of a client / vendor: many contacts (nama, jabatan, No. HP, email, catatan, utama) as a
 * Payload `array` field (tables `clients_contacts` / `vendors_contacts`, migration 20261016_100000_d1610_partner_contacts).
 * The rows belong to their client / vendor (PT, access, audit and the reason rules of the parent apply; the audit log
 * records the whole list as one field). The single `contact` (and, for clients, `phone`) columns stay — list columns,
 * APK masters, Odoo mirror — and are DERIVED from the primary row whenever the rows change (`contactsHook`); a write
 * of only the single columns (seed, import, old REST clients) updates / creates the primary row instead.
 */
export function contactsField(): ArrayField {
  return {
    name: 'contacts',
    type: 'array',
    label: 'Kontak PIC',
    labels: { singular: 'Kontak PIC', plural: 'Kontak PIC' },
    maxRows: MAX_CONTACTS,
    admin: { description: 'Orang yang dapat dihubungi. Satu kontak ditandai Utama (tampil sebagai Kontak di daftar dan aplikasi).' },
    fields: [
      { name: 'name', type: 'text', label: 'Nama', required: true, maxLength: CONTACT_LIMITS.name },
      { name: 'position', type: 'text', label: 'Jabatan', maxLength: CONTACT_LIMITS.position },
      { name: 'phone', type: 'text', label: 'No. HP', maxLength: CONTACT_LIMITS.phone },
      { name: 'email', type: 'text', label: 'Email', maxLength: CONTACT_LIMITS.email, validate: (v: unknown) => (contactEmailValid(v) ? true : CONTACT_EMAIL_MESSAGE) },
      { name: 'notes', type: 'textarea', label: 'Catatan', maxLength: CONTACT_LIMITS.notes },
      { name: 'isPrimary', type: 'checkbox', label: 'Utama', defaultValue: false },
    ],
  }
}

/** The single "Kontak" / "No. HP" column, read-only in the Payload form (derived from the primary contact). */
export function legacyContactColumn(name: 'contact' | 'phone', label: string, maxLength: number): TextField {
  return { name, type: 'text', label, maxLength, admin: { readOnly: true, description: 'Otomatis dari Kontak PIC utama.' } }
}

/**
 * beforeValidate of clients / vendors (Payload hands the update hooks the stored values merged with the write):
 * - the contact rows changed (or a create sends rows) → rows normalized (one primary), the single columns derived;
 * - otherwise a write of the single columns only (seed, import, the REST API of old clients) → the primary row takes
 *   the new name (+ phone), or becomes the first row when there is none, so both stay in step.
 */
export function contactsHook(opts: { phone: boolean }): CollectionBeforeValidateHook {
  return ({ data, operation, originalDoc }) => {
    if (!data) return data
    const d = data as Record<string, unknown>
    const o = (originalDoc ?? {}) as Record<string, unknown>
    const rows = Array.isArray(d.contacts) ? normalizeContacts(d.contacts as ContactInput[]) : null
    const stored = Array.isArray(o.contacts) ? normalizeContacts(o.contacts as ContactInput[]) : []
    const rowsChanged = rows !== null && (operation === 'create' ? rows.length > 0 : !sameContacts(rows, stored))
    if (rowsChanged) {
      d.contacts = rows
      const legacy = legacyContactOf(rows)
      d.contact = legacy.contact
      if (opts.phone) d.phone = legacy.phone
      return data
    }
    if (rows !== null) d.contacts = rows
    const differs = (k: 'contact' | 'phone') => k in d && (d[k] ?? null) !== (o[k] ?? null)
    const legacyChanged = operation === 'create' ? typeof d.contact === 'string' && d.contact.trim() !== '' : differs('contact') || (opts.phone && differs('phone'))
    if (!legacyChanged) return data
    const name = typeof d.contact === 'string' ? d.contact.trim().slice(0, CONTACT_LIMITS.name) : ''
    if (!name) return data // a contact row needs a name; the single columns keep the written value
    const phone = opts.phone && typeof d.phone === 'string' && d.phone.trim() !== '' ? d.phone.trim() : null
    const base = rows ?? stored
    const at = base.findIndex((r) => r.isPrimary)
    const next = at >= 0 ? base.map((r, i) => (i === at ? { ...r, name, ...(opts.phone ? { phone } : {}) } : r)) : [{ name, phone, isPrimary: true }, ...base]
    d.contacts = normalizeContacts(next)
    return data
  }
}
