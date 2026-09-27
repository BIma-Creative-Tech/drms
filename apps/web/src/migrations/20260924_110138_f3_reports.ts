import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * F3 (dashboards/reports). ADDITIVE / staging-safe: one new column with a constant default (PG 11+
 * "fast default": no table rewrite, no row update → no guard trigger fires).
 * - company_settings.lpj_due_days: an Uang Muka without LPJ becomes "LPJ terlambat" (K-12b) after
 *   this many days since its first posted advance transfer (Q-F3-1, user 2026-09-24: default 7).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "company_settings" ADD COLUMN "lpj_due_days" numeric DEFAULT 7 NOT NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "company_settings" DROP COLUMN "lpj_due_days";`)
}
