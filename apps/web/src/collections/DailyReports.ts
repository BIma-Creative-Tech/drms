import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { withAudit } from '@/audit/hooks'
import { WEATHER, WEATHER_LABELS } from '@/domain/daily/rules'
import { companyField, companyHook } from '@/fields/company'

import { FIELD_AUDIT_EXCLUDE, fieldReportRead, fieldSystemFields, jsonView } from './field-common'
import { businessDateField, ro } from './fields-f2'
import { USER_NAME_VIEW } from '@/fields/users'

const weather = (name: string, label: string) =>
  ({ name, type: 'select' as const, label, options: WEATHER.map((v) => ({ label: WEATHER_LABELS[v], value: v })), admin: ro })

/**
 * P3 Laporan Harian (`LH/YYMM/####`, konstruksi; owner decisions 2026-10-09/10): one report per project,
 * reporter and date (Staff assigned / PM team / Direktur). Sections: A pekerjaan + B material are LEDGER
 * lines (`daily-report-lines`, append-only, they move the RAP realisation and the stage %), C tenaga
 * kerja and D alat (JSON rows, resource-types), E cuaca, F kendala/catatan + ≤ 10 photos
 * (media-progress-photos, owner type `daily_report`). Written only by domain/daily/* (REST, corrections,
 * sync item `daily_report.upsert`); 24 h edit window and identity guards in the DB (p3_security).
 */
export const DailyReports: CollectionConfig = withAudit(
  {
    slug: 'daily-reports',
    labels: { singular: 'Laporan harian', plural: 'Laporan harian' },
    admin: {
      group: 'Proyek',
      useAsTitle: 'docNo',
      defaultColumns: ['docNo', 'reportDate', 'project', 'reporter', 'workerCount', 'photoCount'],
      listSearchableFields: ['docNo'],
      description: 'Dibuat dari aplikasi Android atau layar Laporan Harian (bukan dari form ini).',
    },
    defaultSort: '-id',
    access: { read: fieldReportRead, create: denyAll, update: denyAll, delete: denyAll },
    hooks: { beforeChange: [companyHook('daily-reports', { derive: [{ field: 'project', collection: 'projects' }] })] },
    fields: [
      companyField({ derived: true }),
      { name: 'docNo', type: 'text', label: 'No. laporan', index: true, unique: true, admin: ro },
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', required: true, index: true, admin: ro },
      businessDateField('reportDate', 'Tanggal', { required: true, index: true, admin: ro }),
      { name: 'reporter', type: 'relationship', relationTo: 'users', label: 'Pelapor', required: true, index: true, admin: { ...ro, components: USER_NAME_VIEW } },
      weather('weatherMorning', 'Cuaca pagi'),
      weather('weatherNoon', 'Cuaca siang'),
      weather('weatherAfternoon', 'Cuaca sore'),
      { name: 'rainHours', type: 'number', label: 'Jam hujan', min: 0, max: 24, admin: ro },
      { name: 'stopHours', type: 'number', label: 'Jam berhenti kerja', min: 0, max: 24, admin: ro },
      { name: 'manpower', type: 'json', label: 'Tenaga kerja', admin: jsonView },
      { name: 'equipment', type: 'json', label: 'Alat', admin: jsonView },
      { name: 'workerCount', type: 'number', label: 'Jumlah tenaga', defaultValue: 0, admin: ro },
      { name: 'issues', type: 'textarea', label: 'Kendala', maxLength: 2000, admin: ro },
      { name: 'notes', type: 'textarea', label: 'Catatan', maxLength: 2000, admin: ro },
      ...fieldSystemFields(),
    ],
  },
  { docType: 'daily_report', docNo: (doc) => (typeof doc.docNo === 'string' ? doc.docNo : undefined), exclude: FIELD_AUDIT_EXCLUDE },
)
