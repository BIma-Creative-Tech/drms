/**
 * DRMS 13/10 Persetujuan #3: ONE vertical stepper of an expense request — the overall status flow (the old
 * status chips of the workflow panel) and the approval flow (approval-timeline.ts) merged:
 * Diajukan → the positions of the approval snapshot (PM, Direktur, Finance level …, skipped ones included) →
 * [Reimburse: Verifikasi nota] → Transfer → [Pengajuan Baru: Nota & LPJ → Persetujuan kekurangan → Penyelesaian
 * LPJ] → Selesai / Ditolak / Dibatalkan. Per step: who acted, when, the decision and the note; the step that waits
 * now is `current` ("Tahapan saat ini"), a step sent back to the requester is `revision` (Revisi Nota, LPJ Revisi,
 * a withdrawn request back in Draft). ADR 0027: a vendor payment ("Pembayaran vendor") has no LPJ steps — Transfer → Selesai.
 * Pure module (unit-tested, API-reusable — the APK detail can render the same list later): derived from the
 * request status, the approval snapshot stored at submit, the decision rows of the CURRENT cycle, the transfers
 * and the LPJ — no new columns, it never decides anything (the domain service does).
 */
import { buildApprovalTimeline, type ApprovalTimelineStep, type TimelineInput, type TimelineState } from './approval-timeline'
import { payeeOf, type PayeeType, type RequestStatus } from './types'

export type StepperState = TimelineState | 'revision'

export const STEPPER_STATE_LABELS: Record<StepperState, string> = {
  done: 'Selesai',
  current: 'Tahapan saat ini',
  revision: 'Dikembalikan',
  pending: 'Menunggu',
  skipped: 'Dilewati',
  rejected: 'Ditolak',
}

export type StepperStep = Omit<ApprovalTimelineStep, 'state'> & { state: StepperState }

/** LPJ of a Pengajuan Baru as far as the stepper needs it (detail DTO `settlement`). */
export type StepperSettlement = {
  docNo: string | null
  status: string
  statusLabel: string
  settlementType: string | null
  submittedAt: string | null
  verifiedAt: string | null
  settledAt: string | null
  financeNotes?: string | null
  /** ADR 0019 shortfall re-approval (office roles only; null otherwise / none asked). */
  shortfallApproval?: {
    status: string | null
    statusLabel: string | null
    rejectReason?: string | null
    decisions?: ReadonlyArray<{ actorName: string | null; decision: string; reason: string | null; decidedAt: string | null }>
  } | null
}

export type StepperInput = TimelineInput & {
  /** ADR 0027: `vendor` = vendor payment (no "Nota & LPJ" / "Penyelesaian LPJ"); absent = karyawan. */
  payeeType?: PayeeType | null
  settlement?: StepperSettlement | null
  rejectReason?: string | null
  cancelReason?: string | null
}

export type RequestStepper = {
  steps: StepperStep[]
  /** Key of the step that waits now (current / revision); null on a final status. */
  currentKey: string | null
  /** Re-approval after a changed total (approvalCycle > 1, receipts resubmit). */
  cycleNote: string | null
}

const ENDED: readonly RequestStatus[] = ['rejected', 'cancelled']
const BEFORE_APPROVAL: readonly RequestStatus[] = ['draft', 'pending_ack', 'pending_approval']
const LPJ_RUNNING: readonly RequestStatus[] = ['transferred', 'receipts_complete', 'lpj_submitted', 'lpj_revision']

/** Note of the "Diajukan" step of a withdrawn request (Draft again after a submit). */
export const WITHDRAWN_NOTE = 'ditarik kembali ke Draft — perbaiki lalu Kirim pengajuan lagi'

/** ADR 0027: note of the final step of a vendor payment. */
export const VENDOR_END_NOTE = 'pembayaran vendor selesai saat ditransfer — invoice = bukti, tanpa LPJ'

export const isCurrentStep = (s: Pick<StepperStep, 'state'>) => s.state === 'current' || s.state === 'revision'

