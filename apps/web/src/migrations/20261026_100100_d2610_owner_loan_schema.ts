import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 26/10 #1 (ADR 0031 amendment 2026-10-26) — schema part (Payload-generated shape, snapshot in the .json), run as
 * <prefix>_owner after 20261026_100000_d2610_owner_loan_enums:
 * - `project_loans.expense_request_id` (nullable FK → expense_requests, ON DELETE set null like every relationship) — the
 *   expense request an Owner-instructed loan (`submitter_role` = 'owner') covers. NULL on every other loan.
 * Guards: 20261026_100200_d2610_owner_loan_guard. ADDITIVE for the previous image (it never writes the column).
 * Down: refused once an instructed loan exists (restore the pre-deploy dump instead).
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
  ALTER TABLE "project_loans" ADD COLUMN "expense_request_id" integer;
  ALTER TABLE "project_loans" ADD CONSTRAINT "project_loans_expense_request_id_expense_requests_id_fk" FOREIGN KEY ("expense_request_id") REFERENCES "public"."expense_requests"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "project_loans_expense_request_idx" ON "project_loans" USING btree ("expense_request_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DO $pk$
  BEGIN
    IF EXISTS (SELECT 1 FROM project_loans WHERE expense_request_id IS NOT NULL OR submitter_role::text = 'owner') THEN
      RAISE EXCEPTION '20261026_100100_d2610_owner_loan_schema down: Owner-instructed loans exist — restore the pre-deploy dump instead';
    END IF;
  END
  $pk$;
  ALTER TABLE "project_loans" DROP CONSTRAINT "project_loans_expense_request_id_expense_requests_id_fk";
  DROP INDEX "project_loans_expense_request_idx";
  ALTER TABLE "project_loans" DROP COLUMN "expense_request_id";`)
}
