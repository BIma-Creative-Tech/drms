import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0027 (DRMS 13/10 Wave 4) "Pembayaran vendor" — DB guards, hand-written, run as <prefix>_owner after
 * 20261013_700000_d1310_vendor_payments.
 *
 * 1. `vendor_bank_accounts` = per-PT master derived from the vendor (as employee_bank_accounts): company filled from
 *    the vendor on a raw insert (`_00_company`), NOT NULL, immutable with the uuid, same PT as its vendor
 *    (`pk_same_company`), digits-only account number, no DELETE / TRUNCATE (deactivate instead).
 * 2. `expense_requests`:
 *    - `expense_requests_payee` CHECK: an employee payment carries no vendor / invoice data; a vendor payment is type
 *      `advance`, has no employee account, and outside Draft / Dibatalkan carries vendor, vendor account, invoice
 *      number, date and file (checked at submit by the service; the DB keeps a locked row complete);
 *    - invoice dates are 'YYYY-MM-DD', the due date not before the invoice date;
 *    - same PT for vendor / vendor account (`pk_same_company`), the vendor account belongs to the vendor, and a vendor
 *      payment never enters a receipt / LPJ status (`pk_expense_vendor_guard`, SQLSTATE 23514);
 *    - duplicate invoice: UNIQUE (vendor_id, pk_invoice_key(invoice_no)) over vendor payments that are not cancelled /
 *      rejected (`expense_requests_vendor_invoice_uq`; key = upper case letters + digits, the app's
 *      normalizeInvoiceNo). Drafts count: a second draft with the same invoice is refused.
 * 3. `settlements`: no LPJ for a vendor payment (`settlements_no_vendor_payment`).
 * 4. `approval_rules.payee_type` is an expense-request condition only (addendum rules: 'any').
 * Existing rows: every request is `karyawan` without vendor data and every rule `any` → all checks hold (validated).
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

    -- 1. vendor_bank_accounts (per-PT master, PT from the vendor)
    CREATE TRIGGER vendor_bank_accounts_00_company BEFORE INSERT ON vendor_bank_accounts FOR EACH ROW EXECUTE FUNCTION pk_company_from_parent('vendor_id', 'vendors');
    ALTER TABLE vendor_bank_accounts ALTER COLUMN company_id SET NOT NULL;
    ALTER TABLE vendor_bank_accounts ADD CONSTRAINT vendor_bank_accounts_account_no CHECK (account_no ~ '^[0-9]{5,34}$');
    CREATE TRIGGER vendor_bank_accounts_company_protect BEFORE UPDATE ON vendor_bank_accounts FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('company_id', 'uuid');
    CREATE TRIGGER vendor_bank_accounts_company_refs BEFORE INSERT OR UPDATE ON vendor_bank_accounts FOR EACH ROW EXECUTE FUNCTION pk_same_company('vendor_id', 'vendors');
    CREATE TRIGGER vendor_bank_accounts_no_delete BEFORE DELETE ON vendor_bank_accounts FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER vendor_bank_accounts_no_truncate BEFORE TRUNCATE ON vendor_bank_accounts FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();

    -- 2. expense_requests
    ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_payee CHECK (
      (payee_type = 'karyawan' AND vendor_id IS NULL AND vendor_bank_account_id IS NULL AND invoice_no IS NULL
        AND invoice_date IS NULL AND invoice_due_date IS NULL AND invoice_file_id IS NULL)
      OR (payee_type = 'vendor' AND type = 'advance' AND bank_account_id IS NULL
        AND (status IN ('draft', 'cancelled') OR (vendor_id IS NOT NULL AND vendor_bank_account_id IS NOT NULL
             AND invoice_no IS NOT NULL AND invoice_date IS NOT NULL AND invoice_file_id IS NOT NULL)))
    );
    ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_invoice_dates CHECK (
      (invoice_date IS NULL OR invoice_date ~ '^\\d{4}-\\d{2}-\\d{2}$')
      AND (invoice_due_date IS NULL OR invoice_due_date ~ '^\\d{4}-\\d{2}-\\d{2}$')
      AND (invoice_date IS NULL OR invoice_due_date IS NULL OR invoice_due_date >= invoice_date)
    );
    CREATE TRIGGER expense_requests_vendor_same_company BEFORE INSERT OR UPDATE ON expense_requests FOR EACH ROW
      EXECUTE FUNCTION pk_same_company('vendor_id', 'vendors', 'vendor_bank_account_id', 'vendor_bank_accounts');

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
    CREATE TRIGGER expense_requests_vendor_guard BEFORE INSERT OR UPDATE ON expense_requests FOR EACH ROW EXECUTE FUNCTION pk_expense_vendor_guard();

    CREATE OR REPLACE FUNCTION pk_invoice_key(v text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
      SELECT upper(regexp_replace(coalesce(v, ''), '[^A-Za-z0-9]', '', 'g'))
    $fn$;
    CREATE UNIQUE INDEX expense_requests_vendor_invoice_uq ON expense_requests (vendor_id, pk_invoice_key(invoice_no))
      WHERE payee_type = 'vendor' AND vendor_id IS NOT NULL AND invoice_no IS NOT NULL AND pk_invoice_key(invoice_no) <> ''
        AND status NOT IN ('cancelled', 'rejected');

    -- 3. no LPJ for a vendor payment
    CREATE OR REPLACE FUNCTION pk_settlement_not_vendor() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF EXISTS (SELECT 1 FROM expense_requests e WHERE e.id = NEW.request_id AND e.payee_type::text = 'vendor') THEN
        RAISE EXCEPTION 'settlements: request % is a vendor payment — no LPJ (ADR 0027)', NEW.request_id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER settlements_no_vendor_payment BEFORE INSERT ON settlements FOR EACH ROW EXECUTE FUNCTION pk_settlement_not_vendor();

    -- 4. payee condition only on expense-request rules
    ALTER TABLE approval_rules ADD CONSTRAINT approval_rules_payee_type CHECK (doc_type = 'expense_request' OR payee_type = 'any');

    DO $pk$
    DECLARE
      app_role text := regexp_replace(current_user, '_owner$', '_app');
    BEGIN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON vendor_bank_accounts FROM %I', app_role);
    END
    $pk$;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE approval_rules DROP CONSTRAINT IF EXISTS approval_rules_payee_type;
    DROP TRIGGER IF EXISTS settlements_no_vendor_payment ON settlements;
    DROP FUNCTION IF EXISTS pk_settlement_not_vendor();
    DROP INDEX IF EXISTS expense_requests_vendor_invoice_uq;
    DROP FUNCTION IF EXISTS pk_invoice_key(text);
    DROP TRIGGER IF EXISTS expense_requests_vendor_guard ON expense_requests;
    DROP FUNCTION IF EXISTS pk_expense_vendor_guard();
    DROP TRIGGER IF EXISTS expense_requests_vendor_same_company ON expense_requests;
    ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_invoice_dates;
    ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_payee;
    DROP TRIGGER IF EXISTS vendor_bank_accounts_no_truncate ON vendor_bank_accounts;
    DROP TRIGGER IF EXISTS vendor_bank_accounts_no_delete ON vendor_bank_accounts;
    DROP TRIGGER IF EXISTS vendor_bank_accounts_company_refs ON vendor_bank_accounts;
    DROP TRIGGER IF EXISTS vendor_bank_accounts_company_protect ON vendor_bank_accounts;
    ALTER TABLE vendor_bank_accounts DROP CONSTRAINT IF EXISTS vendor_bank_accounts_account_no;
    DROP TRIGGER IF EXISTS vendor_bank_accounts_00_company ON vendor_bank_accounts;`)
}
