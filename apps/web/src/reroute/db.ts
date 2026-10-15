/**
 * d1510 (owner decision 2026-10-15) — database side: load, plan, apply, revert. Used by the data migration
 * `20261015_200000_d1510_approval_reroute` (up / down, one transaction, `<prefix>_owner`) and by the read-only
 * dry-run `./cli.ts`. Raw SQL outside Payload (no hooks): the snapshot facts are read with the SAME semantics as the
 * Payload helpers of a submit (`sqlSnapshotSource` ≙ `payloadSnapshotSource`, compared by the integration test), the
 * snapshot is computed by `@/domain/expense/snapshot-plan` — the code of a submit.
 *
 * apply (up):
 * 1. rules NAMED like the replaced defaults in exactly a replaced shape (`./plan.ts` ruleAlignmentOf), every PT, active
 *    or not: renamed to the seed name, "Diketahui" = PM project, levels Direktur → Owner (id kept). One audit row each
 *    (old name + shape → new, source `system`, reason "keputusan owner 2026-10-15").
 * 2. requests `pending_ack` under such a rule, without a decision in the current cycle, still on a "Diketahui
 *    Direktur" snapshot: rule + snapshot + status / level replaced by what a submit today produces (doc no, lines,
 *    amounts, attachments, signatures and the approval cycle unchanged). The request guard
 *    (`expense_requests_guard`, content locked after submit) is disabled for these statements only (owner, same
 *    transaction — like 20261012_200100). Per request: one audit row `update` field `approvalFlow` (old rule /
 *    snapshot / status → new: what `down` restores), a `status_change` row when the status moves (PM step skipped →
 *    "Menunggu persetujuan Direktur"), the `approval_skipped` rows a submit writes, and the notification a submit
 *    sends to the new first approver (in-app row + the approval e-mail job when the PT has it switched on).
 * revert (down): refused when a re-routed request moved since (decision, status, snapshot or cycle changed); else the
 * old rule / snapshot / status come back from the audit rows, and the aligned rules get their old name and shape back
 * while they still have the aligned shape (an Admin's later change is kept).
 */
import { sql } from '@payloadcms/db-postgres'

import { isRole, type Role } from '@/access/roles'
import type { ApprovalSnapshot, RuleInput } from '@/domain/expense/rules'
import type { MemberInfo, SnapshotSource } from '@/domain/expense/snapshot-plan'
import { payeeOf, type RequestType } from '@/domain/expense/types'
import { APPROVAL_EMAIL_EVENTS, approvalEmail, defaultText, fixedText, renderTemplate, type NotifyDoc, type NotifyEvent } from '@/domain/notifications'

import {
  alignedRuleInput,
  canonicalJson,
  isTargetShape,
  legacyShapeWarning,
  MIGRATION,
  planRequest,
  REASON_REQUEST,
  REASON_REVERT,
  REASON_RULE,
  REROUTE_FIELD,
  REROUTE_NOTE,
  ruleAlignmentOf,
  shapeText,
  TARGET_STEP_ROLES,
  type Candidate,
  type ReroutePlan,
  type RequestPlan,
  type RuleAlignment,
  type RuleRow,
} from './plan'

/** A drizzle-style executor: the migration's `db` (transaction), or a `pg` client wrapped by `./cli.ts` / the tests. */
export type SqlQuery = ReturnType<typeof sql>
export type Exec = { execute: (q: SqlQuery) => Promise<unknown> }

export async function rows<T>(db: Exec, q: SqlQuery): Promise<T[]> {
  const r = (await db.execute(q)) as { rows?: T[] } | T[]
  return Array.isArray(r) ? r : (r.rows ?? [])
}

/** `{1,2,3}` for `= ANY(${…}::int[])` (drizzle expands a JS array into a parenthesised list). */
export function intArray(xs: readonly number[]): string {
  for (const x of xs) if (!Number.isSafeInteger(x)) throw new Error(`d1510: not an id: ${String(x)}`)
  return `{${xs.join(',')}}`
}

export const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
export const json = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))
const roles = (v: unknown): Role[] => json<unknown[]>(v ?? []).filter(isRole)

// ---------------------------------------------------------------- snapshot facts (≙ domain/companies + snapshot.ts)

type RuleSql = Record<string, unknown>

