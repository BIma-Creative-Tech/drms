import { sql } from '@payloadcms/db-postgres'
import { APIError, type PayloadRequest } from 'payload'

import { relId, userId, userRoles } from '@/access/roles'
import { writeAuditDetached } from '@/audit/writer'
import { DEFAULT_TZ, localDateInTz } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

import { allowedActions, FINANCE_SELF_GUARDED, mayPerform, targets, type Action, type ActorContext } from './state'
import { lacksDecisionRole } from './decision'
import { matchesAcknowledger, matchesStep, type ApprovalSnapshot } from './rules'
import { BUDGET_COMMITTED, type RequestStatus, type RequestType } from './types'

/** Public domain error (mapped to problem+json by the /api/v1 wrapper, Payload REST too). */
export function fail(status: number, message: string, errors?: Array<{ path: string; message: string }>): never {
  throw new APIError(message, status, errors ? { errors } : null, true)
}

export type LineDoc = {
  id: string
  description?: string | null
  qty?: number | null
  uom?: unknown
  unitPrice?: number | null
  total?: number | null
  notes?: string | null
  category?: unknown
  vehicle?: unknown
}

export type RequestDoc = {
  id: number
  docNo?: string | null
  type: RequestType
  status: RequestStatus
  title: string
  project?: unknown
  costCenter?: unknown
  requestDate?: string | null
  neededDate?: string | null
  periodFrom?: string | null
  periodTo?: string | null
  notes?: string | null
  requesters?: unknown[] | null
  createdBy?: unknown
  bankAccount?: unknown
  bankSnapshot?: { bankName?: string | null; accountNo?: string | null; accountHolder?: string | null } | null
  lines?: LineDoc[] | null
  grandTotal?: number | null
  approvedAmount?: number | null
  transferredTotal?: number | null
  verifiedReceiptsTotal?: number | null
  approvalRule?: unknown
  approvalSnapshot?: ApprovalSnapshot | null
  approvalCycle?: number | null
  currentLevel?: number | null
  submittedAt?: string | null
  resubmitOf?: unknown
  cancelReason?: string | null
  rejectReason?: string | null
  clientUuid?: string | null
  /** F4: content revision of an editable request (sync `rev` / `base_rev`). */
  syncRev?: number | null
  source?: string | null
  attachments?: unknown[] | null
  createdAt?: string
  updatedAt?: string
}

export type ApprovalRow = {
  id: number
  cycle: number
  position: 'diajukan' | 'dibuat' | 'diketahui' | 'approval'
  level: number
  actor?: unknown
  employee?: unknown
  actorName?: string | null
  onBehalf?: boolean | null
  decision: 'signed' | 'acknowledged' | 'approved' | 'rejected'
  reason?: string | null
  decidedAt?: string | null
  budgetPctBefore?: number | null
  budgetPctAfter?: number | null
  openFlags?: number | null
  signature?: unknown
  signatureSha256?: string | null
  signatureSource?: string | null
}

export const ids = (v: unknown[] | null | undefined): number[] => (v ?? []).map((x) => relId(x)).filter((x): x is number => x !== undefined)

/** Today's business date in the company timezone. */
export async function today(req: PayloadRequest): Promise<string> {
  const s = await settings(req)
  const d = localDateInTz(new Date(), s.timezone || process.env.TZ || DEFAULT_TZ)
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

export async function settings(req: PayloadRequest) {
  return req.payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: company settings */, req })
}

/** Row lock on the request (serialises concurrent actions on the same document). */
export async function lockRequest(req: PayloadRequest, id: number): Promise<void> {
  const tx = await getRequestTx(req)
  await tx.execute(sql`SELECT id FROM expense_requests WHERE id = ${id} FOR UPDATE`)
}

/**
 * Loads a request the CALLER may read (collection read access, overrideAccess:false) — anything
 * else is 404 (architecture §7.4: other PM's project → 404/empty). With `lock`, the row is locked
 * first so the returned state is the one the action acts on.
 */
export async function loadVisible(req: PayloadRequest, id: number, opts: { lock?: boolean } = {}): Promise<RequestDoc> {
  if (!Number.isSafeInteger(id) || id <= 0) fail(404, 'Pengajuan tidak ditemukan.')
  if (opts.lock) await lockRequest(req, id)
  try {
    const doc = await req.payload.findByID({ collection: 'expense-requests', id, depth: 0, user: req.user, overrideAccess: false, req })
    return doc as unknown as RequestDoc
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 404 || status === 403) fail(404, 'Pengajuan tidak ditemukan.')
    throw err
  }
}

/** Same document without access control (after the visibility check or for system work). */
export async function loadRaw(req: PayloadRequest, id: number): Promise<RequestDoc> {
  const doc = await req.payload.findByID({ collection: 'expense-requests', id, depth: 0, overrideAccess: true /* SYSTEM-READ: post-check reload */, req })
  return doc as unknown as RequestDoc
}

