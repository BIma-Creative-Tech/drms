import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * QA report 2026-10-08, QA-11 — the `mediaOrphanCleanup` job (jobs/tasks.ts, domain/media-orphans.ts):
 * Payload stores job task slugs in two Postgres enums. Generated shape of `payload migrate:create`
 * (schema snapshot in the .json), written re-runnable (ADD VALUE IF NOT EXISTS). Run as <prefix>_owner.
 * Down: removes the value again (rows of that task in the job tables are deleted first — they are
 * scheduling bookkeeping only; the job's audit rows stay).
 */
const PREV = sql.raw(`'inline', 'auditDailyAnchor', 'sendEmail', 'reimburseAutoClose', 'selfieRetention', 'dailyReminders'`)

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'mediaOrphanCleanup';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'mediaOrphanCleanup';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DELETE FROM "payload_jobs_log" WHERE "task_slug"::text = 'mediaOrphanCleanup';
  DELETE FROM "payload_jobs" WHERE "task_slug"::text = 'mediaOrphanCleanup';
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_log_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM(${PREV});
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_log_task_slug" USING "task_slug"::"public"."enum_payload_jobs_log_task_slug";
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM(${PREV});
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_task_slug" USING "task_slug"::"public"."enum_payload_jobs_task_slug";`)
}
