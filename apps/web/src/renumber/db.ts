/**
 * DRMS 13/10 Wave 4 — database side of the ONE-TIME renumbering (ADR 0007 "Amendment 2026-10-13"; plan: `./plan.ts`,
 * CLI: `./cli.ts`, runbook `docs/proyekkas/runbooks/penomoran-ulang.md`). Runs on a plain `pg` client as the
 * `<prefix>_owner` role, OUTSIDE Payload (no hooks, no Local API): every query names its tables literally and is
 * bound to the PTs in scope (`company_id = ANY($1)`).
 *
 * apply = ONE transaction:
 *   lock the document / counter / text tables (SHARE ROW EXCLUSIVE: reads go on, writes wait) → refuse when a PT in
 *   scope was already renumbered (`document_renumber_runs`, unique per PT) → load + plan (same code as the dry-run;
 *   optional `expectSha256` = exactly the reviewed mapping) → register the run (`status = running`, this txid) and
 *   `SET LOCAL pk.renumber = 'on'` — only both together open the DB guards (`pk_renumber_bypass`, migration
 *   20261013_610000), and only for the number / derived-text columns → sequences without `{COMPANY}` moved to the D5
 *   default (audited) → numbers in two phases (temporary `RENUM-TMP-<id>`, then final; a swap never collides) + one
 *   `renumbered` audit row per changed document (old → new, same txid) → derived text (cash entry descriptions,
 *   notification number/title/body, receipt-flag message/detail) → counters → deferred checks fired → duplicate check →
 *   run `applied` → COMMIT. Any error → ROLLBACK (nothing changed).
 */
import { randomUUID } from 'node:crypto'

import { DEFAULT_SEQUENCES } from '@/domain/numbering'
import { DEFAULT_TZ } from '@/lib/time'

import { DOC_TABLES, makeReplacer, planRenumber, textMaps, type CompanyInfo, type CounterRow, type DocRow, type DocTable, type RenumberPlan, type SequenceRow } from './plan'

/** The subset of `pg.Client` used here (a `pg.Client` / `pg.PoolClient` fits). */
export type Db = { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }> }

export type Scope = { all: true } | { codes: string[] }

export const RENUMBER_REASON = 'Penomoran ulang satu kali (DRMS 13/10 Umum #1, ADR 0007 amandemen 2026-10-13): nomor direset dari 1 per PT × jenis dokumen × bulan, urut tanggal dibuat'

const LOAD: Record<DocTable, string> = {
  expense_requests: `SELECT id, company_id, 'expense_request' AS doc_type, doc_no AS old_no, request_date AS business_date, NULL::timestamptz AS numbered_at, created_at
      FROM expense_requests WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[])`,
  transfers: `SELECT id, company_id, 'transfer' AS doc_type, doc_no AS old_no, transfer_date AS business_date, NULL::timestamptz AS numbered_at, created_at
      FROM transfers WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[])`,
  // LPJ: numbered "today" at the first submit → the number_issued audit row (else the submit time)
  settlements: `SELECT s.id, s.company_id, 'settlement' AS doc_type, s.doc_no AS old_no, NULL::text AS business_date,
           coalesce((SELECT min(a.server_time) FROM audit_logs a WHERE a.action = 'number_issued' AND a.doc_type = 'settlement' AND a.doc_id = s.id::text), s.submitted_at) AS numbered_at,
           s.created_at
      FROM settlements s WHERE s.doc_no IS NOT NULL AND s.company_id = ANY($1::int[])`,
  cash_entries: `SELECT id, company_id, CASE WHEN direction::text = 'in' THEN 'cash_in' ELSE 'cash_out' END AS doc_type, entry_no AS old_no,
           entry_date AS business_date, NULL::timestamptz AS numbered_at, created_at
      FROM cash_entries WHERE entry_no IS NOT NULL AND company_id = ANY($1::int[])`,
  progress_reports: `SELECT id, company_id, 'progress_report' AS doc_type, doc_no AS old_no, report_date AS business_date, NULL::timestamptz AS numbered_at, created_at
      FROM progress_reports WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[])`,
  // addendum: numbered "today" at submit, like the LPJ
  budget_addenda: `SELECT b.id, b.company_id, 'budget_addendum' AS doc_type, b.doc_no AS old_no, NULL::text AS business_date,
           coalesce((SELECT min(a.server_time) FROM audit_logs a WHERE a.action = 'number_issued' AND a.doc_type = 'budget_addendum' AND a.doc_id = b.id::text), b.submitted_at) AS numbered_at,
           b.created_at
      FROM budget_addenda b WHERE b.doc_no IS NOT NULL AND b.company_id = ANY($1::int[])`,
  service_reports: `SELECT id, company_id, 'service_report' AS doc_type, doc_no AS old_no, report_date AS business_date, NULL::timestamptz AS numbered_at, created_at
      FROM service_reports WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[])`,
  daily_reports: `SELECT id, company_id, 'daily_report' AS doc_type, doc_no AS old_no, report_date AS business_date, NULL::timestamptz AS numbered_at, created_at
      FROM daily_reports WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[])`,
  project_loans: `SELECT id, company_id, 'project_loan' AS doc_type, doc_no AS old_no, loan_date AS business_date, NULL::timestamptz AS numbered_at, created_at
      FROM project_loans WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[])`,
}

