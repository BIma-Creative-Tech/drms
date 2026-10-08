import type { PayloadRequest, Where } from 'payload'

import { companiesWithRole, relId, rolesIn, userId, userRoles, type Role } from '@/access/roles'
import { writeAudit, writeAuditDetached } from '@/audit/writer'
import { membersWithRole } from '@/domain/companies'
import { notificationTemplate, pushEnabled } from '@/domain/notifications'
import { formatRupiah } from '@/lib/money'
import { requestMeta } from '@/lib/request-meta'

import { actorContext, displayName, fail, loadRaw, loadVisible, requireActionAudited, resolveSignature, type RequestDoc, type Signature } from './common'
import { lacksDecisionRole } from './decision'
import { requireSettlement, settlementOfRequest, shortfallStateOf, updateSettlement, type SettlementDoc } from './lpj'
import { lastLevel, matchesAcknowledger, matchesStep, type ApprovalSnapshot } from './rules'
import { SHORTFALL_APPROVAL_LABELS, shortfallAllowedActions, type ShortfallAction, type ShortfallApprovalStatus, type ShortfallCtx } from './settlement-rules'
import { involvedUserIds, selectAndSnapshot } from './snapshot'

/**
 * QA-06 / ADR 0019 — LPJ shortfall above the approved amount (owner decision 2026-10-08: tolerance,
 * then re-approval). When paying the verified shortfall would make the request's transferred total
 * exceed approved × (1 + `shortfallTolerancePct`/100), `settle` answers 409 SHORTFALL_REAPPROVAL_REQUIRED.
 * Finance then asks for the "persetujuan kekurangan": the NEW TOTAL goes through the existing approval
 * engine (ADR 0013: the request's matching `approval-rules` row, Direktur "Diketahui" → Finance level
 * 1..n, G1/G2, G1-2 skip rule) — state on the LPJ (`settlements.shortfallApproval*`, the request stays
 * "LPJ Terverifikasi"), decision rows in `approvals` (docType `expense_shortfall`, `settlement`).
 * Approved → `settle` pays the shortfall as before; rejected → settle stays refused (Finance may ask
 * again with a new justification). Web only: the APK inbox lists requests in pending_ack /
 * pending_approval and is not changed (ADR 0019 §APK). Every write in the caller's transaction.
 */

export type ShortfallDecisionRow = {
  id: number
  cycle: number
  position: 'diketahui' | 'approval'
  level: number
  actor?: unknown
  actorName?: string | null
  decision: 'acknowledged' | 'approved' | 'rejected'
  reason?: string | null
  decidedAt?: string | null
  signatureSource?: string | null
}

export async function shortfallDecisions(req: PayloadRequest, settlementId: number): Promise<ShortfallDecisionRow[]> {
  const res = await req.payload.find({
    collection: 'approvals',
    where: { and: [{ docType: { equals: 'expense_shortfall' } }, { settlement: { equals: settlementId } }] },
    depth: 0,
    pagination: false,
    sort: 'id',
    overrideAccess: true, // SYSTEM-READ: decision rows of an LPJ whose request the caller may read
    req,
  })
  return res.docs as unknown as ShortfallDecisionRow[]
}

async function ctxOf(req: PayloadRequest, raw: RequestDoc, s: SettlementDoc, rows?: ShortfallDecisionRow[]): Promise<ShortfallCtx & { roles: readonly Role[] }> {
  const uid = userId(req) ?? -1
  const company = relId((raw as { company?: unknown }).company)
  const roles = company !== undefined ? rolesIn(req, company) : userRoles(req)
  const involved = await involvedUserIds(req, raw)
  const cycle = s.shortfallApprovalCycle ?? 0
  const decisions = (rows ?? (cycle > 0 ? await shortfallDecisions(req, s.id) : [])).filter((r) => r.cycle === cycle)
  const snap = (s.shortfallApprovalSnapshot ?? null) as ApprovalSnapshot | null
  const status = s.shortfallApprovalStatus ?? null
  const caller = { id: uid, roles }
  const step = snap?.steps.find((x) => x.level === (s.shortfallApprovalLevel ?? 1))
  return {
    roles,
    status,
    selfInvolved: involved.has(uid),
    isAcknowledger: !!snap && status === 'pending_ack' && matchesAcknowledger(snap, caller),
    matchesCurrentStep: !!snap && status === 'pending_approval' && matchesStep(step, caller),
    alreadyDecided: decisions.some((r) => relId(r.actor) === uid),
    lacksDecisionRole: lacksDecisionRole(snap, roles),
  }
}

