import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole, rolesAllowed } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { activeField, percentField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'

/**
 * Template tahapan (name + stages with weight/order). Mutable master → the `items` array child
 * table is rewritten on every update (spike c) and gets an explicit DELETE grant.
 */
export const StageTemplates: CollectionConfig = withAudit(
  {
    slug: 'stage-templates',
    labels: { singular: 'Template tahapan', plural: 'Template tahapan' },
    admin: { useAsTitle: 'name', group: 'Proyek', defaultColumns: ['name', 'active'] },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-finance': true, 'pk-pm': true }),
      create: rolesAllowed('pk-admin', 'pk-owner'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('stage-templates')] },
    fields: [
      companyField(),
      { name: 'name', type: 'text', label: 'Nama template', required: true, index: true, maxLength: 128 },
      {
        name: 'items',
        type: 'array',
        label: 'Tahapan',
        minRows: 1,
        validate: (rows: unknown) => {
          if (!Array.isArray(rows)) return true
          const sum = rows.reduce((s: number, r: { weightPct?: number }) => s + (r?.weightPct ?? 0), 0)
          return Math.abs(sum - 100) < 0.001 ? true : `Total bobot harus 100% (sekarang ${sum}%).`
        },
        fields: [
          { name: 'name', type: 'text', label: 'Nama tahapan', required: true, maxLength: 128 },
          { ...percentField('weightPct', 'Bobot (%)'), required: true },
          { name: 'sequence', type: 'number', label: 'Urutan', min: 1, required: true },
        ],
      },
      activeField(),
    ],
  },
  { docType: 'stage_template', reasonRules: [reasonOnDeactivate] },
)
