import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0028 (DRMS 13/10 Phase B) "Transfer antar-PT" — DB guards, hand-written, run as <prefix>_owner after
 * 20261014_100100_d1310_intercompany.
 *
 * 1. `expense_requests`:
 *    - `expense_requests_payee` CHECK, three shapes: an employee payment carries no vendor / PT / invoice data; a vendor
 *      payment as in ADR 0027 (and no PT); a `pt_grup` payment is type `advance`, has no employee or vendor account and
 *      outside Draft / Dibatalkan carries the receiving PT and the receiving PT's document (number, date, file — owner
 *      decision 2026-10-14: mandatory, like a vendor invoice);
 *    - `expense_requests_payee_not_own_pt`: the receiving PT is never the request's own PT;
 *    - duplicate document: UNIQUE (payee_company_id, pk_invoice_key(invoice_no)) over `pt_grup` payments that are not
 *      cancelled / rejected (`expense_requests_ic_invoice_uq`, same key as the vendor invoice index);
 *    - `pk_expense_vendor_guard` / `pk_settlement_not_vendor` / `pk_expense_requests_project_rules` extended to
 *      `pt_grup`: no receipt / LPJ status, no LPJ, project OR cost center (ADR 0027 decision 2).
 * 2. `cash_accounts`: the designated intercompany receiving account is an active BANK account with bank, number and
 *    holder (`cash_accounts_ic_receiving`), at most one active per PT (`cash_accounts_ic_receiving_uq`).
 * 3. `intercompany_links` (the only two-PT table, ADR 0016 amendment):
 *    - `pk_ic_link_sides()` BEFORE INSERT: every reference belongs to ITS side's PT — the request (payee type
 *      `pt_grup`, receiving PT = target), the transfer (of that request) and the KK (`out`, source_type transfer) of the
 *      source PT; the receiving account and the KM (`in`, source_type intercompany, on that account) of the target PT;
 *      amount = both entries' amount (SQLSTATE 23514 'intercompany link side mismatch');
 *    - immutable except `posted → void` with reason / voided_at (`pk_ic_link_immutable`), no DELETE / TRUNCATE;
 *    - DEFERRED consistency (`pk_ic_consistency`, at commit): a link, its KK, its KM and its transfer are all `posted`
 *      or all `void`; fired only when a status changes (cash_entries / transfers: `UPDATE OF status` + WHEN), so the
 *      renumber CLI's entry_no / doc_no / description updates never trip it (renumber neutral list);
 *    - DEFERRED `pk_ic_entry_linked`: every KM with source_type `intercompany` has its link (UNIQUE: exactly one).
 * Existing rows: no request is `pt_grup`, no account is designated, no link exists → all checks hold.
 * Down: the ADR 0027 bodies / constraints back (refused while `pt_grup` rows exist — see the schema migration).
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

    -- 1. expense_requests
    ALTER TABLE expense_requests DROP CONSTRAINT expense_requests_payee;
    ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_payee CHECK (
      (payee_type = 'karyawan' AND vendor_id IS NULL AND vendor_bank_account_id IS NULL AND payee_company_id IS NULL
        AND invoice_no IS NULL AND invoice_date IS NULL AND invoice_due_date IS NULL AND invoice_file_id IS NULL)
      OR (payee_type = 'vendor' AND type = 'advance' AND bank_account_id IS NULL AND payee_company_id IS NULL
        AND (status IN ('draft', 'cancelled') OR (vendor_id IS NOT NULL AND vendor_bank_account_id IS NOT NULL
             AND invoice_no IS NOT NULL AND invoice_date IS NOT NULL AND invoice_file_id IS NOT NULL)))
      OR (payee_type = 'pt_grup' AND type = 'advance' AND bank_account_id IS NULL AND vendor_id IS NULL AND vendor_bank_account_id IS NULL
        AND (status IN ('draft', 'cancelled') OR (payee_company_id IS NOT NULL
             AND invoice_no IS NOT NULL AND invoice_date IS NOT NULL AND invoice_file_id IS NOT NULL)))
    );
    ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_payee_not_own_pt CHECK (payee_company_id IS DISTINCT FROM company_id);
    CREATE UNIQUE INDEX expense_requests_ic_invoice_uq ON expense_requests (payee_company_id, pk_invoice_key(invoice_no))
      WHERE payee_type = 'pt_grup' AND payee_company_id IS NOT NULL AND invoice_no IS NOT NULL AND pk_invoice_key(invoice_no) <> ''
        AND status NOT IN ('cancelled', 'rejected');

    -- ADR 0027 body + pt_grup: no receipt / LPJ status for a payment without LPJ (vendor, PT grup)
    CREATE OR REPLACE FUNCTION pk_expense_vendor_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.payee_type::text NOT IN ('vendor', 'pt_grup') THEN RETURN NEW; END IF;
      IF NEW.status::text IN ('receipt_revision', 'receipts_verified', 'transferred', 'receipts_complete', 'lpj_submitted', 'lpj_revision', 'lpj_verified') THEN
        RAISE EXCEPTION 'expense_requests %: a % payment has no receipt / LPJ status (%) (ADR 0027 / 0028)', NEW.id, NEW.payee_type, NEW.status USING ERRCODE = '23514';
      END IF;
      IF NEW.payee_type::text = 'vendor' AND NEW.vendor_bank_account_id IS NOT NULL
         AND (TG_OP = 'INSERT' OR NEW.vendor_bank_account_id IS DISTINCT FROM OLD.vendor_bank_account_id OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id)
         AND NOT EXISTS (SELECT 1 FROM vendor_bank_accounts a WHERE a.id = NEW.vendor_bank_account_id AND a.vendor_id IS NOT DISTINCT FROM NEW.vendor_id) THEN
        RAISE EXCEPTION 'expense_requests %: vendor account % is not an account of vendor % (ADR 0027)', NEW.id, NEW.vendor_bank_account_id, NEW.vendor_id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;

    CREATE OR REPLACE FUNCTION pk_settlement_not_vendor() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF EXISTS (SELECT 1 FROM expense_requests e WHERE e.id = NEW.request_id AND e.payee_type::text IN ('vendor', 'pt_grup')) THEN
        RAISE EXCEPTION 'settlements: request % is a vendor / PT grup payment — no LPJ (ADR 0027 / 0028)', NEW.request_id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;

    -- D2 project rule as widened by ADR 0027 (20261013_700100), now for vendor AND pt_grup payments
    CREATE OR REPLACE FUNCTION pk_expense_requests_project_rules() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        -- Payload writes an update of a row with hasMany children as INSERT … ON CONFLICT (id) DO UPDATE: the INSERT
        -- step of an EXISTING row is passed through (the UPDATE branch below then checks the change)
        IF EXISTS (SELECT 1 FROM expense_requests WHERE id = NEW.id) THEN RETURN NEW; END IF;
        -- ADR 0027 / 0028: a vendor / PT grup payment without a project names its cost center
        IF NEW.cost_center_id IS NOT NULL AND NOT (NEW.payee_type::text IN ('vendor', 'pt_grup') AND NEW.project_id IS NULL) THEN
          RAISE EXCEPTION 'expense_requests: new requests have no cost center — Finance sets it on the transfer (D2)' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;
      IF NEW.cost_center_id IS NOT NULL AND NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id
         AND NOT (NEW.payee_type::text IN ('vendor', 'pt_grup') AND OLD.status = 'draft' AND NEW.project_id IS NULL) THEN
        RAISE EXCEPTION 'expense_requests %: the cost center of a request cannot be set or changed (D2)', OLD.id USING ERRCODE = '23514';
      END IF;
      IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'cancelled') AND NEW.project_id IS NULL
         AND NOT (NEW.cost_center_id IS NOT NULL AND (coalesce(OLD.approval_cycle, 0) > 0 OR NEW.payee_type::text IN ('vendor', 'pt_grup'))) THEN
        RAISE EXCEPTION 'expense_requests %: a request is sent with a project (D2)', OLD.id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;

    -- 2. cash_accounts: "Rekening penerimaan antar-PT"
    ALTER TABLE cash_accounts ADD CONSTRAINT cash_accounts_ic_receiving CHECK (
      NOT coalesce(intercompany_receiving, false)
      OR (kind = 'bank' AND bank_id IS NOT NULL AND account_no IS NOT NULL AND btrim(account_no) <> ''
          AND account_holder IS NOT NULL AND btrim(account_holder) <> '')
    );
    CREATE UNIQUE INDEX cash_accounts_ic_receiving_uq ON cash_accounts (company_id) WHERE intercompany_receiving AND active IS NOT FALSE;

    -- 3. intercompany_links
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
    $fn$;
    CREATE TRIGGER intercompany_links_sides BEFORE INSERT ON intercompany_links FOR EACH ROW EXECUTE FUNCTION pk_ic_link_sides();

    CREATE OR REPLACE FUNCTION pk_ic_link_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF (to_jsonb(NEW) - ARRAY['status', 'void_reason', 'voided_by_id', 'voided_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'void_reason', 'voided_by_id', 'voided_at'])
         OR NOT (OLD.status = 'posted' AND NEW.status = 'void') THEN
        RAISE EXCEPTION 'intercompany_links %: immutable — only posted → void with a reason', OLD.id USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER intercompany_links_immutable BEFORE UPDATE ON intercompany_links FOR EACH ROW EXECUTE FUNCTION pk_ic_link_immutable();
    CREATE TRIGGER intercompany_links_no_delete BEFORE DELETE ON intercompany_links FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER intercompany_links_no_truncate BEFORE TRUNCATE ON intercompany_links FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();

    -- deferred: link, KK, KM (and transfer) all posted or all void (checked on the CURRENT rows at commit)
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
    CREATE CONSTRAINT TRIGGER intercompany_links_consistency AFTER INSERT OR UPDATE ON intercompany_links
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pk_ic_consistency();
    CREATE CONSTRAINT TRIGGER cash_entries_ic_consistency AFTER UPDATE OF status ON cash_entries
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION pk_ic_consistency();
    CREATE CONSTRAINT TRIGGER transfers_ic_consistency AFTER UPDATE OF status ON transfers
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION pk_ic_consistency();

    CREATE OR REPLACE FUNCTION pk_ic_entry_linked() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM intercompany_links x WHERE x.target_cash_entry_id = NEW.id) THEN
        RAISE EXCEPTION 'cash_entries %: an intercompany cash-in needs its intercompany link (ADR 0028)', NEW.id USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END
    $fn$;
    CREATE CONSTRAINT TRIGGER cash_entries_ic_linked AFTER INSERT ON cash_entries
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.source_type = 'intercompany') EXECUTE FUNCTION pk_ic_entry_linked();

    DO $pk$
    DECLARE
      app_role text := regexp_replace(current_user, '_owner$', '_app');
    BEGIN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON intercompany_links FROM %I', app_role);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON intercompany_links TO %I', app_role);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE intercompany_links_id_seq TO %I', app_role);
    END
    $pk$;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS cash_entries_ic_linked ON cash_entries;
    DROP FUNCTION IF EXISTS pk_ic_entry_linked();
    DROP TRIGGER IF EXISTS transfers_ic_consistency ON transfers;
    DROP TRIGGER IF EXISTS cash_entries_ic_consistency ON cash_entries;
    DROP TRIGGER IF EXISTS intercompany_links_consistency ON intercompany_links;
    DROP FUNCTION IF EXISTS pk_ic_consistency();
    DROP TRIGGER IF EXISTS intercompany_links_no_truncate ON intercompany_links;
    DROP TRIGGER IF EXISTS intercompany_links_no_delete ON intercompany_links;
    DROP TRIGGER IF EXISTS intercompany_links_immutable ON intercompany_links;
    DROP FUNCTION IF EXISTS pk_ic_link_immutable();
    DROP TRIGGER IF EXISTS intercompany_links_sides ON intercompany_links;
    DROP FUNCTION IF EXISTS pk_ic_link_sides();
    DROP INDEX IF EXISTS cash_accounts_ic_receiving_uq;
    ALTER TABLE cash_accounts DROP CONSTRAINT IF EXISTS cash_accounts_ic_receiving;

    -- ADR 0027 bodies (20261013_700100_d1310_vendor_payments_guard)
    CREATE OR REPLACE FUNCTION pk_expense_requests_project_rules() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF EXISTS (SELECT 1 FROM expense_requests WHERE id = NEW.id) THEN RETURN NEW; END IF;
        IF NEW.cost_center_id IS NOT NULL AND NOT (NEW.payee_type::text = 'vendor' AND NEW.project_id IS NULL) THEN
          RAISE EXCEPTION 'expense_requests: new requests have no cost center — Finance sets it on the transfer (D2)' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;
      IF NEW.cost_center_id IS NOT NULL AND NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id
         AND NOT (NEW.payee_type::text = 'vendor' AND OLD.status = 'draft' AND NEW.project_id IS NULL) THEN
        RAISE EXCEPTION 'expense_requests %: the cost center of a request cannot be set or changed (D2)', OLD.id USING ERRCODE = '23514';
      END IF;
      IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'cancelled') AND NEW.project_id IS NULL
         AND NOT (NEW.cost_center_id IS NOT NULL AND (coalesce(OLD.approval_cycle, 0) > 0 OR NEW.payee_type::text = 'vendor')) THEN
        RAISE EXCEPTION 'expense_requests %: a request is sent with a project (D2)', OLD.id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE OR REPLACE FUNCTION pk_settlement_not_vendor() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF EXISTS (SELECT 1 FROM expense_requests e WHERE e.id = NEW.request_id AND e.payee_type::text = 'vendor') THEN
        RAISE EXCEPTION 'settlements: request % is a vendor payment — no LPJ (ADR 0027)', NEW.request_id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE OR REPLACE FUNCTION pk_expense_vendor_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.payee_type::text <> 'vendor' THEN RETURN NEW; END IF;
      IF NEW.status::text IN ('receipt_revision', 'receipts_verified', 'transferred', 'receipts_complete', 'lpj_submitted', 'lpj_revision', 'lpj_verified') THEN
        RAISE EXCEPTION 'expense_requests %: a vendor payment has no receipt / LPJ status (%) (ADR 0027)', NEW.id, NEW.status USING ERRCODE = '23514';
      END IF;
      IF NEW.vendor_bank_account_id IS NOT NULL
         AND (TG_OP = 'INSERT' OR NEW.vendor_bank_account_id IS DISTINCT FROM OLD.vendor_bank_account_id OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id)
         AND NOT EXISTS (SELECT 1 FROM vendor_bank_accounts a WHERE a.id = NEW.vendor_bank_account_id AND a.vendor_id IS NOT DISTINCT FROM NEW.vendor_id) THEN
        RAISE EXCEPTION 'expense_requests %: vendor account % is not an account of vendor % (ADR 0027)', NEW.id, NEW.vendor_bank_account_id, NEW.vendor_id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;
    DROP INDEX IF EXISTS expense_requests_ic_invoice_uq;
    ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_payee_not_own_pt;
    ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_payee;
    ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_payee CHECK (
      (payee_type = 'karyawan' AND vendor_id IS NULL AND vendor_bank_account_id IS NULL AND invoice_no IS NULL
        AND invoice_date IS NULL AND invoice_due_date IS NULL AND invoice_file_id IS NULL)
      OR (payee_type = 'vendor' AND type = 'advance' AND bank_account_id IS NULL
        AND (status IN ('draft', 'cancelled') OR (vendor_id IS NOT NULL AND vendor_bank_account_id IS NOT NULL
             AND invoice_no IS NOT NULL AND invoice_date IS NOT NULL AND invoice_file_id IS NOT NULL)))
    );`)
}
