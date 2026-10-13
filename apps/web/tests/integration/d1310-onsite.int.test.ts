import { randomUUID } from 'node:crypto'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetAppConfigCache } from '@/api/v1/endpoints/app'
import { SKIP_COMPANY_DEFAULTS } from '@/domain/company-defaults'
import { resetRateLimits } from '@/lib/rate-limit'

import { accessToken, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, sqlError, type TestUser, updateCompany } from './helpers'
import { api, makeWorld, sysCreate, upload, type FlowUser, type World } from './flow-world'

/**
 * DRMS 13/10 A2 (ADR 0023 amendment 2026-10-13): employee attendance type OnSite / Non-OnSite and the head office
 * flag on sites. OnSite: any registered location of the own PT with a point (no assignment); Non-OnSite: head office
 * + branch offices only; another PT's location never; outside the geofence / without a point refused; one head office
 * per PT (hook + DB); GET /api/v1/attendance/locations scoped to the caller's employees. Points, names and codes are
 * fictional. syncAttendanceEnabled is switched ON for this file and OFF again afterwards; the second PT is inactive.
 */
let w: World
let tag = ''
const HO = { lat: -1.01, lng: 114.01 }
const BR = { lat: -1.11, lng: 114.11 }
const PRJ = { lat: -1.21, lng: 114.21 }
const CC = { lat: -1.31, lng: 114.31 }
let head = 0
let branch = 0
let siteNoPoint = 0
let project = 0 // nobody assigned
let projectNoPoint = 0
let costCenter = 0 // nobody assigned
let otherCompany = 0
let foreignSite = 0
let onsite: FlowUser // staff A — OnSite (default)
let office: FlowUser // staff B — Non-OnSite

async function selfie(user: FlowUser): Promise<number> {
  const bytes = await sharp({ create: { width: 640, height: 800, channels: 3, background: { r: Math.floor(Math.random() * 255), g: 120, b: 60 } } }).jpeg().toBuffer()
  const r = await upload('/api/v1/media/selfies', user, bytes, 'image/jpeg')
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return (r.body as { id: number }).id
}

async function check(user: FlowUser, at: { lat: number; lng: number }, loc: Record<string, number>, dLat = 0) {
  resetRateLimits()
  return api('POST', '/api/v1/attendance/check-in', user, { ...loc, lat: at.lat + dLat, lng: at.lng, accuracy_m: 8, selfie_media_id: await selfie(user) })
}

async function setAttendance(enabled: boolean) {
  await updateCompany({ syncAttendanceEnabled: enabled })
  resetAppConfigCache()
}

type Locations = {
  employees: Array<{ id: number; company: number; attendanceType: string; homeSiteId: number | null }>
  items: Array<Record<string, unknown> & { kind: string; id: number; company: number; isHeadOffice: boolean; home: boolean }>
}

