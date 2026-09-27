import { z } from 'zod'

/**
 * /api/v1 contract for the F2a expense-request flow (T1–T4, T6–T8, period closing).
 * Money = integer Rupiah; business dates = 'YYYY-MM-DD' (company TZ); server timestamps ISO-8601 UTC.
 * Pure module (bundled by scripts/gen-openapi.mjs).
 */
const id = z.number().int().positive()
const rupiah = z.number().int().min(0).max(1e13)
const rupiahPos = z.number().int().min(1).max(1e13)
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

export const RequestTypeEnum = z.enum(['advance', 'reimburse']).meta({ id: 'RequestType', description: 'advance = Uang Muka, reimburse = Reimburse' })
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
  ])
  .meta({ id: 'RequestAction' })

export const LineInput = z
  .object({
    id: z.string().max(64).optional().meta({ description: 'Existing line id (keep to update a line in place; omit for new lines).' }),
    description: z.string().max(500).optional(),
    qty: qty.nullable().optional(),
    uomId: id.nullable().optional(),
    unitPrice: rupiah.nullable().optional().meta({ description: 'Informational only — never used to compute the total (Q-05).' }),
    total: rupiahPos.nullable().optional().meta({ description: 'PRIMARY value entered by the user (may be rounded from the receipt).' }),
    notes: z.string().max(500).nullable().optional(),
    categoryId: id.nullable().optional(),
    vehicleId: id.nullable().optional(),
  })
  .strict()
  .meta({ id: 'ExpenseLineInput' })

const draftFields = {
  title: z.string().trim().min(1).max(200),
  projectId: id.nullable().optional(),
  costCenterId: id.nullable().optional(),
  neededDate: businessDate.nullable().optional(),
  periodFrom: businessDate.nullable().optional(),
  periodTo: businessDate.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  requesterIds: z.array(id).max(20).optional().meta({ description: '"Diajukan Oleh" in order (default: the caller\'s employee).' }),
  bankAccountId: id.nullable().optional().meta({ description: 'employee-bank-accounts id of one of the requesters (Q-11).' }),
  lines: z.array(LineInput).max(200).optional(),
  attachmentIds: z.array(id).max(20).optional(),
}

