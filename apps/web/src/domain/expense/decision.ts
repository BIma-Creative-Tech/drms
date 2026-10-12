/**
 * ADR 0013 (accepted 2026-09-26, GATE 1 G1-1/G1-2): "Diketahui" is an APPROVAL by the Direktur
 * (= the existing role `pk-owner`, relabelled), followed by Finance approval; the PM only monitors.
 * ADR 0021 (owner 2026-10-10) supersedes the decision part for expense requests: "Diketahui" may be
 * given by the PM project (`acknowledgeBy: scope_manager` = `projects.pm`, else `cost-centers.manager`)
 * followed by the Direktur; Finance only transfers. Budget addenda stay Direktur → Finance.
 * ADR 0024 (owner 2026-10-11): a rule may carry a requester-role condition ("Peran pemohon") and an
 * expense-request rule whose requester role is EXACTLY Direktur may have zero steps ("Tanpa persetujuan —
 * langsung ke antrian transfer Finance"): a Direktur's own request then goes to Finance with no decision
 * (`direktur_no_approval`, audited); the PM no longer files for a Direktur (`direktur_via_pm*` = legacy).
 * Pure module (unit-tested): rule validation shared by the `approval-rules` hook and the submit
 * check, and the submit-time position plan (who may decide each position, which positions are
 * skipped because their only holders are requester/creator).
 */
import { ROLE_LABELS, type Role } from '@/access/roles'

import type { ApprovalSnapshot, RuleInput } from './rules'

/** The only roles that may take a decision (acknowledge / approve / reject) on an ADR 0013 snapshot. */
export const DECISION_ROLES = ['pk-owner', 'pk-finance'] as const satisfies readonly Role[]

export function isDecisionRole(r: unknown): r is (typeof DECISION_ROLES)[number] {
  return (DECISION_ROLES as readonly unknown[]).includes(r)
}

export const DIREKTUR_ROLE: Role = 'pk-owner'

/** A decision position left out at submit (G1-2): recorded in the snapshot, the audit and the PDF. */
export type SkippedPosition = {
  position: 'diketahui' | 'approval'
  /** 0 for "Diketahui", the ORIGINAL rule level for an approval step. */
  level: number
  role: Role | null
  userId: number | null
  reason: string
}

/** Printed in the PDF box / shown in the panel for a skipped position. */
export const SKIPPED_LABEL = '(tidak berlaku — pemohon)'

type RuleShape = Pick<RuleInput, 'acknowledge' | 'acknowledgeBy' | 'acknowledgeRole' | 'acknowledgeUser' | 'steps' | 'requesterRoles'>

/** ADR 0021: G1 exception of a Direktur's request filed by the PM project (snapshot / DB column value). */
export const DIREKTUR_VIA_PM = 'direktur_via_pm' as const
/**
 * ADR 0021, owner answer 2026-10-11 ("Utamakan Direktur lain"): the requester Direktur may approve his own
 * request ONLY when he is the only Direktur of the PT at submit. With another active Direktur who is not a
 * requester, the exception is `direktur_via_pm` (only the creator PM's "Diketahui" is exempt) and only the
 * other Direktur(s) decide the Direktur step.
 */
export const DIREKTUR_VIA_PM_SELF = 'direktur_via_pm_self' as const
/**
 * The ADR 0021 exceptions (a Direktur's request filed by the PM project). ADR 0024: no longer set for new
 * submissions — only requests that already carry one (re-approval / LPJ shortfall keep their flow).
 */
export type SelfApproval = typeof DIREKTUR_VIA_PM | typeof DIREKTUR_VIA_PM_SELF
export const SELF_APPROVALS: readonly SelfApproval[] = [DIREKTUR_VIA_PM, DIREKTUR_VIA_PM_SELF]

export function isSelfApproval(v: unknown): v is SelfApproval {
  return (SELF_APPROVALS as readonly unknown[]).includes(v)
}

/**
 * ADR 0024 (owner decision 2026-10-11): a Direktur's OWN request under a zero-step rule (requester role =
 * Direktur) goes straight to the Finance transfer queue — no decision position at all. An explicit, audited
 * policy exception to G1-2 ("at least one independent decision"); Finance's transfer checks stay the only
 * check before money leaves. Snapshot `selfApproval` + column `expense_requests.g1_exception` (DB-checked).
 */
