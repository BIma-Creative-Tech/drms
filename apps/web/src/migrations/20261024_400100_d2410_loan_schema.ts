import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 24/10 #10–#12 (ADR 0022 / 0031 amendment 2026-10-24) — schema part (Payload-generated shape, snapshot in the
 * .json), run as <prefix>_owner after 20261024_400000_d2410_loan_enums:
 * - `project_loans.approval_level` — the level a submitted loan waits at (1 Direktur, 2 Owner; 0 before submit);
 *   `project_loans.submitter_role` (pm | finance) — the creator filed as the borrower PM or as Finance of the PT
 *   (NULL on every existing loan = filed by the borrower PM, the only filer before);
 * - `project_loan_repayments`: the request part of a cash-backed repayment — `planned_date`, `approval_level`,
 *   `submitted_at`, `decided_at` / `decided_by_id`, `reject_reason`, `cancel_reason`, `executed_at` / `executed_by_id`;
 * - `approvals.loan_repayment_id` — the repayment request of a `project_loan_repayment` decision row.
 * Data (in-flight loans): 20261024_400200_d2410_loan_data; guards: 20261024_400300_d2410_loan_guard.
 * ADDITIVE for the previous image (it never writes the new columns; defaults fill them).
 * Down: refused once a repayment request or its decision row exists (restore the pre-deploy dump instead).
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
  CREATE TYPE "public"."enum_project_loans_submitter_role" AS ENUM('pm', 'finance');
  ALTER TABLE "project_loans" ADD COLUMN "approval_level" numeric DEFAULT 0;
  ALTER TABLE "project_loans" ADD COLUMN "submitter_role" "enum_project_loans_submitter_role";
  ALTER TABLE "project_loan_repayments" ADD COLUMN "planned_date" varchar;
  ALTER TABLE "project_loan_repayments" ADD COLUMN "approval_level" numeric DEFAULT 0;
  ALTER TABLE "project_loan_repayments" ADD COLUMN "submitted_at" timestamp(3) with time zone;
  ALTER TABLE "project_loan_repayments" ADD COLUMN "decided_at" timestamp(3) with time zone;
  ALTER TABLE "project_loan_repayments" ADD COLUMN "decided_by_id" integer;
  ALTER TABLE "project_loan_repayments" ADD COLUMN "reject_reason" varchar;
  ALTER TABLE "project_loan_repayments" ADD COLUMN "cancel_reason" varchar;
  ALTER TABLE "project_loan_repayments" ADD COLUMN "executed_at" timestamp(3) with time zone;
  ALTER TABLE "project_loan_repayments" ADD COLUMN "executed_by_id" integer;
  ALTER TABLE "approvals" ADD COLUMN "loan_repayment_id" integer;
  ALTER TABLE "project_loan_repayments" ADD CONSTRAINT "project_loan_repayments_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "project_loan_repayments" ADD CONSTRAINT "project_loan_repayments_executed_by_id_users_id_fk" FOREIGN KEY ("executed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "approvals" ADD CONSTRAINT "approvals_loan_repayment_id_project_loan_repayments_id_fk" FOREIGN KEY ("loan_repayment_id") REFERENCES "public"."project_loan_repayments"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "project_loan_repayments_decided_by_idx" ON "project_loan_repayments" USING btree ("decided_by_id");
  CREATE INDEX "project_loan_repayments_executed_by_idx" ON "project_loan_repayments" USING btree ("executed_by_id");
  CREATE INDEX "approvals_loan_repayment_idx" ON "approvals" USING btree ("loan_repayment_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DO $pk$
  BEGIN
    IF EXISTS (SELECT 1 FROM project_loan_repayments WHERE status::text NOT IN ('posted', 'void'))
       OR EXISTS (SELECT 1 FROM approvals WHERE loan_repayment_id IS NOT NULL OR doc_type::text = 'project_loan_repayment') THEN
      RAISE EXCEPTION '20261024_400100_d2410_loan_schema down: repayment requests / their decision rows exist — restore the pre-deploy dump instead';
    END IF;
  END
  $pk$;
  ALTER TABLE "project_loan_repayments" DROP CONSTRAINT "project_loan_repayments_decided_by_id_users_id_fk";
  ALTER TABLE "project_loan_repayments" DROP CONSTRAINT "project_loan_repayments_executed_by_id_users_id_fk";
  ALTER TABLE "approvals" DROP CONSTRAINT "approvals_loan_repayment_id_project_loan_repayments_id_fk";
  DROP INDEX "project_loan_repayments_decided_by_idx";
  DROP INDEX "project_loan_repayments_executed_by_idx";
  DROP INDEX "approvals_loan_repayment_idx";
  ALTER TABLE "project_loans" DROP COLUMN "approval_level";
  ALTER TABLE "project_loans" DROP COLUMN "submitter_role";
  ALTER TABLE "project_loan_repayments" DROP COLUMN "planned_date";
  ALTER TABLE "project_loan_repayments" DROP COLUMN "approval_level";
  ALTER TABLE "project_loan_repayments" DROP COLUMN "submitted_at";
  ALTER TABLE "project_loan_repayments" DROP COLUMN "decided_at";
  ALTER TABLE "project_loan_repayments" DROP COLUMN "decided_by_id";
  ALTER TABLE "project_loan_repayments" DROP COLUMN "reject_reason";
  ALTER TABLE "project_loan_repayments" DROP COLUMN "cancel_reason";
  ALTER TABLE "project_loan_repayments" DROP COLUMN "executed_at";
  ALTER TABLE "project_loan_repayments" DROP COLUMN "executed_by_id";
  ALTER TABLE "approvals" DROP COLUMN "loan_repayment_id";
  DROP TYPE "public"."enum_project_loans_submitter_role";`)
}
