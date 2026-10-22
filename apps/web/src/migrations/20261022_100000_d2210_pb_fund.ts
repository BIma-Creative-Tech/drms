import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0031 amendment (user 2026-10-22, "PB dulu, lalu PT") — fund check per Pusat Biaya first, hand-written, run as
 * <prefix>_owner after 20261021_100200_d2110_pb_guard. The service (domain/fundcheck/service.ts) calls the SAME functions:
 *
 * 1. `pk_pb_balance(aid)` = opening + Σ in − Σ out of ONE active cash account (a site account too: it is the project's
 *    own Pusat Biaya); `pk_pb_commitments(aid)` = approved-but-not-transferred requests of the projects mapped to the
 *    account (same statuses as `pk_fund_commitments`) + their verified, unpaid LPJ shortfalls + approved, cash-backed
 *    inter-project loans the account lends and Finance has not disbursed yet.
 * 2. `pk_request_fund_available(cid, pid)` = the larger of `pk_fund_available(cid)` (ADR 0029, per PT) and the dana
 *    bebas of the project's Pusat Biaya; per PT only when the request has no project or the project is not mapped.
 * 3. Backstop `pk_expense_fund_guard` (REPLACED, same trigger, same per-PT lock and firing rule): compares with
 *    `pk_request_fund_available`. Renumber list: still NEUTRAL (fires on a status change into `approved` only).
 * Down: restores the ADR 0029 body and drops the new functions.
 */
const GUARD_PREV = `
    CREATE OR REPLACE FUNCTION pk_expense_fund_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      avail numeric;
    BEGIN
      IF NOT coalesce((SELECT c.fund_check_enabled FROM companies c WHERE c.id = NEW.company_id), false) THEN RETURN NEW; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('pk:fund:' || NEW.company_id::text, 0));
      avail := pk_fund_available(NEW.company_id);
      IF avail < coalesce(NEW.approved_amount, NEW.grand_total, 0) THEN
        RAISE EXCEPTION 'fund check: PT % available % < needed %', NEW.company_id, avail, coalesce(NEW.approved_amount, NEW.grand_total, 0) USING ERRCODE = '23514';
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

    CREATE OR REPLACE FUNCTION pk_pb_balance(aid integer) RETURNS numeric LANGUAGE sql STABLE AS $fn$
      SELECT coalesce((SELECT coalesce(a.opening_balance, 0)
                                + coalesce((SELECT sum(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END) FROM cash_entries e WHERE e.cash_account_id = a.id), 0)
                         FROM cash_accounts a WHERE a.id = aid AND a.active IS NOT FALSE), 0)
    $fn$;

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
    $fn$;

    CREATE OR REPLACE FUNCTION pk_request_fund_available(cid integer, pid integer) RETURNS numeric LANGUAGE sql STABLE AS $fn$
      SELECT CASE WHEN x.aid IS NULL THEN pk_fund_available(cid)
                  ELSE greatest(pk_fund_available(cid), pk_pb_balance(x.aid) - pk_pb_commitments(x.aid)) END
        FROM (SELECT (SELECT p.cash_account_id FROM projects p WHERE p.id = pid) AS aid) x
    $fn$;

    CREATE OR REPLACE FUNCTION pk_expense_fund_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      avail numeric;
    BEGIN
      IF NOT coalesce((SELECT c.fund_check_enabled FROM companies c WHERE c.id = NEW.company_id), false) THEN RETURN NEW; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('pk:fund:' || NEW.company_id::text, 0));
      avail := pk_request_fund_available(NEW.company_id, NEW.project_id);
      IF avail < coalesce(NEW.approved_amount, NEW.grand_total, 0) THEN
        RAISE EXCEPTION 'fund check: PT % / project % available % < needed %', NEW.company_id, NEW.project_id, avail, coalesce(NEW.approved_amount, NEW.grand_total, 0) USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(`
    ${GUARD_PREV}
    DROP FUNCTION IF EXISTS pk_request_fund_available(integer, integer);
    DROP FUNCTION IF EXISTS pk_pb_commitments(integer);
    DROP FUNCTION IF EXISTS pk_pb_balance(integer);
  `))
}
