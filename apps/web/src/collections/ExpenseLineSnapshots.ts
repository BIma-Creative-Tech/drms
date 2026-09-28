import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { byVisibleRequest, denyDeleteLogged } from '@/domain/expense/access'
import { companyField, companyHook } from '@/fields/company'

const ro = { readOnly: true }
const jsonView = { readOnly: true, components: { Field: '@/components/ReadOnlyJson#ReadOnlyJson' } }

/**
 * Frozen copy of an expense request's content (lines, requesters, bank snapshot, grand total) at
 * submit / approval / receipt revision (ADR 0006 §2, architecture ERD `expense_line_snapshots`).
 * CLASS A: flat, append-only, `taken_at` forced to the DB clock. Service writes only.
 */
export const ExpenseLineSnapshots: CollectionConfig = {
  slug: 'expense-line-snapshots',
  labels: { singular: 'Snapshot pengajuan', plural: 'Snapshot pengajuan' },
  admin: { group: 'Keuangan', defaultColumns: ['request', 'reason', 'cycle', 'grandTotal', 'takenAt'] },
  access: { read: byVisibleRequest('request'), create: denyAll, update: denyAll, delete: denyDeleteLogged('expense_line_snapshot') },
  lockDocuments: false,
  hooks: { beforeChange: [companyHook('expense-line-snapshots', { derive: [{ field: 'request', collection: 'expense-requests' }] })] },
  fields: [
    companyField({ derived: true }),
    { name: 'request', type: 'relationship', relationTo: 'expense-requests', required: true, index: true, admin: ro },
    { name: 'cycle', type: 'number', required: true, admin: ro },
    { name: 'reason', type: 'select', required: true, options: ['submit', 'approve', 'receipts_resubmit'].map((v) => ({ label: v, value: v })), admin: ro },
    { name: 'grandTotal', type: 'number', required: true, admin: ro },
    { name: 'contentHash', type: 'text', admin: ro },
    { name: 'data', type: 'json', required: true, admin: jsonView },
    { name: 'takenAt', type: 'date', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
  ],
}
