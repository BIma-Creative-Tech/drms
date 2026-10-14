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
const SCAN = ['domain/reports', 'domain/reminders', 'domain/attendance', 'domain/cash', 'domain/expense', 'domain/progress', 'domain/addendum', 'domain/sync', 'domain/field', 'domain/daily', 'domain/rap']

const PER_PT_TABLES = [
  'expense_requests', 'cash_entries', 'cash_accounts', 'projects', 'cost_centers', 'attendances', 'employees', 'team_assignments', 'transfers',
  'vehicles', 'expense_categories', 'period_closings', 'audit_logs', 'progress_reports', 'receipt_flags', 'settlements', 'receipts', 'budget_lines',
  'cash_in_sources', 'work_schedules', 'media_selfies',
  // QA-MC4-13: the per-PT tables the lint did not know
  'approvals', 'budget_addenda', 'project_stages', 'attendance_corrections', 'employee_bank_accounts', 'company_memberships', 'document_sequence_counters',
  'urgency_levels',
  // FR1 (ADR 0020)
  'contract_units', 'service_reports', 'unit_timesheets', 'aftersales_activities', 'clients',
  // P3
  'rap_items', 'rap_templates', 'resource_types', 'daily_reports', 'daily_report_lines',
  // ADR 0023
  'sites',
]
/** Company helpers (they build `company_id IN (<bound ids>)` from the caller's scope) — a CALL, not a mention. */
const HELPER_CALL = /\b(?:requestScopeSql|cashScopeSql|ledgerScopeSql|projectScopeSql|costCenterScopeSql|masterScopeSql|companyScopeSql|locationScopeSql|employeeCompanySql|candidateWhere|ptSql|siteScopeSql|homeSiteScopeSql)\(/
/** An explicit company predicate against a bound parameter. */
const BOUND_COMPANY = /\bcompany_id\s*(?:=\s*ANY\s*\(|=|IN\b)\s*\(?\s*\$\{/i
const hasCompanyPredicate = (body: string) => HELPER_CALL.test(body) || BOUND_COMPANY.test(body)

/** function → why no company predicate is needed (rows bound to ONE document / id already checked). */
const ALLOWED: Record<string, string> = {
  'domain/attendance/queries.ts#currentSchedules': 'by employee ids of an already scoped list; schedule joined within the employee PT',
  'domain/attendance/queries.ts#employeeRef': 'one employee id, callers check scope / own employee first',
  'domain/attendance/web.ts#selfieState': 'by attendance ids of an already scoped list',
  'domain/attendance/record.ts#dayRowsAt': 'one employee + one location (both PT-bound, checked by recordAttendance)',
  'domain/attendance/corrections.ts#effectiveTime': 'one attendance id checked by correctAttendance',
  'domain/attendance/stamp.ts#stampAttendanceSelfie': 'worker job (system): ONE attendance id queued by recordAttendance in that attendance transaction; no caller data is returned',
  'domain/reports/attendance-report.ts#attendanceMonth': 'employees by ids from the scoped facts (locationScopeSql)',
  'domain/reminders/service.ts#requestPeople': 'one request id of the PT run',
  'domain/reports/audit-log.ts#auditLogCount': 'where(f) adds the company predicate (companyScopeSql on a.company_id)',
  'domain/reports/kpi.ts#reportContext': 'the per-request fragments that follow (REALIZED/DISBURSED/REFUND) are used inside scoped queries only',
  'domain/cash/ledger.ts#loadEntry': 'one cash entry id; the caller checks the PT role on the loaded row',
  // QA-MC4-13 (scan of domain/expense|progress|addendum): rows bound to one checked document
  'domain/expense/common.ts#lockRequest': 'row lock (FOR UPDATE) of ONE request id; visibility is checked right after (loadVisible)',
  'domain/expense/common.ts#projectCommitted': 'requests of ONE project id (the request being decided; same PT by the DB trigger)',
  // ADR 0027: duplicate invoice check
  'domain/expense/drafts.ts#assertInvoiceUnused': 'requests of ONE vendor id (validated before: active vendor of the request PT; vendor_id is same-PT by DB trigger)',
  'domain/expense/receipts.ts#duplicateHits': 'receipts of ONE request; PT = the request PT or a PT the uploader is mapped to (QA-MC4-06, scope rule)',
  'domain/expense/snapshot.ts#writeSnapshot': 'content hash of ONE request id (the document being snapshotted)',
  'domain/expense/transfers.ts#approvedByCaller': 'approvals of request ids from an already scoped queue, actor = the caller',
  'domain/progress/recalc.ts#lockProject': 'row lock (FOR UPDATE) of ONE project id checked by the caller',
  'domain/addendum/service.ts#lockAddendum': 'row lock (FOR UPDATE) of ONE addendum id; visibility is checked right after (loadVisibleAddendum)',
  // DRMS 10/10 Phase C (D4 RAP realisation, D2 cost center filter)
  'domain/rap/budget.ts#rapUsage': 'requests of project ids the caller already passed the project read check for (loadRap, listProjects / rapMonitoring read scope, one request\'s project); a request shares its project\'s PT (DB trigger)',
  'domain/rap/budget.ts#rapItemRows': 'RAP items of checked project ids, or of ONE request\'s lines (same PT as the request, DB trigger)',
  'domain/reports/kpi.ts#requestCostCenterSql': 'fragment used only inside requestScopeSql-scoped queries (requestFilterSql, spending)',
  // ADR 0023 site filter: AND-ed fragments of orCompanies (each part is `company_id = <PT> AND …` already)
  'domain/reports/scope.ts#projectOfSitesSql': 'site narrowing fragment, used only inside the company-bound parts of orCompanies (requestScopeSql, cashScopeSql) — it only narrows',
  'domain/reports/scope.ts#accountOfSitesSql': 'site narrowing fragment, used only inside the company-bound parts of orCompanies (cashScopeSql, ledgerScopeSql) — it only narrows',
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
