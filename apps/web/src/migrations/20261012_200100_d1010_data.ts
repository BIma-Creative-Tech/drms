import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 10/10 Phase B (server), DATA ONLY, hand-written, idempotent, run as <prefix>_owner after
 * 20261012_200000_d1010_schema.
 *
 * 1. D5 numbering (owner decision 2026-10-11: every number carries the PT short code): a
 *    `document_sequences` row moves to `<DOC>/{COMPANY}/{YY}{MM}/{seq}` (4 digits) ONLY while it still
 *    has exactly the OLD DEFAULT pattern of its doc type (LEGACY below). A pattern an Admin changed is
 *    left alone and listed in the migrate log (`customisedKept`). Reset policy and start value are NOT
 *    touched (PB keeps `never` + its running counter: the next PB after 0237 is `PB/DRMS/2610/0238`).
 *    Counters are keyed (company, doc type, period) — the pattern is not part of the key — so a
 *    mid-month switch continues the same counter (`TRF/2610/0005` → `TRF/DRMS/2610/0006`); the new
 *    strings can never equal an issued old one (different shape), and issued numbers stay unchanged.
 *    Audited: one `update` row per moved sequence (field `pattern`, old → new, source `system`).
 * 2. Item 11: `expense_requests.approved_at` backfilled for every request that has an approved amount
 *    (= reached the final approval) from the LAST decision (`approved` / final `acknowledged`, G1-2) of
 *    its current approval cycle. The request guard only accepts `approved_at` on the final approval, so
 *    it is disabled for this one statement (owner role, same transaction). Count → migrate log.
 *    Old transfers keep `transfer_at` NULL ("jam tidak diketahui"): posted transfers are immutable.
 * Down: the patterns go back to the old defaults for rows this migration moved (by its audit rows);
 * `approved_at` is dropped with the column by the schema migration's down.
 */
const NAME = '20261012_200100_d1010_data'
const REASON = `D5 keputusan owner DRMS 10/10 (2026-10-11): semua nomor dokumen memuat kode PT (migrasi ${NAME}; pola lama = default yang belum pernah diubah)`

/** Old default → new default, frozen copy (src/domain/numbering.ts LEGACY_DEFAULT_PATTERNS / DEFAULT_SEQUENCES; unit-tested). */
export const NUMBERING_MOVES: ReadonlyArray<{ docType: string; oldPattern: string; oldPadding: number; newPattern: string; newPadding: number }> = [
  { docType: 'expense_request', oldPattern: '{seq}/PB-{COMPANY}/{DD}/{MM_ROMAN}/{YYYY}', oldPadding: 0, newPattern: 'PB/{COMPANY}/{YY}{MM}/{seq}', newPadding: 4 },
  { docType: 'transfer', oldPattern: 'TRF/{YY}{MM}/{seq}', oldPadding: 4, newPattern: 'TRF/{COMPANY}/{YY}{MM}/{seq}', newPadding: 4 },
  { docType: 'settlement', oldPattern: 'LPJ/{YY}{MM}/{seq}', oldPadding: 4, newPattern: 'LPJ/{COMPANY}/{YY}{MM}/{seq}', newPadding: 4 },
  { docType: 'cash_in', oldPattern: 'KM/{YY}{MM}/{seq}', oldPadding: 4, newPattern: 'KM/{COMPANY}/{YY}{MM}/{seq}', newPadding: 4 },
  { docType: 'cash_out', oldPattern: 'KK/{YY}{MM}/{seq}', oldPadding: 4, newPattern: 'KK/{COMPANY}/{YY}{MM}/{seq}', newPadding: 4 },
  { docType: 'progress_report', oldPattern: 'LP/{YY}{MM}/{seq}', oldPadding: 4, newPattern: 'LP/{COMPANY}/{YY}{MM}/{seq}', newPadding: 4 },
  { docType: 'budget_addendum', oldPattern: 'ADD/{YY}{MM}/{seq}', oldPadding: 4, newPattern: 'ADD/{COMPANY}/{YY}{MM}/{seq}', newPadding: 4 },
  { docType: 'service_report', oldPattern: 'SV/{YY}{MM}/{seq}', oldPadding: 4, newPattern: 'SV/{COMPANY}/{YY}{MM}/{seq}', newPadding: 4 },
  { docType: 'daily_report', oldPattern: 'LH/{YY}{MM}/{seq}', oldPadding: 4, newPattern: 'LH/{COMPANY}/{YY}{MM}/{seq}', newPadding: 4 },
]

