/**
 * d1510 — owner decision 2026-10-15, follow-up of migration 20261015_200000 ("Pastikan ini berlaku dengan transaksi yg
 * existing; jika masih berjalan lanjutkan penyesuaian approval flow"): Finance never approves — the flow ends at the
 * Owner, then Finance only transfers. In-flight requests whose snapshot still carries an UNDECIDED Finance approval
 * level (any rule, `pending_ack` / `pending_approval`) are trimmed:
 *  - case 1 — waiting before the Finance level: the undecided Finance level(s) are dropped (`steps`, `decisionRoles`);
 *    status, current level and every decision stay;
 *  - case 2 — waiting at a Finance level and the snapshot has no Owner level: that level becomes the Owner's (same
 *    level number) and the Owners of the PT are notified like the normal "next level" notification;
 *  - case 3 — waiting at a Finance level after the Owner approved: nothing undecided is left → "Disetujui" through the
 *    finalisation of the last approval (domain/expense/receipts.ts finalizeApproved, fund check ADR 0029 first);
 *  - case 4 — an old-flow snapshot without the PM project step: never sent back to the PM; the audit / note say
 *    "PM project: tidak berlaku — alur lama — Direktur sudah memutuskan".
 * Pure part (unit-tested). Database side: `./trim-db.ts` (migration 20261015_210000_d1510_approval_inflight_trim,
 * dry-run in `./cli.ts`), the Payload finalisation: `./trim-finalize.ts`.
 */
import { ROLE_LABELS, type Role } from '@/access/roles'
import { OWNER_ROLE } from '@/domain/expense/decision'
import type { ApprovalSnapshot } from '@/domain/expense/rules'

import { canonicalJson, flowText, MIGRATION as REROUTE_MIGRATION, REROUTE_FIELD } from './plan'

export const TRIM_MIGRATION = '20261015_210000_d1510_approval_inflight_trim'

/** Same "Log perubahan" field as the re-route ("Alur persetujuan: lama → baru"). */
export const TRIM_FIELD = REROUTE_FIELD

export const FINANCE_ROLE: Role = 'pk-finance'

/** Shown in "Log perubahan" of every trimmed request (audit reason) and next to the stepper. */
export const TRIM_NOTE = 'Alur persetujuan diperbarui (keputusan owner 2026-10-15): Finance tidak lagi menyetujui — hanya transfer'
/** Case 4: an old-flow request the Direktur already decided is never sent back to the PM project. */
export const PM_LEGACY_DECIDED = 'PM project: tidak berlaku — alur lama — Direktur sudah memutuskan'
/** An old-flow request still waiting for the Direktur that 20261015_200000 did not re-route (other rule / kept). */
export const PM_LEGACY_KEPT = `PM project: tidak ditambahkan — alur lama dipertahankan (tidak dialihkan migrasi ${REROUTE_MIGRATION})`
export const TRIM_REASON = `${TRIM_NOTE}: alur berakhir di Owner, lalu Finance hanya transfer (migrasi ${TRIM_MIGRATION})`
export const TRIM_REASON_FINAL = `${TRIM_NOTE}: Owner sudah menyetujui — "Disetujui", masuk antrian transfer Finance (migrasi ${TRIM_MIGRATION})`
export const TRIM_REASON_REVERT = `rollback migrasi ${TRIM_MIGRATION}: level Finance dikembalikan ke alur pengajuan`

/** The statuses that wait for a decision (state.ts: acknowledge / approve / reject). */
export const WAITING_STATUSES = ['pending_ack', 'pending_approval'] as const
export type WaitingStatus = (typeof WAITING_STATUSES)[number]
export const isWaiting = (s: string): s is WaitingStatus => (WAITING_STATUSES as readonly string[]).includes(s)

/** A decision row ("Diketahui" / approval) of the CURRENT approval cycle. */
export type TrimDecision = { position: 'diketahui' | 'approval'; level: number; decision: string; actor: number | null }

/** An in-flight request whose snapshot names a Finance approval level, as read from the database. */
export type TrimCandidate = {
  id: number
  companyId: number
  docNo: string | null
  title: string
  status: string
  cycle: number
  currentLevel: number | null
  ruleId: number | null
  ruleName: string | null
  snapshot: ApprovalSnapshot | null
  g1Exception: string | null
  decisions: TrimDecision[]
  /** Requesters' accounts + creator (G1: never decide). */
  excluded: number[]
  /** Active Owner (`pk-principal`) holders of the PT. */
  owners: number[]
}

