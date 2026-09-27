/**
 * Table-driven state machines for T1 (architecture §5.1 Uang Muka, §5.2 Reimburse, guard G6):
 * the ONLY transitions the domain service performs. Status never changes through a generic field
 * edit (field access update=false + hook rejecting a status diff without a transition context).
 * Pure module (unit-tested).
 */
import type { Role } from '@/access/roles'

import { receiptsEditable, type RequestStatus, type RequestType } from './types'

export const ACTIONS = [
  'edit',
  'submit',
  'withdraw',
  'cancel',
  'acknowledge',
  'approve',
  'reject',
  'add_receipt',
  'receipt_verify',
  'receipt_reject',
  'receipts_resubmit',
  'verify_receipts',
  'review_flag',
  'transfer',
  'transfer_void',
  'complete',
  'resubmit',
  // F2b — T5 LPJ & settlement (Uang Muka only, architecture §5.1/§5.3)
  'receipts_complete',
  'lpj_submit',
  'lpj_request_revision',
  'lpj_verify',
  'settle',
  // E9 — settlement reversal (Finance): void the refund KM / shortfall transfer, back to "LPJ Terverifikasi".
  'settle_reverse',
] as const
export type Action = (typeof ACTIONS)[number]

type Row = { from: RequestStatus[]; action: Action; to: RequestStatus[]; types?: RequestType[] }

/**
 * `to` lists every target the action may produce (e.g. submit → pending_ack when the approval
 * rule requires "Diketahui Oleh", else pending_approval; approve → pending_approval while levels
 * remain, approved on the last level; receipts_resubmit → approved when the grand total is
 * unchanged, pending_ack / pending_approval (re-approval) when it changed).
 */
export const TRANSITIONS: readonly Row[] = [
  { from: ['draft'], action: 'submit', to: ['pending_ack', 'pending_approval'] },
  { from: ['pending_ack', 'pending_approval'], action: 'withdraw', to: ['draft'] },
  { from: ['draft', 'pending_ack', 'pending_approval'], action: 'cancel', to: ['cancelled'] },
  { from: ['pending_ack', 'pending_approval'], action: 'acknowledge', to: ['pending_approval'] },
  { from: ['pending_approval'], action: 'approve', to: ['pending_approval', 'approved'] },
  { from: ['pending_ack', 'pending_approval'], action: 'reject', to: ['rejected'] },
  // Uang Muka (advance)
  { types: ['advance'], from: ['approved'], action: 'cancel', to: ['cancelled'] },
  { types: ['advance'], from: ['approved'], action: 'transfer', to: ['transferred'] },
  { types: ['advance'], from: ['transferred'], action: 'transfer_void', to: ['approved'] },
  // Reimburse
  { types: ['reimburse'], from: ['approved', 'receipts_verified'], action: 'receipt_reject', to: ['receipt_revision'] },
  // E1 (ADR 0013): changed total → re-approval starts again at "Menunggu Diketahui" (Direktur) when the
  // new snapshot requires it, else at "Menunggu Approval".
  { types: ['reimburse'], from: ['receipt_revision'], action: 'receipts_resubmit', to: ['approved', 'pending_ack', 'pending_approval'] },
  { types: ['reimburse'], from: ['approved'], action: 'verify_receipts', to: ['receipts_verified'] },
  { types: ['reimburse'], from: ['approved', 'receipts_verified', 'receipt_revision'], action: 'cancel', to: ['cancelled'] },
  { types: ['reimburse'], from: ['receipts_verified'], action: 'transfer', to: ['transferred'] },
  { types: ['reimburse'], from: ['transferred'], action: 'transfer_void', to: ['receipts_verified'] },
  { types: ['reimburse'], from: ['transferred'], action: 'complete', to: ['completed'] },
  // Uang Muka LPJ (T5): receipts complete → LPJ submitted ⇄ revision → verified → settled.
  // lpj_verify → completed directly when the difference is 0 (nothing to settle).
  { types: ['advance'], from: ['transferred'], action: 'receipts_complete', to: ['receipts_complete'] },
  { types: ['advance'], from: ['receipts_complete', 'lpj_revision'], action: 'lpj_submit', to: ['lpj_submitted'] },
  { types: ['advance'], from: ['lpj_submitted'], action: 'lpj_request_revision', to: ['lpj_revision'] },
  { types: ['advance'], from: ['lpj_submitted'], action: 'lpj_verify', to: ['lpj_verified', 'completed'] },
  { types: ['advance'], from: ['lpj_verified'], action: 'settle', to: ['completed'] },
  { types: ['advance'], from: ['completed'], action: 'settle_reverse', to: ['lpj_verified'] },
]

