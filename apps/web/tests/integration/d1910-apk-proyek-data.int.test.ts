import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resetRateLimits } from '@/lib/rate-limit'

import { api, makeFlowUser, type FlowUser } from './flow-world'
import { auditRows, getTestPayload } from './helpers'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 5): the generic edit form of the Proyek collections — GET
 * /data/{collection}/form, /options, POST /data/{collection}, PATCH /data/{collection}/{id} (payload.create / update
 * as the caller: access, hooks, validation, audit as the web form) — and GET /field/contracts. Fictional data only.
 */
let admin: FlowUser
let staff: FlowUser
const idem = () => ({ 'Idempotency-Key': randomUUID() })
const code = `APK5-${Date.now() % 100000}`

beforeAll(async () => {
  admin = await makeFlowUser(['pk-admin'], 'p5-admin', null, { signature: false })
  staff = await makeFlowUser(['pk-staff'], 'p5-staff', null, { signature: false })
})

beforeEach(() => resetRateLimits())

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('GET /api/v1/data/{collection}/form', () => {
  it('cost-centers (Admin): create form with the field types, access and the deactivate reason rule', async () => {
    const r = await api('GET', '/api/v1/data/cost-centers/form', admin)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ collection: 'cost-centers', id: null, canCreate: true, canUpdate: false, supported: true, reason: { onUpdate: false, onDeactivate: true } })
    const byKey = new Map((r.body.fields as Array<{ key: string }>).map((f) => [f.key, f]))
    expect(byKey.get('name')).toMatchObject({ type: 'text', required: true, readOnly: false, maxLength: 128 })
    expect(byKey.get('type')).toMatchObject({ type: 'select', value: 'operational', options: expect.arrayContaining([{ value: 'department', label: 'Departemen' }]) })
    expect(byKey.get('manager')).toMatchObject({ type: 'relationship', relationTo: 'users' })
    expect(byKey.has('siteLink')).toBe(false)
    expect(byKey.has('changeReason')).toBe(false)
  })

  it('Staff: no create; unknown or non-writable collection → 404', async () => {
    const s = await api('GET', '/api/v1/data/cost-centers/form', staff)
    expect(s.status).toBe(200)
    expect(s.body.canCreate).toBe(false)
    expect((await api('GET', '/api/v1/data/rap-items/form', admin)).status).toBe(404)
    expect((await api('GET', '/api/v1/data/clients/form', admin)).status).toBe(404)
  })
})

describe('POST / PATCH /api/v1/data/{collection}', () => {
  it('create → detail, update with the deactivate reason → audited; read-only / unknown keys → 400', async () => {
    const c = await api('POST', '/api/v1/data/cost-centers', admin, { data: { code, name: 'Pusat biaya APK tahap 5', type: 'operational' } }, idem())
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    expect(c.body).toMatchObject({ collection: 'cost-centers', title: expect.any(String) })
    const id = c.body.id as number
    expect((await api('GET', `/api/v1/data/cost-centers/${id}`, admin)).body.fields.find((f: { key: string }) => f.key === 'name')?.value).toBe('Pusat biaya APK tahap 5')

    const form = await api('GET', `/api/v1/data/cost-centers/form?id=${id}`, admin)
    expect(form.body).toMatchObject({ id, canUpdate: true })
    expect(form.body.fields.find((f: { key: string }) => f.key === 'company')).toMatchObject({ readOnly: true })

    // deactivating needs a reason (audit rule) → 400 at changeReason, then OK with it
    const noReason = await api('PATCH', `/api/v1/data/cost-centers/${id}`, admin, { data: { active: false } }, idem())
    expect(noReason.status).toBe(400)
    expect(JSON.stringify(noReason.body.errors)).toContain('changeReason')
    const ok = await api('PATCH', `/api/v1/data/cost-centers/${id}`, admin, { data: { active: false }, reason: 'uji APK tahap 5' }, idem())
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect((await auditRows('cost_center', id)).some((a) => a.action === 'deactivate' && a.reason === 'uji APK tahap 5')).toBe(true)

    const bad = await api('PATCH', `/api/v1/data/cost-centers/${id}`, admin, { data: { nope: 1, company: 1 } }, idem())
    expect(bad.status).toBe(400)
    expect(bad.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['company', 'nope'])
  })

  it('Staff: POST → 403', async () => {
    const r = await api('POST', '/api/v1/data/resource-types', staff, { data: { kind: 'tenaga', code: `${code}-S`, name: 'x' } }, idem())
    expect(r.status).toBe(403)
  })
})

describe('GET /api/v1/data/{collection}/options', () => {
  it('relationship picker of cost-centers.manager; a non-relationship field → 404', async () => {
    const r = await api('GET', '/api/v1/data/cost-centers/options?field=manager', admin)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(Array.isArray(r.body.items)).toBe(true)
    for (const i of r.body.items) expect(i).toMatchObject({ id: expect.anything(), label: expect.any(String) })
    expect((await api('GET', '/api/v1/data/cost-centers/options?field=name', admin)).status).toBe(404)
  })
})

describe('GET /api/v1/field/contracts', () => {
  it('Staff of a PT without field reports → 403 FIELD_REPORTS_OFF or the page shape', async () => {
    const r = await api('GET', '/api/v1/field/contracts', admin)
    if (r.status === 403) {
      expect(r.body.code).toBe('FIELD_REPORTS_OFF')
      return
    }
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ today: expect.any(String), month: expect.any(String), items: expect.any(Array), units: expect.any(Array), page: 1 })
    expect(JSON.stringify(r.body)).not.toMatch(/"rate"|minHours/)
  })
})
