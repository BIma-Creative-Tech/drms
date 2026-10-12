import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0024 (owner decision 2026-10-11) — DB guards of the configurable approval rules and of the audited
 * Direktur no-approval exception. Hand-written, re-runnable, run as <prefix>_owner after
 * 20261013_300000_d1010_approval_config. ADDITIVE for the previous web image (it never writes the new
 * value, never saves a zero-step rule, and every approval it records has a decision row):
 *
 * 1. `approval_rules_zero_step` (DEFERRABLE INITIALLY DEFERRED constraint triggers on approval_rules,
 *    approval_rules_steps and approval_rules_requester_roles; checked at commit because Payload rewrites
 *    the child rows after the parent): a rule WITHOUT approval levels must be an expense-request rule
 *    without "Diketahui" whose requester roles are EXACTLY {pk-owner} (Direktur) — an Admin can never open a
 *    no-approval path for Staff / PM / Finance (the collection hook says the same in Indonesian).
 * 2. `expense_requests.g1_exception` CHECK += 'direktur_no_approval'; `pk_expense_requests_g1_exception`
 *    (same trigger) additionally accepts that value at the submit freeze point ONLY when
 *    `pk_no_approval_allowed`: the request's rule is a zero-step Direktur rule of the request's PT, the
 *    snapshot has no step / no "Diketahui" and carries the exception, every requester employee has an active
 *    account holding Direktur (pk-owner) in that PT through an active membership, and the creator is one of
 *    those Direktur accounts (his OWN request).
 * 3. `expense_requests_approval_guard` (BEFORE UPDATE): "Menunggu persetujuan" → "Disetujui" needs the FINAL
 *    decision of the current cycle — the approval of the snapshot's last level, or (all levels skipped, G1-2) the
 *    "Diketahui" approval — or `g1_exception = 'direktur_no_approval'`.
 * Down: function bodies of 20261010_130000_approval_pm_direktur restored, new triggers / functions dropped;
 * the CHECK goes back to the two ADR 0021 values only when no request carries the new value (else kept,
 * NOTICE) — rows are never rewritten.
 */
