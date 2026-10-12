import type { Access, CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { inIds } from '@/access/scope'
import { withAudit } from '@/audit/hooks'
import { visibleLoanIds } from '@/domain/loans/access'
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
        options: [
          { label: 'Tercatat', value: 'posted' },
          { label: 'Dibatalkan (void)', value: 'void' },
        ],
        admin: ro,
      },
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
    actionFor: (c, operation) => (operation === 'update' && c.field === 'status' ? 'void' : undefined),
  },
)
