import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { BUDGET_COMMITTED, type RequestStatus, type RequestType } from '@/domain/expense/types'
import { settings, today } from '@/domain/expense/common'
import { DEFAULT_TZ } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

import { budgetPct, budgetTone, daysBetween, firstDay, lastDay, periodRange, type BudgetTone } from './rules'
import { cashScopeSql, costCenterScopeSql, includesManualCash, inList, projectScopeSql, requestScopeSql, type ReportScope, type SQL } from './scope'

/**
 * KPI queries of the F3 dashboards and reports — one function per KPI of
 * docs/proyekkas/f3/kpi-definitions.md (K-01 … K-17). Rules:
 * - C1: sums in SQL as numeric → text → Number (Rupiah are integers ≤ MAX_SAFE_INTEGER);
 * - C2: business dates are text 'YYYY-MM-DD' (compared lexically); timestamps are bucketed in the
 *   company timezone (`AT TIME ZONE <settings.timezone>`);
 * - C5: every query is filtered by a ReportScope (scope.ts); an empty scope returns nothing;
 * - C8: computed at request time, raw parameterised SQL on the request transaction
 *   (call inside withReqTransaction). No user input is ever interpolated as SQL text.
 * The reconciliation SQL of the doc is re-run by tests/integration/f3-kpi-reconciliation.int.test.ts.
 */

type Row = Record<string, unknown>

export async function rows<T extends Row = Row>(req: PayloadRequest, query: SQL): Promise<T[]> {
  const tx = await getRequestTx(req)
  return ((await tx.execute(query)) as unknown as { rows: T[] }).rows
}

/**
 * Runs the queries ONE AFTER ANOTHER. All of them use the same request-transaction connection; pg
 * queues parallel queries on one client but warns (removed in pg@9), so no Promise.all here.
 */
export async function inSequence<T extends unknown[]>(...fns: { [K in keyof T]: () => Promise<T[K]> }): Promise<T> {
  const out: unknown[] = []
  for (const fn of fns) out.push(await fn())
  return out as T
}

export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export const textList = (list: readonly string[]): SQL =>
  sql.join(
    list.map((s) => sql`${s}`),
    sql`, `,
  )

const COMMITTED = textList(BUDGET_COMMITTED)
/** K-14 (a): request statuses "at least Ditransfer". */
export const TRANSFERRED_OR_LATER: readonly RequestStatus[] = ['transferred', 'receipts_complete', 'lpj_submitted', 'lpj_revision', 'lpj_verified', 'completed']
/** K-12a: Uang Muka transferred but without an LPJ yet. */
export const ADVANCE_WITHOUT_LPJ: readonly RequestStatus[] = ['transferred', 'receipts_complete', 'lpj_revision']
/** K-12g: Uang Muka that has an LPJ. */
export const ADVANCE_WITH_LPJ: readonly RequestStatus[] = ['lpj_submitted', 'lpj_verified', 'completed']

export type Ctx = { today: string; month: string; tz: string; lpjDueDays: number; budgetWarnPct: number; budgetOverPct: number; companyName: string }

/** Settings + "today" (company TZ) once per request. */
export async function reportContext(req: PayloadRequest): Promise<Ctx> {
  const cached = req.context.pkReportCtx as Ctx | undefined
  if (cached) return cached
  const s = await settings(req)
  const t = await today(req)
  const ctx: Ctx = {
    today: t,
    month: t.slice(0, 7),
    tz: s.timezone || process.env.TZ || DEFAULT_TZ,
    lpjDueDays: (s as { lpjDueDays?: number | null }).lpjDueDays ?? 7,
    budgetWarnPct: s.budgetWarnPct ?? 85,
    budgetOverPct: s.budgetOverPct ?? 100,
    companyName: s.name ?? '',
  }
  req.context.pkReportCtx = ctx
  return ctx
}

/** K-06 per request (§0.1 "Realisasi terverifikasi"). */
const REALIZED = sql`CASE
  WHEN er.type = 'advance' AND er.status IN ('lpj_verified', 'completed') THEN coalesce(er.verified_receipts_total, 0)
  WHEN er.type = 'reimburse' AND er.status IN ('receipts_verified', 'transferred', 'completed') THEN coalesce(er.approved_amount, 0)
  ELSE 0 END`
/** K-03 per request: Σ posted transfers (advance, reimburse, lpj_shortfall). */
const DISBURSED = sql`coalesce((SELECT sum(t.amount) FROM transfers t WHERE t.request_id = er.id AND t.status = 'posted'), 0)`
/** K-04 per request: Σ posted LPJ refunds (KM settlement_refund). */
const REFUND = sql`coalesce((SELECT sum(c.amount) FROM cash_entries c WHERE c.expense_request_id = er.id AND c.source_type = 'settlement_refund' AND c.status = 'posted'), 0)`

// ================================================================ K-01 cash balance per account

export type AccountBalance = { id: number; name: string; kind: string; active: boolean; opening: number; totalIn: number; totalOut: number; balance: number }

/** K-01: opening + Σ in − Σ out over ALL rows (posted, void, reversal) with entry_date ≤ asOf. */
export async function cashBalances(req: PayloadRequest, asOf: string, accountId?: number): Promise<{ accounts: AccountBalance[]; total: number }> {
  const r = await rows(
    req,
    sql`SELECT a.id, a.name, a.kind::text AS kind, coalesce(a.active, true) AS active, coalesce(a.opening_balance, 0)::text AS opening,
          coalesce(sum(e.amount) FILTER (WHERE e.direction = 'in'), 0)::text AS tin,
          coalesce(sum(e.amount) FILTER (WHERE e.direction = 'out'), 0)::text AS tout
        FROM cash_accounts a
        LEFT JOIN cash_entries e ON e.cash_account_id = a.id AND e.entry_date <= ${asOf}
        WHERE ${accountId ? sql`a.id = ${accountId}` : sql`TRUE`}
        GROUP BY a.id ORDER BY a.name, a.id`,
  )
  const accounts = r.map((x) => {
    const opening = num(x.opening)
    const totalIn = num(x.tin)
    const totalOut = num(x.tout)
    return { id: num(x.id), name: String(x.name), kind: String(x.kind), active: x.active !== false, opening, totalIn, totalOut, balance: opening + totalIn - totalOut }
  })
  return { accounts, total: accounts.reduce((s, a) => s + a.balance, 0) }
}

/** Display rule of K-01: inactive accounts with balance 0 are hidden. */
export const visibleAccounts = (list: AccountBalance[]) => list.filter((a) => a.active || a.balance !== 0)

// ================================================================ K-02 cash in/out per month

export type FlowMode = 'book' | 'operational'
export type FlowFilter = { from: string; to: string; accountId?: number; projectId?: number; costCenterId?: number }
export type FlowRow = { period: string; masuk: number; keluar: number; net: number; koreksi: number; openingBalance: number | null; closingBalance: number | null }

/**
 * K-02a (book, `mode='book'`): every row incl. voided originals and their reversals; `koreksi` = net
 * (in − out) of the void pairs' rows in that month. K-02b (`operational`): posted non-reversal rows
 * only (Owner chart, Q-F3-7). Opening/closing balances (K-01 at month ends) when no project/cost
 * center filter is set (book mode only).
 */
