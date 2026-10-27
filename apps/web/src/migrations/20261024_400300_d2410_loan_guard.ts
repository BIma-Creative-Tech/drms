import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

import { withPrelude } from './20261013_610000_d1310_renumber'

/**
 * DRMS 24/10 #10–#12 (ADR 0022 / 0031 amendment 2026-10-24) "Pinjaman antar project: PM / Finance mengajukan,
 * Direktur → Owner, antrian transfer" — DB guards, hand-written, run as <prefix>_owner after 20261024_400200_d2410_loan_data.
 * Defence in depth behind domain/loans/{rules,service,cash}.ts:
 *
 * 1. project_loans
 *    - CHECKs: `approval_level` ∈ {0, 1, 2} and 1 | 2 while pending; `submitter_role` only on a manual loan;
 *      `project_loans_cash_backed` REPLACED: a MANUAL loan of money between two known accounts is cash-backed also when
 *      both projects share ONE account (#11 — the pair is posted on it, tagged with each project); an automatic loan still
 *      needs two different accounts (its transfer guard says so too);
 *    - `pk_project_loans_guard` (REPLACED, previous body = 20261021_100200 restored by down, prelude kept): a new manual
 *      loan names its `submitter_role` and the creator holds it in the PT (`pm` = pk-pm AND the borrower project's PM;
 *      `finance` = pk-finance), level 0; `submitter_role` immutable; level 0 → 1 only at submit, 1 → 2 only while pending
 *      and after an APPROVED level-1 decision row of the cycle; pending → approved only at level 2 after an approved
 *      level-2 row (the Owner), pending → rejected only after a rejected row of the current level; the disbursement
 *      (transfer order executed) of a manual loan is recorded by a Finance member of the PT.
 * 2. project_loan_repayments (append-only stays): CHECK `project_loan_repayments_void` REPLACED (void columns ⇔ void,
 *    for every status) + `project_loan_repayments_request` (reasons of rejected / cancelled, level 1 | 2 while pending,
 *    executed_at ⇔ executed_by and only once posted, planned date shape); `pk_project_loan_repayments_guard` REPLACED:
 *    on a CASH-BACKED loan a repayment is inserted `pending_approval` level 1 with its planned date, after the loan's
 *    transfer; on a claim it is inserted `posted` (as before); transitions pending → pending (level 1 → 2 after an
 *    approved level-1 row) | approved (level 2 + approved level-2 row) | rejected (rejected row) | cancelled,
 *    approved → posted (executed by a Finance member; the date becomes the execution date) | cancelled, posted → void;
 *    amount / loan / note / submitter / planned date frozen; terminal rows immutable.
 * 3. approvals: owner CHECK gets the fifth kind (`project_loan_repayment` + loan_repayment_id); one decision per
 *    (repayment, cycle, position, level) and one position per person; `approvals_company_refs` checks loan_repayment_id;
 *    `pk_approvals_before_insert` (REPLACED): a loan decision is level 1 by a STORED Direktur (pk-owner) or level 2 by a
 *    STORED Owner (pk-principal) after an approved level 1 of the cycle; the creator never decides — except
 *    `direktur_self` at level 1 only; a repayment decision: same levels / roles / order, its submitter never decides.
 * 4. Fund check: `pk_pb_commitments` (REPLACED) — an approved, not executed loan counts on the lender account only when
 *    the money leaves it (two different accounts); an approved repayment order counts on the borrower account the same way.
 * The cash-leg checker (`pk_project_loan_cash_check`, 20261021_100200) is unchanged: it already accepts one shared
 * account (KK and KM counted per direction) and a repayment request needs no leg until it is `posted`.
 * Renumber list (20261013_610000): `pk_project_loans_guard` keeps its prelude; the repayment / approval tables are not
 * renumbered. Down: restores the previous functions / constraints (refused by the schema down while requests exist).
 */

