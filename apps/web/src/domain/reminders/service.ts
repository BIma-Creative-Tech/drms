import { sql } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'

import { notificationTemplate, projectPmUsers, pushEnabled } from '@/domain/notifications'
import { lateProgressProjects, LATE_REPORT_EVENT, notifyLateProgressReport } from '@/domain/progress/reminders'
import { projectBudgets } from '@/domain/reports/kpi'
import { fromCompanies } from '@/domain/reports/scope'
import { daysBetween } from '@/domain/reports/rules'
import { statusLabel, type RequestStatus, type RequestType } from '@/domain/expense/types'
import { daysOverdue } from '@/domain/loans/rules'
import { LOAN_NOTIFICATION_DEFAULTS, loanVars, renderLoanText } from '@/domain/loans/service'
import { daysOverdue as icDaysOverdue, IC_LOAN_NOTIFY_DEFAULTS, renderLoanText as renderIcLoanText } from '@/domain/intercompany/loan-rules'
import { icLoanVars, overdueIcLoans } from '@/domain/intercompany/loans'
import { formatRupiah } from '@/lib/money'
import { withSystemTransaction } from '@/lib/system-tx'
import { DEFAULT_TZ } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

import { companyClock, crossedThresholds, DEFAULT_TEXTS, fill, REMINDER_EVENTS, reminderSettingsOf, runDecision, type ReminderRule, type ReminderSettings } from './rules'
import { activeCompanyIds, companyRefs, settingsOf } from '@/domain/companies'

/**
 * E7 — daily scheduled reminders (M12, US-11; plan fase1-golive §E7). Job `dailyReminders` fires
 * hourly (worker, process TZ); ONE run per business day happens at/after company-settings.reminderHour
 * (company timezone). The whole run is one transaction under an advisory lock:
 *   (a) late_progress    running project without progress report ≥ lateReportDays → PM + Direktur
 *   (b) lpj_overdue      Pengajuan Baru `transferred`/`receipts_complete`, first posted transfer > lpjDueDays
 *                        → requesters' accounts + creator + Finance
 *   (c) revision_pending Revisi Nota / LPJ Revisi unchanged ≥ reminderRevisionDays → requesters + creator
 *   (d) budget_threshold project commitment (K-07/K-08) ≥ budgetWarnPct / budgetOverPct → Direktur +
 *                        Finance + PM, once per threshold per project (not per day)
 *   (e) loan_overdue     ADR 0022 Q-L6: inter-project loan past its due date with an outstanding balance →
 *                        PM of the borrower project + Direktur, once per business day while overdue
 * Idempotency: `reminder_deliveries` (rule, subject, period, user) primary key — a recipient gets a
 * rule's reminder for a subject at most once per business day (budget: once per threshold), even when
 * the job is re-run or forced. Recipients are ACTIVE users only; archived projects (and requests of
 * archived projects) produce nothing. Channels: in-app notification always (push status per
 * PUSH_FCM_ENABLED), email via the sendEmail queue when reminderEmailEnabled. Logs carry counts only.
 *
 * MC2 (ADR 0016 §7): one run PER ACTIVE PT with that PT's settings (hour, toggles, thresholds) and its
 * own `reminder_runs (company_id, run_date)` row / advisory lock / transaction; subjects are the PT's
 * documents, recipients hold the role IN THAT PT; notification rows carry the PT. A failing PT is
 * logged and the others continue. The returned result aggregates the PTs (`companies` = per PT).
 */
export type RuleSummary = { subjects: number; notified: number }
export type ReminderRunStatus = 'run' | 'disabled' | 'before_hour' | 'already_ran' | 'failed'
export type CompanyRunResult = {
  companyId: number
  status: ReminderRunStatus
  date: string
  hour: number
  rules: Partial<Record<ReminderRule, RuleSummary>>
  emails: number
}
export type ReminderRunResult = {
  /** 'run' when at least one PT ran; else the status of the first PT (single-PT: unchanged semantics). */
  status: Exclude<ReminderRunStatus, 'failed'> | 'failed'
  date: string
  hour: number
  rules: Partial<Record<ReminderRule, RuleSummary>>
  emails: number
  companies: CompanyRunResult[]
}

