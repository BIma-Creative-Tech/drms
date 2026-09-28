import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * MC2 raw-SQL company lint (ADR 0016 "Security model": raw SQL bypasses Payload access — every
 * query over a per-PT table must carry a company predicate built by a helper). Scans the raw-SQL
 * modules function by function: a function whose `sql` templates read a per-PT table must use one
 * of the company helpers (or an explicit `company_id` predicate), unless it is listed in ALLOWED
 * with the reason why the rows are already bound to one checked document / PT.
 * A NEW raw-SQL function without a company predicate fails this test.
 */
const ROOT = path.resolve(__dirname, '../../src')
const SCAN = ['domain/reports', 'domain/reminders', 'domain/attendance', 'domain/cash', 'domain/expense/auto-close.ts', 'domain/progress/reminders.ts']

const PER_PT_TABLES = [
  'expense_requests', 'cash_entries', 'cash_accounts', 'projects', 'cost_centers', 'attendances', 'employees', 'team_assignments', 'transfers',
  'vehicles', 'expense_categories', 'period_closings', 'audit_logs', 'progress_reports', 'receipt_flags', 'settlements', 'receipts', 'budget_lines',
  'cash_in_sources', 'work_schedules', 'media_selfies',
]
const HELPERS = /requestScopeSql|cashScopeSql|ledgerScopeSql|projectScopeSql|costCenterScopeSql|masterScopeSql|companyScopeSql|locationScopeSql|employeeCompanySql|candidateWhere|company_id\s*(=|IN)|ptSql\(/

/** function → why no company predicate is needed (rows bound to ONE document / id already checked). */
const ALLOWED: Record<string, string> = {
  'domain/reports/kpi.ts#projectBudgetByCategory': 'p = one project id AND projectScopeSql (CTE p)',
  'domain/attendance/queries.ts#loadHolidays': 'holidays are shared (no PT)',
  'domain/attendance/queries.ts#currentSchedules': 'by employee ids of an already scoped list; schedule joined within the employee PT',
  'domain/attendance/queries.ts#employeeRef': 'one employee id, callers check scope / own employee first',
  'domain/attendance/web.ts#selfieState': 'by attendance ids of an already scoped list',
  'domain/attendance/record.ts#dayRowsAt': 'one employee + one location (both PT-bound, checked by recordAttendance)',
  'domain/attendance/corrections.ts#effectiveTime': 'one attendance id checked by correctAttendance',
  'domain/reports/attendance-report.ts#attendanceMonth': 'employees by ids from the scoped facts (locationScopeSql)',
  'domain/reminders/service.ts#activeOnly': 'users table (no PT)',
  'domain/reminders/service.ts#requestPeople': 'one request id of the PT run',
  'domain/reminders/service.ts#claim': 'reminder_deliveries (keys embed globally unique ids)',
  'domain/cash/ledger.ts#currentLockDate': 'pk_cash_lock_date(company_id) of ONE PT',
  'domain/cash/ledger.ts#closePeriod': 'LOCK TABLE only (period rows are read through Payload with company)',
  'domain/cash/ledger.ts#reopenPeriod': 'LOCK TABLE only (period rows are read through Payload with company)',
  'domain/expense/auto-close.ts#autoCloseCompany': 'e.company_id = the PT of the run',
  'domain/reports/audit-log.ts#auditLogCount': 'where(f) adds the company predicate (companyScopeSql on a.company_id)',
  'domain/reports/kpi.ts#reportContext': 'the per-request fragments that follow (REALIZED/DISBURSED/REFUND) are used inside scoped queries only',
  'domain/cash/ledger.ts#loadEntry': 'one cash entry id; the caller checks the PT role on the loaded row',
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

const readsPerPtTable = (body: string) => /\bsql`/.test(body) && PER_PT_TABLES.some((t) => new RegExp(`\\b(FROM|JOIN)\\s+${t}\\b`, 'i').test(body))

describe('MC2 raw SQL: every per-PT query carries a company predicate', () => {
  const scanned = [...SCAN, 'domain/attendance/record.ts', 'domain/attendance/corrections.ts'].flatMap(files)
  const fns = [...new Set(scanned)].flatMap(functions)

  it('no raw-SQL function over a per-PT table without a company helper (or an allow-listed reason)', () => {
    const violations = fns.filter((f) => readsPerPtTable(f.body) && !HELPERS.test(f.body) && !ALLOWED[`${f.file}#${f.name}`]).map((f) => `${f.file}#${f.name}`)
    expect(violations).toEqual([])
  })

  it('the allow list has no stale entries', () => {
    const names = new Set(fns.map((f) => `${f.file}#${f.name}`))
    expect(Object.keys(ALLOWED).filter((k) => !names.has(k))).toEqual([])
  })

  it('no company-blind scope literal: SQL `TRUE` is never returned for a whole scope kind', () => {
    const scope = readFileSync(path.join(ROOT, 'domain/reports/scope.ts'), 'utf8')
    expect(scope).not.toMatch(/case 'all':\s*return sql`TRUE`/)
    const att = readFileSync(path.join(ROOT, 'domain/attendance/queries.ts'), 'utf8')
    expect(att).not.toMatch(/kind === 'all'\) return sql`TRUE`/)
  })
})
