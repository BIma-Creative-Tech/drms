import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 24/10 #10–#12 (ADR 0022 / 0031 amendment 2026-10-24), DATA ONLY, hand-written, IDEMPOTENT, run as
 * <prefix>_owner after 20261024_400100_d2410_loan_schema and BEFORE the guards (20261024_400300) — in-flight loans:
 *
 * 1. A manual loan `pending_approval` was waiting for the (single) Direktur decision → `approval_level = 1`: it follows
 *    the new path Direktur → Owner (the Direktur's approval no longer finalises it). One audit row per loan.
 * 2. Nothing else changes: an APPROVED loan keeps its approval; when it is cash-backed and not disbursed yet it simply
 *    appears as a transfer order in "Antrian Transfer" (read model, no column); an approved manual loan whose two
 *    projects shared one account stays a claim (`cash_backed` is frozen at the approval). Existing repayments are
 *    executed repayments (`posted`). `submitter_role` stays NULL on existing loans (= the borrower PM, the only filer
 *    before; a terminal row is immutable anyway).
 * Down: the level goes back to 0 for loans still pending at level 1 (a loan already at level 2 keeps it: its Owner step
 * cannot be undone by a migration).
 */
const NAME = '20261024_400200_d2410_loan_data'
const REASON = `DRMS 24/10 #10: pinjaman antar project yang menunggu Direktur mengikuti alur baru Direktur → Owner (migrasi ${NAME})`

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
    WITH upd AS (
      UPDATE project_loans SET approval_level = 1
       WHERE status::text = 'pending_approval' AND coalesce(approval_level, 0) = 0
      RETURNING id, doc_no, company_id
    ), logged AS (
      INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, doc_no, action, field, old_value, new_value, reason, source, company_id)
      SELECT gen_random_uuid()::text, txid_current(), 'project_loan', upd.id::text, upd.doc_no, 'update', 'approvalLevel', '0'::jsonb,
             jsonb_build_object('approvalLevel', 1, 'levels', jsonb_build_array('Direktur', 'Owner'), 'migration', ${NAME}::text),
             ${REASON}::text, 'system', upd.company_id
        FROM upd RETURNING 1
    )
    SELECT (SELECT count(*) FROM upd)::int AS loans, (SELECT count(*) FROM logged)::int AS logged`)) as unknown as { rows: Array<{ loans: number }> }
  payload?.logger?.info?.({ msg: `${NAME}: pending loans moved to the two-level flow`, loans: r.rows[0]?.loans ?? 0 })
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`UPDATE project_loans SET approval_level = 0 WHERE status::text = 'pending_approval' AND approval_level = 1`)
}