export const ExpenseRequestCreate = z
  .object({
    type: RequestTypeEnum,
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

export const TransferCreate = z
  .object({
    cashAccountId: id,
    bankRef: z.string().trim().min(1).max(64),
    proofMediaId: id.meta({ description: 'media-transfer-proofs id (POST /media/transfer-proofs).' }),
    transferDate: businessDate.optional(),
    amount: rupiahPos.optional().meta({ description: 'Optional echo; must equal the approved amount (Finance cannot change it, G3).' }),
  })
  .strict()
  .meta({ id: 'TransferCreate' })

export const ListQuery = z
  .object({
    scope: z.enum(['mine', 'team', 'inbox', 'all']).default('all'),
    status: z.string().regex(/^[a-z_]+(,[a-z_]+)*$/).optional(),
    type: RequestTypeEnum.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(64).optional(),
  })
  .meta({ id: 'ExpenseRequestListQuery' })

const Ref = z.object({ id, code: z.string().nullish(), name: z.string().nullish() }).meta({ id: 'Ref' })

export const ExpenseRequestListItem = z
  .object({
    id,
    docNo: z.string().nullable(),
    type: RequestTypeEnum,
    typeLabel: z.string(),
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
    openWarningFlags: z.number().int().optional(),
  })
  .meta({ id: 'ExpenseRequestListItem' })

export const ExpenseRequestList = z
  .object({ items: z.array(ExpenseRequestListItem), nextCursor: z.string().nullable() })
  .meta({ id: 'ExpenseRequestList' })

export const ExpenseRequestDetail = ExpenseRequestListItem.extend({
  uuid: z.string().nullable(),
  project: Ref.nullable(),
  costCenter: Ref.nullable(),
  periodFrom: z.string().nullable(),
  periodTo: z.string().nullable(),
  notes: z.string().nullable(),
  requesters: z.array(Ref.nullable()),
  createdBy: z.object({ id, name: z.string().nullish() }).nullable(),
  bankAccountId: id.nullable(),
  bank: z
    .object({ bankName: z.string().nullable(), accountNo: z.string().nullable().meta({ description: 'Masked (last 4) unless own request or Finance/Owner/Admin.' }), accountHolder: z.string().nullable() })
    .nullable(),
  lines: z.array(
    z.object({
      id: z.string(),
      no: z.number().int(),
      description: z.string().nullable(),
      qty: z.number().nullable(),
      uom: Ref.nullable(),
      unitPrice: rupiah.nullable(),
      unitPriceDisplay: rupiah.nullable().meta({ description: 'unitPrice, else total ÷ qty (display only).' }),
      total: rupiah,
      notes: z.string().nullable(),
      category: Ref.nullable(),
      vehicle: z.object({ id, plateNo: z.string().nullish(), plateDisplay: z.string().nullish(), type: z.string().nullish() }).nullable(),
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
      acknowledgeBy: z.enum(['scope_manager', 'role', 'user']).meta({ description: 'scope_manager only on pre-E1 snapshots (PM "Diketahui").' }),
      acknowledgeRole: z.string().nullable().meta({ description: 'ADR 0013: pk-owner (label "Direktur") when "Diketahui" is the Direktur approval.' }),
      decisionRoles: z.array(z.string()).meta({ description: 'ADR 0013: roles that may acknowledge/approve/reject ([pk-owner, pk-finance]); empty = pre-E1 snapshot (old guards).' }),
      skipped: z
        .array(z.object({ position: z.enum(['diketahui', 'approval']), level: z.number().int(), role: z.string().nullable(), userId: id.nullable(), reason: z.string() }))
        .meta({ description: 'ADR 0013 G1-2: positions skipped at submit because their only holders are requester/creator — show "(tidak berlaku — pemohon)".' }),
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
      signatureId: id.nullable(),
      signatureSha256: z.string().nullable(),
      signatureSource: z.string().nullable(),
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
      kind: z.enum(['amount_diff', 'date_after_request', 'date_too_old', 'date_out_of_period', 'uom_suspicious', 'duplicate']),
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
      transferredTotal: rupiah.nullable(),
      receiptsTotal: rupiah.nullable().meta({ description: 'Σ active receipts at the last LPJ submit.' }),
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
    })
    .nullable()
    .meta({ id: 'Settlement', description: 'T5 LPJ (Uang Muka only; null before "Nota Lengkap").' }),
  budget: z
    .object({ basis: z.enum(['project', 'none']), pctBefore: z.number().nullable(), pctAfter: z.number().nullable() })
    .meta({ description: 'US-26 preview (committed % before → after); cost centers: "none" (Q-24).' }),
  openWarningFlags: z.number().int(),
  allowedActions: z.array(ActionEnum).meta({ description: 'UI hint; the server re-checks every action.' }),
  resubmitOfId: id.nullable(),
  resubmitOf: z.object({ id, docNo: z.string().nullable(), title: z.string() }).nullable(),
  submittedAt: z.string().nullable(),
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

export const LpjSubmitBody = z
  .object({ usageNotes: z.string().trim().min(3).max(2000).optional().meta({ description: 'Required at the first submit; kept on resubmit when omitted.' }) })
  .strict()
  .meta({ id: 'LpjSubmitBody' })

export const RevisionBody = z.object({ note }).strict().meta({ id: 'LpjRevisionBody' })

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
  })
  .strict()
  .meta({ id: 'CashEntryUpdate', description: 'Manual entries of an open period only; amount/date/account changes = void + new entry.' })

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
    sourceType: z.enum(['transfer', 'settlement_refund', 'manual', 'reversal', 'opening']),
    expenseRequestId: id.nullable(),
    transferId: id.nullable(),
    status: z.enum(['posted', 'void']),
    reversalOfId: id.nullable(),
    reversedById: id.nullable(),
    voidReason: z.string().nullable(),
    postedAt: z.string().nullable(),
  })
  .meta({ id: 'CashEntry' })

export const CashEntryList = z.object({ items: z.array(CashEntry), nextCursor: z.string().nullable() }).meta({ id: 'CashEntryList' })
export const CashListQuery = z
  .object({
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    cashAccountId: z.coerce.number().int().positive().optional(),
    projectId: z.coerce.number().int().positive().optional(),
    costCenterId: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(64).optional(),
  })
  .meta({ id: 'CashEntryListQuery' })

export const VoidResult = z.object({ original: CashEntry, reversal: CashEntry }).meta({ id: 'CashVoidResult' })

export const Balances = z
  .object({
    asOf: z.string().nullable(),
    items: z.array(z.object({ cashAccountId: id, name: z.string(), openingBalance: z.number().int(), totalIn: z.number().int(), totalOut: z.number().int(), balance: z.number().int() })),
  })
  .meta({ id: 'Balances' })

export const PeriodCloseBody = z
  .object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), note: z.string().max(500).optional() })
  .strict()
  .meta({ id: 'PeriodCloseBody' })

export const PeriodClosing = z
  .object({
    id,
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
export const PeriodClosingList = z.object({ lockDate: z.string().nullable(), items: z.array(PeriodClosing) }).meta({ id: 'PeriodClosingList' })

export const TransferResult = z
  .object({
    request: ExpenseRequestDetail,
    transferId: id,
    transferDocNo: z.string(),
    cashEntryId: id,
    cashEntryNo: z.string(),
  })
  .meta({ id: 'TransferResult' })

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
export const PdfQuery = z.object({ variant: z.enum(['standard', 'internal']).optional().meta({ description: 'internal = with receipt validation flags (Finance/Owner/Admin).' }) }).meta({ id: 'PdfQuery' })

export const ApprovalInbox = z
  .object({
    budgetWarnPct: z.number(),
    items: z.array(
      z.object({
        id,
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
        stepLabel: z.string().meta({ description: 'ADR 0013: "Persetujuan Direktur (Diketahui)" | "Approval level n" (legacy PM step: "Diketahui Oleh").' }),
        decisionFlow: z.boolean().meta({ description: 'ADR 0013 Direktur → Finance request (acknowledge = the Direktur approval, button "Setujui"); false = pre-E1 snapshot.' }),
        budget: z.object({ basis: z.enum(['project', 'none']), pctBefore: z.number().nullable(), pctAfter: z.number().nullable(), overWarn: z.boolean() }),
        flags: z.object({ warning: z.number().int(), info: z.number().int() }),
      }),
    ),
  })
  .meta({ id: 'ApprovalInbox' })
