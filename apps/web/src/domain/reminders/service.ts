import { sql } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'

import { notificationTemplate, pushEnabled } from '@/domain/notifications'
import { lateProgressProjects, LATE_REPORT_EVENT, notifyLateProgressReport } from '@/domain/progress/reminders'
import { projectBudgets } from '@/domain/reports/kpi'
import { daysBetween } from '@/domain/reports/rules'
import { statusLabel, type RequestStatus, type RequestType } from '@/domain/expense/types'
import { formatRupiah } from '@/lib/money'
import { withSystemTransaction } from '@/lib/system-tx'
import { DEFAULT_TZ } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

import { companyClock, crossedThresholds, DEFAULT_TEXTS, fill, REMINDER_EVENTS, reminderSettingsOf, runDecision, type ReminderRule, type ReminderSettings } from './rules'

/**
 * E7 — daily scheduled reminders (M12, US-11; plan fase1-golive §E7). Job `dailyReminders` fires
 * hourly (worker, process TZ); ONE run per business day happens at/after company-settings.reminderHour
 * (company timezone). The whole run is one transaction under an advisory lock:
 *   (a) late_progress    running project without progress report ≥ lateReportDays → PM + Direktur
 *   (b) lpj_overdue      Uang Muka `transferred`/`receipts_complete`, first posted transfer > lpjDueDays
 *                        → requesters' accounts + creator + Finance
 *   (c) revision_pending Revisi Nota / LPJ Revisi unchanged ≥ reminderRevisionDays → requesters + creator
 *   (d) budget_threshold project commitment (K-07/K-08) ≥ budgetWarnPct / budgetOverPct → Direktur +
 *                        Finance + PM, once per threshold per project (not per day)
 * Idempotency: `reminder_deliveries` (rule, subject, period, user) primary key — a recipient gets a
 * rule's reminder for a subject at most once per business day (budget: once per threshold), even when
 * the job is re-run or forced. Recipients are ACTIVE users only; archived projects (and requests of
 * archived projects) produce nothing. Channels: in-app notification always (push status per
 * PUSH_FCM_ENABLED), email via the sendEmail queue when reminderEmailEnabled. Logs carry counts only.
 */
export type RuleSummary = { subjects: number; notified: number }
export type ReminderRunResult = {
  status: 'run' | 'disabled' | 'before_hour' | 'already_ran'
  date: string
  hour: number
  rules: Partial<Record<ReminderRule, RuleSummary>>
  emails: number
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

async function roleHolders(req: PayloadRequest, role: string): Promise<number[]> {
  const r = await q<{ id: number }>(req, sql`SELECT DISTINCT u.id FROM users u JOIN users_roles ur ON ur.parent_id = u.id WHERE ur.value::text = ${role} AND coalesce(u.active, true) ORDER BY u.id`)
  return r.map((x) => Number(x.id))
}

/** Creator + accounts of the "Diajukan Oleh" employees of a request. */
async function requestPeople(req: PayloadRequest, requestId: number): Promise<number[]> {
  const r = await q<{ id: number }>(
    req,
    sql`SELECT er.created_by_id AS id FROM expense_requests er WHERE er.id = ${requestId} AND er.created_by_id IS NOT NULL
        UNION
        SELECT u.id FROM expense_requests_rels rr JOIN users u ON u.employee_id = rr.employees_id
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

async function inApp(req: PayloadRequest, event: string, userIds: number[], m: Msg): Promise<void> {
  for (const uid of userIds) {
    await req.payload.create({
      collection: 'notifications',
      data: { user: uid, event, title: m.title.slice(0, 160), body: m.body.slice(0, 1000), docType: m.docType, docId: m.docId, docNo: m.docNo, pushStatus: pushEnabled() ? 'pending' : 'skipped' } as never,
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
        input: { userId: uid, subject: `ProyekKas — ${m.title}`.slice(0, 200), text: `${m.body}\n\n${base ? `Buka ProyekKas: ${base}\n\n` : ''}Email otomatis pengingat harian ProyekKas.\n` },
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
  const owners = await roleHolders(req, 'pk-owner')
  const late = await lateProgressProjects(req, { asOf: date, days: s.lateProgress.days, timezone: s.timeZone })
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
  const finance = await roleHolders(req, 'pk-finance')
  const rows = await q<ReqRow>(
    req,
    sql`SELECT er.id, er.doc_no, er.title, er.type::text AS type, er.status::text AS status,
               (SELECT min(t.transfer_date) FROM transfers t WHERE t.request_id = er.id AND t.status = 'posted' AND t.kind = 'advance') AS since
          FROM expense_requests er LEFT JOIN projects p ON p.id = er.project_id
         WHERE er.type = 'advance' AND er.status::text IN ('transferred', 'receipts_complete')
           AND (p.id IS NULL OR p.status::text <> 'arsip')
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
      await inApp(req, REMINDER_EVENTS.lpj_overdue, userIds, m)
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
         WHERE er.status::text IN ('receipt_revision', 'lpj_revision')
           AND (p.id IS NULL OR p.status::text <> 'arsip')
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
      await inApp(req, REMINDER_EVENTS.revision_pending, userIds, m)
      return m
    })
  }
}

