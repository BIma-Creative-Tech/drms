/**
 * d1510 — owner decision 2026-10-15: "Default" rules of every PT → PM project → Direktur → Owner (Finance only
 * transfers), and in-flight requests the Direktur has not decided yet re-routed to what a submit TODAY produces.
 * Pure part (unit-tested): which rule shapes are aligned, the target shape, the request candidates, texts. The
 * database side is `./db.ts` (migration 20261015_200000_d1510_approval_reroute + read-only dry-run `./cli.ts`), the
 * snapshot itself comes from `@/domain/expense/snapshot-plan` (the code a submit runs).
 */
import { ROLE_LABELS, type Role } from '@/access/roles'
import { isNoApproval } from '@/domain/expense/decision'
import type { ApprovalSnapshot, RuleInput } from '@/domain/expense/rules'
import { resolveSelectAndSnapshot, SnapshotRefused, type SnapshotRequest, type SnapshotSource } from '@/domain/expense/snapshot-plan'

export const MIGRATION = '20261015_200000_d1510_approval_reroute'

/** Audit field of the re-route rows of a request ("Log perubahan": "Alur persetujuan: lama → baru"). */
export const REROUTE_FIELD = 'approvalFlow'

/** Shown in "Log perubahan" of every re-routed request (audit reason) and next to the stepper. */
export const REROUTE_NOTE = 'Alur persetujuan diperbarui ke aturan terbaru (keputusan owner 2026-10-15)'
export const REASON_REQUEST = `${REROUTE_NOTE}: PM project → Direktur → Owner, Finance hanya transfer — pengajuan belum diputuskan Direktur (migrasi ${MIGRATION})`
export const REASON_RULE = `keputusan owner 2026-10-15: aturan default diselaraskan ke PM project → Direktur → Owner, Finance hanya transfer (migrasi ${MIGRATION})`
export const REASON_REVERT = `rollback migrasi ${MIGRATION}: alur persetujuan dikembalikan ke aturan sebelum keputusan owner 2026-10-15`

/**
 * The rules aligned (by their name as seeded / migrated since ADR 0013 → the name of the current seed, `seed/data.ts`
 * DEFAULT_APPROVAL_RULES). Frozen copy (a unit test keeps the target names equal to the seed).
 */
export const RULE_RENAMES: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'Default — Direktur lalu Finance (semua nominal)', to: 'Default — PM project lalu Direktur (semua nominal)' },
  { from: 'Contoh — di atas Rp 10 juta: Direktur lalu Finance (Q-31, nonaktif)', to: 'Contoh — di atas Rp 10 juta: PM project lalu Direktur (Q-31, nonaktif)' },
]

/** Target levels (ADR 0021 + ADR 0026): Direktur, then Owner; "Diketahui" = the PM project. */
export const TARGET_STEP_ROLES: readonly Role[] = ['pk-owner', 'pk-principal']

/** A rule as read from the database (any doc type, active or not). */
export type RuleRow = {
  id: number
  companyId: number | null
  name: string
  active: boolean
  docType: string
  acknowledge: string | null
  acknowledgeBy: string | null
  acknowledgeRole: string | null
  acknowledgeUser: number | null
  requesterRoles: string[]
  payeeType: string | null
  steps: Array<{ level: number; role: string | null; user: number | null }>
}

/**
 * The two shapes the owner decision replaces: ADR 0013 ("Diketahui" Direktur → Finance level) and the same after
 * migration 20261013_630200 (ADR 0026: Direktur → Owner level → Finance level). Anything else = an Admin changed it.
 */
export type LegacyShape = 'adr0013' | 'adr0013_owner'

const stepRoles = (r: Pick<RuleRow, 'steps'>) => [...r.steps].sort((a, b) => a.level - b.level).map((s) => s.role)
const sameRoles = (a: ReadonlyArray<string | null>, b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])
const noCondition = (r: Pick<RuleRow, 'requesterRoles' | 'payeeType'>) => r.requesterRoles.length === 0 && (r.payeeType ?? 'any') === 'any'
const levelsOk = (r: Pick<RuleRow, 'steps'>) => {
  const levels = r.steps.map((s) => s.level).sort((a, b) => a - b)
  return levels.every((l, i) => l === i + 1) && r.steps.every((s) => s.user === null)
}

/** Exactly one of the two replaced shapes (no named user, no "Peran pemohon" / payee condition), else null. */
export function legacyShapeOf(r: RuleRow): LegacyShape | null {
  if (r.docType !== 'expense_request' || r.acknowledge !== 'required' || r.acknowledgeBy !== 'role' || r.acknowledgeRole !== 'pk-owner' || r.acknowledgeUser !== null) return null
  if (!noCondition(r) || !levelsOk(r)) return null
  const roles = stepRoles(r)
  if (sameRoles(roles, ['pk-finance'])) return 'adr0013'
  if (sameRoles(roles, ['pk-principal', 'pk-finance'])) return 'adr0013_owner'
  return null
}

