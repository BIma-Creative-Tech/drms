import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { memberCompanies } from '@/access/roles'
import { kindOf } from '@/domain/field/rules'
import { BUDGET_COMMITTED, type RequestStatus } from '@/domain/expense/types'
import { getRequestTx } from '@/lib/tx'

/**
 * D4 (DRMS 10/10, owner 2026-10-11): RAP cost realisation. Every expense line of a project request is charged to
 * one RAP item of that project (`expense_requests_lines.rap_item_id`). Per item:
 * - planned     = round(volume × harga satuan) of the RAP item (null when the item has no price),
 * - realised    = Σ line totals of requests from the final approval onward (BUDGET_COMMITTED, same basis as the
 *                 US-26 budget "Komitmen"),
 * - transferred = Σ line totals of requests whose money left (Ditransfer and later),
 * - verified    = Σ valid receipt amounts of those lines once the LPJ / Reimburse receipts are verified,
 * - remaining   = planned − realised, percent = realised / planned.
 * Over budget (realised > planned) is a WARNING ("Melebihi RAP", flag `rap_over_budget`), never a blocker.
 * Money figures are for the price roles only (Direktur, Admin, Finance, PM — owner 2026-10-10: no prices for Staff).
 */

/** Realised = from the final approval onward. */
export const RAP_REALISED_STATUSES: readonly RequestStatus[] = BUDGET_COMMITTED

/** Transferred = the money left (Pengajuan Baru after the transfer, Reimburse "Ditransfer" / "Selesai"). */
export const RAP_TRANSFERRED_STATUSES: readonly RequestStatus[] = ['transferred', 'receipts_complete', 'lpj_submitted', 'lpj_revision', 'lpj_verified', 'completed']

export type RapMoney = {
  planned: number | null
  realised: number
  transferred: number
  verified: number
  /** planned − realised (null without a planned amount). */
  remaining: number | null
  /** realised / planned × 100, 2 decimals (null without a planned amount > 0). */
  percent: number | null
  overBudget: boolean
}

/** Planned amount of a RAP item: round(volume × unit price), null when unpriced. Pure. */
export function plannedAmount(volume: number, unitPrice: number | null | undefined): number | null {
  if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice)) return null
  return Math.round(volume * unitPrice)
}

/** Plan vs realisation figures of one item (or a sum of items). Pure. */
export function rapMoney(planned: number | null, realised: number, transferred = 0, verified = 0): RapMoney {
  return {
    planned,
    realised,
    transferred,
    verified,
    remaining: planned === null ? null : planned - realised,
    percent: planned !== null && planned > 0 ? Math.round((realised / planned) * 10000) / 100 : null,
    overBudget: planned !== null && realised > planned,
  }
}

/** Σ of item figures (planned = Σ priced items; null when no item is priced). Pure. */
export function sumRapMoney(items: readonly RapMoney[]): RapMoney & { overBudgetItems: number } {
  const priced = items.filter((i) => i.planned !== null)
  const planned = priced.length ? priced.reduce((s, i) => s + (i.planned ?? 0), 0) : null
  const m = rapMoney(
    planned,
    items.reduce((s, i) => s + i.realised, 0),
    items.reduce((s, i) => s + i.transferred, 0),
    items.reduce((s, i) => s + i.verified, 0),
  )
  return { ...m, overBudgetItems: items.filter((i) => i.overBudget).length }
}

const list = (vals: readonly string[]) =>
  sql.join(
    vals.map((v) => sql`${v}`),
    sql`, `,
  )

type UsageRow = { rap_item_id: number; realised: string; transferred: string; verified: string }

/**
 * Money used per RAP item of the given projects (all requests, any PT of the project — callers checked the
 * project's visibility). `excludeRequestId`: leave one request out (over-budget check of that request).
 */
export async function rapUsage(req: PayloadRequest, projectIds: readonly number[], opts: { excludeRequestId?: number } = {}): Promise<Map<number, { realised: number; transferred: number; verified: number }>> {
  const out = new Map<number, { realised: number; transferred: number; verified: number }>()
  if (projectIds.length === 0) return out
  const tx = await getRequestTx(req)
  const pids = sql.join(
    projectIds.map((p) => sql`${p}`),
    sql`, `,
  )
  const excl = opts.excludeRequestId ? sql`AND er.id <> ${opts.excludeRequestId}` : sql``
  const r = (await tx.execute(sql`
    WITH lines AS (
      SELECT l.id AS line_id, l.rap_item_id, l.total, er.id AS request_id, er.type::text AS type, er.status::text AS status
        FROM expense_requests_lines l JOIN expense_requests er ON er.id = l._parent_id
       WHERE er.project_id IN (${pids}) AND l.rap_item_id IS NOT NULL ${excl}
    )
    SELECT x.rap_item_id,
           coalesce(sum(x.total) FILTER (WHERE x.status IN (${list(RAP_REALISED_STATUSES)})), 0)::text AS realised,
           coalesce(sum(x.total) FILTER (WHERE x.status IN (${list(RAP_TRANSFERRED_STATUSES)})), 0)::text AS transferred,
           coalesce(sum((SELECT sum(r.amount) FROM receipts r WHERE r.line_id = x.line_id AND r.request_id = x.request_id AND r.status = 'valid'))
             FILTER (WHERE (x.type = 'advance' AND x.status IN ('lpj_verified', 'completed'))
                        OR (x.type = 'reimburse' AND x.status IN ('receipts_verified', 'transferred', 'completed'))), 0)::text AS verified
      FROM lines x GROUP BY x.rap_item_id`)) as unknown as { rows: UsageRow[] }
  for (const row of r.rows) out.set(Number(row.rap_item_id), { realised: Number(row.realised), transferred: Number(row.transferred), verified: Number(row.verified) })
  return out
}

