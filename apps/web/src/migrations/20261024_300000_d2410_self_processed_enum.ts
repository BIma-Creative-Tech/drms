import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * D2410 (user decision 2026-10-24, "Finance self LPJ/receipts") — ENUM ONLY, ADDITIVE (pattern of 20261021_100000_d2110_pb_enums):
 * `enum_audit_logs_action` += 'self_processed' — a Finance receipt / flag / LPJ / settlement action on a request where the
 * Finance user is the requester or creator (allowed since D2410; history "diproses oleh pemohon sendiri").
 * Its own migration (= its own transaction): Postgres refuses to USE a new enum value in the transaction that added it.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_audit_logs_action" ADD VALUE IF NOT EXISTS 'self_processed' AFTER 'auto_create';`)
}

export async function down({}: MigrateDownArgs): Promise<void> {
  // Postgres cannot drop an enum value — no-op like 20261021_100000_d2110_pb_enums (harmless when unused).
}
