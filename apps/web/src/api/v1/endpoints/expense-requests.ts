import type { PayloadRequest, Where } from 'payload'

import { hasRole, membershipsOf, ownEmployees, relId, userId, type Role } from '@/access/roles'
import { resolveScope } from '@/access/scope'
import { writeAudit } from '@/audit/writer'
import { actorContext, displayName, loadRaw, loadVisible, type RequestDoc } from '@/domain/expense/common'
import { withReqTransaction } from '@/lib/system-tx'
import { createDraft, resubmitAsDraft, updateDraft } from '@/domain/expense/drafts'
import { duplicateAsDraft } from '@/domain/expense/duplicate'
import { withFlagVisibility } from '@/domain/expense/flag-visibility'
import { bankPreview } from '@/domain/expense/bank-preview'
import { detail, listItem } from '@/domain/expense/dto'
import { addReceipt, editReceipt, rejectReceipt, removeReceipt, resubmitReceipts, reviewFlag, verifyAllReceipts, verifyReceipt } from '@/domain/expense/receipts'
import { allowedActions } from '@/domain/expense/state'
import { recordTransfer, voidTransfer } from '@/domain/expense/transfers'
import { acknowledge, approve, cancel, complete, reject, submit, withdraw } from '@/domain/expense/workflow'
import { receiptsComplete, requestLpjRevision, reverseSettlement, setLpjPhotos, settle, submitLpj, verifyLpj } from '@/domain/expense/lpj'
import { requestHistory } from '@/domain/history'
import { approvalInbox, lpjQueue, officeQueueWhere, transferQueue } from '@/domain/expense/queues'
import { searchWhere } from '@/lib/text-search'
import { settlePrecheck } from '@/domain/expense/settle-precheck'

import { companyQuery } from '../company-query'

import { HttpError, json, problem, v1 } from '../http'
import { withNamedCompany } from '../named-company'
import {
  BankPreviewQuery,
  EmptyBody,
  ExpenseRequestCreate,
  ExpenseRequestUpdate,
  FlagReviewBody,
  ListQuery,
  LpjPhotosBody,
  LpjSubmitBody,
  PdfQuery,
  RevisionBody,
  SettleBody,
  ReasonBody,
  ReceiptCreate,
  ReceiptUpdate,
  RejectBody,
  SignBody,
  TransferCreate,
} from '../schemas-flow'

/** Architecture §6.5: submit/approve 30/min per user. */
const ACTION_LIMIT: [number, number] = [30, 60_000]

function idParam(params: Record<string, string>, name = 'id'): number {
  const v = params[name] ?? ''
  if (!/^\d{1,10}$/.test(v)) throw new HttpError(404, 'Not Found')
  return Number(v)
}

const ok = async (req: PayloadRequest, id: number, status = 200) => json(await detail(req, id), status)

// ---------------------------------------------------------------- list / detail / history

function decodeCursor(c: string | undefined): number | undefined {
  if (!c) return undefined
  const n = Number(Buffer.from(c, 'base64url').toString('utf8'))
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, 'Bad Request', { detail: 'cursor tidak valid.' })
  return n
}
const encodeCursor = (id: number) => Buffer.from(String(id)).toString('base64url')

/**
 * GET /expense-requests?scope=mine|team|inbox|all — always within the caller's read access
 * (own / team / all per role, architecture §7.1). `inbox` = waiting for the caller's
 * acknowledge/approve decision (US-26 approval inbox data).
 */