/** The target shape: "Diketahui" = PM project (required), Direktur level 1, Owner level 2, no named user. */
export function isTargetShape(r: RuleRow): boolean {
  return (
    r.docType === 'expense_request' &&
    r.acknowledge === 'required' &&
    r.acknowledgeBy === 'scope_manager' &&
    r.acknowledgeRole === null &&
    r.acknowledgeUser === null &&
    noCondition(r) &&
    levelsOk(r) &&
    sameRoles(stepRoles(r), TARGET_STEP_ROLES)
  )
}

export type RuleAlignment =
  | { rule: RuleRow; action: 'align'; shape: LegacyShape; to: string }
  | { rule: RuleRow; action: 'skip'; reason: string }

/**
 * What happens to one rule: a rule NAMED like a replaced default (`RULE_RENAMES.from`) in exactly one of the replaced
 * shapes is aligned (id kept — requests reference it — renamed to the seed name); the same name in another shape
 * was changed by an Admin → left alone (reported). Other rules: null (not this decision's business).
 */
export function ruleAlignmentOf(r: RuleRow): RuleAlignment | null {
  if (r.docType !== 'expense_request') return null
  const rename = RULE_RENAMES.find((x) => x.from === r.name)
  if (!rename) return null
  const shape = legacyShapeOf(r)
  if (!shape) return { rule: r, action: 'skip', reason: `bentuk sudah diubah Admin (${shapeText(r)}) — dibiarkan` }
  return { rule: r, action: 'align', shape, to: rename.to }
}

/** Active expense rules still in a replaced shape under another name (Admin's own rule): reported, never changed. */
export function legacyShapeWarning(r: RuleRow): string | null {
  if (!r.active || RULE_RENAMES.some((x) => x.from === r.name) || !legacyShapeOf(r)) return null
  return `aturan aktif #${r.id} "${r.name}" masih "Diketahui" Direktur → … → Finance (bukan aturan default, tidak diubah — Admin memutuskan)`
}

/** The aligned rule as the engine sees it (same id, conditions, priority, signatures). */
export function alignedRuleInput(rule: RuleInput, to: string): RuleInput {
  return {
    ...rule,
    name: to,
    acknowledge: 'required',
    acknowledgeBy: 'scope_manager',
    acknowledgeRole: null,
    acknowledgeUser: null,
    steps: TARGET_STEP_ROLES.map((role, i) => ({ level: i + 1, approverRole: role, approverUser: null })),
  }
}

/**
 * A snapshot of the replaced model: "Diketahui" by the Direktur role, not delegated, no G1 exception (taken at submit
 * under an ADR 0013 / ADR 0013 + Owner rule). Only such requests are re-routed.
 */
export function isDirekturAckSnapshot(s: Partial<ApprovalSnapshot> | null | undefined): boolean {
  return !!s && s.acknowledge === 'required' && s.acknowledgeBy === 'role' && s.acknowledgeRole === 'pk-owner' && !s.acknowledgeDelegatedTo && !s.selfApproval
}

const label = (r: string | null | undefined) => (r && Object.hasOwn(ROLE_LABELS, r) ? ROLE_LABELS[r as Role] : (r ?? '?'))

/** "Direktur (Diketahui) → Owner → Finance" of a rule row. */
export function shapeText(r: Pick<RuleRow, 'acknowledge' | 'acknowledgeBy' | 'acknowledgeRole' | 'acknowledgeUser' | 'steps'>): string {
  const parts: string[] = []
  if (r.acknowledge && r.acknowledge !== 'none') {
    parts.push(r.acknowledgeBy === 'scope_manager' ? 'PM project' : r.acknowledgeBy === 'user' ? `user #${r.acknowledgeUser ?? '?'} (Diketahui)` : `${label(r.acknowledgeRole)} (Diketahui)`)
  }
  for (const s of [...r.steps].sort((a, b) => a.level - b.level)) parts.push(s.user ? `user #${s.user}` : label(s.role))
  return parts.join(' → ') || 'tanpa persetujuan'
}

