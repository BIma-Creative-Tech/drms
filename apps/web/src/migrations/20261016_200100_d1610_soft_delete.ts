import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * D1610 (ADR 0030, owner 2026-10-16) "Hapus per baris (soft delete) / Batalkan proyek" — schema part, run as
 * <prefix>_owner after 20261016_200000_d1610_soft_delete_enums (snapshot of the Payload schema in the .json: the
 * Payload-managed columns below + every earlier enum value).
 *
 * Payload fields (domain/soft-delete/collection.ts `softDeleteFields`, on the registry's collections — frozen copy of
 * the table list below):
 * - `is_deleted` boolean DEFAULT false (true = dihapus; index), `deleted_at`, `deleted_by_id` → users (FK set null,
 *   index), `delete_reason`; written ONLY by domain/soft-delete/service.ts (one UPDATE + audit `soft_delete` /
 *   `restore`). Existing rows: false (nothing is deleted by this migration).
 * - projects: `cancel_reason`, `cancelled_at`, `cancelled_by_id` → users ("Batalkan proyek", domain/projects/cancel.ts).
 * Hand-written guards (not in the Payload snapshot):
 * - CHECK `<table>_soft_delete_state`: a deleted row carries its time and a reason (≥ 3 characters);
 * - CHECK `projects_cancel_state`: status 'dibatalkan' ⇔ reason + time present.
 * ADDITIVE for the previous image: it never reads or writes the new columns; the defaults fill them, and the old image
 * keeps showing soft-deleted rows (harmless — a rollback only un-hides them).
 * Down: drops the columns (the deletion flags are lost — the audit log keeps every soft_delete / restore row); refused
 * while a project is 'dibatalkan' (the status cannot be represented without its columns — restore the dump instead).
 */
export const SOFT_DELETE_TABLES = [
  'banks',
  'uoms',
  'clients',
  'vendors',
  'vendor_bank_accounts',
  'employees',
  'employee_bank_accounts',
  'sites',
  'cost_centers',
  'expense_categories',
  'urgency_levels',
  'resource_types',
  'vehicles',
  'cash_in_sources',
  'cash_accounts',
  'work_schedules',
  'stage_templates',
  'rap_templates',
  'projects',
  'expense_requests',
] as const

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  DO $pk$
  BEGIN
    IF current_user !~ '_owner$' THEN
      RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
    END IF;
  END
  $pk$;`)
  for (const t of SOFT_DELETE_TABLES) {
    await db.execute(
      sql.raw(`
  ALTER TABLE "${t}" ADD COLUMN "is_deleted" boolean DEFAULT false;
  ALTER TABLE "${t}" ADD COLUMN "deleted_at" timestamp(3) with time zone;
  ALTER TABLE "${t}" ADD COLUMN "deleted_by_id" integer;
  ALTER TABLE "${t}" ADD COLUMN "delete_reason" varchar;
  ALTER TABLE "${t}" ADD CONSTRAINT "${t}_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "${t}_is_deleted_idx" ON "${t}" USING btree ("is_deleted");
  CREATE INDEX "${t}_deleted_by_idx" ON "${t}" USING btree ("deleted_by_id");
  ALTER TABLE "${t}" ADD CONSTRAINT "${t}_soft_delete_state" CHECK ("is_deleted" IS NOT TRUE OR ("deleted_at" IS NOT NULL AND char_length(btrim(coalesce("delete_reason", ''))) >= 3));`),
    )
  }
  await db.execute(sql`
  ALTER TABLE "projects" ADD COLUMN "cancel_reason" varchar;
  ALTER TABLE "projects" ADD COLUMN "cancelled_at" timestamp(3) with time zone;
  ALTER TABLE "projects" ADD COLUMN "cancelled_by_id" integer;
  ALTER TABLE "projects" ADD CONSTRAINT "projects_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "projects_cancelled_by_idx" ON "projects" USING btree ("cancelled_by_id");
  ALTER TABLE "projects" ADD CONSTRAINT "projects_cancel_state" CHECK (("status" = 'dibatalkan') = ("cancel_reason" IS NOT NULL AND "cancelled_at" IS NOT NULL AND char_length(btrim("cancel_reason")) >= 3));`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DO $pk$
  BEGIN
    IF EXISTS (SELECT 1 FROM projects WHERE status = 'dibatalkan') THEN
      RAISE EXCEPTION '20261016_200100_d1610_soft_delete down: cancelled projects exist (status dibatalkan) — restore the pre-deploy dump instead';
    END IF;
  END
  $pk$;
  ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_cancel_state";
  ALTER TABLE "projects" DROP COLUMN "cancelled_by_id";
  ALTER TABLE "projects" DROP COLUMN "cancelled_at";
  ALTER TABLE "projects" DROP COLUMN "cancel_reason";`)
  for (const t of SOFT_DELETE_TABLES) {
    await db.execute(
      sql.raw(`
  ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS "${t}_soft_delete_state";
  ALTER TABLE "${t}" DROP COLUMN "delete_reason";
  ALTER TABLE "${t}" DROP COLUMN "deleted_by_id";
  ALTER TABLE "${t}" DROP COLUMN "deleted_at";
  ALTER TABLE "${t}" DROP COLUMN "is_deleted";`),
    )
  }
}
