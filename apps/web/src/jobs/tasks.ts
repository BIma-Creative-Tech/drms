import { sql } from '@payloadcms/db-postgres'
import type { TaskConfig } from 'payload'

import { purgeExpiredSelfies } from '@/domain/attendance/retention'
import { runDailyReminders } from '@/domain/reminders/service'
import { autoCloseReimburse } from '@/domain/expense/auto-close'

/**
 * Daily audit anchor (architecture §11 "daily audit hash anchor (optional)", ADR 0006 §5 first
 * step): logs yesterday's audit row count and the highest audit id to stdout → Loki, an external
 * record that later tampering with `audit_logs` would contradict. Read-only.
 *
 * Cron is evaluated in the PROCESS timezone (spike e: ScheduleConfig has no timezone; Cron is
 * built without one) → the worker runs with TZ=Asia/Makassar, so 00:05 = 00:05 WITA.
 */
export const auditDailyAnchorTask: TaskConfig<{
  input: Record<string, never>
  output: { day: string; rows: number; maxId: number }
}> = {
  slug: 'auditDailyAnchor',
  schedule: [{ cron: '5 0 * * *', queue: 'default' }],
  inputSchema: [],
  outputSchema: [
    { name: 'day', type: 'text', required: true },
    { name: 'rows', type: 'number', required: true },
    { name: 'maxId', type: 'number', required: true },
  ],
  handler: async ({ req }) => {
    const tz = process.env.TZ || 'Asia/Makassar'
    const res = (await req.payload.db.drizzle.execute(sql`
      SELECT ((now() AT TIME ZONE ${tz}) - interval '1 day')::date::text AS day,
             count(*) FILTER (
               WHERE (server_time AT TIME ZONE ${tz})::date = ((now() AT TIME ZONE ${tz}) - interval '1 day')::date
             )::int AS rows,
             coalesce(max(id), 0)::bigint::text AS max_id
      FROM audit_logs`)) as unknown as { rows: Array<{ day: string; rows: number; max_id: string }> }
    const r = res.rows[0] ?? { day: '', rows: 0, max_id: '0' }
    const output = { day: r.day, rows: Number(r.rows), maxId: Number(r.max_id) }
    req.payload.logger.info({ msg: 'audit daily anchor', ...output })
    return { output }
  },
}

/**
 * Outbound email to ONE app user, ALWAYS through the queue → sent by the worker (not in the web
 * request): SMTP latency/outages never block a request, and a send refused by the mailbox rate
 * guard (EmailRateLimitedError, src/email/rate-guard.ts) or a transient SMTP error is retried with
 * exponential backoff (150 s base, 6 attempts ≈ 2.6 h) instead of being lost.
 * The input holds the USER ID, not the address: Payload logs the job input on task errors, and
 * addresses must not end up in logs/Loki (PII); the address is resolved when sending. Inactive or
 * address-less users are skipped. From is forced by the adapter; without SMTP (dev) Payload's
 * console adapter logs the mail instead.
 */
export const sendEmailTask: TaskConfig<{
  input: { userId: number; subject: string; text: string }
  output: { messageId: string }
}> = {
  slug: 'sendEmail',
  inputSchema: [
    { name: 'userId', type: 'number', required: true },
    { name: 'subject', type: 'text', required: true, maxLength: 200 },
    { name: 'text', type: 'textarea', required: true, maxLength: 20_000 },
  ],
  outputSchema: [{ name: 'messageId', type: 'text' }],
  retries: { attempts: 6, backoff: { type: 'exponential', delay: 150_000 } },
  handler: async ({ input, req, job }) => {
    const user = await req.payload
      .findByID({ collection: 'users', id: input.userId, depth: 0, select: { email: true, active: true }, overrideAccess: true /* SYSTEM-READ: recipient address */, req })
      .catch(() => null)
    if (!user?.email || user.active === false) {
      req.payload.logger.warn({ msg: 'email skipped (user missing, inactive or without address)', jobId: job.id, userId: input.userId })
      return { output: { messageId: '' } }
    }
    const info = (await req.payload.sendEmail({ to: user.email, subject: input.subject, text: input.text })) as
      | { messageId?: string }
      | undefined
    const messageId = typeof info?.messageId === 'string' ? info.messageId : ''
    req.payload.logger.info({ msg: 'email sent', jobId: job.id, userId: input.userId, messageId })
    return { output: { messageId } }
  },
}