/** pk_project_loans_guard as of 20261021_100200_d2110_pb_guard (restored by down). */
const LOANS_GUARD_PREV = `
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

/** Exported for 20261026_100200_d2610_owner_loan_guard (built on it, restored by its down). */
export const LOANS_GUARD_NEW = `
    CREATE OR REPLACE FUNCTION pk_project_loans_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      allowed text[];
      posted numeric;
      cyc numeric;
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
           OR coalesce(NEW.cash_backed, false) OR NEW.lender_cash_account_id IS NOT NULL OR NEW.borrower_cash_account_id IS NOT NULL OR NEW.disbursed_at IS NOT NULL
           OR coalesce(NEW.approval_level, 0) <> 0 THEN
          RAISE EXCEPTION 'project_loans: new rows start as an unnumbered draft' USING ERRCODE = '42501';
        END IF;
        -- 2026-10-24 (#10): filed by the borrower project's PM or by Finance of the PT (stored roles)
        IF NEW.submitter_role IS NULL
           OR (NEW.submitter_role::text = 'finance' AND NOT pk_icl_has_role(NEW.created_by_id, NEW.company_id, 'pk-finance'))
           OR (NEW.submitter_role::text = 'pm' AND NOT (pk_icl_has_role(NEW.created_by_id, NEW.company_id, 'pk-pm')
                 AND EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.borrower_project_id AND p.pm_id = NEW.created_by_id))) THEN
          RAISE EXCEPTION 'project_loans: a loan is filed by the borrower project''s PM or by Finance of the PT (submitter_role %)', NEW.submitter_role USING ERRCODE = '42501';
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
      IF NEW.origin IS DISTINCT FROM OLD.origin OR NEW.transfer_id IS DISTINCT FROM OLD.transfer_id OR NEW.submitter_role IS DISTINCT FROM OLD.submitter_role THEN
        RAISE EXCEPTION 'project_loans: origin / transfer / submitter role are immutable' USING ERRCODE = '42501';
      END IF;
      -- 2026-10-24 (#10): Direktur (level 1) → Owner (level 2); every step backed by its decision row of the cycle
      cyc := coalesce(NEW.approval_cycle, 1);
      IF NEW.approval_level IS DISTINCT FROM OLD.approval_level AND NOT (
           (OLD.status = 'draft' AND NEW.status = 'pending_approval' AND NEW.approval_level = 1)
        OR (OLD.status = 'pending_approval' AND NEW.status = 'pending_approval' AND coalesce(OLD.approval_level, 0) = 1 AND NEW.approval_level = 2
            AND EXISTS (SELECT 1 FROM approvals a WHERE a.loan_id = NEW.id AND a.cycle = cyc AND a.level = 1 AND a.decision = 'approved'))) THEN
        RAISE EXCEPTION 'project_loans %: approval level % -> % not allowed (Direktur level 1, then Owner level 2)', NEW.id, OLD.approval_level, NEW.approval_level USING ERRCODE = '42501';
      END IF;
      IF OLD.status = 'pending_approval' AND NEW.status = 'approved'
         AND NOT (coalesce(NEW.approval_level, 0) = 2 AND EXISTS (SELECT 1 FROM approvals a WHERE a.loan_id = NEW.id AND a.cycle = cyc AND a.level = 2 AND a.decision = 'approved')) THEN
        RAISE EXCEPTION 'project_loans %: approved only after the Owner (level 2) approval', NEW.id USING ERRCODE = '42501';
      END IF;
      IF OLD.status = 'pending_approval' AND NEW.status = 'rejected'
         AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.loan_id = NEW.id AND a.cycle = cyc AND a.level = coalesce(nullif(NEW.approval_level, 0), 1) AND a.decision = 'rejected') THEN
        RAISE EXCEPTION 'project_loans %: rejected only with the rejection row of the current level', NEW.id USING ERRCODE = '42501';
      END IF;
      -- ADR 0031: the Pusat Biaya accounts and cash_backed of a manual loan are frozen at the (final) approval
      IF (NEW.lender_cash_account_id IS DISTINCT FROM OLD.lender_cash_account_id OR NEW.borrower_cash_account_id IS DISTINCT FROM OLD.borrower_cash_account_id
          OR NEW.cash_backed IS DISTINCT FROM OLD.cash_backed)
         AND NOT (OLD.status = 'pending_approval' AND NEW.status = 'approved') THEN
        RAISE EXCEPTION 'project_loans: accounts / cash_backed are set at the approval only' USING ERRCODE = '42501';
      END IF;
      IF (NEW.disbursed_at IS DISTINCT FROM OLD.disbursed_at OR NEW.disbursed_by_id IS DISTINCT FROM OLD.disbursed_by_id)
         AND NOT (OLD.disbursed_at IS NULL AND OLD.status = 'approved' AND NEW.status = 'approved') THEN
        RAISE EXCEPTION 'project_loans: the disbursement is recorded once, on an approved loan' USING ERRCODE = '42501';
      END IF;
      -- #11: the transfer order of a manual loan is executed by a Finance member of the PT
      IF NEW.disbursed_at IS NOT NULL AND OLD.disbursed_at IS NULL AND NEW.origin::text = 'manual'
         AND NOT pk_icl_has_role(NEW.disbursed_by_id, NEW.company_id, 'pk-finance') THEN
        RAISE EXCEPTION 'project_loans %: the loan transfer is executed by Finance of the PT', NEW.id USING ERRCODE = '42501';
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

