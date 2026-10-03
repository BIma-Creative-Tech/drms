import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * UAT defect MC4-04 (case AUD-02, staging 2026-10-02), hand-written, run as <prefix>_owner: PT tag for HISTORIC
 * audit rows. QA-MC4-03 (`74ba23b`) made the writer tag rows of per-PT documents, but rows written before that
 * (and before MC1 added `audit_logs.company_id`) stayed NULL — 8 428 of 8 524 `expense_request` rows on staging.
 * Untagged rows are readable only by group admins and by the Admin / Direktur of EVERY PT
 * (`mayReadUntaggedAudit`), so once a second PT exists the Direktur / Admin of DRMS without a role in the other PT
 * lost the audit trail and "Riwayat" of older DRMS documents. Scope rule (owner, 2026-10-02): read scope = mapped
 * PTs → a historic row must carry the PT of its document.
 *
 * What it does (set-based, batches of BATCH ids per doc type, one transaction — Payload runs every migration in
 * its own transaction):
 * 1. `company_id IS NULL` rows whose `doc_type` is in BY_ID (frozen copy of `PER_PT_DOC_TYPES` in
 *    `src/audit/writer.ts`, the map the writer derives the PT from today; a unit test keeps them equal) and whose
 *    numeric `doc_id` still exists → the document's PT (`company_id`; `companies.id` for `company`; media:
 *    `owner_company_id`).
 * 2. Rows WITHOUT `doc_id` but with `doc_no` (historic `number_issued` rows of transfers, progress reports and
 *    cash entries, written before the allocator passed the PT) → the PT of the ONE document with that number
 *    (BY_DOC_NO); a number held in two PTs is ambiguous and stays NULL.
 * 3. Never touched: rows that already carry a PT; rows marked untagged ON PURPOSE (QA-MC4-06 cross-PT duplicate
 *    flags: `newValue.relatedCompanyId`); rows whose document is gone or whose id is not numeric; app-wide doc
 *    types (user, device, web_session, users, company_settings, report, import, audit_log, bank, uom, …).
 *
 * Append-only (ADR 0006 §2): `audit_logs_no_update` (BEFORE UPDATE OR DELETE → `pk_reject_mutation`) rejects
 * every UPDATE, for the owner too, and there is no session setting it honours. As ADR 0006 §6 prescribes for a
 * migration that must rewrite Class A rows (and as MC1 `*_mc1_company_columns` did for the per-PT tables),
 * this migration — as the table OWNER, inside its own transaction — disables exactly that one trigger, runs the
 * UPDATEs and re-enables it; a failure rolls the DDL back with the data (DDL is transactional), so the trigger
 * can never stay disabled. `audit_logs_company_protect` (`company_id` immutable once set) stays ENABLED and
 * guards that only NULL tags are filled. DELETE / TRUNCATE stay rejected throughout; the app role has no UPDATE
 * grant anyway. ALTER TABLE takes a SHARE ROW EXCLUSIVE lock: concurrent audit INSERTs wait for the few seconds
 * of this transaction (staging ~10 k rows; measured in docs/proyekkas/qa/mc4-qa-report.md §11.2). When nothing
 * is left to tag the trigger is not touched at all (a re-run takes no lock). The change is itself recorded as
 * one `schema_maintenance` audit row (ADR 0006 §6) with the counts per doc type.
 *
 * Hash chain / anchor (ADR 0006 §5): there is no `row_hash` / `prev_hash` (hash chain deferred, E9 2026-09-26);
 * the daily anchor (`auditDailyAnchor`) logs only the row count and max id — `company_id` is not part of any
 * digest, and no row is added or removed (except the one `schema_maintenance` row), so earlier anchors stay valid.
 *
 * Idempotent: only `company_id IS NULL` rows are candidates and a tagged row is never a candidate again.
 * Down: deliberate no-op — re-NULLing the tags would recreate the defect (and break the append-only rule).
 */