/** "PM project (Nama) → Direktur → Owner" of a snapshot; skipped positions in brackets; `names` = user id → name. */
export function flowText(s: ApprovalSnapshot, names: ReadonlyMap<number, string> = new Map()): string {
  const who = (id: number | null) => (id === null ? null : (names.get(id) ?? `user #${id}`))
  const parts: string[] = []
  if (s.acknowledge !== 'none') {
    parts.push(s.acknowledgeBy === 'scope_manager' ? `PM project${s.acknowledgerUserId !== null ? ` (${who(s.acknowledgerUserId)})` : ''}` : s.acknowledgeBy === 'user' ? `${who(s.acknowledgerUserId)} (Diketahui)` : `${label(s.acknowledgeRole)} (Diketahui)`)
  }
  for (const x of [...s.steps].sort((a, b) => a.level - b.level)) parts.push(x.approverUserId !== null ? (who(x.approverUserId) ?? '?') : label(x.approverRole))
  const skipped = (s.skipped ?? []).map((x) => `${x.position === 'diketahui' ? (s.acknowledgeBy === 'scope_manager' ? 'PM project' : 'Diketahui') : label(x.role)} dilewati — ${x.reason}`)
  return [parts.join(' → ') || 'tanpa persetujuan', ...skipped.map((t) => `[${t}]`)].join(' ')
}

/** Status after the re-route: like a submit — "Diketahui" still required → pending_ack (level 0), else level 1. */
export function statusAfter(s: ApprovalSnapshot): { status: 'pending_ack' | 'pending_approval'; currentLevel: number } {
  return s.acknowledge === 'required' ? { status: 'pending_ack', currentLevel: 0 } : { status: 'pending_approval', currentLevel: 1 }
}

/** The position that decides first after the re-route ("Persetujuan PM (Nama)", "Persetujuan Direktur", …). */
export function firstStepText(s: ApprovalSnapshot, names: ReadonlyMap<number, string> = new Map()): string {
  if (s.acknowledge === 'required') {
    if (s.acknowledgeBy === 'scope_manager') return `Persetujuan PM${s.acknowledgerUserId !== null ? ` (${names.get(s.acknowledgerUserId) ?? `user #${s.acknowledgerUserId}`})` : ''}`
    return `Diketahui ${label(s.acknowledgeRole)}`
  }
  const first = [...s.steps].sort((a, b) => a.level - b.level)[0]
  if (!first) return 'tanpa persetujuan'
  if (first.approverUserId !== null) return `Approval level 1 (${names.get(first.approverUserId) ?? `user #${first.approverUserId}`})`
  return first.approverRole === 'pk-owner' ? 'Persetujuan Direktur' : first.approverRole === 'pk-principal' ? 'Persetujuan Owner' : `Approval ${label(first.approverRole)}`
}

/**
 * Stepper note ("Alur persetujuan diperbarui …") of a request re-routed by this migration while it still carries the
 * snapshot it got there (history rows oldest first, values unwrapped — domain/history.ts). null otherwise.
 */
export function rerouteNoteOf(history: ReadonlyArray<{ action: string; field: string | null; newValue: unknown }>, snapshot: unknown): string | null {
  const last = [...history].reverse().find((h) => h.action === 'update' && h.field === REROUTE_FIELD && (h.newValue as { migration?: unknown } | null)?.migration === MIGRATION)
  const v = last?.newValue as { kind?: unknown; snapshot?: unknown } | undefined
  return v?.kind === 'reroute' && canonicalJson(v.snapshot) === canonicalJson(snapshot) ? REROUTE_NOTE : null
}

/** Key-order independent JSON (jsonb reorders keys) — equality of two snapshots. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

export type RequestPlan = {
  id: number
  companyId: number
  docNo: string | null
  title: string
  status: string
  cycle: number
  oldRuleId: number | null
  oldRuleName: string | null
  oldFlow: string
  /** reroute = changed by the migration; keep = left as it is (reason). */
  action: 'reroute' | 'keep'
  reason: string | null
  oldSnapshot: ApprovalSnapshot | null
  oldLevel: number | null
  newRuleId: number | null
  newRuleName: string | null
  newFlow: string | null
  newSnapshot: ApprovalSnapshot | null
  newStatus: 'pending_ack' | 'pending_approval' | null
  newLevel: number | null
  firstStep: string | null
}

/** An in-flight request under an aligned rule, as read from the database. */
export type Candidate = {
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
  /** Decision rows ("Diketahui" / approval, any decision) of the CURRENT approval cycle. */
  decisions: number
  facts: SnapshotRequest
}

const keepPlan = (c: Candidate, oldFlow: string, reason: string): RequestPlan => ({
  id: c.id,
  companyId: c.companyId,
  docNo: c.docNo,
  title: c.title,
  status: c.status,
  cycle: c.cycle,
  oldRuleId: c.ruleId,
  oldRuleName: c.snapshot?.ruleName ?? c.ruleName,
  oldFlow,
  action: 'keep',
  reason,
  oldSnapshot: c.snapshot,
  oldLevel: c.currentLevel,
  newRuleId: null,
  newRuleName: null,
  newFlow: null,
  newSnapshot: null,
  newStatus: null,
  newLevel: null,
  firstStep: null,
})

