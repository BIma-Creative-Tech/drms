import { z } from 'zod'

import { REASON_MAX, REASON_MIN, SOFT_DELETE_SLUGS } from '@/domain/soft-delete/registry'

/**
 * D1610 (ADR 0030): /api/v1 contract of the row actions "Hapus" (soft delete), "Pulihkan" and "Batalkan proyek".
 * Web admin today; the APK can call the same endpoints later (none of them is needed for its current screens —
 * soft-deleted rows simply disappear from its lists and masters). Pure module (bundled by scripts/gen-openapi.mjs).
 */
const id = z.number().int().positive()

export const RecordReason = z
  .object({
    reason: z
      .string({ error: 'Alasan wajib diisi.' })
      .trim()
      .min(REASON_MIN, `Alasan wajib diisi, minimal ${REASON_MIN} karakter.`)
      .max(REASON_MAX, `Alasan maksimal ${REASON_MAX} karakter.`)
      .meta({ description: 'Alasan (wajib) — tercatat di audit log.' }),
  })
  .strict()
  .meta({ id: 'RecordReason' })

export const RecordCollection = z.enum([...SOFT_DELETE_SLUGS] as [string, ...string[]]).meta({ id: 'RecordCollection', description: 'Collection with a soft delete (ADR 0030).' })

export const RecordParams = z.object({ collection: RecordCollection, id: z.string().regex(/^\d+$/) })

export const UsageLine = z
  .object({ table: z.string(), label: z.string().meta({ description: 'e.g. "Pengajuan", "Kas".' }), count: z.number().int() })
  .meta({ id: 'RecordUsageLine' })

export const RowAction = z.enum(['hapus', 'batalkan', 'nonaktifkan', 'pulihkan']).nullable().meta({ id: 'RecordRowAction', description: 'hapus = soft delete allowed; batalkan = cancel instead (project / submitted request); nonaktifkan = used master (deactivate); pulihkan = deleted, the caller (Admin) may restore; null = nothing for this caller.' })

export const DeleteCheck = z
  .object({
    collection: z.string(),
    id,
    title: z.string(),
    deleted: z.boolean(),
    action: RowAction,
    canDelete: z.boolean(),
    canRestore: z.boolean(),
    blockedReason: z.string().nullable(),
    usage: z.array(UsageLine).meta({ description: 'Rows of other tables that reference this one (non-empty = used; Hapus refused).' }),
    deletedAt: z.string().nullable(),
    deleteReason: z.string().nullable(),
  })
  .meta({ id: 'RecordDeleteCheck' })

const PlanItem = z
  .object({
    kind: z.enum(['expense_request', 'budget_addendum', 'project_loan']),
    id,
    docNo: z.string().nullable(),
    title: z.string(),
    status: z.string(),
    statusLabel: z.string(),
    href: z.string().meta({ description: 'Admin page of the document.' }),
  })
  .meta({ id: 'ProjectCancelItem' })

const ProjectRef = z.object({ id, code: z.string(), name: z.string(), status: z.string(), companyId: id.nullable() })

export const ProjectCancelPlan = z
  .object({
    project: ProjectRef,
    allowed: z.boolean().meta({ description: 'The caller may cancel (Direktur / Admin of the PT; status Perencanaan / Berjalan / Ditunda).' }),
    notAllowedReason: z.string().nullable(),
    cancel: z.array(PlanItem).meta({ description: 'Cancelled together with the project (reason "Proyek dibatalkan: <alasan>").' }),
    blocking: z.array(PlanItem).meta({ description: 'In flight and not cancellable (transferred / LPJ / loan with a repayment) — the cancellation is refused (409) until they are settled.' }),
  })
  .meta({ id: 'ProjectCancelPlan' })

export const ProjectCancelResult = z
  .object({ project: ProjectRef.extend({ cancelReason: z.string() }), cancelled: z.array(PlanItem) })
  .meta({ id: 'ProjectCancelResult' })
