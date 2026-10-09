import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * MC2 raw-SQL company lint (ADR 0016 "Security model": raw SQL bypasses Payload access — every
 * query over a per-PT table must carry a company predicate built by a helper). Scans the raw-SQL
 * modules function by function: a function whose `sql` templates read a per-PT table must call one
 * of the company helpers or carry a BOUND company predicate (`company_id = ${…}` / `IN (${…})` /
 * `= ANY(${…})`), unless it is listed in ALLOWED with the reason why the rows are already bound to one
 * checked document / PT. A pure join condition (`ws.company_id = e.company_id`) is NOT a company
 * predicate (QA-MC4-13): it keeps two tables in one PT but says nothing about WHICH PT.
 * A NEW raw-SQL function without a company predicate fails this test.
 */
const ROOT = path.resolve(__dirname, '../../src')
// QA-MC4-13: the whole of domain/expense, progress, addendum and sync (was: three single files)
const SCAN = ['domain/reports', 'domain/reminders', 'domain/attendance', 'domain/cash', 'domain/expense', 'domain/progress', 'domain/addendum', 'domain/sync']

const PER_PT_TABLES = [
  'expense_requests', 'cash_entries', 'cash_accounts', 'projects', 'cost_centers', 'attendances', 'employees', 'team_assignments', 'transfers',
  'vehicles', 'expense_categories', 'period_closings', 'audit_logs', 'progress_reports', 'receipt_flags', 'settlements', 'receipts', 'budget_lines',
  'cash_in_sources', 'work_schedules', 'media_selfies',
  // QA-MC4-13: the per-PT tables the lint did not know
  'approvals', 'budget_addenda', 'project_stages', 'attendance_corrections', 'employee_bank_accounts', 'company_memberships', 'document_sequence_counters',
  'urgency_levels',
]
/** Company helpers (they build `company_id IN (<bound ids>)` from the caller's scope) — a CALL, not a mention. */
const HELPER_CALL = /\b(?:requestScopeSql|cashScopeSql|ledgerScopeSql|projectScopeSql|costCenterScopeSql|masterScopeSql|companyScopeSql|locationScopeSql|employeeCompanySql|candidateWhere|ptSql)\(/
/** An explicit company predicate against a bound parameter. */
const BOUND_COMPANY = /\bcompany_id\s*(?:=\s*ANY\s*\(|=|IN\b)\s*\(?\s*\$\{/i
const hasCompanyPredicate = (body: string) => HELPER_CALL.test(body) || BOUND_COMPANY.test(body)

/** function → why no company predicate is needed (rows bound to ONE document / id already checked). */
const ALLOWED: Record<string, string> = {
  'domain/attendance/queries.ts#currentSchedules': 'by employee ids of an already scoped list; schedule joined within the employee PT',
  'domain/attendance/queries.ts#employeeRef': 'one employee id, callers check scope / own employee first',
  'domain/attendance/queries.ts#myAssignedLocations': "the caller's OWN employee ids (ownEmployees: one per mapped PT); locations come through those employees' assignments",
  'domain/attendance/web.ts#selfieState': 'by attendance ids of an already scoped list',
  'domain/attendance/record.ts#dayRowsAt': 'one employee + one location (both PT-bound, checked by recordAttendance)',
  'domain/attendance/corrections.ts#effectiveTime': 'one attendance id checked by correctAttendance',
  'domain/reports/attendance-report.ts#attendanceMonth': 'employees by ids from the scoped facts (locationScopeSql)',
  'domain/reminders/service.ts#requestPeople': 'one request id of the PT run',
  'domain/reports/audit-log.ts#auditLogCount': 'where(f) adds the company predicate (companyScopeSql on a.company_id)',
  'domain/reports/kpi.ts#reportContext': 'the per-request fragments that follow (REALIZED/DISBURSED/REFUND) are used inside scoped queries only',
  'domain/cash/ledger.ts#loadEntry': 'one cash entry id; the caller checks the PT role on the loaded row',
  // QA-MC4-13 (scan of domain/expense|progress|addendum): rows bound to one checked document
  'domain/expense/common.ts#lockRequest': 'row lock (FOR UPDATE) of ONE request id; visibility is checked right after (loadVisible)',
  'domain/expense/common.ts#projectCommitted': 'requests of ONE project id (the request being decided; same PT by the DB trigger)',
  'domain/expense/receipts.ts#duplicateHits': 'receipts of ONE request; PT = the request PT or a PT the uploader is mapped to (QA-MC4-06, scope rule)',
  'domain/expense/snapshot.ts#writeSnapshot': 'content hash of ONE request id (the document being snapshotted)',
  'domain/expense/transfers.ts#approvedByCaller': 'approvals of request ids from an already scoped queue, actor = the caller',
  'domain/progress/recalc.ts#lockProject': 'row lock (FOR UPDATE) of ONE project id checked by the caller',
  'domain/addendum/service.ts#lockAddendum': 'row lock (FOR UPDATE) of ONE addendum id; visibility is checked right after (loadVisibleAddendum)',
}

type Fn = { file: string; name: string; body: string }

function files(p: string): string[] {
  const abs = path.join(ROOT, p)
  if (statSync(abs).isFile()) return [p]
  return readdirSync(abs).flatMap((f) => files(path.join(p, f))).filter((f) => f.endsWith('.ts'))
}

/** Top-level functions (declarations and `const x = async (…) =>`), split at column 0. */
function functions(file: string): Fn[] {
  const src = readFileSync(path.join(ROOT, file), 'utf8')
  const re = /^(?:export )?(?:async )?function (\w+)|^(?:export )?const (\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/gm
  const marks: Array<{ name: string; at: number }> = []
  for (let m = re.exec(src); m; m = re.exec(src)) marks.push({ name: (m[1] ?? m[2])!, at: m.index })
  return marks.map((m, i) => ({ file, name: m.name, body: src.slice(m.at, marks[i + 1]?.at ?? src.length) }))
}

const readsPerPtTable = (body: string) => /\bsql`/.test(body) && PER_PT_TABLES.some((t) => new RegExp(`\\b(FROM|JOIN|UPDATE)\\s+${t}\\b`, 'i').test(body))

describe('MC2 raw SQL: every per-PT query carries a company predicate', () => {
  const scanned = SCAN.flatMap(files)
  const fns = [...new Set(scanned)].flatMap(functions)

  it('no raw-SQL function over a per-PT table without a company helper / bound predicate (or an allow-listed reason)', () => {
    const violations = fns.filter((f) => readsPerPtTable(f.body) && !hasCompanyPredicate(f.body) && !ALLOWED[`${f.file}#${f.name}`]).map((f) => `${f.file}#${f.name}`)
    expect(violations).toEqual([])
  })

  it('the allow list has no stale entries (each one is a function that still needs it)', () => {
    const byName = new Map(fns.map((f) => [`${f.file}#${f.name}`, f]))
    expect(Object.keys(ALLOWED).filter((k) => !byName.has(k))).toEqual([])
    // minimal list: an entry for a function that reads no per-PT table or already has a predicate is noise
    expect(Object.keys(ALLOWED).filter((k) => byName.has(k) && (!readsPerPtTable(byName.get(k)!.body) || hasCompanyPredicate(byName.get(k)!.body)))).toEqual([])
  })

  it('QA-MC4-13: covers expense / progress / addendum / sync and the 7 tables added', () => {
    for (const dir of ['domain/expense', 'domain/progress', 'domain/addendum', 'domain/sync']) expect(scanned.some((f) => f.startsWith(`${dir}/`))).toBe(true)
    for (const t of ['approvals', 'budget_addenda', 'project_stages', 'attendance_corrections', 'employee_bank_accounts', 'company_memberships', 'document_sequence_counters']) expect(PER_PT_TABLES).toContain(t)
  })

  it('QA-MC4-13: a join condition alone is not a company predicate; a bound parameter or a helper call is', () => {
    const t = '`'
    const fn = (where: string) => `async function f() { return sql${t}SELECT 1 FROM work_schedules ws JOIN employees e ON ${where}${t} }`
    expect(hasCompanyPredicate(fn('ws.company_id = e.company_id'))).toBe(false)
    expect(hasCompanyPredicate(fn('e.company_id IN (SELECT company_id FROM companies)'))).toBe(false)
    expect(hasCompanyPredicate(fn('true') + ' // requestScopeSql is imported')).toBe(false)
    expect(hasCompanyPredicate(fn('e.company_id = ${company}'))).toBe(true)
    expect(hasCompanyPredicate(fn('e.company_id IN (${sql.join(ids)})'))).toBe(true)
    expect(hasCompanyPredicate(fn('e.company_id = ANY(${ids})'))).toBe(true)
    expect(hasCompanyPredicate(fn('${companyScopeSql(scope, sql`e.company_id`)}'))).toBe(true)
  })

  it('no company-blind scope literal: SQL `TRUE` is never returned for a whole scope kind', () => {
    const scope = readFileSync(path.join(ROOT, 'domain/reports/scope.ts'), 'utf8')
    expect(scope).not.toMatch(/case 'all':\s*return sql`TRUE`/)
    const att = readFileSync(path.join(ROOT, 'domain/attendance/queries.ts'), 'utf8')
    expect(att).not.toMatch(/kind === 'all'\) return sql`TRUE`/)
  })
})