export const DIREKTUR_NO_APPROVAL = 'direktur_no_approval' as const
export type G1Exception = SelfApproval | typeof DIREKTUR_NO_APPROVAL
export const G1_EXCEPTIONS: readonly G1Exception[] = [DIREKTUR_VIA_PM, DIREKTUR_VIA_PM_SELF, DIREKTUR_NO_APPROVAL]

/** Snapshot of a Direktur's own request without approval (ADR 0024). */
export function isNoApproval(s: { selfApproval?: unknown } | null | undefined): boolean {
  return s?.selfApproval === DIREKTUR_NO_APPROVAL
}

/** Panel / timeline / PDF / report text of the ADR 0024 exception. */
export const NO_APPROVAL_NOTE = 'Tanpa persetujuan — pengajuan Direktur (kebijakan PT)'
/** Rule form / list label of a zero-step rule. */
export const NO_APPROVAL_RULE_LABEL = 'Tanpa persetujuan — langsung ke antrian transfer Finance'
/** PDF box text of the decision positions of such a request. */
export const NO_APPROVAL_PDF_LABEL = '(tidak berlaku — tanpa persetujuan)'

/** Requester roles offered in "Peran pemohon" (ADR 0024; Operator never files expense requests). */
export const REQUESTER_ROLE_OPTIONS = ['pk-owner', 'pk-pm', 'pk-staff', 'pk-finance', 'pk-admin'] as const satisfies readonly Role[]

/**
 * ADR 0024 guardrail: why a ZERO-STEP rule may not be saved / used (null = fine or not zero-step). Only an
 * expense-request rule whose requester role is EXACTLY Direktur and without "Diketahui" — so an Admin can
 * never open a no-approval path for Staff / PM / Finance. Mirrored by the DB trigger `approval_rules_zero_step`.
 */
export function zeroStepRuleError(rule: Pick<RuleInput, 'steps' | 'requesterRoles' | 'acknowledge'>, docType: string = 'expense_request'): string | null {
  if (rule.steps.length > 0) return null
  if (docType !== 'expense_request') return 'Aturan Addendum RAB harus punya minimal 1 level approval.'
  const roles = [...new Set(rule.requesterRoles ?? [])]
  if (roles.length !== 1 || roles[0] !== DIREKTUR_ROLE) {
    return `Aturan tanpa level approval ("${NO_APPROVAL_RULE_LABEL}") hanya boleh untuk Peran pemohon = ${ROLE_LABELS[DIREKTUR_ROLE]} saja (ADR 0024). Tambahkan level approval atau ubah Peran pemohon.`
  }
  if (rule.acknowledge !== 'none') return `Aturan "${NO_APPROVAL_RULE_LABEL}" tidak memakai "Diketahui Oleh": pilih "Tidak dipakai" (ADR 0024).`
  return null
}

/** Printed in the PDF / shown in the panel when the snapshot carries the ADR 0021 G1 exception. */
export const DIREKTUR_VIA_PM_NOTE = 'Pengajuan Direktur — diajukan oleh PM (kebijakan owner 2026-10-10)'
export const DIREKTUR_VIA_PM_SELF_NOTE = 'Pengajuan Direktur — diajukan oleh PM; disetujui Direktur pemohon karena satu-satunya Direktur PT (kebijakan owner 2026-10-10)'

/** Panel / PDF / audit text of the exception (null = none); ADR 0021 wording kept for those requests. */
export function selfApprovalNote(v: unknown): string | null {
  return v === DIREKTUR_VIA_PM ? DIREKTUR_VIA_PM_NOTE : v === DIREKTUR_VIA_PM_SELF ? DIREKTUR_VIA_PM_SELF_NOTE : v === DIREKTUR_NO_APPROVAL ? NO_APPROVAL_NOTE : null
}

/** Label of the ADR 0021 "Diketahui" filler (rule form, panel). */
export const SCOPE_MANAGER_LABEL = 'PM project (manajer pusat biaya bila tanpa project)'

/**
 * Why a rule may not be used (null = valid). `rolesOfUser` returns the roles of a named user
 * (acknowledgeUser / approverUser); only Direktur/Finance holders may be named. ADR 0021: the PM
 * project (`scope_manager`) may fill a REQUIRED "Diketahui" of an expense-request rule only.
 */
