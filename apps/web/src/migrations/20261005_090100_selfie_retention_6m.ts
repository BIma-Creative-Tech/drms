import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Q-33 owner decision 2026-10-05: attendance selfies are kept 6 months (was the proposed default 12, never decided).
 * DATA ONLY, hand-written, idempotent, run as <prefix>_owner (after `20261005_090000_privacy_notice`, which changed the
 * column DEFAULT to 6 for new PTs).
 *
 * Moves `companies.selfie_retention_months` 12 → 6 for every PT whose value is still the UNTOUCHED old default:
 * - value = 12, and
 * - nobody ever changed it: no `update` audit row of field `selfieRetentionMonths` for that PT (doc type `company`),
 *   and for the PT created from the former global by MC1 (lowest id) none of the global (doc type
 *   `company_settings`) either. A PT where an Admin/Direktur deliberately chose 12 (or anything else) is left alone.
 * `selfie_retention_delete_enabled` is NOT touched: switching the deletion on stays an owner action in the admin.
 *
 * Audited: one `update` audit row per moved PT (field `selfieRetentionMonths`, 12 → 6, source `system`, tagged with
 * the PT, reason naming Q-33 and this migration), in this migration's transaction; the counts go to the migrate log.
 * A re-run finds no PT at 12 that is untouched by this migration's own rows → changes nothing.
 * Down: deliberate no-op — the old default was never a decision, and reverting would contradict the privacy notice.
 */
const NAME = '20261005_090100_selfie_retention_6m'
const OLD_DEFAULT = 12
const NEW_DEFAULT = 6
const REASON = `Q-33 keputusan owner 2026-10-05: retensi selfie absensi ${NEW_DEFAULT} bulan (migrasi ${NAME}; nilai lama ${OLD_DEFAULT} = default yang belum pernah diubah)`

/** Integer constants inlined as SQL literals (untyped bind parameters break `jsonb_build_object`). */
const OLD = sql.raw(String(Math.trunc(OLD_DEFAULT)))
const NEW = sql.raw(String(Math.trunc(NEW_DEFAULT)))

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)
  const res = (await db.execute(sql`
    WITH touched AS (
      SELECT DISTINCT a.doc_id FROM audit_logs a
       WHERE a.doc_type = 'company' AND a.field = 'selfieRetentionMonths' AND a.action = 'update' AND a.doc_id IS NOT NULL
    ), global_touched AS (
      SELECT EXISTS (
        SELECT 1 FROM audit_logs a WHERE a.doc_type = 'company_settings' AND a.field = 'selfieRetentionMonths' AND a.action = 'update'
      ) AS t
    ), moved AS (
      UPDATE companies c
         SET selfie_retention_months = ${NEW}, updated_at = now()
       WHERE c.selfie_retention_months = ${OLD}
         AND c.id::text NOT IN (SELECT doc_id FROM touched)
         AND NOT (c.id = (SELECT min(id) FROM companies) AND (SELECT t FROM global_touched))
      RETURNING c.id
    ), logged AS (
      INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, old_value, new_value, reason, source, company_id)
      SELECT gen_random_uuid()::text, txid_current(), 'company', m.id::text, 'update', 'selfieRetentionMonths',
             jsonb_build_object('v', ${OLD}), jsonb_build_object('v', ${NEW}), ${REASON}, 'system', m.id
        FROM moved m
      RETURNING company_id
    )
    SELECT (SELECT coalesce(array_agg(company_id ORDER BY company_id), '{}') FROM logged) AS moved,
           (SELECT coalesce(array_agg(id ORDER BY id), '{}') FROM companies
             WHERE selfie_retention_months = ${OLD} AND id NOT IN (SELECT company_id FROM logged)) AS kept`)) as unknown as {
    rows: Array<{ moved: number[]; kept: number[] }>
  }
  const row = res.rows[0] ?? { moved: [], kept: [] }
  payload?.logger?.info?.({
    msg: `${NAME}: selfie retention ${OLD_DEFAULT} → ${NEW_DEFAULT} months`,
    movedCompanyIds: row.moved,
    keptAt12CompanyIds: row.kept, // deliberately set to 12 by an Admin/Direktur (audit trail) → unchanged
  })
}

export async function down(_args: MigrateDownArgs): Promise<void> {}
