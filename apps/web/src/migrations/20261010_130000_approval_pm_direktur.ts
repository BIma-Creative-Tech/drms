import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0021 (owner decision 2026-10-10): approval of expense requests Staff → PM project → Direktur →
 * Finance transfer, with ONE narrow G1 exception: a Direktur's own request filed by the PM project
 * (`direktur_via_pm`). Schema part as `payload migrate:create` would generate it (snapshot in the
 * .json), written re-runnable, run as <prefix>_owner, plus hand-written guards. ADDITIVE for the
 * previous web image and every released APK (new nullable column, new enum value, triggers that only
 * act on new writes; the approval rules themselves are changed by the Admin in the UI, not here):
 *
 * 1. `audit_logs.action` += 'approval_policy_exception' (the exception was applied at submit).
 * 2. `expense_requests.g1_exception` varchar NULL, CHECK value IN ('direktur_via_pm'); system-only
 *    Payload field. Trigger `expense_requests_g1_exception` (BEFORE INSERT OR UPDATE; Payload's upsert-style
 *    update fires BEFORE INSERT as well): new rows carry none; the value changes only at the submit freeze point (editable status → locked status, i.e.
 *    draft → pending_*, receipt_revision → pending_*) — afterwards it is fixed with the rest of the
 *    locked content (`pk_expense_requests_guard`).
 * 3. `pk_approvals_before_insert` (CREATE OR REPLACE; body of 20261008_090000_qa_finance_integrity +
 *    this block): requester/creator still never hold a decision position (G1), EXCEPT when the request
 *    carries g1_exception = 'direktur_via_pm': exactly `position = 'diketahui' AND actor = creator`
 *    (the PM project, not a requester) and `position = 'approval' AND actor ∈ requesters` (the
 *    Direktur, not the creator). Applies to `expense_shortfall` rows through `settlements.request_id`.
 * Rollback (down): previous trigger body restored, guard + CHECK + column dropped (the enum value stays:
 * audit_logs is append-only, ADR 0006).
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
  ALTER TYPE "public"."enum_audit_logs_action" ADD VALUE IF NOT EXISTS 'approval_policy_exception';
  ALTER TABLE "expense_requests" ADD COLUMN IF NOT EXISTS "g1_exception" varchar;`)

  await db.execute(sql`
    DO $pk$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_requests_g1_exception_value') THEN
        ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_g1_exception_value CHECK (g1_exception IS NULL OR g1_exception = 'direktur_via_pm');
      END IF;
    END
    $pk$;

    CREATE OR REPLACE FUNCTION pk_expense_requests_g1_exception() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        -- Payload writes updates as INSERT … ON CONFLICT (id) DO UPDATE: BEFORE INSERT fires for those too, the
        -- update branch is then checked below (BEFORE UPDATE). Only a genuinely new row must carry no value.
        IF NEW.g1_exception IS NOT NULL AND NOT EXISTS (SELECT 1 FROM expense_requests WHERE id = NEW.id) THEN
          RAISE EXCEPTION 'expense_requests: g1_exception is set by the service at submit only (ADR 0021)' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;
      IF NEW.g1_exception IS DISTINCT FROM OLD.g1_exception
         AND NOT (pk_expense_editable(OLD.status::text) AND NOT pk_expense_editable(NEW.status::text)) THEN
        RAISE EXCEPTION 'expense_requests %: g1_exception changes only at submit (ADR 0021)', OLD.id USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;
    DROP TRIGGER IF EXISTS expense_requests_g1_exception ON expense_requests;
    CREATE TRIGGER expense_requests_g1_exception BEFORE INSERT OR UPDATE ON expense_requests
      FOR EACH ROW EXECUTE FUNCTION pk_expense_requests_g1_exception();

    CREATE OR REPLACE FUNCTION pk_approvals_before_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      creator integer;
      rid integer;
      exc text;
      is_requester boolean;
    BEGIN
      NEW.decided_at := clock_timestamp();
      IF NEW.position IN ('diketahui', 'approval') THEN
        IF NEW.doc_type::text = 'budget_addendum' THEN
          SELECT created_by_id INTO creator FROM budget_addenda WHERE id = NEW.addendum_id;
          IF NEW.actor_id IS NULL OR creator IS NULL OR NEW.actor_id = creator THEN
            RAISE EXCEPTION 'approvals: the addendum creator cannot hold a decision position (G1)' USING ERRCODE = '42501';
          END IF;
          RETURN NEW;
        END IF;
        -- QA-06 / ADR 0019: a shortfall decision is about the settlement's request (same G1 rule)
        rid := NEW.request_id;
        IF NEW.doc_type::text = 'expense_shortfall' THEN
          SELECT request_id INTO rid FROM settlements WHERE id = NEW.settlement_id;
        END IF;
        SELECT created_by_id, g1_exception INTO creator, exc FROM expense_requests WHERE id = rid;
        is_requester := EXISTS (
          SELECT 1 FROM expense_requests_rels r JOIN company_memberships m ON m.employee_id = r.employees_id
          WHERE r.parent_id = rid AND r.path = 'requesters' AND m.user_id = NEW.actor_id);
        IF NEW.actor_id IS NULL OR NEW.actor_id = creator OR is_requester THEN
          -- ADR 0021: the narrow exception of a Direktur's request filed by the PM project — the creator PM
          -- gives "Diketahui" (Persetujuan PM), a requester Direktur decides an approval level. Nothing else.
          -- (coalesce: a NULL comparison must never let a row through — three-valued logic)
          IF NOT coalesce(exc = 'direktur_via_pm' AND NEW.actor_id IS NOT NULL AND creator IS NOT NULL AND (
                (NEW.position = 'diketahui' AND NEW.actor_id = creator AND NOT is_requester)
             OR (NEW.position = 'approval' AND is_requester AND NEW.actor_id IS DISTINCT FROM creator)), false) THEN
            RAISE EXCEPTION 'approvals: requester/creator cannot hold a decision position (G1)' USING ERRCODE = '42501';
          END IF;
        END IF;
      END IF;
      RETURN NEW;
    END
    $fn$;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION pk_approvals_before_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      creator integer;
      rid integer;
    BEGIN
      NEW.decided_at := clock_timestamp();
      IF NEW.position IN ('diketahui', 'approval') THEN
        IF NEW.doc_type::text = 'budget_addendum' THEN
          SELECT created_by_id INTO creator FROM budget_addenda WHERE id = NEW.addendum_id;
          IF NEW.actor_id IS NULL OR creator IS NULL OR NEW.actor_id = creator THEN
            RAISE EXCEPTION 'approvals: the addendum creator cannot hold a decision position (G1)' USING ERRCODE = '42501';
          END IF;
          RETURN NEW;
        END IF;
        -- QA-06 / ADR 0019: a shortfall decision is about the settlement's request (same G1 rule)
        rid := NEW.request_id;
        IF NEW.doc_type::text = 'expense_shortfall' THEN
          SELECT request_id INTO rid FROM settlements WHERE id = NEW.settlement_id;
        END IF;
        SELECT created_by_id INTO creator FROM expense_requests WHERE id = rid;
        IF NEW.actor_id IS NULL OR NEW.actor_id = creator OR EXISTS (
             SELECT 1 FROM expense_requests_rels r JOIN company_memberships m ON m.employee_id = r.employees_id
             WHERE r.parent_id = rid AND r.path = 'requesters' AND m.user_id = NEW.actor_id) THEN
          RAISE EXCEPTION 'approvals: requester/creator cannot hold a decision position (G1)' USING ERRCODE = '42501';
        END IF;
      END IF;
      RETURN NEW;
    END
    $fn$;

    DROP TRIGGER IF EXISTS expense_requests_g1_exception ON expense_requests;
    DROP FUNCTION IF EXISTS pk_expense_requests_g1_exception();
    ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_g1_exception_value;
    ALTER TABLE "expense_requests" DROP COLUMN IF EXISTS "g1_exception";`)
}
