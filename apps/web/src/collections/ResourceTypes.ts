import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { anyMember, byRole, rolesAllowed } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { RESOURCE_KIND_LABELS, RESOURCE_KINDS } from '@/domain/rap/rules'
import { activeField, codeField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'

/**
 * P3 Laporan Harian: types of manpower (tenaga kerja: mandor, tukang batu, …) and equipment (alat) per PT.
 * Mandor/tukang have no account — the daily report counts them (owner decision 2026-10-09). Seeded per PT
 * (DEFAULT_RESOURCE_TYPES), configurable; no delete (deactivate).
 */
export const ResourceTypes: CollectionConfig = withAudit(
  {
    slug: 'resource-types',
    labels: { singular: 'Jenis tenaga / alat', plural: 'Jenis tenaga / alat' },
    admin: { useAsTitle: 'name', group: 'Master Data', defaultColumns: ['code', 'name', 'kind', 'active'] },
    access: {
      read: anyMember,
      create: rolesAllowed('pk-admin', 'pk-owner', 'pk-pm'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-pm': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('resource-types')] },
    fields: [
      companyField(),
      { name: 'kind', type: 'select', label: 'Jenis', required: true, index: true, options: RESOURCE_KINDS.map((v) => ({ label: RESOURCE_KIND_LABELS[v], value: v })) },
      codeField('Kode', 32, { perCompany: true }),
      { name: 'name', type: 'text', label: 'Nama', required: true, maxLength: 80 },
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'resource_type', reasonRules: [reasonOnDeactivate] },
)