/** Phase 1 (temporary, unique per table) and phase 2 (final) number updates. `updated_at` moves → the APK re-syncs. */
const SET_TMP: Record<DocTable, string> = {
  expense_requests: `UPDATE expense_requests t SET doc_no = 'RENUM-TMP-' || t.id, updated_at = now() FROM unnest($1::int[]) AS v(id) WHERE t.id = v.id`,
  transfers: `UPDATE transfers t SET doc_no = 'RENUM-TMP-' || t.id, updated_at = now() FROM unnest($1::int[]) AS v(id) WHERE t.id = v.id`,
  settlements: `UPDATE settlements t SET doc_no = 'RENUM-TMP-' || t.id, updated_at = now() FROM unnest($1::int[]) AS v(id) WHERE t.id = v.id`,
  cash_entries: `UPDATE cash_entries t SET entry_no = 'RENUM-TMP-' || t.id, updated_at = now() FROM unnest($1::int[]) AS v(id) WHERE t.id = v.id`,
  progress_reports: `UPDATE progress_reports t SET doc_no = 'RENUM-TMP-' || t.id, updated_at = now() FROM unnest($1::int[]) AS v(id) WHERE t.id = v.id`,
  budget_addenda: `UPDATE budget_addenda t SET doc_no = 'RENUM-TMP-' || t.id, updated_at = now() FROM unnest($1::int[]) AS v(id) WHERE t.id = v.id`,
  service_reports: `UPDATE service_reports t SET doc_no = 'RENUM-TMP-' || t.id, updated_at = now() FROM unnest($1::int[]) AS v(id) WHERE t.id = v.id`,
  daily_reports: `UPDATE daily_reports t SET doc_no = 'RENUM-TMP-' || t.id, updated_at = now() FROM unnest($1::int[]) AS v(id) WHERE t.id = v.id`,
  project_loans: `UPDATE project_loans t SET doc_no = 'RENUM-TMP-' || t.id, updated_at = now() FROM unnest($1::int[]) AS v(id) WHERE t.id = v.id`,
}
const SET_FINAL: Record<DocTable, string> = {
  expense_requests: `UPDATE expense_requests t SET doc_no = v.no, updated_at = now() FROM unnest($1::int[], $2::text[]) AS v(id, no) WHERE t.id = v.id`,
  transfers: `UPDATE transfers t SET doc_no = v.no, updated_at = now() FROM unnest($1::int[], $2::text[]) AS v(id, no) WHERE t.id = v.id`,
  settlements: `UPDATE settlements t SET doc_no = v.no, updated_at = now() FROM unnest($1::int[], $2::text[]) AS v(id, no) WHERE t.id = v.id`,
  cash_entries: `UPDATE cash_entries t SET entry_no = v.no, updated_at = now() FROM unnest($1::int[], $2::text[]) AS v(id, no) WHERE t.id = v.id`,
  progress_reports: `UPDATE progress_reports t SET doc_no = v.no, updated_at = now() FROM unnest($1::int[], $2::text[]) AS v(id, no) WHERE t.id = v.id`,
  budget_addenda: `UPDATE budget_addenda t SET doc_no = v.no, updated_at = now() FROM unnest($1::int[], $2::text[]) AS v(id, no) WHERE t.id = v.id`,
  service_reports: `UPDATE service_reports t SET doc_no = v.no, updated_at = now() FROM unnest($1::int[], $2::text[]) AS v(id, no) WHERE t.id = v.id`,
  daily_reports: `UPDATE daily_reports t SET doc_no = v.no, updated_at = now() FROM unnest($1::int[], $2::text[]) AS v(id, no) WHERE t.id = v.id`,
  project_loans: `UPDATE project_loans t SET doc_no = v.no, updated_at = now() FROM unnest($1::int[], $2::text[]) AS v(id, no) WHERE t.id = v.id`,
}
/** Duplicate check per PT (same number twice in one PT and table; cash: KM/KK share the table, prefixes differ). */
const DUPLICATES: Record<DocTable, string> = {
  expense_requests: `SELECT company_id, doc_no AS no, count(*)::int AS n FROM expense_requests WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]) GROUP BY 1, 2 HAVING count(*) > 1`,
  transfers: `SELECT company_id, doc_no AS no, count(*)::int AS n FROM transfers WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]) GROUP BY 1, 2 HAVING count(*) > 1`,
  settlements: `SELECT company_id, doc_no AS no, count(*)::int AS n FROM settlements WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]) GROUP BY 1, 2 HAVING count(*) > 1`,
  cash_entries: `SELECT company_id, entry_no AS no, count(*)::int AS n FROM cash_entries WHERE entry_no IS NOT NULL AND company_id = ANY($1::int[]) GROUP BY 1, 2 HAVING count(*) > 1`,
  progress_reports: `SELECT company_id, doc_no AS no, count(*)::int AS n FROM progress_reports WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]) GROUP BY 1, 2 HAVING count(*) > 1`,
  budget_addenda: `SELECT company_id, doc_no AS no, count(*)::int AS n FROM budget_addenda WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]) GROUP BY 1, 2 HAVING count(*) > 1`,
  service_reports: `SELECT company_id, doc_no AS no, count(*)::int AS n FROM service_reports WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]) GROUP BY 1, 2 HAVING count(*) > 1`,
  daily_reports: `SELECT company_id, doc_no AS no, count(*)::int AS n FROM daily_reports WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]) GROUP BY 1, 2 HAVING count(*) > 1`,
  project_loans: `SELECT company_id, doc_no AS no, count(*)::int AS n FROM project_loans WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]) GROUP BY 1, 2 HAVING count(*) > 1`,
}
/** Verification probe: an ORDINARY number change (no run registered) must still be refused by the DB. */
const PROBE: Record<DocTable, string> = {
  expense_requests: `UPDATE expense_requests SET doc_no = doc_no || '-X' WHERE id = (SELECT min(id) FROM expense_requests WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]))`,
  transfers: `UPDATE transfers SET doc_no = doc_no || '-X' WHERE id = (SELECT min(id) FROM transfers WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]))`,
  settlements: `UPDATE settlements SET doc_no = doc_no || '-X' WHERE id = (SELECT min(id) FROM settlements WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]))`,
  cash_entries: `UPDATE cash_entries SET entry_no = entry_no || '-X' WHERE id = (SELECT min(id) FROM cash_entries WHERE entry_no IS NOT NULL AND company_id = ANY($1::int[]))`,
  progress_reports: `UPDATE progress_reports SET doc_no = doc_no || '-X' WHERE id = (SELECT min(id) FROM progress_reports WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]))`,
  budget_addenda: `UPDATE budget_addenda SET doc_no = doc_no || '-X' WHERE id = (SELECT min(id) FROM budget_addenda WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]))`,
  service_reports: `UPDATE service_reports SET doc_no = doc_no || '-X' WHERE id = (SELECT min(id) FROM service_reports WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]))`,
  daily_reports: `UPDATE daily_reports SET doc_no = doc_no || '-X' WHERE id = (SELECT min(id) FROM daily_reports WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]))`,
  project_loans: `UPDATE project_loans SET doc_no = doc_no || '-X' WHERE id = (SELECT min(id) FROM project_loans WHERE doc_no IS NOT NULL AND company_id = ANY($1::int[]))`,
}

