/**
 * d1510 in-flight trim (owner decision 2026-10-15) — database side: load, plan, apply, revert. Used by the data
 * migration `20261015_210000_d1510_approval_inflight_trim` (up / down, one transaction, `<prefix>_owner`) and the
 * read-only dry-run `./cli.ts`. Raw SQL for the snapshot (the request guard `expense_requests_guard` is disabled for
 * those statements only, like 20261015_200000), the "Disetujui" of case 3 through the app's finalisation
 * (`Finalizer`, `./trim-finalize.ts` — Payload Local API in the SAME transaction).
 *
 * apply (up), per request with an undecided Finance level (`./trim-plan.ts` planTrim):
 * - trim / owner: snapshot (`steps`, `decisionRoles`) replaced, status / level / decisions kept; one audit row `update`
 *   field `approvalFlow` (old → new: what `down` restores); owner: the Owners of the PT are notified like the "next
 *   level" notification (in-app + the approval e-mail job when the PT has it switched on);
 * - final: fund check (ADR 0029) first — refused → kept and listed; else the snapshot is trimmed (audit row incl. the
 *   fund figures) and the request goes "Disetujui" through `finalizeApproved` (approved_at / approved_amount, status
 *   audit row, notifications, Finance transfer queue). Without a Finalizer (dry-run / a caller without Payload) such
 *   a request is kept and listed.
 * revert (down): refused when a trimmed request moved since (decision, status, snapshot, cycle) or went "Disetujui"
 * (case 3 — an approval is never undone automatically); else the old snapshot / level come back from the audit rows.
 */
import { sql } from '@payloadcms/db-postgres'

import type { ApprovalSnapshot } from '@/domain/expense/rules'
import type { FundFigures } from '@/domain/fundcheck/rules'
import type { RequestType } from '@/domain/expense/types'

import { audit, json, notifyWaiting, num, rows, sqlSnapshotSource, userNames, type Exec } from './db'
import { canonicalJson } from './plan'
import {
  planTrim,
  TRIM_FIELD,
  TRIM_MIGRATION,
  TRIM_REASON,
  TRIM_REASON_FINAL,
  TRIM_REASON_REVERT,
  trimValue,
  type TrimCandidate,
  type TrimDecision,
  type TrimPlan,
  type TrimResult,
} from './trim-plan'

/** The app's finalisation of case 3, bound to the migration's transaction (`./trim-finalize.ts`). */
export type Finalizer = {
  /** ADR 0029 fund check of the final decision (switch on): ok + figures, or the refusal text. Writes nothing. */
  check(requestId: number): Promise<{ ok: true; fund: FundFigures | null } | { ok: false; reason: string }>
  /** "Menunggu persetujuan" → "Disetujui" (the code of the last approval). Returns the new status. */
  approve(requestId: number, reason: string): Promise<string>
}

type Facts = { type: RequestType; grandTotal: number; projectId: number | null; creatorId: number | null; requesterEmployeeIds: number[] }

