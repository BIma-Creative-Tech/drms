import type { PayloadRequest } from 'payload'

import { approvalInbox } from '@/domain/expense/queues'

import { auditLogPage } from './audit-log'
import {
  accountMonthFlows,
  advancesWithoutLpj,
  cashBalances,
  cashFlowMonthly,
  costCenterMonth,
  disbursedMonthly,
  inSequence,
  lastClosedPeriod,
  lpjSummary,
  masterGaps,
  ownRequests,
  pendingApprovals,
  projectBudgets,
  recentCashEntries,
  reportContext,
  requestRows,
  requestStatusCounts,
  requestTrendMonthly,
  spending,
  STAFF_ACTION_STATUSES,
  teamMonth,
  teamWaiting,
  transferQueueSummary,
  transferQueueTop,
  visibleAccounts,
  type ProjectBudget,
} from './kpi'
import { addMonths, firstDay, lastDay } from './rules'
import { ownScope, teamScope, type ReportScope } from './scope'
import { pipelineFromStatus, topWithOther } from './viz'

/**
 * Data of the role dashboards (wireframes §1–§4a). One function per layout, shared by the admin
 * "Beranda" view and GET /api/v1/dashboard/{owner,finance,pm,me}. Call inside a transaction.
 * Every number is a KPI of kpi-definitions.md; click targets are built by the view (C9).
 */
const ALL: ReportScope = { kind: 'all' }

/** "Menunggu saya" (K-10): the caller's approval inbox (G1/G2 + delegation, F2) — count + first rows. */
async function waitingForMe(req: PayloadRequest, top = 6) {
  const items = (await approvalInbox(req)).items
  return {
    count: items.length,
    items: items.slice(0, top).map((i) => ({
      id: i.id,
      docNo: i.docNo,
      title: i.title,
      type: i.type,
      status: i.status,
      statusLabel: i.statusLabel,
      step: i.step,
      scopeName: i.scope,
      requesters: i.requesters,
      grandTotal: i.grandTotal,
      requestDate: i.requestDate,
      overWarn: i.budget.overWarn,
    })),
  }
}

/** Categories of K-17 (Dicairkan) in [from, to], top 6 + "Lainnya" (chart "Komposisi biaya"). */
async function categoryMix(req: PayloadRequest, scope: ReportScope, from: string, to: string) {
  const s = await spending(req, scope, { from, to, basis: 'dicairkan', group: 'kategori' })
  const items = topWithOther(
    s.items.filter((i) => i.total > 0).map((i) => ({ label: i.label, value: i.total, key: i.key })),
    6,
  ).map((i) => ({ label: i.label, total: i.value, other: i.other, categoryId: i.item && /^\d+$/.test(i.item.key) ? Number(i.item.key) : null }))
  return { from, to, total: s.total, includesManual: s.includesManual, items }
}

/** Σ over projects with a budget (running): RAB, Komitmen, Realisasi (KPI "Realisasi vs anggaran"). */
function budgetTotals(projects: ProjectBudget[]) {
  const withBudget = projects.filter((p) => p.status === 'berjalan' && p.budget && p.budget > 0)
  return {
    projects: withBudget.length,
    budget: withBudget.reduce((s, p) => s + (p.budget ?? 0), 0),
    committed: withBudget.reduce((s, p) => s + p.committed, 0),
    realized: withBudget.reduce((s, p) => s + p.realized, 0),
  }
}

