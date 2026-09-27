import type { Endpoint } from 'payload'

import { officeScope } from '@/domain/reports/scope'
import { projectProgressVsBudget } from '@/domain/reports/progress'
import { listReports, reportDto } from '@/domain/progress/dto'
import { createReport, editReport, loadVisibleReport } from '@/domain/progress/reports'
import { loadStageSet, requireVisibleProject, saveStageSet } from '@/domain/progress/stages'
import { withReqTransaction } from '@/lib/system-tx'

import { HttpError, json, v1 } from '../http'
import { ProgressReportCreate, ProgressReportListQuery, ProgressReportUpdate, ProjectProgressQuery, StageSetBody } from '../schemas-progress'

/** Architecture §6.5: mutations 30/min per user (same bucket size as submit/approve). */
const WRITE_LIMIT: [number, number] = [30, 60_000]

function idParam(params: Record<string, string>, name = 'id'): number {
  const v = params[name] ?? ''
  if (!/^\d{1,10}$/.test(v)) throw new HttpError(404, 'Not Found')
  return Number(v)
}

function query<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } }, sp: URLSearchParams): T {
  const q = schema.safeParse(Object.fromEntries(sp.entries()))
  if (!q.success) throw new HttpError(400, 'Bad Request', { errors: q.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) })
  return q.data
}

function decodeCursor(c: string | undefined): number | undefined {
  if (!c) return undefined
  const n = Number(Buffer.from(c, 'base64url').toString('utf8'))
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, 'Bad Request', { detail: 'cursor tidak valid.' })
  return n
}
const encodeCursor = (id: number) => Buffer.from(String(id)).toString('base64url')

// ---------------------------------------------------------------- stages (G11, US-29)

/** GET /projects/{id}/stages — stage set of a project the caller may read (weights, stage %, total). */
export const getStagesEndpoint = v1({
  path: '/projects/:id/stages',
  method: 'get',
  handler: async ({ req, params }) => {
    const id = idParam(params)
    // No outer transaction: a denied/missing read inside Payload kills the request transaction.
    await requireVisibleProject(req, id)
    return json(await loadStageSet(req, id))
  },
})

/**
 * PUT /projects/{id}/stages — stage editor: saves the whole active set (total = 100 %, G11) in one
 * transaction and recalculates the project progress. Direktur: any project (add/deactivate); PM: team
 * projects (rename/reorder/re-weight). Reason required for weight changes / deactivation (G7).
 */
export const putStagesEndpoint = v1({
  path: '/projects/:id/stages',
  method: 'put',
  roles: ['pk-owner', 'pk-pm'],
  body: StageSetBody,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => json(await saveStageSet(req, idParam(params), body)),
})

// ---------------------------------------------------------------- progress reports (T11)

/** GET /progress-reports — US-31: newest first, filter project/stage/date, caller scope (PM team, Direktur/Finance all). */
export const listReportsEndpoint = v1({
  path: '/progress-reports',
  method: 'get',
  handler: async ({ req }) => {
    const q = query(ProgressReportListQuery, req.searchParams)
    {
      const page = await listReports(req, {
        projectId: q.project,
        stageId: q.stage,
        from: q.from,
        to: q.to,
        mine: q.mine !== undefined,
        limit: q.limit,
        after: decodeCursor(q.cursor),
      })
      return json({ items: page.items, nextCursor: page.nextCursor === null ? null : encodeCursor(page.nextCursor) })
    }
  },
})

export const getReportEndpoint = v1({
  path: '/progress-reports/:id',
  method: 'get',
  handler: async ({ req, params }) => {
    const id = idParam(params)
    return json(await reportDto(req, await loadVisibleReport(req, id)))
  },
})

/**
 * POST /progress-reports — US-10: PM of the project (team) or Direktur. Photos are uploaded first
 * (POST /media/progress-photos, ≤ 5). Stage % before → after and the project progress are updated in
 * the same transaction. A replayed clientUuid → 200 with the existing report.
 */
export const createReportEndpoint = v1({
  path: '/progress-reports',
  method: 'post',
  body: ProgressReportCreate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body }) => {
    const { doc, created } = await createReport(req, {
      projectId: body.projectId,
      stageId: body.stageId,
      pctAfter: body.pctAfter,
      work: body.work,
      issues: body.issues ?? null,
      photoIds: body.photoIds ?? [],
      clientUuid: body.clientUuid ?? null,
    })
    return json(await reportDto(req, doc), created ? 201 : 200)
  },
})

/** PATCH /progress-reports/{id} — reporter only, within 24 h, reason required (requirements §8 T11). */
export const updateReportEndpoint = v1({
  path: '/progress-reports/:id',
  method: 'patch',
  body: ProgressReportUpdate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const doc = await editReport(req, idParam(params), {
      pctAfter: body.pctAfter,
      work: body.work,
      issues: body.issues,
      addPhotoIds: body.addPhotoIds,
      reason: body.reason,
    })
    return json(await reportDto(req, doc))
  },
})

// ---------------------------------------------------------------- K-09 (US-12)

/** GET /projects/progress — K-09 progress fisik vs anggaran per project (Finance/Direktur all, PM team). */
export const projectProgressEndpoint = v1({
  path: '/projects/progress',
  method: 'get',
  roles: ['pk-finance', 'pk-owner', 'pk-pm'],
  rateLimit: [60, 60_000],
  handler: async ({ req }) => {
    const q = query(ProjectProgressQuery, req.searchParams)
    return withReqTransaction(req, async () => json(await projectProgressVsBudget(req, await officeScope(req), { projectId: q.project, includeArchived: q.arsip === 'ya' })))
  },
})

export const PROGRESS_ENDPOINTS: Endpoint[] = [
  projectProgressEndpoint,
  getStagesEndpoint,
  putStagesEndpoint,
  listReportsEndpoint,
  getReportEndpoint,
  createReportEndpoint,
  updateReportEndpoint,
]