const RULE_COLUMNS = sql`
  r.id, r.company_id, r.name, coalesce(r.active, false) AS active, r.doc_type::text AS doc_type, r.request_type::text AS request_type,
  r.min_amount::float8 AS min_amount, r.max_amount::float8 AS max_amount, r.category_id, r.project_id, r.cost_center_id,
  r.priority::float8 AS priority, r.payee_type::text AS payee_type, r.acknowledge::text AS acknowledge,
  r.acknowledge_by::text AS acknowledge_by, r.acknowledge_role::text AS acknowledge_role, r.acknowledge_user_id,
  r.sign_diajukan::text AS sign_diajukan, r.sign_dibuat::text AS sign_dibuat,
  coalesce((SELECT jsonb_agg(x.value::text ORDER BY x."order") FROM approval_rules_requester_roles x WHERE x.parent_id = r.id), '[]'::jsonb) AS requester_roles,
  coalesce((SELECT jsonb_agg(jsonb_build_object('level', s.level::float8, 'role', s.approver_role::text, 'user', s.approver_user_id) ORDER BY s._order, s.level)
              FROM approval_rules_steps s WHERE s._parent_id = r.id), '[]'::jsonb) AS steps`

type StepJson = { level: number; role: string | null; user: number | null }

/** Engine shape of a rule row — same defaults as `loadActiveRules` (snapshot.ts). */
function ruleInputOf(r: RuleSql): RuleInput {
  return {
    id: Number(r.id),
    name: String(r.name),
    active: r.active as boolean,
    docType: String(r.doc_type),
    requestType: r.request_type as RuleInput['requestType'],
    minAmount: num(r.min_amount) ?? 0,
    maxAmount: num(r.max_amount),
    category: num(r.category_id),
    project: num(r.project_id),
    costCenter: num(r.cost_center_id),
    priority: num(r.priority) ?? 100,
    requesterRoles: json<unknown[]>(r.requester_roles).filter((x): x is Role => typeof x === 'string'),
    payeeType: ((r.payee_type as string | null) ?? 'any') as RuleInput['payeeType'],
    acknowledge: ((r.acknowledge as string | null) ?? 'none') as RuleInput['acknowledge'],
    acknowledgeBy: ((r.acknowledge_by as string | null) ?? 'scope_manager') as RuleInput['acknowledgeBy'],
    acknowledgeRole: ((r.acknowledge_role as string | null) ?? null) as RuleInput['acknowledgeRole'],
    acknowledgeUser: num(r.acknowledge_user_id),
    signDiajukan: ((r.sign_diajukan as string | null) ?? 'required') as RuleInput['signDiajukan'],
    signDibuat: ((r.sign_dibuat as string | null) ?? 'required') as RuleInput['signDibuat'],
    steps: json<StepJson[]>(r.steps).map((s) => ({ level: Number(s.level), approverRole: (s.role ?? null) as Role | null, approverUser: num(s.user) })),
  }
}

function ruleRowOf(r: RuleSql): RuleRow {
  return {
    id: Number(r.id),
    companyId: num(r.company_id),
    name: String(r.name),
    active: r.active === true,
    docType: String(r.doc_type),
    acknowledge: (r.acknowledge as string | null) ?? null,
    acknowledgeBy: (r.acknowledge_by as string | null) ?? null,
    acknowledgeRole: (r.acknowledge_role as string | null) ?? null,
    acknowledgeUser: num(r.acknowledge_user_id),
    requesterRoles: json<string[]>(r.requester_roles),
    payeeType: (r.payee_type as string | null) ?? null,
    steps: json<StepJson[]>(r.steps).map((s) => ({ level: Number(s.level), role: s.role ?? null, user: num(s.user) })),
  }
}

/**
 * The snapshot facts read with raw SQL — the semantics of `payloadSnapshotSource` (Payload `find` with
 * `active = true` on memberships / users; stored membership roles; no soft delete in these tables). `aligned`: rule id →
 * target name — those rules are presented in the aligned shape (dry-run before the rules are written; after, a no-op).
 */
