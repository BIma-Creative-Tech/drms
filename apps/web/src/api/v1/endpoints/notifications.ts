import type { PayloadRequest, Where } from 'payload'

import { relId, userId } from '@/access/roles'

import { companyQuery } from '../company-query'

import { HttpError, json, v1 } from '../http'
import { NotificationQuery } from '../schemas-flow'

/**
 * In-app notifications of the CALLER only (architecture §6.3 `GET /notifications`,
 * `POST /notifications/{id}/read`; ADR 0011 §3 fetch by uuid). Reads use the collection access
 * (own rows, overrideAccess:false); another user's notification is a 404.
 */
type Row = { id: number; uuid: string; event: string; title: string; body: string; docType?: string | null; docId?: string | null; docNo?: string | null; readAt?: string | null; createdAt: string; company?: unknown }

const dto = (n: Row) => ({
  id: n.id,
  uuid: n.uuid,
  event: n.event,
  title: n.title,
  body: n.body,
  docType: n.docType ?? null,
  docId: n.docId ?? null,
  docNo: n.docNo ?? null,
  readAt: n.readAt ?? null,
  createdAt: n.createdAt,
  companyId: relId(n.company) ?? null, // MC3 (MC2: rows carry the PT of their document)
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `{id}` = numeric id or uuid (FCM data payload carries the uuid, ADR 0011 §3). */
async function findOwn(req: PayloadRequest, key: string): Promise<Row> {
  let where: Where
  if (/^\d{1,10}$/.test(key)) where = { id: { equals: Number(key) } }
  else if (UUID.test(key)) where = { uuid: { equals: key.toLowerCase() } }
  else throw new HttpError(404, 'Not Found')
  const res = await req.payload.find({ collection: 'notifications', where, limit: 1, depth: 0, user: req.user, overrideAccess: false, req })
  const n = res.docs[0] as unknown as Row | undefined
  if (!n) throw new HttpError(404, 'Not Found')
  return n
}

async function unreadCount(req: PayloadRequest): Promise<number> {
  const r = await req.payload.count({
    collection: 'notifications',
    where: { and: [{ user: { equals: userId(req)! } }, { readAt: { exists: false } }] },
    user: req.user,
    overrideAccess: false,
    req,
  })
  return r.totalDocs
}

export const listNotificationsEndpoint = v1({
  path: '/notifications',
  method: 'get',
  handler: async ({ req }) => {
    const q = NotificationQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) throw new HttpError(400, 'Bad Request', { errors: q.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
    const { unread, limit, cursor } = q.data
    const and: Where[] = [{ user: { equals: userId(req)! } }]
    if (unread === 'true') and.push({ readAt: { exists: false } })
    // MC3: own rows are never filtered by the selection (a notification is the user's); ?company= narrows
    const companies = await companyQuery(req)
    if (companies) and.push({ company: { in: companies } })
    if (cursor) {
      const n = Number(Buffer.from(cursor, 'base64url').toString('utf8'))
      if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, 'Bad Request', { detail: 'cursor tidak valid.' })
      and.push({ id: { less_than: n } })
    }
    const res = await req.payload.find({ collection: 'notifications', where: { and }, sort: '-id', limit: limit + 1, depth: 0, user: req.user, overrideAccess: false, req })
    const docs = res.docs as unknown as Row[]
    const page = docs.slice(0, limit)
    const nextCursor = docs.length > limit ? Buffer.from(String(page[page.length - 1]!.id)).toString('base64url') : null
    return json({ items: page.map(dto), unreadCount: await unreadCount(req), nextCursor })
  },
})

export const getNotificationEndpoint = v1({
  path: '/notifications/:id',
  method: 'get',
  handler: async ({ req, params }) => json(dto(await findOwn(req, params.id ?? ''))),
})

export const readNotificationEndpoint = v1({
  path: '/notifications/:id/read',
  method: 'post',
  rateLimit: [120, 60_000],
  transactional: true,
  handler: async ({ req, params }) => {
    const n = await findOwn(req, params.id ?? '')
    if (n.readAt) return json(dto(n)) // idempotent: read stays read (DB: read_at immutable once set)
    const updated = await req.payload.update({
      collection: 'notifications',
      id: n.id,
      data: { readAt: new Date().toISOString() } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: own row (found with overrideAccess:false above), readAt only
      req,
    })
    return json(dto(updated as unknown as Row))
  },
})

export const readAllNotificationsEndpoint = v1({
  path: '/notifications/read-all',
  method: 'post',
  rateLimit: [30, 60_000],
  transactional: true,
  handler: async ({ req }) => {
    const res = await req.payload.update({
      collection: 'notifications',
      where: { and: [{ user: { equals: userId(req)! } }, { readAt: { exists: false } }] },
      data: { readAt: new Date().toISOString() } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: the caller's own unread rows, readAt only
      req,
    })
    return json({ updated: res.docs.length })
  },
})

export const NOTIFICATION_ENDPOINTS = [listNotificationsEndpoint, readAllNotificationsEndpoint, getNotificationEndpoint, readNotificationEndpoint]
