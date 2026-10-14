import type { PayloadRequest } from 'payload'

import { employeeIn, relId, ROLE_LABELS, userId } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { allocateDocNo, loadSequence } from '@/domain/numbering-db'
import { formatDocNo, parseBusinessDate } from '@/domain/numbering'
import { requestMeta } from '@/lib/request-meta'
import { isDirekturAckStep, isDirekturApprovalStep, signDecision, signerColumns, type DecisionSigner } from '@/domain/direktur-signature'

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
import { fromDocLines, validateContent, vendorOfDoc } from './drafts'
import { payeeOf } from './types'
import { designatedAccount } from '@/domain/intercompany/service'
import { checkFundsForApproval } from '@/domain/fundcheck/service'
import type { FundFigures } from '@/domain/fundcheck/rules'
import { approveWithoutDecision, assertEveryLineHasReceipt, claimAttachments, recomputeFlags, syncProjectRapFlags, syncRapFlags } from './receipts'
import { isNoApproval } from './decision'
import { ACK_DELEGATE_ROLE, budgetImpact, lastLevel, type AckDelegate, type ApprovalSnapshot } from './rules'
import { auditSelfApproval, auditSkipped, involvedUserIds, selectAndSnapshot, writeSnapshot } from './snapshot'
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
    /** ADR 0025: decision signer (signature + display name, possibly the PT's definitive Direktur); wins over `signature`. */
    signer?: DecisionSigner
    budget?: { before: number | null; after: number | null }
    openFlags?: number
    /** F2e: "Diketahui" given by a delegated Owner/Admin (recorded in the audit row). */
    delegation?: { to: AckDelegate; reason: string | null } | null
    /** ADR 0029: the PT's available funds at a checked final decision (evidence on the decision row). */
    fund?: FundFigures | null
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
      onBehalf: row.onBehalf ?? false,
      decision: row.decision,
      reason: row.reason ?? null,
      budgetPctBefore: row.budget?.before ?? null,
      budgetPctAfter: row.budget?.after ?? null,
      openFlags: row.openFlags ?? null,
      ...(row.fund ? { fundBalance: row.fund.balance, fundCommitments: row.fund.commitments, fundAvailable: row.fund.available } : {}),
      ...(row.signer
        ? signerColumns(row.signer)
        : {
            actorName: await displayName(req, row.actor),
            signature: row.signature?.mediaId ?? null,
            signatureSha256: row.signature?.sha256 ?? null,
            signatureSource: row.signature ? row.signature.source : 'none',
          }),
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
        signatureSource: (row.signer ? row.signer.signature : row.signature)?.source ?? 'none',
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
    fail(409, 'Tanda tangan wajib: unggah tanda tangan Anda di Profil & tanda tangan (web) atau buat tanda tangan di aplikasi, lalu ulangi.')
  }
  return sig
}

