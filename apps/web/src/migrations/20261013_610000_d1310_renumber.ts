import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 13/10 Wave 4 (Umum #1) — prerequisites of the ONE-TIME document renumbering (ADR 0007 "Amendment
 * 2026-10-13"). Hand-written, run as <prefix>_owner. This migration renumbers NOTHING: the renumbering itself is the
 * CLI `src/renumber/cli.ts` (dry-run → review → apply by the infra Lead, runbook `runbooks/penomoran-ulang.md`).
 *
 * 1. `audit_logs.action` += 'renumbered' (one row per renumbered document: old → new, same txid as the change).
 * 2. `document_renumber_runs`: one row per PT that was renumbered (UNIQUE per PT → the CLI can never run twice for a
 *    PT); written only by the owner (INSERT/UPDATE revoked from the app role), no DELETE/TRUNCATE; a run is inserted
 *    `running` with the txid of the renumber transaction and set `applied` in that same transaction.
 * 3. `pk_renumber_bypass(table, old, new)`: TRUE only while (a) the session flag `pk.renumber = 'on'` is set
 *    (SET LOCAL), (b) a `running` run row exists for the CURRENT txid (only the owner can insert one), and (c) the
 *    row change touches nothing but the columns the renumbering may write in that table:
 *      expense_requests / transfers / settlements / progress_reports / budget_addenda / service_reports /
 *      daily_reports / project_loans: doc_no · cash_entries: entry_no, description · notifications: doc_no, title,
 *      body · receipt_flags: message, detail · document_sequence_counters: next_value (may go down) — plus updated_at.
 *    SECURITY DEFINER (owner) so it can read the run table under the app role; it only answers a boolean.
 * 4. The immutability / workflow guards of those tables get a 3-line prelude (marked `pk:renumber-bypass`) right after
 *    their top-level BEGIN: `IF TG_OP = 'UPDATE' AND <flag on> THEN IF pk_renumber_bypass(...) THEN RETURN NEW …`.
 *    The prelude is inserted into the CURRENT definition (pg_get_functiondef), so every guard keeps its exact body;
 *    without the flag + a registered run the prelude is a no-op and every ordinary write stays blocked exactly as
 *    before (integration test d1310-w4-renumber). Guards that only check CHANGED columns (pk_same_company,
 *    pk_company_member, g1 / project / approval rules of expense_requests, the receipt-flag self-review guard) need
 *    no prelude. A later migration that re-creates one of these functions must keep the prelude (the integration test
 *    lists them and fails otherwise).
 * Down: refused once a renumbering ran (append-only audit rows / runs → restore the dump); otherwise the preludes are
 * removed, the function / table dropped and the enum re-created without 'renumbered'.
 */
export const RENUMBER_MARKER = 'pk:renumber-bypass'

/** Guards that would refuse a number / derived-text change; each gets the prelude. */
export const RENUMBER_GUARDED_FUNCTIONS = [
  'pk_protect_columns',
  'pk_counter_monotonic',
  'pk_expense_requests_guard',
  'pk_expense_frozen_check',
  'pk_transfers_guard',
  'pk_settlements_guard',
  'pk_settlements_photos_freeze',
  'pk_settlements_photos_check',
  'pk_cash_entries_guard',
  'pk_progress_report_window',
  'pk_field_report_window',
  'pk_budget_addenda_guard',
  'pk_project_loans_guard',
  'pk_receipt_flags_guard',
] as const

/** Trigger functions on the renumbered tables that need NO prelude (they only check columns that changed). */
export const RENUMBER_NEUTRAL_FUNCTIONS = [
  'pk_same_company',
  'pk_company_member',
  'pk_expense_requests_g1_exception',
  'pk_expense_requests_project_rules',
  'pk_expense_requests_approval_guard',
  'pk_receipt_flags_self_review_guard',
  // ADR 0027 (20261013_700100, vendor payments): its status check covers statuses a vendor row never reaches and its
  // vendor-account check runs only when vendor / account change → a number-only change passes
  'pk_expense_vendor_guard',
  // ADR 0028 (20261014_100200, intercompany): deferred link consistency — fired only when `status` changes
  // (`UPDATE OF status` + WHEN) on cash_entries / transfers; the KM link check runs on INSERT only
  'pk_ic_consistency',
  'pk_ic_entry_linked',
  // ADR 0029 (20261015_100200, fund check): backstop on expense_requests — fired only on a status change INTO `approved`
  // (`UPDATE OF status` + WHEN pending → approved), so a doc_no-only update never reaches it. `pk_ic_entry_linked` /
  // `pk_ic_consistency` are re-created there with the same firing rules (INSERT only / status change only). The loan
  // tables (`intercompany_loans`, `intercompany_loan_transfers`: pk_icl_guard, pk_icl_transfer_guard) are not renumbered
  // — PJA numbers are issued in the D5 shape from day one; if they ever are, pk_icl_guard (it freezes doc_no) must move
  // to RENUMBER_GUARDED_FUNCTIONS with the prelude.
  'pk_expense_fund_guard',
  // ADR 0031 (20261021_100200, Pusat Biaya = akun kas): deferred cash-leg check of an inter-project loan — it re-reads the
  // loan's `project_loan` cash rows (amount / account / status), so a number-only update of the loan or of a cash row
  // passes unchanged; the transfer "paid from" check fires on INSERT only
  'pk_project_loan_cash_consistency',
  'pk_transfers_paid_from_loan',
] as const

const PRELUDE = `
      -- ${RENUMBER_MARKER}: ADR 0007 Amendment 2026-10-13 (one-time renumbering: owner run + session flag only)
      IF TG_OP = 'UPDATE' AND current_setting('pk.renumber', true) = 'on' THEN
        IF pk_renumber_bypass(TG_TABLE_NAME::text, to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF;
      END IF;`

const NAME = '20261013_610000_d1310_renumber'

async function functionDef(db: MigrateUpArgs['db'], fn: string): Promise<string> {
  const r = (await db.execute(sql`
    SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ${fn} AND p.pronargs = 0`)) as unknown as { rows: Array<{ def: string }> }
  if (r.rows.length !== 1) throw new Error(`${NAME}: function ${fn}() not found exactly once (${r.rows.length})`)
  return r.rows[0]!.def
}

/** Inserts the prelude after the first top-level `BEGIN` (the body's DECLARE section never contains that word). */
export function withPrelude(def: string): string {
  if (def.includes(RENUMBER_MARKER)) return def
  const m = /\bBEGIN\b/.exec(def)
  if (!m) throw new Error(`${NAME}: no BEGIN in ${def.slice(0, 80)}`)
  return `${def.slice(0, m.index + 5)}${PRELUDE}${def.slice(m.index + 5)}`
}

export function withoutPrelude(def: string): string {
  return def.includes(RENUMBER_MARKER) ? def.replace(PRELUDE, '') : def
}

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;
  ALTER TYPE "public"."enum_audit_logs_action" ADD VALUE IF NOT EXISTS 'renumbered';`)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS document_renumber_runs (
      id          serial PRIMARY KEY,
      company_id  integer NOT NULL REFERENCES companies(id),
      tx_id       bigint NOT NULL,
      status      text NOT NULL CHECK (status IN ('running', 'applied')),
      operator    text NOT NULL CHECK (length(operator) BETWEEN 1 AND 200),
      plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
      documents   integer,
      changed     integer,
      summary     jsonb,
      started_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
      finished_at timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS document_renumber_runs_once ON document_renumber_runs (company_id);
    CREATE INDEX IF NOT EXISTS document_renumber_runs_tx ON document_renumber_runs (tx_id);

    CREATE OR REPLACE FUNCTION pk_renumber_runs_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'running' OR NEW.tx_id <> txid_current() OR NEW.finished_at IS NOT NULL THEN
          RAISE EXCEPTION 'document_renumber_runs: a run starts as running in its own transaction' USING ERRCODE = '42501';
        END IF;
        NEW.started_at := clock_timestamp();
        RETURN NEW;
      END IF;
      IF NOT (OLD.status = 'running' AND NEW.status = 'applied' AND OLD.tx_id = txid_current()
              AND NEW.tx_id = OLD.tx_id AND NEW.company_id = OLD.company_id AND NEW.operator = OLD.operator
              AND NEW.plan_sha256 = OLD.plan_sha256 AND NEW.started_at = OLD.started_at) THEN
        RAISE EXCEPTION 'document_renumber_runs %: only running → applied in the run transaction', OLD.id USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;
    DROP TRIGGER IF EXISTS document_renumber_runs_guard ON document_renumber_runs;
    CREATE TRIGGER document_renumber_runs_guard BEFORE INSERT OR UPDATE ON document_renumber_runs FOR EACH ROW EXECUTE FUNCTION pk_renumber_runs_guard();
    DROP TRIGGER IF EXISTS document_renumber_runs_no_delete ON document_renumber_runs;
    CREATE TRIGGER document_renumber_runs_no_delete BEFORE DELETE ON document_renumber_runs FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
    DROP TRIGGER IF EXISTS document_renumber_runs_no_truncate ON document_renumber_runs;
    CREATE TRIGGER document_renumber_runs_no_truncate BEFORE TRUNCATE ON document_renumber_runs FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();

    DO $pk$
    DECLARE
      app_role text := regexp_replace(current_user, '_owner$', '_app');
    BEGIN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON document_renumber_runs FROM %I', app_role);
      EXECUTE format('REVOKE USAGE ON SEQUENCE document_renumber_runs_id_seq FROM %I', app_role);
    END
    $pk$;

    CREATE OR REPLACE FUNCTION pk_renumber_bypass(tbl text, o jsonb, n jsonb) RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    DECLARE
      allowed text[];
    BEGIN
      IF coalesce(current_setting('pk.renumber', true), '') <> 'on' THEN
        RETURN false;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM document_renumber_runs r WHERE r.tx_id = txid_current() AND r.status = 'running') THEN
        RETURN false;
      END IF;
      allowed := CASE tbl
        WHEN 'expense_requests' THEN ARRAY['doc_no', 'updated_at']
        WHEN 'transfers' THEN ARRAY['doc_no', 'updated_at']
        WHEN 'settlements' THEN ARRAY['doc_no', 'updated_at']
        WHEN 'progress_reports' THEN ARRAY['doc_no', 'updated_at']
        WHEN 'budget_addenda' THEN ARRAY['doc_no', 'updated_at']
        WHEN 'service_reports' THEN ARRAY['doc_no', 'updated_at']
        WHEN 'daily_reports' THEN ARRAY['doc_no', 'updated_at']
        WHEN 'project_loans' THEN ARRAY['doc_no', 'updated_at']
        WHEN 'cash_entries' THEN ARRAY['entry_no', 'description', 'updated_at']
        WHEN 'notifications' THEN ARRAY['doc_no', 'title', 'body', 'updated_at']
        WHEN 'receipt_flags' THEN ARRAY['message', 'detail', 'updated_at']
        WHEN 'document_sequence_counters' THEN ARRAY['next_value']
        ELSE NULL END;
      IF allowed IS NULL OR o IS NULL OR n IS NULL THEN
        RETURN false;
      END IF;
      RETURN (o - allowed) = (n - allowed);
    END
    $fn$;
    REVOKE ALL ON FUNCTION pk_renumber_bypass(text, jsonb, jsonb) FROM PUBLIC;
    DO $pk$
    BEGIN
      EXECUTE format('GRANT EXECUTE ON FUNCTION pk_renumber_bypass(text, jsonb, jsonb) TO %I', regexp_replace(current_user, '_owner$', '_app'));
    END
    $pk$;`)

  for (const fn of RENUMBER_GUARDED_FUNCTIONS) {
    const def = await functionDef(db, fn)
    const next = withPrelude(def)
    if (!next.includes(RENUMBER_MARKER)) throw new Error(`${NAME}: prelude not inserted into ${fn}`)
    if (next !== def) await db.execute(sql.raw(next))
  }
  payload?.logger?.info?.({ msg: `${NAME}: renumber prerequisites (no document changed)`, guarded: RENUMBER_GUARDED_FUNCTIONS })
}

