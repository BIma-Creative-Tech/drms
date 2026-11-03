import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

import { withPrelude } from './20261013_610000_d1310_renumber'

/**
 * D0311 (user 2026-11-03) "Ganti bukti transfer" — DB guard, hand-written, run as <prefix>_owner. Defence in depth
 * behind domain/expense/transfers.ts replaceTransferProof:
 *
 * `pk_transfers_guard` (REPLACED, renumber prelude kept; previous body = 20260928_000100_mc1_security restored by
 * down): an UPDATE that changes `proof_id` is allowed ONLY when
 * - it changes nothing else (`updated_at` aside),
 * - the transfer is and stays `posted`,
 * - its request is `completed` ("Selesai"; while "Sudah Ditransfer" a wrong transfer is voided and recorded again),
 * - the new proof is a media-transfer-proofs row already linked to that request (claimMedia).
 * No period lock check: the proof is an attachment — amount, dates, accounts and the KK stay as recorded. Every other
 * update keeps the former rules (posted transfers immutable, void only).
 */

const GUARD_HEAD = `
    CREATE OR REPLACE FUNCTION pk_transfers_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      r record;
      s record;
      lock_d date := pk_cash_lock_date(NEW.company_id);
      wl text[] := ARRAY['status', 'void_reason', 'voided_by_id', 'voided_at', 'cash_entry_id', 'updated_at'];
    BEGIN`

const PROOF_RULE = `
      IF TG_OP = 'UPDATE' AND NEW.proof_id IS DISTINCT FROM OLD.proof_id THEN
        IF NEW.proof_id IS NULL OR OLD.status <> 'posted' OR NEW.status <> 'posted'
           OR (to_jsonb(OLD) - ARRAY['proof_id', 'updated_at']) IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['proof_id', 'updated_at'])
           OR NOT EXISTS (SELECT 1 FROM expense_requests er WHERE er.id = NEW.request_id AND er.status = 'completed') THEN
          RAISE EXCEPTION 'transfers %: only the proof of a posted transfer of a completed request may be replaced, alone', OLD.id USING ERRCODE = '42501';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM media_transfer_proofs m
                        WHERE m.id = NEW.proof_id AND m.owner_doc_type = 'expense_request' AND m.owner_doc_id = NEW.request_id::text) THEN
          RAISE EXCEPTION 'transfers %: the new proof must belong to request %', OLD.id, NEW.request_id USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;`

const GUARD_TAIL = `
      IF TG_OP = 'INSERT' THEN
        IF lock_d IS NOT NULL AND NEW.transfer_date::date <= lock_d THEN
          RAISE EXCEPTION 'transfers: period of % is closed (lock date %)', NEW.transfer_date, lock_d USING ERRCODE = '42501';
        END IF;
        SELECT type::text AS type, status::text AS status, approved_amount INTO r FROM expense_requests WHERE id = NEW.request_id;
        IF NEW.kind IN ('advance', 'reimburse') THEN
          IF r.approved_amount IS NULL OR NEW.amount <> r.approved_amount THEN
            RAISE EXCEPTION 'transfers: amount must equal the approved amount (G3)' USING ERRCODE = '42501';
          END IF;
          IF NOT ((r.type = 'advance' AND r.status = 'approved') OR (r.type = 'reimburse' AND r.status = 'receipts_verified')) THEN
            RAISE EXCEPTION 'transfers: request % is not in the transfer queue (%)', NEW.request_id, r.status USING ERRCODE = '42501';
          END IF;
        ELSIF NEW.kind = 'lpj_shortfall' THEN
          SELECT status::text AS status, settlement_type::text AS settlement_type, difference INTO s FROM settlements WHERE request_id = NEW.request_id;
          IF r.type IS DISTINCT FROM 'advance' OR r.status IS DISTINCT FROM 'lpj_verified' OR s.status IS DISTINCT FROM 'verified'
             OR s.settlement_type IS DISTINCT FROM 'shortfall' OR NEW.amount <> -s.difference THEN
            RAISE EXCEPTION 'transfers: shortfall transfer must equal the verified LPJ shortfall (G3)' USING ERRCODE = '42501';
          END IF;
          IF EXISTS (SELECT 1 FROM transfers t WHERE t.request_id = NEW.request_id AND t.kind = 'lpj_shortfall' AND t.status = 'posted') THEN
            RAISE EXCEPTION 'transfers: request % already has a shortfall transfer', NEW.request_id USING ERRCODE = '42501';
          END IF;
        END IF;
        IF NEW.status <> 'posted' OR NEW.void_reason IS NOT NULL THEN
          RAISE EXCEPTION 'transfers: new transfers are posted' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END IF;
      IF (to_jsonb(OLD) - wl) IS DISTINCT FROM (to_jsonb(NEW) - wl)
         OR (OLD.cash_entry_id IS NOT NULL AND NEW.cash_entry_id IS DISTINCT FROM OLD.cash_entry_id)
         OR (OLD.status = 'void' AND (to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at'))
         OR (NEW.status = 'void' AND NEW.void_reason IS NULL)
         OR (NEW.status = 'posted' AND (NEW.void_reason IS NOT NULL OR NEW.voided_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'transfers %: posted transfers are immutable (void only)', OLD.id USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;`

/** pk_transfers_guard as of 20260928_000100_mc1_security (restored by down; the prelude is added by withPrelude). */
export const TRANSFERS_GUARD_PREV = `${GUARD_HEAD}${GUARD_TAIL}`

/** pk_transfers_guard with the D0311 proof rule first (after the renumber prelude). */
export const TRANSFERS_GUARD_NEW = `${GUARD_HEAD}${PROOF_RULE}${GUARD_TAIL}`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)
  await db.execute(sql.raw(withPrelude(TRANSFERS_GUARD_NEW)))
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql.raw(withPrelude(TRANSFERS_GUARD_PREV)))
}