const companyOfDoc = (doc: RequestDoc) => relId((doc as { company?: unknown }).company)

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
      urgencyLevelId: relId(doc.urgencyLevel) ?? null,
      ...vendorOfDoc(doc), // ADR 0027: vendor, rekening vendor, invoice (required to send a vendor payment)
    },
    // D2: a legacy cost-center request submitted before may be sent again as it was (no project)
    { forSubmit: true, creatorId: creator, requestId: id, legacyCostCenter: !relId(doc.project) && relId(doc.costCenter) !== undefined && (doc.approvalCycle ?? 0) > 0 },
  )
  if (doc.type === 'reimburse') await assertEveryLineHasReceipt(req, doc)

  const { rule, snapshot } = await selectAndSnapshot(req, doc)
  // TGL = date of the FIRST submit (Q-04 default); a resubmit after withdraw keeps number and date.
  const requestDate = opts.historical?.requestDate ?? doc.requestDate ?? (await today(req))

  // Signatures are checked before anything is written (a missing required one aborts cleanly).
  const firstRequester = ids(doc.requesters)[0]!
  // ADR 0016: the caller's employee IN THE REQUEST's PT
  const companyId = relId((doc as { company?: unknown }).company)!
  const callerEmp = employeeIn(req, companyId)
  const dibuatSig = await requireSignature(req, creator, snapshot.signDibuat, caller === creator ? opts.signatureMediaId : null)
  const diajukanSig = await requireSignature(req, caller, snapshot.signDiajukan, opts.signatureMediaId)
  // "Lampiran umum" become readable by everyone who may read the request (owner link, same transaction)
  await claimAttachments(req, doc, new Set([...(await involvedUserIds(req, doc)), caller]))

  // Number: allocated once, at the first submit (kept on withdraw → resubmit; ADR 0007 §4).
  let docNo = doc.docNo ?? null
  if (!docNo) {
    if (opts.historical) {
      const cfg = await loadSequence(req, 'expense_request', companyId)
      const s = await settings(req, companyId)
      docNo = formatDocNo(cfg, opts.historical.seq, parseBusinessDate(opts.historical.requestDate), s.shortCode || 'DRMS')
      await writeAudit(req, [
        { action: 'number_issued', docType: 'expense_request', docId: String(id), docNo, field: 'docNo', newValue: docNo, reason: 'nomor historis (dokumen kertas), counter tidak berubah' },
      ])
    } else {
      docNo = (await allocateDocNo(req, 'expense_request', { companyId, date: parseBusinessDate(requestDate), docId: String(id) })).docNo
    }
  }

  // US-44 bank snapshot = the destination of the transfer: the requester's account, or (ADR 0027) the vendor's account,
  // or (ADR 0028) the receiving PT's designated intercompany account (re-checked against it at the transfer)
  const payee = payeeOf(doc.payeeType)
  let acc: { accountNo: string; accountHolder: string }
  let bankName: string | null | undefined
  if (payee === 'pt_grup') {
    const ic = await designatedAccount(req, relId(doc.payeeCompany)!)
    if (!ic) fail(400, 'Data pengajuan tidak valid.', [{ path: 'payeeCompanyId', message: 'PT penerima belum menetapkan rekening penerimaan antar-PT.' }])
    acc = { accountNo: ic!.accountNo, accountHolder: ic!.accountHolder }
    bankName = ic!.bankName
  } else {
    const a =
      payee === 'vendor'
        ? await req.payload.findByID({ collection: 'vendor-bank-accounts', id: relId(doc.vendorBankAccount)!, depth: 1, overrideAccess: true /* SYSTEM-READ: vendor account snapshot (ADR 0027) */, req })
        : await req.payload.findByID({ collection: 'employee-bank-accounts', id: relId(doc.bankAccount)!, depth: 1, overrideAccess: true /* SYSTEM-READ: bank snapshot (US-44) */, req })
    acc = { accountNo: a.accountNo, accountHolder: a.accountHolder }
    bankName = a.bank && typeof a.bank === 'object' ? (a.bank as { name?: string }).name : null
  }
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
    // ADR 0021 / 0024: the G1 exception is fixed at submit (DB guard: changes only at the freeze point;
    // `direktur_no_approval` only for a Direktur's own request under a zero-step rule).
    g1Exception: snapshot.selfApproval ?? null,
    approvalCycle: cycle,
    currentLevel: needsAck ? 0 : isNoApproval(snapshot) ? 0 : 1,
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
  await auditSelfApproval(req, updated, snapshot)
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
  // ADR 0024: a Direktur's own request under the zero-step rule goes straight to Finance (no decision).
  if (isNoApproval(snapshot)) return approveWithoutDecision(req, updated)
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
 * POST …/acknowledge — "Diketahui Oleh" (US-42). ADR 0013: the Direktur's approval ("Setujui");
 * ADR 0021: on PM project → Direktur snapshots the approval of the request's PM project ("Persetujuan
 * PM"). Anyone else is refused and audited (`requireActionAudited`).
 */
