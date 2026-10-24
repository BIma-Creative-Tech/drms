import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * D2410 (user decision "Hapus draft"): the requester / creator soft-deletes (ADR 0030 `is_deleted`) a Draft nobody ever
 * decided on — also a withdrawn, numbered one. A deleted draft must not block the invoice / document number of its
 * vendor (ADR 0027) or receiving PT grup (ADR 0028) any more: both partial unique indexes now also skip deleted rows
 * (`is_deleted IS NOT TRUE`); the services' duplicate checks (`assertInvoiceUnused`, `assertDocumentUnused`) match.
 * Hand-written (the indexes are not in the Payload snapshot), run as <prefix>_owner. Existing rows: nothing deleted
 * shares a key with a live row (the old index covered deleted rows too) → the new indexes build.
 * Down: the old indexes back — refused (unique violation) while a deleted draft and a live request share a key.
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

    DROP INDEX IF EXISTS expense_requests_vendor_invoice_uq;
    CREATE UNIQUE INDEX expense_requests_vendor_invoice_uq ON expense_requests (vendor_id, pk_invoice_key(invoice_no))
      WHERE payee_type = 'vendor' AND vendor_id IS NOT NULL AND invoice_no IS NOT NULL AND pk_invoice_key(invoice_no) <> ''
        AND status NOT IN ('cancelled', 'rejected') AND is_deleted IS NOT TRUE;

    DROP INDEX IF EXISTS expense_requests_ic_invoice_uq;
    CREATE UNIQUE INDEX expense_requests_ic_invoice_uq ON expense_requests (payee_company_id, pk_invoice_key(invoice_no))
      WHERE payee_type = 'pt_grup' AND payee_company_id IS NOT NULL AND invoice_no IS NOT NULL AND pk_invoice_key(invoice_no) <> ''
        AND status NOT IN ('cancelled', 'rejected') AND is_deleted IS NOT TRUE;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS expense_requests_vendor_invoice_uq;
    CREATE UNIQUE INDEX expense_requests_vendor_invoice_uq ON expense_requests (vendor_id, pk_invoice_key(invoice_no))
      WHERE payee_type = 'vendor' AND vendor_id IS NOT NULL AND invoice_no IS NOT NULL AND pk_invoice_key(invoice_no) <> ''
        AND status NOT IN ('cancelled', 'rejected');

    DROP INDEX IF EXISTS expense_requests_ic_invoice_uq;
    CREATE UNIQUE INDEX expense_requests_ic_invoice_uq ON expense_requests (payee_company_id, pk_invoice_key(invoice_no))
      WHERE payee_type = 'pt_grup' AND payee_company_id IS NOT NULL AND invoice_no IS NOT NULL AND pk_invoice_key(invoice_no) <> ''
        AND status NOT IN ('cancelled', 'rejected');`)
}