beforeAll(async () => {
  installLocalJwks()
  tag = `os${Date.now() % 100000}`
  w = await makeWorld(tag)
  const p = await getTestPayload()
  head = await sysCreate('sites', { code: `${tag}-HO`, name: `${tag} Kantor Pusat`, isHeadOffice: true, lat: HO.lat, lng: HO.lng, radiusM: 100 })
  branch = await sysCreate('sites', { code: `${tag}-CB`, name: `${tag} Kantor Cabang`, lat: BR.lat, lng: BR.lng, radiusM: 100 })
  siteNoPoint = await sysCreate('sites', { code: `${tag}-NP`, name: `${tag} Cabang tanpa titik` })
  project = await sysCreate('projects', { code: `${tag}-P9`, name: `${tag} Proyek tanpa penugasan`, pm: w.users.otherPm.id, status: 'berjalan', lat: PRJ.lat, lng: PRJ.lng, radiusM: 100 })
  projectNoPoint = await sysCreate('projects', { code: `${tag}-P0`, name: `${tag} Proyek tanpa titik`, pm: w.users.otherPm.id, status: 'berjalan' })
  costCenter = await sysCreate('cost-centers', { code: `${tag}-CCX`, name: `${tag} Ops tanpa penugasan`, type: 'operational', lat: CC.lat, lng: CC.lng, radiusM: 100 })
  // the world project is assigned to staff A and B (team assignments): for a Non-OnSite employee that no longer counts
  await p.update({ collection: 'projects', id: w.project, data: { lat: PRJ.lat + 0.5, lng: PRJ.lng, radiusM: 100 }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  otherCompany = (await p.create({ collection: 'companies', data: { name: 'PT OnSite Lain', shortCode: `OS${Date.now() % 1000}`, timezone: 'Asia/Makassar', active: false } as never, depth: 0, overrideAccess: true, context: { [SKIP_COMPANY_DEFAULTS]: true } })).id as number
  foreignSite = await sysCreate('sites', { company: otherCompany, code: `${tag}-X`, name: `${tag} Kantor PT lain`, isHeadOffice: true, lat: HO.lat, lng: HO.lng, radiusM: 100 })
  await p.update({ collection: 'employees', id: w.emp.a, data: { homeSite: branch }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  await p.update({ collection: 'employees', id: w.emp.b, data: { attendanceType: 'non_onsite' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  onsite = w.users.staffA
  office = w.users.staffB
  await setAttendance(true)
})

afterAll(async () => {
  await setAttendance(false)
})

describe('schema + defaults', () => {
  it('existing / new employees are OnSite by default; a site is not a head office by default', async () => {
    const r = await sqlAs('app', 'SELECT attendance_type FROM employees WHERE id = ANY($1::int[]) ORDER BY id', [[w.emp.a, w.emp.pm, w.emp.noAccount]])
    expect(r.rows.map((x) => x.attendance_type)).toEqual(['onsite', 'onsite', 'onsite'])
    expect((await sqlAs('app', 'SELECT is_head_office FROM sites WHERE id = $1', [branch])).rows[0].is_head_office).toBe(false)
    expect((await sqlError('app', `UPDATE employees SET attendance_type = 'kantor' WHERE id = ${w.emp.a}`))?.code).toBe('22P02')
  })

  it('one head office per PT: field error in the admin / REST path, unique index in the DB; another PT may have its own', async () => {
    const dup = await api('POST', '/api/sites', w.users.admin, { code: `${tag}-HO2`, name: 'Pusat kedua', isHeadOffice: true })
    expect(dup.status, JSON.stringify(dup.body)).toBe(400)
    expect(JSON.stringify(dup.body)).toContain('sudah punya kantor pusat')
    const moved = await api('PATCH', `/api/sites/${branch}`, w.users.admin, { isHeadOffice: true })
    expect(moved.status).toBe(400)
    const e = await sqlError('app', `UPDATE sites SET is_head_office = TRUE WHERE id = ${branch}`)
    expect(e?.code).toBe('23505')
    expect((await sqlAs('app', 'SELECT is_head_office FROM sites WHERE id = $1', [foreignSite])).rows[0].is_head_office).toBe(true)
  })

  it('Admin sets the attendance type on the employee; staff cannot', async () => {
    const denied = await api('PATCH', `/api/employees/${w.emp.noAccount}`, w.users.staffA, { attendanceType: 'non_onsite' })
    expect(denied.status).toBe(403)
    const ok = await api('PATCH', `/api/employees/${w.emp.noAccount}`, w.users.admin, { attendanceType: 'non_onsite' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect((await sqlAs('app', 'SELECT attendance_type FROM employees WHERE id = $1', [w.emp.noAccount])).rows[0].attendance_type).toBe('non_onsite')
  })
})

describe('OnSite: any registered location of the own PT, no assignment', () => {
  it('unassigned project, cost center and branch site → 201', async () => {
    for (const [at, loc] of [
      [PRJ, { project_id: project }],
      [CC, { cost_center_id: costCenter }],
      [BR, { site_id: branch }],
    ] as const) {
      const r = await check(onsite, at, loc)
      expect(r.status, `${JSON.stringify(loc)} ${JSON.stringify(r.body)}`).toBe(201)
    }
  })

  it('outside the geofence → OUTSIDE_GEOFENCE; a location without a point is not eligible → NO_GEOFENCE', async () => {
    const far = await check(onsite, HO, { site_id: head }, 0.01)
    expect((far.body as { code?: string }).code).toBe('OUTSIDE_GEOFENCE')
    const noPoint = await check(onsite, PRJ, { project_id: projectNoPoint })
    expect((noPoint.body as { code?: string }).code).toBe('NO_GEOFENCE')
    const noPointSite = await check(onsite, BR, { site_id: siteNoPoint })
    expect((noPointSite.body as { code?: string }).code).toBe('NO_GEOFENCE')
  })

  it("another PT's location (even its head office) → NOT_FOUND, nothing stored", async () => {
    const r = await check(onsite, HO, { site_id: foreignSite })
    expect(r.status).toBe(404)
    const n = await sqlAs('app', 'SELECT count(*)::int AS n FROM attendances WHERE site_id = $1', [foreignSite])
    expect(n.rows[0].n).toBe(0)
  })
})

describe('Non-OnSite: head office and branch offices only', () => {
  it('head office and branch → 201', async () => {
    expect((await check(office, HO, { site_id: head })).status).toBe(201)
    expect((await check(office, BR, { site_id: branch })).status).toBe(201)
  })

  it('project / cost center → 403 NOT_ASSIGNED with the Non-OnSite reason (also an assigned project)', async () => {
    for (const [at, loc] of [
      [PRJ, { project_id: project }],
      [CC, { cost_center_id: costCenter }],
      [{ lat: PRJ.lat + 0.5, lng: PRJ.lng }, { project_id: w.project }],
    ] as const) {
      const r = await check(office, at, loc)
      expect(r.status, JSON.stringify(r.body)).toBe(403)
      expect((r.body as { code?: string }).code).toBe('NOT_ASSIGNED')
      expect(JSON.stringify(r.body)).toContain('tidak termasuk area absen untuk karyawan Non-OnSite')
    }
  })

  it('APK sync (queued item): the server re-validates — project refused, head office check-out applied', async () => {
    const p = await getTestPayload()
    const doc = await p.findByID({ collection: 'users', id: office.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
    const t: TestUser = { ...office, keycloakSub: doc.keycloakSub as string }
    const token = await accessToken(t, ['pk-staff'])
    const device = await registerDevice(t, token)
    const headers = { Authorization: `Bearer ${token}`, 'X-Device-Id': device, 'X-App-Version': '1.0.0' }
    // queued on the phone (the APK picked the area from its cached list), sent at the next sync
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
          item('attendance.check_in', { project_id: project, lat: PRJ.lat, lng: PRJ.lng, accuracy_m: 8, is_mocked: false, selfie_media_id: await selfie(office) }),
          item('attendance.check_out', { site_id: head, lat: HO.lat, lng: HO.lng, accuracy_m: 8, is_mocked: false, selfie_media_id: await selfie(office) }),
        ],
      },
    })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const results = (r.body as { results: Array<{ status: string; errors: Array<{ code: string }> }> }).results
    expect(results[0]).toMatchObject({ status: 'rejected', errors: [{ code: 'NOT_ASSIGNED' }] })
    expect(results[1], JSON.stringify(results[1])).toMatchObject({ status: 'applied' })
  })
})

describe('GET /api/v1/attendance/locations', () => {
  it('OnSite: home site first, head office, then sites / projects / cost centers with a point; no money fields', async () => {
    resetRateLimits()
    const r = await api('GET', '/api/v1/attendance/locations', onsite)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const body = r.body as Locations
    expect(body.employees).toEqual([expect.objectContaining({ id: w.emp.a, attendanceType: 'onsite', homeSiteId: branch })])
    const keys = body.items.map((i) => `${i.kind}:${i.id}`)
    expect(keys.slice(0, 2)).toEqual([`site:${branch}`, `site:${head}`])
    expect(keys).toEqual(expect.arrayContaining([`project:${project}`, `cost_center:${costCenter}`, `project:${w.project}`]))
    for (const missing of [`site:${siteNoPoint}`, `project:${projectNoPoint}`, `site:${foreignSite}`]) expect(keys).not.toContain(missing)
    expect(body.items.find((i) => i.id === head && i.kind === 'site')).toMatchObject({ isHeadOffice: true, home: false, radiusM: 100, lat: HO.lat, lng: HO.lng })
    expect(body.items.find((i) => i.id === branch && i.kind === 'site')).toMatchObject({ home: true })
    for (const i of body.items) expect(Object.keys(i).sort()).toEqual(['code', 'company', 'employeeId', 'home', 'id', 'isHeadOffice', 'kind', 'lat', 'lng', 'name', 'radiusM'])
  })

  it('Non-OnSite: sites only (head office + branches)', async () => {
    resetRateLimits()
    const body = (await api('GET', '/api/v1/attendance/locations', office)).body as Locations
    expect(body.employees[0]).toMatchObject({ id: w.emp.b, attendanceType: 'non_onsite' })
    expect(new Set(body.items.map((i) => i.kind))).toEqual(new Set(['site']))
    expect(body.items.map((i) => i.id)).toEqual(expect.arrayContaining([head, branch]))
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
