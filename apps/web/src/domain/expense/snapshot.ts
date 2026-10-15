import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { relId, type Role } from '@/access/roles'
import { contextCompanyId, membersWithRole, rolesOfUsersIn, usersOfEmployees } from '@/domain/companies'
import { writeAudit } from '@/audit/writer'
import { getRequestTx } from '@/lib/tx'

import { fail, ids, type RequestDoc } from './common'
import { displayUnitPrice } from './lines'
import { DIREKTUR_ROLE, isNoApproval, isSelfApproval, selfApprovalNote, type SelfApproval } from './decision'
import type { ApprovalSnapshot, RuleInput } from './rules'
import {
  resolveInvolvedUsers,
  resolveRequesterRoles,
  resolveRequesterUsersAllRole,
  resolveSelectAndSnapshot,
  resolveSnapshotForRule,
  SnapshotRefused,
  type SnapshotRequest,
  type SnapshotScope,
  type SnapshotSource,
} from './snapshot-plan'
import { payeeOf } from './types'

export {
  MSG_COST_CENTER_WITHOUT_MANAGER,
  MSG_DIREKTUR_STEP_SKIPPED,
  MSG_OWNER_OWN_REQUEST,
  MSG_OWNER_STEP_SKIPPED,
  MSG_PM_NOT_MEMBER,
  MSG_PROJECT_WITHOUT_PM,
  type SnapshotScope,
} from './snapshot-plan'

/**
 * Rule resolution at submit / re-approval (US-34, G2) through Payload. The logic itself — rule selection, ADR 0013 /
 * 0021 / 0024 / 0026 position plan, G1 exceptions — lives in `snapshot-plan.ts` (shared with the d1510 re-route of
 * in-flight requests, owner decision 2026-10-15, which reads the same facts with SQL). Refusals → HTTP 409.
 * Requests submitted before keep their snapshot (and so their flow) — this module only runs at submit / re-approval.
 */
export async function selectAndSnapshot(req: PayloadRequest, doc: RequestDoc, opts: { legacy?: SelfApproval | null } = {}): Promise<{ rule: RuleInput; snapshot: ApprovalSnapshot }> {
  const companyId = relId((doc as { company?: unknown }).company) ?? (await contextCompanyId(req))
  return conflict(resolveSelectAndSnapshot(payloadSnapshotSource(req), snapshotRequestOf(doc, companyId), opts))
}

/** The facts of `doc` the rule selection depends on (company resolved by the caller). */
export function snapshotRequestOf(doc: RequestDoc, companyId: number): SnapshotRequest {
  return {
    companyId,
    type: doc.type,
    grandTotal: doc.grandTotal ?? 0,
    categoryIds: (doc.lines ?? []).map((l) => relId(l.category)).filter((x): x is number => x !== undefined),
    projectId: relId(doc.project) ?? null,
    costCenterId: relId(doc.costCenter) ?? null,
    creatorId: relId(doc.createdBy) ?? null,
    requesterEmployeeIds: ids(doc.requesters),
    payeeType: payeeOf(doc.payeeType), // ADR 0027
  }
}

/** The snapshot facts read through Payload (SYSTEM-READ helpers of domain/companies + the rule loader below). */
export function payloadSnapshotSource(req: PayloadRequest): SnapshotSource {
  return {
    activeRules: (docType, companyId) => loadActiveRules(req, docType, companyId),
    usersOfEmployees: (employeeIds) => usersOfEmployees(req, employeeIds),
    rolesOfUsersIn: (userIds, companyId) => rolesOfUsersIn(req, userIds, companyId),
    membersWithRole: (role, companyId) => membersWithRole(req, role, companyId),
    scopeManagerOf: (scope) => scopeManagerOf(req, scope),
  }
}

/** `SnapshotRefused` → HTTP 409 (same text). */
async function conflict<T>(p: Promise<T>): Promise<T> {
  try {
    return await p
  } catch (err) {
    if (err instanceof SnapshotRefused) fail(409, err.message)
    throw err
  }
}

/** The ADR 0021 exception a request carries (re-approval / LPJ shortfall keep it), else null. */
export function legacyExceptionOf(g1Exception: unknown): SelfApproval | null {
  return isSelfApproval(g1Exception) ? g1Exception : null
}

/**
 * ADR 0024 "Peran pemohon": the roles IN THE PT of each requester employee (union over its active
 * accounts with an active membership there; an employee without such an account → []).
 */
export async function requesterRolesIn(req: PayloadRequest, employeeIds: readonly number[], companyId: number): Promise<Role[][]> {
  return resolveRequesterRoles(payloadSnapshotSource(req), employeeIds, companyId)
}

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
 * Snapshot of `rule` for a document whose requester/creator accounts are `excluded` (G1) — see
 * `resolveSnapshotForRule`. Shared by expense requests (with `scope`) and budget addenda (E5, no scope).
 */
export async function snapshotForRule(req: PayloadRequest, rule: RuleInput, excluded: ReadonlySet<number>, companyId: number, scope?: SnapshotScope): Promise<ApprovalSnapshot> {
  return conflict(resolveSnapshotForRule(payloadSnapshotSource(req), rule, excluded, companyId, scope))
}

/**
 * ADR 0021: the accounts of the requester employees when EVERY requester has an account and every such
 * account holds Direktur (`pk-owner`) in the PT; else null (no exception).
 */
export async function requesterUsersAllDirektur(req: PayloadRequest, employeeIds: readonly number[], companyId: number): Promise<Set<number> | null> {
  return requesterUsersAllRole(req, employeeIds, companyId, DIREKTUR_ROLE)
}

/**
 * The accounts of the requester employees when EVERY requester has an account and every such account is active and
 * holds `role` AS STORED in the PT (ADR 0026: Owner for the no-approval rule); else null.
 */
export async function requesterUsersAllRole(req: PayloadRequest, employeeIds: readonly number[], companyId: number, role: Role): Promise<Set<number> | null> {
  return resolveRequesterUsersAllRole(payloadSnapshotSource(req), employeeIds, companyId, role)
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
    requesterRoles: ((r.requesterRoles as Role[] | null | undefined) ?? []).filter((x) => typeof x === 'string'),
    payeeType: (r.payeeType as RuleInput['payeeType']) ?? 'any',
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
  return resolveInvolvedUsers(payloadSnapshotSource(req), relId(doc.createdBy) ?? null, ids(doc.requesters))
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
 * One `approval_policy_exception` audit row when the snapshot carries a G1 exception — submit /
 * re-approval: ADR 0021 (a Direktur's request filed by the PM project, legacy) or ADR 0024 / 0026
 * (`principal_no_approval`: the Owner's own request straight to the Finance transfer queue).
 */
export async function auditSelfApproval(req: PayloadRequest, doc: RequestDoc, snapshot: ApprovalSnapshot): Promise<void> {
  const note = selfApprovalNote(snapshot.selfApproval)
  if (!note) return
  const newValue =
    isNoApproval(snapshot)
      ? { exception: snapshot.selfApproval, rule: snapshot.ruleId, ruleName: snapshot.ruleName, cycle: doc.approvalCycle ?? 0 }
      : { exception: snapshot.selfApproval, pm: snapshot.acknowledgerUserId, cycle: doc.approvalCycle ?? 0 }
  await writeAudit(req, [{ action: 'approval_policy_exception', docType: 'expense_request', docId: String(doc.id), docNo: doc.docNo ?? undefined, field: 'g1Exception', newValue, reason: note }])
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
