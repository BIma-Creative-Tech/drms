import type { CollectionConfig, FieldAccess } from 'payload'

import { denyAll, relId, rolesIn, userId } from '@/access/roles'
import { withAudit } from '@/audit/hooks'
import { ACTIVITY_KIND_LABELS, ACTIVITY_KINDS, PO_STATUS_LABELS, PO_STATUSES, RATE_FIELD_ROLES } from '@/domain/field/rules'
import { rupiahField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'

import { FIELD_AUDIT_EXCLUDE, fieldReportRead, fieldSystemFields, jsonView } from './field-common'
import { businessDateField, ro } from './fields-f2'
import { USER_NAME_VIEW } from '@/fields/users'

/** ADR 0020 §7: the value (Rp) — Direktur/Finance/Admin of the row's PT, or the reporter who entered it. */
const valueRead: FieldAccess = ({ req, doc }) => {
  const d = (doc ?? {}) as { company?: unknown; reporter?: unknown }
  if (rolesIn(req, relId(d.company)).some((r) => RATE_FIELD_ROLES.includes(r))) return true
  const uid = userId(req)
  return uid !== undefined && relId(d.reporter) === uid
}

/**
 * FR1 Log aktivitas aftersales (ADR 0020 §5, requirements v1.3): one row per activity of an
 * aftersales staff member for a CUSTOMER (clients, same PT) in a project of kind aftersales —
 * quotation (follow-up date → reminder), incoming PO (status belum_kirim → sebagian/terkirim by the
 * deliveries that refer to it, or batal), delivery (refers to an incoming PO of the same customer,
 * receiver, delivery-note photos ≤ 5), invoicing, visit, other. Items are text lines (no stock); the
 * value (Rp) is optional and hidden from everyone but Direktur/Finance/Admin and its reporter.
 * Written only by domain/field/aftersales.ts.
 */
export const AftersalesActivities: CollectionConfig = withAudit(
  {
    slug: 'aftersales-activities',
    labels: { singular: 'Aktivitas aftersales', plural: 'Aktivitas aftersales' },
    admin: {
      group: 'Proyek',
      useAsTitle: 'docNo',
      defaultColumns: ['activityDate', 'project', 'client', 'kind', 'docNo', 'poStatus', 'value', 'reporter'],
      listSearchableFields: ['docNo'],
      description: 'Dibuat dari aplikasi Android atau API laporan lapangan (bukan dari form ini). Nilai (Rp) hanya terlihat oleh Direktur, Finance, Admin, dan pelapornya.',
    },
    defaultSort: '-id',
    access: { read: fieldReportRead, create: denyAll, update: denyAll, delete: denyAll },
    hooks: {
      beforeChange: [
        companyHook('aftersales-activities', { derive: [{ field: 'project', collection: 'projects' }], check: [{ field: 'client', collection: 'clients' }, { field: 'relatesTo', collection: 'aftersales-activities' }] }),
      ],
    },
    fields: [
      companyField({ derived: true }),
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', required: true, index: true, admin: ro },
      businessDateField('activityDate', 'Tanggal', { required: true, index: true, admin: ro }),
      { name: 'reporter', type: 'relationship', relationTo: 'users', label: 'Pelapor', required: true, index: true, admin: { ...ro, components: USER_NAME_VIEW } },
      { name: 'client', type: 'relationship', relationTo: 'clients', label: 'Pelanggan', required: true, index: true, admin: ro },
      { name: 'kind', type: 'select', label: 'Jenis', required: true, index: true, options: ACTIVITY_KINDS.map((v) => ({ label: ACTIVITY_KIND_LABELS[v], value: v })), admin: ro },
      { name: 'docNo', type: 'text', label: 'No. dokumen (Q/PO/SJ/INV)', maxLength: 64, index: true, admin: ro },
      { name: 'items', type: 'json', label: 'Item', admin: jsonView },
      { ...rupiahField('value', 'Nilai (Rp)'), access: { read: valueRead }, admin: ro },
      { name: 'relatesTo', type: 'relationship', relationTo: 'aftersales-activities', label: 'PO masuk terkait', index: true, admin: ro },
      { name: 'poStatus', type: 'select', label: 'Status PO', index: true, options: PO_STATUSES.map((v) => ({ label: PO_STATUS_LABELS[v], value: v })), admin: ro },
      businessDateField('followUpDate', 'Tanggal follow-up', { index: true, admin: ro }),
      { name: 'receiver', type: 'text', label: 'Penerima', maxLength: 128, admin: ro },
      { name: 'notes', type: 'textarea', label: 'Catatan', maxLength: 2000, admin: ro },
      ...fieldSystemFields(),
    ],
  },
  { docType: 'aftersales_activity', exclude: FIELD_AUDIT_EXCLUDE },
)
