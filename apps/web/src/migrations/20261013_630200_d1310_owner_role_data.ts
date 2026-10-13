import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0026 (owner decision 2026-10-13), DATA ONLY, hand-written, IDEMPOTENT, run as <prefix>_owner after
 * 20261013_630100_d1310_owner_role_guard. New submissions route through the Owner (`pk-principal`):
 *
 * 1. Every expense-request rule that is ACTIVE (any PT, any shape) — plus every zero-step Direktur rule of ADR 0024
 *    ("Pengajuan Direktur", active or not: that shape is no longer valid) — gets ONE approval level "Owner", placed
 *    Direktur → Owner → Finance (`ownerLevelPosition`): directly AFTER the last Direktur (`pk-owner`) level; without a
 *    Direktur level BEFORE the first Finance level (ADR 0013 shape "Diketahui" Direktur → Finance: the Owner becomes
 *    level 1); else at the end. The following levels are renumbered (+1). Skipped: rules that already name the Owner
 *    in a level (re-run / Admin did it), the Owner's own rules (Peran pemohon = Owner only) and Addendum RAB rules
 *    (Direktur → Finance stays, ADR 0026). Inactive rules of other shapes are left to the Admin; names are kept.
 * 2. Every PT without an ACTIVE zero-step Owner rule gets "Pengajuan Owner": Peran pemohon = Owner, no
 *    "Diketahui", no approval level (= "Tanpa persetujuan — langsung ke antrian transfer Finance"), priority 5 (before
 *    "Pengajuan Direktur" = 10 and the defaults = 100). The Owner's own request then goes straight to Finance
 *    (`principal_no_approval`, audited) — the only no-approval path since ADR 0026.
 * One audit row per change (source `system`, reason below, `migration` = this name in new_value). Requests already
 * submitted keep their approval snapshot (taken at submit) and so their flow — no request row is touched.
 * Until an Owner membership exists in a PT, a submit there answers 409 "Tidak ada pengguna aktif untuk posisi Approval
 * level n (peran Owner)" — deploy step: tick "Owner" for the Owner in every PT (Pengguna → Akses PT).
 * Down: the levels this migration added are removed (only while that level is still the Owner's; never from a rule that
 * would be left without any level — the ADR 0026 zero-step guard forbids a Direktur zero-step rule until the guard
 * migration is reverted too), the following levels renumbered back, and the rules it created are deleted when unused,
 * else deactivated.
 */
const NAME = '20261013_630200_d1310_owner_role_data'
/** Name of the seeded no-approval rule of the Owner (seed/data.ts OWNER_RULE_NAME, frozen copy). */
export const OWNER_RULE = 'Pengajuan Owner'
const OWNER = 'pk-principal'
const REASON_LEVEL = `ADR 0026 keputusan owner 2026-10-13: level persetujuan Owner di atas Direktur (Staff → PM → Direktur → Owner → Finance) — level Owner ditambahkan sesudah Direktur / sebelum Finance (migrasi ${NAME})`
const REASON_RULE = `ADR 0026 keputusan owner 2026-10-13: pengajuan Owner sendiri tanpa persetujuan, langsung ke antrian transfer Finance (migrasi ${NAME})`

type RuleRow = { id: number; company_id: number | null; name: string; levels: Array<{ level: number; role: string | null; user: number | null }> }

/**
 * Level the Owner takes in a rule (Direktur → Owner → Finance): after the last Direktur level (role, no named user),
 * else before the first Finance level, else at the end (1 for a rule without levels). Pure (unit-tested).
 */
export function ownerLevelPosition(levels: ReadonlyArray<{ level: number; role: string | null; user?: number | null }>): number {
  const byRole = (role: string) => levels.filter((s) => s.role === role && !s.user).map((s) => s.level)
  const dir = byRole('pk-owner')
  if (dir.length > 0) return Math.max(...dir) + 1
  const fin = byRole('pk-finance')
  if (fin.length > 0) return Math.min(...fin)
  return levels.reduce((m, s) => Math.max(m, s.level), 0) + 1
}

