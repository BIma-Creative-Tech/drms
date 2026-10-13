/**
 * DRMS 10/10 9c (WA-06): readable approval timeline of a request — the web counterpart of the APK
 * `turn_timeline.dart` (buildTimeline + TimelineView): Diajukan → Persetujuan PM / Diketahui →
 * Persetujuan Direktur / Approval → Transfer Finance, per step the role, the planned approver, the
 * state (selesai / saat ini / menunggu / dilewati / ditolak), who acted, when and the note. Replaces
 * the raw JSON snapshot for everyone (raw JSON stays for Admin only, collapsed).
 * Pure module (unit-tested): derived from the snapshot stored at submit + the decision rows of the
 * CURRENT approval cycle + the transfers — it never decides anything, the domain service does.
 */
import { ROLE_LABELS, type Role } from '@/access/roles'

import { DIREKTUR_ROLE, isDecisionSnapshot, isNoApproval, NO_APPROVAL_NOTE, selfApprovalNote, SKIPPED_LABEL, type SkippedPosition } from './decision'
import type { AckBy, AckDelegate, AckMode } from './rules'
import type { RequestStatus, RequestType } from './types'

export type TimelineState = 'done' | 'current' | 'pending' | 'skipped' | 'rejected'

export const TIMELINE_STATE_LABELS: Record<TimelineState, string> = {
  done: 'Selesai',
  current: 'Saat ini', // DRMS 13/10 Persetujuan #9: no "Giliran" in the UI
  pending: 'Menunggu',
  skipped: 'Dilewati',
  rejected: 'Ditolak',
}

export type ApprovalTimelineStep = {
  key: string
  /** Position title ("Persetujuan PM", "Persetujuan Direktur", "Transfer Finance"). */
  title: string
  /** Role / position holder of the step ("PM project", "Direktur", "Finance", "Pemohon"). */
  role: string
  /** Planned approver (snapshot): a named person or the role pool; null when not known. */
  planned: string | null
  state: TimelineState
  actor: string | null
  /** Server timestamp (ISO) or business date (YYYY-MM-DD) of the action. */
  at: string | null
  note: string | null
}

export type TimelineSnapshot = {
  acknowledge: AckMode
  acknowledgeBy: AckBy
  acknowledgerUserId: number | null
  acknowledgeRole: Role | null
  acknowledgeDelegatedTo?: AckDelegate | null
  decisionRoles?: Role[]
  skipped?: SkippedPosition[]
  selfApproval?: string | null
  steps: Array<{ level: number; approverRole: Role | null; approverUserId: number | null }>
}

export type TimelineInput = {
  type: RequestType
  status: RequestStatus
  approvalCycle: number
  currentLevel: number | null
  submittedAt: string | null
  snapshot: TimelineSnapshot | null
  approvals: ReadonlyArray<{ cycle: number; position: string; level: number | null; actorName: string | null; onBehalf: boolean; decision: string; reason: string | null; decidedAt: string | null }>
  transfers: ReadonlyArray<{ docNo: string; kind: string; amount: number; transferDate: string; status: string }>
  /** "Pemohon" display text (requester names, comma separated). */
  requesters: string
  /** Creator display name ("dibuat oleh" note when it is not one of the requesters). */
  createdBy: string | null
  /** user id → display name (acknowledger / named approvers of the snapshot). */
  names: Readonly<Record<number, string>>
}

const WAITING: readonly RequestStatus[] = ['pending_ack', 'pending_approval']
const ENDED: readonly RequestStatus[] = ['rejected', 'cancelled']
const NOT_SUBMITTED: readonly RequestStatus[] = ['draft']

/** ADR 0021 PM project → Direktur snapshot (same rule as timeline.ts isPmFlow / APK pmApproval). */
function pmFlow(s: TimelineSnapshot | null): boolean {
  return !!s && s.acknowledgeBy === 'scope_manager' && isDecisionSnapshot(s)
}

const DELEGATE_LABELS: Record<AckDelegate, string> = { owner: ROLE_LABELS['pk-owner'], admin: ROLE_LABELS['pk-admin'] }

/** Title + role of the "Diketahui" position (APK acknowledgeTitle). */
export function ackPosition(s: TimelineSnapshot | null): { title: string; role: string } {
  if (pmFlow(s)) return { title: 'Persetujuan PM', role: 'PM project' }
  if (s && (isDecisionSnapshot(s) || s.acknowledgeRole === DIREKTUR_ROLE)) return { title: 'Persetujuan Direktur (Diketahui)', role: ROLE_LABELS[DIREKTUR_ROLE] }
  if (s?.acknowledgeBy === 'scope_manager') return { title: 'Diketahui (PM / penanggung jawab)', role: 'PM / penanggung jawab' }
  if (s?.acknowledgeBy === 'role' && s.acknowledgeRole) return { title: 'Diketahui Oleh', role: ROLE_LABELS[s.acknowledgeRole] }
  return { title: 'Diketahui Oleh', role: 'Penanggung jawab' }
}

