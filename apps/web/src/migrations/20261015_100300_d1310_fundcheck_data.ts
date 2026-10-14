import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0029 (DRMS 13/10 Phase C) — DATA ONLY, hand-written, idempotent, run as <prefix>_owner after
 * 20261015_100200_d1310_fundcheck_guard. Per PT (active or not — a PT can be re-activated):
 * - the document sequence of "Pinjaman antar-PT": doc type `intercompany_loan`, code `PJA`, pattern
 *   `PJA/{COMPANY}/{YY}{MM}/{seq}` (`{COMPANY}` = the LENDER PT, which issues the money and holds the receivable),
 *   monthly reset, padding 4, start 1 — the D5 shape from day one (domain/numbering.ts DEFAULT_SEQUENCES, so new PTs and
 *   the seed get it too); skipped where the PT already has one. `PJA` is free (`PJ` = ADR 0022 project loan).
 * `companies.fund_check_enabled` stays false everywhere (group admin switches it on per PT after the bank
 * reconciliation). Notification texts are code defaults (domain/intercompany/loan-rules.ts), editable as
 * `notification-templates` rows of the same event — no row is created here.
 * Down: the PJA sequences are removed while no loan exists.
 */
const NAME = '20261015_100300_d1310_fundcheck_data'

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
    WITH ins AS (
      INSERT INTO document_sequences (company_id, doc_type, doc_code, pattern, reset_policy, padding, start_at, timezone, active)
      SELECT c.id, 'intercompany_loan', 'PJA', 'PJA/{COMPANY}/{YY}{MM}/{seq}', 'monthly', 4, 1, coalesce(nullif(c.timezone, ''), 'Asia/Makassar'), true
        FROM companies c
       WHERE NOT EXISTS (SELECT 1 FROM document_sequences d WHERE d.company_id = c.id AND d.doc_type::text = 'intercompany_loan')
      RETURNING company_id
    )
    SELECT coalesce(array_agg(company_id ORDER BY company_id), '{}') AS created FROM ins`)) as unknown as { rows: Array<{ created: number[] }> }
  payload?.logger?.info?.({ msg: `${NAME}: PJA sequence per PT (ADR 0029)`, createdFor: r.rows[0]?.created ?? [] })
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF EXISTS (SELECT 1 FROM intercompany_loans) THEN
        RAISE EXCEPTION '20261015_100300_d1310_fundcheck_data down: inter-PT loans exist — restore the pre-deploy dump instead';
      END IF;
    END
    $pk$;
    DELETE FROM document_sequences WHERE doc_type::text = 'intercompany_loan';`)
}
