import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { assignedProjects, byRole, teamProjects } from '@/access/policies'
import { LINE_KIND_LABELS, LINE_KINDS, LINE_ORIGINS } from '@/domain/rap/rules'
import { companyField, companyHook } from '@/fields/company'

import { ro } from './fields-f2'

/**
 * P3 ledger of the daily reports (append-only — no UPDATE/DELETE for anyone, DB trigger p3_security):
 * one row per change of a RAP item quantity. A report's value of an item = Σ of its rows; an edit within
 * 24 h or a PM/Direktur correction APPENDS the difference (origin `edit` / `correction`, with reason). An
 * AFTER INSERT trigger keeps rap_items.realised_qty / received_qty / used_qty in step. Not audited row by
 * row (the ledger IS the history; the report/correction is audited).
 */
export const DailyReportLines: CollectionConfig = {
  slug: 'daily-report-lines',
  labels: { singular: 'Baris laporan harian', plural: 'Baris laporan harian' },
  admin: { group: 'Proyek', defaultColumns: ['report', 'rapItem', 'kind', 'qty', 'origin', 'createdAt'], hidden: true },
  defaultSort: 'id',
  access: {
    read: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-finance': true, 'pk-pm': teamProjects('project'), 'pk-staff': assignedProjects('project') }),
    create: denyAll,
    update: denyAll,
    delete: denyAll,
  },
  hooks: { beforeChange: [companyHook('daily-report-lines', { derive: [{ field: 'report', collection: 'daily-reports' }], check: [{ field: 'rapItem', collection: 'rap-items' }] })] },
  fields: [
    companyField({ derived: true }),
    { name: 'report', type: 'relationship', relationTo: 'daily-reports', label: 'Laporan', required: true, index: true, admin: ro },
    { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', required: true, index: true, admin: ro },
    { name: 'reportDate', type: 'text', label: 'Tanggal laporan', required: true, index: true, admin: ro },
    { name: 'rapItem', type: 'relationship', relationTo: 'rap-items', label: 'Item RAP', required: true, index: true, admin: ro },
    { name: 'kind', type: 'select', label: 'Jenis', required: true, options: LINE_KINDS.map((v) => ({ label: LINE_KIND_LABELS[v], value: v })), admin: ro },
    { name: 'qty', type: 'number', label: 'Jumlah (selisih)', required: true, admin: ro },
    { name: 'origin', type: 'select', label: 'Asal', required: true, options: LINE_ORIGINS.map((v) => ({ label: v, value: v })), admin: ro },
    { name: 'reason', type: 'text', label: 'Alasan', maxLength: 500, admin: ro },
    { name: 'createdBy', type: 'relationship', relationTo: 'users', label: 'Oleh', required: true, admin: ro },
  ],
}
