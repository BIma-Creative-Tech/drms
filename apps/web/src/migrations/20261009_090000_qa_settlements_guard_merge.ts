import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Release 0.6.2 merge of two QA report 2026-10-08 branches that both replace `pk_settlements_guard`
 * (hand-written, run as <prefix>_owner, no schema change):
 * - `20261008_090000_qa_finance_integrity` (QA-06 / ADR 0019): E9 body + the shortfall re-approval block
 *   (`shortfall_approval_*` change only while the LPJ stays verified, status graph none|rejected → pending_* →
 *   approved|rejected, amount/rule/note fixed per cycle, rejection needs a reason, new LPJ rows carry none of it);
 * - `20261008_120000_qa_flow_lpj_totals` (QA-09): E9 body + the provisional totals rule (an OPEN LPJ —
 *   draft/submitted/revision, status unchanged — may change only `receipts_total` + `difference`, and only to
 *   Σ active receipts / transferred − receipts).
 * The later one (120000) ran CREATE OR REPLACE with the E9 body + its rule and so dropped the 090000 shortfall
 * rules. This migration installs the UNION: the 090000 body plus the 120000 rule, nothing else changed.
 * Down restores the 120000 body verbatim (the state right before this migration).
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
    $fn$;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
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
           OR NEW.last_reversal_reason IS NOT NULL THEN
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
    $fn$;
  `)
}
