import { z } from 'zod'

import { companyFilterParam } from './schemas'

import { IC_LOAN_ACTIONS, IC_LOAN_STATUSES, IC_MOVEMENT_KINDS, MAX_IC_LOAN_AMOUNT, REASON_MAX, REASON_MIN } from '@/domain/intercompany/loan-rules'

/**
 * /api/v1 contract for ADR 0029 "Pinjaman antar-PT" (`PJA/{LENDER}/{YY}{MM}/{seq}`) and the fund availability of a PT
 * — web + APK (Owner: lender list + instruction; Finance of the lender: disbursement queue + execution). Amounts are
 * integer Rupiah; dates are PT business dates `YYYY-MM-DD`. Pure module (bundled by scripts/gen-openapi.mjs).
 */
const id = z.number().int().positive()
const rupiah = z.number().int()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD.')
const reason = z
  .string({ error: 'Alasan wajib diisi.' })
  .trim()
  .min(REASON_MIN, `Alasan wajib diisi, minimal ${REASON_MIN} karakter.`)
  .max(REASON_MAX, `Alasan maksimal ${REASON_MAX} karakter.`)
const amount = z.number({ error: 'Nilai wajib diisi.' }).int('Nilai harus bilangan bulat Rupiah.').positive('Nilai harus lebih dari 0.').max(MAX_IC_LOAN_AMOUNT, 'Nilai maksimal Rp 1 triliun.')
const transferAt = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/, 'YYYY-MM-DDTHH:MM')
  .optional()
  .meta({ description: 'Date + time of the bank proof (ISO 8601 with offset, or wall clock in the PAYING PT zone). Not in the future; its date is the movement date (period lock of both PTs).' })
const companyRef = z.object({ id, shortCode: z.string(), name: z.string() })
const userRef = z.object({ id, name: z.string().nullable() })
/** `icLoanDestination` (loan-rules.ts): one shape for the queue item and the loan detail. */
const destination = z.object({ bankName: z.string().nullable(), accountNoMasked: z.string().nullable(), accountHolder: z.string() }).nullable()

export const IcLoanCreate = z
  .object({
    borrowerCompanyId: id.meta({ description: 'PT peminjam (the short PT) — the caller must be Owner (pk-principal) there.' }),
    lenderCompanyId: id.meta({ description: 'PT pemberi — another active PT where the caller is Owner (GET /intercompany-loans/lenders).' }),
    amount: amount.meta({ description: 'Nilai (Rp > 0, ≤ the lender\'s "Dana tersedia" — else 409 LOAN_LENDER_INSUFFICIENT). Default in the form: the gap of the linked request(s).' }),
    dueDate: date.nullable().optional().meta({ description: 'Jatuh tempo (required in the form, ≥ today; omitted = today + 30 days, owner 2026-10-14).' }),
    reason: reason.meta({ description: 'Alasan (3–1000).' }),
    requestIds: z.array(id).max(50).optional().meta({ description: 'Requests of the BORROWER PT this loan is for (informational; not cancelled / rejected).' }),
  })
  .strict()
  .meta({ id: 'IntercompanyLoanCreate' })

export const IcLoanReason = z.object({ reason }).strict().meta({ id: 'IntercompanyLoanReason' })

const movementBase = {
  cashAccountId: id.meta({ description: 'Source account of the PAYING PT: active, WITHOUT a site (the pool of the fund check).' }),
  bankRef: z.string().trim().min(1).max(64),
  proofMediaId: id.meta({ description: 'media-transfer-proofs id (POST /media/transfer-proofs), an unclaimed upload of the caller.' }),
  transferAt,
  transferDate: date.optional().meta({ description: 'Date only (time unknown); with transferAt it must be its date.' }),
  confirmOverdraft: z.boolean().optional().meta({ description: 'QA-04: confirm that the source account goes below 0 (else 409 CASH_OVERDRAFT_CONFIRM_REQUIRED); audited overdraft_confirmed.' }),
}

export const IcLoanDisburse = z.object(movementBase).strict().meta({ id: 'IntercompanyLoanDisburse', description: 'Amount = the loan amount (one disbursement); destination = the borrower\'s designated receiving account.' })

export const IcLoanRepay = z
  .object({ ...movementBase, amount: amount.meta({ description: 'Nominal pengembalian (Rp > 0, ≤ outstanding — else 409 LOAN_REPAYMENT_EXCEEDS_OUTSTANDING; ≤ the borrower\'s "Dana tersedia" — else 409 FUND_INSUFFICIENT).' }) })
  .strict()
  .meta({ id: 'IntercompanyLoanRepay', description: 'Destination = the lender\'s designated receiving account (none → 409 INTERCOMPANY_NO_ACCOUNT).' })

export const IcLoanVoidDisbursement = z
  .object({
    reason,
    confirmBorrowerShortfall: z.boolean().optional().meta({ description: 'Required when the borrower\'s "Dana tersedia" would go below 0 after the reversal (else 409 LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED {borrowerCompanyId, available, after, amount}); audited.' }),
  })
  .strict()
  .meta({ id: 'IntercompanyLoanVoidDisbursement' })

