import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * QA report 2026-10-08, QA-11 — every PT needs the system cash-in source "Pengembalian LPJ" (code `LPJ`):
 * the LPJ refund (POST …/settle, surplus) posts its KM with it. It used to come only from the seed /
 * go-live import, so a PT created in the admin had none and the settlement failed with 409 at the very
 * last step. New PTs get it from `copyCompanyDefaults` (domain/company-defaults.ts); this migration
 * backfills the existing ones.
 *
 * DATA ONLY, hand-written, idempotent, run as <prefix>_owner: for every PT (active or not — a PT can be
 * re-activated) WITHOUT a `cash_in_sources` row of code `LPJ` (any active flag: a deliberately
 * deactivated source is left alone), one row `LPJ` / "Pengembalian LPJ" (active, fresh uuid) is inserted.
 * Audited: one `create` audit row per inserted source (doc type `cash_in_source`, source `system`, tagged
 * with the PT, reason naming QA-11 and this migration), in this migration's transaction; the PT ids go
 * to the migrate log. A re-run finds every PT covered → inserts nothing.
 * Down: deliberate no-op — a source may already be referenced by cash entries (FK), and a missing
 * source is exactly the bug.
 */
const NAME = '20261008_120100_qa_flow_lpj_source'
const LPJ_SOURCE = { code: 'LPJ', name: 'Pengembalian LPJ' } as const
const REASON = `QA-11: sumber kas masuk sistem "${LPJ_SOURCE.name}" (kode ${LPJ_SOURCE.code}) wajib ada per PT (migrasi ${NAME})`

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
    WITH missing AS (
      SELECT c.id FROM companies c
       WHERE NOT EXISTS (SELECT 1 FROM cash_in_sources s WHERE s.company_id = c.id AND s.code = ${LPJ_SOURCE.code})
    ), created AS (
      INSERT INTO cash_in_sources (company_id, code, name, active, uuid)
      SELECT m.id, ${LPJ_SOURCE.code}, ${LPJ_SOURCE.name}, true, gen_random_uuid()::text FROM missing m
      RETURNING id, company_id, code, name
    ), logged AS (
      INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, old_value, new_value, reason, source, company_id)
      SELECT gen_random_uuid()::text, txid_current(), 'cash_in_source', x.id::text, 'create', 'code',
             NULL, jsonb_build_object('v', jsonb_build_object('code', x.code, 'name', x.name, 'active', true)), ${REASON}, 'system', x.company_id
        FROM created x
      RETURNING company_id
    )
    SELECT coalesce(array_agg(company_id ORDER BY company_id), '{}') AS created FROM logged`)) as unknown as { rows: Array<{ created: number[] }> }
  payload?.logger?.info?.({ msg: `${NAME}: cash-in source ${LPJ_SOURCE.code} backfilled`, createdForCompanyIds: res.rows[0]?.created ?? [] })
}

export async function down(_args: MigrateDownArgs): Promise<void> {}