/** pk_project_loan_repayments_guard as of 20261013_100100_d1010_project_loans_guard (restored by down). */
const REPAYMENTS_GUARD_PREV = `
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
    $fn$;`

const REPAYMENTS_GUARD_NEW = `
    CREATE OR REPLACE FUNCTION pk_project_loan_repayments_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      l record;
      st text := NEW.status::text;
      ost text;
      lvl numeric;
      steps text[] := ARRAY['updated_at', 'status', 'approval_level', 'decided_at', 'decided_by_id', 'reject_reason', 'cancel_reason',
                            'executed_at', 'executed_by_id', 'repay_date', 'void_reason', 'voided_by_id', 'voided_at'];
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF EXISTS (SELECT 1 FROM project_loan_repayments WHERE id = NEW.id) THEN RETURN NEW; END IF;
        SELECT x.status::text AS status, coalesce(x.cash_backed, false) AS cash, x.disbursed_at, x.company_id INTO l FROM project_loans x WHERE x.id = NEW.loan_id;
        IF NOT FOUND OR l.status NOT IN ('approved', 'partially_repaid') THEN
          RAISE EXCEPTION 'project_loan_repayments: a repayment is recorded on an approved / partially repaid loan only' USING ERRCODE = '42501';
        END IF;
        IF l.cash THEN
          -- 2026-10-24 (#12): a cash-backed loan is repaid by a request (Direktur → Owner → transfer order), after its transfer
          IF st <> 'pending_approval' OR coalesce(NEW.approval_level, 0) <> 1 OR NEW.planned_date IS NULL OR l.disbursed_at IS NULL
             OR NEW.executed_at IS NOT NULL OR NEW.decided_at IS NOT NULL THEN
            RAISE EXCEPTION 'project_loan_repayments: a repayment of a cash-backed loan starts as a request (pending, level 1, planned date) after the loan transfer' USING ERRCODE = '42501';
          END IF;
        ELSIF st <> 'posted' OR coalesce(NEW.approval_level, 0) <> 0 THEN
          RAISE EXCEPTION 'project_loan_repayments: a repayment of a claim is recorded (posted) at once' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;
      ost := OLD.status::text;
      IF ost IN ('void', 'rejected', 'cancelled') THEN
        IF (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
          RAISE EXCEPTION 'project_loan_repayments: a % repayment is final', ost USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;
      IF (to_jsonb(NEW) - steps) IS DISTINCT FROM (to_jsonb(OLD) - steps) THEN
        RAISE EXCEPTION 'project_loan_repayments: append-only (amount, loan, note, submitter, planned date are frozen)' USING ERRCODE = '42501';
      END IF;
      lvl := coalesce(nullif(OLD.approval_level, 0), 1);
      IF NOT (
           (ost = st AND (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at'))
        OR (ost = 'pending_approval' AND st = 'pending_approval' AND lvl = 1 AND NEW.approval_level = 2
            AND EXISTS (SELECT 1 FROM approvals a WHERE a.loan_repayment_id = NEW.id AND a.level = 1 AND a.decision = 'approved'))
        OR (ost = 'pending_approval' AND st = 'approved' AND lvl = 2 AND NEW.approval_level = 2 AND NEW.decided_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM approvals a WHERE a.loan_repayment_id = NEW.id AND a.level = 2 AND a.decision = 'approved'))
        OR (ost = 'pending_approval' AND st = 'rejected' AND NEW.approval_level = OLD.approval_level
            AND EXISTS (SELECT 1 FROM approvals a WHERE a.loan_repayment_id = NEW.id AND a.level = lvl AND a.decision = 'rejected'))
        OR (ost IN ('pending_approval', 'approved') AND st = 'cancelled' AND NEW.approval_level = OLD.approval_level)
        OR (ost = 'approved' AND st = 'posted' AND NEW.executed_at IS NOT NULL
            AND pk_icl_has_role(NEW.executed_by_id, NEW.company_id, 'pk-finance'))
        OR (ost = 'posted' AND st = 'void')) THEN
        RAISE EXCEPTION 'project_loan_repayments %: transition % -> % not allowed', NEW.id, ost, st USING ERRCODE = '42501';
      END IF;
      IF NEW.repay_date IS DISTINCT FROM OLD.repay_date AND NOT (ost = 'approved' AND st = 'posted') THEN
        RAISE EXCEPTION 'project_loan_repayments %: the date changes only at the execution', NEW.id USING ERRCODE = '42501';
      END IF;
      IF (NEW.decided_at IS DISTINCT FROM OLD.decided_at OR NEW.decided_by_id IS DISTINCT FROM OLD.decided_by_id OR NEW.reject_reason IS DISTINCT FROM OLD.reject_reason)
         AND NOT (ost = 'pending_approval' AND st IN ('approved', 'rejected')) THEN
        RAISE EXCEPTION 'project_loan_repayments %: the decision is recorded once (final level / rejection)', NEW.id USING ERRCODE = '42501';
      END IF;
      IF NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason AND st <> 'cancelled' THEN
        RAISE EXCEPTION 'project_loan_repayments %: a cancel reason only with the cancellation', NEW.id USING ERRCODE = '42501';
      END IF;
      IF (NEW.executed_at IS DISTINCT FROM OLD.executed_at OR NEW.executed_by_id IS DISTINCT FROM OLD.executed_by_id) AND NOT (ost = 'approved' AND st = 'posted') THEN
        RAISE EXCEPTION 'project_loan_repayments %: the execution is recorded once', NEW.id USING ERRCODE = '42501';
      END IF;
      IF (NEW.void_reason IS DISTINCT FROM OLD.void_reason OR NEW.voided_by_id IS DISTINCT FROM OLD.voided_by_id OR NEW.voided_at IS DISTINCT FROM OLD.voided_at)
         AND NOT (ost = 'posted' AND st = 'void') THEN
        RAISE EXCEPTION 'project_loan_repayments %: void columns only with the void', NEW.id USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;`

