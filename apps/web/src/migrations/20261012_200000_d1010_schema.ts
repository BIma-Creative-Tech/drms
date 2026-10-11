import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 10/10 Phase B (server), schema + DB guards. Run as <prefix>_owner.
 *
 * - Item 11: `transfers.transfer_at` (date + time of the bank proof; NULL = old client, time unknown),
 *   `expense_requests.approved_at` (final approval of the current cycle, start of the transfer SLA),
 *   `companies.transfer_sla_hours` (per-PT SLA, default 24).
 *   Guard: `approved_at` is one of the columns that may change on a locked request, but ONLY together
 *   with the final approval (pending_approval → approved), like `approved_amount` (G3). `transfer_at` is
 *   covered by the existing transfers guard (posted rows are immutable except the void columns).
 * - D7: `media_selfies.stamped_at` (timestamp band burnt into the file by the worker job `stampSelfie`),
 *   write-once (pk_protect_columns: NULL → value once, never changed afterwards).
 * - Job task slug `stampSelfie`.
 * The generated diff also contained the approval-PM schema (enum value `approval_policy_exception`,
 * `expense_requests.g1_exception`) because the p3 snapshot predates that merge; both already exist
 * (migration 20261010_130000_approval_pm_direktur) and are left out here. Data: 20261012_200100_d1010_data.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;

    ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'stampSelfie';
    ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'stampSelfie';
    ALTER TABLE "companies" ADD COLUMN "transfer_sla_hours" numeric DEFAULT 24 NOT NULL;
    ALTER TABLE "expense_requests" ADD COLUMN "approved_at" timestamp(3) with time zone;
    ALTER TABLE "transfers" ADD COLUMN "transfer_at" timestamp(3) with time zone;
    ALTER TABLE "media_selfies" ADD COLUMN "stamped_at" timestamp(3) with time zone;
    CREATE INDEX "expense_requests_approved_at_idx" ON "expense_requests" USING btree ("approved_at");
    CREATE INDEX "transfers_transfer_at_idx" ON "transfers" USING btree ("transfer_at");

    ALTER TABLE companies ADD CONSTRAINT companies_transfer_sla_hours CHECK (transfer_sla_hours >= 1 AND transfer_sla_hours <= 720);

    CREATE TRIGGER media_selfies_stamped_protect BEFORE UPDATE ON media_selfies FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('stamped_at');

    -- F2b body (verbatim, incl. the verified_receipts_total rule) + 'approved_at' (item 11)
    CREATE OR REPLACE FUNCTION pk_expense_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      wl text[] := ARRAY['status', 'updated_at', 'current_level', 'approved_amount', 'content_hash',
                         'transferred_total', 'cancel_reason', 'reject_reason', 'verified_receipts_total', 'approved_at'];
    BEGIN
      IF pk_expense_editable(OLD.status::text) THEN
        IF NOT pk_expense_editable(NEW.status::text) THEN
          NEW.content_hash := pk_expense_content_hash(NEW.id); -- freeze point (re-checked at commit)
        END IF;
      ELSE
        IF (to_jsonb(OLD) - wl) IS DISTINCT FROM (to_jsonb(NEW) - wl) THEN
          RAISE EXCEPTION 'expense_requests %: content is locked in status %', OLD.id, OLD.status USING ERRCODE = '42501';
        END IF;
        IF NEW.content_hash IS DISTINCT FROM OLD.content_hash AND NOT pk_expense_editable(NEW.status::text) THEN
          RAISE EXCEPTION 'expense_requests %: content_hash is immutable while locked', OLD.id USING ERRCODE = '42501';
        END IF;
        IF pk_expense_editable(NEW.status::text) THEN
          NEW.content_hash := NULL; -- withdraw / receipt revision: content editable again
        END IF;
      END IF;
      IF NEW.approved_amount IS DISTINCT FROM OLD.approved_amount THEN
        IF NOT (OLD.status = 'pending_approval' AND NEW.status = 'approved') THEN
          RAISE EXCEPTION 'expense_requests %: approved_amount changes only on approval (G3)', OLD.id USING ERRCODE = '42501';
        END IF;
      END IF;
      IF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
        IF NOT (OLD.status = 'pending_approval' AND NEW.status = 'approved' AND NEW.approved_at IS NOT NULL) THEN
          RAISE EXCEPTION 'expense_requests %: approved_at is set only on the final approval', OLD.id USING ERRCODE = '42501';
        END IF;
      END IF;
      IF NEW.status = 'approved' AND OLD.status = 'pending_approval' AND NEW.approved_amount IS DISTINCT FROM NEW.grand_total THEN
        RAISE EXCEPTION 'expense_requests %: approved_amount must equal grand_total', OLD.id USING ERRCODE = '42501';
      END IF;
      IF NEW.verified_receipts_total IS DISTINCT FROM OLD.verified_receipts_total
         AND NOT (OLD.status = 'lpj_submitted' AND NEW.status IN ('lpj_verified', 'completed')) THEN
        RAISE EXCEPTION 'expense_requests %: verified_receipts_total changes only on LPJ verification', OLD.id USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Guard back to the F2b body FIRST (it must not reference the dropped column).
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION pk_expense_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      wl text[] := ARRAY['status', 'updated_at', 'current_level', 'approved_amount', 'content_hash',
                         'transferred_total', 'cancel_reason', 'reject_reason', 'verified_receipts_total'];
    BEGIN
      IF pk_expense_editable(OLD.status::text) THEN
        IF NOT pk_expense_editable(NEW.status::text) THEN
          NEW.content_hash := pk_expense_content_hash(NEW.id); -- freeze point (re-checked at commit)
        END IF;
      ELSE
        IF (to_jsonb(OLD) - wl) IS DISTINCT FROM (to_jsonb(NEW) - wl) THEN
          RAISE EXCEPTION 'expense_requests %: content is locked in status %', OLD.id, OLD.status USING ERRCODE = '42501';
        END IF;
        IF NEW.content_hash IS DISTINCT FROM OLD.content_hash AND NOT pk_expense_editable(NEW.status::text) THEN
          RAISE EXCEPTION 'expense_requests %: content_hash is immutable while locked', OLD.id USING ERRCODE = '42501';
        END IF;
        IF pk_expense_editable(NEW.status::text) THEN
          NEW.content_hash := NULL; -- withdraw / receipt revision: content editable again
        END IF;
      END IF;
      IF NEW.approved_amount IS DISTINCT FROM OLD.approved_amount THEN
        IF NOT (OLD.status = 'pending_approval' AND NEW.status = 'approved') THEN
          RAISE EXCEPTION 'expense_requests %: approved_amount changes only on approval (G3)', OLD.id USING ERRCODE = '42501';
        END IF;
      END IF;
      IF NEW.status = 'approved' AND OLD.status = 'pending_approval' AND NEW.approved_amount IS DISTINCT FROM NEW.grand_total THEN
        RAISE EXCEPTION 'expense_requests %: approved_amount must equal grand_total', OLD.id USING ERRCODE = '42501';
      END IF;
      IF NEW.verified_receipts_total IS DISTINCT FROM OLD.verified_receipts_total
         AND NOT (OLD.status = 'lpj_submitted' AND NEW.status IN ('lpj_verified', 'completed')) THEN
        RAISE EXCEPTION 'expense_requests %: verified_receipts_total changes only on LPJ verification', OLD.id USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;

    DROP TRIGGER IF EXISTS media_selfies_stamped_protect ON media_selfies;
    ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_transfer_sla_hours;
    DELETE FROM payload_jobs WHERE task_slug = 'stampSelfie';
    DELETE FROM payload_jobs_log WHERE task_slug = 'stampSelfie';
    ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE text;
    DROP TYPE "public"."enum_payload_jobs_log_task_slug";
    CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM('inline', 'auditDailyAnchor', 'sendEmail', 'reimburseAutoClose', 'selfieRetention', 'dailyReminders', 'mediaOrphanCleanup');
    ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_log_task_slug" USING "task_slug"::"public"."enum_payload_jobs_log_task_slug";
    ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE text;
    DROP TYPE "public"."enum_payload_jobs_task_slug";
    CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM('inline', 'auditDailyAnchor', 'sendEmail', 'reimburseAutoClose', 'selfieRetention', 'dailyReminders', 'mediaOrphanCleanup');
    ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_task_slug" USING "task_slug"::"public"."enum_payload_jobs_task_slug";
    DROP INDEX IF EXISTS "expense_requests_approved_at_idx";
    DROP INDEX IF EXISTS "transfers_transfer_at_idx";
    ALTER TABLE "companies" DROP COLUMN "transfer_sla_hours";
    ALTER TABLE "expense_requests" DROP COLUMN "approved_at";
    ALTER TABLE "transfers" DROP COLUMN "transfer_at";
    ALTER TABLE "media_selfies" DROP COLUMN "stamped_at";`)
}