export async function ownerDashboard(req: PayloadRequest, opts: { months?: number; accountId?: number } = {}) {
  const ctx = await reportContext(req)
  const months = opts.months === 6 ? 6 : 12
  const flowRange = { from: addMonths(ctx.month, -(months - 1)), to: ctx.month, accountId: opts.accountId }
  const [balances, monthOps, pending, mine, lpj, flows, projects, costCenters, queue, book, disbursed, trend, statuses, categories, recent] = await inSequence(
    () => cashBalances(req, ctx.today),
    () => accountMonthFlows(req, ctx.month, 'operational'),
    () => pendingApprovals(req, ALL),
    () => waitingForMe(req),
    () => lpjSummary(req, ALL, firstDay(ctx.month), lastDay(ctx.month)),
    () => cashFlowMonthly(req, flowRange, 'operational'),
    () => projectBudgets(req, ALL),
    () => costCenterMonth(req, ALL, ctx.month),
    () => transferQueueSummary(req),
    () => cashFlowMonthly(req, { from: flowRange.from, to: flowRange.to }, 'book'),
    () => disbursedMonthly(req, ALL, flowRange.from, ctx.month),
    () => requestTrendMonthly(req, ALL, flowRange.from, ctx.month),
    () => requestStatusCounts(req, ALL),
    () => categoryMix(req, ALL, firstDay(flowRange.from), ctx.today),
    () => recentCashEntries(req, ALL, 8),
  )
  const running = projects.filter((p) => p.status === 'berjalan')
  const count = (t: string) => running.filter((p) => p.tone === t).length
  return {
    asOf: ctx.today,
    month: ctx.month,
    cash: {
      total: balances.total,
      accounts: visibleAccounts(balances.accounts).map((a) => ({ id: a.id, name: a.name, active: a.active, balance: a.balance })),
      monthIn: [...monthOps.values()].reduce((s, x) => s + x.masuk, 0),
      monthOut: [...monthOps.values()].reduce((s, x) => s + x.keluar, 0),
    },
    budget: { running: running.length, over: count('over'), warn: count('warn'), ok: count('ok'), none: count('none') },
    completeness: {
      ratioDone: lpj.ratio.done,
      ratioTotal: lpj.ratio.total,
      withoutLpj: lpj.withoutLpj.count,
      overdue: lpj.overdue.count,
      reimburseToVerify: lpj.reimburseToVerify,
      openWarnings: lpj.openWarnings,
    },
    approvals: {
      count: pending.count,
      sum: pending.sum,
      waitingForMe: mine.count,
      oldestDays: pending.oldestDays,
      pendingAck: pending.pendingAck,
      pendingApproval: pending.pendingApproval,
    },
    cashFlow: { basis: 'K-02b' as const, months, rows: flows.map((f) => ({ period: f.period, masuk: f.masuk, keluar: f.keluar })) },
    projects,
    costCenters: costCenters.filter((c) => c.total !== 0 || c.fromRequests !== 0 || c.manualOut !== 0 || c.manualIn !== 0),
    transferQueue: queue,
    viz: {
      balanceTrend: book.map((f) => ({ period: f.period, balance: f.closingBalance ?? 0 })),
      disbursed: disbursed.map((d) => ({ period: d.period, net: d.net })),
      requestTrend: trend,
      pipeline: pipelineFromStatus(statuses),
      categories,
      budgetTotals: budgetTotals(projects),
      recentCash: recent,
      inbox: mine.items,
      warnPct: ctx.budgetWarnPct,
    },
  }
}

export async function financeDashboard(req: PayloadRequest) {
  const ctx = await reportContext(req)
  const from = addMonths(ctx.month, -5)
  const [queue, lpj, balances, monthBook, flows, lastClosed, disbursed, statuses, categories, recent, queueTop] = await inSequence(
    () => transferQueueSummary(req),
    () => lpjSummary(req, ALL, firstDay(ctx.month), lastDay(ctx.month)),
    () => cashBalances(req, ctx.today),
    () => accountMonthFlows(req, ctx.month, 'book'),
    () => cashFlowMonthly(req, { from, to: ctx.month }, 'book'),
    () => lastClosedPeriod(req),
    () => disbursedMonthly(req, ALL, from, ctx.month),
    () => requestStatusCounts(req, ALL),
    () => categoryMix(req, ALL, firstDay(from), ctx.today),
    () => recentCashEntries(req, ALL, 8),
    () => transferQueueTop(req, ALL, 6),
  )
  return {
    asOf: ctx.today,
    month: ctx.month,
    transferQueue: queue,
    reimburseToVerify: { count: queue.reimburseToVerify, warnings: queue.reimburseToVerifyWarnings },
    lpjToVerify: lpj.lpjToVerify,
    lpjToSettle: lpj.lpjToSettle,
    accounts: visibleAccounts(balances.accounts).map((a) => ({ id: a.id, name: a.name, active: a.active, balance: a.balance, monthIn: monthBook.get(a.id)?.masuk ?? 0, monthOut: monthBook.get(a.id)?.keluar ?? 0 })),
    cashTotal: balances.total,
    advancesWithoutLpj: lpj.rows,
    lpjDueDays: ctx.lpjDueDays,
    cashFlow: { basis: 'K-02a' as const, months: 6, rows: flows.map((f) => ({ period: f.period, masuk: f.masuk, keluar: f.keluar, koreksi: f.koreksi })) },
    lastClosedPeriod: lastClosed,
    nextClosable: addMonths(ctx.month, -1),
    viz: {
      balanceTrend: flows.map((f) => ({ period: f.period, balance: f.closingBalance ?? 0 })),
      disbursed: disbursed.map((d) => ({ period: d.period, net: d.net })),
      pipeline: pipelineFromStatus(statuses),
      categories,
      recentCash: recent,
      transferTop: queueTop,
    },
  }
}

