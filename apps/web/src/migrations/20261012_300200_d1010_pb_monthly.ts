import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 10/10 extra (owner decision 2026-10-11): PB (expense_request) numbers reset MONTHLY from 1 per PT,
 * `PB/<shortCode>/<YYMM>/0001` (e.g. PB/DRMS/2611/0001, PB/LAS/2611/0001). DATA ONLY, hand-written,
 * idempotent, run as <prefix>_owner.
 *
 * 1. Every PT's `expense_request` sequence that still has the D5 default pattern `PB/{COMPANY}/{YY}{MM}/{seq}`
 *    moves to reset `monthly`, start 1 (audited: one `update` row per sequence, field `resetPolicy`, source
 *    system). A pattern an Admin customised is left alone and listed in the migrate log (`customisedKept`).
 * 2. Collision guard: counters are keyed (company, doc type, period key); the old `never` counter used
 *    period key `ALL`, the monthly one uses `YYYY-MM`, so the first monthly PB of a month would be 0001 even
 *    when that month already has issued numbers of the same shape from the `never` series (e.g.
 *    PB/DRMS/2610/0238 → the monthly counter would reach 0238 again). For every moved PT and every month that
 *    already has issued PB numbers of the new shape, the month's counter is created (or raised) to
 *    max(issued seq) + 1 — so the current month continues after its highest number and later months start
 *    at 0001. Issued numbers are never changed. Count → migrate log.
 * Down: the sequences this migration moved (by their audit rows) go back to `never` + start 229; the
 * month counters stay (they are only used by a monthly sequence; counters never move backwards).
 */
const NAME = '20261012_300200_d1010_pb_monthly'
const PATTERN = 'PB/{COMPANY}/{YY}{MM}/{seq}'
const REASON = `Keputusan owner DRMS 10/10 (2026-10-11): nomor PB direset bulanan mulai 1 per PT (migrasi ${NAME}; hanya pola default)`

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)

  const moved = (await db.execute(sql`
    WITH old AS (
      SELECT s.id, s.company_id, s.reset_policy::text AS reset_policy, s.start_at
        FROM document_sequences s
       WHERE s.doc_type::text = 'expense_request' AND s.pattern = ${PATTERN}
         AND (s.reset_policy::text <> 'monthly' OR s.start_at IS DISTINCT FROM 1)
    ), moved AS (
      UPDATE document_sequences s SET reset_policy = 'monthly', start_at = 1, updated_at = now()
        FROM old WHERE old.id = s.id
      RETURNING s.id, s.company_id
    ), logged AS (
      INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, old_value, new_value, reason, source, company_id)
      SELECT gen_random_uuid()::text, txid_current(), 'document_sequence', o.id::text, 'update', 'resetPolicy',
             jsonb_build_object('resetPolicy', o.reset_policy, 'startAt', o.start_at),
             jsonb_build_object('resetPolicy', 'monthly', 'startAt', 1),
             ${REASON}, 'system', o.company_id
        FROM old o
      RETURNING 1
    )
    SELECT m.id, m.company_id FROM moved m, (SELECT count(*) FROM logged) l`)) as unknown as { rows: Array<{ id: number; company_id: number }> }

  // collision guard: month counters after the highest issued PB/<code>/<YYMM>/<seq> of each moved PT
  const seeded = (await db.execute(sql`
    WITH issued AS (
      SELECT e.company_id,
             '20' || substring(e.doc_no FROM '^PB/[^/]+/([0-9]{2})[0-9]{2}/[0-9]+$') || '-' || substring(e.doc_no FROM '^PB/[^/]+/[0-9]{2}([0-9]{2})/[0-9]+$') AS period_key,
             max(substring(e.doc_no FROM '/([0-9]+)$')::int) AS max_seq
        FROM expense_requests e
       WHERE e.doc_no ~ '^PB/[^/]+/[0-9]{4}/[0-9]+$'
         AND e.company_id IN (SELECT s.company_id FROM document_sequences s
                               WHERE s.doc_type::text = 'expense_request' AND s.pattern = ${PATTERN} AND s.reset_policy::text = 'monthly')
       GROUP BY 1, 2
    )
    INSERT INTO document_sequence_counters (company_id, doc_type, period_key, next_value)
    SELECT company_id, 'expense_request', period_key, max_seq + 1 FROM issued
    ON CONFLICT (company_id, doc_type, period_key)
      DO UPDATE SET next_value = GREATEST(document_sequence_counters.next_value, EXCLUDED.next_value)
    RETURNING company_id, period_key, next_value`)) as unknown as { rows: Array<{ company_id: number; period_key: string; next_value: number }> }

  const kept = (await db.execute(sql`
    SELECT s.id, s.company_id, s.pattern, s.reset_policy::text AS reset_policy FROM document_sequences s
     WHERE s.doc_type::text = 'expense_request' AND s.pattern <> ${PATTERN} ORDER BY s.company_id`)) as unknown as {
    rows: Array<{ id: number; company_id: number; pattern: string; reset_policy: string }>
  }

  payload?.logger?.info?.({
    msg: `${NAME}: PB monthly reset`,
    movedSequences: moved.rows.map((r) => `${r.company_id}#${r.id}`),
    monthCountersSeeded: seeded.rows.map((r) => `${r.company_id}:${r.period_key}→${r.next_value}`),
    // Admin-customised PB patterns: unchanged — review them in Sistem › Penomoran dokumen
    customisedKept: kept.rows.map((r) => `${r.company_id}#${r.id} ${r.pattern} (${r.reset_policy})`),
  })
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    UPDATE document_sequences s SET reset_policy = 'never', start_at = 229, updated_at = now()
     WHERE s.doc_type::text = 'expense_request' AND s.pattern = ${PATTERN} AND s.reset_policy::text = 'monthly'
       AND EXISTS (SELECT 1 FROM audit_logs a WHERE a.doc_type = 'document_sequence' AND a.doc_id = s.id::text AND a.field = 'resetPolicy' AND a.reason = ${REASON})`)
}
