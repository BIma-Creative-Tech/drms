import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { relId, type Role } from '@/access/roles'
import { contextCompanyId, membersWithRole, rolesOfUsersIn, usersOfEmployees } from '@/domain/companies'
import { writeAudit } from '@/audit/writer'
import { getRequestTx } from '@/lib/tx'

import { fail, ids, type RequestDoc } from './common'
import { displayUnitPrice } from './lines'
import { DECISION_ROLES, DIREKTUR_ROLE, DIREKTUR_VIA_PM, DIREKTUR_VIA_PM_SELF, planPositions, ruleDecisionError, selfApprovalNote, type SelfApproval } from './decision'
import { buildSnapshot, selectRule, type ApprovalSnapshot, type RuleInput } from './rules'

/**
 * Rule resolution at submit / re-approval (US-34, G2). ADR 0013 (E1): "Diketahui" = approval by the
 * Direktur (`pk-owner`), then Finance. ADR 0021 (owner 2026-10-10): an expense-request rule may name
 * the PM project instead (`acknowledgeBy: scope_manager` → `projects.pm`, else `cost-centers.manager`,
 * an active member of the PT; missing → 409), followed by the Direktur; Finance only transfers. The rule
 * must pass `ruleDecisionError` (legacy rules → 409); the positions are planned by `planPositions`
 * (G1-2 skip rule: a position whose only holders are requester/creator is skipped and recorded; no
 * independent decision → 409). The snapshot carries `decisionRoles` (service guard), `skipped` and,
 * for the narrow ADR 0021 G1 exception, `selfApproval`. Snapshots taken earlier keep working unchanged
 * at decision time.
 */
export async function selectAndSnapshot(
  req: PayloadRequest,
  doc: RequestDoc,
  opts: { allowSelfApproval?: boolean | 'pm_only' } = {},
): Promise<{ rule: RuleInput; snapshot: ApprovalSnapshot }> {
  const companyId = relId((doc as { company?: unknown }).company) ?? (await contextCompanyId(req))
  const rules = await loadActiveRules(req, 'expense_request', companyId)
  const projectId = relId(doc.project) ?? null
  const costCenterId = relId(doc.costCenter) ?? null
  const rule = selectRule(rules, {
    type: doc.type,
    grandTotal: doc.grandTotal ?? 0,
    categoryIds: (doc.lines ?? []).map((l) => relId(l.category)).filter((x): x is number => x !== undefined),
    projectId,
    costCenterId,
  })
  if (!rule) fail(409, 'Tidak ada aturan approval yang berlaku untuk pengajuan ini. Hubungi Admin.')

  const snapshot = await snapshotForRule(req, rule, await involvedUserIds(req, doc), companyId, {
    projectId,
    costCenterId,
    creatorId: relId(doc.createdBy) ?? null,
    requesterEmployeeIds: ids(doc.requesters),
    allowSelfApproval: opts.allowSelfApproval ?? true,
  })
  return { rule, snapshot }
}

/** ADR 0021: the expense request's scope (PM project resolution + the narrow G1 exception). */
export type SnapshotScope = {
  projectId: number | null
  costCenterId: number | null
  creatorId: number | null
  requesterEmployeeIds: readonly number[]
  /**
   * Which ADR 0021 exception may be applied: true at submit / re-approval (either); for an LPJ shortfall
   * only what the request itself carries (the DB trigger checks `expense_requests.g1_exception`):
   * 'pm_only' = `direktur_via_pm` (creator PM's "Diketahui" only), false = none.
   */
  allowSelfApproval: boolean | 'pm_only'
}

export const MSG_PROJECT_WITHOUT_PM = 'Project ini belum punya PM. Hubungi Admin untuk mengisi PM project.'
export const MSG_COST_CENTER_WITHOUT_MANAGER = 'Pusat biaya ini belum punya manajer (penanggung jawab). Hubungi Admin untuk mengisi manajer pusat biaya.'
export const MSG_PM_NOT_MEMBER = 'PM project bukan pengguna aktif di PT ini. Hubungi Admin untuk memperbarui PM project.'
export const MSG_DIREKTUR_VIA_PM =
  'Pengajuan untuk Direktur dibuat oleh PM project (kebijakan owner 2026-10-10): persetujuan Direktur tidak boleh terlewati. Minta PM project membuat pengajuan ini atas nama Direktur.'

