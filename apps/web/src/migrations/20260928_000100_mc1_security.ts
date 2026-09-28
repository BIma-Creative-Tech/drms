import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

import { PER_PT_TABLES } from './20260927_234849_mc1_company_columns'

/**
 * MC1-4 security (ADR 0016 §4, "Migration / backfill" step 3), hand-written, run as <prefix>_owner:
 * 1. `company_id` immutable on every per-PT table (+ notifications/audit tag): `<table>_company_protect`
 *    = `pk_protect_columns('company_id')` (a PT change = new document, never an UPDATE).
 * 2. Cross-PT references rejected by the DB (SQLSTATE 23514, message `cross-company reference`):
 *    - `pk_same_company(col, parent, …)` on per-PT rows: every listed per-PT reference must carry the
 *      row's company (checked on INSERT and when the column changes);
 *    - `pk_child_same_company(parent_col, parent, col, target, …)` on Payload child tables
 *      (`expense_requests_rels` requesters, `expense_requests_lines`, `approval_rules_steps`);
 *    - `pk_company_member(col, …)`: user references (PM, cost center manager, named approvers) need an
 *      ACTIVE membership in the row's company; `companies.default_work_schedule_id` must be of that PT.
 *    Shared masters (banks, UoM) and users/media are not listed → always allowed.
 * 3. Period lock per PT: `pk_cash_lock_date(company_id)` replaces `pk_cash_lock_date()`; the transfer,
 *    cash-entry and opening-balance guards pass the row's company (closing PT A never locks PT B).
 * 4. `reminder_runs` keyed `(company_id, run_date)` (one daily run per PT, ADR 0016 §7).
 * Staging-safe: every existing row belongs to company #1 (migration `*_mc1_company_columns`), so no
 * existing row violates a check; the triggers only act on new writes.
 */
const REFS: Record<string, Array<[string, string]>> = {
  expense_requests: [['project_id', 'projects'], ['cost_center_id', 'cost_centers'], ['bank_account_id', 'employee_bank_accounts'], ['approval_rule_id', 'approval_rules'], ['resubmit_of_id', 'expense_requests']],
  receipts: [['request_id', 'expense_requests'], ['vendor_id', 'vendors']],
  receipt_flags: [['request_id', 'expense_requests'], ['receipt_id', 'receipts']],
  approvals: [['request_id', 'expense_requests'], ['addendum_id', 'budget_addenda'], ['employee_id', 'employees']],
  transfers: [['request_id', 'expense_requests'], ['cash_account_id', 'cash_accounts'], ['cash_entry_id', 'cash_entries']],
  cash_entries: [
    ['cash_account_id', 'cash_accounts'], ['category_id', 'expense_categories'], ['cash_in_source_id', 'cash_in_sources'], ['project_id', 'projects'],
    ['cost_center_id', 'cost_centers'], ['vehicle_id', 'vehicles'], ['expense_request_id', 'expense_requests'], ['transfer_id', 'transfers'], ['reversal_of_id', 'cash_entries'],
  ],
  settlements: [['request_id', 'expense_requests'], ['refund_cash_entry_id', 'cash_entries'], ['shortfall_transfer_id', 'transfers']],
  budget_addenda: [['project_id', 'projects'], ['approval_rule_id', 'approval_rules']],
  budget_lines: [['project_id', 'projects'], ['category_id', 'expense_categories']],
  progress_reports: [['project_id', 'projects'], ['stage_id', 'project_stages']],
  project_stages: [['project_id', 'projects']],
  projects: [['client_id', 'clients']],
  vehicles: [['project_id', 'projects'], ['cost_center_id', 'cost_centers']],
  team_assignments: [['employee_id', 'employees'], ['project_id', 'projects'], ['cost_center_id', 'cost_centers']],
  attendances: [['employee_id', 'employees'], ['project_id', 'projects'], ['cost_center_id', 'cost_centers']],
  attendance_corrections: [['attendance_id', 'attendances'], ['employee_id', 'employees'], ['project_id', 'projects'], ['cost_center_id', 'cost_centers']],
  employees: [['work_schedule_id', 'work_schedules']],
  employee_bank_accounts: [['employee_id', 'employees']],
  approval_rules: [['category_id', 'expense_categories'], ['project_id', 'projects'], ['cost_center_id', 'cost_centers']],
  expense_line_snapshots: [['request_id', 'expense_requests']],
  company_memberships: [['employee_id', 'employees']],
}

