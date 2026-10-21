/**
 * Rule resolution + approval snapshot of an expense request (US-34, G2) — the logic of `snapshot.ts`, independent of
 * HOW the facts are read. Submit / re-approval read them through Payload (`payloadSnapshotSource` in snapshot.ts);
 * the d1510 re-route (owner decision 2026-10-15, `src/reroute/`) reads the same facts with raw SQL inside its
 * migration / dry-run — both run THIS code, so a re-routed request gets exactly the snapshot a submit would produce.
 * No Payload import (unit-tested with in-memory sources). Every refusal is a `SnapshotRefused` (HTTP 409 at submit).
 *
 * ADR 0013 (E1): "Diketahui" = approval by the Direktur (`pk-owner`), then Finance. ADR 0021 (owner 2026-10-10): an
 * expense-request rule may name the PM project instead (`acknowledgeBy: scope_manager` → `projects.pm`, else
 * `cost-centers.manager`, an active member of the PT; missing → 409), followed by the Direktur; Finance only
 * transfers. The rule must pass `ruleDecisionError` (legacy rules → 409); the positions are planned by
 * `planPositions` (G1-2 skip rule: a position whose only holders are requester/creator is skipped and recorded; no
 * independent decision → 409). The snapshot carries `decisionRoles` (service guard), `skipped` and the G1 exception
 * `selfApproval`. ADR 0024 (owner 2026-10-11): rules may be limited to requester roles ("Peran pemohon", matched per
 * requester in the PT). ADR 0026 (owner 2026-10-13): the zero-step rule is the Owner's ("Pengajuan Owner",
 * `principal_no_approval`); a Direktur's own request goes through the Owner level; an Owner level is never skipped
 * silently (409 MSG_OWNER_STEP_SKIPPED). A request that already carries an ADR 0021 exception (`legacy`) keeps that
 * flow on re-approval / LPJ shortfall (zero-step rules are not considered for it).
 */
import type { Role } from '@/access/roles'

import {
  ADDENDUM_DECISION_ROLES,
  DECISION_ROLES,
  DIREKTUR_ROLE,
  DIREKTUR_VIA_PM,
  DIREKTUR_VIA_PM_SELF,
  NO_APPROVAL_REQUESTER_ROLE,
  OWNER_ROLE,
  planPositions,
  PRINCIPAL_NO_APPROVAL,
  ruleDecisionError,
  type SelfApproval,
} from './decision'
import { buildSnapshot, selectRule, type ApprovalSnapshot, type RuleInput } from './rules'
import type { PayeeType, RequestType } from './types'

/** Membership facts of one account in one PT: STORED roles (ADR 0026) + the account's active flag. */
export type MemberInfo = { roles: Role[]; active: boolean }

/**
 * Read access of the snapshot resolution (same semantics in every implementation):
 * - `activeRules`: active `approval-rules` of one document type in one PT, engine shape;
 * - `usersOfEmployees`: accounts linked to the employees by an ACTIVE membership (any PT), ascending, active or not;
 * - `rolesOfUsersIn`: per existing account its active flag + its stored roles through an ACTIVE membership of the PT;
 * - `membersWithRole`: ACTIVE accounts holding `role` through an ACTIVE membership of the PT, ascending;
 * - `scopeManagerOf`: `projects.pm` of the project, else `cost-centers.manager` of the cost center (null = none).
 */
export type SnapshotSource = {
  activeRules(docType: 'expense_request' | 'budget_addendum', companyId: number): Promise<RuleInput[]>
  usersOfEmployees(employeeIds: number[]): Promise<number[]>
  rolesOfUsersIn(userIds: number[], companyId: number): Promise<Map<number, MemberInfo>>
  membersWithRole(role: Role, companyId: number): Promise<number[]>
  scopeManagerOf(scope: { projectId: number | null; costCenterId: number | null }): Promise<number | null>
}

/** A submit that cannot be snapshotted (rule invalid / missing holder / G1) — HTTP 409 with this text. */
export class SnapshotRefused extends Error {
  readonly status = 409
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotRefused'
  }
}

function refuse(message: string): never {
  throw new SnapshotRefused(message)
}

