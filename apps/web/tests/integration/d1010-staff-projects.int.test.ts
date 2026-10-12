import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createLocalReq, type DocumentViewServerProps } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/ui', () => ({ Gutter: ({ children }: { children: ReactNode }) => React.createElement('div', { 'data-gutter': '' }, children) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), usePathname: () => '/admin' }))

import { PROJECT_TABS } from '@/admin/config'
import { ProjectRapTab, ProjectRequestsTab } from '@/admin/views/ProjectTabs'
import { resetRateLimits } from '@/lib/rate-limit'

import { api, draftBody, makeFlowUser, makeWorld, sysCreate, type FlowUser, type World } from './flow-world'
import { addMembership, companyId, getTestPayload, installLocalJwks } from './helpers'

/**
 * Owner decision 2026-10-11 (DRMS 10/10 follow-up): Staff see their projects on the web (read-only, tabs Proyek / RAP /
 * Pengajuan, no Pinjaman) and the APK, but NEVER project money — RAB / contract value, RAP prices and amounts, the
 * RAB % of a request, loans — on REST, /api/v1 or the admin views. Field access (access/money.ts) is the guard, so a
 * `select`, `where` or `sort` on the money field cannot reveal it either. Fictional data.
 */
const E = '/api/v1/expense-requests'
let w: World
let kon = 0
let otherPt = 0
let mixed: FlowUser // Staff in DRMS, PM in another PT
const item: Record<string, number> = {}
let ownReq = 0 // staff A's sent request on w.project
let otherReq = 0 // staff B's request on w.project

type Props = DocumentViewServerProps

async function propsFor(user: FlowUser, docID: number, searchParams: Record<string, string> = {}): Promise<Props> {
  const req = await createLocalReq({ user: { ...user, collection: 'users' } as never }, await getTestPayload())
  return { initPageResult: { req, docID, locale: undefined, permissions: {}, visibleEntities: { collections: [], globals: [] } }, searchParams } as unknown as Props
}

async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve))
  if (!isValidElement(node)) return node
  const el = node as ReactElement<{ children?: ReactNode }>
  if (typeof el.type === 'function' && el.type.constructor.name === 'AsyncFunction') return resolve(await (el.type as (p: unknown) => Promise<ReactNode>)(el.props))
  if (el.props && 'children' in el.props && el.props.children !== undefined) return cloneElement(el, undefined, ...([] as ReactNode[]).concat(await resolve(el.props.children)))
  return el
}

async function render(view: (p: Props) => Promise<ReactNode>, user: FlowUser, id: number, sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(React.createElement(React.Fragment, null, await resolve(await view(await propsFor(user, id, sp)))))
}