/** Tables written by apply (locked for the whole transaction; reads continue). */
const LOCK_SQL = `LOCK TABLE document_sequences, document_sequence_counters, expense_requests, transfers, settlements, cash_entries,
  progress_reports, budget_addenda, service_reports, daily_reports, project_loans, notifications, receipt_flags, document_renumber_runs
  IN SHARE ROW EXCLUSIVE MODE`

/** Notification `doc_type` → document table (for a notification without PT: the PT of the document it is about). */
const NOTIFICATION_DOC_TABLE: Readonly<Record<string, DocTable>> = {
  expense_request: 'expense_requests',
  expense_shortfall: 'expense_requests',
  transfer: 'transfers',
  settlement: 'settlements',
  cash_entry: 'cash_entries',
  cash_in: 'cash_entries',
  cash_out: 'cash_entries',
  progress_report: 'progress_reports',
  budget_addendum: 'budget_addenda',
  service_report: 'service_reports',
  daily_report: 'daily_reports',
  project_loan: 'project_loans',
}

const num = (v: unknown) => Number(v)
const str = (v: unknown) => (v === null || v === undefined ? null : String(v))
const iso = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString())

/** Company ids in scope (all PTs, or the given short codes — unknown codes are an error). */
export async function resolveScope(db: Db, scope: Scope): Promise<CompanyInfo[]> {
  const r = await db.query('SELECT id, short_code, timezone FROM companies ORDER BY id')
  const all: CompanyInfo[] = r.rows.map((x) => ({ id: num(x.id), shortCode: str(x.short_code), timezone: str(x.timezone) }))
  if ('all' in scope) return all
  const want = [...new Set(scope.codes.map((c) => c.trim().toUpperCase()).filter(Boolean))]
  const unknown = want.filter((c) => !all.some((x) => x.shortCode === c))
  if (unknown.length > 0) throw new Error(`kode PT tidak dikenal: ${unknown.join(', ')}`)
  return all.filter((x) => x.shortCode !== null && want.includes(x.shortCode))
}

