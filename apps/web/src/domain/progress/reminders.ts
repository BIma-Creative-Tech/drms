import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { notificationTemplate, pushEnabled } from '@/domain/notifications'
import { DEFAULT_TZ } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

import { daysBetweenDates } from './rules'

/**
 * Hook points for E7 (US-11 "diingatkan bila laporan belum dibuat", plan fase1-golive §E7 (a)):
 * the scheduled job (E7, NOT here) decides when to run, reads `lateReportDays` from company-settings,
 * resolves recipients (PM + Direktur) and de-duplicates per day. This module only provides:
 * - `lateProgressProjects()`: running projects whose latest report (or start, when none) is older
 *   than `days` calendar days before `asOf` (company business dates, TZ-free text compare);
 * - `notifyLateProgressReport()`: writes the in-app rows of one project for the given users, event
 *   `progress.late_report` (text from notification-templates when active, else the default below).
 * Both run on the caller's transaction (call inside withReqTransaction / the job's transaction).
 */

export const LATE_REPORT_EVENT = 'progress.late_report'

const DEFAULT_TEXT = {
  title: 'Laporan progress terlambat: {code}',
  body: 'Project {code} {name} belum punya laporan progress selama {days} hari (terakhir: {last}).',
}

export type LateProject = { projectId: number; code: string; name: string; pmUserId: number | null; lastReportDate: string | null; since: string; daysSince: number }

export async function lateProgressProjects(req: PayloadRequest, opts: { asOf: string; days: number; timezone?: string }): Promise<LateProject[]> {
  const tz = opts.timezone ?? DEFAULT_TZ
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT p.id, p.code, p.name, p.pm_id,
           (SELECT max(r.report_date) FROM progress_reports r WHERE r.project_id = p.id) AS last_report,
           to_char(coalesce(p.start_date, p.created_at) AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS started
      FROM projects p
     WHERE p.status = 'berjalan'
     ORDER BY p.code, p.id`)) as unknown as { rows: Array<{ id: number; code: string; name: string; pm_id: number | null; last_report: string | null; started: string }> }
  const out: LateProject[] = []
  for (const x of r.rows) {
    const since = x.last_report ?? x.started
    const daysSince = daysBetweenDates(since, opts.asOf)
    if (daysSince >= opts.days) {
      out.push({ projectId: Number(x.id), code: x.code, name: x.name, pmUserId: x.pm_id === null ? null : Number(x.pm_id), lastReportDate: x.last_report, since, daysSince })
    }
  }
  return out
}

function render(tpl: string, p: LateProject): string {
  const vars: Record<string, string> = { code: p.code, name: p.name, days: String(p.daysSince), last: p.lastReportDate ?? 'belum ada' }
  return tpl.replace(/\{(code|name|days|last)\}/g, (_, k: string) => vars[k] ?? '')
}

/** In-app rows for one late project (no de-duplication here — E7 owns the schedule and dedup). */
export async function notifyLateProgressReport(req: PayloadRequest, project: LateProject, userIds: readonly number[]): Promise<number> {
  const t = await notificationTemplate(req, LATE_REPORT_EVENT, DEFAULT_TEXT)
  let n = 0
  for (const uid of new Set(userIds)) {
    await req.payload.create({
      collection: 'notifications',
      data: {
        user: uid,
        event: LATE_REPORT_EVENT,
        title: render(t.title, project).slice(0, 160),
        body: render(t.body, project).slice(0, 1000),
        docType: 'project',
        docId: String(project.projectId),
        docNo: project.code,
        pushStatus: pushEnabled() ? 'pending' : 'skipped',
      } as never,
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: scheduled reminder (E7)
      req,
    })
    n++
  }
  return n
}