type Row = Record<string, unknown>
async function q<T = Row>(req: PayloadRequest, query: ReturnType<typeof sql>): Promise<T[]> {
  const tx = await getRequestTx(req)
  return ((await tx.execute(query)) as unknown as { rows: T[] }).rows
}

const ids = (list: readonly number[]) =>
  sql.join(
    list.map((i) => sql`${i}`),
    sql`, `,
  )

async function activeOnly(req: PayloadRequest, userIds: Iterable<number>): Promise<number[]> {
  const list = [...new Set([...userIds].filter((x) => Number.isInteger(x) && x > 0))]
  if (list.length === 0) return []
  const r = await q<{ id: number }>(req, sql`SELECT id FROM users WHERE id IN (${ids(list)}) AND coalesce(active, true) ORDER BY id`)
  return r.map((x) => Number(x.id))
}

/** Active holders of `role` IN `companyId` (ADR 0016 §5/§7: recipients of the subject's PT only). */
async function roleHolders(req: PayloadRequest, role: string, companyId: number): Promise<number[]> {
  // ADR 0026: an FYI reminder addressed to the Direktur reaches the Owner too (same view as the Direktur);
  // decision requests of an approval step never come from here (they use the step's exact role)
  const roles = role === 'pk-owner' ? ['pk-owner', 'pk-principal'] : [role]
  const r = await q<{ id: number }>(
    req,
    sql`SELECT DISTINCT u.id FROM users u JOIN company_memberships m ON m.user_id = u.id AND coalesce(m.active, true) AND m.company_id = ${companyId}
          JOIN company_memberships_roles mr ON mr.parent_id = m.id
         WHERE mr.value::text IN (${sql.join(roles.map((x) => sql`${x}`), sql`, `)}) AND coalesce(u.active, true) ORDER BY u.id`,
  )
  return r.map((x) => Number(x.id))
}

/** Creator + accounts of the "Diajukan Oleh" employees of a request. */
async function requestPeople(req: PayloadRequest, requestId: number): Promise<number[]> {
  const r = await q<{ id: number }>(
    req,
    sql`SELECT er.created_by_id AS id FROM expense_requests er WHERE er.id = ${requestId} AND er.created_by_id IS NOT NULL
        UNION
        SELECT m.user_id FROM expense_requests_rels rr JOIN company_memberships m ON m.employee_id = rr.employees_id
         WHERE rr.parent_id = ${requestId} AND rr.path = 'requesters'`,
  )
  return r.map((x) => Number(x.id))
}

/** Records the deliveries; returns ONLY the recipients not yet reminded for this subject/period. */
async function claim(req: PayloadRequest, rule: ReminderRule, subject: string, period: string, userIds: number[]): Promise<number[]> {
  if (userIds.length === 0) return []
  const r = await q<{ user_id: number }>(
    req,
    sql`INSERT INTO reminder_deliveries (rule, subject_key, period_key, user_id)
        SELECT ${rule}, ${subject}, ${period}, u FROM unnest(ARRAY[${ids(userIds)}]::int[]) AS u
        ON CONFLICT DO NOTHING RETURNING user_id`,
  )
  return r.map((x) => Number(x.user_id)).sort((a, b) => a - b)
}

type Msg = { title: string; body: string; docType: string; docId: string; docNo: string | null }

async function inApp(req: PayloadRequest, event: string, userIds: number[], m: Msg, companyId: number): Promise<void> {
  for (const uid of userIds) {
    await req.payload.create({
      collection: 'notifications',
      data: { user: uid, company: companyId, event, title: m.title.slice(0, 160), body: m.body.slice(0, 1000), docType: m.docType, docId: m.docId, docNo: m.docNo, pushStatus: pushEnabled() ? 'pending' : 'skipped' } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: scheduled reminder (E7)
      req,
    })
  }
}