async function budgetThreshold(run: Run) {
  const { req, s } = run
  const office = [...(await roleHolders(req, 'pk-owner')), ...(await roleHolders(req, 'pk-finance'))]
  const projects = await projectBudgets(req, { kind: 'all' }) // archived projects excluded (K-08)
  const pms = new Map((await q<{ id: number; pm_id: number | null }>(req, sql`SELECT id, pm_id FROM projects`)).map((x) => [Number(x.id), x.pm_id === null ? null : Number(x.pm_id)]))
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
      await inApp(req, REMINDER_EVENTS.budget_threshold, userIds, m)
      await run.email(userIds, m)
    }
    const r = (run.rules.budget_threshold ??= { subjects: 0, notified: 0 })
    r.subjects++
    r.notified += top.size
  }
}

// ---------------------------------------------------------------- run

export async function reminderSettings(payload: Payload, req?: PayloadRequest): Promise<ReminderSettings> {
  const s = (await payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: reminder settings (job) */, req })) as unknown as Record<string, unknown>
  return reminderSettingsOf(s, process.env.TZ || DEFAULT_TZ)
}

/**
 * One tick of the job. `now` = injectable clock (fake-clock tests); `force` ignores the hour and the
 * "already ran today" marker (deliveries stay de-duplicated) — tests and manual re-runs only.
 */
export async function runDailyReminders(payload: Payload, opts: { now?: Date; force?: boolean } = {}): Promise<ReminderRunResult> {
  const now = opts.now ?? new Date()
  const s = await reminderSettings(payload)
  const { date, hour } = companyClock(now, s.timeZone)
  const base: ReminderRunResult = { status: 'run', date, hour, rules: {}, emails: 0 }
  if (!s.enabled) return { ...base, status: 'disabled' }
  if (!opts.force && hour < s.hour) return { ...base, status: 'before_hour' }
  return withSystemTransaction(
    payload,
    null,
    async (req) => {
      const tx = await getRequestTx(req)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('pk:daily-reminders', 0))`)
      const ran = await q(req, sql`SELECT 1 FROM reminder_runs WHERE run_date = ${date}`)
      const decision = opts.force ? 'run' : runDecision(s, hour, ran.length > 0)
      if (decision !== 'run') return { ...base, status: decision }
      const run = new Run(req, s, date)
      if (s.lateProgress.enabled) await lateProgress(run)
      if (s.lpjOverdue.enabled) await lpjOverdue(run)
      if (s.revision.enabled) await revisionPending(run)
      if (s.budget.enabled) await budgetThreshold(run)
      const result: ReminderRunResult = { ...base, rules: run.rules, emails: run.emails }
      await tx.execute(
        sql`INSERT INTO reminder_runs (run_date, summary) VALUES (${date}, ${JSON.stringify({ rules: run.rules, emails: run.emails })}::jsonb)
            ON CONFLICT (run_date) DO UPDATE SET summary = EXCLUDED.summary, finished_at = clock_timestamp()`,
      )
      return result
    },
    { auditSource: 'job' },
  )
}