beforeAll(async () => {
  await installLocalJwks()
  w = await makeWorld(`gs${Date.now() % 100000}`)
  kon = await sysCreate('projects', { code: `GS-K${Date.now() % 100000}`, name: 'Gedung uji Staff', kind: 'konstruksi', pm: w.users.pm.id, budget: 77_000_000, status: 'berjalan', costCenter: w.projectCostCenter })
  for (const e of [w.emp.a, w.emp.b]) await sysCreate('team-assignments', { employee: e, project: kon, roleInProject: 'staff' })
  const stage = await sysCreate('project-stages', { project: kon, name: 'Struktur', weightPct: 100, sequence: 1 })
  for (const [code, volume, unitPrice] of [
    ['S.1', 4, 1_250_000],
    ['S.2', 2, 3_500_000],
  ] as const) {
    const r = await api('POST', `/api/v1/projects/${kon}/rap/items`, w.users.pm, { code, description: `Item ${code}`, stageId: stage, kind: 'pekerjaan', uomId: w.uom.l, volume, unitPrice })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    item[code] = r.body.id
  }
  // a Staff of DRMS who is PM in another PT (roles are per PT: no money in DRMS)
  otherPt = await sysCreate('companies', { name: 'PT Uji Staff Proyek', shortCode: `GS${Date.now() % 1000}`, timezone: 'Asia/Makassar' })
  const mixedEmp = await sysCreate('employees', { company: await companyId(), code: `GS-MX${Date.now() % 1000}`, name: 'Staff Campuran' })
  await sysCreate('team-assignments', { employee: mixedEmp, project: w.project, roleInProject: 'staff' })
  mixed = await makeFlowUser(['pk-staff'], 'gs-mixed', mixedEmp)
  await addMembership(mixed.id, otherPt, ['pk-pm'])
  // staff A: a sent request (approval rows carry the RAB %), staff B: a draft on the same project
  resetRateLimits()
  const c = await api('POST', E, w.users.staffA, draftBody(w))
  expect(c.status, JSON.stringify(c.body)).toBe(201)
  ownReq = c.body.id
  expect((await api('POST', `${E}/${ownReq}/submit`, w.users.staffA, {})).status).toBe(200)
  expect((await api('POST', `${E}/${ownReq}/acknowledge`, w.users.owner, {})).status).toBe(200)
  const b = await api('POST', E, w.users.staffB, draftBody(w, { requesterIds: [w.emp.b], bankAccountId: w.accB, title: 'Sewa genset' }))
  expect(b.status, JSON.stringify(b.body)).toBe(201)
  otherReq = b.body.id
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  const p = await getTestPayload()
  // every other test file assumes the single-company default (same as mc-isolation)
  if (otherPt) await p.update({ collection: 'companies', id: otherPt, data: { active: false, changeReason: 'uji staff proyek selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
})

describe('REST (Payload API): the RAB is not readable for Staff', () => {
  it('list + by id: Staff reads its assigned projects WITHOUT budget; PM / Finance / Direktur with budget', async () => {
    const list = await api('GET', '/api/projects?limit=100&depth=0', w.users.staffA)
    expect(list.status).toBe(200)
    const ids = list.body.docs.map((d: { id: number }) => d.id)
    expect(ids).toEqual(expect.arrayContaining([w.project, kon]))
    expect(ids).not.toContain(w.otherProject)
    for (const d of list.body.docs) expect(d).not.toHaveProperty('budget')
    const one = await api('GET', `/api/projects/${kon}?depth=0`, w.users.staffA)
    expect(one.status).toBe(200)
    expect(one.body).toMatchObject({ id: kon, code: expect.any(String), name: 'Gedung uji Staff' })
    expect(one.body).not.toHaveProperty('budget')
    for (const u of [w.users.pm, w.users.finance, w.users.owner, w.users.admin]) expect((await api('GET', `/api/projects/${kon}?depth=0`, u)).body.budget).toBe(77_000_000)
  })

  it('select / where / sort on the budget cannot reveal it; a populated project (depth) neither', async () => {
    const sel = await api('GET', `/api/projects/${kon}?select[budget]=true`, w.users.staffA)
    expect(sel.status).toBe(200)
    expect(sel.body).not.toHaveProperty('budget')
    const where = await api('GET', '/api/projects?where[budget][greater_than]=1', w.users.staffA)
    expect(where.status, JSON.stringify(where.body)).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(where.body)).toMatch(/budget/)
    expect((await api('GET', '/api/projects?sort=-budget', w.users.staffA)).status).toBeGreaterThanOrEqual(400)
    expect((await api('GET', '/api/projects?where[budget][greater_than]=1', w.users.pm)).status).toBe(200)
    // the request's populated project (depth 1) goes through the same field access
    const r = await api('GET', `/api/expense-requests/${ownReq}?depth=1`, w.users.staffA)
    expect(r.status).toBe(200)
    expect(r.body.project).toMatchObject({ id: w.project })
    expect(r.body.project).not.toHaveProperty('budget')
  })

  it('a Staff of PT A who is PM in PT B: no RAB of the PT A project (row PT decides), no filter on it', async () => {
    const one = await api('GET', `/api/projects/${w.project}?depth=0`, mixed)
    expect(one.status).toBe(200)
    expect(one.body).not.toHaveProperty('budget')
    expect((await api('GET', `/api/projects/${w.project}?select[budget]=true`, mixed)).body).not.toHaveProperty('budget')
    expect((await api('GET', '/api/projects?where[budget][greater_than]=1', mixed)).status).toBeGreaterThanOrEqual(400)
  })

  it('RAP items: no unit price for Staff; approval rows: no RAB % for Staff; GraphQL is not served', async () => {
    const rap = await api('GET', `/api/rap-items?where[project][equals]=${kon}&depth=0`, w.users.staffA)
    expect(rap.status).toBe(200)
    expect(rap.body.docs.length).toBe(2)
    for (const d of rap.body.docs) expect(d).not.toHaveProperty('unitPrice')
    expect((await api('GET', `/api/rap-items/${item['S.1']}?select[unitPrice]=true`, w.users.staffA)).body).not.toHaveProperty('unitPrice')
    expect((await api('GET', `/api/rap-items/${item['S.1']}?depth=0`, w.users.pm)).body.unitPrice).toBe(1_250_000)
    const ap = await api('GET', `/api/approvals?where[request][equals]=${ownReq}&depth=0`, w.users.staffA)
    expect(ap.status).toBe(200)
    expect(ap.body.docs.length).toBeGreaterThan(0)
    for (const d of ap.body.docs) {
      expect(d).not.toHaveProperty('budgetPctBefore')
      expect(d).not.toHaveProperty('budgetPctAfter')
    }
    const apOwner = await api('GET', `/api/approvals?where[request][equals]=${ownReq}&depth=0`, w.users.owner)
    expect(apOwner.body.docs.some((d: { budgetPctAfter?: number | null }) => typeof d.budgetPctAfter === 'number')).toBe(true)
    expect((await api('POST', '/api/graphql', w.users.staffA, { query: `{ Project(id: ${kon}) { budget } }` })).status).toBe(404)
  })
})

describe('/api/v1 (APK): no contract value, no RAP money, no RAB %, no loans for Staff', () => {
  it('GET /projects + /projects/{id}: contractValue null for Staff, the RAB for PM', async () => {
    const list = await api('GET', '/api/v1/projects?limit=100', w.users.staffA)
    expect(list.status).toBe(200)
    const k = list.body.docs.find((p: { id: number }) => p.id === kon)
    expect(k).toMatchObject({ id: kon, contractValue: null, rapPlanned: null, rapRealised: null, rapPercent: null, rapItems: 2 })
    const d = await api('GET', `/api/v1/projects/${kon}`, w.users.staffA)
    expect(d.status).toBe(200)
    expect(d.body).toMatchObject({ contractValue: null, rap: { items: 2, planned: null, realised: null, remaining: null } })
    expect((await api('GET', `/api/v1/projects/${w.project}`, mixed)).body.contractValue).toBeNull()
    expect((await api('GET', `/api/v1/projects/${kon}`, w.users.pm)).body.contractValue).toBe(77_000_000)
    expect((await api('GET', `/api/v1/projects/${kon}`, w.users.finance)).body.contractValue).toBe(77_000_000)
  })

  it('GET /projects/{id}/rap: items with volume, no price / plan / realisation money for Staff', async () => {
    const r = await api('GET', `/api/v1/projects/${kon}/rap`, w.users.staffA)
    expect(r.status).toBe(200)
    expect(r.body.totals).toBeNull()
    expect(r.body.budget).toBeNull()
    for (const i of r.body.items) {
      expect(i).toMatchObject({ code: expect.any(String), volume: expect.any(Number) })
      for (const k of ['unitPrice', 'value', 'planned', 'realisedAmount', 'transferredAmount', 'verifiedAmount', 'remaining', 'percent']) expect(i[k] ?? null, k).toBeNull()
    }
    const pm = await api('GET', `/api/v1/projects/${kon}/rap`, w.users.pm)
    expect(pm.body.totals).toMatchObject({ rapValue: 12_000_000, budget: 77_000_000 })
  })

  it('GET /expense-requests/{id}: the RAB % (preview + approval rows) only for the money roles', async () => {
    const staff = await api('GET', `${E}/${ownReq}`, w.users.staffA)
    expect(staff.status).toBe(200)
    expect(staff.body.budget).toEqual({ basis: 'none', pctBefore: null, pctAfter: null })
    expect(staff.body.approvals.length).toBeGreaterThan(0)
    for (const a of staff.body.approvals) expect([a.budgetPctBefore, a.budgetPctAfter]).toEqual([null, null])
    const owner = await api('GET', `${E}/${ownReq}`, w.users.owner)
    expect(owner.body.budget.basis).toBe('project')
    expect(typeof owner.body.budget.pctAfter).toBe('number')
    expect(owner.body.approvals.some((a: { budgetPctAfter: number | null }) => typeof a.budgetPctAfter === 'number')).toBe(true)
  })

  it('loans: nothing for Staff (list empty / refused, REST rows none)', async () => {
    const l = await api('GET', '/api/v1/project-loans', w.users.staffA)
    expect([200, 403]).toContain(l.status)
    if (l.status === 200) expect(l.body.items ?? l.body.docs ?? []).toEqual([])
    const rest = await api('GET', '/api/project-loans?depth=0', w.users.staffA)
    expect(rest.status === 403 || rest.body.docs.length === 0).toBe(true)
  })
})

describe('web: project page for Staff (read-only, no money, own requests, no Pinjaman tab)', () => {
  it('RAP tab: codes, volumes and realised volume — no Rupiah, no price note leak', async () => {
    const html = await render(ProjectRapTab, w.users.staffA, kon)
    expect(html).toContain('S.1')
    expect(html).toContain('Item S.2')
    expect(html).toContain('Volume RAP')
    expect(html).toContain('Nilai RAP hanya untuk Direktur, Admin, Finance dan PM project')
    expect(html).not.toMatch(/Rp\s?[\d.]/)
    expect(html).not.toContain('1.250.000')
    const pm = await render(ProjectRapTab, w.users.pm, kon)
    expect(pm).toMatch(/Rp\s?1\.250\.000|Rp\s?12\.000\.000/)
  })

  it('RAP tab of a project the Staff is not assigned to → not found', async () => {
    expect(await render(ProjectRapTab, w.users.staffA, w.otherProject)).toContain('Project tidak ditemukan atau tidak dapat Anda buka.')
  })

  it('Pengajuan tab: Staff sees only own requests ("Pengajuan saya"); PM sees every request of the project', async () => {
    const a = await render(ProjectRequestsTab, w.users.staffA, w.project)
    expect(a).toContain('Pengajuan saya di project ini')
    expect(a).toContain(`data-pk-request="${ownReq}"`)
    expect(a).not.toContain(`data-pk-request="${otherReq}"`)
    const pm = await render(ProjectRequestsTab, w.users.pm, w.project)
    expect(pm).toContain('Pengajuan project ini')
    expect(pm).toContain(`data-pk-request="${ownReq}"`)
  })

  it('Pinjaman tab: shown for the money roles only', async () => {
    const cond = PROJECT_TABS.pinjaman.tab.condition
    const reqOf = async (u: FlowUser) => createLocalReq({ user: { ...u, collection: 'users' } as never }, await getTestPayload())
    expect(cond({ req: await reqOf(w.users.staffA) })).toBe(false)
    for (const u of [w.users.pm, w.users.finance, w.users.owner, w.users.admin]) expect(cond({ req: await reqOf(u) })).toBe(true)
  })

  it('Staff may not change a project (403 naming the fields), may not create one', async () => {
    const u = await api('PATCH', `/api/projects/${kon}`, w.users.staffA, { name: 'Diubah staff' })
    expect(u.status).toBe(403)
    expect((await api('POST', '/api/projects', w.users.staffA, { code: 'GS-X', name: 'x', pm: w.users.pm.id })).status).toBe(403)
  })
})