class Run {
  emails = 0
  rules: Partial<Record<ReminderRule, RuleSummary>> = {}
  constructor(
    readonly req: PayloadRequest,
    readonly s: ReminderSettings,
    readonly date: string,
  ) {}

  count(rule: ReminderRule, notified: number) {
    const r = (this.rules[rule] ??= { subjects: 0, notified: 0 })
    r.subjects++
    r.notified += notified
  }

  async email(userIds: number[], m: Msg) {
    if (!this.s.email) return
    const base = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/admin` : null
    for (const uid of userIds) {
      await this.req.payload.jobs.queue({
        task: 'sendEmail',
        input: { userId: uid, subject: `RR Teams — ${m.title}`.slice(0, 200), text: `${m.body}\n\n${base ? `Buka RR Teams: ${base}\n\n` : ''}Email otomatis pengingat harian RR Teams.\n` },
        req: this.req,
      })
      this.emails++
    }
  }

  /** Claims + delivers one subject of a rule to `recipients` (active users only). */
  async deliver(rule: ReminderRule, subject: string, period: string, recipients: Iterable<number>, send: (userIds: number[]) => Promise<Msg>): Promise<number> {
    const fresh = await claim(this.req, rule, subject, period, await activeOnly(this.req, recipients))
    if (fresh.length > 0) await this.email(fresh, await send(fresh))
    this.count(rule, fresh.length)
    return fresh.length
  }
}

// ---------------------------------------------------------------- rules

/** Same default text as domain/progress/reminders.ts (the in-app row is written there). */
const LATE_TEXT = {
  title: 'Laporan progress terlambat: {code}',
  body: 'Project {code} {name} belum punya laporan progress selama {days} hari (terakhir: {last}).',
}

async function lateProgress(run: Run) {
  const { req, s, date } = run
  const owners = await roleHolders(req, 'pk-owner', s.companyId)
  const late = await lateProgressProjects(req, { asOf: date, days: s.lateProgress.days, timezone: s.timeZone, companyId: s.companyId })
  const t = await notificationTemplate(req, LATE_REPORT_EVENT, LATE_TEXT)
  for (const p of late) {
    await run.deliver('late_progress', `project:${p.projectId}`, date, [...(p.pmUserId ? [p.pmUserId] : []), ...owners], async (userIds) => {
      await notifyLateProgressReport(req, p, userIds)
      const vars = { code: p.code, name: p.name, days: String(p.daysSince), last: p.lastReportDate ?? 'belum ada' }
      return { title: fill(t.title, vars), body: fill(t.body, vars), docType: 'project', docId: String(p.projectId), docNo: p.code }
    })
  }
}

type ReqRow = { id: number; doc_no: string | null; title: string; type: RequestType; status: RequestStatus; since: string | null }

async function lpjOverdue(run: Run) {
  const { req, s, date } = run
  const finance = await roleHolders(req, 'pk-finance', s.companyId)
  const rows = await q<ReqRow>(
    req,
    sql`SELECT er.id, er.doc_no, er.title, er.type::text AS type, er.status::text AS status,
               (SELECT min(t.transfer_date) FROM transfers t WHERE t.request_id = er.id AND t.status = 'posted' AND t.kind = 'advance') AS since
          FROM expense_requests er LEFT JOIN projects p ON p.id = er.project_id
         WHERE er.type = 'advance' AND er.status::text IN ('transferred', 'receipts_complete') AND er.company_id = ${s.companyId}
           AND (p.id IS NULL OR p.status::text NOT IN ('arsip', 'dibatalkan'))
         ORDER BY er.id`,
  )
  const t = await notificationTemplate(req, REMINDER_EVENTS.lpj_overdue, DEFAULT_TEXTS.lpj_overdue)
  for (const r of rows) {
    if (!r.since || r.since > date) continue
    const days = daysBetween(r.since, date)
    if (days <= s.lpjOverdue.days) continue // K-12b: overdue = age > lpjDueDays
    const vars = { docNo: r.doc_no ?? `#${r.id}`, title: r.title, days: String(days), since: r.since, limit: String(s.lpjOverdue.days) }
    const people = await requestPeople(req, Number(r.id))
    await run.deliver('lpj_overdue', `request:${r.id}`, date, [...people, ...finance], async (userIds) => {
      const m: Msg = { title: fill(t.title, vars), body: fill(t.body, vars), docType: 'expense_request', docId: String(r.id), docNo: r.doc_no }
      await inApp(req, REMINDER_EVENTS.lpj_overdue, userIds, m, s.companyId)
      return m
    })
  }
}