/** In-flight requests whose snapshot names a Finance approval level (`lock`: FOR UPDATE — apply only). */
async function loadCandidates(db: Exec, lock: boolean): Promise<Array<TrimCandidate & { facts: Facts }>> {
  const rs = await rows<Record<string, unknown>>(
    db,
    sql`SELECT e.id, e.company_id, e.doc_no, e.title, e.status::text AS status, coalesce(e.approval_cycle, 0)::int AS cycle, e.current_level::int AS current_level,
               e.approval_rule_id, (SELECT r.name FROM approval_rules r WHERE r.id = e.approval_rule_id) AS rule_name, e.approval_snapshot, e.g1_exception,
               e.type::text AS type, coalesce(e.grand_total, 0)::float8 AS grand_total, e.project_id, e.created_by_id,
               coalesce((SELECT jsonb_agg(x.employees_id ORDER BY x."order") FROM expense_requests_rels x WHERE x.parent_id = e.id AND x.path = 'requesters' AND x.employees_id IS NOT NULL), '[]'::jsonb) AS requester_ids,
               coalesce((SELECT jsonb_agg(jsonb_build_object('position', a.position::text, 'level', a.level::int, 'decision', a.decision::text, 'actor', a.actor_id) ORDER BY a.id)
                           FROM approvals a WHERE a.request_id = e.id AND a.doc_type::text = 'expense_request' AND a.cycle = e.approval_cycle
                            AND a.position::text IN ('diketahui', 'approval')), '[]'::jsonb) AS decisions
          FROM expense_requests e
         WHERE e.status::text IN ('pending_ack', 'pending_approval') AND jsonb_typeof(e.approval_snapshot -> 'steps') = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(e.approval_snapshot -> 'steps') s WHERE s ->> 'approverRole' = 'pk-finance')
         ORDER BY e.company_id, e.id${lock ? sql` FOR UPDATE OF e` : sql``}`,
  )
  const src = sqlSnapshotSource(db)
  const owners = new Map<number, number[]>()
  const out: Array<TrimCandidate & { facts: Facts }> = []
  for (const r of rs) {
    const companyId = Number(r.company_id)
    if (!owners.has(companyId)) owners.set(companyId, await src.membersWithRole('pk-principal', companyId))
    const requesterEmployeeIds = json<unknown[]>(r.requester_ids).map(Number)
    const creatorId = num(r.created_by_id)
    const excluded = [...new Set([...(await src.usersOfEmployees(requesterEmployeeIds)), ...(creatorId !== null ? [creatorId] : [])])]
    out.push({
      id: Number(r.id),
      companyId,
      docNo: (r.doc_no as string | null) ?? null,
      title: String(r.title ?? ''),
      status: String(r.status),
      cycle: Number(r.cycle),
      currentLevel: num(r.current_level),
      ruleId: num(r.approval_rule_id),
      ruleName: (r.rule_name as string | null) ?? null,
      snapshot: r.approval_snapshot ? json<ApprovalSnapshot>(r.approval_snapshot) : null,
      g1Exception: (r.g1_exception as string | null) ?? null,
      decisions: json<TrimDecision[]>(r.decisions).map((d) => ({ ...d, level: Number(d.level), actor: num(d.actor) })),
      excluded,
      owners: owners.get(companyId)!,
      facts: { type: r.type as RequestType, grandTotal: Number(r.grand_total), projectId: num(r.project_id), creatorId, requesterEmployeeIds },
    })
  }
  return out
}

/**
 * The plan, no write. `skip`: requests 20261015_200000 re-routes first (dry-run BEFORE that migration ran: their new
 * flow has no Finance level) — listed as a count only.
 */
async function buildTrimPlan(db: Exec, lock: boolean, skip: ReadonlySet<number>) {
  const all = await loadCandidates(db, lock)
  const cands = all.filter((c) => !skip.has(c.id))
  const ids: number[] = []
  for (const c of cands) if (c.snapshot?.acknowledgerUserId) ids.push(c.snapshot.acknowledgerUserId)
  const names = await userNames(db, ids)
  const plans = cands.map((c) => planTrim(c, names)).filter((p): p is TrimPlan => p !== null)
  return { result: { plans, skippedByReroute: all.filter((c) => skip.has(c.id)).map((c) => c.id) } as TrimResult, cands: new Map(cands.map((c) => [c.id, c])) }
}

/** The full plan, no write (dry-run; a READ ONLY transaction is enough). */
export async function planInflightTrim(db: Exec, opts: { skip?: ReadonlySet<number> } = {}): Promise<TrimResult> {
  return (await buildTrimPlan(db, false, opts.skip ?? new Set())).result
}

// ---------------------------------------------------------------- apply (migration up)

/** The request guard is off for the snapshot statements only; pending deferred events must fire before ALTER TABLE. */
async function guardOff(db: Exec): Promise<void> {
  await db.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`)
  await db.execute(sql`ALTER TABLE expense_requests DISABLE TRIGGER expense_requests_guard`)
}
async function guardOn(db: Exec): Promise<void> {
  await db.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`)
  await db.execute(sql`ALTER TABLE expense_requests ENABLE TRIGGER expense_requests_guard`)
  // back to deferred (as `forceDeferredChecks`): a Payload update deletes + re-inserts the request's relationship rows,
  // the frozen-content check must see the end state; the final IMMEDIATE of `applyInflightTrim` flushes them
  await db.execute(sql`SET CONSTRAINTS ALL DEFERRED`)
}

