import { z } from 'zod'

import { companyFilterParam, createCompanyField } from './schemas'

import { LOAN_ACTIONS, LOAN_G1_EXCEPTIONS, LOAN_KINDS, LOAN_ORIGINS, LOAN_STATUSES, LOAN_SUBMITTER_ROLES, MAX_LOAN_AMOUNT, NOTE_MAX, REPAYMENT_ACTIONS, REPAYMENT_STATUSES } from '@/domain/loans/rules'

/**
 * /api/v1 contract for ADR 0022 Pinjaman antar project: web + APK (PM creates / submits, Direktur decides from the
 * inbox). Amounts are integer Rupiah; dates are PT business dates `YYYY-MM-DD`. Pure module (bundled by
 * scripts/gen-openapi.mjs).
 * 2026-10-24 (DRMS 24/10 #10–#12): PM or Finance files; Direktur (level 1) → Owner (level 2); a cash-backed loan and
 * each repayment request of it become transfer orders (`GET /project-loans/transfer-orders`) Finance executes.
 */
const id = z.number().int().positive()
const rupiah = z.number().int()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD.')
const reason = z.string({ error: 'Alasan wajib diisi.' }).trim().min(3, 'Alasan wajib diisi, minimal 3 karakter.').max(1000, 'Alasan maksimal 1000 karakter.')
const amount = z.number({ error: 'Nilai wajib diisi.' }).int('Nilai harus bilangan bulat Rupiah.').positive('Nilai harus lebih dari 0.').max(MAX_LOAN_AMOUNT)

export const LoanCreate = z
  .object({
    company: createCompanyField,
    borrowerProjectId: id.meta({ description: 'Project peminjam — the caller must be its PM (projects.pm, pk-pm) or Finance (pk-finance) of its PT (2026-10-24).' }),
    lenderProjectId: id.meta({ description: 'Project pemberi pinjaman — same PT, ≠ borrower (open project).' }),
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
    amount: amount.meta({ description: 'Nominal pengembalian (Rp, > 0, ≤ sisa pinjaman; cash-backed: ≤ `repayableAmount`, the part not yet requested).' }),
    repayDate: date.optional().meta({ description: 'Default today (PT TZ). Claim: between the loan date and today. Cash-backed loan (2026-10-24 #12): the PLANNED date of the request (≥ loan date, may be in the future).' }),
    note: z.string().trim().max(NOTE_MAX).nullable().optional(),
    confirmOverdraft: z.boolean().optional().meta({ description: 'Ignored since 2026-10-24 (a cash-backed repayment is a request; the overdraft is confirmed at its execution). Kept for older APKs.' }),
  })
  .strict()
  .meta({ id: 'ProjectLoanRepaymentCreate' })

export const LoanExecute = z
  .object({
    executeDate: date.optional().meta({ description: 'Date of the bank transfer = date of the KK / KM (default today, PT TZ; between the loan date and today).' }),
    note: z.string().trim().max(NOTE_MAX).nullable().optional(),
    proofMediaId: id.nullable().optional().meta({ description: 'Optional transfer proof (media-attachments, an unclaimed upload of the caller) — stored on the KK.' }),
    confirmOverdraft: z.boolean().optional().meta({ description: 'Confirm that the paying account goes below 0 (else 409 CASH_OVERDRAFT_CONFIRM_REQUIRED); audited.' }),
  })
  .strict()
  .meta({ id: 'ProjectLoanExecute', description: '2026-10-24 (#11/#12): Finance executes a transfer order of "Antrian Transfer" — loan: KK lender account (lender project) + KM borrower account (borrower project); repayment: KK borrower + KM lender. One transaction.' })

export const LoanDisburse = z
  .object({
    disburseDate: date.optional().meta({ description: 'Default today (PT TZ); between the loan date and today — date of the KK / KM.' }),
    note: z.string().trim().max(NOTE_MAX).nullable().optional(),
    proofMediaId: id.nullable().optional().meta({ description: 'Optional proof (media-attachments, an unclaimed upload of the caller) — stored on the KK.' }),
    confirmOverdraft: z.boolean().optional().meta({ description: 'Confirm that the lender\'s account goes below 0 (else 409 CASH_OVERDRAFT_CONFIRM_REQUIRED); audited.' }),
  })
  .strict()
  .meta({ id: 'ProjectLoanDisburse', description: 'ADR 0031 "Cairkan" (Finance, kept for older APKs): the same execution as POST /project-loans/{id}/execute — KK on the lender\'s Pusat Biaya + KM on the borrower\'s, for the loan amount, once.' })

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