export const listRequestsEndpoint = v1({
  path: '/expense-requests',
  method: 'get',
  handler: async ({ req }) => {
    const q = ListQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) throw new HttpError(400, 'Bad Request', { errors: q.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
    const { scope, status, type, payeeType, limit, cursor, project, q: text, page: pageNo } = q.data
    const and: Where[] = []
    const uid = userId(req)!
    if (scope === 'mine') {
      // ADR 0016 D1: one employee per PT — "mine" = created by me or naming ANY of my employees
      const own: Where[] = [{ createdBy: { equals: uid } }]
      const emps = ownEmployees(req)
      if (emps.length) own.push({ requesters: { in: emps } })
      and.push({ or: own })
    }
    const members = membershipsOf(req.user)
    if (scope === 'team' && members.some((m) => m.roles.includes('pk-pm'))) {
      // per PT (ADR 0016 §5): office PTs in full, PM PTs team only, other PTs nothing
      const office: Role[] = ['pk-finance', 'pk-owner', 'pk-admin']
      const parts: Where[] = []
      for (const m of members) {
        if (m.roles.some((r) => office.includes(r))) parts.push({ company: { equals: m.company } })
        else if (m.roles.includes('pk-pm')) {
          const s = await resolveScope(req, m.company)
          const team: Where[] = []
          if (s.teamProjects.length) team.push({ project: { in: s.teamProjects } })
          if (s.teamCostCenters.length) team.push({ costCenter: { in: s.teamCostCenters } })
          if (team.length) parts.push({ and: [{ company: { equals: m.company } }, { or: team }] })
        }
      }
      if (parts.length === 0) return json({ items: [], nextCursor: null })
      and.push({ or: parts })
    }
    // MC3: ?company= narrows the selection (never widens; foreign → 403 COMPANY_NOT_ALLOWED)
    const companies = await companyQuery(req)
    if (companies) and.push({ company: { in: companies } })
    if (scope === 'inbox') and.push({ status: { in: ['pending_ack', 'pending_approval'] } })
    if (status) and.push({ status: { in: status.split(',') } })
    if (type) and.push({ type: { equals: type } })
    // ADR 0027: vendor payments only (or only requests paid to employees)
    if (payeeType) and.push({ payeeType: { equals: payeeType } })
    // DRMS 10/10 (project "Pengajuan" tab, APK project screen): one project + search in nomor / judul
    if (project) and.push({ project: { equals: project } })
    const search = searchWhere(['docNo', 'title'], text)
    if (search) and.push(search)
    if (pageNo !== undefined && scope !== 'inbox') {
      // DRMS 10/10 D8: numbered pages (newest first) instead of the cursor
      try {
        const res = await req.payload.find({ collection: 'expense-requests', where: and.length ? { and } : undefined, sort: '-id', page: pageNo, limit, depth: 0, user: req.user, overrideAccess: false /* caller's read scope */, req })
        return json({ items: (res.docs as unknown as RequestDoc[]).map((d) => listItem(d)), nextCursor: null, page: res.page ?? pageNo, totalPages: Math.max(1, res.totalPages), totalDocs: res.totalDocs })
      } catch (err) {
        if ((err as { status?: number }).status === 403) return json({ items: [], nextCursor: null, page: 1, totalPages: 1, totalDocs: 0 })
        throw err
      }
    }
    const after = decodeCursor(cursor)
    if (after !== undefined) and.push({ id: { less_than: after } })
    let docs: RequestDoc[] = []
    try {
      const res = await req.payload.find({
        collection: 'expense-requests',
        where: and.length ? { and } : undefined,
        sort: '-id',
        limit: scope === 'inbox' ? 200 : limit + 1,
        depth: 0,
        user: req.user,
        overrideAccess: false, // caller's read scope
        req,
      })
      docs = res.docs as unknown as RequestDoc[]
    } catch (err) {
      if ((err as { status?: number }).status === 403) return json({ items: [], nextCursor: null })
      throw err
    }
    if (scope === 'inbox') {
      const mine: RequestDoc[] = []
      for (const d of docs) {
        const acts = allowedActions(await actorContext(req, d))
        if (acts.includes('approve') || acts.includes('acknowledge')) mine.push(d)
      }
      docs = mine
    }
    const page = docs.slice(0, limit)
    const next = docs.length > limit && scope !== 'inbox' ? encodeCursor(page[page.length - 1]!.id) : null
    return json({ items: page.map((d) => listItem(d)), nextCursor: next })
  },
})

export const getRequestEndpoint = v1({
  path: '/expense-requests/:id',
  method: 'get',
  transactional: true, // consistent snapshot; budget query uses the request transaction handle
  handler: async ({ req, params }) => {
    const id = idParam(params)
    await loadVisible(req, id)
    return ok(req, id)
  },
})

/**
 * GET /expense-requests/{id}/history — "Riwayat" (US-35): audit rows of the request and its
 * satellites (receipts, transfers, LPJ; cash entries for Finance/Owner/Admin) with who / when /
 * old → new / source + device.
 */
export const historyEndpoint = v1({
  path: '/expense-requests/:id/history',
  method: 'get',
  transactional: true,
  handler: async ({ req, params }) => {
    const id = idParam(params)
    await loadVisible(req, id)
    const rows = await requestHistory(req, id)
    return json({
      items: rows.map((a) => ({
        serverTime: a.serverTime,
        action: a.action,
        field: a.field,
        lineNo: a.lineNo,
        oldValue: a.oldValue,
        newValue: a.newValue,
        statusFrom: a.statusFrom,
        statusTo: a.statusTo,
        reason: a.reason,
        userId: a.userId,
        userName: a.userName,
        source: a.source,
        appVersion: a.appVersion,
        deviceId: a.deviceId,
        docType: a.docType,
        docNo: a.docNo,
      })),
    })
  },
})

/**
 * GET /transfer-queue — US-19: Pengajuan Baru "Disetujui", Reimburse "Nota Terverifikasi", by needed date.
 * DRMS 10/10 (APK Finance menu): + project, suggested cost center (D2), bank snapshot + verification, flag counts
 * and the transfer SLA of the web queue (domain transferQueue).
 */
export const transferQueueEndpoint = v1({
  path: '/transfer-queue',
  method: 'get',
  roles: ['pk-finance', 'pk-owner'],
  transactional: true, // queue figures use the request transaction handle
  handler: async ({ req }) => {
    const companies = await companyQuery(req)
    const res = await req.payload.find({
      collection: 'expense-requests',
      // MC2: only PTs where the caller is Finance / Direktur (not the team requests of a PM PT); MC3: ?company=
      where: officeQueueWhere(
        req,
        {
          or: [
            { and: [{ type: { equals: 'advance' } }, { status: { equals: 'approved' } }] },
            { and: [{ type: { equals: 'reimburse' } }, { status: { equals: 'receipts_verified' } }] },
          ],
        },
        { companyIds: companies },
      ),
      sort: 'neededDate',
      limit: 500,
      depth: 0,
      user: req.user,
      overrideAccess: false, // Finance/Owner read all
      req,
    })
    const items = []
    for (const d of res.docs as unknown as RequestDoc[]) {
      const flags = await req.payload.count({
        collection: 'receipt-flags',
        where: withFlagVisibility(req, { and: [{ request: { equals: d.id } }, { status: { equals: 'open' } }] }), // QA-MC4-06
        overrideAccess: true, // SYSTEM-READ: open flag count (US-19 column)
        req,
      })
      items.push(listItem(d, { openWarningFlags: flags.totalDocs }))
    }
    const extra = new Map((await transferQueue(req, { companyIds: companies })).map((x) => [x.id, x]))
    return json({
      items: items.map((i) => {
        const x = extra.get(i.id)
        return { ...i, project: x?.project ?? null, costCenter: x?.costCenter ?? null, bank: x?.bank ?? null, bankVerification: x?.bankVerification ?? 'unverified', flags: x?.flags ?? { warning: 0, info: 0, receiptMismatch: 0 }, sla: x?.sla ?? { approvedAt: null, slaHours: 24, ageHours: null, over: false }, noApproval: x?.noApproval ?? false, vendorName: x?.vendorName ?? null }
      }),
      nextCursor: null,
    })
  },
})

/**
 * GET /approvals/inbox (architecture §6.3, US-26/US-59): requests waiting for the caller's
 * "Diketahui" or approval with budget impact % before → after and open flag counts.
 */
export const approvalInboxEndpoint = v1({
  path: '/approvals/inbox',
  method: 'get',
  transactional: true, // budget figures use the request transaction handle
  handler: async ({ req }) => json(await approvalInbox(req, { companyIds: await companyQuery(req) })),
})

/**
 * GET /lpj-queue[?company=] — US-21 LPJ verification list (Pengajuan Baru "LPJ Diajukan" / "LPJ
 * Terverifikasi") of the PTs where the caller is Finance / Direktur, with `company` refs (MC3-1).
 */
export const lpjQueueEndpoint = v1({
  path: '/lpj-queue',
  method: 'get',
  roles: ['pk-finance', 'pk-owner'],
  handler: async ({ req }) => json({ items: await lpjQueue(req, { companyIds: await companyQuery(req) }) }),
})

// ---------------------------------------------------------------- drafts

export const createRequestEndpoint = v1({
  path: '/expense-requests',
  method: 'post',
  body: ExpenseRequestCreate,
  rateLimit: ACTION_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body }) => {
    // periodFrom/periodTo: accepted from older apps, ignored since 2026-10-09 (replaced by urgencyLevelId)
    const { company, periodFrom: _pf, periodTo: _pt, ...input } = body
    // MC4: optional body `company` (ADR 0016 §5) — roles = collection create access of expense-requests
    // (the answer is built under the same PT, so a PT outside the header selection still reads back)
    return withNamedCompany(
      req,
      company,
      { roles: ['pk-staff', 'pk-pm', 'pk-admin', 'pk-finance', 'pk-owner'], refs: [{ collection: 'projects', id: input.projectId, path: 'projectId' }, { collection: 'cost-centers', id: input.costCenterId, path: 'costCenterId' }] },
      async () => {
        const { doc, created } = await createDraft(req, input)
        return ok(req, doc.id, created ? 201 : 200)
      },
    )
  },
})

