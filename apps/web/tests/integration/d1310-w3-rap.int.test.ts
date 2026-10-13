import { randomUUID } from 'node:crypto'

import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createLocalReq, type AdminViewServerProps } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/next/templates', () => ({ DefaultTemplate: ({ children }: { children: ReactNode }) => children }))
vi.mock('@payloadcms/ui', () => ({ Gutter: ({ children }: { children: ReactNode }) => React.createElement('div', { 'data-gutter': '' }, children) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), usePathname: () => '/admin' }))

import { RapIndex, RapProject } from '@/admin/views/Rap'
import { loadRapOverview } from '@/domain/rap/overview-load'
import { resetRateLimits } from '@/lib/rate-limit'

import { api, asUser, sysCreate, type FlowUser } from './flow-world'
import { makeFr1World, type Fr1World } from './fr1-world'
import { fixturePm, getTestPayload, installLocalJwks, updateCompany } from './helpers'

/**
 * DRMS 13/10 Wave 3 "Proyek › RAP": the RAP index (/admin/rap) and the RAP page of one project (/admin/rap/:id)
 * rendered server-side with real data and the caller's access, and the existing RAP item endpoints the page's form
 * uses (POST /projects/{id}/rap/items, PATCH /rap-items/{id}): who may write, Staff without money (no "Rp" + digit
 * anywhere on the page), the lock after daily-report realisation (PM: disabled buttons + 409 RAP_LOCKED, Direktur:
 * reason), PT scope (a project of a PT the caller is not a member of is never listed / opened / written).
 * Payload's DefaultTemplate / Gutter are stubbed. Fictional data only.
 */
let w: Fr1World
let kon = 0 // konstruksi, RAB, PM = world PM, Staff A assigned
let umum = 0 // umum with RAB and NO RAP yet (→ "wajib")
let stage = 0
let foreignPt = 0
let foreignProject = 0
const item: Record<string, number> = {}
const tag = `rap${randomUUID().slice(0, 5)}` // starts with 2 letters: the world vehicle plate takes them
const MONEY = /Rp\s?\d/

type Props = AdminViewServerProps

async function propsFor(user: FlowUser, segments: string[], searchParams: Record<string, string> = {}): Promise<Props> {
  const req = await createLocalReq({ user: { ...user, collection: 'users' } as never }, await getTestPayload())
  return { initPageResult: { req, locale: undefined, permissions: {}, visibleEntities: { collections: [], globals: [] } }, params: { segments }, searchParams } as unknown as Props
}

/** Resolves async server components so the static renderer can render the rest. */
async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve))
  if (!isValidElement(node)) return node
  const el = node as ReactElement<{ children?: ReactNode }>
  if (typeof el.type === 'function' && el.type.constructor.name === 'AsyncFunction') return resolve(await (el.type as (p: unknown) => Promise<ReactNode>)(el.props))
  if (el.props && 'children' in el.props && el.props.children !== undefined) return cloneElement(el, undefined, ...([] as ReactNode[]).concat(await resolve(el.props.children)))
  return el
}

async function render(view: (p: Props) => Promise<ReactNode>, user: FlowUser, segments: string[], sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(React.createElement(React.Fragment, null, await resolve(await view(await propsFor(user, segments, sp)))))
}

const index = (u: FlowUser, sp: Record<string, string> = {}) => render(RapIndex, u, ['rap'], sp)
const page = (u: FlowUser, id: number, sp: Record<string, string> = {}) => render(RapProject, u, ['rap', String(id)], sp)
const addItem = (u: FlowUser, project: number, body: Record<string, unknown>) => api('POST', `/api/v1/projects/${project}/rap/items`, u, body, { 'Idempotency-Key': randomUUID() })
const editItem = (u: FlowUser, id: number, body: Record<string, unknown>) => api('PATCH', `/api/v1/rap-items/${id}`, u, body, { 'Idempotency-Key': randomUUID() })

beforeAll(async () => {
  installLocalJwks()
  w = await makeFr1World(tag)
  kon = await sysCreate('projects', { code: `${tag}-KON`, name: `${tag} Gudang beton`, kind: 'konstruksi', pm: w.users.pm.id, budget: 40_000_000, status: 'berjalan' })
  umum = await sysCreate('projects', { code: `${tag}-UMM`, name: `${tag} Renovasi kantor`, kind: 'umum', pm: w.users.pm.id, budget: 5_000_000, status: 'berjalan' }, { rap: false })
  for (const p of [kon, umum]) await sysCreate('team-assignments', { employee: w.emp.a, project: p, roleInProject: 'staff' })
  stage = await sysCreate('project-stages', { project: kon, name: 'Pekerjaan tanah', weightPct: 100, sequence: 1 })
  foreignPt = await sysCreate('companies', { name: 'PT Uji RAP Lain', shortCode: `RL${Date.now() % 1000}`, timezone: 'Asia/Makassar' })
  foreignProject = await sysCreate('projects', { company: foreignPt, pm: await fixturePm(foreignPt), code: `${tag}-LAIN`, name: `${tag} Project PT lain`, kind: 'umum', budget: 1_000_000, status: 'berjalan' }, { rap: false })
})
beforeEach(() => resetRateLimits())
afterAll(async () => {
  await updateCompany({ fieldReportsEnabled: false })
  // every other test file assumes the single-company default
  if (foreignPt) await (await getTestPayload()).update({ collection: 'companies', id: foreignPt, data: { active: false, changeReason: 'uji RAP selesai' }, overrideAccess: true /* SYSTEM-WRITE: restore the single-company default */ })
})

