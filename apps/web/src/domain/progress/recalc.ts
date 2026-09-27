import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { getRequestTx } from '@/lib/tx'

import { projectProgress, round2, weightSum } from './rules'

/**
 * Stage % and project physical progress (G11, requirements §1 #7): the ONLY writers of
 * `project_stages.progress_pct` and `projects.progress_pct`. Both run inside the business
 * transaction of the progress report / stage editor, through the Local API so the audit hooks write
 * the before → after rows in the same transaction. The DB guard (migration e4_progress_reports,
 * `pk_progress_guard`) rejects any other change of these columns: it only lets a change through while
 * the transaction-local setting `pk.progress_write` is 'on', which is set here around each write.
 */

export const CTX_PROGRESS_WRITE = 'pkProgressWrite'
export const CTX_STAGE_EDITOR = 'pkStageEditor'

async function withProgressWrite<T>(req: PayloadRequest, fn: () => Promise<T>): Promise<T> {
  const tx = await getRequestTx(req)
  await tx.execute(sql`SELECT set_config('pk.progress_write', 'on', true)`)
  req.context[CTX_PROGRESS_WRITE] = true
  try {
    return await fn()
  } finally {
    delete req.context[CTX_PROGRESS_WRITE]
    await tx.execute(sql`SELECT set_config('pk.progress_write', 'off', true)`)
  }
}

export type StageRow = { id: number; project: number; name: string; weightPct: number; sequence: number; progressPct: number; active: boolean }

/** Stages of a project (SYSTEM-READ, ordered by sequence then id). */
export async function projectStages(req: PayloadRequest, projectId: number): Promise<StageRow[]> {
  const res = await req.payload.find({
    collection: 'project-stages',
    where: { project: { equals: projectId } },
    depth: 0,
    pagination: false,
    sort: 'sequence',
    overrideAccess: true, // SYSTEM-READ: weights/progress of the project (caller checked by the service)
    req,
  })
  return (res.docs as unknown as Array<Record<string, unknown>>).map((d) => ({
    id: d.id as number,
    project: projectId,
    name: String(d.name ?? ''),
    weightPct: Number(d.weightPct ?? 0),
    sequence: Number(d.sequence ?? 0),
    progressPct: Number(d.progressPct ?? 0),
    active: d.active !== false,
  }))
}

/** Row lock on the project: serialises reports / stage edits / recalculations of one project. */
export async function lockProject(req: PayloadRequest, projectId: number): Promise<void> {
  const tx = await getRequestTx(req)
  await tx.execute(sql`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`)
}

export async function setStageProgress(req: PayloadRequest, stageId: number, pct: number): Promise<void> {
  await withProgressWrite(req, () =>
    req.payload.update({
      collection: 'project-stages',
      id: stageId,
      data: { progressPct: round2(pct) },
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: stage % only through a progress report (G11)
      req,
    }),
  )
}

/**
 * Recalculates `projects.progress_pct` = Σ(weight × stage %) / 100 over active stages. Writes (and
 * audits) only when the value changes. Returns before/after and the active weight sum.
 */
export async function recalcProjectProgress(req: PayloadRequest, projectId: number): Promise<{ before: number; after: number; weightSum: number }> {
  const stages = await projectStages(req, projectId)
  const project = (await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, overrideAccess: true /* SYSTEM-READ: current progress */, req })) as {
    progressPct?: number | null
  }
  const before = Number(project.progressPct ?? 0)
  const after = projectProgress(stages)
  if (round2(before) !== after) {
    await withProgressWrite(req, () =>
      req.payload.update({
        collection: 'projects',
        id: projectId,
        data: { progressPct: after },
        depth: 0,
        overrideAccess: true, // SYSTEM-WRITE: project physical progress from stage weights (G11)
        req,
      }),
    )
  }
  return { before, after, weightSum: weightSum(stages) }
}