export type RenumberInput = { companies: CompanyInfo[]; sequences: SequenceRow[]; docs: DocRow[]; counters: CounterRow[] }

export async function loadInput(db: Db, companies: CompanyInfo[]): Promise<RenumberInput> {
  const ids = companies.map((c) => c.id)
  const docs: DocRow[] = []
  for (const t of DOC_TABLES) {
    const r = await db.query(LOAD[t.table], [ids])
    for (const x of r.rows) {
      docs.push({ table: t.table, id: num(x.id), companyId: num(x.company_id), docType: String(x.doc_type), oldNo: String(x.old_no), businessDate: str(x.business_date), numberedAt: iso(x.numbered_at), createdAt: iso(x.created_at)! })
    }
  }
  const s = await db.query(
    `SELECT id, company_id, doc_type::text AS doc_type, doc_code, pattern, padding, reset_policy::text AS reset_policy, start_at, timezone, active
       FROM document_sequences WHERE company_id = ANY($1::int[]) ORDER BY company_id, doc_type, id`,
    [ids],
  )
  const sequences: SequenceRow[] = s.rows.map((x) => ({
    id: num(x.id),
    companyId: num(x.company_id),
    docType: String(x.doc_type),
    docCode: str(x.doc_code),
    pattern: String(x.pattern),
    padding: num(x.padding ?? 0),
    resetPolicy: String(x.reset_policy) as SequenceRow['resetPolicy'],
    startAt: num(x.start_at ?? 1),
    timezone: str(x.timezone) || DEFAULT_TZ,
    active: x.active !== false,
  }))
  const c = await db.query('SELECT company_id, doc_type, period_key, next_value FROM document_sequence_counters WHERE company_id = ANY($1::int[]) ORDER BY 1, 2, 3', [ids])
  const counters: CounterRow[] = c.rows.map((x) => ({ companyId: num(x.company_id), docType: String(x.doc_type), periodKey: String(x.period_key), nextValue: num(x.next_value) }))
  return { companies, sequences, docs, counters }
}

export type TextChange = { table: 'cash_entries' | 'notifications' | 'receipt_flags'; id: number; companyId: number | null; column: string; old: string; new: string }

/** Derived text that contains changed numbers (computed for the dry-run report and written by apply). */
export async function derivedTextChanges(db: Db, plan: RenumberPlan, companies: CompanyInfo[]): Promise<TextChange[]> {
  const ids = companies.map((c) => c.id)
  const maps = textMaps(plan)
  const replacers = new Map([...maps].map(([cid, m]) => [cid, { map: m, replace: makeReplacer(m) }]))
  const out: TextChange[] = []
  if (replacers.size === 0) return out

  // cash entry descriptions ("Transfer TRF/… — PB/… judul", "Jurnal balik KK/…: alasan", "Pengembalian LPJ LPJ/… — PB/…")
  const ce = await db.query('SELECT id, company_id, description FROM cash_entries WHERE description IS NOT NULL AND company_id = ANY($1::int[]) ORDER BY id', [ids])
  for (const x of ce.rows) {
    const r = replacers.get(num(x.company_id))
    const old = String(x.description)
    const next = r ? r.replace(old) : old
    if (next !== old) out.push({ table: 'cash_entries', id: num(x.id), companyId: num(x.company_id), column: 'description', old, new: next })
  }

  // notifications: number + title + body; a row without PT takes the PT of the document it is about
  const docCompany = new Map(plan.items.map((i) => [`${i.table}:${i.id}`, i.companyId]))
  const nt = await db.query('SELECT id, company_id, doc_type, doc_id, doc_no, title, body FROM notifications WHERE company_id = ANY($1::int[]) OR company_id IS NULL ORDER BY id', [ids])
  for (const x of nt.rows) {
    let cid = x.company_id === null ? null : num(x.company_id)
    if (cid === null) {
      const table = NOTIFICATION_DOC_TABLE[String(x.doc_type ?? '')]
      const docId = str(x.doc_id)
      cid = table && docId && /^\d+$/.test(docId) ? (docCompany.get(`${table}:${docId}`) ?? null) : null
    }
    const r = cid === null ? undefined : replacers.get(cid)
    if (!r) continue
    const cols: Array<[string, string | null]> = [
      ['doc_no', str(x.doc_no)],
      ['title', str(x.title)],
      ['body', str(x.body)],
    ]
    for (const [col, old] of cols) {
      if (old === null) continue
      const next = col === 'doc_no' ? (r.map.get(old) ?? old) : r.replace(old)
      if (next !== old) out.push({ table: 'notifications', id: num(x.id), companyId: cid, column: col, old, new: next })
    }
  }

  // receipt flags about ANOTHER request ("Nota sudah dipakai di pengajuan PB/…"): that request's number only
  const reqNew = new Map(plan.items.filter((i) => i.table === 'expense_requests' && i.changed).map((i) => [i.id, i]))
  if (reqNew.size > 0) {
    const rf = await db.query('SELECT id, company_id, related_request_id, message, detail FROM receipt_flags WHERE related_request_id = ANY($1::int[]) ORDER BY id', [[...reqNew.keys()]])
    for (const x of rf.rows) {
      const it = reqNew.get(num(x.related_request_id))
      if (!it) continue
      const one = makeReplacer(new Map([[it.oldNo, it.newNo]]))
      const msg = str(x.message)
      if (msg !== null && one(msg) !== msg) out.push({ table: 'receipt_flags', id: num(x.id), companyId: num(x.company_id), column: 'message', old: msg, new: one(msg) })
      const detail = x.detail && typeof x.detail === 'object' ? (x.detail as Record<string, unknown>) : null
      if (detail && detail.otherDocNo === it.oldNo) {
        out.push({ table: 'receipt_flags', id: num(x.id), companyId: num(x.company_id), column: 'detail', old: JSON.stringify(detail), new: JSON.stringify({ ...detail, otherDocNo: it.newNo }) })
      }
    }
  }
  return out
}

