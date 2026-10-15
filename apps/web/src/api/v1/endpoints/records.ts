import type { Endpoint } from 'payload'

import { cancelProject, projectCancelPlan } from '@/domain/projects/cancel'
import { softDeleteEntry } from '@/domain/soft-delete/registry'
import { deleteCheck, RecordError, restoreDeleted, softDelete } from '@/domain/soft-delete/service'
import { withReqTransaction } from '@/lib/system-tx'

import { HttpError, json, v1 } from '../http'
import { RecordReason } from '../schemas-records'

/**
 * D1610 (ADR 0030, owner 2026-10-16): the row actions of the admin tables.
 * - GET  /records/{collection}/{id}/delete-check — what "Hapus" would do (usage lines, the action for the caller);
 * - POST /records/{collection}/{id}/delete       — soft delete (reason; unused rows / never-submitted drafts only);
 * - POST /records/{collection}/{id}/restore      — Admin "Pulihkan" (reason);
 * - GET  /projects/{id}/cancel-plan               — dry run of "Batalkan proyek" (what is cancelled / what blocks);
 * - POST /projects/{id}/cancel                    — status Dibatalkan + cascade, ONE transaction (409 + list when blocked).
 * Mutations: transactional, Idempotency-Key honoured, 30/min per user. Permissions live in the domain services.
 */
const WRITE_LIMIT: [number, number] = [30, 60_000]

function idParam(params: Record<string, string>): number {
  const v = params.id ?? ''
  if (!/^\d{1,10}$/.test(v)) throw new HttpError(404, 'Not Found')
  return Number(v)
}

function collectionParam(params: Record<string, string>): string {
  const c = params.collection ?? ''
  if (!softDeleteEntry(c)) throw new HttpError(404, 'Not Found', { detail: 'Data ini tidak dapat dihapus lewat aksi Hapus.' })
  return c
}

const TITLES: Record<number, string> = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict' }

/** Domain refusal → problem+json with its code and lists (`usage`, `blocking`), rolled back by the wrapper. */
async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof RecordError) throw new HttpError(err.status, TITLES[err.status] ?? 'Request rejected', { detail: err.message, code: err.pkCode, ...err.pkDetails })
    throw err
  }
}

export const deleteCheckEndpoint = v1({
  path: '/records/:collection/:id/delete-check',
  method: 'get',
  handler: async ({ req, params }) => {
    const c = collectionParam(params)
    const id = idParam(params)
    return json(await withReqTransaction(req, () => mapped(() => deleteCheck(req, c, id))))
  },
})

export const softDeleteEndpoint = v1({
  path: '/records/:collection/:id/delete',
  method: 'post',
  body: RecordReason,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => json(await mapped(() => softDelete(req, collectionParam(params), idParam(params), body.reason))),
})

export const restoreEndpoint = v1({
  path: '/records/:collection/:id/restore',
  method: 'post',
  body: RecordReason,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => json(await mapped(() => restoreDeleted(req, collectionParam(params), idParam(params), body.reason))),
})

export const projectCancelPlanEndpoint = v1({
  path: '/projects/:id/cancel-plan',
  method: 'get',
  handler: async ({ req, params }) => {
    const id = idParam(params)
    return json(await withReqTransaction(req, () => mapped(() => projectCancelPlan(req, id))))
  },
})

export const projectCancelEndpoint = v1({
  path: '/projects/:id/cancel',
  method: 'post',
  body: RecordReason,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => json(await mapped(() => cancelProject(req, idParam(params), body.reason))),
})

export const RECORD_ENDPOINTS: Endpoint[] = [deleteCheckEndpoint, softDeleteEndpoint, restoreEndpoint, projectCancelPlanEndpoint, projectCancelEndpoint]
