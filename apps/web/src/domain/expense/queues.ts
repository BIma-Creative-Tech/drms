import type { PayloadRequest, Where } from 'payload'

import { seesMoney } from '@/access/money'
import { companiesWithRole, relId, type Role } from '@/access/roles'
import { companyRefs, type CompanyRef } from '@/domain/companies'

import { actorContext, ids, projectCommitted, settings, type RequestDoc } from './common'
import { isDecisionSnapshot, isNoApproval, noApprovalRequesterRole, OWNER_ROLE } from './decision'
import { DEFAULT_TRANSFER_SLA_HOURS, queueAge } from './sla'
import { requestPusatBiaya } from './transfers'
import { withFlagVisibility } from './flag-visibility'
import { budgetImpact, lastLevel, type ApprovalSnapshot } from './rules'
import { allowedActions } from './state'
import { ackStepLabel, approvalStepLabel, decisionByOf, requestStatusLabel } from './timeline'
import { payeeOf, requestKindLabel, TRANSFER_QUEUE_WHERE } from './types'
import { inboxFundRow, newFundCache, projectLoansOfRequest } from '@/domain/fundcheck/service'

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
type Populated = Omit<RequestDoc, 'project' | 'costCenter' | 'requesters' | 'vendor'> & {
  project?: { id: number; code?: string; name?: string; budget?: number | null } | number | null
  costCenter?: { id: number; code?: string; name?: string } | number | null
  requesters?: Array<{ id: number; name?: string } | number> | null
  vendor?: { id: number; name?: string } | number | null
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
    where: withFlagVisibility(req, { and: [{ request: { equals: requestId } }, { status: { in: ['open', 'reviewed'] } }] }), // QA-MC4-06
    depth: 0,
    pagination: false,
    select: { level: true, kind: true, status: true },
    overrideAccess: true, // SYSTEM-READ: flag counts of a visible request
    req,
  })
  const rows = res.docs as unknown as Array<{ level?: string; kind?: string; status?: string }>
  const open = rows.filter((f) => f.status === 'open').map((f) => f.level)
  return {
    warning: open.filter((l) => l === 'warning').length,
    info: open.filter((l) => l === 'info').length,
    // D3 (DRMS 10/10): lines whose "Nominal sesuai nota" ≠ total — awareness badge "Selisih nota" (also once reviewed)
    receiptMismatch: rows.filter((f) => f.kind === 'receipt_amount_mismatch').length,
  }
}

const scopeName = (d: Populated) => {
  const p = d.project && typeof d.project === 'object' ? d.project : null
  const c = d.costCenter && typeof d.costCenter === 'object' ? d.costCenter : null
  return p ? `${p.code ?? ''} ${p.name ?? ''}`.trim() : c ? `${c.code ?? ''} ${c.name ?? ''}`.trim() : ''
}
const requesterNames = (d: Populated) => (d.requesters ?? []).map((r) => (typeof r === 'object' ? (r.name ?? '') : '')).filter(Boolean).join(', ')

/** PT refs of the documents (one lookup per PT, request cache) — ADR 0028: also the receiving PTs of PT grup payments. */
async function refsOf(req: PayloadRequest, docs: Populated[]): Promise<Map<number, CompanyRef>> {
  const ids = [...new Set(docs.flatMap((d) => [relId((d as { company?: unknown }).company), relId(d.payeeCompany)]).filter((x): x is number => x !== undefined))]
  return new Map((await companyRefs(req, ids)).map((r) => [r.id, r]))
}

