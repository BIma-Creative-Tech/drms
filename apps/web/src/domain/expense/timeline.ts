/**
 * Status timeline + "whose turn is it" for the web panel (US-05, F2c item 5). Pure module
 * (unit-tested): derived from the state machine vocabulary (architecture §5.1 Pengajuan Baru, §5.2
 * Reimburse) and the approval snapshot stored at submit — never decides anything, the domain
 * service stays authoritative.
 */
import { ROLE_LABELS, type Role } from '@/access/roles'

import { DIREKTUR_ROLE, isDecisionSnapshot, isNoApproval } from './decision'
import { ACK_DELEGATE_ROLE, type ApprovalSnapshot } from './rules'
import { LEGACY_WAITING_LABELS, NO_APPROVAL_STATUS_LABELS, statusLabel, type RequestStatus, type RequestType } from './types'

/** Happy-path order per type (branches — rejected/cancelled/revisions — are shown as the current step). */
export const STATUS_PATH: Record<RequestType, RequestStatus[]> = {
  advance: ['draft', 'pending_ack', 'pending_approval', 'approved', 'transferred', 'receipts_complete', 'lpj_submitted', 'lpj_verified', 'completed'],
  reimburse: ['draft', 'pending_ack', 'pending_approval', 'approved', 'receipts_verified', 'transferred', 'completed'],
}

/** Where a side status sits on the happy path (for "done" marking). */
const SIDE_ANCHOR: Partial<Record<RequestStatus, RequestStatus>> = {
  receipt_revision: 'approved',
  lpj_revision: 'lpj_submitted',
}

export type TimelineStep = { status: RequestStatus; label: string; state: 'done' | 'current' | 'todo' }

export function timeline(type: RequestType, status: RequestStatus, opts: { skipAck?: boolean; snapshot?: LabelSnapshot | null; currentLevel?: number | null } = {}): TimelineStep[] {
  // ADR 0024: a Direktur's own request without approval never waits for a decision
  const noApproval = isNoApproval(opts.snapshot)
  const path = STATUS_PATH[type].filter((s) => !((opts.skipAck || noApproval) && s === 'pending_ack') && !(noApproval && s === 'pending_approval'))
  const anchor = SIDE_ANCHOR[status] ?? status
  const idx = path.indexOf(anchor)
  const steps: TimelineStep[] = path.map((s, i) => ({
    status: s,
    label: requestStatusLabel(type, s, opts.snapshot ?? null, opts.currentLevel ?? null),
    state: idx < 0 ? (i === 0 ? 'done' : 'todo') : i < idx ? 'done' : i === idx ? 'current' : 'todo',
  }))
  if (SIDE_ANCHOR[status] && idx >= 0) {
    // e.g. "Revisi Nota" after "Disetujui": the anchor is done, the side status is current.
    steps[idx] = { ...steps[idx]!, state: 'done' }
    steps.splice(idx + 1, 0, { status, label: statusLabel(type, status), state: 'current' })
  }
  if (status === 'rejected' || status === 'cancelled') {
    steps.push({ status, label: statusLabel(type, status), state: 'current' })
  }
  return steps
}

export type NextActor = { who: string; what: string }

type LabelSnapshot = Pick<ApprovalSnapshot, 'acknowledgeBy' | 'acknowledgeRole' | 'steps' | 'decisionRoles' | 'selfApproval'>

/** ADR 0021: PM project → Direktur snapshot ("Diketahui" = Persetujuan PM). */
export function isPmFlow(snap: Pick<ApprovalSnapshot, 'acknowledgeBy' | 'decisionRoles'> | null | undefined): boolean {
  return !!snap && snap.acknowledgeBy === 'scope_manager' && isDecisionSnapshot(snap)
}

/** Approval step of `level` decided by the Direktur role (ADR 0021 step 2). */
function direkturStep(snap: LabelSnapshot | null | undefined, level: number): boolean {
  const step = snap?.steps.find((s) => s.level === level)
  return !!step && step.approverUserId === null && step.approverRole === DIREKTUR_ROLE
}

/** Label of the "Diketahui" step (inbox, panel): ADR 0021 "Persetujuan PM", ADR 0013 "Persetujuan Direktur (Diketahui)". */
export function ackStepLabel(snap: LabelSnapshot | null | undefined): string {
  if (isPmFlow(snap)) return 'Persetujuan PM'
  return isDecisionSnapshot(snap) ? 'Persetujuan Direktur (Diketahui)' : 'Diketahui Oleh'
}

/** Label of approval level `level` (ADR 0021: the Direktur step → "Persetujuan Direktur"). */
export function approvalStepLabel(snap: LabelSnapshot | null | undefined, level: number): string {
  return direkturStep(snap, level) ? 'Persetujuan Direktur' : `Approval level ${level}`
}

/** Who decides the step (APK decision sheet texts): ADR 0021 PM / Direktur, ADR 0013 Direktur / Finance. */
export function decisionByOf(snap: LabelSnapshot | null | undefined, step: 'acknowledge' | 'approve', level: number): 'pm' | 'direktur' | 'finance' | 'other' {
  if (step === 'acknowledge') return isPmFlow(snap) ? 'pm' : snap?.acknowledgeBy === 'role' && snap.acknowledgeRole === DIREKTUR_ROLE ? 'direktur' : snap?.acknowledgeBy === 'role' && snap.acknowledgeRole === 'pk-finance' ? 'finance' : 'other'
  const s = snap?.steps.find((x) => x.level === level)
  if (!s || s.approverUserId !== null) return 'other'
  return s.approverRole === DIREKTUR_ROLE ? 'direktur' : s.approverRole === 'pk-finance' ? 'finance' : 'other'
}

