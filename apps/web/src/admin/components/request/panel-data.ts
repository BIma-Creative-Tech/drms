import type { Payload, PayloadRequest } from 'payload'
import { cache } from 'react'

import { hasRole, ownEmployees, relId, type Role } from '@/access/roles'
import { companyById } from '@/domain/companies'
import { g1ExceptionText } from '@/domain/expense/approval-timeline'
import { bankPreview } from '@/domain/expense/bank-preview'
import { displayName, ids, loadVisible, today } from '@/domain/expense/common'
import { isDecisionSnapshot } from '@/domain/expense/decision'
import { decisionText } from '@/domain/expense/decision-texts'
import { direkturLabel } from '@/domain/direktur-rules'
import { detail } from '@/domain/expense/dto'
import { buildRequestStepper, type RequestStepper } from '@/domain/expense/request-stepper'
import { lastLevel, type ApprovalSnapshot } from '@/domain/expense/rules'
import { ackStepLabel, approvalStepLabel, decisionByOf } from '@/domain/expense/timeline'
import { requestHistory } from '@/domain/history'
import { historyEntry, type HistoryEntry } from '@/domain/history-format'
import { withSystemTransaction } from '@/lib/system-tx'

import type { DraftBank } from './RequestSummary'

export type Detail = Awaited<ReturnType<typeof detail>>

/** Q-09 / ADR 0024: roles that may create a request (= collection create access; "Duplikat" needs one in the request's PT). */
const CREATE_ROLES: readonly Role[] = ['pk-staff', 'pk-pm', 'pk-admin', 'pk-finance', 'pk-owner']
/** Roles that read approval rules (collection access) — the stepper names the rule for them (Persetujuan #5). */
const RULE_READERS: readonly Role[] = ['pk-admin', 'pk-finance']

export type DecisionProps = {
  step: 'acknowledge' | 'approve' | null
  label: string
  confirm: string
  canReject: boolean
  stepLabel: string
  /** ADR 0025: the decision is signed as the PT's definitive Direktur ("Nama (Jabatan)"), else null. */
  signAs: string | null
}

export type RequestPanel = {
  d: Detail
  snap: ApprovalSnapshot | null
  names: Record<number, string>
  hasSignature: boolean
  todayDate: string
  tz: string
  /** Finance / Direktur / Admin of the request's PT (KK links, internal PDF, bank reveal). */
  office: boolean
  /** Creator or one of the requesters. */
  own: boolean
  /**
   * "Duplikat" (Persetujuan #12): a create role in the request's PT AND allowed to file for its requesters — own request,
   * or Admin / Finance of the PT (Q-09 on-behalf); the server re-checks (createDraft → validateContent).
   */
  canDuplicate: boolean
  ptName: string | null
  /** PT badge of the page header (short code + name). */
  pt: { shortCode: string; name: string | null } | null
  /** Chosen account of a Draft for the read-only summary (submitted: the DTO's snapshot). */
  draftBank: DraftBank | null
  attachments: Array<{ id: number; name: string }>
  stepper: RequestStepper
  /** Readable G1 exception note (ADR 0021 / 0024) and, for Finance / Admin, the approval rule's name. */
  stepperNote: string | null
  ruleName: string | null
  /** Decision the caller may take now (decision buttons of the action bar); null = none. */
  decision: DecisionProps | null
  /** "Log perubahan" (Persetujuan #6): the request's history (domain/history.ts), newest first. */
  history: HistoryEntry[]
  createdAt: string | null
  updatedAt: string | null
}

