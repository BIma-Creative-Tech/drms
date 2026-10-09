import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { anyMember, byRole, rolesAllowed } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, codeField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'

/**
 * Tingkat urgensi of an expense request (owner decision 2026-10-09): replaces the activity period
 * "Periode kegiatan" (periodFrom/periodTo, Q-04). Configurable per PT; every new PT starts with Low /
 * Medium / High / Super (`ensureDefaultUrgencyLevels`). `rank` orders the levels (1 = lowest). No delete:
 * a level is deactivated (requests keep their reference).
 */
export const UrgencyLevels: CollectionConfig = withAudit(
  {
    slug: 'urgency-levels',
    labels: { singular: 'Tingkat urgensi', plural: 'Tingkat urgensi' },
    admin: { useAsTitle: 'name', group: 'Master Data', defaultColumns: ['code', 'name', 'rank', 'active'] },
    defaultSort: 'rank',
    access: {
      read: anyMember,
      create: rolesAllowed('pk-admin', 'pk-owner', 'pk-finance'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-finance': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('urgency-levels')] },
    fields: [
      companyField(),
      codeField('Kode', 32, { perCompany: true }),
      { name: 'name', type: 'text', label: 'Nama', required: true, maxLength: 64 },
      { name: 'rank', type: 'number', label: 'Urutan', required: true, min: 1, max: 99, admin: { description: '1 = paling rendah. Menentukan urutan di pilihan dan antrian.' } },
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'urgency_level', reasonRules: [reasonOnDeactivate] },
)