export class TransitionError extends Error {
  constructor(
    readonly type: RequestType,
    readonly from: RequestStatus,
    readonly action: Action,
    readonly to?: RequestStatus,
  ) {
    super(`Aksi "${action}" tidak diizinkan pada status ${from}${to ? ` → ${to}` : ''} (${type}).`)
  }
}

/** Targets reachable from `from` via `action` for `type` (empty = not allowed). */
export function targets(type: RequestType, from: RequestStatus, action: Action): RequestStatus[] {
  const out = new Set<RequestStatus>()
  for (const r of TRANSITIONS) {
    if (r.action !== action) continue
    if (r.types && !r.types.includes(type)) continue
    if (!r.from.includes(from)) continue
    for (const t of r.to) out.add(t)
  }
  return [...out]
}

/** Throws TransitionError unless `from --action--> to` is in the table. */
export function assertTransition(type: RequestType, from: RequestStatus, action: Action, to: RequestStatus): void {
  if (!targets(type, from, action).includes(to)) throw new TransitionError(type, from, action, to)
}

/** Facts about the caller and the document that the actor guards need (computed by the service). */
export type ActorContext = {
  type: RequestType
  status: RequestStatus
  roles: readonly Role[]
  /** "Dibuat Oleh" (server-set creator). */
  isCreator: boolean
  /** The caller's employee is one of "Diajukan Oleh". */
  isRequester: boolean
  /** Any acknowledge/approve/reject row exists in the current approval cycle (US-04, G8). */
  hasDecision: boolean
  /** Caller is the acknowledger resolved at submit (and the step is still open). */
  isAcknowledger: boolean
  /** Caller matches the approval step of the current level (role/user) — G2. */
  matchesCurrentStep: boolean
  /** Caller already holds a decision position (diketahui/approval) in this cycle — G1. */
  alreadyDecided: boolean
  /**
   * ADR 0013: the request's snapshot restricts decisions to Direktur/Finance and the caller holds
   * neither (PM monitors only). Absent/false on legacy snapshots.
   */
  lacksDecisionRole?: boolean
}

/** Actions that do not move the status (their own status preconditions are checked in allowedActions). */
const NON_TRANSITION: ReadonlySet<Action> = new Set<Action>(['edit', 'resubmit', 'review_flag', 'add_receipt', 'receipt_verify'])

/** Finance actions refused on a request where the Finance user is requester or creator (F2e). */
export const FINANCE_SELF_GUARDED: ReadonlySet<Action> = new Set<Action>(['receipt_verify', 'receipt_reject', 'verify_receipts', 'review_flag', 'lpj_request_revision', 'lpj_verify', 'settle', 'settle_reverse'])

const has = (ctx: ActorContext, ...roles: Role[]) => ctx.roles.some((r) => roles.includes(r))
const office = (ctx: ActorContext) => has(ctx, 'pk-finance', 'pk-owner')

/**
 * Actor guards (requirements v1.1 §4, US-04/US-17/US-40/US-42, architecture G1/G2/G8). Returns
 * the actions the caller may perform NOW (state table ∩ role/ownership rules). Used by the
 * service (authoritative) and by the detail DTO (`allowedActions`, UI hint only).
 */