async function writeTrim(db: Exec, p: TrimPlan, extra: Record<string, unknown> = {}): Promise<void> {
  const done = await rows<{ id: number }>(db, sql`
    UPDATE expense_requests SET approval_snapshot = ${JSON.stringify(p.newSnapshot)}::jsonb, current_level = ${p.newLevel}::numeric, updated_at = now()
     WHERE id = ${p.id}::int AND status::text = ${p.status} AND coalesce(approval_cycle, 0) = ${p.cycle}::int AND approval_snapshot = ${JSON.stringify(p.oldSnapshot)}::jsonb
     RETURNING id`)
  if (done.length !== 1) throw new Error(`d1510 trim: pengajuan #${p.id} berubah selama migrasi`)
  await audit(db, {
    docId: p.id,
    docNo: p.docNo,
    companyId: p.companyId,
    action: 'update',
    field: TRIM_FIELD,
    old: trimValue(p, 'old'),
    neu: trimValue(p, 'new', extra),
    reason: p.kind === 'final' ? TRIM_REASON_FINAL : TRIM_REASON,
  })
}

export type TrimApplyResult = TrimResult & { trimmed: number; ownerLevels: number; approved: number; notifications: number }

/**
 * Up: plan with the candidate rows locked; trim / owner first (one guard window), then case 3 one by one (fund check →
 * trim → finalisation; each fund check sees the requests approved before it). Idempotent: a trimmed request carries no
 * undecided Finance level any more — a second run finds only the kept ones (no write).
 */
