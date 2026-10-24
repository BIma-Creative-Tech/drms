import { z } from 'zod'

import { companyFilterParam, createCompanyField } from './schemas'
import { ShortfallApproval } from './schemas-shortfall'

/**
 * /api/v1 contract for the F2a expense-request flow (T1–T4, T6–T8, period closing).
 * Money = integer Rupiah; business dates = 'YYYY-MM-DD' (company TZ); server timestamps ISO-8601 UTC.
 * Pure module (bundled by scripts/gen-openapi.mjs).
 */
const id = z.number().int().positive()
const rupiah = z.number().int().min(0).max(1e13)
const rupiahPos = z.number().int().min(1).max(1e13)
/** ADR 0029: a signed Rupiah figure (a balance / available funds may be negative). */
const signedRupiah = z.number().int()
const businessDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'YYYY-MM-DD')
// S3e (S-06): specific Indonesian messages (the web shows them as-is; before: generic "Data tidak valid.").
const reason = z
  .string({ error: 'Alasan wajib diisi.' })
  .trim()
  .min(3, 'Alasan wajib diisi, minimal 3 karakter.')
  .max(1000, 'Alasan maksimal 1000 karakter.')
const note = z
  .string({ error: 'Catatan wajib diisi.' })
  .trim()
  .min(3, 'Catatan wajib diisi, minimal 3 karakter.')
  .max(1000, 'Catatan maksimal 1000 karakter.')
const qty = z
  .number()
  .positive()
  .max(1e9)
  .refine((v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, 'maks. 3 desimal')

export const RequestTypeEnum = z.enum(['advance', 'reimburse']).meta({ id: 'RequestType', description: 'advance = Pengajuan Baru (label until 2026-10: Uang Muka), reimburse = Reimburse' })
export const PayeeTypeEnum = z
  .enum(['karyawan', 'vendor', 'pt_grup'])
  .meta({
    id: 'PayeeType',
    description:
      'ADR 0027 "Jenis penerima": karyawan = the requester\'s employee account (default, every request before ADR 0027); vendor = "Pembayaran vendor" (Staff / Finance / PM of the request PT; Staff since 2026-10-16): vendor + vendor account + invoice, type always advance, no LPJ (transfer → completed). ADR 0028: pt_grup = "Pembayaran antar-PT" (Finance / PM / Direktur of the paying PT): another PT of the group (payeeCompanyId) paid to its designated receiving account + the receiving PT\'s document (invoice / memo, required), type always advance, no LPJ; the transfer completes it AND posts a Kas Masuk in the receiving PT. Older apps that do not know a value show it as karyawan and must not send payeeType on such a draft (the server keeps the stored one).',
  })

export const RequestStatusEnum = z
  .enum([
    'draft',
    'pending_ack',
    'pending_approval',
    'approved',
    'receipt_revision',
    'receipts_verified',
    'transferred',
    'receipts_complete',
    'lpj_submitted',
    'lpj_revision',
    'lpj_verified',
    'completed',
    'rejected',
    'cancelled',
  ])
  .meta({ id: 'RequestStatus' })

export const ActionEnum = z
  .enum([
    'edit',
    'submit',
    'withdraw',
    'cancel',
    'acknowledge',
    'approve',
    'reject',
    'add_receipt',
    'receipt_verify',
    'receipt_reject',
    'receipts_resubmit',
    'verify_receipts',
    'review_flag',
    'transfer',
    'transfer_void',
    'complete',
    'resubmit',
    'receipts_complete',
    'lpj_submit',
    'lpj_request_revision',
    'lpj_verify',
    'settle',
    'settle_reverse',
    // ADR 0029: the Owner orders an inter-PT loan for a short request (POST /intercompany-loans)
    'instruct_loan',
    // D2410 "Hapus draft" (POST /expense-requests/{id}/delete-draft)
    'delete_draft',
  ])
  .meta({ id: 'RequestAction' })

export const LineInput = z
  .object({
    id: z.string().max(64).optional().meta({ description: 'Existing line id (keep to update a line in place; omit for new lines).' }),
    description: z.string().max(500).optional(),
    qty: qty.nullable().optional().meta({ description: 'Quantity (≤ 3 decimals); empty = 1. A unit (uomId) is required when qty is set.' }),
    uomId: id.nullable().optional(),
    unitPrice: rupiah.nullable().optional().meta({ description: 'D3 (DRMS 10/10): required to submit. The line total is computed by the server: total = qty × unitPrice (qty empty = 1), rounded to whole Rupiah.' }),
    total: rupiahPos.nullable().optional().meta({ description: 'READ-ONLY since D3: ignored when unitPrice is sent (the server computes qty × unitPrice). Compatibility for old clients that send only `total`: unitPrice = total ÷ qty when that is a whole Rupiah amount, else the line stays incomplete (cannot be submitted).' }),
    receiptAmount: rupiah.nullable().optional().meta({ description: 'D3 "Nominal sesuai nota" (optional). When set and ≠ total, the request carries the awareness flag `receipt_amount_mismatch` ("Selisih nota") for Finance; amounts stay based on total.' }),
    notes: z.string().max(500).nullable().optional(),
    categoryId: id.nullable().optional(),
    vehicleId: id.nullable().optional(),
    rapItemId: id.nullable().optional().meta({ description: 'D4 (DRMS 10/10): RAP item of the request project (GET /projects/{id}/rap items[].id). Required on every line to submit when the project has a RAP; a konstruksi project without RAP cannot submit. Omitted = the line (same id) keeps its stored item; null clears it.' }),
  })
  .strict()
  .meta({ id: 'ExpenseLineInput' })

const draftFields = {
  title: z.string().trim().min(1).max(200),
  projectId: id.nullable().optional().meta({ description: 'D2 (DRMS 10/10): required to submit (no non-project requests).' }),
  costCenterId: id.nullable().optional().meta({ description: 'D2: IGNORED since DRMS 10/10 for employee payments (Finance sets the cost center at the transfer; still accepted so older apps keep working). ADR 0027: a vendor payment (payeeType vendor) WITHOUT a project names its cost center here (active, of the request PT; project OR cost center required to submit).' }),
  neededDate: businessDate.nullable().optional(),
  urgencyLevelId: id.nullable().optional().meta({ description: 'urgency-levels id of the request PT ("Tingkat urgensi", owner decision 2026-10-09).' }),
  periodFrom: businessDate.nullable().optional().meta({ description: 'Ignored since 2026-10-09: "Periode kegiatan" was replaced by the urgency level. Still accepted so older apps keep working.' }),
  periodTo: businessDate.nullable().optional().meta({ description: 'Ignored since 2026-10-09: "Periode kegiatan" was replaced by the urgency level. Still accepted so older apps keep working.' }),
  notes: z.string().max(2000).nullable().optional(),
  requesterIds: z.array(id).max(20).optional().meta({ description: '"Diajukan Oleh" in order (default: the caller\'s employee).' }),
  bankAccountId: id.nullable().optional().meta({ description: 'employee-bank-accounts id of one of the requesters (Q-11).' }),
  lines: z.array(LineInput).max(200).optional(),
  attachmentIds: z.array(id).max(20).optional(),
  // ADR 0027 (DRMS 13/10 Wave 4) "Pembayaran vendor"
  payeeType: PayeeTypeEnum.optional().meta({ description: 'Default karyawan. vendor: only a Staff / Finance / PM caller of the request PT (403 otherwise; Staff since 2026-10-16 — the normal Staff approval flow); pt_grup (ADR 0028): only Finance / PM / Direktur of the request PT (403 otherwise). Both: `type` is set to advance, `bankAccountId` must be empty, the requester is the caller himself. Omitted on PATCH / sync = the stored payee type stays.' }),
  vendorId: id.nullable().optional().meta({ description: 'ADR 0027: active vendor of the request PT (GET /masters?types=vendors). Required to submit a vendor payment.' }),
  vendorBankAccountId: id.nullable().optional().meta({ description: 'ADR 0027: active account OF THAT vendor (GET /masters?types=vendor-bank-accounts). Required to submit; snapshotted at submit = the transfer destination.' }),
  invoiceNo: z.string().trim().max(64).nullable().optional().meta({ description: 'ADR 0027: required to submit. Unique per vendor among requests that are not cancelled / rejected (compared upper case, letters + digits only) → else 409 with errors[invoiceNo]. ADR 0028 (pt_grup): the receiving PT\'s document number (invoice / memo), required to submit, unique per receiving PT the same way.' }),
  invoiceDate: businessDate.nullable().optional().meta({ description: 'ADR 0027 / 0028: required to submit; not in the future.' }),
  invoiceDueDate: businessDate.nullable().optional().meta({ description: 'ADR 0027 / 0028: optional; not before invoiceDate.' }),
  invoiceFileId: id.nullable().optional().meta({ description: 'ADR 0027 / 0028: media-attachments id (photo / PDF, POST /media/attachments) of the invoice / document. Required to submit; linked to the request at submit.' }),
  payeeCompanyId: id
    .nullable()
    .optional()
    .meta({ description: 'ADR 0028 (pt_grup): the receiving PT — another active PT of the group with a designated receiving account (GET /intercompany/payees?company=<request PT>). Required to submit; none designated → 400 code INTERCOMPANY_NO_ACCOUNT (errors[payeeCompanyId]). Ignored for other payee types.' }),
}

export const ExpenseRequestCreate = z
  .object({
    type: RequestTypeEnum,
    company: createCompanyField,
    ...draftFields,
    clientUuid: z.uuid().optional().meta({ description: 'APK offline id; a retry with the same value returns the existing draft.' }),
  })
  .strict()
  .meta({ id: 'ExpenseRequestCreate' })

export const ExpenseRequestUpdate = z
  .object({ type: RequestTypeEnum.optional(), ...draftFields, title: draftFields.title.optional() })
  .strict()
  .meta({ id: 'ExpenseRequestUpdate', description: 'Draft only. Omitted fields stay unchanged; `lines` replaces all lines.' })

export const SignBody = z
  .object({ signatureMediaId: id.nullable().optional().meta({ description: 'media-signatures id captured on screen (own upload); default = profile signature.' }) })
  .strict()
  .meta({ id: 'SignBody' })

export const ReasonBody = z.object({ reason }).strict().meta({ id: 'ReasonBody' })

/** D2410 "Hapus draft": the reason is optional (default "Draft dihapus oleh pemohon" in the audit row). */
export const OptionalReasonBody = z.object({ reason: z.string().trim().max(1000).optional() }).strict().meta({ id: 'OptionalReasonBody' })

export const RejectBody = z
  .object({ reason, signatureMediaId: id.nullable().optional() })
  .strict()
  .meta({ id: 'RejectBody' })

export const EmptyBody = z.object({}).strict().meta({ id: 'EmptyBody' })

export const ReceiptCreate = z
  .object({
    lineId: z.string().min(1).max(64),
    receiptNo: z.string().max(64).nullable().optional(),
    vendorName: z.string().trim().min(1).max(160),
    vendorId: id.nullable().optional(),
    receiptDate: businessDate,
    receiptTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).nullable().optional(),
    amount: rupiahPos.meta({ description: 'Total PRINTED on the receipt.' }),
    taxAmount: rupiah.nullable().optional(),
    imageId: id.meta({ description: 'media-receipts id uploaded by the caller (POST /media/receipts).' }),
  })
  .strict()
  .meta({ id: 'ReceiptCreate' })