/**
 * trim = Finance level(s) dropped, the waiting position unchanged (case 1 / 4); owner = the waiting Finance level
 * became the Owner's (case 2) or the next level after a dropped one is waiting — its holders are notified; final =
 * nothing undecided left → "Disetujui" (case 3); keep = left as it is (reason).
 */
export type TrimKind = 'trim' | 'owner' | 'final' | 'keep'

export type TrimPlan = {
  id: number
  companyId: number
  docNo: string | null
  title: string
  status: string
  cycle: number
  ruleId: number | null
  ruleName: string | null
  kind: TrimKind
  reason: string | null
  oldSnapshot: ApprovalSnapshot
  oldLevel: number | null
  oldFlow: string
  newSnapshot: ApprovalSnapshot | null
  newStatus: 'pending_ack' | 'pending_approval' | 'approved' | null
  /** current_level written by the trim (case 3: the Owner's level = the last level, as after a normal final approval). */
  newLevel: number | null
  newFlow: string | null
  /** Old level numbers of the Finance levels dropped / the one replaced by the Owner. */
  dropped: number[]
  replaced: number | null
  /** What waits after the trim ("Persetujuan Owner", "Disetujui — antrian transfer Finance", …). */
  waiting: string | null
  /** Case 4 note (null = the snapshot has a PM project step or no "Diketahui" at all). */
  pm: string | null
  /** Decision rows of the current cycle at plan time (down compares). */
  decisions: number
}

const label = (r: string | null | undefined) => (r && Object.hasOwn(ROLE_LABELS, r) ? ROLE_LABELS[r as Role] : (r ?? '?'))

type Step = ApprovalSnapshot['steps'][number]
const byLevel = (a: Step, b: Step) => a.level - b.level

/** Level numbers of the Finance approval levels not decided yet (all levels while "Diketahui" waits). */
export function undecidedFinanceLevels(s: Pick<ApprovalSnapshot, 'steps'>, status: string, currentLevel: number | null): number[] {
  const from = status === 'pending_ack' ? 1 : Math.max(currentLevel ?? 1, 1)
  return s.steps
    .filter((x) => x.level >= from && x.approverRole === FINANCE_ROLE)
    .map((x) => x.level)
    .sort((a, b) => a - b)
}

/** "Persetujuan Owner" / "Diketahui Direktur" / "Persetujuan PM (Nama)" … of the position waiting after the trim. */
export function waitingText(s: ApprovalSnapshot, status: string, level: number | null, names: ReadonlyMap<number, string> = new Map()): string {
  if (status === 'approved') return 'Disetujui — antrian transfer Finance'
  const who = (id: number) => names.get(id) ?? `user #${id}`
  if (status === 'pending_ack') {
    if (s.acknowledgeBy === 'scope_manager') return `Persetujuan PM${s.acknowledgerUserId !== null ? ` (${who(s.acknowledgerUserId)})` : ''}`
    if (s.acknowledgeBy === 'user' && s.acknowledgerUserId !== null) return `Diketahui ${who(s.acknowledgerUserId)}`
    return `Diketahui ${label(s.acknowledgeRole)}`
  }
  const step = s.steps.find((x) => x.level === (level ?? 1))
  if (!step) return 'tanpa level'
  if (step.approverUserId !== null) return `Approval level ${step.level} (${who(step.approverUserId)})`
  return step.approverRole === 'pk-owner' ? 'Persetujuan Direktur' : step.approverRole === OWNER_ROLE ? 'Persetujuan Owner' : `Approval ${label(step.approverRole)}`
}

/** Has the Direktur (role `pk-owner`) decided a position of this cycle ("Diketahui" by role or a Direktur level)? */
function direkturDecided(s: ApprovalSnapshot, decisions: readonly TrimDecision[]): boolean {
  return decisions.some(
    (d) =>
      d.decision !== 'rejected' &&
      ((d.position === 'diketahui' && s.acknowledgeBy === 'role' && s.acknowledgeRole === 'pk-owner') ||
        (d.position === 'approval' && s.steps.find((x) => x.level === d.level)?.approverRole === 'pk-owner')),
  )
}

