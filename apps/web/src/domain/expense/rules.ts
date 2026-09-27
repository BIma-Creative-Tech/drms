/**
 * Approval rule engine (US-34, architecture G2): which `approval-rules` row applies to a request,
 * the snapshot stored on the request at submit (rule changes never affect submitted requests), and
 * step matching. Pure module (unit-tested).
 */
import type { Role } from '@/access/roles'

import type { SkippedPosition } from './decision'
import type { RequestType } from './types'

export type AckMode = 'required' | 'optional' | 'none'
export type AckBy = 'scope_manager' | 'role' | 'user'
export type SignMode = 'required' | 'optional' | 'none'

export type RuleInput = {
  id: number
  name: string
  active?: boolean | null
  docType: string
  requestType: 'any' | RequestType
  minAmount: number
  maxAmount?: number | null
  category?: number | null
  project?: number | null
  costCenter?: number | null
  priority?: number | null
  acknowledge: AckMode
  acknowledgeBy?: AckBy | null
  acknowledgeRole?: Role | null
  acknowledgeUser?: number | null
  signDiajukan?: SignMode | null
  signDibuat?: SignMode | null
  steps: Array<{ level: number; approverRole?: Role | null; approverUser?: number | null }>
}

export type RequestFacts = {
  /** E5: `budget_addendum` rules are matched for addenda (default: expense requests). */
  docType?: 'expense_request' | 'budget_addendum'
  /** Request type; null for addenda (only `requestType: any` rules match). */
  type: RequestType | null
  grandTotal: number
  categoryIds: number[]
  projectId?: number | null
  costCenterId?: number | null
}

export type ApprovalSnapshot = {
  ruleId: number
  ruleName: string
  acknowledge: AckMode
  acknowledgeBy: AckBy
  /** Resolved acknowledger (scope_manager / user); null with acknowledgeBy = 'role'. */
  acknowledgerUserId: number | null
  acknowledgeRole: Role | null
  signDiajukan: SignMode
  signDibuat: SignMode
  steps: Array<{ level: number; approverRole: Role | null; approverUserId: number | null }>
  /**
   * F2e (user decision, option a): the resolved "Diketahui Oleh" person was a requester/creator or
   * missing → the acknowledge step is DELEGATED to an Owner (else an Admin). Absent on snapshots
   * taken before F2e (= not delegated).
   */
  acknowledgeDelegatedTo?: AckDelegate | null
  /** Human-readable reason of the delegation (printed/audited). */
  acknowledgeDelegationReason?: string | null
  /** Users who may give the delegated "Diketahui" (fixed at submit, like the rest of the snapshot). */
  acknowledgeDelegateUserIds?: number[]
  /** The originally resolved person (PM / cost-center manager / rule user) that was skipped, if any. */
  acknowledgeOriginalUserId?: number | null
  /**
   * ADR 0013 (E1): roles that may decide (acknowledge / approve / reject) — `pk-owner` (Direktur) and
   * `pk-finance`. Absent on snapshots taken before E1 (legacy flow, e.g. PM "Diketahui"): those keep
   * their old guards until they are closed (US-34, AC-8).
   */
  decisionRoles?: Role[]
  /**
   * ADR 0013 G1-2: decision positions left out at submit because their only holders are requester/
   * creator (a skipped "Diketahui" also sets `acknowledge: 'none'`; skipped approval levels are
   * removed from `steps`, the rest renumbered 1..m). Printed "(tidak berlaku — pemohon)".
   */
  skipped?: SkippedPosition[]
}

export type AckDelegate = 'owner' | 'admin'

export const ACK_DELEGATE_ROLE: Record<AckDelegate, Role> = { owner: 'pk-owner', admin: 'pk-admin' }

export const ACK_DELEGATION_REASON = 'PM/penanggung jawab adalah pemohon/pembuat (Q-07/Q-08)'
export const ACK_DELEGATION_REASON_MISSING = 'PM/penanggung jawab belum diatur (Q-07)'