const base = (d: Populated, refs: Map<number, CompanyRef>) => ({
  id: d.id,
  company: refs.get(relId((d as { company?: unknown }).company) ?? -1) ?? null,
  docNo: d.docNo ?? null,
  type: d.type,
  typeLabel: requestKindLabel(d.type, d.payeeType),
  // ADR 0027: vendor payment (+ the vendor's name for the queues)
  payeeType: payeeOf(d.payeeType),
  vendorName: payeeOf(d.payeeType) === 'vendor' && d.vendor && typeof d.vendor === 'object' ? (d.vendor.name ?? null) : null,
  // ADR 0028: PT grup payment — the receiving PT (badge "Antar PT: <PT>")
  payeeCompany: payeeOf(d.payeeType) === 'pt_grup' ? (refs.get(relId(d.payeeCompany) ?? -1) ?? null) : null,
  payeeCompanyName: payeeOf(d.payeeType) === 'pt_grup' ? (refs.get(relId(d.payeeCompany) ?? -1)?.name ?? null) : null,
  status: d.status,
  statusLabel: requestStatusLabel(d.type, d.status, (d.approvalSnapshot ?? null) as ApprovalSnapshot | null, d.currentLevel ?? null),
  title: d.title,
  scope: scopeName(d),
  requesters: requesterNames(d),
  grandTotal: d.grandTotal ?? 0,
  approvedAmount: d.approvedAmount ?? null,
  neededDate: d.neededDate ?? null,
  requestDate: d.requestDate ?? null,
})

/** The CALLER's step on a pending request ("Diketahui" / approval, G1/G2 applied), or null. */
async function callerStep(req: PayloadRequest, d: Populated): Promise<'approve' | 'acknowledge' | null> {
  const acts = allowedActions(await actorContext(req, { ...d, createdBy: relId(d.createdBy), requesters: ids(d.requesters as unknown[]) } as unknown as RequestDoc))
  return acts.includes('approve') ? 'approve' : acts.includes('acknowledge') ? 'acknowledge' : null
}

/** DRMS 20/10: nav badge of "Persetujuan" — the inbox rows without their figures (no budget/fund/flags, no transaction). */
export async function approvalInboxCount(req: PayloadRequest): Promise<number> {
  let n = 0
  for (const d of await findVisible(req, { status: { in: ['pending_ack', 'pending_approval'] } }, 'submittedAt')) if (await callerStep(req, d)) n++
  return n
}