export function sqlSnapshotSource(db: Exec, aligned: ReadonlyMap<number, string> = new Map()): SnapshotSource {
  return {
    async activeRules(docType, companyId) {
      const rs = await rows<RuleSql>(db, sql`SELECT ${RULE_COLUMNS} FROM approval_rules r
         WHERE r.active = true AND r.doc_type::text = ${docType} AND r.company_id = ${companyId}::int ORDER BY r.id`)
      return rs.map(ruleInputOf).map((r) => (aligned.has(r.id) ? alignedRuleInput(r, aligned.get(r.id)!) : r))
    },
    async usersOfEmployees(employeeIds) {
      if (employeeIds.length === 0) return []
      const rs = await rows<{ u: number }>(db, sql`SELECT DISTINCT m.user_id AS u FROM company_memberships m
         WHERE m.active = true AND m.user_id IS NOT NULL AND m.employee_id = ANY(${intArray(employeeIds)}::int[]) ORDER BY m.user_id`)
      return rs.map((r) => Number(r.u))
    },
    async rolesOfUsersIn(userIds, companyId) {
      const out = new Map<number, MemberInfo>()
      if (userIds.length === 0) return out
      const rs = await rows<{ id: number; active: boolean; roles: unknown }>(db, sql`
        SELECT u.id, (u.active IS DISTINCT FROM false) AS active,
               coalesce((SELECT jsonb_agg(x.value::text ORDER BY x."order") FROM company_memberships m JOIN company_memberships_roles x ON x.parent_id = m.id
                          WHERE m.user_id = u.id AND m.company_id = ${companyId}::int AND m.active = true), '[]'::jsonb) AS roles
          FROM users u WHERE u.id = ANY(${intArray(userIds)}::int[])`)
      for (const r of rs) out.set(Number(r.id), { active: r.active === true, roles: roles(r.roles) })
      return out
    },
    async membersWithRole(role, companyId) {
      const rs = await rows<{ u: number }>(db, sql`
        SELECT DISTINCT u.id AS u FROM company_memberships m
          JOIN company_memberships_roles x ON x.parent_id = m.id
          JOIN users u ON u.id = m.user_id
         WHERE m.company_id = ${companyId}::int AND m.active = true AND x.value::text = ${role} AND u.active = true
         ORDER BY u.id`)
      return rs.map((r) => Number(r.u))
    },
    async scopeManagerOf(scope) {
      if (scope.projectId) return num((await rows<{ u: number | null }>(db, sql`SELECT pm_id AS u FROM projects WHERE id = ${scope.projectId}::int`))[0]?.u)
      if (scope.costCenterId) return num((await rows<{ u: number | null }>(db, sql`SELECT manager_id AS u FROM cost_centers WHERE id = ${scope.costCenterId}::int`))[0]?.u)
      return null
    },
  }
}

// ---------------------------------------------------------------- plan

async function loadRuleRows(db: Exec): Promise<RuleRow[]> {
  return (await rows<RuleSql>(db, sql`SELECT ${RULE_COLUMNS} FROM approval_rules r WHERE r.doc_type::text = 'expense_request' ORDER BY r.company_id, r.id`)).map(ruleRowOf)
}

/** `pending_ack` requests under the given rules (`lock`: FOR UPDATE — apply only; a read-only dry-run cannot lock). */
async function loadCandidates(db: Exec, ruleIds: readonly number[], lock: boolean): Promise<Candidate[]> {
  if (ruleIds.length === 0) return []
  const rs = await rows<Record<string, unknown>>(
    db,
    sql`SELECT e.id, e.company_id, e.doc_no, e.title, e.status::text AS status, coalesce(e.approval_cycle, 0)::int AS cycle, e.current_level::int AS current_level,
               e.approval_rule_id, (SELECT r.name FROM approval_rules r WHERE r.id = e.approval_rule_id) AS rule_name, e.approval_snapshot, e.g1_exception,
               e.type::text AS type, coalesce(e.grand_total, 0)::float8 AS grand_total, e.project_id, e.cost_center_id, e.created_by_id, e.payee_type::text AS payee_type,
               coalesce((SELECT jsonb_agg(l.category_id ORDER BY l._order) FROM expense_requests_lines l WHERE l._parent_id = e.id AND l.category_id IS NOT NULL), '[]'::jsonb) AS category_ids,
               coalesce((SELECT jsonb_agg(x.employees_id ORDER BY x."order") FROM expense_requests_rels x WHERE x.parent_id = e.id AND x.path = 'requesters' AND x.employees_id IS NOT NULL), '[]'::jsonb) AS requester_ids,
               (SELECT count(*)::int FROM approvals a WHERE a.request_id = e.id AND a.cycle = e.approval_cycle AND a.position::text IN ('diketahui', 'approval')) AS decisions
          FROM expense_requests e
         WHERE e.status::text = 'pending_ack' AND e.approval_rule_id = ANY(${intArray(ruleIds)}::int[])
         ORDER BY e.company_id, e.id${lock ? sql` FOR UPDATE OF e` : sql``}`,
  )
  return rs.map((r) => ({
    id: Number(r.id),
    companyId: Number(r.company_id),
    docNo: (r.doc_no as string | null) ?? null,
    title: String(r.title ?? ''),
    status: String(r.status),
    cycle: Number(r.cycle),
    currentLevel: num(r.current_level),
    ruleId: num(r.approval_rule_id),
    ruleName: (r.rule_name as string | null) ?? null,
    snapshot: r.approval_snapshot ? json<ApprovalSnapshot>(r.approval_snapshot) : null,
    g1Exception: (r.g1_exception as string | null) ?? null,
    decisions: Number(r.decisions),
    facts: {
      companyId: Number(r.company_id),
      type: r.type as RequestType,
      grandTotal: Number(r.grand_total),
      categoryIds: json<unknown[]>(r.category_ids).map(Number),
      projectId: num(r.project_id),
      costCenterId: num(r.cost_center_id),
      creatorId: num(r.created_by_id),
      requesterEmployeeIds: json<unknown[]>(r.requester_ids).map(Number),
      payeeType: payeeOf(r.payee_type),
    },
  }))
}