/**
 * Reimburse auto-close (architecture §5.2 DT → SE "auto after N days", §11 jobs; setting
 * reimburseAutoCloseDays). Daily 01:15 in the process TZ (Asia/Makassar, see auditDailyAnchor).
 * Idempotent: only requests still "Ditransfer" whose latest transfer is ≥ N days old are closed.
 */
export const reimburseAutoCloseTask: TaskConfig<{
  input: Record<string, never>
  output: { closed: number }
}> = {
  slug: 'reimburseAutoClose',
  schedule: [{ cron: '15 1 * * *', queue: 'default' }],
  inputSchema: [],
  outputSchema: [{ name: 'closed', type: 'number', required: true }],
  handler: async ({ req }) => {
    const ids = await autoCloseReimburse(req.payload)
    req.payload.logger.info({ msg: 'reimburse auto-close', closed: ids.length, ids })
    return { output: { closed: ids.length } }
  },
}

/**
 * E6 selfie retention (Q-33): daily 02:30 (process TZ). company-settings.selfieRetentionDeleteEnabled
 * OFF (default) = dry run (count only); ON = deletes at most selfieRetentionBatch selfie FILES older
 * than selfieRetentionMonths, marks the media rows removed and writes one `retention_purge` audit
 * row per run (domain/attendance/retention.ts). Attendance rows stay. Log = counts only (no ids/PII).
 */
export const selfieRetentionTask: TaskConfig<{
  input: Record<string, never>
  output: { months: number; cutoff: string; candidates: number; deleted: number }
}> = {
  slug: 'selfieRetention',
  schedule: [{ cron: '30 2 * * *', queue: 'default' }],
  inputSchema: [],
  outputSchema: [
    { name: 'months', type: 'number', required: true },
    { name: 'cutoff', type: 'text', required: true },
    { name: 'candidates', type: 'number', required: true },
    { name: 'deleted', type: 'number', required: true },
  ],
  handler: async ({ req }) => {
    const r = await purgeExpiredSelfies(req.payload)
    req.payload.logger.info({ msg: r.dryRun ? 'selfie retention (dry run)' : 'selfie retention', months: r.months, cutoff: r.cutoff, candidates: r.candidates, deleted: r.deleted, failed: r.failed, remaining: r.remaining })
    return { output: { months: r.months, cutoff: r.cutoff, candidates: r.candidates, deleted: r.deleted } }
  },
}

/**
 * E7 daily reminders (M12, US-11): the worker queues this every hour (process TZ); the domain runs
 * ONE pass per business day at/after company-settings.reminderHour and de-duplicates every delivery
 * (domain/reminders/service.ts). Log = counts per rule only (no names/ids of recipients).
 */
export const dailyRemindersTask: TaskConfig<{
  input: Record<string, never>
  output: { status: string; date: string; notified: number; emails: number }
}> = {
  slug: 'dailyReminders',
  schedule: [{ cron: '2 * * * *', queue: 'default' }],
  inputSchema: [],
  outputSchema: [
    { name: 'status', type: 'text', required: true },
    { name: 'date', type: 'text', required: true },
    { name: 'notified', type: 'number', required: true },
    { name: 'emails', type: 'number', required: true },
  ],
  handler: async ({ req }) => {
    const r = await runDailyReminders(req.payload)
    const notified = Object.values(r.rules).reduce((s, x) => s + (x?.notified ?? 0), 0)
    if (r.status === 'run') req.payload.logger.info({ msg: 'daily reminders', date: r.date, rules: r.rules, emails: r.emails })
    return { output: { status: r.status, date: r.date, notified, emails: r.emails } }
  },
}

export const tasks = [auditDailyAnchorTask, sendEmailTask, reimburseAutoCloseTask, selfieRetentionTask, dailyRemindersTask]
