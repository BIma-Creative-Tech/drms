import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

import { withPrelude } from './20261013_610000_d1310_renumber'

/**
 * ADR 0031 (DRMS 21/10) "Pusat Biaya = akun kas" — DB guards, hand-written, run as <prefix>_owner after
 * 20261021_100100_d2110_pb_schema. Defence in depth behind domain/expense/transfers.ts and domain/loans/{service,cash}.ts:
 *
 * 1. Same PT (ADR 0016 §4) for every new reference — own `*_pb_company_refs` triggers (the existing ones stay as they
 *    are): projects / vehicles → cash account; transfers.paid_from → cash account; cash_entries → loan / repayment;
 *    project_loans → both accounts + transfer; disbursed_by an active member of the PT.
 * 2. Transfers (`pk_transfers_cost_center_required` REPLACED — the cost center is no longer required, D2 retired):
 *    an advance / reimburse transfer of a PROJECT request is charged to the project's Pusat Biaya
 *    (`cash_account_id = projects.cash_account_id`, which must be set); `paid_from_cash_account_id` only on a project
 *    request and different from the charged account; at commit (deferred) a transfer paid from another account has its
 *    automatic loan (`project_loans.transfer_id`).
 * 3. Cash entries: a `project_loan` row names its loan; a repayment reference implies the loan.
 * 4. project_loans:
 *    - shape per origin: `manual` = lender project, no transfer; `transfer` = no lender project, both accounts, the
 *      transfer, money (`dana`), cash-backed; `cash_backed` ⇒ money between two different accounts; disbursed_at ⇔
 *      disbursed_by; disbursed only when cash-backed; nothing repaid on a cash-backed loan before its disbursement;
 *      one automatic loan per transfer;
 *    - `pk_project_loans_guard` (REPLACED, previous body restored by down): an automatic loan is INSERTED approved,
 *      numbered and disbursed (the transfer is its decision); the accounts / cash_backed of a manual loan are set at the
 *      approval only; origin / transfer / accounts frozen afterwards; disbursed_* set once, on an approved loan.
 * 5. Cash legs (deferred constraint triggers on project_loans, project_loan_repayments and cash_entries, one checker
 *    `pk_project_loan_cash_check`): a disbursed cash-backed loan has exactly one POSTED `project_loan` KK on the lender
 *    account and one KM on the borrower account for its amount (none once cancelled, none at all for a claim); a posted
 *    repayment of a cash-backed loan has the mirror pair (KK borrower, KM lender) for its amount, none once void.
 * Down: restores the previous functions / triggers (the schema down refuses while loan cash rows exist).
 */
const TRANSFERS_CC_PREV = `
    CREATE OR REPLACE FUNCTION pk_transfers_cost_center_required() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      cc_company integer;
    BEGIN
      IF NEW.cost_center_id IS NULL THEN
        RAISE EXCEPTION 'transfers: cost center required (D2)' USING ERRCODE = '23514';
      END IF;
      SELECT company_id INTO cc_company FROM cost_centers WHERE id = NEW.cost_center_id;
      IF cc_company IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'transfers: cost center % is not of the transfer PT', NEW.cost_center_id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;`

const TRANSFERS_CC_NEW = `
    CREATE OR REPLACE FUNCTION pk_transfers_cost_center_required() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      pid integer;
      pb integer;
    BEGIN
      -- ADR 0031: the former cost center (D2) is optional; a project request is charged to the project's Pusat Biaya
      SELECT r.project_id INTO pid FROM expense_requests r WHERE r.id = NEW.request_id;
      IF pid IS NOT NULL THEN
        SELECT p.cash_account_id INTO pb FROM projects p WHERE p.id = pid;
        IF pb IS NULL THEN
          RAISE EXCEPTION 'transfers: project % has no Pusat Biaya (cash account) (ADR 0031)', pid USING ERRCODE = '23514';
        END IF;
        IF NEW.cash_account_id IS DISTINCT FROM pb THEN
          RAISE EXCEPTION 'transfers: a project request is charged to its Pusat Biaya % (got %) (ADR 0031)', pb, NEW.cash_account_id USING ERRCODE = '23514';
        END IF;
      END IF;
      IF NEW.paid_from_cash_account_id IS NOT NULL AND (pid IS NULL OR NEW.paid_from_cash_account_id = NEW.cash_account_id) THEN
        RAISE EXCEPTION 'transfers: "paid from" another account only for a project request, and different from its Pusat Biaya (ADR 0031)' USING ERRCODE = '23514';
      END IF;
      IF NEW.cost_center_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cost_centers c WHERE c.id = NEW.cost_center_id AND c.company_id = NEW.company_id) THEN
        RAISE EXCEPTION 'transfers: cost center % is not of the transfer PT', NEW.cost_center_id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;`

