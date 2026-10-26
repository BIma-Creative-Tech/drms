import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

import { withPrelude } from './20261013_610000_d1310_renumber'
import { LOANS_GUARD_NEW as LOANS_GUARD_PREV } from './20261024_400300_d2410_loan_guard'

/**
 * DRMS 26/10 #1 (ADR 0031 amendment 2026-10-26, user decisions) — DB guards, hand-written, run as <prefix>_owner after
 * 20261026_100100_d2610_owner_loan_schema. Defence in depth behind domain/fundcheck/service.ts and
 * domain/loans/owner-instruct.ts:
 *
 * 1. Fund check: `pk_request_fund_available(cid, pid)` (REPLACED, used by the backstop `pk_expense_fund_guard`, which
 *    is unchanged — same per-PT lock, same firing rule, renumber-NEUTRAL): a request of a project mapped to a Pusat
 *    Biaya is compared with THAT account's dana bebas only (`pk_pb_balance − pk_pb_commitments`); the 0.19.1 fallback
 *    "the PT covers it" is gone. Per PT (`pk_fund_available`) when the request has no project / the project no account.
 * 2. project_loans — an Owner-instructed loan (`submitter_role` 'owner', `expense_request_id` set):
 *    - `pk_project_loans_guard` (REPLACED, prelude kept; previous body = 20261024_400300 restored by down): such a row is
 *      INSERTED approved (no Direktur / Owner level): `pk_project_loan_instruction_check` — manual, numbered, money
 *      (`dana`), cash-backed between the two projects' own, DIFFERENT accounts, not disbursed, level 0, decided by its
 *      creator; the request is of the same PT and project, waiting at its final decision; the creator holds that
 *      decision (the step's named approver / role, or a STORED Owner / Direktur of the PT); no other instructed loan
 *      of the request waits for its transfer; the lender account's dana bebas (row not yet visible) covers the amount,
 *      under the PT fund lock (ADR 0029 §1 lock order). Every other new row has no `expense_request_id`.
 *    - `expense_request_id` immutable (`pk_protect_columns`), same PT (`pk_same_company`), at most one instructed loan per
 *      request waiting for its transfer (partial unique index).
 * Execution of the transfer order is unchanged (Finance of the PT; the service re-checks the lender's dana bebas).
 * Down: restores the previous functions and drops the new objects.
 */

/** pk_request_fund_available as of 20261022_100000_d2210_pb_fund (restored by down). */
const FUND_AVAILABLE_PREV = `
    CREATE OR REPLACE FUNCTION pk_request_fund_available(cid integer, pid integer) RETURNS numeric LANGUAGE sql STABLE AS $fn$
      SELECT CASE WHEN x.aid IS NULL THEN pk_fund_available(cid)
                  ELSE greatest(pk_fund_available(cid), pk_pb_balance(x.aid) - pk_pb_commitments(x.aid)) END
        FROM (SELECT (SELECT p.cash_account_id FROM projects p WHERE p.id = pid) AS aid) x
    $fn$;`

const FUND_AVAILABLE_NEW = `
    CREATE OR REPLACE FUNCTION pk_request_fund_available(cid integer, pid integer) RETURNS numeric LANGUAGE sql STABLE AS $fn$
      SELECT CASE WHEN x.aid IS NULL THEN pk_fund_available(cid)
                  ELSE pk_pb_balance(x.aid) - pk_pb_commitments(x.aid) END
        FROM (SELECT (SELECT p.cash_account_id FROM projects p WHERE p.id = pid) AS aid) x
    $fn$;`

