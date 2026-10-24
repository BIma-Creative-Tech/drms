import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 24/10 #10–#12 (ADR 0022 / 0031 amendment 2026-10-24) "Pinjaman antar project: Direktur → Owner, antrian
 * transfer" — ENUM ONLY, ADDITIVE (pattern of 20261021_100000_d2110_pb_enums):
 * - `enum_project_loan_repayments_status` += 'pending_approval', 'approved' (before 'posted'), 'rejected', 'cancelled'
 *   (after 'void'): a repayment of a cash-backed loan is a request decided Direktur → Owner, then a transfer order
 *   Finance executes (`posted` = executed — every existing row keeps it);
 * - `enum_approvals_doc_type` += 'project_loan_repayment' (the decision rows of such a request).
 * Its own migration (= its own transaction): Postgres refuses to USE a new enum value in the transaction that added it,
 * and the guard migration that follows (20261024_400300) does.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_project_loan_repayments_status" ADD VALUE IF NOT EXISTS 'pending_approval' BEFORE 'posted';
  ALTER TYPE "public"."enum_project_loan_repayments_status" ADD VALUE IF NOT EXISTS 'approved' AFTER 'pending_approval';
  ALTER TYPE "public"."enum_project_loan_repayments_status" ADD VALUE IF NOT EXISTS 'rejected' AFTER 'void';
  ALTER TYPE "public"."enum_project_loan_repayments_status" ADD VALUE IF NOT EXISTS 'cancelled' AFTER 'rejected';
  ALTER TYPE "public"."enum_approvals_doc_type" ADD VALUE IF NOT EXISTS 'project_loan_repayment' AFTER 'project_loan';`)
}

export async function down({}: MigrateDownArgs): Promise<void> {
  // Postgres cannot drop an enum value — no-op like 20261021_100000_d2110_pb_enums (harmless when unused).
}