export const ReceiptUpdate = ReceiptCreate.omit({ imageId: true }).partial().strict().meta({ id: 'ReceiptUpdate' })

export const FlagReviewBody = z.object({ note: z.string().max(500).optional() }).strict().meta({ id: 'FlagReviewBody' })

/**
 * QA-04 (owner decision 2026-10-08): a cash-out that would make the account balance negative is
 * refused 409 `CASH_OVERDRAFT_CONFIRM_REQUIRED` {balance, after} unless this is true (audited
 * `overdraft_confirmed`).
 */
const confirmOverdraft = z
  .boolean()
  .optional()
  .meta({ description: 'QA-04: confirm that this cash-out may make the cash account balance negative (else 409 CASH_OVERDRAFT_CONFIRM_REQUIRED with balance/after); audited overdraft_confirmed.' })
/** QA-17: transfer to an employee bank account that is not verified → 409 unless confirmed (audited). */
const confirmUnverifiedAccount = z
  .boolean()
  .optional()
  .meta({ description: 'QA-17: confirm a transfer to a bank account with verificationStatus ≠ verified (else 409 BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED); audited bank_unverified_confirmed.' })

export const TransferCreate = z
  .object({
    cashAccountId: id.meta({ description: 'ADR 0031: the account Finance PAYS from (active, of the request PT). Default in the UI = the project\'s Pusat Biaya (GET /transfer-queue pusatBiaya); another account → automatic inter-project loan (loanReason required).' }),
    bankRef: z.string().trim().min(1).max(64),
    proofMediaId: id.meta({ description: 'media-transfer-proofs id (POST /media/transfer-proofs).' }),
    transferDate: businessDate.optional().meta({ description: 'Legacy: date only (time unknown). With transferAt it must equal the date of transferAt in the PT zone.' }),
    transferAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/, 'YYYY-MM-DDTHH:MM')
      .optional()
      .meta({ description: 'Item 11: date + time of the bank transfer proof. ISO 8601 with offset, or without offset = wall clock in the PT time zone. Not in the future; its date (PT zone) becomes transferDate (period lock). Omitted = old client, transfer time unknown.' }),
    costCenterId: id
      .nullable()
      .optional()
      .meta({ description: 'DEPRECATED (ADR 0031, DRMS 21/10): ignored — the Pusat Biaya is the project\'s cash account. Still accepted so older apps keep working.' }),
    loanReason: z
      .string()
      .trim()
      .max(1000)
      .nullable()
      .optional()
      .meta({ description: 'ADR 0031: required (min 3) when cashAccountId is not the project\'s Pusat Biaya — the reason of the automatic inter-project loan (400 path loanReason).' }),
    loanDueDate: businessDate.nullable().optional().meta({ description: 'ADR 0031: due date of the automatic loan (default transfer date + 30 days; not before the transfer date).' }),
    amount: rupiahPos.optional().meta({ description: 'Optional echo; must equal the approved amount (Finance cannot change it, G3).' }),
    confirmOverdraft: confirmOverdraft,
    confirmUnverifiedAccount: confirmUnverifiedAccount,
  })
  .strict()
  .meta({ id: 'TransferCreate' })

export const ListQuery = z
  .object({
    scope: z.enum(['mine', 'team', 'inbox', 'all']).default('all'),
    status: z.string().regex(/^[a-z_]+(,[a-z_]+)*$/).optional(),
    type: RequestTypeEnum.optional(),
    payeeType: PayeeTypeEnum.optional().meta({ description: 'ADR 0027: vendor = vendor payments only, karyawan = requests paid to employees; ADR 0028: pt_grup = payments to another PT of the group.' }),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(64).optional(),
    company: companyFilterParam,
    project: z.coerce.number().int().positive().optional().meta({ description: 'DRMS 10/10: only requests of this project (project detail "Pengajuan" tab / APK).' }),
    q: z.string().trim().max(100).optional().meta({ description: 'DRMS 10/10: search in nomor / judul (every word must match).' }),
    page: z.coerce.number().int().min(1).max(100_000).optional().meta({ description: 'DRMS 10/10: page number (1-based) instead of the cursor — the answer then also carries page / totalPages / totalDocs.' }),
  })
  .meta({ id: 'ExpenseRequestListQuery' })

const Ref = z.object({ id, code: z.string().nullish(), name: z.string().nullish() }).meta({ id: 'Ref' })

