import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0028 (DRMS 13/10 Phase B) "Transfer antar-PT" — ENUM ONLY, ADDITIVE / staging-safe (same pattern as
 * 20261013_630000_d1310_owner_role): the new values of the Postgres enums behind Payload selects —
 * - `enum_expense_requests_payee_type` += 'pt_grup' ("PT grup" = Pembayaran antar-PT);
 * - `enum_approval_rules_payee_type` += 'pt_grup' (rule condition "Jenis penerima");
 * - `enum_cash_entries_source_type` += 'intercompany' (the automatic Kas Masuk in the receiving PT).
 * No row changes value. Its own migration (= its own transaction): Postgres refuses to USE a new enum value in the
 * transaction that added it, and the schema / guard / data migrations that follow (20261014_1001xx–1003xx) do.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_expense_requests_payee_type" ADD VALUE IF NOT EXISTS 'pt_grup' AFTER 'vendor';
  ALTER TYPE "public"."enum_approval_rules_payee_type" ADD VALUE IF NOT EXISTS 'pt_grup' AFTER 'vendor';
  ALTER TYPE "public"."enum_cash_entries_source_type" ADD VALUE IF NOT EXISTS 'intercompany' AFTER 'opening';`)
}

export async function down({}: MigrateDownArgs): Promise<void> {
  // Postgres cannot drop an enum value (and a down-migration run after any row uses one would break on the reload) —
  // hand-written no-op like 20261013_630000_d1310_owner_role. The extra values are harmless when unused.
}