/** Child tables: [parent column, parent table, (column, target table)…]. */
const CHILD_REFS: Record<string, [string, string, Array<[string, string]>]> = {
  expense_requests_rels: ['parent_id', 'expense_requests', [['employees_id', 'employees']]],
  expense_requests_lines: ['_parent_id', 'expense_requests', [['category_id', 'expense_categories'], ['vehicle_id', 'vehicles']]],
}

/** User references that need an ACTIVE membership in the row's company. */
const MEMBERS: Record<string, string[]> = {
  projects: ['pm_id'],
  cost_centers: ['manager_id'],
  approval_rules: ['acknowledge_user_id'],
}

const TAGGED = ['notifications', 'audit_logs'] as const

const pairs = (list: Array<[string, string]>) => list.flatMap(([c, t]) => [`'${c}'`, `'${t}'`]).join(', ')

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;

    CREATE OR REPLACE FUNCTION pk_same_company() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      i integer := 0;
      o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
      n jsonb := to_jsonb(NEW);
      v text;
      c integer;
    BEGIN
      WHILE i < TG_NARGS LOOP
        v := n ->> TG_ARGV[i];
        IF v IS NOT NULL AND (TG_OP = 'INSERT' OR v IS DISTINCT FROM o ->> TG_ARGV[i]) THEN
          EXECUTE format('SELECT company_id FROM %I WHERE id = $1', TG_ARGV[i + 1]) INTO c USING v::integer;
          IF c IS DISTINCT FROM NEW.company_id THEN
            RAISE EXCEPTION 'cross-company reference: %.% → % (row PT %, referenced PT %)', TG_TABLE_NAME, TG_ARGV[i], TG_ARGV[i + 1], NEW.company_id, c
              USING ERRCODE = '23514';
          END IF;
        END IF;
        i := i + 2;
      END LOOP;
      RETURN NEW;
    END
    $fn$;

    CREATE OR REPLACE FUNCTION pk_child_same_company() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      i integer := 2;
      n jsonb := to_jsonb(NEW);
      pc integer;
      v text;
      c integer;
    BEGIN
      EXECUTE format('SELECT company_id FROM %I WHERE id = $1', TG_ARGV[1]) INTO pc USING (n ->> TG_ARGV[0])::integer;
      WHILE i < TG_NARGS LOOP
        v := n ->> TG_ARGV[i];
        IF v IS NOT NULL THEN
          EXECUTE format('SELECT company_id FROM %I WHERE id = $1', TG_ARGV[i + 1]) INTO c USING v::integer;
          IF c IS DISTINCT FROM pc THEN
            RAISE EXCEPTION 'cross-company reference: %.% → % (document PT %, referenced PT %)', TG_TABLE_NAME, TG_ARGV[i], TG_ARGV[i + 1], pc, c
              USING ERRCODE = '23514';
          END IF;
        END IF;
        i := i + 2;
      END LOOP;
      RETURN NEW;
    END
    $fn$;

    CREATE OR REPLACE FUNCTION pk_company_member() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      col text;
      o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
      n jsonb := to_jsonb(NEW);
      v text;
    BEGIN
      FOREACH col IN ARRAY TG_ARGV LOOP
        v := n ->> col;
        IF v IS NOT NULL AND (TG_OP = 'INSERT' OR v IS DISTINCT FROM o ->> col)
           AND NOT EXISTS (SELECT 1 FROM company_memberships m WHERE m.user_id = v::integer AND m.company_id = NEW.company_id AND coalesce(m.active, true)) THEN
          RAISE EXCEPTION 'cross-company reference: %.% → user % without an active membership in PT %', TG_TABLE_NAME, col, v, NEW.company_id
            USING ERRCODE = '23514';
        END IF;
      END LOOP;
      RETURN NEW;
    END
    $fn$;

    -- approval_rules_steps.approver_user_id: member of the RULE's company
    CREATE OR REPLACE FUNCTION pk_rule_step_member() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      pc integer;
    BEGIN
      IF NEW.approver_user_id IS NULL THEN RETURN NEW; END IF;
      SELECT company_id INTO pc FROM approval_rules WHERE id = NEW._parent_id;
      IF NOT EXISTS (SELECT 1 FROM company_memberships m WHERE m.user_id = NEW.approver_user_id AND m.company_id = pc AND coalesce(m.active, true)) THEN
        RAISE EXCEPTION 'cross-company reference: approval_rules_steps.approver_user_id → user % without an active membership in PT %', NEW.approver_user_id, pc
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER approval_rules_steps_company BEFORE INSERT OR UPDATE ON approval_rules_steps FOR EACH ROW EXECUTE FUNCTION pk_rule_step_member();

    -- companies.default_work_schedule_id: a work schedule of THAT company
    CREATE OR REPLACE FUNCTION pk_companies_schedule() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.default_work_schedule_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM work_schedules w WHERE w.id = NEW.default_work_schedule_id AND w.company_id = NEW.id) THEN
        RAISE EXCEPTION 'cross-company reference: companies.default_work_schedule_id → work schedule of another PT' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER companies_schedule_company BEFORE INSERT OR UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION pk_companies_schedule();

    -- period lock per PT (ADR 0016 §4 / ADR 0005 §6 revision)
    CREATE OR REPLACE FUNCTION pk_cash_lock_date(p_company integer) RETURNS date LANGUAGE sql STABLE AS $fn$
      SELECT (max(to_date(period || '-01', 'YYYY-MM-DD')) + interval '1 month' - interval '1 day')::date
      FROM period_closings WHERE status = 'closed' AND company_id = p_company
    $fn$;

    CREATE OR REPLACE FUNCTION pk_cash_entries_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      lock_d date := pk_cash_lock_date(NEW.company_id);
      descr text[] := ARRAY['description', 'category_id', 'cash_in_source_id', 'project_id', 'cost_center_id', 'vehicle_id', 'proof_id'];
      voidc text[] := ARRAY['status', 'void_reason', 'voided_by_id', 'voided_at', 'reversed_by_id'];
      o jsonb := to_jsonb(OLD);
      n jsonb := to_jsonb(NEW);
      k text;
      descr_changed boolean := false;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        NEW.period := substr(NEW.entry_date, 1, 7);
        NEW.posted_at := clock_timestamp();
        IF lock_d IS NOT NULL AND NEW.entry_date::date <= lock_d THEN
          RAISE EXCEPTION 'cash_entries: period of % is closed (lock date %)', NEW.entry_date, lock_d USING ERRCODE = '42501';
        END IF;
        IF NEW.status <> 'posted' OR NEW.void_reason IS NOT NULL OR NEW.reversed_by_id IS NOT NULL THEN
          RAISE EXCEPTION 'cash_entries: new entries are posted' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;
      -- posted rows: amount/direction/account/date/number/source never change (void + new entry)
      IF (o - descr - voidc - 'updated_at') IS DISTINCT FROM (n - descr - voidc - 'updated_at') THEN
        RAISE EXCEPTION 'cash_entries %: posted entries are immutable (void + new entry)', OLD.id USING ERRCODE = '42501';
      END IF;
      FOREACH k IN ARRAY descr LOOP
        IF (o -> k) IS DISTINCT FROM (n -> k) THEN descr_changed := true; END IF;
      END LOOP;
      IF descr_changed AND (OLD.source_type <> 'manual' OR OLD.status <> 'posted' OR NEW.status <> 'posted'
                            OR (lock_d IS NOT NULL AND OLD.entry_date::date <= lock_d)) THEN
        RAISE EXCEPTION 'cash_entries %: only manual posted entries of an open period can be edited', OLD.id USING ERRCODE = '42501';
      END IF;
      IF (o -> 'status') IS DISTINCT FROM (n -> 'status') OR (o -> 'void_reason') IS DISTINCT FROM (n -> 'void_reason')
         OR (o -> 'voided_by_id') IS DISTINCT FROM (n -> 'voided_by_id') OR (o -> 'voided_at') IS DISTINCT FROM (n -> 'voided_at')
         OR (o -> 'reversed_by_id') IS DISTINCT FROM (n -> 'reversed_by_id') THEN
        IF NOT (OLD.status = 'posted' AND NEW.status = 'void' AND NEW.void_reason IS NOT NULL AND OLD.void_reason IS NULL
                AND OLD.source_type <> 'reversal') THEN
          RAISE EXCEPTION 'cash_entries %: only posted → void (with reason) is allowed', OLD.id USING ERRCODE = '42501';
        END IF;
      END IF;
      RETURN NEW;
    END
    $fn$;

    CREATE OR REPLACE FUNCTION pk_transfers_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      r record;
      s record;
      lock_d date := pk_cash_lock_date(NEW.company_id);
      wl text[] := ARRAY['status', 'void_reason', 'voided_by_id', 'voided_at', 'cash_entry_id', 'updated_at'];
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF lock_d IS NOT NULL AND NEW.transfer_date::date <= lock_d THEN
          RAISE EXCEPTION 'transfers: period of % is closed (lock date %)', NEW.transfer_date, lock_d USING ERRCODE = '42501';
        END IF;
        SELECT type::text AS type, status::text AS status, approved_amount INTO r FROM expense_requests WHERE id = NEW.request_id;
        IF NEW.kind IN ('advance', 'reimburse') THEN
          IF r.approved_amount IS NULL OR NEW.amount <> r.approved_amount THEN
            RAISE EXCEPTION 'transfers: amount must equal the approved amount (G3)' USING ERRCODE = '42501';
          END IF;
          IF NOT ((r.type = 'advance' AND r.status = 'approved') OR (r.type = 'reimburse' AND r.status = 'receipts_verified')) THEN
            RAISE EXCEPTION 'transfers: request % is not in the transfer queue (%)', NEW.request_id, r.status USING ERRCODE = '42501';
          END IF;
        ELSIF NEW.kind = 'lpj_shortfall' THEN
          SELECT status::text AS status, settlement_type::text AS settlement_type, difference INTO s FROM settlements WHERE request_id = NEW.request_id;
          IF r.type IS DISTINCT FROM 'advance' OR r.status IS DISTINCT FROM 'lpj_verified' OR s.status IS DISTINCT FROM 'verified'
             OR s.settlement_type IS DISTINCT FROM 'shortfall' OR NEW.amount <> -s.difference THEN
            RAISE EXCEPTION 'transfers: shortfall transfer must equal the verified LPJ shortfall (G3)' USING ERRCODE = '42501';
          END IF;
          IF EXISTS (SELECT 1 FROM transfers t WHERE t.request_id = NEW.request_id AND t.kind = 'lpj_shortfall' AND t.status = 'posted') THEN
            RAISE EXCEPTION 'transfers: request % already has a shortfall transfer', NEW.request_id USING ERRCODE = '42501';
          END IF;
        END IF;
        IF NEW.status <> 'posted' OR NEW.void_reason IS NOT NULL THEN
          RAISE EXCEPTION 'transfers: new transfers are posted' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;
      IF (to_jsonb(OLD) - wl) IS DISTINCT FROM (to_jsonb(NEW) - wl)
         OR (OLD.cash_entry_id IS NOT NULL AND NEW.cash_entry_id IS DISTINCT FROM OLD.cash_entry_id)
         OR (OLD.status = 'void' AND (to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at'))
         OR (NEW.status = 'void' AND NEW.void_reason IS NULL)
         OR (NEW.status = 'posted' AND (NEW.void_reason IS NOT NULL OR NEW.voided_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'transfers %: posted transfers are immutable (void only)', OLD.id USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;

    CREATE OR REPLACE FUNCTION pk_cash_accounts_opening_lock() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      p text;
    BEGIN
      IF OLD.opening_balance_date IS NOT NULL
         AND (NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
              OR NEW.opening_balance_date IS DISTINCT FROM OLD.opening_balance_date) THEN
        SELECT min(period) INTO p FROM period_closings
          WHERE status = 'closed' AND company_id = OLD.company_id AND period >= substr(OLD.opening_balance_date, 1, 7);
        IF p IS NOT NULL THEN
          RAISE EXCEPTION 'cash_accounts %: opening balance is locked (period % is closed)', OLD.id, p USING ERRCODE = '42501';
        END IF;
      END IF;
      RETURN NEW;
    END
    $fn$;

    DROP FUNCTION IF EXISTS pk_cash_lock_date();

    -- one reminder run per PT and day
    ALTER TABLE reminder_runs ADD COLUMN company_id integer REFERENCES companies(id);
    UPDATE reminder_runs SET company_id = (SELECT min(id) FROM companies) WHERE company_id IS NULL;
    ALTER TABLE reminder_runs ALTER COLUMN company_id SET NOT NULL;
    ALTER TABLE reminder_runs DROP CONSTRAINT reminder_runs_pkey;
    ALTER TABLE reminder_runs ADD PRIMARY KEY (company_id, run_date);
  `)

  for (const t of [...PER_PT_TABLES, ...TAGGED]) {
    await db.execute(sql.raw(`CREATE TRIGGER ${t}_company_protect BEFORE UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('company_id');`))
  }
  for (const [t, list] of Object.entries(REFS)) {
    await db.execute(sql.raw(`CREATE TRIGGER ${t}_company_refs BEFORE INSERT OR UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION pk_same_company(${pairs(list)});`))
  }
  for (const [t, [pcol, ptable, list]] of Object.entries(CHILD_REFS)) {
    await db.execute(sql.raw(`CREATE TRIGGER ${t}_company_refs BEFORE INSERT OR UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION pk_child_same_company('${pcol}', '${ptable}', ${pairs(list)});`))
  }
  for (const [t, cols] of Object.entries(MEMBERS)) {
    await db.execute(sql.raw(`CREATE TRIGGER ${t}_company_members BEFORE INSERT OR UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION pk_company_member(${cols.map((c) => `'${c}'`).join(', ')});`))
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  for (const t of [...PER_PT_TABLES, ...TAGGED]) await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${t}_company_protect ON ${t};`))
  for (const t of [...Object.keys(REFS), ...Object.keys(CHILD_REFS)]) await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${t}_company_refs ON ${t};`))
  for (const t of Object.keys(MEMBERS)) await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${t}_company_members ON ${t};`))
  await db.execute(sql`
    DROP TRIGGER IF EXISTS approval_rules_steps_company ON approval_rules_steps;
    DROP TRIGGER IF EXISTS companies_schedule_company ON companies;
    DROP FUNCTION IF EXISTS pk_rule_step_member();
    DROP FUNCTION IF EXISTS pk_companies_schedule();
    DROP FUNCTION IF EXISTS pk_company_member();
    DROP FUNCTION IF EXISTS pk_child_same_company();
    DROP FUNCTION IF EXISTS pk_same_company();

    ALTER TABLE reminder_runs DROP CONSTRAINT reminder_runs_pkey;
    DELETE FROM reminder_runs WHERE company_id <> (SELECT min(id) FROM companies);
    ALTER TABLE reminder_runs ADD PRIMARY KEY (run_date);
    ALTER TABLE reminder_runs DROP COLUMN company_id;

    CREATE OR REPLACE FUNCTION pk_cash_lock_date() RETURNS date LANGUAGE sql STABLE AS $fn$
      SELECT (max(to_date(period || '-01', 'YYYY-MM-DD')) + interval '1 month' - interval '1 day')::date
      FROM period_closings WHERE status = 'closed'
    $fn$;
    CREATE OR REPLACE FUNCTION pk_cash_entries_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      lock_d date := pk_cash_lock_date();
      descr text[] := ARRAY['description', 'category_id', 'cash_in_source_id', 'project_id', 'cost_center_id', 'vehicle_id', 'proof_id'];
      voidc text[] := ARRAY['status', 'void_reason', 'voided_by_id', 'voided_at', 'reversed_by_id'];
      o jsonb := to_jsonb(OLD);
      n jsonb := to_jsonb(NEW);
      k text;
      descr_changed boolean := false;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        NEW.period := substr(NEW.entry_date, 1, 7);
        NEW.posted_at := clock_timestamp();
        IF lock_d IS NOT NULL AND NEW.entry_date::date <= lock_d THEN
          RAISE EXCEPTION 'cash_entries: period of % is closed (lock date %)', NEW.entry_date, lock_d USING ERRCODE = '42501';
        END IF;
        IF NEW.status <> 'posted' OR NEW.void_reason IS NOT NULL OR NEW.reversed_by_id IS NOT NULL THEN
          RAISE EXCEPTION 'cash_entries: new entries are posted' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;
      -- posted rows: amount/direction/account/date/number/source never change (void + new entry)
      IF (o - descr - voidc - 'updated_at') IS DISTINCT FROM (n - descr - voidc - 'updated_at') THEN
        RAISE EXCEPTION 'cash_entries %: posted entries are immutable (void + new entry)', OLD.id USING ERRCODE = '42501';
      END IF;
      FOREACH k IN ARRAY descr LOOP
        IF (o -> k) IS DISTINCT FROM (n -> k) THEN descr_changed := true; END IF;
      END LOOP;
      IF descr_changed AND (OLD.source_type <> 'manual' OR OLD.status <> 'posted' OR NEW.status <> 'posted'
                            OR (lock_d IS NOT NULL AND OLD.entry_date::date <= lock_d)) THEN
        RAISE EXCEPTION 'cash_entries %: only manual posted entries of an open period can be edited', OLD.id USING ERRCODE = '42501';
      END IF;
      IF (o -> 'status') IS DISTINCT FROM (n -> 'status') OR (o -> 'void_reason') IS DISTINCT FROM (n -> 'void_reason')
         OR (o -> 'voided_by_id') IS DISTINCT FROM (n -> 'voided_by_id') OR (o -> 'voided_at') IS DISTINCT FROM (n -> 'voided_at')
         OR (o -> 'reversed_by_id') IS DISTINCT FROM (n -> 'reversed_by_id') THEN
        IF NOT (OLD.status = 'posted' AND NEW.status = 'void' AND NEW.void_reason IS NOT NULL AND OLD.void_reason IS NULL
                AND OLD.source_type <> 'reversal') THEN
          RAISE EXCEPTION 'cash_entries %: only posted → void (with reason) is allowed', OLD.id USING ERRCODE = '42501';
        END IF;
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE OR REPLACE FUNCTION pk_transfers_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      r record;
      s record;
      lock_d date := pk_cash_lock_date();
      wl text[] := ARRAY['status', 'void_reason', 'voided_by_id', 'voided_at', 'cash_entry_id', 'updated_at'];
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF lock_d IS NOT NULL AND NEW.transfer_date::date <= lock_d THEN
          RAISE EXCEPTION 'transfers: period of % is closed (lock date %)', NEW.transfer_date, lock_d USING ERRCODE = '42501';
        END IF;
        SELECT type::text AS type, status::text AS status, approved_amount INTO r FROM expense_requests WHERE id = NEW.request_id;
        IF NEW.kind IN ('advance', 'reimburse') THEN
          IF r.approved_amount IS NULL OR NEW.amount <> r.approved_amount THEN
            RAISE EXCEPTION 'transfers: amount must equal the approved amount (G3)' USING ERRCODE = '42501';
          END IF;
          IF NOT ((r.type = 'advance' AND r.status = 'approved') OR (r.type = 'reimburse' AND r.status = 'receipts_verified')) THEN
            RAISE EXCEPTION 'transfers: request % is not in the transfer queue (%)', NEW.request_id, r.status USING ERRCODE = '42501';
          END IF;
        ELSIF NEW.kind = 'lpj_shortfall' THEN
          SELECT status::text AS status, settlement_type::text AS settlement_type, difference INTO s FROM settlements WHERE request_id = NEW.request_id;
          IF r.type IS DISTINCT FROM 'advance' OR r.status IS DISTINCT FROM 'lpj_verified' OR s.status IS DISTINCT FROM 'verified'
             OR s.settlement_type IS DISTINCT FROM 'shortfall' OR NEW.amount <> -s.difference THEN
            RAISE EXCEPTION 'transfers: shortfall transfer must equal the verified LPJ shortfall (G3)' USING ERRCODE = '42501';
          END IF;
          IF EXISTS (SELECT 1 FROM transfers t WHERE t.request_id = NEW.request_id AND t.kind = 'lpj_shortfall' AND t.status = 'posted') THEN
            RAISE EXCEPTION 'transfers: request % already has a shortfall transfer', NEW.request_id USING ERRCODE = '42501';
          END IF;
        END IF;
        IF NEW.status <> 'posted' OR NEW.void_reason IS NOT NULL THEN
          RAISE EXCEPTION 'transfers: new transfers are posted' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;
      IF (to_jsonb(OLD) - wl) IS DISTINCT FROM (to_jsonb(NEW) - wl)
         OR (OLD.cash_entry_id IS NOT NULL AND NEW.cash_entry_id IS DISTINCT FROM OLD.cash_entry_id)
         OR (OLD.status = 'void' AND (to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at'))
         OR (NEW.status = 'void' AND NEW.void_reason IS NULL)
         OR (NEW.status = 'posted' AND (NEW.void_reason IS NOT NULL OR NEW.voided_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'transfers %: posted transfers are immutable (void only)', OLD.id USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE OR REPLACE FUNCTION pk_cash_accounts_opening_lock() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      p text;
    BEGIN
      IF OLD.opening_balance_date IS NOT NULL
         AND (NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
              OR NEW.opening_balance_date IS DISTINCT FROM OLD.opening_balance_date) THEN
        SELECT min(period) INTO p FROM period_closings
          WHERE status = 'closed' AND period >= substr(OLD.opening_balance_date, 1, 7);
        IF p IS NOT NULL THEN
          RAISE EXCEPTION 'cash_accounts %: opening balance is locked (period % is closed)', OLD.id, p USING ERRCODE = '42501';
        END IF;
      END IF;
      RETURN NEW;
    END
    $fn$;
    DROP FUNCTION IF EXISTS pk_cash_lock_date(integer);
  `)
}
