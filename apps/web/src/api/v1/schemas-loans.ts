import { z } from 'zod'

import { companyFilterParam, createCompanyField } from './schemas'

import { LOAN_ACTIONS, LOAN_G1_EXCEPTIONS, LOAN_KINDS, LOAN_ORIGINS, LOAN_STATUSES, MAX_LOAN_AMOUNT, NOTE_MAX } from '@/domain/loans/rules'

/**
 * /api/v1 contract for ADR 0022 Pinjaman antar project: web + APK (PM creates / submits, Direktur decides from the
 * inbox). Amounts are integer Rupiah; dates are PT business dates `YYYY-MM-DD`. Pure module (bundled by
 * scripts/gen-openapi.mjs).
 */
const id = z.number().int().positive()
const rupiah = z.number().int()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD.')
const reason = z.string({ error: 'Alasan wajib diisi.' }).trim().min(3, 'Alasan wajib diisi, minimal 3 karakter.').max(1000, 'Alasan maksimal 1000 karakter.')
const amount = z.number({ error: 'Nilai wajib diisi.' }).int('Nilai harus bilangan bulat Rupiah.').positive('Nilai harus lebih dari 0.').max(MAX_LOAN_AMOUNT)

export const LoanCreate = z
  .object({
    company: createCompanyField,
    borrowerProjectId: id.meta({ description: 'Project peminjam — the caller must be its PM (projects.pm, pk-pm).' }),
    lenderProjectId: id.meta({ description: 'Project pemberi pinjaman — same PT, ≠ borrower.' }),
    kind: z.enum(LOAN_KINDS).optional().meta({ description: 'dana (default) | barang (value in Rp; the cost stays on the lender RAP).' }),
    amount: amount.meta({ description: 'Nilai pinjaman (Rp, > 0).' }),
    reason: reason.meta({ description: 'Alasan (wajib).' }),
    loanDate: date.optional().meta({ description: 'Tanggal pinjaman (default today, PT TZ; not in the future).' }),
    dueDate: date.meta({ description: 'Jatuh tempo (required, ≥ loanDate).' }),
    submit: z.boolean().optional().meta({ description: 'true = ajukan langsung (tanpa tinggal di Draft).' }),
  })
  .strict()
  .meta({ id: 'ProjectLoanCreate' })

export const LoanUpdate = z
  .object({
    lenderProjectId: id.optional(),
    kind: z.enum(LOAN_KINDS).optional(),
    amount: amount.optional(),
    reason: reason.optional(),
    loanDate: date.optional(),
    dueDate: date.optional(),
  })
  .strict()
  .meta({ id: 'ProjectLoanUpdate' })

export const LoanReason = z.object({ reason }).strict().meta({ id: 'ProjectLoanReason' })

export const LoanDecision = z
  .object({ signatureMediaId: id.nullable().optional().meta({ description: 'Optional captured signature (media-signatures of the caller); else the profile signature, if any.' }) })
  .strict()
  .meta({ id: 'ProjectLoanDecision' })

export const LoanReject = z.object({ reason, signatureMediaId: id.nullable().optional() }).strict().meta({ id: 'ProjectLoanReject' })

export const RepaymentCreate = z
  .object({
    amount: amount.meta({ description: 'Nominal pengembalian (Rp, > 0, ≤ sisa pinjaman).' }),
    repayDate: date.optional().meta({ description: 'Default today (PT TZ); between the loan date and today.' }),
    note: z.string().trim().max(NOTE_MAX).nullable().optional(),
    confirmOverdraft: z.boolean().optional().meta({ description: 'ADR 0031 (cash-backed loan): confirm that the borrower\'s account goes below 0 (else 409 CASH_OVERDRAFT_CONFIRM_REQUIRED); audited.' }),
  })
  .strict()
  .meta({ id: 'ProjectLoanRepaymentCreate' })