export async function applyInflightTrim(db: Exec, opts: { push?: boolean; appUrl?: string; finalizer?: Finalizer } = {}): Promise<TrimApplyResult> {
  const { result, cands } = await buildTrimPlan(db, true, new Set())
  const notifyOpts = { push: opts.push === true, appUrl: opts.appUrl }
  let notifications = 0
  const plain = result.plans.filter((p) => p.kind === 'trim' || p.kind === 'owner')
  if (plain.length > 0) {
    await guardOff(db)
    for (const p of plain) await writeTrim(db, p)
    await guardOn(db)
    for (const p of plain.filter((x) => x.kind === 'owner')) {
      const c = cands.get(p.id)!
      notifications += await notifyWaiting(
        db,
        {
          id: p.id,
          docNo: p.docNo,
          title: p.title,
          type: c.facts.type,
          grandTotal: c.facts.grandTotal,
          companyId: p.companyId,
          projectId: c.facts.projectId,
          creatorId: c.facts.creatorId,
          requesterEmployeeIds: c.facts.requesterEmployeeIds,
          status: 'pending_approval',
          currentLevel: p.newLevel,
          snapshot: p.newSnapshot!,
        },
        notifyOpts,
      )
    }
  }
  let approved = 0
  const plans: TrimPlan[] = []
  for (const p of result.plans) {
    if (p.kind !== 'final') {
      plans.push(p)
      continue
    }
    if (!opts.finalizer) {
      plans.push({ ...p, kind: 'keep', reason: '"Disetujui" hanya lewat payload migrate (finalisasi aplikasi + cek dana) — tidak dijalankan di sini' })
      continue
    }
    const chk = await opts.finalizer.check(p.id)
    if (!chk.ok) {
      plans.push({ ...p, kind: 'keep', reason: chk.reason })
      continue
    }
    await guardOff(db)
    await writeTrim(db, p, chk.fund ? { fund: { balance: chk.fund.balance, commitments: chk.fund.commitments, available: chk.fund.available } } : {})
    await guardOn(db)
    const status = await opts.finalizer.approve(p.id, TRIM_REASON_FINAL)
    if (status !== 'approved') throw new Error(`d1510 trim: pengajuan #${p.id} tidak menjadi Disetujui (${status})`)
    approved++
    plans.push(p)
  }
  // every deferred check of this transaction fires here (Payload's COMMIT would swallow a failure)
  await db.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`)
  return {
    plans,
    skippedByReroute: result.skippedByReroute,
    trimmed: plain.filter((p) => p.kind === 'trim').length,
    ownerLevels: plain.filter((p) => p.kind === 'owner').length,
    approved,
    notifications,
  }
}

// ---------------------------------------------------------------- revert (migration down)

type AuditJson = { v?: Record<string, unknown> } | null
type Val = { status: string; currentLevel: number | null; cycle: number; snapshot: ApprovalSnapshot | null; kasus?: string; decisions?: number }

export type TrimRevertResult = { requestsRestored: number }

/** Down: see the module comment. Throws (nothing changed) when a trimmed request moved since or was approved. */
export async function revertInflightTrim(db: Exec): Promise<TrimRevertResult> {
  const audits = (
    await rows<{ doc_id: string; old_value: AuditJson; new_value: AuditJson }>(db, sql`
      SELECT DISTINCT ON (a.doc_id) a.doc_id, a.old_value, a.new_value FROM audit_logs a
       WHERE a.doc_type = 'expense_request' AND a.action::text = 'update' AND a.field = ${TRIM_FIELD} AND a.new_value -> 'v' ->> 'migration' = ${TRIM_MIGRATION}
       ORDER BY a.doc_id, a.id DESC`)
  ).filter((r) => json<AuditJson>(r.new_value)?.v?.kind === 'trim')
  const todo: Array<{ id: number; docNo: string | null; companyId: number; old: Val; neu: Val }> = []
  const moved: string[] = []
  for (const r of audits) {
    const old = json<AuditJson>(r.old_value)!.v as unknown as Val
    const neu = json<AuditJson>(r.new_value)!.v as unknown as Val
    const id = Number(r.doc_id)
    const cur = (
      await rows<Record<string, unknown>>(db, sql`
        SELECT e.doc_no, e.company_id, e.status::text AS status, e.approval_snapshot, coalesce(e.approval_cycle, 0)::int AS cycle,
               (SELECT count(*)::int FROM approvals a WHERE a.request_id = e.id AND a.cycle = e.approval_cycle AND a.position::text IN ('diketahui', 'approval')) AS decisions
          FROM expense_requests e WHERE e.id = ${id}::int FOR UPDATE`)
    )[0]
    if (!cur) continue
    const same =
      neu.kasus !== 'final' &&
      cur.status === neu.status &&
      Number(cur.cycle) === neu.cycle &&
      Number(cur.decisions) === (neu.decisions ?? 0) &&
      canonicalJson(json(cur.approval_snapshot)) === canonicalJson(neu.snapshot)
    if (!same) moved.push(`${String(cur.doc_no ?? `#${id}`)} (${String(cur.status)})`)
    else todo.push({ id, docNo: (cur.doc_no as string | null) ?? null, companyId: Number(cur.company_id), old, neu })
  }
  if (moved.length > 0) {
    throw new Error(
      `${TRIM_MIGRATION} down DITOLAK: pengajuan yang alurnya dipotong sudah berjalan / sudah Disetujui (${moved.join(', ')}). Keputusan tidak dibatalkan otomatis — pulihkan dump pra-migrasi bila rollback tetap diperlukan.`,
    )
  }
  if (todo.length > 0) {
    await guardOff(db)
    for (const t of todo) {
      await db.execute(sql`UPDATE expense_requests SET approval_snapshot = ${JSON.stringify(t.old.snapshot)}::jsonb, current_level = ${t.old.currentLevel}::numeric, updated_at = now()
                            WHERE id = ${t.id}::int`)
      await audit(db, { docId: t.id, docNo: t.docNo, companyId: t.companyId, action: 'update', field: TRIM_FIELD, old: t.neu, neu: { ...t.old, migration: TRIM_MIGRATION, kind: 'revert' }, reason: TRIM_REASON_REVERT })
    }
    await guardOn(db)
  }
  return { requestsRestored: todo.length }
}

/** Ids for `planInflightTrim({ skip })` (helper for callers holding a re-route plan). */
export const reroutedIds = (requests: ReadonlyArray<{ id: number; action: string }>): Set<number> => new Set(requests.filter((r) => r.action === 'reroute').map((r) => r.id))