export const ExpenseRequestListItem = z
  .object({
    id,
    docNo: z.string().nullable(),
    type: RequestTypeEnum,
    typeLabel: z.string().meta({ description: 'Pengajuan Baru / Reimburse; "Pembayaran vendor" for payeeType vendor (ADR 0027); "Pembayaran antar-PT" for payeeType pt_grup (ADR 0028).' }),
    payeeType: PayeeTypeEnum,
    status: RequestStatusEnum,
    statusLabel: z.string(),
    title: z.string(),
    projectId: id.nullable(),
    costCenterId: id.nullable(),
    grandTotal: rupiah,
    approvedAmount: rupiah.nullable(),
    requestDate: z.string().nullable(),
    neededDate: z.string().nullable(),
    createdById: id.nullable(),
    updatedAt: z.string().nullable(),
    companyId: id.nullable().meta({ description: 'MC3: PT of the request (label: GET /me companies[]).' }),
    openWarningFlags: z.number().int().optional(),
  })
  .meta({ id: 'ExpenseRequestListItem' })

export const ExpenseRequestList = z
  .object({
    items: z.array(ExpenseRequestListItem),
    nextCursor: z.string().nullable(),
    page: z.number().int().optional().meta({ description: 'Only with ?page=.' }),
    totalPages: z.number().int().optional(),
    totalDocs: z.number().int().optional(),
  })
  .meta({ id: 'ExpenseRequestList' })

const CostCenterRef = z.object({ id, code: z.string().nullish(), name: z.string().nullish() })

/** DRMS 10/10: GET /transfer-queue items = list items + what the Finance transfer screen needs. */
export const TransferQueueItem = ExpenseRequestListItem.extend({
  project: Ref.nullable(),
  costCenter: CostCenterRef.nullable().meta({ description: 'DEPRECATED (ADR 0031): always null — see pusatBiaya.' }),
  pusatBiaya: z
    .object({ id, name: z.string() })
    .nullable()
    .meta({ description: 'ADR 0031: the project\'s Pusat Biaya (cash account) — default source account; paying from another one records an automatic inter-project loan. Null without project / unmapped project.' }),
  pusatBiayaMissing: z.boolean().meta({ description: 'ADR 0031: project request whose project has no Pusat Biaya yet → the transfer is refused (409) until it is mapped.' }),
  bank: z.object({ bankName: z.string().nullable(), accountNo: z.string().nullable(), accountHolder: z.string().nullable() }).nullable(),
  bankVerification: z.enum(['verified', 'unverified']).meta({ description: 'QA-17: unverified → the transfer needs confirmUnverifiedAccount.' }),
  flags: z.object({ warning: z.number().int(), info: z.number().int(), receiptMismatch: z.number().int() }),
  sla: z.object({ approvedAt: z.string().nullable(), slaHours: z.number(), ageHours: z.number().nullable(), over: z.boolean() }).meta({ description: 'Item 11: age since the final approval vs the PT transfer SLA.' }),
  noApproval: z.boolean().meta({ description: 'ADR 0024: a Direktur\'s own request without any approval (kebijakan PT) — show the badge "Tanpa persetujuan (Direktur)"; Finance\'s transfer checks are the only check. ADR 0026: also the Owner\'s own request (see noApprovalBy).' }),
  noApprovalBy: z.enum(['direktur', 'owner']).nullable().meta({ description: 'ADR 0026: whose own request went without approval — "owner" (rule "Pengajuan Owner") or "direktur" (ADR 0024, older requests); null when noApproval is false. Badge "Tanpa persetujuan (Owner|Direktur)".' }),
  vendorName: z.string().nullable().meta({ description: 'ADR 0027: vendor of a vendor payment (the transfer completes it; destination = the vendor account in `bank`).' }),
  payeeCompany: z
    .object({ id, shortCode: z.string(), name: z.string() })
    .nullable()
    .meta({ description: 'ADR 0028: receiving PT of a PT grup payment (badge "Antar PT: <shortCode>"; destination = its designated account in `bank`; the transfer also posts its Kas Masuk — closed period there → 409 INTERCOMPANY_PERIOD_CLOSED).' }),
  payeeCompanyName: z.string().nullable().meta({ description: 'ADR 0028: name of the receiving PT (null unless pt_grup).' }),
}).meta({ id: 'TransferQueueItem' })

export const TransferQueueList = z.object({ items: z.array(TransferQueueItem), nextCursor: z.string().nullable() }).meta({ id: 'TransferQueueList' })

/** ADR 0029 §2 / §6: the fund panel of the request detail. */
export const FundCheck = z
  .object({
    companyId: id,
    company: z.object({ id, shortCode: z.string(), name: z.string() }).nullable(),
    enabled: z.boolean().meta({ description: 'companies.fundCheckEnabled — off: information only (no block).' }),
    applies: z.boolean().meta({ description: 'The request\'s NEXT decision makes it "Disetujui" (the Owner level / a final level without Owner) or this is the Owner\'s own Draft (checked at submit).' }),
    status: z.enum(['ok', 'insufficient', 'not_applicable']),
    blocked: z.boolean().meta({ description: 'enabled ∧ applies ∧ insufficient.' }),
    blockedText: z.string().nullable().meta({ description: '"Dana PT tidak cukup — kurang Rp X. Tolak, atau perintahkan pinjaman antar-PT."' }),
    balance: signedRupiah.meta({ description: 'Saldo dana: Σ balance of the PT\'s active accounts (no site exclusion since DRMS 24/10).' }),
    commitments: signedRupiah.meta({ description: 'Komitmen: approved-not-transferred + unpaid LPJ shortfalls + loans instructed with this PT as lender.' }),
    available: signedRupiah.meta({ description: 'Dana tersedia = balance − commitments (may be negative).' }),
    needed: rupiah.meta({ description: 'Dibutuhkan: the request\'s grand total (not yet committed).' }),
    gap: rupiah.meta({ description: 'Kurang = max(0, needed − max(available, pusatBiaya.available)) (ADR 0031 amendment: Pusat Biaya first, then PT).' }),
    route: z.enum(['pusat_biaya', 'other_account', 'pt', 'short']).meta({
      description: 'ADR 0031 amendment: pusat_biaya = the project\'s Pusat Biaya covers the need; other_account = it does not, the PT does (Finance pays from another account → automatic inter-project loan); pt = no Pusat Biaya, the PT covers it; short = neither.',
    }),
    routeText: z.string().nullable().meta({ description: 'Indonesian one-liner of `route` (null when pt / short).' }),
    pusatBiaya: z
      .object({
        accountId: id,
        name: z.string(),
        balance: signedRupiah.meta({ description: 'Saldo of the account (a site account too).' }),
        commitments: rupiah.meta({ description: 'Approved-not-transferred requests of the projects mapped to it + their unpaid LPJ shortfalls + approved, not yet disbursed cash-backed loans it lends.' }),
        available: signedRupiah.meta({ description: 'Dana bebas = balance − commitments.' }),
        commitmentItems: z.array(z.object({ kind: z.enum(['request', 'shortfall', 'loan', 'project_loan']), id, docNo: z.string().nullable(), amount: rupiah, status: z.string() })),
      })
      .nullable()
      .meta({ description: 'The project\'s Pusat Biaya (cash account) and its figures; null = no project / not mapped (checked per PT only).' }),
    accountCount: z.number().int().meta({ description: '"n akun" (every active account).' }),
    excludedSiteAccounts: z.object({ count: z.number().int(), balance: signedRupiah }),
    waitingAtOwner: z.object({ count: z.number().int(), amount: rupiah }).meta({ description: 'Other requests of the PT waiting at their final decision (not committed: first approved, first served).' }),
    commitmentItems: z
      .array(z.object({ kind: z.enum(['request', 'shortfall', 'loan', 'project_loan']), id, docNo: z.string().nullable(), amount: rupiah, status: z.string() }))
      .meta({ description: 'The commitments behind the figure, largest first (max 20). kind loan: id = the inter-PT loan; project_loan (Pusat Biaya list only): id = the inter-project loan.' }),
    loans: z
      .array(
        z.object({
          id,
          docNo: z.string(),
          status: z.string(),
          statusLabel: z.string().meta({ description: 'Indonesian label of `status` (instructed | disbursed | partially_repaid | repaid | cancelled), the labels of GET /intercompany-loans: Menunggu pencairan | Dicairkan | Sebagian dikembalikan | Lunas | Dibatalkan.' }),
          amount: rupiah,
          lender: z.object({ id, shortCode: z.string() }).nullable(),
        }),
      )
      .meta({ description: 'Inter-PT loans instructed for this request (linked).' }),
  })
  .meta({ id: 'FundCheck' })