export const LoanDisburse = z
  .object({
    disburseDate: date.optional().meta({ description: 'Default today (PT TZ); between the loan date and today — date of the KK / KM.' }),
    note: z.string().trim().max(NOTE_MAX).nullable().optional(),
    proofMediaId: id.nullable().optional().meta({ description: 'Optional proof (media-attachments, an unclaimed upload of the caller) — stored on the KK.' }),
    confirmOverdraft: z.boolean().optional().meta({ description: 'Confirm that the lender\'s account goes below 0 (else 409 CASH_OVERDRAFT_CONFIRM_REQUIRED); audited.' }),
  })
  .strict()
  .meta({ id: 'ProjectLoanDisburse', description: 'ADR 0031 "Cairkan" (Finance): KK on the lender\'s Pusat Biaya + KM on the borrower\'s, for the loan amount, once.' })

export const LoanListQuery = z
  .object({
    project: z.coerce.number().int().positive().optional().meta({ description: 'Loans of this project (as lender or borrower, see `role`).' }),
    role: z.enum(['borrower', 'lender']).optional(),
    status: z.enum(LOAN_STATUSES).optional(),
    overdue: z.enum(['1', 'true']).optional().meta({ description: 'Only "Terlambat" loans (due date before today, outstanding > 0).' }),
    q: z.string().trim().max(100).optional().meta({ description: 'Search in number and reason (D8).' }),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    summary: z.enum(['1', 'true']).optional().meta({ description: 'User 2026-10-19 (APK Pinjaman list): add `summary` (the web list\'s tiles) to the response.' }),
    company: companyFilterParam,
  })
  .meta({ id: 'ProjectLoanListQuery' })

const projectRef = z.object({ id, code: z.string().nullable(), name: z.string().nullable(), pm: z.object({ id, name: z.string().nullable() }).nullable() })
const accountRef = z.object({ id, name: z.string().nullable() })
const userRef = z.object({ id, name: z.string().nullable() })

export const LoanSummary = z
  .object({
    id,
    uuid: z.string().nullable(),
    companyId: id.nullable(),
    docNo: z.string().nullable().meta({ description: 'PJ/{COMPANY}/{YY}{MM}/#### (issued at submit).' }),
    status: z.enum(LOAN_STATUSES),
    statusLabel: z.string(),
    overdue: z.boolean().meta({ description: 'Derived "Terlambat": due date before today, outstanding > 0, approved / partially repaid.' }),
    overdueLabel: z.string().nullable(),
    daysOverdue: z.number().int(),
    kind: z.enum(LOAN_KINDS),
    kindLabel: z.string(),
    origin: z.enum(LOAN_ORIGINS).meta({ description: 'ADR 0031: manual = PM → Direktur; transfer = automatic (Finance paid a project request from another account).' }),
    originLabel: z.string(),
    lenderProject: projectRef.nullable().meta({ description: 'Null for an automatic loan — its lender is `lenderCashAccount`.' }),
    borrowerProject: projectRef,
    lenderCashAccount: accountRef.nullable().meta({ description: 'ADR 0031: Pusat Biaya of the lender (frozen at the approval / the transfer).' }),
    borrowerCashAccount: accountRef.nullable().meta({ description: 'ADR 0031: Pusat Biaya of the borrower project.' }),
    cashBacked: z.boolean().meta({ description: 'ADR 0031: money between two different accounts — disbursement and repayments post KK / KM.' }),
    disbursedAt: z.string().nullable(),
    disbursedBy: z.object({ id, name: z.string().nullable() }).nullable(),
    awaitingDisbursement: z.boolean().meta({ description: 'Approved, cash-backed, not yet disbursed by Finance ("Disetujui – menunggu pencairan").' }),
    transfer: z.object({ id, docNo: z.string().nullable() }).nullable().meta({ description: 'ADR 0031: the transfer of an automatic loan.' }),
    amount: rupiah,
    repaidTotal: rupiah,
    outstanding: rupiah.meta({ description: 'amount − posted repayments (Draft / Menunggu: the requested amount; Ditolak / Dibatalkan: 0).' }),
    reason: z.string(),
    loanDate: z.string(),
    dueDate: z.string(),
    samePm: z.boolean(),
    samePmNote: z.string().nullable().meta({ description: '"PM peminjam = PM pemberi" when one PM leads both projects.' }),
    g1Exception: z.enum(LOAN_G1_EXCEPTIONS).nullable(),
    createdBy: userRef,
    submittedAt: z.string().nullable(),
    decidedAt: z.string().nullable(),
    decidedBy: userRef.nullable(),
    rejectReason: z.string().nullable(),
    cancelReason: z.string().nullable(),
    source: z.enum(['web', 'apk']).nullable(),
    createdAt: z.string().nullable(),
  })
  .meta({ id: 'ProjectLoanSummary' })

