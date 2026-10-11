import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { anyOf, byRole, ownUser, teamProjects } from '@/access/policies'
import { withAudit } from '@/audit/hooks'
import { LOAN_KIND_LABELS, LOAN_KINDS, LOAN_STATUS_LABELS, LOAN_STATUSES } from '@/domain/loans/rules'
import { rupiahField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'
import { USER_NAME_VIEW } from '@/fields/users'

import { businessDateField, ro } from './fields-f2'

/**
 * ADR 0022 Pinjaman antar project (`PJ/{COMPANY}/{YY}{MM}/{seq}`, DRMS 10/10 point 15, owner D6 + Q-L1…Q-L7):
 * a recorded, Direktur-approved claim of the lender project on the borrower project of the SAME PT. Notional
 * allocation (ADR 0022 §5 option B) — no cash entry is ever written for a loan or its repayments.
 * Written ONLY by the domain service (`domain/loans/service.ts`, /api/v1/project-loans) — HTTP create/update/delete
 * are closed. Read: Direktur / Admin / Finance of the PT, PM of the borrower or lender project (team scope) and the
 * creator; Staff / Operator never (money figures, owner 2026-10-10).
 * DB guards (migration 20261013_100100_d1010_project_loans_guard): same PT for both projects, lender ≠ borrower,
 * transitions whitelisted, content frozen after Draft, repaid ≤ amount, no DELETE/TRUNCATE.
 */
export const ProjectLoans: CollectionConfig = withAudit(
  {
    slug: 'project-loans',
    labels: { singular: 'Pinjaman antar project', plural: 'Pinjaman antar project' },
    admin: {
      group: 'Keuangan',
      useAsTitle: 'docNo',
      defaultColumns: ['docNo', 'lenderProject', 'borrowerProject', 'amount', 'outstanding', 'status', 'dueDate'],
      listSearchableFields: ['docNo'],
      description: 'Diajukan dan diputuskan lewat layar Pinjaman antar project (bukan dari form ini).',
    },
    defaultSort: '-id',
    access: {
      read: byRole({
        'pk-admin': true,
        'pk-owner': true,
        'pk-finance': true,
        'pk-pm': anyOf(teamProjects('borrowerProject'), teamProjects('lenderProject'), ownUser('createdBy')),
      }),
      create: denyAll,
      update: denyAll,
      delete: denyAll,
    },
    hooks: {
      beforeChange: [
        companyHook('project-loans', {
          derive: [
            { field: 'borrowerProject', collection: 'projects' },
            { field: 'lenderProject', collection: 'projects' },
          ],
        }),
      ],
    },
    fields: [
      companyField({ derived: true }),
      { name: 'docNo', type: 'text', label: 'No. pinjaman', index: true, admin: ro },
      { name: 'lenderProject', type: 'relationship', relationTo: 'projects', label: 'Project pemberi pinjaman', required: true, index: true, admin: ro },
      { name: 'borrowerProject', type: 'relationship', relationTo: 'projects', label: 'Project peminjam', required: true, index: true, admin: ro },
      {
        name: 'kind',
        type: 'select',
        label: 'Jenis',
        required: true,
        defaultValue: 'dana',
        options: LOAN_KINDS.map((k) => ({ label: LOAN_KIND_LABELS[k], value: k })),
        admin: ro,
      },
      { ...rupiahField('amount', 'Nilai pinjaman (Rp)', { required: true }), admin: ro },
      { name: 'reason', type: 'textarea', label: 'Alasan', required: true, maxLength: 1000, admin: ro },
      businessDateField('loanDate', 'Tanggal pinjaman', { required: true, admin: ro }),
      businessDateField('dueDate', 'Jatuh tempo', { required: true, admin: ro }),
      {
        name: 'status',
        type: 'select',
        label: 'Status',
        required: true,
        defaultValue: 'draft',
        index: true,
        options: LOAN_STATUSES.map((s) => ({ label: LOAN_STATUS_LABELS[s], value: s })),
        admin: ro,
      },
      { ...rupiahField('repaidTotal', 'Sudah kembali (Rp)'), defaultValue: 0, admin: ro },
      { ...rupiahField('outstanding', 'Sisa pinjaman (Rp)'), admin: ro },
      // ADR 0022 §3: borrower PM = lender PM (frozen at submit) — "PM peminjam = PM pemberi" on the detail
      { name: 'samePm', type: 'checkbox', label: 'PM peminjam = PM pemberi', defaultValue: false, admin: ro },
      { name: 'createdBy', type: 'relationship', relationTo: 'users', label: 'Diajukan oleh', required: true, index: true, admin: { ...ro, components: USER_NAME_VIEW } },
      { name: 'submittedAt', type: 'date', label: 'Diajukan', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'decidedAt', type: 'date', label: 'Diputuskan', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'decidedBy', type: 'relationship', relationTo: 'users', label: 'Diputuskan oleh', admin: { ...ro, components: USER_NAME_VIEW } },
      { name: 'rejectReason', type: 'text', label: 'Alasan ditolak', admin: ro },
      { name: 'cancelReason', type: 'text', label: 'Alasan batal', admin: ro },
      { name: 'approvalCycle', type: 'number', label: 'Siklus', defaultValue: 0, admin: { ...ro, hidden: true } },
      // ADR 0022 §4 (Q-L5): 'direktur_self' when the creator PM is the PT's only Direktur (set at submit only, DB CHECK)
      { name: 'g1Exception', type: 'text', label: 'Pengecualian G1', admin: { ...ro, hidden: true } },
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
    docType: 'project_loan',
    // docNo: `number_issued` row written by allocateDocNo(); cycle / timestamps are workflow internals
    exclude: ['docNo', 'approvalCycle', 'submittedAt', 'decidedAt'],
    docNo: (doc) => (typeof doc.docNo === 'string' ? doc.docNo : undefined),
    actionFor: (c) => (c.field === 'status' ? 'status_change' : undefined),
  },
)
