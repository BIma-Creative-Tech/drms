import { randomUUID } from 'node:crypto'

import { beforeAll, describe, expect, it } from 'vitest'

import { SyncDraftUpsertPayload } from '@/api/v1/schemas-sync'
import { resetRateLimits } from '@/lib/rate-limit'

import { companyId, getTestPayload, sqlAs } from './helpers'
import { api, draftBody, makeFlowUser, makeWorld, sysCreate, type World } from './flow-world'

/**
 * Owner decision 2026-10-09: "Tingkat Urgensi" (per-PT master `urgency-levels`, defaults Low / Medium /
 * High / Super) replaces "Periode kegiatan" (periodFrom/periodTo) on expense requests. Extra PTs are
 * created INACTIVE so they do not change what other files count. Fictional data.
 */
const E = '/api/v1/expense-requests'
let w: World
let levels: Record<string, number>

beforeAll(async () => {
  w = await makeWorld(`ug${Date.now() % 100000}`)
  resetRateLimits()
  const p = await getTestPayload()
  const r = await p.find({ collection: 'urgency-levels', where: { company: { equals: await companyId() } }, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: fixture */ })
  levels = Object.fromEntries(r.docs.map((d) => [d.code as string, d.id as number]))
})

describe('urgency-levels master (per PT)', () => {
  it('the existing PT has the four defaults (migration backfill), ordered by rank', async () => {
    const r = await sqlAs('app', 'SELECT code, name, rank::int AS rank FROM urgency_levels WHERE company_id = $1 ORDER BY rank', [await companyId()])
    expect(r.rows.map((x) => [x.code, x.name, x.rank])).toEqual([
      ['LOW', 'Low', 1],
      ['MEDIUM', 'Medium', 2],
      ['HIGH', 'High', 3],
      ['SUPER', 'Super', 4],
    ])
  })

  it('a new PT gets the defaults automatically', async () => {
    const p = await getTestPayload()
    const pt = (await p.create({ collection: 'companies', data: { name: 'PT UG Baru', shortCode: `UG${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'U')}`, timezone: 'Asia/Makassar', active: false } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */ })).id as number
    const n = await sqlAs('app', 'SELECT count(*)::int AS n FROM urgency_levels WHERE company_id = $1', [pt])
    expect(n.rows[0].n).toBe(4)
  })

  it('configurable: Admin/Direktur/Finance create and rename; Staff reads; Operator has no access; no delete', async () => {
    const created = await api('POST', '/api/urgency-levels', w.users.admin, { code: `KRIT${Date.now() % 1000}`, name: 'Kritis', rank: 5 })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const id = (created.body as { doc: { id: number } }).doc.id
    expect((await api('PATCH', `/api/urgency-levels/${id}`, w.users.owner, { name: 'Sangat kritis' })).status).toBe(200)
    expect((await api('POST', '/api/urgency-levels', w.users.staffA, { code: 'X1', name: 'x', rank: 6 })).status).toBe(403)
    expect((await api('GET', '/api/urgency-levels?limit=50', w.users.staffA)).status).toBe(200)
    const op = await makeFlowUser(['pk-operator'], 'ug-operator', null)
    expect((await api('GET', '/api/urgency-levels?limit=1', op)).status).toBe(403)
    expect((await api('DELETE', `/api/urgency-levels/${id}`, w.users.admin)).status).toBe(403)
  })
})

describe('expense request: "Tingkat urgensi" instead of "Periode kegiatan"', () => {
  it('draft with urgencyLevelId → saved and returned in the detail', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w, { urgencyLevelId: levels.HIGH }))
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const id = (c.body as { id: number }).id
    const d = await api('GET', `${E}/${id}`, w.users.staffA)
    expect((d.body as { urgencyLevel: unknown }).urgencyLevel).toMatchObject({ id: levels.HIGH, code: 'HIGH', name: 'High', rank: 3 })
    const u = await api('PATCH', `${E}/${id}`, w.users.staffA, { urgencyLevelId: levels.SUPER })
    expect(u.status, JSON.stringify(u.body)).toBe(200)
    const row = await sqlAs('app', 'SELECT urgency_level_id FROM expense_requests WHERE id = $1', [id])
    expect(row.rows[0].urgency_level_id).toBe(levels.SUPER)
  })

  it('a level of another PT or an inactive one is refused (400 on urgencyLevelId)', async () => {
    const p = await getTestPayload()
    const other = (await p.create({ collection: 'companies', data: { name: 'PT UG Lain', shortCode: `UL${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'L')}`, timezone: 'Asia/Makassar', active: false } as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: fixture */ })).id as number
    const foreign = (await sqlAs('app', "SELECT id FROM urgency_levels WHERE company_id = $1 AND code = 'LOW'", [other])).rows[0].id as number
    const f = await api('POST', E, w.users.staffA, draftBody(w, { urgencyLevelId: foreign }))
    expect(f.status).toBe(400)
    expect(JSON.stringify(f.body)).toMatch(/urgencyLevelId/)
    const inactive = await sysCreate('urgency-levels', { code: `OFF${Date.now() % 1000}`, name: 'Nonaktif', rank: 9, active: false })
    const i = await api('POST', E, w.users.staffA, draftBody(w, { urgencyLevelId: inactive }))
    expect(i.status).toBe(400)
  })

  it('periodFrom/periodTo from older apps are accepted and ignored (no column any more)', async () => {
    const c = await api('POST', E, w.users.staffA, draftBody(w, { periodFrom: '2026-10-01', periodTo: '2026-10-05' }))
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const cols = await sqlAs('app', "SELECT column_name FROM information_schema.columns WHERE table_name = 'expense_requests' AND column_name IN ('period_from', 'period_to', 'urgency_level_id')")
    expect(cols.rows.map((x) => x.column_name)).toEqual(['urgency_level_id'])
    expect(SyncDraftUpsertPayload.safeParse({ kind: 'advance', title: 'APK lama', period_from: '2026-10-01', period_to: null }).success).toBe(true)
  })
})
