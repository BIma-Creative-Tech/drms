import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { withAudit } from '@/audit/hooks'
import { SERVICE_TYPE_LABELS, SERVICE_TYPES, UNIT_STATUS_LABELS, UNIT_STATUSES } from '@/domain/field/rules'
import { companyField, companyHook } from '@/fields/company'

import { FIELD_AUDIT_EXCLUDE, fieldReportRead, fieldSystemFields, jsonView } from './field-common'
import { businessDateField, ro } from './fields-f2'

/**
 * FR1 Laporan servis unit (`SV/YYMM/####`, ADR 0020 §5, requirements v1.3 US-60…): mechanic's report
 * of a service visit on a unit (own fleet or customer-owned) in a project of kind kontrak_unit or
 * aftersales — HM, complaint, action, spare parts (text lines, NO stock), unit status after the
 * service (→ vehicles.status) and up to 10 photos (media-progress-photos, owner type
 * `service_report`). Written only by domain/field/service.ts (POST/PATCH /api/v1/service-reports,
 * corrections, sync item `service_report.upsert`).
 */
export const ServiceReports: CollectionConfig = withAudit(
  {
    slug: 'service-reports',
    labels: { singular: 'Laporan servis unit', plural: 'Laporan servis unit' },
    admin: {
      group: 'Proyek',
      useAsTitle: 'docNo',
      defaultColumns: ['docNo', 'reportDate', 'project', 'unit', 'serviceType', 'unitStatusAfter', 'reporter', 'photoCount'],
      listSearchableFields: ['docNo'],
      description: 'Dibuat dari aplikasi Android atau API laporan lapangan (bukan dari form ini).',
    },
    defaultSort: '-id',
    access: { read: fieldReportRead, create: denyAll, update: denyAll, delete: denyAll },
    hooks: { beforeChange: [companyHook('service-reports', { derive: [{ field: 'project', collection: 'projects' }], check: [{ field: 'unit', collection: 'vehicles' }] })] },
    fields: [
      companyField({ derived: true }),
      { name: 'docNo', type: 'text', label: 'No. laporan', index: true, unique: true, admin: ro },
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', required: true, index: true, admin: ro },
      { name: 'unit', type: 'relationship', relationTo: 'vehicles', label: 'Unit', required: true, index: true, admin: ro },
      businessDateField('reportDate', 'Tanggal', { required: true, index: true, admin: ro }),
      { name: 'reporter', type: 'relationship', relationTo: 'users', label: 'Mekanik (pelapor)', required: true, index: true, admin: ro },
      { name: 'helpers', type: 'text', label: 'Helper', maxLength: 200, admin: ro },
      { name: 'startTime', type: 'text', label: 'Jam mulai', maxLength: 5, admin: ro },
      { name: 'endTime', type: 'text', label: 'Jam selesai', maxLength: 5, admin: ro },
      { name: 'hourMeter', type: 'number', label: 'HM saat servis', admin: ro },
      { name: 'serviceType', type: 'select', label: 'Jenis servis', required: true, index: true, options: SERVICE_TYPES.map((v) => ({ label: SERVICE_TYPE_LABELS[v], value: v })), admin: ro },
      { name: 'complaint', type: 'textarea', label: 'Keluhan', maxLength: 2000, admin: ro },
      { name: 'action', type: 'textarea', label: 'Tindakan / pekerjaan', required: true, maxLength: 4000, admin: ro },
      { name: 'unitStatusAfter', type: 'select', label: 'Status unit setelah servis', required: true, index: true, options: UNIT_STATUSES.map((v) => ({ label: UNIT_STATUS_LABELS[v], value: v })), admin: ro },
      { name: 'spareparts', type: 'json', label: 'Sparepart (tanpa stok)', admin: jsonView },
      { name: 'notes', type: 'textarea', label: 'Catatan', maxLength: 2000, admin: ro },
      ...fieldSystemFields(),
    ],
  },
  { docType: 'service_report', docNo: (doc) => (typeof doc.docNo === 'string' ? doc.docNo : undefined), exclude: FIELD_AUDIT_EXCLUDE },
)