export type RapItemRow = { id: number; project_id: number; company_id: number; code: string; description: string; kind: string; active: boolean; volume: number; unit_price: number | null; uom_code: string | null }

export async function rapItemRows(req: PayloadRequest, where: { projectIds?: readonly number[]; ids?: readonly number[] }): Promise<RapItemRow[]> {
  const conds = []
  if (where.projectIds) {
    if (where.projectIds.length === 0) return []
    conds.push(sql`i.project_id IN (${sql.join(
      where.projectIds.map((p) => sql`${p}`),
      sql`, `,
    )})`)
  }
  if (where.ids) {
    if (where.ids.length === 0) return []
    conds.push(sql`i.id IN (${sql.join(
      where.ids.map((p) => sql`${p}`),
      sql`, `,
    )})`)
  }
  const tx = await getRequestTx(req)
  const r = (await tx.execute(sql`
    SELECT i.id, i.project_id, i.company_id, i.code, i.description, i.kind::text AS kind, coalesce(i.active, true) AS active,
           i.volume::text AS volume, i.unit_price::text AS unit_price, u.code AS uom_code
      FROM rap_items i LEFT JOIN uoms u ON u.id = i.uom_id
     WHERE ${sql.join(conds, sql` AND `)}
     ORDER BY i.sort_order, i.id`)) as unknown as { rows: Array<Record<string, unknown>> }
  return r.rows.map((x) => ({
    id: Number(x.id),
    project_id: Number(x.project_id),
    company_id: Number(x.company_id),
    code: String(x.code),
    description: String(x.description),
    kind: String(x.kind),
    active: x.active !== false,
    volume: Number(x.volume),
    unit_price: x.unit_price === null || x.unit_price === undefined ? null : Number(x.unit_price),
    uom_code: (x.uom_code as string | null) ?? null,
  }))
}

/** Per-item money of one or more projects (items of every kind; inactive items keep their realisation). */
export async function rapItemMoney(req: PayloadRequest, projectIds: readonly number[]): Promise<Map<number, RapMoney & { projectId: number; active: boolean }>> {
  const [items, usage] = [await rapItemRows(req, { projectIds }), await rapUsage(req, projectIds)]
  const out = new Map<number, RapMoney & { projectId: number; active: boolean }>()
  for (const i of items) {
    const u = usage.get(i.id) ?? { realised: 0, transferred: 0, verified: 0 }
    out.set(i.id, { ...rapMoney(plannedAmount(i.volume, i.unit_price), u.realised, u.transferred, u.verified), projectId: i.project_id, active: i.active })
  }
  return out
}

export type ProjectRapSummary = RapMoney & { projectId: number; items: number; overBudgetItems: number }

/** Plan vs realisation per project (Σ of its RAP items) — "Monitoring RAP", project list, APK project screen. */
export async function projectRapSummaries(req: PayloadRequest, projectIds: readonly number[]): Promise<Map<number, ProjectRapSummary>> {
  const money = await rapItemMoney(req, projectIds)
  const out = new Map<number, ProjectRapSummary>()
  for (const pid of projectIds) {
    const items = [...money.values()].filter((m) => m.projectId === pid && (m.active || m.realised > 0))
    const s = sumRapMoney(items)
    out.set(pid, { ...s, projectId: pid, items: items.length })
  }
  return out
}

/**
 * D4 rule of the project: a line must name a RAP item of the project when the project HAS a RAP (≥ 1 active item),
 * and a konstruksi project must have one before anything can be sent (owner: "every project with RAB has ≥ 1
 * RAP item"; RAP exists for konstruksi only since P3 — other kinds without RAP stay unconstrained). Local API reads
 * (no raw SQL): also called from the collection hook of the admin form.
 */