export const MSG_NO_RULE = 'Tidak ada aturan approval yang berlaku untuk pengajuan ini. Hubungi Admin.'
export const MSG_PROJECT_WITHOUT_PM = 'Project ini belum punya PM. Hubungi Admin untuk mengisi PM project.'
export const MSG_COST_CENTER_WITHOUT_MANAGER = 'Pusat biaya ini belum punya manajer (penanggung jawab). Hubungi Admin untuk mengisi manajer pusat biaya.'
export const MSG_PM_NOT_MEMBER = 'PM project bukan pengguna aktif di PT ini. Hubungi Admin untuk memperbarui PM project.'
/**
 * ADR 0024: under the PM project → Direktur model the Direktur's approval is never skipped silently. ADR 0026: a
 * Direktur's own request follows the rule "Pengajuan Direktur" (approved by the Owner, then the Finance transfer
 * queue). Replaces the ADR 0021 text "Pengajuan untuk Direktur dibuat oleh PM project …" for new submissions.
 */
export const MSG_DIREKTUR_STEP_SKIPPED =
  'Persetujuan Direktur tidak boleh terlewati: pemohon/pembuat adalah satu-satunya Direktur PT. Pengajuan Direktur memakai aturan "Pengajuan Direktur" (disetujui Owner, lalu antrian transfer Finance — kebijakan PT 2026-10-13). Hubungi Admin bila aturan itu belum ada.'
/**
 * ADR 0026: the Owner level is never skipped silently — only the Owner's OWN request goes straight to Finance, under
 * the zero-step rule "Pengajuan Owner". Raised when the only Owner of the PT is requester / creator of a request
 * whose rule has an Owner level (e.g. the Owner files for someone else, or the rule "Pengajuan Owner" is missing).
 */
export const MSG_OWNER_STEP_SKIPPED =
  'Persetujuan Owner tidak boleh terlewati: pemohon/pembuat adalah satu-satunya Owner PT. Pengajuan Owner sendiri dibuat dan dikirim oleh Owner dengan aturan "Pengajuan Owner" (langsung ke antrian transfer Finance, kebijakan PT 2026-10-13). Hubungi Admin bila aturan itu belum ada.'
/** ADR 0024 / 0026: the no-approval path only for the Owner's OWN request (creator = the Owner requester). */
export const MSG_OWNER_OWN_REQUEST =
  'Pengajuan Owner tanpa persetujuan (langsung ke antrian transfer Finance) harus dibuat dan dikirim sendiri oleh Owner pemohon (kebijakan PT 2026-10-13). Pengguna lain tidak mengajukan atas nama Owner.'

/** ADR 0021: the expense request's scope (PM project resolution + the G1 exceptions). */
export type SnapshotScope = {
  projectId: number | null
  costCenterId: number | null
  creatorId: number | null
  requesterEmployeeIds: readonly number[]
  /**
   * ADR 0021 exception the REQUEST already carries (`expense_requests.g1_exception`; the DB trigger checks
   * the column): re-approval / LPJ shortfall of such a request keep its flow — `direktur_via_pm_self` →
   * either variant may be re-derived, `direktur_via_pm` → only that one. null = none (every new submit,
   * ADR 0024: the PM no longer files for a Direktur).
   */
  legacy: SelfApproval | null
}

/** The facts of an expense request that the rule selection and the snapshot depend on. */
export type SnapshotRequest = {
  companyId: number
  type: RequestType
  grandTotal: number
  categoryIds: number[]
  projectId: number | null
  costCenterId: number | null
  creatorId: number | null
  requesterEmployeeIds: number[]
  /** ADR 0027 (absent on old rows = karyawan, already normalised by the caller). */
  payeeType: PayeeType
}

/**
 * Rule resolution at submit / re-approval: the best matching active rule of the request's PT (`selectRule`) and its
 * snapshot (`resolveSnapshotForRule`). `legacy`: see `SnapshotScope.legacy`.
 */
export async function resolveSelectAndSnapshot(
  src: SnapshotSource,
  r: SnapshotRequest,
  opts: { legacy?: SelfApproval | null } = {},
): Promise<{ rule: RuleInput; snapshot: ApprovalSnapshot }> {
  const legacy = opts.legacy ?? null
  const all = await src.activeRules('expense_request', r.companyId)
  const rules = legacy ? all.filter((x) => x.steps.length > 0) : all
  const rule = selectRule(rules, {
    type: r.type,
    grandTotal: r.grandTotal,
    categoryIds: r.categoryIds,
    projectId: r.projectId,
    costCenterId: r.costCenterId,
    requesterRoles: await resolveRequesterRoles(src, r.requesterEmployeeIds, r.companyId),
    payeeType: r.payeeType, // ADR 0027
  })
  if (!rule) refuse(MSG_NO_RULE)
  const snapshot = await resolveSnapshotForRule(src, rule, await resolveInvolvedUsers(src, r.creatorId, r.requesterEmployeeIds), r.companyId, {
    projectId: r.projectId,
    costCenterId: r.costCenterId,
    creatorId: r.creatorId,
    requesterEmployeeIds: r.requesterEmployeeIds,
    legacy,
  })
  return { rule, snapshot }
}

