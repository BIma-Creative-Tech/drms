import { z } from 'zod'

import { ADDENDUM_ACTIONS, ADDENDUM_STATUSES, MAX_ADDITION } from '@/domain/addendum/rules'

/**
 * /api/v1 contract for E5 Addendum RAB (T12, US-18/US-30): web + APK (Direktur/Finance approve from
 * the phone). Amounts are integer Rupiah. Pure module (bundled by scripts/gen-openapi.mjs).
 */
const id = z.number().int().positive()
const rupiah = z.number().int()
const reason = z.string({ error: 'Alasan wajib diisi.' }).trim().min(3, 'Alasan wajib diisi, minimal 3 karakter.').max(1000, 'Alasan maksimal 1000 karakter.')

export const AddendumCreate = z
  .object({
    projectId: id,
    addition: z.number().int().positive().max(MAX_ADDITION).meta({ description: 'Tambahan RAB (Rp, > 0).' }),
    reason: reason.meta({ description: 'Alasan addendum (wajib).' }),
    submit: z.boolean().optional().meta({ description: 'true = ajukan langsung (tanpa tinggal di Draft).' }),
  })
  .strict()
  .meta({ id: 'BudgetAddendumCreate' })

export const AddendumUpdate = z
  .object({
    addition: z.number().int().positive().max(MAX_ADDITION).optional(),
    reason: reason.optional(),
  })
  .strict()
  .meta({ id: 'BudgetAddendumUpdate' })

export const AddendumReason = z.object({ reason }).strict().meta({ id: 'BudgetAddendumReason' })

export const AddendumDecision = z
  .object({ signatureMediaId: id.nullable().optional().meta({ description: 'Optional captured signature (media-signatures of the caller); else the profile signature, if any.' }) })
  .strict()
  .meta({ id: 'BudgetAddendumDecision' })

export const AddendumReject = z
  .object({ reason, signatureMediaId: id.nullable().optional() })
  .strict()
  .meta({ id: 'BudgetAddendumReject' })

export const AddendumListQuery = z
  .object({
    project: z.coerce.number().int().positive().optional(),
    status: z.enum(ADDENDUM_STATUSES).optional(),
    mine: z.enum(['1', 'true']).optional().meta({ description: 'Only addenda created by the caller.' }),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(64).optional(),
  })
  .meta({ id: 'BudgetAddendumListQuery' })

const status = z.enum(ADDENDUM_STATUSES)

export const AddendumSummary = z
  .object({
    id,
    uuid: z.string().nullable(),
    docNo: z.string().nullable().meta({ description: 'ADD/YYMM/#### (allocated at submit).' }),
    status,
    statusLabel: z.string(),
    stepLabel: z.string().nullable().meta({ description: 'Current decision step (Direktur / Finance level).' }),
    project: z.object({ id, code: z.string().nullable(), name: z.string().nullable(), budget: rupiah.nullable() }),
    addition: rupiah,
    reason: z.string(),
    budgetAtSubmit: rupiah.nullable(),
    oldBudget: rupiah.nullable().meta({ description: 'RAB re-read under lock at approval.' }),
    newBudget: rupiah.nullable().meta({ description: 'oldBudget + addition (set when approved).' }),
    createdBy: z.object({ id, name: z.string().nullable() }),
    submittedAt: z.string().nullable(),
    decidedAt: z.string().nullable(),
    rejectReason: z.string().nullable(),
    cancelReason: z.string().nullable(),
    currentLevel: z.number().int().nullable(),
    source: z.enum(['web', 'apk']).nullable(),
    createdAt: z.string().nullable(),
  })
  .meta({ id: 'BudgetAddendumSummary' })

export const AddendumDetail = AddendumSummary.extend({
  allowedActions: z.array(z.enum(ADDENDUM_ACTIONS)).meta({ description: 'What the caller may do now (edit/submit/cancel: creator PM; acknowledge = Direktur "Setujui"; approve = Finance; reject).' }),
  budget: z.object({
    current: rupiah,
    committed: rupiah.meta({ description: 'K-07 Komitmen of the project.' }),
    afterAddition: rupiah,
    committedPctBefore: z.number().nullable(),
    committedPctAfter: z.number().nullable(),
  }),
  approvalRule: z
    .object({ id, name: z.string(), acknowledgeRole: z.string().nullable(), levels: z.number().int(), skipped: z.array(z.object({ position: z.string(), level: z.number().int(), role: z.string().nullable(), userId: z.number().int().nullable(), reason: z.string() })) })
    .nullable(),
  decisions: z.array(
    z.object({
      id,
      position: z.enum(['diketahui', 'approval']),
      level: z.number().int(),
      actor: z.object({ id: id.nullable(), name: z.string().nullable() }),
      decision: z.enum(['acknowledged', 'approved', 'rejected']),
      reason: z.string().nullable(),
      decidedAt: z.string().nullable(),
      budgetPctBefore: z.number().nullable(),
      budgetPctAfter: z.number().nullable(),
      signatureSource: z.string().nullable(),
    }),
  ),
}).meta({ id: 'BudgetAddendumDetail' })

export const AddendumList = z.object({ items: z.array(AddendumSummary), nextCursor: z.string().nullable() }).meta({ id: 'BudgetAddendumList' })

export const AddendumInbox = z
  .object({
    items: z.array(
      AddendumSummary.extend({
        step: z.enum(['acknowledge', 'approve']).meta({ description: 'acknowledge → POST …/acknowledge (Direktur); approve → POST …/approve (Finance).' }),
        budget: z.object({ current: rupiah, afterAddition: rupiah, committedPctBefore: z.number().nullable(), committedPctAfter: z.number().nullable() }),
      }),
    ),
  })
  .meta({ id: 'BudgetAddendumInbox' })