export const ExpenseRequestDetail = ExpenseRequestListItem.extend({
  uuid: z.string().nullable(),
  project: Ref.nullable(),
  costCenter: Ref.nullable().meta({ description: 'D2 legacy: the cost center of an old non-project request (none since ADR 0031).' }),
  pusatBiaya: z
    .object({ id, name: z.string() })
    .nullable()
    .meta({ description: 'ADR 0031 (DRMS 21/10): the Pusat Biaya = the project\'s cash account (read-only; null without project or while the project is not mapped).' }),
  urgencyLevel: Ref.extend({ rank: z.number().int().nullish() }).nullable().meta({ description: '"Tingkat urgensi" (owner decision 2026-10-09; replaces periodFrom/periodTo).' }),
  notes: z.string().nullable(),
  requesters: z.array(Ref.nullable()),
  createdBy: z.object({ id, name: z.string().nullish() }).nullable(),
  bankAccountId: id.nullable(),
  vendor: Ref.nullable().meta({ description: 'ADR 0027: vendor of a vendor payment (null for payeeType karyawan).' }),
  vendorBankAccountId: id.nullable().meta({ description: 'ADR 0027: chosen vendor account (vendor payment); after submit the destination is `bank` (snapshot).' }),
  invoice: z
    .object({
      no: z.string().nullable(),
      date: z.string().nullable(),
      dueDate: z.string().nullable(),
      fileId: id.nullable().meta({ description: 'media-attachments id (GET /api/v1/media/attachments/{id}/file).' }),
      fileName: z.string().nullable(),
      mimeType: z.string().nullable(),
    })
    .nullable()
    .meta({ id: 'VendorInvoice', description: 'ADR 0027: the vendor invoice (the proof of a vendor payment — no LPJ); ADR 0028: the receiving PT\'s document (invoice / memo) of a PT grup payment. null for payeeType karyawan.' }),
  attachments: z
    .array(z.object({ id, fileName: z.string().nullable(), mimeType: z.string().nullable() }))
    .meta({ description: 'D2410: general attachments ("Lampiran", photo / PDF; GET /api/v1/media/attachments/{id}/file). A Reimburse is submitted with at least one.' }),
  payeeCompany: z
    .object({ id, shortCode: z.string().nullish(), name: z.string().nullish() })
    .nullable()
    .meta({ description: 'ADR 0028: receiving PT of a PT grup payment (null otherwise).' }),
  intercompany: z
    .object({
      status: z.enum(['posted', 'void']),
      targetEntryNo: z.string().meta({ description: 'Number of the Kas Masuk in the receiving PT (KM/<PT>/…).' }),
      targetCompany: z.object({ id, shortCode: z.string(), name: z.string() }).nullable(),
      transferId: id.nullable(),
    })
    .nullable()
    .meta({ id: 'RequestIntercompany', description: 'ADR 0028: the receiving PT\'s Kas Masuk of the (latest) transfer of a PT grup payment — numbers and PT only; null before the transfer / for other payee types. status void = the transfer was voided (reversal posted in the receiving PT).' }),
  bank: z
    .object({ bankName: z.string().nullable(), accountNo: z.string().nullable().meta({ description: 'Masked (last 4) unless own request or Finance/Owner/Admin.' }), accountHolder: z.string().nullable() })
    .nullable()
    .meta({ description: 'Destination snapshot taken at submit: the requester\'s account, or (ADR 0027) the vendor account, or (ADR 0028) the receiving PT\'s designated account.' }),
  lines: z.array(
    z.object({
      id: z.string(),
      no: z.number().int(),
      description: z.string().nullable(),
      qty: z.number().nullable(),
      uom: Ref.nullable(),
      unitPrice: rupiah.nullable(),
      unitPriceDisplay: rupiah.nullable().meta({ description: 'unitPrice, else total ÷ qty (display only; lines saved before D3).' }),
      total: rupiah.meta({ description: 'Server-computed qty × unitPrice (D3). 0 = incomplete line (no unit price yet).' }),
      receiptAmount: rupiah.nullable().meta({ description: 'D3 "Nominal sesuai nota" (null = not filled).' }),
      receiptMismatch: z.boolean().meta({ description: 'receiptAmount set and ≠ total (live; the stored Finance flag is flags[] kind receipt_amount_mismatch).' }),
      notes: z.string().nullable(),
      category: Ref.nullable(),
      vehicle: z.object({ id, plateNo: z.string().nullish(), plateDisplay: z.string().nullish(), type: z.string().nullish() }).nullable(),
      rapItem: Ref.nullable().meta({ description: 'D4: RAP item of the line (name = the item\'s uraian).' }),
      rapOverBudget: z.boolean().meta({ description: 'D4: live "Melebihi RAP" (approved realisation of the item + this request > planned). Always false for callers without a RAP price role (Staff).' }),
    }),
  ),
  transferredTotal: rupiah,
  approvalCycle: z.number().int(),
  currentLevel: z.number().int().nullable(),
  approvalRule: z
    .object({
      id,
      name: z.string(),
      acknowledge: z.enum(['required', 'optional', 'none']),
      acknowledgerUserId: id.nullable(),
      acknowledgeDelegatedTo: z.enum(['owner', 'admin']).nullable(),
      acknowledgeDelegationReason: z.string().nullable(),
      acknowledgeBy: z.enum(['scope_manager', 'role', 'user']).meta({ description: 'ADR 0021: scope_manager with decisionRoles = "Persetujuan PM" by the PM project (acknowledgerUserId), then the Direktur level; scope_manager without decisionRoles = pre-E1 snapshot (PM "Diketahui").' }),
      acknowledgeRole: z.string().nullable().meta({ description: 'ADR 0013: pk-owner (label "Direktur") when "Diketahui" is the Direktur approval.' }),
      decisionRoles: z.array(z.string()).meta({ description: 'ADR 0013: roles that may acknowledge/approve/reject ([pk-owner, pk-finance]); empty = pre-E1 snapshot (old guards).' }),
      skipped: z
        .array(z.object({ position: z.enum(['diketahui', 'approval']), level: z.number().int(), role: z.string().nullable(), userId: id.nullable(), reason: z.string() }))
        .meta({ description: 'ADR 0013 G1-2: positions skipped at submit because their only holders are requester/creator — show "(tidak berlaku — pemohon)".' }),
      selfApproval: z
        .enum(['direktur_via_pm', 'direktur_via_pm_self', 'direktur_no_approval', 'principal_no_approval'])
        .nullable()
        .meta({
          description:
            'G1 exception of the snapshot. ADR 0026 (owner 2026-10-13): principal_no_approval = the Owner\'s OWN request under the zero-step rule "Pengajuan Owner" — no approval step, straight to the Finance transfer queue; show the step "Persetujuan" (skipped) with the note "Tanpa persetujuan — pengajuan Owner (kebijakan PT)". Since ADR 0026 a Direktur\'s own request is approved by the Owner (direktur_no_approval stays on older requests). ADR 0024 (owner 2026-10-11): direktur_no_approval = a Direktur\'s OWN request under a zero-step rule — no approval step at all, straight to the Finance transfer queue; show the step "Persetujuan" (skipped) with the note "Tanpa persetujuan — pengajuan Direktur (kebijakan PT)" and status "Tanpa persetujuan (Antri Transfer)". Legacy ADR 0021 (no longer set for new requests): a Direktur\'s request filed by the PM project (PM approves, then a Direktur). direktur_via_pm = another Direktur decides the Direktur step; direktur_via_pm_self = the requester Direktur may approve (only Direktur of the PT, owner 2026-10-11). Show the note "Pengajuan Direktur — diajukan oleh PM …".',
        }),
      steps: z.array(z.object({ level: z.number().int(), approverRole: z.string().nullable(), approverUserId: id.nullable() })),
      signDiajukan: z.enum(['required', 'optional', 'none']),
      signDibuat: z.enum(['required', 'optional', 'none']),
    })
    .nullable(),
  approvals: z.array(
    z.object({
      id,
      cycle: z.number().int(),
      position: z.enum(['diajukan', 'dibuat', 'diketahui', 'approval']),
      level: z.number().int(),
      actorId: id.nullable(),
      employeeId: id.nullable(),
      actorName: z.string().nullable(),
      onBehalf: z.boolean(),
      decision: z.enum(['signed', 'acknowledged', 'approved', 'rejected']),
      reason: z.string().nullable(),
      decidedAt: z.string().nullable(),
      budgetPctBefore: z.number().nullable(),
      budgetPctAfter: z.number().nullable(),
      openFlags: z.number().int().nullable(),
      fundAvailable: signedRupiah.nullable().meta({ description: 'ADR 0029: "Dana tersedia saat disetujui" of a checked final decision (Kas roles of the PT only; else null).' }),
      fundBalance: signedRupiah.nullable(),
      fundCommitments: signedRupiah.nullable(),
      signatureId: id.nullable(),
      signatureSha256: z.string().nullable(),
      signatureSource: z
        .string()
        .nullable()
        .meta({ description: 'profile | captured | none | company (ADR 0025: signed with the PT\'s definitive Direktur signature by a designated representative; actorName = that Direktur).' }),
    }),
  ),
  receipts: z.array(
    z.object({
      id,
      lineId: z.string(),
      lineNo: z.number().int().nullable(),
      receiptNo: z.string().nullable(),
      vendorName: z.string(),
      receiptDate: z.string(),
      amount: rupiah,
      imageId: id.nullable(),
      status: z.enum(['pending', 'valid', 'rejected', 'removed']),
    }),
  ),
  flags: z.array(
    z.object({
      id,
      kind: z
        .enum(['amount_diff', 'date_after_request', 'date_too_old', 'date_out_of_period', 'uom_suspicious', 'duplicate', 'receipt_amount_mismatch', 'rap_over_budget'])
        .meta({ description: 'receipt_amount_mismatch = "Selisih nota" (D3); rap_over_budget = "Melebihi RAP" (D4, warning, not blocking; only for Direktur/Admin/Finance/PM).' }),
      kindLabel: z.string(),
      level: z.string(),
      status: z.string(),
      lineId: z.string().nullable(),
      lineNo: z.number().int().nullable(),
      receiptId: id.nullable(),
      relatedRequestId: id.nullable(),
      message: z.string(),
      reviewNote: z.string().nullable(),
    }),
  ),
  transfers: z.array(
    z.object({
      id,
      docNo: z.string(),
      kind: z.string(),
      amount: rupiah,
      transferDate: z.string(),
      transferAt: z.string().nullable().meta({ description: 'Item 11: date + time of the proof (UTC ISO); null = recorded without a time.' }),
      costCenter: CostCenterRef.nullable().meta({ description: 'D2 legacy: cost center chosen by Finance (transfers of 10/10–21/10/2026 only).' }),
      cashAccount: z.object({ id, name: z.string().nullable() }).nullable().optional().meta({ description: 'ADR 0031: account the transfer is charged to (the project\'s Pusat Biaya).' }),
      paidFromCashAccount: z.object({ id, name: z.string().nullable() }).nullable().optional().meta({ description: 'ADR 0031: account actually paid from when not the Pusat Biaya (null = paid from it).' }),
      projectLoan: z.object({ id, docNo: z.string().nullable(), status: z.string() }).nullable().optional().meta({ description: 'ADR 0031: the automatic inter-project loan of a transfer paid from another account.' }),
      bankRef: z.string(),
      status: z.string(),
      cashEntryId: id.nullable(),
      proofId: id.nullable(),
      voidReason: z.string().nullable(),
    }),
  ),
  verifiedReceiptsTotal: rupiah.nullable(),
  settlement: z
    .object({
      id,
      docNo: z.string().nullable(),
      status: z.enum(['draft', 'submitted', 'revision', 'verified', 'settled']),
      statusLabel: z.string(),
      usageNotes: z.string().nullable(),
      photos: z.array(id).meta({ description: 'Point 13: LPJ photo ids (media-receipts; file: GET /api/v1/media/receipts/{id}/file).' }),
      transferredTotal: rupiah.nullable(),
      receiptsTotal: rupiah.nullable().meta({ description: 'Σ active receipts (pending + valid); refreshed at every LPJ submit and — QA-09 — after every receipt add / edit / remove / valid / reject while the LPJ is open.' }),
      verifiedReceiptsTotal: rupiah.nullable(),
      difference: z.number().int().nullable().meta({ description: 'transferred − receipts (verified after verification): > 0 refund, < 0 shortfall.' }),
      settlementType: z.enum(['none', 'refund', 'shortfall']).nullable(),
      financeNotes: z.string().nullable().meta({ description: 'Latest revision note from Finance (US-08).' }),
      submitCount: z.number().int(),
      submittedAt: z.string().nullable(),
      verifiedAt: z.string().nullable(),
      settledAt: z.string().nullable(),
      refundCashEntryId: id.nullable(),
      shortfallTransferId: id.nullable(),
      reversalCount: z.number().int().meta({ description: 'E9: how often the settlement was reversed (void of the refund KM / shortfall transfer).' }),
      lastReversedAt: z.string().nullable(),
      lastReversalReason: z.string().nullable(),
      shortfallApproval: ShortfallApproval.nullable()
        .optional()
        .meta({ description: 'QA-06 / ADR 0019 (Finance/Direktur of the PT only; null otherwise or without a shortfall): shortfall vs approved + tolerance and its re-approval.' }),
    })
    .nullable()
    .meta({ id: 'Settlement', description: 'T5 LPJ (Pengajuan Baru only; null before "Nota Lengkap").' }),
  budget: z
    .object({ basis: z.enum(['project', 'none']), pctBefore: z.number().nullable(), pctAfter: z.number().nullable() })
    .meta({ description: 'US-26 preview (committed % before → after); cost centers: "none" (Q-24). Owner 2026-10-11: "none" + nulls for callers without a money role in the PT (Staff) — the % with the total would reveal the RAB.' }),
  openWarningFlags: z.number().int(),
  allowedActions: z.array(ActionEnum).meta({ description: 'UI hint; the server re-checks every action.' }),
  fundCheck: FundCheck.nullable().meta({
    description:
      'ADR 0029 §2 "Ketersediaan dana PT": for Finance / Direktur / Owner of the request\'s PT while the request waits for a decision (any step; read-only before the final one) or is the Owner\'s own Draft; null otherwise. `blocked` = the next decision (or the Owner\'s submit) is refused with 409 FUND_INSUFFICIENT — show "Setujui" disabled with `blockedText`, keep "Tolak"; `instruct_loan` in allowedActions opens the loan instruction (amount default = gap).',
  }),
  direkturSignature: z
    .object({ name: z.string(), title: z.string().nullable(), signatureId: id })
    .nullable()
    .meta({
      description:
        'ADR 0025: non-null when the decision the caller may take now is a Direktur step of a PT with a definitive Direktur and the caller is one of its designated representatives. The decision is then signed with the PT\'s Direktur signature (signatureId, media-signatures; readable by the office roles of the PT) and shown under `name` — show it read-only ("Tanda tangan Direktur PT") instead of asking for a signature; a sent signatureMediaId is ignored. The server decides again at the decision.',
    }),
  resubmitOfId: id.nullable(),
  resubmitOf: z.object({ id, docNo: z.string().nullable(), title: z.string() }).nullable(),
  submittedAt: z.string().nullable(),
  approvedAt: z.string().nullable().meta({ description: 'Item 11: final approval time (server) of the current cycle; start of the transfer SLA.' }),
  cancelReason: z.string().nullable(),
  rejectReason: z.string().nullable(),
  clientUuid: z.string().nullable(),
  createdAt: z.string().nullable(),
  rev: z.number().int().meta({ description: 'Content revision (sync `base_rev` for offline edits of a draft, ADR 0010).' }),
  timeline: z
    .array(z.object({ status: RequestStatusEnum, label: z.string(), state: z.enum(['done', 'current', 'todo']) }))
    .meta({ description: 'Status path of the request type with done / current / todo marks (US-05).' }),
  nextActor: z
    .object({ who: z.string(), what: z.string() })
    .nullable()
    .meta({ description: '"Giliran": who is expected to act next and what (display text, Bahasa Indonesia); null when finished.' }),
}).meta({ id: 'ExpenseRequestDetail' })

