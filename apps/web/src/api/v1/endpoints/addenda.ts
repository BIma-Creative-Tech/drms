import type { Endpoint } from 'payload'

import {
  acknowledgeAddendum,
  addendumDetail,
  addendumInbox,
  approveAddendum,
  cancelAddendum,
  createAddendum,
  editAddendum,
  listAddenda,
  loadVisibleAddendum,
  rejectAddendum,
  submitAddendum,
  type AddendumDoc,
} from '@/domain/addendum/service'
import { withReqTransaction } from '@/lib/system-tx'

import { HttpError, json, v1 } from '../http'
import { AddendumCreate, AddendumDecision, AddendumListQuery, AddendumReason, AddendumReject, AddendumUpdate } from '../schemas-addendum'

/**
 * E5 Addendum RAB (T12, US-18/US-30). Mutations: transactional + Idempotency-Key (mandatory for the
 * APK), 30/min per user like submit/approve (architecture §6.5). Role checks live in the domain
 * service (PM team creates; Direktur/Finance decide per the snapshotted rule, ADR 0013).
 */
const WRITE_LIMIT: [number, number] = [30, 60_000]

function idParam(params: Record<string, string>): number {
  const v = params.id ?? ''
  if (!/^\d{1,10}$/.test(v)) throw new HttpError(404, 'Not Found')
  return Number(v)
}

function decodeCursor(c: string | undefined): number | undefined {
  if (!c) return undefined
  const n = Number(Buffer.from(c, 'base64url').toString('utf8'))
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, 'Bad Request', { detail: 'cursor tidak valid.' })
  return n
}
const encodeCursor = (id: number) => Buffer.from(String(id)).toString('base64url')

type Req = Parameters<typeof addendumDetail>[0]
const detail = async (req: Req, doc: AddendumDoc, status = 200) => json(await addendumDetail(req, doc), status)

export const listAddendaEndpoint = v1({
  path: '/budget-addenda',
  method: 'get',
  handler: async ({ req }) => {
    const q = AddendumListQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) throw new HttpError(400, 'Bad Request', { errors: q.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) })
    const page = await withReqTransaction(req, () =>
      listAddenda(req, { projectId: q.data.project, status: q.data.status, mine: q.data.mine !== undefined, limit: q.data.limit, after: decodeCursor(q.data.cursor) }),
    )
    return json({ items: page.items, nextCursor: page.nextCursor === null ? null : encodeCursor(page.nextCursor) })
  },
})

/** Addenda waiting for the caller's decision (Direktur/Finance) — web inbox + APK. */
export const addendumInboxEndpoint = v1({
  path: '/budget-addenda/inbox',
  method: 'get',
  handler: async ({ req }) => json(await withReqTransaction(req, () => addendumInbox(req))),
})

export const getAddendumEndpoint = v1({
  path: '/budget-addenda/:id',
  method: 'get',
  handler: async ({ req, params }) => {
    const id = idParam(params)
    return withReqTransaction(req, async () => detail(req, await loadVisibleAddendum(req, id)))
  },
})

/** US-18: PM of the team creates a Draft (or submits at once with `submit: true`). */
export const createAddendumEndpoint = v1({
  path: '/budget-addenda',
  method: 'post',
  body: AddendumCreate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body }) => detail(req, await createAddendum(req, { projectId: body.projectId, addition: body.addition, reason: body.reason, submit: body.submit === true }), 201),
})

export const updateAddendumEndpoint = v1({
  path: '/budget-addenda/:id',
  method: 'patch',
  body: AddendumUpdate,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => detail(req, await editAddendum(req, idParam(params), body)),
})

export const submitAddendumEndpoint = v1({
  path: '/budget-addenda/:id/submit',
  method: 'post',
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, params }) => detail(req, await submitAddendum(req, idParam(params))),
})

export const cancelAddendumEndpoint = v1({
  path: '/budget-addenda/:id/cancel',
  method: 'post',
  body: AddendumReason,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => detail(req, await cancelAddendum(req, idParam(params), body.reason)),
})

/** Direktur "Setujui" (= "Diketahui", ADR 0013). */
export const acknowledgeAddendumEndpoint = v1({
  path: '/budget-addenda/:id/acknowledge',
  method: 'post',
  body: AddendumDecision,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => detail(req, await acknowledgeAddendum(req, idParam(params), { signatureMediaId: body.signatureMediaId ?? null })),
})

/** Finance approval; the last level increases projects.budget in the same transaction. */
export const approveAddendumEndpoint = v1({
  path: '/budget-addenda/:id/approve',
  method: 'post',
  body: AddendumDecision,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => detail(req, await approveAddendum(req, idParam(params), { signatureMediaId: body.signatureMediaId ?? null })),
})

export const rejectAddendumEndpoint = v1({
  path: '/budget-addenda/:id/reject',
  method: 'post',
  body: AddendumReject,
  rateLimit: WRITE_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => detail(req, await rejectAddendum(req, idParam(params), body.reason, { signatureMediaId: body.signatureMediaId ?? null })),
})

/** Order matters: `/budget-addenda/inbox` before `/budget-addenda/:id`. */
export const ADDENDUM_ENDPOINTS: Endpoint[] = [
  listAddendaEndpoint,
  addendumInboxEndpoint,
  getAddendumEndpoint,
  createAddendumEndpoint,
  updateAddendumEndpoint,
  submitAddendumEndpoint,
  cancelAddendumEndpoint,
  acknowledgeAddendumEndpoint,
  approveAddendumEndpoint,
  rejectAddendumEndpoint,
]