export async function cashFlowMonthly(req: PayloadRequest, f: FlowFilter, mode: FlowMode): Promise<FlowRow[]> {
  const where = [sql`ce.period BETWEEN ${f.from} AND ${f.to}`]
  if (f.accountId) where.push(sql`ce.cash_account_id = ${f.accountId}`)
  if (f.projectId) where.push(sql`ce.project_id = ${f.projectId}`)
  if (f.costCenterId) where.push(sql`ce.cost_center_id = ${f.costCenterId}`)
  if (mode === 'operational') where.push(sql`ce.status = 'posted' AND ce.source_type <> 'reversal'`)
  const r = await rows(
    req,
    sql`SELECT ce.period,
          coalesce(sum(ce.amount) FILTER (WHERE ce.direction = 'in'), 0)::text AS masuk,
          coalesce(sum(ce.amount) FILTER (WHERE ce.direction = 'out'), 0)::text AS keluar,
          coalesce(sum(CASE WHEN ce.direction = 'in' THEN ce.amount ELSE -ce.amount END) FILTER (WHERE ce.status = 'void' OR ce.source_type = 'reversal'), 0)::text AS koreksi
        FROM cash_entries ce WHERE ${sql.join(where, sql` AND `)} GROUP BY ce.period`,
  )
  const byPeriod = new Map(r.map((x) => [String(x.period), x]))
  const withBalance = mode === 'book' && !f.projectId && !f.costCenterId
  let running: number | null = null
  if (withBalance) {
    const o = await rows(
      req,
      sql`SELECT (SELECT coalesce(sum(a.opening_balance), 0) FROM cash_accounts a WHERE ${f.accountId ? sql`a.id = ${f.accountId}` : sql`TRUE`})::text AS opening,
            (SELECT coalesce(sum(CASE WHEN ce.direction = 'in' THEN ce.amount ELSE -ce.amount END), 0) FROM cash_entries ce
              WHERE ce.entry_date < ${firstDay(f.from)} AND ${f.accountId ? sql`ce.cash_account_id = ${f.accountId}` : sql`TRUE`})::text AS before`,
    )
    running = num(o[0]?.opening) + num(o[0]?.before)
  }
  return periodRange(f.from, f.to).map((period) => {
    const x = byPeriod.get(period)
    const masuk = num(x?.masuk)
    const keluar = num(x?.keluar)
    const openingBalance = running
    if (running !== null) running += masuk - keluar
    return { period, masuk, keluar, net: masuk - keluar, koreksi: mode === 'book' ? num(x?.koreksi) : 0, openingBalance, closingBalance: running }
  })
}

/** Month in/out per cash account (Finance widget [5]: K-02a; Owner card [1]: K-02b). */
export async function accountMonthFlows(req: PayloadRequest, period: string, mode: FlowMode): Promise<Map<number, { masuk: number; keluar: number }>> {
  const r = await rows(
    req,
    sql`SELECT ce.cash_account_id AS id,
          coalesce(sum(ce.amount) FILTER (WHERE ce.direction = 'in'), 0)::text AS masuk,
          coalesce(sum(ce.amount) FILTER (WHERE ce.direction = 'out'), 0)::text AS keluar
        FROM cash_entries ce WHERE ce.period = ${period}
          ${mode === 'operational' ? sql`AND ce.status = 'posted' AND ce.source_type <> 'reversal'` : sql``}
        GROUP BY ce.cash_account_id`,
  )
  return new Map(r.map((x) => [num(x.id), { masuk: num(x.masuk), keluar: num(x.keluar) }]))
}