// ---------------------------------------------------------------- notifications

type ShortfallEvent = 'expense.shortfall_pending_ack' | 'expense.shortfall_pending_approval' | 'expense.shortfall_approved' | 'expense.shortfall_rejected'

const DEFAULTS: Record<ShortfallEvent, { title: string; body: string }> = {
  'expense.shortfall_pending_ack': {
    title: 'Persetujuan kekurangan LPJ: {docNo}',
    body: 'Kekurangan LPJ {docNo} membuat total transfer {amount} (disetujui {approved}). Menunggu persetujuan Anda sebagai Direktur di menu Persetujuan (web).',
  },
  'expense.shortfall_pending_approval': {
    title: 'Approval kekurangan LPJ: {docNo}',
    body: 'Kekurangan LPJ {docNo} membuat total transfer {amount} (disetujui {approved}). Menunggu approval Anda di menu Persetujuan (web).',
  },
  'expense.shortfall_approved': { title: 'Kekurangan LPJ disetujui: {docNo}', body: 'Total transfer {amount} untuk {docNo} disetujui. Transfer kekurangan dapat dicatat di Verifikasi LPJ.' },
  'expense.shortfall_rejected': { title: 'Kekurangan LPJ ditolak: {docNo}', body: 'Persetujuan kekurangan LPJ {docNo} ditolak. Lihat alasannya di Verifikasi LPJ.' },
}

async function notify(req: PayloadRequest, raw: RequestDoc, s: SettlementDoc, event: ShortfallEvent, to: number[]): Promise<void> {
  const actor = userId(req)
  const exclude = await involvedUserIds(req, raw) // G1: requester/creator never get a decision request
  const t = await notificationTemplate(req, event, DEFAULTS[event])
  const vars: Record<string, string> = { docNo: raw.docNo ?? `#${raw.id}`, amount: formatRupiah(s.shortfallApprovalAmount ?? 0), approved: formatRupiah(raw.approvedAmount ?? 0) }
  const render = (x: string) => x.replace(/\{(docNo|amount|approved)\}/g, (_, k: string) => vars[k] ?? '')
  for (const uid of new Set(to)) {
    if (uid === actor || (event.endsWith('pending_ack') || event.endsWith('pending_approval') ? exclude.has(uid) : false)) continue
    await req.payload.create({
      collection: 'notifications',
      data: {
        user: uid,
        event,
        title: render(t.title).slice(0, 160),
        body: render(t.body).slice(0, 1000),
        docType: 'expense_request', // opens the request (web + APK know this doc type)
        docId: String(raw.id),
        docNo: raw.docNo ?? null,
        company: relId((raw as { company?: unknown }).company) ?? null,
        pushStatus: pushEnabled() ? 'pending' : 'skipped',
      } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: in-app notification committed with the transition
      req,
    })
  }
}

async function stepRecipients(req: PayloadRequest, raw: RequestDoc, s: SettlementDoc): Promise<number[]> {
  const snap = (s.shortfallApprovalSnapshot ?? null) as ApprovalSnapshot | null
  const company = relId((raw as { company?: unknown }).company)
  if (!snap || company === undefined) return []
  if (s.shortfallApprovalStatus === 'pending_ack') {
    if (snap.acknowledgerUserId !== null) return [snap.acknowledgerUserId]
    return snap.acknowledgeRole ? membersWithRole(req, snap.acknowledgeRole, company) : []
  }
  const step = snap.steps.find((x) => x.level === (s.shortfallApprovalLevel ?? 1))
  if (step?.approverUserId) return [step.approverUserId]
  return step?.approverRole ? membersWithRole(req, step.approverRole, company) : []
}

async function notifyStep(req: PayloadRequest, raw: RequestDoc, s: SettlementDoc): Promise<void> {
  if (s.shortfallApprovalStatus === 'pending_ack') await notify(req, raw, s, 'expense.shortfall_pending_ack', await stepRecipients(req, raw, s))
  else if (s.shortfallApprovalStatus === 'pending_approval') await notify(req, raw, s, 'expense.shortfall_pending_approval', await stepRecipients(req, raw, s))
}

async function financeOf(req: PayloadRequest, raw: RequestDoc): Promise<number[]> {
  const company = relId((raw as { company?: unknown }).company)
  return company === undefined ? [] : membersWithRole(req, 'pk-finance', company)
}

