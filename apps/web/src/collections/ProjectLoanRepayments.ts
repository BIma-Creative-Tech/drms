import type { Access, CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { inIds } from '@/access/scope'
import { withAudit } from '@/audit/hooks'
import { visibleLoanIds } from '@/domain/loans/access'
import { REPAYMENT_STATUS_LABELS, REPAYMENT_STATUSES } from '@/domain/loans/rules'
import { rupiahField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'
import { USER_NAME_VIEW } from '@/fields/users'

import { businessDateField, ro } from './fields-f2'

/** Rows of the loans the caller may read (same scope as `project-loans`). */
const readAccess: Access = async ({ req }) => {
  if (!req.user) return false
  return inIds('loan', await visibleLoanIds(req))
}

/**
 * ADR 0022 §7: repayments of an inter-project loan ("Pengembalian ke-n", no own number). Recorded by the borrower PM
 * or Finance without Direktur approval; APPEND-ONLY like cash entries — a wrong entry is voided with a reason
 * (Direktur / Finance), never edited or deleted. No cash entry is written (notional allocation, §5).
 * DB guards: amount > 0, same PT as the loan, only status / void columns change (posted → void once), no DELETE.
 * 2026-10-24 (DRMS 24/10 #12): a repayment of a CASH-BACKED loan is a request — inserted `pending_approval` (planned
 * date), decided Direktur → Owner (`approvals` docType project_loan_repayment), then a transfer order Finance executes
 * (`posted` = executed: KK borrower + KM lender, `executedAt` / `executedBy`); rejected / cancelled with a reason. Claims
 * are still recorded `posted` at once. Existing rows are executed repayments (`posted`).
 */
export const ProjectLoanRepayments: CollectionConfig = withAudit(
  {
    slug: 'project-loan-repayments',
    labels: { singular: 'Pengembalian pinjaman', plural: 'Pengembalian pinjaman' },
    admin: {
      group: 'Keuangan',
      defaultColumns: ['loan', 'repayDate', 'amount', 'status', 'recordedBy'],
      description: 'Dicatat dan dibatalkan (void) lewat layar Pinjaman antar project.',
    },
    defaultSort: '-id',
    access: { read: readAccess, create: denyAll, update: denyAll, delete: denyAll },
    hooks: { beforeChange: [companyHook('project-loan-repayments', { derive: [{ field: 'loan', collection: 'project-loans' }] })] },
    fields: [
      companyField({ derived: true }),
      { name: 'loan', type: 'relationship', relationTo: 'project-loans', label: 'Pinjaman', required: true, index: true, admin: ro },
      businessDateField('repayDate', 'Tanggal pengembalian', { required: true, admin: ro }),
      { ...rupiahField('amount', 'Nominal (Rp)', { required: true }), admin: ro },
      { name: 'note', type: 'text', label: 'Catatan', maxLength: 500, admin: ro },
      {
        name: 'status',
        type: 'select',
        label: 'Status',
        required: true,
        defaultValue: 'posted',
        index: true,
        options: REPAYMENT_STATUSES.map((s) => ({ label: REPAYMENT_STATUS_LABELS[s], value: s })),
        admin: ro,
      },
      // 2026-10-24 (#12): the request part (cash-backed loans) — planned date, level waiting, decision / cancel reasons, execution
      businessDateField('plannedDate', 'Rencana tanggal', { admin: ro }),
      { name: 'approvalLevel', type: 'number', label: 'Level persetujuan', defaultValue: 0, admin: { ...ro, hidden: true } },
      { name: 'submittedAt', type: 'date', label: 'Diajukan', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'decidedAt', type: 'date', label: 'Diputuskan', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'decidedBy', type: 'relationship', relationTo: 'users', label: 'Diputuskan oleh', admin: { ...ro, components: USER_NAME_VIEW } },
      { name: 'rejectReason', type: 'text', label: 'Alasan ditolak', admin: ro },
      { name: 'cancelReason', type: 'text', label: 'Alasan batal', admin: ro },
      { name: 'executedAt', type: 'date', label: 'Ditransfer', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'executedBy', type: 'relationship', relationTo: 'users', label: 'Ditransfer oleh', admin: { ...ro, components: USER_NAME_VIEW } },
      { name: 'voidReason', type: 'text', label: 'Alasan void', admin: ro },
      { name: 'recordedBy', type: 'relationship', relationTo: 'users', label: 'Dicatat oleh', required: true, admin: { ...ro, components: USER_NAME_VIEW } },
      { name: 'voidedBy', type: 'relationship', relationTo: 'users', label: 'Di-void oleh', admin: { ...ro, components: USER_NAME_VIEW } },
      { name: 'voidedAt', type: 'date', label: 'Waktu void', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      {
        name: 'source',
        type: 'select',
        label: 'Sumber',
        options: ['web', 'apk'].map((s) => ({ label: s, value: s })),
        admin: { ...ro, position: 'sidebar' },
      },
    ],
  },
  {
    docType: 'project_loan_repayment',
    exclude: ['submittedAt', 'decidedAt', 'executedAt', 'approvalLevel'],
    // a status change is a void only when it becomes `void`; the request steps are ordinary status changes (#12)
    actionFor: (c, operation) => (operation === 'update' && c.field === 'status' ? (c.newValue === 'void' ? 'void' : 'status_change') : undefined),
  },
)