/** Display names of users (dry-run / log texts). */
export async function userNames(db: Exec, ids: readonly number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (ids.length === 0) return out
  for (const r of await rows<{ id: number; name: string | null; email: string | null }>(db, sql`SELECT id, name, email FROM users WHERE id = ANY(${intArray([...new Set(ids)])}::int[])`)) {
    out.set(Number(r.id), r.name || r.email || `user #${r.id}`)
  }
  return out
}

/** PT id → short code. */
export async function companyCodes(db: Exec): Promise<Map<number, string>> {
  return new Map((await rows<{ id: number; c: string | null }>(db, sql`SELECT id, short_code AS c FROM companies ORDER BY id`)).map((r) => [Number(r.id), r.c ?? `#${r.id}`]))
}

/** The full plan (no write) + the candidate rows it was made from. `lock` = apply mode (candidate rows FOR UPDATE). */
async function buildPlan(db: Exec, lock: boolean): Promise<{ plan: ReroutePlan; candidates: Map<number, Candidate> }> {
  const ruleRows = await loadRuleRows(db)
  const rules = ruleRows.map(ruleAlignmentOf).filter((x): x is RuleAlignment => x !== null)
  const warnings = ruleRows.map(legacyShapeWarning).filter((x): x is string => x !== null)
  const aligned = new Map(rules.flatMap((r) => (r.action === 'align' ? [[r.rule.id, r.to] as const] : [])))
  const candidates = await loadCandidates(db, [...aligned.keys()], lock)
  const src = sqlSnapshotSource(db, aligned)
  const ids: number[] = []
  for (const c of candidates) {
    if (c.snapshot?.acknowledgerUserId) ids.push(c.snapshot.acknowledgerUserId)
    const pm = await src.scopeManagerOf(c.facts)
    if (pm !== null) ids.push(pm)
  }
  const names = await userNames(db, ids)
  const requests: RequestPlan[] = []
  for (const c of candidates) requests.push(await planRequest(src, c, names))
  return { plan: { rules, warnings, requests }, candidates: new Map(candidates.map((c) => [c.id, c])) }
}

/** The full plan, no write (dry-run; a READ ONLY transaction is enough). */
export async function planReroute(db: Exec): Promise<ReroutePlan> {
  return (await buildPlan(db, false)).plan
}

// ---------------------------------------------------------------- apply (migration up)

const stepsJson = (steps: ReadonlyArray<{ level: number; role: string | null; user: number | null }>) => steps.map((s) => ({ level: s.level, role: s.role, user: s.user }))

async function writeRuleAlignment(db: Exec, r: Extract<ReroutePlan['rules'][number], { action: 'align' }>): Promise<void> {
  const old = { name: r.rule.name, shape: r.shape, alur: shapeText(r.rule), acknowledgeBy: r.rule.acknowledgeBy, acknowledgeRole: r.rule.acknowledgeRole, steps: stepsJson(r.rule.steps) }
  const steps = TARGET_STEP_ROLES.map((role, i) => ({ level: i + 1, role, user: null }))
  const neu = { name: r.to, alur: 'PM project → Direktur → Owner', acknowledgeBy: 'scope_manager', acknowledgeRole: null, steps, migration: MIGRATION, kind: 'align' }
  await db.execute(sql`UPDATE approval_rules SET name = ${r.to}, acknowledge = 'required', acknowledge_by = 'scope_manager', acknowledge_role = NULL, acknowledge_user_id = NULL, updated_at = now()
                        WHERE id = ${r.rule.id}::int`)
  await db.execute(sql`DELETE FROM approval_rules_steps WHERE _parent_id = ${r.rule.id}::int`)
  for (const s of steps) {
    await db.execute(sql`INSERT INTO approval_rules_steps (_order, _parent_id, id, level, approver_role, approver_user_id)
      VALUES (${s.level}::int, ${r.rule.id}::int, substr(md5(random()::text || clock_timestamp()::text || ${`${r.rule.id}:${s.level}`}::text), 1, 24), ${s.level}::numeric,
              ${s.role}::enum_approval_rules_steps_approver_role, NULL)`)
  }
  await db.execute(sql`INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, old_value, new_value, reason, source, company_id)
    VALUES (gen_random_uuid()::text, txid_current(), 'approval_rule', ${String(r.rule.id)}, 'update', 'steps',
            jsonb_build_object('v', ${JSON.stringify(old)}::jsonb), jsonb_build_object('v', ${JSON.stringify(neu)}::jsonb), ${REASON_RULE}, 'system', ${r.rule.companyId}::int)`)
}