export const updateRequestEndpoint = v1({
  path: '/expense-requests/:id',
  method: 'patch',
  body: ExpenseRequestUpdate,
  rateLimit: ACTION_LIMIT,
  transactional: true,
  handler: async ({ req, body, params }) => {
    const id = idParam(params)
    const { periodFrom: _pf, periodTo: _pt, ...input } = body
    await updateDraft(req, id, input)
    return ok(req, id)
  },
})

// ---------------------------------------------------------------- transitions

type Handler<B> = (req: PayloadRequest, id: number, body: B) => Promise<unknown>

function action<B>(path: string, schema: import('zod').ZodType<B>, fn: Handler<B>, opts: { status?: number; returnsNewId?: boolean } = {}) {
  return v1({
    path: `/expense-requests/:id/${path}`,
    method: 'post',
    body: schema,
    rateLimit: ACTION_LIMIT,
    transactional: true,
    idempotent: true,
    handler: async ({ req, body, params }) => {
      const id = idParam(params)
      const res = await fn(req, id, body as B)
      const target = opts.returnsNewId ? (res as { id: number }).id : id
      return ok(req, target, opts.status ?? 200)
    },
  })
}

export const submitEndpoint = action('submit', SignBody, (req, id, b) => submit(req, id, { signatureMediaId: b.signatureMediaId }))
export const withdrawEndpoint = action('withdraw', ReasonBody, (req, id, b) => {
  req.context.auditReason = b.reason
  return withdraw(req, id, b.reason)
})
export const cancelEndpoint = action('cancel', ReasonBody, (req, id, b) => {
  req.context.auditReason = b.reason
  return cancel(req, id, b.reason)
})
export const resubmitEndpoint = action('resubmit', EmptyBody, (req, id) => resubmitAsDraft(req, id), { status: 201, returnsNewId: true })
/**
 * POST /expense-requests/{id}/duplicate — DRMS 13/10 Persetujuan #12 "Duplikat": a clean NEW Draft from a request the
 * caller can read (same PT, project, lines, requesters; no number, approvals, transfers, receipts, flags,
 * attachments — domain/expense/duplicate.ts). Permission: a create role (Q-09 / ADR 0024) IN THE SOURCE's PT; the
 * draft is created and answered under that PT (withNamedCompany, as a create body `company`). 201 + the new draft.
 */
