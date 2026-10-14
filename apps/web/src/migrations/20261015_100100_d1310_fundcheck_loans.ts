import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0029 (DRMS 13/10 Phase C) — schema part, run as <prefix>_owner after 20261015_100000_d1310_fundcheck_enums
 * (snapshot of the Payload schema in the .json: the Payload-managed columns below + every earlier enum value).
 *
 * Payload fields (collections Companies / Approvals):
 * - `companies.fund_check_enabled` ("Cek dana saat persetujuan", default false → every PT keeps today's behaviour
 *   until a group admin switches it on after the bank reconciliation, ADR 0029 Rollout step 4);
 * - `companies.reminder_ic_loan_overdue_enabled` (daily "Pinjaman antar-PT terlambat" reminder of the borrower PT,
 *   default true);
 * - `approvals.fund_balance` / `fund_commitments` / `fund_available` (the figures at a checked final decision —
 *   evidence; null on every decision without a fund check).
 *
 * Hand-written (NOT Payload collections — like `intercompany_links` of ADR 0028: the "group — two PTs" class of the
 * ADR 0016 amendment has no `company` column, no per-PT access rule and no admin list; the domain module
 * `domain/intercompany/loans.ts` reads / writes them with SQL; plain text + CHECK instead of enum types so the
 * Payload snapshot never sees them):
 * - `intercompany_loans` — "Pinjaman antar-PT" (`PJA/{LENDER}/{YY}{MM}/{seq}`), the Owner's instruction: lender PT,
 *   borrower PT, amount, instruction / due date, reason, status, repaid total, evidence snapshot, cancel columns;
 * - `intercompany_loan_requests` — the borrower PT's expense requests the instruction was made for (informational);
 * - `intercompany_loan_transfers` — the money movements of a loan (one disbursement lender → borrower, any number of
 *   repayments borrower → lender); the KK / KM ids live in the `intercompany_links` row of the movement.
 * Guards (sides, transitions, G1, frozen columns, deferred consistency): 20261015_100200_d1310_fundcheck_guard.
 * ADDITIVE for the previous image (it never writes the new columns / tables; the defaults fill them).
 * Down: refused while a loan exists (posted ledger rows are permanent, ADR 0005 — restore the pre-deploy dump).
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
  ALTER TABLE "companies" ADD COLUMN "fund_check_enabled" boolean DEFAULT false;
  ALTER TABLE "companies" ADD COLUMN "reminder_ic_loan_overdue_enabled" boolean DEFAULT true;
  ALTER TABLE "approvals" ADD COLUMN "fund_balance" numeric;
  ALTER TABLE "approvals" ADD COLUMN "fund_commitments" numeric;
  ALTER TABLE "approvals" ADD COLUMN "fund_available" numeric;`)

  await db.execute(sql`
  CREATE TABLE "intercompany_loans" (
    "id" serial PRIMARY KEY NOT NULL,
    "doc_no" text NOT NULL,
    "lender_company_id" integer NOT NULL REFERENCES "public"."companies"("id"),
    "borrower_company_id" integer NOT NULL REFERENCES "public"."companies"("id"),
    "amount" numeric NOT NULL,
    "instruction_date" text NOT NULL,
    "due_date" text NOT NULL,
    "reason" text NOT NULL,
    "status" text DEFAULT 'instructed' NOT NULL,
    "repaid_total" numeric DEFAULT 0 NOT NULL,
    "snapshot" jsonb,
    "created_by_id" integer NOT NULL REFERENCES "public"."users"("id"),
    "cancel_reason" text,
    "cancelled_by_id" integer REFERENCES "public"."users"("id"),
    "cancelled_at" timestamp(3) with time zone,
    "uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "intercompany_loans_two_pts" CHECK ("lender_company_id" <> "borrower_company_id"),
    CONSTRAINT "intercompany_loans_amount" CHECK ("amount" > 0 AND "amount" = trunc("amount") AND "amount" <= 1000000000000),
    CONSTRAINT "intercompany_loans_dates" CHECK ("instruction_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND "due_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND "due_date" >= "instruction_date"),
    CONSTRAINT "intercompany_loans_reason" CHECK (char_length(btrim("reason")) BETWEEN 3 AND 1000),
    CONSTRAINT "intercompany_loans_status" CHECK ("status" IN ('instructed', 'disbursed', 'partially_repaid', 'repaid', 'cancelled')),
    CONSTRAINT "intercompany_loans_repaid" CHECK ("repaid_total" >= 0 AND "repaid_total" <= "amount" AND "repaid_total" = trunc("repaid_total")),
    CONSTRAINT "intercompany_loans_cancel" CHECK ((("status" = 'cancelled') = ("cancel_reason" IS NOT NULL AND "cancelled_at" IS NOT NULL))
      AND ("cancel_reason" IS NULL OR char_length(btrim("cancel_reason")) >= 3))
  );
  CREATE UNIQUE INDEX "intercompany_loans_doc_no_uq" ON "intercompany_loans" ("lender_company_id", "doc_no");
  CREATE UNIQUE INDEX "intercompany_loans_uuid_uq" ON "intercompany_loans" ("uuid");
  CREATE INDEX "intercompany_loans_lender_idx" ON "intercompany_loans" ("lender_company_id", "status");
  CREATE INDEX "intercompany_loans_borrower_idx" ON "intercompany_loans" ("borrower_company_id", "status");
  CREATE INDEX "intercompany_loans_created_by_idx" ON "intercompany_loans" ("created_by_id");

  CREATE TABLE "intercompany_loan_requests" (
    "loan_id" integer NOT NULL REFERENCES "public"."intercompany_loans"("id"),
    "request_id" integer NOT NULL REFERENCES "public"."expense_requests"("id"),
    PRIMARY KEY ("loan_id", "request_id")
  );
  CREATE INDEX "intercompany_loan_requests_request_idx" ON "intercompany_loan_requests" ("request_id");

  CREATE TABLE "intercompany_loan_transfers" (
    "id" serial PRIMARY KEY NOT NULL,
    "loan_id" integer NOT NULL REFERENCES "public"."intercompany_loans"("id"),
    "kind" text NOT NULL,
    "from_company_id" integer NOT NULL REFERENCES "public"."companies"("id"),
    "to_company_id" integer NOT NULL REFERENCES "public"."companies"("id"),
    "from_cash_account_id" integer NOT NULL REFERENCES "public"."cash_accounts"("id"),
    "to_cash_account_id" integer NOT NULL REFERENCES "public"."cash_accounts"("id"),
    "amount" numeric NOT NULL,
    "transfer_date" text NOT NULL,
    "transfer_at" timestamp(3) with time zone,
    "bank_ref" text NOT NULL,
    "proof_id" integer REFERENCES "public"."media_transfer_proofs"("id"),
    "status" text DEFAULT 'posted' NOT NULL,
    "void_reason" text,
    "voided_by_id" integer REFERENCES "public"."users"("id"),
    "voided_at" timestamp(3) with time zone,
    "executed_by_id" integer NOT NULL REFERENCES "public"."users"("id"),
    "uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "intercompany_loan_transfers_kind" CHECK ("kind" IN ('disbursement', 'repayment')),
    CONSTRAINT "intercompany_loan_transfers_two_pts" CHECK ("from_company_id" <> "to_company_id"),
    CONSTRAINT "intercompany_loan_transfers_amount" CHECK ("amount" > 0 AND "amount" = trunc("amount")),
    CONSTRAINT "intercompany_loan_transfers_date" CHECK ("transfer_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
    CONSTRAINT "intercompany_loan_transfers_bank_ref" CHECK (char_length(btrim("bank_ref")) BETWEEN 1 AND 64),
    CONSTRAINT "intercompany_loan_transfers_status" CHECK ("status" IN ('posted', 'void')),
    CONSTRAINT "intercompany_loan_transfers_void" CHECK (("status" = 'posted' AND "void_reason" IS NULL AND "voided_at" IS NULL)
      OR ("status" = 'void' AND "void_reason" IS NOT NULL AND btrim("void_reason") <> '' AND "voided_at" IS NOT NULL))
  );
  -- at most one POSTED disbursement per loan (a voided one may be followed by a new one)
  CREATE UNIQUE INDEX "intercompany_loan_transfers_one_disbursement" ON "intercompany_loan_transfers" ("loan_id") WHERE "kind" = 'disbursement' AND "status" = 'posted';
  CREATE UNIQUE INDEX "intercompany_loan_transfers_uuid_uq" ON "intercompany_loan_transfers" ("uuid");
  CREATE INDEX "intercompany_loan_transfers_loan_idx" ON "intercompany_loan_transfers" ("loan_id", "kind", "status");
  CREATE INDEX "intercompany_loan_transfers_from_idx" ON "intercompany_loan_transfers" ("from_company_id");
  CREATE INDEX "intercompany_loan_transfers_to_idx" ON "intercompany_loan_transfers" ("to_company_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DO $pk$
  BEGIN
    IF EXISTS (SELECT 1 FROM intercompany_loans) THEN
      RAISE EXCEPTION '20261015_100100_d1310_fundcheck_loans down: inter-PT loans exist (posted ledger rows are permanent, ADR 0005) — restore the pre-deploy dump instead';
    END IF;
  END
  $pk$;
  DROP TABLE "intercompany_loan_transfers";
  DROP TABLE "intercompany_loan_requests";
  DROP TABLE "intercompany_loans";
  ALTER TABLE "approvals" DROP COLUMN "fund_available";
  ALTER TABLE "approvals" DROP COLUMN "fund_commitments";
  ALTER TABLE "approvals" DROP COLUMN "fund_balance";
  ALTER TABLE "companies" DROP COLUMN "reminder_ic_loan_overdue_enabled";
  ALTER TABLE "companies" DROP COLUMN "fund_check_enabled";`)
}