async function revisionPending(run: Run) {
  const { req, s, date } = run
  const rows = await q<ReqRow>(
    req,
    sql`SELECT er.id, er.doc_no, er.title, er.type::text AS type, er.status::text AS status,
               to_char(coalesce(
                 (SELECT max(a.server_time) FROM audit_logs a
                   WHERE a.doc_type = 'expense_request' AND a.doc_id = er.id::text AND a.action::text = 'status_change' AND a.status_to = er.status::text),
                 er.updated_at) AT TIME ZONE ${s.timeZone}, 'YYYY-MM-DD') AS since
          FROM expense_requests er LEFT JOIN projects p ON p.id = er.project_id
         WHERE er.status::text IN ('receipt_revision', 'lpj_revision') AND er.company_id = ${s.companyId}
           AND (p.id IS NULL OR p.status::text NOT IN ('arsip', 'dibatalkan'))
         ORDER BY er.id`,
  )
  const t = await notificationTemplate(req, REMINDER_EVENTS.revision_pending, DEFAULT_TEXTS.revision_pending)
  for (const r of rows) {
    if (!r.since || r.since > date) continue
    const days = daysBetween(r.since, date)
    if (days < s.revision.days) continue
    const vars = { docNo: r.doc_no ?? `#${r.id}`, title: r.title, days: String(days), since: r.since, status: statusLabel(r.type, r.status) }
    await run.deliver('revision_pending', `request:${r.id}`, date, await requestPeople(req, Number(r.id)), async (userIds) => {
      const m: Msg = { title: fill(t.title, vars), body: fill(t.body, vars), docType: 'expense_request', docId: String(r.id), docNo: r.doc_no }
      await inApp(req, REMINDER_EVENTS.revision_pending, userIds, m, s.companyId)
      return m
    })
  }
}

/**
 * FR1 (ADR 0020 §5): quotations (aftersales `penawaran`) whose follow-up date is due (≤ today, at most
 * 30 days back) → the reporter + the project's PMs, ONCE per quotation and follow-up date.
 */
async function aftersalesFollowup(run: Run) {
  const { req, s, date } = run
  const rows = await q<{ id: number; doc_no: string | null; follow_up_date: string; reporter_id: number; project_id: number; client: string; code: string; pname: string }>(
    req,
    sql`SELECT a.id, a.doc_no, a.follow_up_date, a.reporter_id, a.project_id, c.name AS client, p.code, p.name AS pname
          FROM aftersales_activities a JOIN clients c ON c.id = a.client_id JOIN projects p ON p.id = a.project_id
         WHERE a.company_id = ${s.companyId} AND a.kind = 'penawaran' AND a.follow_up_date IS NOT NULL
           AND a.follow_up_date <= ${date} AND a.follow_up_date >= to_char(${date}::date - 30, 'YYYY-MM-DD')
           AND p.status::text NOT IN ('arsip', 'dibatalkan')
         ORDER BY a.follow_up_date, a.id`,
  )
  const t = await notificationTemplate(req, REMINDER_EVENTS.aftersales_followup, DEFAULT_TEXTS.aftersales_followup)
  for (const r of rows) {
    const pms = await projectPmUsers(req, Number(r.project_id), s.companyId)
    const vars = { docNo: r.doc_no ?? `#${r.id}`, client: r.client, project: `${r.code} ${r.pname}`, date: r.follow_up_date }
    await run.deliver('aftersales_followup', `activity:${r.id}`, `fu:${r.follow_up_date}`, [Number(r.reporter_id), ...pms], async (userIds) => {
      const m: Msg = { title: fill(t.title, vars), body: fill(t.body, vars), docType: 'aftersales_activity', docId: String(r.id), docNo: r.doc_no }
      await inApp(req, REMINDER_EVENTS.aftersales_followup, userIds, m, s.companyId)
      return m
    })
  }
}