export const duplicateEndpoint = v1({
  path: '/expense-requests/:id/duplicate',
  method: 'post',
  body: EmptyBody,
  rateLimit: ACTION_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, params }) => {
    const id = idParam(params)
    await loadVisible(req, id)
    const company = relId(((await loadRaw(req, id)) as { company?: unknown }).company)
    return withNamedCompany(req, company, { roles: ['pk-staff', 'pk-pm', 'pk-admin', 'pk-finance', 'pk-owner'] }, async () => {
      const doc = await duplicateAsDraft(req, id)
      return ok(req, doc.id, 201)
    })
  },
})
export const acknowledgeEndpoint = action('acknowledge', SignBody, (req, id, b) => acknowledge(req, id, { signatureMediaId: b.signatureMediaId }))
export const approveEndpoint = action('approve', SignBody, (req, id, b) => approve(req, id, { signatureMediaId: b.signatureMediaId }))
export const rejectEndpoint = action('reject', RejectBody, (req, id, b) => {
  req.context.auditReason = b.reason
  return reject(req, id, b.reason, { signatureMediaId: b.signatureMediaId })
})
export const completeEndpoint = action('complete', EmptyBody, (req, id) => complete(req, id))

// ---------------------------------------------------------------- receipts (T4)

export const addReceiptEndpoint = action('receipts', ReceiptCreate, (req, id, b) => addReceipt(req, id, b), { status: 201 })