// ---------------------------------------------------------------- request (Finance)

/**
 * POST …/lpj/shortfall-approval {note} — Finance (the `settle` guard: Finance of the request's PT, never
 * on its own request), LPJ verified with a shortfall ABOVE the tolerance, no approval running or
 * covering it. Rule = the request's approval rule for the NEW total (US-34 selection, ADR 0013 checks).
 */
export async function requestShortfallApproval(req: PayloadRequest, id: number, note: string): Promise<SettlementDoc> {
  const visible = await loadVisible(req, id, { lock: true })
  await requireActionAudited(req, await actorContext(req, visible), 'settle', visible)
  const s = await requireSettlement(req, id, ['verified'])
  if (s.settlementType !== 'shortfall') fail(409, 'LPJ ini tidak memiliki kekurangan yang perlu disetujui.')
  const raw = await loadRaw(req, id)
  const sf = await shortfallStateOf(req, raw, s)
  if (!sf.aboveTolerance) fail(409, `Kekurangan masih dalam toleransi ${sf.tolerancePct}% (maks. total ${formatRupiah(sf.ceiling)}); selesaikan langsung tanpa persetujuan.`)
  if (s.shortfallApprovalStatus === 'pending_ack' || s.shortfallApprovalStatus === 'pending_approval') fail(409, 'Persetujuan kekurangan sedang berjalan.')
  if (sf.covered) fail(409, 'Kekurangan sudah disetujui; catat transfer kekurangan.')
  const { snapshot } = await selectAndSnapshot(req, { ...raw, grandTotal: sf.totalAfter })
  const needsAck = snapshot.acknowledge === 'required'
  const cycle = (s.shortfallApprovalCycle ?? 0) + 1
  const reason = note.trim()
  const updated = await updateSettlement(
    req,
    s.id,
    {
      shortfallApprovalStatus: needsAck ? 'pending_ack' : 'pending_approval',
      shortfallApprovalCycle: cycle,
      shortfallApprovalLevel: needsAck ? 0 : 1,
      shortfallApprovalAmount: sf.totalAfter,
      shortfallApprovalSnapshot: snapshot,
      shortfallApprovalNote: reason,
      shortfallRejectReason: null,
    },
    reason,
  )
  delete req.context.auditReason
  await writeAudit(
    req,
    (snapshot.skipped ?? []).map((x) => ({
      action: 'approval_skipped' as const,
      docType: 'settlement',
      docId: String(s.id),
      docNo: s.docNo ?? undefined,
      field: x.position,
      newValue: { level: x.level, role: x.role, userId: x.userId, cycle, shortfallApproval: true },
      reason: x.reason,
    })),
  )
  await notifyStep(req, raw, updated)
  return updated
}

// ---------------------------------------------------------------- decisions (Direktur → Finance)

const STATUS_FOR: Record<ShortfallAction, ShortfallApprovalStatus[]> = {
  acknowledge: ['pending_ack'],
  approve: ['pending_approval'],
  reject: ['pending_ack', 'pending_approval'],
}

async function requireDecision(req: PayloadRequest, raw: RequestDoc, s: SettlementDoc, action: ShortfallAction): Promise<void> {
  const ctx = await ctxOf(req, raw, s)
  if (shortfallAllowedActions(ctx).includes(action)) return
  const audit = async (reason: string) =>
    writeAuditDetached(req, [{ action: 'access_denied', docType: 'settlement', docId: String(s.id), docNo: s.docNo ?? undefined, field: `shortfall_${action}`, newValue: { action, status: ctx.status, roles: ctx.roles }, reason }])
  // E9 rule: authorization (403) before state (409)
  if (ctx.lacksDecisionRole || !ctx.roles.some((r) => r === 'pk-owner' || r === 'pk-finance')) {
    await audit('hanya Direktur/Finance yang memutuskan kekurangan LPJ (ADR 0013/0019)')
    fail(403, 'Hanya Direktur atau Finance yang dapat menyetujui atau menolak kekurangan LPJ.')
  }
  if (ctx.selfInvolved) {
    await audit('pemohon/pembuat tidak boleh memutuskan kekurangan pengajuannya sendiri (G1)')
    fail(403, 'Pemohon/pembuat tidak dapat memberi keputusan pada pengajuannya sendiri (G1).')
  }
  if (!ctx.status || !STATUS_FOR[action].includes(ctx.status)) fail(409, `Tidak ada persetujuan kekurangan yang menunggu langkah ini${ctx.status ? ` (${SHORTFALL_APPROVAL_LABELS[ctx.status]})` : ''}.`)
  if (ctx.alreadyDecided) fail(409, 'Anda sudah memberi keputusan pada persetujuan kekurangan ini (satu posisi per orang, G1).')
  await audit('bukan pemutus pada langkah ini (G2)')
  fail(403, 'Anda bukan pemutus pada langkah persetujuan kekurangan ini.')
}