/**
 * What happens to one in-flight request: re-routed when it still waits for the Direktur's "Diketahui" of the replaced
 * model (status pending_ack, no decision in the current cycle, no G1 exception) — to the rule and snapshot a submit
 * TODAY would produce (`src` reads the database with the rules ALREADY aligned): same G1 rules (PM step skipped when
 * the requester / creator is the PM project; a Direktur's / Finance's own request takes "its" rule by priority).
 * Kept (with the reason) when the submit would be refused (409: no PM, …) or would need no approval at all (the
 * Owner's own request: that is a decision for a person, not for a migration).
 */
export async function planRequest(src: SnapshotSource, c: Candidate, names: ReadonlyMap<number, string> = new Map()): Promise<RequestPlan> {
  const oldFlow = c.snapshot ? flowText(c.snapshot, names) : 'tanpa snapshot'
  if (c.status !== 'pending_ack') return keepPlan(c, oldFlow, `status ${c.status} — sudah lewat Direktur`)
  if (c.decisions > 0) return keepPlan(c, oldFlow, 'sudah ada keputusan pada siklus ini')
  if (c.g1Exception) return keepPlan(c, oldFlow, `pengecualian G1 ${c.g1Exception} — alur dipertahankan`)
  if (!isDirekturAckSnapshot(c.snapshot)) return keepPlan(c, oldFlow, 'snapshot bukan "Diketahui" Direktur (sudah alur baru / alur khusus)')
  let picked: Awaited<ReturnType<typeof resolveSelectAndSnapshot>>
  try {
    picked = await resolveSelectAndSnapshot(src, c.facts)
  } catch (err) {
    if (err instanceof SnapshotRefused) return keepPlan(c, oldFlow, `pengajuan ulang hari ini ditolak (409): ${err.message}`)
    throw err
  }
  const { rule, snapshot } = picked
  if (isNoApproval(snapshot)) return keepPlan(c, oldFlow, `aturan "${rule.name}" tanpa persetujuan (pengajuan Owner) — perlu keputusan manual, tidak dialihkan otomatis`)
  if (canonicalJson(snapshot) === canonicalJson(c.snapshot) && rule.id === c.ruleId) return keepPlan(c, oldFlow, 'sudah sama dengan pengajuan hari ini')
  const after = statusAfter(snapshot)
  return {
    ...keepPlan(c, oldFlow, ''),
    action: 'reroute',
    reason: null,
    newRuleId: rule.id,
    newRuleName: rule.name,
    newFlow: flowText(snapshot, names),
    newSnapshot: snapshot,
    newStatus: after.status,
    newLevel: after.currentLevel,
    firstStep: firstStepText(snapshot, names),
  }
}

export type ReroutePlan = {
  rules: RuleAlignment[]
  warnings: string[]
  requests: RequestPlan[]
}

/** Human summary (dry-run / migrate log / runbook). `codes` = PT id → short code. */
export function planSummary(plan: ReroutePlan, codes: ReadonlyMap<number, string> = new Map()): string {
  const pt = (id: number | null) => (id === null ? '-' : (codes.get(id) ?? `#${id}`))
  const lines: string[] = []
  const align = plan.rules.filter((r) => r.action === 'align')
  const skip = plan.rules.filter((r) => r.action === 'skip')
  lines.push(`Aturan diselaraskan: ${align.length}; dibiarkan (diubah Admin): ${skip.length}`)
  for (const r of plan.rules) {
    if (r.action === 'align') lines.push(`  [UBAH] ${pt(r.rule.companyId)} aturan #${r.rule.id}${r.rule.active ? '' : ' (nonaktif)'} "${r.rule.name}" (${shapeText(r.rule)}) → "${r.to}" (PM project → Direktur → Owner)`)
    else lines.push(`  [TETAP] ${pt(r.rule.companyId)} aturan #${r.rule.id} "${r.rule.name}": ${r.reason}`)
  }
  for (const w of plan.warnings) lines.push(`  PERINGATAN: ${w}`)
  const re = plan.requests.filter((r) => r.action === 'reroute')
  const keep = plan.requests.filter((r) => r.action === 'keep')
  lines.push(`Pengajuan dialihkan: ${re.length}; tetap alur lama: ${keep.length}`)
  for (const r of re) {
    lines.push(`  [ALIH] ${pt(r.companyId)} ${r.docNo ?? `#${r.id}`} (${r.status}) ${r.oldFlow}  ⇒  ${r.newFlow} — aturan "${r.newRuleName}" #${r.newRuleId}, status ${r.newStatus}, menunggu: ${r.firstStep}`)
  }
  for (const r of keep) lines.push(`  [TETAP] ${pt(r.companyId)} ${r.docNo ?? `#${r.id}`} (${r.status}) ${r.oldFlow}: ${r.reason}`)
  return lines.join('\n')
}