export const editReceiptEndpoint = v1({
  path: '/expense-requests/:id/receipts/:rid',
  method: 'patch',
  body: ReceiptUpdate,
  rateLimit: ACTION_LIMIT,
  transactional: true,
  handler: async ({ req, body, params }) => {
    const id = idParam(params)
    await editReceipt(req, id, idParam(params, 'rid'), body)
    return ok(req, id)
  },
})

function receiptAction<B>(path: string, schema: import('zod').ZodType<B>, fn: (req: PayloadRequest, id: number, rid: number, body: B) => Promise<unknown>) {
  return v1({
    path: `/expense-requests/:id/receipts/:rid/${path}`,
    method: 'post',
    body: schema,
    rateLimit: ACTION_LIMIT,
    transactional: true,
    idempotent: true,
    handler: async ({ req, body, params }) => {
      const id = idParam(params)
      await fn(req, id, idParam(params, 'rid'), body as B)
      return ok(req, id)
    },
  })
}

export const removeReceiptEndpoint = receiptAction('remove', ReasonBody, (req, id, rid, b) => removeReceipt(req, id, rid, b.reason))
export const verifyReceiptEndpoint = receiptAction('verify', EmptyBody, (req, id, rid) => verifyReceipt(req, id, rid))
export const rejectReceiptEndpoint = receiptAction('reject', ReasonBody, (req, id, rid, b) => rejectReceipt(req, id, rid, b.reason))
export const resubmitReceiptsEndpoint = action('receipts-resubmit', EmptyBody, (req, id) => resubmitReceipts(req, id))
export const verifyReceiptsEndpoint = action('verify-receipts', EmptyBody, (req, id) => verifyAllReceipts(req, id))

export const reviewFlagEndpoint = v1({
  path: '/expense-requests/:id/flags/:fid/review',
  method: 'post',
  body: FlagReviewBody,
  rateLimit: ACTION_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const id = idParam(params)
    await reviewFlag(req, id, idParam(params, 'fid'), body.note)
    return ok(req, id)
  },
})

// ---------------------------------------------------------------- transfers (T3) + void (T8)

export const transferEndpoint = v1({
  path: '/expense-requests/:id/transfer',
  method: 'post',
  roles: ['pk-finance'],
  body: TransferCreate,
  rateLimit: ACTION_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const id = idParam(params)
    const r = await recordTransfer(req, id, body)
    const t = r.transfer as { id: number; docNo: string }
    return json({ request: await detail(req, id), transferId: t.id, transferDocNo: t.docNo, cashEntryId: r.cashEntry.id, cashEntryNo: r.cashEntry.entryNo }, 201)
  },
})

export const voidTransferEndpoint = v1({
  path: '/expense-requests/:id/transfers/:tid/void',
  method: 'post',
  roles: ['pk-finance'],
  body: ReasonBody,
  rateLimit: ACTION_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const id = idParam(params)
    await voidTransfer(req, id, idParam(params, 'tid'), body.reason)
    return ok(req, id)
  },
})