describe('form endpoints (the page dialog): who may write', () => {
  it('PM of the project adds items (konstruksi: stage required; umum: stage optional); duplicate kode 409', async () => {
    const noStage = await addItem(w.users.pm, kon, { code: 'A.1', description: 'Galian tanah', kind: 'pekerjaan', uomId: w.uom.l, volume: 10 })
    expect(noStage.status).toBe(400)
    expect(noStage.body.errors).toEqual([expect.objectContaining({ path: 'stageId' })])
    const a1 = await addItem(w.users.pm, kon, { code: 'A.1', description: 'Galian tanah', kind: 'pekerjaan', stageId: stage, uomId: w.uom.l, volume: 12.5, unitPrice: 80_000 })
    expect(a1.status, JSON.stringify(a1.body)).toBe(201)
    item['A.1'] = a1.body.id
    expect(a1.body).toMatchObject({ code: 'A.1', volume: 12.5, unitPrice: 80_000, value: 1_000_000, active: true })
    const a2 = await addItem(w.users.pm, kon, { code: 'A.2', description: 'Urugan pasir', kind: 'pekerjaan', stageId: stage, uomId: w.uom.l, volume: 4, unitPrice: 250_000 })
    expect(a2.status, JSON.stringify(a2.body)).toBe(201)
    item['A.2'] = a2.body.id
    const dup = await addItem(w.users.pm, kon, { code: 'a.1', description: 'Lagi', kind: 'material', stageId: stage, uomId: w.uom.l, volume: 1 })
    expect(dup.status).toBe(409)
    expect(dup.body.code).toBe('DUPLICATE_CODE')
  })

  it('Staff and Finance cannot write; another PM (not the team) cannot; a project of a foreign PT is not found', async () => {
    for (const u of [w.users.staffA, w.users.finance, w.users.otherPm]) {
      const r = await addItem(u, kon, { code: 'X.1', description: 'Tidak boleh', kind: 'pekerjaan', stageId: stage, uomId: w.uom.l, volume: 1 })
      expect([403, 404], u.email).toContain(r.status)
      const p = await editItem(u, item['A.1']!, { volume: 99 })
      expect([403, 404], u.email).toContain(p.status)
    }
    expect((await addItem(w.users.owner, foreignProject, { code: 'X.1', description: 'PT lain', kind: 'pekerjaan', uomId: w.uom.l, volume: 1 })).status).toBe(404)
  })

  it('edit: changed fields only, deactivate (never delete), kind fixed', async () => {
    const e = await editItem(w.users.pm, item['A.2']!, { volume: 5, unitPrice: 200_000 })
    expect(e.status, JSON.stringify(e.body)).toBe(200)
    expect(e.body).toMatchObject({ volume: 5, value: 1_000_000 })
    expect((await editItem(w.users.pm, item['A.2']!, { kind: 'material' })).status).toBe(400)
    const off = await editItem(w.users.owner, item['A.2']!, { active: false })
    expect(off.status).toBe(200)
    expect(off.body.active).toBe(false)
    expect((await editItem(w.users.owner, item['A.2']!, { active: true })).body.active).toBe(true)
  })
})

