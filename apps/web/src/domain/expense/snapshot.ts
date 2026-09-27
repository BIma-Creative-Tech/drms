import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { relId, rolesOf, type Role } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { getRequestTx } from '@/lib/tx'

import { fail, ids, type RequestDoc } from './common'
import { displayUnitPrice } from './lines'
import { DECISION_ROLES, planPositions, ruleDecisionError } from './decision'
import { buildSnapshot, selectRule, type ApprovalSnapshot, type RuleInput } from './rules'

/**
 * Rule resolution at submit / re-approval (US-34, G2) under ADR 0013 (E1): "Diketahui" = approval by
 * the Direktur (`pk-owner`), then Finance; PM/Staff never decide. The rule must pass
 * `ruleDecisionError` (legacy rules → 409); the positions are planned by `planPositions` (G1-2 skip
 * rule: a position whose only holders are requester/creator is skipped and recorded; no independent
 * decision → 409). The snapshot carries `decisionRoles` (service guard) and `skipped`. Snapshots taken
 * before E1 (PM acknowledger, F2e delegation) keep working unchanged at decision time.
 */
export async function selectAndSnapshot(req: PayloadRequest, doc: RequestDoc): Promise<{ rule: RuleInput; snapshot: ApprovalSnapshot }> {
  const rules = await loadActiveRules(req, 'expense_request')
  const projectId = relId(doc.project) ?? null
  const costCenterId = relId(doc.costCenter) ?? null
  const rule = selectRule(rules, {
    type: doc.type,
    grandTotal: doc.grandTotal ?? 0,
    categoryIds: (doc.lines ?? []).map((l) => relId(l.category)).filter((x): x is number => x !== undefined),
    projectId,
    costCenterId,
  })
  if (!rule) fail(409, 'Tidak ada aturan approval yang berlaku untuk pengajuan ini (US-34). Hubungi Admin.')

  const snapshot = await snapshotForRule(req, rule, await involvedUserIds(req, doc))
  return { rule, snapshot }
}

/**
 * ADR 0013 snapshot of `rule` for a document whose requester/creator accounts are `excluded` (G1):
 * rule validity (legacy rules → 409), position plan (G1-2 skip rule), decision roles. Shared by
 * expense requests and budget addenda (E5).
 */
export async function snapshotForRule(req: PayloadRequest, rule: RuleInput, excluded: ReadonlySet<number>): Promise<ApprovalSnapshot> {
  // ADR 0013: only rules of the Direktur → Finance model may be used for NEW submissions. A rule saved
  // before E1 (e.g. "Diketahui" by the PM) is refused here instead of being silently reinterpreted.
  const named = [...new Set([rule.acknowledgeUser, ...rule.steps.map((s) => s.approverUser)].filter((x): x is number => typeof x === 'number'))]
  const namedUsers = await usersById(req, named)
  const ruleErr = ruleDecisionError(rule, (id) => namedUsers.get(id)?.roles)
  if (ruleErr) fail(409, `Aturan approval "${rule.name}" tidak sesuai alur Direktur → Finance (ADR 0013): ${ruleErr} Hubungi Admin.`)

  const holders = async (role: Role | null | undefined, user: number | null | undefined): Promise<number[]> => {
    if (user) return namedUsers.get(user)?.active ? [user] : []
    return role ? activeUsersWithRole(req, role) : []
  }
  const ackHolders =
    rule.acknowledge === 'required'
      ? await holders(rule.acknowledgeBy === 'role' ? rule.acknowledgeRole : null, rule.acknowledgeBy === 'user' ? rule.acknowledgeUser : null)
      : []
  const stepHolders: number[][] = []
  for (const s of [...rule.steps].sort((a, b) => a.level - b.level)) stepHolders.push(await holders(s.approverUser ? null : s.approverRole, s.approverUser))
  // G1-2: positions whose only holders are requester/creator are skipped (recorded); at least one
  // independent decision must remain and every remaining position needs a different person — else 409.
  const planned = planPositions({ rule, excluded, ackHolders, stepHolders })
  if (!planned.ok) fail(409, planned.error)
  const { plan } = planned
  const optionalAckUser =
    rule.acknowledge === 'optional' && rule.acknowledgeBy === 'user' && rule.acknowledgeUser && !excluded.has(rule.acknowledgeUser) ? rule.acknowledgeUser : null
  const base = buildSnapshot(rule, plan.ackRequired ? plan.ackUserId : optionalAckUser)
  const snapshot: ApprovalSnapshot = {
    ...base,
    acknowledge: rule.acknowledge === 'required' && !plan.ackRequired ? 'none' : base.acknowledge,
    steps: plan.steps,
    decisionRoles: [...DECISION_ROLES],
    skipped: plan.skipped,
  }
  return snapshot
}

/** Active `approval-rules` of one document type, mapped to the engine shape (SYSTEM-READ). */
export async function loadActiveRules(req: PayloadRequest, docType: 'expense_request' | 'budget_addendum'): Promise<RuleInput[]> {
  const res = await req.payload.find({
    collection: 'approval-rules',
    where: { and: [{ active: { equals: true } }, { docType: { equals: docType } }] },
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: approval rules
    req,
  })
  return (res.docs as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as number,
    name: r.name as string,
    active: r.active as boolean,
    docType: r.docType as string,
    requestType: r.requestType as RuleInput['requestType'],
    minAmount: (r.minAmount as number) ?? 0,
    maxAmount: (r.maxAmount as number | null) ?? null,
    category: relId(r.category) ?? null,
    project: relId(r.project) ?? null,
    costCenter: relId(r.costCenter) ?? null,
    priority: (r.priority as number | null) ?? 100,
    acknowledge: (r.acknowledge as RuleInput['acknowledge']) ?? 'none',
    acknowledgeBy: (r.acknowledgeBy as RuleInput['acknowledgeBy']) ?? 'scope_manager',
    acknowledgeRole: (r.acknowledgeRole as RuleInput['acknowledgeRole']) ?? null,
    acknowledgeUser: relId(r.acknowledgeUser) ?? null,
    signDiajukan: (r.signDiajukan as RuleInput['signDiajukan']) ?? 'required',
    signDibuat: (r.signDibuat as RuleInput['signDibuat']) ?? 'required',
    steps: ((r.steps as Array<Record<string, unknown>>) ?? []).map((s) => ({
      level: s.level as number,
      approverRole: (s.approverRole as RuleInput['steps'][number]['approverRole']) ?? null,
      approverUser: relId(s.approverUser) ?? null,
    })),
  }))
}

