import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * D1610 (ADR 0030, owner 2026-10-16) "Hapus per baris (soft delete) / Batalkan proyek" — ENUM ONLY, ADDITIVE /
 * staging-safe (same pattern as 20261015_100000_d1310_fundcheck_enums):
 * - `enum_projects_status` += 'dibatalkan' (set only by "Batalkan proyek": reason + cascade, terminal);
 * - `enum_audit_logs_action` += 'soft_delete', 'restore' (the row action "Hapus" and the Admin's "Pulihkan").
 * No row changes value. Its own migration (= its own transaction): Postgres refuses to USE a new enum value in the
 * transaction that added it, and 20261016_200100_d1610_soft_delete adds a CHECK naming 'dibatalkan'.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_projects_status" ADD VALUE IF NOT EXISTS 'dibatalkan' AFTER 'arsip';
  ALTER TYPE "public"."enum_audit_logs_action" ADD VALUE IF NOT EXISTS 'soft_delete' AFTER 'fund_insufficient';
  ALTER TYPE "public"."enum_audit_logs_action" ADD VALUE IF NOT EXISTS 'restore' AFTER 'soft_delete';`)
}

export async function down({}: MigrateDownArgs): Promise<void> {
  // Postgres cannot drop an enum value (and a down-migration run after any row uses one would break on the reload) —
  // hand-written no-op like 20261015_100000_d1310_fundcheck_enums. The extra values are harmless when unused.
}