function specificity(r: RuleInput): number {
  return (r.category ? 1 : 0) + (r.project ? 1 : 0) + (r.costCenter ? 1 : 0) + (r.requestType !== 'any' ? 1 : 0)
}

export function ruleMatches(r: RuleInput, f: RequestFacts): boolean {
  if (r.active === false) return false
  if (r.docType !== (f.docType ?? 'expense_request')) return false
  if (r.requestType !== 'any' && r.requestType !== f.type) return false
  if (f.grandTotal < r.minAmount) return false
  if (r.maxAmount !== null && r.maxAmount !== undefined && f.grandTotal > r.maxAmount) return false
  if (r.category && !f.categoryIds.includes(r.category)) return false
  if (r.project && r.project !== f.projectId) return false
  if (r.costCenter && r.costCenter !== f.costCenterId) return false
  return true
}

/**
 * Best matching rule: lowest `priority` first, then the most specific (category/project/cost
 * center/request type), then the highest `minAmount` (the narrower amount band), then lowest id.
 */
export function selectRule(rules: readonly RuleInput[], f: RequestFacts): RuleInput | null {
  const candidates = rules.filter((r) => ruleMatches(r, f))
  candidates.sort(
    (a, b) =>
      (a.priority ?? 100) - (b.priority ?? 100) ||
      specificity(b) - specificity(a) ||
      b.minAmount - a.minAmount ||
      a.id - b.id,
  )
  return candidates[0] ?? null
}

/** Steps must be levels 1..n without gaps/duplicates, each with a role or a user. */
export function stepsError(steps: RuleInput['steps']): string | null {
  if (steps.length === 0) return 'Aturan approval harus punya minimal 1 level.'
  const levels = [...steps].map((s) => s.level).sort((a, b) => a - b)
  for (let i = 0; i < levels.length; i++) if (levels[i] !== i + 1) return 'Level approval harus berurutan 1..n tanpa duplikat.'
  if (steps.some((s) => !s.approverRole && !s.approverUser)) return 'Setiap level approval butuh peran atau user approver.'
  return null
}

export type AckDelegation = { to: AckDelegate; userIds: number[]; reason: string; originalUserId: number | null }

export function buildSnapshot(r: RuleInput, acknowledgerUserId: number | null, delegation?: AckDelegation | null): ApprovalSnapshot {
  const err = stepsError(r.steps)
  if (err) throw new Error(err)
  const delegated = delegation
    ? {
        acknowledgeDelegatedTo: delegation.to,
        acknowledgeDelegationReason: delegation.reason,
        acknowledgeDelegateUserIds: [...delegation.userIds].sort((a, b) => a - b),
        acknowledgeOriginalUserId: delegation.originalUserId,
      }
    : {}
  return {
    ruleId: r.id,
    ruleName: r.name,
    acknowledge: r.acknowledge,
    acknowledgeBy: r.acknowledgeBy ?? 'scope_manager',
    acknowledgerUserId,
    acknowledgeRole: r.acknowledgeRole ?? null,
    signDiajukan: r.signDiajukan ?? 'required',
    signDibuat: r.signDibuat ?? 'required',
    steps: [...r.steps]
      .sort((a, b) => a.level - b.level)
      .map((s) => ({ level: s.level, approverRole: s.approverRole ?? null, approverUserId: s.approverUser ?? null })),
    ...delegated,
  }
}

/**
 * Whether every approval level can still be decided by DISTINCT eligible people (G1 + DB unique
 * index `approvals_one_position_per_person`: one decision position per person per cycle) once
 * `without` has taken the "Diketahui" position. `pools[i]` = eligible approvers of level i
 * (requesters/creator already removed). Small exact matching (levels are few).
 */
export function approversAssignable(pools: ReadonlyArray<readonly number[]>, without: number): boolean {
  const lists = pools.map((p) => p.filter((u) => u !== without))
  const used = new Set<number>()
  const assign = (i: number): boolean => {
    if (i === lists.length) return true
    for (const u of lists[i]!) {
      if (used.has(u)) continue
      used.add(u)
      if (assign(i + 1)) return true
      used.delete(u)
    }
    return false
  }
  return assign(0)
}

