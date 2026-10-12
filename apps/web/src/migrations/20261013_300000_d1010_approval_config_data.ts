import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0024 (owner decision 2026-10-11), DATA ONLY, hand-written, idempotent, run as <prefix>_owner after
 * 20261013_300000_d1010_approval_config_guard: per PT, the rule "Pengajuan Direktur" (Peran pemohon =
 * Direktur, no "Diketahui", NO approval level = "Tanpa persetujuan — langsung ke antrian transfer Finance",
 * priority 10 < the default's 100) — ONLY when the PT still has the seeded default rules: every ACTIVE
 * expense-request rule of the PT is one of the two seeded default shapes (no condition: all types, from
 * Rp 0, no maximum, no category / project / cost center / requester role) —
 *   - ADR 0021 "PM project → Direktur": Diketahui required by `scope_manager`, one level `pk-owner`;
 *   - ADR 0013 "Direktur → Finance": Diketahui required by role `pk-owner`, one level `pk-finance`
 *     (the Admin switches it to the ADR 0021 shape in the UI, ADR 0021 rollout step 3) —
 * and the PT has no active zero-step rule and no active rule named "Pengajuan Direktur" yet. Any other PT is listed in the
 * migrate log as customised (the Admin decides there). Inserted in ONE statement (the zero-step guard is
 * checked at commit) with one `create` audit row per rule (source `system`, reason below).
 * Down: the rules this migration created (by its audit rows) are deleted when no request references them,
 * else deactivated (a zero-step rule must never stay active for the previous image).
 */
const NAME = '20261013_300000_d1010_approval_config_data'
/** Name of the seeded rule (seed/data.ts DIREKTUR_RULE_NAME, frozen copy). */
export const DIREKTUR_RULE = 'Pengajuan Direktur'
const REASON = `ADR 0024 keputusan owner 2026-10-11: pengajuan Direktur sendiri tanpa persetujuan, langsung ke antrian transfer Finance (migrasi ${NAME}; PT masih memakai aturan default)`

type PtRow = { company_id: number; short_code: string | null; active_rules: number; default_rules: number; zero_rules: number; named: number }

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)

  const pts = (await db.execute(sql`
    WITH steps AS (
      SELECT s._parent_id AS rid, count(*)::int AS n,
             bool_and(s.level = 1 AND s.approver_user_id IS NULL) AS l1, min(s.approver_role::text) AS role
        FROM approval_rules_steps s GROUP BY s._parent_id
    ), rules AS (
      SELECT r.id, r.company_id, r.active, r.name,
             coalesce(st.n, 0) AS n_steps,
             (r.doc_type::text = 'expense_request' AND r.request_type::text = 'any' AND coalesce(r.min_amount, 0) = 0 AND r.max_amount IS NULL
              AND r.category_id IS NULL AND r.project_id IS NULL AND r.cost_center_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM approval_rules_requester_roles x WHERE x.parent_id = r.id)
              AND r.acknowledge::text = 'required' AND coalesce(st.n, 0) = 1 AND st.l1
              AND ((r.acknowledge_by::text = 'scope_manager' AND st.role = 'pk-owner')
                OR (r.acknowledge_by::text = 'role' AND r.acknowledge_role::text = 'pk-owner' AND st.role = 'pk-finance'))) AS is_default
        FROM approval_rules r LEFT JOIN steps st ON st.rid = r.id
       WHERE r.doc_type::text = 'expense_request'
    )
    SELECT c.id AS company_id, c.short_code,
           count(*) FILTER (WHERE r.active)::int AS active_rules,
           count(*) FILTER (WHERE r.active AND r.is_default)::int AS default_rules,
           count(*) FILTER (WHERE r.active AND r.n_steps = 0)::int AS zero_rules,
           count(*) FILTER (WHERE r.active AND r.name = ${DIREKTUR_RULE})::int AS named
      FROM companies c LEFT JOIN rules r ON r.company_id = c.id
     GROUP BY c.id, c.short_code ORDER BY c.id`)) as unknown as { rows: PtRow[] }

  const seeded: Array<{ company: number; shortCode: string | null; rule: number }> = []
  const customised: Array<{ company: number; shortCode: string | null; why: string }> = []
  for (const p of pts.rows) {
    const why =
      p.active_rules === 0
        ? 'tanpa aturan aktif'
        : p.default_rules !== p.active_rules
          ? 'aturan sudah diubah Admin'
          : p.zero_rules > 0 || p.named > 0
            ? 'aturan "Pengajuan Direktur" / tanpa level sudah ada'
            : null
    if (why) {
      customised.push({ company: p.company_id, shortCode: p.short_code, why })
      continue
    }
    // one statement: rule + requester role + audit (the deferred zero-step guard sees the role row at commit)
    const r = (await db.execute(sql`
      WITH ins AS (
        INSERT INTO approval_rules (company_id, name, doc_type, request_type, min_amount, max_amount, priority, acknowledge, acknowledge_by, acknowledge_role,
                                    sign_diajukan, sign_dibuat, active, updated_at, created_at)
        VALUES (${p.company_id}, ${DIREKTUR_RULE}, 'expense_request', 'any', 0, NULL, 10, 'none', 'role', NULL, 'required', 'required', true, now(), now())
        RETURNING id, company_id
      ), roles AS (
        INSERT INTO approval_rules_requester_roles ("order", parent_id, value) SELECT 1, ins.id, 'pk-owner' FROM ins RETURNING 1
      ), logged AS (
        INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, new_value, reason, source, company_id)
        SELECT gen_random_uuid()::text, txid_current(), 'approval_rule', ins.id::text, 'create', 'requesterRoles',
               jsonb_build_object('name', ${DIREKTUR_RULE}::text, 'requesterRoles', jsonb_build_array('pk-owner'), 'steps', jsonb_build_array(), 'acknowledge', 'none', 'priority', 10, 'migration', ${NAME}::text),
               ${REASON}, 'system', ins.company_id
          FROM ins RETURNING 1
      )
      SELECT ins.id FROM ins, (SELECT count(*) FROM roles) r, (SELECT count(*) FROM logged) l`)) as unknown as { rows: Array<{ id: number }> }
    seeded.push({ company: p.company_id, shortCode: p.short_code, rule: r.rows[0]!.id })
  }
  payload?.logger?.info?.({ msg: `${NAME}: rule "${DIREKTUR_RULE}" per PT (ADR 0024)`, seeded, customisedKept: customised })
}

export async function down({ db, payload }: MigrateDownArgs): Promise<void> {
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
    SELECT (SELECT count(*) FROM off)::int AS deactivated, (SELECT count(*) FROM del)::int AS deleted`)) as unknown as { rows: Array<{ deactivated: number; deleted: number }> }
  payload?.logger?.info?.({ msg: `${NAME} down`, ...r.rows[0] })
}
