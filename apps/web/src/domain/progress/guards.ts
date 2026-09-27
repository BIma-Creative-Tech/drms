import { APIError, type CollectionAfterChangeHook, type CollectionBeforeChangeHook, type CollectionBeforeOperationHook, type CollectionSlug } from 'payload'

import { relId } from '@/access/roles'

import { CTX_PROGRESS_WRITE, CTX_STAGE_EDITOR, projectStages, recalcProjectProgress } from './recalc'
import { collectionWeightError, round2, weightSum } from './rules'

/**
 * Collection hooks of `projects` / `project-stages` for E4 (G11, requirements §1 #7).
 */

/**
 * `progressPct` only changes through progress reports: Payload silently drops a field whose
 * `access.update` is false, so an explicit REST/admin write of a DIFFERENT value is rejected here
 * (403) before field access runs. The recalculation service sets `req.context.pkProgressWrite`.
 * Last line of defence: DB trigger `pk_progress_guard` (migration e4_progress_reports).
 */
export function progressWriteGuard(slug: CollectionSlug): CollectionBeforeOperationHook {
  return async ({ args, operation, req }) => {
    if (operation !== 'create' && operation !== 'update') return args
    if (req.context?.[CTX_PROGRESS_WRITE]) return args
    const a = args as { data?: Record<string, unknown>; id?: number | string }
    const data = a.data
    if (!data || !('progressPct' in data) || data.progressPct === undefined || data.progressPct === null) return args
    const wanted = Number(data.progressPct)
    let current = 0
    if (operation === 'update') {
      if (a.id === undefined) throw new APIError('Progress hanya berubah lewat laporan progress.', 403, null, true)
      const doc = (await req.payload.findByID({ collection: slug, id: a.id, depth: 0, overrideAccess: true /* SYSTEM-READ: compare the stored value */, req, disableErrors: true })) as {
        progressPct?: number | null
      } | null
      current = Number(doc?.progressPct ?? 0)
    }
    if (!Number.isFinite(wanted) || round2(wanted) !== round2(current)) {
      throw new APIError('Progress hanya berubah lewat laporan progress (bukan diedit langsung).', 403, null, true)
    }
    return args
  }
}

/**
 * G11 for single-stage writes through the collection (admin panel / REST): an incomplete stage set
 * may grow up to 100 %, a complete set must stay 100 % (use the stage editor to re-weight). The stage
 * editor itself validates the whole set and sets `req.context.pkStageEditor`.
 */
export const stageWeightGuard: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  if (req.context?.[CTX_STAGE_EDITOR] || req.context?.[CTX_PROGRESS_WRITE]) return data
  if (operation !== 'create' && operation !== 'update') return data
  const merged = { ...(originalDoc ?? {}), ...data } as Record<string, unknown>
  const project = relId(merged.project)
  if (project === undefined) return data
  const weightChanged =
    operation === 'create' ||
    Number(merged.weightPct ?? 0) !== Number(originalDoc?.weightPct ?? 0) ||
    (merged.active !== false) !== (originalDoc?.active !== false)
  if (!weightChanged) return data
  const others = (await projectStages(req, project)).filter((s) => s.id !== originalDoc?.id)
  const before = weightSum([...others, ...(originalDoc ? [{ weightPct: Number(originalDoc.weightPct ?? 0), active: originalDoc.active !== false }] : [])])
  const after = weightSum([...others, { weightPct: Number(merged.weightPct ?? 0), active: merged.active !== false }])
  const message = collectionWeightError(before, after)
  if (message) throw new APIError(message, 400, { errors: [{ path: 'weightPct', message }] }, true)
  return data
}

/** A weight/active change of a stage changes the project progress → recalculated in the same transaction. */
export const stageRecalcHook: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (req.context?.[CTX_STAGE_EDITOR] || req.context?.[CTX_PROGRESS_WRITE]) return doc
  const project = relId((doc as { project?: unknown }).project)
  if (project === undefined) return doc
  const prev = (previousDoc ?? {}) as { weightPct?: number | null; active?: boolean | null }
  const cur = doc as { weightPct?: number | null; active?: boolean | null }
  const changed = operation === 'create' || Number(prev.weightPct ?? 0) !== Number(cur.weightPct ?? 0) || (prev.active !== false) !== (cur.active !== false)
  if (changed) await recalcProjectProgress(req, project)
  return doc
}