/** `_order` of a rule's levels = their level order (Payload array order). */
const reorder = (rid: number) => sql`
  UPDATE approval_rules_steps s SET _order = x.rn
    FROM (SELECT id, row_number() OVER (ORDER BY level, _order)::int AS rn FROM approval_rules_steps WHERE _parent_id = ${rid}::int) x
   WHERE s.id = x.id AND s._parent_id = ${rid}::int`

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)

  // 1. Owner level (Direktur → Owner → Finance) in the active expense rules (+ the ADR 0024 zero-step Direktur rules)
  const rules = (await db.execute(sql`
    SELECT r.id, r.company_id, r.name,
           coalesce((SELECT jsonb_agg(jsonb_build_object('level', s.level::int, 'role', s.approver_role::text, 'user', s.approver_user_id) ORDER BY s.level)
                       FROM approval_rules_steps s WHERE s._parent_id = r.id), '[]'::jsonb) AS levels
      FROM approval_rules r
     WHERE r.doc_type::text = 'expense_request'
       AND NOT EXISTS (SELECT 1 FROM approval_rules_steps s WHERE s._parent_id = r.id AND s.approver_role::text = ${OWNER})
       AND NOT pk_rule_requester_only(r.id, ${OWNER})
       AND (coalesce(r.active, false)
            OR (NOT EXISTS (SELECT 1 FROM approval_rules_steps s WHERE s._parent_id = r.id) AND pk_rule_requester_only(r.id, 'pk-owner')))
     ORDER BY r.id`)) as unknown as { rows: RuleRow[] }
  const extended: Array<{ rule: number; company: number | null; name: string; level: number }> = []
  for (const r of rules.rows) {
    const level = ownerLevelPosition(r.levels)
    // the following levels move up by one (one statement per row order: no transient duplicate levels matter — no unique index)
    await db.execute(sql`UPDATE approval_rules_steps SET level = level + 1 WHERE _parent_id = ${r.id}::int AND level >= ${level}::numeric`)
    await db.execute(sql`
      WITH st AS (
        INSERT INTO approval_rules_steps (_order, _parent_id, id, level, approver_role, approver_user_id)
        VALUES (0, ${r.id}::int, substr(md5(random()::text || clock_timestamp()::text || ${String(r.id)}::text), 1, 24), ${level}::numeric, ${OWNER}::enum_approval_rules_steps_approver_role, NULL)
        RETURNING 1
      ), upd AS (
        UPDATE approval_rules SET updated_at = now() WHERE id = ${r.id}::int RETURNING id
      )
      INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, old_value, new_value, reason, source, company_id)
      SELECT gen_random_uuid()::text, txid_current(), 'approval_rule', ${String(r.id)}::text, 'update', 'steps', ${JSON.stringify(r.levels)}::jsonb,
             jsonb_build_object('addedLevel', ${level}::int, 'approverRole', ${OWNER}::text, 'levelsBefore', ${r.levels.length}::int, 'migration', ${NAME}::text),
             ${REASON_LEVEL}::text, 'system', ${r.company_id}::int
        FROM (SELECT count(*) FROM st) a, (SELECT count(*) FROM upd) b`)
    await db.execute(reorder(r.id))
    extended.push({ rule: r.id, company: r.company_id, name: r.name, level })
  }

  // 2. "Pengajuan Owner" (zero-step, Peran pemohon = Owner) in every PT that has no active one yet
  const pts = (await db.execute(sql`
    SELECT c.id AS company_id FROM companies c
     WHERE NOT EXISTS (SELECT 1 FROM approval_rules r
                        WHERE r.company_id = c.id AND r.doc_type::text = 'expense_request' AND coalesce(r.active, false)
                          AND NOT EXISTS (SELECT 1 FROM approval_rules_steps s WHERE s._parent_id = r.id) AND pk_rule_requester_only(r.id, ${OWNER}))
     ORDER BY c.id`)) as unknown as { rows: Array<{ company_id: number }> }
  const created: Array<{ company: number; rule: number }> = []
  for (const p of pts.rows) {
    // one statement: rule + requester role + audit (the deferred zero-step guard sees the role row at commit)
    const r = (await db.execute(sql`
      WITH ins AS (
        INSERT INTO approval_rules (company_id, name, doc_type, request_type, min_amount, max_amount, priority, acknowledge, acknowledge_by, acknowledge_role,
                                    sign_diajukan, sign_dibuat, active, updated_at, created_at)
        VALUES (${p.company_id}::int, ${OWNER_RULE}::text, 'expense_request', 'any', 0, NULL, 5, 'none', 'role', NULL, 'required', 'required', true, now(), now())
        RETURNING id, company_id
      ), roles AS (
        INSERT INTO approval_rules_requester_roles ("order", parent_id, value) SELECT 1, ins.id, ${OWNER}::enum_approval_rules_requester_roles FROM ins RETURNING 1
      ), logged AS (
        INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, new_value, reason, source, company_id)
        SELECT gen_random_uuid()::text, txid_current(), 'approval_rule', ins.id::text, 'create', 'requesterRoles',
               jsonb_build_object('name', ${OWNER_RULE}::text, 'requesterRoles', jsonb_build_array(${OWNER}::text), 'steps', jsonb_build_array(), 'acknowledge', 'none', 'priority', 5, 'migration', ${NAME}::text),
               ${REASON_RULE}, 'system', ins.company_id
          FROM ins RETURNING 1
      )
      SELECT ins.id FROM ins, (SELECT count(*) FROM roles) r, (SELECT count(*) FROM logged) l`)) as unknown as { rows: Array<{ id: number }> }
    created.push({ company: p.company_id, rule: r.rows[0]!.id })
  }
  payload?.logger?.info?.({ msg: `${NAME}: Owner level (ADR 0026)`, extended, created })
}

