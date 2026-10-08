/**
 * T5 LPJ & settlement vocabulary and arithmetic (architecture §5.1 "settle" choice, §5.3).
 * Pure module (unit-tested, bundled by the OpenAPI generator).
 */
export const SETTLEMENT_STATUSES = ['draft', 'submitted', 'revision', 'verified', 'settled'] as const
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number]

export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  draft: 'Draft',
  submitted: 'Diajukan',
  revision: 'Revisi',
  verified: 'Terverifikasi',
  settled: 'Disettle',
}

export type SettlementType = 'none' | 'refund' | 'shortfall'

export const SETTLEMENT_TYPE_LABELS: Record<SettlementType, string> = {
  none: 'Pas — tanpa selisih',
  refund: 'Sisa dana dikembalikan ke kas (KM Pengembalian LPJ)',
  shortfall: 'Kekurangan dibayar dengan transfer',
}

/** Allowed settlement status moves (mirrors the DB trigger pk_settlements_guard). */
export const SETTLEMENT_MOVES: Readonly<Record<SettlementStatus, readonly SettlementStatus[]>> = {
  draft: ['submitted'],
  submitted: ['revision', 'verified'],
  revision: ['submitted'],
  verified: ['settled'],
  settled: [],
}

/**
 * difference = transferred − verified receipts (architecture §5.1):
 * > 0 surplus → staff returns the rest → refund (KM); < 0 → company owes the rest → shortfall
 * transfer (T3); 0 → nothing to settle.
 */
export function settlementOf(transferredTotal: number, verifiedReceiptsTotal: number): { difference: number; type: SettlementType; amount: number } {
  const difference = transferredTotal - verifiedReceiptsTotal
  if (difference > 0) return { difference, type: 'refund', amount: difference }
  if (difference < 0) return { difference, type: 'shortfall', amount: -difference }
  return { difference: 0, type: 'none', amount: 0 }
}

// ------------------------------------------------------------------------------------------------
// QA-06 / ADR 0019 — LPJ shortfall above the approved amount: tolerance, then re-approval.

/** Default `companies.shortfallTolerancePct` (owner decision 2026-10-08). */
export const SHORTFALL_TOLERANCE_DEFAULT_PCT = 10

export const SHORTFALL_APPROVAL_STATUSES = ['pending_ack', 'pending_approval', 'approved', 'rejected'] as const
export type ShortfallApprovalStatus = (typeof SHORTFALL_APPROVAL_STATUSES)[number]

export const SHORTFALL_APPROVAL_LABELS: Record<ShortfallApprovalStatus, string> = {
  pending_ack: 'Menunggu persetujuan Direktur',
  pending_approval: 'Menunggu approval Finance',
  approved: 'Kekurangan disetujui',
  rejected: 'Kekurangan ditolak',
}

/**
 * Highest total transfer that needs no re-approval: approved + ⌊approved × tol / 100⌋ (whole Rupiah;
 * a negative / invalid tolerance counts as 0, above 100 as 100 — the field is validated 0–100).
 */
export function shortfallCeiling(approvedAmount: number, tolerancePct: number | null | undefined): number {
  const tol = typeof tolerancePct === 'number' && Number.isFinite(tolerancePct) ? Math.min(100, Math.max(0, tolerancePct)) : SHORTFALL_TOLERANCE_DEFAULT_PCT
  const approved = Math.max(0, Math.trunc(approvedAmount))
  return approved + Math.floor((approved * tol) / 100)
}

export type ShortfallCheck = {
  /** Total transferred after paying the shortfall. */
  totalAfter: number
  ceiling: number
  /** totalAfter above the ceiling → the excess needs the approval engine (ADR 0013 Direktur → Finance). */
  aboveTolerance: boolean
  /** An approved shortfall approval covers totalAfter. */
  covered: boolean
  /** Settling is allowed now. */
  allowed: boolean
}

/** ADR 0019 rule (also enforced by the DB trigger pk_transfers_shortfall_tolerance). */
export function shortfallCheck(input: {
  approvedAmount: number
  transferredTotal: number
  shortfall: number
  tolerancePct: number | null | undefined
  approval?: { status?: ShortfallApprovalStatus | null; amount?: number | null } | null
}): ShortfallCheck {
  const totalAfter = Math.max(0, input.transferredTotal) + Math.max(0, input.shortfall)
  const ceiling = shortfallCeiling(input.approvedAmount, input.tolerancePct)
  const aboveTolerance = totalAfter > ceiling
  const covered = input.approval?.status === 'approved' && (input.approval.amount ?? 0) >= totalAfter
  return { totalAfter, ceiling, aboveTolerance, covered, allowed: !aboveTolerance || covered }
}

export type ShortfallAction = 'acknowledge' | 'approve' | 'reject'

export type ShortfallCtx = {
  status: ShortfallApprovalStatus | null
  selfInvolved: boolean
  isAcknowledger: boolean
  matchesCurrentStep: boolean
  alreadyDecided: boolean
  lacksDecisionRole: boolean
}

/** Decisions the caller may take now (pure; same guards as expense requests G1/G2/ADR 0013). */
export function shortfallAllowedActions(ctx: ShortfallCtx): ShortfallAction[] {
  const decider = !ctx.selfInvolved && !ctx.alreadyDecided && !ctx.lacksDecisionRole
  const out: ShortfallAction[] = []
  if (decider && ctx.status === 'pending_ack' && ctx.isAcknowledger) out.push('acknowledge', 'reject')
  if (decider && ctx.status === 'pending_approval' && ctx.matchesCurrentStep) out.push('approve', 'reject')
  return out
}
