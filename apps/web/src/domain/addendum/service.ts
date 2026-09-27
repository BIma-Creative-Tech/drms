import { sql } from '@payloadcms/db-postgres'
import { APIError, type PayloadRequest, type Where } from 'payload'

import { hasRole, relId, userId, userRoles } from '@/access/roles'
import { resolveScope } from '@/access/scope'
import { writeAudit, writeAuditDetached } from '@/audit/writer'
import { displayName, projectCommitted, resolveSignature, today, type Signature } from '@/domain/expense/common'
import { lacksDecisionRole } from '@/domain/expense/decision'
import { lastLevel, matchesAcknowledger, matchesStep, selectRule, type ApprovalSnapshot } from '@/domain/expense/rules'
import { loadActiveRules, snapshotForRule } from '@/domain/expense/snapshot'
import { notificationTemplate, pushEnabled } from '@/domain/notifications'
import { parseBusinessDate } from '@/domain/numbering'
import { allocateDocNo } from '@/domain/numbering-db'
import { lockProject } from '@/domain/progress/recalc'
import { formatRupiah } from '@/lib/money'
import { requestMeta } from '@/lib/request-meta'
import { getRequestTx } from '@/lib/tx'

import { isTeamPm, mayReadAddenda } from './access'
import { addendumAllowedActions, addendumInputErrors, ADDENDUM_STATUS_LABELS, newBudget, pctOf, type AddendumAction, type AddendumActorContext, type AddendumStatus } from './rules'

/**
 * E5 Addendum RAB (T12, US-18/US-30) — the single write path behind /api/v1/budget-addenda.
 * Every function runs inside the caller's transaction: number allocation, status change, decision
 * rows (`approvals`, docType budget_addendum), the project RAB update on the final approval, audit
 * rows and in-app notifications commit or roll back together.
 *
 * Flow (ADR 0013 engine, rule docType `budget_addendum`, default rule seeded by the E5 migration):
 * Draft (PM of the team) → submit → Menunggu Direktur ("Diketahui" = approval) → Menunggu Finance
 * (level 1..n) → Disetujui: projects.budget := CURRENT budget (re-read under the project row lock)
 * + addition. Reject (reason) from either step; cancel by the creator before any decision.
 */

export class AddendumError extends APIError {
  constructor(
    status: number,
    message: string,
    readonly pkCode: string,
    field?: string,
  ) {
    super(message, status, field ? { errors: [{ path: field, message }] } : null, true)
  }
}

const fail = (status: number, code: string, message: string, field?: string): never => {
  throw new AddendumError(status, message, code, field)
}

export type AddendumDoc = {
  id: number
  uuid?: string | null
  docNo?: string | null
  project: unknown
  status: AddendumStatus
  addition: number
  reason: string
  budgetAtSubmit?: number | null
  oldBudget?: number | null
  newBudget?: number | null
  createdBy: unknown
  submittedAt?: string | null
  decidedAt?: string | null
  approvalRule?: unknown
  approvalSnapshot?: ApprovalSnapshot | null
  approvalCycle?: number | null
  currentLevel?: number | null
  rejectReason?: string | null
  cancelReason?: string | null
  source?: 'web' | 'apk' | null
  createdAt?: string
  updatedAt?: string
}

type ProjectRow = { id: number; code?: string; name?: string; status?: string | null; budget?: number | null; pm?: unknown }

export type DecisionRow = {
  id: number
  cycle: number
  position: 'diketahui' | 'approval'
  level: number
  actor?: unknown
  actorName?: string | null
  decision: 'acknowledged' | 'approved' | 'rejected'
  reason?: string | null
  decidedAt?: string | null
  budgetPctBefore?: number | null
  budgetPctAfter?: number | null
  signatureSource?: string | null
}

// ---------------------------------------------------------------- loading

async function lockAddendum(req: PayloadRequest, id: number): Promise<void> {
  const tx = await getRequestTx(req)
  await tx.execute(sql`SELECT id FROM budget_addenda WHERE id = ${id} FOR UPDATE`)
}

export async function loadRawAddendum(req: PayloadRequest, id: number): Promise<AddendumDoc> {
  return (await req.payload.findByID({ collection: 'budget-addenda', id, depth: 0, overrideAccess: true /* SYSTEM-READ: after the visibility check */, req })) as unknown as AddendumDoc
}

