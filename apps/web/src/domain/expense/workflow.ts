import type { PayloadRequest } from 'payload'

import { relId, ROLE_LABELS, userId } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { allocateDocNo, loadSequence } from '@/domain/numbering-db'
import { formatDocNo, parseBusinessDate } from '@/domain/numbering'
import { requestMeta } from '@/lib/request-meta'

import {
  actorContext,
  approvalsOf,
  displayName,
  fail,
  ids,
  loadRaw,
  loadVisible,
  openFlagCount,
  projectCommitted,
  requireAction,
  requireActionAudited,
  resolveSignature,
  settings,
  today,
  updateRequest,
  type RequestDoc,
  type Signature,
} from './common'
import { fromDocLines, validateContent } from './drafts'
import { assertEveryLineHasReceipt, recomputeFlags } from './receipts'
import { ACK_DELEGATE_ROLE, budgetImpact, lastLevel, type AckDelegate, type ApprovalSnapshot } from './rules'
import { auditSkipped, selectAndSnapshot, writeSnapshot } from './snapshot'
import type { ApprovalDecision, ApprovalPosition } from './types'

export { selectAndSnapshot, writeSnapshot }

type SignOpts = { signatureMediaId?: number | null }

async function insertApproval(
  req: PayloadRequest,
  doc: RequestDoc,
  row: {
    position: ApprovalPosition
    level: number
    decision: ApprovalDecision
    actor: number
    employee?: number | null
    onBehalf?: boolean
    reason?: string | null
    signature: Signature | null
    budget?: { before: number | null; after: number | null }
    openFlags?: number
    /** F2e: "Diketahui" given by a delegated Owner/Admin (recorded in the audit row). */
    delegation?: { to: AckDelegate; reason: string | null } | null
  },
) {
  const meta = requestMeta(req)
  const created = await req.payload.create({
    collection: 'approvals',
    data: {
      docType: 'expense_request',
      request: doc.id,
      cycle: doc.approvalCycle ?? 0,
      position: row.position,
      level: row.level,
      actor: row.actor,
      employee: row.employee ?? null,
      actorName: await displayName(req, row.actor),
      onBehalf: row.onBehalf ?? false,
      decision: row.decision,
      reason: row.reason ?? null,
      budgetPctBefore: row.budget?.before ?? null,
      budgetPctAfter: row.budget?.after ?? null,
      openFlags: row.openFlags ?? null,
      signature: row.signature?.mediaId ?? null,
      signatureSha256: row.signature?.sha256 ?? null,
      signatureSource: row.signature ? row.signature.source : 'none',
      deviceId: meta.deviceId ?? null,
      source: meta.source,
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: Class A approval row after guards (G1/G2)
    req,
  })
  const action = row.decision === 'signed' ? 'sign' : row.decision === 'acknowledged' ? 'acknowledge' : row.decision === 'approved' ? 'approve' : 'reject'
  await writeAudit(req, [
    {
      action,
      docType: 'expense_request',
      docId: String(doc.id),
      docNo: doc.docNo ?? undefined,
      field: row.position,
      newValue: {
        level: row.level,
        decision: row.decision,
        signatureSource: row.signature?.source ?? 'none',
        budgetPctBefore: row.budget?.before ?? null,
        budgetPctAfter: row.budget?.after ?? null,
        openFlags: row.openFlags ?? null,
        onBehalf: row.onBehalf ?? false,
        ...(row.delegation ? { delegatedTo: row.delegation.to } : {}),
      },
      reason: row.reason ?? (row.delegation ? `dilimpahkan ke ${ROLE_LABELS[ACK_DELEGATE_ROLE[row.delegation.to]]}: ${row.delegation.reason ?? ''}`.trim() : undefined),
    },
  ])
  return created
}

async function requireSignature(req: PayloadRequest, signer: number, mode: 'required' | 'optional' | 'none', captured?: number | null): Promise<Signature | null> {
  if (mode === 'none') return null
  const sig = await resolveSignature(req, signer, captured)
  if (!sig && mode === 'required') {
    fail(409, 'Tanda tangan wajib: unggah tanda tangan di profil atau kirim signatureMediaId (US-43).')
  }
  return sig
}

async function budgetFor(req: PayloadRequest, doc: RequestDoc) {
  const projectId = relId(doc.project)
  if (!projectId) return { before: null, after: null } // Q-24 default: cost centers have no budget
  const p = await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, overrideAccess: true /* SYSTEM-READ: RAB for US-26 */, req })
  return budgetImpact(p.budget, await projectCommitted(req, projectId, doc.id), doc.grandTotal ?? 0)
}

