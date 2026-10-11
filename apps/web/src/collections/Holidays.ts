import type { CollectionConfig } from 'payload'

import { anyRole, denyAll } from '@/access/roles'
import { byRoleAny, rolesAllowedAny } from '@/access/policies'
import { reasonOnAnyUpdate, withAudit } from '@/audit/hooks'

import { BUSINESS_DATE_FIELD } from './fields-f2'

/** Hari libur (rekap absensi). Admin C/R/U, Owner R/U, all R. Date = business date (YYYY-MM-DD). */
export const Holidays: CollectionConfig = withAudit(
  {
    slug: 'holidays',
    labels: { singular: 'Hari libur', plural: 'Hari libur' },
    admin: { useAsTitle: 'name', group: 'Master Data', defaultColumns: ['date', 'name'] },
    access: {
      read: anyRole,
      create: rolesAllowedAny('pk-admin'),
      update: byRoleAny({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    fields: [
      {
        name: 'date',
        type: 'text',
        label: 'Tanggal',
        required: true,
        // DRMS 10/10 8c: date picker on the same YYYY-MM-DD text column (like every business date)
        admin: { components: { Field: BUSINESS_DATE_FIELD } },
        unique: true,
        index: true,
        validate: (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? true : 'Format tanggal YYYY-MM-DD.'),
      },
      { name: 'name', type: 'text', label: 'Keterangan', required: true, maxLength: 128 },
    ],
  },
  { docType: 'holiday', reasonRules: [reasonOnAnyUpdate] },
)
