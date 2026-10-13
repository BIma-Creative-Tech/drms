import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0025 (DRMS 13/10 Wave 4, decision D3), DATA ONLY, hand-written, idempotent, run as <prefix>_owner after
 * 20261014_100100_d1310_vendor_payments_guard: per PT the approval rule "Pembayaran vendor oleh Finance — Direktur"
 * (Jenis penerima = Vendor, Peran pemohon = Finance, no "Diketahui", one level Direktur, priority 20) — a vendor
 * payment filed by Finance goes to the Direktur only. Skipped in a PT that already has an active rule with Jenis
 * penerima = Vendor (none before this migration; idempotent re-run). PM vendor payments need no rule: the PT's default
 * rule applies and the PM step is skipped because the filer is the project's PM (G1-2). Employee payments are untouched
 * (the rule matches vendor payments only). One `create` audit row per rule (source `system`).
 * Down: the rules this migration created (by its audit rows) are deleted when no request references them, else
 * deactivated.
 */
const NAME = '20261014_100200_d1310_vendor_payments_data'
/** Name of the seeded rule (seed/data.ts VENDOR_FINANCE_RULE_NAME, frozen copy). */
export const VENDOR_FINANCE_RULE = 'Pembayaran vendor oleh Finance — Direktur'
const REASON = `ADR 0025 (DRMS 13/10 D3): pembayaran vendor oleh Finance langsung ke persetujuan Direktur (migrasi ${NAME})`

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)
  const r = (await db.execute(sql`
    WITH pts AS (
      SELECT c.id FROM companies c
       WHERE NOT EXISTS (SELECT 1 FROM approval_rules r WHERE r.company_id = c.id AND r.active AND r.payee_type::text = 'vendor')
    ), ins AS (
      INSERT INTO approval_rules (company_id, name, doc_type, request_type, payee_type, min_amount, max_amount, priority, acknowledge, acknowledge_by,
                                  acknowledge_role, sign_diajukan, sign_dibuat, active, updated_at, created_at)
      SELECT pts.id, ${VENDOR_FINANCE_RULE}, 'expense_request', 'any', 'vendor', 0, NULL, 20, 'none', 'role', NULL, 'required', 'required', true, now(), now()
        FROM pts
      RETURNING id, company_id
    ), roles AS (
      INSERT INTO approval_rules_requester_roles ("order", parent_id, value) SELECT 1, ins.id, 'pk-finance' FROM ins RETURNING 1
    ), steps AS (
      INSERT INTO approval_rules_steps (_order, _parent_id, id, level, approver_role) SELECT 1, ins.id, gen_random_uuid()::text, 1, 'pk-owner' FROM ins RETURNING 1
    ), logged AS (
      INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, new_value, reason, source, company_id)
      SELECT gen_random_uuid()::text, txid_current(), 'approval_rule', ins.id::text, 'create', 'payeeType',
             jsonb_build_object('name', ${VENDOR_FINANCE_RULE}::text, 'payeeType', 'vendor', 'requesterRoles', jsonb_build_array('pk-finance'),
                                'steps', jsonb_build_array(jsonb_build_object('level', 1, 'approverRole', 'pk-owner')), 'acknowledge', 'none', 'priority', 20, 'migration', ${NAME}::text),
             ${REASON}, 'system', ins.company_id
        FROM ins RETURNING 1
    )
    SELECT coalesce(array_agg(ins.company_id ORDER BY ins.company_id), '{}') AS companies, (SELECT count(*) FROM roles)::int AS roles,
           (SELECT count(*) FROM steps)::int AS steps, (SELECT count(*) FROM logged)::int AS logged
      FROM ins`)) as unknown as { rows: Array<{ companies: number[]; roles: number; steps: number; logged: number }> }
  payload?.logger?.info?.({ msg: `${NAME}: rule "${VENDOR_FINANCE_RULE}" per PT (ADR 0025)`, ...r.rows[0] })
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
