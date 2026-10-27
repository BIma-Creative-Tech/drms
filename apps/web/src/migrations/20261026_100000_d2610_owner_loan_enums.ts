import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 26/10 #1 (ADR 0031 amendment 2026-10-26) "Instruksi pinjam antar proyek" — ENUM ONLY, ADDITIVE (pattern of
 * 20261024_400000_d2410_loan_enums): `enum_project_loans_submitter_role` += 'owner' — the inter-project loan the final
 * decider of an expense request instructed to the request project's short cash account (born approved).
 * Its own migration (= its own transaction): Postgres refuses to USE a new enum value in the transaction that added it.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_project_loans_submitter_role" ADD VALUE IF NOT EXISTS 'owner' AFTER 'finance';`)
}

export async function down({}: MigrateDownArgs): Promise<void> {
  // Postgres cannot drop an enum value — no-op like 20261024_400000_d2410_loan_enums (harmless when unused).
}