const OLD_G1_FN = sql`
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
    $fn$;`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;

    -- ---------------------------------------------------------------- 1. zero-step rules (Direktur only)
    CREATE OR REPLACE FUNCTION pk_rule_direktur_only(rid integer) RETURNS boolean LANGUAGE sql STABLE AS $fn$
      SELECT coalesce((SELECT array_agg(DISTINCT x.value::text) FROM approval_rules_requester_roles x WHERE x.parent_id = rid) = ARRAY['pk-owner']::text[], false)
    $fn$;

    CREATE OR REPLACE FUNCTION pk_approval_rules_zero_step_check() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      rid integer;
      r record;
    BEGIN
      IF TG_TABLE_NAME = 'approval_rules' THEN
        rid := NEW.id;
      ELSIF TG_TABLE_NAME = 'approval_rules_steps' THEN
        rid := CASE WHEN TG_OP = 'DELETE' THEN OLD._parent_id ELSE NEW._parent_id END;
      ELSE
        rid := CASE WHEN TG_OP = 'DELETE' THEN OLD.parent_id ELSE NEW.parent_id END;
      END IF;
      SELECT a.id, a.doc_type::text AS doc_type, a.acknowledge::text AS ack INTO r FROM approval_rules a WHERE a.id = rid;
      IF NOT FOUND OR EXISTS (SELECT 1 FROM approval_rules_steps s WHERE s._parent_id = rid) THEN
        RETURN NULL;
      END IF;
      IF r.doc_type IS DISTINCT FROM 'expense_request' OR r.ack IS DISTINCT FROM 'none' OR NOT pk_rule_direktur_only(rid) THEN
        RAISE EXCEPTION 'approval_rules %: a rule without approval levels is allowed only for requester role = Direktur (pk-owner) on expense requests, without "Diketahui" (ADR 0024)', rid
          USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END
    $fn$;
    DROP TRIGGER IF EXISTS approval_rules_zero_step ON approval_rules;
    DROP TRIGGER IF EXISTS approval_rules_steps_zero_step ON approval_rules_steps;
    DROP TRIGGER IF EXISTS approval_rules_requester_roles_zero_step ON approval_rules_requester_roles;
    CREATE CONSTRAINT TRIGGER approval_rules_zero_step AFTER INSERT OR UPDATE ON approval_rules
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pk_approval_rules_zero_step_check();
    CREATE CONSTRAINT TRIGGER approval_rules_steps_zero_step AFTER INSERT OR UPDATE OR DELETE ON approval_rules_steps
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pk_approval_rules_zero_step_check();
    CREATE CONSTRAINT TRIGGER approval_rules_requester_roles_zero_step AFTER INSERT OR UPDATE OR DELETE ON approval_rules_requester_roles
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pk_approval_rules_zero_step_check();

    -- ---------------------------------------------------------------- 2. g1_exception 'direktur_no_approval'
    ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_g1_exception_value;
    ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_g1_exception_value
      CHECK (g1_exception IS NULL OR g1_exception IN ('direktur_via_pm', 'direktur_via_pm_self', 'direktur_no_approval'));

    CREATE OR REPLACE FUNCTION pk_no_approval_allowed(rid integer, company integer, creator integer, rule integer, snap jsonb) RETURNS boolean LANGUAGE sql STABLE AS $fn$
      SELECT coalesce(
        -- the applied rule: a zero-step Direktur rule of the request's PT, without "Diketahui"
        EXISTS (SELECT 1 FROM approval_rules r
                 WHERE r.id = rule AND r.company_id = company AND r.doc_type::text = 'expense_request' AND r.acknowledge::text = 'none'
                   AND NOT EXISTS (SELECT 1 FROM approval_rules_steps s WHERE s._parent_id = r.id) AND pk_rule_direktur_only(r.id))
        -- the snapshot: no step, no "Diketahui", the exception recorded
        AND coalesce(jsonb_array_length(snap -> 'steps'), 0) = 0 AND snap ->> 'acknowledge' = 'none' AND snap ->> 'selfApproval' = 'direktur_no_approval'
        -- every requester holds Direktur in this PT (active account + active membership) …
        AND EXISTS (SELECT 1 FROM expense_requests_rels rr WHERE rr.parent_id = rid AND rr.path = 'requesters')
        AND NOT EXISTS (
          SELECT 1 FROM expense_requests_rels rr
           WHERE rr.parent_id = rid AND rr.path = 'requesters' AND NOT EXISTS (
             SELECT 1 FROM company_memberships m JOIN users u ON u.id = m.user_id JOIN company_memberships_roles mr ON mr.parent_id = m.id
              WHERE m.employee_id = rr.employees_id AND m.company_id = company AND coalesce(m.active, true) AND coalesce(u.active, true) AND mr.value::text = 'pk-owner'))
        -- … and the creator is one of those Direktur accounts (his own request)
        AND EXISTS (
          SELECT 1 FROM expense_requests_rels rr JOIN company_memberships m ON m.employee_id = rr.employees_id
            JOIN users u ON u.id = m.user_id JOIN company_memberships_roles mr ON mr.parent_id = m.id
           WHERE rr.parent_id = rid AND rr.path = 'requesters' AND m.user_id = creator AND m.company_id = company
             AND coalesce(m.active, true) AND coalesce(u.active, true) AND mr.value::text = 'pk-owner'),
        false)
    $fn$;

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
      -- ADR 0024: the no-approval exception only for a Direktur's own request under a zero-step Direktur rule
      IF NEW.g1_exception = 'direktur_no_approval' AND pk_expense_editable(OLD.status::text) AND NOT pk_expense_editable(NEW.status::text)
         AND NOT pk_no_approval_allowed(NEW.id, NEW.company_id, NEW.created_by_id, NEW.approval_rule_id, NEW.approval_snapshot) THEN
        RAISE EXCEPTION 'expense_requests %: direktur_no_approval only for a Direktur''s own request under a zero-step Direktur rule (ADR 0024)', OLD.id USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;

    -- ---------------------------------------------------------------- 3. "Disetujui" needs a decision
    CREATE OR REPLACE FUNCTION pk_expense_requests_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF OLD.status::text = 'pending_approval' AND NEW.status::text = 'approved'
         AND NEW.g1_exception IS DISTINCT FROM 'direktur_no_approval'
         AND NOT EXISTS (SELECT 1 FROM approvals a
                          WHERE a.request_id = NEW.id AND a.doc_type::text = 'expense_request' AND a.cycle = NEW.approval_cycle
                            AND ((a.position::text = 'approval' AND a.decision::text = 'approved'
                                  AND a.level = (SELECT max((s ->> 'level')::int) FROM jsonb_array_elements(coalesce(NEW.approval_snapshot -> 'steps', '[]'::jsonb)) s))
                              -- G1-2: every approval level skipped → the "Diketahui" approval is final
                              OR (a.position::text = 'diketahui' AND a.decision::text = 'acknowledged'
                                  AND coalesce(jsonb_array_length(NEW.approval_snapshot -> 'steps'), 0) = 0))) THEN
        RAISE EXCEPTION 'expense_requests %: approved without a decision of cycle % (only direktur_no_approval, ADR 0024)', OLD.id, NEW.approval_cycle USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;
    DROP TRIGGER IF EXISTS expense_requests_approval_guard ON expense_requests;
    CREATE TRIGGER expense_requests_approval_guard BEFORE UPDATE ON expense_requests
      FOR EACH ROW EXECUTE FUNCTION pk_expense_requests_approval_guard();`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS expense_requests_approval_guard ON expense_requests;
    DROP FUNCTION IF EXISTS pk_expense_requests_approval_guard();
    DROP TRIGGER IF EXISTS approval_rules_zero_step ON approval_rules;
    DROP TRIGGER IF EXISTS approval_rules_steps_zero_step ON approval_rules_steps;
    DO $pk$
    BEGIN
      IF to_regclass('approval_rules_requester_roles') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS approval_rules_requester_roles_zero_step ON approval_rules_requester_roles;
      END IF;
    END
    $pk$;
    DROP FUNCTION IF EXISTS pk_approval_rules_zero_step_check();`)
  await db.execute(OLD_G1_FN)
  await db.execute(sql`
    DROP FUNCTION IF EXISTS pk_no_approval_allowed(integer, integer, integer, integer, jsonb);
    DROP FUNCTION IF EXISTS pk_rule_direktur_only(integer);
    DO $pk$
    BEGIN
      IF EXISTS (SELECT 1 FROM expense_requests WHERE g1_exception = 'direktur_no_approval') THEN
        RAISE NOTICE 'expense_requests carry direktur_no_approval: CHECK expense_requests_g1_exception_value kept with the ADR 0024 value';
      ELSE
        ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_g1_exception_value;
        ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_g1_exception_value CHECK (g1_exception IS NULL OR g1_exception IN ('direktur_via_pm', 'direktur_via_pm_self'));
      END IF;
    END
    $pk$;`)
}