export const BY_ID: Readonly<Record<string, readonly [table: string, column: string]>> = {
  expense_request: ['expense_requests', 'company_id'],
  budget_addendum: ['budget_addenda', 'company_id'],
  progress_report: ['progress_reports', 'company_id'],
  settlement: ['settlements', 'company_id'],
  transfer: ['transfers', 'company_id'],
  receipt: ['receipts', 'company_id'],
  attendance: ['attendances', 'company_id'],
  attendance_correction: ['attendance_corrections', 'company_id'],
  cash_entry: ['cash_entries', 'company_id'],
  period_closing: ['period_closings', 'company_id'],
  project: ['projects', 'company_id'],
  project_stage: ['project_stages', 'company_id'],
  team_assignment: ['team_assignments', 'company_id'],
  employee: ['employees', 'company_id'],
  employee_bank_account: ['employee_bank_accounts', 'company_id'],
  budget_line: ['budget_lines', 'company_id'],
  client: ['clients', 'company_id'],
  vendor: ['vendors', 'company_id'],
  stage_template: ['stage_templates', 'company_id'],
  expense_category: ['expense_categories', 'company_id'],
  cash_in_source: ['cash_in_sources', 'company_id'],
  cash_account: ['cash_accounts', 'company_id'],
  work_schedule: ['work_schedules', 'company_id'],
  approval_rule: ['approval_rules', 'company_id'],
  vehicle: ['vehicles', 'company_id'],
  cost_center: ['cost_centers', 'company_id'],
  document_sequence: ['document_sequences', 'company_id'],
  company_membership: ['company_memberships', 'company_id'],
  company: ['companies', 'id'],
  media_receipts: ['media_receipts', 'owner_company_id'],
  media_transfer_proofs: ['media_transfer_proofs', 'owner_company_id'],
  media_selfies: ['media_selfies', 'owner_company_id'],
  media_progress_photos: ['media_progress_photos', 'owner_company_id'],
  media_attachments: ['media_attachments', 'owner_company_id'],
}

/** Rows without `doc_id`: doc type → [table, number column] (numbers are unique per PT, ADR 0007 / MC1). */
export const BY_DOC_NO: Readonly<Record<string, readonly [table: string, column: string]>> = {
  expense_request: ['expense_requests', 'doc_no'],
  budget_addendum: ['budget_addenda', 'doc_no'],
  progress_report: ['progress_reports', 'doc_no'],
  settlement: ['settlements', 'doc_no'],
  transfer: ['transfers', 'doc_no'],
  cash_in: ['cash_entries', 'entry_no'],
  cash_out: ['cash_entries', 'entry_no'],
}

const BATCH = 5000
const NAME = '20261003_090000_mc4_audit_company_backfill'
const REASON = 'UAT MC4-04 (AUD-02): PT tag for historic audit rows of per-PT documents (ADR 0016 scope rule, ADR 0006 §6)'

/** Identifiers / doc types are the constants above (checked against a strict pattern), never user input. */
const ident = (s: string) => {
  if (!/^[a-z_]{2,40}$/.test(s)) throw new Error(`mc4 audit backfill: bad identifier ${s}`)
  return s
}
const arrayLit = (rows: ReadonlyArray<readonly string[]>) => `ARRAY[${rows.map((r) => `ARRAY[${r.map((x) => `'${ident(x)}'`).join(', ')}]`).join(', ')}]`
const DOC_TYPES = [...new Set([...Object.keys(BY_ID), ...Object.keys(BY_DOC_NO)])]
/** Never tagged: QA-MC4-06 rows written untagged on purpose (cross-PT duplicate flag names another PT). */
const NOT_ON_PURPOSE = `(a.new_value -> 'v' -> 'relatedCompanyId') IS NULL`

