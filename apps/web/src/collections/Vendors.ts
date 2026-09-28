import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole, rolesAllowed } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, odooRefField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'

/** Vendor (opsional; duplikat nota). Admin/Finance C/R/U, Owner R/U, PM R. */
export const Vendors: CollectionConfig = withAudit(
  {
    slug: 'vendors',
    labels: { singular: 'Vendor', plural: 'Vendor' },
    admin: { useAsTitle: 'name', group: 'Master Data', defaultColumns: ['name', 'contact', 'npwp', 'active'] },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-finance': true, 'pk-pm': true }),
      create: rolesAllowed('pk-admin', 'pk-finance'),
      update: byRole({ 'pk-admin': true, 'pk-finance': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('vendors')] },
    fields: [
      companyField(),
      { name: 'name', type: 'text', label: 'Nama', required: true, maxLength: 160 },
      { name: 'contact', type: 'text', label: 'Kontak', maxLength: 128 },
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
      odooRefField('odooPartnerRef', 'Ref. partner Odoo'),
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'vendor', reasonRules: [reasonOnDeactivate] },
)