/** An addendum the CALLER may read (collection access), else 404 (no existence leak). */
export async function loadVisibleAddendum(req: PayloadRequest, id: number, opts: { lock?: boolean } = {}): Promise<AddendumDoc> {
  if (!Number.isSafeInteger(id) || id <= 0 || !mayReadAddenda(req)) fail(404, 'NOT_FOUND', 'Addendum tidak ditemukan.')
  if (opts.lock) await lockAddendum(req, id)
  const doc = (await req.payload
    .findByID({ collection: 'budget-addenda', id, depth: 0, user: req.user, overrideAccess: false /* caller's read scope */, req })
    .catch(() => null)) as AddendumDoc | null
  if (!doc) fail(404, 'NOT_FOUND', 'Addendum tidak ditemukan.')
  return doc!
}

async function loadProject(req: PayloadRequest, projectId: number): Promise<ProjectRow> {
  const p = (await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, overrideAccess: true /* SYSTEM-READ: RAB/status (caller checked) */, req, disableErrors: true })) as ProjectRow | null
  if (!p) fail(404, 'NOT_FOUND', 'Project tidak ditemukan.', 'projectId')
  return p!
}

export async function decisionsOf(req: PayloadRequest, addendumId: number): Promise<DecisionRow[]> {
  const res = await req.payload.find({
    collection: 'approvals',
    where: { and: [{ docType: { equals: 'budget_addendum' } }, { addendum: { equals: addendumId } }] },
    depth: 0,
    pagination: false,
    sort: 'id',
    overrideAccess: true, // SYSTEM-READ: decision rows of an addendum the caller may read
    req,
  })
  return res.docs as unknown as DecisionRow[]
}

export async function actorContext(req: PayloadRequest, doc: AddendumDoc, rows?: DecisionRow[]): Promise<AddendumActorContext & { lacksDecisionRole: boolean }> {
  const uid = userId(req) ?? -1
  const roles = userRoles(req)
  const cycle = doc.approvalCycle ?? 0
  const decisions = (rows ?? (cycle > 0 ? await decisionsOf(req, doc.id) : [])).filter((r) => r.cycle === cycle)
  const snap = doc.approvalSnapshot ?? null
  const caller = { id: uid, roles }
  const step = snap?.steps.find((s) => s.level === (doc.currentLevel ?? 0))
  const projectId = relId(doc.project)!
  return {
    status: doc.status,
    isCreator: relId(doc.createdBy) === uid,
    isTeamPm: await isTeamPm(req, projectId),
    isAcknowledger: !!snap && doc.status === 'pending_ack' && matchesAcknowledger(snap, caller),
    matchesCurrentStep: !!snap && doc.status === 'pending_approval' && matchesStep(step, caller),
    hasDecision: decisions.length > 0,
    alreadyDecided: decisions.some((r) => relId(r.actor) === uid),
    lacksDecisionRole: lacksDecisionRole(snap, roles),
  }
}

// ---------------------------------------------------------------- guards

async function deniedCreate(req: PayloadRequest, projectId: number): Promise<never> {
  await writeAuditDetached(req, [
    {
      action: 'access_denied',
      docType: 'budget_addendum',
      field: 'create',
      newValue: { projectId },
      reason: 'addendum RAB hanya diajukan oleh PM project tim (requirements §4, US-18)',
    },
  ])
  return fail(403, 'FORBIDDEN', 'Addendum RAB hanya dapat diajukan oleh PM project ini.', 'projectId')
}

const DECISIONS: ReadonlySet<AddendumAction> = new Set<AddendumAction>(['acknowledge', 'approve', 'reject'])