/**
 * pk_project_loans_guard as of 20261013_100100_d1010_project_loans_guard (restored by down). Both versions run through
 * `withPrelude` — the guard is in RENUMBER_GUARDED_FUNCTIONS (20261013_610000_d1310_renumber) and must keep its prelude.
 */
const LOANS_GUARD_PREV = `
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
    $fn$;`

const LOANS_GUARD_NEW = `
    CREATE OR REPLACE FUNCTION pk_project_loans_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      allowed text[];
      posted numeric;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        -- an upsert-style update fires BEFORE INSERT too: only a genuinely new row is checked here
        IF EXISTS (SELECT 1 FROM project_loans WHERE id = NEW.id) THEN RETURN NEW; END IF;
        IF NEW.origin::text = 'transfer' THEN
          -- ADR 0031: the automatic loan of a transfer is born approved, numbered and disbursed (the transfer decides it)
          IF NEW.status <> 'approved' OR NEW.doc_no IS NULL OR NEW.g1_exception IS NOT NULL OR coalesce(NEW.repaid_total, 0) <> 0
             OR NEW.disbursed_at IS NULL OR NOT coalesce(NEW.cash_backed, false) THEN
            RAISE EXCEPTION 'project_loans: an automatic loan starts approved, numbered and disbursed' USING ERRCODE = '42501';
          END IF;
          RETURN NEW;
        END IF;
        IF NEW.status <> 'draft' OR NEW.doc_no IS NOT NULL OR NEW.g1_exception IS NOT NULL OR coalesce(NEW.repaid_total, 0) <> 0
           OR coalesce(NEW.cash_backed, false) OR NEW.lender_cash_account_id IS NOT NULL OR NEW.borrower_cash_account_id IS NOT NULL OR NEW.disbursed_at IS NOT NULL THEN
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
      IF NEW.origin IS DISTINCT FROM OLD.origin OR NEW.transfer_id IS DISTINCT FROM OLD.transfer_id THEN
        RAISE EXCEPTION 'project_loans: origin / transfer are immutable' USING ERRCODE = '42501';
      END IF;
      -- ADR 0031: the Pusat Biaya accounts and cash_backed of a manual loan are frozen at the Direktur's approval
      IF (NEW.lender_cash_account_id IS DISTINCT FROM OLD.lender_cash_account_id OR NEW.borrower_cash_account_id IS DISTINCT FROM OLD.borrower_cash_account_id
          OR NEW.cash_backed IS DISTINCT FROM OLD.cash_backed)
         AND NOT (OLD.status = 'pending_approval' AND NEW.status = 'approved') THEN
        RAISE EXCEPTION 'project_loans: accounts / cash_backed are set at the approval only' USING ERRCODE = '42501';
      END IF;
      IF (NEW.disbursed_at IS DISTINCT FROM OLD.disbursed_at OR NEW.disbursed_by_id IS DISTINCT FROM OLD.disbursed_by_id)
         AND NOT (OLD.disbursed_at IS NULL AND OLD.status = 'approved' AND NEW.status = 'approved') THEN
        RAISE EXCEPTION 'project_loans: the disbursement is recorded once, on an approved loan' USING ERRCODE = '42501';
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
    $fn$;`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)

  // ---- 1. same PT
  await db.execute(sql`
    CREATE TRIGGER projects_pb_company_refs BEFORE INSERT OR UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION pk_same_company('cash_account_id', 'cash_accounts');
    CREATE TRIGGER vehicles_pb_company_refs BEFORE INSERT OR UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION pk_same_company('cash_account_id', 'cash_accounts');
    CREATE TRIGGER transfers_pb_company_refs BEFORE INSERT OR UPDATE ON transfers FOR EACH ROW EXECUTE FUNCTION pk_same_company('paid_from_cash_account_id', 'cash_accounts');
    CREATE TRIGGER cash_entries_pb_company_refs BEFORE INSERT OR UPDATE ON cash_entries FOR EACH ROW
      EXECUTE FUNCTION pk_same_company('project_loan_id', 'project_loans', 'project_loan_repayment_id', 'project_loan_repayments');
    CREATE TRIGGER project_loans_pb_company_refs BEFORE INSERT OR UPDATE ON project_loans FOR EACH ROW
      EXECUTE FUNCTION pk_same_company('lender_cash_account_id', 'cash_accounts', 'borrower_cash_account_id', 'cash_accounts', 'transfer_id', 'transfers');
    CREATE TRIGGER project_loans_pb_company_members BEFORE INSERT OR UPDATE ON project_loans FOR EACH ROW EXECUTE FUNCTION pk_company_member('disbursed_by_id');`)

  // ---- 2. transfers
  await db.execute(sql.raw(TRANSFERS_CC_NEW))
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION pk_transfers_paid_from_loan() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.paid_from_cash_account_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM project_loans l WHERE l.transfer_id = NEW.id AND l.origin::text = 'transfer'
              AND l.lender_cash_account_id = NEW.paid_from_cash_account_id AND l.borrower_cash_account_id = NEW.cash_account_id) THEN
        RAISE EXCEPTION 'transfers %: paid from another account without its automatic inter-project loan (ADR 0031)', NEW.id USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END
    $fn$;
    CREATE CONSTRAINT TRIGGER transfers_paid_from_loan AFTER INSERT ON transfers
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.paid_from_cash_account_id IS NOT NULL) EXECUTE FUNCTION pk_transfers_paid_from_loan();
    CREATE TRIGGER transfers_pb_protect BEFORE UPDATE ON transfers FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('paid_from_cash_account_id');`)

  // ---- 3. cash entries + 4. project_loans shape
  await db.execute(sql`
    ALTER TABLE cash_entries
      ADD CONSTRAINT cash_entries_project_loan_ref CHECK (source_type::text <> 'project_loan' OR project_loan_id IS NOT NULL),
      ADD CONSTRAINT cash_entries_project_loan_repayment_ref CHECK (project_loan_repayment_id IS NULL OR project_loan_id IS NOT NULL);
    CREATE TRIGGER cash_entries_pb_protect BEFORE UPDATE ON cash_entries FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('project_loan_id', 'project_loan_repayment_id');

    ALTER TABLE project_loans
      ADD CONSTRAINT project_loans_origin_shape CHECK (
        (origin::text = 'manual' AND lender_project_id IS NOT NULL AND transfer_id IS NULL)
        OR (origin::text = 'transfer' AND lender_project_id IS NULL AND transfer_id IS NOT NULL AND kind = 'dana'
            AND coalesce(cash_backed, false) AND lender_cash_account_id IS NOT NULL AND borrower_cash_account_id IS NOT NULL)),
      ADD CONSTRAINT project_loans_cash_backed CHECK (
        NOT coalesce(cash_backed, false)
        OR (kind = 'dana' AND lender_cash_account_id IS NOT NULL AND borrower_cash_account_id IS NOT NULL AND lender_cash_account_id <> borrower_cash_account_id)),
      ADD CONSTRAINT project_loans_disbursed CHECK (
        (disbursed_at IS NULL) = (disbursed_by_id IS NULL)
        AND (disbursed_at IS NULL OR coalesce(cash_backed, false))
        AND (NOT coalesce(cash_backed, false) OR disbursed_at IS NOT NULL OR coalesce(repaid_total, 0) = 0));
    CREATE UNIQUE INDEX project_loans_transfer_uq ON project_loans (transfer_id) WHERE transfer_id IS NOT NULL;
    CREATE TRIGGER project_loans_pb_protect BEFORE UPDATE ON project_loans FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('origin', 'transfer_id');`)
  await db.execute(sql.raw(withPrelude(LOANS_GUARD_NEW)))

  // ---- 5. cash legs (deferred, one checker)
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION pk_project_loan_cash_check(lid integer, rid integer) RETURNS void LANGUAGE plpgsql AS $fn$
    DECLARE
      l record;
      r record;
      n_out integer;
      n_in integer;
      n_all integer;
      want boolean;
    BEGIN
      SELECT id, status::text AS status, amount, cash_backed, disbursed_at, lender_cash_account_id, borrower_cash_account_id INTO l FROM project_loans WHERE id = lid;
      IF NOT FOUND THEN RETURN; END IF;
      IF rid IS NULL THEN
        want := coalesce(l.cash_backed, false) AND l.disbursed_at IS NOT NULL AND l.status <> 'cancelled';
        SELECT count(*) FILTER (WHERE e.direction = 'out' AND e.cash_account_id = l.lender_cash_account_id AND e.amount = l.amount),
               count(*) FILTER (WHERE e.direction = 'in' AND e.cash_account_id = l.borrower_cash_account_id AND e.amount = l.amount),
               count(*)
          INTO n_out, n_in, n_all
          FROM cash_entries e
         WHERE e.project_loan_id = lid AND e.project_loan_repayment_id IS NULL AND e.source_type::text = 'project_loan' AND e.status = 'posted';
        IF (want AND NOT (n_out = 1 AND n_in = 1 AND n_all = 2)) OR (NOT want AND n_all <> 0) THEN
          RAISE EXCEPTION 'project_loans %: disbursement cash legs out of step (want %, KK %, KM %, total %) (ADR 0031)', lid, want, n_out, n_in, n_all USING ERRCODE = '23514';
        END IF;
        RETURN;
      END IF;
      SELECT id, status, amount INTO r FROM project_loan_repayments WHERE id = rid;
      IF NOT FOUND THEN RETURN; END IF;
      want := coalesce(l.cash_backed, false) AND r.status = 'posted';
      SELECT count(*) FILTER (WHERE e.direction = 'out' AND e.cash_account_id = l.borrower_cash_account_id AND e.amount = r.amount),
             count(*) FILTER (WHERE e.direction = 'in' AND e.cash_account_id = l.lender_cash_account_id AND e.amount = r.amount),
             count(*)
        INTO n_out, n_in, n_all
        FROM cash_entries e
       WHERE e.project_loan_repayment_id = rid AND e.source_type::text = 'project_loan' AND e.status = 'posted';
      IF (want AND NOT (n_out = 1 AND n_in = 1 AND n_all = 2)) OR (NOT want AND n_all <> 0) THEN
        RAISE EXCEPTION 'project_loan_repayments %: repayment cash legs out of step (want %, KK %, KM %, total %) (ADR 0031)', rid, want, n_out, n_in, n_all USING ERRCODE = '23514';
      END IF;
    END
    $fn$;

    CREATE OR REPLACE FUNCTION pk_project_loan_cash_consistency() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF TG_TABLE_NAME = 'project_loans' THEN
        PERFORM pk_project_loan_cash_check(NEW.id, NULL);
      ELSIF TG_TABLE_NAME = 'project_loan_repayments' THEN
        PERFORM pk_project_loan_cash_check(NEW.loan_id, NEW.id);
      ELSIF NEW.project_loan_id IS NOT NULL THEN
        PERFORM pk_project_loan_cash_check(NEW.project_loan_id, NEW.project_loan_repayment_id);
      END IF;
      RETURN NULL;
    END
    $fn$;
    CREATE CONSTRAINT TRIGGER project_loans_cash_consistency AFTER INSERT OR UPDATE ON project_loans
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pk_project_loan_cash_consistency();
    CREATE CONSTRAINT TRIGGER project_loan_repayments_cash_consistency AFTER INSERT OR UPDATE ON project_loan_repayments
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pk_project_loan_cash_consistency();
    CREATE CONSTRAINT TRIGGER cash_entries_project_loan_consistency AFTER INSERT OR UPDATE OF status ON cash_entries
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.project_loan_id IS NOT NULL) EXECUTE FUNCTION pk_project_loan_cash_consistency();`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS cash_entries_project_loan_consistency ON cash_entries;
    DROP TRIGGER IF EXISTS project_loan_repayments_cash_consistency ON project_loan_repayments;
    DROP TRIGGER IF EXISTS project_loans_cash_consistency ON project_loans;
    DROP FUNCTION IF EXISTS pk_project_loan_cash_consistency();
    DROP FUNCTION IF EXISTS pk_project_loan_cash_check(integer, integer);
    DROP TRIGGER IF EXISTS project_loans_pb_protect ON project_loans;
    DROP INDEX IF EXISTS project_loans_transfer_uq;
    ALTER TABLE project_loans
      DROP CONSTRAINT IF EXISTS project_loans_origin_shape,
      DROP CONSTRAINT IF EXISTS project_loans_cash_backed,
      DROP CONSTRAINT IF EXISTS project_loans_disbursed;
    DROP TRIGGER IF EXISTS cash_entries_pb_protect ON cash_entries;
    ALTER TABLE cash_entries
      DROP CONSTRAINT IF EXISTS cash_entries_project_loan_ref,
      DROP CONSTRAINT IF EXISTS cash_entries_project_loan_repayment_ref;
    DROP TRIGGER IF EXISTS transfers_pb_protect ON transfers;
    DROP TRIGGER IF EXISTS transfers_paid_from_loan ON transfers;
    DROP FUNCTION IF EXISTS pk_transfers_paid_from_loan();
    DROP TRIGGER IF EXISTS project_loans_pb_company_members ON project_loans;
    DROP TRIGGER IF EXISTS project_loans_pb_company_refs ON project_loans;
    DROP TRIGGER IF EXISTS cash_entries_pb_company_refs ON cash_entries;
    DROP TRIGGER IF EXISTS transfers_pb_company_refs ON transfers;
    DROP TRIGGER IF EXISTS vehicles_pb_company_refs ON vehicles;
    DROP TRIGGER IF EXISTS projects_pb_company_refs ON projects;`)
  await db.execute(sql.raw(withPrelude(LOANS_GUARD_PREV)))
  await db.execute(sql.raw(TRANSFERS_CC_PREV))
}