/** pk_approvals_before_insert as of 20261013_100100_d1010_project_loans_guard (restored by down). */
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
        -- ADR 0022 §4: the loan's creator never decides, except 'direktur_self' (the creator PM is the PT's only Direktur)
        IF NEW.doc_type::text = 'project_loan' THEN
          SELECT created_by_id, g1_exception INTO creator, exc FROM project_loans WHERE id = NEW.loan_id;
          IF NEW.actor_id IS NULL OR creator IS NULL OR (NEW.actor_id = creator AND exc IS DISTINCT FROM 'direktur_self') THEN
            RAISE EXCEPTION 'approvals: the loan creator cannot hold a decision position (G1)' USING ERRCODE = '42501';
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

/** Previous body with the 2026-10-24 loan branch (levels, roles, order) and the repayment-request branch. */
const APPROVALS_FN_NEW = APPROVALS_FN_PREV.replace(
  `      is_requester boolean;
    BEGIN`,
  `      is_requester boolean;
      cid integer;
    BEGIN`,
).replace(
  `        -- ADR 0022 §4: the loan's creator never decides, except 'direktur_self' (the creator PM is the PT's only Direktur)
        IF NEW.doc_type::text = 'project_loan' THEN
          SELECT created_by_id, g1_exception INTO creator, exc FROM project_loans WHERE id = NEW.loan_id;
          IF NEW.actor_id IS NULL OR creator IS NULL OR (NEW.actor_id = creator AND exc IS DISTINCT FROM 'direktur_self') THEN
            RAISE EXCEPTION 'approvals: the loan creator cannot hold a decision position (G1)' USING ERRCODE = '42501';
          END IF;
          RETURN NEW;
        END IF;`,
  `        -- ADR 0022 §4: the loan's creator never decides, except 'direktur_self' (the creator PM is the PT's only Direktur) —
        -- 2026-10-24 (#10): at level 1 only; level 1 = a STORED Direktur, level 2 = a STORED Owner after an approved level 1
        IF NEW.doc_type::text = 'project_loan' THEN
          SELECT created_by_id, g1_exception, company_id INTO creator, exc, cid FROM project_loans WHERE id = NEW.loan_id;
          IF NEW.actor_id IS NULL OR creator IS NULL OR (NEW.actor_id = creator AND (exc IS DISTINCT FROM 'direktur_self' OR NEW.level IS DISTINCT FROM 1)) THEN
            RAISE EXCEPTION 'approvals: the loan creator cannot hold a decision position (G1)' USING ERRCODE = '42501';
          END IF;
          IF NEW.position <> 'approval' OR NEW.level NOT IN (1, 2)
             OR NOT pk_icl_has_role(NEW.actor_id, cid, CASE WHEN NEW.level = 2 THEN 'pk-principal' ELSE 'pk-owner' END) THEN
            RAISE EXCEPTION 'approvals: a loan is decided at level 1 by a Direktur, at level 2 by an Owner (level %)', NEW.level USING ERRCODE = '42501';
          END IF;
          IF NEW.level = 2 AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.loan_id = NEW.loan_id AND a.cycle = NEW.cycle AND a.level = 1 AND a.decision = 'approved') THEN
            RAISE EXCEPTION 'approvals: the Owner level of a loan follows an approved Direktur level' USING ERRCODE = '42501';
          END IF;
          RETURN NEW;
        END IF;
        -- 2026-10-24 (#12): a repayment request — its submitter never decides; same levels, roles and order as a loan
        IF NEW.doc_type::text = 'project_loan_repayment' THEN
          SELECT recorded_by_id, company_id INTO creator, cid FROM project_loan_repayments WHERE id = NEW.loan_repayment_id;
          IF NEW.actor_id IS NULL OR creator IS NULL OR NEW.actor_id = creator THEN
            RAISE EXCEPTION 'approvals: the repayment submitter cannot hold a decision position (G1)' USING ERRCODE = '42501';
          END IF;
          IF NEW.position <> 'approval' OR NEW.level NOT IN (1, 2)
             OR NOT pk_icl_has_role(NEW.actor_id, cid, CASE WHEN NEW.level = 2 THEN 'pk-principal' ELSE 'pk-owner' END) THEN
            RAISE EXCEPTION 'approvals: a repayment is decided at level 1 by a Direktur, at level 2 by an Owner (level %)', NEW.level USING ERRCODE = '42501';
          END IF;
          IF NEW.level = 2 AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.loan_repayment_id = NEW.loan_repayment_id AND a.cycle = NEW.cycle AND a.level = 1 AND a.decision = 'approved') THEN
            RAISE EXCEPTION 'approvals: the Owner level of a repayment follows an approved Direktur level' USING ERRCODE = '42501';
          END IF;
          RETURN NEW;
        END IF;`,
)