type MoveRow = { id: number; company_id: number | null; doc_type: string }

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)

  // ---- 1. D5 numbering
  const moved: MoveRow[] = []
  for (const m of NUMBERING_MOVES) {
    const r = (await db.execute(sql`
      WITH moved AS (
        UPDATE document_sequences s
           SET pattern = ${m.newPattern}, padding = ${m.newPadding}, updated_at = now()
         WHERE s.doc_type::text = ${m.docType} AND s.pattern = ${m.oldPattern}
        RETURNING s.id, s.company_id, s.doc_type::text AS doc_type
      ), logged AS (
        INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, old_value, new_value, reason, source, company_id)
        SELECT gen_random_uuid()::text, txid_current(), 'document_sequence', x.id::text, 'update', 'pattern',
               jsonb_build_object('pattern', ${m.oldPattern}::text, 'padding', ${String(m.oldPadding)}::int),
               jsonb_build_object('pattern', ${m.newPattern}::text, 'padding', ${String(m.newPadding)}::int),
               ${REASON}, 'system', x.company_id
          FROM moved x
        RETURNING 1
      )
      SELECT m.id, m.company_id, m.doc_type FROM moved m, (SELECT count(*) FROM logged) l`)) as unknown as { rows: MoveRow[] }
    moved.push(...r.rows)
  }
  const kept = (await db.execute(sql`
    SELECT s.id, s.company_id, s.doc_type::text AS doc_type, s.pattern FROM document_sequences s
     WHERE s.pattern NOT LIKE '%{COMPANY}%' ORDER BY s.company_id, s.doc_type`)) as unknown as { rows: Array<MoveRow & { pattern: string }> }

  // ---- 2. approved_at backfill (guard bypassed for this statement only)
  await db.execute(sql`ALTER TABLE expense_requests DISABLE TRIGGER expense_requests_guard`)
  const back = (await db.execute(sql`
    WITH src AS (
      SELECT er.id,
             (SELECT max(coalesce(a.decided_at, a.created_at)) FROM approvals a
               WHERE a.request_id = er.id AND a.doc_type = 'expense_request' AND a.cycle = er.approval_cycle
                 AND a.decision IN ('approved', 'acknowledged')) AS at
        FROM expense_requests er
       WHERE er.approved_amount IS NOT NULL AND er.approved_at IS NULL
    )
    UPDATE expense_requests er SET approved_at = src.at FROM src WHERE src.id = er.id AND src.at IS NOT NULL
    RETURNING er.id`)) as unknown as { rows: Array<{ id: number }> }
  // the deferred constraint trigger (frozen-content check) must fire before the table can be altered again
  await db.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`)
  await db.execute(sql`ALTER TABLE expense_requests ENABLE TRIGGER expense_requests_guard`)

  payload?.logger?.info?.({
    msg: `${NAME}: D5 numbering + approved_at backfill`,
    movedSequences: moved.map((r) => `${r.company_id}:${r.doc_type}#${r.id}`),
    // patterns an Admin customised (no {COMPANY}): unchanged — review them in Sistem › Penomoran dokumen
    customisedKept: kept.rows.map((r) => `${r.company_id}:${r.doc_type}#${r.id} ${r.pattern}`),
    approvedAtBackfilled: back.rows.length,
  })
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  for (const m of NUMBERING_MOVES) {
    await db.execute(sql`
      UPDATE document_sequences s SET pattern = ${m.oldPattern}, padding = ${m.oldPadding}, updated_at = now()
       WHERE s.doc_type::text = ${m.docType} AND s.pattern = ${m.newPattern}
         AND EXISTS (SELECT 1 FROM audit_logs a WHERE a.doc_type = 'document_sequence' AND a.doc_id = s.id::text AND a.field = 'pattern' AND a.reason = ${REASON})`)
  }
}