export function buildRequestStepper(d: StepperInput): RequestStepper {
  const ended = ENDED.includes(d.status)
  const rejectedSeen = () => steps.some((s) => s.state === 'rejected')
  /** A step that is not reached yet: waiting, or skipped once the flow ended (rejected / cancelled). */
  const later = (): StepperState => (ended || rejectedSeen() ? 'skipped' : 'pending')
  const steps: StepperStep[] = buildApprovalTimeline(d).map((s) => ({ ...s }))

  // Withdrawn (US-04): back in Draft after a submit → the requester has it again ("Dikembalikan")
  const diajukan = steps.find((s) => s.key === 'diajukan')
  if (diajukan && d.status === 'draft' && d.approvalCycle > 0) {
    diajukan.state = 'revision'
    diajukan.note = diajukan.note?.replace(/^belum diajukan/, WITHDRAWN_NOTE) ?? WITHDRAWN_NOTE
  }

  // Reimburse: Finance verifies the receipts BEFORE the transfer (architecture §5.2)
  if (d.type === 'reimburse') {
    const state: StepperState =
      d.status === 'approved' ? 'current' : d.status === 'receipt_revision' ? 'revision' : BEFORE_APPROVAL.includes(d.status) || ended ? later() : 'done'
    const note = d.status === 'receipt_revision' ? 'Revisi Nota — pemohon memperbaiki nota yang ditolak lalu mengirim ulang' : d.status === 'approved' ? 'Finance memeriksa nota (valid / tolak)' : null
    insertBefore(steps, 'transfer', { key: 'verify-receipts', title: 'Verifikasi nota', role: 'Finance', planned: 'Finance', state, actor: null, at: null, note })
  }

  const vendor = payeeOf(d.payeeType) === 'vendor'
  // Pengajuan Baru: receipts + LPJ by the requester, verification + settlement by Finance (§5.1, ADR 0019).
  // ADR 0027: not for a vendor payment — the vendor's invoice is the proof, the transfer completes it.
  if (d.type === 'advance' && !vendor) {
    const lpj = d.settlement ?? null
    const lpjState: StepperState =
      d.status === 'lpj_revision' ? 'revision' : LPJ_RUNNING.includes(d.status) ? 'current' : d.status === 'lpj_verified' || d.status === 'completed' ? 'done' : later()
    const lpjNote: Partial<Record<RequestStatus, string>> = {
      transferred: 'pemohon mengunggah nota per baris lalu menandai Nota lengkap',
      receipts_complete: 'pemohon mengisi uraian penggunaan dana lalu Kirim LPJ',
      lpj_submitted: 'Finance memeriksa nota dan LPJ',
      lpj_revision: `LPJ dikembalikan untuk revisi${lpj?.financeNotes ? `: ${lpj.financeNotes}` : ''}`,
    }
    steps.push({
      key: 'lpj',
      title: 'Nota & LPJ',
      role: 'Pemohon → Finance',
      planned: null,
      state: lpjState,
      actor: null,
      at: lpjState === 'done' ? (lpj?.verifiedAt ?? null) : (lpj?.submittedAt ?? null),
      note: [lpj?.docNo ?? null, lpjNote[d.status] ?? null].filter(Boolean).join(' · ') || null,
    })
    const sa = lpj?.shortfallApproval
    if (sa?.status) {
      const last = [...(sa.decisions ?? [])].reverse().find((x) => x.decision === 'approved' || x.decision === 'rejected' || x.decision === 'acknowledged')
      const state: StepperState = sa.status === 'approved' ? 'done' : sa.status === 'rejected' ? 'rejected' : d.status === 'lpj_verified' ? 'current' : later()
      steps.push({
        key: 'shortfall',
        title: 'Persetujuan kekurangan',
        // ADR 0019 / 0026: the deciders of the request's approval rule (PM project → Direktur → Owner; legacy Direktur → Finance)
        role: 'Sesuai aturan approval',
        planned: null,
        state,
        actor: state === 'done' || state === 'rejected' ? (last?.actorName ?? null) : null,
        at: state === 'done' || state === 'rejected' ? (last?.decidedAt ?? null) : null,
        note: [sa.statusLabel, sa.status === 'rejected' ? (sa.rejectReason ?? last?.reason ?? null) : null].filter(Boolean).join(' — ') || null,
      })
    }
    const settleWaits = d.status === 'lpj_verified' && sa?.status !== 'pending_ack' && sa?.status !== 'pending_approval'
    steps.push({
      key: 'settlement',
      title: 'Penyelesaian LPJ',
      role: 'Finance',
      planned: 'Finance',
      state: d.status === 'completed' ? 'done' : settleWaits ? 'current' : d.status === 'lpj_verified' ? 'pending' : later(),
      actor: null,
      at: d.status === 'completed' ? (lpj?.settledAt ?? null) : null,
      note: settleNote(d.status, lpj),
    })
  }

  // Final step: Selesai — or the end of a stopped flow, named as such
  if (d.status === 'rejected') {
    steps.push({ key: 'end', title: 'Ditolak', role: 'Pengajuan', planned: null, state: 'rejected', actor: null, at: null, note: d.rejectReason ? `Alasan: ${d.rejectReason}` : null })
  } else if (d.status === 'cancelled') {
    steps.push({ key: 'end', title: 'Dibatalkan', role: 'Pengajuan', planned: null, state: 'rejected', actor: null, at: null, note: d.cancelReason ? `Alasan: ${d.cancelReason}` : null })
  } else {
    const confirm = d.type === 'reimburse' && d.status === 'transferred'
    steps.push({
      key: 'end',
      title: 'Selesai',
      role: d.type === 'reimburse' ? 'Pemohon / Finance' : 'Pengajuan',
      planned: null,
      state: d.status === 'completed' ? 'done' : confirm ? 'current' : 'pending',
      actor: null,
      at: null,
      note: confirm ? 'pemohon (atau Finance) mengonfirmasi dana sudah diterima' : vendor ? VENDOR_END_NOTE : null,
    })
  }

  const current = steps.find(isCurrentStep) ?? null
  return {
    steps,
    currentKey: current?.key ?? null,
    // earlier cycles (withdrawn and sent again / receipts changed the total) stay in the change log (Persetujuan #4)
    cycleNote: d.approvalCycle > 1 && d.status !== 'draft' ? `Siklus persetujuan ke-${d.approvalCycle} — keputusan siklus sebelumnya ada di Log perubahan` : null,
  }
}

function settleNote(status: RequestStatus, lpj: StepperSettlement | null): string | null {
  if (status === 'completed' && lpj?.settlementType === 'refund') return 'sisa dana dikembalikan (kas masuk)'
  if (status === 'completed' && lpj?.settlementType === 'shortfall') return 'kekurangan dibayar (transfer)'
  if (status === 'completed' && lpj?.settlementType === 'none') return 'tanpa selisih'
  if (status === 'lpj_verified') return 'Finance menyelesaikan selisih (pengembalian / kekurangan)'
  return null
}

function insertBefore(steps: StepperStep[], key: string, step: StepperStep): void {
  const i = steps.findIndex((s) => s.key === key)
  if (i < 0) steps.push(step)
  else steps.splice(i, 0, step)
}