const decisionRow = z.object({
  id,
  level: z.union([z.literal(1), z.literal(2)]),
  levelLabel: z.string().meta({ description: 'Direktur | Owner' }),
  actor: z.object({ id: id.nullable(), name: z.string().nullable() }),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().nullable(),
  decidedAt: z.string().nullable(),
  signatureSource: z.string().nullable(),
})
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
    statusLabel: z.string().meta({ description: '2026-10-24: "Menunggu persetujuan Direktur" / "Menunggu persetujuan Owner" per level; "Disetujui – menunggu transfer Finance" while the transfer order waits.' }),
    approvalLevel: z.union([z.literal(1), z.literal(2)]).nullable().meta({ description: '2026-10-24 (#10): level a pending loan waits at — 1 Direktur, 2 Owner; null otherwise.' }),
    overdue: z.boolean().meta({ description: 'Derived "Terlambat": due date before today, outstanding > 0, approved / partially repaid.' }),
    overdueLabel: z.string().nullable(),
    daysOverdue: z.number().int(),
    kind: z.enum(LOAN_KINDS),
    kindLabel: z.string(),
    origin: z.enum(LOAN_ORIGINS).meta({ description: 'ADR 0031: manual = PM / Finance → Direktur → Owner; transfer = automatic (Finance paid a project request from another account).' }),
    originLabel: z.string().meta({ description: '"Diajukan PM" / "Diajukan Finance" / "Otomatis dari transfer".' }),
    submitterRole: z.enum(LOAN_SUBMITTER_ROLES).nullable().meta({ description: '2026-10-24 (#10): the creator filed as borrower PM or as Finance (null for an automatic loan; legacy loans = pm).' }),
    lenderProject: projectRef.nullable().meta({ description: 'Null for an automatic loan — its lender is `lenderCashAccount`.' }),
    borrowerProject: projectRef,
    lenderCashAccount: accountRef.nullable().meta({ description: 'ADR 0031: Pusat Biaya of the lender (frozen at the approval / the transfer).' }),
    borrowerCashAccount: accountRef.nullable().meta({ description: 'ADR 0031: Pusat Biaya of the borrower project.' }),
    cashBacked: z.boolean().meta({ description: 'ADR 0031: money between two known accounts (2026-10-24: also one shared account) — the transfer orders post KK / KM.' }),
    disbursedAt: z.string().nullable(),
    disbursedBy: z.object({ id, name: z.string().nullable() }).nullable(),
    awaitingDisbursement: z.boolean().meta({ description: 'Approved, cash-backed, transfer order not executed yet ("Disetujui – menunggu transfer Finance").' }),
    transferQueueHref: z.string().nullable().meta({ description: '2026-10-24 (#11): web "Antrian Transfer" anchor of the loan\'s transfer order while it waits.' }),
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
  allowedActions: z.array(z.enum(LOAN_ACTIONS)).meta({ description: 'edit/submit: creator (borrower PM / Finance, Draft); cancel: creator (Draft/Menunggu) or Direktur (Disetujui, no repayment, not transferred, not automatic); approve/reject: the pool of the CURRENT level (1 Direktur, 2 Owner; G1); disburse: Finance — execute the transfer order (web: in Antrian Transfer); repay: borrower PM / Finance — cash-backed: a repayment REQUEST after the transfer while `repayableAmount` > 0.' }),
  disbursement: z.object({ kk: z.string().nullable(), km: z.string().nullable() }).nullable().meta({ description: 'ADR 0031: entry numbers of the disbursement KK (lender) / KM (borrower); null when no cash moved.' }),
  mayVoidRepayment: z.boolean(),
  repaymentNeedsApproval: z.boolean().meta({ description: '2026-10-24 (#12): cash-backed — a repayment is a request (Direktur → Owner → transfer order); else recorded at once.' }),
  repayableAmount: rupiah.meta({ description: 'Max of a new repayment: outstanding minus requests not executed yet.' }),
  today: date.meta({ description: 'Business date of the loan\'s PT (max date of a repayment).' }),
  g1Note: z.string().nullable(),
  repayments: z.array(
    z.object({
      id,
      seq: z.number().int().nullable().meta({ description: '"Pengembalian ke-n" among the posted repayments (null otherwise).' }),
      repayDate: z.string().meta({ description: 'Planned date while a request, the execution / record date once posted.' }),
      plannedDate: z.string().nullable(),
      amount: rupiah,
      note: z.string().nullable(),
      status: z.enum(REPAYMENT_STATUSES).meta({ description: 'posted = executed (cash-backed) / recorded (claim); pending_approval → approved → posted; rejected / cancelled / void final.' }),
      statusLabel: z.string(),
      approvalLevel: z.union([z.literal(1), z.literal(2)]).nullable(),
      voidReason: z.string().nullable(),
      rejectReason: z.string().nullable(),
      cancelReason: z.string().nullable(),
      recordedBy: z.object({ id: id.nullable(), name: z.string().nullable() }).meta({ description: 'Recorded / submitted by.' }),
      voidedBy: userRef.nullable(),
      voidedAt: z.string().nullable(),
      submittedAt: z.string().nullable(),
      executedAt: z.string().nullable(),
      executedBy: userRef.nullable(),
      createdAt: z.string().nullable(),
      cash: z.object({ kk: z.string().nullable(), km: z.string().nullable() }).nullable().meta({ description: 'ADR 0031: entry numbers of the repayment KK (borrower) / KM (lender); null for a claim, a request or a voided repayment.' }),
      allowedActions: z.array(z.enum(REPAYMENT_ACTIONS)).meta({ description: 'approve/reject: the pool of the current level (G1: never the submitter); cancel: submitter (pending) or Finance / submitter (approved); execute: Finance (approved, in Antrian Transfer); void: posted (Direktur / Finance; Finance only when cash moved).' }),
      transferQueueHref: z.string().nullable(),
      decisions: z.array(decisionRow),
    }),
  ),
  decisions: z.array(decisionRow),
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
        inboxCount: z.number().int().meta({ description: 'Loans waiting for the caller\'s decision (Direktur level 1 / Owner level 2).' }),
        canCreate: z.boolean().meta({ description: 'The caller is PM of a borrower project or Finance of a PT ("Ajukan pinjaman").' }),
      })
      .optional()
      .meta({ description: 'Only with `summary=1`: the web list tiles (whole loan scope of the caller, not the filters).' }),
  })
  .meta({ id: 'ProjectLoanList' })

