import { beforeAll, describe, expect, it } from 'vitest'

import { costCenterMonth } from '@/domain/reports/kpi'
import { officeScope } from '@/domain/reports/scope'
import { rapMonitoring } from '@/domain/rap/budget'
import { resetRateLimits } from '@/lib/rate-limit'

import { api, asUser, draftBody, legacyCostCenter, makeWorld, png, sysCreate, upload, type World } from './flow-world'
import { sqlAs, sqlError } from './helpers'

/**
 * DRMS 10/10 Phase C (server): D4 RAP cost realisation (line → RAP item of the request's project, plan vs
 * realisation, "Melebihi RAP" flag for the RAP viewers, DB rules), D2 (no non-project requests, cost center set by
 * Finance at the transfer — default = the project's, ledger + K-15), project / cost-center API of the APK,
 * project + search + page filters of the request list. Fictional data.
 */
const E = '/api/v1/expense-requests'
let w: World
let kon = 0 // konstruksi project with RAP (default cost center: w.projectCostCenter)
let bare = 0 // konstruksi project WITHOUT RAP and without a default cost center
const item: Record<string, number> = {}

async function proof(): Promise<number> {
  const r = await upload('/api/v1/media/transfer-proofs', w.users.finance, await png())
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id as number
}

const rapLine = (rapItemId: number | null, unitPrice: number, over: Record<string, unknown> = {}) => ({ description: 'Galian', qty: 1, uomId: w.uom.l, unitPrice, categoryId: w.cat.mat, rapItemId, ...over })

beforeAll(async () => {
  w = await makeWorld(`dc${Date.now() % 100000}`)
  kon = await sysCreate('projects', { code: `DC-K${Date.now() % 100000}`, name: 'Gedung uji RAP', kind: 'konstruksi', pm: w.users.pm.id, budget: 50_000_000, status: 'berjalan', costCenter: w.projectCostCenter })
  bare = await sysCreate('projects', { code: `DC-B${Date.now() % 100000}`, name: 'Konstruksi tanpa RAP', kind: 'konstruksi', pm: w.users.pm.id, budget: 10_000_000, status: 'berjalan' })
  for (const p of [kon, bare]) for (const e of [w.emp.a, w.emp.b]) await sysCreate('team-assignments', { employee: e, project: p, roleInProject: 'staff' })
  const stage = await sysCreate('project-stages', { project: kon, name: 'Pekerjaan tanah', weightPct: 100, sequence: 1 })
  for (const [code, volume, unitPrice] of [
    ['A.1', 10, 100_000],
    ['A.2', 5, 200_000],
  ] as const) {
    const r = await api('POST', `/api/v1/projects/${kon}/rap/items`, w.users.pm, { code, description: `Item ${code}`, stageId: stage, kind: 'pekerjaan', uomId: w.uom.l, volume, unitPrice })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    item[code] = r.body.id
  }
})

describe('D2: no non-project requests', () => {
  it('a cost center from the requester (old APK) is ignored; sending without a project → 400', async () => {
    resetRateLimits()
    const c = await api('POST', E, w.users.staffA, draftBody(w, { projectId: null, costCenterId: w.costCenter }))
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    expect(c.body).toMatchObject({ projectId: null, costCenterId: null, costCenter: null })
    const s = await api('POST', `${E}/${c.body.id}/submit`, w.users.staffA, {})
    expect(s.status).toBe(400)
    expect(s.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'projectId', message: expect.stringContaining('Project wajib') })]))
  })

  it('DB: a new row with a cost center, or a cost center set later → refused (23514); sending without a project → refused', async () => {
    const own = (await api('POST', E, w.users.staffA, draftBody(w))).body.id as number
    expect((await sqlError('app', 'UPDATE expense_requests SET cost_center_id = $1 WHERE id = $2', [w.costCenter, own]))?.code).toBe('23514')
    const noProject = (await api('POST', E, w.users.staffA, draftBody(w, { projectId: null }))).body.id as number
    expect((await sqlError('app', "UPDATE expense_requests SET status = 'pending_ack' WHERE id = $1", [noProject]))?.message).toMatch(/sent with a project/)
  })

  it('a legacy cost-center DRAFT that gets a project drops its cost center and is sent normally', async () => {
    const id = (await api('POST', E, w.users.staffA, draftBody(w, { projectId: null }))).body.id as number
    // legacy row (before D2): only the migration's owner could have such data
    await legacyCostCenter(id, w.costCenter)
    const legacy = (await api('GET', `${E}/${id}`, w.users.staffA)).body
    expect(legacy.costCenterId).toBe(w.costCenter)
    const u = await api('PATCH', `${E}/${id}`, w.users.staffA, { projectId: w.project })
    expect(u.status, JSON.stringify(u.body)).toBe(200)
    expect(u.body).toMatchObject({ projectId: w.project, costCenterId: null })
    expect((await api('POST', `${E}/${id}/submit`, w.users.staffA, {})).status).toBe(200)
  })
})

