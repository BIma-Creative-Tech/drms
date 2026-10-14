import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0028 (DRMS 13/10 Phase B) "Transfer antar-PT" — DATA ONLY, hand-written, idempotent, run as <prefix>_owner after
 * 20261014_100200_d1310_intercompany_guard. Per PT (active or not — a PT can be re-activated):
 * 1. the SYSTEM cash-in source "Antar PT" (code `ANTAR-PT`) — the automatic Kas Masuk of a payment from another PT of
 *    the group is posted with it (domain/company-defaults.ts SYSTEM_CASH_IN_SOURCES, so new PTs get it too); skipped
 *    where a source with that code exists (any active flag);
 * 2. the approval rule "Pembayaran antar-PT oleh Finance — Direktur lalu Owner" (Jenis penerima = PT grup, Peran
 *    pemohon = Finance, no "Diketahui", levels Direktur (pk-owner) then Owner (pk-principal), priority 20 — mirror of
 *    the ADR 0027 vendor rule); skipped in a PT that already has an active rule with Jenis penerima = PT grup. A PM's
 *    payment follows the PT's default rule (PM step skipped: he is the project's PM, G1-2); a Direktur's follows
 *    "Pengajuan Direktur" (→ Owner, priority 10).
 * No cash account is designated as "Rekening penerimaan antar-PT" (Finance / Admin of each PT does that). One `create`
 * audit row per inserted source / rule (source `system`, tagged with the PT).
 * Down: the rules this migration created (by its audit rows) are deleted when no request references them, else
 * deactivated; the sources are deactivated (a cash entry may reference them).
 */
const NAME = '20261014_100300_d1310_intercompany_data'
/** Name of the seeded rule (seed/data.ts INTERCOMPANY_FINANCE_RULE_NAME, frozen copy). */
export const INTERCOMPANY_FINANCE_RULE = 'Pembayaran antar-PT oleh Finance — Direktur lalu Owner'
/** System cash-in source of the automatic KM (domain/company-defaults.ts, frozen copy). */
export const INTERCOMPANY_SOURCE = { code: 'ANTAR-PT', name: 'Antar PT' } as const
const REASON = `ADR 0028 (DRMS 13/10 Phase B): transfer antar-PT — aturan persetujuan + sumber kas masuk sistem (migrasi ${NAME})`

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)
  const src = (await db.execute(sql`
    WITH missing AS (
      SELECT c.id FROM companies c
       WHERE NOT EXISTS (SELECT 1 FROM cash_in_sources s WHERE s.company_id = c.id AND s.code = ${INTERCOMPANY_SOURCE.code})
    ), created AS (
      INSERT INTO cash_in_sources (company_id, code, name, active, uuid)
      SELECT m.id, ${INTERCOMPANY_SOURCE.code}, ${INTERCOMPANY_SOURCE.name}, true, gen_random_uuid()::text FROM missing m
      RETURNING id, company_id, code, name
    ), logged AS (
      INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, old_value, new_value, reason, source, company_id)
      SELECT gen_random_uuid()::text, txid_current(), 'cash_in_source', x.id::text, 'create', 'code',
             NULL, jsonb_build_object('v', jsonb_build_object('code', x.code, 'name', x.name, 'active', true, 'migration', ${NAME}::text)), ${REASON}, 'system', x.company_id
        FROM created x
      RETURNING company_id
    )
    SELECT coalesce(array_agg(company_id ORDER BY company_id), '{}') AS created FROM logged`)) as unknown as { rows: Array<{ created: number[] }> }

  const rules = (await db.execute(sql`
    WITH pts AS (
      SELECT c.id FROM companies c
       WHERE NOT EXISTS (SELECT 1 FROM approval_rules r WHERE r.company_id = c.id AND r.active AND r.payee_type::text = 'pt_grup')
    ), ins AS (
      INSERT INTO approval_rules (company_id, name, doc_type, request_type, payee_type, min_amount, max_amount, priority, acknowledge, acknowledge_by,
                                  acknowledge_role, sign_diajukan, sign_dibuat, active, updated_at, created_at)
      SELECT pts.id, ${INTERCOMPANY_FINANCE_RULE}, 'expense_request', 'any', 'pt_grup', 0, NULL, 20, 'none', 'role', NULL, 'required', 'required', true, now(), now()
        FROM pts
      RETURNING id, company_id
    ), roles AS (
      INSERT INTO approval_rules_requester_roles ("order", parent_id, value) SELECT 1, ins.id, 'pk-finance' FROM ins RETURNING 1
    ), steps AS (
      INSERT INTO approval_rules_steps (_order, _parent_id, id, level, approver_role) SELECT s.ord, ins.id, gen_random_uuid()::text, s.ord::numeric, s.role::enum_approval_rules_steps_approver_role
        FROM ins CROSS JOIN (VALUES (1, 'pk-owner'), (2, 'pk-principal')) AS s(ord, role) RETURNING 1
    ), logged AS (
      INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, new_value, reason, source, company_id)
      SELECT gen_random_uuid()::text, txid_current(), 'approval_rule', ins.id::text, 'create', 'payeeType',
             jsonb_build_object('name', ${INTERCOMPANY_FINANCE_RULE}::text, 'payeeType', 'pt_grup', 'requesterRoles', jsonb_build_array('pk-finance'),
                                'steps', jsonb_build_array(jsonb_build_object('level', 1, 'approverRole', 'pk-owner'), jsonb_build_object('level', 2, 'approverRole', 'pk-principal')), 'acknowledge', 'none', 'priority', 20, 'migration', ${NAME}::text),
             ${REASON}, 'system', ins.company_id
        FROM ins RETURNING 1
    )
    SELECT coalesce(array_agg(ins.company_id ORDER BY ins.company_id), '{}') AS companies, (SELECT count(*) FROM roles)::int AS roles,
           (SELECT count(*) FROM steps)::int AS steps, (SELECT count(*) FROM logged)::int AS logged
      FROM ins`)) as unknown as { rows: Array<{ companies: number[]; roles: number; steps: number; logged: number }> }
  payload?.logger?.info?.({ msg: `${NAME}: source ${INTERCOMPANY_SOURCE.code} + rule "${INTERCOMPANY_FINANCE_RULE}" per PT (ADR 0028)`, sourcesFor: src.rows[0]?.created ?? [], ...rules.rows[0] })
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
    ), srcs AS (
      UPDATE cash_in_sources SET active = false, updated_at = now()
       WHERE id IN (SELECT a.doc_id::int FROM audit_logs a WHERE a.doc_type = 'cash_in_source' AND a.action::text = 'create'
                      AND a.new_value -> 'v' ->> 'migration' = ${NAME})
      RETURNING id
    )
    SELECT (SELECT count(*) FROM off)::int AS deactivated, (SELECT count(*) FROM del)::int AS deleted, (SELECT count(*) FROM srcs)::int AS sources`)) as unknown as {
    rows: Array<{ deactivated: number; deleted: number; sources: number }>
  }
  payload?.logger?.info?.({ msg: `${NAME} down`, ...r.rows[0] })
}
