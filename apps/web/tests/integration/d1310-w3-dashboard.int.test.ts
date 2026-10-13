import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { addDays } from '@/domain/expense/types'
import { financeDashboard, loanBlock, ownerDashboard, pmDashboard, rapMissingBlock, rapMonitoringBlock, slaBlock, staffDashboard } from '@/domain/reports/dashboards'
import { resetRateLimits } from '@/lib/rate-limit'

import { fixturePm, getTestPayload, sqlAs } from './helpers'
import { api, asUser, makeFlowUser, makeWorld, sysCreate, type FlowUser, type Res, type World } from './flow-world'

/**
 * DRMS 13/10 Wave 3 — dashboard parity APK ↔ web: "SLA transfer", "Pinjaman antar project", "Project ber-RAB tanpa
 * RAP" and "Monitoring RAP" are part of GET /api/v1/dashboard/{owner,finance,pm} (the web view renders the SAME
 * blocks, so the numbers cannot drift). Role visibility as on the web: Direktur all four, Finance SLA + loans, PM
 * loans + its team's projects without RAP, Staff (`/dashboard/me`) none of them (no money). PT scope: a Direktur of
 * another PT never sees this world's projects. Fictional data only.
 */
let w: World
let today = ''
let noRap = 0 // umum project WITH a RAB and WITHOUT a RAP (PM = w.users.pm)
let otherPt = 0
let foreignOwner: FlowUser
let foreignNoRap = 0
const L = '/api/v1/project-loans'

