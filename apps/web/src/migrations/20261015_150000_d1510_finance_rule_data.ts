import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Owner decision 2026-10-15 — DATA ONLY, hand-written, idempotent, run as <prefix>_owner. Per PT (active or not — a PT
 * can be re-activated) the approval rule "Pengajuan Finance — Direktur lalu Owner": Jenis penerima = Karyawan, Peran
 * pemohon = Finance, every request type (Reimburse + Pengajuan Baru), no "Diketahui", levels Direktur (pk-owner) then
 * Owner (pk-principal), priority 20 — the shape of the ADR 0027 / 0028 Finance rules. Finance's own requests no longer
 * pass the PM project step; Finance still only transfers afterwards. A requester who is also Direktur keeps "Pengajuan
 * Direktur" (priority 10), the Owner "Pengajuan Owner" (5).
 * Skipped in a PT that already has a rule with that name, or an active expense rule with Jenis penerima = Karyawan and
 * Peran pemohon Finance (an Admin made one). Runs before 20261015_200000_d1510_approval_reroute, so a Finance request
 * re-routed there gets this rule (the same result as a submit today). Submitted requests keep their snapshot otherwise.
 * One `create` audit row per inserted rule (source `system`, tagged with the PT).
 * Down: the rules this migration created (by its audit rows) are deleted when no request references them, else
 * deactivated.
 */
const NAME = '20261015_150000_d1510_finance_rule_data'
/** Name of the seeded rule (seed/data.ts FINANCE_RULE_NAME, frozen copy). */
export const FINANCE_RULE = 'Pengajuan Finance — Direktur lalu Owner'
const REASON = `Keputusan owner 2026-10-15: pengajuan Finance (Reimburse + Pengajuan Baru) → Direktur → Owner, tanpa PM project (migrasi ${NAME})`

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)
  const rules = (await db.execute(sql`
    WITH pts AS (
      SELECT c.id FROM companies c
       WHERE NOT EXISTS (SELECT 1 FROM approval_rules r WHERE r.company_id = c.id AND r.name = ${FINANCE_RULE})
         AND NOT EXISTS (SELECT 1 FROM approval_rules r JOIN approval_rules_requester_roles rr ON rr.parent_id = r.id
                          WHERE r.company_id = c.id AND r.active AND r.doc_type::text = 'expense_request'
                            AND r.payee_type::text = 'karyawan' AND rr.value::text = 'pk-finance')
    ), ins AS (
      INSERT INTO approval_rules (company_id, name, doc_type, request_type, payee_type, min_amount, max_amount, priority, acknowledge, acknowledge_by,
                                  acknowledge_role, sign_diajukan, sign_dibuat, active, updated_at, created_at)
      SELECT pts.id, ${FINANCE_RULE}, 'expense_request', 'any', 'karyawan', 0, NULL, 20, 'none', 'role', NULL, 'required', 'required', true, now(), now()
        FROM pts
      RETURNING id, company_id
    ), roles AS (
      INSERT INTO approval_rules_requester_roles ("order", parent_id, value) SELECT 1, ins.id, 'pk-finance' FROM ins RETURNING 1
    ), steps AS (
      INSERT INTO approval_rules_steps (_order, _parent_id, id, level, approver_role) SELECT s.ord, ins.id, gen_random_uuid()::text, s.ord::numeric, s.role::enum_approval_rules_steps_approver_role
        FROM ins CROSS JOIN (VALUES (1, 'pk-owner'), (2, 'pk-principal')) AS s(ord, role) RETURNING 1
    ), logged AS (
      INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, new_value, reason, source, company_id)
      SELECT gen_random_uuid()::text, txid_current(), 'approval_rule', ins.id::text, 'create', 'requesterRoles',
             jsonb_build_object('name', ${FINANCE_RULE}::text, 'payeeType', 'karyawan', 'requestType', 'any', 'requesterRoles', jsonb_build_array('pk-finance'),
                                'steps', jsonb_build_array(jsonb_build_object('level', 1, 'approverRole', 'pk-owner'), jsonb_build_object('level', 2, 'approverRole', 'pk-principal')), 'acknowledge', 'none', 'priority', 20, 'migration', ${NAME}::text),
             ${REASON}, 'system', ins.company_id
        FROM ins RETURNING 1
    )
    SELECT coalesce(array_agg(ins.company_id ORDER BY ins.company_id), '{}') AS companies, (SELECT count(*) FROM roles)::int AS roles,
           (SELECT count(*) FROM steps)::int AS steps, (SELECT count(*) FROM logged)::int AS logged
      FROM ins`)) as unknown as { rows: Array<{ companies: number[]; roles: number; steps: number; logged: number }> }
  payload?.logger?.info?.({ msg: `${NAME}: rule "${FINANCE_RULE}" per PT (owner decision 2026-10-15)`, ...rules.rows[0] })
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
    SELECT (SELECT count(*) FROM off)::int AS deactivated, (SELECT count(*) FROM del)::int AS deleted`)) as unknown as {
    rows: Array<{ deactivated: number; deleted: number }>
  }
  payload?.logger?.info?.({ msg: `${NAME} down`, ...r.rows[0] })
}