const smallProject = z.object({ id, code: z.string().nullable(), name: z.string().nullable() })

export const RepaymentInboxItem = z
  .object({
    id: id.meta({ description: 'Repayment id (decided on the loan: POST /project-loans/{loanId}/repayments/{id}/approve | reject).' }),
    loanId: id,
    companyId: id.nullable(),
    loanDocNo: z.string().nullable(),
    lenderProject: projectRef.nullable(),
    borrowerProject: projectRef,
    lenderCashAccount: accountRef.nullable(),
    borrowerCashAccount: accountRef.nullable(),
    amount: rupiah,
    plannedDate: z.string(),
    note: z.string().nullable(),
    approvalLevel: z.union([z.literal(1), z.literal(2)]),
    statusLabel: z.string(),
    outstanding: rupiah,
    submittedBy: userRef.nullable(),
    submittedAt: z.string().nullable(),
  })
  .meta({ id: 'ProjectLoanRepaymentInboxItem' })

export const LoanInbox = z
  .object({
    items: z.array(LoanSummary),
    repayments: z.array(RepaymentInboxItem).meta({ description: '2026-10-24 (#12): repayment requests waiting for the caller\'s decision at their level (absent on older servers).' }),
  })
  .meta({ id: 'ProjectLoanInbox' })

export const LoanTransferOrders = z
  .object({
    items: z.array(
      z.object({
        kind: z.enum(['loan', 'repayment']).meta({ description: 'loan = "Pencairan pinjaman" (id = loan); repayment = "Pengembalian pinjaman" (id = repayment).' }),
        key: z.string(),
        id,
        loanId: id,
        companyId: id,
        docNo: z.string().nullable(),
        title: z.string(),
        amount: rupiah,
        date: z.string().meta({ description: 'Loan date / planned repayment date (sort key, ascending).' }),
        minDate: z.string().meta({ description: 'Earliest execution date (the loan date).' }),
        today: z.string().meta({ description: 'Business date of the PT (latest execution date).' }),
        dueDate: z.string(),
        fromAccount: accountRef.nullable().meta({ description: 'Account the money leaves (KK) — frozen at the approval.' }),
        toAccount: accountRef.nullable().meta({ description: 'Account the money arrives on (KM).' }),
        fromProject: smallProject.nullable(),
        toProject: smallProject.nullable(),
        note: z.string().nullable(),
        reason: z.string(),
        submittedBy: z.object({ id: id.nullable(), name: z.string().nullable() }),
        approvedAt: z.string().nullable(),
        selfSubmitted: z.boolean().meta({ description: 'The caller submitted it — a Finance user MAY execute his own order (no self-guard on loans; audited).' }),
        canExecute: z.boolean().meta({ description: 'Finance of the PT.' }),
        href: z.string(),
        anchor: z.string(),
      }),
    ),
    count: z.number().int(),
  })
  .meta({ id: 'ProjectLoanTransferOrders' })

const option = z.object({ id, code: z.string(), name: z.string(), companyId: id })
export const LoanOptions = z
  .object({
    borrowers: z.array(option).meta({ description: 'Projects whose PM is the caller (pk-pm) and — 2026-10-24 — every open project of a PT where the caller is Finance.' }),
    lenders: z.array(option).meta({ description: 'Open projects of the same PT(s).' }),
  })
  .meta({ id: 'ProjectLoanOptions' })
