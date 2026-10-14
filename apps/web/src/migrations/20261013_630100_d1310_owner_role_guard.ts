import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

import { up as adr0024GuardUp } from './20261013_300000_d1010_approval_config_guard'

/**
 * ADR 0026 (owner decision 2026-10-13) — DB guards of the Owner approval level. Hand-written, re-runnable, run as
 * <prefix>_owner after 20261013_630000_d1310_owner_role (the enum value must be committed before it is used here).
 * Replaces the ADR 0024 function bodies of 20261013_300000_d1010_approval_config_guard:
 *
 * 1. `approval_rules_zero_step` (same DEFERRABLE constraint triggers, new body): a rule WITHOUT approval levels must be
 *    an expense-request rule without "Diketahui" whose requester roles are EXACTLY {pk-principal} (Owner). A
 *    Direktur's own request is approved by the Owner since ADR 0026 — the ADR 0024 zero-step Direktur rules get an
 *    Owner level from the data migration 20261013_630200 (the trigger checks a rule only when it is written).
 * 2. `expense_requests.g1_exception` CHECK += 'principal_no_approval'; `pk_expense_requests_g1_exception` accepts a
 *    no-approval value at the submit freeze point ONLY when `pk_no_approval_allowed_for`: the request's rule is a
 *    zero-step rule of the request's PT whose requester roles are exactly the role of the value
 *    (`principal_no_approval` → pk-principal; `direktur_no_approval` → pk-owner, which no rule can satisfy any more),
 *    the snapshot has no step / no "Diketahui" and carries the value, every requester employee has an active account
 *    holding that role in the PT (active membership) and the creator is one of them (his OWN request).
 * 3. `expense_requests_approval_guard`: "Menunggu persetujuan" → "Disetujui" needs the final decision of the cycle —
 *    or one of the two no-approval values.
 * ADDITIVE for the previous web image: it never writes the new value and never saves a zero-step rule; the only
 * behaviour it loses is saving a NEW zero-step Direktur rule (ADR 0026 policy).
 * Down: the ADR 0024 bodies are restored (re-running that migration's `up`) — refused while a request carries
 * `principal_no_approval` (that CHECK value cannot be dropped then); rows are never rewritten.
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

    -- ---------------------------------------------------------------- 1. zero-step rules (Owner only)
    CREATE OR REPLACE FUNCTION pk_rule_requester_only(rid integer, role text) RETURNS boolean LANGUAGE sql STABLE AS $fn$
      SELECT coalesce((SELECT array_agg(DISTINCT x.value::text) FROM approval_rules_requester_roles x WHERE x.parent_id = rid) = ARRAY[role]::text[], false)
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
      IF r.doc_type IS DISTINCT FROM 'expense_request' OR r.ack IS DISTINCT FROM 'none' OR NOT pk_rule_requester_only(rid, 'pk-principal') THEN
        RAISE EXCEPTION 'approval_rules %: a rule without approval levels is allowed only for requester role = Owner (pk-principal) on expense requests, without "Diketahui" (ADR 0024/0026)', rid
          USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END
    $fn$;

    -- ---------------------------------------------------------------- 2. g1_exception 'principal_no_approval'
    ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_g1_exception_value;
    ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_g1_exception_value
      CHECK (g1_exception IS NULL OR g1_exception IN ('direktur_via_pm', 'direktur_via_pm_self', 'direktur_no_approval', 'principal_no_approval'));

    CREATE OR REPLACE FUNCTION pk_no_approval_allowed_for(rid integer, company integer, creator integer, rule integer, snap jsonb, role text, exc text) RETURNS boolean LANGUAGE sql STABLE AS $fn$
      SELECT coalesce(
        -- the applied rule: a zero-step rule of the request's PT for exactly this requester role, without "Diketahui"
        EXISTS (SELECT 1 FROM approval_rules r
                 WHERE r.id = rule AND r.company_id = company AND r.doc_type::text = 'expense_request' AND r.acknowledge::text = 'none'
                   AND NOT EXISTS (SELECT 1 FROM approval_rules_steps s WHERE s._parent_id = r.id) AND pk_rule_requester_only(r.id, role))
        -- the snapshot: no step, no "Diketahui", the exception recorded
        AND coalesce(jsonb_array_length(snap -> 'steps'), 0) = 0 AND snap ->> 'acknowledge' = 'none' AND snap ->> 'selfApproval' = exc
        -- every requester holds the role in this PT (active account + active membership) …
        AND EXISTS (SELECT 1 FROM expense_requests_rels rr WHERE rr.parent_id = rid AND rr.path = 'requesters')
        AND NOT EXISTS (
          SELECT 1 FROM expense_requests_rels rr
           WHERE rr.parent_id = rid AND rr.path = 'requesters' AND NOT EXISTS (
             SELECT 1 FROM company_memberships m JOIN users u ON u.id = m.user_id JOIN company_memberships_roles mr ON mr.parent_id = m.id
              WHERE m.employee_id = rr.employees_id AND m.company_id = company AND coalesce(m.active, true) AND coalesce(u.active, true) AND mr.value::text = role))
        -- … and the creator is one of those accounts (his own request)
        AND EXISTS (
          SELECT 1 FROM expense_requests_rels rr JOIN company_memberships m ON m.employee_id = rr.employees_id
            JOIN users u ON u.id = m.user_id JOIN company_memberships_roles mr ON mr.parent_id = m.id
           WHERE rr.parent_id = rid AND rr.path = 'requesters' AND m.user_id = creator AND m.company_id = company
             AND coalesce(m.active, true) AND coalesce(u.active, true) AND mr.value::text = role),
        false)
    $fn$;

    -- ADR 0024 entry point kept (same signature) for any caller of the previous image
    CREATE OR REPLACE FUNCTION pk_no_approval_allowed(rid integer, company integer, creator integer, rule integer, snap jsonb) RETURNS boolean LANGUAGE sql STABLE AS $fn$
      SELECT pk_no_approval_allowed_for(rid, company, creator, rule, snap, 'pk-owner', 'direktur_no_approval')
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
      -- ADR 0024 / 0026: a no-approval value only for the requester's OWN request under the zero-step rule of his role
      IF NEW.g1_exception IN ('direktur_no_approval', 'principal_no_approval')
         AND pk_expense_editable(OLD.status::text) AND NOT pk_expense_editable(NEW.status::text)
         AND NOT pk_no_approval_allowed_for(NEW.id, NEW.company_id, NEW.created_by_id, NEW.approval_rule_id, NEW.approval_snapshot,
                                            CASE NEW.g1_exception WHEN 'principal_no_approval' THEN 'pk-principal' ELSE 'pk-owner' END, NEW.g1_exception) THEN
        RAISE EXCEPTION 'expense_requests %: % only for the requester''s own request under the zero-step rule of his role (ADR 0024/0026)', OLD.id, NEW.g1_exception USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;

    -- ---------------------------------------------------------------- 3. "Disetujui" needs a decision
    CREATE OR REPLACE FUNCTION pk_expense_requests_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF OLD.status::text = 'pending_approval' AND NEW.status::text = 'approved'
         AND coalesce(NEW.g1_exception, '') NOT IN ('direktur_no_approval', 'principal_no_approval')
         AND NOT EXISTS (SELECT 1 FROM approvals a
                          WHERE a.request_id = NEW.id AND a.doc_type::text = 'expense_request' AND a.cycle = NEW.approval_cycle
                            AND ((a.position::text = 'approval' AND a.decision::text = 'approved'
                                  AND a.level = (SELECT max((s ->> 'level')::int) FROM jsonb_array_elements(coalesce(NEW.approval_snapshot -> 'steps', '[]'::jsonb)) s))
                              -- G1-2: every approval level skipped → the "Diketahui" approval is final
                              OR (a.position::text = 'diketahui' AND a.decision::text = 'acknowledged'
                                  AND coalesce(jsonb_array_length(NEW.approval_snapshot -> 'steps'), 0) = 0))) THEN
        RAISE EXCEPTION 'expense_requests %: approved without a decision of cycle % (only direktur_no_approval / principal_no_approval, ADR 0024/0026)', OLD.id, NEW.approval_cycle USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  const r = (await db.execute(sql`SELECT count(*)::int AS n FROM expense_requests WHERE g1_exception = 'principal_no_approval'`)) as unknown as { rows: Array<{ n: number }> }
  if ((r.rows[0]?.n ?? 0) > 0) {
    throw new Error(`20261013_630100_d1310_owner_role_guard down: ${r.rows[0]!.n} request(s) carry principal_no_approval (ADR 0026) — not reverted`)
  }
  // ADR 0024 bodies (zero-step = Direktur only, CHECK without the ADR 0026 value, approval guard) — re-runnable
  await adr0024GuardUp({ db, payload, req } as MigrateUpArgs)
  await db.execute(sql`
    DROP FUNCTION IF EXISTS pk_no_approval_allowed_for(integer, integer, integer, integer, jsonb, text, text);
    DROP FUNCTION IF EXISTS pk_rule_requester_only(integer, text);`)
}
