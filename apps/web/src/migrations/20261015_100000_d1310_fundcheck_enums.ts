import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0029 (DRMS 13/10 Phase C) "Cek dana di persetujuan Owner + Pinjaman antar-PT" — ENUM ONLY, ADDITIVE /
 * staging-safe (same pattern as 20261014_100000_d1310_intercompany_enums):
 * - `enum_document_sequences_doc_type` += 'intercompany_loan' (the `PJA/{COMPANY}/{YY}{MM}/{seq}` sequence of the lender PT);
 * - `enum_audit_logs_action` += 'fund_insufficient' (a refused approval / submit / loan step: the PT's available funds
 *   are short — written in its own transaction like `access_denied`).
 * No row changes value. Its own migration (= its own transaction): Postgres refuses to USE a new enum value in the
 * transaction that added it, and the data migration 20261015_100300 inserts the PJA sequences.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_document_sequences_doc_type" ADD VALUE IF NOT EXISTS 'intercompany_loan' AFTER 'project_loan';
  ALTER TYPE "public"."enum_audit_logs_action" ADD VALUE IF NOT EXISTS 'fund_insufficient' AFTER 'renumbered';`)
}

export async function down({}: MigrateDownArgs): Promise<void> {
  // Postgres cannot drop an enum value (and a down-migration run after any row uses one would break on the reload) —
  // hand-written no-op like 20261014_100000_d1310_intercompany_enums. The extra values are harmless when unused.
}
