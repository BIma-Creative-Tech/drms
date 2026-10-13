import { z } from 'zod'

import { SHORTFALL_APPROVAL_STATUSES } from '@/domain/expense/settlement-rules'

/**
 * /api/v1 contract of the LPJ shortfall re-approval (QA-06, ADR 0019) — web only (the APK inbox is
 * unchanged). Amounts are integer Rupiah. Pure module (bundled by scripts/gen-openapi.mjs).
 */
const id = z.number().int().positive()
const rupiah = z.number().int()
const note = z.string({ error: 'Alasan wajib diisi.' }).trim().min(3, 'Alasan wajib diisi, minimal 3 karakter.').max(1000, 'Alasan maksimal 1000 karakter.')

export const ShortfallApprovalRequestBody = z
  .object({ note: note.meta({ description: 'Why the receipts exceed the approved amount (shown to the deciders).' }) })
  .strict()
  .meta({ id: 'ShortfallApprovalRequestBody' })

export const ShortfallDecisionBody = z
  .object({ signatureMediaId: id.nullable().optional().meta({ description: 'Captured signature (own media-signatures upload); default = profile signature (required to approve).' }) })
  .strict()
  .meta({ id: 'ShortfallDecisionBody' })

export const ShortfallRejectBody = z
  .object({ reason: note, signatureMediaId: id.nullable().optional() })
  .strict()
  .meta({ id: 'ShortfallRejectBody' })

export const ShortfallApproval = z
  .object({
    approvedAmount: rupiah,
    tolerancePct: z.number().meta({ description: 'companies.shortfallTolerancePct of the request PT (default 10).' }),
    limit: rupiah.meta({ description: 'approved + ⌊approved × tolerance / 100⌋: highest total transfer without re-approval.' }),
    totalAfter: rupiah.meta({ description: 'Transferred total after paying the shortfall.' }),
    aboveTolerance: z.boolean(),
    settleAllowed: z.boolean().nullable().meta({ description: 'LPJ verified: may the shortfall be paid now (within tolerance or approved)? null when not verified.' }),
    status: z.enum(SHORTFALL_APPROVAL_STATUSES).nullable(),
    statusLabel: z.string().nullable(),
    noApproval: z.boolean().meta({ description: 'ADR 0024 / 0025: the shortfall of a Direktur\'s (older requests) or the Owner\'s own request was approved without a decision (kebijakan PT; audited; statusLabel names which).' }),
    amount: rupiah.nullable().meta({ description: 'Total transfer the (last) re-approval is about.' }),
    cycle: z.number().int(),
    level: z.number().int().nullable(),
    note: z.string().nullable(),
    rejectReason: z.string().nullable(),
    allowedActions: z.array(z.enum(['acknowledge', 'approve', 'reject'])).meta({ description: 'UI hint for the caller; the server re-checks.' }),
    decisions: z.array(
      z.object({
        cycle: z.number().int(),
        position: z.enum(['diketahui', 'approval']),
        level: z.number().int(),
        actorName: z.string().nullable(),
        decision: z.enum(['acknowledged', 'approved', 'rejected']),
        reason: z.string().nullable(),
        decidedAt: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'ShortfallApproval', description: 'QA-06 / ADR 0019: LPJ shortfall vs approved amount + tolerance, and its re-approval (Direktur → Finance).' })

export const ShortfallInbox = z
  .object({
    items: z.array(
      z.object({
        requestId: id,
        companyId: id.nullable(),
        docNo: z.string().nullable(),
        title: z.string(),
        lpjNo: z.string().nullable(),
        settlementId: id,
        step: z.enum(['acknowledge', 'approve']),
        stepLabel: z.string(),
        approvedAmount: rupiah,
        transferredTotal: rupiah,
        shortfall: rupiah,
        totalAfter: rupiah,
        tolerancePct: z.number(),
        limit: rupiah,
        note: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'ShortfallInbox' })