/** Title + role of approval level `level` (APK approvalTitle). */
export function approvalPosition(s: TimelineSnapshot | null, level: number, multi: boolean): { title: string; role: string } {
  const role = s?.steps.find((x) => x.level === level)?.approverRole ?? null
  const suffix = multi ? ` (level ${level})` : ''
  if (role === DIREKTUR_ROLE) return { title: `Persetujuan Direktur${suffix}`, role: ROLE_LABELS[DIREKTUR_ROLE] }
  if (role === 'pk-finance' || (!role && s && isDecisionSnapshot(s))) return { title: `Approval Finance${suffix}`, role: ROLE_LABELS['pk-finance'] }
  return { title: multi ? `Approval level ${level}` : 'Approval', role: role ? ROLE_LABELS[role] : 'Approver' }
}

/** Readable text of the ADR 0021 / 0024 G1 exception (never the code `direktur_via_pm` / `direktur_no_approval`). */
export function g1ExceptionText(v: unknown): string | null {
  return selfApprovalNote(v)
}

/** ADR 0024 step of a request without approval (web = APK). */
export const NO_APPROVAL_STEP_TITLE = 'Persetujuan'
export const NO_APPROVAL_STEP_ROLE = 'Direktur (pemohon)'

export function buildApprovalTimeline(d: TimelineInput): ApprovalTimelineStep[] {
  const snap = d.snapshot
  const cycle = d.approvals.filter((a) => a.cycle === d.approvalCycle)
  const find = (position: string, level?: number) => cycle.find((a) => a.position === position && (level === undefined || (a.level ?? 0) === level))
  const actorOf = (a: { actorName: string | null; onBehalf: boolean }) => `${a.actorName ?? '—'}${a.onBehalf ? ' (diwakili)' : ''}`
  const name = (id: number | null | undefined) => (typeof id === 'number' ? (d.names[id] ?? `user #${id}`) : null)
  const submitted = !NOT_SUBMITTED.includes(d.status)
  const ended = ENDED.includes(d.status)
  const steps: ApprovalTimelineStep[] = []
  let rejectedSeen = false
  /** A step without a decision: current / waiting, or skipped once the flow ended (rejected/cancelled). */
  const open = (isCurrent: boolean): TimelineState => (isCurrent ? 'current' : ended || rejectedSeen ? 'skipped' : 'pending')

  // 1. Diajukan (requester submits; the "Dibuat Oleh" creator is named in the note when different)
  const diajukan = find('diajukan')
  const dibuat = find('dibuat')
  const creatorNote = d.createdBy && !d.requesters.split(', ').includes(d.createdBy) ? `dibuat oleh ${d.createdBy}` : null
  steps.push({
    key: 'diajukan',
    title: 'Diajukan',
    role: 'Pemohon',
    planned: d.requesters || null,
    state: submitted ? 'done' : 'current',
    actor: diajukan ? actorOf(diajukan) : submitted ? d.requesters || null : null,
    at: diajukan?.decidedAt ?? dibuat?.decidedAt ?? d.submittedAt,
    note: submitted ? creatorNote : ['belum diajukan', creatorNote].filter(Boolean).join(' · '),
  })

  // ADR 0024: a Direktur's own request without approval → one "Persetujuan" step, skipped by policy
  // (APK turn_timeline.dart builds the same step).
  if (isNoApproval(snap)) {
    steps.push({ key: 'no-approval', title: NO_APPROVAL_STEP_TITLE, role: NO_APPROVAL_STEP_ROLE, planned: null, state: 'skipped', actor: null, at: null, note: NO_APPROVAL_NOTE })
  }

  // 2. Persetujuan PM / Diketahui
  const ack = ackPosition(snap)
  const ackSkipped = snap?.skipped?.find((x) => x.position === 'diketahui')
  if (ackSkipped) {
    steps.push({ key: 'diketahui', ...ack, planned: name(ackSkipped.userId) ?? (ackSkipped.role ? ROLE_LABELS[ackSkipped.role] : null), state: 'skipped', actor: null, at: null, note: `${SKIPPED_LABEL} — ${ackSkipped.reason}` })
  } else if (!snap || snap.acknowledge !== 'none') {
    const a = find('diketahui')
    const delegated = snap?.acknowledgeDelegatedTo ? `dilimpahkan ke ${DELEGATE_LABELS[snap.acknowledgeDelegatedTo]}` : null
    const planned = snap ? (snap.acknowledgeDelegatedTo ? DELEGATE_LABELS[snap.acknowledgeDelegatedTo] : (name(snap.acknowledgerUserId) ?? (snap.acknowledgeRole ? ROLE_LABELS[snap.acknowledgeRole] : null))) : null
    if (a) {
      const rejected = a.decision === 'rejected'
      rejectedSeen ||= rejected
      steps.push({ key: 'diketahui', ...ack, planned, state: rejected ? 'rejected' : 'done', actor: actorOf(a), at: a.decidedAt, note: a.reason ?? delegated })
    } else if (snap || !submitted) {
      const optionalPassed = snap?.acknowledge === 'optional' && submitted && !WAITING.includes(d.status)
      // APK: current only while "Menunggu persetujuan PM/Diketahui"; an optional one stays open during the approval.
      const state: TimelineState = optionalPassed || (submitted && !WAITING.includes(d.status)) ? 'skipped' : !submitted ? 'pending' : open(d.status === 'pending_ack')
      steps.push({ key: 'diketahui', ...ack, planned, state, actor: null, at: null, note: optionalPassed ? 'opsional — tidak diberikan' : delegated })
    }
  }

  // 3. Approval levels (ADR 0021: Persetujuan Direktur; ADR 0013: Finance)
  const levels = snap?.steps.map((s) => s.level).sort((a, b) => a - b) ?? []
  const multi = levels.length > 1
  for (const level of levels) {
    const pos = approvalPosition(snap, level, multi)
    const step = snap!.steps.find((s) => s.level === level)!
    const planned = name(step.approverUserId) ?? (step.approverRole ? ROLE_LABELS[step.approverRole] : null)
    const a = find('approval', level)
    if (a) {
      const rejected = a.decision === 'rejected'
      rejectedSeen ||= rejected
      steps.push({ key: `approval-${level}`, ...pos, planned, state: rejected ? 'rejected' : 'done', actor: actorOf(a), at: a.decidedAt, note: a.reason })
    } else {
      const isCurrent = d.status === 'pending_approval' && (d.currentLevel ?? levels[0]) === level
      steps.push({ key: `approval-${level}`, ...pos, planned, state: submitted ? open(isCurrent) : 'pending', actor: null, at: null, note: null })
    }
  }
  if (!snap && !submitted) {
    // Draft: the rule is chosen at submit — show the usual next positions without names.
    steps.push({ key: 'approval-1', title: 'Persetujuan Direktur', role: ROLE_LABELS[DIREKTUR_ROLE], planned: null, state: 'pending', actor: null, at: null, note: 'aturan approval ditetapkan saat diajukan' })
  }
  for (const s of snap?.skipped ?? []) {
    if (s.position !== 'approval') continue
    const pos = approvalPosition(snap, s.level, false)
    steps.push({ key: `skipped-${s.level}`, title: s.role === DIREKTUR_ROLE ? 'Persetujuan Direktur' : s.role === 'pk-finance' ? 'Approval Finance' : pos.title, role: s.role ? ROLE_LABELS[s.role] : pos.role, planned: name(s.userId) ?? (s.role ? ROLE_LABELS[s.role] : null), state: 'skipped', actor: null, at: null, note: `${SKIPPED_LABEL} — ${s.reason}` })
  }

  // 4. Transfer Finance (posted Pengajuan Baru / Reimburse transfers; voided ones are listed in the note)
  const posted = d.transfers.filter((t) => (t.kind === 'advance' || t.kind === 'reimburse') && t.status === 'posted')
  const voided = d.transfers.filter((t) => (t.kind === 'advance' || t.kind === 'reimburse') && t.status !== 'posted')
  const queue = (d.type === 'advance' && d.status === 'approved') || (d.type === 'reimburse' && d.status === 'receipts_verified')
  const voidNote = voided.length > 0 ? `void: ${voided.map((t) => t.docNo).join(', ')}` : null
  if (posted.length > 0) {
    steps.push({
      key: 'transfer',
      title: 'Transfer Finance',
      role: ROLE_LABELS['pk-finance'],
      planned: ROLE_LABELS['pk-finance'],
      state: 'done',
      actor: null,
      at: posted[posted.length - 1]!.transferDate,
      note: [posted.map((t) => t.docNo).join(', '), voidNote].filter(Boolean).join(' · '),
    })
  } else {
    const note = d.type === 'reimburse' && (d.status === 'approved' || d.status === 'receipt_revision') ? 'setelah nota diverifikasi Finance' : voidNote
    steps.push({ key: 'transfer', title: 'Transfer Finance', role: ROLE_LABELS['pk-finance'], planned: ROLE_LABELS['pk-finance'], state: submitted ? open(queue) : 'pending', actor: null, at: null, note })
  }
  return steps
}