export async function pmDashboard(req: PayloadRequest) {
  const ctx = await reportContext(req)
  const scope = await teamScope(req)
  const from = addMonths(ctx.month, -5)
  const [mine, month, lpjRows, projects, costCenters, latest, trend, statuses, categories, waiting] = await inSequence(
    () => waitingForMe(req),
    () => teamMonth(req, scope, ctx.month),
    () => advancesWithoutLpj(req, scope),
    () => projectBudgets(req, scope),
    () => costCenterMonth(req, scope, ctx.month),
    () => requestRows(req, scope, { from: '0000-01-01', to: '9999-12-31' }, { limit: 10 }),
    () => requestTrendMonthly(req, scope, from, ctx.month),
    () => requestStatusCounts(req, scope),
    () => categoryMix(req, scope, firstDay(from), ctx.today),
    () => teamWaiting(req, scope),
  )
  return {
    asOf: ctx.today,
    month: ctx.month,
    hasScope: scope.kind === 'team' && (scope.projects.length > 0 || scope.costCenters.length > 0),
    /** ADR 0013: always 0 for requests under the Direktur → Finance flow (PM never decides); kept for API compatibility. */
    waitingForMe: mine.count,
    /** S3e (US-17, S-01): team requests waiting for the Direktur / Finance (monitoring, oldest first). */
    teamWaiting: waiting,
    teamMonth: month,
    lpj: { withoutLpj: lpjRows.length, overdue: lpjRows.filter((r) => r.overdue).length, lpjDueDays: ctx.lpjDueDays },
    projects,
    costCenters,
    latest,
    attendance: { available: false as const, phase: 'F5' },
    progressReports: { available: false as const, phase: 'F5' },
    viz: { requestTrend: trend, pipeline: pipelineFromStatus(statuses), categories, budgetTotals: budgetTotals(projects), inbox: mine.items, warnPct: ctx.budgetWarnPct },
  }
}

export async function staffDashboard(req: PayloadRequest) {
  const ctx = await reportContext(req)
  const scope = await ownScope(req)
  const [actions, latest, trend, statuses] = await inSequence(
    () => ownRequests(req, scope, { statuses: STAFF_ACTION_STATUSES, limit: 20 }),
    () => ownRequests(req, scope, { limit: 10 }),
    () => requestTrendMonthly(req, scope, addMonths(ctx.month, -5), ctx.month),
    () => requestStatusCounts(req, scope),
  )
  return { actions, latest, month: ctx.month, viz: { requestTrend: trend, pipeline: pipelineFromStatus(statuses) } }
}

export async function adminDashboard(req: PayloadRequest) {
  const ctx = await reportContext(req)
  const [gaps, audit] = await inSequence(() => masterGaps(req), () => auditLogPage(req, { from: addDaysSafe(ctx.today, -30), to: ctx.today }, { limit: 20 }))
  return { gaps, latestAudit: audit.rows }
}

function addDaysSafe(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