export function ruleDecisionError(rule: RuleShape, rolesOfUser: (id: number) => readonly Role[] | undefined, docType: string = 'expense_request'): string | null {
  const zero = zeroStepRuleError(rule, docType)
  if (zero) return zero
  if (docType !== 'expense_request' && (rule.requesterRoles ?? []).length > 0) return 'Peran pemohon hanya untuk aturan Pengajuan biaya (ADR 0024).'
  const label = (r: Role) => ROLE_LABELS[r]
  const allowed = `${label('pk-owner')} atau ${label('pk-finance')}`
  if (rule.acknowledge !== 'none') {
    const by = rule.acknowledgeBy ?? 'scope_manager'
    if (by === 'scope_manager') {
      if (docType !== 'expense_request') {
        return `Pengisi "Diketahui Oleh" = PM project hanya untuk aturan Pengajuan biaya (ADR 0021). Addendum RAB tetap ${label('pk-owner')} lalu ${label('pk-finance')}.`
      }
      if (rule.acknowledge !== 'required') return `"Diketahui" oleh PM project adalah persetujuan dan tidak boleh opsional (ADR 0021). Pilih "Wajib".`
    }
    if (by === 'role') {
      if (!rule.acknowledgeRole) return 'Pilih peran "Diketahui Oleh".'
      if (!isDecisionRole(rule.acknowledgeRole)) return `Peran "Diketahui Oleh" harus ${allowed} (ADR 0013: PM/Staff/Admin tidak memberi keputusan).`
      if (rule.acknowledge === 'optional' && rule.acknowledgeRole === DIREKTUR_ROLE) {
        return `"Diketahui" oleh ${label('pk-owner')} adalah persetujuan dan tidak boleh opsional (ADR 0013). Pilih "Wajib".`
      }
    }
    if (by === 'user') {
      if (!rule.acknowledgeUser) return 'Pilih user "Diketahui Oleh".'
      if (!(rolesOfUser(rule.acknowledgeUser) ?? []).some(isDecisionRole)) return `User "Diketahui Oleh" harus memegang peran ${allowed} (ADR 0013).`
    }
  }
  for (const s of rule.steps) {
    if (s.approverUser) {
      if (!(rolesOfUser(s.approverUser) ?? []).some(isDecisionRole)) return `Approver level ${s.level} harus memegang peran ${allowed} (ADR 0013).`
    } else if (s.approverRole && !isDecisionRole(s.approverRole)) {
      return `Peran approver level ${s.level} harus ${allowed} (ADR 0013: PM/Staff/Admin tidak memberi keputusan).`
    }
  }
  return null
}

export type PositionPlan = {
  /** "Diketahui" still has to be given (required and not skipped). */
  ackRequired: boolean
  /** Named acknowledger (acknowledgeBy = user), else null (role holders). */
  ackUserId: number | null
  /** Remaining approval steps, renumbered 1..m (may be empty when the only step was skipped). */
  steps: ApprovalSnapshot['steps']
  skipped: SkippedPosition[]
}

export type PlanInput = {
  rule: RuleShape
  /** Requesters' accounts + creator (G1, Q-08). */
  excluded: ReadonlySet<number>
  /**
   * ADR 0021 G1 exception (`direktur_via_pm`): the accounts excluded from the "Diketahui" position
   * (requesters only — the creator PM may approve as PM project) and from the approval steps
   * (creator only — the requester Direktur may approve). Default: `excluded` for both.
   */
  ackExcluded?: ReadonlySet<number>
  stepExcluded?: ReadonlySet<number>
  /** Active holders of the "Diketahui" position: role holders, or [the named user]. */
  ackHolders: readonly number[]
  /** Active holders per rule step, in the rule's level order (named user → [user]). */
  stepHolders: ReadonlyArray<readonly number[]>
}

const skipReason = (role: Role | null, scopeManager = false) =>
  role ? `pemohon/pembuat adalah satu-satunya ${ROLE_LABELS[role]}` : scopeManager ? 'PM project adalah pemohon/pembuat' : 'user yang ditetapkan adalah pemohon/pembuat'

/**
 * G1-2 position plan (ADR 0013 decision 5). For every decision position (required "Diketahui" +
 * each approval level) with holders H and eligible E = H − requesters/creator:
 *  - H empty → 409 (nobody holds the role: configuration problem, not a self-involvement case);
 *  - E empty → the position is SKIPPED (its only holders are requester/creator);
 *  - the remaining positions must be decidable by DISTINCT people (one position per person, DB
 *    unique index) and at least one must remain — else 409.
 * An optional "Diketahui" never blocks and is never recorded as skipped.
 */