type Counts = Record<string, number>
async function nullCounts(db: MigrateUpArgs['db']): Promise<Counts> {
  const r = (await db.execute(sql`SELECT doc_type, count(*)::int AS n FROM audit_logs WHERE company_id IS NULL GROUP BY doc_type`)) as unknown as {
    rows: Array<{ doc_type: string; n: number }>
  }
  return Object.fromEntries(r.rows.map((x) => [x.doc_type, Number(x.n)]))
}

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  const t0 = Date.now()
  const before = await nullCounts(db)
  const byId = arrayLit(Object.entries(BY_ID).map(([d, [t, c]]) => [d, t, c]))
  const byNo = arrayLit(Object.entries(BY_DOC_NO).map(([d, [t, c]]) => [d, t, c]))
  const types = DOC_TYPES.map((d) => `'${ident(d)}'`).join(', ')
  await db.execute(
    sql.raw(`
    DO $pk$
    DECLARE
      m text[];
      lo integer;
      hi integer;
      b integer;
      n bigint;
      total bigint := 0;
      tagged jsonb := '{}'::jsonb;
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
      SELECT min(a.id), max(a.id) INTO lo, hi FROM audit_logs a
       WHERE a.company_id IS NULL AND a.doc_type = ANY (ARRAY[${types}]) AND ${NOT_ON_PURPOSE};
      IF lo IS NULL THEN
        RETURN; -- nothing left to tag: the append-only trigger is not touched (idempotent re-run, no lock)
      END IF;

      -- ADR 0006 §6: controlled rewrite of Class A rows by the owner, inside this transaction only
      ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update;

      FOREACH m SLICE 1 IN ARRAY ${byId} LOOP
        b := lo;
        WHILE b <= hi LOOP
          EXECUTE format(
            'UPDATE audit_logs a SET company_id = d.%1$I FROM %2$I d
              WHERE a.company_id IS NULL AND a.doc_type = $1 AND a.id >= $2 AND a.id < $2 + $3
                AND d.id = (CASE WHEN a.doc_id ~ ''^[0-9]{1,9}$'' THEN a.doc_id::integer END)
                AND d.%1$I IS NOT NULL AND ${NOT_ON_PURPOSE.replace(/'/g, "''")}', m[3], m[2])
            USING m[1], b, ${BATCH};
          GET DIAGNOSTICS n = ROW_COUNT;
          IF n > 0 THEN
            tagged := jsonb_set(tagged, ARRAY[m[1]], to_jsonb(coalesce((tagged ->> m[1])::bigint, 0) + n));
            total := total + n;
          END IF;
          b := b + ${BATCH};
        END LOOP;
      END LOOP;

      FOREACH m SLICE 1 IN ARRAY ${byNo} LOOP
        b := lo;
        WHILE b <= hi LOOP
          EXECUTE format(
            'UPDATE audit_logs a SET company_id = d.company_id
               FROM (SELECT %1$I AS no, min(company_id) AS company_id FROM %2$I
                      WHERE %1$I IS NOT NULL GROUP BY %1$I HAVING count(DISTINCT company_id) = 1) d
              WHERE a.company_id IS NULL AND a.doc_type = $1 AND a.id >= $2 AND a.id < $2 + $3
                AND a.doc_id IS NULL AND a.doc_no = d.no AND ${NOT_ON_PURPOSE.replace(/'/g, "''")}', m[3], m[2])
            USING m[1], b, ${BATCH};
          GET DIAGNOSTICS n = ROW_COUNT;
          IF n > 0 THEN
            tagged := jsonb_set(tagged, ARRAY[m[1]], to_jsonb(coalesce((tagged ->> m[1])::bigint, 0) + n));
            total := total + n;
          END IF;
          b := b + ${BATCH};
        END LOOP;
      END LOOP;

      ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update;

      IF total > 0 THEN
        INSERT INTO audit_logs (event_id, tx_id, doc_type, action, field, new_value, reason, source)
        VALUES (gen_random_uuid()::text, txid_current(), 'audit_log', 'schema_maintenance', 'company',
                jsonb_build_object('v', jsonb_build_object('migration', '${NAME}', 'tagged', tagged, 'total', total)),
                '${REASON.replace(/'/g, "''")}', 'system');
      END IF;
    END
    $pk$;`),
  )
  const after = await nullCounts(db)
  const tagged: Counts = {}
  const leftNull: Counts = {}
  const appWide: Counts = {}
  for (const [docType, n] of Object.entries(before)) {
    const left = after[docType] ?? 0
    if (DOC_TYPES.includes(docType)) {
      if (n - left > 0) tagged[docType] = n - left
      if (left > 0) leftNull[docType] = left // document gone, id not numeric, ambiguous number, or untagged on purpose
    } else if (left > 0) appWide[docType] = left
  }
  const log = payload?.logger ?? console
  log.info({ msg: `${NAME}: audit rows tagged with their PT`, ms: Date.now() - t0, tagged, leftNullPerPtDocType: leftNull, leftNullAppWide: appWide })
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Deliberate no-op: setting the tags back to NULL would recreate defect MC4-04 (historic rows of a PT hidden from
  // that PT's Direktur / Admin) and would rewrite append-only rows a second time (ADR 0006). The tags are correct
  // without this migration's code, so nothing has to be undone for a rollback of the application.
  await db.execute(sql`SELECT 1`)
}
