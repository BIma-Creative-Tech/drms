/**
 * ADR 0013 (accepted 2026-09-26, GATE 1 G1-1/G1-2): "Diketahui" is an APPROVAL by the Direktur
 * (= the existing role `pk-owner`, relabelled), followed by Finance approval; the PM only monitors.
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

type RuleShape = Pick<RuleInput, 'acknowledge' | 'acknowledgeBy' | 'acknowledgeRole' | 'acknowledgeUser' | 'steps'>

/**
 * Why a rule may not be used under ADR 0013 (null = valid). `rolesOfUser` returns the roles of a
 * named user (acknowledgeUser / approverUser); only Direktur/Finance holders may be named.
 */
export function ruleDecisionError(rule: RuleShape, rolesOfUser: (id: number) => readonly Role[] | undefined): string | null {
  const label = (r: Role) => ROLE_LABELS[r]
  const allowed = `${label('pk-owner')} atau ${label('pk-finance')}`
  if (rule.acknowledge !== 'none') {
    const by = rule.acknowledgeBy ?? 'scope_manager'
    if (by === 'scope_manager') {
      return `Pengisi "Diketahui Oleh" = PM project / penanggung jawab pusat biaya tidak dipakai lagi (ADR 0013: PM hanya memantau). Pilih peran ${label('pk-owner')} atau user tertentu.`
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
  /** Active holders of the "Diketahui" position: role holders, or [the named user]. */
  ackHolders: readonly number[]
  /** Active holders per rule step, in the rule's level order (named user → [user]). */
  stepHolders: ReadonlyArray<readonly number[]>
}

const skipReason = (role: Role | null) => (role ? `pemohon/pembuat adalah satu-satunya ${ROLE_LABELS[role]}` : 'user yang ditetapkan adalah pemohon/pembuat')

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
  const ackRole = rule.acknowledgeBy === 'role' ? (rule.acknowledgeRole ?? null) : null
  const ackUser = rule.acknowledgeBy === 'user' ? (rule.acknowledgeUser ?? null) : null
  let ackRequired = false
  if (rule.acknowledge === 'required') {
    const holders = [...new Set(input.ackHolders)]
    if (holders.length === 0) return { ok: false, error: noHolder('"Diketahui Oleh"', ackRole) }
    const eligible = holders.filter((u) => !excluded.has(u))
    if (eligible.length === 0) skipped.push({ position: 'diketahui', level: 0, role: ackRole, userId: ackUser, reason: skipReason(ackRole) })
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
    const eligible = holders.filter((u) => !excluded.has(u))
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
        'Tidak ada pihak independen yang dapat memutuskan: pemohon/pembuat adalah satu-satunya pemegang semua posisi keputusan (Direktur dan Finance) (ADR 0013, G1). Hubungi Admin.',
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

/** Caller lacks every decision role of an ADR 0013 snapshot (PM / Staff / Admin → refused + audited). */
export function lacksDecisionRole(s: Pick<ApprovalSnapshot, 'decisionRoles'> | null | undefined, roles: readonly Role[]): boolean {
  if (!isDecisionSnapshot(s)) return false
  return !roles.some((r) => s!.decisionRoles!.includes(r))
}