/**
 * ADR 0022 Q-L6: approved / partially repaid loans of the PT whose due date lies before today (PT clock) and that still
 * have an outstanding balance ("Terlambat", derived) → the borrower project's PM + the PT's Direktur, once per day.
 * Archived borrower projects produce nothing (like the other rules).
 */
async function loanOverdue(run: Run) {
  const { req, s, date } = run
  const owners = await roleHolders(req, 'pk-owner', s.companyId)
  const rows = await q<{ id: number; doc_no: string | null; amount: string; repaid_total: string; due_date: string; status: string; pm_id: number | null; lcode: string; lname: string; bcode: string; bname: string }>(
    req,
    sql`SELECT l.id, l.doc_no, l.amount, l.repaid_total, l.due_date, l.status::text AS status, pb.pm_id, pl.code AS lcode, pl.name AS lname, pb.code AS bcode, pb.name AS bname
          FROM project_loans l JOIN projects pb ON pb.id = l.borrower_project_id JOIN projects pl ON pl.id = l.lender_project_id
         WHERE l.company_id = ${s.companyId} AND l.status::text IN ('approved', 'partially_repaid') AND l.due_date < ${date}
           AND l.amount > l.repaid_total AND pb.status::text NOT IN ('arsip', 'dibatalkan')
         ORDER BY l.due_date, l.id`,
  )
  const t = await notificationTemplate(req, REMINDER_EVENTS.loan_overdue, LOAN_NOTIFICATION_DEFAULTS['project_loan.overdue'])
  for (const r of rows) {
    const loan = { id: Number(r.id), docNo: r.doc_no, amount: Number(r.amount), repaidTotal: Number(r.repaid_total), dueDate: r.due_date }
    const days = daysOverdue({ status: r.status as 'approved', dueDate: r.due_date, outstanding: loan.amount - loan.repaidTotal }, date)
    const vars = loanVars(loan, { id: 0, code: r.lcode, name: r.lname }, { id: 0, code: r.bcode, name: r.bname }, { days: String(days) })
    await run.deliver('loan_overdue', `loan:${r.id}`, date, [...(r.pm_id ? [Number(r.pm_id)] : []), ...owners], async (userIds) => {
      const m: Msg = { title: renderLoanText(t.title, vars), body: renderLoanText(t.body, vars), docType: 'project_loan', docId: String(r.id), docNo: r.doc_no }
      await inApp(req, REMINDER_EVENTS.loan_overdue, userIds, m, s.companyId)
      return m
    })
  }
}

/**
 * ADR 0029 §3.8: inter-PT loans of this PT as BORROWER past their due date (borrower clock) with an outstanding balance →
 * the Owner(s), Finance and Direktur of the borrower and Finance of the lender, once per business day while overdue.
 * The lender's Finance gets the row tagged with the lender PT.
 */