// ---------------------------------------------------------------- T5 LPJ & settlement (Pengajuan Baru)

export const receiptsCompleteEndpoint = action('receipts-complete', EmptyBody, (req, id) => receiptsComplete(req, id))
export const lpjSubmitEndpoint = action('lpj/submit', LpjSubmitBody, (req, id, b) => submitLpj(req, id, { usageNotes: b.usageNotes, photos: b.photos }))

/** PUT /expense-requests/:id/lpj/photos — point 13: the requester's LPJ photo set while the LPJ is Draft / Revisi. */
export const lpjPhotosEndpoint = v1({
  path: '/expense-requests/:id/lpj/photos',
  method: 'put',
  body: LpjPhotosBody,
  rateLimit: ACTION_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const id = idParam(params)
    await setLpjPhotos(req, id, body.photos)
    return ok(req, id)
  },
})
export const lpjRevisionEndpoint = action('lpj/request-revision', RevisionBody, (req, id, b) => {
  req.context.auditReason = b.note
  return requestLpjRevision(req, id, b.note)
})
export const lpjVerifyEndpoint = action('lpj/verify', EmptyBody, (req, id) => verifyLpj(req, id))

export const settleEndpoint = v1({
  path: '/expense-requests/:id/settle',
  method: 'post',
  roles: ['pk-finance'],
  body: SettleBody,
  rateLimit: ACTION_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const id = idParam(params)
    const r = await settle(req, id, body)
    return json({
      request: await detail(req, id),
      settlementType: r.type,
      amount: r.amount,
      refundCashEntryId: r.refundEntry?.id ?? null,
      refundCashEntryNo: r.refundEntry?.entryNo ?? null,
      shortfallTransferId: r.shortfall?.id ?? null,
      shortfallTransferNo: r.shortfall?.docNo ?? null,
      shortfallCashEntryId: r.shortfall?.cashEntryId ?? null,
    })
  },
})

/**
 * GET /expense-requests/{id}/settle/precheck — QA-11: read-only configuration check the admin form runs
 * BEFORE uploading the proof (no orphan file when e.g. the "Pengembalian LPJ" source is missing).
 */
export const settlePrecheckEndpoint = v1({
  path: '/expense-requests/:id/settle/precheck',
  method: 'get',
  roles: ['pk-finance'],
  rateLimit: ACTION_LIMIT,
  transactional: true,
  handler: async ({ req, params }) => json(await settlePrecheck(req, idParam(params))),
})

/**
 * POST /expense-requests/{id}/settle/reverse {reason} — E9: Finance voids the settlement's refund KM
 * or shortfall transfer (+ KK reversal) → LPJ "Terverifikasi", request "LPJ Terverifikasi" again.
 * Closed period → 409 (re-open first); not Finance / Finance self-involved → 403 (audited).
 */
export const settleReverseEndpoint = v1({
  path: '/expense-requests/:id/settle/reverse',
  method: 'post',
  roles: ['pk-finance'],
  body: ReasonBody,
  rateLimit: ACTION_LIMIT,
  transactional: true,
  idempotent: true,
  handler: async ({ req, body, params }) => {
    const id = idParam(params)
    const r = await reverseSettlement(req, id, body.reason)
    return json({ request: await detail(req, id), voided: r.voided })
  },
})

// ---------------------------------------------------------------- PDF "Pengajuan Biaya" (M16, US-46)

/**
 * GET /expense-requests/{id}/pdf[?variant=internal] — ADR 0008: same read access as the request
 * (US-46 "P" own/team/all → everyone who may read it; else 404), any status after submit (Draft →
 * 409), internal variant (receipt flags) for Finance/Owner/Admin only. Data + `export` audit row
 * (bank number is printed; requirements §8 "Cetak PDF": number, user, status) in one transaction,
 * then the render OUTSIDE it (no DB connection held while rendering; semaphore 2, 10 s → 503).
 * Rate limit 10/min per user (architecture §6.5). The render modules load lazily (web RAM).
 */