async function insertDecision(req: PayloadRequest, s: SettlementDoc, row: { position: 'diketahui' | 'approval'; level: number; decision: 'acknowledged' | 'approved' | 'rejected'; reason?: string | null; signature: Signature | null }): Promise<void> {
  const caller = userId(req)!
  const meta = requestMeta(req)
  await req.payload.create({
    collection: 'approvals',
    data: {
      docType: 'expense_shortfall',
      settlement: s.id,
      cycle: s.shortfallApprovalCycle ?? 1,
      position: row.position,
      level: row.level,
      actor: caller,
      actorName: await displayName(req, caller),
      onBehalf: false,
      decision: row.decision,
      reason: row.reason ?? null,
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
      docType: 'settlement',
      docId: String(s.id),
      docNo: s.docNo ?? undefined,
      field: `shortfall_${row.position}`,
      newValue: { level: row.level, decision: row.decision, cycle: s.shortfallApprovalCycle ?? 1, amount: s.shortfallApprovalAmount ?? null, signatureSource: row.signature?.source ?? 'none' },
      reason: row.reason ?? undefined,
    },
  ])
}

/**
 * POST …/lpj/shortfall-approval/{acknowledge|approve|reject} — Direktur "Diketahui" (= approval, ADR
 * 0013), Finance levels 1..n of the snapshot; reject needs a reason (G7). Signature: profile or
 * `signatureMediaId` (required to approve, like the request decisions, US-43).
 */
export async function decideShortfall(req: PayloadRequest, id: number, action: ShortfallAction, opts: { reason?: string; signatureMediaId?: number | null } = {}): Promise<SettlementDoc> {
  await loadVisible(req, id, { lock: true })
  const raw = await loadRaw(req, id)
  const s = await settlementOfRequest(req, id)
  if (!s || s.status !== 'verified') fail(409, 'Tidak ada LPJ terverifikasi yang menunggu persetujuan kekurangan.')
  await requireDecision(req, raw, s!, action)
  const caller = userId(req)!
  const sig = await resolveSignature(req, caller, opts.signatureMediaId)
  if (!sig && action !== 'reject') fail(409, 'Tanda tangan wajib: unggah tanda tangan di profil atau kirim signatureMediaId (US-43).')
  const snap = s!.shortfallApprovalSnapshot as ApprovalSnapshot
  if (action === 'reject') {
    const reason = (opts.reason ?? '').trim()
    if (reason.length < 3) fail(400, 'Alasan penolakan wajib diisi (minimal 3 karakter).', [{ path: 'reason', message: 'Wajib.' }])
    const ack = s!.shortfallApprovalStatus === 'pending_ack'
    await insertDecision(req, s!, { position: ack ? 'diketahui' : 'approval', level: ack ? 0 : (s!.shortfallApprovalLevel ?? 1), decision: 'rejected', reason, signature: sig })
    const rejected = await updateSettlement(req, s!.id, { shortfallApprovalStatus: 'rejected', shortfallApprovalLevel: null, shortfallRejectReason: reason }, reason)
    delete req.context.auditReason
    await notify(req, raw, rejected, 'expense.shortfall_rejected', await financeOf(req, raw))
    return rejected
  }
  if (action === 'acknowledge') {
    await insertDecision(req, s!, { position: 'diketahui', level: 0, decision: 'acknowledged', signature: sig })
    if (lastLevel(snap) === 0) return finalize(req, raw, s!) // only approval level skipped (G1-2)
    const next = await updateSettlement(req, s!.id, { shortfallApprovalStatus: 'pending_approval', shortfallApprovalLevel: 1 })
    await notifyStep(req, raw, next)
    return next
  }
  const level = s!.shortfallApprovalLevel ?? 1
  await insertDecision(req, s!, { position: 'approval', level, decision: 'approved', signature: sig })
  if (level < lastLevel(snap)) {
    const next = await updateSettlement(req, s!.id, { shortfallApprovalLevel: level + 1 })
    await notifyStep(req, raw, next)
    return next
  }
  return finalize(req, raw, s!)
}

