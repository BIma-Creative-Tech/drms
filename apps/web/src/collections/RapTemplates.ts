import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byRole, rolesAllowed } from '@/access/policies'
import { reasonOnDeactivate, withAudit } from '@/audit/hooks'
import { RAP_KIND_LABELS, RAP_KINDS } from '@/domain/rap/rules'
import { activeField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'

/**
 * P3 RAP template per PT (owner decision 2026-10-10): applied to a project without RAP, or saved from a
 * project's RAP. Stages by name, units by code (resolved when applied). Cross-PT reuse goes through the
 * Excel file. The `items` array is rewritten on every update (Payload child table → DELETE grant).
 */
export const RapTemplates: CollectionConfig = withAudit(
  {
    slug: 'rap-templates',
    labels: { singular: 'Template RAP', plural: 'Template RAP' },
    admin: { useAsTitle: 'name', group: 'Proyek', defaultColumns: ['name', 'active', 'updatedAt'] },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-finance': true, 'pk-pm': true }),
      create: rolesAllowed('pk-admin', 'pk-owner', 'pk-pm'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-pm': true }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('rap-templates')] },
    fields: [
      companyField(),
      { name: 'name', type: 'text', label: 'Nama template', required: true, index: true, maxLength: 128 },
      { name: 'notes', type: 'textarea', label: 'Keterangan', maxLength: 1000 },
      {
        name: 'items',
        type: 'array',
        label: 'Item',
        minRows: 1,
        maxRows: 2000,
        fields: [
          { name: 'code', type: 'text', label: 'Kode', required: true, maxLength: 32 },
          { name: 'description', type: 'text', label: 'Uraian', required: true, maxLength: 300 },
          { name: 'stageName', type: 'text', label: 'Tahapan', required: true, maxLength: 128 },
          { name: 'kind', type: 'select', label: 'Jenis', required: true, options: RAP_KINDS.map((v) => ({ label: RAP_KIND_LABELS[v], value: v })) },
          { name: 'uomCode', type: 'text', label: 'Satuan (kode)', required: true, maxLength: 16 },
          { name: 'volume', type: 'number', label: 'Volume', required: true, min: 0 },
          { name: 'unitPrice', type: 'number', label: 'Harga satuan (Rp)', min: 0 },
          { name: 'weightPct', type: 'number', label: 'Bobot (%)', min: 0, max: 100 },
        ],
      },
      activeField(),
      uuidField(),
    ],
  },
  { docType: 'rap_template', reasonRules: [reasonOnDeactivate] },
)