export type SubmitOptions = SignOpts & {
  /**
   * INTERNAL (tests / data migration only, never from HTTP): register a historical paper document
   * with its original number and date WITHOUT touching the live counter (seed fixture of the
   * client form 228/PB-DRMS/20/IX/2026).
   */
  historical?: { seq: number; requestDate: string }
}

/**
 * POST /expense-requests/{id}/submit — Draft → Menunggu Diketahui | Menunggu Approval
 * (architecture §5.1/§5.2): completeness (US-03/US-37/US-53/US-44), Reimburse needs a receipt on
 * every line (US-38), approval rule resolved and snapshotted (US-34), number allocated at FIRST
 * submit (ADR 0007), bank snapshot, signatures "Dibuat Oleh" / "Diajukan Oleh" (Q-10/Q-28 default:
 * the first requester, or the submitting creator on their behalf), Class A snapshot, flags.
 */
export async function submit(req: PayloadRequest, id: number, opts: SubmitOptions = {}): Promise<RequestDoc> {
  const visible = await loadVisible(req, id, { lock: true })
  requireAction(await actorContext(req, visible), 'submit')
  const doc = await loadRaw(req, id)
  const caller = userId(req)!
  const creator = relId(doc.createdBy)!
  await validateContent(
    req,
    {
      type: doc.type,
      title: doc.title,
      projectId: relId(doc.project) ?? null,
      costCenterId: relId(doc.costCenter) ?? null,
      requesterIds: ids(doc.requesters),
      bankAccountId: relId(doc.bankAccount) ?? null,
      lines: fromDocLines(doc),
      neededDate: doc.neededDate,
      periodFrom: doc.periodFrom,
      periodTo: doc.periodTo,
    },
    { forSubmit: true, creatorId: creator },
  )
  if (doc.type === 'reimburse') await assertEveryLineHasReceipt(req, doc)

  const { rule, snapshot } = await selectAndSnapshot(req, doc)
  // TGL = date of the FIRST submit (Q-04 default); a resubmit after withdraw keeps number and date.
  const requestDate = opts.historical?.requestDate ?? doc.requestDate ?? (await today(req))

  // Signatures are checked before anything is written (a missing required one aborts cleanly).
  const firstRequester = ids(doc.requesters)[0]!
  const callerEmp = relId((req.user as { employee?: unknown } | null)?.employee)
  const dibuatSig = await requireSignature(req, creator, snapshot.signDibuat, caller === creator ? opts.signatureMediaId : null)
  const diajukanSig = await requireSignature(req, caller, snapshot.signDiajukan, opts.signatureMediaId)

  // Number: allocated once, at the first submit (kept on withdraw → resubmit; ADR 0007 §4).
  let docNo = doc.docNo ?? null
  if (!docNo) {
    if (opts.historical) {
      const cfg = await loadSequence(req, 'expense_request')
      const s = await settings(req)
      docNo = formatDocNo(cfg, opts.historical.seq, parseBusinessDate(opts.historical.requestDate), s.shortCode || 'DRMS')
      await writeAudit(req, [
        { action: 'number_issued', docType: 'expense_request', docId: String(id), docNo, field: 'docNo', newValue: docNo, reason: 'nomor historis (dokumen kertas), counter tidak berubah' },
      ])
    } else {
      docNo = (await allocateDocNo(req, 'expense_request', { date: parseBusinessDate(requestDate), docId: String(id) })).docNo
    }
  }

  const acc = await req.payload.findByID({ collection: 'employee-bank-accounts', id: relId(doc.bankAccount)!, depth: 1, overrideAccess: true /* SYSTEM-READ: bank snapshot (US-44) */, req })
  const bankName = acc.bank && typeof acc.bank === 'object' ? (acc.bank as { name?: string }).name : null
  const cycle = (doc.approvalCycle ?? 0) + 1
  const needsAck = snapshot.acknowledge === 'required'
  const updated = await updateRequest(req, id, {
    status: needsAck ? 'pending_ack' : 'pending_approval',
    docNo,
    requestDate,
    submittedAt: new Date().toISOString(),
    bankSnapshot: { bankName: bankName ?? null, accountNo: acc.accountNo, accountHolder: acc.accountHolder },
    approvalRule: rule.id,
    approvalSnapshot: snapshot,
    approvalCycle: cycle,
    currentLevel: needsAck ? 0 : 1,
  })

  if (snapshot.signDibuat !== 'none') {
    await insertApproval(req, updated, { position: 'dibuat', level: 0, decision: 'signed', actor: creator, onBehalf: caller !== creator, signature: dibuatSig })
  }
  if (snapshot.signDiajukan !== 'none') {
    await insertApproval(req, updated, {
      position: 'diajukan',
      level: 0,
      decision: 'signed',
      actor: caller,
      employee: firstRequester,
      onBehalf: callerEmp !== firstRequester,
      signature: diajukanSig,
    })
  }
  await auditSkipped(req, updated, snapshot)
  if (needsAck && snapshot.acknowledgeDelegatedTo) {
    // F2e: the delegation is part of the submit's audit trail (who was skipped, to whom, why).
    await writeAudit(req, [
      {
        action: 'acknowledge_delegated',
        docType: 'expense_request',
        docId: String(id),
        docNo,
        field: 'diketahui',
        oldValue: { userId: snapshot.acknowledgeOriginalUserId ?? null },
        newValue: { delegatedTo: snapshot.acknowledgeDelegatedTo, delegateUserIds: snapshot.acknowledgeDelegateUserIds ?? [], cycle },
        reason: snapshot.acknowledgeDelegationReason ?? undefined,
      },
    ])
  }
  await writeSnapshot(req, updated, 'submit')
  await recomputeFlags(req, id)
  return updated
}

