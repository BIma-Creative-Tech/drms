import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * D2410 (user decision 2026-10-24): a Finance user who is the requester or creator of a request MAY verify / reject its
 * receipts and review its flags (and process its LPJ / settlement — those had no DB-level self guard). Hand-written, run
 * as <prefix>_owner: drops the two F2e triggers of 20260924_020344_f2e_security that refused it at the DB level —
 * `receipts_self_verify_guard` (pk_receipts_self_verify_guard) and `receipt_flags_self_review_guard`
 * (pk_receipt_flags_self_review_guard; listed as "neutral" by 20261013_610000_d1310_renumber — a dropped function no
 * longer has a trigger, so the renumber listing stays complete). `pk_request_involves` stays (shared helper).
 * Every other guard is unchanged: the receipts / flags whitelists, G1 on approvals (pk_approvals_before_insert), the
 * shortfall re-approval G1 rule. The domain records each such action as audit `self_processed`.
 * Down: re-creates both triggers exactly as F2e (they only check rows whose verifier / reviewer changes, so rows verified
 * meanwhile by their own Finance stay as they are).
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

    DROP TRIGGER IF EXISTS receipts_self_verify_guard ON receipts;
    DROP FUNCTION IF EXISTS pk_receipts_self_verify_guard();
    DROP TRIGGER IF EXISTS receipt_flags_self_review_guard ON receipt_flags;
    DROP FUNCTION IF EXISTS pk_receipt_flags_self_review_guard();
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION pk_receipts_self_verify_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.verified_by_id IS NOT NULL AND NEW.status::text IN ('valid', 'rejected')
         AND (NEW.verified_by_id IS DISTINCT FROM OLD.verified_by_id OR NEW.status IS DISTINCT FROM OLD.status)
         AND pk_request_involves(NEW.request_id, NEW.verified_by_id) THEN
        RAISE EXCEPTION 'receipts %: requester/creator cannot verify receipts of their own request (G1)', OLD.id USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;
    DROP TRIGGER IF EXISTS receipts_self_verify_guard ON receipts;
    CREATE TRIGGER receipts_self_verify_guard BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION pk_receipts_self_verify_guard();

    CREATE OR REPLACE FUNCTION pk_receipt_flags_self_review_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.reviewed_by_id IS NOT NULL AND NEW.status::text = 'reviewed'
         AND (NEW.reviewed_by_id IS DISTINCT FROM OLD.reviewed_by_id OR NEW.status IS DISTINCT FROM OLD.status)
         AND pk_request_involves(NEW.request_id, NEW.reviewed_by_id) THEN
        RAISE EXCEPTION 'receipt_flags %: requester/creator cannot review flags of their own request (G1)', OLD.id USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;
    DROP TRIGGER IF EXISTS receipt_flags_self_review_guard ON receipt_flags;
    CREATE TRIGGER receipt_flags_self_review_guard BEFORE UPDATE ON receipt_flags FOR EACH ROW EXECUTE FUNCTION pk_receipt_flags_self_review_guard();
  `)
}