/**
 * ADR 0024 "Peran pemohon": the roles IN THE PT of each requester employee (union over its active
 * accounts with an active membership there; an employee without such an account → []).
 */
export async function resolveRequesterRoles(src: SnapshotSource, employeeIds: readonly number[], companyId: number): Promise<Role[][]> {
  const out: Role[][] = []
  for (const e of employeeIds) {
    const users = await src.usersOfEmployees([e])
    const roles = await src.rolesOfUsersIn(users, companyId)
    out.push([...new Set([...roles.values()].filter((r) => r.active).flatMap((r) => r.roles))])
  }
  return out
}

/** User ids of the creator and of every requester employee that has an account (G1, Q-08). */
export async function resolveInvolvedUsers(src: SnapshotSource, creatorId: number | null, employeeIds: readonly number[]): Promise<Set<number>> {
  const out = new Set<number>()
  if (creatorId !== null) out.add(creatorId)
  // requester accounts (G1): membership employee links (ADR 0016 §2)
  if (employeeIds.length > 0) for (const u of await src.usersOfEmployees([...employeeIds])) out.add(u)
  return out
}

/**
 * The accounts of the requester employees when EVERY requester has an account and every such account is active and
 * holds `role` AS STORED in the PT (ADR 0026: Owner for the no-approval rule); else null.
 */
export async function resolveRequesterUsersAllRole(src: SnapshotSource, employeeIds: readonly number[], companyId: number, role: Role): Promise<Set<number> | null> {
  if (employeeIds.length === 0) return null
  const users = new Set<number>()
  for (const e of employeeIds) {
    const us = await src.usersOfEmployees([e])
    if (us.length === 0) return null
    for (const u of us) users.add(u)
  }
  const roles = await src.rolesOfUsersIn([...users], companyId)
  for (const u of users) {
    const r = roles.get(u)
    if (!r || !r.active || !r.roles.includes(role)) return null
  }
  return users
}

/**
 * Snapshot of `rule` for a document whose requester/creator accounts are `excluded` (G1): rule validity
 * (legacy rules → 409), position plan (G1-2 skip rule), decision roles. Shared by expense requests
 * (with `scope`) and budget addenda (E5, no scope: Direktur → Finance only). Position holders = members
 * of the document's PT (`companyId`, ADR 0016 §5; the G1-2 skip rule counts holders of that PT only).
 */
