import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole, rolesAllowed } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, codeField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'

/** Sumber kas masuk (Termin, DP klien, …). Finance C/R/U, Owner R/U, Admin C/R/U. */
export const CashInSources: CollectionConfig = withAudit(
  {
    slug: 'cash-in-sources',
    labels: { singular: 'Sumber kas masuk', plural: 'Sumber kas masuk' },
    admin: { useAsTitle: 'name', group: 'Keuangan', defaultColumns: ['code', 'name', 'coaCode', 'active'] },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-finance': true, 'pk-owner': true }),
      create: rolesAllowed('pk-admin', 'pk-finance'),
      update: byRole({ 'pk-admin': true, 'pk-finance': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('cash-in-sources')] },
    fields: [
      companyField(),
      codeField('Kode', 32, { perCompany: true }),
      { name: 'name', type: 'text', label: 'Nama', required: true, maxLength: 128 },
      { name: 'coaCode', type: 'text', label: 'Kode akun (COA)', maxLength: 32 },
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'cash_in_source', reasonRules: [reasonOnDeactivate] },
)
