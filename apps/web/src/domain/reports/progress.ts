import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { settings } from '@/domain/expense/common'
import { isComplete } from '@/domain/progress/rules'

import { num, projectBudgets, reportContext, rows, type ProjectBudget } from './kpi'
import { PROGRESS_LABELS, progressGap, progressTone, type ProgressTone } from './rules'
import { projectScopeSql, type ReportScope } from './scope'

/**
 * K-09 "Progress fisik vs anggaran" (US-12, docs/proyekkas/f3/kpi-definitions.md §K-09) — read-only
 * data for the dashboards (web UI in Sprint S2) and GET /api/v1/projects/progress:
 * selisih = K-08 (% Komitmen of RAB, same basis as the approval screen) − projects.progress_pct
 * (Σ weight × stage % from progress reports). Colour by company-settings progressWarnGapPct (0) /
 * progressBadGapPct (8). A project without RAB or without a complete (100 %) stage set is "none".
 * Scope = ReportScope (Finance/Direktur all, PM team), filtered in SQL like every F3 KPI.
 */
export type ProjectProgress = {
  id: number
  code: string
  name: string
  status: string
  budget: number | null
  committed: number
  budgetPct: number | null
  budgetTone: ProjectBudget['tone']
  progressPct: number
  weightSum: number
  stagesComplete: boolean
  gap: number | null
  tone: ProgressTone
  toneLabel: string
  lastReportDate: string | null
  reportCount: number
}

export async function projectProgressVsBudget(req: PayloadRequest, scope: ReportScope, opts: { projectId?: number; includeArchived?: boolean } = {}): Promise<{ warnGapPct: number; badGapPct: number; asOf: string; projects: ProjectProgress[] }> {
  const ctx = await reportContext(req)
  const s = (await settings(req)) as { progressWarnGapPct?: number | null; progressBadGapPct?: number | null }
  const warn = Number(s.progressWarnGapPct ?? 0)
  const bad = Number(s.progressBadGapPct ?? 8)
  const budgets = await projectBudgets(req, scope, opts)
  if (budgets.length === 0) return { warnGapPct: warn, badGapPct: bad, asOf: ctx.today, projects: [] }
  const extra = await rows(
    req,
    sql`SELECT p.id, coalesce(p.progress_pct, 0)::text AS progress,
          (SELECT coalesce(sum(st.weight_pct), 0) FROM project_stages st WHERE st.project_id = p.id AND st.active IS NOT FALSE)::text AS weight_sum,
          (SELECT max(r.report_date) FROM progress_reports r WHERE r.project_id = p.id) AS last_report,
          (SELECT count(*) FROM progress_reports r WHERE r.project_id = p.id)::int AS reports
        FROM projects p
        WHERE ${projectScopeSql(scope)} ${opts.projectId ? sql`AND p.id = ${opts.projectId}` : sql``}`,
  )
  const byId = new Map(extra.map((x) => [num(x.id), x]))
  return {
    warnGapPct: warn,
    badGapPct: bad,
    asOf: ctx.today,
    projects: budgets.map((b) => {
      const x = byId.get(b.id)
      const progressPct = num(x?.progress)
      const weightSum = num(x?.weight_sum)
      const stagesComplete = isComplete(weightSum)
      const gap = stagesComplete ? progressGap(b.pct, progressPct) : null
      const tone = progressTone(gap, warn, bad)
      return {
        id: b.id,
        code: b.code,
        name: b.name,
        status: b.status,
        budget: b.budget,
        committed: b.committed,
        budgetPct: b.pct,
        budgetTone: b.tone,
        progressPct,
        weightSum,
        stagesComplete,
        gap,
        tone,
        toneLabel: b.pct === null ? 'Tanpa RAB' : !stagesComplete ? 'Tahapan belum 100%' : PROGRESS_LABELS[tone],
        lastReportDate: x?.last_report ? String(x.last_report) : null,
        reportCount: num(x?.reports),
      }
    }),
  }
}