/** PM project of the request (`projects.pm`), else the manager of its cost center (ADR 0021). */
export async function scopeManagerOf(req: PayloadRequest, scope: Pick<SnapshotScope, 'projectId' | 'costCenterId'>): Promise<number | null> {
  if (scope.projectId) {
    const p = (await req.payload.findByID({ collection: 'projects', id: scope.projectId, depth: 0, select: { pm: true }, overrideAccess: true /* SYSTEM-READ: PM project (ADR 0021) */, req, disableErrors: true })) as {
      pm?: unknown
    } | null
    return relId(p?.pm) ?? null
  }
  if (scope.costCenterId) {
    const c = (await req.payload.findByID({ collection: 'cost-centers', id: scope.costCenterId, depth: 0, select: { manager: true }, overrideAccess: true /* SYSTEM-READ: cost-center manager (ADR 0021) */, req, disableErrors: true })) as {
      manager?: unknown
    } | null
    return relId(c?.manager) ?? null
  }
  return null
}

/**
 * Snapshot of `rule` for a document whose requester/creator accounts are `excluded` (G1): rule validity
 * (legacy rules → 409), position plan (G1-2 skip rule), decision roles. Shared by expense requests
 * (with `scope`) and budget addenda (E5, no scope: Direktur → Finance only). Position holders = members
 * of the document's PT (`companyId`, ADR 0016 §5; the G1-2 skip rule counts holders of that PT only).
 */
export async function snapshotForRule(req: PayloadRequest, rule: RuleInput, excluded: ReadonlySet<number>, companyId: number, scope?: SnapshotScope): Promise<ApprovalSnapshot> {
  // Only rules of the current models may be used for NEW submissions. A rule saved before E1 (e.g.
  // "Diketahui" by a Staff role) is refused here instead of being silently reinterpreted.
  const named = [...new Set([rule.acknowledgeUser, ...rule.steps.map((s) => s.approverUser)].filter((x): x is number => typeof x === 'number'))]
  const namedUsers = await rolesOfUsersIn(req, named, companyId)
  const ruleErr = ruleDecisionError(rule, (id) => namedUsers.get(id)?.roles, scope ? rule.docType : 'budget_addendum')
  if (ruleErr) fail(409, `Aturan approval "${rule.name}" tidak sesuai alur persetujuan (Direktur → Finance / PM project → Direktur): ${ruleErr} Hubungi Admin.`)

  const scopeManager = rule.acknowledge === 'required' && rule.acknowledgeBy === 'scope_manager'
  // ADR 0021: the PM project (or cost-center manager) — must exist and be an active member of the PT.
  let pm: number | null = null
  if (scopeManager && scope) {
    pm = await scopeManagerOf(req, scope)
    if (pm === null) fail(409, scope.projectId ? MSG_PROJECT_WITHOUT_PM : MSG_COST_CENTER_WITHOUT_MANAGER)
    const m = (await rolesOfUsersIn(req, [pm], companyId)).get(pm)
    if (!m || !m.active || m.roles.length === 0) fail(409, MSG_PM_NOT_MEMBER)
  }

  const holders = async (role: Role | null | undefined, user: number | null | undefined): Promise<number[]> => {
    if (user) return namedUsers.get(user)?.active ? [user] : []
    return role ? membersWithRole(req, role, companyId) : []
  }
  const ackHolders =
    rule.acknowledge === 'required'
      ? scopeManager
        ? pm !== null
          ? [pm]
          : []
        : await holders(rule.acknowledgeBy === 'role' ? rule.acknowledgeRole : null, rule.acknowledgeBy === 'user' ? rule.acknowledgeUser : null)
      : []
  const stepHolders: number[][] = []
  for (const s of [...rule.steps].sort((a, b) => a.level - b.level)) stepHolders.push(await holders(s.approverUser ? null : s.approverRole, s.approverUser))

  // ADR 0021 narrow G1 exception: a Direktur's own request filed by the PM project (creator = the PM,
  // every requester holds Direktur in the PT) → the creator PM is not excluded from "Diketahui". Owner
  // answer 2026-10-11 ("Utamakan Direktur lain"): when another active Direktur (not a requester) can take
  // the Direktur step, only that Direktur decides (`direktur_via_pm`); the requester Direktur(s) are kept
  // in the Direktur step only when no other Direktur exists (`direktur_via_pm_self`). Recorded in the
  // snapshot, the request column `g1_exception` (DB trigger) and an `approval_policy_exception` audit row.
  let selfApproval: SelfApproval | null = null
  let planned = planPositions({ rule, excluded, ackHolders, stepHolders })
  if (scopeManager && scope && scope.allowSelfApproval && pm !== null && scope.creatorId === pm) {
    const requesters = await requesterUsersAllDirektur(req, scope.requesterEmployeeIds, companyId)
    if (requesters && !requesters.has(pm)) {
      const ackExcluded = new Set([...excluded].filter((u) => u !== pm))
      const viaPm = planPositions({ rule, excluded, ackExcluded, ackHolders, stepHolders })
      const otherDirektur = viaPm.ok && !viaPm.plan.skipped.some((x) => x.position === 'approval' && x.role === DIREKTUR_ROLE)
      if (otherDirektur || scope.allowSelfApproval === 'pm_only') {
        selfApproval = DIREKTUR_VIA_PM
        planned = viaPm
      } else {
        selfApproval = DIREKTUR_VIA_PM_SELF
        const stepExcluded = new Set([...excluded].filter((u) => !requesters.has(u)))
        planned = planPositions({ rule, excluded, ackExcluded, stepExcluded, ackHolders, stepHolders })
      }
    }
  }

  // G1-2: positions whose only holders are requester/creator are skipped (recorded); at least one
  // independent decision must remain and every remaining position needs a different person — else 409.
  if (!planned.ok) fail(409, planned.error)
  const { plan } = planned
  // ADR 0021: under the PM project → Direktur model the Direktur's approval is never skipped silently
  // (a Direktur's own request is filed by the PM project, see the exception above).
  if (scopeManager && plan.skipped.some((x) => x.position === 'approval' && x.role === DIREKTUR_ROLE)) fail(409, MSG_DIREKTUR_VIA_PM)
  const optionalAckUser =
    rule.acknowledge === 'optional' && rule.acknowledgeBy === 'user' && rule.acknowledgeUser && !excluded.has(rule.acknowledgeUser) ? rule.acknowledgeUser : null
  const base = buildSnapshot(rule, plan.ackRequired ? plan.ackUserId : optionalAckUser)
  const snapshot: ApprovalSnapshot = {
    ...base,
    acknowledge: rule.acknowledge === 'required' && !plan.ackRequired ? 'none' : base.acknowledge,
    steps: plan.steps,
    decisionRoles: [...DECISION_ROLES],
    skipped: plan.skipped,
    ...(selfApproval ? { selfApproval } : {}),
  }
  return snapshot
}