const OWNER_DOC_PREV = `
    ALTER TABLE approvals ADD CONSTRAINT approvals_owner_doc CHECK (
      (doc_type::text = 'expense_request' AND request_id IS NOT NULL AND addendum_id IS NULL AND settlement_id IS NULL AND loan_id IS NULL)
      OR (doc_type::text = 'budget_addendum' AND addendum_id IS NOT NULL AND request_id IS NULL AND settlement_id IS NULL AND loan_id IS NULL)
      OR (doc_type::text = 'expense_shortfall' AND settlement_id IS NOT NULL AND request_id IS NULL AND addendum_id IS NULL AND loan_id IS NULL)
      OR (doc_type::text = 'project_loan' AND loan_id IS NOT NULL AND request_id IS NULL AND addendum_id IS NULL AND settlement_id IS NULL));`

const OWNER_DOC_NEW = `
    ALTER TABLE approvals ADD CONSTRAINT approvals_owner_doc CHECK (
      (doc_type::text = 'expense_request' AND request_id IS NOT NULL AND addendum_id IS NULL AND settlement_id IS NULL AND loan_id IS NULL AND loan_repayment_id IS NULL)
      OR (doc_type::text = 'budget_addendum' AND addendum_id IS NOT NULL AND request_id IS NULL AND settlement_id IS NULL AND loan_id IS NULL AND loan_repayment_id IS NULL)
      OR (doc_type::text = 'expense_shortfall' AND settlement_id IS NOT NULL AND request_id IS NULL AND addendum_id IS NULL AND loan_id IS NULL AND loan_repayment_id IS NULL)
      OR (doc_type::text = 'project_loan' AND loan_id IS NOT NULL AND request_id IS NULL AND addendum_id IS NULL AND settlement_id IS NULL AND loan_repayment_id IS NULL)
      OR (doc_type::text = 'project_loan_repayment' AND loan_repayment_id IS NOT NULL AND request_id IS NULL AND addendum_id IS NULL AND settlement_id IS NULL AND loan_id IS NULL));`