async function icLoanOverdue(run: Run) {
  const { req, s, date } = run
  const loans = await overdueIcLoans(req, s.companyId, date)
  if (loans.length === 0) return
  const t = await notificationTemplate(req, REMINDER_EVENTS.ic_loan_overdue, IC_LOAN_NOTIFY_DEFAULTS['icloan.overdue'])
  const borrowerSide = [...(await roleHolders(req, 'pk-principal', s.companyId)), ...(await roleHolders(req, 'pk-finance', s.companyId)), ...(await roleHolders(req, 'pk-owner', s.companyId))]
  const refs = new Map((await companyRefs(req, [s.companyId, ...loans.map((l) => l.lenderId)])).map((c) => [c.id, c]))
  for (const l of loans) {
    const lenderFinance = await roleHolders(req, 'pk-finance', l.lenderId)
    const vars = { ...icLoanVars(l, refs), days: String(icDaysOverdue(l, date)) }
    await run.deliver('ic_loan_overdue', `icloan:${l.id}`, date, [...borrowerSide, ...lenderFinance], async (userIds) => {
      const m: Msg = { title: renderIcLoanText(t.title, vars), body: renderIcLoanText(t.body, vars), docType: 'intercompany_loan', docId: String(l.id), docNo: l.docNo }
      const lenderOnly = new Set(lenderFinance.filter((u) => !borrowerSide.includes(u)))
      await inApp(req, REMINDER_EVENTS.ic_loan_overdue, userIds.filter((u) => !lenderOnly.has(u)), m, s.companyId)
      await inApp(req, REMINDER_EVENTS.ic_loan_overdue, userIds.filter((u) => lenderOnly.has(u)), m, l.lenderId)
      return m
    })
  }
}

async function budgetThreshold(run: Run) {
  const { req, s } = run
  const office = [...(await roleHolders(req, 'pk-owner', s.companyId)), ...(await roleHolders(req, 'pk-finance', s.companyId))]
  const projects = await projectBudgets(req, fromCompanies([{ company: s.companyId, kind: 'all' }])) // this PT; archived excluded (K-08)
  const pms = new Map((await q<{ id: number; pm_id: number | null }>(req, sql`SELECT id, pm_id FROM projects WHERE company_id = ${s.companyId}`)).map((x) => [Number(x.id), x.pm_id === null ? null : Number(x.pm_id)]))
  const t = await notificationTemplate(req, REMINDER_EVENTS.budget_threshold, DEFAULT_TEXTS.budget_threshold)
  for (const p of projects) {
    const crossed = crossedThresholds(p.pct, s.budget.thresholds)
    if (crossed.length === 0) continue
    const pm = pms.get(p.id)
    const recipients = await activeOnly(req, [...office, ...(pm ? [pm] : [])])
    // Once per threshold per project: claim every crossed threshold; notify about the HIGHEST one
    // that is new for the recipient (a project jumping from 70% to 105% gets one message, not two).
    const top = new Map<number, number>()
    for (const th of crossed) for (const uid of await claim(req, 'budget_threshold', `project:${p.id}`, `pct:${th}`, recipients)) top.set(uid, th)
    const byTh = new Map<number, number[]>()
    for (const [uid, th] of top) byTh.set(th, [...(byTh.get(th) ?? []), uid])
    for (const [th, userIds] of byTh) {
      const vars = { code: p.code, name: p.name, threshold: String(th), pct: String(p.pct).replace('.', ','), committed: formatRupiah(p.committed), budget: formatRupiah(p.budget ?? 0) }
      const m: Msg = { title: fill(t.title, vars), body: fill(t.body, vars), docType: 'project', docId: String(p.id), docNo: p.code }
      userIds.sort((a, b) => a - b)
      await inApp(req, REMINDER_EVENTS.budget_threshold, userIds, m, s.companyId)
      await run.email(userIds, m)
    }
    const r = (run.rules.budget_threshold ??= { subjects: 0, notified: 0 })
    r.subjects++
    r.notified += top.size
  }
}

// ---------------------------------------------------------------- run

/** Reminder settings of one PT (default: company #1 — tests / single-PT callers). */
export async function reminderSettings(payload: Payload, req?: PayloadRequest, companyId?: number | null): Promise<ReminderSettings> {
  const s = (await settingsOf(payload, companyId ?? null, req)) as unknown as Record<string, unknown>
  return reminderSettingsOf(s, process.env.TZ || DEFAULT_TZ)
}