export const pdfEndpoint = v1({
  path: '/expense-requests/:id/pdf',
  method: 'get',
  rateLimit: [10, 60_000],
  handler: async ({ req, params }) => {
    const id = idParam(params)
    const q = PdfQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) throw new HttpError(400, 'Bad Request', { detail: 'variant harus standard atau internal.' })
    const internal = q.data.variant === 'internal'
    const { buildPdfData } = await import('@/pdf/data')
    const data = await withReqTransaction(req, async () => {
      const doc = await loadVisible(req, id)
      // ADR 0016 §5: the internal copy needs the office role IN THE DOCUMENT's PT
      if (internal && !hasRole(req, ['pk-finance', 'pk-owner', 'pk-admin'], relId((doc as { company?: unknown }).company))) {
        throw new HttpError(403, 'Forbidden', { detail: 'Salinan internal hanya untuk Finance/Direktur/Admin.' })
      }
      if (doc.status === 'draft' || !doc.docNo) throw new HttpError(409, 'Conflict', { detail: 'PDF tersedia setelah pengajuan diajukan (bernomor).' })
      const built = await buildPdfData(req, id, { internal, printedBy: await displayName(req, userId(req)!) })
      await writeAudit(req, [
        { action: 'export', docType: 'expense_request', docId: String(id), docNo: doc.docNo ?? undefined, field: 'pdf', newValue: { variant: internal ? 'internal' : 'standard', status: doc.status } },
      ])
      return built
    })
    const { renderPengajuanBiaya, PdfBusyError } = await import('@/pdf/render')
    let pdf: Buffer
    try {
      pdf = await renderPengajuanBiaya(data)
    } catch (err) {
      if (err instanceof PdfBusyError) {
        const res = problem(503, 'Service Unavailable', { detail: 'Pembuat PDF sedang sibuk, coba lagi.' })
        res.headers.set('Retry-After', '10')
        return res
      }
      throw err
    }
    const safeNo = data.docNo.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': `attachment; filename="Pengajuan-Biaya-${safeNo}${internal ? '-internal' : ''}.pdf"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  },
})

/**
 * GET /bank-account-preview?request=&account=&reveal=1 (DRMS 10/10 8e) — destination account under
 * the "Rekening tujuan" picker (draft) or of the submit snapshot: bank · holder · masked number; the
 * full number only with reveal=1 for the people the detail DTO shows it to (domain/expense/bank-preview.ts).
 */
export const bankPreviewEndpoint = v1({
  path: '/bank-account-preview',
  method: 'get',
  rateLimit: [60, 60_000],
  handler: async ({ req }) => {
    const q = BankPreviewQuery.safeParse(Object.fromEntries(req.searchParams.entries()))
    if (!q.success) throw new HttpError(400, 'Bad Request', { errors: q.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
    return json(await bankPreview(req, { requestId: q.data.request, accountId: q.data.account, vendorAccountId: q.data.vendorAccount, reveal: q.data.reveal === '1' }))
  },
})

export const EXPENSE_ENDPOINTS = [
  listRequestsEndpoint,
  createRequestEndpoint,
  getRequestEndpoint,
  updateRequestEndpoint,
  historyEndpoint,
  transferQueueEndpoint,
  approvalInboxEndpoint,
  lpjQueueEndpoint,
  submitEndpoint,
  withdrawEndpoint,
  cancelEndpoint,
  resubmitEndpoint,
  duplicateEndpoint,
  acknowledgeEndpoint,
  approveEndpoint,
  rejectEndpoint,
  completeEndpoint,
  addReceiptEndpoint,
  editReceiptEndpoint,
  removeReceiptEndpoint,
  verifyReceiptEndpoint,
  rejectReceiptEndpoint,
  resubmitReceiptsEndpoint,
  verifyReceiptsEndpoint,
  reviewFlagEndpoint,
  transferEndpoint,
  voidTransferEndpoint,
  receiptsCompleteEndpoint,
  lpjSubmitEndpoint,
  lpjPhotosEndpoint,
  lpjRevisionEndpoint,
  lpjVerifyEndpoint,
  settleEndpoint,
  settlePrecheckEndpoint,
  settleReverseEndpoint,
  pdfEndpoint,
  bankPreviewEndpoint,
]

