import type { PayloadRequest } from 'payload'

import { companiesWithRole, rolesIn } from '@/access/roles'
import { companyRefs, mayReadUntaggedAudit } from '@/domain/companies'
import { formatHours } from '@/domain/expense/sla'
import { approvalInbox } from '@/domain/expense/queues'
import { kindOf, PROJECT_KIND_LABELS } from '@/domain/field/rules'
import { loanDashboard } from '@/domain/loans/report'
import { loanInbox } from '@/domain/loans/service'
import { rapMissingProjects, rapMonitoring } from '@/domain/rap/budget'

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
import { slaThisMonth } from './sla-report'
import { narrowToSite, ownScope, roleScope, scopeCompanies, teamScope, type ReportScope } from './scope'
import { cashBySite, scopeSiteOptions, siteSummaries } from './sites'
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

// ---- DRMS 13/10 Wave 3 (dashboard parity APK ↔ web): the cards that used to load their own data in the admin view
// (dashboard-sla / -loans / -rap) are computed here, ONCE, for the web view and GET /api/v1/dashboard/* alike. Each
// keeps the scope it has on the web: NOT narrowed by the dashboard's site filter nor by the layout role.

/**
 * Item 11 (DRMS 10/10) "SLA transfer" (Direktur + Finance layouts): this month's transfers of the PTs where the caller
 * is Owner/Finance (`slaScope`), share within the PT's SLA since the final approval — same numbers as the report.
 */
export async function slaBlock(req: PayloadRequest) {
  const s = await slaThisMonth(req)
  return { ...s, avgText: formatHours(s.avgHours) }
}
export type SlaBlock = Awaited<ReturnType<typeof slaBlock>>

/**
 * ADR 0022 §9 "Pinjaman antar project" (Direktur, Finance, PM layouts): totals + top 5 projects by outstanding in
 * `loanScope` (office roles: their PTs, PM: team projects as borrower or lender); `waitingForMe` = loans waiting for
 * the caller's decision (Direktur only, G1 rules of the inbox).
 */
export async function loanBlock(req: PayloadRequest) {
  const d = await loanDashboard(req)
  const waitingForMe = (await loanInbox(req)).items.length
  return { totals: d.totals, projects: d.projects, waitingForMe }
}
export type LoanBlock = Awaited<ReturnType<typeof loanBlock>>

/**
 * D4 (owner 2026-10-11) "Project ber-RAB belum punya RAP": Direktur = every project the caller may read in the
 * selected PTs, PM (`team`) = the PM's team projects only (nudge). Top 8 + `total`.
 */
export async function rapMissingBlock(req: PayloadRequest, team: boolean) {
  const d = await rapMissingProjects(req, { teamOnly: team, limit: 8 })
  return { team, total: d.total, rows: d.rows.map((r) => ({ ...r, kindLabel: PROJECT_KIND_LABELS[kindOf(r.kind)] })) }
}
export type RapMissingBlock = Awaited<ReturnType<typeof rapMissingBlock>>

/** DRMS 10/10 point 2–4 "Monitoring RAP" (Direktur layout): projects with a RAP, realisation vs plan, top 8. */
export async function rapMonitoringBlock(req: PayloadRequest) {
  return rapMonitoring(req, { limit: 8 })
}
export type RapMonitoringBlock = Awaited<ReturnType<typeof rapMonitoringBlock>>

/**
 * ADR 0023 §5: `siteId` = the dashboard "Site" filter (next to the PT switcher) — narrows every scope-based card to
 * that site (requests / projects through the project's site, cash through the account's site flag); the per-PT
 * queues and closings keep their meaning. `sites` (filter options) and the per-site cash rows come from the
 * UN-narrowed scope.
 */