describe('/admin/rap index', () => {
  it('Direktur: projects with RAP state, Total RAP vs RAB, totals row; "wajib" filter; foreign PT never listed', async () => {
    const html = await index(w.users.owner, { q: tag })
    expect(html).toContain(`data-pk-rap-project="${tag}-KON"`)
    expect(html).toMatch(new RegExp(`data-pk-rap-project="${tag}-UMM" data-pk-rap-state="wajib"`))
    expect(html).toContain(`href="/admin/rap/${kon}"`)
    expect(html).toContain('Total RAP')
    expect(html).toContain('Rp 2.000.000') // A.1 1.000.000 + A.2 1.000.000
    expect(html).toContain('Rp 40.000.000')
    expect(html).toContain('data-pk-rap-totals')
    expect(html).toContain('data-pk-toolbar="rap"')
    expect(html).not.toContain(`${tag}-LAIN`)
    const wajib = await index(w.users.owner, { q: tag, rap: 'wajib' })
    expect(wajib).toContain(`${tag}-UMM`)
    expect(wajib).not.toContain(`data-pk-rap-project="${tag}-KON"`)
    expect(await index(w.users.owner, { pt: String(foreignPt) })).toContain('data-pk-denied="pt"')
  })

  it('data: RAP total only for the price roles (PM of the team yes, other PM no), RAB per field access', async () => {
    const pm = (await asUser(w.users.pm, (req) => loadRapOverview(req))).find((r) => r.id === kon)!
    expect(pm).toMatchObject({ state: 'ada', items: 2, prices: true, editor: true, rapValue: 2_000_000, budget: 40_000_000 })
    const other = (await asUser(w.users.otherPm, (req) => loadRapOverview(req))).find((r) => r.id === kon)
    if (other) expect(other).toMatchObject({ prices: false, editor: false, rapValue: null })
    const fin = (await asUser(w.users.finance, (req) => loadRapOverview(req))).find((r) => r.id === kon)!
    expect(fin).toMatchObject({ prices: true, editor: false, rapValue: 2_000_000 })
    const staff = await asUser(w.users.staffA, (req) => loadRapOverview(req))
    expect(staff.find((r) => r.id === umum)).toMatchObject({ state: 'wajib', prices: false, rapValue: null, budget: null })
  })

  it('Staff: assigned projects and RAP state, no money at all', async () => {
    const html = await index(w.users.staffA, { q: tag })
    expect(html).toContain(`data-pk-rap-project="${tag}-KON"`)
    expect(html).not.toMatch(MONEY)
    expect(html).not.toContain('Total RAP')
    expect(html).not.toContain('>RAB<')
  })
})

describe('/admin/rap/:id', () => {
  it('PM: items table with grand total, add / edit enabled, Excel upload + template', async () => {
    const html = await page(w.users.pm, kon)
    expect(html).toContain('data-pk-rap-editor="edit"')
    expect(html).toContain('data-pk-rap-grand-total="2000000"')
    expect(html).toContain('data-pk-rap-item="A.1"')
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*data-pk-action="rap-item-add"/)
    expect(html).toContain('data-pk-form="rap-import"')
    expect(html).toContain('href="/api/v1/rap/template.xlsx"')
    expect(html).toContain('Grand total')
  })

  it('Finance: money, read only (no add / edit buttons, no upload)', async () => {
    const html = await page(w.users.finance, kon)
    expect(html).toContain('data-pk-rap-editor="read"')
    expect(html).toContain('Rp 2.000.000')
    expect(html).not.toContain('rap-item-add')
    expect(html).not.toContain('data-pk-form="rap-import"')
  })

  it('Staff: items and volumes only — never money, never write tools', async () => {
    const html = await page(w.users.staffA, kon)
    expect(html).toContain('data-pk-rap-editor="read"')
    expect(html).toContain('data-pk-rap-item="A.1"')
    expect(html).toContain('data-pk-rap-no-money')
    expect(html).not.toMatch(MONEY)
    expect(html).not.toContain('Harga satuan')
    expect(html).not.toContain('rap-item-add')
    expect(html).not.toContain('data-pk-form="rap-import"')
  })

  it('a project the caller cannot read (Staff not assigned, foreign PT) is not found', async () => {
    expect(await page(w.users.staffB, kon)).toContain('Project tidak ditemukan')
    expect(await page(w.users.owner, foreignProject)).toContain('Project tidak ditemukan')
    expect(await page(w.users.owner, 999_999_999)).toContain('Project tidak ditemukan')
  })

  it('locked after daily-report realisation: PM sees disabled buttons and gets 409 RAP_LOCKED; Direktur edits with a reason', async () => {
    const lh = await api('POST', '/api/v1/daily-reports', w.users.staffA, { projectId: kon, work: [{ rapItemId: item['A.1'], qty: 2 }], clientUuid: randomUUID() })
    expect(lh.status, JSON.stringify(lh.body)).toBe(201)
    const pmHtml = await page(w.users.pm, kon)
    expect(pmHtml).toContain('data-pk-rap-editor="locked"')
    expect(pmHtml).toContain('data-pk-rap-blocked="locked"')
    expect(pmHtml).toMatch(/<button[^>]*disabled=""[^>]*data-pk-action="rap-item-edit-A.1"/)
    expect(pmHtml).toMatch(/data-pk-rap-item="A.1"[^>]*data-pk-used="1"/)
    expect(pmHtml).not.toContain('data-pk-form="rap-import"') // canEdit false → no upload (as the project tab)
    const pm = await editItem(w.users.pm, item['A.1']!, { volume: 13 })
    expect(pm.status).toBe(409)
    expect(pm.body.code).toBe('RAP_LOCKED')
    const ownerHtml = await page(w.users.owner, kon)
    expect(ownerHtml).toContain('data-pk-rap-editor="reason"')
    expect(ownerHtml).toContain('data-pk-alert="rap-locked"')
    expect((await editItem(w.users.owner, item['A.1']!, { volume: 13 })).status).toBe(400)
    const ok = await editItem(w.users.owner, item['A.1']!, { volume: 13, reason: 'Revisi volume galian' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.volume).toBe(13)
  })
})
