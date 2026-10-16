import { relId, type Role } from '@/access/roles'

/**
 * ADR 0025 — per-PT definitive Direktur signature (owner decision DRMS 13/10 A3).
 *
 * Each PT may record its DEFINITIVE (legal) Direktur: name, title (jabatan) and signature image, plus the
 * app users ("wakil") designated to decide the Direktur step on that Direktur's behalf — the definitive
 * Direktur has no app account. When a designated representative decides a DIREKTUR STEP of a document of that
 * PT, the decision is signed with the PT's Direktur signature and SHOWN under the Direktur's name (PDF, stepper,
 * timeline, Log perubahan, API, APK). The approval row still references the real user (`actor`: FK, G1 /
 * distinct-person rules, DB guards, forensics) and records the representation in non-displayed columns
 * (`signatureSource = 'company'` + `representedDirektur` name/title snapshot); the signature media row is
 * immutable (id + SHA-256), so a re-rendered PDF stays identical after the PT changes its Direktur data.
 *
 * Direktur step = a decision position HELD BY THE DIREKTUR ROLE (`pk-owner`), never a person named in the rule:
 *  - "Diketahui" given by the role Direktur (ADR 0013 / addendum Direktur → Finance), or delegated to the
 *    Direktur tier (F2e, PM is requester/creator);
 *  - an approval level whose approver is the role Direktur (ADR 0021 PM → Direktur);
 *  - the single Direktur decision of an inter-project loan (ADR 0022).
 * A PM step (scope_manager), a Finance level, a named-user step and every signature of the requester/creator
 * (Diajukan / Dibuat) are personal: the representative signs them with their own profile/drawn signature.
 */

export const DIREKTUR: Role = 'pk-owner'

/** `media-signatures.ownerDocType` of a PT's definitive Direktur signature (owner link set on the PT save). */
export const COMPANY_DIREKTUR_OWNER = 'company_direktur'

/** `approvals.signatureSource` of a decision signed with the PT's definitive Direktur signature. */
export const COMPANY_SIGNATURE_SOURCE = 'company'

/** `req.context` key: display name of the actor of every audit row written in this request (writeAudit). */
export const AUDIT_ACTOR_DISPLAY = 'pkAuditActorDisplay'

type AckShape = {
  acknowledge?: string | null
  acknowledgeBy?: string | null
  acknowledgeRole?: string | null
  acknowledgeDelegatedTo?: string | null
}
type StepShape = { steps?: ReadonlyArray<{ level: number; approverRole?: string | null; approverUserId?: number | null }> | null }

/** "Diketahui" of the snapshot is held by the Direktur role (role step, or F2e delegation to the Direktur tier). */
export function isDirekturAckStep(s: AckShape | null | undefined): boolean {
  if (!s || s.acknowledge === 'none') return false
  if (s.acknowledgeDelegatedTo) return s.acknowledgeDelegatedTo === 'owner'
  return s.acknowledgeBy === 'role' && s.acknowledgeRole === DIREKTUR
}

/** Approval level `level` of the snapshot is held by the Direktur role (a named user is a personal step). */
export function isDirekturApprovalStep(s: StepShape | null | undefined, level: number | null | undefined): boolean {
  const step = s?.steps?.find((x) => x.level === (level ?? 1))
  return !!step && (step.approverUserId === null || step.approverUserId === undefined) && step.approverRole === DIREKTUR
}

/** The decision position being decided (acknowledge = level 0 "Diketahui", else an approval level). */
export function isDirekturStep(s: (AckShape & StepShape) | null | undefined, position: 'diketahui' | 'approval', level: number | null | undefined): boolean {
  return position === 'diketahui' ? isDirekturAckStep(s) : isDirekturApprovalStep(s, level)
}

export type CompanyDirektur = {
  companyId: number
  name: string
  title: string | null
  signatureId: number
  representatives: number[]
}

/** The `direktur` group of a company row → a COMPLETE configuration (name + signature), else null. Pure. */
export function direkturOf(companyId: number, d: unknown): CompanyDirektur | null {
  if (!d || typeof d !== 'object') return null
  const g = d as { name?: unknown; title?: unknown; signature?: unknown; representatives?: unknown }
  const name = typeof g.name === 'string' ? g.name.trim() : ''
  const signatureId = relId(g.signature)
  if (!name || signatureId === undefined) return null
  const title = typeof g.title === 'string' && g.title.trim() ? g.title.trim() : null
  const reps = Array.isArray(g.representatives) ? g.representatives.map((r) => relId(r)).filter((x): x is number => x !== undefined) : []
  return { companyId, name, title, signatureId, representatives: [...new Set(reps)].sort((a, b) => a - b) }
}

/** Representation applies: complete config, the caller is a designated representative, the step is a Direktur step. Pure. */
export function representationApplies(cfg: CompanyDirektur | null, callerId: number, direkturStep: boolean): cfg is CompanyDirektur {
  return direkturStep && !!cfg && cfg.representatives.includes(callerId)
}

/**
 * Owner decision 2026-10-16 (DRMS, wakil PM + Direktur): G1 "one decision position per person per cycle" counts a
 * user's PERSONAL decisions and their decisions AS the PT's definitive Direktur (`signatureSource = 'company'`)
 * separately — a designated representative who decided the PM step with their own signature may still decide the
 * Direktur step as the definitive Direktur, never two positions under the same identity. `asDirektur` = the
 * decision the caller would take now is represented. The DB indexes `approvals_one_position_per_person` /
 * `approvals_settlement_one_position_per_person` (migration 20261016_220000) enforce the same split. Pure.
 */
export function holdsPositionAs(
  rows: ReadonlyArray<{ actor?: unknown; position: string; decision: string; signatureSource?: string | null }>,
  callerId: number,
  asDirektur: boolean,
): boolean {
  return rows.some(
    (r) =>
      relId(r.actor) === callerId &&
      (r.position === 'diketahui' || r.position === 'approval') &&
      r.decision !== 'signed' &&
      (r.signatureSource === COMPANY_SIGNATURE_SOURCE) === asDirektur,
  )
}

/** Text of the represented Direktur as printed (PDF box / timeline): "Nama (Jabatan)". Pure. */
export function direkturLabel(name: string | null | undefined, title?: string | null): string {
  const n = (name ?? '').trim()
  const t = (title ?? '').trim()
  return t ? `${n} (${t})` : n
}


/**
 * The decision position the caller's allowed actions point at (detail DTO hint, same order as the decision bar):
 * approve → the current approval level, acknowledge → "Diketahui", reject → the waiting position. Pure.
 */
export function decisionPositionOf(allowed: readonly string[], status: string, currentLevel: number | null | undefined): { position: 'diketahui' | 'approval'; level: number } | null {
  if (allowed.includes('approve')) return { position: 'approval', level: currentLevel ?? 1 }
  if (allowed.includes('acknowledge')) return { position: 'diketahui', level: 0 }
  if (allowed.includes('reject')) return status === 'pending_ack' ? { position: 'diketahui', level: 0 } : { position: 'approval', level: currentLevel ?? 1 }
  return null
}