/** Rekap Kas breakdown: in per cash-in source, out per source type (K-02a, all rows). */
export async function cashBreakdown(req: PayloadRequest, f: FlowFilter) {
  const where = [sql`ce.period BETWEEN ${f.from} AND ${f.to}`]
  if (f.accountId) where.push(sql`ce.cash_account_id = ${f.accountId}`)
  if (f.projectId) where.push(sql`ce.project_id = ${f.projectId}`)
  if (f.costCenterId) where.push(sql`ce.cost_center_id = ${f.costCenterId}`)
  const r = await rows(
    req,
    sql`SELECT ce.direction::text AS direction, ce.source_type::text AS source_type, s.name AS source_name, count(*)::int AS n, sum(ce.amount)::text AS amount
        FROM cash_entries ce LEFT JOIN cash_in_sources s ON s.id = ce.cash_in_source_id
        WHERE ${sql.join(where, sql` AND `)}
        GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
  )
  return r.map((x) => ({ direction: String(x.direction) as 'in' | 'out', sourceType: String(x.source_type), sourceName: (x.source_name as string | null) ?? null, count: num(x.n), amount: num(x.amount) }))
}

// ================================================================ K-03..K-06 per request

export type RequestMoney = { disbursed: number; refund: number; net: number; realized: number }

/** K-03/K-04/K-05/K-06 of one request (per-request dashboard/detail figures). */
export async function requestMoney(req: PayloadRequest, requestId: number): Promise<RequestMoney> {
  const r = await rows(req, sql`SELECT ${DISBURSED}::text AS d, ${REFUND}::text AS rf, (${REALIZED})::text AS rl FROM expense_requests er WHERE er.id = ${requestId}`)
  const d = num(r[0]?.d)
  const rf = num(r[0]?.rf)
  return { disbursed: d, refund: rf, net: d - rf, realized: num(r[0]?.rl) }
}

/** K-03/K-04/K-05 over a transfer-date range, in scope (office cards). */
export async function disbursedInRange(req: PayloadRequest, scope: ReportScope, from: string, to: string): Promise<{ disbursed: number; refund: number; net: number }> {
  const r = await rows(
    req,
    sql`SELECT
          (SELECT coalesce(sum(t.amount), 0) FROM transfers t JOIN expense_requests er ON er.id = t.request_id
            WHERE t.status = 'posted' AND t.transfer_date BETWEEN ${from} AND ${to} AND ${requestScopeSql(scope)})::text AS d,
          (SELECT coalesce(sum(c.amount), 0) FROM cash_entries c JOIN expense_requests er ON er.id = c.expense_request_id
            WHERE c.source_type = 'settlement_refund' AND c.status = 'posted' AND c.entry_date BETWEEN ${from} AND ${to} AND ${requestScopeSql(scope)})::text AS rf`,
  )
  const d = num(r[0]?.d)
  const rf = num(r[0]?.rf)
  return { disbursed: d, refund: rf, net: d - rf }
}

// ================================================================ K-07/K-08 project budget

export type ProjectBudget = {
  id: number
  code: string
  name: string
  status: string
  budget: number | null
  committed: number
  committedCount: number
  pct: number | null
  tone: BudgetTone
  disbursedNet: number
  realized: number
  pctDisbursed: number | null
  pctRealized: number | null
}

/** K-07 (Komitmen), K-08 (% + colour), K-05 (Dicairkan bersih), K-06 (Realisasi) per project. */
export async function projectBudgets(req: PayloadRequest, scope: ReportScope, opts: { projectId?: number; includeArchived?: boolean } = {}): Promise<ProjectBudget[]> {
  const ctx = await reportContext(req)
  const r = await rows(
    req,
    sql`SELECT p.id, p.code, p.name, p.status::text AS status, p.budget::text AS budget,
          coalesce(sum(er.grand_total) FILTER (WHERE er.status::text IN (${COMMITTED})), 0)::text AS committed,
          count(er.id) FILTER (WHERE er.status::text IN (${COMMITTED}))::int AS committed_n,
          coalesce(sum(m.d - m.rf), 0)::text AS disbursed_net,
          coalesce(sum(m.rl), 0)::text AS realized
        FROM projects p
        LEFT JOIN expense_requests er ON er.project_id = p.id
        LEFT JOIN LATERAL (SELECT ${DISBURSED} AS d, ${REFUND} AS rf, (${REALIZED}) AS rl) m ON er.id IS NOT NULL
        WHERE ${projectScopeSql(scope)}
          ${opts.projectId ? sql`AND p.id = ${opts.projectId}` : sql``}
          ${opts.includeArchived ? sql`` : sql`AND p.status <> 'arsip'`}
        GROUP BY p.id ORDER BY p.code, p.id`,
  )
  return r.map((x) => {
    const budget = numOrNull(x.budget)
    const committed = num(x.committed)
    const pct = budgetPct(committed, budget)
    const disbursedNet = num(x.disbursed_net)
    const realized = num(x.realized)
    return {
      id: num(x.id),
      code: String(x.code),
      name: String(x.name),
      status: String(x.status),
      budget,
      committed,
      committedCount: num(x.committed_n),
      pct,
      tone: budgetTone(pct, ctx.budgetWarnPct, ctx.budgetOverPct),
      disbursedNet,
      realized,
      pctDisbursed: budgetPct(disbursedNet, budget),
      pctRealized: budgetPct(realized, budget),
    }
  })
}

/**
 * K-07 per category for one project (RAB per category vs committed line totals). Lines without a
 * category form one "Tanpa kategori" bucket (committed only: budget_lines.category_id is NOT NULL).
 * RAB and committed are merged with UNION ALL + GROUP BY (NULL category = one group), not a
 * FULL JOIN: PostgreSQL rejects FULL JOIN … ON a IS NOT DISTINCT FROM b (not merge/hash-joinable).
 */
export async function projectBudgetByCategory(req: PayloadRequest, scope: ReportScope, projectId: number) {
  const r = await rows(
    req,
    sql`WITH p AS (SELECT p.id FROM projects p WHERE p.id = ${projectId} AND ${projectScopeSql(scope)}),
        rab AS (SELECT bl.category_id, sum(bl.amount) AS amount FROM budget_lines bl JOIN p ON p.id = bl.project_id GROUP BY bl.category_id),
        com AS (SELECT l.category_id, sum(l.total) AS amount FROM expense_requests er JOIN p ON p.id = er.project_id
                  JOIN expense_requests_lines l ON l._parent_id = er.id
                WHERE er.status::text IN (${COMMITTED}) GROUP BY l.category_id),
        u AS (SELECT category_id, amount AS rab, NULL::numeric AS com FROM rab
              UNION ALL SELECT category_id, NULL::numeric, amount FROM com),
        g AS (SELECT category_id, sum(rab) AS rab, sum(com) AS com FROM u GROUP BY category_id)
        SELECT g.category_id, c.code, c.name, g.rab::text AS rab, coalesce(g.com, 0)::text AS committed
        FROM g LEFT JOIN expense_categories c ON c.id = g.category_id
        ORDER BY c.code NULLS LAST, g.category_id NULLS LAST`,
  )
  return r.map((x) => {
    const rab = numOrNull(x.rab)
    const committed = num(x.committed)
    return { categoryId: numOrNull(x.category_id), code: (x.code as string | null) ?? null, name: (x.name as string | null) ?? 'Tanpa kategori', rab, committed, pct: budgetPct(committed, rab), outsideRab: rab === null }
  })
}

// ================================================================ K-10 waiting for approval

export async function pendingApprovals(req: PayloadRequest, scope: ReportScope) {
  const ctx = await reportContext(req)
  const r = await rows(
    req,
    sql`SELECT er.status::text AS status, count(*)::int AS n, coalesce(sum(er.grand_total), 0)::text AS s,
          min((er.submitted_at AT TIME ZONE ${ctx.tz})::date)::text AS oldest
        FROM expense_requests er WHERE er.status IN ('pending_ack', 'pending_approval') AND ${requestScopeSql(scope)}
        GROUP BY er.status`,
  )
  const get = (s: string) => r.find((x) => x.status === s)
  const ack = { count: num(get('pending_ack')?.n), sum: num(get('pending_ack')?.s) }
  const appr = { count: num(get('pending_approval')?.n), sum: num(get('pending_approval')?.s) }
  const oldest = r.map((x) => x.oldest as string | null).filter((x): x is string => !!x).sort()[0] ?? null
  return { pendingAck: ack, pendingApproval: appr, count: ack.count + appr.count, sum: ack.sum + appr.sum, oldestDays: oldest ? daysBetween(oldest, ctx.today) : null }
}

/**
 * S3e (US-17, ADR 0013, S-01): PM monitoring — team requests waiting for a decision, oldest first.
 * The PM never decides; `waitingFor` names who does: "Menunggu Direktur" (pending_ack, Diketahui =
 * Direktur approval) or "Menunggu Finance" (pending_approval). Legacy snapshots (PM "Diketahui",
 * Owner approval) are rare and labelled by status the same way.
 */
export type TeamWaitingItem = { id: number; docNo: string | null; title: string; type: RequestType; status: RequestStatus; waitingFor: 'direktur' | 'finance'; scopeName: string; requesters: string; grandTotal: number; submittedDate: string | null; days: number | null }

export async function teamWaiting(req: PayloadRequest, scope: ReportScope, top = 8) {
  const ctx = await reportContext(req)
  const base = sql`er.status IN ('pending_ack', 'pending_approval') AND ${requestScopeSql(scope)}`
  const [counts, list] = await inSequence(
    () => rows(req, sql`SELECT er.status::text AS status, count(*)::int AS n, min((er.submitted_at AT TIME ZONE ${ctx.tz})::date)::text AS oldest FROM expense_requests er WHERE ${base} GROUP BY er.status`),
    () =>
      rows(
        req,
        sql`SELECT er.id, er.doc_no, er.title, er.type::text AS type, er.status::text AS status, coalesce(er.grand_total, 0)::text AS gt,
              ((er.submitted_at AT TIME ZONE ${ctx.tz})::date)::text AS submitted,
              coalesce((SELECT string_agg(e.name, ', ' ORDER BY rr."order") FROM expense_requests_rels rr JOIN employees e ON e.id = rr.employees_id
                        WHERE rr.parent_id = er.id AND rr.path = 'requesters'), '') AS requesters,
              coalesce(p.code || ' ' || p.name, cc.code || ' ' || cc.name, '') AS scope_name
            FROM expense_requests er
            LEFT JOIN projects p ON p.id = er.project_id LEFT JOIN cost_centers cc ON cc.id = er.cost_center_id
            WHERE ${base} ORDER BY er.submitted_at ASC NULLS LAST, er.id ASC LIMIT ${top}`,
      ),
  )
  const n = (st: string) => num(counts.find((x) => x.status === st)?.n)
  const oldest = counts.map((x) => x.oldest as string | null).filter((x): x is string => !!x).sort()[0] ?? null
  const items: TeamWaitingItem[] = list.map((x) => {
    const submitted = (x.submitted as string | null) ?? null
    return {
      id: num(x.id),
      docNo: (x.doc_no as string | null) ?? null,
      title: String(x.title),
      type: x.type as RequestType,
      status: x.status as RequestStatus,
      waitingFor: x.status === 'pending_ack' ? 'direktur' : 'finance',
      scopeName: String(x.scope_name),
      requesters: String(x.requesters),
      grandTotal: num(x.gt),
      submittedDate: submitted,
      days: submitted ? daysBetween(submitted, ctx.today) : null,
    }
  })
  return { count: n('pending_ack') + n('pending_approval'), direktur: n('pending_ack'), finance: n('pending_approval'), oldestDays: oldest ? daysBetween(oldest, ctx.today) : null, items }
}

// ================================================================ K-11 transfer queue

export async function transferQueueSummary(req: PayloadRequest) {
  const ctx = await reportContext(req)
  const r = await rows(
    req,
    sql`SELECT
          count(*) FILTER (WHERE q)::int AS n,
          coalesce(sum(er.approved_amount) FILTER (WHERE q), 0)::text AS s,
          count(*) FILTER (WHERE q AND er.needed_date < ${ctx.today})::int AS overdue,
          count(*) FILTER (WHERE er.type = 'reimburse' AND er.status = 'approved')::int AS to_verify,
          (SELECT count(*) FROM receipt_flags f JOIN expense_requests r2 ON r2.id = f.request_id
            WHERE f.status = 'open' AND f.level = 'warning' AND r2.type = 'reimburse' AND r2.status = 'approved')::int AS to_verify_flags
        FROM (SELECT er.*, ((er.type = 'advance' AND er.status = 'approved') OR (er.type = 'reimburse' AND er.status = 'receipts_verified')) AS q
              FROM expense_requests er) er`,
  )
  const x = r[0] ?? {}
  return { count: num(x.n), sum: num(x.s), overdue: num(x.overdue), reimburseToVerify: num(x.to_verify), reimburseToVerifyWarnings: num(x.to_verify_flags) }
}

// ================================================================ K-12 receipts / LPJ completeness

export type AdvanceWithoutLpj = { id: number; docNo: string | null; title: string; requesters: string; scopeName: string; status: string; transferredTotal: number; firstTransfer: string | null; ageDays: number | null; overdue: boolean }

/** K-12a/K-12b rows: Uang Muka transferred without LPJ; age from the first posted advance transfer. */
export async function advancesWithoutLpj(req: PayloadRequest, scope: ReportScope): Promise<AdvanceWithoutLpj[]> {
  const ctx = await reportContext(req)
  const r = await rows(
    req,
    sql`SELECT er.id, er.doc_no, er.title, er.status::text AS status, coalesce(er.transferred_total, 0)::text AS tt,
          (SELECT min(t.transfer_date) FROM transfers t WHERE t.request_id = er.id AND t.status = 'posted' AND t.kind = 'advance') AS first_transfer,
          coalesce((SELECT string_agg(e.name, ', ' ORDER BY rr."order") FROM expense_requests_rels rr JOIN employees e ON e.id = rr.employees_id
                    WHERE rr.parent_id = er.id AND rr.path = 'requesters'), '') AS requesters,
          coalesce(p.code || ' ' || p.name, cc.code || ' ' || cc.name, '') AS scope_name
        FROM expense_requests er
        LEFT JOIN projects p ON p.id = er.project_id LEFT JOIN cost_centers cc ON cc.id = er.cost_center_id
        WHERE er.type = 'advance' AND er.status::text IN (${textList(ADVANCE_WITHOUT_LPJ)}) AND ${requestScopeSql(scope)}
        ORDER BY first_transfer NULLS LAST, er.id`,
  )
  return r.map((x) => {
    const first = (x.first_transfer as string | null) ?? null
    const age = first ? daysBetween(first, ctx.today) : null
    return {
      id: num(x.id),
      docNo: (x.doc_no as string | null) ?? null,
      title: String(x.title),
      requesters: String(x.requesters),
      scopeName: String(x.scope_name),
      status: String(x.status),
      transferredTotal: num(x.tt),
      firstTransfer: first,
      ageDays: age,
      overdue: age !== null && age > ctx.lpjDueDays,
    }
  })
}

/** K-12a…g summary. K-12g ratio over Uang Muka first transferred in [from, to]. */
export async function lpjSummary(req: PayloadRequest, scope: ReportScope, from: string, to: string) {
  const rowsA = await advancesWithoutLpj(req, scope)
  const r = await rows(
    req,
    sql`SELECT
          count(*) FILTER (WHERE er.status = 'lpj_submitted')::int AS c,
          count(*) FILTER (WHERE er.status = 'lpj_verified')::int AS d,
          count(*) FILTER (WHERE er.type = 'reimburse' AND er.status = 'approved')::int AS e,
          (SELECT coalesce(sum(s.difference) FILTER (WHERE s.difference > 0), 0) FROM settlements s JOIN expense_requests er ON er.id = s.request_id
            WHERE s.status = 'verified' AND er.status = 'lpj_verified' AND ${requestScopeSql(scope)})::text AS d_refund,
          (SELECT coalesce(-sum(s.difference) FILTER (WHERE s.difference < 0), 0) FROM settlements s JOIN expense_requests er ON er.id = s.request_id
            WHERE s.status = 'verified' AND er.status = 'lpj_verified' AND ${requestScopeSql(scope)})::text AS d_shortfall,
          (SELECT count(*) FROM receipt_flags f JOIN expense_requests er ON er.id = f.request_id
            WHERE f.status = 'open' AND f.level = 'warning' AND er.status NOT IN ('cancelled', 'rejected') AND ${requestScopeSql(scope)})::int AS f,
          (SELECT count(*) FROM expense_requests er WHERE er.type = 'advance' AND ${requestScopeSql(scope)}
             AND (SELECT min(t.transfer_date) FROM transfers t WHERE t.request_id = er.id AND t.status = 'posted' AND t.kind = 'advance') BETWEEN ${from} AND ${to})::int AS g_total,
          (SELECT count(*) FROM expense_requests er WHERE er.type = 'advance' AND er.status::text IN (${textList(ADVANCE_WITH_LPJ)}) AND ${requestScopeSql(scope)}
             AND (SELECT min(t.transfer_date) FROM transfers t WHERE t.request_id = er.id AND t.status = 'posted' AND t.kind = 'advance') BETWEEN ${from} AND ${to})::int AS g_done
        FROM expense_requests er WHERE ${requestScopeSql(scope)}`,
  )
  const x = r[0] ?? {}
  const overdue = rowsA.filter((a) => a.overdue)
  return {
    withoutLpj: { count: rowsA.length, sum: rowsA.reduce((s, a) => s + a.transferredTotal, 0) }, // K-12a
    overdue: { count: overdue.length, sum: overdue.reduce((s, a) => s + a.transferredTotal, 0) }, // K-12b
    lpjToVerify: num(x.c), // K-12c
    lpjToSettle: { count: num(x.d), refund: num(x.d_refund), shortfall: num(x.d_shortfall) }, // K-12d
    reimburseToVerify: num(x.e), // K-12e
    openWarnings: num(x.f), // K-12f
    ratio: { done: num(x.g_done), total: num(x.g_total) }, // K-12g
    rows: rowsA,
  }
}

// ================================================================ K-13 requests per status / type / category

export type RequestFilter = {
  from: string
  to: string
  type?: RequestType
  statuses?: RequestStatus[]
  projectId?: number
  costCenterId?: number
  categoryId?: number
  requesterId?: number
}

export function requestFilterSql(f: RequestFilter): SQL {
  const w: SQL[] = [sql`er.status <> 'draft'`, sql`er.request_date BETWEEN ${f.from} AND ${f.to}`]
  if (f.type) w.push(sql`er.type = ${f.type}`)
  if (f.statuses?.length) w.push(sql`er.status::text IN (${textList(f.statuses)})`)
  if (f.projectId) w.push(sql`er.project_id = ${f.projectId}`)
  if (f.costCenterId) w.push(sql`er.cost_center_id = ${f.costCenterId}`)
  if (f.categoryId) w.push(sql`EXISTS (SELECT 1 FROM expense_requests_lines l2 WHERE l2._parent_id = er.id AND l2.category_id = ${f.categoryId})`)
  if (f.requesterId) w.push(sql`EXISTS (SELECT 1 FROM expense_requests_rels r2 WHERE r2.parent_id = er.id AND r2.path = 'requesters' AND r2.employees_id = ${f.requesterId})`)
  return sql.join(w, sql` AND `)
}

export type RequestRow = {
  id: number
  docNo: string | null
  requestDate: string | null
  type: RequestType
  title: string
  scopeName: string
  requesters: string
  status: RequestStatus
  grandTotal: number
  approvedAmount: number | null
  disbursed: number
  refund: number
  realized: number
  openFlags: number
}

/** K-13 rows (keyset by id descending; `after` = last id of the previous page). */
export async function requestRows(req: PayloadRequest, scope: ReportScope, f: RequestFilter, page: { after?: number; limit: number }): Promise<RequestRow[]> {
  const r = await rows(
    req,
    sql`SELECT er.id, er.doc_no, er.request_date, er.type::text AS type, er.title, er.status::text AS status,
          coalesce(er.grand_total, 0)::text AS gt, er.approved_amount::text AS aa,
          ${DISBURSED}::text AS d, ${REFUND}::text AS rf, (${REALIZED})::text AS rl,
          (SELECT count(*) FROM receipt_flags f WHERE f.request_id = er.id AND f.status = 'open')::int AS flags,
          coalesce((SELECT string_agg(e.name, ', ' ORDER BY rr."order") FROM expense_requests_rels rr JOIN employees e ON e.id = rr.employees_id
                    WHERE rr.parent_id = er.id AND rr.path = 'requesters'), '') AS requesters,
          coalesce(p.code || ' ' || p.name, cc.code || ' ' || cc.name, '') AS scope_name
        FROM expense_requests er
        LEFT JOIN projects p ON p.id = er.project_id LEFT JOIN cost_centers cc ON cc.id = er.cost_center_id
        WHERE ${requestScopeSql(scope)} AND ${requestFilterSql(f)} ${page.after ? sql`AND er.id < ${page.after}` : sql``}
        ORDER BY er.id DESC LIMIT ${page.limit}`,
  )
  return r.map((x) => ({
    id: num(x.id),
    docNo: (x.doc_no as string | null) ?? null,
    requestDate: (x.request_date as string | null) ?? null,
    type: x.type as RequestType,
    title: String(x.title),
    scopeName: String(x.scope_name),
    requesters: String(x.requesters),
    status: x.status as RequestStatus,
    grandTotal: num(x.gt),
    approvedAmount: numOrNull(x.aa),
    disbursed: num(x.d),
    refund: num(x.rf),
    realized: num(x.rl),
    openFlags: num(x.flags),
  }))
}

/** K-13 aggregates: per status, per type, per category (distinct requests, Σ line totals). */
export async function requestSummary(req: PayloadRequest, scope: ReportScope, f: RequestFilter) {
  const base = sql`${requestScopeSql(scope)} AND ${requestFilterSql(f)}`
  const [byStatus, byType, byCategory, total] = await inSequence(
    () => rows(req, sql`SELECT er.type::text AS type, er.status::text AS status, count(*)::int AS n, coalesce(sum(er.grand_total), 0)::text AS s FROM expense_requests er WHERE ${base} GROUP BY 1, 2 ORDER BY 1, 2`),
    () => rows(req, sql`SELECT er.type::text AS type, count(*)::int AS n, coalesce(sum(er.grand_total), 0)::text AS s FROM expense_requests er WHERE ${base} GROUP BY 1 ORDER BY 1`),
    () => rows(
      req,
      sql`SELECT l.category_id, c.code, c.name, count(DISTINCT er.id)::int AS n, coalesce(sum(l.total), 0)::text AS s
          FROM expense_requests er JOIN expense_requests_lines l ON l._parent_id = er.id LEFT JOIN expense_categories c ON c.id = l.category_id
          WHERE ${base} ${f.categoryId ? sql`AND l.category_id = ${f.categoryId}` : sql``}
          GROUP BY l.category_id, c.code, c.name ORDER BY sum(l.total) DESC NULLS LAST, c.code`,
    ),
    () => rows(req, sql`SELECT count(*)::int AS n, coalesce(sum(er.grand_total), 0)::text AS s FROM expense_requests er WHERE ${base}`),
  )
  return {
    byStatus: byStatus.map((x) => ({ type: x.type as RequestType, status: x.status as RequestStatus, count: num(x.n), sum: num(x.s) })),
    byType: byType.map((x) => ({ type: x.type as RequestType, count: num(x.n), sum: num(x.s) })),
    byCategory: byCategory.map((x) => ({ categoryId: numOrNull(x.category_id), code: (x.code as string | null) ?? null, name: (x.name as string | null) ?? 'Tanpa kategori', count: num(x.n), sum: num(x.s) })),
    total: { count: num(total[0]?.n), sum: num(total[0]?.s) },
  }
}

// ================================================================ K-14 cost per vehicle

export type VehicleFilter = { from: string; to: string; vehicleId?: number; categoryId?: number }

/**
 * K-14 (Q-F3-8 basis): (a) request lines with a vehicle, request at least "Ditransfer", period =
 * first posted transfer date; (b) manual cash-out with a vehicle, posted, period = entry date
 * (office scope only; PM: without manual cash).
 */
export async function vehicleCosts(req: PayloadRequest, scope: ReportScope, f: VehicleFilter) {
  const manual = includesManualCash(scope)
  const r = await rows(
    req,
    sql`WITH a AS (
          SELECT l.vehicle_id, l.category_id, sum(l.total) AS amount
          FROM expense_requests er JOIN expense_requests_lines l ON l._parent_id = er.id
          WHERE l.vehicle_id IS NOT NULL AND er.status::text IN (${textList(TRANSFERRED_OR_LATER)}) AND ${requestScopeSql(scope)}
            AND (SELECT min(t.transfer_date) FROM transfers t WHERE t.request_id = er.id AND t.status = 'posted') BETWEEN ${f.from} AND ${f.to}
            ${f.vehicleId ? sql`AND l.vehicle_id = ${f.vehicleId}` : sql``}
            ${f.categoryId ? sql`AND l.category_id = ${f.categoryId}` : sql``}
          GROUP BY 1, 2),
        b AS (
          SELECT ce.vehicle_id, ce.category_id, sum(ce.amount) AS amount
          FROM cash_entries ce
          WHERE ${manual ? sql`TRUE` : sql`FALSE`} AND ce.vehicle_id IS NOT NULL AND ce.source_type = 'manual' AND ce.direction = 'out' AND ce.status = 'posted'
            AND ce.entry_date BETWEEN ${f.from} AND ${f.to}
            ${f.vehicleId ? sql`AND ce.vehicle_id = ${f.vehicleId}` : sql``}
            ${f.categoryId ? sql`AND ce.category_id = ${f.categoryId}` : sql``}
          GROUP BY 1, 2),
        u AS (SELECT vehicle_id, category_id, amount AS a, 0::numeric AS b FROM a UNION ALL SELECT vehicle_id, category_id, 0, amount FROM b)
        SELECT v.id, coalesce(v.plate_display, v.plate_no) AS plate, v.type, u.category_id, c.name AS category,
               sum(u.a)::text AS from_requests, sum(u.b)::text AS from_manual
        FROM u JOIN vehicles v ON v.id = u.vehicle_id LEFT JOIN expense_categories c ON c.id = u.category_id
        GROUP BY v.id, plate, v.type, u.category_id, c.name ORDER BY plate, c.name NULLS LAST`,
  )
  type V = { id: number; plate: string; type: string; fromRequests: number; fromManual: number; total: number; categories: Array<{ categoryId: number | null; name: string; fromRequests: number; fromManual: number }> }
  const map = new Map<number, V>()
  for (const x of r) {
    const id = num(x.id)
    const v = map.get(id) ?? { id, plate: String(x.plate), type: String(x.type), fromRequests: 0, fromManual: 0, total: 0, categories: [] }
    const a = num(x.from_requests)
    const b = num(x.from_manual)
    v.fromRequests += a
    v.fromManual += b
    v.total += a + b
    v.categories.push({ categoryId: numOrNull(x.category_id), name: (x.category as string | null) ?? 'Tanpa kategori', fromRequests: a, fromManual: b })
    map.set(id, v)
  }
  return { vehicles: [...map.values()], includesManual: manual }
}

// ================================================================ K-15 cost center month

/**
 * K-15 per cost center for `period`: K-05 of its requests in the month (posted transfers by
 * transfer date − posted LPJ refunds by entry date) + manual cash-out − manual cash-in of the cost
 * center (posted, not reversal).
 */
export async function costCenterMonth(req: PayloadRequest, scope: ReportScope, period: string) {
  const from = firstDay(period)
  const to = lastDay(period)
  const r = await rows(
    req,
    sql`SELECT cc.id, cc.code, cc.name,
          (SELECT coalesce(sum(t.amount), 0) FROM transfers t JOIN expense_requests er ON er.id = t.request_id
            WHERE er.cost_center_id = cc.id AND t.status = 'posted' AND t.transfer_date BETWEEN ${from} AND ${to})::text AS transfers,
          (SELECT coalesce(sum(c.amount), 0) FROM cash_entries c JOIN expense_requests er ON er.id = c.expense_request_id
            WHERE er.cost_center_id = cc.id AND c.source_type = 'settlement_refund' AND c.status = 'posted' AND c.entry_date BETWEEN ${from} AND ${to})::text AS refunds,
          (SELECT coalesce(sum(c.amount) FILTER (WHERE c.direction = 'out'), 0) FROM cash_entries c
            WHERE c.cost_center_id = cc.id AND c.source_type = 'manual' AND c.status = 'posted' AND c.period = ${period})::text AS manual_out,
          (SELECT coalesce(sum(c.amount) FILTER (WHERE c.direction = 'in'), 0) FROM cash_entries c
            WHERE c.cost_center_id = cc.id AND c.source_type = 'manual' AND c.status = 'posted' AND c.period = ${period})::text AS manual_in
        FROM cost_centers cc WHERE ${costCenterScopeSql(scope)} ORDER BY cc.code, cc.id`,
  )
  return r.map((x) => {
    const fromRequests = num(x.transfers) - num(x.refunds)
    const manualOut = num(x.manual_out)
    const manualIn = num(x.manual_in)
    return { id: num(x.id), code: String(x.code), name: String(x.name), fromRequests, manualOut, manualIn, total: fromRequests + manualOut - manualIn }
  })
}

// ================================================================ K-17 spending per category / scope

export type SpendFilter = { from: string; to: string; basis: 'dicairkan' | 'realisasi'; group: 'kategori' | 'lingkup'; type?: RequestType; projectId?: number; costCenterId?: number; categoryId?: number }

/**
 * K-17. Dicairkan: line totals of requests with a posted advance/reimburse transfer dated in range
 * (allocation by line, US-25) + posted manual cash-out. Realisasi: K-06 per category (Uang Muka:
 * valid receipts per line category, dated by LPJ verification; Reimburse: line totals, dated by
 * the last valid receipt verification) + the same manual cash-out. PM scope: no manual cash.
 * Group by category (default) or by project / cost center ("lingkup").
 */
export async function spending(req: PayloadRequest, scope: ReportScope, f: SpendFilter) {
  const ctx = await reportContext(req)
  const manual = includesManualCash(scope) && !f.type
  const reqWhere: SQL[] = [requestScopeSql(scope)]
  if (f.type) reqWhere.push(sql`er.type = ${f.type}`)
  if (f.projectId) reqWhere.push(sql`er.project_id = ${f.projectId}`)
  if (f.costCenterId) reqWhere.push(sql`er.cost_center_id = ${f.costCenterId}`)
  const catWhere = f.categoryId ? sql`AND l.category_id = ${f.categoryId}` : sql``
  const manWhere: SQL[] = [sql`ce.source_type = 'manual'`, sql`ce.direction = 'out'`, sql`ce.status = 'posted'`, sql`ce.entry_date BETWEEN ${f.from} AND ${f.to}`, cashScopeSql(scope)]
  if (f.projectId) manWhere.push(sql`ce.project_id = ${f.projectId}`)
  if (f.costCenterId) manWhere.push(sql`ce.cost_center_id = ${f.costCenterId}`)
  if (f.categoryId) manWhere.push(sql`ce.category_id = ${f.categoryId}`)
  const W = sql.join(reqWhere, sql` AND `)
  const lineSource =
    f.basis === 'dicairkan'
      ? sql`SELECT er.id AS rid, er.project_id, er.cost_center_id, l.category_id, l.total AS amount
            FROM expense_requests er JOIN expense_requests_lines l ON l._parent_id = er.id
            WHERE ${W} ${catWhere} AND EXISTS (SELECT 1 FROM transfers t WHERE t.request_id = er.id AND t.status = 'posted' AND t.kind IN ('advance', 'reimburse') AND t.transfer_date BETWEEN ${f.from} AND ${f.to})`
      : sql`SELECT er.id AS rid, er.project_id, er.cost_center_id, l.category_id, r.amount
            FROM expense_requests er JOIN receipts r ON r.request_id = er.id AND r.status = 'valid' JOIN expense_requests_lines l ON l.id = r.line_id
            WHERE ${W} ${catWhere} AND er.type = 'advance' AND er.status IN ('lpj_verified', 'completed')
              AND ((SELECT max(s.verified_at) FROM settlements s WHERE s.request_id = er.id) AT TIME ZONE ${ctx.tz})::date BETWEEN ${f.from}::date AND ${f.to}::date
            UNION ALL
            SELECT er.id, er.project_id, er.cost_center_id, l.category_id, l.total
            FROM expense_requests er JOIN expense_requests_lines l ON l._parent_id = er.id
            WHERE ${W} ${catWhere} AND er.type = 'reimburse' AND er.status IN ('receipts_verified', 'transferred', 'completed')
              AND ((SELECT max(r.verified_at) FROM receipts r WHERE r.request_id = er.id AND r.status = 'valid') AT TIME ZONE ${ctx.tz})::date BETWEEN ${f.from}::date AND ${f.to}::date`
  const key = f.group === 'kategori' ? sql`category_id::text` : sql`coalesce('p' || project_id::text, 'c' || cost_center_id::text, '-')`
  const r = await rows(
    req,
    sql`WITH src AS (${lineSource}),
          man AS (SELECT ce.project_id, ce.cost_center_id, ce.category_id, ce.amount FROM cash_entries ce WHERE ${manual ? sql.join(manWhere, sql` AND `) : sql`FALSE`}),
          agg AS (
            SELECT ${key} AS k, count(DISTINCT rid)::int AS n, sum(amount) AS req_amount, 0::numeric AS man_amount FROM src GROUP BY 1
            UNION ALL
            SELECT ${key}, 0, 0, sum(amount) FROM man GROUP BY 1)
        SELECT k, sum(n)::int AS n, sum(req_amount)::text AS req_amount, sum(man_amount)::text AS man_amount FROM agg GROUP BY k`,
  )
  const labels = await groupLabels(req, f.group)
  const items = r
    .map((x) => {
      const k = (x.k as string | null) ?? '-'
      const fromRequests = num(x.req_amount)
      const fromManual = num(x.man_amount)
      return { key: k, label: labels.get(k) ?? (f.group === 'kategori' ? 'Tanpa kategori' : 'Tanpa project/pusat biaya'), requestCount: num(x.n), fromRequests, fromManual, total: fromRequests + fromManual }
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
  const total = items.reduce((s, i) => s + i.total, 0)
  return { items: items.map((i) => ({ ...i, share: total > 0 ? Math.round((i.total / total) * 1000) / 10 : 0 })), total, includesManual: manual }
}

async function groupLabels(req: PayloadRequest, group: SpendFilter['group']): Promise<Map<string, string>> {
  if (group === 'kategori') {
    const r = await rows(req, sql`SELECT id::text AS k, code || ' ' || name AS label FROM expense_categories`)
    return new Map(r.map((x) => [String(x.k), String(x.label)]))
  }
  const r = await rows(req, sql`SELECT 'p' || id::text AS k, code || ' ' || name AS label FROM projects UNION ALL SELECT 'c' || id::text, code || ' ' || name FROM cost_centers`)
  return new Map(r.map((x) => [String(x.k), String(x.label)]))
}

// ================================================================ Staff / Admin homes

/** Staff "Perlu tindakan saya" (wireframe §4): own requests in a status that waits for the requester. */
export const STAFF_ACTION_STATUSES: readonly RequestStatus[] = ['draft', 'receipt_revision', 'transferred', 'receipts_complete', 'lpj_revision']

export async function ownRequests(req: PayloadRequest, scope: ReportScope, opts: { statuses?: readonly RequestStatus[]; limit: number }) {
  const ctx = await reportContext(req)
  const r = await rows(
    req,
    sql`SELECT er.id, er.doc_no, er.title, er.type::text AS type, er.status::text AS status, coalesce(er.grand_total, 0)::text AS gt,
          (${ctx.today}::date - (coalesce(er.updated_at, er.created_at) AT TIME ZONE ${ctx.tz})::date)::int AS age
        FROM expense_requests er WHERE ${requestScopeSql(scope)} ${opts.statuses ? sql`AND er.status::text IN (${textList(opts.statuses)})` : sql``}
        ORDER BY er.id DESC LIMIT ${opts.limit}`,
  )
  return r.map((x) => ({ id: num(x.id), docNo: (x.doc_no as string | null) ?? null, title: String(x.title), type: x.type as RequestType, status: x.status as RequestStatus, grandTotal: num(x.gt), ageDays: num(x.age) }))
}

/** Admin home: onboarding gaps (approval prerequisites, F2). */
export async function masterGaps(req: PayloadRequest) {
  const [u, p, c] = await inSequence(
    () => rows(req, sql`SELECT count(*)::int AS n FROM users u WHERE coalesce(u.active, true) AND (u.employee_id IS NULL OR NOT EXISTS (SELECT 1 FROM users_roles r WHERE r.parent_id = u.id))`),
    () => rows(req, sql`SELECT count(*)::int AS n FROM projects p WHERE p.pm_id IS NULL AND p.status <> 'arsip'`),
    () => rows(req, sql`SELECT count(*)::int AS n FROM cost_centers cc WHERE cc.manager_id IS NULL AND coalesce(cc.active, true)`),
  )
  return { usersIncomplete: num(u[0]?.n), projectsWithoutPm: num(p[0]?.n), costCentersWithoutManager: num(c[0]?.n) }
}

/** PM: team requests created this month (wireframe PM [2]). */
export async function teamMonth(req: PayloadRequest, scope: ReportScope, period: string) {
  const r = await rows(
    req,
    sql`SELECT count(*)::int AS n, coalesce(sum(er.grand_total), 0)::text AS s,
          count(*) FILTER (WHERE er.status IN ('pending_ack', 'pending_approval'))::int AS waiting
        FROM expense_requests er WHERE er.status <> 'draft' AND er.request_date BETWEEN ${firstDay(period)} AND ${lastDay(period)} AND ${requestScopeSql(scope)}`,
  )
  return { count: num(r[0]?.n), sum: num(r[0]?.s), waiting: num(r[0]?.waiting) }
}

/** Latest closed period (Finance [8]). */
export async function lastClosedPeriod(req: PayloadRequest): Promise<string | null> {
  const r = await rows(req, sql`SELECT max(period) AS p FROM period_closings WHERE status = 'closed'`)
  return (r[0]?.p as string | null) ?? null
}

// ================================================================ dashboard charts (Beranda 2026-09-25)

/**
 * K-13 per status over ALL request dates (the pipeline "posisi pengajuan saat ini"), in scope.
 * Drafts excluded like every K-13 figure.
 */
export async function requestStatusCounts(req: PayloadRequest, scope: ReportScope): Promise<Array<{ type: RequestType; status: RequestStatus; count: number; sum: number }>> {
  const r = await rows(
    req,
    sql`SELECT er.type::text AS type, er.status::text AS status, count(*)::int AS n, coalesce(sum(er.grand_total), 0)::text AS s
        FROM expense_requests er WHERE er.status <> 'draft' AND ${requestScopeSql(scope)}
        GROUP BY 1, 2 ORDER BY 1, 2`,
  )
  return r.map((x) => ({ type: x.type as RequestType, status: x.status as RequestStatus, count: num(x.n), sum: num(x.s) }))
}

/** K-13 per month of the request date (count + Σ grand total), non-draft, in scope; every month of the range present. */
export async function requestTrendMonthly(req: PayloadRequest, scope: ReportScope, from: string, to: string): Promise<Array<{ period: string; count: number; sum: number }>> {
  const r = await rows(
    req,
    sql`SELECT substr(er.request_date, 1, 7) AS period, count(*)::int AS n, coalesce(sum(er.grand_total), 0)::text AS s
        FROM expense_requests er
        WHERE er.status <> 'draft' AND er.request_date BETWEEN ${firstDay(from)} AND ${lastDay(to)} AND ${requestScopeSql(scope)}
        GROUP BY 1`,
  )
  const by = new Map(r.map((x) => [String(x.period), x]))
  return periodRange(from, to).map((period) => ({ period, count: num(by.get(period)?.n), sum: num(by.get(period)?.s) }))
}

/**
 * K-05 per month (Dicairkan bersih): posted transfers by transfer month − posted LPJ refunds by
 * entry month, of the requests in scope; every month of the range present.
 */
export async function disbursedMonthly(req: PayloadRequest, scope: ReportScope, from: string, to: string): Promise<Array<{ period: string; disbursed: number; refund: number; net: number }>> {
  const r = await rows(
    req,
    sql`WITH d AS (
          SELECT substr(t.transfer_date, 1, 7) AS period, sum(t.amount) AS amount FROM transfers t JOIN expense_requests er ON er.id = t.request_id
          WHERE t.status = 'posted' AND t.transfer_date BETWEEN ${firstDay(from)} AND ${lastDay(to)} AND ${requestScopeSql(scope)} GROUP BY 1),
        rf AS (
          SELECT substr(c.entry_date, 1, 7) AS period, sum(c.amount) AS amount FROM cash_entries c JOIN expense_requests er ON er.id = c.expense_request_id
          WHERE c.source_type = 'settlement_refund' AND c.status = 'posted' AND c.entry_date BETWEEN ${firstDay(from)} AND ${lastDay(to)} AND ${requestScopeSql(scope)} GROUP BY 1)
        SELECT coalesce(d.period, rf.period) AS period, coalesce(d.amount, 0)::text AS d, coalesce(rf.amount, 0)::text AS rf
        FROM d FULL JOIN rf ON rf.period = d.period`,
  )
  const by = new Map(r.map((x) => [String(x.period), x]))
  return periodRange(from, to).map((period) => {
    const d = num(by.get(period)?.d)
    const rf = num(by.get(period)?.rf)
    return { period, disbursed: d, refund: rf, net: d - rf }
  })
}

export type RecentCashEntry = {
  id: number
  entryNo: string | null
  entryDate: string
  direction: 'in' | 'out'
  amount: number
  status: 'posted' | 'void'
  sourceType: string
  account: string
  label: string
  requestId: number | null
  requestDocNo: string | null
}

/**
 * Latest rows of the cash ledger (Owner/Finance "Transaksi terbaru"). The ledger is office data
 * only (scope.ts): any scope other than `all` returns nothing, without querying.
 */
export async function recentCashEntries(req: PayloadRequest, scope: ReportScope, limit: number): Promise<RecentCashEntry[]> {
  if (scope.kind !== 'all') return []
  const r = await rows(
    req,
    sql`SELECT ce.id, ce.entry_no, ce.entry_date, ce.direction::text AS direction, ce.amount::text AS amount, ce.status::text AS status,
          ce.source_type::text AS source_type, a.name AS account,
          coalesce(nullif(ce.description, ''), c.name, s.name, '') AS label, er.id AS rid, er.doc_no
        FROM cash_entries ce
        JOIN cash_accounts a ON a.id = ce.cash_account_id
        LEFT JOIN expense_categories c ON c.id = ce.category_id
        LEFT JOIN cash_in_sources s ON s.id = ce.cash_in_source_id
        LEFT JOIN expense_requests er ON er.id = ce.expense_request_id
        ORDER BY ce.entry_date DESC, ce.id DESC LIMIT ${Math.max(1, Math.min(50, Math.floor(limit)))}`,
  )
  return r.map((x) => ({
    id: num(x.id),
    entryNo: (x.entry_no as string | null) ?? null,
    entryDate: String(x.entry_date),
    direction: x.direction === 'in' ? ('in' as const) : ('out' as const),
    amount: num(x.amount),
    status: x.status === 'void' ? ('void' as const) : ('posted' as const),
    sourceType: String(x.source_type),
    account: String(x.account),
    label: String(x.label),
    requestId: numOrNull(x.rid),
    requestDocNo: (x.doc_no as string | null) ?? null,
  }))
}

/**
 * First rows of the transfer queue (K-11 set: Uang Muka "approved" + Reimburse "receipts_verified")
 * by needed date — Finance "Menunggu tindakan saya". Office data: scope `all` only.
 */
export async function transferQueueTop(req: PayloadRequest, scope: ReportScope, limit: number) {
  if (scope.kind !== 'all') return []
  const ctx = await reportContext(req)
  const r = await rows(
    req,
    sql`SELECT er.id, er.doc_no, er.title, er.type::text AS type, er.status::text AS status, er.needed_date,
          coalesce(er.approved_amount, er.grand_total, 0)::text AS amount,
          coalesce(p.code || ' ' || p.name, cc.code || ' ' || cc.name, '') AS scope_name
        FROM expense_requests er
        LEFT JOIN projects p ON p.id = er.project_id LEFT JOIN cost_centers cc ON cc.id = er.cost_center_id
        WHERE (er.type = 'advance' AND er.status = 'approved') OR (er.type = 'reimburse' AND er.status = 'receipts_verified')
        ORDER BY er.needed_date NULLS LAST, er.id LIMIT ${Math.max(1, Math.min(50, Math.floor(limit)))}`,
  )
  return r.map((x) => {
    const needed = (x.needed_date as string | null) ?? null
    return {
      id: num(x.id),
      docNo: (x.doc_no as string | null) ?? null,
      title: String(x.title),
      type: x.type as RequestType,
      status: x.status as RequestStatus,
      scopeName: String(x.scope_name),
      amount: num(x.amount),
      neededDate: needed,
      overdue: needed !== null && needed < ctx.today,
    }
  })
}

export { inList }