export const LoanDetail = LoanSummary.extend({
  allowedActions: z.array(z.enum(LOAN_ACTIONS)).meta({ description: 'edit/submit: creator PM (Draft); cancel: creator (Draft/Menunggu) or Direktur (Disetujui, no repayment, not disbursed, not automatic); approve/reject: Direktur pool (G1); disburse: Finance (approved cash-backed loan, once); repay: borrower PM / Finance — Finance only after the disbursement for a cash-backed loan.' }),
  disbursement: z.object({ kk: z.string().nullable(), km: z.string().nullable() }).nullable().meta({ description: 'ADR 0031: entry numbers of the disbursement KK (lender) / KM (borrower); null when no cash moved.' }),
  mayVoidRepayment: z.boolean(),
  today: date.meta({ description: 'Business date of the loan\'s PT (max date of a repayment).' }),
  g1Note: z.string().nullable(),
  repayments: z.array(
    z.object({
      id,
      seq: z.number().int().nullable().meta({ description: '"Pengembalian ke-n" among the posted repayments (null when void).' }),
      repayDate: z.string(),
      amount: rupiah,
      note: z.string().nullable(),
      status: z.enum(['posted', 'void']),
      statusLabel: z.string(),
      voidReason: z.string().nullable(),
      recordedBy: z.object({ id: id.nullable(), name: z.string().nullable() }),
      voidedBy: userRef.nullable(),
      voidedAt: z.string().nullable(),
      createdAt: z.string().nullable(),
      cash: z.object({ kk: z.string().nullable(), km: z.string().nullable() }).nullable().meta({ description: 'ADR 0031: entry numbers of the repayment KK (borrower) / KM (lender); null for a claim or a voided repayment.' }),
    }),
  ),
  decisions: z.array(z.object({ id, actor: z.object({ id: id.nullable(), name: z.string().nullable() }), decision: z.enum(['approved', 'rejected']), reason: z.string().nullable(), decidedAt: z.string().nullable(), signatureSource: z.string().nullable() })),
}).meta({ id: 'ProjectLoanDetail' })

export const LoanList = z
  .object({
    items: z.array(LoanSummary),
    page: z.number().int(),
    totalPages: z.number().int(),
    totalDocs: z.number().int(),
    limit: z.number().int(),
    summary: z
      .object({
        totals: z.object({ pending: z.number().int(), amount: rupiah, repaid: rupiah, outstanding: rupiah, overdueCount: z.number().int(), overdue: rupiah }),
        inboxCount: z.number().int().meta({ description: 'Loans waiting for the caller\'s decision (Direktur).' }),
        canCreate: z.boolean().meta({ description: 'The caller is PM of a borrower project ("Ajukan pinjaman").' }),
      })
      .optional()
      .meta({ description: 'Only with `summary=1`: the web list tiles (whole loan scope of the caller, not the filters).' }),
  })
  .meta({ id: 'ProjectLoanList' })

export const LoanInbox = z.object({ items: z.array(LoanSummary) }).meta({ id: 'ProjectLoanInbox' })

const option = z.object({ id, code: z.string(), name: z.string(), companyId: id })
export const LoanOptions = z
  .object({ borrowers: z.array(option).meta({ description: 'Projects whose PM is the caller (pk-pm).' }), lenders: z.array(option).meta({ description: 'Open projects of the same PT(s).' }) })
  .meta({ id: 'ProjectLoanOptions' })
