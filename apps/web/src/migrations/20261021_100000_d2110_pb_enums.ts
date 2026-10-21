import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0031 (DRMS 21/10) "Pusat Biaya = akun kas" — ENUM ONLY, ADDITIVE (pattern of 20261014_100000_d1310_intercompany_enums):
 * - `enum_cash_entries_source_type` += 'project_loan' (the cash legs of an inter-project loan: disbursement, the
 *   automatic loan of a transfer paid from another account, repayments);
 * - `enum_audit_logs_action` += 'disburse' (Finance "Cairkan"), 'auto_create' (the automatic loan of a transfer).
 * Its own migration (= its own transaction): Postgres refuses
 * to USE a new enum value in the transaction that added it, and the guard migration that follows (20261021_100200) does.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_cash_entries_source_type" ADD VALUE IF NOT EXISTS 'project_loan' AFTER 'intercompany';
  ALTER TYPE "public"."enum_audit_logs_action" ADD VALUE IF NOT EXISTS 'disburse' AFTER 'restore';
  ALTER TYPE "public"."enum_audit_logs_action" ADD VALUE IF NOT EXISTS 'auto_create' AFTER 'disburse';`)
}

export async function down({}: MigrateDownArgs): Promise<void> {
  // Postgres cannot drop an enum value — no-op like 20261014_100000_d1310_intercompany_enums (harmless when unused).
}