describe('D4: RAP item per line, plan vs realisation, "Melebihi RAP"', () => {
  let a = 0
  let b = 0
  it('submit: every line needs a RAP item of the project; an item of another project → 400 already in the draft', async () => {
    const d = await api('POST', E, w.users.staffA, draftBody(w, { projectId: kon, lines: [rapLine(null, 300_000)] }))
    expect(d.status, JSON.stringify(d.body)).toBe(201)
    const s = await api('POST', `${E}/${d.body.id}/submit`, w.users.staffA, {})
    expect(s.status).toBe(400)
    expect(s.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'lines.0.rapItemId', message: 'Item RAP wajib dipilih.' })]))
    const foreign = await api('PATCH', `${E}/${d.body.id}`, w.users.staffA, { projectId: w.project, lines: [rapLine(item['A.1']!, 300_000)] })
    expect(foreign.status).toBe(400)
    expect(foreign.body.errors).toEqual([expect.objectContaining({ path: 'lines.0.rapItemId' })])
    // a konstruksi project without RAP cannot send requests yet
    const noRap = await api('POST', E, w.users.staffA, draftBody(w, { projectId: bare }))
    const sn = await api('POST', `${E}/${noRap.body.id}/submit`, w.users.staffA, {})
    expect(sn.status).toBe(400)
    expect(sn.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'projectId', message: expect.stringContaining('belum punya RAP') })]))
  })

  it('approved lines are the realisation of their RAP item (GET /projects/{id}/rap, price roles only)', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w, { projectId: kon, lines: [rapLine(item['A.1']!, 600_000), rapLine(item['A.2']!, 250_000, { description: 'Urugan' })] }))
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    a = c.body.id
    expect(c.body.lines.map((l: { rapItem: { id: number; code: string } }) => [l.rapItem.id, l.rapItem.code])).toEqual([
      [item['A.1'], 'A.1'],
      [item['A.2'], 'A.2'],
    ])
    expect((await api('POST', `${E}/${a}/submit`, w.users.staffA, {})).status).toBe(200)
    expect((await api('POST', `${E}/${a}/acknowledge`, w.users.owner, {})).status).toBe(200)
    expect((await api('POST', `${E}/${a}/approve`, w.users.finance, {})).status).toBe(200)
    const rap = (await api('GET', `/api/v1/projects/${kon}/rap`, w.users.owner)).body
    const a1 = rap.items.find((i: { code: string }) => i.code === 'A.1')
    expect(a1).toMatchObject({ name: 'Item A.1', qty: 10, planned: 1_000_000, realisedAmount: 600_000, transferredAmount: 0, remaining: 400_000, percent: 60, overBudget: false, realised: 0 })
    expect(rap.budget).toMatchObject({ planned: 2_000_000, realised: 850_000, overBudgetItems: 0 })
    const staff = (await api('GET', `/api/v1/projects/${kon}/rap`, w.users.staffA)).body
    expect(staff.budget).toBeNull()
    expect(staff.items[0].planned).toBeUndefined()
    expect(staff.items[0].realisedAmount).toBeUndefined()
  })

  it('over plan → flag "Melebihi RAP" (warning, not blocking) for PM / Direktur / Finance — never for Staff', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w, { projectId: kon, lines: [rapLine(item['A.1']!, 500_000)] }))
    b = c.body.id
    expect((await api('POST', `${E}/${b}/submit`, w.users.staffA, {})).status).toBe(200)
    const owner = (await api('GET', `${E}/${b}`, w.users.owner)).body
    expect(owner.lines[0].rapOverBudget).toBe(true)
    expect(owner.flags).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'rap_over_budget', kindLabel: 'Melebihi RAP', level: 'warning', lineNo: 1, status: 'open' })]))
    expect(owner.flags.find((f: { kind: string }) => f.kind === 'rap_over_budget').message).not.toMatch(/Rp/)
    const staff = (await api('GET', `${E}/${b}`, w.users.staffA)).body
    expect(staff.lines[0].rapOverBudget).toBe(false)
    expect(staff.flags.some((f: { kind: string }) => f.kind === 'rap_over_budget')).toBe(false)
    // not blocking: the Direktur approves; the decision stores the open flag
    expect((await api('POST', `${E}/${b}/acknowledge`, w.users.owner, {})).status).toBe(200)
    expect((await api('POST', `${E}/${b}/approve`, w.users.finance, {})).status).toBe(200)
    const rap = (await api('GET', `/api/v1/projects/${kon}/rap`, w.users.pm)).body
    expect(rap.items.find((i: { code: string }) => i.code === 'A.1')).toMatchObject({ realisedAmount: 1_100_000, remaining: -100_000, percent: 110, overBudget: true })
    expect(rap.budget.overBudgetItems).toBe(1)
    const m = await asUser(w.users.owner, (req) => rapMonitoring(req, { limit: 50 }))
    expect(m.rows.find((r) => r.projectId === kon)).toMatchObject({ overBudgetItems: 1, realised: 1_350_000, planned: 2_000_000 })
  })

  it('old clients keep the stored RAP item; DB: an item of another project → 23514, a locked line item → 42501', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w, { projectId: kon, lines: [rapLine(item['A.2']!, 10_000)] }))
    const lines = c.body.lines.map((l: { id: string }) => ({ id: l.id, description: 'Urugan lama', qty: 1, uomId: w.uom.l, unitPrice: 12_000, categoryId: w.cat.mat }))
    const u = await api('PATCH', `${E}/${c.body.id}`, w.users.staffA, { lines })
    expect(u.status, JSON.stringify(u.body)).toBe(200)
    expect(u.body.lines[0].rapItem.id).toBe(item['A.2'])
    const other = await sysCreate('rap-items', { project: w.otherProject, stage: await sysCreate('project-stages', { project: w.otherProject, name: 'Lain', weightPct: 100, sequence: 1 }), code: 'X.1', description: 'Lain', kind: 'pekerjaan', uom: w.uom.l, volume: 1 })
    expect((await sqlError('app', 'UPDATE expense_requests_lines SET rap_item_id = $1 WHERE _parent_id = $2', [other, c.body.id]))?.code).toBe('23514')
    expect((await sqlError('app', 'UPDATE expense_requests_lines SET rap_item_id = $1 WHERE _parent_id = $2', [item['A.2'], a]))?.code).toBe('42501')
  })

  it('D2 transfer: cost center required (default = the project\'s); KK carries project + cost center; K-15 by the chosen cost center', async () => {
    const q = (await api('GET', '/api/v1/transfer-queue', w.users.finance)).body.items.find((x: { id: number }) => x.id === a)
    expect(q).toMatchObject({ project: { id: kon }, costCenter: { id: w.projectCostCenter }, bankVerification: 'verified', sla: expect.objectContaining({ slaHours: expect.any(Number) }) })
    const t = await api('POST', `${E}/${a}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `DC-${a}`, proofMediaId: await proof(), costCenterId: w.costCenter })
    expect(t.status, JSON.stringify(t.body)).toBe(201)
    expect(t.body.request.transfers[0].costCenter).toMatchObject({ id: w.costCenter })
    const kk = (await sqlAs('app', 'SELECT project_id, cost_center_id FROM cash_entries WHERE id = $1', [t.body.cashEntryId])).rows[0]
    expect(kk).toEqual({ project_id: kon, cost_center_id: w.costCenter })
    const rap = (await api('GET', `/api/v1/projects/${kon}/rap`, w.users.finance)).body
    expect(rap.items.find((i: { code: string }) => i.code === 'A.1').transferredAmount).toBe(600_000)
    const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Makassar' }).slice(0, 7)
    const k15 = await asUser(w.users.finance, async (req) => costCenterMonth(req, await officeScope(req), month))
    expect(k15.find((c) => c.id === w.costCenter)!.fromRequests).toBeGreaterThanOrEqual(850_000)
  })

  it('no default cost center and none chosen → 400 costCenterId; a cost center of another PT → 400', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w, { projectId: bare, lines: [rapLine(null, 50_000)] }))
    // `bare` has no RAP → a legacy-free path: make it a plain (umum) project for this check
    await sqlAs('owner', 'UPDATE projects SET kind = $1 WHERE id = $2', ['umum', bare])
    expect((await api('POST', `${E}/${c.body.id}/submit`, w.users.staffA, {})).status).toBe(200)
    expect((await api('POST', `${E}/${c.body.id}/acknowledge`, w.users.owner, {})).status).toBe(200)
    expect((await api('POST', `${E}/${c.body.id}/approve`, w.users.finance, {})).status).toBe(200)
    const q = (await api('GET', '/api/v1/transfer-queue', w.users.finance)).body.items.find((x: { id: number }) => x.id === c.body.id)
    expect(q.costCenter).toBeNull()
    const none = await api('POST', `${E}/${c.body.id}/transfer`, w.users.finance, { cashAccountId: w.cashAccount, bankRef: `DC-N-${c.body.id}`, proofMediaId: await proof() })
    expect(none.status).toBe(400)
    expect(none.body.errors).toEqual([expect.objectContaining({ path: 'costCenterId' })])
  })
})

describe('APK: projects, cost centers, request list filters', () => {
  it('GET /projects: Staff = assigned projects, no RAP money; Direktur = all with RAP money; search + paging', async () => {
    const staff = await api('GET', '/api/v1/projects?limit=100', w.users.staffA)
    expect(staff.status).toBe(200)
    const sk = staff.body.docs.find((p: { id: number }) => p.id === kon)
    expect(sk).toMatchObject({ code: expect.any(String), kind: 'konstruksi', pm: { id: w.users.pm.id }, costCenter: { id: w.projectCostCenter }, rapPlanned: null, rapRealised: null, rapItems: 2 })
    expect(staff.body.docs.some((p: { id: number }) => p.id === w.otherProject)).toBe(false)
    const own = await api('GET', `/api/v1/projects?q=${encodeURIComponent('Gedung uji RAP')}&limit=1&page=1`, w.users.owner)
    expect(own.body).toMatchObject({ page: 1, limit: 1 })
    expect(own.body.docs[0]).toMatchObject({ id: kon, rapPlanned: 2_000_000, rapRealised: 1_350_000, rapOverBudgetItems: 1 })
    const d = await api('GET', `/api/v1/projects/${kon}`, w.users.pm)
    expect(d.body).toMatchObject({ id: kon, rap: { items: 2, planned: 2_000_000, overBudgetItems: 1 } })
    expect((await api('GET', `/api/v1/projects/${w.otherProject}`, w.users.staffA)).status).toBe(404)
  })

  it('GET /cost-centers (Finance picker) and GET /expense-requests?project=&q=&page=', async () => {
    const cc = await api('GET', '/api/v1/cost-centers', w.users.finance)
    expect(cc.status).toBe(200)
    expect(cc.body.docs.map((c: { id: number }) => c.id)).toEqual(expect.arrayContaining([w.costCenter, w.projectCostCenter]))
    const list = await api('GET', `${E}?project=${kon}&page=1&limit=2`, w.users.owner)
    expect(list.status, JSON.stringify(list.body)).toBe(200)
    expect(list.body).toMatchObject({ page: 1, nextCursor: null })
    expect(list.body.totalDocs).toBeGreaterThanOrEqual(3)
    expect(list.body.items.every((i: { projectId: number }) => i.projectId === kon)).toBe(true)
    const none = await api('GET', `${E}?project=${kon}&q=tidak-ada-judul-ini`, w.users.owner)
    expect(none.body.items).toEqual([])
  })

  it('APK transfer form pickers: inactive cash accounts are marked (active: false), inactive cost centers left out', async () => {
    const tag = `DC${Date.now() % 100000}`
    const oldCash = await sysCreate('cash-accounts', { name: `${tag} Kas lama`, kind: 'cash', openingBalance: 0, active: false })
    const oldCc = await sysCreate('cost-centers', { code: `${tag}-OLD`, name: 'Pusat biaya lama', active: false })
    const bal = await api('GET', '/api/v1/cash-accounts/balances', w.users.finance)
    expect(bal.status, JSON.stringify(bal.body)).toBe(200)
    const byId = (id: number) => bal.body.items.find((x: { cashAccountId: number }) => x.cashAccountId === id)
    expect(byId(oldCash)).toMatchObject({ active: false, balance: 0 })
    expect(byId(w.cashAccount)).toMatchObject({ active: true })
    expect((await api('GET', '/api/v1/cost-centers', w.users.finance)).body.docs.map((c: { id: number }) => c.id)).not.toContain(oldCc)
    expect((await api('GET', '/api/v1/cost-centers?active=all', w.users.finance)).body.docs).toEqual(expect.arrayContaining([expect.objectContaining({ id: oldCc, active: false })]))
  })
})