/** 403 not allowed (checked first, E9), 409 wrong status; denied decisions are audited (`access_denied`, own transaction). */
async function requireAction(req: PayloadRequest, doc: AddendumDoc, action: AddendumAction): Promise<AddendumActorContext> {
  const ctx = await actorContext(req, doc)
  if (addendumAllowedActions(ctx).includes(action)) return ctx
  const decision = DECISIONS.has(action)
  const statusOk =
    action === 'edit' || action === 'submit'
      ? doc.status === 'draft'
      : action === 'cancel'
        ? ['draft', 'pending_ack', 'pending_approval'].includes(doc.status)
        : action === 'acknowledge'
          ? doc.status === 'pending_ack'
          : action === 'approve'
            ? doc.status === 'pending_approval'
            : doc.status === 'pending_ack' || doc.status === 'pending_approval'
  if (decision && (ctx.lacksDecisionRole || ctx.isCreator || statusOk)) {
    const reason = ctx.lacksDecisionRole
      ? 'hanya Direktur/Finance yang memutuskan addendum (ADR 0013; PM hanya memantau)'
      : ctx.isCreator
        ? 'pengaju tidak boleh memutuskan addendumnya sendiri (G1)'
        : 'bukan pemutus pada langkah ini (G2)'
    await writeAuditDetached(req, [
      { action: 'access_denied', docType: 'budget_addendum', docId: String(doc.id), docNo: doc.docNo ?? undefined, field: action, newValue: { action, status: doc.status, roles: userRoles(req) }, reason },
    ])
  }
  // E9 (UAT 5.2 rule): authorization failures (403) are answered BEFORE state conflicts (409) — a
  // caller who may never take this action does not learn the document's state.
  if (decision && ctx.lacksDecisionRole) fail(403, 'FORBIDDEN', 'Hanya Direktur atau Finance yang dapat menyetujui atau menolak addendum RAB (ADR 0013). PM hanya memantau.')
  if (decision && ctx.isCreator) fail(403, 'FORBIDDEN', 'Pengaju tidak dapat memutuskan addendumnya sendiri (G1).')
  if (!decision && !ctx.isCreator) fail(403, 'FORBIDDEN', 'Hanya pengaju yang dapat mengubah, mengajukan atau membatalkan addendum ini.')
  if (!statusOk) fail(409, 'STATE_CONFLICT', `Aksi tidak dapat dilakukan pada status addendum saat ini (${ADDENDUM_STATUS_LABELS[doc.status]}).`)
  if (action === 'cancel' && ctx.isCreator && ctx.hasDecision) fail(409, 'STATE_CONFLICT', 'Addendum yang sudah diputuskan sebagian tidak dapat dibatalkan.')
  return fail(403, 'FORBIDDEN', 'Anda tidak berhak melakukan aksi ini pada addendum ini.')
}

async function updateAddendum(req: PayloadRequest, id: number, data: Record<string, unknown>, reason?: string): Promise<AddendumDoc> {
  if (reason) req.context.auditReason = reason
  try {
    return (await req.payload.update({
      collection: 'budget-addenda',
      id,
      data: data as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: addendum state machine after the guards above
      req,
    })) as unknown as AddendumDoc
  } finally {
    delete req.context.auditReason
  }
}

// ---------------------------------------------------------------- notifications

type AddendumEvent = 'addendum.pending_ack' | 'addendum.pending_approval' | 'addendum.approved' | 'addendum.rejected'

const DEFAULTS: Record<AddendumEvent, { title: string; body: string }> = {
  'addendum.pending_ack': { title: 'Persetujuan Direktur: {docNo}', body: 'Addendum RAB {docNo} ({project}) +{amount} menunggu persetujuan Anda sebagai Direktur.' },
  'addendum.pending_approval': { title: 'Menunggu Approval: {docNo}', body: 'Addendum RAB {docNo} ({project}) +{amount} menunggu persetujuan Anda.' },
  'addendum.approved': { title: 'Addendum disetujui: {docNo}', body: 'Addendum RAB {docNo} ({project}) +{amount} disetujui. RAB project bertambah.' },
  'addendum.rejected': { title: 'Addendum ditolak: {docNo}', body: 'Addendum RAB {docNo} ({project}) ditolak. Lihat alasan di detail addendum.' },
}

async function usersWithRole(req: PayloadRequest, role: string): Promise<number[]> {
  const res = await req.payload.find({
    collection: 'users',
    where: { and: [{ roles: { in: [role] } }, { active: { equals: true } }] },
    depth: 0,
    pagination: false,
    select: { email: true },
    overrideAccess: true, // SYSTEM-READ: notification recipients by role
    req,
  })
  return res.docs.map((d) => d.id as number)
}

async function stepRecipients(req: PayloadRequest, doc: AddendumDoc, kind: 'ack' | 'approval'): Promise<number[]> {
  const snap = doc.approvalSnapshot
  if (!snap) return []
  let ids: number[] = []
  if (kind === 'ack') {
    if (snap.acknowledgerUserId !== null) ids = [snap.acknowledgerUserId]
    else if (snap.acknowledgeBy === 'role' && snap.acknowledgeRole) ids = await usersWithRole(req, snap.acknowledgeRole)
  } else {
    const step = snap.steps.find((s) => s.level === (doc.currentLevel ?? 1))
    if (step?.approverUserId) ids = [step.approverUserId]
    else if (step?.approverRole) ids = await usersWithRole(req, step.approverRole)
  }
  const creator = relId(doc.createdBy)
  return ids.filter((x) => x !== creator) // G1: the creator never decides
}

