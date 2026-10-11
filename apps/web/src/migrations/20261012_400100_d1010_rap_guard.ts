import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 10/10 Phase C — DB guards for D2 (no non-project requests, cost center by Finance at the transfer) and D4
 * (RAP item per line). Hand-written, run as <prefix>_owner after 20261012_400000_d1010_rap_cost_center.
 *
 * D4 lines
 * - `pk_expense_content_hash`: `rap_item_id` is part of the frozen content, appended ONLY when set (same technique
 *   as `receipt_amount`), so the hash of every existing locked request (all NULL) is byte-identical.
 * - `expense_requests_lines_rap_item` (BEFORE INSERT/UPDATE): a line's RAP item belongs to the request's project.
 *
 * D2 requests (`expense_requests_project_rules`, BEFORE INSERT/UPDATE)
 * - a NEW request never carries a cost center (the requester no longer picks one);
 * - a stored cost center (legacy request) only ever goes away (a legacy draft that gets a project), never changes;
 * - sending a request (Draft → any status but Dibatalkan) needs a project. Exception: a LEGACY cost-center request
 *   that was submitted before (approval_cycle > 0, withdrawn / back to Draft) may be sent again as it was —
 *   legacy rows stay valid and keep their workflow.
 *
 * D2 transfers (`transfers_guard_cost_center`, BEFORE INSERT, named to fire after `transfers_guard`): an advance / reimburse transfer names a cost
 * center of the transfer's PT (LPJ shortfall transfers inherit the request's first transfer). Existing transfers
 * are not touched (the column is immutable afterwards through pk_transfers_guard's whitelist).
 *
 * D2 ledger (`cash_entries_project_xor`): a MANUAL cash entry stays "project OR cost center"; entries of a request
 * flow (transfer KK, LPJ refund KM, shortfall KK and their reversals) carry the request's project AND the cost center
 * Finance chose — so K-15 "pusat biaya" = Σ ledger rows of the cost center keeps reconciling. Down: those rows lose
 * the cost center again (append-only table → its user triggers paused for that one statement).
 */
const CONTENT_HASH_300100 = `
    CREATE OR REPLACE FUNCTION pk_expense_content_hash(rid integer) RETURNS text LANGUAGE sql STABLE AS $fn$
      SELECT md5(
        coalesce((SELECT string_agg(concat_ws('|', l.id, coalesce(l.description, ''), coalesce(l.qty::text, ''),
                                              coalesce(l.uom_id::text, ''), coalesce(l.unit_price::text, ''),
                                              coalesce(l.total::text, ''), coalesce(l.category_id::text, ''),
                                              coalesce(l.vehicle_id::text, ''), coalesce(l.notes, ''))
                                    || CASE WHEN l.receipt_amount IS NULL THEN '' ELSE '|ra=' || l.receipt_amount::text END,
                                    E'\\n' ORDER BY l._order)
                  FROM expense_requests_lines l WHERE l._parent_id = rid), '')
        || E'\\n#requesters#' ||
        coalesce((SELECT string_agg(r.employees_id::text, ',' ORDER BY r."order")
                  FROM expense_requests_rels r WHERE r.parent_id = rid AND r.path = 'requesters'), '')
      )
    $fn$;`

const CONTENT_HASH_NEW = `
    CREATE OR REPLACE FUNCTION pk_expense_content_hash(rid integer) RETURNS text LANGUAGE sql STABLE AS $fn$
      SELECT md5(
        coalesce((SELECT string_agg(concat_ws('|', l.id, coalesce(l.description, ''), coalesce(l.qty::text, ''),
                                              coalesce(l.uom_id::text, ''), coalesce(l.unit_price::text, ''),
                                              coalesce(l.total::text, ''), coalesce(l.category_id::text, ''),
                                              coalesce(l.vehicle_id::text, ''), coalesce(l.notes, ''))
                                    || CASE WHEN l.receipt_amount IS NULL THEN '' ELSE '|ra=' || l.receipt_amount::text END
                                    || CASE WHEN l.rap_item_id IS NULL THEN '' ELSE '|rap=' || l.rap_item_id::text END,
                                    E'\\n' ORDER BY l._order)
                  FROM expense_requests_lines l WHERE l._parent_id = rid), '')
        || E'\\n#requesters#' ||
        coalesce((SELECT string_agg(r.employees_id::text, ',' ORDER BY r."order")
                  FROM expense_requests_rels r WHERE r.parent_id = rid AND r.path = 'requesters'), '')
      )
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
  await db.execute(sql.raw(CONTENT_HASH_NEW))
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION pk_expense_lines_rap_item() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      item_project integer;
      req_project integer;
    BEGIN
      IF NEW.rap_item_id IS NULL THEN RETURN NEW; END IF;
      SELECT project_id INTO item_project FROM rap_items WHERE id = NEW.rap_item_id;
      SELECT project_id INTO req_project FROM expense_requests WHERE id = NEW._parent_id;
      IF item_project IS DISTINCT FROM req_project THEN
        RAISE EXCEPTION 'expense_requests %: line RAP item % is not an item of the request project (D4)', NEW._parent_id, NEW.rap_item_id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER expense_requests_lines_rap_item BEFORE INSERT OR UPDATE ON expense_requests_lines
      FOR EACH ROW EXECUTE FUNCTION pk_expense_lines_rap_item();

    CREATE OR REPLACE FUNCTION pk_expense_requests_project_rules() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        -- Payload writes an update of a row with hasMany children as INSERT … ON CONFLICT (id) DO UPDATE: the INSERT
        -- step of an EXISTING row is passed through (the UPDATE branch below then checks the change)
        IF EXISTS (SELECT 1 FROM expense_requests WHERE id = NEW.id) THEN RETURN NEW; END IF;
        IF NEW.cost_center_id IS NOT NULL THEN
          RAISE EXCEPTION 'expense_requests: new requests have no cost center — Finance sets it on the transfer (D2)' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;
      IF NEW.cost_center_id IS NOT NULL AND NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id THEN
        RAISE EXCEPTION 'expense_requests %: the cost center of a request cannot be set or changed (D2)', OLD.id USING ERRCODE = '23514';
      END IF;
      IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'cancelled') AND NEW.project_id IS NULL
         AND NOT (NEW.cost_center_id IS NOT NULL AND coalesce(OLD.approval_cycle, 0) > 0) THEN
        RAISE EXCEPTION 'expense_requests %: a request is sent with a project (D2)', OLD.id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER expense_requests_project_rules BEFORE INSERT OR UPDATE ON expense_requests
      FOR EACH ROW EXECUTE FUNCTION pk_expense_requests_project_rules();

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
    $fn$;
    CREATE TRIGGER transfers_guard_cost_center BEFORE INSERT ON transfers
      FOR EACH ROW WHEN (NEW.kind IN ('advance', 'reimburse')) EXECUTE FUNCTION pk_transfers_cost_center_required();

    ALTER TABLE cash_entries DROP CONSTRAINT cash_entries_project_xor;
    ALTER TABLE cash_entries ADD CONSTRAINT cash_entries_project_xor CHECK (project_id IS NULL OR cost_center_id IS NULL OR source_type <> 'manual');`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE cash_entries DISABLE TRIGGER USER;
    UPDATE cash_entries SET cost_center_id = NULL WHERE project_id IS NOT NULL AND cost_center_id IS NOT NULL;
    ALTER TABLE cash_entries ENABLE TRIGGER USER;
    ALTER TABLE cash_entries DROP CONSTRAINT cash_entries_project_xor;
    ALTER TABLE cash_entries ADD CONSTRAINT cash_entries_project_xor CHECK (project_id IS NULL OR cost_center_id IS NULL);
    DROP TRIGGER IF EXISTS transfers_guard_cost_center ON transfers;
    DROP FUNCTION IF EXISTS pk_transfers_cost_center_required();
    DROP TRIGGER IF EXISTS expense_requests_project_rules ON expense_requests;
    DROP FUNCTION IF EXISTS pk_expense_requests_project_rules();
    DROP TRIGGER IF EXISTS expense_requests_lines_rap_item ON expense_requests_lines;
    DROP FUNCTION IF EXISTS pk_expense_lines_rap_item();`)
  await db.execute(sql.raw(CONTENT_HASH_300100))
}
