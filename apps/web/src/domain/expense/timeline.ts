/**
 * Status timeline + "whose turn is it" for the web panel (US-05, F2c item 5). Pure module
 * (unit-tested): derived from the state machine vocabulary (architecture §5.1 Uang Muka, §5.2
 * Reimburse) and the approval snapshot stored at submit — never decides anything, the domain
 * service stays authoritative.
 */
import { ROLE_LABELS, type Role } from '@/access/roles'

import { isDecisionSnapshot } from './decision'
import { ACK_DELEGATE_ROLE, type ApprovalSnapshot } from './rules'
import { statusLabel, type RequestStatus, type RequestType } from './types'

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

export function timeline(type: RequestType, status: RequestStatus, opts: { skipAck?: boolean } = {}): TimelineStep[] {
  const path = STATUS_PATH[type].filter((s) => !(opts.skipAck && s === 'pending_ack'))
  const anchor = SIDE_ANCHOR[status] ?? status
  const idx = path.indexOf(anchor)
  const steps: TimelineStep[] = path.map((s, i) => ({
    status: s,
    label: statusLabel(type, s),
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
      return type === 'advance' ? { who: 'Finance', what: 'catat transfer uang muka (Antrian Transfer)' } : { who: 'Finance', what: 'verifikasi nota (valid / tolak)' }
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
