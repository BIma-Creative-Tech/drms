import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { assignedProjects, byRole, fieldRoles, teamProjects } from '@/access/policies'
import { withAudit } from '@/audit/hooks'
import { RAP_KIND_LABELS, RAP_KINDS } from '@/domain/rap/rules'
import { activeField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'

import { ro } from './fields-f2'

/** Prices/values never reach Staff (owner decision 2026-10-10) — field read on the price columns. */
const priceRead = fieldRoles('pk-admin', 'pk-owner', 'pk-finance', 'pk-pm')

/**
 * P3 RAP item of a project (ADR 0020 §C; every kind with a RAB since DRMS 10/10 D4, owner 2026-10-11): `pekerjaan`
 * (konstruksi: volume drives the stage progress) or `material` (received / used / stock, never in %). Written ONLY by domain/rap/* (import, edit, lock
 * rules: before the first realisation PM team + Direktur, afterwards Direktur with a reason; items with
 * realisation are deactivated, never deleted). The realised / received / used columns are maintained by
 * the DB from the append-only daily-report ledger (trigger, migration p3_security).
 */
export const RapItems: CollectionConfig = withAudit(
  {
    slug: 'rap-items',
    labels: { singular: 'Item RAP', plural: 'Item RAP' },
    admin: { useAsTitle: 'description', group: 'Proyek', defaultColumns: ['project', 'code', 'description', 'kind', 'uom', 'volume', 'realisedQty', 'active'], description: 'Diubah dari tab RAP project atau impor Excel (bukan dari form ini).' },
    defaultSort: 'sortOrder',
    access: {
      read: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-finance': true, 'pk-pm': teamProjects('project'), 'pk-staff': assignedProjects('project') }),
      create: denyAll,
      update: denyAll,
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('rap-items', { derive: [{ field: 'project', collection: 'projects' }], check: [{ field: 'stage', collection: 'project-stages' }] })] },
    fields: [
      companyField({ derived: true }),
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', required: true, index: true, admin: ro },
      // DRMS 10/10 D4 (2026-10-11): required for konstruksi only (DB trigger); other kinds may leave it empty
      { name: 'stage', type: 'relationship', relationTo: 'project-stages', label: 'Tahapan', index: true, admin: ro },
      { name: 'code', type: 'text', label: 'Kode', required: true, maxLength: 32, index: true, admin: ro },
      { name: 'description', type: 'text', label: 'Uraian', required: true, maxLength: 300, admin: ro },
      { name: 'kind', type: 'select', label: 'Jenis', required: true, index: true, options: RAP_KINDS.map((v) => ({ label: RAP_KIND_LABELS[v], value: v })), admin: ro },
      { name: 'uom', type: 'relationship', relationTo: 'uoms', label: 'Satuan', required: true, admin: ro },
      { name: 'volume', type: 'number', label: 'Volume RAP', required: true, admin: ro },
      { name: 'unitPrice', type: 'number', label: 'Harga satuan (Rp)', access: { read: priceRead }, admin: ro },
      { name: 'weightPct', type: 'number', label: 'Bobot (%)', admin: ro },
      { name: 'sortOrder', type: 'number', label: 'Urutan', defaultValue: 0, admin: ro },
      { name: 'realisedQty', type: 'number', label: 'Realisasi', defaultValue: 0, admin: { ...ro, description: 'Pekerjaan: Σ volume laporan harian (ledger).' } },
      { name: 'receivedQty', type: 'number', label: 'Material masuk', defaultValue: 0, admin: ro },
      { name: 'usedQty', type: 'number', label: 'Material terpakai', defaultValue: 0, admin: ro },
      { ...activeField(), admin: ro },
      uuidField(),
    ],
  },
  { docType: 'rap_item', exclude: ['realisedQty', 'receivedQty', 'usedQty'] },
)
