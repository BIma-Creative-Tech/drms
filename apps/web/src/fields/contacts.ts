import type { ArrayField, CollectionBeforeValidateHook, TextField } from 'payload'

import { CONTACT_EMAIL_MESSAGE, CONTACT_LIMITS, contactEmailValid, legacyContactOf, MAX_CONTACTS, normalizeContacts, type ContactInput } from '@/domain/partners/rules'

/**
 * DRMS 16/10 "Kontak PIC" of a client / vendor: many contacts (nama, jabatan, No. HP, email, catatan, utama) as a
 * Payload `array` field (tables `clients_contacts` / `vendors_contacts`, migration 20261016_100000_d1610_partner_contacts).
 * The rows belong to their client / vendor (PT, access, audit and the reason rules of the parent apply; the audit log
 * records the whole list as one field). The single `contact` (and, for clients, `phone`) columns stay — list columns,
 * APK masters, Odoo mirror — and are DERIVED from the primary row on every write that sends `contacts`
 * (`contactsHook`); a write that sends only the single columns on create (seed, import) becomes the primary row.
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

/** beforeValidate of clients / vendors: normalize the rows (one primary) and derive the single columns. */
export function contactsHook(opts: { phone: boolean }): CollectionBeforeValidateHook {
  return ({ data, operation }) => {
    if (!data) return data
    const d = data as Record<string, unknown>
    if (Array.isArray(d.contacts)) {
      const rows = normalizeContacts(d.contacts as ContactInput[])
      d.contacts = rows
      const legacy = legacyContactOf(rows)
      d.contact = legacy.contact
      if (opts.phone) d.phone = legacy.phone
    } else if (operation === 'create' && typeof d.contact === 'string' && d.contact.trim() !== '') {
      d.contacts = normalizeContacts([{ name: d.contact.slice(0, CONTACT_LIMITS.name), phone: opts.phone && typeof d.phone === 'string' ? d.phone : null, isPrimary: true }])
    }
    return data
  }
}
