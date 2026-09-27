import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * F4 (APK backend, ADR 0010). ADDITIVE / staging-safe (new nullable/defaulted columns only; no
 * row is rewritten, so no guard trigger fires):
 * - expense_requests.sync_rev: content revision of an editable request (`base_rev` of the sync
 *   contract). Existing rows read the column default 1.
 * - receipts.client_uuid (unique): APK offline id of a receipt synced with a draft.
 * - company_settings: latest_app_version, app_download_url, sync_expense_drafts_enabled (app gate,
 *   GET /api/v1/app/config; server-side feature flag of the offline draft sync).
 */

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "expense_requests" ADD COLUMN "sync_rev" numeric DEFAULT 1;
  ALTER TABLE "receipts" ADD COLUMN "client_uuid" varchar;
  ALTER TABLE "company_settings" ADD COLUMN "latest_app_version" varchar;
  ALTER TABLE "company_settings" ADD COLUMN "app_download_url" varchar;
  ALTER TABLE "company_settings" ADD COLUMN "sync_expense_drafts_enabled" boolean DEFAULT true;
  CREATE UNIQUE INDEX "receipts_client_uuid_idx" ON "receipts" USING btree ("client_uuid");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "receipts_client_uuid_idx";
  ALTER TABLE "expense_requests" DROP COLUMN "sync_rev";
  ALTER TABLE "receipts" DROP COLUMN "client_uuid";
  ALTER TABLE "company_settings" DROP COLUMN "latest_app_version";
  ALTER TABLE "company_settings" DROP COLUMN "app_download_url";
  ALTER TABLE "company_settings" DROP COLUMN "sync_expense_drafts_enabled";`)
}