/** Approval inbox: requests waiting for the CALLER's "Diketahui" or approval (G1/G2 applied). */
export async function approvalInbox(req: PayloadRequest, f?: QueueFilter) {
  const docs = await findVisible(req, narrow({ status: { in: ['pending_ack', 'pending_approval'] } }, f), 'submittedAt')
  const refs = await refsOf(req, docs)
  const s = await settings(req)
  const warnPct = s.budgetWarnPct ?? 85
  const warnOf = new Map<number, number>()
  // ADR 0029 §2: one availability per PT per inbox read (badge "Dana kurang Rp X")
  const funds = newFundCache()
  const out = []
  for (const d of docs) {
    const cid = relId((d as { company?: unknown }).company)
    if (cid !== undefined && !warnOf.has(cid)) warnOf.set(cid, (await settings(req, cid)).budgetWarnPct ?? 85)
    const itemWarn = cid !== undefined ? warnOf.get(cid)! : warnPct
    const step = await callerStep(req, d)
    if (!step) continue
    // owner 2026-10-11: RAB % only for the money roles of the request's PT (e.g. not a Staff acknowledger)
    const p = d.project && typeof d.project === 'object' && seesMoney(req, cid) ? d.project : null
    const b = p ? budgetImpact(p.budget, await projectCommitted(req, p.id, d.id), d.grandTotal ?? 0) : { before: null, after: null }
    const decisionFlow = isDecisionSnapshot(d.approvalSnapshot)
    const snap = (d.approvalSnapshot ?? null) as ApprovalSnapshot | null
    const finalStep = snap ? (step === 'acknowledge' ? lastLevel(snap) === 0 : (d.currentLevel ?? 1) >= lastLevel(snap)) : false
    // ADR 0029: the gap of a row at its final decision (PT with the fund check on, Kas viewer) — "Dana kurang Rp X";
    // 2026-10-26: a short project cash account → "Instruksi pinjam antar proyek" unless an instructed loan waits for Finance
    const fund = await inboxFundRow(req, { company: (d as { company?: unknown }).company, project: d.project, grandTotal: d.grandTotal ?? 0, finalStep }, funds)
    const pendingLoan = fund.short !== null && fund.accountMapped ? ((await projectLoansOfRequest(req, d.id)).find((l) => l.awaitingTransfer) ?? null) : null
    out.push({
      ...base(d, refs),
      step,
      level: d.currentLevel ?? null,
      // ADR 0013/0021: human label of the step (web + APK), whether this is a decision flow, who decides
      // the step and whether approving it is final (APK decision sheet texts).
      stepLabel: step === 'acknowledge' ? ackStepLabel(snap) : approvalStepLabel(snap, d.currentLevel ?? 1),
      decisionFlow,
      decisionBy: decisionByOf(snap, step, step === 'acknowledge' ? 0 : (d.currentLevel ?? 1)),
      finalStep,
      fundShort: fund.short,
      instructProjectLoan: fund.short !== null && fund.accountMapped && pendingLoan === null,
      projectLoanPending: pendingLoan ? { id: pendingLoan.id, docNo: pendingLoan.docNo } : null,
      selfApproval: snap?.selfApproval ?? null,
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
  // QA-17: verification state of the destination account (the transfer asks for a confirmation when unverified)
  const verification = (v: unknown): 'verified' | 'unverified' => (v && typeof v === 'object' && (v as { verificationStatus?: string }).verificationStatus === 'verified' ? 'verified' : 'unverified')
  // Item 11: age since the final approval vs the PT's transfer SLA (badge "Umur sejak disetujui")
  const slaOf = new Map<number, number>()
  const now = new Date()
  for (const d of docs) {
    const cid = relId((d as { company?: unknown }).company)
    if (cid !== undefined && !slaOf.has(cid)) slaOf.set(cid, (await settings(req, cid)).transferSlaHours ?? DEFAULT_TRANSFER_SLA_HOURS)
    const slaHours = cid !== undefined ? slaOf.get(cid)! : DEFAULT_TRANSFER_SLA_HOURS
    const approvedAt = (d as { approvedAt?: string | null }).approvedAt ?? null
    const age = queueAge(approvedAt ? new Date(approvedAt) : null, now, slaHours)
    const p = d.project && typeof d.project === 'object' ? d.project : null
    const projectId = p?.id ?? relId(d.project)
    const pusatBiaya = projectId === undefined ? null : await requestPusatBiaya(req, { project: projectId })
    items.push({
      ...base(d, refs),
      project: p ? { id: p.id, code: p.code ?? null, name: p.name ?? null } : null,
      // D2 legacy (deprecated, always null since ADR 0031 — older APKs still read the key)
      costCenter: null,
      // ADR 0031: the project's Pusat Biaya (cash account) — the default "Dibayar dari akun"; another account = automatic
      // loan. `pusatBiayaMissing`: a project request whose project is not mapped yet (the transfer is refused).
      pusatBiaya,
      pusatBiayaMissing: projectId !== undefined && !pusatBiaya,
      bank: d.bankSnapshot ?? null,
      // ADR 0027: a vendor payment's destination is the vendor account (same confirmation rule)
      // ADR 0028: the receiving PT's designated account is an own group account — trusted (never asked)
      bankVerification: payeeOf(d.payeeType) === 'pt_grup' ? ('verified' as const) : verification(payeeOf(d.payeeType) === 'vendor' ? (d as { vendorBankAccount?: unknown }).vendorBankAccount : (d as { bankAccount?: unknown }).bankAccount),
      flags: await flagCounts(req, d.id),
      sla: { approvedAt, slaHours, ageHours: age?.hours ?? null, over: age?.over ?? false },
      // ADR 0024 / 0026: a Direktur's (legacy) / the Owner's own request that reached the queue without any approval (badge)
      noApproval: isNoApproval(d.approvalSnapshot),
      noApprovalBy: noApprovalRequesterRole(d.approvalSnapshot) === OWNER_ROLE ? ('owner' as const) : isNoApproval(d.approvalSnapshot) ? ('direktur' as const) : null,
    })
  }
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

/** US-21 LPJ verification list (Pengajuan Baru `lpj_submitted` / `lpj_verified`), consolidated with PT refs. */
export async function lpjQueue(req: PayloadRequest, f?: QueueFilter) {
  const docs = await findVisible(req, officeQueueWhere(req, { and: [{ type: { equals: 'advance' } }, { status: { in: ['lpj_submitted', 'lpj_verified'] } }] }, f), 'updatedAt', 500)
  const refs = await refsOf(req, docs)
  return docs.map((d) => ({ ...base(d, refs), transferredTotal: (d as { transferredTotal?: number | null }).transferredTotal ?? 0 }))
}