export async function ownerDashboard(req: PayloadRequest, opts: { months?: number; accountId?: number; siteId?: number } = {}) {
  const ctx = await reportContext(req)
  const BASE = await roleScope(req, ['pk-owner'])
  const ALL = narrowToSite(BASE, opts.siteId)
  const pts = scopeCompanies(ALL)
  const months = opts.months === 6 ? 6 : 12
  const flowRange = { from: addMonths(ctx.month, -(months - 1)), to: ctx.month, accountId: opts.accountId }
  const [balances, monthOps, pending, mine, lpj, flows, projects, costCenters, queue, book, disbursed, trend, statuses, categories, recent, companies, sla, loans, rapMon, rapMissing] = await inSequence(
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
    () => slaBlock(req),
    () => loanBlock(req),
    () => rapMonitoringBlock(req),
    () => rapMissingBlock(req, false),
  )
  const completeness = await completenessByCompany(req, ALL, firstDay(ctx.month), lastDay(ctx.month), lpj)
  const monthPt = flowsByCompany(balances.accounts, monthOps, pts)
  const siteOpts = await scopeSiteOptions(req, BASE)
  const siteCash = siteOpts.length ? cashBySite(siteOpts, visibleAccounts((await cashBalances(req, BASE, ctx.today)).accounts)) : []
  return {
    asOf: ctx.today,
    month: ctx.month,
    companies,
    sites: { options: siteOpts, selected: opts.siteId && siteOpts.some((x) => x.id === opts.siteId) ? opts.siteId : null, cash: siteCash, summary: siteOpts.length && !opts.siteId ? await siteSummaries(req, BASE, siteOpts, siteCash, ctx) : [] },
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
    // ADR 0028: + the intercompany part of each month (consolidated toggle "tanpa antar-PT" subtracts it; no elimination)
    cashFlow: { basis: 'K-02b' as const, months, rows: flows.map((f) => ({ period: f.period, masuk: f.masuk, keluar: f.keluar, masukAntarPt: f.masukAntarPt, keluarAntarPt: f.keluarAntarPt })) },
    projects,
    costCenters: costCenters.filter((c) => c.total !== 0 || c.fromRequests !== 0 || c.manualOut !== 0 || c.manualIn !== 0),
    transferQueue: queue,
    sla,
    loans,
    rapMonitoring: rapMon,
    rapMissing,
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

export async function financeDashboard(req: PayloadRequest, opts: { siteId?: number } = {}) {
  const ctx = await reportContext(req)
  const BASE = await roleScope(req, ['pk-finance'])
  const ALL = narrowToSite(BASE, opts.siteId)
  const pts = scopeCompanies(ALL)
  const from = addMonths(ctx.month, -5)
  const [queue, lpj, balances, monthBook, flows, lastClosed, disbursed, statuses, categories, recent, queueTop, companies, sla, loans] = await inSequence(
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
    () => slaBlock(req),
    () => loanBlock(req),
  )
  const completeness = await completenessByCompany(req, ALL, firstDay(ctx.month), lastDay(ctx.month), lpj)
  const siteOpts = await scopeSiteOptions(req, BASE)
  return {
    asOf: ctx.today,
    month: ctx.month,
    companies,
    // ADR 0023 Q-S7: per-site cash balance (accounts flagged with a site) + the site filter
    sites: {
      options: siteOpts,
      selected: opts.siteId && siteOpts.some((x) => x.id === opts.siteId) ? opts.siteId : null,
      cash: siteOpts.length ? cashBySite(siteOpts, visibleAccounts((await cashBalances(req, BASE, ctx.today)).accounts)) : [],
    },
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
    cashFlow: { basis: 'K-02a' as const, months: 6, rows: flows.map((f) => ({ period: f.period, masuk: f.masuk, keluar: f.keluar, koreksi: f.koreksi, masukAntarPt: f.masukAntarPt, keluarAntarPt: f.keluarAntarPt })) },
    lastClosedPeriod: lastClosed.period,
    lastClosedByCompany: lastClosed.byCompany,
    nextClosable: addMonths(ctx.month, -1),
    sla,
    loans,
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

export async function pmDashboard(req: PayloadRequest, opts: { siteId?: number } = {}) {
  const ctx = await reportContext(req)
  const BASE = await teamScope(req)
  // ADR 0023 §5: the site filter narrows the team scope (a PM still sees only team projects)
  const scope = narrowToSite(BASE, opts.siteId)
  const pts = scopeCompanies(scope)
  const from = addMonths(ctx.month, -5)
  const [mine, month, lpjRows, projects, costCenters, latest, trend, statuses, categories, waiting, companies, loans, rapMissing] = await inSequence(
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
    () => loanBlock(req),
    () => rapMissingBlock(req, true),
  )
  const monthPt = pts.length <= 1 ? pts.map((c) => ({ companyId: c, value: month })) : await perCompany(scope, (s) => teamMonth(req, s, ctx.month))
  const siteOpts = await scopeSiteOptions(req, BASE)
  return {
    asOf: ctx.today,
    month: ctx.month,
    companies,
    sites: { options: siteOpts, selected: opts.siteId && siteOpts.some((x) => x.id === opts.siteId) ? opts.siteId : null },
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
    loans,
    rapMissing,
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
