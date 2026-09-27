import type { PayloadRequest, Where } from 'payload'

import { relId } from '@/access/roles'

import { actorContext, ids, projectCommitted, settings, type RequestDoc } from './common'
import { isDecisionSnapshot } from './decision'
import { budgetImpact } from './rules'
import { allowedActions } from './state'
import { REQUEST_TYPE_LABELS, statusLabel, TRANSFER_QUEUE_WHERE } from './types'

export { TRANSFER_QUEUE_WHERE }

/**
 * Work queues of the F2 admin views and the APK (US-19 transfer queue, US-21 LPJ verification,
 * US-26/US-59 approval inbox). Reads run with the CALLER's access (overrideAccess:false); budget
 * figures use the request transaction handle → call inside a transaction.
 */
type Populated = Omit<RequestDoc, 'project' | 'costCenter' | 'requesters'> & {
  project?: { id: number; code?: string; name?: string; budget?: number | null } | number | null
  costCenter?: { id: number; code?: string; name?: string } | number | null
  requesters?: Array<{ id: number; name?: string } | number> | null
}

async function findVisible(req: PayloadRequest, where: Where, sort: string, limit = 200): Promise<Populated[]> {
  try {
    const res = await req.payload.find({ collection: 'expense-requests', where, sort, limit, depth: 1, user: req.user, overrideAccess: false, req })
    return res.docs as unknown as Populated[]
  } catch (err) {
    if ((err as { status?: number }).status === 403) return []
    throw err
  }
}

async function flagCounts(req: PayloadRequest, requestId: number) {
  const res = await req.payload.find({
    collection: 'receipt-flags',
    where: { and: [{ request: { equals: requestId } }, { status: { equals: 'open' } }] },
    depth: 0,
    pagination: false,
    select: { level: true },
    overrideAccess: true, // SYSTEM-READ: flag counts of a visible request
    req,
  })
  const levels = res.docs.map((d) => (d as { level?: string }).level)
  return { warning: levels.filter((l) => l === 'warning').length, info: levels.filter((l) => l === 'info').length }
}

const scopeName = (d: Populated) => {
  const p = d.project && typeof d.project === 'object' ? d.project : null
  const c = d.costCenter && typeof d.costCenter === 'object' ? d.costCenter : null
  return p ? `${p.code ?? ''} ${p.name ?? ''}`.trim() : c ? `${c.code ?? ''} ${c.name ?? ''}`.trim() : ''
}
const requesterNames = (d: Populated) => (d.requesters ?? []).map((r) => (typeof r === 'object' ? (r.name ?? '') : '')).filter(Boolean).join(', ')

const base = (d: Populated) => ({
  id: d.id,
  docNo: d.docNo ?? null,
  type: d.type,
  typeLabel: REQUEST_TYPE_LABELS[d.type],
  status: d.status,
  statusLabel: statusLabel(d.type, d.status),
  title: d.title,
  scope: scopeName(d),
  requesters: requesterNames(d),
  grandTotal: d.grandTotal ?? 0,
  approvedAmount: d.approvedAmount ?? null,
  neededDate: d.neededDate ?? null,
  requestDate: d.requestDate ?? null,
})

/** Approval inbox: requests waiting for the CALLER's "Diketahui" or approval (G1/G2 applied). */
export async function approvalInbox(req: PayloadRequest) {
  const docs = await findVisible(req, { status: { in: ['pending_ack', 'pending_approval'] } }, 'submittedAt')
  const s = await settings(req)
  const warnPct = s.budgetWarnPct ?? 85
  const out = []
  for (const d of docs) {
    const ctx = await actorContext(req, { ...d, createdBy: relId(d.createdBy), requesters: ids(d.requesters as unknown[]) } as unknown as RequestDoc)
    const acts = allowedActions(ctx)
    const step = acts.includes('approve') ? 'approve' : acts.includes('acknowledge') ? 'acknowledge' : null
    if (!step) continue
    const p = d.project && typeof d.project === 'object' ? d.project : null
    const b = p ? budgetImpact(p.budget, await projectCommitted(req, p.id, d.id), d.grandTotal ?? 0) : { before: null, after: null }
    const decisionFlow = isDecisionSnapshot(d.approvalSnapshot)
    out.push({
      ...base(d),
      step,
      level: d.currentLevel ?? null,
      // ADR 0013: human label of the step (web + APK) and whether this is the Direktur → Finance flow.
      stepLabel: step === 'acknowledge' ? (decisionFlow ? 'Persetujuan Direktur (Diketahui)' : 'Diketahui Oleh') : `Approval level ${d.currentLevel ?? 1}`,
      decisionFlow,
      budget: { basis: p?.budget ? ('project' as const) : ('none' as const), pctBefore: b.before, pctAfter: b.after, overWarn: b.after !== null && b.after > warnPct },
      flags: await flagCounts(req, d.id),
    })
  }
  return { items: out, budgetWarnPct: warnPct }
}

/** US-19: transfer queue by needed date. */
export async function transferQueue(req: PayloadRequest) {
  const docs = await findVisible(req, TRANSFER_QUEUE_WHERE, 'neededDate', 500)
  const items = []
  for (const d of docs) items.push({ ...base(d), bank: d.bankSnapshot ?? null, flags: await flagCounts(req, d.id) })
  // needed date ascending, requests without a date last
  items.sort((a, b) => (a.neededDate ?? '9999-12-31').localeCompare(b.neededDate ?? '9999-12-31') || a.id - b.id)
  return items
}

export async function transferQueueCount(req: PayloadRequest): Promise<number> {
  const r = await req.payload.count({
    collection: 'expense-requests',
    where: TRANSFER_QUEUE_WHERE,
    user: req.user,
    overrideAccess: false,
    req,
  })
  return r.totalDocs
}

export async function lpjQueueCount(req: PayloadRequest): Promise<number> {
  const r = await req.payload.count({ collection: 'expense-requests', where: { status: { in: ['lpj_submitted', 'lpj_verified'] } }, user: req.user, overrideAccess: false, req })
  return r.totalDocs
}
