import type { CollectionConfig } from 'payload'

import { anyRole, denyAll } from '@/access/roles'
import { byRoleAny, rolesAllowedAny } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, codeField, odooRefField, uuidField } from '@/fields/common'

/** Satuan (UoM) — requirements v1.1 §6; Finance C/R/U, Owner R/U, Admin C/R/U, all roles R. */
export const Uoms: CollectionConfig = withAudit(
  {
    slug: 'uoms',
    labels: { singular: 'Satuan', plural: 'Satuan' },
    admin: { useAsTitle: 'name', group: 'Master Data', defaultColumns: ['code', 'name', 'category', 'active'] },
    access: {
      read: anyRole,
      create: rolesAllowedAny('pk-admin', 'pk-finance'),
      update: byRoleAny({ 'pk-admin': true, 'pk-finance': true, 'pk-owner': true }),
      delete: denyAll,
    },
    fields: [
      codeField(),
      { name: 'name', type: 'text', label: 'Nama', required: true, maxLength: 64 },
      { name: 'category', type: 'text', label: 'Kategori', maxLength: 64, admin: { description: 'mis. volume, waktu, akomodasi' } },
      odooRefField('odooUomRef', 'Ref. UoM Odoo'),
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'uom', reasonRules: [reasonOnDeactivate] },
)
