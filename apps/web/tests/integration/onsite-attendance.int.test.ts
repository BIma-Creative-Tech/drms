import { randomUUID } from 'node:crypto'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetAppConfigCache } from '@/api/v1/endpoints/app'
import { SKIP_COMPANY_DEFAULTS } from '@/domain/company-defaults'
import { resetRateLimits } from '@/lib/rate-limit'

import { accessToken, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, sqlError, type TestUser, updateCompany } from './helpers'
import { api, makeWorld, sysCreate, upload, type FlowUser, type World } from './flow-world'

/**
 * DRMS 13/10 A2 + ADR 0032 (user 2026-10-24): employee attendance type OnSite / Non-OnSite; registered locations =
 * projects and cost centers with a point (no site any more). OnSite: inside the CHOSEN registered location of the own
 * PT (no assignment), outside the geofence / without a point refused. Non-OnSite: inside ANY registered location of the
 * own PT (the containing one is recorded), outside every location refused OUTSIDE_GEOFENCE (no "Di luar area" record);
 * a check-out closes the day's open check-in (flag CHECK_OUT_ELSEWHERE when the fix lies inside another location).
 * Both: another PT's location never, mock refused. GET /api/v1/attendance/locations scoped to the caller's employees.
 * Points, names and codes are fictional. syncAttendanceEnabled is switched ON for this file and OFF again afterwards;
 * the second PT is inactive.
 */
let w: World
let tag = ''
const PRJ = { lat: -1.21, lng: 114.21 }
const CC = { lat: -1.31, lng: 114.31 }
const FAR = { lat: -1.61, lng: 114.61 } // inside no registered location
let project = 0 // nobody assigned
let projectNoPoint = 0
let costCenter = 0 // nobody assigned
let otherCompany = 0
let foreignProject = 0
let onsite: FlowUser // staff A — OnSite (default)
let office: FlowUser // staff B — Non-OnSite

async function selfie(user: FlowUser): Promise<number> {
  const bytes = await sharp({ create: { width: 640, height: 800, channels: 3, background: { r: Math.floor(Math.random() * 255), g: 120, b: 60 } } }).jpeg().toBuffer()
  const r = await upload('/api/v1/media/selfies', user, bytes, 'image/jpeg')
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return (r.body as { id: number }).id
}

async function check(user: FlowUser, at: { lat: number; lng: number }, loc: Record<string, number>, kind: 'in' | 'out' = 'in') {
  resetRateLimits()
  return api('POST', `/api/v1/attendance/check-${kind}`, user, { ...loc, lat: at.lat, lng: at.lng, accuracy_m: 8, selfie_media_id: await selfie(user) })
}

async function setAttendance(enabled: boolean) {
  await updateCompany({ syncAttendanceEnabled: enabled })
  resetAppConfigCache()
}

type Locations = {
  employees: Array<{ id: number; company: number; attendanceType: string; homeSiteId: number | null; referenceSite: unknown }>
  items: Array<Record<string, unknown> & { kind: string; id: number; company: number; isHeadOffice: boolean; home: boolean }>
}
type Checked = { id: number; location: { type: string; id: number }; outsideArea: boolean; distanceM: number }

