import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { financeDashboard, ownerDashboard, pmDashboard, staffDashboard } from '@/domain/reports/dashboards'
import { disbursedMonthly, recentCashEntries, requestStatusCounts, requestTrendMonthly, transferQueueTop } from '@/domain/reports/kpi'
import { addMonths } from '@/domain/reports/rules'
import { officeScope, ownScope, teamScope } from '@/domain/reports/scope'
import { resetRateLimits } from '@/lib/rate-limit'

import { getTestPayload, sqlAs } from './helpers'
import { api, asUser, draftBody, makeWorld, png, sysCreate, upload, type FlowUser, type Res, type World } from './flow-world'

/**
 * Beranda redesign (2026-09-25): read-only chart queries of kpi.ts and the `viz` part of the role
 * dashboards, incl. role scoping — PM sees only the projects/cost centers of his team, Staff only
 * own requests, the cash ledger (recent entries, transfer queue rows) is office data only.
 * Fictional data only; the DB is shared with other test files → every assertion is restricted to
 * this world's ids or compared with the same rule in plain SQL.
 */
let w: World
let today: string
let month: string
const E = '/api/v1/expense-requests'
const ids: Record<string, number> = {}

async function must(r: Promise<Res>, status = 200): Promise<Res['body']> {
  resetRateLimits()
  const res = await r
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 400)}`)
  return res.body
}

/** Request by `staff` in `projectId`, driven to `target` through /api/v1. */
async function drive(staff: FlowUser, requesterEmp: number, bank: number, projectId: number, ack: FlowUser, target: 'pending_ack' | 'pending_approval' | 'approved' | 'transferred' | 'rejected') {
  const d = await must(api('POST', E, staff, draftBody(w, { projectId, requesterIds: [requesterEmp], bankAccountId: bank })), 201)
  await must(api('POST', `${E}/${d.id}/submit`, staff, {}))
  if (target === 'pending_ack') return d.id as number
  if (target === 'rejected') {
    await must(api('POST', `${E}/${d.id}/reject`, ack, { reason: 'uji' }))
    return d.id as number
  }
  await must(api('POST', `${E}/${d.id}/acknowledge`, ack, {}))
  if (target === 'pending_approval') return d.id as number
  await must(api('POST', `${E}/${d.id}/approve`, w.users.finance, {}))
  if (target === 'approved') return d.id as number
  resetRateLimits()
  const proof = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png(undefined, 120, 90))
  await must(api('POST', `${E}/${d.id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `VIZ-${d.id}`, proofMediaId: proof.body.id }), 201)
  return d.id as number
}

beforeAll(async () => {
  w = await makeWorld('VZ')
  today = await asUser(w.users.finance, async (req) => (await import('@/domain/expense/common')).today(req))
  month = today.slice(0, 7)
  // staff A (world project, PM = w.users.pm); staff A also in the other project (PM = otherPm)
  await sysCreate('team-assignments', { employee: w.emp.a, project: w.otherProject, roleInProject: 'staff' })
  ids.ack = await drive(w.users.staffA, w.emp.a, w.accA, w.project, w.users.owner, 'pending_ack')
  ids.appr = await drive(w.users.staffA, w.emp.a, w.accA, w.project, w.users.owner, 'pending_approval')
  ids.approved = await drive(w.users.staffA, w.emp.a, w.accA, w.project, w.users.owner, 'approved')
  ids.transferred = await drive(w.users.staffA, w.emp.a, w.accA, w.project, w.users.owner, 'transferred')
  ids.rejected = await drive(w.users.staffB, w.emp.b, w.accB, w.project, w.users.owner, 'rejected')
  ids.other = await drive(w.users.staffA, w.emp.a, w.accA, w.otherProject, w.users.owner, 'transferred')
}, 600_000)

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

const worldRequests = () => Object.values(ids)