export async function rapRequirement(req: PayloadRequest, projectId: number): Promise<{ hasRap: boolean; konstruksi: boolean; items: Map<number, { active: boolean }> }> {
  const res = await req.payload.find({
    collection: 'rap-items',
    where: { project: { equals: projectId } },
    depth: 0,
    pagination: false,
    select: { active: true },
    overrideAccess: true, // SYSTEM-READ: RAP items of the request's project (D4 validation; caller's project scope checked by validateContent)
    req,
  })
  const items = new Map(res.docs.map((d) => [d.id as number, { active: (d as { active?: boolean | null }).active !== false }]))
  const p = await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, select: { kind: true }, overrideAccess: true /* SYSTEM-READ: project kind for the D4 rule */, req, disableErrors: true })
  return { hasRap: [...items.values()].some((i) => i.active), konstruksi: kindOf((p as { kind?: unknown } | null)?.kind) === 'konstruksi', items }
}

export type RapOverLine = { lineId: string; lineNo: number; itemId: number; itemCode: string; itemName: string; planned: number; usedOthers: number; thisRequest: number }

/**
 * Lines of a request whose RAP item would be (or is) over its planned amount: realised of the OTHER requests +
 * this request's lines of the item > planned. Unpriced items are never flagged (nothing to compare).
 */
export async function rapOverBudgetLines(req: PayloadRequest, input: { requestId: number; projectId: number | null; lines: ReadonlyArray<{ id: string; lineNo: number; total: number; rapItem: number | null }> }): Promise<RapOverLine[]> {
  const charged = input.lines.filter((l) => l.rapItem !== null)
  if (!input.projectId || charged.length === 0) return []
  const itemIds = [...new Set(charged.map((l) => l.rapItem as number))]
  const items = new Map((await rapItemRows(req, { ids: itemIds })).map((i) => [i.id, i]))
  const usage = await rapUsage(req, [input.projectId], { excludeRequestId: input.requestId })
  const out: RapOverLine[] = []
  for (const itemId of itemIds) {
    const item = items.get(itemId)
    const planned = item && item.project_id === input.projectId ? plannedAmount(item.volume, item.unit_price) : null
    if (planned === null) continue
    const mine = charged.filter((l) => l.rapItem === itemId)
    const thisRequest = mine.reduce((s, l) => s + l.total, 0)
    const usedOthers = usage.get(itemId)?.realised ?? 0
    if (usedOthers + thisRequest <= planned) continue
    for (const l of mine) out.push({ lineId: l.id, lineNo: l.lineNo, itemId, itemCode: item!.code, itemName: item!.description, planned, usedOthers, thisRequest })
  }
  return out
}

export type RapMonitorRow = ProjectRapSummary & { code: string; name: string; companyId: number; status: string | null }

/**
 * Direktur dashboard "Monitoring RAP" (DRMS 10/10 point 2–4): the projects with a RAP that the caller may read
 * (selected PTs, not archived), plan vs realisation + items over plan, highest realisation % first. Call inside a
 * transaction (raw SQL sums).
 */
export async function rapMonitoring(req: PayloadRequest, opts: { limit?: number } = {}): Promise<{ rows: RapMonitorRow[]; projects: number; overProjects: number }> {
  const companies = memberCompanies(req)
  if (companies.length === 0) return { rows: [], projects: 0, overProjects: 0 }
  const tx = await getRequestTx(req)
  const withRap = (await tx.execute(
    sql`SELECT DISTINCT project_id FROM rap_items WHERE company_id IN (${sql.join(
      companies.map((c) => sql`${c}`),
      sql`, `,
    )})`,
  )) as unknown as { rows: Array<{ project_id: number }> }
  const ids = withRap.rows.map((r) => Number(r.project_id))
  if (ids.length === 0) return { rows: [], projects: 0, overProjects: 0 }
  let docs: Array<{ id: number; code?: string; name?: string; company?: unknown; status?: string | null }> = []
  try {
    const res = await req.payload.find({
      collection: 'projects',
      where: { and: [{ id: { in: ids } }, { status: { not_equals: 'arsip' } }] },
      depth: 0,
      limit: 500,
      select: { code: true, name: true, company: true, status: true },
      user: req.user,
      overrideAccess: false, // caller's project read scope (Direktur: every project of the selected PTs)
      req,
    })
    docs = res.docs as typeof docs
  } catch (err) {
    if ((err as { status?: number }).status !== 403) throw err
  }
  const sums = await projectRapSummaries(req, docs.map((d) => d.id))
  const rows: RapMonitorRow[] = docs.map((d) => ({
    ...sums.get(d.id)!,
    code: d.code ?? '',
    name: d.name ?? '',
    companyId: typeof d.company === 'number' ? d.company : ((d.company as { id?: number } | null)?.id ?? -1),
    status: d.status ?? null,
  }))
  rows.sort((a, b) => Number(b.overBudgetItems > 0) - Number(a.overBudgetItems > 0) || (b.percent ?? -1) - (a.percent ?? -1) || a.code.localeCompare(b.code))
  return { rows: rows.slice(0, opts.limit ?? 8), projects: rows.length, overProjects: rows.filter((r) => r.overBudgetItems > 0).length }
}