export async function approvalsOf(req: PayloadRequest, requestId: number, cycle?: number): Promise<ApprovalRow[]> {
  const res = await req.payload.find({
    collection: 'approvals',
    where: cycle === undefined ? { request: { equals: requestId } } : { and: [{ request: { equals: requestId } }, { cycle: { equals: cycle } }] },
    depth: 0,
    pagination: false,
    sort: 'id',
    overrideAccess: true, // SYSTEM-READ: guard evaluation (caller visibility checked by loadVisible)
    req,
  })
  return res.docs as unknown as ApprovalRow[]
}

export async function actorContext(req: PayloadRequest, doc: RequestDoc): Promise<ActorContext> {
  const uid = userId(req) ?? -1
  const roles = userRoles(req)
  const emp = relId((req.user as { employee?: unknown } | null)?.employee)
  const cycle = doc.approvalCycle ?? 0
  const rows = cycle > 0 ? await approvalsOf(req, doc.id, cycle) : []
  const decisions = rows.filter((r) => r.decision !== 'signed')
  const snap = doc.approvalSnapshot ?? null
  const caller = { id: uid, roles }
  const acknowledged = rows.some((r) => r.position === 'diketahui' && r.decision === 'acknowledged')
  const step = snap?.steps.find((s) => s.level === (doc.currentLevel ?? 0))
  return {
    type: doc.type,
    status: doc.status,
    roles,
    isCreator: relId(doc.createdBy) === uid,
    isRequester: emp !== undefined && ids(doc.requesters).includes(emp),
    hasDecision: decisions.length > 0,
    isAcknowledger:
      !!snap && !acknowledged && (doc.status === 'pending_ack' || (doc.status === 'pending_approval' && snap.acknowledge === 'optional')) && matchesAcknowledger(snap, caller),
    matchesCurrentStep: doc.status === 'pending_approval' && matchesStep(step, caller),
    alreadyDecided: decisions.some((r) => relId(r.actor) === uid && (r.position === 'diketahui' || r.position === 'approval')),
    lacksDecisionRole: lacksDecisionRole(snap, roles),
  }
}

/**
 * 403 when the caller may not perform the action on this document at all (role/ownership — checked
 * FIRST, E9 / UAT 5.2), 409 when the status does not allow it, else 403 for the remaining
 * status-dependent turn rules (not the caller's step / already decided).
 */
export function requireAction(ctx: ActorContext, action: Action): void {
  if (!mayPerform(ctx, action)) fail(403, 'Anda tidak berhak melakukan aksi ini pada pengajuan ini.')
  const nonTransition = ['edit', 'add_receipt', 'receipt_verify', 'review_flag', 'resubmit'].includes(action)
  if (!nonTransition && targets(ctx.type, ctx.status, action).length === 0) {
    fail(409, `Aksi tidak dapat dilakukan pada status pengajuan saat ini (${ctx.status}).`)
  }
  if (!allowedActions(ctx).includes(action)) {
    const own = ctx.isCreator || ctx.isRequester
    if (own && action === 'edit') fail(409, 'Pengajuan hanya dapat diubah saat Draft (tarik kembali dulu).')
    if (own && action === 'add_receipt') fail(409, 'Nota tidak dapat diubah pada status pengajuan saat ini.')
    if (own && action === 'resubmit') fail(409, 'Hanya pengajuan yang ditolak yang dapat diajukan ulang.')
    fail(403, 'Anda tidak berhak melakukan aksi ini pada pengajuan ini.')
  }
}

/** Decision actions a requester/creator may never take (G1, Q-08). */
const G1_DECISIONS: ReadonlySet<Action> = new Set<Action>(['acknowledge', 'approve', 'reject'])

/**
 * `requireAction` + audit of decision-role denials (E1, ADR 0013: caller is neither Direktur nor
 * Finance on a Direktur → Finance request) and of SELF-INVOLVEMENT denials (F2e): a requester/creator attempting a
 * decision (G1) or a Finance user attempting a receipt/flag/LPJ verification on a request it
 * requested or created (FINANCE_SELF_GUARDED) → 403 and an `access_denied` audit row written in its
 * own transaction (the failing operation rolls back, the attempt stays recorded).
 */
export async function requireActionAudited(req: PayloadRequest, ctx: ActorContext, action: Action, doc: Pick<RequestDoc, 'id' | 'docNo'>): Promise<void> {
  if (G1_DECISIONS.has(action) && ctx.lacksDecisionRole) {
    // ADR 0013 (E1): PM / Staff / Admin never decide on a Direktur → Finance request — refused whatever
    // the status, and the attempt is recorded (defence in depth behind the UI and the rule hook).
    await writeAuditDetached(req, [
      {
        action: 'access_denied',
        docType: 'expense_request',
        docId: String(doc.id),
        docNo: doc.docNo ?? undefined,
        field: action,
        newValue: { action, status: ctx.status, roles: ctx.roles },
        reason: 'hanya Direktur/Finance yang memberi keputusan (ADR 0013; PM hanya memantau)',
      },
    ])
    fail(403, 'Hanya Direktur atau Finance yang dapat menyetujui atau menolak pengajuan (ADR 0013). PM hanya memantau.')
  }
  try {
    requireAction(ctx, action)
  } catch (err) {
    const selfInvolved = ctx.isCreator || ctx.isRequester
    const financeSelf = FINANCE_SELF_GUARDED.has(action) && ctx.roles.includes('pk-finance')
    if ((err as { status?: number }).status !== 403 || !selfInvolved || !(financeSelf || G1_DECISIONS.has(action))) throw err
    const guard = financeSelf ? 'Finance adalah pemohon/pembuat pengajuan ini (G1)' : 'pemohon/pembuat tidak boleh memutuskan pengajuannya sendiri (G1, Q-08)'
    await writeAuditDetached(req, [
      { action: 'access_denied', docType: 'expense_request', docId: String(doc.id), docNo: doc.docNo ?? undefined, field: action, newValue: { action, status: ctx.status }, reason: guard },
    ])
    fail(
      403,
      financeSelf
        ? 'Finance tidak dapat memverifikasi nota, meninjau flag atau memverifikasi LPJ pada pengajuan di mana ia pemohon atau pembuat (G1). Minta Finance lain.'
        : 'Pemohon/pembuat tidak dapat memberi keputusan pada pengajuannya sendiri (G1).',
    )
  }
}

