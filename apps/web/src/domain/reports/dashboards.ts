import type { PayloadRequest } from 'payload'

import { companiesWithRole, rolesIn } from '@/access/roles'
import { companyRefs, mayReadUntaggedAudit } from '@/domain/companies'
import { approvalInbox } from '@/domain/expense/queues'

import { auditLogPage } from './audit-log'
import {
  accountMonthFlows,
  advancesWithoutLpj,
  cashBalances,
  cashFlowMonthly,
  costCenterMonth,
  disbursedMonthly,
  byCompany,
  companyCtx,
  inSequence,
  lastClosedPeriod,
  lpjSummary,
  masterGaps,
  perCompany,
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
import { ownScope, roleScope, scopeCompanies, teamScope, type ReportScope } from './scope'
import { pipelineFromStatus, topWithOther } from './viz'

/**
 * Data of the role dashboards (wireframes §1–§4a). One function per layout, shared by the admin
 * "Beranda" view and GET /api/v1/dashboard/{owner,finance,pm,me}. Call inside a transaction.
 * Every number is a KPI of kpi-definitions.md; click targets are built by the view (C9).
 *
 * MC2 (ADR 0016 §6, requirements v1.2 §5 "Beranda", wireframes MC §5): each layout reads the PTs
 * where the caller holds THAT role (Owner layout: pk-owner PTs; Finance: pk-finance PTs; PM: pk-pm
 * PTs, team only; Staff: own requests per PT; Admin: pk-admin PTs). Every payload carries
 * `companies` (the PTs covered) and `byCompany` rows next to the combined totals (Σ per PT = total).
 */

/** "Menunggu saya" (K-10): the caller's approval inbox (G1/G2 + delegation, F2) — count + first rows. */
async function waitingForMe(req: PayloadRequest, top = 6) {
  const items = (await approvalInbox(req)).items
  return {
    count: items.length,
    byCompany: byCompany(
      items.map((i) => ({ companyId: i.company?.id ?? 0 })),
      () => 1,
    ),
    items: items.slice(0, top).map((i) => ({
      id: i.id,
      company: i.company,
      docNo: i.docNo,
      title: i.title,
      type: i.type,
      status: i.status,
      statusLabel: i.statusLabel,
      step: i.step,
      stepLabel: i.stepLabel,
      scopeName: i.scope,
      requesters: i.requesters,
      grandTotal: i.grandTotal,
      requestDate: i.requestDate,
      overWarn: i.budget.overWarn,
    })),
  }
}

/**
 * MC4: K-08 "Waspada" threshold per PT of the layout (the top-level `viz.warnPct` stays the context
 * PT's value for released clients; project tones are already computed with the project's PT).
 */
async function warnPctByCompany(req: PayloadRequest, companyIds: readonly number[]) {
  const out: Array<{ companyId: number; warnPct: number }> = []
  for (const c of companyIds) out.push({ companyId: c, warnPct: (await companyCtx(req, c)).budgetWarnPct })
  return out
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

/** Month in/out per PT from the per-account flows (accounts belong to one PT). */
function flowsByCompany(accounts: Array<{ id: number; companyId: number }>, flows: Map<number, { masuk: number; keluar: number }>, companyIds: number[]) {
  const pt = new Map(accounts.map((a) => [a.id, a.companyId]))
  return companyIds.map((c) => {
    let masuk = 0
    let keluar = 0
    for (const [acc, f] of flows) {
      if (pt.get(acc) !== c) continue
      masuk += f.masuk
      keluar += f.keluar
    }
    return { companyId: c, masuk, keluar }
  })
}

/** Project budget colour counts (running projects), combined and per PT. */
function budgetCounts(projects: ProjectBudget[], companyIds: number[]) {
  const counts = (list: ProjectBudget[]) => {
    const running = list.filter((p) => p.status === 'berjalan')
    const count = (t: string) => running.filter((p) => p.tone === t).length
    return { running: running.length, over: count('over'), warn: count('warn'), ok: count('ok'), none: count('none') }
  }
  return { ...counts(projects), byCompany: companyIds.map((c) => ({ companyId: c, ...counts(projects.filter((p) => p.companyId === c)) })) }
}

/** Per-PT K-12 completeness (one lpjSummary per PT; one PT → the combined value, no extra query). */
async function completenessByCompany(req: PayloadRequest, scope: ReportScope, from: string, to: string, combined: Awaited<ReturnType<typeof lpjSummary>>) {
  const pts = scopeCompanies(scope)
  const list = pts.length === 1 ? [{ companyId: pts[0]!, value: combined }] : await perCompany(scope, (s) => lpjSummary(req, s, from, to))
  return list.map(({ companyId, value: l }) => ({
    companyId,
    ratioDone: l.ratio.done,
    ratioTotal: l.ratio.total,
    withoutLpj: l.withoutLpj.count,
    overdue: l.overdue.count,
    lpjToVerify: l.lpjToVerify,
    reimburseToVerify: l.reimburseToVerify,
    openWarnings: l.openWarnings,
  }))
}

export async function ownerDashboard(req: PayloadRequest, opts: { months?: number; accountId?: number } = {}) {
  const ctx = await reportContext(req)
  const ALL = await roleScope(req, ['pk-owner'])
  const pts = scopeCompanies(ALL)
  const months = opts.months === 6 ? 6 : 12
  const flowRange = { from: addMonths(ctx.month, -(months - 1)), to: ctx.month, accountId: opts.accountId }
  const [balances, monthOps, pending, mine, lpj, flows, projects, costCenters, queue, book, disbursed, trend, statuses, categories, recent, companies] = await inSequence(
    () => cashBalances(req, ALL, ctx.today),
    () => accountMonthFlows(req, ALL, ctx.month, 'operational'),
    () => pendingApprovals(req, ALL),
    () => waitingForMe(req),
    () => lpjSummary(req, ALL, firstDay(ctx.month), lastDay(ctx.month)),
    () => cashFlowMonthly(req, ALL, flowRange, 'operational'),
    () => projectBudgets(req, ALL),
    () => costCenterMonth(req, ALL, ctx.month),
    () => transferQueueSummary(req, ALL),
    () => cashFlowMonthly(req, ALL, { from: flowRange.from, to: flowRange.to }, 'book'),
    () => disbursedMonthly(req, ALL, flowRange.from, ctx.month),
    () => requestTrendMonthly(req, ALL, flowRange.from, ctx.month),
    () => requestStatusCounts(req, ALL),
    () => categoryMix(req, ALL, firstDay(flowRange.from), ctx.today),
    () => recentCashEntries(req, ALL, 8),
    () => companyRefs(req, pts),
  )
  const completeness = await completenessByCompany(req, ALL, firstDay(ctx.month), lastDay(ctx.month), lpj)
  const monthPt = flowsByCompany(balances.accounts, monthOps, pts)
  return {
    asOf: ctx.today,
    month: ctx.month,
    companies,
    cash: {
      total: balances.total,
      accounts: visibleAccounts(balances.accounts).map((a) => ({ id: a.id, companyId: a.companyId, name: a.name, active: a.active, balance: a.balance })),
      monthIn: [...monthOps.values()].reduce((s, x) => s + x.masuk, 0),
      monthOut: [...monthOps.values()].reduce((s, x) => s + x.keluar, 0),
      byCompany: balances.byCompany.map((b) => ({ companyId: b.companyId, total: b.total, monthIn: monthPt.find((m) => m.companyId === b.companyId)?.masuk ?? 0, monthOut: monthPt.find((m) => m.companyId === b.companyId)?.keluar ?? 0 })),
    },
    budget: budgetCounts(projects, pts),
    completeness: {
      ratioDone: lpj.ratio.done,
      ratioTotal: lpj.ratio.total,
      withoutLpj: lpj.withoutLpj.count,
      overdue: lpj.overdue.count,
      reimburseToVerify: lpj.reimburseToVerify,
      openWarnings: lpj.openWarnings,
      byCompany: completeness,
    },
    approvals: {
      count: pending.count,
      sum: pending.sum,
      waitingForMe: mine.count,
      oldestDays: pending.oldestDays,
      pendingAck: pending.pendingAck,
      pendingApproval: pending.pendingApproval,
      byCompany: pending.byCompany,
      waitingForMeByCompany: mine.byCompany,
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
      warnPctByCompany: await warnPctByCompany(req, pts),
    },
  }
}

export async function financeDashboard(req: PayloadRequest) {
  const ctx = await reportContext(req)
  const ALL = await roleScope(req, ['pk-finance'])
  const pts = scopeCompanies(ALL)
  const from = addMonths(ctx.month, -5)
  const [queue, lpj, balances, monthBook, flows, lastClosed, disbursed, statuses, categories, recent, queueTop, companies] = await inSequence(
    () => transferQueueSummary(req, ALL),
    () => lpjSummary(req, ALL, firstDay(ctx.month), lastDay(ctx.month)),
    () => cashBalances(req, ALL, ctx.today),
    () => accountMonthFlows(req, ALL, ctx.month, 'book'),
    () => cashFlowMonthly(req, ALL, { from, to: ctx.month }, 'book'),
    () => lastClosedPeriod(req, pts),
    () => disbursedMonthly(req, ALL, from, ctx.month),
    () => requestStatusCounts(req, ALL),
    () => categoryMix(req, ALL, firstDay(from), ctx.today),
    () => recentCashEntries(req, ALL, 8),
    () => transferQueueTop(req, ALL, 6),
    () => companyRefs(req, pts),
  )
  const completeness = await completenessByCompany(req, ALL, firstDay(ctx.month), lastDay(ctx.month), lpj)
  return {
    asOf: ctx.today,
    month: ctx.month,
    companies,
    transferQueue: queue,
    reimburseToVerify: { count: queue.reimburseToVerify, warnings: queue.reimburseToVerifyWarnings },
    lpjToVerify: lpj.lpjToVerify,
    lpjToSettle: lpj.lpjToSettle,
    completenessByCompany: completeness,
    accounts: visibleAccounts(balances.accounts).map((a) => ({ id: a.id, companyId: a.companyId, name: a.name, active: a.active, balance: a.balance, monthIn: monthBook.get(a.id)?.masuk ?? 0, monthOut: monthBook.get(a.id)?.keluar ?? 0 })),
    cashTotal: balances.total,
    cashByCompany: balances.byCompany,
    advancesWithoutLpj: lpj.rows,
    lpjDueDays: ctx.lpjDueDays,
    cashFlow: { basis: 'K-02a' as const, months: 6, rows: flows.map((f) => ({ period: f.period, masuk: f.masuk, keluar: f.keluar, koreksi: f.koreksi })) },
    lastClosedPeriod: lastClosed.period,
    lastClosedByCompany: lastClosed.byCompany,
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
  const pts = scopeCompanies(scope)
  const from = addMonths(ctx.month, -5)
  const [mine, month, lpjRows, projects, costCenters, latest, trend, statuses, categories, waiting, companies] = await inSequence(
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
    () => companyRefs(req, pts),
  )
  const monthPt = pts.length <= 1 ? pts.map((c) => ({ companyId: c, value: month })) : await perCompany(scope, (s) => teamMonth(req, s, ctx.month))
  return {
    asOf: ctx.today,
    month: ctx.month,
    companies,
    hasScope: scope.kind === 'team' && (scope.projects.length > 0 || scope.costCenters.length > 0),
    /** ADR 0021: the PM's own "Persetujuan PM" steps (0 on Direktur → Finance requests, ADR 0013). */
    waitingForMe: mine.count,
    /** S3e (US-17, S-01): team requests waiting for the PM / Direktur / Finance (oldest first). */
    teamWaiting: waiting,
    teamMonth: month,
    teamMonthByCompany: monthPt.map((m) => ({ companyId: m.companyId, ...m.value })),
    lpj: { withoutLpj: lpjRows.length, overdue: lpjRows.filter((r) => r.overdue).length, lpjDueDays: ctx.lpjDueDays },
    projects,
    costCenters,
    latest,
    attendance: { available: false as const, phase: 'F5' },
    progressReports: { available: false as const, phase: 'F5' },
    viz: {
      requestTrend: trend,
      pipeline: pipelineFromStatus(statuses),
      categories,
      budgetTotals: budgetTotals(projects),
      inbox: mine.items,
      warnPct: ctx.budgetWarnPct,
      warnPctByCompany: await warnPctByCompany(req, pts),
    },
  }
}

export async function staffDashboard(req: PayloadRequest) {
  const ctx = await reportContext(req)
  const scope = await ownScope(req)
  const [actions, latest, trend, statuses, companies] = await inSequence(
    () => ownRequests(req, scope, { statuses: STAFF_ACTION_STATUSES, limit: 20 }),
    () => ownRequests(req, scope, { limit: 10 }),
    () => requestTrendMonthly(req, scope, addMonths(ctx.month, -5), ctx.month),
    () => requestStatusCounts(req, scope),
    () => companyRefs(req, scopeCompanies(scope)),
  )
  return { companies, actions, latest, month: ctx.month, viz: { requestTrend: trend, pipeline: pipelineFromStatus(statuses) } }
}

/** Admin home: onboarding gaps + latest audit rows of the PTs where the caller is Admin (+ rows without PT). */
export async function adminDashboard(req: PayloadRequest) {
  const ctx = await reportContext(req)
  const pts = companiesWithRole(req, ['pk-admin'])
  const includeUntagged = pts.some((c) => rolesIn(req, c).includes('pk-admin')) && (await mayReadUntaggedAudit(req)) // QA-MC4-03
  const [gaps, audit, companies] = await inSequence(
    () => masterGaps(req, pts),
    () => auditLogPage(req, { from: addDaysSafe(ctx.today, -30), to: ctx.today, companyIds: pts, includeUntagged }, { limit: 20 }),
    () => companyRefs(req, pts),
  )
  return { companies, gaps, latestAudit: audit.rows }
}

function addDaysSafe(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
