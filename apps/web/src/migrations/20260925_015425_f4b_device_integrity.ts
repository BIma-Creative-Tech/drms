import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * F4b (ADR 0010 decision 10, QM-4): device integrity signals reported by the APK at register.
 * ADDITIVE / staging-safe: new nullable/defaulted columns + one index on `devices`; no row is
 * rewritten. Existing grants on `devices` cover the new columns (table-level privileges).
 */

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "devices" ADD COLUMN "integrity_risk" boolean DEFAULT false;
  ALTER TABLE "devices" ADD COLUMN "integrity_rooted" boolean;
  ALTER TABLE "devices" ADD COLUMN "integrity_emulator" boolean;
  ALTER TABLE "devices" ADD COLUMN "integrity_developer_mode" boolean;
  ALTER TABLE "devices" ADD COLUMN "integrity_adb_enabled" boolean;
  ALTER TABLE "devices" ADD COLUMN "integrity_mock_location" boolean;
  ALTER TABLE "devices" ADD COLUMN "integrity_checked_at" timestamp(3) with time zone;
  CREATE INDEX "devices_integrity_risk_idx" ON "devices" USING btree ("integrity_risk");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "devices_integrity_risk_idx";
  ALTER TABLE "devices" DROP COLUMN "integrity_risk";
  ALTER TABLE "devices" DROP COLUMN "integrity_rooted";
  ALTER TABLE "devices" DROP COLUMN "integrity_emulator";
  ALTER TABLE "devices" DROP COLUMN "integrity_developer_mode";
  ALTER TABLE "devices" DROP COLUMN "integrity_adb_enabled";
  ALTER TABLE "devices" DROP COLUMN "integrity_mock_location";
  ALTER TABLE "devices" DROP COLUMN "integrity_checked_at";`)
}