/** Point 13 (DRMS 10/10): LPJ photos = media-receipts ids uploaded by the caller (POST /api/v1/media/receipts), images only. */
const lpjPhotos = z.array(id).max(10).meta({ description: 'Point 13: LPJ photos — media-receipts ids (POST /api/v1/media/receipts, images only), max 10. Replaces the whole set.' })

export const LpjSubmitBody = z
  .object({
    usageNotes: z.string().trim().min(3).max(2000).optional().meta({ description: 'Required at the first submit; kept on resubmit when omitted.' }),
    photos: lpjPhotos.optional(),
  })
  .strict()
  .meta({ id: 'LpjSubmitBody' })

export const RevisionBody = z.object({ note }).strict().meta({ id: 'LpjRevisionBody' })

export const LpjPhotosBody = z.object({ photos: lpjPhotos }).strict().meta({ id: 'LpjPhotosBody', description: 'Point 13: save the LPJ photo set while the LPJ is editable (Draft / Revisi) — requester only.' })

export const SettleReverseResult = z
  .object({
    request: ExpenseRequestDetail,
    voided: z
      .object({
        type: z.enum(['refund', 'shortfall']),
        amount: rupiah,
        refundCashEntryId: id.optional(),
        refundCashEntryNo: z.string().optional(),
        shortfallTransferId: id.optional(),
        shortfallTransferNo: z.string().nullable().optional(),
        reversalCashEntryId: id.nullable(),
        reversalCashEntryNo: z.string().nullable(),
      })
      .meta({ description: 'Documents voided by the reversal (also in the audit log).' }),
  })
  .meta({ id: 'SettleReverseResult' })