export function planPositions(input: PlanInput): { ok: true; plan: PositionPlan } | { ok: false; error: string } {
  const { rule, excluded } = input
  const skipped: SkippedPosition[] = []
  const pools: number[][] = []
  const ackExcluded = input.ackExcluded ?? excluded
  const stepExcluded = input.stepExcluded ?? excluded
  const scopeManager = rule.acknowledgeBy === 'scope_manager'
  const ackRole = rule.acknowledgeBy === 'role' ? (rule.acknowledgeRole ?? null) : null
  // ADR 0021: the PM project resolved at submit is the only holder of a scope_manager "Diketahui".
  const ackUser = rule.acknowledgeBy === 'user' ? (rule.acknowledgeUser ?? null) : scopeManager ? (input.ackHolders[0] ?? null) : null
  let ackRequired = false
  if (rule.acknowledge === 'required') {
    const holders = [...new Set(input.ackHolders)]
    if (holders.length === 0) return { ok: false, error: noHolder('"Diketahui Oleh"', ackRole) }
    const eligible = holders.filter((u) => !ackExcluded.has(u))
    if (eligible.length === 0) skipped.push({ position: 'diketahui', level: 0, role: ackRole, userId: ackUser, reason: skipReason(ackRole, scopeManager) })
    else {
      ackRequired = true
      pools.push(eligible)
    }
  }
  const sorted = [...rule.steps].sort((a, b) => a.level - b.level)
  const steps: PositionPlan['steps'] = []
  for (const [i, s] of sorted.entries()) {
    const holders = [...new Set(input.stepHolders[i] ?? [])]
    const role = s.approverUser ? null : (s.approverRole ?? null)
    if (holders.length === 0) return { ok: false, error: noHolder(`Approval level ${s.level}`, role) }
    const eligible = holders.filter((u) => !stepExcluded.has(u))
    if (eligible.length === 0) {
      skipped.push({ position: 'approval', level: s.level, role, userId: s.approverUser ?? null, reason: skipReason(role) })
      continue
    }
    pools.push(eligible)
    steps.push({ level: steps.length + 1, approverRole: s.approverRole ?? null, approverUserId: s.approverUser ?? null })
  }
  if (pools.length === 0) {
    return {
      ok: false,
      error:
        'Tidak ada pihak independen yang dapat memutuskan: pemohon/pembuat adalah satu-satunya pemegang semua posisi keputusan (ADR 0013, G1). Hubungi Admin.',
    }
  }
  if (!distinctAssignable(pools)) {
    return {
      ok: false,
      error: 'Posisi "Diketahui"/Approval tidak dapat diisi oleh orang yang berbeda-beda (satu orang satu posisi, G1). Tambah pemegang peran atau ubah aturan approval. Hubungi Admin.',
    }
  }
  return { ok: true, plan: { ackRequired, ackUserId: ackRequired ? ackUser : null, steps, skipped } }
}

function noHolder(position: string, role: Role | null): string {
  return `Tidak ada pengguna aktif untuk posisi ${position}${role ? ` (peran ${ROLE_LABELS[role]})` : ''}. Hubungi Admin.`
}

/** Every pool gets a different person (small exact matching; positions are few). */
export function distinctAssignable(pools: ReadonlyArray<readonly number[]>): boolean {
  const used = new Set<number>()
  const assign = (i: number): boolean => {
    if (i === pools.length) return true
    for (const u of pools[i]!) {
      if (used.has(u)) continue
      used.add(u)
      if (assign(i + 1)) return true
      used.delete(u)
    }
    return false
  }
  return assign(0)
}

/** ADR 0013 snapshot (decision roles recorded) — legacy snapshots (before E1) have none. */
export function isDecisionSnapshot(s: Pick<ApprovalSnapshot, 'decisionRoles'> | null | undefined): boolean {
  return !!s?.decisionRoles && s.decisionRoles.length > 0
}

/**
 * Caller lacks every decision role of an ADR 0013 snapshot (PM / Staff / Admin → refused + audited).
 * ADR 0021: callers combine this with "is the PM acknowledger of this document" (`actorContext`).
 */
export function lacksDecisionRole(s: Pick<ApprovalSnapshot, 'decisionRoles'> | null | undefined, roles: readonly Role[]): boolean {
  if (!isDecisionSnapshot(s)) return false
  return !roles.some((r) => s!.decisionRoles!.includes(r))
}