async function must(r: Promise<Res>, status = 200): Promise<Res['body']> {
  resetRateLimits()
  const res = await r
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 400)}`)
  return res.body
}

async function loan(over: Record<string, unknown>): Promise<number> {
  const c = await must(
    api('POST', L, w.users.pm, { borrowerProjectId: w.project, lenderProjectId: w.otherProject, amount: 7_500_000, reason: 'Termin klien belum cair, bayar material', dueDate: addDays(today, 30), submit: true, ...over }, { 'Idempotency-Key': randomUUID() }),
    201,
  )
  return c.id as number
}

beforeAll(async () => {
  w = await makeWorld('WTD') // letters only: the world's vehicle plate suffix comes from the tag
  today = (await sqlAs('app', "SELECT to_char(now() AT TIME ZONE 'Asia/Makassar', 'YYYY-MM-DD') AS d")).rows[0].d
  noRap = await sysCreate('projects', { code: `W3D-NR${Date.now() % 10000}`, name: 'W3D tanpa RAP', kind: 'umum', pm: w.users.pm.id, budget: 9_000_000, status: 'berjalan' }, { rap: false })
  // one approved loan (outstanding) + one waiting for the Direktur
  const approved = await loan({})
  await must(api('POST', `${L}/${approved}/approve`, w.users.owner, {}, { 'Idempotency-Key': randomUUID() }))
  await loan({ amount: 2_500_000 })
  // a second PT with its own Direktur and a RAB project without RAP
  otherPt = await sysCreate('companies', { name: 'PT Uji Dashboard W3', shortCode: `W3${Date.now() % 1000}`, timezone: 'Asia/Makassar' })
  foreignOwner = await makeFlowUser(['pk-owner'], 'w3d-foreign-owner', null, { company: otherPt })
  foreignNoRap = await sysCreate('projects', { company: otherPt, pm: await fixturePm(otherPt), code: 'W3D-X1', name: 'W3D lain PT', kind: 'umum', budget: 4_000_000, status: 'berjalan' }, { rap: false })
}, 600_000)

beforeEach(() => resetRateLimits())

afterAll(async () => {
  const p = await getTestPayload()
  // every other test file assumes the single-company default (same as d1010-loans / mc-isolation)
  if (otherPt) await p.update({ collection: 'companies', id: otherPt, data: { active: false, changeReason: 'uji dashboard W3 selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
})

describe('Direktur (/dashboard/owner): SLA, loans, RAP monitoring, projects without RAP', () => {
  it('the payload carries the same numbers as the block functions (single source for web + APK)', async () => {
    const o = await asUser(w.users.owner, (req) => ownerDashboard(req))
    expect(o.sla).toEqual(await asUser(w.users.owner, (req) => slaBlock(req)))
    expect(o.loans).toEqual(await asUser(w.users.owner, (req) => loanBlock(req)))
    expect(o.rapMonitoring).toEqual(await asUser(w.users.owner, (req) => rapMonitoringBlock(req)))
    expect(o.rapMissing).toEqual(await asUser(w.users.owner, (req) => rapMissingBlock(req, false)))
    expect(o.sla.month).toBe(o.month)
    expect(o.sla.text).toEqual(o.sla.pctWithin === null ? '—' : expect.stringMatching(/%$/))
    expect(typeof o.sla.avgText).toBe('string')
  })

  it('loans: outstanding of the approved loan, pending + waiting for this Direktur, world project in the top rows', async () => {
    const o = await must(api('GET', '/api/v1/dashboard/owner', w.users.owner))
    expect(o.loans.totals.outstanding).toBeGreaterThanOrEqual(7_500_000)
    expect(o.loans.totals.pending).toBeGreaterThanOrEqual(1)
    expect(o.loans.waitingForMe).toBeGreaterThanOrEqual(1)
    const sql = await sqlAs('app', "SELECT coalesce(sum(amount - repaid_total), 0)::text AS s FROM project_loans WHERE status::text IN ('approved', 'partially_repaid', 'repaid') AND company_id = (SELECT id FROM companies WHERE short_code = 'DRMS')")
    expect(o.loans.totals.outstanding).toBe(Number(sql.rows[0].s))
    expect(o.loans.projects.length).toBeLessThanOrEqual(5)
    expect(o.rapMissing).toMatchObject({ team: false })
    const all = await asUser(w.users.owner, async (req) => (await import('@/domain/rap/budget')).rapMissingProjects(req, { limit: 500 }))
    expect(all.rows.map((r) => r.id)).toContain(noRap)
    expect(o.rapMissing.total).toBe(all.total)
    for (const r of o.rapMissing.rows) expect(typeof r.kindLabel).toBe('string')
    expect(o.rapMonitoring.projects).toBeGreaterThanOrEqual(1) // the world projects carry a fixture RAP item
  })

  it('PT scope: a Direktur of another PT sees none of this world\'s projects or loans', async () => {
    const f = await must(api('GET', '/api/v1/dashboard/owner', foreignOwner))
    expect(f.companies.map((c: { id: number }) => c.id)).toEqual([otherPt])
    const missing = f.rapMissing.rows.map((r: { id: number }) => r.id)
    expect(missing).toContain(foreignNoRap)
    expect(missing).not.toContain(noRap)
    expect(f.rapMonitoring.rows.map((r: { projectId: number }) => r.projectId)).not.toContain(w.project)
    expect(f.loans.projects.map((r: { projectId: number }) => r.projectId)).not.toContain(w.project)
    expect(f.loans.totals.outstanding).toBe(0)
    expect(f.loans.waitingForMe).toBe(0)
    const mine = await must(api('GET', '/api/v1/dashboard/owner', w.users.owner))
    expect(mine.rapMissing.rows.map((r: { id: number }) => r.id)).not.toContain(foreignNoRap)
  })
})

describe('Finance (/dashboard/finance): SLA + loans only', () => {
  it('same blocks as the Direktur cards on the web; no RAP blocks; no loan decisions', async () => {
    const f = await must(api('GET', '/api/v1/dashboard/finance', w.users.finance))
    expect(f.sla).toEqual(await asUser(w.users.finance, (req) => slaBlock(req)))
    expect(f.loans.totals.outstanding).toBeGreaterThanOrEqual(7_500_000)
    expect(f.loans.waitingForMe).toBe(0)
    expect(f).not.toHaveProperty('rapMissing')
    expect(f).not.toHaveProperty('rapMonitoring')
    const d = await asUser(w.users.finance, (req) => financeDashboard(req))
    expect(d.loans).toEqual(await asUser(w.users.finance, (req) => loanBlock(req)))
  })
})

describe('PM (/dashboard/pm): team loans + team projects without RAP, no SLA', () => {
  it('team scope only', async () => {
    const p = await must(api('GET', '/api/v1/dashboard/pm', w.users.pm))
    expect(p).not.toHaveProperty('sla')
    expect(p).not.toHaveProperty('rapMonitoring')
    expect(p.rapMissing.team).toBe(true)
    expect(p.rapMissing.rows.map((r: { id: number }) => r.id)).toContain(noRap)
    expect(p.loans.projects.map((r: { projectId: number }) => r.projectId)).toContain(w.project)
    expect(p.loans.waitingForMe).toBe(0)
    const d = await asUser(w.users.pm, (req) => pmDashboard(req))
    expect(d.rapMissing).toEqual(await asUser(w.users.pm, (req) => rapMissingBlock(req, true)))
    expect(d.loans).toEqual(await asUser(w.users.pm, (req) => loanBlock(req)))
    // the other PM is not PM of `noRap`
    const other = await must(api('GET', '/api/v1/dashboard/pm', w.users.otherPm))
    expect(other.rapMissing.rows.map((r: { id: number }) => r.id)).not.toContain(noRap)
  })
})

describe('Staff: no money blocks', () => {
  it('/dashboard/me carries none of the office cards; office layouts are 403', async () => {
    const me = await must(api('GET', '/api/v1/dashboard/me', w.users.staffA))
    for (const k of ['sla', 'loans', 'rapMissing', 'rapMonitoring', 'cash', 'accounts', 'cashTotal', 'projects']) expect(me).not.toHaveProperty(k)
    const d = await asUser(w.users.staffA, (req) => staffDashboard(req))
    expect(Object.keys(d).sort()).toEqual(['actions', 'companies', 'latest', 'month', 'viz'])
    for (const p of ['/api/v1/dashboard/owner', '/api/v1/dashboard/finance', '/api/v1/dashboard/pm']) {
      resetRateLimits()
      expect((await api('GET', p, w.users.staffA)).status).toBe(403)
    }
  })
})
