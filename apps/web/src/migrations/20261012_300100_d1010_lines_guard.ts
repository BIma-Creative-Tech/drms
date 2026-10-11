import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 10/10 Phase B-2 — DB guards + data for D3 (computed line total, "Nominal sesuai nota") and point 13
 * (LPJ photos). Hand-written, run as <prefix>_owner after the generated schema migration
 * 20261012_300000_d1010_lines_lpj_photos (receipt_amount, settlements_rels, photos_hash, flag kind).
 *
 * D3 lines
 * - `expense_requests_lines.receipt_amount`: whole Rupiah ≥ 0 (CHECK).
 * - `pk_expense_frozen_check` (deferred, F2a): additionally, while a request is content-editable (Draft /
 *   Revisi Nota) every line WITH a unit price has `total = round(coalesce(qty, 1) × unit_price)` — the server
 *   rule of src/domain/expense/lines.ts computeLineTotal (qty ≤ 3 decimals, exact numeric). Locked requests are
 *   covered by the content hash (unchanged); lines without a unit price (saved before D3) stay valid and cannot
 *   be submitted (service rule) until completed.
 * - `pk_expense_content_hash`: `receipt_amount` is part of the frozen content, appended ONLY when set, so the
 *   hash of every existing locked request (all NULL) is byte-identical — no stored `content_hash` changes.
 * - Data: lines of content-editable requests whose unit price is missing or no longer reproduces the stored
 *   total get `unit_price = total ÷ qty` when that is exact (the requester's total is kept), else NULL
 *   (legacy line, keeps its total, must be completed before submit). Locked requests are not touched
 *   (frozen content; their informational unit price stays). Count → migrate log. Not reverted by down.
 *
 * Point 13 LPJ photos
 * - app role gets DELETE on `settlements_rels` (Payload re-writes hasMany rows on every update).
 * - `pk_settlements_guard`: with a hasMany field Payload stores every settlement UPDATE as
 *   `INSERT … ON CONFLICT (id) DO UPDATE`; the BEFORE INSERT step of an EXISTING row is now passed through (the
 *   UPDATE branch then checks the change as before). A real INSERT keeps every rule.
 * - `photos_hash` = md5 of the sorted photo ids, set by trigger `settlements_photos_freeze` when the LPJ is
 *   submitted (Draft/Revisi → Diajukan). The settlements guard already refuses any other change of the column.
 * - Deferred constraint trigger `settlements_photos_frozen` (settlements + settlements_rels): outside Draft /
 *   Revisi the photo set must still hash to `photos_hash` (Payload's delete + re-insert of the same set passes,
 *   any real change fails the commit — also as raw SQL with the app role); at most 10 photos.
 */
const CONTENT_HASH_OLD = `
    CREATE OR REPLACE FUNCTION pk_expense_content_hash(rid integer) RETURNS text LANGUAGE sql STABLE AS $fn$
      SELECT md5(
        coalesce((SELECT string_agg(concat_ws('|', l.id, coalesce(l.description, ''), coalesce(l.qty::text, ''),
                                              coalesce(l.uom_id::text, ''), coalesce(l.unit_price::text, ''),
                                              coalesce(l.total::text, ''), coalesce(l.category_id::text, ''),
                                              coalesce(l.vehicle_id::text, ''), coalesce(l.notes, '')),
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
                                    || CASE WHEN l.receipt_amount IS NULL THEN '' ELSE '|ra=' || l.receipt_amount::text END,
                                    E'\\n' ORDER BY l._order)
                  FROM expense_requests_lines l WHERE l._parent_id = rid), '')
        || E'\\n#requesters#' ||
        coalesce((SELECT string_agg(r.employees_id::text, ',' ORDER BY r."order")
                  FROM expense_requests_rels r WHERE r.parent_id = rid AND r.path = 'requesters'), '')
      )
    $fn$;`

const frozenCheck = (withLineRule: boolean) => `
    CREATE OR REPLACE FUNCTION pk_expense_frozen_check() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      rid integer;
      r record;
      lines_total numeric;${withLineRule ? '\n      bad record;' : ''}
    BEGIN
      IF TG_TABLE_NAME = 'expense_requests' THEN
        rid := NEW.id;
      ELSIF TG_TABLE_NAME = 'expense_requests_lines' THEN
        rid := CASE WHEN TG_OP = 'DELETE' THEN OLD._parent_id ELSE NEW._parent_id END;
      ELSE
        rid := CASE WHEN TG_OP = 'DELETE' THEN OLD.parent_id ELSE NEW.parent_id END;
      END IF;
      SELECT status::text AS status, content_hash, grand_total INTO r FROM expense_requests WHERE id = rid;
      IF NOT FOUND THEN RETURN NULL; END IF;
      SELECT coalesce(sum(total), 0) INTO lines_total FROM expense_requests_lines WHERE _parent_id = rid;
      IF coalesce(r.grand_total, 0) <> lines_total THEN
        RAISE EXCEPTION 'expense_requests %: grand_total % <> sum of lines %', rid, r.grand_total, lines_total USING ERRCODE = '23514';
      END IF;
      IF NOT pk_expense_editable(r.status) AND (r.content_hash IS NULL OR r.content_hash <> pk_expense_content_hash(rid)) THEN
        RAISE EXCEPTION 'expense_requests %: lines/requesters are locked in status %', rid, r.status USING ERRCODE = '42501';
      END IF;${
        withLineRule
          ? `
      -- D3 (DRMS 10/10): editable content → total = qty × unit price (qty empty = 1), whole Rupiah
      IF pk_expense_editable(r.status) THEN
        SELECT l.id, l.total, l.qty, l.unit_price INTO bad FROM expense_requests_lines l
         WHERE l._parent_id = rid AND l.unit_price IS NOT NULL
           AND l.total IS DISTINCT FROM round(coalesce(l.qty, 1) * l.unit_price)
         LIMIT 1;
        IF FOUND THEN
          RAISE EXCEPTION 'expense_requests %: line % total % <> qty × unit price (D3)', rid, bad.id, bad.total USING ERRCODE = '23514';
        END IF;
      END IF;`
          : ''
      }
      RETURN NULL;
    END
    $fn$;`

/** pk_settlements_guard as of 20261009_090000_qa_settlements_guard_merge (verbatim; restored by down). */
const SETTLEMENTS_GUARD_OLD = `
    CREATE OR REPLACE FUNCTION pk_settlements_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      r record;
      o jsonb;
      n jsonb;
      submit_cols text[] := ARRAY['usage_notes', 'transferred_total', 'receipts_total', 'difference', 'submit_count',
                                  'submitted_at', 'submitted_by_id', 'doc_no'];
      verify_cols text[] := ARRAY['transferred_total', 'verified_receipts_total', 'difference', 'settlement_type',
                                  'verified_at', 'verified_by_id'];
      settle_cols text[] := ARRAY['settled_at', 'settled_by_id', 'refund_cash_entry_id', 'shortfall_transfer_id'];
      reverse_cols text[] := ARRAY['reversal_count', 'last_reversed_at', 'last_reversed_by_id', 'last_reversal_reason'];
      approval_cols text[] := ARRAY['shortfall_approval_status', 'shortfall_approval_cycle', 'shortfall_approval_level', 'shortfall_approval_amount',
                                    'shortfall_approval_snapshot', 'shortfall_approval_note', 'shortfall_reject_reason'];
      os text;
      ns text;
      entering boolean;
      always text[] := ARRAY['status', 'updated_at'];
      allowed text[];
      reversing boolean;
      provisional boolean;
      ce record;
      tr record;
    BEGIN
      SELECT type::text AS type, status::text AS status INTO r FROM expense_requests WHERE id = NEW.request_id;
      IF TG_OP = 'INSERT' THEN
        IF r.type IS DISTINCT FROM 'advance' THEN
          RAISE EXCEPTION 'settlements: LPJ exists only for Uang Muka (request %)', NEW.request_id USING ERRCODE = '42501';
        END IF;
        IF NEW.status <> 'draft' OR NEW.doc_no IS NOT NULL OR NEW.settled_at IS NOT NULL OR NEW.verified_at IS NOT NULL
           OR NEW.refund_cash_entry_id IS NOT NULL OR NEW.shortfall_transfer_id IS NOT NULL
           OR coalesce(NEW.reversal_count, 0) <> 0 OR NEW.last_reversed_at IS NOT NULL OR NEW.last_reversed_by_id IS NOT NULL
           OR NEW.last_reversal_reason IS NOT NULL
           OR NEW.shortfall_approval_status IS NOT NULL OR coalesce(NEW.shortfall_approval_cycle, 0) <> 0 OR NEW.shortfall_approval_amount IS NOT NULL THEN
          RAISE EXCEPTION 'settlements: new LPJ rows are drafts' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;

      o := to_jsonb(OLD);
      n := to_jsonb(NEW);
      -- E9: the ONLY change of a settled row is the reversal settled → verified (Finance, reason).
      reversing := OLD.status = 'settled' AND NEW.status = 'verified';
      IF OLD.status = 'settled' AND NOT reversing AND (o - 'updated_at') IS DISTINCT FROM (n - 'updated_at') THEN
        RAISE EXCEPTION 'settlements %: settled LPJ is immutable', OLD.id USING ERRCODE = '42501';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
           (OLD.status = 'draft' AND NEW.status = 'submitted') OR (OLD.status = 'submitted' AND NEW.status IN ('revision', 'verified'))
           OR (OLD.status = 'revision' AND NEW.status = 'submitted') OR (OLD.status = 'verified' AND NEW.status = 'settled')
           OR reversing) THEN
        RAISE EXCEPTION 'settlements %: status % → % not allowed', OLD.id, OLD.status, NEW.status USING ERRCODE = '42501';
      END IF;
      allowed := always;
      -- QA-09: the provisional totals of an OPEN LPJ follow every receipt decision / removal without a
      -- status change: receipts_total + difference only (checked below).
      provisional := NEW.status = OLD.status AND OLD.status IN ('draft', 'submitted', 'revision');
      IF provisional THEN allowed := allowed || ARRAY['receipts_total', 'difference']; END IF;
      IF NEW.status = 'submitted' AND OLD.status IN ('draft', 'revision') THEN allowed := allowed || submit_cols; END IF;
      IF NEW.status = 'revision' AND OLD.status = 'submitted' THEN allowed := allowed || ARRAY['finance_notes']; END IF;
      IF NEW.status = 'verified' AND OLD.status = 'submitted' THEN allowed := allowed || verify_cols; END IF;
      IF NEW.status = 'settled' AND OLD.status = 'verified' THEN allowed := allowed || settle_cols; END IF;
      IF reversing THEN allowed := allowed || settle_cols || reverse_cols; END IF;
      -- QA-06 / ADR 0019: the shortfall re-approval runs while the LPJ stays verified
      IF OLD.status = 'verified' AND NEW.status = 'verified' THEN allowed := allowed || approval_cols; END IF;
      IF (o - allowed) IS DISTINCT FROM (n - allowed) THEN
        RAISE EXCEPTION 'settlements %: columns outside the % transition cannot change', OLD.id, NEW.status USING ERRCODE = '42501';
      END IF;

      IF provisional AND (NEW.receipts_total IS DISTINCT FROM OLD.receipts_total OR NEW.difference IS DISTINCT FROM OLD.difference) THEN
        IF NEW.receipts_total IS NULL OR NEW.difference IS DISTINCT FROM NEW.transferred_total - NEW.receipts_total
           OR NEW.receipts_total <> (SELECT coalesce(sum(x.amount), 0) FROM receipts x
                                      WHERE x.request_id = NEW.request_id AND x.status::text IN ('pending', 'valid')) THEN
          RAISE EXCEPTION 'settlements %: provisional totals must equal the active receipts', OLD.id USING ERRCODE = '23514';
        END IF;
      END IF;

      IF (o -> 'shortfall_approval_status', o -> 'shortfall_approval_cycle', o -> 'shortfall_approval_level', o -> 'shortfall_approval_amount',
          o -> 'shortfall_approval_snapshot', o -> 'shortfall_approval_note', o -> 'shortfall_reject_reason')
         IS DISTINCT FROM
         (n -> 'shortfall_approval_status', n -> 'shortfall_approval_cycle', n -> 'shortfall_approval_level', n -> 'shortfall_approval_amount',
          n -> 'shortfall_approval_snapshot', n -> 'shortfall_approval_note', n -> 'shortfall_reject_reason') THEN
        -- QA-06 / ADR 0019 status graph: (none | rejected) → pending_* (new cycle, amount/snapshot/note set once per
        -- cycle); pending_ack → pending_approval | approved | rejected; pending_approval → (next level) | approved | rejected.
        os := OLD.shortfall_approval_status::text;
        ns := NEW.shortfall_approval_status::text;
        entering := coalesce(coalesce(os, 'rejected') = 'rejected' AND ns IN ('pending_ack', 'pending_approval'), false);
        IF NEW.settlement_type IS DISTINCT FROM 'shortfall' THEN
          RAISE EXCEPTION 'settlements %: shortfall approval only for a shortfall LPJ', OLD.id USING ERRCODE = '42501';
        END IF;
        IF NOT coalesce(
             (entering AND NEW.shortfall_approval_cycle = coalesce(OLD.shortfall_approval_cycle, 0) + 1)
          OR (os = 'pending_ack' AND ns IN ('pending_approval', 'approved', 'rejected') AND NEW.shortfall_approval_cycle = OLD.shortfall_approval_cycle)
          OR (os = 'pending_approval' AND ns IN ('pending_approval', 'approved', 'rejected') AND NEW.shortfall_approval_cycle = OLD.shortfall_approval_cycle), false) THEN
          RAISE EXCEPTION 'settlements %: shortfall approval % → % not allowed', OLD.id, coalesce(os, 'none'), coalesce(ns, 'none') USING ERRCODE = '42501';
        END IF;
        IF NOT entering AND ((o -> 'shortfall_approval_amount', o -> 'shortfall_approval_snapshot', o -> 'shortfall_approval_note')
                             IS DISTINCT FROM (n -> 'shortfall_approval_amount', n -> 'shortfall_approval_snapshot', n -> 'shortfall_approval_note')) THEN
          RAISE EXCEPTION 'settlements %: shortfall approval amount/rule/note are fixed per cycle', OLD.id USING ERRCODE = '42501';
        END IF;
        IF ns = 'rejected' AND length(coalesce(NEW.shortfall_reject_reason, '')) < 3 THEN
          RAISE EXCEPTION 'settlements %: shortfall rejection needs a reason', OLD.id USING ERRCODE = '23514';
        END IF;
      END IF;

      IF NEW.status = 'verified' AND OLD.status = 'submitted' THEN
        IF NEW.verified_receipts_total IS NULL OR NEW.transferred_total IS NULL
           OR NEW.difference IS DISTINCT FROM NEW.transferred_total - NEW.verified_receipts_total
           OR NEW.settlement_type IS DISTINCT FROM (CASE WHEN NEW.difference > 0 THEN 'refund' WHEN NEW.difference < 0 THEN 'shortfall' ELSE 'none' END)::enum_settlements_settlement_type THEN
          RAISE EXCEPTION 'settlements %: verified totals are inconsistent', OLD.id USING ERRCODE = '23514';
        END IF;
      END IF;

      IF NEW.status = 'settled' AND OLD.status = 'verified' THEN
        -- links are set once per settlement cycle (a reversal clears them; replaces pk_protect_columns)
        IF OLD.refund_cash_entry_id IS NOT NULL OR OLD.shortfall_transfer_id IS NOT NULL THEN
          RAISE EXCEPTION 'settlements %: settlement links are set once per settlement', OLD.id USING ERRCODE = '42501';
        END IF;
        IF NEW.settlement_type = 'none' THEN
          IF NEW.difference <> 0 OR NEW.refund_cash_entry_id IS NOT NULL OR NEW.shortfall_transfer_id IS NOT NULL THEN
            RAISE EXCEPTION 'settlements %: nothing to settle expected', OLD.id USING ERRCODE = '23514';
          END IF;
        ELSIF NEW.settlement_type = 'refund' THEN
          SELECT direction::text AS direction, amount, source_type::text AS source_type, expense_request_id, status::text AS status
            INTO ce FROM cash_entries WHERE id = NEW.refund_cash_entry_id;
          IF NOT FOUND OR NEW.shortfall_transfer_id IS NOT NULL OR ce.direction <> 'in' OR ce.source_type <> 'settlement_refund'
             OR ce.status <> 'posted' OR ce.expense_request_id IS DISTINCT FROM NEW.request_id OR ce.amount <> NEW.difference THEN
            RAISE EXCEPTION 'settlements %: refund must be a posted KM of exactly the surplus', OLD.id USING ERRCODE = '23514';
          END IF;
        ELSE
          SELECT kind::text AS kind, amount, request_id, status::text AS status INTO tr FROM transfers WHERE id = NEW.shortfall_transfer_id;
          IF NOT FOUND OR NEW.refund_cash_entry_id IS NOT NULL OR tr.kind <> 'lpj_shortfall' OR tr.status <> 'posted'
             OR tr.request_id IS DISTINCT FROM NEW.request_id OR tr.amount <> -NEW.difference THEN
            RAISE EXCEPTION 'settlements %: shortfall must be a posted transfer of exactly the shortfall', OLD.id USING ERRCODE = '23514';
          END IF;
        END IF;
      END IF;

      IF reversing THEN
        -- E9: only a settlement that moved money; its KM / transfer must already be void; links and
        -- settle stamps cleared; reversal counter +1 with actor, time and reason.
        IF OLD.settlement_type NOT IN ('refund', 'shortfall') THEN
          RAISE EXCEPTION 'settlements %: nothing to reverse (settlement type %)', OLD.id, OLD.settlement_type USING ERRCODE = '42501';
        END IF;
        IF NEW.settled_at IS NOT NULL OR NEW.settled_by_id IS NOT NULL OR NEW.refund_cash_entry_id IS NOT NULL OR NEW.shortfall_transfer_id IS NOT NULL
           OR NEW.reversal_count IS DISTINCT FROM coalesce(OLD.reversal_count, 0) + 1 OR NEW.last_reversed_at IS NULL
           OR NEW.last_reversed_by_id IS NULL OR length(coalesce(NEW.last_reversal_reason, '')) < 3 THEN
          RAISE EXCEPTION 'settlements %: reversal must clear the settlement and record count, actor and reason', OLD.id USING ERRCODE = '23514';
        END IF;
        IF OLD.settlement_type = 'refund' AND NOT EXISTS (SELECT 1 FROM cash_entries WHERE id = OLD.refund_cash_entry_id AND status = 'void') THEN
          RAISE EXCEPTION 'settlements %: reverse only after the refund KM is void', OLD.id USING ERRCODE = '23514';
        END IF;
        IF OLD.settlement_type = 'shortfall' AND NOT EXISTS (SELECT 1 FROM transfers WHERE id = OLD.shortfall_transfer_id AND status = 'void') THEN
          RAISE EXCEPTION 'settlements %: reverse only after the shortfall transfer is void', OLD.id USING ERRCODE = '23514';
        END IF;
      END IF;
      RETURN NEW;
    END
    $fn$;`

/** + the upsert pass-through (Payload upsert of an existing settlement once `photos` exists). */
const SETTLEMENTS_GUARD_NEW = `
    CREATE OR REPLACE FUNCTION pk_settlements_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      r record;
      o jsonb;
      n jsonb;
      submit_cols text[] := ARRAY['usage_notes', 'transferred_total', 'receipts_total', 'difference', 'submit_count',
                                  'submitted_at', 'submitted_by_id', 'doc_no'];
      verify_cols text[] := ARRAY['transferred_total', 'verified_receipts_total', 'difference', 'settlement_type',
                                  'verified_at', 'verified_by_id'];
      settle_cols text[] := ARRAY['settled_at', 'settled_by_id', 'refund_cash_entry_id', 'shortfall_transfer_id'];
      reverse_cols text[] := ARRAY['reversal_count', 'last_reversed_at', 'last_reversed_by_id', 'last_reversal_reason'];
      approval_cols text[] := ARRAY['shortfall_approval_status', 'shortfall_approval_cycle', 'shortfall_approval_level', 'shortfall_approval_amount',
                                    'shortfall_approval_snapshot', 'shortfall_approval_note', 'shortfall_reject_reason'];
      os text;
      ns text;
      entering boolean;
      always text[] := ARRAY['status', 'updated_at'];
      allowed text[];
      reversing boolean;
      provisional boolean;
      ce record;
      tr record;
    BEGIN
      SELECT type::text AS type, status::text AS status INTO r FROM expense_requests WHERE id = NEW.request_id;
      -- DRMS 10/10 B-2: with a hasMany field (LPJ photos) Payload writes an UPDATE as INSERT … ON CONFLICT (id) DO UPDATE;
      -- its BEFORE INSERT step carries the id of an EXISTING row → skip here, the UPDATE branch below checks the change.
      IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM settlements x WHERE x.id = NEW.id) THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'INSERT' THEN
        IF r.type IS DISTINCT FROM 'advance' THEN
          RAISE EXCEPTION 'settlements: LPJ exists only for Uang Muka (request %)', NEW.request_id USING ERRCODE = '42501';
        END IF;
        IF NEW.status <> 'draft' OR NEW.doc_no IS NOT NULL OR NEW.settled_at IS NOT NULL OR NEW.verified_at IS NOT NULL
           OR NEW.refund_cash_entry_id IS NOT NULL OR NEW.shortfall_transfer_id IS NOT NULL
           OR coalesce(NEW.reversal_count, 0) <> 0 OR NEW.last_reversed_at IS NOT NULL OR NEW.last_reversed_by_id IS NOT NULL
           OR NEW.last_reversal_reason IS NOT NULL
           OR NEW.shortfall_approval_status IS NOT NULL OR coalesce(NEW.shortfall_approval_cycle, 0) <> 0 OR NEW.shortfall_approval_amount IS NOT NULL THEN
          RAISE EXCEPTION 'settlements: new LPJ rows are drafts' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;

      o := to_jsonb(OLD);
      n := to_jsonb(NEW);
      -- E9: the ONLY change of a settled row is the reversal settled → verified (Finance, reason).
      reversing := OLD.status = 'settled' AND NEW.status = 'verified';
      IF OLD.status = 'settled' AND NOT reversing AND (o - 'updated_at') IS DISTINCT FROM (n - 'updated_at') THEN
        RAISE EXCEPTION 'settlements %: settled LPJ is immutable', OLD.id USING ERRCODE = '42501';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
           (OLD.status = 'draft' AND NEW.status = 'submitted') OR (OLD.status = 'submitted' AND NEW.status IN ('revision', 'verified'))
           OR (OLD.status = 'revision' AND NEW.status = 'submitted') OR (OLD.status = 'verified' AND NEW.status = 'settled')
           OR reversing) THEN
        RAISE EXCEPTION 'settlements %: status % → % not allowed', OLD.id, OLD.status, NEW.status USING ERRCODE = '42501';
      END IF;
      allowed := always;
      -- QA-09: the provisional totals of an OPEN LPJ follow every receipt decision / removal without a
      -- status change: receipts_total + difference only (checked below).
      provisional := NEW.status = OLD.status AND OLD.status IN ('draft', 'submitted', 'revision');
      IF provisional THEN allowed := allowed || ARRAY['receipts_total', 'difference']; END IF;
      IF NEW.status = 'submitted' AND OLD.status IN ('draft', 'revision') THEN allowed := allowed || submit_cols; END IF;
      IF NEW.status = 'revision' AND OLD.status = 'submitted' THEN allowed := allowed || ARRAY['finance_notes']; END IF;
      IF NEW.status = 'verified' AND OLD.status = 'submitted' THEN allowed := allowed || verify_cols; END IF;
      IF NEW.status = 'settled' AND OLD.status = 'verified' THEN allowed := allowed || settle_cols; END IF;
      IF reversing THEN allowed := allowed || settle_cols || reverse_cols; END IF;
      -- QA-06 / ADR 0019: the shortfall re-approval runs while the LPJ stays verified
      IF OLD.status = 'verified' AND NEW.status = 'verified' THEN allowed := allowed || approval_cols; END IF;
      IF (o - allowed) IS DISTINCT FROM (n - allowed) THEN
        RAISE EXCEPTION 'settlements %: columns outside the % transition cannot change', OLD.id, NEW.status USING ERRCODE = '42501';
      END IF;

      IF provisional AND (NEW.receipts_total IS DISTINCT FROM OLD.receipts_total OR NEW.difference IS DISTINCT FROM OLD.difference) THEN
        IF NEW.receipts_total IS NULL OR NEW.difference IS DISTINCT FROM NEW.transferred_total - NEW.receipts_total
           OR NEW.receipts_total <> (SELECT coalesce(sum(x.amount), 0) FROM receipts x
                                      WHERE x.request_id = NEW.request_id AND x.status::text IN ('pending', 'valid')) THEN
          RAISE EXCEPTION 'settlements %: provisional totals must equal the active receipts', OLD.id USING ERRCODE = '23514';
        END IF;
      END IF;

      IF (o -> 'shortfall_approval_status', o -> 'shortfall_approval_cycle', o -> 'shortfall_approval_level', o -> 'shortfall_approval_amount',
          o -> 'shortfall_approval_snapshot', o -> 'shortfall_approval_note', o -> 'shortfall_reject_reason')
         IS DISTINCT FROM
         (n -> 'shortfall_approval_status', n -> 'shortfall_approval_cycle', n -> 'shortfall_approval_level', n -> 'shortfall_approval_amount',
          n -> 'shortfall_approval_snapshot', n -> 'shortfall_approval_note', n -> 'shortfall_reject_reason') THEN
        -- QA-06 / ADR 0019 status graph: (none | rejected) → pending_* (new cycle, amount/snapshot/note set once per
        -- cycle); pending_ack → pending_approval | approved | rejected; pending_approval → (next level) | approved | rejected.
        os := OLD.shortfall_approval_status::text;
        ns := NEW.shortfall_approval_status::text;
        entering := coalesce(coalesce(os, 'rejected') = 'rejected' AND ns IN ('pending_ack', 'pending_approval'), false);
        IF NEW.settlement_type IS DISTINCT FROM 'shortfall' THEN
          RAISE EXCEPTION 'settlements %: shortfall approval only for a shortfall LPJ', OLD.id USING ERRCODE = '42501';
        END IF;
        IF NOT coalesce(
             (entering AND NEW.shortfall_approval_cycle = coalesce(OLD.shortfall_approval_cycle, 0) + 1)
          OR (os = 'pending_ack' AND ns IN ('pending_approval', 'approved', 'rejected') AND NEW.shortfall_approval_cycle = OLD.shortfall_approval_cycle)
          OR (os = 'pending_approval' AND ns IN ('pending_approval', 'approved', 'rejected') AND NEW.shortfall_approval_cycle = OLD.shortfall_approval_cycle), false) THEN
          RAISE EXCEPTION 'settlements %: shortfall approval % → % not allowed', OLD.id, coalesce(os, 'none'), coalesce(ns, 'none') USING ERRCODE = '42501';
        END IF;
        IF NOT entering AND ((o -> 'shortfall_approval_amount', o -> 'shortfall_approval_snapshot', o -> 'shortfall_approval_note')
                             IS DISTINCT FROM (n -> 'shortfall_approval_amount', n -> 'shortfall_approval_snapshot', n -> 'shortfall_approval_note')) THEN
          RAISE EXCEPTION 'settlements %: shortfall approval amount/rule/note are fixed per cycle', OLD.id USING ERRCODE = '42501';
        END IF;
        IF ns = 'rejected' AND length(coalesce(NEW.shortfall_reject_reason, '')) < 3 THEN
          RAISE EXCEPTION 'settlements %: shortfall rejection needs a reason', OLD.id USING ERRCODE = '23514';
        END IF;
      END IF;

      IF NEW.status = 'verified' AND OLD.status = 'submitted' THEN
        IF NEW.verified_receipts_total IS NULL OR NEW.transferred_total IS NULL
           OR NEW.difference IS DISTINCT FROM NEW.transferred_total - NEW.verified_receipts_total
           OR NEW.settlement_type IS DISTINCT FROM (CASE WHEN NEW.difference > 0 THEN 'refund' WHEN NEW.difference < 0 THEN 'shortfall' ELSE 'none' END)::enum_settlements_settlement_type THEN
          RAISE EXCEPTION 'settlements %: verified totals are inconsistent', OLD.id USING ERRCODE = '23514';
        END IF;
      END IF;

      IF NEW.status = 'settled' AND OLD.status = 'verified' THEN
        -- links are set once per settlement cycle (a reversal clears them; replaces pk_protect_columns)
        IF OLD.refund_cash_entry_id IS NOT NULL OR OLD.shortfall_transfer_id IS NOT NULL THEN
          RAISE EXCEPTION 'settlements %: settlement links are set once per settlement', OLD.id USING ERRCODE = '42501';
        END IF;
        IF NEW.settlement_type = 'none' THEN
          IF NEW.difference <> 0 OR NEW.refund_cash_entry_id IS NOT NULL OR NEW.shortfall_transfer_id IS NOT NULL THEN
            RAISE EXCEPTION 'settlements %: nothing to settle expected', OLD.id USING ERRCODE = '23514';
          END IF;
        ELSIF NEW.settlement_type = 'refund' THEN
          SELECT direction::text AS direction, amount, source_type::text AS source_type, expense_request_id, status::text AS status
            INTO ce FROM cash_entries WHERE id = NEW.refund_cash_entry_id;
          IF NOT FOUND OR NEW.shortfall_transfer_id IS NOT NULL OR ce.direction <> 'in' OR ce.source_type <> 'settlement_refund'
             OR ce.status <> 'posted' OR ce.expense_request_id IS DISTINCT FROM NEW.request_id OR ce.amount <> NEW.difference THEN
            RAISE EXCEPTION 'settlements %: refund must be a posted KM of exactly the surplus', OLD.id USING ERRCODE = '23514';
          END IF;
        ELSE
          SELECT kind::text AS kind, amount, request_id, status::text AS status INTO tr FROM transfers WHERE id = NEW.shortfall_transfer_id;
          IF NOT FOUND OR NEW.refund_cash_entry_id IS NOT NULL OR tr.kind <> 'lpj_shortfall' OR tr.status <> 'posted'
             OR tr.request_id IS DISTINCT FROM NEW.request_id OR tr.amount <> -NEW.difference THEN
            RAISE EXCEPTION 'settlements %: shortfall must be a posted transfer of exactly the shortfall', OLD.id USING ERRCODE = '23514';
          END IF;
        END IF;
      END IF;

      IF reversing THEN
        -- E9: only a settlement that moved money; its KM / transfer must already be void; links and
        -- settle stamps cleared; reversal counter +1 with actor, time and reason.
        IF OLD.settlement_type NOT IN ('refund', 'shortfall') THEN
          RAISE EXCEPTION 'settlements %: nothing to reverse (settlement type %)', OLD.id, OLD.settlement_type USING ERRCODE = '42501';
        END IF;
        IF NEW.settled_at IS NOT NULL OR NEW.settled_by_id IS NOT NULL OR NEW.refund_cash_entry_id IS NOT NULL OR NEW.shortfall_transfer_id IS NOT NULL
           OR NEW.reversal_count IS DISTINCT FROM coalesce(OLD.reversal_count, 0) + 1 OR NEW.last_reversed_at IS NULL
           OR NEW.last_reversed_by_id IS NULL OR length(coalesce(NEW.last_reversal_reason, '')) < 3 THEN
          RAISE EXCEPTION 'settlements %: reversal must clear the settlement and record count, actor and reason', OLD.id USING ERRCODE = '23514';
        END IF;
        IF OLD.settlement_type = 'refund' AND NOT EXISTS (SELECT 1 FROM cash_entries WHERE id = OLD.refund_cash_entry_id AND status = 'void') THEN
          RAISE EXCEPTION 'settlements %: reverse only after the refund KM is void', OLD.id USING ERRCODE = '23514';
        END IF;
        IF OLD.settlement_type = 'shortfall' AND NOT EXISTS (SELECT 1 FROM transfers WHERE id = OLD.shortfall_transfer_id AND status = 'void') THEN
          RAISE EXCEPTION 'settlements %: reverse only after the shortfall transfer is void', OLD.id USING ERRCODE = '23514';
        END IF;
      END IF;
      RETURN NEW;
    END
    $fn$;`

const NAME = '20261012_300100_d1010_lines_guard'

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;

    ALTER TABLE expense_requests_lines
      ADD CONSTRAINT expense_requests_lines_receipt_amount CHECK (receipt_amount IS NULL OR (receipt_amount >= 0 AND receipt_amount = trunc(receipt_amount)));

    DO $pk$
    DECLARE
      app_role text := regexp_replace(current_user, '_owner$', '_app');
    BEGIN
      EXECUTE format('GRANT DELETE ON settlements_rels TO %I', app_role);
    END
    $pk$;`)

  // ---- D3 data: editable requests only (locked content is frozen and keeps its informational unit price)
  const fixed = (await db.execute(sql`
    WITH c AS (
      SELECT l.id, l.total, coalesce(l.qty, 1) AS q, round(l.total / coalesce(l.qty, 1)) AS up
        FROM expense_requests_lines l JOIN expense_requests e ON e.id = l._parent_id
       WHERE pk_expense_editable(e.status::text) AND l.total IS NOT NULL
         AND (l.unit_price IS NULL OR round(coalesce(l.qty, 1) * l.unit_price) <> l.total)
    )
    UPDATE expense_requests_lines l
       SET unit_price = CASE WHEN round(c.q * c.up) = c.total THEN c.up ELSE NULL END
      FROM c WHERE c.id = l.id
    RETURNING l.id, l.unit_price`)) as unknown as { rows: Array<{ id: string; unit_price: string | null }> }

  await db.execute(sql.raw(`${CONTENT_HASH_NEW}\n${frozenCheck(true)}`))

  // ---- point 13: LPJ photos frozen at submit
  await db.execute(sql.raw(SETTLEMENTS_GUARD_NEW))
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION pk_settlement_photos_hash(sid integer) RETURNS text LANGUAGE sql STABLE AS $fn$
      SELECT md5(string_agg(r.media_receipts_id::text, ',' ORDER BY r.media_receipts_id))
        FROM settlements_rels r WHERE r.parent_id = sid AND r.path = 'photos' AND r.media_receipts_id IS NOT NULL
    $fn$;

    CREATE OR REPLACE FUNCTION pk_settlements_photos_freeze() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.status = 'submitted' AND OLD.status IN ('draft', 'revision') THEN
        NEW.photos_hash := pk_settlement_photos_hash(NEW.id);
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER settlements_photos_freeze BEFORE UPDATE ON settlements FOR EACH ROW EXECUTE FUNCTION pk_settlements_photos_freeze();

    CREATE OR REPLACE FUNCTION pk_settlements_photos_check() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      sid integer;
      s record;
      n integer;
    BEGIN
      IF TG_TABLE_NAME = 'settlements' THEN
        sid := NEW.id;
      ELSE
        sid := CASE WHEN TG_OP = 'DELETE' THEN OLD.parent_id ELSE NEW.parent_id END;
      END IF;
      SELECT status::text AS status, photos_hash INTO s FROM settlements WHERE id = sid;
      IF NOT FOUND THEN RETURN NULL; END IF;
      SELECT count(*) INTO n FROM settlements_rels WHERE parent_id = sid AND path = 'photos';
      IF n > 10 THEN
        RAISE EXCEPTION 'settlements %: at most 10 LPJ photos', sid USING ERRCODE = '23514';
      END IF;
      IF s.status NOT IN ('draft', 'revision') AND s.photos_hash IS DISTINCT FROM pk_settlement_photos_hash(sid) THEN
        RAISE EXCEPTION 'settlements %: LPJ photos are locked in status %', sid, s.status USING ERRCODE = '42501';
      END IF;
      RETURN NULL;
    END
    $fn$;
    CREATE CONSTRAINT TRIGGER settlements_photos_frozen AFTER UPDATE ON settlements
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pk_settlements_photos_check();
    CREATE CONSTRAINT TRIGGER settlements_rels_photos_frozen AFTER INSERT OR UPDATE OR DELETE ON settlements_rels
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pk_settlements_photos_check();`)

  payload?.logger?.info?.({
    msg: `${NAME}: D3 line guard + LPJ photo freeze`,
    editableLinesUnitPriceSet: fixed.rows.filter((r) => r.unit_price !== null).length,
    editableLinesLegacyNoUnitPrice: fixed.rows.filter((r) => r.unit_price === null).map((r) => r.id),
  })
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS settlements_rels_photos_frozen ON settlements_rels;
    DROP TRIGGER IF EXISTS settlements_photos_frozen ON settlements;
    DROP TRIGGER IF EXISTS settlements_photos_freeze ON settlements;
    DROP FUNCTION IF EXISTS pk_settlements_photos_check();
    DROP FUNCTION IF EXISTS pk_settlements_photos_freeze();
    DROP FUNCTION IF EXISTS pk_settlement_photos_hash(integer);
    ALTER TABLE expense_requests_lines DROP CONSTRAINT IF EXISTS expense_requests_lines_receipt_amount;
    DO $pk$
    DECLARE
      app_role text := regexp_replace(current_user, '_owner$', '_app');
    BEGIN
      EXECUTE format('REVOKE DELETE ON settlements_rels FROM %I', app_role);
    END
    $pk$;`)
  // F2a bodies (the schema migration's down drops receipt_amount next) + the 0.6.2 settlements guard
  await db.execute(sql.raw(`${CONTENT_HASH_OLD}\n${frozenCheck(false)}`))
  await db.execute(sql.raw(SETTLEMENTS_GUARD_OLD))
}