const INSTRUCTION_CHECK = `
    CREATE OR REPLACE FUNCTION pk_project_loan_instruction_check(l project_loans) RETURNS void LANGUAGE plpgsql AS $fn$
    DECLARE
      r record;
      last integer;
      st jsonb;
      uid integer := l.created_by_id;
      free numeric;
    BEGIN
      IF l.origin::text <> 'manual' OR l.status::text <> 'approved' OR l.doc_no IS NULL OR l.g1_exception IS NOT NULL
         OR coalesce(l.repaid_total, 0) <> 0 OR l.kind::text <> 'dana' OR NOT coalesce(l.cash_backed, false)
         OR l.lender_cash_account_id IS NULL OR l.borrower_cash_account_id IS NULL OR l.lender_cash_account_id = l.borrower_cash_account_id
         OR l.disbursed_at IS NOT NULL OR coalesce(l.approval_level, 0) <> 0 OR l.expense_request_id IS NULL
         OR l.decided_at IS NULL OR l.decided_by_id IS DISTINCT FROM uid THEN
        RAISE EXCEPTION 'project_loans: an instructed loan starts approved, numbered, cash-backed between two accounts, linked to its request and not transferred' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = l.lender_project_id AND p.cash_account_id = l.lender_cash_account_id)
         OR NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = l.borrower_project_id AND p.cash_account_id = l.borrower_cash_account_id) THEN
        RAISE EXCEPTION 'project_loans: an instructed loan moves money between the two projects'' own cash accounts' USING ERRCODE = '42501';
      END IF;
      SELECT x.company_id, x.project_id, x.status::text AS status, x.current_level, x.approval_snapshot AS snap INTO r FROM expense_requests x WHERE x.id = l.expense_request_id;
      IF NOT FOUND OR r.company_id IS DISTINCT FROM l.company_id OR r.project_id IS DISTINCT FROM l.borrower_project_id THEN
        RAISE EXCEPTION 'project_loans: an instructed loan covers a request of its borrower project (same PT)' USING ERRCODE = '42501';
      END IF;
      last := coalesce((SELECT max((s ->> 'level')::int) FROM jsonb_array_elements(coalesce(r.snap -> 'steps', '[]'::jsonb)) s), 0);
      IF NOT ((r.status = 'pending_approval' AND last > 0 AND coalesce(r.current_level, 1) >= last) OR (r.status = 'pending_ack' AND last = 0)) THEN
        RAISE EXCEPTION 'project_loans: request % is not waiting at its final decision', l.expense_request_id USING ERRCODE = '42501';
      END IF;
      IF last > 0 THEN
        SELECT s INTO st FROM jsonb_array_elements(r.snap -> 'steps') s WHERE (s ->> 'level')::int = last LIMIT 1;
      ELSE
        st := jsonb_build_object('approverUserId', r.snap -> 'acknowledgerUserId', 'approverRole', r.snap -> 'acknowledgeRole');
      END IF;
      IF NOT coalesce(
           (st ->> 'approverUserId') ~ '^[0-9]+$' AND (st ->> 'approverUserId')::int = uid
        OR (st ->> 'approverRole' IS NOT NULL AND pk_icl_has_role(uid, l.company_id, st ->> 'approverRole'))
        OR pk_icl_has_role(uid, l.company_id, 'pk-principal')
        OR pk_icl_has_role(uid, l.company_id, 'pk-owner'), false) THEN
        RAISE EXCEPTION 'project_loans: only the final decider of request % instructs its loan', l.expense_request_id USING ERRCODE = '42501';
      END IF;
      IF EXISTS (SELECT 1 FROM project_loans x WHERE x.expense_request_id = l.expense_request_id AND x.id <> l.id
                    AND x.status::text = 'approved' AND x.disbursed_at IS NULL) THEN
        RAISE EXCEPTION 'project_loans: request % already has an instructed loan waiting for its transfer', l.expense_request_id USING ERRCODE = '23505';
      END IF;
      -- ADR 0029 §1 lock order: the PT fund lock, then the lender account's dana bebas (this row is not visible yet)
      PERFORM pg_advisory_xact_lock(hashtextextended('pk:fund:' || l.company_id::text, 0));
      free := pk_pb_balance(l.lender_cash_account_id) - pk_pb_commitments(l.lender_cash_account_id);
      IF free < l.amount THEN
        RAISE EXCEPTION 'fund check: lender account % free % < loan %', l.lender_cash_account_id, free, l.amount USING ERRCODE = '23514';
      END IF;
    END
    $fn$;`

const OWNER_BRANCH = `
        -- 2026-10-26 (DRMS 26/10 #1): the loan the final decider instructed for a request whose project's account is short
        IF NEW.submitter_role::text = 'owner' THEN
          PERFORM pk_project_loan_instruction_check(NEW);
          RETURN NEW;
        END IF;
        IF NEW.expense_request_id IS NOT NULL THEN
          RAISE EXCEPTION 'project_loans: only an instructed loan is linked to an expense request' USING ERRCODE = '42501';
        END IF;
        IF NEW.status <> 'draft' OR NEW.doc_no IS NOT NULL`

function replaceOnce(src: string, a: string, b: string): string {
  const i = src.indexOf(a)
  if (i < 0 || src.indexOf(a, i + 1) >= 0) throw new Error(`20261026_100200_d2610_owner_loan_guard: anchor not found exactly once: ${a.slice(0, 60)}`)
  return src.slice(0, i) + b + src.slice(i + a.length)
}

/** Previous guard + the instructed-loan insert branch (an automatic loan is never linked to a request either). */
export const LOANS_GUARD_NEW = replaceOnce(
  replaceOnce(
    LOANS_GUARD_PREV,
    `             OR NEW.disbursed_at IS NULL OR NOT coalesce(NEW.cash_backed, false) THEN`,
    `             OR NEW.disbursed_at IS NULL OR NOT coalesce(NEW.cash_backed, false) OR NEW.expense_request_id IS NOT NULL THEN`,
  ),
  `
        IF NEW.status <> 'draft' OR NEW.doc_no IS NOT NULL`,
  OWNER_BRANCH,
)

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)
  // ---- 1. fund check of a mapped project's request: its Pusat Biaya only
  await db.execute(sql.raw(FUND_AVAILABLE_NEW))
  // ---- 2. instructed loans
  await db.execute(sql.raw(INSTRUCTION_CHECK))
  await db.execute(sql.raw(withPrelude(LOANS_GUARD_NEW)))
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS project_loans_instruction_open_uq ON project_loans (expense_request_id)
      WHERE expense_request_id IS NOT NULL AND status = 'approved' AND disbursed_at IS NULL;
    DROP TRIGGER IF EXISTS project_loans_instruction_protect ON project_loans;
    CREATE TRIGGER project_loans_instruction_protect BEFORE UPDATE ON project_loans FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('expense_request_id');
    DROP TRIGGER IF EXISTS project_loans_instruction_company_refs ON project_loans;
    CREATE TRIGGER project_loans_instruction_company_refs BEFORE INSERT OR UPDATE ON project_loans FOR EACH ROW
      EXECUTE FUNCTION pk_same_company('expense_request_id', 'expense_requests');`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS project_loans_instruction_company_refs ON project_loans;
    DROP TRIGGER IF EXISTS project_loans_instruction_protect ON project_loans;
    DROP INDEX IF EXISTS project_loans_instruction_open_uq;`)
  await db.execute(sql.raw(withPrelude(LOANS_GUARD_PREV)))
  await db.execute(sql`DROP FUNCTION IF EXISTS pk_project_loan_instruction_check(project_loans);`)
  await db.execute(sql.raw(FUND_AVAILABLE_PREV))
}