/** Request audit value (old / new): readable "alur" first (jsonb orders short keys first), then what `down` needs. */
function requestValue(p: { flow: string; ruleId: number | null; ruleName: string | null; status: string; currentLevel: number | null; cycle: number; snapshot: ApprovalSnapshot | null }, extra: Record<string, unknown> = {}) {
  return { alur: p.flow, aturan: p.ruleName, ruleId: p.ruleId, status: p.status, currentLevel: p.currentLevel, cycle: p.cycle, snapshot: p.snapshot, ...extra }
}

export async function audit(
  db: Exec,
  row: { docId: number; docNo: string | null; companyId: number; action: string; field: string; old: unknown; neu: unknown; reason: string; statusFrom?: string | null; statusTo?: string | null },
): Promise<void> {
  await db.execute(sql`INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, doc_no, action, field, old_value, new_value, status_from, status_to, reason, source, company_id)
    VALUES (gen_random_uuid()::text, txid_current(), 'expense_request', ${String(row.docId)}, ${row.docNo}, ${row.action}::enum_audit_logs_action, ${row.field},
            ${row.old === undefined ? null : JSON.stringify({ v: row.old })}::jsonb, ${row.neu === undefined ? null : JSON.stringify({ v: row.neu })}::jsonb,
            ${row.statusFrom ?? null}, ${row.statusTo ?? null}, ${row.reason}, 'system', ${row.companyId}::int)`)
}

/** The request facts a waiting-position notification needs (SQL rows of a re-routed / trimmed request). */
export type WaitingDoc = {
  id: number
  docNo: string | null
  title: string
  type: RequestType
  grandTotal: number
  companyId: number
  projectId: number | null
  creatorId: number | null
  requesterEmployeeIds: number[]
  status: 'pending_ack' | 'pending_approval'
  currentLevel: number | null
  snapshot: ApprovalSnapshot
}

/**
 * The notification of the waiting position (`notifyTransition` → `deliver` of a submit / of the "next level"): in-app
 * row for the PM project / named user / role holders of the position (minus requesters + creator, G1) and the approval
 * e-mail job when the PT has it switched on. Shared by the re-route (new first approver) and the d1510 in-flight trim
 * (a Finance level replaced by the Owner's). Returns the number of recipients.
 */