async function notify(req: PayloadRequest, doc: AddendumDoc, event: AddendumEvent, to: number[], project: ProjectRow): Promise<void> {
  const actor = userId(req)
  const t = await notificationTemplate(req, event, DEFAULTS[event])
  const vars: Record<string, string> = { docNo: doc.docNo ?? `#${doc.id}`, project: `${project.code ?? ''} ${project.name ?? ''}`.trim(), amount: formatRupiah(doc.addition) }
  const render = (s: string) => s.replace(/\{(docNo|project|amount)\}/g, (_, k: string) => vars[k] ?? '')
  for (const uid of new Set(to)) {
    if (uid === actor) continue
    await req.payload.create({
      collection: 'notifications',
      data: {
        user: uid,
        event,
        title: render(t.title).slice(0, 160),
        body: render(t.body).slice(0, 1000),
        docType: 'budget_addendum',
        docId: String(doc.id),
        docNo: doc.docNo ?? null,
        pushStatus: pushEnabled() ? 'pending' : 'skipped',
      } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: in-app notification of a committed-together transition
      req,
    })
  }
}

async function notifyStep(req: PayloadRequest, doc: AddendumDoc, project: ProjectRow): Promise<void> {
  if (doc.status === 'pending_ack') await notify(req, doc, 'addendum.pending_ack', await stepRecipients(req, doc, 'ack'), project)
  else if (doc.status === 'pending_approval') await notify(req, doc, 'addendum.pending_approval', await stepRecipients(req, doc, 'approval'), project)
}

// ---------------------------------------------------------------- budget impact

/** K-07 Komitmen of the project as % of the RAB before and after the addition (US-26 style). */
export async function budgetImpact(req: PayloadRequest, project: ProjectRow, addition: number) {
  const committed = await projectCommitted(req, project.id, -1)
  const budget = Number(project.budget ?? 0)
  return { budget, committed, budgetAfter: newBudget(budget, addition), pctBefore: pctOf(committed, budget), pctAfter: pctOf(committed, newBudget(budget, addition)) }
}

// ---------------------------------------------------------------- create / edit / submit / cancel

export type AddendumInput = { projectId: number; addition: number; reason: string; submit?: boolean }

function checkInput(input: { addition?: unknown; reason?: unknown }): void {
  const errs = addendumInputErrors(input)
  if (errs.length > 0) throw new AddendumError(400, errs[0]!.message, 'VALIDATION', errs[0]!.path)
}

function checkProjectOpen(p: ProjectRow): void {
  if (p.status === 'arsip') fail(409, 'STATE_CONFLICT', 'Project sudah diarsipkan.', 'projectId')
  if (!p.budget || p.budget <= 0) fail(409, 'NO_BUDGET', 'Project belum memiliki RAB. RAB awal ditetapkan Direktur di data project; addendum menambah RAB yang ada.', 'projectId')
}