export const SettleBody = z
  .object({
    cashAccountId: id,
    date: businessDate.optional().meta({ description: 'KM date (refund) or transfer date (shortfall); default today.' }),
    bankRef: z.string().trim().min(1).max(64).optional().meta({ description: 'Shortfall: required.' }),
    proofMediaId: id.nullable().optional().meta({ description: 'Shortfall: media-transfer-proofs id (required). Refund: media-attachments id (optional).' }),
    amount: rupiahPos.optional().meta({ description: 'Optional echo; must equal the server-computed |difference|.' }),
    confirmOverdraft: confirmOverdraft,
    confirmUnverifiedAccount: confirmUnverifiedAccount,
  })
  .strict()
  .meta({ id: 'SettleBody' })

export const HistoryItem = z
  .object({
    serverTime: z.string(),
    action: z.string(),
    field: z.string().nullable(),
    lineNo: z.number().int().nullable(),
    oldValue: z.unknown(),
    newValue: z.unknown(),
    statusFrom: z.string().nullable(),
    statusTo: z.string().nullable(),
    reason: z.string().nullable(),
    userId: z.number().int().nullable(),
    userName: z.string().nullable(),
    source: z.string().nullable(),
    appVersion: z.string().nullable(),
    deviceId: z.string().nullable(),
    docType: z.string().meta({ description: 'expense_request, or a satellite: receipt, transfer, settlement, cash_entry.' }),
    docNo: z.string().nullable(),
  })
  .meta({ id: 'HistoryItem' })
export const History = z.object({ items: z.array(HistoryItem) }).meta({ id: 'History' })

export const MediaKindEnum = z.enum(['receipts', 'transfer-proofs', 'signatures', 'attachments', 'selfies', 'progress-photos']).meta({ id: 'MediaKind' })
export const MediaUploaded = z
  .object({ id, kind: MediaKindEnum, mimeType: z.string().nullable(), filesize: z.number().int().nullable(), width: z.number().int().nullable(), height: z.number().int().nullable(), sha256Original: z.string().nullable() })
  .meta({ id: 'MediaUploaded' })

export const CashEntryCreate = z
  .object({
    direction: z.enum(['in', 'out']),
    company: createCompanyField,
    entryDate: businessDate.optional(),
    cashAccountId: id,
    amount: rupiahPos,
    description: z.string().trim().min(1).max(1000),
    categoryId: id.nullable().optional().meta({ description: 'Required for direction=out.' }),
    cashInSourceId: id.nullable().optional().meta({ description: 'Required for direction=in.' }),
    projectId: id.nullable().optional(),
    costCenterId: id.nullable().optional(),
    vehicleId: id.nullable().optional(),
    proofId: id.nullable().optional().meta({ description: 'media-attachments id (optional, US-23).' }),
    confirmOverdraft: confirmOverdraft,
  })
  .strict()
  .meta({ id: 'CashEntryCreate' })

export const CashEntryUpdate = z
  .object({
    reason,
    description: z.string().trim().min(1).max(1000).optional(),
    categoryId: id.nullable().optional(),
    cashInSourceId: id.nullable().optional(),
    projectId: id.nullable().optional(),
    costCenterId: id.nullable().optional(),
    vehicleId: id.nullable().optional(),
    proofId: id.nullable().optional().meta({ description: 'QA-31 (ADR 0005 §5): add or replace the proof (media-attachments id uploaded by the caller); null removes it.' }),
  })
  .strict()
  .meta({ id: 'CashEntryUpdate', description: 'Manual entries of an open period only; amount/date/account changes = void + new entry.' })

/** ADR 0028: the cash source types (`intercompany` = automatic Kas Masuk of a payment from another PT of the group). */
export const CashSourceTypeEnum = z.enum(['transfer', 'settlement_refund', 'manual', 'reversal', 'opening', 'intercompany']).meta({ id: 'CashSourceType' })

export const CashEntryIntercompany = z
  .object({
    direction: z.enum(['in', 'out']).meta({ description: 'in = this entry is the Kas Masuk of the receiving PT; out = the transfer KK of the paying PT.' }),
    status: z.enum(['posted', 'void']).meta({ description: 'Link status (void after the paying PT voided its transfer).' }),
    counterpartCompany: z.object({ id, shortCode: z.string(), name: z.string() }).nullable(),
    sourceDocType: z.enum(['expense_request', 'intercompany_loan']).meta({ description: 'ADR 0029: the document of the pair — a PT grup payment (request of the paying PT) or an inter-PT loan (PJA, belongs to both PTs).' }),
    loanLeg: z.enum(['given', 'received', 'repaid_in', 'repaid_out']).nullable().meta({ description: 'ADR 0029: Pinjaman antar-PT diberikan / diterima, Pengembalian pinjaman antar-PT diterima, Pembayaran hutang antar-PT; null for a PT grup payment.' }),
    sourceDocNo: z.string().nullable().meta({ description: 'Number of the paying PT\'s request (PB/…) or the loan (PJA/…).' }),
    sourceDocId: id.meta({ description: 'The request id, or (sourceDocType intercompany_loan) the loan id.' }),
    transferDocNo: z.string().nullable().meta({ description: 'Number of the paying PT\'s transfer (TRF/…).' }),
    counterpartEntryNo: z.string().meta({ description: 'The other leg: KM of the receiving PT (direction out) or KK of the paying PT (direction in).' }),
    counterpartEntryId: id,
    canOpenCounterpart: z.boolean().meta({ description: 'The caller holds Finance / Direktur / Admin in the other PT (else show the numbers as plain text).' }),
    canOpenSourceDoc: z.boolean(),
  })
  .meta({ id: 'CashEntryIntercompany', description: 'ADR 0028: counterpart of an intercompany pair — numbers and PT only.' })