/** pk_pb_commitments as of 20261022_100000_d2210_pb_fund (restored by down). */
const COMMITMENTS_PREV = `
    CREATE OR REPLACE FUNCTION pk_pb_commitments(aid integer) RETURNS numeric LANGUAGE sql STABLE AS $fn$
      SELECT coalesce((SELECT sum(greatest(coalesce(r.approved_amount, 0) - coalesce(r.transferred_total, 0), 0))
                         FROM expense_requests r JOIN projects p ON p.id = r.project_id
                        WHERE p.cash_account_id = aid
                          AND ((r.type::text = 'advance' AND r.status::text = 'approved')
                            OR (r.type::text = 'reimburse' AND r.status::text IN ('approved', 'receipt_revision', 'receipts_verified')))), 0)
           + coalesce((SELECT sum(-s.difference) FROM settlements s JOIN expense_requests r ON r.id = s.request_id JOIN projects p ON p.id = r.project_id
                        WHERE p.cash_account_id = aid AND s.status::text = 'verified' AND s.settlement_type::text = 'shortfall' AND s.difference < 0), 0)
           + coalesce((SELECT sum(l.amount) FROM project_loans l
                        WHERE l.lender_cash_account_id = aid AND l.status::text = 'approved' AND coalesce(l.cash_backed, false) AND l.disbursed_at IS NULL), 0)
    $fn$;`