/** US-18: PM of the team creates a Draft (and submits it at once with `submit: true`). */
export async function createAddendum(req: PayloadRequest, input: AddendumInput): Promise<AddendumDoc> {
  const uid = userId(req)
  if (uid === undefined) fail(401, 'FORBIDDEN', 'Unauthorized')
  const project = await loadProject(req, input.projectId)
  if (!(await isTeamPm(req, input.projectId))) await deniedCreate(req, input.projectId)
  checkInput(input)
  checkProjectOpen(project)
  const doc = (await req.payload.create({
    collection: 'budget-addenda',
    data: {
      project: input.projectId,
      status: 'draft',
      addition: input.addition,
      reason: input.reason.trim(),
      createdBy: uid!,
      approvalCycle: 0,
      source: requestMeta(req).source === 'apk' ? 'apk' : 'web',
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: addendum after the role/scope checks above (HTTP create is closed)
    req,
  })) as unknown as AddendumDoc
  return input.submit ? submitAddendum(req, doc.id) : doc
}

/** Draft edit by its creator (still PM of the team). */
export async function editAddendum(req: PayloadRequest, id: number, patch: { addition?: number; reason?: string }): Promise<AddendumDoc> {
  const doc = await loadVisibleAddendum(req, id, { lock: true })
  await requireAction(req, doc, 'edit')
  const next = { addition: patch.addition ?? doc.addition, reason: patch.reason ?? doc.reason }
  checkInput(next)
  const data: Record<string, unknown> = {}
  if (next.addition !== doc.addition) data.addition = next.addition
  if (next.reason.trim() !== doc.reason) data.reason = next.reason.trim()
  if (Object.keys(data).length === 0) return doc
  return updateAddendum(req, id, data)
}

/** Draft → Menunggu Direktur | Menunggu Finance: rule resolved + snapshotted, number ADD/YYMM/#### allocated. */
export async function submitAddendum(req: PayloadRequest, id: number): Promise<AddendumDoc> {
  const visible = await loadVisibleAddendum(req, id, { lock: true })
  await requireAction(req, visible, 'submit')
  const doc = await loadRawAddendum(req, id)
  const projectId = relId(doc.project)!
  const project = await loadProject(req, projectId)
  checkInput(doc)
  checkProjectOpen(project)
  const rule = selectRule(await loadActiveRules(req, 'budget_addendum'), {
    docType: 'budget_addendum',
    type: null,
    grandTotal: doc.addition,
    categoryIds: [],
    projectId,
    costCenterId: null,
  })
  if (!rule) fail(409, 'NO_RULE', 'Tidak ada aturan approval addendum RAB yang berlaku (approval-rules docType budget_addendum). Hubungi Admin.')
  const snapshot = await snapshotForRule(req, rule!, new Set([relId(doc.createdBy)!]))
  const date = await today(req)
  const docNo = doc.docNo ?? (await allocateDocNo(req, 'budget_addendum', { date: parseBusinessDate(date), docId: String(id) })).docNo
  const needsAck = snapshot.acknowledge === 'required'
  const updated = await updateAddendum(req, id, {
    status: needsAck ? 'pending_ack' : 'pending_approval',
    docNo,
    submittedAt: new Date().toISOString(),
    budgetAtSubmit: Number(project.budget ?? 0),
    approvalRule: rule!.id,
    approvalSnapshot: snapshot,
    approvalCycle: 1,
    currentLevel: needsAck ? 0 : 1,
  })
  const skipped = (snapshot.skipped ?? []).map((s) => ({
    action: 'approval_skipped' as const,
    docType: 'budget_addendum',
    docId: String(id),
    docNo,
    field: s.position,
    newValue: { level: s.level, role: s.role, userId: s.userId, cycle: 1 },
    reason: s.reason,
  }))
  await writeAudit(req, skipped)
  await notifyStep(req, updated, project)
  return updated
}

/** Cancel (reason required, G7): the creator, before any decision. */
export async function cancelAddendum(req: PayloadRequest, id: number, reason: string): Promise<AddendumDoc> {
  const doc = await loadVisibleAddendum(req, id, { lock: true })
  await requireAction(req, doc, 'cancel')
  return updateAddendum(req, id, { status: 'cancelled', cancelReason: reason.trim(), currentLevel: null }, reason.trim())
}

// ---------------------------------------------------------------- decisions

type SignOpts = { signatureMediaId?: number | null }

async function insertDecision(
  req: PayloadRequest,
  doc: AddendumDoc,
  row: { position: 'diketahui' | 'approval'; level: number; decision: 'acknowledged' | 'approved' | 'rejected'; reason?: string | null; signature: Signature | null; impact: { pctBefore: number | null; pctAfter: number | null } },
): Promise<void> {
  const caller = userId(req)!
  const meta = requestMeta(req)
  await req.payload.create({
    collection: 'approvals',
    data: {
      docType: 'budget_addendum',
      addendum: doc.id,
      cycle: doc.approvalCycle ?? 1,
      position: row.position,
      level: row.level,
      actor: caller,
      actorName: await displayName(req, caller),
      onBehalf: false,
      decision: row.decision,
      reason: row.reason ?? null,
      budgetPctBefore: row.impact.pctBefore,
      budgetPctAfter: row.impact.pctAfter,
      signature: row.signature?.mediaId ?? null,
      signatureSha256: row.signature?.sha256 ?? null,
      signatureSource: row.signature ? row.signature.source : 'none',
      deviceId: meta.deviceId ?? null,
      source: meta.source,
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: Class A decision row after the guards (G1/G2; DB re-checks G1)
    req,
  })
  const action = row.decision === 'acknowledged' ? 'acknowledge' : row.decision === 'approved' ? 'approve' : 'reject'
  await writeAudit(req, [
    {
      action,
      docType: 'budget_addendum',
      docId: String(doc.id),
      docNo: doc.docNo ?? undefined,
      field: row.position,
      newValue: { level: row.level, decision: row.decision, addition: doc.addition, budgetPctBefore: row.impact.pctBefore, budgetPctAfter: row.impact.pctAfter, signatureSource: row.signature?.source ?? 'none' },
      reason: row.reason ?? undefined,
    },
  ])
}

/**
 * Final approval: the project RAB is increased in THIS transaction — row lock on the project, the
 * CURRENT budget re-read (concurrent addenda), budget update through the Local API (audit row
 * project.budget old → new with the addendum as reason), old/new budget stored on the addendum.
 */
async function finalize(req: PayloadRequest, doc: AddendumDoc, project: ProjectRow): Promise<AddendumDoc> {
  const projectId = project.id
  await lockProject(req, projectId)
  const fresh = await loadProject(req, projectId)
  if (fresh.status === 'arsip') fail(409, 'STATE_CONFLICT', 'Project sudah diarsipkan; addendum tidak dapat disetujui.')
  const oldBudget = Math.round(Number(fresh.budget ?? 0))
  const nextBudget = newBudget(oldBudget, doc.addition)
  const approved = await updateAddendum(req, doc.id, { status: 'approved', oldBudget, newBudget: nextBudget, decidedAt: new Date().toISOString(), currentLevel: null })
  req.context.auditReason = `Addendum RAB ${doc.docNo ?? `#${doc.id}`} disetujui: ${doc.reason}`.slice(0, 1000)
  try {
    await req.payload.update({
      collection: 'projects',
      id: projectId,
      data: { budget: nextBudget },
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: RAB += approved addendum (T12), audited before → after
      req,
    })
  } finally {
    delete req.context.auditReason
  }
  const creator = relId(doc.createdBy)
  const finance = await usersWithRole(req, 'pk-finance')
  await notify(req, approved, 'addendum.approved', [...(creator ? [creator] : []), ...finance], fresh)
  return approved
}

/** "Diketahui" = the Direktur's approval (ADR 0013). */
export async function acknowledgeAddendum(req: PayloadRequest, id: number, opts: SignOpts = {}): Promise<AddendumDoc> {
  const visible = await loadVisibleAddendum(req, id, { lock: true })
  await requireAction(req, visible, 'acknowledge')
  const doc = await loadRawAddendum(req, id)
  const project = await loadProject(req, relId(doc.project)!)
  const sig = await resolveSignature(req, userId(req)!, opts.signatureMediaId)
  await insertDecision(req, doc, { position: 'diketahui', level: 0, decision: 'acknowledged', signature: sig, impact: await budgetImpact(req, project, doc.addition) })
  const snap = doc.approvalSnapshot!
  if (lastLevel(snap) === 0) return finalize(req, doc, project) // only approval level skipped (G1-2)
  const next = await updateAddendum(req, id, { status: 'pending_approval', currentLevel: 1 })
  await notifyStep(req, next, project)
  return next
}

/** Finance approval (level 1..n of the snapshot); the last level applies the addendum. */
export async function approveAddendum(req: PayloadRequest, id: number, opts: SignOpts = {}): Promise<AddendumDoc> {
  const visible = await loadVisibleAddendum(req, id, { lock: true })
  await requireAction(req, visible, 'approve')
  const doc = await loadRawAddendum(req, id)
  const project = await loadProject(req, relId(doc.project)!)
  const level = doc.currentLevel ?? 1
  const sig = await resolveSignature(req, userId(req)!, opts.signatureMediaId)
  await insertDecision(req, doc, { position: 'approval', level, decision: 'approved', signature: sig, impact: await budgetImpact(req, project, doc.addition) })
  if (level < lastLevel(doc.approvalSnapshot!)) {
    const next = await updateAddendum(req, id, { currentLevel: level + 1 })
    await notifyStep(req, next, project)
    return next
  }
  return finalize(req, doc, project)
}

/** Reject with reason (G7) at the Direktur or Finance step. */
export async function rejectAddendum(req: PayloadRequest, id: number, reason: string, opts: SignOpts = {}): Promise<AddendumDoc> {
  const visible = await loadVisibleAddendum(req, id, { lock: true })
  await requireAction(req, visible, 'reject')
  const doc = await loadRawAddendum(req, id)
  const project = await loadProject(req, relId(doc.project)!)
  const sig = await resolveSignature(req, userId(req)!, opts.signatureMediaId)
  const ack = doc.status === 'pending_ack'
  await insertDecision(req, doc, { position: ack ? 'diketahui' : 'approval', level: ack ? 0 : (doc.currentLevel ?? 1), decision: 'rejected', reason: reason.trim(), signature: sig, impact: await budgetImpact(req, project, doc.addition) })
  const rejected = await updateAddendum(req, id, { status: 'rejected', rejectReason: reason.trim(), decidedAt: new Date().toISOString(), currentLevel: null }, reason.trim())
  const creator = relId(doc.createdBy)
  await notify(req, rejected, 'addendum.rejected', creator ? [creator] : [], project)
  return rejected
}

// ---------------------------------------------------------------- read models

type Names = { projects: Map<number, ProjectRow>; users: Map<number, string> }

async function names(req: PayloadRequest, docs: readonly AddendumDoc[]): Promise<Names> {
  const out: Names = { projects: new Map(), users: new Map() }
  const pIds = [...new Set(docs.map((d) => relId(d.project)).filter((x): x is number => x !== undefined))]
  if (pIds.length) {
    const r = await req.payload.find({ collection: 'projects', where: { id: { in: pIds } }, depth: 0, pagination: false, select: { code: true, name: true, budget: true, status: true }, overrideAccess: true /* SYSTEM-READ: names of projects of readable addenda */, req })
    for (const p of r.docs as unknown as ProjectRow[]) out.projects.set(p.id, p)
  }
  for (const u of new Set(docs.map((d) => relId(d.createdBy)).filter((x): x is number => x !== undefined))) out.users.set(u, await displayName(req, u))
  return out
}

function stepLabel(doc: AddendumDoc): string | null {
  if (doc.status === 'pending_ack') return 'Persetujuan Direktur (Diketahui)'
  if (doc.status === 'pending_approval') {
    const n = doc.approvalSnapshot?.steps.length ?? 1
    return n > 1 ? `Approval Finance level ${doc.currentLevel ?? 1}/${n}` : 'Approval Finance'
  }
  return null
}

function summary(d: AddendumDoc, n: Names) {
  const pid = relId(d.project)!
  const p = n.projects.get(pid)
  const uid = relId(d.createdBy)!
  return {
    id: d.id,
    uuid: d.uuid ?? null,
    docNo: d.docNo ?? null,
    status: d.status,
    statusLabel: ADDENDUM_STATUS_LABELS[d.status],
    stepLabel: stepLabel(d),
    project: { id: pid, code: p?.code ?? null, name: p?.name ?? null, budget: p?.budget ?? null },
    addition: d.addition,
    reason: d.reason,
    budgetAtSubmit: d.budgetAtSubmit ?? null,
    oldBudget: d.oldBudget ?? null,
    newBudget: d.newBudget ?? null,
    createdBy: { id: uid, name: n.users.get(uid) ?? null },
    submittedAt: d.submittedAt ?? null,
    decidedAt: d.decidedAt ?? null,
    rejectReason: d.rejectReason ?? null,
    cancelReason: d.cancelReason ?? null,
    currentLevel: d.currentLevel ?? null,
    source: d.source ?? null,
    createdAt: d.createdAt ?? null,
  }
}

export type AddendumSummary = ReturnType<typeof summary>

/** Detail: summary + decision timeline + allowed actions + budget impact of the pending addition. */
export async function addendumDetail(req: PayloadRequest, doc: AddendumDoc) {
  const n = await names(req, [doc])
  const rows = await decisionsOf(req, doc.id)
  const ctx = await actorContext(req, doc, rows)
  const project = n.projects.get(relId(doc.project)!) ?? (await loadProject(req, relId(doc.project)!))
  const impact = await budgetImpact(req, project, doc.addition)
  const snap = doc.approvalSnapshot ?? null
  return {
    ...summary(doc, n),
    allowedActions: addendumAllowedActions(ctx),
    budget: { current: impact.budget, committed: impact.committed, afterAddition: impact.budgetAfter, committedPctBefore: impact.pctBefore, committedPctAfter: impact.pctAfter },
    approvalRule: snap ? { id: snap.ruleId, name: snap.ruleName, acknowledgeRole: snap.acknowledgeRole, levels: snap.steps.length, skipped: snap.skipped ?? [] } : null,
    decisions: rows.map((r) => ({
      id: r.id,
      position: r.position,
      level: r.level,
      actor: { id: relId(r.actor) ?? null, name: r.actorName ?? null },
      decision: r.decision,
      reason: r.reason ?? null,
      decidedAt: r.decidedAt ?? null,
      budgetPctBefore: r.budgetPctBefore ?? null,
      budgetPctAfter: r.budgetPctAfter ?? null,
      signatureSource: r.signatureSource ?? null,
    })),
  }
}

export type AddendumFilter = { projectId?: number; status?: AddendumStatus; mine?: boolean; limit: number; after?: number }

/** List (newest first, caller scope: PM team/own, Direktur/Finance all), cursor on id. */
export async function listAddenda(req: PayloadRequest, f: AddendumFilter): Promise<{ items: AddendumSummary[]; nextCursor: number | null }> {
  if (!mayReadAddenda(req)) return { items: [], nextCursor: null }
  const and: Where[] = []
  if (f.projectId !== undefined) and.push({ project: { equals: f.projectId } })
  if (f.status) and.push({ status: { equals: f.status } })
  if (f.mine) and.push({ createdBy: { equals: userId(req) ?? -1 } })
  if (f.after !== undefined) and.push({ id: { less_than: f.after } })
  const res = await req.payload.find({
    collection: 'budget-addenda',
    where: and.length ? { and } : undefined,
    sort: '-id',
    limit: f.limit + 1,
    depth: 0,
    user: req.user,
    overrideAccess: false, // caller's read scope
    req,
  })
  const docs = res.docs as unknown as AddendumDoc[]
  const page = docs.slice(0, f.limit)
  const n = await names(req, page)
  return { items: page.map((d) => summary(d, n)), nextCursor: docs.length > f.limit ? page[page.length - 1]!.id : null }
}

/** Addenda waiting for the CALLER's decision (Direktur "Diketahui" / Finance level), oldest first. */
export async function addendumInbox(req: PayloadRequest) {
  if (!hasRole(req, 'pk-owner', 'pk-finance')) return { items: [] as Array<AddendumSummary & { step: 'acknowledge' | 'approve'; budget: { current: number; afterAddition: number; committedPctBefore: number | null; committedPctAfter: number | null } }> }
  const res = await req.payload.find({
    collection: 'budget-addenda',
    where: { status: { in: ['pending_ack', 'pending_approval'] } },
    sort: 'submittedAt',
    limit: 200,
    depth: 0,
    user: req.user,
    overrideAccess: false,
    req,
  })
  const docs = res.docs as unknown as AddendumDoc[]
  const n = await names(req, docs)
  const items = []
  for (const d of docs) {
    const acts = addendumAllowedActions(await actorContext(req, d))
    const step = acts.includes('approve') ? ('approve' as const) : acts.includes('acknowledge') ? ('acknowledge' as const) : null
    if (!step) continue
    const p = n.projects.get(relId(d.project)!)!
    const impact = await budgetImpact(req, p, d.addition)
    items.push({ ...summary(d, n), step, budget: { current: impact.budget, afterAddition: impact.budgetAfter, committedPctBefore: impact.pctBefore, committedPctAfter: impact.pctAfter } })
  }
  return { items }
}

/** Team projects of the caller (PM) that can receive an addendum — web form options. */
export async function addendumProjectOptions(req: PayloadRequest): Promise<Array<{ id: number; code: string; name: string; budget: number | null }>> {
  if (!hasRole(req, 'pk-pm')) return []
  const res = await req.payload.find({
    collection: 'projects',
    where: { status: { not_equals: 'arsip' } },
    sort: 'code',
    depth: 0,
    pagination: false,
    select: { code: true, name: true, budget: true },
    user: req.user,
    overrideAccess: false,
    req,
  })
  const team = new Set((await resolveScope(req)).teamProjects)
  return (res.docs as unknown as Array<{ id: number; code: string; name: string; budget?: number | null }>)
    .filter((p) => team.has(p.id))
    .map((p) => ({ id: p.id, code: p.code, name: p.name, budget: p.budget ?? null }))
}
