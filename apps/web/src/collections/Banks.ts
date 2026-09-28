import type { CollectionConfig } from 'payload'

import { anyRole, denyAll } from '@/access/roles'
import { byRoleAny, rolesAllowedAny } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, codeField, uuidField } from '@/fields/common'

/** Bank (Mandiri, BCA, …). Finance C/R/U, Owner R/U, Admin C/R/U; all roles R (account picker). */
export const Banks: CollectionConfig = withAudit(
  {
    slug: 'banks',
    labels: { singular: 'Bank', plural: 'Bank' },
    admin: { useAsTitle: 'name', group: 'Master Data', defaultColumns: ['code', 'name', 'active'] },
    access: {
      read: anyRole,
      create: rolesAllowedAny('pk-admin', 'pk-finance'),
      update: byRoleAny({ 'pk-admin': true, 'pk-finance': true, 'pk-owner': true }),
      delete: denyAll,
    },
    fields: [
      codeField(),
      { name: 'name', type: 'text', label: 'Nama bank', required: true, maxLength: 128 },
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'bank', reasonRules: [reasonOnDeactivate] },
)