/** Active users holding `role` (SYSTEM-READ: decision position holders, ADR 0013). */
export async function activeUsersWithRole(req: PayloadRequest, role: Role): Promise<number[]> {
  const res = await req.payload.find({
    collection: 'users',
    where: { and: [{ roles: { in: [role] } }, { active: { equals: true } }] },
    depth: 0,
    pagination: false,
    select: { email: true },
    sort: 'id',
    overrideAccess: true, // SYSTEM-READ: decision position holders (ADR 0013)
    req,
  })
  return res.docs.map((d) => d.id as number)
}

/** Roles + active flag of users named in a rule (acknowledgeUser / approverUser). */
export async function usersById(req: PayloadRequest, ids: number[]): Promise<Map<number, { roles: Role[]; active: boolean }>> {
  const out = new Map<number, { roles: Role[]; active: boolean }>()
  if (ids.length === 0) return out
  const res = await req.payload.find({
    collection: 'users',
    where: { id: { in: ids } },
    depth: 0,
    pagination: false,
    select: { roles: true, active: true },
    overrideAccess: true, // SYSTEM-READ: named decision users of an approval rule (ADR 0013)
    req,
  })
  for (const u of res.docs as unknown as Array<{ id: number; roles?: unknown; active?: boolean | null }>) out.set(u.id, { roles: rolesOf(u), active: u.active !== false })
  return out
}

/** User ids of the creator and of every requester employee that has an account (G1, Q-08). */
export async function involvedUserIds(req: PayloadRequest, doc: RequestDoc): Promise<Set<number>> {
  const out = new Set<number>()
  const creator = relId(doc.createdBy)
  if (creator !== undefined) out.add(creator)
  const emps = ids(doc.requesters)
  if (emps.length > 0) {
    const users = await req.payload.find({
      collection: 'users',
      where: { employee: { in: emps } },
      depth: 0,
      pagination: false,
      overrideAccess: true, // SYSTEM-READ: requester accounts (G1)
      req,
    })
    for (const u of users.docs) out.add(u.id as number)
  }
  return out
}

/**
 * ADR 0013 G1-2: one `approval_skipped` audit row per decision position left out at submit /
 * re-approval (the only Direktur/Finance is requester or creator) — printed "(tidak berlaku — pemohon)".
 */
export async function auditSkipped(req: PayloadRequest, doc: RequestDoc, snapshot: ApprovalSnapshot): Promise<void> {
  const rows = (snapshot.skipped ?? []).map((s) => ({
    action: 'approval_skipped' as const,
    docType: 'expense_request',
    docId: String(doc.id),
    docNo: doc.docNo ?? undefined,
    field: s.position,
    newValue: { level: s.level, role: s.role, userId: s.userId, cycle: doc.approvalCycle ?? 0 },
    reason: s.reason,
  }))
  await writeAudit(req, rows)
}

/** Class A snapshot of the request content (ADR 0006 §2 `expense_line_snapshots`). */
export async function writeSnapshot(req: PayloadRequest, doc: RequestDoc, reason: 'submit' | 'approve' | 'receipts_resubmit') {
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`SELECT content_hash FROM expense_requests WHERE id = ${doc.id}`)) as unknown as { rows: Array<{ content_hash: string | null }> }
  const emps = ids(doc.requesters)
  const names = emps.length
    ? (
        await req.payload.find({ collection: 'employees', where: { id: { in: emps } }, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: snapshot names */, req })
      ).docs.map((e) => ({ id: e.id as number, name: (e as { name: string }).name }))
    : []
  await req.payload.create({
    collection: 'expense-line-snapshots',
    data: {
      request: doc.id,
      cycle: doc.approvalCycle ?? 0,
      reason,
      grandTotal: doc.grandTotal ?? 0,
      contentHash: r.rows[0]?.content_hash ?? null,
      data: {
        docNo: doc.docNo ?? null,
        type: doc.type,
        title: doc.title,
        requestDate: doc.requestDate ?? null,
        project: relId(doc.project) ?? null,
        costCenter: relId(doc.costCenter) ?? null,
        requesters: emps.map((id) => names.find((n) => n.id === id) ?? { id, name: null }),
        createdBy: relId(doc.createdBy) ?? null,
        bank: doc.bankSnapshot ?? null,
        lines: (doc.lines ?? []).map((l, i) => ({
          no: i + 1,
          id: l.id,
          description: l.description ?? null,
          qty: l.qty ?? null,
          uom: relId(l.uom) ?? null,
          unitPrice: l.unitPrice ?? null,
          unitPriceDisplay: displayUnitPrice({ unitPrice: l.unitPrice, qty: l.qty, total: l.total }),
          total: l.total ?? null,
          category: relId(l.category) ?? null,
          vehicle: relId(l.vehicle) ?? null,
          notes: l.notes ?? null,
        })),
      },
    } as never,
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: Class A snapshot
    req,
  })
}