/**
 * The only way the service changes a request after creation: status/workflow fields through a
 * Local API update flagged `pkTransition` (hook allows it; DB guard still freezes locked content).
 * `reason` goes to the audit rows of this change.
 */
export async function updateRequest(req: PayloadRequest, id: number, data: Record<string, unknown>, reason?: string): Promise<RequestDoc> {
  req.context.pkTransition = true
  if (reason) req.context.auditReason = reason
  try {
    const doc = await req.payload.update({
      collection: 'expense-requests',
      id,
      data: data as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: state machine transition after guards (G6)
      req,
    })
    return doc as unknown as RequestDoc
  } finally {
    delete req.context.pkTransition
  }
}

/** US-26: committed amount of the project's OTHER requests (approved and later). */
export async function projectCommitted(req: PayloadRequest, projectId: number, excludeId: number): Promise<number> {
  const tx = await getRequestTx(req)
  const statuses = sql.join(
    BUDGET_COMMITTED.map((s) => sql`${s}`),
    sql`, `,
  )
  const r = (await tx.execute(sql`
    SELECT coalesce(sum(grand_total), 0)::text AS s FROM expense_requests
    WHERE project_id = ${projectId} AND id <> ${excludeId} AND status::text IN (${statuses})`)) as unknown as { rows: Array<{ s: string }> }
  return Number(r.rows[0]?.s ?? 0)
}

/**
 * Flag count stored with a decision (`approvals.openFlags`, US-26/US-59). S3e (S-05): counts what the
 * decider sees as open in the inbox / review panel — status "Terbuka", BOTH levels (peringatan + info).
 * Reviewed ("Sudah diperiksa") and resolved flags are not counted. Decisions before S3e counted
 * open warnings only.
 */
export async function openFlagCount(req: PayloadRequest, requestId: number): Promise<number> {
  const r = await req.payload.count({
    collection: 'receipt-flags',
    where: { and: [{ request: { equals: requestId } }, { status: { equals: 'open' } }] },
    overrideAccess: true, // SYSTEM-READ: flag count for decisions
    req,
  })
  return r.totalDocs
}

export type Signature = { mediaId: number; sha256: string | null; source: 'profile' | 'captured' }

/**
 * US-43 / Q-15 default (both): a signature captured on screen (a `media-signatures` upload of the
 * SAME user) or the user's profile signature. The media row is immutable (update access false +
 * protected columns), so referencing it by id + sha256 is a snapshot — a later profile change
 * points to a new media row and never alters signed documents.
 */
export async function resolveSignature(req: PayloadRequest, signerId: number, capturedId?: number | null): Promise<Signature | null> {
  if (capturedId) {
    const m = await req.payload
      .findByID({ collection: 'media-signatures', id: capturedId, depth: 0, overrideAccess: true /* SYSTEM-READ: ownership checked below */, req })
      .catch(() => null)
    if (!m || relId(m.uploadedBy) !== signerId) fail(400, 'Tanda tangan tidak ditemukan atau bukan milik Anda.')
    return { mediaId: m.id, sha256: m.sha256Original ?? null, source: 'captured' }
  }
  const u = await req.payload.findByID({ collection: 'users', id: signerId, depth: 0, overrideAccess: true /* SYSTEM-READ: profile signature */, req }).catch(() => null)
  const sigId = relId(u?.signature)
  if (!sigId) return null
  const m = await req.payload.findByID({ collection: 'media-signatures', id: sigId, depth: 0, overrideAccess: true /* SYSTEM-READ: profile signature */, req }).catch(() => null)
  return m ? { mediaId: m.id, sha256: m.sha256Original ?? null, source: 'profile' } : null
}

export async function displayName(req: PayloadRequest, uid: number): Promise<string> {
  const u = await req.payload.findByID({ collection: 'users', id: uid, depth: 1, overrideAccess: true /* SYSTEM-READ: display name */, req }).catch(() => null)
  const emp = u?.employee && typeof u.employee === 'object' ? (u.employee as { name?: string }).name : undefined
  return emp || u?.name || u?.email || `user#${uid}`
}