export function allowedActions(ctx: ActorContext): Action[] {
  const own = ctx.isCreator || ctx.isRequester
  const selfInvolved = ctx.isCreator || ctx.isRequester // G1 / Q-08: may not acknowledge or approve
  const out: Action[] = []
  const add = (a: Action, ok: boolean) => {
    if (ok && (NON_TRANSITION.has(a) || targets(ctx.type, ctx.status, a).length > 0)) out.push(a)
  }
  add('edit', (ctx.status === 'draft' || (ctx.status === 'receipt_revision' && ctx.type === 'reimburse')) && own)
  add('submit', own)
  add('withdraw', own && !ctx.hasDecision)
  add(
    'cancel',
    ctx.status === 'draft' || ctx.status === 'pending_ack' || ctx.status === 'pending_approval'
      ? own && !ctx.hasDecision
      : office(ctx),
  )
  const decider = !selfInvolved && !ctx.alreadyDecided && !ctx.lacksDecisionRole
  add('acknowledge', ctx.isAcknowledger && decider)
  add('approve', ctx.matchesCurrentStep && decider)
  add('reject', decider && (ctx.status === 'pending_ack' ? ctx.isAcknowledger : ctx.matchesCurrentStep))
  // F2e: Finance never verifies receipts / reviews flags of a request it requested or created
  // (G1 spirit, like the LPJ actions below) — FINANCE_SELF_GUARDED, denied attempts are audited.
  const finance = has(ctx, 'pk-finance') && !selfInvolved
  add(
    'receipt_verify',
    finance &&
      ((ctx.type === 'reimburse' && (ctx.status === 'approved' || ctx.status === 'receipts_verified')) ||
        // LPJ review (Uang Muka): valid/rejected per receipt, no status change.
        (ctx.type === 'advance' && ctx.status === 'lpj_submitted')),
  )
  add('receipt_reject', finance)
  add('receipts_resubmit', own)
  add('verify_receipts', finance)
  add('review_flag', finance && ctx.status !== 'draft' && ctx.status !== 'cancelled' && ctx.status !== 'rejected')
  add('transfer', has(ctx, 'pk-finance'))
  add('transfer_void', has(ctx, 'pk-finance'))
  add('complete', own || has(ctx, 'pk-finance'))
  add('resubmit', ctx.status === 'rejected' && own)
  // T5 (US-08, US-21, US-22): the requester side completes receipts and (re)submits the LPJ;
  // Finance reviews, requests revision, verifies and settles — never on its own request (G1 spirit).
  add('receipts_complete', own)
  add('lpj_submit', own)
  add('lpj_request_revision', has(ctx, 'pk-finance') && !selfInvolved)
  add('lpj_verify', has(ctx, 'pk-finance') && !selfInvolved)
  add('settle', has(ctx, 'pk-finance') && !selfInvolved)
  add('settle_reverse', has(ctx, 'pk-finance') && !selfInvolved)
  add('add_receipt', own && receiptsEditable(ctx.type, ctx.status))
  return out
}

/**
 * E9 (UAT 5.2, "409 vs 403"): may the caller EVER perform `action` on this document, whatever its
 * status? Role and ownership only (requirements v1.1 §4, G1/G17, ADR 0013) — the status-dependent
 * parts (whose turn, current step, already decided) stay in `allowedActions`. The service checks
 * this FIRST, so an authorization failure is always 403 and only an authorized caller learns that
 * the status does not allow the action (409). Pure (unit-tested).
 */
export function mayPerform(ctx: ActorContext, action: Action): boolean {
  const own = ctx.isCreator || ctx.isRequester
  const finance = has(ctx, 'pk-finance')
  switch (action) {
    case 'edit':
    case 'submit':
    case 'withdraw':
    case 'resubmit':
    case 'receipts_resubmit':
    case 'add_receipt':
    case 'receipts_complete':
    case 'lpj_submit':
      return own
    case 'cancel':
      return own || office(ctx)
    case 'acknowledge':
    case 'approve':
    case 'reject':
      // G1 / Q-08: never on one's own request; ADR 0013: only Direktur/Finance decide.
      return !own && !ctx.lacksDecisionRole
    case 'transfer':
    case 'transfer_void':
      return finance
    case 'complete':
      return own || finance
    default:
      // receipt_verify, receipt_reject, verify_receipts, review_flag, lpj_request_revision, lpj_verify,
      // settle, settle_reverse: Finance, never on a request it requested/created (F2e, G17).
      return finance && !own
  }
}