/** Case 4 note: the snapshot has a "Diketahui" that is not the PM project's (old flow). */
export function pmNoteOf(s: ApprovalSnapshot, decisions: readonly TrimDecision[]): string | null {
  if (s.acknowledge === 'none' || s.acknowledgeBy === 'scope_manager') return null
  return direkturDecided(s, decisions) ? PM_LEGACY_DECIDED : PM_LEGACY_KEPT
}

/**
 * What happens to one request (null = no undecided Finance level → not this migration's business). Never touches a
 * G1 exception. Level numbers stay contiguous (levels after a dropped one move up); decided levels keep their number.
 */
export function planTrim(c: TrimCandidate, names: ReadonlyMap<number, string> = new Map()): TrimPlan | null {
  const s = c.snapshot
  if (!s || !Array.isArray(s.steps) || !isWaiting(c.status)) return null
  const fin = undecidedFinanceLevels(s, c.status, c.currentLevel)
  if (fin.length === 0) return null
  const oldFlow = flowText(s, names)
  const decided = c.decisions.filter((d) => d.decision !== 'rejected')
  const base: TrimPlan = {
    id: c.id,
    companyId: c.companyId,
    docNo: c.docNo,
    title: c.title,
    status: c.status,
    cycle: c.cycle,
    ruleId: c.ruleId,
    ruleName: s.ruleName ?? c.ruleName,
    kind: 'keep',
    reason: null,
    oldSnapshot: s,
    oldLevel: c.currentLevel,
    oldFlow,
    newSnapshot: null,
    newStatus: null,
    newLevel: null,
    newFlow: null,
    dropped: [],
    replaced: null,
    waiting: null,
    pm: null,
    decisions: c.decisions.length,
  }
  const keep = (reason: string): TrimPlan => ({ ...base, reason })
  if (c.g1Exception || s.selfApproval) return keep(`pengecualian G1 ${c.g1Exception ?? String(s.selfApproval)} — alur dipertahankan`)
  if (c.decisions.some((d) => d.decision === 'rejected')) return keep('ada penolakan pada siklus ini')
  const sorted = [...s.steps].sort(byLevel)
  if (!sorted.every((x, i) => x.level === i + 1)) return keep('level snapshot tidak berurutan — periksa manual')

  const hasOwner = sorted.some((x) => x.approverRole === OWNER_ROLE)
  let replaced: number | null = null
  const dropped: number[] = []
  const kept: Step[] = []
  for (const x of sorted) {
    if (!fin.includes(x.level)) kept.push(x)
    else if (!hasOwner && replaced === null) {
      replaced = x.level
      kept.push({ level: x.level, approverRole: OWNER_ROLE, approverUserId: null })
    } else dropped.push(x.level)
  }
  const steps = kept.map((x, i) => ({ ...x, level: i + 1 }))
  const stillFinance = steps.some((x) => x.approverRole === FINANCE_ROLE) || (s.acknowledge !== 'none' && s.acknowledgeBy === 'role' && s.acknowledgeRole === FINANCE_ROLE)
  let decisionRoles = s.decisionRoles
  if (decisionRoles) {
    decisionRoles = decisionRoles.filter((r) => r !== FINANCE_ROLE || stillFinance)
    if (replaced !== null && !decisionRoles.includes(OWNER_ROLE)) decisionRoles = [...decisionRoles, OWNER_ROLE]
  }
  const newSnapshot: ApprovalSnapshot = { ...s, steps, ...(decisionRoles ? { decisionRoles } : {}) }

  if (replaced !== null) {
    // the new Owner level must be decidable (G1: not a requester / creator, one position per person in a cycle)
    if (c.owners.length === 0) return keep('tidak ada Owner aktif di PT — level Finance tidak dapat diganti Owner')
    const deciders = new Set(decided.map((d) => d.actor).filter((x): x is number => x !== null))
    if (!c.owners.some((u) => !c.excluded.includes(u) && !deciders.has(u))) return keep('Owner PT adalah pemohon/pembuat atau sudah memutuskan posisi lain (G1) — periksa manual')
  }

  const last = steps.length > 0 ? steps[steps.length - 1]!.level : 0
  const pm = pmNoteOf(s, decided)
  const out = (kind: TrimKind, newStatus: TrimPlan['newStatus'], newLevel: number | null): TrimPlan => ({
    ...base,
    kind,
    newSnapshot,
    newStatus,
    newLevel,
    newFlow: flowText(newSnapshot, names),
    dropped,
    replaced,
    waiting: waitingText(newSnapshot, newStatus ?? c.status, newLevel, names),
    pm,
  })
  if (c.status === 'pending_ack') return out('trim', 'pending_ack', c.currentLevel ?? 0)
  const level = Math.max(c.currentLevel ?? 1, 1)
  if (level <= last) return out(fin.includes(level) ? 'owner' : 'trim', 'pending_approval', level)
  // nothing undecided left: the last remaining level (the Owner's) must have approved in this cycle
  const final = decided.some((d) => d.position === 'approval' && d.level === last && d.decision === 'approved')
  if (last === 0 || !final) return keep('tidak ada persetujuan level terakhir pada siklus ini — periksa manual')
  return out('final', 'approved', last)
}