export async function resolveSnapshotForRule(src: SnapshotSource, ruleIn: RuleInput, excluded: ReadonlySet<number>, companyId: number, scope?: SnapshotScope): Promise<ApprovalSnapshot> {
  // ADR 0031 (DRMS 21/10): a payment without project (vendor / PT grup) has no "PM project" any more — the cost-center
  // manager went with the cost-center master — so a "PM project → Direktur" rule decides at the Direktur level only
  const unscoped = scope !== undefined && !scope.projectId && !scope.costCenterId && ruleIn.acknowledge === 'required' && ruleIn.acknowledgeBy === 'scope_manager'
  const rule: RuleInput = unscoped ? { ...ruleIn, acknowledge: 'none' } : ruleIn
  // Only rules of the current models may be used for NEW submissions. A rule saved before E1 (e.g.
  // "Diketahui" by a Staff role) is refused here instead of being silently reinterpreted.
  const named = [...new Set([rule.acknowledgeUser, ...rule.steps.map((s) => s.approverUser)].filter((x): x is number => typeof x === 'number'))]
  const namedUsers = await src.rolesOfUsersIn(named, companyId)
  const ruleErr = ruleDecisionError(ruleIn, (id) => namedUsers.get(id)?.roles, scope ? ruleIn.docType : 'budget_addendum')
  if (ruleErr) refuse(`Aturan approval "${rule.name}" tidak sesuai alur persetujuan (Direktur → Finance / PM project → Direktur): ${ruleErr} Hubungi Admin.`)

  const scopeManager = rule.acknowledge === 'required' && rule.acknowledgeBy === 'scope_manager'
  // ADR 0021: the PM project (or cost-center manager) — must exist and be an active member of the PT.
  let pm: number | null = null
  if (scopeManager && scope) {
    pm = await src.scopeManagerOf(scope)
    if (pm === null) refuse(scope.projectId ? MSG_PROJECT_WITHOUT_PM : MSG_COST_CENTER_WITHOUT_MANAGER)
    const m = (await src.rolesOfUsersIn([pm], companyId)).get(pm)
    if (!m || !m.active || m.roles.length === 0) refuse(MSG_PM_NOT_MEMBER)
  }

  const holders = async (role: Role | null | undefined, user: number | null | undefined): Promise<number[]> => {
    if (user) return namedUsers.get(user)?.active ? [user] : []
    return role ? src.membersWithRole(role, companyId) : []
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

  // ADR 0024 / 0026: zero-step rule (requester role = Owner only, validated by ruleDecisionError above) → the
  // Owner's OWN request without any decision position: every requester holds Owner in the PT (stored role) and
  // the creator is one of them. Anyone filing for the Owner → 409.
  if (rule.steps.length === 0) {
    const requesters = scope ? await resolveRequesterUsersAllRole(src, scope.requesterEmployeeIds, companyId, NO_APPROVAL_REQUESTER_ROLE) : null
    if (!scope || !requesters || scope.creatorId === null || !requesters.has(scope.creatorId)) refuse(MSG_OWNER_OWN_REQUEST)
    return { ...buildSnapshot(rule, null), acknowledge: 'none', steps: [], decisionRoles: [...DECISION_ROLES], skipped: [], selfApproval: PRINCIPAL_NO_APPROVAL }
  }

  // ADR 0021 narrow G1 exception — LEGACY ONLY since ADR 0024 (a request that already carries it: re-approval
  // / LPJ shortfall). A Direktur's request filed by the PM project (creator = the PM, every requester holds
  // Direktur in the PT) → the creator PM is not excluded from "Diketahui". Owner answer 2026-10-11 ("Utamakan
  // Direktur lain"): when another active Direktur (not a requester) can take the Direktur step, only that
  // Direktur decides (`direktur_via_pm`); the requester Direktur(s) are kept in the Direktur step only when no
  // other Direktur exists (`direktur_via_pm_self`).
  let selfApproval: SelfApproval | null = null
  let planned = planPositions({ rule, excluded, ackHolders, stepHolders })
  if (scopeManager && scope?.legacy && pm !== null && scope.creatorId === pm) {
    const requesters = await resolveRequesterUsersAllRole(src, scope.requesterEmployeeIds, companyId, DIREKTUR_ROLE)
    if (requesters && !requesters.has(pm)) {
      const ackExcluded = new Set([...excluded].filter((u) => u !== pm))
      const viaPm = planPositions({ rule, excluded, ackExcluded, ackHolders, stepHolders })
      const otherDirektur = viaPm.ok && !viaPm.plan.skipped.some((x) => x.position === 'approval' && x.role === DIREKTUR_ROLE)
      if (otherDirektur || scope.legacy === DIREKTUR_VIA_PM) {
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
  if (!planned.ok) refuse(planned.error)
  const { plan } = planned
  // ADR 0021 / 0024: under the PM project → Direktur model the Direktur's approval is never skipped silently.
  if (scopeManager && plan.skipped.some((x) => x.position === 'approval' && x.role === DIREKTUR_ROLE)) refuse(MSG_DIREKTUR_STEP_SKIPPED)
  // ADR 0026: the Owner level (approval or "Diketahui" by role) is never skipped silently — whatever the rule shape.
  if (plan.skipped.some((x) => x.role === OWNER_ROLE)) refuse(MSG_OWNER_STEP_SKIPPED)
  const optionalAckUser =
    rule.acknowledge === 'optional' && rule.acknowledgeBy === 'user' && rule.acknowledgeUser && !excluded.has(rule.acknowledgeUser) ? rule.acknowledgeUser : null
  const base = buildSnapshot(rule, plan.ackRequired ? plan.ackUserId : optionalAckUser)
  return {
    ...base,
    acknowledge: rule.acknowledge === 'required' && !plan.ackRequired ? 'none' : base.acknowledge,
    steps: plan.steps,
    // ADR 0026: Addendum RAB (no scope) stays Direktur → Finance — the Owner is not a decider there
    decisionRoles: scope ? [...DECISION_ROLES] : [...ADDENDUM_DECISION_ROLES],
    skipped: plan.skipped,
    ...(selfApproval ? { selfApproval } : {}),
  }
}