/**
 * F2e acknowledger FALLBACK (user decision "option a", Q-07/Q-08, G1). Called only when the rule
 * requires "Diketahui Oleh" by a resolved person (scope_manager / user) and that person is a
 * requester or the creator of the request, or is missing. The EXACT rule:
 *
 *  1. Candidates tier 1 = every ACTIVE `pk-owner` user who is not a requester/creator.
 *     Candidates tier 2 = every ACTIVE `pk-admin` user who is not a requester/creator.
 *  2. A candidate X is eligible only if, after X takes "Diketahui", every approval level can still
 *     be decided by a DIFFERENT eligible person (`approversAssignable`) — acknowledge and approve
 *     are never the same person (e.g. the only non-requester Owner, when the approver is the Owner
 *     role or that Owner by name, is NOT eligible to acknowledge).
 *  3. The first tier with ≥ 1 eligible candidate wins: delegatedTo = 'owner' | 'admin', and ANY
 *     of that tier's eligible candidates may acknowledge (fixed in the snapshot at submit).
 *  4. No eligible candidate in either tier → null (the caller keeps the 409).
 */
export function resolveAckDelegation(input: {
  excluded: ReadonlySet<number>
  owners: readonly number[]
  admins: readonly number[]
  /** Eligible approvers per level, requesters/creator already removed. */
  approverPools: ReadonlyArray<readonly number[]>
  originalUserId: number | null
}): AckDelegation | null {
  const reason = input.originalUserId === null ? ACK_DELEGATION_REASON_MISSING : ACK_DELEGATION_REASON
  const tiers: Array<[AckDelegate, readonly number[]]> = [
    ['owner', input.owners],
    ['admin', input.admins],
  ]
  for (const [to, users] of tiers) {
    const eligible = [...new Set(users)].filter((u) => !input.excluded.has(u) && approversAssignable(input.approverPools, u))
    if (eligible.length > 0) return { to, userIds: eligible, reason, originalUserId: input.originalUserId }
  }
  return null
}

export type Caller = { id: number; roles: readonly Role[] }

/** G2: caller matches the approval step (a named user wins over the role). */
export function matchesStep(step: ApprovalSnapshot['steps'][number] | undefined, caller: Caller): boolean {
  if (!step) return false
  if (step.approverUserId !== null) return step.approverUserId === caller.id
  return step.approverRole !== null && caller.roles.includes(step.approverRole)
}

/** Caller may give "Diketahui" (US-42): the resolved user, or any holder of the role. */
export function matchesAcknowledger(s: ApprovalSnapshot, caller: Caller): boolean {
  if (s.acknowledge === 'none') return false
  if (s.acknowledgeDelegatedTo) {
    // F2e delegation: one of the eligible users fixed at submit who still holds the tier's role.
    return (s.acknowledgeDelegateUserIds ?? []).includes(caller.id) && caller.roles.includes(ACK_DELEGATE_ROLE[s.acknowledgeDelegatedTo])
  }
  if (s.acknowledgerUserId !== null) return s.acknowledgerUserId === caller.id
  return s.acknowledgeBy === 'role' && s.acknowledgeRole !== null && caller.roles.includes(s.acknowledgeRole)
}

export function lastLevel(s: ApprovalSnapshot): number {
  return s.steps.reduce((m, x) => Math.max(m, x.level), 0)
}

/**
 * US-26 budget impact: committed amount of the project (approved and later, excluding this
 * request) vs budget. Cost centers have no budget in the first release (Q-24 default) → null.
 */
export function budgetImpact(budget: number | null | undefined, committedOthers: number, amount: number): { before: number | null; after: number | null } {
  if (!budget || budget <= 0) return { before: null, after: null }
  const pct = (v: number) => Math.round((v / budget) * 10000) / 100
  return { before: pct(committedOthers), after: pct(committedOthers + amount) }
}