const COMMITMENTS_NEW = `
    CREATE OR REPLACE FUNCTION pk_pb_commitments(aid integer) RETURNS numeric LANGUAGE sql STABLE AS $fn$
      SELECT coalesce((SELECT sum(greatest(coalesce(r.approved_amount, 0) - coalesce(r.transferred_total, 0), 0))
                         FROM expense_requests r JOIN projects p ON p.id = r.project_id
                        WHERE p.cash_account_id = aid
                          AND ((r.type::text = 'advance' AND r.status::text = 'approved')
                            OR (r.type::text = 'reimburse' AND r.status::text IN ('approved', 'receipt_revision', 'receipts_verified')))), 0)
           + coalesce((SELECT sum(-s.difference) FROM settlements s JOIN expense_requests r ON r.id = s.request_id JOIN projects p ON p.id = r.project_id
                        WHERE p.cash_account_id = aid AND s.status::text = 'verified' AND s.settlement_type::text = 'shortfall' AND s.difference < 0), 0)
           + coalesce((SELECT sum(l.amount) FROM project_loans l
                        WHERE l.lender_cash_account_id = aid AND l.status::text = 'approved' AND coalesce(l.cash_backed, false) AND l.disbursed_at IS NULL
                          AND l.borrower_cash_account_id IS DISTINCT FROM aid), 0)
           + coalesce((SELECT sum(x.amount) FROM project_loan_repayments x JOIN project_loans l ON l.id = x.loan_id
                        WHERE l.borrower_cash_account_id = aid AND x.status::text = 'approved' AND coalesce(l.cash_backed, false)
                          AND l.lender_cash_account_id IS DISTINCT FROM aid), 0)
    $fn$;`