async function finalize(req: PayloadRequest, raw: RequestDoc, s: SettlementDoc): Promise<SettlementDoc> {
  const approved = await updateSettlement(req, s.id, { shortfallApprovalStatus: 'approved', shortfallApprovalLevel: null })
  await notify(req, raw, approved, 'expense.shortfall_approved', await financeOf(req, raw))
  return approved
}

// ---------------------------------------------------------------- read models

/** Shortfall section of the request detail / LPJ screen (null when the LPJ has no shortfall). */
export async function shortfallSummary(req: PayloadRequest, raw: RequestDoc, s: SettlementDoc | null) {
  if (!s || s.settlementType !== 'shortfall') return null
  const sf = await shortfallStateOf(req, raw, s)
  const rows = (s.shortfallApprovalCycle ?? 0) > 0 ? await shortfallDecisions(req, s.id) : []
  const ctx = await ctxOf(req, raw, s, rows)
  const status = s.shortfallApprovalStatus ?? null
  return {
    approvedAmount: sf.approvedAmount,
    tolerancePct: sf.tolerancePct,
    limit: sf.ceiling,
    totalAfter: sf.totalAfter,
    aboveTolerance: sf.aboveTolerance,
    settleAllowed: s.status === 'verified' ? sf.allowed : null,
    status,
    statusLabel: status ? SHORTFALL_APPROVAL_LABELS[status] : null,
    amount: s.shortfallApprovalAmount ?? null,
    cycle: s.shortfallApprovalCycle ?? 0,
    level: s.shortfallApprovalLevel ?? null,
    note: s.shortfallApprovalNote ?? null,
    rejectReason: s.shortfallRejectReason ?? null,
    allowedActions: s.status === 'verified' ? shortfallAllowedActions(ctx) : [],
    decisions: rows.map((r) => ({ cycle: r.cycle, position: r.position, level: r.level, actorName: r.actorName ?? null, decision: r.decision, reason: r.reason ?? null, decidedAt: r.decidedAt ?? null })),
  }
}

export type ShortfallSummary = NonNullable<Awaited<ReturnType<typeof shortfallSummary>>>

/** LPJ shortfall approvals waiting for the CALLER (Direktur "Diketahui" / Finance level), oldest first. */
export async function shortfallInbox(req: PayloadRequest, f: { companyIds?: readonly number[] } = {}) {
  const pts = companiesWithRole(req, ['pk-owner', 'pk-finance']).filter((c) => !f.companyIds?.length || f.companyIds.includes(c))
  if (pts.length === 0) return { items: [] }
  const where: Where = { and: [{ shortfallApprovalStatus: { in: ['pending_ack', 'pending_approval'] } }, { status: { equals: 'verified' } }, { company: { in: pts } }] }
  const res = await req.payload.find({ collection: 'settlements', where, sort: 'updatedAt', limit: 200, depth: 0, user: req.user, overrideAccess: false, req })
  const items = []
  for (const d of res.docs as unknown as SettlementDoc[]) {
    const rid = relId(d.request)
    if (rid === undefined) continue
    const raw = await loadRaw(req, rid)
    const acts = shortfallAllowedActions(await ctxOf(req, raw, d))
    const step = acts.includes('approve') ? ('approve' as const) : acts.includes('acknowledge') ? ('acknowledge' as const) : null
    if (!step) continue
    const sf = await shortfallStateOf(req, raw, d)
    items.push({
      requestId: rid,
      companyId: relId((raw as { company?: unknown }).company) ?? null,
      docNo: raw.docNo ?? null,
      title: raw.title,
      lpjNo: d.docNo ?? null,
      settlementId: d.id,
      step,
      stepLabel: d.shortfallApprovalStatus === 'pending_ack' ? 'Persetujuan Direktur (Diketahui)' : 'Approval Finance',
      approvedAmount: sf.approvedAmount,
      transferredTotal: raw.transferredTotal ?? 0,
      shortfall: sf.shortfall,
      totalAfter: d.shortfallApprovalAmount ?? sf.totalAfter,
      tolerancePct: sf.tolerancePct,
      limit: sf.ceiling,
      note: d.shortfallApprovalNote ?? null,
    })
  }
  return { items }
}

export type ShortfallInboxItem = Awaited<ReturnType<typeof shortfallInbox>>['items'][number]