export const CashEntry = z
  .object({
    id,
    entryNo: z.string(),
    entryDate: z.string(),
    period: z.string().nullable(),
    direction: z.enum(['in', 'out']),
    amount: rupiah,
    cashAccountId: id,
    categoryId: id.nullable(),
    cashInSourceId: id.nullable(),
    projectId: id.nullable(),
    costCenterId: id.nullable(),
    vehicleId: id.nullable(),
    description: z.string().nullable(),
    sourceType: CashSourceTypeEnum,
    expenseRequestId: id.nullable(),
    transferId: id.nullable(),
    status: z.enum(['posted', 'void']),
    reversalOfId: id.nullable(),
    reversedById: id.nullable(),
    voidReason: z.string().nullable(),
    proofId: id.nullable().meta({ description: 'QA-31: current proof (media-attachments id; GET /media/attachments/{id}/file); PATCH proofId adds or replaces it.' }),
    postedAt: z.string().nullable(),
    companyId: id.nullable().meta({ description: 'MC3: PT of the entry.' }),
    intercompany: CashEntryIntercompany.nullable().meta({ description: 'ADR 0028: the other leg of an intercompany payment (KK of the paying PT ↔ KM of the receiving PT); null for every other entry.' }),
  })
  .meta({ id: 'CashEntry' })

export const CashEntryList = z.object({ items: z.array(CashEntry), nextCursor: z.string().nullable() }).meta({ id: 'CashEntryList' })
export const CashListQuery = z
  .object({
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    cashAccountId: z.coerce.number().int().positive().optional(),
    projectId: z.coerce.number().int().positive().optional(),
    costCenterId: z.coerce.number().int().positive().optional(),
    sourceType: CashSourceTypeEnum.optional().meta({ description: 'ADR 0028: only entries of this source type (e.g. intercompany).' }),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(64).optional(),
    company: companyFilterParam,
  })
  .meta({ id: 'CashEntryListQuery' })

export const VoidResult = z.object({ original: CashEntry, reversal: CashEntry }).meta({ id: 'CashVoidResult' })

export const Balances = z
  .object({
    asOf: z.string().nullable(),
    items: z.array(
      z.object({
        cashAccountId: id,
        companyId: id,
        siteId: id.nullable().meta({ description: 'ADR 0023 (Q-S7): site flag of the account (petty cash of a branch), null = none.' }),
        name: z.string(),
        active: z.boolean().meta({ description: 'Inactive accounts keep their balance here but cannot take new postings (transfer form pickers hide them).' }),
        openingBalance: z.number().int(),
        totalIn: z.number().int(),
        totalOut: z.number().int(),
        balance: z.number().int(),
      }),
    ),
  })
  .meta({ id: 'Balances' })

export const PeriodCloseBody = z
  .object({
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    note: z.string().max(500).optional(),
    /** ADR 0016 §4: PT to close; required when the caller is Finance/Direktur in more than one selected PT. */
    company: z.number().int().positive().optional(),
  })
  .strict()
  .meta({ id: 'PeriodCloseBody' })

