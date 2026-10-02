import type { PayloadRequest, Where } from 'payload'

import { companiesWithRole, relId, type Role } from '@/access/roles'
import { companyRefs, type CompanyRef } from '@/domain/companies'

import { actorContext, ids, projectCommitted, settings, type RequestDoc } from './common'
import { isDecisionSnapshot } from './decision'
import { withFlagVisibility } from './flag-visibility'
import { budgetImpact } from './rules'
import { allowedActions } from './state'
import { REQUEST_TYPE_LABELS, statusLabel, TRANSFER_QUEUE_WHERE } from './types'

export { TRANSFER_QUEUE_WHERE }

/**
 * Work queues of the F2 admin views and the APK (US-19 transfer queue, US-21 LPJ verification,
 * US-26/US-59 approval inbox). Reads run with the CALLER's access (overrideAccess:false); budget
 * figures use the request transaction handle → call inside a transaction.
 *
 * MC2 (ADR 0016 §5, requirements v1.2 §5): one consolidated list over the SELECTED PTs where the
 * caller's role grants read access (collection access is per PT); every item carries
 * `company { id, shortCode, name }`; thresholds (budget warn %) are those of the item's PT. The
 * optional `companyIds` filter narrows further (UI PT filter) — it never widens.
 */
type Populated = Omit<RequestDoc, 'project' | 'costCenter' | 'requesters'> & {
  project?: { id: number; code?: string; name?: string; budget?: number | null } | number | null
  costCenter?: { id: number; code?: string; name?: string } | number | null
  requesters?: Array<{ id: number; name?: string } | number> | null
}

export type QueueFilter = { companyIds?: readonly number[] | null }

const narrow = (where: Where, f?: QueueFilter): Where => (f?.companyIds?.length ? { and: [where, { company: { in: [...f.companyIds] } }] } : where)

/** Roles of the Finance work queues (transfer queue, LPJ verification). */
export const OFFICE_QUEUE_ROLES: readonly Role[] = ['pk-finance', 'pk-owner']

/**
 * Finance queues list only the selected PTs where the caller is Finance / Direktur (mc2-contract §3):
 * collection read access alone would add the TEAM requests of a PT where the caller is only PM (with
 * the unmasked bank snapshot of the queue row). System callers (no user) keep the plain filter.
 */
export function officeQueueWhere(req: PayloadRequest, where: Where, f?: QueueFilter): Where {
  if (!req.user) return narrow(where, f)
  const pts = companiesWithRole(req, OFFICE_QUEUE_ROLES)
  return narrow({ and: [where, pts.length ? { company: { in: pts } } : { id: { equals: -1 } }] }, f)
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
    where: withFlagVisibility(req, { and: [{ request: { equals: requestId } }, { status: { equals: 'open' } }] }), // QA-MC4-06
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

/** PT refs of the documents (one lookup per PT, request cache). */
async function refsOf(req: PayloadRequest, docs: Populated[]): Promise<Map<number, CompanyRef>> {
  const ids = [...new Set(docs.map((d) => relId((d as { company?: unknown }).company)).filter((x): x is number => x !== undefined))]
  return new Map((await companyRefs(req, ids)).map((r) => [r.id, r]))
}

const base = (d: Populated, refs: Map<number, CompanyRef>) => ({
  id: d.id,
  company: refs.get(relId((d as { company?: unknown }).company) ?? -1) ?? null,
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
export async function approvalInbox(req: PayloadRequest, f?: QueueFilter) {
  const docs = await findVisible(req, narrow({ status: { in: ['pending_ack', 'pending_approval'] } }, f), 'submittedAt')
  const refs = await refsOf(req, docs)
  const s = await settings(req)
  const warnPct = s.budgetWarnPct ?? 85
  const warnOf = new Map<number, number>()
  const out = []
  for (const d of docs) {
    const cid = relId((d as { company?: unknown }).company)
    if (cid !== undefined && !warnOf.has(cid)) warnOf.set(cid, (await settings(req, cid)).budgetWarnPct ?? 85)
    const itemWarn = cid !== undefined ? warnOf.get(cid)! : warnPct
    const ctx = await actorContext(req, { ...d, createdBy: relId(d.createdBy), requesters: ids(d.requesters as unknown[]) } as unknown as RequestDoc)
    const acts = allowedActions(ctx)
    const step = acts.includes('approve') ? 'approve' : acts.includes('acknowledge') ? 'acknowledge' : null
    if (!step) continue
    const p = d.project && typeof d.project === 'object' ? d.project : null
    const b = p ? budgetImpact(p.budget, await projectCommitted(req, p.id, d.id), d.grandTotal ?? 0) : { before: null, after: null }
    const decisionFlow = isDecisionSnapshot(d.approvalSnapshot)
    out.push({
      ...base(d, refs),
      step,
      level: d.currentLevel ?? null,
      // ADR 0013: human label of the step (web + APK) and whether this is the Direktur → Finance flow.
      stepLabel: step === 'acknowledge' ? (decisionFlow ? 'Persetujuan Direktur (Diketahui)' : 'Diketahui Oleh') : `Approval level ${d.currentLevel ?? 1}`,
      decisionFlow,
      budget: { basis: p?.budget ? ('project' as const) : ('none' as const), pctBefore: b.before, pctAfter: b.after, overWarn: b.after !== null && b.after > itemWarn, warnPct: itemWarn },
      flags: await flagCounts(req, d.id),
    })
  }
  return { items: out, budgetWarnPct: warnPct }
}

/** US-19: transfer queue by needed date. */
export async function transferQueue(req: PayloadRequest, f?: QueueFilter) {
  const docs = await findVisible(req, officeQueueWhere(req, TRANSFER_QUEUE_WHERE, f), 'neededDate', 500)
  const refs = await refsOf(req, docs)
  const items = []
  for (const d of docs) items.push({ ...base(d, refs), bank: d.bankSnapshot ?? null, flags: await flagCounts(req, d.id) })
  // needed date ascending, requests without a date last
  items.sort((a, b) => (a.neededDate ?? '9999-12-31').localeCompare(b.neededDate ?? '9999-12-31') || a.id - b.id)
  return items
}

export async function transferQueueCount(req: PayloadRequest, f?: QueueFilter): Promise<number> {
  const r = await req.payload.count({
    collection: 'expense-requests',
    where: officeQueueWhere(req, TRANSFER_QUEUE_WHERE, f),
    user: req.user,
    overrideAccess: false,
    req,
  })
  return r.totalDocs
}

export async function lpjQueueCount(req: PayloadRequest, f?: QueueFilter): Promise<number> {
  const r = await req.payload.count({ collection: 'expense-requests', where: officeQueueWhere(req, { status: { in: ['lpj_submitted', 'lpj_verified'] } }, f), user: req.user, overrideAccess: false, req })
  return r.totalDocs
}

/** US-21 LPJ verification list (Uang Muka `lpj_submitted` / `lpj_verified`), consolidated with PT refs. */
export async function lpjQueue(req: PayloadRequest, f?: QueueFilter) {
  const docs = await findVisible(req, officeQueueWhere(req, { and: [{ type: { equals: 'advance' } }, { status: { in: ['lpj_submitted', 'lpj_verified'] } }] }, f), 'updatedAt', 500)
  const refs = await refsOf(req, docs)
  return docs.map((d) => ({ ...base(d, refs), transferredTotal: (d as { transferredTotal?: number | null }).transferredTotal ?? 0 }))
}
