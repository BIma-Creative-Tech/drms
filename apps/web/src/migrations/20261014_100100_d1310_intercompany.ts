import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0028 (DRMS 13/10 Phase B) "Transfer antar-PT" — schema part, run as <prefix>_owner after
 * 20261014_100000_d1310_intercompany_enums (snapshot of the Payload schema in the .json):
 * - `expense_requests.payee_company_id` (→ companies, "PT penerima" of a payment with payee type `pt_grup`; `companies`
 *   is the app-wide group master, so this is not a cross-PT reference — CHECK ≠ own PT in the guard migration);
 * - `cash_accounts.intercompany_receiving` ("Rekening penerimaan antar-PT", default false → every existing account
 *   stays undesignated; at most one active designated bank account per PT, guard migration).
 * Hand-written (not a Payload collection, plain text + CHECK instead of enum types so the Payload snapshot never sees
 * it — the domain module `domain/intercompany` reads / writes it with SQL, like
 * `document_sequence_counters`): `intercompany_links`, the ONLY table that relates rows of two PTs (ADR 0016
 * amendment) — the paying PT's transfer KK and the receiving PT's automatic KM. Guards (sides, immutability, deferred
 * consistency): 20261014_100200_d1310_intercompany_guard.
 * ADDITIVE for the previous image (it never writes the new columns / table; the defaults fill them).
 * Down: refused while a `pt_grup` request or a link exists (posted ledger rows are permanent, ADR 0005 — restore the
 * pre-deploy dump instead).
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
  ALTER TABLE "expense_requests" ADD COLUMN "payee_company_id" integer;
  ALTER TABLE "cash_accounts" ADD COLUMN "intercompany_receiving" boolean DEFAULT false;
  ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_payee_company_id_companies_id_fk" FOREIGN KEY ("payee_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "expense_requests_payee_company_idx" ON "expense_requests" USING btree ("payee_company_id");`)

  await db.execute(sql`
  CREATE TABLE "intercompany_links" (
    "id" serial PRIMARY KEY NOT NULL,
    "source_company_id" integer NOT NULL REFERENCES "public"."companies"("id"),
    "target_company_id" integer NOT NULL REFERENCES "public"."companies"("id"),
    "source_doc_type" text NOT NULL CHECK ("source_doc_type" IN ('expense_request')),
    "source_doc_id" integer NOT NULL,
    "source_transfer_id" integer REFERENCES "public"."transfers"("id"),
    "source_cash_entry_id" integer NOT NULL REFERENCES "public"."cash_entries"("id"),
    "target_cash_account_id" integer NOT NULL REFERENCES "public"."cash_accounts"("id"),
    "target_cash_entry_id" integer NOT NULL REFERENCES "public"."cash_entries"("id"),
    "amount" numeric NOT NULL,
    "status" text DEFAULT 'posted' NOT NULL CHECK ("status" IN ('posted', 'void')),
    "void_reason" text,
    "voided_by_id" integer REFERENCES "public"."users"("id"),
    "voided_at" timestamp(3) with time zone,
    "created_by_id" integer REFERENCES "public"."users"("id"),
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT "intercompany_links_two_pts" CHECK ("source_company_id" <> "target_company_id"),
    CONSTRAINT "intercompany_links_amount" CHECK ("amount" > 0 AND "amount" = trunc("amount")),
    CONSTRAINT "intercompany_links_void" CHECK (("status" = 'posted' AND "void_reason" IS NULL AND "voided_at" IS NULL)
      OR ("status" = 'void' AND "void_reason" IS NOT NULL AND btrim("void_reason") <> '' AND "voided_at" IS NOT NULL))
  );
  CREATE UNIQUE INDEX "intercompany_links_source_transfer_uq" ON "intercompany_links" ("source_transfer_id");
  CREATE UNIQUE INDEX "intercompany_links_source_entry_uq" ON "intercompany_links" ("source_cash_entry_id");
  CREATE UNIQUE INDEX "intercompany_links_target_entry_uq" ON "intercompany_links" ("target_cash_entry_id");
  CREATE UNIQUE INDEX "intercompany_links_uuid_uq" ON "intercompany_links" ("uuid");
  CREATE INDEX "intercompany_links_source_doc_idx" ON "intercompany_links" ("source_doc_type", "source_doc_id");
  CREATE INDEX "intercompany_links_source_company_idx" ON "intercompany_links" ("source_company_id");
  CREATE INDEX "intercompany_links_target_company_idx" ON "intercompany_links" ("target_company_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DO $pk$
  BEGIN
    IF EXISTS (SELECT 1 FROM intercompany_links) OR EXISTS (SELECT 1 FROM expense_requests WHERE payee_type::text = 'pt_grup') THEN
      RAISE EXCEPTION '20261014_100100_d1310_intercompany down: intercompany payments exist (posted ledger rows are permanent, ADR 0005) — restore the pre-deploy dump instead';
    END IF;
  END
  $pk$;
  DROP TABLE "intercompany_links";
  ALTER TABLE "expense_requests" DROP CONSTRAINT "expense_requests_payee_company_id_companies_id_fk";
  DROP INDEX "expense_requests_payee_company_idx";
  ALTER TABLE "expense_requests" DROP COLUMN "payee_company_id";
  ALTER TABLE "cash_accounts" DROP COLUMN "intercompany_receiving";`)
}
