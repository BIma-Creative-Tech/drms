import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { anyOf, byRole, ownUser, teamProjects } from '@/access/policies'
import { withAudit } from '@/audit/hooks'
import { businessDateField, ro } from './fields-f2'
import { uuidField } from '@/fields/common'

/** Read-only JSON without Monaco (CSP, config-guards.test.ts). */
const jsonView = { readOnly: true, components: { Field: '@/components/ReadOnlyJson#ReadOnlyJson' } }

/**
 * T11 Laporan progress (`LP/YYMM/####`, US-10/US-31, requirements §4: PM C/R team, Direktur C/R all,
 * Finance R, Staff/Admin —). Written ONLY by the domain service (`domain/progress/reports.ts`:
 * POST/PATCH /api/v1/progress-reports and sync item `progress_report.draft_upsert`) — HTTP
 * create/update/delete on the collection are closed. The service sets the stage % (before → after)
 * and recalculates the project progress in the same transaction (G11).
 * DB guards (migration e4_progress_reports): no DELETE/TRUNCATE for the app role, identity columns
 * immutable, `received_at` = DB clock, `editable_until` = received_at + 24 h and no UPDATE after it.
 * Photos (≤ 5) are `media-progress-photos` rows owned by the report (ownerDocType `progress_report`).
 */
export const ProgressReports: CollectionConfig = withAudit(
  {
    slug: 'progress-reports',
    labels: { singular: 'Laporan progress', plural: 'Laporan progress' },
    admin: {
      group: 'Proyek',
      useAsTitle: 'docNo',
      defaultColumns: ['docNo', 'reportDate', 'project', 'stage', 'pctBefore', 'pctAfter', 'reporter', 'photoCount', 'offline'],
      listSearchableFields: ['docNo'],
      description: 'Laporan dibuat dari aplikasi Android atau layar laporan progress (bukan dari form ini).',
    },
    defaultSort: '-id',
    access: {
      read: byRole({
        'pk-owner': true,
        'pk-finance': true,
        'pk-pm': anyOf(teamProjects('project'), ownUser('reporter')),
      }),
      create: denyAll,
      update: denyAll,
      delete: denyAll,
    },
    fields: [
      { name: 'docNo', type: 'text', label: 'No. laporan', unique: true, index: true, admin: ro },
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', required: true, index: true, admin: ro },
      { name: 'stage', type: 'relationship', relationTo: 'project-stages', label: 'Tahapan', required: true, index: true, admin: ro },
      businessDateField('reportDate', 'Tanggal laporan', { required: true, index: true, admin: ro }),
      { name: 'pctBefore', type: 'number', label: '% tahapan sebelum', required: true, admin: ro },
      { name: 'pctAfter', type: 'number', label: '% tahapan sesudah', required: true, admin: ro },
      { name: 'projectPctBefore', type: 'number', label: '% project sebelum', admin: ro },
      { name: 'projectPctAfter', type: 'number', label: '% project sesudah', admin: ro },
      { name: 'work', type: 'textarea', label: 'Pekerjaan', required: true, maxLength: 2000, admin: ro },
      { name: 'issues', type: 'textarea', label: 'Kendala', maxLength: 2000, admin: ro },
      { name: 'reporter', type: 'relationship', relationTo: 'users', label: 'Pelapor', required: true, index: true, admin: ro },
      { name: 'photoCount', type: 'number', label: 'Jumlah foto', defaultValue: 0, admin: ro },
      { name: 'receivedAt', type: 'date', label: 'Diterima server', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'editableUntil', type: 'date', label: 'Bisa diedit sampai', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'deviceTime', type: 'date', label: 'Jam HP', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      {
        name: 'timeTrust',
        type: 'select',
        label: 'Sumber jam',
        options: [
          { label: 'Server (online)', value: 'server' },
          { label: 'Perkiraan server', value: 'estimated' },
          { label: 'Jam HP saja', value: 'device_only' },
        ],
        admin: ro,
      },
      { name: 'offline', type: 'checkbox', label: 'Offline', defaultValue: false, index: true, admin: ro },
      {
        name: 'source',
        type: 'select',
        label: 'Sumber',
        options: ['web', 'apk'].map((s) => ({ label: s, value: s })),
        admin: ro,
      },
      { name: 'flags', type: 'json', label: 'Tanda', admin: jsonView },
      { name: 'syncRev', type: 'number', label: 'Revisi', defaultValue: 1, admin: { ...ro, hidden: true } },
      { name: 'clientUuid', type: 'text', label: 'ID offline', unique: true, index: true, admin: { ...ro, hidden: true } },
      uuidField(),
    ],
  },
  { docType: 'progress_report', docNo: (doc) => (typeof doc.docNo === 'string' ? doc.docNo : undefined), exclude: ['syncRev', 'receivedAt', 'editableUntil'] },
)
