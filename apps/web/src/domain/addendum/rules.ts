/**
 * E5 — Addendum RAB (T12, US-18/US-30, plan fase1-golive §E5, architecture §5.4, ADR 0013 O-3 as
 * decided for Sprint S2: Direktur ("Diketahui" = approval) → Finance, through the SAME rule engine
 * as expense requests: `approval-rules` rows with `docType: budget_addendum`).
 * Pure module (unit-tested, bundled into the OpenAPI generator): statuses, transitions, validation
 * and the budget arithmetic. No Payload import.
 */

export const ADDENDUM_STATUSES = ['draft', 'pending_ack', 'pending_approval', 'approved', 'rejected', 'cancelled'] as const
export type AddendumStatus = (typeof ADDENDUM_STATUSES)[number]

export const ADDENDUM_STATUS_LABELS: Record<AddendumStatus, string> = {
  draft: 'Draft',
  pending_ack: 'Menunggu Direktur',
  pending_approval: 'Menunggu Finance',
  approved: 'Disetujui',
  rejected: 'Ditolak',
  cancelled: 'Dibatalkan',
}

export const ADDENDUM_ACTIONS = ['edit', 'submit', 'cancel', 'acknowledge', 'approve', 'reject'] as const
export type AddendumAction = (typeof ADDENDUM_ACTIONS)[number]

/** Status transitions performed by the service (DB trigger `pk_budget_addenda_guard` mirrors them). */
export const ADDENDUM_TRANSITIONS: Readonly<Record<AddendumStatus, readonly AddendumStatus[]>> = {
  draft: ['pending_ack', 'pending_approval', 'cancelled'],
  pending_ack: ['pending_approval', 'approved', 'rejected', 'cancelled'],
  pending_approval: ['approved', 'rejected', 'cancelled'],
  approved: [],
  rejected: [],
  cancelled: [],
}

export const isTerminal = (s: AddendumStatus): boolean => ADDENDUM_TRANSITIONS[s].length === 0

/** Maximum addition per addendum (Rp 1 triliun) — a sanity bound, not a business limit. */
export const MAX_ADDITION = 1_000_000_000_000
export const REASON_MIN = 3
export const REASON_MAX = 1000

/** US-18: nominal (integer Rupiah > 0) and reason (≥ 3 chars) are required. */
export function addendumInputErrors(input: { addition?: unknown; reason?: unknown }): Array<{ path: string; message: string }> {
  const errors: Array<{ path: string; message: string }> = []
  const a = input.addition
  if (typeof a !== 'number' || !Number.isSafeInteger(a) || a <= 0) errors.push({ path: 'addition', message: 'Nominal tambahan wajib diisi (bilangan bulat Rupiah > 0).' })
  else if (a > MAX_ADDITION) errors.push({ path: 'addition', message: 'Nominal tambahan terlalu besar.' })
  const r = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (r.length < REASON_MIN) errors.push({ path: 'reason', message: `Alasan addendum wajib diisi (min. ${REASON_MIN} karakter).` })
  else if (r.length > REASON_MAX) errors.push({ path: 'reason', message: `Alasan maks. ${REASON_MAX} karakter.` })
  return errors
}

/**
 * New RAB after approval (architecture §5.4 "Concurrent addenda"): the CURRENT budget re-read under the
 * project row lock + the addition — never the value seen at submit.
 */
export function newBudget(currentBudget: number | null | undefined, addition: number): number {
  return Math.round(Number(currentBudget ?? 0)) + addition
}

/** % of RAB (2 decimals) or null without RAB. */
export function pctOf(amount: number, budget: number | null | undefined): number | null {
  if (!budget || budget <= 0) return null
  return Math.round((amount / budget) * 10000) / 100
}

export type AddendumActorContext = {
  status: AddendumStatus
  isCreator: boolean
  /** PM of the project (team scope) — may create/submit/cancel. */
  isTeamPm: boolean
  /** Snapshot resolution (G2): caller is an eligible "Diketahui" (Direktur) holder. */
  isAcknowledger: boolean
  /** Snapshot resolution (G2): caller matches the current approval level. */
  matchesCurrentStep: boolean
  /** A decision exists in the current cycle (cancel is then no longer possible). */
  hasDecision: boolean
  /** Caller already holds a decision position on this addendum (one position per person, G1). */
  alreadyDecided: boolean
}

/** Actions the caller may take now (UI + service guard; the DB re-checks G1 and the transitions). */
export function addendumAllowedActions(c: AddendumActorContext): AddendumAction[] {
  const out: AddendumAction[] = []
  if (c.status === 'draft' && c.isCreator && c.isTeamPm) out.push('edit', 'submit')
  if (c.isCreator && (c.status === 'draft' || ((c.status === 'pending_ack' || c.status === 'pending_approval') && !c.hasDecision))) out.push('cancel')
  if (!c.isCreator && !c.alreadyDecided) {
    if (c.status === 'pending_ack' && c.isAcknowledger) out.push('acknowledge', 'reject')
    if (c.status === 'pending_approval' && c.matchesCurrentStep) out.push('approve', 'reject')
  }
  return out
}