export const IcLoanListQuery = z
  .object({
    summary: z.enum(['1', 'true']).optional().meta({ description: 'User 2026-10-19 (APK Pinjaman antar-PT list): add `summary` (the web list\'s tiles) to the response.' }),
    company: companyFilterParam,
    role: z.enum(['lender', 'borrower']).optional().meta({ description: 'Only loans where a PT of the filter / selection is the lender (piutang) or the borrower (hutang).' }),
    status: z.string().regex(/^[a-z_]+(,[a-z_]+)*$/).optional().meta({ description: `Comma separated: ${IC_LOAN_STATUSES.join(', ')}.` }),
    overdue: z.enum(['1', 'true']).optional().meta({ description: 'Only "Terlambat" loans (due date before today, outstanding > 0).' }),
    q: z.string().trim().max(100).optional().meta({ description: 'Search in number, reason, PT codes.' }),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .meta({ id: 'IntercompanyLoanListQuery' })

export const IcLenderQuery = z
  .object({
    borrower: z.coerce.number().int().positive().meta({ description: 'PT peminjam (the caller must be Owner there).' }),
    amount: z.coerce.number().int().positive().max(MAX_IC_LOAN_AMOUNT).optional().meta({ description: 'Needed amount — `sufficient` compares with it (omitted: available > 0).' }),
  })
  .meta({ id: 'IntercompanyLenderQuery' })

export const IcLoanSummary = z
  .object({
    id,
    uuid: z.string(),
    docNo: z.string().meta({ description: 'PJA/{LENDER}/{YY}{MM}/#### (issued at the instruction, lender PT\'s counter).' }),
    status: z.enum(IC_LOAN_STATUSES),
    statusLabel: z.string().meta({ description: 'Menunggu pencairan | Dicairkan | Sebagian dikembalikan | Lunas | Dibatalkan.' }),
    overdue: z.boolean(),
    overdueLabel: z.string().nullable(),
    daysOverdue: z.number().int(),
    lender: companyRef.nullable(),
    borrower: companyRef.nullable(),
    amount: rupiah,
    repaidTotal: rupiah,
    outstanding: rupiah.meta({ description: 'amount − posted repayments once disbursed; 0 while instructed / cancelled.' }),
    instructionDate: z.string(),
    dueDate: z.string(),
    reason: z.string(),
    createdBy: userRef,
    createdAt: z.string().nullable(),
    side: z.enum(['lender', 'borrower', 'both']).meta({ description: 'The caller\'s side: lender (piutang antar-PT), borrower (hutang antar-PT), both.' }),
  })
  .meta({ id: 'IntercompanyLoanSummary' })

export const IcLoanList = z
  .object({
    items: z.array(IcLoanSummary),
    page: z.number().int(),
    totalPages: z.number().int(),
    totalDocs: z.number().int(),
    limit: z.number().int(),
    summary: z
      .object({
        receivable: rupiah,
        payable: rupiah,
        overdue: rupiah,
        queueCount: z.number().int().meta({ description: 'Instructed loans waiting for disbursement by the caller\'s (lender) Finance PTs.' }),
        canInstruct: z.boolean().meta({ description: 'Owner (stored pk-principal) in more than one PT.' }),
      })
      .optional()
      .meta({ description: 'Only with `summary=1`: the web list tiles (Σ over the caller\'s report scope, not the filters).' }),
  })
  .meta({ id: 'IntercompanyLoanList' })

export const IcLoanQueue = z
  .object({
    count: z.number().int().meta({ description: 'Badge: instructed loans waiting for disbursement by the caller\'s (lender) Finance PTs.' }),
    items: z.array(
      IcLoanSummary.extend({
        canDisburse: z.boolean().meta({ description: 'false for the instruction\'s creator (G1).' }),
        g1Note: z.string().nullable(),
        destination: destination.meta({ description: 'The borrower\'s designated receiving account (masked); null = none designated (the disbursement answers 409 INTERCOMPANY_NO_ACCOUNT).' }),
      }),
    ),
  })
  .meta({ id: 'IntercompanyLoanQueue' })

export const IcLoanDetail = IcLoanSummary.extend({
  lenderToday: date.meta({ description: 'Business date of the lender PT (disbursement date max).' }),
  borrowerToday: date.meta({ description: 'Business date of the borrower PT (repayment date max).' }),
  snapshot: z.record(z.string(), z.unknown()).nullable().meta({ description: 'Evidence at the instruction: borrowerAvailable, borrowerGap, lenderAvailable (+ balances / commitments).' }),
  cancelReason: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelledBy: userRef.nullable(),
  ownRequest: z.boolean().meta({ description: 'G1 note: the loan is for the Owner\'s own request (the disbursement by Finance is the independent second person).' }),
  ownRequestNote: z.string().nullable(),
  droppedRequestNote: z.string().nullable().meta({ description: 'A linked request was cancelled / rejected while the loan waits ("batalkan perintah bila tidak diperlukan").' }),
  lenderHasReceivingAccount: z.boolean().meta({ description: 'Repayments need the lender\'s designated receiving account.' }),
  destination: destination.meta({
    description:
      'The borrower\'s designated receiving account (masked) — the queue item\'s `destination`, for its readers: Finance of the LENDER while the loan is instructed. null for everyone else, after the disbursement (the movement\'s toAccount shows the account paid) or when none is designated (the disbursement answers 409 INTERCOMPANY_NO_ACCOUNT). Absent on older servers (clients then fall back to the queue).',
  }),
  requests: z.array(
    z.object({
      id,
      docNo: z.string().nullable(),
      title: z.string().nullable().meta({ description: 'Borrower-side readers only.' }),
      status: z.string().nullable(),
      statusLabel: z.string().nullable(),
      grandTotal: rupiah.nullable(),
    }),
  ),
  movements: z.array(
    z.object({
      id,
      kind: z.enum(IC_MOVEMENT_KINDS),
      label: z.string().meta({ description: '"Pencairan" | "Pengembalian ke-n".' }),
      seq: z.number().int().nullable(),
      amount: rupiah,
      transferDate: z.string(),
      transferAt: z.string().nullable(),
      bankRef: z.string().nullable().meta({ description: 'Paying-side readers only.' }),
      status: z.enum(['posted', 'void']),
      voidReason: z.string().nullable(),
      fromCompanyId: id,
      toCompanyId: id,
      fromAccount: z.object({ id, name: z.string().nullable() }).nullable(),
      toAccount: z.object({ name: z.string().nullable(), accountNoMasked: z.string().nullable() }),
      kk: z.object({ id: id.nullable(), entryNo: z.string().nullable() }).nullable().meta({ description: 'KK of the paying PT (id only for its Kas roles).' }),
      km: z.object({ id: id.nullable(), entryNo: z.string().nullable() }).nullable().meta({ description: 'Automatic KM of the receiving PT (id only for its Kas roles).' }),
      proofId: id.nullable(),
      executedBy: userRef,
      voidedBy: userRef.nullable(),
      voidedAt: z.string().nullable(),
      createdAt: z.string().nullable(),
    }),
  ),
  allowedActions: z.array(z.enum(IC_LOAN_ACTIONS)).meta({ description: 'cancel: Owner (instructed); disburse: Finance of the lender, not the creator (G1); void_disbursement: Finance of the lender (no repayment); repay / void_repayment: Finance of the borrower.' }),
  disburseBlockedByG1: z.boolean(),
}).meta({ id: 'IntercompanyLoanDetail' })

const fundOf = z.object({ company: companyRef.nullable(), balance: rupiah, commitments: rupiah, available: rupiah })

export const IcLenderOptions = z
  .object({
    borrower: fundOf.extend({
      fundCheckEnabled: z.boolean(),
      hasReceivingAccount: z.boolean().meta({ description: 'false → the instruction is refused (400 INTERCOMPANY_NO_ACCOUNT).' }),
      waiting: z.array(z.object({ id, docNo: z.string().nullable(), title: z.string(), needed: rupiah, gap: rupiah })).meta({ description: 'Requests of the borrower PT waiting at their final decision (the "Hitung untuk semua pengajuan yang menunggu" list).' }),
      gapAll: rupiah.meta({ description: 'Σ needed − available of every waiting request (≥ 0).' }),
    }),
    defaultDueDate: z.string().meta({ description: 'Today (borrower PT) + 30 days.' }),
    lenders: z.array(
      fundOf.extend({
        sufficient: z.boolean().meta({ description: 'available ≥ amount — short PTs are shown disabled ("Dana tersedia Rp X").' }),
        hasReceivingAccount: z.boolean(),
        warning: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'IntercompanyLenderOptions' })

export const FundAvailabilityQuery = z.object({ company: z.coerce.number().int().positive().meta({ description: 'The PT (Finance / Direktur / Owner of it, within the selection).' }) }).meta({ id: 'FundAvailabilityQuery' })

export const FundAvailability = z
  .object({
    companyId: id,
    company: companyRef.nullable(),
    enabled: z.boolean().meta({ description: 'companies.fundCheckEnabled.' }),
    balance: rupiah,
    commitments: rupiah,
    available: rupiah,
    accounts: z.array(z.object({ id, name: z.string(), balance: rupiah })).meta({ description: 'The accounts behind "Saldo dana" (active, without a site).' }),
    excludedSiteAccounts: z.object({ count: z.number().int(), balance: rupiah }),
    commitmentItems: z.array(z.object({ kind: z.enum(['request', 'shortfall', 'loan']), id, docNo: z.string().nullable(), amount: rupiah, status: z.string() })),
  })
  .meta({ id: 'FundAvailability' })