export async function acknowledge(req: PayloadRequest, id: number, opts: SignOpts = {}): Promise<RequestDoc> {
  const visible = await loadVisible(req, id, { lock: true })
  await requireActionAudited(req, await actorContext(req, visible), 'acknowledge', visible)
  const doc = await loadRaw(req, id)
  const caller = userId(req)!
  const snap = doc.approvalSnapshot ?? null
  // ADR 0029 §1: a "Diketahui" that is the final decision (no approval level left, G1-2) makes the request "Disetujui" —
  // the fund check runs here (switch on: 409 FUND_INSUFFICIENT when the PT is short; nothing is written)
  const fund = doc.status === 'pending_ack' && snap && lastLevel(snap) === 0 ? await checkFundsForApproval(req, doc, 'acknowledge') : null
  // ADR 0025: a designated representative deciding the Direktur "Diketahui" signs as the PT's definitive Direktur
  const signer = await signDecision(req, { companyId: companyOfDoc(doc), callerId: caller, direkturStep: isDirekturAckStep(snap), capturedId: opts.signatureMediaId, required: true })
  await syncRapFlags(req, id) // D4: "Melebihi RAP" as of this decision (counted in openFlags)
  await insertApproval(req, doc, {
    position: 'diketahui',
    level: 0,
    decision: 'acknowledged',
    actor: caller,
    delegation: snap?.acknowledgeDelegatedTo ? { to: snap.acknowledgeDelegatedTo, reason: snap.acknowledgeDelegationReason ?? null } : null,
    signature: signer.signature,
    signer,
    budget: await budgetFor(req, doc),
    openFlags: await openFlagCount(req, id),
    fund,
  })
  if (doc.status !== 'pending_ack') return doc
  const next = await updateRequest(req, id, { status: 'pending_approval', currentLevel: 1 })
  if (snap && lastLevel(snap) === 0) {
    // ADR 0013 G1-2: the only approval position was skipped (the only Finance is requester/creator) →
    // the Direktur's decision is final. Through "Menunggu Approval" so the DB rule "approvedAmount only
    // on pending_approval → approved" (G3) holds; nobody is notified for the empty level.
    const approved = await updateRequest(req, id, { status: 'approved', approvedAmount: next.grandTotal ?? 0, approvedAt: new Date().toISOString() })
    await writeSnapshot(req, approved, 'approve')
    await syncProjectRapFlags(req, id)
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
  const level = doc.currentLevel ?? 1
  const snap = doc.approvalSnapshot as ApprovalSnapshot
  // ADR 0029 §1: the decision that makes the request "Disetujui" (normally the Owner level; a rule without an Owner level:
  // its last level, whoever decides it) — hard block when the PT's available funds are short (switch on), before any write
  const fund = level >= lastLevel(snap) ? await checkFundsForApproval(req, doc, 'approve') : null
  // ADR 0025: the Direktur level decided by a designated representative → the PT's definitive Direktur signature
  const signer = await signDecision(req, { companyId: companyOfDoc(doc), callerId: caller, direkturStep: isDirekturApprovalStep(doc.approvalSnapshot, level), capturedId: opts.signatureMediaId, required: true })
  await syncRapFlags(req, id) // D4: "Melebihi RAP" as of this decision (counted in openFlags)
  await insertApproval(req, doc, {
    position: 'approval',
    level,
    decision: 'approved',
    actor: caller,
    signature: signer.signature,
    signer,
    budget: await budgetFor(req, doc),
    openFlags: await openFlagCount(req, id),
    fund,
  })
  if (level < lastLevel(snap)) return updateRequest(req, id, { currentLevel: level + 1 })
  // item 11: approvedAt = start of the transfer SLA (DB: set only on pending_approval → approved)
  const updated = await updateRequest(req, id, { status: 'approved', approvedAmount: doc.grandTotal ?? 0, approvedAt: new Date().toISOString() })
  await writeSnapshot(req, updated, 'approve')
  // D4: this request now counts as RAP realisation → the project's other pending requests re-check "Melebihi RAP"
  await syncProjectRapFlags(req, id)
  return updated
}

/** POST …/reject — reason required (G7); at the Diketahui step or at an approval level. */
export async function reject(req: PayloadRequest, id: number, reason: string, opts: SignOpts = {}): Promise<RequestDoc> {
  const visible = await loadVisible(req, id, { lock: true })
  await requireActionAudited(req, await actorContext(req, visible), 'reject', visible)
  const doc = await loadRaw(req, id)
  const caller = userId(req)!
  const position = doc.status === 'pending_ack' ? 'diketahui' : 'approval'
  const level = doc.status === 'pending_ack' ? 0 : (doc.currentLevel ?? 1)
  // ADR 0025: a rejection of the Direktur step by a representative is the definitive Direktur's decision too
  const signer = await signDecision(req, {
    companyId: companyOfDoc(doc),
    callerId: caller,
    direkturStep: position === 'diketahui' ? isDirekturAckStep(doc.approvalSnapshot) : isDirekturApprovalStep(doc.approvalSnapshot, level),
    capturedId: opts.signatureMediaId,
    required: false,
  })
  await insertApproval(req, doc, {
    position,
    level,
    decision: 'rejected',
    actor: caller,
    reason,
    delegation:
      doc.status === 'pending_ack' && doc.approvalSnapshot?.acknowledgeDelegatedTo
        ? { to: doc.approvalSnapshot.acknowledgeDelegatedTo, reason: doc.approvalSnapshot.acknowledgeDelegationReason ?? null }
        : null,
    signature: signer.signature,
    signer,
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
