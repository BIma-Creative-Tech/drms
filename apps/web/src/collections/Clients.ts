import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole, rolesAllowed } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, odooRefField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'

/** Klien (pemberi kerja). Admin C/R/U, Owner C/R/U, Finance + PM R (project/kas masuk pickers). */
export const Clients: CollectionConfig = withAudit(
  {
    slug: 'clients',
    labels: { singular: 'Klien', plural: 'Klien' },
    admin: { useAsTitle: 'name', group: 'Proyek', defaultColumns: ['name', 'contact', 'phone', 'active'] },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-finance': true, 'pk-pm': true }),
      create: rolesAllowed('pk-admin', 'pk-owner'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('clients')] },
    fields: [
      companyField(),
      { name: 'name', type: 'text', label: 'Nama', required: true, maxLength: 160 },
      { name: 'contact', type: 'text', label: 'Kontak', maxLength: 128 },
      { name: 'phone', type: 'text', label: 'No. HP/telepon', maxLength: 32 },
      { name: 'address', type: 'textarea', label: 'Alamat', maxLength: 500 },
      odooRefField('odooPartnerRef', 'Ref. partner Odoo'),
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'client', reasonRules: [reasonOnDeactivate] },
)