export type DryRunResult = { companies: CompanyInfo[]; plan: RenumberPlan; text: TextChange[]; alreadyApplied: Array<{ companyId: number; finishedAt: string | null; txId: string }> }

async function appliedRuns(db: Db, ids: number[]) {
  const r = await db.query('SELECT company_id, tx_id::text AS tx_id, status, finished_at FROM document_renumber_runs WHERE company_id = ANY($1::int[]) ORDER BY company_id', [ids])
  return r.rows.map((x) => ({ companyId: num(x.company_id), txId: String(x.tx_id), status: String(x.status), finishedAt: iso(x.finished_at) }))
}

/** Dry-run: the full mapping, the derived-text changes and the counters — READ ONLY (one read-only transaction). */
export async function dryRun(db: Db, scope: Scope): Promise<DryRunResult> {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    const companies = await resolveScope(db, scope)
    const input = await loadInput(db, companies)
    const plan = planRenumber(input)
    const text = await derivedTextChanges(db, plan, companies)
    const alreadyApplied = (await appliedRuns(db, companies.map((c) => c.id))).map(({ companyId, finishedAt, txId }) => ({ companyId, finishedAt, txId }))
    return { companies, plan, text, alreadyApplied }
  } finally {
    await db.query('ROLLBACK')
  }
}

export class RenumberRefused extends Error {
  constructor(
    message: string,
    readonly code: 'already_applied' | 'plan_errors' | 'sha_mismatch' | 'not_owner',
  ) {
    super(message)
  }
}

export type ApplyResult = { companies: CompanyInfo[]; plan: RenumberPlan; text: TextChange[]; txId: string; runIds: number[] }

/**
 * Apply (ONE transaction, see the module comment). Refuses — and changes nothing — when the role is not the owner,
 * a PT in scope was already renumbered, the plan has errors, or `expectSha256` differs from the plan computed under
 * the lock (the data changed since the reviewed dry-run).
 */