/** One PT's tick: own settings, own lock, own transaction, own `reminder_runs` row. */
async function runCompany(payload: Payload, companyId: number, now: Date, force: boolean): Promise<CompanyRunResult> {
  const s = await reminderSettings(payload, undefined, companyId)
  const { date, hour } = companyClock(now, s.timeZone)
  const base: CompanyRunResult = { companyId, status: 'run', date, hour, rules: {}, emails: 0 }
  if (!s.enabled) return { ...base, status: 'disabled' }
  if (!force && hour < s.hour) return { ...base, status: 'before_hour' }
  return withSystemTransaction(
    payload,
    null,
    async (req) => {
      const tx = await getRequestTx(req)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pk:daily-reminders:${companyId}`}, 0))`)
      const ran = await q(req, sql`SELECT 1 FROM reminder_runs WHERE company_id = ${companyId} AND run_date = ${date}`)
      const decision = force ? 'run' : runDecision(s, hour, ran.length > 0)
      if (decision !== 'run') return { ...base, status: decision }
      const run = new Run(req, s, date)
      if (s.lateProgress.enabled) await lateProgress(run)
      if (s.lpjOverdue.enabled) await lpjOverdue(run)
      if (s.revision.enabled) await revisionPending(run)
      if (s.budget.enabled) await budgetThreshold(run)
      if (s.aftersalesFollowup.enabled) await aftersalesFollowup(run)
      if (s.loanOverdue.enabled) await loanOverdue(run)
      if (s.icLoanOverdue.enabled) await icLoanOverdue(run)
      await tx.execute(
        sql`INSERT INTO reminder_runs (company_id, run_date, summary) VALUES (${companyId}, ${date}, ${JSON.stringify({ rules: run.rules, emails: run.emails })}::jsonb)
            ON CONFLICT (company_id, run_date) DO UPDATE SET summary = EXCLUDED.summary, finished_at = clock_timestamp()`,
      )
      return { ...base, rules: run.rules, emails: run.emails }
    },
    { auditSource: 'job' },
  )
}

/**
 * One tick of the job over every active PT (or `companyId` only). `now` = injectable clock
 * (fake-clock tests); `force` ignores the hour and the "already ran today" marker (deliveries stay
 * de-duplicated) — tests and manual re-runs only. A PT that fails is logged (status `failed`), the
 * others still run (ADR 0016 §7).
 */
export async function runDailyReminders(payload: Payload, opts: { now?: Date; force?: boolean; companyId?: number } = {}): Promise<ReminderRunResult> {
  const now = opts.now ?? new Date()
  const ids = opts.companyId !== undefined ? [opts.companyId] : await activeCompanyIds(payload)
  const companies: CompanyRunResult[] = []
  for (const cid of ids) {
    try {
      companies.push(await runCompany(payload, cid, now, opts.force === true))
    } catch (err) {
      payload.logger.error({ msg: 'daily reminders failed for a PT', companyId: cid, err: (err as Error).message })
      const { date, hour } = companyClock(now, process.env.TZ || DEFAULT_TZ)
      companies.push({ companyId: cid, status: 'failed', date, hour, rules: {}, emails: 0 })
    }
  }
  const first = companies[0]
  const rules: Partial<Record<ReminderRule, RuleSummary>> = {}
  for (const c of companies)
    for (const [k, v] of Object.entries(c.rules) as Array<[ReminderRule, RuleSummary]>) {
      const r = (rules[k] ??= { subjects: 0, notified: 0 })
      r.subjects += v.subjects
      r.notified += v.notified
    }
  const clock = companyClock(now, process.env.TZ || DEFAULT_TZ)
  return {
    status: companies.some((c) => c.status === 'run') ? 'run' : (first?.status ?? 'disabled'),
    date: first?.date ?? clock.date,
    hour: first?.hour ?? clock.hour,
    rules,
    emails: companies.reduce((a, c) => a + c.emails, 0),
    companies,
  }
}
