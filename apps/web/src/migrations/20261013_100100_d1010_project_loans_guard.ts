import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0022 Pinjaman antar project — DB guards + data (hand-written, run as <prefix>_owner after
 * 20261013_100000_d1010_project_loans). Defence in depth behind domain/loans/service.ts:
 *
 * 1. project_loans
 *    - per PT (ADR 0016 §4): company immutable, BOTH projects of the loan's PT (`pk_same_company`, Q-L2 "same PT
 *      only"), creator an active member of the PT;
 *    - CHECKs: amount whole Rupiah 0 < amount ≤ 1 T; lender ≠ borrower; due date ≥ loan date (YYYY-MM-DD);
 *      0 ≤ repaid_total ≤ amount and status ↔ repaid_total (Disetujui 0, Sebagian kembali 0 < x < amount, Lunas = amount,
 *      every other status 0); outstanding = amount − repaid_total (0 once Ditolak / Dibatalkan); g1_exception NULL | 'direktur_self'; numbered
 *      outside Draft / Dibatalkan; number unique per PT;
 *    - `pk_project_loans_guard` (pattern of pk_budget_addenda_guard): rows start as Draft without number / exception /
 *      repayment; transitions whitelisted (domain/loans/rules.ts LOAN_TRANSITIONS); content (projects, kind, amount,
 *      reason, dates) frozen outside Draft; g1_exception / same_pm only at submit; terminal rows (Ditolak / Dibatalkan)
 *      immutable; repaid_total always = Σ posted repayments (the service writes the repayment first);
 *    - identity columns immutable once set, no DELETE / TRUNCATE.
 * 2. project_loan_repayments — APPEND-ONLY like cash entries: inserted `posted` on an approved / partially repaid
 *    loan of the same PT; afterwards only posted → void (reason, actor, time) once; no DELETE / TRUNCATE.
 * 3. approvals: owner CHECK gets the fourth kind (`project_loan` + loan_id); `pk_approvals_before_insert` refuses the
 *    loan's creator (G1) unless the loan carries 'direktur_self' (the creator PM is the PT's only Direktur, Q-L5);
 *    one decision per (loan, cycle, position, level) and one position per person; `approvals_company_refs` checks
 *    loan_id (same PT).
 * 4. reminder_deliveries.rule += 'loan_overdue' (Q-L6).
 * 5. Data: sequence `PJ/{COMPANY}/{YY}{MM}/{seq}` (monthly, 4 digits) for every PT that has none (idempotent).
 * No cash table is touched (ADR 0022 §5 option B).
 */
const APPROVALS_FN_PREV = `
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
          -- gives "Diketahui" (Persetujuan PM; both values); a requester Direktur decides an approval level only
          -- under 'direktur_via_pm_self' (the PT's only Direktur, owner 2026-10-11). Nothing else.
          -- (coalesce: a NULL comparison must never let a row through — three-valued logic)
          IF NOT coalesce(exc IN ('direktur_via_pm', 'direktur_via_pm_self') AND NEW.actor_id IS NOT NULL AND creator IS NOT NULL AND (
                (NEW.position = 'diketahui' AND NEW.actor_id = creator AND NOT is_requester)
             OR (exc = 'direktur_via_pm_self' AND NEW.position = 'approval' AND is_requester AND NEW.actor_id IS DISTINCT FROM creator)), false) THEN
            RAISE EXCEPTION 'approvals: requester/creator cannot hold a decision position (G1)' USING ERRCODE = '42501';
          END IF;
        END IF;
      END IF;
      RETURN NEW;
    END
    $fn$;`

/** Previous body + the ADR 0022 branch (inserted before the expense-request part). */
const APPROVALS_FN_NEW = APPROVALS_FN_PREV.replace(
  `        -- QA-06 / ADR 0019: a shortfall decision`,
  `        -- ADR 0022 §4: the loan's creator never decides, except 'direktur_self' (the creator PM is the PT's only Direktur)
        IF NEW.doc_type::text = 'project_loan' THEN
          SELECT created_by_id, g1_exception INTO creator, exc FROM project_loans WHERE id = NEW.loan_id;
          IF NEW.actor_id IS NULL OR creator IS NULL OR (NEW.actor_id = creator AND exc IS DISTINCT FROM 'direktur_self') THEN
            RAISE EXCEPTION 'approvals: the loan creator cannot hold a decision position (G1)' USING ERRCODE = '42501';
          END IF;
          RETURN NEW;
        END IF;
        -- QA-06 / ADR 0019: a shortfall decision`,
)