describe('requestStatusCounts / requestTrendMonthly (K-13) scoping', () => {
  it('Owner/Finance (all) = the SQL rule over every request', async () => {
    const r = await asUser(w.users.owner, async (req) => requestStatusCounts(req, await officeScope(req)))
    const sql = await sqlAs('app', "SELECT count(*)::int AS n FROM expense_requests WHERE status <> 'draft'")
    expect(r.reduce((s, x) => s + x.count, 0)).toBe(sql.rows[0].n)
  })

  it('PM: only requests of his team projects/cost centers', async () => {
    const r = await asUser(w.users.pm, async (req) => requestStatusCounts(req, await teamScope(req)))
    const sql = await sqlAs('app', "SELECT count(*)::int AS n FROM expense_requests WHERE status <> 'draft' AND (project_id = $1 OR cost_center_id = $2)", [w.project, w.costCenter])
    expect(r.reduce((s, x) => s + x.count, 0)).toBe(sql.rows[0].n)
    expect(r.find((x) => x.status === 'pending_ack')?.count).toBeGreaterThanOrEqual(1)
    // the other project's transferred request is NOT in the PM's scope
    const other = await asUser(w.users.otherPm, async (req) => requestStatusCounts(req, await teamScope(req)))
    expect(other.reduce((s, x) => s + x.count, 0)).toBe(
      (await sqlAs('app', "SELECT count(*)::int AS n FROM expense_requests WHERE status <> 'draft' AND project_id = $1", [w.otherProject])).rows[0].n,
    )
  })

  it('Staff: only own requests (creator or requester); staff B sees only the rejected one', async () => {
    const b = await asUser(w.users.staffB, async (req) => requestStatusCounts(req, await ownScope(req)))
    expect(b).toEqual([expect.objectContaining({ status: 'rejected', count: 1 })])
    const a = await asUser(w.users.staffA, async (req) => requestTrendMonthly(req, await ownScope(req), addMonths(month, -2), month))
    expect(a.map((x) => x.period)).toEqual([addMonths(month, -2), addMonths(month, -1), month])
    expect(a[2]!.count).toBe(5)
  })

  it('an EMPTY team scope returns nothing (never "all")', async () => {
    const r = await asUser(w.users.admin, async (req) => requestStatusCounts(req, { kind: 'team', projects: [], costCenters: [] }))
    expect(r).toEqual([])
  })
})

describe('disbursedMonthly (K-05 per month)', () => {
  it('PM scope = posted transfers of the team requests in the month', async () => {
    const r = await asUser(w.users.pm, async (req) => disbursedMonthly(req, await teamScope(req), month, month))
    const sql = await sqlAs(
      'app',
      "SELECT coalesce(sum(t.amount),0)::text AS s FROM transfers t JOIN expense_requests er ON er.id = t.request_id WHERE t.status='posted' AND substr(t.transfer_date,1,7) = $1 AND (er.project_id = $2 OR er.cost_center_id = $3)",
      [month, w.project, w.costCenter],
    )
    expect(r).toHaveLength(1)
    expect(r[0]!.disbursed).toBe(Number(sql.rows[0].s))
    expect(r[0]!.disbursed).toBeGreaterThan(0)
  })
})

describe('office-only ledger rows', () => {
  it('recentCashEntries: all → newest first; team/own/none → [] without data', async () => {
    const all = await asUser(w.users.finance, async (req) => recentCashEntries(req, await officeScope(req), 5))
    expect(all.length).toBeGreaterThan(0)
    for (let i = 1; i < all.length; i++) expect(all[i - 1]!.entryDate >= all[i]!.entryDate).toBe(true)
    expect(all.some((x) => x.requestId !== null && worldRequests().includes(x.requestId))).toBe(true)
    expect(await asUser(w.users.pm, async (req) => recentCashEntries(req, await teamScope(req), 5))).toEqual([])
    expect(await asUser(w.users.staffA, async (req) => recentCashEntries(req, await ownScope(req), 5))).toEqual([])
  })

  it('transferQueueTop: approved Uang Muka is queued; non-office scope → []', async () => {
    const q = await asUser(w.users.finance, async (req) => transferQueueTop(req, await officeScope(req), 50))
    // same K-11 set and order in plain SQL (shared DB: other files queue requests too)
    const sql = await sqlAs(
      'app',
      "SELECT id FROM expense_requests WHERE (type = 'advance' AND status = 'approved') OR (type = 'reimburse' AND status = 'receipts_verified') ORDER BY needed_date NULLS LAST, id LIMIT 50",
    )
    expect(q.map((x) => x.id)).toEqual(sql.rows.map((r) => r.id))
    const all = await sqlAs('app', "SELECT count(*)::int AS n FROM expense_requests WHERE type = 'advance' AND status = 'approved' AND id = $1", [ids.approved])
    expect(all.rows[0].n).toBe(1)
    expect(q.map((x) => x.id)).not.toContain(ids.transferred)
    expect(await asUser(w.users.pm, async (req) => transferQueueTop(req, await teamScope(req), 50))).toEqual([])
  })
})