export async function notifyWaiting(db: Exec, w: WaitingDoc, opts: { push: boolean; appUrl: string | undefined }): Promise<number> {
  const snap = w.snapshot
  const event: NotifyEvent = w.status === 'pending_ack' ? 'expense.pending_ack' : 'expense.pending_approval'
  const src = sqlSnapshotSource(db)
  const doc: NotifyDoc = {
    id: w.id,
    docNo: w.docNo,
    type: w.type,
    status: w.status,
    title: w.title,
    grandTotal: w.grandTotal,
    approvedAmount: null,
    requesters: w.requesterEmployeeIds,
    createdBy: w.creatorId,
    currentLevel: w.currentLevel,
    approvalSnapshot: snap,
    g1Exception: null,
    company: w.companyId,
    project: w.projectId,
  }
  // stepUsers(): the PM project / named user / role holders of the waiting position, minus requesters + creator (G1)
  let to: number[] = []
  if (event === 'expense.pending_ack') {
    if (snap.acknowledgerUserId !== null) to = [snap.acknowledgerUserId]
    else if (snap.acknowledgeBy === 'role' && snap.acknowledgeRole) to = await src.membersWithRole(snap.acknowledgeRole, w.companyId)
  } else {
    const step = snap.steps.find((s) => s.level === (w.currentLevel ?? 1))
    if (step?.approverUserId) to = [step.approverUserId]
    else if (step?.approverRole) to = await src.membersWithRole(step.approverRole, w.companyId)
  }
  const people = new Set<number>(w.creatorId !== null ? [w.creatorId] : [])
  const requesterUsers = await src.usersOfEmployees(w.requesterEmployeeIds)
  if (requesterUsers.length) {
    for (const r of await rows<{ id: number }>(db, sql`SELECT id FROM users WHERE active = true AND id = ANY(${intArray(requesterUsers)}::int[])`)) people.add(Number(r.id))
  }
  to = [...new Set(to)].filter((u) => !people.has(u))
  if (to.length === 0) return 0
  const tpl = (await rows<{ title: string | null; body: string | null }>(db, sql`SELECT title, body FROM notification_templates WHERE event = ${event} AND active = true ORDER BY id LIMIT 1`))[0]
  const text = fixedText(event, doc) ?? (tpl?.title && tpl.body ? { title: tpl.title, body: tpl.body } : defaultText(event))
  const email = APPROVAL_EMAIL_EVENTS.has(event) && (await rows<{ on: boolean }>(db, sql`SELECT approval_email_enabled IS TRUE AS on FROM companies WHERE id = ${w.companyId}::int`))[0]?.on === true
  for (const uid of to) {
    if (email) {
      const m = approvalEmail(doc, event, opts.appUrl)
      await db.execute(sql`INSERT INTO payload_jobs (input, task_slug, queue, total_tried, has_error, processing, created_at, updated_at)
        VALUES (${JSON.stringify({ userId: uid, subject: m.subject, text: m.text })}::jsonb, 'sendEmail', 'default', 0, false, false, now(), now())`)
    }
    await db.execute(sql`INSERT INTO notifications (user_id, event, title, body, doc_type, doc_id, doc_no, company_id, push_status, uuid, created_at, updated_at)
      VALUES (${uid}::int, ${event}, ${renderTemplate(text.title, doc).slice(0, 160)}, ${renderTemplate(text.body, doc).slice(0, 1000)}, 'expense_request', ${String(w.id)}, ${w.docNo},
              ${w.companyId}::int, ${opts.push ? 'pending' : 'skipped'}::enum_notifications_push_status, gen_random_uuid()::text, now(), now())`)
  }
  return to.length
}

/** The notification a submit sends to the first approver of a re-routed request. */
async function notifyFirstApprover(db: Exec, p: RequestPlan, c: Candidate, opts: { push: boolean; appUrl: string | undefined }): Promise<number> {
  return notifyWaiting(
    db,
    {
      id: c.id,
      docNo: c.docNo,
      title: c.title,
      type: c.facts.type,
      grandTotal: c.facts.grandTotal,
      companyId: c.companyId,
      projectId: c.facts.projectId,
      creatorId: c.facts.creatorId,
      requesterEmployeeIds: c.facts.requesterEmployeeIds,
      status: p.newStatus!,
      currentLevel: p.newLevel,
      snapshot: p.newSnapshot!,
    },
    opts,
  )
}

export type ApplyResult = { plan: ReroutePlan; rulesAligned: number; requestsRerouted: number; notifications: number }

/**
 * Up: plan with the candidate rows locked, write the rule alignment, then the re-routed requests (guard disabled for
 * those statements only). Idempotent: aligned rules no longer carry the old name, re-routed requests no longer carry a
 * "Diketahui Direktur" snapshot — a second run finds nothing.
 */