/** enum_audit_logs_action as of 20261013_400000 (frozen copy, without 'renumbered'). */
const ACTIONS_BEFORE = [
  'create', 'update', 'status_change', 'deactivate', 'reactivate', 'delete_attempt', 'void', 'view_sensitive', 'login', 'logout', 'login_failed',
  'session_revoked', 'role_change', 'role_sync', 'device_register', 'device_revoke', 'number_issued', 'export', 'print', 'sign', 'acknowledge',
  'flag_raised', 'flag_reviewed', 'sync_odoo', 'sync_offline', 'period_close', 'period_reopen', 'schema_maintenance', 'email_test', 'approve', 'reject',
  'verify', 'acknowledge_delegated', 'access_denied', 'approval_skipped', 'approval_policy_exception', 'retention_purge', 'import', '2fa_enabled',
  '2fa_disabled', 'privacy_ack', 'overdraft_confirmed', 'bank_unverified_confirmed',
]

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF EXISTS (SELECT 1 FROM document_renumber_runs) OR EXISTS (SELECT 1 FROM audit_logs WHERE action::text = 'renumbered') THEN
        RAISE EXCEPTION 'd1310_renumber down: a renumbering ran (append-only runs / audit rows); not rolling back (restore the dump)';
      END IF;
    END
    $pk$;`)
  for (const fn of RENUMBER_GUARDED_FUNCTIONS) {
    const def = await functionDef(db as unknown as MigrateUpArgs['db'], fn)
    const prev = withoutPrelude(def)
    if (prev !== def) await db.execute(sql.raw(prev))
  }
  await db.execute(sql`
    DROP FUNCTION IF EXISTS pk_renumber_bypass(text, jsonb, jsonb);
    DROP TABLE IF EXISTS document_renumber_runs;
    DROP FUNCTION IF EXISTS pk_renumber_runs_guard();`)
  await db.execute(
    sql.raw(`
    ALTER TABLE "audit_logs" ALTER COLUMN "action" SET DATA TYPE text;
    DROP TYPE "public"."enum_audit_logs_action";
    CREATE TYPE "public"."enum_audit_logs_action" AS ENUM(${ACTIONS_BEFORE.map((a) => `'${a}'`).join(', ')});
    ALTER TABLE "audit_logs" ALTER COLUMN "action" SET DATA TYPE "public"."enum_audit_logs_action" USING "action"::"public"."enum_audit_logs_action";`),
  )
}