async function load(payload: Payload, user: NonNullable<PayloadRequest['user']>, docId: number): Promise<RequestPanel> {
  return withSystemTransaction(payload, user, async (r) => {
    const doc = await loadVisible(r, docId)
    const d = await detail(r, docId)
    const snap = (doc.approvalSnapshot ?? null) as ApprovalSnapshot | null
    const names: Record<number, string> = {}
    const userIds = [snap?.acknowledgerUserId, ...(snap?.steps ?? []).map((s) => s.approverUserId)].filter((x): x is number => typeof x === 'number')
    for (const u of new Set(userIds)) names[u] = await displayName(r, u)
    const me = await r.payload.findByID({ collection: 'users', id: user.id as number, depth: 0, overrideAccess: true /* SYSTEM-READ: own profile signature flag */, req: r })
    const company = relId((doc as { company?: unknown }).company)
    const pt = company !== undefined ? await companyById(r, company) : null
    const tz = pt?.timezone ?? 'Asia/Makassar'
    // B-2 item 3: "Lampiran" of the read-only summary (file names; the files open through the authorized media endpoint)
    const attIds = ids((doc as { attachments?: unknown[] | null }).attachments ?? null)
    const attachments = attIds.length
      ? (
          await r.payload.find({ collection: 'media-attachments', where: { id: { in: attIds } }, depth: 0, pagination: false, select: { filename: true }, overrideAccess: true /* SYSTEM-READ: names of a visible request's attachments */, req: r })
        ).docs.map((m) => ({ id: m.id as number, name: String((m as { filename?: string }).filename ?? `Lampiran #${String(m.id)}`) }))
      : []
    // KK (cash entries) are readable by Finance/Direktur/Admin of the PT only → link them only for those
    const office = hasRole(r, ['pk-finance', 'pk-owner', 'pk-admin'], company)
    const requesters = d.requesters.map((x) => (x && 'name' in x ? String(x.name ?? '') : '')).filter(Boolean).join(', ')
    const stepper = buildRequestStepper({
      type: d.type,
      status: d.status,
      approvalCycle: d.approvalCycle,
      currentLevel: d.currentLevel,
      submittedAt: d.submittedAt,
      snapshot: snap,
      approvals: d.approvals,
      transfers: d.transfers,
      requesters,
      createdBy: d.createdBy && 'name' in d.createdBy ? String(d.createdBy.name ?? '') : null,
      names,
      settlement: d.settlement,
      rejectReason: d.rejectReason,
      cancelReason: d.cancelReason,
    })
    const own = isOwn(d, user)
    return {
      d,
      snap,
      names,
      hasSignature: relId(me.signature) !== undefined,
      todayDate: await today(r, company),
      tz,
      office,
      own,
      canDuplicate: hasRole(r, CREATE_ROLES, company) && (own || hasRole(r, ['pk-admin', 'pk-finance'], company)),
      ptName: pt ? [pt.shortCode, pt.name].filter(Boolean).join(' · ') : null,
      pt: pt ? { shortCode: String(pt.shortCode ?? `#${company}`), name: pt.name ?? null } : null,
      draftBank: d.status === 'draft' && d.bankAccountId ? await bankPreview(r, { requestId: docId, reveal: false }).catch(() => null) : null,
      attachments,
      stepper,
      stepperNote: g1ExceptionText(snap?.selfApproval),
      ruleName: snap?.ruleName && hasRole(r, RULE_READERS, company) ? String(snap.ruleName) : null,
      decision: decisionOf(d, snap),
      history: (await requestHistory(r, docId)).map((h) => historyEntry(h, tz)).reverse(),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }
  })
}

/** DRMS 10/10 9d: decision when the server allows one now (same texts as the inbox and the APK decision sheet). */
export function decisionOf(d: Pick<Detail, 'allowedActions' | 'currentLevel' | 'status' | 'docNo' | 'grandTotal'> & { direkturSignature?: Detail['direkturSignature'] }, snap: ApprovalSnapshot | null): DecisionProps | null {
  const step = d.allowedActions.includes('approve') ? 'approve' : d.allowedActions.includes('acknowledge') ? 'acknowledge' : null
  const canReject = d.allowedActions.includes('reject')
  if (!step && !canReject) return null
  const level = d.currentLevel ?? 1
  const text = step
    ? decisionText({
        step,
        docNo: d.docNo,
        grandTotal: d.grandTotal,
        decisionFlow: isDecisionSnapshot(snap),
        decisionBy: decisionByOf(snap, step, step === 'acknowledge' ? 0 : level),
        finalStep: snap ? (step === 'acknowledge' ? lastLevel(snap) === 0 : level >= lastLevel(snap)) : false,
      })
    : null
  const stepLabel = step === 'approve' || (!step && d.status === 'pending_approval') ? approvalStepLabel(snap, level) : ackStepLabel(snap)
  const signAs = d.direkturSignature ? direkturLabel(d.direkturSignature.name, d.direkturSignature.title) : null
  const confirm = [text?.confirm ?? '', signAs ? `Ditandatangani dengan tanda tangan Direktur PT: ${signAs}.` : ''].filter(Boolean).join(' ')
  return { step, label: text?.label ?? 'Setujui', confirm, canReject, stepLabel, signAs }
}

function isOwn(d: Detail, user: { id?: unknown }): boolean {
  if (d.createdById === user.id) return true
  // ADR 0016: one employee per PT membership — any of them counts (each belongs to one PT).
  const emps = ownEmployees({ user } as never)
  return d.requesters.some((r) => r?.id !== undefined && emps.includes(r.id))
}

/**
 * Per-render memo (React `cache`): the workflow panel (main column), the stepper (sidebar) and the action bar
 * (document controls) of ONE page render read the request once. Keyed by payload + user id + document id; outside
 * a server render `cache` is a pass-through (tests, server functions) and every call loads.
 */
const slot = cache((_payload: Payload, _userId: unknown, _docId: number): { p?: Promise<RequestPanel | null> } => ({}))

/**
 * The request as the logged-in user may read it, in a fresh req + transaction (SYSTEM tx pattern of the work views);
 * visibility = collection read access (loadVisible). null = not visible (the document view itself denies) or failed (logged).
 */
export function loadRequestPanel(payload: Payload, user: PayloadRequest['user'] | null | undefined, docId: number): Promise<RequestPanel | null> {
  if (!user || !Number.isSafeInteger(docId) || docId <= 0) return Promise.resolve(null)
  const s = slot(payload, user.id, docId)
  s.p ??= load(payload, user, docId).catch((err: unknown) => {
    const status = (err as { status?: number }).status
    if (status !== 404) payload.logger.error({ msg: 'request panel failed', id: docId, err: (err as Error).message })
    return null
  })
  return s.p
}
