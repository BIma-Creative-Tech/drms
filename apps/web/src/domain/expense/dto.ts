import type { PayloadRequest } from 'payload'

import { hasRole, relId, userId } from '@/access/roles'

import { actorContext, approvalsOf, displayName, loadRaw, projectCommitted, type RequestDoc } from './common'
import { displayUnitPrice, receiptMismatch } from './lines'
import { budgetImpact, type ApprovalSnapshot } from './rules'
import { allowedActions } from './state'
import { REQUEST_TYPE_LABELS, FLAG_LABELS, type FlagKind } from './types'
import { withFlagVisibility } from './flag-visibility'
import { receiptsOf } from './receipts'
import { settlementOfRequest } from './lpj'
import { shortfallSummary } from './shortfall-approval'
import { SETTLEMENT_STATUS_LABELS } from './settlement-rules'
import { nextActor, requestStatusLabel, timeline } from './timeline'

type Named = { id: number; name?: string; code?: string; email?: string; plateNo?: string; plateDisplay?: string } | null

const ref = (v: unknown, pick: (d: Record<string, unknown>) => Record<string, unknown>) =>
  v && typeof v === 'object' ? { id: (v as { id: number }).id, ...pick(v as Record<string, unknown>) } : typeof v === 'number' ? { id: v } : null

/** Bank numbers are shown in full only to Finance/Owner/Admin and the request's own people. */
export function maskAccountNo(no: string | null | undefined, full: boolean): string | null {
  if (!no) return null
  return full ? no : `••••${no.slice(-4)}`
}

export function listItem(doc: RequestDoc & { project?: unknown; costCenter?: unknown }, extra: Record<string, unknown> = {}) {
  return {
    id: doc.id,
    docNo: doc.docNo ?? null,
    type: doc.type,
    typeLabel: REQUEST_TYPE_LABELS[doc.type],
    status: doc.status,
    // ADR 0021: "Menunggu persetujuan PM" / "Menunggu persetujuan Direktur" from the request's snapshot
    statusLabel: requestStatusLabel(doc.type, doc.status, doc.approvalSnapshot ?? null, doc.currentLevel ?? null),
    title: doc.title,
    projectId: relId(doc.project) ?? null,
    costCenterId: relId(doc.costCenter) ?? null,
    grandTotal: doc.grandTotal ?? 0,
    approvedAmount: doc.approvedAmount ?? null,
    requestDate: doc.requestDate ?? null,
    neededDate: doc.neededDate ?? null,
    createdById: relId(doc.createdBy) ?? null,
    updatedAt: doc.updatedAt ?? null,
    companyId: relId((doc as { company?: unknown }).company) ?? null, // MC3: PT chip (labels: /me companies[])
    ...extra,
  }
}

