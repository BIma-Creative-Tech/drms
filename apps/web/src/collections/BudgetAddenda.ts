import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { anyOf, byRole, ownUser, teamProjects } from '@/access/policies'
import { withAudit } from '@/audit/hooks'
import { ADDENDUM_STATUS_LABELS, ADDENDUM_STATUSES } from '@/domain/addendum/rules'
import { rupiahField, uuidField } from '@/fields/common'

import { ro } from './fields-f2'

/** Read-only JSON without Monaco (CSP, config-guards.test.ts). */
const jsonView = { readOnly: true, components: { Field: '@/components/ReadOnlyJson#ReadOnlyJson' } }

/**
 * T12 Addendum RAB (`ADD/YYMM/####`, US-18/US-30, requirements §4 "Addendum RAB": Staff —, PM C team,
 * Finance R, Direktur A, Admin —; architecture §5.4). Written ONLY by the domain service
 * (`domain/addendum/service.ts`, /api/v1/budget-addenda) — HTTP create/update/delete are closed.
 * Approval through the ADR 0013 engine (`approval-rules` docType `budget_addendum`, snapshotted at
 * submit); decisions are `approvals` rows (docType `budget_addendum`). On the final approval the
 * project RAB (`projects.budget`) is increased in the SAME transaction (audit before → after).
 * DB guards (migration e5_budget_addenda): no DELETE/TRUNCATE, content frozen after Draft, status
 * transitions whitelisted, approved ⇒ newBudget = oldBudget + addition, terminal rows immutable.
 */
export const BudgetAddenda: CollectionConfig = withAudit(
  {
    slug: 'budget-addenda',
    labels: { singular: 'Addendum RAB', plural: 'Addendum RAB' },
    admin: {
      group: 'Proyek',
      useAsTitle: 'docNo',
      defaultColumns: ['docNo', 'project', 'addition', 'status', 'createdBy', 'submittedAt'],
      listSearchableFields: ['docNo'],
      description: 'Diajukan dan diputuskan lewat layar Addendum RAB (bukan dari form ini).',
    },
    defaultSort: '-id',
    access: {
      read: byRole({
        'pk-owner': true,
        'pk-finance': true,
        'pk-pm': anyOf(teamProjects('project'), ownUser('createdBy')),
      }),
      create: denyAll,
      update: denyAll,
      delete: denyAll,
    },
    fields: [
      { name: 'docNo', type: 'text', label: 'No. addendum', unique: true, index: true, admin: ro },
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', required: true, index: true, admin: ro },
      {
        name: 'status',
        type: 'select',
        label: 'Status',
        required: true,
        defaultValue: 'draft',
        index: true,
        options: ADDENDUM_STATUSES.map((s) => ({ label: ADDENDUM_STATUS_LABELS[s], value: s })),
        admin: ro,
      },
      { ...rupiahField('addition', 'Tambahan (Rp)', { required: true }), admin: ro },
      { name: 'reason', type: 'textarea', label: 'Alasan', required: true, maxLength: 1000, admin: ro },
      { ...rupiahField('budgetAtSubmit', 'RAB saat diajukan (Rp)'), admin: ro },
      { ...rupiahField('oldBudget', 'RAB lama (Rp)'), admin: { ...ro, description: 'Dibaca ulang saat disetujui (terkunci).' } },
      { ...rupiahField('newBudget', 'RAB baru (Rp)'), admin: ro },
      { name: 'createdBy', type: 'relationship', relationTo: 'users', label: 'Diajukan oleh', required: true, index: true, admin: ro },
      { name: 'submittedAt', type: 'date', label: 'Diajukan', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'decidedAt', type: 'date', label: 'Diputuskan', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'approvalRule', type: 'relationship', relationTo: 'approval-rules', label: 'Aturan approval', admin: ro },
      { name: 'approvalSnapshot', type: 'json', label: 'Snapshot aturan', admin: jsonView },
      { name: 'approvalCycle', type: 'number', label: 'Siklus', defaultValue: 0, admin: { ...ro, hidden: true } },
      { name: 'currentLevel', type: 'number', label: 'Level berjalan', admin: { ...ro, hidden: true } },
      { name: 'rejectReason', type: 'text', label: 'Alasan ditolak', admin: ro },
      { name: 'cancelReason', type: 'text', label: 'Alasan batal', admin: ro },
      {
        name: 'source',
        type: 'select',
        label: 'Sumber',
        options: ['web', 'apk'].map((s) => ({ label: s, value: s })),
        admin: { ...ro, position: 'sidebar' },
      },
      uuidField(),
    ],
  },
  {
    docType: 'budget_addendum',
    // docNo: `number_issued` row written by allocateDocNo(); snapshot/level/cycle are workflow internals.
    exclude: ['docNo', 'approvalSnapshot', 'currentLevel', 'approvalCycle', 'submittedAt', 'decidedAt'],
    docNo: (doc) => (typeof doc.docNo === 'string' ? doc.docNo : undefined),
    actionFor: (c) => (c.field === 'status' ? 'status_change' : undefined),
  },
)