const DATE_RE = `'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'`

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
    ALTER TABLE project_loans DROP CONSTRAINT IF EXISTS project_loans_cash_backed;
    ALTER TABLE project_loans
      ADD CONSTRAINT project_loans_cash_backed CHECK (
        NOT coalesce(cash_backed, false)
        OR (kind = 'dana' AND lender_cash_account_id IS NOT NULL AND borrower_cash_account_id IS NOT NULL
            AND (origin::text = 'manual' OR lender_cash_account_id <> borrower_cash_account_id))),
      ADD CONSTRAINT project_loans_approval_level CHECK (
        coalesce(approval_level, 0) IN (0, 1, 2) AND (status::text <> 'pending_approval' OR approval_level IN (1, 2))),
      ADD CONSTRAINT project_loans_submitter_role CHECK (submitter_role IS NULL OR origin::text = 'manual');`)
  await db.execute(sql.raw(withPrelude(LOANS_GUARD_NEW)))

  // ---- 2. project_loan_repayments (status compared as text: the enum values were added by 20261024_400000)
  await db.execute(
    sql.raw(`
    ALTER TABLE project_loan_repayments DROP CONSTRAINT IF EXISTS project_loan_repayments_void;
    ALTER TABLE project_loan_repayments
      ADD CONSTRAINT project_loan_repayments_void CHECK (
        (status::text <> 'void' AND void_reason IS NULL AND voided_by_id IS NULL AND voided_at IS NULL)
        OR (status::text = 'void' AND coalesce(length(trim(void_reason)), 0) >= 3 AND voided_by_id IS NOT NULL AND voided_at IS NOT NULL)),
      ADD CONSTRAINT project_loan_repayments_request CHECK (
        (status::text <> 'rejected' OR coalesce(length(trim(reject_reason)), 0) >= 3)
        AND (status::text <> 'cancelled' OR coalesce(length(trim(cancel_reason)), 0) >= 3)
        AND (status::text <> 'pending_approval' OR approval_level IN (1, 2))
        AND coalesce(approval_level, 0) IN (0, 1, 2)
        AND ((executed_at IS NULL) = (executed_by_id IS NULL))
        AND (executed_at IS NULL OR status::text IN ('posted', 'void'))
        AND (planned_date IS NULL OR planned_date ~ ${DATE_RE}));
    ${REPAYMENTS_GUARD_NEW}
    DROP TRIGGER IF EXISTS project_loan_repayments_company_members ON project_loan_repayments;
    CREATE TRIGGER project_loan_repayments_company_members BEFORE INSERT OR UPDATE ON project_loan_repayments FOR EACH ROW
      EXECUTE FUNCTION pk_company_member('recorded_by_id', 'voided_by_id', 'decided_by_id', 'executed_by_id');`),
  )

  // ---- 3. approvals
  await db.execute(sql.raw(`ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_owner_doc;${OWNER_DOC_NEW}`))
  await db.execute(sql.raw(APPROVALS_FN_NEW))
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS approvals_loan_repayment_one_decision_per_level ON approvals (loan_repayment_id, cycle, position, level)
      WHERE loan_repayment_id IS NOT NULL AND decision IN ('acknowledged', 'approved', 'rejected');
    CREATE UNIQUE INDEX IF NOT EXISTS approvals_loan_repayment_one_position_per_person ON approvals (loan_repayment_id, cycle, actor_id)
      WHERE loan_repayment_id IS NOT NULL AND position IN ('diketahui', 'approval');
    DROP TRIGGER IF EXISTS approvals_company_refs ON approvals;
    CREATE TRIGGER approvals_company_refs BEFORE INSERT OR UPDATE ON approvals FOR EACH ROW
      EXECUTE FUNCTION pk_same_company('request_id', 'expense_requests', 'addendum_id', 'budget_addenda', 'employee_id', 'employees', 'settlement_id', 'settlements', 'loan_id', 'project_loans', 'loan_repayment_id', 'project_loan_repayments');`)

  // ---- 4. fund check commitments of a Pusat Biaya
  await db.execute(sql.raw(COMMITMENTS_NEW))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(COMMITMENTS_PREV))
  await db.execute(sql`
    DROP TRIGGER IF EXISTS approvals_company_refs ON approvals;
    CREATE TRIGGER approvals_company_refs BEFORE INSERT OR UPDATE ON approvals FOR EACH ROW
      EXECUTE FUNCTION pk_same_company('request_id', 'expense_requests', 'addendum_id', 'budget_addenda', 'employee_id', 'employees', 'settlement_id', 'settlements', 'loan_id', 'project_loans');
    DROP INDEX IF EXISTS approvals_loan_repayment_one_decision_per_level;
    DROP INDEX IF EXISTS approvals_loan_repayment_one_position_per_person;`)
  await db.execute(sql.raw(APPROVALS_FN_PREV))
  await db.execute(sql.raw(`ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_owner_doc;${OWNER_DOC_PREV}`))
  await db.execute(
    sql.raw(`
    DROP TRIGGER IF EXISTS project_loan_repayments_company_members ON project_loan_repayments;
    CREATE TRIGGER project_loan_repayments_company_members BEFORE INSERT OR UPDATE ON project_loan_repayments FOR EACH ROW
      EXECUTE FUNCTION pk_company_member('recorded_by_id', 'voided_by_id');
    ${REPAYMENTS_GUARD_PREV}
    ALTER TABLE project_loan_repayments DROP CONSTRAINT IF EXISTS project_loan_repayments_request;
    ALTER TABLE project_loan_repayments DROP CONSTRAINT IF EXISTS project_loan_repayments_void;
    ALTER TABLE project_loan_repayments ADD CONSTRAINT project_loan_repayments_void CHECK (
      (status = 'posted' AND void_reason IS NULL AND voided_by_id IS NULL AND voided_at IS NULL)
      OR (status = 'void' AND coalesce(length(trim(void_reason)), 0) >= 3 AND voided_by_id IS NOT NULL AND voided_at IS NOT NULL));`),
  )
  await db.execute(sql.raw(withPrelude(LOANS_GUARD_PREV)))
  await db.execute(sql`
    ALTER TABLE project_loans DROP CONSTRAINT IF EXISTS project_loans_submitter_role;
    ALTER TABLE project_loans DROP CONSTRAINT IF EXISTS project_loans_approval_level;
    ALTER TABLE project_loans DROP CONSTRAINT IF EXISTS project_loans_cash_backed;
    ALTER TABLE project_loans ADD CONSTRAINT project_loans_cash_backed CHECK (
      NOT coalesce(cash_backed, false)
      OR (kind = 'dana' AND lender_cash_account_id IS NOT NULL AND borrower_cash_account_id IS NOT NULL AND lender_cash_account_id <> borrower_cash_account_id));`)
}