/** GET /expense-requests/{id} — everything the APK/approval screen needs (US-05, US-26, US-59). */
export async function detail(req: PayloadRequest, id: number) {
  const doc = (await req.payload.findByID({
    collection: 'expense-requests',
    id,
    depth: 1,
    overrideAccess: true, // SYSTEM-READ: caller visibility checked by loadVisible() before
    req,
  })) as unknown as RequestDoc & Record<string, unknown>
  const flat = { ...doc, approvalCycle: doc.approvalCycle ?? 0 } as RequestDoc
  const ctx = await actorContext(req, {
    ...flat,
    createdBy: relId(doc.createdBy),
    requesters: (doc.requesters ?? []).map((r) => relId(r)),
    currentLevel: doc.currentLevel,
  } as RequestDoc)
  const own = ctx.isCreator || ctx.isRequester
  // ADR 0016 §5: the full account number for office roles OF THE DOCUMENT's PT only
  const fullBank = own || hasRole(req, ['pk-finance', 'pk-owner', 'pk-admin'], relId((doc as { company?: unknown }).company))
  const approvals = await approvalsOf(req, id)
  const receipts = await receiptsOf(req, id)
  const flags = (
    await req.payload.find({
      collection: 'receipt-flags',
      // QA-MC4-06: a cross-PT duplicate only for viewers mapped to the other request's PT
      where: withFlagVisibility(req, { and: [{ request: { equals: id } }, { status: { not_equals: 'resolved' } }] }),
      depth: 0,
      pagination: false,
      sort: 'id',
      overrideAccess: true, // SYSTEM-READ: flags of a visible request
      req,
    })
  ).docs as unknown as Array<Record<string, unknown>>
  const transfers = (
    await req.payload.find({
      collection: 'transfers',
      where: { request: { equals: id } },
      depth: 0,
      pagination: false,
      sort: 'id',
      overrideAccess: true, // SYSTEM-READ: transfers of a visible request
      req,
    })
  ).docs as unknown as Array<Record<string, unknown>>

  const projectDoc = doc.project && typeof doc.project === 'object' ? (doc.project as { id: number; budget?: number | null }) : null
  let budget: { basis: 'project' | 'none'; pctBefore: number | null; pctAfter: number | null } = { basis: 'none', pctBefore: null, pctAfter: null }
  if (projectDoc) {
    const b = budgetImpact(projectDoc.budget, await projectCommitted(req, projectDoc.id, id), doc.grandTotal ?? 0)
    budget = { basis: projectDoc.budget ? 'project' : 'none', pctBefore: b.before, pctAfter: b.after }
  }
  const snap = (doc.approvalSnapshot ?? null) as ApprovalSnapshot | null
  const lpj = doc.type === 'advance' ? await settlementOfRequest(req, id) : null
  // QA-06 / ADR 0019: shortfall vs approved + tolerance and its re-approval (office roles only)
  // ADR 0021: also the PM project acknowledger of the shortfall approval (it decides "Persetujuan PM")
  const shortfallAck = (lpj?.shortfallApprovalSnapshot as ApprovalSnapshot | null | undefined)?.acknowledgerUserId
  const shortfall =
    lpj && lpj.settlementType === 'shortfall' && (hasRole(req, ['pk-finance', 'pk-owner'], relId((doc as { company?: unknown }).company)) || (shortfallAck != null && shortfallAck === userId(req)))
      ? await shortfallSummary(req, await loadRaw(req, id), lpj)
      : null
  // F4: status timeline + "Giliran" (next expected actor) — same derivation as the web WorkflowPanel.
  const names: Record<number, string> = {}
  const nameIds = [snap?.acknowledgerUserId, ...(snap?.steps ?? []).map((s) => s.approverUserId)].filter((x): x is number => typeof x === 'number')
  for (const u of new Set(nameIds)) names[u] = await displayName(req, u)
  const requesterNames = (doc.requesters ?? [])
    .map((r) => (r && typeof r === 'object' ? String((r as { name?: string }).name ?? '') : ''))
    .filter(Boolean)
    .join(', ')
  const next = nextActor({ type: doc.type, status: doc.status, currentLevel: doc.currentLevel ?? null, snapshot: snap, requesters: requesterNames, names })

  return {
    ...listItem({ ...flat, project: doc.project, costCenter: doc.costCenter, createdBy: doc.createdBy } as RequestDoc),
    uuid: (doc.uuid as string) ?? null,
    project: ref(doc.project, (d) => ({ code: d.code, name: d.name })),
    costCenter: ref(doc.costCenter, (d) => ({ code: d.code, name: d.name })),
    urgencyLevel: ref(doc.urgencyLevel, (d) => ({ code: d.code, name: d.name, rank: d.rank })),
    notes: doc.notes ?? null,
    requesters: (doc.requesters ?? []).map((r) => ref(r, (d) => ({ code: d.code, name: d.name }))),
    createdBy: ref(doc.createdBy, (d) => ({ name: (d.name as string) || (d.email as string) })),
    bankAccountId: relId(doc.bankAccount) ?? null,
    bank: doc.bankSnapshot?.accountNo
      ? { bankName: doc.bankSnapshot.bankName ?? null, accountNo: maskAccountNo(doc.bankSnapshot.accountNo, fullBank), accountHolder: doc.bankSnapshot.accountHolder ?? null }
      : null,
    lines: (doc.lines ?? []).map((l, i) => ({
      id: l.id,
      no: i + 1,
      description: l.description ?? null,
      qty: l.qty ?? null,
      uom: ref(l.uom, (d) => ({ code: d.code, name: d.name })),
      unitPrice: l.unitPrice ?? null,
      unitPriceDisplay: displayUnitPrice({ unitPrice: l.unitPrice, qty: l.qty, total: l.total }),
      total: l.total ?? 0,
      // D3: "Nominal sesuai nota" + live mismatch (the persisted awareness flag is `flags[]` kind receipt_amount_mismatch)
      receiptAmount: l.receiptAmount ?? null,
      receiptMismatch: receiptMismatch(l),
      notes: l.notes ?? null,
      category: ref(l.category, (d) => ({ code: d.code, name: d.name })),
      vehicle: ref(l.vehicle, (d) => ({ plateNo: d.plateNo, plateDisplay: d.plateDisplay, type: d.type })) as Named,
    })),
    transferredTotal: doc.transferredTotal ?? 0,
    approvalCycle: doc.approvalCycle ?? 0,
    currentLevel: doc.currentLevel ?? null,
    approvalRule: snap
      ? {
          id: snap.ruleId,
          name: snap.ruleName,
          acknowledge: snap.acknowledge,
          acknowledgerUserId: snap.acknowledgerUserId,
          acknowledgeDelegatedTo: snap.acknowledgeDelegatedTo ?? null,
          acknowledgeDelegationReason: snap.acknowledgeDelegationReason ?? null,
          acknowledgeBy: snap.acknowledgeBy,
          acknowledgeRole: snap.acknowledgeRole ?? null,
          decisionRoles: snap.decisionRoles ?? [],
          skipped: snap.skipped ?? [],
          // ADR 0021: narrow G1 exception (a Direktur's request filed by the PM project)
          selfApproval: snap.selfApproval ?? null,
          steps: snap.steps,
          signDiajukan: snap.signDiajukan,
          signDibuat: snap.signDibuat,
        }
      : null,
    approvals: approvals.map((a) => ({
      id: a.id,
      cycle: a.cycle,
      position: a.position,
      level: a.level,
      actorId: relId(a.actor) ?? null,
      employeeId: relId(a.employee) ?? null,
      actorName: a.actorName ?? null,
      onBehalf: a.onBehalf ?? false,
      decision: a.decision,
      reason: a.reason ?? null,
      decidedAt: a.decidedAt ?? null,
      budgetPctBefore: a.budgetPctBefore ?? null,
      budgetPctAfter: a.budgetPctAfter ?? null,
      openFlags: a.openFlags ?? null,
      signatureId: relId(a.signature) ?? null,
      signatureSha256: a.signatureSha256 ?? null,
      signatureSource: a.signatureSource ?? null,
    })),
    receipts: receipts.map((r) => ({
      id: r.id,
      lineId: r.lineId,
      lineNo: r.lineNo ?? null,
      receiptNo: r.receiptNo ?? null,
      vendorName: r.vendorName,
      receiptDate: r.receiptDate,
      amount: r.amount,
      imageId: relId(r.image) ?? null,
      status: r.status,
    })),
    flags: flags.map((f) => ({
      id: f.id as number,
      kind: f.kind as FlagKind,
      kindLabel: FLAG_LABELS[f.kind as FlagKind],
      level: f.level as string,
      status: f.status as string,
      lineId: (f.lineId as string) ?? null,
      lineNo: (f.lineNo as number) ?? null,
      receiptId: relId(f.receipt) ?? null,
      relatedRequestId: relId(f.relatedRequest) ?? null,
      message: f.message as string,
      reviewNote: (f.reviewNote as string) ?? null,
    })),
    transfers: transfers.map((t) => ({
      id: t.id as number,
      docNo: t.docNo as string,
      kind: t.kind as string,
      amount: t.amount as number,
      transferDate: t.transferDate as string,
      transferAt: (t.transferAt as string | null | undefined) ?? null,
      bankRef: t.bankRef as string,
      status: t.status as string,
      cashEntryId: relId(t.cashEntry) ?? null,
      proofId: relId(t.proof) ?? null,
      voidReason: (t.voidReason as string) ?? null,
    })),
    verifiedReceiptsTotal: doc.verifiedReceiptsTotal ?? null,
    settlement: lpj
      ? {
          id: lpj.id,
          docNo: lpj.docNo ?? null,
          status: lpj.status,
          statusLabel: SETTLEMENT_STATUS_LABELS[lpj.status],
          usageNotes: lpj.usageNotes ?? null,
          photos: (lpj.photos ?? []).map((p) => relId(p)).filter((x): x is number => x !== undefined),
          transferredTotal: lpj.transferredTotal ?? null,
          receiptsTotal: lpj.receiptsTotal ?? null,
          verifiedReceiptsTotal: lpj.verifiedReceiptsTotal ?? null,
          difference: lpj.difference ?? null,
          settlementType: lpj.settlementType ?? null,
          financeNotes: lpj.financeNotes ?? null,
          submitCount: lpj.submitCount ?? 0,
          submittedAt: lpj.submittedAt ?? null,
          verifiedAt: lpj.verifiedAt ?? null,
          settledAt: lpj.settledAt ?? null,
          refundCashEntryId: relId(lpj.refundCashEntry) ?? null,
          shortfallTransferId: relId(lpj.shortfallTransfer) ?? null,
          reversalCount: lpj.reversalCount ?? 0,
          lastReversedAt: lpj.lastReversedAt ?? null,
          lastReversalReason: lpj.lastReversalReason ?? null,
          shortfallApproval: shortfall,
        }
      : null,
    budget,
    openWarningFlags: flags.filter((f) => f.status === 'open' && f.level === 'warning').length,
    // E9: reversal only for a settled LPJ that posted a refund KM / shortfall transfer (UI hint; the service re-checks).
    allowedActions: allowedActions(ctx).filter((a) => a !== 'settle_reverse' || (lpj?.status === 'settled' && (lpj.settlementType === 'refund' || lpj.settlementType === 'shortfall'))),
    resubmitOfId: relId(doc.resubmitOf) ?? null,
    // F2e: the previous (rejected) request by number + title ("Pengajuan ulang dari").
    resubmitOf:
      doc.resubmitOf && typeof doc.resubmitOf === 'object'
        ? { id: (doc.resubmitOf as { id: number }).id, docNo: (doc.resubmitOf as { docNo?: string | null }).docNo ?? null, title: (doc.resubmitOf as { title?: string }).title ?? '' }
        : null,
    submittedAt: doc.submittedAt ?? null,
    approvedAt: (doc as { approvedAt?: string | null }).approvedAt ?? null,
    cancelReason: doc.cancelReason ?? null,
    rejectReason: doc.rejectReason ?? null,
    clientUuid: doc.clientUuid ?? null,
    createdAt: doc.createdAt ?? null,
    rev: typeof doc.syncRev === 'number' && doc.syncRev > 0 ? doc.syncRev : 1,
    timeline: timeline(doc.type, doc.status, { skipAck: snap?.acknowledge === 'none', snapshot: snap, currentLevel: doc.currentLevel ?? null }),
    nextActor: next,
  }
}
