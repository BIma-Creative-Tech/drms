import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetAppConfigCache } from '@/api/v1/endpoints/app'
import { resetRateLimits } from '@/lib/rate-limit'

import { getTestPayload, sqlAs, updateCompany } from './helpers'
import { api, makeFlowUser, makeWorld, sysCreate, upload, type FlowUser, type World } from './flow-world'

/**
 * Owner decision 2026-10-09: web self check-in/out for every role (POST /api/v1/attendance/check-in
 * and /check-out) and the attendance-only role pk-operator ("Operator/Anggota"). Same gates as the
 * APK sync path. syncAttendanceEnabled is switched ON here and OFF again afterwards. Fictional data.
 */
let w: World
let operator: FlowUser
let financeEmp: FlowUser
const SITE = { lat: -2.31, lng: 113.81 }

async function selfie(user: FlowUser): Promise<number> {
  const bytes = await sharp({ create: { width: 640, height: 800, channels: 3, background: { r: 90, g: 120, b: 60 } } }).jpeg().toBuffer()
  const r = await upload('/api/v1/media/selfies', user, bytes, 'image/jpeg')
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return (r.body as { id: number }).id
}

async function check(kind: 'in' | 'out', user: FlowUser, body: Record<string, unknown>) {
  resetRateLimits()
  return api('POST', `/api/v1/attendance/check-${kind}`, user, { lat: SITE.lat, lng: SITE.lng, accuracy_m: 10, ...body })
}

async function setAttendance(enabled: boolean) {
  await updateCompany({ syncAttendanceEnabled: enabled })
  resetAppConfigCache()
}

beforeAll(async () => {
  w = await makeWorld(`wa${Date.now() % 100000}`)
  const p = await getTestPayload()
  await p.update({ collection: 'projects', id: w.project, data: { lat: SITE.lat, lng: SITE.lng, radiusM: 100 }, overrideAccess: true /* SYSTEM-WRITE: fixture geofence */ })
  await p.update({ collection: 'projects', id: w.otherProject, data: { lat: SITE.lat, lng: SITE.lng, radiusM: 100 }, overrideAccess: true /* SYSTEM-WRITE: fixture geofence */ })
  const opEmp = await sysCreate('employees', { code: `WA-OP${Date.now() % 10000}`, name: 'Operator Uji' })
  operator = await makeFlowUser(['pk-operator'], 'wa-operator', opEmp)
  await sysCreate('team-assignments', { employee: opEmp, project: w.project, roleInProject: 'staff' })
  const finEmp = await sysCreate('employees', { code: `WA-FIN${Date.now() % 10000}`, name: 'Finance Uji' })
  financeEmp = await makeFlowUser(['pk-finance'], 'wa-finance', finEmp)
  await sysCreate('team-assignments', { employee: finEmp, project: w.project, roleInProject: 'staff' })
})

afterAll(async () => {
  await setAttendance(false)
})

describe('web self check-in/out (owner decision 2026-10-09)', () => {
  it('feature switch off → 403 FEATURE_DISABLED, nothing written', async () => {
    await setAttendance(false)
    const r = await check('in', w.users.staffA, { project_id: w.project, selfie_media_id: await selfie(w.users.staffA) })
    expect(r.status, JSON.stringify(r.body)).toBe(403)
    expect((r.body as { code?: string }).code).toBe('FEATURE_DISABLED')
    await setAttendance(true)
  })

  it('staff: check-in → 201 (source self, server time, online), duplicate → 409; check-out → 201, again → 409', async () => {
    const r = await check('in', w.users.staffA, { project_id: w.project, selfie_media_id: await selfie(w.users.staffA) })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const id = (r.body as { id: number }).id
    const row = (await sqlAs('app', 'SELECT source, time_trust, offline, user_id, project_id FROM attendances WHERE id = $1', [id])).rows[0]
    expect(row).toMatchObject({ source: 'self', time_trust: 'server', offline: false, user_id: w.users.staffA.id, project_id: w.project })
    const dup = await check('in', w.users.staffA, { project_id: w.project, selfie_media_id: await selfie(w.users.staffA) })
    expect(dup.status).toBe(409)
    expect((dup.body as { code?: string }).code).toBe('ALREADY_CHECKED_IN')
    const out = await check('out', w.users.staffA, { project_id: w.project, selfie_media_id: await selfie(w.users.staffA) })
    expect(out.status, JSON.stringify(out.body)).toBe(201)
    const again = await check('out', w.users.staffA, { project_id: w.project, selfie_media_id: await selfie(w.users.staffA) })
    expect((again.body as { code?: string }).code).toBe('ALREADY_CHECKED_OUT')
  })

  it('server rules apply: outside the radius → OUTSIDE_GEOFENCE; not assigned → NOT_ASSIGNED; two locations → 400', async () => {
    const far = await check('in', w.users.staffB, { project_id: w.project, lat: SITE.lat + 0.05, selfie_media_id: await selfie(w.users.staffB) })
    expect((far.body as { code?: string }).code).toBe('OUTSIDE_GEOFENCE')
    const other = await check('in', w.users.staffB, { project_id: w.otherProject, selfie_media_id: await selfie(w.users.staffB) })
    expect(other.status).toBe(403)
    expect((other.body as { code?: string }).code).toBe('NOT_ASSIGNED')
    const both = await check('in', w.users.staffB, { project_id: w.project, cost_center_id: w.costCenter, selfie_media_id: 1 })
    expect(both.status).toBe(400)
  })

  it('every role with an assignment may use it: Finance checks in', async () => {
    const r = await check('in', financeEmp, { project_id: w.project, selfie_media_id: await selfie(financeEmp) })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
  })
})

describe('pk-operator (Operator/Anggota) is attendance-only', () => {
  it('checks in on the web and reads only its own attendance', async () => {
    const r = await check('in', operator, { project_id: w.project, selfie_media_id: await selfie(operator) })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const own = await api('GET', '/api/attendances?limit=50&depth=0', operator)
    expect(own.status).toBe(200)
    const users = ((own.body as { docs: Array<{ user: number | null }> }).docs ?? []).map((d) => d.user)
    expect(users.length).toBeGreaterThan(0)
    expect(users.every((u) => u === operator.id)).toBe(true)
  })

  it('no business data: projects / expense requests / employees → 403; cannot create a request', async () => {
    for (const c of ['projects', 'expense-requests', 'employees', 'cost-centers']) {
      expect((await api('GET', `/api/${c}?limit=1`, operator)).status, c).toBe(403)
    }
    const create = await api('POST', '/api/expense-requests', operator, { title: 'x' })
    expect(create.status).toBe(403)
  })

  it('own profile only', async () => {
    const r = await api('GET', '/api/users?limit=50&depth=0', operator)
    expect(r.status).toBe(200)
    expect(((r.body as { docs: Array<{ id: number }> }).docs ?? []).map((d) => d.id)).toEqual([operator.id])
  })
})