/** POST …/withdraw — back to Draft while no decision exists in the current cycle (US-04). */
export async function withdraw(req: PayloadRequest, id: number, reason: string): Promise<RequestDoc> {
  const doc = await loadVisible(req, id, { lock: true })
  requireAction(await actorContext(req, doc), 'withdraw')
  return updateRequest(req, id, { status: 'draft', currentLevel: null }, reason)
}

/** POST …/cancel — reason required (G7); requester before any decision, Finance/Owner later. */
export async function cancel(req: PayloadRequest, id: number, reason: string): Promise<RequestDoc> {
  const doc = await loadVisible(req, id, { lock: true })
  requireAction(await actorContext(req, doc), 'cancel')
  return updateRequest(req, id, { status: 'cancelled', cancelReason: reason }, reason)
}

/**
 * POST …/acknowledge — "Diketahui Oleh" (US-42). ADR 0013: on new requests this is the Direktur's
 * approval ("Setujui"); PM/Staff/Admin are refused and audited (`requireActionAudited`).
 */
export async function acknowledge(req: PayloadRequest, id: number, opts: SignOpts = {}): Promise<RequestDoc> {
  const visible = await loadVisible(req, id, { lock: true })
  await requireActionAudited(req, await actorContext(req, visible), 'acknowledge', visible)
  const doc = await loadRaw(req, id)
  const caller = userId(req)!
  const sig = await requireSignature(req, caller, 'required', opts.signatureMediaId)
  const snap = doc.approvalSnapshot ?? null
  await insertApproval(req, doc, {
    position: 'diketahui',
    level: 0,
    decision: 'acknowledged',
    actor: caller,
    delegation: snap?.acknowledgeDelegatedTo ? { to: snap.acknowledgeDelegatedTo, reason: snap.acknowledgeDelegationReason ?? null } : null,
    signature: sig,
    budget: await budgetFor(req, doc),
    openFlags: await openFlagCount(req, id),
  })
  if (doc.status !== 'pending_ack') return doc
  const next = await updateRequest(req, id, { status: 'pending_approval', currentLevel: 1 })
  if (snap && lastLevel(snap) === 0) {
    // ADR 0013 G1-2: the only approval position was skipped (the only Finance is requester/creator) →
    // the Direktur's decision is final. Through "Menunggu Approval" so the DB rule "approvedAmount only
    // on pending_approval → approved" (G3) holds; nobody is notified for the empty level.
    const approved = await updateRequest(req, id, { status: 'approved', approvedAmount: next.grandTotal ?? 0 })
    await writeSnapshot(req, approved, 'approve')
    return approved
  }
  return next
}