describe('dashboards `viz` + API', () => {
  it('Owner/Finance: pipeline totals agree with the status counts; months filled', async () => {
    const o = await asUser(w.users.owner, (req) => ownerDashboard(req, { months: 6 }))
    expect(o.viz.requestTrend).toHaveLength(6)
    expect(o.viz.disbursed).toHaveLength(6)
    expect(o.viz.balanceTrend.at(-1)!.balance).toBe(o.cash.total)
    const sql = await sqlAs('app', "SELECT count(*)::int AS n FROM expense_requests WHERE status <> 'draft'")
    expect(o.viz.pipeline.total).toBe(sql.rows[0].n)
    expect(o.viz.categories.items.length).toBeLessThanOrEqual(7)
    const f = await asUser(w.users.finance, (req) => financeDashboard(req))
    // top 6 of the K-11 set (shared DB: other files queue requests too)
    const queued = await sqlAs('app', "SELECT id FROM expense_requests WHERE (type = 'advance' AND status = 'approved') OR (type = 'reimburse' AND status = 'receipts_verified')")
    expect(f.viz.transferTop.length).toBe(Math.min(6, queued.rows.length))
    for (const x of f.viz.transferTop) expect(queued.rows.map((r) => r.id)).toContain(x.id)
  })

  it('PM: viz pipeline/inbox limited to the team; Staff: own pipeline', async () => {
    const p = await asUser(w.users.pm, (req) => pmDashboard(req))
    const teamN = (await sqlAs('app', "SELECT count(*)::int AS n FROM expense_requests WHERE status <> 'draft' AND (project_id = $1 OR cost_center_id = $2)", [w.project, w.costCenter])).rows[0].n
    expect(p.viz.pipeline.total).toBe(teamN)
    // ADR 0013 (E1): the PM monitors only → nothing waits for the PM's decision (was: team "Diketahui")
    expect(p.viz.inbox.map((x) => x.id)).not.toContain(ids.ack)
    expect(p.viz.inbox.map((x) => x.id)).not.toContain(ids.other)
    const dir = await must(api('GET', '/api/v1/approvals/inbox', w.users.owner2))
    expect(dir.items.map((x: { id: number }) => x.id)).toContain(ids.ack) // waiting for the Direktur
    expect(p.viz.categories.includesManual).toBe(false)
    const s = await asUser(w.users.staffB, (req) => staffDashboard(req))
    expect(s.viz.pipeline.total).toBe(1)
    expect(s.viz.pipeline.exit.count).toBe(1)
  })

  it('GET /api/v1/dashboard/{pm,me,owner}: viz present, role-gated', async () => {
    const pm = await must(api('GET', '/api/v1/dashboard/pm', w.users.pm))
    expect(pm.viz.pipeline.stages).toHaveLength(5)
    const me = await must(api('GET', '/api/v1/dashboard/me', w.users.staffB))
    expect(me.viz.pipeline.total).toBe(1)
    resetRateLimits()
    expect((await api('GET', '/api/v1/dashboard/owner', w.users.pm)).status).toBe(403)
    resetRateLimits()
    expect((await api('GET', '/api/v1/dashboard/finance', w.users.staffA)).status).toBe(403)
  })
})