/**
 * Status label of a request for its snapshot. ADR 0021 (PM project → Direktur) = STATUS_LABELS
 * ("Menunggu persetujuan PM" / "Menunggu persetujuan Direktur"); older snapshots keep their wording
 * (LEGACY_WAITING_LABELS: "Menunggu Diketahui (Direktur)", "Menunggu Diketahui", "Menunggu Approval").
 * ADR 0024: "Disetujui" of a `direktur_no_approval` snapshot → NO_APPROVAL_STATUS_LABELS.
 * No snapshot (list rows without it, reminders) = `statusLabel`. One source: domain/expense/types.ts.
 */
export function requestStatusLabel(type: RequestType, status: RequestStatus, snap: LabelSnapshot | null | undefined, currentLevel: number | null | undefined): string {
  // ADR 0024: a Direktur's own request without approval is never "Disetujui"
  if (status === 'approved' && isNoApproval(snap)) return NO_APPROVAL_STATUS_LABELS[type]
  if (status === 'pending_ack' && snap && !isPmFlow(snap)) {
    return isDecisionSnapshot(snap) && snap.acknowledgeBy === 'role' && snap.acknowledgeRole === DIREKTUR_ROLE ? LEGACY_WAITING_LABELS.ackDirektur : LEGACY_WAITING_LABELS.ack
  }
  if (status === 'pending_approval' && snap && !(isPmFlow(snap) && direkturStep(snap, currentLevel || 1))) return LEGACY_WAITING_LABELS.approval
  return statusLabel(type, status)
}

type SnapshotLike = Pick<ApprovalSnapshot, 'acknowledge' | 'acknowledgeBy' | 'acknowledgerUserId' | 'acknowledgeRole' | 'steps' | 'acknowledgeDelegatedTo' | 'decisionRoles'>

const roleLabel = (r: Role | null | undefined) => (r ? ROLE_LABELS[r] : 'approver')

/**
 * The actor expected to act next. `names` resolves user ids (acknowledger / approver user) to a
 * display name; `requesters` is the "Diajukan Oleh" display text.
 */
export function nextActor(input: {
  type: RequestType
  status: RequestStatus
  currentLevel: number | null
  snapshot: SnapshotLike | null
  requesters: string
  names: Record<number, string>
}): NextActor | null {
  const { type, status, snapshot } = input
  const requester = input.requesters ? `Pemohon (${input.requesters})` : 'Pemohon / pembuat'
  const user = (id: number | null | undefined) => (id ? (input.names[id] ?? `user #${id}`) : null)
  switch (status) {
    case 'draft':
      return { who: requester, what: type === 'reimburse' ? 'lengkapi baris item, upload nota per baris, lalu Kirim pengajuan' : 'lengkapi baris item lalu Kirim pengajuan' }
    case 'pending_ack': {
      if (snapshot?.acknowledgeDelegatedTo) {
        // F2e: PM / penanggung jawab is a requester/creator (or missing) → delegated step.
        return { who: ROLE_LABELS[ACK_DELEGATE_ROLE[snapshot.acknowledgeDelegatedTo]], what: 'Diketahui (dilimpahkan): tandai "Diketahui" (atau tolak)' }
      }
      if (isPmFlow(snapshot)) {
        // ADR 0021: the PM project of the request (cost-center manager without a project) approves first.
        const pm = user(snapshot?.acknowledgerUserId)
        return { who: pm ? `${pm} (PM project)` : 'PM project', what: 'setujui sebagai PM project atau tolak' }
      }
      const who =
        user(snapshot?.acknowledgerUserId) ??
        (snapshot?.acknowledgeBy === 'role' ? roleLabel(snapshot.acknowledgeRole) : 'Manajer project / pusat biaya')
      // ADR 0013: "Diketahui" is the Direktur's approval on new requests; legacy snapshots keep the old wording.
      return { who, what: isDecisionSnapshot(snapshot) ? 'setujui (Diketahui) atau tolak' : 'tandai "Diketahui" (atau tolak)' }
    }
    case 'pending_approval': {
      const step = snapshot?.steps.find((s) => s.level === (input.currentLevel ?? 1))
      const who = step ? (user(step.approverUserId) ?? roleLabel(step.approverRole)) : 'Approver'
      return { who: `${who} — approval level ${input.currentLevel ?? 1}`, what: 'setujui atau tolak' }
    }
    case 'approved':
      return type === 'advance' ? { who: 'Finance', what: 'catat transfer pengajuan baru (Antrian Transfer)' } : { who: 'Finance', what: 'verifikasi nota (valid / tolak)' }
    case 'receipt_revision':
      return { who: requester, what: 'perbaiki nota yang ditolak lalu Kirim ulang nota' }
    case 'receipts_verified':
      return { who: 'Finance', what: 'catat transfer reimburse (Antrian Transfer)' }
    case 'transferred':
      return type === 'advance'
        ? { who: requester, what: 'upload nota per baris, lalu tandai Nota lengkap' }
        : { who: `${requester} atau Finance`, what: 'konfirmasi selesai' }
    case 'receipts_complete':
      return { who: requester, what: 'isi uraian penggunaan dana lalu Kirim LPJ' }
    case 'lpj_submitted':
      return { who: 'Finance', what: 'periksa nota (valid / tolak), lalu verifikasi LPJ atau minta revisi' }
    case 'lpj_revision':
      return { who: requester, what: 'perbaiki sesuai catatan Finance lalu Kirim ulang LPJ' }
    case 'lpj_verified':
      return { who: 'Finance', what: 'selesaikan selisih (pengembalian / kekurangan)' }
    case 'rejected':
      return { who: requester, what: 'baca alasan penolakan; bila perlu Ajukan ulang (membuat draft baru)' }
    default:
      return null
  }
}
