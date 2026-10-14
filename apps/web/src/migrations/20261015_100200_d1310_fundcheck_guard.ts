import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0029 (DRMS 13/10 Phase C) — DB guards, hand-written, run as <prefix>_owner after 20261015_100100_d1310_fundcheck_loans.
 *
 * 1. "Dana tersedia" (ADR 0029 §1) as SQL — the service calls the SAME functions, so web and DB never disagree:
 *    - `pk_fund_balance(cid)` = Σ balance (opening + Σ in − Σ out over all rows) of the PT's ACTIVE cash accounts
 *      WITHOUT a site (site-flagged = kas kecil / rekening kantor cabang, owner 2026-10-15: all excluded);
 *    - `pk_fund_commitments(cid)` = approved-but-not-transferred requests (advance `approved`; reimburse `approved` /
 *      `receipt_revision` / `receipts_verified`: approved − transferred) + verified, unsettled LPJ shortfalls +
 *      inter-PT loans INSTRUCTED with this PT as lender (not yet disbursed);
 *    - `pk_fund_available(cid)` = balance − commitments.
 * 2. Backstop `pk_expense_fund_guard` (BEFORE UPDATE OF status on expense_requests, only `pending_ack|pending_approval →
 *    approved` and only for a PT with `fund_check_enabled`): the per-PT advisory lock of the service
 *    (`pk:fund:<companyId>`) + SQLSTATE 23514 when available < approved amount. The service answers the coded 409
 *    first; this only catches a path that forgets it. The request itself is not counted (the commitment query sees
 *    the OLD status). Renumber list: NEUTRAL (fires on a status change into `approved` only).
 * 3. `intercompany_links` (ADR 0028) carries the loan movements too: `source_doc_type` += `intercompany_loan_disbursement`
 *    / `intercompany_loan_repayment` (`source_doc_id` = the movement, `source_transfer_id` NULL, the payer's KK is
 *    `source_type = intercompany`, direction out, no transfer); `pk_ic_link_sides` gets the loan branch (the
 *    `expense_request` branch is unchanged), `pk_ic_entry_linked` now requires a link for EVERY `intercompany` entry
 *    (KM as target or loan KK as source), `pk_ic_consistency` also keeps the loan movement's status equal to its link's.
 *    One link per movement.
 * 4. `intercompany_loans` (`pk_icl_guard`): created `instructed` by a user holding the STORED role `pk-principal` in BOTH
 *    PTs; content frozen after insert; transitions of ADR 0029 §3.3; cancel only from `instructed`. Linked requests
 *    (`intercompany_loan_requests`) belong to the borrower PT and are written only in the loan's own transaction.
 * 5. `intercompany_loan_transfers` (`pk_icl_transfer_guard`): sides match the loan and the kind; the source account is an
 *    active account of the paying PT WITHOUT a site; the destination is the receiving PT's designated "Rekening
 *    penerimaan antar-PT"; a disbursement only from `instructed`, amount = loan amount, executed by Finance of the
 *    lender who is NOT the instruction's creator (G1); a repayment only on a disbursed loan, ≤ outstanding, by Finance
 *    of the borrower; immutable except `posted → void` with a reason.
 * 6. DEFERRED `pk_icl_consistency` (at commit): `repaid_total` = Σ posted repayments, the loan status matches its
 *    movements (instructed / cancelled: none posted; disbursed: a posted disbursement, nothing repaid; partially_repaid /
 *    repaid: 0 < repaid < amount / repaid = amount) and every movement has its link.
 * 7. No DELETE / TRUNCATE on the three tables (`pk_reject_mutation`); grants for the app role (SELECT / INSERT / UPDATE).
 * 8. `reminder_deliveries.rule` += 'ic_loan_overdue' (daily overdue reminder of a loan, ADR 0029 §3.8).
 * Existing rows: no loan exists, no PT has the switch on → every check holds.
 * Down: the ADR 0028 bodies / CHECK back (refused while loan links exist).
 */