export async function down({ db, payload }: MigrateDownArgs): Promise<void> {
  // levels this migration added (newest first): removed while still the Owner's and not the rule's only level; the
  // following levels move back down
  const added = (await db.execute(sql`
    SELECT a.doc_id::int AS rule, (a.new_value ->> 'addedLevel')::int AS level FROM audit_logs a
     WHERE a.doc_type = 'approval_rule' AND a.action::text = 'update' AND a.field = 'steps' AND a.new_value ->> 'migration' = ${NAME}
     ORDER BY a.id DESC`)) as unknown as { rows: Array<{ rule: number; level: number }> }
  let removed = 0
  for (const x of added.rows) {
    const d = (await db.execute(sql`
      DELETE FROM approval_rules_steps s
       WHERE s._parent_id = ${x.rule}::int AND s.level = ${x.level}::numeric AND s.approver_role::text = ${OWNER}
         AND (SELECT count(*) FROM approval_rules_steps s3 WHERE s3._parent_id = ${x.rule}::int) > 1
      RETURNING s.id`)) as unknown as { rows: unknown[] }
    if (d.rows.length === 0) continue
    removed++
    await db.execute(sql`UPDATE approval_rules_steps SET level = level - 1 WHERE _parent_id = ${x.rule}::int AND level > ${x.level}::numeric`)
    await db.execute(reorder(x.rule))
  }
  const r = (await db.execute(sql`
    WITH mine AS (
      SELECT DISTINCT a.doc_id::int AS id FROM audit_logs a
       WHERE a.doc_type = 'approval_rule' AND a.action::text = 'create' AND a.new_value ->> 'migration' = ${NAME}
    ), used AS (
      SELECT m.id FROM mine m WHERE EXISTS (SELECT 1 FROM expense_requests e WHERE e.approval_rule_id = m.id)
    ), off AS (
      UPDATE approval_rules SET active = false, updated_at = now() WHERE id IN (SELECT id FROM used) RETURNING id
    ), del AS (
      DELETE FROM approval_rules WHERE id IN (SELECT id FROM mine) AND id NOT IN (SELECT id FROM used) RETURNING id
    )
    SELECT (SELECT count(*) FROM off)::int AS deactivated, (SELECT count(*) FROM del)::int AS deleted`)) as unknown as {
    rows: Array<{ deactivated: number; deleted: number }>
  }
  payload?.logger?.info?.({ msg: `${NAME} down`, levelsRemoved: removed, ...r.rows[0] })
}
