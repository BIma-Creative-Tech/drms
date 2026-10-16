import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole, rolesAllowed } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, odooRefField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'
import { PARTNER_REDIRECT_VIEWS } from '@/admin/partner-routes'
import { contactsField, contactsHook, legacyContactColumn } from '@/fields/contacts'

/**
 * Vendor (opsional; duplikat nota). Admin/Finance C/R/U, Owner R/U, PM R. Staff R (owner request 2026-10-16: Staff file
 * vendor payments and pick the vendor — read only, PTs of the Staff's mapping; the Staff panel still hides the list).
 * ADR 0027 (DRMS 13/10 Wave 4): the vendor's bank accounts (`vendor-bank-accounts`) are the destination of a vendor
 * payment ("Pembayaran vendor").
 * DRMS 16/10: edited in the tabbed "Vendor" page (/admin/vendor/<id>: Detail Vendor · Rekening · Kontak PIC, one save —
 * domain/partners/service.ts) — it replaces the Payload tabs + `join` list of the accounts (no column: no schema change
 * for that part); many "Kontak PIC" (`contacts`), the single Kontak column = the primary one.
 */
export const Vendors: CollectionConfig = withAudit(
  {
    slug: 'vendors',
    labels: { singular: 'Vendor', plural: 'Vendor' },
    // DRMS 16/10 (b): the document pages /collections/vendors/<create|id> → /admin/vendor/<baru|id> (the drawer keeps this form)
    admin: { useAsTitle: 'name', group: 'Master Data', defaultColumns: ['name', 'contact', 'npwp', 'active'], components: { views: PARTNER_REDIRECT_VIEWS } },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-finance': true, 'pk-pm': true, 'pk-staff': true }),
      create: rolesAllowed('pk-admin', 'pk-finance'),
      update: byRole({ 'pk-admin': true, 'pk-finance': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeValidate: [contactsHook({ phone: false })], beforeChange: [companyHook('vendors')] },
    fields: [
      // PT stays a top-level field (PT column / chip / filter of the list wrappers, ADR 0016)
      companyField(),
      { name: 'name', type: 'text', label: 'Nama', required: true, maxLength: 160 },
      legacyContactColumn('contact', 'Kontak', 128),
      {
        name: 'npwp',
        type: 'text',
        label: 'NPWP',
        maxLength: 32,
        validate: (v: unknown) =>
          v === null || v === undefined || v === '' || (typeof v === 'string' && /^[0-9.\-]{15,20}$/.test(v))
            ? true
            : 'NPWP hanya angka, titik dan minus (15–20 karakter).',
      },
      { name: 'address', type: 'textarea', label: 'Alamat', maxLength: 500 },
      contactsField(),
      odooRefField('odooPartnerRef', 'Ref. partner Odoo'),
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'vendor', reasonRules: [reasonOnDeactivate] },
)