/** The value of the audit rows of a trimmed request: readable "alur" first, then what `down` needs. */
export function trimValue(p: TrimPlan, side: 'old' | 'new', extra: Record<string, unknown> = {}): Record<string, unknown> {
  if (side === 'old') return { alur: p.oldFlow, aturan: p.ruleName, ruleId: p.ruleId, status: p.status, currentLevel: p.oldLevel, cycle: p.cycle, snapshot: p.oldSnapshot }
  return {
    alur: p.newFlow,
    aturan: p.ruleName,
    ruleId: p.ruleId,
    status: p.newStatus,
    currentLevel: p.newLevel,
    cycle: p.cycle,
    snapshot: p.newSnapshot,
    migration: TRIM_MIGRATION,
    kind: 'trim',
    kasus: p.kind,
    menunggu: p.waiting,
    ...(p.pm ? { pm: p.pm } : {}),
    decisions: p.decisions,
    ...extra,
  }
}

/**
 * Stepper note of a request trimmed by this migration while it still carries that snapshot (history rows oldest first,
 * values unwrapped — domain/history.ts). null otherwise.
 */
export function trimNoteOf(history: ReadonlyArray<{ action: string; field: string | null; newValue: unknown }>, snapshot: unknown): string | null {
  const last = [...history].reverse().find((h) => h.action === 'update' && h.field === TRIM_FIELD && (h.newValue as { migration?: unknown } | null)?.migration === TRIM_MIGRATION)
  const v = last?.newValue as { kind?: unknown; snapshot?: unknown; pm?: unknown } | undefined
  if (v?.kind !== 'trim' || canonicalJson(v.snapshot) !== canonicalJson(snapshot)) return null
  return typeof v.pm === 'string' && v.pm ? `${TRIM_NOTE} · ${v.pm}` : TRIM_NOTE
}

export type TrimResult = { plans: TrimPlan[]; skippedByReroute: number[] }

const TAG: Record<TrimKind, string> = { trim: 'POTONG', owner: 'OWNER', final: 'SETUJU', keep: 'TETAP' }

/** Human summary (dry-run / migrate log / runbook). `codes` = PT id → short code. */
export function trimSummary(r: TrimResult, codes: ReadonlyMap<number, string> = new Map()): string {
  const pt = (id: number) => codes.get(id) ?? `#${id}`
  const count = (k: TrimKind) => r.plans.filter((p) => p.kind === k).length
  const lines = [
    `Pengajuan berjalan dengan level Finance belum diputuskan: ${r.plans.length} — dipotong ${count('trim')}, Finance → Owner ${count('owner')}, langsung Disetujui ${count('final')}, tetap ${count('keep')}`,
  ]
  if (r.skippedByReroute.length > 0) lines.push(`  (${r.skippedByReroute.length} pengajuan lain dialihkan dulu oleh ${REROUTE_MIGRATION} — alur barunya tanpa Finance)`)
  for (const p of r.plans) {
    const head = `  [${TAG[p.kind]}] ${pt(p.companyId)} ${p.docNo ?? `#${p.id}`} (${p.status}${p.status === 'pending_approval' ? ` L${p.oldLevel ?? 1}` : ''}) ${p.oldFlow}`
    if (p.kind === 'keep') lines.push(`${head}: ${p.reason}`)
    else lines.push(`${head}  ⇒  ${p.newFlow} — status ${p.newStatus}, menunggu: ${p.waiting}${p.pm ? ` · ${p.pm}` : ''}`)
  }
  return lines.join('\n')
}