beforeAll(async () => {
  installLocalJwks()
  tag = `os${Date.now() % 100000}`
  w = await makeWorld(tag)
  const p = await getTestPayload()
  project = await sysCreate('projects', { code: `${tag}-P9`, name: `${tag} Proyek tanpa penugasan`, pm: w.users.otherPm.id, status: 'berjalan', lat: PRJ.lat, lng: PRJ.lng, radiusM: 100 })
  projectNoPoint = await sysCreate('projects', { code: `${tag}-P0`, name: `${tag} Proyek tanpa titik`, pm: w.users.otherPm.id, status: 'berjalan' })
  costCenter = await sysCreate('cost-centers', { code: `${tag}-CCX`, name: `${tag} Ops tanpa penugasan`, type: 'operational', lat: CC.lat, lng: CC.lng, radiusM: 100 })
  // the world project is assigned to staff A and B (team assignments): for the type rule that no longer counts
  await p.update({ collection: 'projects', id: w.project, data: { lat: PRJ.lat + 0.5, lng: PRJ.lng, radiusM: 100 }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  await p.update({ collection: 'projects', id: w.otherProject, data: { lat: PRJ.lat + 0.6, lng: PRJ.lng, radiusM: 100 }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  otherCompany = (await p.create({ collection: 'companies', data: { name: 'PT OnSite Lain', shortCode: `OS${Date.now() % 1000}`, timezone: 'Asia/Makassar', active: false } as never, depth: 0, overrideAccess: true, context: { [SKIP_COMPANY_DEFAULTS]: true } })).id as number
  foreignProject = await sysCreate('projects', { company: otherCompany, code: `${tag}-X`, name: `${tag} Proyek PT lain`, pm: w.users.otherPm.id, status: 'berjalan', lat: PRJ.lat, lng: PRJ.lng, radiusM: 100 })
  // office staff and the admin: Non-OnSite
  await p.update({ collection: 'employees', id: w.emp.b, data: { attendanceType: 'non_onsite' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  await p.update({ collection: 'employees', id: w.emp.admin, data: { attendanceType: 'non_onsite' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  onsite = w.users.staffA
  office = w.users.staffB
  await setAttendance(true)
})

afterAll(async () => {
  await setAttendance(false)
})

describe('schema + defaults', () => {
  it('existing / new employees are OnSite by default; the enum refuses other values', async () => {
    const r = await sqlAs('app', 'SELECT attendance_type FROM employees WHERE id = ANY($1::int[]) ORDER BY id', [[w.emp.a, w.emp.pm, w.emp.noAccount]])
    expect(r.rows.map((x) => x.attendance_type)).toEqual(['onsite', 'onsite', 'onsite'])
    expect((await sqlError('app', `UPDATE employees SET attendance_type = 'kantor' WHERE id = ${w.emp.a}`))?.code).toBe('22P02')
  })

  it('Admin sets the attendance type on the employee; staff cannot', async () => {
    const denied = await api('PATCH', `/api/employees/${w.emp.noAccount}`, w.users.staffA, { attendanceType: 'non_onsite' })
    expect(denied.status).toBe(403)
    const ok = await api('PATCH', `/api/employees/${w.emp.noAccount}`, w.users.admin, { attendanceType: 'non_onsite' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect((await sqlAs('app', 'SELECT attendance_type FROM employees WHERE id = $1', [w.emp.noAccount])).rows[0].attendance_type).toBe('non_onsite')
  })
})

describe('OnSite: inside the chosen registered location of the own PT, no assignment', () => {
  it('unassigned project and cost center → 201', async () => {
    for (const [at, loc] of [
      [PRJ, { project_id: project }],
      [CC, { cost_center_id: costCenter }],
    ] as const) {
      const r = await check(onsite, at, loc)
      expect(r.status, `${JSON.stringify(loc)} ${JSON.stringify(r.body)}`).toBe(201)
    }
  })

  it('outside the geofence → OUTSIDE_GEOFENCE; a location without a point → NO_GEOFENCE; site_id → 400 (web body)', async () => {
    const far = await check(w.users.pm, CC, { project_id: project })
    expect((far.body as { code?: string }).code).toBe('OUTSIDE_GEOFENCE')
    const noPoint = await check(onsite, PRJ, { project_id: projectNoPoint })
    expect((noPoint.body as { code?: string }).code).toBe('NO_GEOFENCE')
    const site = await check(onsite, PRJ, { site_id: 1 })
    expect(site.status).toBe(400)
  })

  it("another PT's location → NOT_FOUND, nothing stored", async () => {
    const r = await check(onsite, PRJ, { project_id: foreignProject })
    expect(r.status).toBe(404)
    const n = await sqlAs('app', 'SELECT count(*)::int AS n FROM attendances WHERE project_id = $1', [foreignProject])
    expect(n.rows[0].n).toBe(0)
  })
})

describe('Non-OnSite: only inside a registered location of the own PT (ADR 0032)', () => {
  it('inside a registered location → recorded there (no assignment, no refusal)', async () => {
    const prj = await check(office, PRJ, { project_id: project })
    expect(prj.status, JSON.stringify(prj.body)).toBe(201)
    expect(prj.body as Checked).toMatchObject({ location: { type: 'project', id: project }, outsideArea: false })
  })

  it('the server records the registered location that contains the fix, whatever was requested', async () => {
    const r = await check(office, CC, { project_id: projectNoPoint })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body as Checked).toMatchObject({ location: { type: 'cost_center', id: costCenter }, outsideArea: false })
  })

  it('outside every registered location → 409 OUTSIDE_GEOFENCE with the Non-OnSite message, nothing stored', async () => {
    const before = (await sqlAs('app', 'SELECT count(*)::int AS n FROM attendances WHERE employee_id = $1', [w.emp.b])).rows[0].n
    const r = await check(office, FAR, { project_id: project })
    expect(r.status, JSON.stringify(r.body)).toBe(409)
    expect((r.body as { code?: string }).code).toBe('OUTSIDE_GEOFENCE')
    expect(JSON.stringify(r.body)).toContain('Non-OnSite')
    const out = await check(office, FAR, { project_id: project }, 'out')
    expect((out.body as { code?: string }).code).toBe('OUTSIDE_GEOFENCE')
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM attendances WHERE employee_id = $1', [w.emp.b])).rows[0].n).toBe(before)
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM attendances WHERE employee_id = $1 AND outside_area', [w.emp.b])).rows[0].n).toBe(0)
  })

  it('a check-out inside ANOTHER registered location closes the open check-in (flag CHECK_OUT_ELSEWHERE)', async () => {
    const admin = w.users.admin
    const inn = await check(admin, PRJ, { project_id: project })
    expect(inn.status, JSON.stringify(inn.body)).toBe(201)
    const out = await check(admin, CC, { cost_center_id: costCenter }, 'out')
    expect(out.status, JSON.stringify(out.body)).toBe(201)
    expect(out.body as Checked).toMatchObject({ location: { type: 'project', id: project }, outsideArea: false })
    expect((out.body as Checked).distanceM).toBeGreaterThan(10_000)
    const row = (await sqlAs('app', 'SELECT kind, project_id, cost_center_id, outside_area, flags FROM attendances WHERE id = $1', [(out.body as Checked).id])).rows[0]
    expect(row).toMatchObject({ kind: 'check_out', project_id: project, cost_center_id: null, outside_area: false })
    expect(row.flags).toContain('CHECK_OUT_ELSEWHERE')
  })

  it("still refused: another PT's location (NOT_FOUND)", async () => {
    const r = await check(office, PRJ, { project_id: foreignProject })
    expect(r.status).toBe(404)
  })

  it('APK sync (queued item): mock location refused; outside every location → rejected OUTSIDE_GEOFENCE', async () => {
    const admin = w.users.admin
    const p = await getTestPayload()
    const doc = await p.findByID({ collection: 'users', id: admin.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
    const t: TestUser = { ...admin, keycloakSub: doc.keycloakSub as string }
    const token = await accessToken(t, ['pk-admin'])
    const device = await registerDevice(t, token)
    const headers = { Authorization: `Bearer ${token}`, 'X-Device-Id': device, 'X-App-Version': '1.0.0' }
    const item = (type: string, payload: Record<string, unknown>) => ({ client_uuid: randomUUID(), type, schema_version: 1, offline: false, device_time: new Date().toISOString(), elapsed_ms: 10_000_000, payload })
    const now = Date.now()
    const clock = { device_time: new Date(now).toISOString(), elapsed_ms: 10_000_000, boot_id: 'boot-os', last_server_time: new Date(now - 60_000).toISOString(), last_server_elapsed_ms: 10_000_000 - 60_000 }
    resetRateLimits()
    const r = await http('POST', '/api/v1/sync/batch', {
      headers,
      json: {
        batch_id: randomUUID(),
        device_id: device,
        clock,
        items: [
          item('attendance.check_in', { project_id: project, ...PRJ, accuracy_m: 8, is_mocked: true, selfie_media_id: await selfie(admin) }),
          item('attendance.check_in', { project_id: project, ...FAR, accuracy_m: 8, is_mocked: false, selfie_media_id: await selfie(admin) }),
        ],
      },
    })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const results = (r.body as { results: Array<{ status: string; server_id: string | null; errors: Array<{ code: string }> }> }).results
    expect(results[0]).toMatchObject({ status: 'rejected', errors: [{ code: 'MOCK_LOCATION' }] })
    expect(results[1], JSON.stringify(results[1])).toMatchObject({ status: 'rejected', errors: [{ code: 'OUTSIDE_GEOFENCE' }] })
  })
})

describe('GET /api/v1/attendance/locations', () => {
  it('OnSite: projects then cost centers with a point; no site, no money fields; legacy site fields null / false', async () => {
    resetRateLimits()
    const r = await api('GET', '/api/v1/attendance/locations', onsite)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const body = r.body as Locations
    expect(body.employees).toEqual([expect.objectContaining({ id: w.emp.a, attendanceType: 'onsite', homeSiteId: null, referenceSite: null })])
    const keys = body.items.map((i) => `${i.kind}:${i.id}`)
    expect(keys).toEqual(expect.arrayContaining([`project:${project}`, `cost_center:${costCenter}`, `project:${w.project}`]))
    expect(keys.findIndex((k) => k.startsWith('cost_center:'))).toBeGreaterThan(keys.findIndex((k) => k === `project:${project}`))
    for (const missing of [`project:${projectNoPoint}`, `project:${foreignProject}`]) expect(keys).not.toContain(missing)
    expect(new Set(body.items.map((i) => i.kind))).toEqual(new Set(['project', 'cost_center']))
    expect(body.items.find((i) => i.id === project && i.kind === 'project')).toMatchObject({ isHeadOffice: false, home: false, radiusM: 100, lat: PRJ.lat, lng: PRJ.lng })
    for (const i of body.items) expect(Object.keys(i).sort()).toEqual(['code', 'company', 'employeeId', 'home', 'id', 'isHeadOffice', 'kind', 'lat', 'lng', 'name', 'radiusM'])
  })

  it('Non-OnSite: the same registered locations; no reference site any more', async () => {
    resetRateLimits()
    const body = (await api('GET', '/api/v1/attendance/locations', office)).body as Locations
    expect(body.employees[0]).toMatchObject({ id: w.emp.b, attendanceType: 'non_onsite', referenceSite: null, homeSiteId: null })
    expect(new Set(body.items.map((i) => i.kind))).toEqual(new Set(['project', 'cost_center']))
  })

  it('scoping: no employee → empty lists; a PT outside the selection → 403 COMPANY_NOT_ALLOWED', async () => {
    resetRateLimits()
    const none = await api('GET', '/api/v1/attendance/locations', w.users.owner)
    expect(none.status).toBe(200)
    expect(none.body).toEqual({ employees: [], items: [] })
    const foreign = await api('GET', `/api/v1/attendance/locations?company=${otherCompany}`, onsite)
    expect(foreign.status).toBe(403)
    expect((foreign.body as { code?: string }).code).toBe('COMPANY_NOT_ALLOWED')
  })
})