export async function applyReroute(db: Exec, opts: { push?: boolean; appUrl?: string } = {}): Promise<ApplyResult> {
  const { plan, candidates } = await buildPlan(db, true)
  const align = plan.rules.filter((r) => r.action === 'align')
  for (const r of align) await writeRuleAlignment(db, r)
  const re = plan.requests.filter((r) => r.action === 'reroute')
  let notifications = 0
  if (re.length > 0) {
    await db.execute(sql`ALTER TABLE expense_requests DISABLE TRIGGER expense_requests_guard`)
    for (const p of re) {
      const c = candidates.get(p.id)
      if (!c) throw new Error(`d1510: pengajuan #${p.id} berubah selama migrasi`)
      const done = await rows<{ id: number }>(db, sql`
        UPDATE expense_requests SET approval_rule_id = ${p.newRuleId}::int, approval_snapshot = ${JSON.stringify(p.newSnapshot)}::jsonb,
               status = ${p.newStatus}::enum_expense_requests_status, current_level = ${p.newLevel}::numeric, updated_at = now()
         WHERE id = ${p.id}::int AND status = 'pending_ack' AND approval_rule_id = ${p.oldRuleId}::int RETURNING id`)
      if (done.length !== 1) throw new Error(`d1510: pengajuan #${p.id} tidak dapat dialihkan (status berubah)`)
      const old = requestValue({ flow: p.oldFlow, ruleId: p.oldRuleId, ruleName: p.oldRuleName, status: p.status, currentLevel: p.oldLevel, cycle: p.cycle, snapshot: p.oldSnapshot })
      const neu = requestValue(
        { flow: p.newFlow!, ruleId: p.newRuleId, ruleName: p.newRuleName, status: p.newStatus!, currentLevel: p.newLevel, cycle: p.cycle, snapshot: p.newSnapshot },
        { migration: MIGRATION, kind: 'reroute', menunggu: p.firstStep },
      )
      await audit(db, { docId: p.id, docNo: p.docNo, companyId: p.companyId, action: 'update', field: REROUTE_FIELD, old, neu, reason: REASON_REQUEST })
      if (p.newStatus !== p.status) {
        await audit(db, { docId: p.id, docNo: p.docNo, companyId: p.companyId, action: 'status_change', field: 'status', old: p.status, neu: p.newStatus, statusFrom: p.status, statusTo: p.newStatus, reason: REROUTE_NOTE })
      }
      // auditSkipped(): one row per position left out (G1-2), like a submit
      for (const s of p.newSnapshot!.skipped ?? []) {
        await audit(db, { docId: p.id, docNo: p.docNo, companyId: p.companyId, action: 'approval_skipped', field: s.position, old: undefined, neu: { level: s.level, role: s.role, userId: s.userId, cycle: p.cycle }, reason: s.reason })
      }
      notifications += await notifyFirstApprover(db, p, c, { push: opts.push === true, appUrl: opts.appUrl })
    }
    // the deferred frozen-content check must fire before the table can be altered again
    await db.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`)
    await db.execute(sql`ALTER TABLE expense_requests ENABLE TRIGGER expense_requests_guard`)
  }
  return { plan, rulesAligned: align.length, requestsRerouted: re.length, notifications }
}

// ---------------------------------------------------------------- revert (migration down)

type AuditJson = { v?: Record<string, unknown> } | null

export type RevertResult = { requestsRestored: number; rulesRestored: number; rulesKept: string[] }

/** Down: see the module comment. Throws (nothing changed) when a re-routed request moved since. */
export async function revertReroute(db: Exec): Promise<RevertResult> {
  const reqRows = (
    await rows<{ doc_id: string; old_value: AuditJson; new_value: AuditJson }>(db, sql`
      SELECT DISTINCT ON (a.doc_id) a.doc_id, a.old_value, a.new_value FROM audit_logs a
       WHERE a.doc_type = 'expense_request' AND a.action::text = 'update' AND a.field = ${REROUTE_FIELD} AND a.new_value -> 'v' ->> 'migration' = ${MIGRATION}
       ORDER BY a.doc_id, a.id DESC`)
  ).filter((r) => json<AuditJson>(r.new_value)?.v?.kind === 'reroute')
  type Val = { ruleId: number | null; ruleName: string | null; status: string; currentLevel: number | null; cycle: number; snapshot: ApprovalSnapshot | null; alur: string }
  const todo: Array<{ id: number; docNo: string | null; companyId: number; old: Val; neu: Val }> = []
  const moved: string[] = []
  for (const r of reqRows) {
    const old = json<AuditJson>(r.old_value)!.v as unknown as Val
    const neu = json<AuditJson>(r.new_value)!.v as unknown as Val
    const id = Number(r.doc_id)
    const cur = (
      await rows<Record<string, unknown>>(db, sql`
        SELECT e.doc_no, e.company_id, e.status::text AS status, e.approval_rule_id, e.approval_snapshot, coalesce(e.approval_cycle, 0)::int AS cycle,
               (SELECT count(*)::int FROM approvals a WHERE a.request_id = e.id AND a.cycle = e.approval_cycle AND a.position::text IN ('diketahui', 'approval')) AS decisions
          FROM expense_requests e WHERE e.id = ${id}::int FOR UPDATE`)
    )[0]
    if (!cur) continue
    const same =
      cur.status === neu.status &&
      num(cur.approval_rule_id) === neu.ruleId &&
      Number(cur.cycle) === neu.cycle &&
      Number(cur.decisions) === 0 &&
      canonicalJson(json(cur.approval_snapshot)) === canonicalJson(neu.snapshot)
    if (!same) moved.push(`${String(cur.doc_no ?? `#${id}`)} (${String(cur.status)})`)
    else todo.push({ id, docNo: (cur.doc_no as string | null) ?? null, companyId: Number(cur.company_id), old, neu })
  }
  if (moved.length > 0) {
    throw new Error(
      `${MIGRATION} down DITOLAK: pengajuan yang dialihkan sudah berjalan di alur baru (${moved.join(', ')}). Keputusan yang sudah diambil tidak dibatalkan otomatis — pulihkan dump pra-migrasi bila rollback tetap diperlukan.`,
    )
  }
  // rules first: their deferred zero-step check must not fire between DELETE and INSERT of the steps
  // rules: back to the old name + shape while they still have the aligned one
  const ruleAudits = (
    await rows<{ doc_id: string; old_value: AuditJson; new_value: AuditJson; company_id: number | null }>(db, sql`
      SELECT DISTINCT ON (a.doc_id) a.doc_id, a.old_value, a.new_value, a.company_id FROM audit_logs a
       WHERE a.doc_type = 'approval_rule' AND a.action::text = 'update' AND a.field = 'steps' AND a.new_value -> 'v' ->> 'migration' = ${MIGRATION}
       ORDER BY a.doc_id, a.id DESC`)
  ).filter((r) => json<AuditJson>(r.new_value)?.v?.kind === 'align')
  let rulesRestored = 0
  const rulesKept: string[] = []
  for (const a of ruleAudits) {
    const id = Number(a.doc_id)
    const old = json<AuditJson>(a.old_value)!.v as { name: string; acknowledgeBy: string; acknowledgeRole: string | null; steps: StepJson[] }
    const neu = json<AuditJson>(a.new_value)!.v as { name: string }
    const cur = (await rows<RuleSql>(db, sql`SELECT ${RULE_COLUMNS} FROM approval_rules r WHERE r.id = ${id}::int`))[0]
    if (!cur) continue
    const row = ruleRowOf(cur)
    if (!isTargetShape(row) || row.name !== neu.name) {
      rulesKept.push(`#${id} "${row.name}" (${shapeText(row)}) — diubah sesudah migrasi, dibiarkan`)
      continue
    }
    await db.execute(sql`UPDATE approval_rules SET name = ${old.name}, acknowledge = 'required', acknowledge_by = ${old.acknowledgeBy}::enum_approval_rules_acknowledge_by,
                           acknowledge_role = ${old.acknowledgeRole}::enum_approval_rules_acknowledge_role, acknowledge_user_id = NULL, updated_at = now() WHERE id = ${id}::int`)
    await db.execute(sql`DELETE FROM approval_rules_steps WHERE _parent_id = ${id}::int`)
    for (const s of [...old.steps].sort((x, y) => x.level - y.level)) {
      await db.execute(sql`INSERT INTO approval_rules_steps (_order, _parent_id, id, level, approver_role, approver_user_id)
        VALUES (${s.level}::int, ${id}::int, substr(md5(random()::text || clock_timestamp()::text || ${`${id}:${s.level}`}::text), 1, 24), ${s.level}::numeric,
                ${s.role}::enum_approval_rules_steps_approver_role, ${s.user}::int)`)
    }
    const back = { name: neu.name, alur: 'PM project → Direktur → Owner', steps: stepsJson(row.steps) }
    await db.execute(sql`INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, old_value, new_value, reason, source, company_id)
      VALUES (gen_random_uuid()::text, txid_current(), 'approval_rule', ${String(id)}, 'update', 'steps',
              jsonb_build_object('v', ${JSON.stringify(back)}::jsonb), jsonb_build_object('v', ${JSON.stringify({ ...old, migration: MIGRATION, kind: 'revert' })}::jsonb), ${REASON_REVERT}, 'system', ${a.company_id}::int)`)
    rulesRestored++
  }
  if (todo.length > 0) {
    await db.execute(sql`ALTER TABLE expense_requests DISABLE TRIGGER expense_requests_guard`)
    for (const t of todo) {
      await db.execute(sql`UPDATE expense_requests SET approval_rule_id = ${t.old.ruleId}::int, approval_snapshot = ${JSON.stringify(t.old.snapshot)}::jsonb,
                             status = ${t.old.status}::enum_expense_requests_status, current_level = ${t.old.currentLevel}::numeric, updated_at = now()
                            WHERE id = ${t.id}::int`)
      await audit(db, { docId: t.id, docNo: t.docNo, companyId: t.companyId, action: 'update', field: REROUTE_FIELD, old: t.neu, neu: { ...t.old, migration: MIGRATION, kind: 'revert' }, reason: REASON_REVERT })
      if (t.old.status !== t.neu.status) {
        await audit(db, { docId: t.id, docNo: t.docNo, companyId: t.companyId, action: 'status_change', field: 'status', old: t.neu.status, neu: t.old.status, statusFrom: t.neu.status, statusTo: t.old.status, reason: REASON_REVERT })
      }
    }
    await db.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`)
    await db.execute(sql`ALTER TABLE expense_requests ENABLE TRIGGER expense_requests_guard`)
  }

  return { requestsRestored: todo.length, rulesRestored, rulesKept }
}
