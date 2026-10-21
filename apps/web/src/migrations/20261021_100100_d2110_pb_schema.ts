import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0031 (DRMS 21/10) "Pusat Biaya = akun kas" — schema part (Payload-generated shape, snapshot in the .json), run as
 * <prefix>_owner after 20261021_100000_d2110_pb_enums:
 * - `projects.cash_account_id` — the project's Pusat Biaya (a cash account of its PT; required on a user create, the
 *   transfer of a project request needs it);
 * - `vehicles.cash_account_id` — the vehicle's default Pusat Biaya (replaces `cost_center_id`, kept for history);
 * - `transfers.paid_from_cash_account_id` — the account Finance actually paid from when it is not the project's
 *   Pusat Biaya (the automatic inter-project loan moves the money);
 * - `cash_entries.project_loan_id` / `project_loan_repayment_id` — the loan (repayment) of a `project_loan` cash leg;
 * - `project_loans`: `origin` (manual | transfer), `lender_project_id` NULL for an automatic loan (its lender is an
 *   account), `lender_cash_account_id` / `borrower_cash_account_id`, `cash_backed`, `transfer_id`, `disbursed_at` /
 *   `disbursed_by_id`.
 * Guards (same PT, shapes, immutability, cash-leg consistency): 20261021_100200_d2110_pb_guard. Mapping of existing
 * projects / vehicles is NOT guessed here — the Owner confirms it (plan "Usulan mapping awal"), entered in the app.
 * ADDITIVE for the previous image (it never writes the new columns; defaults fill them).
 * Down: refused once a `project_loan` cash entry or an automatic loan exists (posted ledger rows are permanent, ADR 0005
 * — restore the pre-deploy dump instead).
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
  CREATE TYPE "public"."enum_project_loans_origin" AS ENUM('manual', 'transfer');
  ALTER TABLE "project_loans" ALTER COLUMN "lender_project_id" DROP NOT NULL;
  ALTER TABLE "projects" ADD COLUMN "cash_account_id" integer;
  ALTER TABLE "vehicles" ADD COLUMN "cash_account_id" integer;
  ALTER TABLE "transfers" ADD COLUMN "paid_from_cash_account_id" integer;
  ALTER TABLE "cash_entries" ADD COLUMN "project_loan_id" integer;
  ALTER TABLE "cash_entries" ADD COLUMN "project_loan_repayment_id" integer;
  ALTER TABLE "project_loans" ADD COLUMN "origin" "enum_project_loans_origin" DEFAULT 'manual' NOT NULL;
  ALTER TABLE "project_loans" ADD COLUMN "lender_cash_account_id" integer;
  ALTER TABLE "project_loans" ADD COLUMN "borrower_cash_account_id" integer;
  ALTER TABLE "project_loans" ADD COLUMN "cash_backed" boolean DEFAULT false;
  ALTER TABLE "project_loans" ADD COLUMN "transfer_id" integer;
  ALTER TABLE "project_loans" ADD COLUMN "disbursed_at" timestamp(3) with time zone;
  ALTER TABLE "project_loans" ADD COLUMN "disbursed_by_id" integer;
  ALTER TABLE "projects" ADD CONSTRAINT "projects_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "transfers" ADD CONSTRAINT "transfers_paid_from_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("paid_from_cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_project_loan_id_project_loans_id_fk" FOREIGN KEY ("project_loan_id") REFERENCES "public"."project_loans"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_project_loan_repayment_id_project_loan_repayments_id_fk" FOREIGN KEY ("project_loan_repayment_id") REFERENCES "public"."project_loan_repayments"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "project_loans" ADD CONSTRAINT "project_loans_lender_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("lender_cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "project_loans" ADD CONSTRAINT "project_loans_borrower_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("borrower_cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "project_loans" ADD CONSTRAINT "project_loans_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "project_loans" ADD CONSTRAINT "project_loans_disbursed_by_id_users_id_fk" FOREIGN KEY ("disbursed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "projects_cash_account_idx" ON "projects" USING btree ("cash_account_id");
  CREATE INDEX "vehicles_cash_account_idx" ON "vehicles" USING btree ("cash_account_id");
  CREATE INDEX "transfers_paid_from_cash_account_idx" ON "transfers" USING btree ("paid_from_cash_account_id");
  CREATE INDEX "cash_entries_project_loan_idx" ON "cash_entries" USING btree ("project_loan_id");
  CREATE INDEX "cash_entries_project_loan_repayment_idx" ON "cash_entries" USING btree ("project_loan_repayment_id");
  CREATE INDEX "project_loans_origin_idx" ON "project_loans" USING btree ("origin");
  CREATE INDEX "project_loans_lender_cash_account_idx" ON "project_loans" USING btree ("lender_cash_account_id");
  CREATE INDEX "project_loans_borrower_cash_account_idx" ON "project_loans" USING btree ("borrower_cash_account_id");
  CREATE INDEX "project_loans_transfer_idx" ON "project_loans" USING btree ("transfer_id");
  CREATE INDEX "project_loans_disbursed_by_idx" ON "project_loans" USING btree ("disbursed_by_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DO $pk$
  BEGIN
    IF EXISTS (SELECT 1 FROM cash_entries WHERE source_type::text = 'project_loan' OR project_loan_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM project_loans WHERE origin::text = 'transfer' OR lender_project_id IS NULL) THEN
      RAISE EXCEPTION '20261021_100100_d2110_pb_schema down: inter-project loan cash entries / automatic loans exist — restore the pre-deploy dump instead';
    END IF;
  END
  $pk$;
  ALTER TABLE "projects" DROP CONSTRAINT "projects_cash_account_id_cash_accounts_id_fk";
  ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_cash_account_id_cash_accounts_id_fk";
  ALTER TABLE "transfers" DROP CONSTRAINT "transfers_paid_from_cash_account_id_cash_accounts_id_fk";
  ALTER TABLE "cash_entries" DROP CONSTRAINT "cash_entries_project_loan_id_project_loans_id_fk";
  ALTER TABLE "cash_entries" DROP CONSTRAINT "cash_entries_project_loan_repayment_id_project_loan_repayments_id_fk";
  ALTER TABLE "project_loans" DROP CONSTRAINT "project_loans_lender_cash_account_id_cash_accounts_id_fk";
  ALTER TABLE "project_loans" DROP CONSTRAINT "project_loans_borrower_cash_account_id_cash_accounts_id_fk";
  ALTER TABLE "project_loans" DROP CONSTRAINT "project_loans_transfer_id_transfers_id_fk";
  ALTER TABLE "project_loans" DROP CONSTRAINT "project_loans_disbursed_by_id_users_id_fk";
  DROP INDEX "projects_cash_account_idx";
  DROP INDEX "vehicles_cash_account_idx";
  DROP INDEX "transfers_paid_from_cash_account_idx";
  DROP INDEX "cash_entries_project_loan_idx";
  DROP INDEX "cash_entries_project_loan_repayment_idx";
  DROP INDEX "project_loans_origin_idx";
  DROP INDEX "project_loans_lender_cash_account_idx";
  DROP INDEX "project_loans_borrower_cash_account_idx";
  DROP INDEX "project_loans_transfer_idx";
  DROP INDEX "project_loans_disbursed_by_idx";
  ALTER TABLE "project_loans" ALTER COLUMN "lender_project_id" SET NOT NULL;
  ALTER TABLE "projects" DROP COLUMN "cash_account_id";
  ALTER TABLE "vehicles" DROP COLUMN "cash_account_id";
  ALTER TABLE "transfers" DROP COLUMN "paid_from_cash_account_id";
  ALTER TABLE "cash_entries" DROP COLUMN "project_loan_id";
  ALTER TABLE "cash_entries" DROP COLUMN "project_loan_repayment_id";
  ALTER TABLE "project_loans" DROP COLUMN "origin";
  ALTER TABLE "project_loans" DROP COLUMN "lender_cash_account_id";
  ALTER TABLE "project_loans" DROP COLUMN "borrower_cash_account_id";
  ALTER TABLE "project_loans" DROP COLUMN "cash_backed";
  ALTER TABLE "project_loans" DROP COLUMN "transfer_id";
  ALTER TABLE "project_loans" DROP COLUMN "disbursed_at";
  ALTER TABLE "project_loans" DROP COLUMN "disbursed_by_id";
  DROP TYPE "public"."enum_project_loans_origin";`)
}