const REMINDER_RULES_PREV = `'late_progress', 'lpj_overdue', 'revision_pending', 'budget_threshold', 'aftersales_followup', 'loan_overdue'`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;

    -- ---------------------------------------------------------------- 1. Dana tersedia
    CREATE OR REPLACE FUNCTION pk_fund_balance(cid integer) RETURNS numeric LANGUAGE sql STABLE AS $fn$
      SELECT coalesce(sum(coalesce(a.opening_balance, 0)
               + coalesce((SELECT sum(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END) FROM cash_entries e WHERE e.cash_account_id = a.id), 0)), 0)
        FROM cash_accounts a
       WHERE a.company_id = cid AND a.active IS NOT FALSE AND a.site_id IS NULL
    $fn$;

    CREATE OR REPLACE FUNCTION pk_fund_commitments(cid integer) RETURNS numeric LANGUAGE sql STABLE AS $fn$
      SELECT coalesce((SELECT sum(greatest(coalesce(r.approved_amount, 0) - coalesce(r.transferred_total, 0), 0)) FROM expense_requests r
                        WHERE r.company_id = cid
                          AND ((r.type::text = 'advance' AND r.status::text = 'approved')
                            OR (r.type::text = 'reimburse' AND r.status::text IN ('approved', 'receipt_revision', 'receipts_verified')))), 0)
           + coalesce((SELECT sum(-s.difference) FROM settlements s
                        WHERE s.company_id = cid AND s.status::text = 'verified' AND s.settlement_type::text = 'shortfall' AND s.difference < 0), 0)
           + coalesce((SELECT sum(l.amount) FROM intercompany_loans l WHERE l.lender_company_id = cid AND l.status = 'instructed'), 0)
    $fn$;

    CREATE OR REPLACE FUNCTION pk_fund_available(cid integer) RETURNS numeric LANGUAGE sql STABLE AS $fn$
      SELECT pk_fund_balance(cid) - pk_fund_commitments(cid)
    $fn$;

    -- ---------------------------------------------------------------- 2. backstop on the approval
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
    $fn$;
    CREATE TRIGGER expense_requests_fund_guard BEFORE UPDATE OF status ON expense_requests FOR EACH ROW
      WHEN (OLD.status IN ('pending_ack', 'pending_approval') AND NEW.status = 'approved')
      EXECUTE FUNCTION pk_expense_fund_guard();

    -- ---------------------------------------------------------------- 3. intercompany_links carries the loan movements
    ALTER TABLE intercompany_links DROP CONSTRAINT IF EXISTS intercompany_links_source_doc_type_check;
    ALTER TABLE intercompany_links ADD CONSTRAINT intercompany_links_source_doc_type_check
      CHECK (source_doc_type IN ('expense_request', 'intercompany_loan_disbursement', 'intercompany_loan_repayment'));
    CREATE UNIQUE INDEX intercompany_links_loan_movement_uq ON intercompany_links (source_doc_type, source_doc_id) WHERE source_doc_type <> 'expense_request';

    CREATE OR REPLACE FUNCTION pk_ic_link_sides() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      kk record;
      km record;
      mv record;
      loan_kind boolean := NEW.source_doc_type IN ('intercompany_loan_disbursement', 'intercompany_loan_repayment');
    BEGIN
      IF NEW.source_doc_type = 'expense_request' AND NOT EXISTS (
           SELECT 1 FROM expense_requests e WHERE e.id = NEW.source_doc_id AND e.company_id = NEW.source_company_id
              AND e.payee_type::text = 'pt_grup' AND e.payee_company_id = NEW.target_company_id) THEN
        RAISE EXCEPTION 'intercompany link side mismatch: request % is not a PT grup payment of PT % to PT %', NEW.source_doc_id, NEW.source_company_id, NEW.target_company_id USING ERRCODE = '23514';
      END IF;
      IF loan_kind THEN
        -- ADR 0029: the movement of an inter-PT loan (disbursement lender → borrower, repayment borrower → lender)
        SELECT * INTO mv FROM intercompany_loan_transfers m WHERE m.id = NEW.source_doc_id;
        IF NOT FOUND OR mv.kind <> CASE NEW.source_doc_type WHEN 'intercompany_loan_disbursement' THEN 'disbursement' ELSE 'repayment' END
           OR mv.from_company_id <> NEW.source_company_id OR mv.to_company_id <> NEW.target_company_id
           OR mv.to_cash_account_id <> NEW.target_cash_account_id OR mv.amount <> NEW.amount OR mv.status <> 'posted'
           OR NEW.source_transfer_id IS NOT NULL THEN
          RAISE EXCEPTION 'intercompany link side mismatch: loan movement % (PT % → PT %)', NEW.source_doc_id, NEW.source_company_id, NEW.target_company_id USING ERRCODE = '23514';
        END IF;
      END IF;
      IF NEW.source_transfer_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM transfers t WHERE t.id = NEW.source_transfer_id AND t.company_id = NEW.source_company_id
              AND (NEW.source_doc_type <> 'expense_request' OR t.request_id = NEW.source_doc_id)) THEN
        RAISE EXCEPTION 'intercompany link side mismatch: transfer % (PT %)', NEW.source_transfer_id, NEW.source_company_id USING ERRCODE = '23514';
      END IF;
      SELECT company_id, direction::text AS direction, source_type::text AS source_type, amount, transfer_id, cash_account_id INTO kk FROM cash_entries WHERE id = NEW.source_cash_entry_id;
      IF NOT FOUND OR kk.company_id <> NEW.source_company_id OR kk.direction <> 'out' OR kk.amount <> NEW.amount
         OR kk.transfer_id IS DISTINCT FROM NEW.source_transfer_id THEN
        RAISE EXCEPTION 'intercompany link side mismatch: source entry % (PT %)', NEW.source_cash_entry_id, NEW.source_company_id USING ERRCODE = '23514';
      END IF;
      -- the payer's KK: a request transfer (ADR 0028) or the loan movement's own KK `intercompany` on its source account (ADR 0029)
      IF loan_kind THEN
        IF kk.source_type <> 'intercompany' OR kk.cash_account_id <> mv.from_cash_account_id THEN
          RAISE EXCEPTION 'intercompany link side mismatch: source entry % is not the KK of loan movement %', NEW.source_cash_entry_id, NEW.source_doc_id USING ERRCODE = '23514';
        END IF;
      ELSIF kk.source_type <> 'transfer' THEN
        RAISE EXCEPTION 'intercompany link side mismatch: source entry % (PT %)', NEW.source_cash_entry_id, NEW.source_company_id USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM cash_accounts a WHERE a.id = NEW.target_cash_account_id AND a.company_id = NEW.target_company_id) THEN
        RAISE EXCEPTION 'intercompany link side mismatch: target account % (PT %)', NEW.target_cash_account_id, NEW.target_company_id USING ERRCODE = '23514';
      END IF;
      SELECT company_id, direction::text AS direction, source_type::text AS source_type, amount, cash_account_id INTO km FROM cash_entries WHERE id = NEW.target_cash_entry_id;
      IF NOT FOUND OR km.company_id <> NEW.target_company_id OR km.direction <> 'in' OR km.source_type <> 'intercompany'
         OR km.amount <> NEW.amount OR km.cash_account_id <> NEW.target_cash_account_id THEN
        RAISE EXCEPTION 'intercompany link side mismatch: target entry % (PT %)', NEW.target_cash_entry_id, NEW.target_company_id USING ERRCODE = '23514';
      END IF;
      IF NEW.status <> 'posted' THEN
        RAISE EXCEPTION 'intercompany_links: a link is created posted' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;

    -- deferred: link, KK, KM (and transfer / loan movement) all posted or all void
    CREATE OR REPLACE FUNCTION pk_ic_consistency() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      l record;
      bad boolean;
    BEGIN
      FOR l IN
        SELECT * FROM intercompany_links x
         WHERE (TG_TABLE_NAME = 'intercompany_links' AND x.id = NEW.id)
            OR (TG_TABLE_NAME = 'cash_entries' AND (x.source_cash_entry_id = NEW.id OR x.target_cash_entry_id = NEW.id))
            OR (TG_TABLE_NAME = 'transfers' AND x.source_transfer_id = NEW.id)
            OR (TG_TABLE_NAME = 'intercompany_loan_transfers' AND x.source_doc_type IN ('intercompany_loan_disbursement', 'intercompany_loan_repayment') AND x.source_doc_id = NEW.id)
      LOOP
        SELECT EXISTS (SELECT 1 FROM cash_entries e WHERE e.id IN (l.source_cash_entry_id, l.target_cash_entry_id) AND e.status::text <> l.status)
            OR EXISTS (SELECT 1 FROM transfers t WHERE t.id = l.source_transfer_id AND t.status::text <> l.status)
            OR EXISTS (SELECT 1 FROM intercompany_loan_transfers m WHERE l.source_doc_type IN ('intercompany_loan_disbursement', 'intercompany_loan_repayment') AND m.id = l.source_doc_id AND m.status <> l.status)
          INTO bad;
        IF bad THEN
          RAISE EXCEPTION 'intercompany link %: link, cash-out of PT %, cash-in of PT % and transfer / loan movement must be all posted or all void (ADR 0028 / 0029)', l.id, l.source_company_id, l.target_company_id USING ERRCODE = '23514';
        END IF;
      END LOOP;
      RETURN NULL;
    END
    $fn$;

    -- every intercompany entry (KM of a payment / loan movement, or the loan KK) has its link
    CREATE OR REPLACE FUNCTION pk_ic_entry_linked() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM intercompany_links x WHERE (NEW.direction::text = 'in' AND x.target_cash_entry_id = NEW.id) OR (NEW.direction::text = 'out' AND x.source_cash_entry_id = NEW.id)) THEN
        RAISE EXCEPTION 'cash_entries %: an intercompany cash entry needs its intercompany link (ADR 0028 / 0029)', NEW.id USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END
    $fn$;

    -- ---------------------------------------------------------------- 4. intercompany_loans
    CREATE OR REPLACE FUNCTION pk_icl_has_role(uid integer, cid integer, role text) RETURNS boolean LANGUAGE sql STABLE AS $fn$
      SELECT EXISTS (SELECT 1 FROM company_memberships m JOIN users u ON u.id = m.user_id JOIN company_memberships_roles mr ON mr.parent_id = m.id
                      WHERE m.user_id = uid AND m.company_id = cid AND coalesce(m.active, true) AND coalesce(u.active, true) AND mr.value::text = role)
    $fn$;

    CREATE OR REPLACE FUNCTION pk_icl_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      frozen text[] := ARRAY['id', 'doc_no', 'lender_company_id', 'borrower_company_id', 'amount', 'instruction_date', 'due_date', 'reason', 'snapshot', 'created_by_id', 'uuid', 'created_at'];
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'instructed' OR NEW.repaid_total <> 0 THEN
          RAISE EXCEPTION 'intercompany_loans: a loan is created instructed, nothing repaid' USING ERRCODE = '23514';
        END IF;
        IF NOT (pk_icl_has_role(NEW.created_by_id, NEW.lender_company_id, 'pk-principal') AND pk_icl_has_role(NEW.created_by_id, NEW.borrower_company_id, 'pk-principal')) THEN
          RAISE EXCEPTION 'intercompany_loans: only the Owner (pk-principal in both PTs) instructs a loan (ADR 0029 §3.4)' USING ERRCODE = '42501';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = NEW.lender_company_id AND c.active IS NOT FALSE)
           OR NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = NEW.borrower_company_id AND c.active IS NOT FALSE) THEN
          RAISE EXCEPTION 'intercompany_loans: both PTs must be active' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;
      IF (to_jsonb(NEW) - ARRAY['status', 'repaid_total', 'cancel_reason', 'cancelled_by_id', 'cancelled_at', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'repaid_total', 'cancel_reason', 'cancelled_by_id', 'cancelled_at', 'updated_at']) THEN
        RAISE EXCEPTION 'intercompany_loans %: content is frozen after the instruction (%)', OLD.id, array_to_string(frozen, ', ') USING ERRCODE = '42501';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
           (OLD.status = 'instructed' AND NEW.status IN ('disbursed', 'cancelled'))
        OR (OLD.status = 'disbursed' AND NEW.status IN ('instructed', 'partially_repaid', 'repaid'))
        OR (OLD.status = 'partially_repaid' AND NEW.status IN ('disbursed', 'repaid'))
        OR (OLD.status = 'repaid' AND NEW.status IN ('partially_repaid', 'disbursed'))) THEN
        RAISE EXCEPTION 'intercompany_loans %: status % → % not allowed (ADR 0029 §3.3)', OLD.id, OLD.status, NEW.status USING ERRCODE = '23514';
      END IF;
      IF OLD.status = 'cancelled' THEN
        RAISE EXCEPTION 'intercompany_loans %: a cancelled loan is final', OLD.id USING ERRCODE = '42501';
      END IF;
      IF (NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR NEW.cancelled_by_id IS DISTINCT FROM OLD.cancelled_by_id)
         AND NOT (OLD.status = 'instructed' AND NEW.status = 'cancelled') THEN
        RAISE EXCEPTION 'intercompany_loans %: cancel columns only with the cancellation', OLD.id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER intercompany_loans_guard BEFORE INSERT OR UPDATE ON intercompany_loans FOR EACH ROW EXECUTE FUNCTION pk_icl_guard();
    CREATE TRIGGER intercompany_loans_no_delete BEFORE DELETE ON intercompany_loans FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER intercompany_loans_no_truncate BEFORE TRUNCATE ON intercompany_loans FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();

    -- linked requests: of the borrower PT, written only in the loan's own (instruction) transaction, never changed
    CREATE OR REPLACE FUNCTION pk_icl_request_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM intercompany_loans l JOIN expense_requests e ON e.id = NEW.request_id
                      WHERE l.id = NEW.loan_id AND e.company_id = l.borrower_company_id AND l.status = 'instructed'
                        AND l.xmin = pg_current_xact_id()::xid) THEN
        RAISE EXCEPTION 'intercompany_loan_requests: request % is not a request of the borrower PT of loan % (or the loan is not new)', NEW.request_id, NEW.loan_id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER intercompany_loan_requests_guard BEFORE INSERT ON intercompany_loan_requests FOR EACH ROW EXECUTE FUNCTION pk_icl_request_guard();
    CREATE TRIGGER intercompany_loan_requests_no_update BEFORE UPDATE OR DELETE ON intercompany_loan_requests FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER intercompany_loan_requests_no_truncate BEFORE TRUNCATE ON intercompany_loan_requests FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();

    -- ---------------------------------------------------------------- 5. intercompany_loan_transfers
    CREATE OR REPLACE FUNCTION pk_icl_transfer_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      l record;
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - ARRAY['status', 'void_reason', 'voided_by_id', 'voided_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'void_reason', 'voided_by_id', 'voided_at'])
           OR NOT (OLD.status = 'posted' AND NEW.status = 'void') THEN
          RAISE EXCEPTION 'intercompany_loan_transfers %: immutable — only posted → void with a reason', OLD.id USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;
      SELECT * INTO l FROM intercompany_loans WHERE id = NEW.loan_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'intercompany_loan_transfers: loan % missing', NEW.loan_id USING ERRCODE = '23514';
      END IF;
      IF NEW.status <> 'posted' THEN
        RAISE EXCEPTION 'intercompany_loan_transfers: a movement is created posted' USING ERRCODE = '23514';
      END IF;
      IF NEW.kind = 'disbursement' THEN
        IF NEW.from_company_id <> l.lender_company_id OR NEW.to_company_id <> l.borrower_company_id THEN
          RAISE EXCEPTION 'intercompany_loan_transfers: a disbursement goes lender → borrower (loan %)', l.id USING ERRCODE = '23514';
        END IF;
        IF l.status <> 'instructed' OR NEW.amount <> l.amount THEN
          RAISE EXCEPTION 'intercompany_loan_transfers: loan % is not waiting for its disbursement of %', l.id, l.amount USING ERRCODE = '23514';
        END IF;
        IF NEW.executed_by_id = l.created_by_id THEN
          RAISE EXCEPTION 'intercompany_loan_transfers: the instruction creator cannot execute the disbursement (G1, loan %)', l.id USING ERRCODE = '42501';
        END IF;
        IF NOT pk_icl_has_role(NEW.executed_by_id, l.lender_company_id, 'pk-finance') THEN
          RAISE EXCEPTION 'intercompany_loan_transfers: the disbursement is executed by Finance of the lender PT (loan %)', l.id USING ERRCODE = '42501';
        END IF;
      ELSE
        IF NEW.from_company_id <> l.borrower_company_id OR NEW.to_company_id <> l.lender_company_id THEN
          RAISE EXCEPTION 'intercompany_loan_transfers: a repayment goes borrower → lender (loan %)', l.id USING ERRCODE = '23514';
        END IF;
        IF l.status NOT IN ('disbursed', 'partially_repaid') OR NEW.amount > l.amount - l.repaid_total THEN
          RAISE EXCEPTION 'intercompany_loan_transfers: repayment % exceeds the outstanding of loan % (or the loan is not disbursed)', NEW.amount, l.id USING ERRCODE = '23514';
        END IF;
        IF NOT pk_icl_has_role(NEW.executed_by_id, l.borrower_company_id, 'pk-finance') THEN
          RAISE EXCEPTION 'intercompany_loan_transfers: the repayment is recorded by Finance of the borrower PT (loan %)', l.id USING ERRCODE = '42501';
        END IF;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM cash_accounts a WHERE a.id = NEW.from_cash_account_id AND a.company_id = NEW.from_company_id AND a.active IS NOT FALSE AND a.site_id IS NULL) THEN
        RAISE EXCEPTION 'intercompany_loan_transfers: source account % is not an active account without site of PT %', NEW.from_cash_account_id, NEW.from_company_id USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM cash_accounts a WHERE a.id = NEW.to_cash_account_id AND a.company_id = NEW.to_company_id AND a.active IS NOT FALSE AND coalesce(a.intercompany_receiving, false)) THEN
        RAISE EXCEPTION 'intercompany_loan_transfers: destination % is not the designated intercompany receiving account of PT %', NEW.to_cash_account_id, NEW.to_company_id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER intercompany_loan_transfers_guard BEFORE INSERT OR UPDATE ON intercompany_loan_transfers FOR EACH ROW EXECUTE FUNCTION pk_icl_transfer_guard();
    CREATE TRIGGER intercompany_loan_transfers_no_delete BEFORE DELETE ON intercompany_loan_transfers FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER intercompany_loan_transfers_no_truncate BEFORE TRUNCATE ON intercompany_loan_transfers FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();
    CREATE CONSTRAINT TRIGGER intercompany_loan_transfers_ic_consistency AFTER UPDATE OF status ON intercompany_loan_transfers
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION pk_ic_consistency();

    -- ---------------------------------------------------------------- 6. deferred loan consistency
    CREATE OR REPLACE FUNCTION pk_icl_consistency() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      l record;
      nr jsonb := to_jsonb(NEW);
      lid integer;
      repaid numeric;
      disbursed integer;
    BEGIN
      -- one function for both tables: the row is read through jsonb (NEW of the loans table has no loan_id / kind)
      IF TG_TABLE_NAME = 'intercompany_loans' THEN
        lid := (nr ->> 'id')::integer;
      ELSE
        lid := (nr ->> 'loan_id')::integer;
      END IF;
      SELECT * INTO l FROM intercompany_loans WHERE id = lid;
      IF NOT FOUND THEN RETURN NULL; END IF;
      SELECT coalesce(sum(m.amount) FILTER (WHERE m.kind = 'repayment' AND m.status = 'posted'), 0),
             (count(*) FILTER (WHERE m.kind = 'disbursement' AND m.status = 'posted'))::int
        INTO repaid, disbursed FROM intercompany_loan_transfers m WHERE m.loan_id = lid;
      IF l.repaid_total <> repaid THEN
        RAISE EXCEPTION 'intercompany_loans %: repaid_total % ≠ posted repayments %', lid, l.repaid_total, repaid USING ERRCODE = '23514';
      END IF;
      IF (l.status IN ('instructed', 'cancelled') AND (disbursed <> 0 OR repaid <> 0))
         OR (l.status = 'disbursed' AND (disbursed <> 1 OR repaid <> 0))
         OR (l.status = 'partially_repaid' AND (disbursed <> 1 OR repaid <= 0 OR repaid >= l.amount))
         OR (l.status = 'repaid' AND (disbursed <> 1 OR repaid <> l.amount)) THEN
        RAISE EXCEPTION 'intercompany_loans %: status % does not match its movements (disbursed %, repaid %)', lid, l.status, disbursed, repaid USING ERRCODE = '23514';
      END IF;
      IF TG_TABLE_NAME = 'intercompany_loan_transfers' AND TG_OP = 'INSERT' THEN
        IF NOT EXISTS (SELECT 1 FROM intercompany_links x
                        WHERE x.source_doc_type = CASE nr ->> 'kind' WHEN 'disbursement' THEN 'intercompany_loan_disbursement' ELSE 'intercompany_loan_repayment' END
                          AND x.source_doc_id = (nr ->> 'id')::integer) THEN
          RAISE EXCEPTION 'intercompany_loan_transfers %: a loan movement needs its intercompany link (KK + KM)', nr ->> 'id' USING ERRCODE = '23514';
        END IF;
      END IF;
      RETURN NULL;
    END
    $fn$;
    CREATE CONSTRAINT TRIGGER intercompany_loans_consistency AFTER INSERT OR UPDATE ON intercompany_loans
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pk_icl_consistency();
    CREATE CONSTRAINT TRIGGER intercompany_loan_transfers_consistency AFTER INSERT OR UPDATE ON intercompany_loan_transfers
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pk_icl_consistency();

    -- ---------------------------------------------------------------- 7. grants
    DO $pk$
    DECLARE
      app_role text := regexp_replace(current_user, '_owner$', '_app');
    BEGIN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON intercompany_loans, intercompany_loan_requests, intercompany_loan_transfers FROM %I', app_role);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON intercompany_loans, intercompany_loan_requests, intercompany_loan_transfers TO %I', app_role);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE intercompany_loans_id_seq, intercompany_loan_transfers_id_seq TO %I', app_role);
    END
    $pk$;`)

  // ---------------------------------------------------------------- 8. reminder rule
  await db.execute(
    sql.raw(`
    ALTER TABLE reminder_deliveries DROP CONSTRAINT IF EXISTS reminder_deliveries_rule_check;
    ALTER TABLE reminder_deliveries ADD CONSTRAINT reminder_deliveries_rule_check CHECK (rule IN (${REMINDER_RULES_PREV}, 'ic_loan_overdue'));`),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF EXISTS (SELECT 1 FROM intercompany_links WHERE source_doc_type <> 'expense_request') THEN
        RAISE EXCEPTION '20261015_100200_d1310_fundcheck_guard down: inter-PT loan movements exist (posted ledger rows are permanent) — restore the pre-deploy dump instead';
      END IF;
    END
    $pk$;
    DELETE FROM reminder_deliveries WHERE rule = 'ic_loan_overdue';`)
  await db.execute(
    sql.raw(`
    ALTER TABLE reminder_deliveries DROP CONSTRAINT IF EXISTS reminder_deliveries_rule_check;
    ALTER TABLE reminder_deliveries ADD CONSTRAINT reminder_deliveries_rule_check CHECK (rule IN (${REMINDER_RULES_PREV}));`),
  )
  await db.execute(sql`
    DROP TRIGGER IF EXISTS intercompany_loan_transfers_consistency ON intercompany_loan_transfers;
    DROP TRIGGER IF EXISTS intercompany_loans_consistency ON intercompany_loans;
    DROP FUNCTION IF EXISTS pk_icl_consistency();
    DROP TRIGGER IF EXISTS intercompany_loan_transfers_ic_consistency ON intercompany_loan_transfers;
    DROP TRIGGER IF EXISTS intercompany_loan_transfers_no_truncate ON intercompany_loan_transfers;
    DROP TRIGGER IF EXISTS intercompany_loan_transfers_no_delete ON intercompany_loan_transfers;
    DROP TRIGGER IF EXISTS intercompany_loan_transfers_guard ON intercompany_loan_transfers;
    DROP FUNCTION IF EXISTS pk_icl_transfer_guard();
    DROP TRIGGER IF EXISTS intercompany_loan_requests_no_truncate ON intercompany_loan_requests;
    DROP TRIGGER IF EXISTS intercompany_loan_requests_no_update ON intercompany_loan_requests;
    DROP TRIGGER IF EXISTS intercompany_loan_requests_guard ON intercompany_loan_requests;
    DROP FUNCTION IF EXISTS pk_icl_request_guard();
    DROP TRIGGER IF EXISTS intercompany_loans_no_truncate ON intercompany_loans;
    DROP TRIGGER IF EXISTS intercompany_loans_no_delete ON intercompany_loans;
    DROP TRIGGER IF EXISTS intercompany_loans_guard ON intercompany_loans;
    DROP FUNCTION IF EXISTS pk_icl_guard();
    DROP FUNCTION IF EXISTS pk_icl_has_role(integer, integer, text);
    DROP TRIGGER IF EXISTS expense_requests_fund_guard ON expense_requests;
    DROP FUNCTION IF EXISTS pk_expense_fund_guard();
    DROP FUNCTION IF EXISTS pk_fund_available(integer);
    DROP FUNCTION IF EXISTS pk_fund_commitments(integer);
    DROP FUNCTION IF EXISTS pk_fund_balance(integer);
    DROP INDEX IF EXISTS intercompany_links_loan_movement_uq;
    ALTER TABLE intercompany_links DROP CONSTRAINT IF EXISTS intercompany_links_source_doc_type_check;
    ALTER TABLE intercompany_links ADD CONSTRAINT intercompany_links_source_doc_type_check CHECK (source_doc_type IN ('expense_request'));

    -- ADR 0028 bodies (20261014_100200_d1310_intercompany_guard)
    CREATE OR REPLACE FUNCTION pk_ic_entry_linked() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM intercompany_links x WHERE x.target_cash_entry_id = NEW.id) THEN
        RAISE EXCEPTION 'cash_entries %: an intercompany cash-in needs its intercompany link (ADR 0028)', NEW.id USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END
    $fn$;
    CREATE OR REPLACE FUNCTION pk_ic_consistency() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      l record;
      bad boolean;
    BEGIN
      FOR l IN
        SELECT * FROM intercompany_links x
         WHERE (TG_TABLE_NAME = 'intercompany_links' AND x.id = NEW.id)
            OR (TG_TABLE_NAME = 'cash_entries' AND (x.source_cash_entry_id = NEW.id OR x.target_cash_entry_id = NEW.id))
            OR (TG_TABLE_NAME = 'transfers' AND x.source_transfer_id = NEW.id)
      LOOP
        SELECT EXISTS (SELECT 1 FROM cash_entries e WHERE e.id IN (l.source_cash_entry_id, l.target_cash_entry_id) AND e.status::text <> l.status)
            OR EXISTS (SELECT 1 FROM transfers t WHERE t.id = l.source_transfer_id AND t.status::text <> l.status)
          INTO bad;
        IF bad THEN
          RAISE EXCEPTION 'intercompany link %: link, cash-out of PT %, cash-in of PT % and transfer must be all posted or all void (ADR 0028)', l.id, l.source_company_id, l.target_company_id USING ERRCODE = '23514';
        END IF;
      END LOOP;
      RETURN NULL;
    END
    $fn$;
    CREATE OR REPLACE FUNCTION pk_ic_link_sides() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      kk record;
      km record;
    BEGIN
      IF NEW.source_doc_type = 'expense_request' AND NOT EXISTS (
           SELECT 1 FROM expense_requests e WHERE e.id = NEW.source_doc_id AND e.company_id = NEW.source_company_id
              AND e.payee_type::text = 'pt_grup' AND e.payee_company_id = NEW.target_company_id) THEN
        RAISE EXCEPTION 'intercompany link side mismatch: request % is not a PT grup payment of PT % to PT %', NEW.source_doc_id, NEW.source_company_id, NEW.target_company_id USING ERRCODE = '23514';
      END IF;
      IF NEW.source_transfer_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM transfers t WHERE t.id = NEW.source_transfer_id AND t.company_id = NEW.source_company_id
              AND (NEW.source_doc_type <> 'expense_request' OR t.request_id = NEW.source_doc_id)) THEN
        RAISE EXCEPTION 'intercompany link side mismatch: transfer % (PT %)', NEW.source_transfer_id, NEW.source_company_id USING ERRCODE = '23514';
      END IF;
      SELECT company_id, direction::text AS direction, source_type::text AS source_type, amount, transfer_id INTO kk FROM cash_entries WHERE id = NEW.source_cash_entry_id;
      IF NOT FOUND OR kk.company_id <> NEW.source_company_id OR kk.direction <> 'out' OR kk.source_type <> 'transfer'
         OR kk.amount <> NEW.amount OR kk.transfer_id IS DISTINCT FROM NEW.source_transfer_id THEN
        RAISE EXCEPTION 'intercompany link side mismatch: source entry % (PT %)', NEW.source_cash_entry_id, NEW.source_company_id USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM cash_accounts a WHERE a.id = NEW.target_cash_account_id AND a.company_id = NEW.target_company_id) THEN
        RAISE EXCEPTION 'intercompany link side mismatch: target account % (PT %)', NEW.target_cash_account_id, NEW.target_company_id USING ERRCODE = '23514';
      END IF;
      SELECT company_id, direction::text AS direction, source_type::text AS source_type, amount, cash_account_id INTO km FROM cash_entries WHERE id = NEW.target_cash_entry_id;
      IF NOT FOUND OR km.company_id <> NEW.target_company_id OR km.direction <> 'in' OR km.source_type <> 'intercompany'
         OR km.amount <> NEW.amount OR km.cash_account_id <> NEW.target_cash_account_id THEN
        RAISE EXCEPTION 'intercompany link side mismatch: target entry % (PT %)', NEW.target_cash_entry_id, NEW.target_company_id USING ERRCODE = '23514';
      END IF;
      IF NEW.status <> 'posted' THEN
        RAISE EXCEPTION 'intercompany_links: a link is created posted' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;`)
}