/**
 * POST …/approve — G1 (no requester/creator, one decision position per person — also DB-enforced),
 * G2 (caller matches the current level of the snapshotted rule). Last level → "Disetujui" with
 * `approvedAmount := grandTotal` (frozen; the DB only lets it change on pending_approval →
 * approved) + Class A snapshot. Records budget % before → after and open flags (US-26, US-59).
 */
export async function approve(req: PayloadRequest, id: number, opts: SignOpts = {}): Promise<RequestDoc> {
  const visible = await loadVisible(req, id, { lock: true })
  await requireActionAudited(req, await actorContext(req, visible), 'approve', visible)
  const doc = await loadRaw(req, id)
  const caller = userId(req)!
  const sig = await requireSignature(req, caller, 'required', opts.signatureMediaId)
  const level = doc.currentLevel ?? 1
  await insertApproval(req, doc, {
    position: 'approval',
    level,
    decision: 'approved',
    actor: caller,
    signature: sig,
    budget: await budgetFor(req, doc),
    openFlags: await openFlagCount(req, id),
  })
  const snap = doc.approvalSnapshot as ApprovalSnapshot
  if (level < lastLevel(snap)) return updateRequest(req, id, { currentLevel: level + 1 })
  const updated = await updateRequest(req, id, { status: 'approved', approvedAmount: doc.grandTotal ?? 0 })
  await writeSnapshot(req, updated, 'approve')
  return updated
}

/** POST …/reject — reason required (G7); at the Diketahui step or at an approval level. */
export async function reject(req: PayloadRequest, id: number, reason: string, opts: SignOpts = {}): Promise<RequestDoc> {
  const visible = await loadVisible(req, id, { lock: true })
  await requireActionAudited(req, await actorContext(req, visible), 'reject', visible)
  const doc = await loadRaw(req, id)
  const caller = userId(req)!
  const sig = await resolveSignature(req, caller, opts.signatureMediaId)
  await insertApproval(req, doc, {
    position: doc.status === 'pending_ack' ? 'diketahui' : 'approval',
    level: doc.status === 'pending_ack' ? 0 : (doc.currentLevel ?? 1),
    decision: 'rejected',
    actor: caller,
    reason,
    delegation:
      doc.status === 'pending_ack' && doc.approvalSnapshot?.acknowledgeDelegatedTo
        ? { to: doc.approvalSnapshot.acknowledgeDelegatedTo, reason: doc.approvalSnapshot.acknowledgeDelegationReason ?? null }
        : null,
    signature: sig,
    budget: await budgetFor(req, doc),
    openFlags: await openFlagCount(req, id),
  })
  return updateRequest(req, id, { status: 'rejected', rejectReason: reason }, reason)
}

/** POST …/complete — Reimburse "Ditransfer" → "Selesai" (requester confirms or Finance closes). */
export async function complete(req: PayloadRequest, id: number): Promise<RequestDoc> {
  const doc = await loadVisible(req, id, { lock: true })
  requireAction(await actorContext(req, doc), 'complete')
  return updateRequest(req, id, { status: 'completed' })
}

export { approvalsOf }