const OWNER_DOC_PREV = `
    ALTER TABLE approvals ADD CONSTRAINT approvals_owner_doc CHECK (
      (doc_type::text = 'expense_request' AND request_id IS NOT NULL AND addendum_id IS NULL AND settlement_id IS NULL)
      OR (doc_type::text = 'budget_addendum' AND addendum_id IS NOT NULL AND request_id IS NULL AND settlement_id IS NULL)
      OR (doc_type::text = 'expense_shortfall' AND settlement_id IS NOT NULL AND request_id IS NULL AND addendum_id IS NULL));`

const OWNER_DOC_NEW = `
    ALTER TABLE approvals ADD CONSTRAINT approvals_owner_doc CHECK (
      (doc_type::text = 'expense_request' AND request_id IS NOT NULL AND addendum_id IS NULL AND settlement_id IS NULL AND loan_id IS NULL)
      OR (doc_type::text = 'budget_addendum' AND addendum_id IS NOT NULL AND request_id IS NULL AND settlement_id IS NULL AND loan_id IS NULL)
      OR (doc_type::text = 'expense_shortfall' AND settlement_id IS NOT NULL AND request_id IS NULL AND addendum_id IS NULL AND loan_id IS NULL)
      OR (doc_type::text = 'project_loan' AND loan_id IS NOT NULL AND request_id IS NULL AND addendum_id IS NULL AND settlement_id IS NULL));`