/** MC2: atomic role-matrix save (all-or-nothing; one audit row per changed membership, reason required). */
export const MembershipBatchBody = z
  .object({
    reason,
    items: z
      .array(
        z
          .object({
            user: id,
            company: id,
            // pk-operator (owner 2026-10-09) is offered by the web matrix ('Opr') — it was missing here (400 on save)
            // ADR 0032: pk-admin-staff (Admin Staff, 'AdmS')
            roles: z.array(z.enum(['pk-staff', 'pk-pm', 'pk-finance', 'pk-owner', 'pk-principal', 'pk-admin', 'pk-operator', 'pk-admin-staff'])).max(8),
            employee: id.nullable().optional().meta({ description: 'Employee of THIS PT (null = unlink; omitted = unchanged).' }),
            active: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .meta({ id: 'MembershipBatchBody' })

export const MembershipBatchResult = z
  .object({
    items: z.array(z.object({ id, user: id, company: id, roles: z.array(z.string()), employee: id.nullable(), active: z.boolean(), created: z.boolean() })),
  })
  .meta({ id: 'MembershipBatchResult' })

export const PeriodClosing = z
  .object({
    id,
    companyId: id.nullable(),
    period: z.string(),
    status: z.enum(['closed', 'reopened']),
    note: z.string().nullable(),
    closedById: id.nullable(),
    closedAt: z.string().nullable(),
    reopenedById: id.nullable(),
    reopenedAt: z.string().nullable(),
    reopenReason: z.string().nullable(),
  })
  .meta({ id: 'PeriodClosing' })
export const PeriodClosingList = z
  .object({
    lockDate: z.string().nullable(),
    /** ADR 0016 §4: lock date per PT readable by the caller. */
    lockDates: z.array(z.object({ companyId: id, lockDate: z.string().nullable() })),
    items: z.array(PeriodClosing),
  })
  .meta({ id: 'PeriodClosingList' })

export const TransferResult = z
  .object({
    request: ExpenseRequestDetail,
    transferId: id,
    transferDocNo: z.string(),
    cashEntryId: id,
    cashEntryNo: z.string(),
    intercompany: z
      .object({ cashEntryId: id, cashEntryNo: z.string(), company: z.object({ id, shortCode: z.string(), name: z.string() }) })
      .nullable()
      .meta({ description: 'ADR 0028: the Kas Masuk posted in the receiving PT (PT grup payment); null otherwise.' }),
    projectLoan: z
      .object({ id, docNo: z.string().nullable(), kk: z.string(), km: z.string() })
      .nullable()
      .optional()
      .meta({ description: 'ADR 0031: the automatic inter-project loan when paid from an account other than the project\'s Pusat Biaya (its KK on the paying account, KM on the Pusat Biaya); null otherwise.' }),
  })
  .meta({ id: 'TransferResult' })

export const IntercompanyPayeesQuery = z
  .object({ company: z.coerce.number().int().positive().meta({ description: 'The PAYING PT (the request\'s PT); the caller must hold Finance / PM / Direktur there.' }) })
  .meta({ id: 'IntercompanyPayeesQuery' })

export const IntercompanyPayee = z
  .object({
    companyId: id,
    shortCode: z.string(),
    name: z.string(),
    bankName: z.string().nullable(),
    accountNoMasked: z.string().meta({ description: '"••••1234" — the full number is only in the request\'s submit snapshot.' }),
    accountHolder: z.string(),
  })
  .meta({ id: 'IntercompanyPayee' })

export const IntercompanyPayeeList = z.object({ items: z.array(IntercompanyPayee) }).meta({ id: 'IntercompanyPayeeList', description: 'ADR 0028 payee directory: every other active PT of the group with a designated receiving account.' })

export const Created = z.object({ id }).meta({ id: 'Created' })

export const SettleResult = z
  .object({
    request: ExpenseRequestDetail,
    settlementType: z.enum(['none', 'refund', 'shortfall']),
    amount: rupiah,
    refundCashEntryId: id.nullable(),
    refundCashEntryNo: z.string().nullable(),
    shortfallTransferId: id.nullable(),
    shortfallTransferNo: z.string().nullable(),
    shortfallCashEntryId: id.nullable(),
  })
  .meta({ id: 'SettleResult' })

/** QA-11: GET …/settle/precheck — the settlement configuration is complete (checked before uploading the proof). */
export const SettlePrecheckResult = z
  .object({
    ready: z.literal(true),
    settlementType: z.enum(['none', 'refund', 'shortfall']),
    amount: rupiah,
  })
  .meta({ id: 'SettlePrecheckResult' })

export const Notification = z
  .object({
    id,
    uuid: z.string(),
    event: z.string(),
    title: z.string(),
    body: z.string(),
    docType: z.string().nullable(),
    docId: z.string().nullable(),
    docNo: z.string().nullable(),
    readAt: z.string().nullable(),
    createdAt: z.string(),
    companyId: id.nullable().meta({ description: 'MC3: PT of the document the notification is about (null = app-wide).' }),
  })
  .meta({ id: 'Notification' })
export const NotificationList = z
  .object({ items: z.array(Notification), unreadCount: z.number().int(), nextCursor: z.string().nullable() })
  .meta({ id: 'NotificationList' })
export const NotificationQuery = z
  .object({
    unread: z.enum(['true', 'false']).optional().meta({ description: 'true = only unread.' }),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: z.string().max(64).optional(),
    company: companyFilterParam,
  })
  .meta({ id: 'NotificationQuery' })
export const ReadAllResult = z.object({ updated: z.number().int() }).meta({ id: 'NotificationsReadAll' })

export const FileCollectionEnum = z.enum(['receipts', 'transfer-proofs', 'signatures', 'attachments', 'company', 'progress-photos', 'selfies']).meta({ id: 'FileCollection' })
export const SignedMediaUrl = z
  .object({
    url: z.string().meta({ description: 'Relative URL: /api/v1/media/{collection}/{id}/file?…&exp=&uid=&sig=' }),
    expiresAt: z.iso.datetime(),
    ttlSeconds: z.number().int(),
  })
  .meta({ id: 'SignedMediaUrl' })
/** DRMS 10/10 8e: destination account preview under the picker / of the submit snapshot (masked; full only on reveal for allowed callers). */
export const BankPreviewQuery = z
  .object({
    request: z.coerce.number().int().positive().optional().meta({ description: 'Expense request id. Draft → live account (`account` = picker value, default the saved one); submitted → the snapshot taken at submit.' }),
    account: z.coerce.number().int().positive().optional().meta({ description: 'Employee bank account id (picker value). Without `request`: only an account readable through the collection access.' }),
    vendorAccount: z.coerce.number().int().positive().optional().meta({ description: 'ADR 0027: vendor bank account id (vendor-payment picker value) instead of `account`. Draft: an account of the request PT and of its chosen vendor (or readable); submitted → the snapshot.' }),
    payeeCompany: z.coerce.number().int().positive().optional().meta({ description: 'ADR 0028: receiving PT (PT grup picker value): its designated receiving account, always masked before submit (Finance / PM / Direktur only); submitted → the snapshot.' }),
    reveal: z.enum(['1']).optional().meta({ description: '1 = include the full number when `canReveal` (creator/requesters, Finance/Direktur/Admin of the PT — same rule as the detail DTO).' }),
  })
  .meta({ id: 'BankPreviewQuery' })

export const BankPreview = z
  .object({
    source: z.enum(['account', 'snapshot']),
    bankName: z.string().nullable(),
    accountHolder: z.string().nullable(),
    accountNoMasked: z.string().nullable().meta({ description: '"••••1234"' }),
    canReveal: z.boolean(),
    accountNo: z.string().optional().meta({ description: 'Only with reveal=1 and canReveal.' }),
  })
  .meta({ id: 'BankPreview' })

export const PdfQuery = z.object({ variant: z.enum(['standard', 'internal']).optional().meta({ description: 'internal = with receipt validation flags (Finance/Owner/Admin).' }) }).meta({ id: 'PdfQuery' })

/** MC2/MC3: short reference of a PT (queue rows). */
export const CompanyRef = z.object({ id, shortCode: z.string(), name: z.string() }).meta({ id: 'CompanyRef' })

/** `?company=` of GET endpoints without another query (queues). */
export const CompanyFilterQuery = z.object({ company: companyFilterParam }).meta({ id: 'CompanyFilterQuery' })

/** GET /lpj-queue (US-21, MC3-1). */
export const LpjQueue = z
  .object({
    items: z.array(
      z.object({
        id,
        company: CompanyRef.nullable(),
        docNo: z.string().nullable(),
        type: RequestTypeEnum,
        typeLabel: z.string(),
        status: RequestStatusEnum,
        statusLabel: z.string(),
        title: z.string(),
        scope: z.string(),
        requesters: z.string(),
        grandTotal: rupiah,
        approvedAmount: rupiah.nullable(),
        neededDate: z.string().nullable(),
        requestDate: z.string().nullable(),
        transferredTotal: rupiah,
      }),
    ),
  })
  .meta({ id: 'LpjQueue' })

export const ApprovalInbox = z
  .object({
    budgetWarnPct: z.number().meta({ description: 'Display default = the caller\'s only / lowest selected PT (MC4). Each item carries its own PT\'s threshold (items[].budget.warnPct).' }),
    items: z.array(
      z.object({
        id,
        company: CompanyRef.nullable().meta({ description: 'MC2/MC3: PT of the request.' }),
        docNo: z.string().nullable(),
        type: RequestTypeEnum,
        typeLabel: z.string(),
        status: RequestStatusEnum,
        statusLabel: z.string(),
        title: z.string(),
        scope: z.string().meta({ description: 'Project or cost center code + name.' }),
        requesters: z.string().meta({ description: '"Diajukan Oleh" names joined with ", ".' }),
        grandTotal: rupiah,
        approvedAmount: rupiah.nullable(),
        neededDate: z.string().nullable(),
        requestDate: z.string().nullable(),
        step: z.enum(['acknowledge', 'approve']),
        level: z.number().int().nullable(),
        stepLabel: z.string().meta({ description: 'ADR 0021: "Persetujuan PM" | "Persetujuan Direktur"; ADR 0013: "Persetujuan Direktur (Diketahui)" | "Approval level n" (legacy PM step: "Diketahui Oleh").' }),
        decisionFlow: z.boolean().meta({ description: 'ADR 0013/0021 decision flow (acknowledge = an approval, button "Setujui"); false = pre-E1 snapshot.' }),
        decisionBy: z.enum(['pm', 'direktur', 'owner', 'finance', 'other']).meta({ description: 'ADR 0021: who decides this step (APK decision sheet texts): pm = PM project, direktur, owner (ADR 0026: the Owner level above the Direktur), finance, other (named user / legacy).' }),
        finalStep: z.boolean().meta({ description: 'ADR 0021: approving this step makes the request "Disetujui" (Finance then transfers / verifies receipts).' }),
        fundShort: rupiah.nullable().meta({ description: 'ADR 0029: "Dana kurang Rp X" — the gap of a final-step row of a PT with the fund check on (Kas roles of the PT); null when enough / not applicable. Approving it is refused (409 FUND_INSUFFICIENT).' }),
        selfApproval: z.enum(['direktur_via_pm', 'direktur_via_pm_self']).nullable().meta({ description: 'ADR 0021 narrow G1 exception (a Direktur\'s request filed by the PM project; _self = the requester Direktur is the PT\'s only Direktur). Legacy since ADR 0024 (a request without approval never reaches the inbox).' }),
        budget: z.object({
          basis: z.enum(['project', 'none']),
          pctBefore: z.number().nullable(),
          pctAfter: z.number().nullable(),
          overWarn: z.boolean(),
          warnPct: z.number().meta({ description: 'MC2: budgetWarnPct of the request\'s PT (overWarn = pctAfter > warnPct).' }),
        }),
        flags: z.object({ warning: z.number().int(), info: z.number().int(), receiptMismatch: z.number().int().meta({ description: 'D3: lines with "Selisih nota" (receipt_amount_mismatch, open or reviewed).' }) }),
      }),
    ),
  })
  .meta({ id: 'ApprovalInbox' })