export async function applyRenumber(db: Db, opts: { scope: Scope; operator: string; expectSha256?: string }): Promise<ApplyResult> {
  const who = await db.query('SELECT current_user::text AS u')
  if (!/_owner$/.test(String(who.rows[0]?.u ?? ''))) throw new RenumberRefused(`apply harus dijalankan dengan role pemilik "*_owner" (sekarang ${String(who.rows[0]?.u)})`, 'not_owner')
  await db.query('BEGIN')
  try {
    await db.query("SET LOCAL lock_timeout = '15s'")
    await db.query(LOCK_SQL)
    const companies = await resolveScope(db, opts.scope)
    const ids = companies.map((c) => c.id)
    const done = await appliedRuns(db, ids)
    if (done.length > 0) {
      throw new RenumberRefused(`penomoran ulang sudah pernah dijalankan untuk PT ${done.map((d) => companies.find((c) => c.id === d.companyId)?.shortCode ?? `#${d.companyId}`).join(', ')} (${done.map((d) => d.finishedAt ?? '?').join(', ')}) — satu kali saja (ADR 0007 amandemen 2026-10-13)`, 'already_applied')
    }
    const plan = planRenumber(await loadInput(db, companies))
    if (plan.errors.length > 0) throw new RenumberRefused(`rencana berisi ${plan.errors.length} error:\n  ${plan.errors.join('\n  ')}`, 'plan_errors')
    if (opts.expectSha256 && opts.expectSha256.toLowerCase() !== plan.sha256) {
      throw new RenumberRefused(`sha256 rencana berbeda dari dry-run yang direview (${opts.expectSha256} ≠ ${plan.sha256}) — data berubah; ulangi dry-run`, 'sha_mismatch')
    }
    const text = await derivedTextChanges(db, plan, companies)

    // ---- open the guards for THIS transaction only (run row + session flag; migration 20261013_610000)
    const tx = await db.query('SELECT txid_current()::text AS tx')
    const txId = String(tx.rows[0]!.tx)
    const runs = await db.query(
      `INSERT INTO document_renumber_runs (company_id, tx_id, status, operator, plan_sha256)
       SELECT c, txid_current(), 'running', $2, $3 FROM unnest($1::int[]) AS c RETURNING id`,
      [ids, opts.operator, plan.sha256],
    )
    await db.query("SET LOCAL pk.renumber = 'on'")
    const eventId = randomUUID()
    const reason = `${RENUMBER_REASON}; operator: ${opts.operator}`

    // ---- 1. sequences without {COMPANY} → D5 default (audited like the D5 data migration)
    for (const f of plan.patternFixes) {
      await db.query(
        `UPDATE document_sequences SET pattern = $2, padding = $3, reset_policy = $4::enum_document_sequences_reset_policy, start_at = $5, updated_at = now()
          WHERE id = $1 AND company_id = ANY($6::int[])`,
        [f.sequenceId, f.to.pattern, f.to.padding, f.to.resetPolicy, f.to.startAt, ids],
      )
      await db.query(
        `INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, old_value, new_value, reason, source, company_id)
         VALUES ($1, txid_current(), 'document_sequence', $2, 'update', 'pattern', $3::jsonb, $4::jsonb, $5, 'system', $6)`,
        [eventId, String(f.sequenceId), JSON.stringify(f.from), JSON.stringify(f.to), reason, f.companyId],
      )
    }

    // ---- 2. numbers: two phases per table + one `renumbered` audit row per changed document
    const changed = plan.items.filter((i) => i.changed)
    for (const t of DOC_TABLES) {
      const rows = changed.filter((i) => i.table === t.table)
      if (rows.length === 0) continue
      await db.query(SET_TMP[t.table], [rows.map((r) => r.id)])
      await db.query(SET_FINAL[t.table], [rows.map((r) => r.id), rows.map((r) => r.newNo)])
      await db.query(
        `INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, doc_no, action, field, old_value, new_value, reason, source, company_id)
         SELECT $1, txid_current(), $2, v.doc_id, v.new_no, 'renumbered', $3, jsonb_build_object('v', v.old_no), jsonb_build_object('v', v.new_no), $4, 'system', v.company_id
           FROM unnest($5::text[], $6::text[], $7::text[], $8::int[]) AS v(doc_id, old_no, new_no, company_id)`,
        [eventId, t.auditDocType, t.field, reason, rows.map((r) => String(r.id)), rows.map((r) => r.oldNo), rows.map((r) => r.newNo), rows.map((r) => r.companyId)],
      )
    }

    // ---- 3. derived text
    const ceDesc = text.filter((x) => x.table === 'cash_entries')
    if (ceDesc.length > 0) {
      await db.query('UPDATE cash_entries t SET description = v.d, updated_at = now() FROM unnest($1::int[], $2::text[]) AS v(id, d) WHERE t.id = v.id', [ceDesc.map((x) => x.id), ceDesc.map((x) => x.new)])
      await db.query(
        `INSERT INTO audit_logs (event_id, tx_id, doc_type, doc_id, action, field, old_value, new_value, reason, source, company_id)
         SELECT $1, txid_current(), 'cash_entry', v.doc_id, 'renumbered', 'description', jsonb_build_object('v', v.o), jsonb_build_object('v', v.n), $2, 'system', v.company_id
           FROM unnest($3::text[], $4::text[], $5::text[], $6::int[]) AS v(doc_id, o, n, company_id)`,
        [eventId, reason, ceDesc.map((x) => String(x.id)), ceDesc.map((x) => x.old), ceDesc.map((x) => x.new), ceDesc.map((x) => x.companyId)],
      )
    }
    const notif = new Map<number, Record<string, string>>()
    for (const x of text.filter((y) => y.table === 'notifications')) notif.set(x.id, { ...notif.get(x.id), [x.column]: x.new })
    if (notif.size > 0) {
      const nIds = [...notif.keys()]
      await db.query(
        `UPDATE notifications t SET doc_no = coalesce(v.doc_no, t.doc_no), title = coalesce(v.title, t.title), body = coalesce(v.body, t.body), updated_at = now()
           FROM unnest($1::int[], $2::text[], $3::text[], $4::text[]) AS v(id, doc_no, title, body) WHERE t.id = v.id`,
        [nIds, nIds.map((i) => notif.get(i)!.doc_no ?? null), nIds.map((i) => notif.get(i)!.title ?? null), nIds.map((i) => notif.get(i)!.body ?? null)],
      )
    }
    const flags = new Map<number, Record<string, string>>()
    for (const x of text.filter((y) => y.table === 'receipt_flags')) flags.set(x.id, { ...flags.get(x.id), [x.column]: x.new })
    if (flags.size > 0) {
      const fIds = [...flags.keys()]
      await db.query(
        `UPDATE receipt_flags t SET message = coalesce(v.message, t.message), detail = coalesce(v.detail::jsonb, t.detail), updated_at = now()
           FROM unnest($1::int[], $2::text[], $3::text[]) AS v(id, message, detail) WHERE t.id = v.id`,
        [fIds, fIds.map((i) => flags.get(i)!.message ?? null), fIds.map((i) => flags.get(i)!.detail ?? null)],
      )
    }

    // ---- 4. counters (may go DOWN: only inside the run, pk_counter_monotonic bypass)
    if (plan.counters.length > 0) {
      await db.query(
        `INSERT INTO document_sequence_counters (company_id, doc_type, period_key, next_value)
         SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::int[])
         ON CONFLICT (company_id, doc_type, period_key) DO UPDATE SET next_value = EXCLUDED.next_value`,
        [plan.counters.map((c) => c.companyId), plan.counters.map((c) => c.docType), plan.counters.map((c) => c.periodKey), plan.counters.map((c) => c.to)],
      )
    }

    // ---- 5. deferred checks now (while the run is open), then the duplicate check
    await db.query('SET CONSTRAINTS ALL IMMEDIATE')
    const dups: string[] = []
    for (const t of DOC_TABLES) {
      const r = await db.query(DUPLICATES[t.table], [ids])
      for (const x of r.rows) dups.push(`${t.table} PT #${String(x.company_id)} ${String(x.no)} ×${String(x.n)}`)
    }
    if (dups.length > 0) throw new Error(`nomor ganda setelah penomoran ulang: ${dups.join('; ')}`)

    const perCompany = (cid: number) => ({
      documents: plan.items.filter((i) => i.companyId === cid).length,
      changed: changed.filter((i) => i.companyId === cid).length,
      counters: plan.counters.filter((c) => c.companyId === cid),
      patternFixes: plan.patternFixes.filter((f) => f.companyId === cid),
      text: text.filter((x) => x.companyId === cid).length,
    })
    for (const c of companies) {
      const s = perCompany(c.id)
      await db.query(
        `UPDATE document_renumber_runs SET status = 'applied', finished_at = clock_timestamp(), documents = $2, changed = $3, summary = $4::jsonb
          WHERE company_id = $1 AND tx_id = txid_current()`,
        [c.id, s.documents, s.changed, JSON.stringify({ counters: s.counters, patternFixes: s.patternFixes, derivedText: s.text, eventId, planSha256: plan.sha256 })],
      )
    }
    await db.query('COMMIT')
    return { companies, plan, text, txId, runIds: runs.rows.map((r) => num(r.id)) }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw err
  }
}

export type Check = { name: string; ok: boolean; detail: string }

/**
 * Verification after apply (owner role). Read-only except for the PROBE: inside a transaction that is always rolled
 * back, an ordinary number change is attempted per table (expected: refused 42501), once plainly and once with the
 * session flag but without a registered run.
 */
export async function verifyRenumber(db: Db, scope: Scope): Promise<{ ok: boolean; checks: Check[] }> {
  const checks: Check[] = []
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })
  const companies = await resolveScope(db, scope)
  const ids = companies.map((c) => c.id)
  const code = (id: number) => companies.find((c) => c.id === id)?.shortCode ?? `#${id}`

  const runs = await db.query(
    "SELECT company_id, tx_id::text AS tx_id, status, documents, changed, started_at FROM document_renumber_runs WHERE company_id = ANY($1::int[]) AND status = 'applied'",
    [ids],
  )
  const runOf = new Map(runs.rows.map((r) => [num(r.company_id), r]))
  const missing = ids.filter((i) => !runOf.has(i))
  add('run tercatat (applied) per PT', missing.length === 0, missing.length === 0 ? `${runOf.size} PT` : `belum: ${missing.map(code).join(', ')}`)

  const input = await loadInput(db, companies)
  const plan = planRenumber(input)
  add('rencana tanpa error', plan.errors.length === 0, plan.errors.join('; ') || 'ok')
  add('nomor sesuai urutan tanggal dibuat (dihitung ulang)', plan.summary.changed === 0, `${plan.summary.changed} dari ${plan.summary.documents} dokumen akan berubah`)

  const dups: string[] = []
  for (const t of DOC_TABLES) for (const x of (await db.query(DUPLICATES[t.table], [ids])).rows) dups.push(`${t.table} ${code(num(x.company_id))} ${String(x.no)} ×${String(x.n)}`)
  add('tidak ada nomor ganda per PT × jenis', dups.length === 0, dups.join('; ') || 'ok')

  const used = new Set<string>(DEFAULT_SEQUENCES.map((d) => d.docType))
  const noCompany = input.sequences.filter((s) => used.has(s.docType) && !s.pattern.includes('{COMPANY}'))
  add('semua pola (jenis yang dipakai) memuat {COMPANY}', noCompany.length === 0, noCompany.map((s) => `${code(s.companyId)} ${s.docType} "${s.pattern}"`).join('; ') || 'ok')

  const counters = new Map(input.counters.map((c) => [`${c.companyId}|${c.docType}|${c.periodKey}`, c.nextValue]))
  const lastSeq = new Map<string, number>()
  for (const it of plan.items) {
    const k = `${it.companyId}|${it.docType}|${it.periodKey}`
    lastSeq.set(k, Math.max(lastSeq.get(k) ?? 0, it.seq))
  }
  const low = [...lastSeq].filter(([k, s]) => (counters.get(k) ?? 0) <= s).map(([k, s]) => `${k} counter ${counters.get(k) ?? '—'} ≤ ${s}`)
  add('counter = nomor terakhir + 1 (dokumen baru mendapat n + 1)', low.length === 0, low.join('; ') || 'ok')

  const counted = await db.query(
    `SELECT a.company_id, count(*)::int AS n FROM audit_logs a JOIN document_renumber_runs r ON r.tx_id = a.tx_id AND r.company_id = a.company_id
      WHERE a.action = 'renumbered' AND a.field IN ('docNo', 'entryNo') AND a.company_id = ANY($1::int[]) GROUP BY 1`,
    [ids],
  )
  const auditN = new Map(counted.rows.map((r) => [num(r.company_id), num(r.n)]))
  const auditBad = [...runOf].filter(([cid, r]) => (auditN.get(cid) ?? 0) !== num(r.changed)).map(([cid, r]) => `${code(cid)}: audit ${auditN.get(cid) ?? 0} ≠ diubah ${num(r.changed)}`)
  add('satu baris audit "renumbered" per dokumen yang diubah', auditBad.length === 0, auditBad.join('; ') || 'ok')

  const disabled = await db.query(
    `SELECT c.relname AS t, g.tgname AS name FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT g.tgisinternal AND g.tgenabled = 'D'
        AND c.relname = ANY(ARRAY['expense_requests','transfers','settlements','cash_entries','progress_reports','budget_addenda','service_reports','daily_reports','project_loans','notifications','receipt_flags','document_sequence_counters'])`,
  )
  add('trigger pengaman aktif (tidak ada yang dinonaktifkan)', disabled.rows.length === 0, disabled.rows.map((r) => `${String(r.t)}.${String(r.name)}`).join(', ') || 'ok')

  // probe: an ordinary change of an issued number is still refused (with and without the session flag)
  const probe: string[] = []
  await db.query('BEGIN')
  try {
    for (const t of DOC_TABLES) {
      if (!plan.items.some((i) => i.table === t.table)) continue
      for (const flag of [false, true]) {
        await db.query('SAVEPOINT pk_probe')
        try {
          if (flag) await db.query("SET LOCAL pk.renumber = 'on'")
          const r = await db.query(PROBE[t.table], [ids])
          probe.push(`${t.table}${flag ? ' (flag)' : ''}: TIDAK ditolak (${r.rowCount ?? 0} baris)`)
        } catch (e) {
          const code42501 = (e as { code?: string }).code === '42501'
          if (!code42501) probe.push(`${t.table}${flag ? ' (flag)' : ''}: error lain ${(e as Error).message}`)
        }
        await db.query('ROLLBACK TO SAVEPOINT pk_probe')
      }
    }
  } finally {
    await db.query('ROLLBACK')
  }
  add('perubahan nomor biasa tetap ditolak DB (42501), juga dengan flag tanpa run', probe.length === 0, probe.join('; ') || 'ok')

  return { ok: checks.every((c) => c.ok), checks }
}