const REMINDER_RULES_PREV = `'late_progress', 'lpj_overdue', 'revision_pending', 'budget_threshold', 'aftersales_followup'`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)

  // ---- 1. project_loans
  await db.execute(sql`
    ALTER TABLE project_loans
      ADD CONSTRAINT project_loans_amount CHECK (amount > 0 AND amount = trunc(amount) AND amount <= 1000000000000),
      ADD CONSTRAINT project_loans_projects CHECK (lender_project_id <> borrower_project_id),
      ADD CONSTRAINT project_loans_dates CHECK (
        loan_date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        AND due_date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        AND due_date >= loan_date),
      ADD CONSTRAINT project_loans_repaid CHECK (
        repaid_total IS NOT NULL AND repaid_total >= 0 AND repaid_total = trunc(repaid_total) AND repaid_total <= amount
        AND (outstanding IS NULL OR outstanding = CASE WHEN status IN ('rejected', 'cancelled') THEN 0 ELSE amount - repaid_total END)
        AND ((status = 'repaid' AND repaid_total = amount)
          OR (status = 'partially_repaid' AND repaid_total > 0 AND repaid_total < amount)
          OR (status NOT IN ('repaid', 'partially_repaid') AND repaid_total = 0))),
      ADD CONSTRAINT project_loans_g1_exception CHECK (g1_exception IS NULL OR g1_exception IN ('direktur_self')),
      ADD CONSTRAINT project_loans_numbered CHECK (status IN ('draft', 'cancelled') OR doc_no IS NOT NULL);
    CREATE UNIQUE INDEX project_loans_company_doc_no ON project_loans (company_id, doc_no) WHERE doc_no IS NOT NULL;

    CREATE OR REPLACE FUNCTION pk_project_loans_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      allowed text[];
      posted numeric;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        -- an upsert-style update fires BEFORE INSERT too: only a genuinely new row is checked here
        IF EXISTS (SELECT 1 FROM project_loans WHERE id = NEW.id) THEN RETURN NEW; END IF;
        IF NEW.status <> 'draft' OR NEW.doc_no IS NOT NULL OR NEW.g1_exception IS NOT NULL OR coalesce(NEW.repaid_total, 0) <> 0 THEN
          RAISE EXCEPTION 'project_loans: new rows start as an unnumbered draft' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;
      IF OLD.status IN ('rejected', 'cancelled') THEN
        IF (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
          RAISE EXCEPTION 'project_loans: % is final', OLD.status USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        allowed := CASE OLD.status::text
          WHEN 'draft' THEN ARRAY['pending_approval', 'cancelled']
          WHEN 'pending_approval' THEN ARRAY['approved', 'rejected', 'cancelled']
          WHEN 'approved' THEN ARRAY['partially_repaid', 'repaid', 'cancelled']
          WHEN 'partially_repaid' THEN ARRAY['repaid', 'approved']
          WHEN 'repaid' THEN ARRAY['partially_repaid', 'approved']
          ELSE ARRAY[]::text[] END;
        IF NOT (NEW.status::text = ANY (allowed)) THEN
          RAISE EXCEPTION 'project_loans: transition % -> % not allowed', OLD.status, NEW.status USING ERRCODE = '42501';
        END IF;
      END IF;
      IF OLD.status <> 'draft' AND (
           NEW.lender_project_id IS DISTINCT FROM OLD.lender_project_id OR NEW.borrower_project_id IS DISTINCT FROM OLD.borrower_project_id
        OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.reason IS DISTINCT FROM OLD.reason
        OR NEW.loan_date IS DISTINCT FROM OLD.loan_date OR NEW.due_date IS DISTINCT FROM OLD.due_date) THEN
        RAISE EXCEPTION 'project_loans: content is frozen after submit' USING ERRCODE = '42501';
      END IF;
      IF (NEW.g1_exception IS DISTINCT FROM OLD.g1_exception OR NEW.same_pm IS DISTINCT FROM OLD.same_pm)
         AND NOT (OLD.status = 'draft' AND NEW.status = 'pending_approval') THEN
        RAISE EXCEPTION 'project_loans: g1_exception / same_pm change only at submit' USING ERRCODE = '42501';
      END IF;
      IF NEW.repaid_total IS DISTINCT FROM OLD.repaid_total THEN
        SELECT coalesce(sum(r.amount), 0) INTO posted FROM project_loan_repayments r WHERE r.loan_id = NEW.id AND r.status = 'posted';
        IF NEW.repaid_total IS DISTINCT FROM posted THEN
          RAISE EXCEPTION 'project_loans %: repaid_total % differs from the posted repayments %', NEW.id, NEW.repaid_total, posted USING ERRCODE = '23514';
        END IF;
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER project_loans_guard BEFORE INSERT OR UPDATE ON project_loans FOR EACH ROW EXECUTE FUNCTION pk_project_loans_guard();
    CREATE TRIGGER project_loans_protect BEFORE UPDATE ON project_loans FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('uuid', 'doc_no', 'created_by_id');
    CREATE TRIGGER project_loans_company_protect BEFORE UPDATE ON project_loans FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('company_id');
    CREATE TRIGGER project_loans_company_refs BEFORE INSERT OR UPDATE ON project_loans FOR EACH ROW
      EXECUTE FUNCTION pk_same_company('lender_project_id', 'projects', 'borrower_project_id', 'projects');
    CREATE TRIGGER project_loans_company_members BEFORE INSERT OR UPDATE ON project_loans FOR EACH ROW EXECUTE FUNCTION pk_company_member('created_by_id', 'decided_by_id');
    CREATE TRIGGER project_loans_no_delete BEFORE DELETE ON project_loans FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER project_loans_no_truncate BEFORE TRUNCATE ON project_loans FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();`)

  // ---- 2. project_loan_repayments (append-only)
  await db.execute(sql`
    ALTER TABLE project_loan_repayments
      ADD CONSTRAINT project_loan_repayments_amount CHECK (amount > 0 AND amount = trunc(amount)),
      ADD CONSTRAINT project_loan_repayments_date CHECK (repay_date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
      ADD CONSTRAINT project_loan_repayments_void CHECK (
        (status = 'posted' AND void_reason IS NULL AND voided_by_id IS NULL AND voided_at IS NULL)
        OR (status = 'void' AND coalesce(length(trim(void_reason)), 0) >= 3 AND voided_by_id IS NOT NULL AND voided_at IS NOT NULL));

    CREATE OR REPLACE FUNCTION pk_project_loan_repayments_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      ls text;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF EXISTS (SELECT 1 FROM project_loan_repayments WHERE id = NEW.id) THEN RETURN NEW; END IF;
        SELECT l.status::text INTO ls FROM project_loans l WHERE l.id = NEW.loan_id;
        IF NEW.status <> 'posted' OR ls IS NULL OR ls NOT IN ('approved', 'partially_repaid') THEN
          RAISE EXCEPTION 'project_loan_repayments: a repayment is posted on an approved / partially repaid loan only' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;
      IF OLD.status = 'void' THEN
        IF (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
          RAISE EXCEPTION 'project_loan_repayments: a voided repayment is final' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;
      IF (to_jsonb(NEW) - ARRAY['updated_at', 'status', 'void_reason', 'voided_by_id', 'voided_at']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['updated_at', 'status', 'void_reason', 'voided_by_id', 'voided_at']) THEN
        RAISE EXCEPTION 'project_loan_repayments: append-only (void with a reason instead)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER project_loan_repayments_guard BEFORE INSERT OR UPDATE ON project_loan_repayments FOR EACH ROW EXECUTE FUNCTION pk_project_loan_repayments_guard();
    CREATE TRIGGER project_loan_repayments_company_protect BEFORE UPDATE ON project_loan_repayments FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('company_id');
    CREATE TRIGGER project_loan_repayments_company_refs BEFORE INSERT OR UPDATE ON project_loan_repayments FOR EACH ROW EXECUTE FUNCTION pk_same_company('loan_id', 'project_loans');
    CREATE TRIGGER project_loan_repayments_company_members BEFORE INSERT OR UPDATE ON project_loan_repayments FOR EACH ROW EXECUTE FUNCTION pk_company_member('recorded_by_id', 'voided_by_id');
    CREATE TRIGGER project_loan_repayments_no_delete BEFORE DELETE ON project_loan_repayments FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER project_loan_repayments_no_truncate BEFORE TRUNCATE ON project_loan_repayments FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();`)

  // ---- 3. approvals
  await db.execute(sql.raw(`ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_owner_doc;${OWNER_DOC_NEW}`))
  await db.execute(sql.raw(APPROVALS_FN_NEW))
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS approvals_loan_one_decision_per_level ON approvals (loan_id, cycle, position, level)
      WHERE loan_id IS NOT NULL AND decision IN ('acknowledged', 'approved', 'rejected');
    CREATE UNIQUE INDEX IF NOT EXISTS approvals_loan_one_position_per_person ON approvals (loan_id, cycle, actor_id)
      WHERE loan_id IS NOT NULL AND position IN ('diketahui', 'approval');
    DROP TRIGGER IF EXISTS approvals_company_refs ON approvals;
    CREATE TRIGGER approvals_company_refs BEFORE INSERT OR UPDATE ON approvals FOR EACH ROW
      EXECUTE FUNCTION pk_same_company('request_id', 'expense_requests', 'addendum_id', 'budget_addenda', 'employee_id', 'employees', 'settlement_id', 'settlements', 'loan_id', 'project_loans');`)

  // ---- 4. reminder rule + 5. PJ sequence per PT + grants
  await db.execute(
    sql.raw(`
    ALTER TABLE reminder_deliveries DROP CONSTRAINT IF EXISTS reminder_deliveries_rule_check;
    ALTER TABLE reminder_deliveries ADD CONSTRAINT reminder_deliveries_rule_check CHECK (rule IN (${REMINDER_RULES_PREV}, 'loan_overdue'));

    INSERT INTO document_sequences (company_id, doc_type, doc_code, pattern, reset_policy, padding, start_at, timezone, active)
    SELECT c.id, 'project_loan', 'PJ', 'PJ/{COMPANY}/{YY}{MM}/{seq}', 'monthly', 4, 1, coalesce(nullif(c.timezone, ''), 'Asia/Makassar'), true
      FROM companies c
     WHERE NOT EXISTS (SELECT 1 FROM document_sequences d WHERE d.company_id = c.id AND d.doc_type::text = 'project_loan');

    DO $pk$
    DECLARE
      app_role text := regexp_replace(current_user, '_owner$', '_app');
    BEGIN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON project_loans, project_loan_repayments FROM %I', app_role);
    END
    $pk$;`),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DELETE FROM document_sequences WHERE doc_type::text = 'project_loan';`)
  await db.execute(
    sql.raw(`
    DELETE FROM reminder_deliveries WHERE rule = 'loan_overdue';
    ALTER TABLE reminder_deliveries DROP CONSTRAINT IF EXISTS reminder_deliveries_rule_check;
    ALTER TABLE reminder_deliveries ADD CONSTRAINT reminder_deliveries_rule_check CHECK (rule IN (${REMINDER_RULES_PREV}));`),
  )
  await db.execute(sql.raw(APPROVALS_FN_PREV))
  await db.execute(sql`
    DROP TRIGGER IF EXISTS approvals_company_refs ON approvals;
    CREATE TRIGGER approvals_company_refs BEFORE INSERT OR UPDATE ON approvals FOR EACH ROW
      EXECUTE FUNCTION pk_same_company('request_id', 'expense_requests', 'addendum_id', 'budget_addenda', 'employee_id', 'employees', 'settlement_id', 'settlements');
    DROP INDEX IF EXISTS approvals_loan_one_decision_per_level;
    DROP INDEX IF EXISTS approvals_loan_one_position_per_person;
    ALTER TABLE approvals DISABLE TRIGGER USER;
    DELETE FROM approvals WHERE doc_type::text = 'project_loan';
    ALTER TABLE approvals ENABLE TRIGGER USER;`)
  await db.execute(sql.raw(`ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_owner_doc;${OWNER_DOC_PREV}`))
  await db.execute(sql`
    DROP TRIGGER IF EXISTS project_loan_repayments_guard ON project_loan_repayments;
    DROP TRIGGER IF EXISTS project_loan_repayments_company_protect ON project_loan_repayments;
    DROP TRIGGER IF EXISTS project_loan_repayments_company_refs ON project_loan_repayments;
    DROP TRIGGER IF EXISTS project_loan_repayments_company_members ON project_loan_repayments;
    DROP TRIGGER IF EXISTS project_loan_repayments_no_delete ON project_loan_repayments;
    DROP TRIGGER IF EXISTS project_loan_repayments_no_truncate ON project_loan_repayments;
    DROP TRIGGER IF EXISTS project_loans_guard ON project_loans;
    DROP TRIGGER IF EXISTS project_loans_protect ON project_loans;
    DROP TRIGGER IF EXISTS project_loans_company_protect ON project_loans;
    DROP TRIGGER IF EXISTS project_loans_company_refs ON project_loans;
    DROP TRIGGER IF EXISTS project_loans_company_members ON project_loans;
    DROP TRIGGER IF EXISTS project_loans_no_delete ON project_loans;
    DROP TRIGGER IF EXISTS project_loans_no_truncate ON project_loans;
    DROP FUNCTION IF EXISTS pk_project_loan_repayments_guard();
    DROP FUNCTION IF EXISTS pk_project_loans_guard();
    DROP INDEX IF EXISTS project_loans_company_doc_no;
    ALTER TABLE project_loan_repayments
      DROP CONSTRAINT IF EXISTS project_loan_repayments_amount,
      DROP CONSTRAINT IF EXISTS project_loan_repayments_date,
      DROP CONSTRAINT IF EXISTS project_loan_repayments_void;
    ALTER TABLE project_loans
      DROP CONSTRAINT IF EXISTS project_loans_amount,
      DROP CONSTRAINT IF EXISTS project_loans_projects,
      DROP CONSTRAINT IF EXISTS project_loans_dates,
      DROP CONSTRAINT IF EXISTS project_loans_repaid,
      DROP CONSTRAINT IF EXISTS project_loans_g1_exception,
      DROP CONSTRAINT IF EXISTS project_loans_numbered;`)
}
