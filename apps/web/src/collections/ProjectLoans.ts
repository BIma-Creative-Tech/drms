import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { anyOf, byRole, ownUser, teamProjects } from '@/access/policies'
import { withAudit } from '@/audit/hooks'
import { LOAN_KIND_LABELS, LOAN_KINDS, LOAN_ORIGIN_LABELS, LOAN_ORIGINS, LOAN_STATUS_LABELS, LOAN_STATUSES, LOAN_SUBMITTER_LABELS, LOAN_SUBMITTER_ROLES } from '@/domain/loans/rules'
import { rupiahField, uuidField } from '@/fields/common'
import { companyField, companyHook } from '@/fields/company'
import { USER_NAME_VIEW } from '@/fields/users'

import { businessDateField, ro } from './fields-f2'

/**
 * ADR 0022 Pinjaman antar project (`PJ/{COMPANY}/{YY}{MM}/{seq}`, DRMS 10/10 point 15, owner D6 + Q-L1…Q-L7):
 * a recorded, Direktur-approved claim of the lender project on the borrower project of the SAME PT.
 * ADR 0031 (DRMS 21/10, amends ADR 0022 §5): a loan of MONEY between two different Pusat Biaya (cash accounts) moves
 * cash — Finance "Cairkan" posts KK on the lender account + KM on the borrower account, repayments the mirror pair
 * (`cash_entries.project_loan_id`). A loan of goods, or between projects of the same account, stays a claim. A second
 * origin `transfer`: Finance paid a project request from another account → automatic, approved loan whose lender is
 * that ACCOUNT (no lender project), cash legs posted with the transfer.
 * Written ONLY by the domain service (`domain/loans/service.ts`, /api/v1/project-loans) — HTTP create/update/delete
 * are closed. Read: Direktur / Admin / Finance of the PT, PM of the borrower or lender project (team scope) and the
 * creator; Staff / Operator never (money figures, owner 2026-10-10).
 * DB guards (migration 20261013_100100_d1010_project_loans_guard): same PT for both projects, lender ≠ borrower,
 * transitions whitelisted, content frozen after Draft, repaid ≤ amount, no DELETE/TRUNCATE.
 * 2026-10-24 (DRMS 24/10 #10–#11, migrations 20261024_4x0000_d2410_*): filed by the borrower PM or Finance
 * (`submitterRole`), decided Direktur (level 1) → Owner (level 2, `approvalLevel` = the level waiting); a cash-backed
 * loan (money between two known accounts, also ONE shared account) is then a transfer order in "Antrian Transfer".
 * 2026-10-26 (DRMS 26/10 #1, migrations 20261026_1x0000_d2610_*): `submitterRole` `owner` + `expenseRequest` — the loan the
 * final decider of an expense request instructed to the request project's short cash account ("Instruksi pinjam antar
 * proyek"): born approved (no Direktur / Owner level), then the same transfer order; the request waits until Finance
 * executed it.
 */
export const ProjectLoans: CollectionConfig = withAudit(
  {
    slug: 'project-loans',
    labels: { singular: 'Pinjaman antar project', plural: 'Pinjaman antar project' },
    admin: {
      group: 'Keuangan',
      useAsTitle: 'docNo',
      defaultColumns: ['docNo', 'origin', 'lenderProject', 'lenderCashAccount', 'borrowerProject', 'amount', 'outstanding', 'status', 'dueDate'],
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
          check: [
            { field: 'lenderCashAccount', collection: 'cash-accounts' },
            { field: 'borrowerCashAccount', collection: 'cash-accounts' },
            { field: 'transfer', collection: 'transfers' },
            { field: 'expenseRequest', collection: 'expense-requests' },
          ],
        }),
      ],
    },
    fields: [
      companyField({ derived: true }),
      { name: 'docNo', type: 'text', label: 'No. pinjaman', index: true, admin: ro },
      // ADR 0031: `manual` = PM → Direktur (ADR 0022); `transfer` = automatic when Finance pays from another account
      { name: 'origin', type: 'select', label: 'Asal', required: true, defaultValue: 'manual', index: true, options: LOAN_ORIGINS.map((o) => ({ label: LOAN_ORIGIN_LABELS[o], value: o })), admin: ro },
      // manual loans only (DB CHECK project_loans_origin_shape); an automatic loan's lender is an account
      { name: 'lenderProject', type: 'relationship', relationTo: 'projects', label: 'Project pemberi pinjaman', index: true, admin: ro },
      { name: 'borrowerProject', type: 'relationship', relationTo: 'projects', label: 'Project peminjam', required: true, index: true, admin: ro },
      // ADR 0031: Pusat Biaya (cash account) of each side — frozen at approval (manual) / at the transfer (automatic)
      { name: 'lenderCashAccount', type: 'relationship', relationTo: 'cash-accounts', label: 'Akun kas pemberi', index: true, admin: ro },
      { name: 'borrowerCashAccount', type: 'relationship', relationTo: 'cash-accounts', label: 'Akun kas peminjam', index: true, admin: ro },
      // true = money between two different accounts: disbursement and repayments post KK / KM (ADR 0031)
      { name: 'cashBacked', type: 'checkbox', label: 'Menggerakkan kas', defaultValue: false, admin: ro },
      { name: 'transfer', type: 'relationship', relationTo: 'transfers', label: 'Transfer pengajuan', index: true, admin: { ...ro, condition: (d) => d?.origin === 'transfer' } },
      // 2026-10-26: the expense request an Owner-instructed loan covers (immutable; DB guard pk_project_loans_guard)
      { name: 'expenseRequest', type: 'relationship', relationTo: 'expense-requests', label: 'Pengajuan yang ditutup', index: true, admin: { ...ro, condition: (d) => d?.submitterRole === 'owner' } },
      { name: 'disbursedAt', type: 'date', label: 'Dicairkan', admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'disbursedBy', type: 'relationship', relationTo: 'users', label: 'Dicairkan oleh', admin: { ...ro, components: USER_NAME_VIEW } },
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
      // 2026-10-24 (#10): level waiting for its decision while pending — 1 Direktur, 2 Owner (0 before submit / after)
      { name: 'approvalLevel', type: 'number', label: 'Level persetujuan', defaultValue: 0, admin: { ...ro, hidden: true } },
      // 2026-10-24 (#10): the creator filed as borrower PM or as Finance of the PT (frozen at create; DB checks the role)
      {
        name: 'submitterRole',
        type: 'select',
        label: 'Diajukan sebagai',
        options: LOAN_SUBMITTER_ROLES.map((r) => ({ label: LOAN_SUBMITTER_LABELS[r], value: r })),
        admin: ro,
      },
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
    exclude: ['docNo', 'approvalCycle', 'submittedAt', 'decidedAt', 'disbursedAt'],
    docNo: (doc) => (typeof doc.docNo === 'string' ? doc.docNo : undefined),
    actionFor: (c) => (c.field === 'status' ? 'status_change' : undefined),
  },
)