/**
 * ADR 0021: the accounts of the requester employees when EVERY requester has an account and every such
 * account holds Direktur (`pk-owner`) in the PT; else null (no exception).
 */
export async function requesterUsersAllDirektur(req: PayloadRequest, employeeIds: readonly number[], companyId: number): Promise<Set<number> | null> {
  if (employeeIds.length === 0) return null
  const users = new Set<number>()
  for (const e of employeeIds) {
    const us = await usersOfEmployees(req, [e])
    if (us.length === 0) return null
    for (const u of us) users.add(u)
  }
  const roles = await rolesOfUsersIn(req, [...users], companyId)
  for (const u of users) {
    const r = roles.get(u)
    if (!r || !r.active || !r.roles.includes(DIREKTUR_ROLE)) return null
  }
  return users
}

/** Active `approval-rules` of one document type IN ONE PT, mapped to the engine shape (SYSTEM-READ). */
export async function loadActiveRules(req: PayloadRequest, docType: 'expense_request' | 'budget_addendum', companyId: number): Promise<RuleInput[]> {
  const res = await req.payload.find({
    collection: 'approval-rules',
    where: { and: [{ active: { equals: true } }, { docType: { equals: docType } }, { company: { equals: companyId } }] },
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

/** User ids of the creator and of every requester employee that has an account (G1, Q-08). */
export async function involvedUserIds(req: PayloadRequest, doc: RequestDoc): Promise<Set<number>> {
  const out = new Set<number>()
  const creator = relId(doc.createdBy)
  if (creator !== undefined) out.add(creator)
  const emps = ids(doc.requesters)
  if (emps.length > 0) {
    // requester accounts (G1): membership employee links (ADR 0016 §2)
    for (const u of await usersOfEmployees(req, emps)) out.add(u)
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

/**
 * ADR 0021: one `approval_policy_exception` audit row when the snapshot carries the narrow G1 exception
 * (a Direktur's request filed by the PM project) — submit / re-approval.
 */
export async function auditSelfApproval(req: PayloadRequest, doc: RequestDoc, snapshot: ApprovalSnapshot): Promise<void> {
  const note = selfApprovalNote(snapshot.selfApproval)
  if (!note) return
  await writeAudit(req, [
    {
      action: 'approval_policy_exception',
      docType: 'expense_request',
      docId: String(doc.id),
      docNo: doc.docNo ?? undefined,
      field: 'g1Exception',
      newValue: { exception: snapshot.selfApproval, pm: snapshot.acknowledgerUserId, cycle: doc.approvalCycle ?? 0 },
      reason: note,
    },
  ])
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
          receiptAmount: l.receiptAmount ?? null,
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
