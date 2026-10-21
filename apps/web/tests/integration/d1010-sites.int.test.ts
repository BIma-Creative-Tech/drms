import { randomUUID } from 'node:crypto'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetAppConfigCache } from '@/api/v1/endpoints/app'
import { scheduleOfEmployee } from '@/domain/attendance/record'
import { SKIP_COMPANY_DEFAULTS } from '@/domain/company-defaults'
import { requestPusatBiaya } from '@/domain/expense/transfers'
import { requestScopeSql, projectScopeSql, narrowToSite, officeScope, teamScope } from '@/domain/reports/scope'
import { rows } from '@/domain/reports/kpi'
import { resetRateLimits } from '@/lib/rate-limit'
import { sql } from '@payloadcms/db-postgres'

import { accessToken, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, sqlError, type TestUser, updateCompany } from './helpers'
import { api, asUser, makeWorld, sysCreate, type FlowUser, type World } from './flow-world'

/**
 * ADR 0023 (DRMS 10/10 Phase D, owner 2026-10-11): sites = kantor cabang per PT. Attendance at a site (geofence,
 * home site OR site assignment, PM on-behalf: pm-role site assignment or PM of a project of the site), server-filled
 * attendance site, schedule fallback employee → home site → PT, the site filter only narrows report / dashboard scope,
 * same-PT references (service + DB triggers), DB guards of the master, transfer default cost center from the site,
 * masters / sites / projects API. Coordinates, names and codes are fictional. syncAttendanceEnabled is switched ON for
 * this file and OFF again afterwards; the second PT is created inactive (single-company default for other files).
 */
let w: World
type Mobile = { user: FlowUser; token: string; device: string }
let staffA: Mobile
let staffB: Mobile
let pm: Mobile
let otherPm: Mobile
const BRANCH = { lat: -1.2654, lng: 116.8312 } // fictional point "Cabang Balikpapan"
const PROJ = { lat: -2.21, lng: 113.91 }
let siteA = 0 // with point + default schedule + default cost center
let siteB = 0 // without point
let siteForeign = 0 // a site of another PT
let otherCompany = 0
let siteSchedule = 0
let ptSchedule = 0
let siteCc = 0
let siteAccount = 0
let plainProject = 0

async function mobile(user: FlowUser, roles: string[]): Promise<Mobile> {
  const p = await getTestPayload()
  const doc = await p.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
  const t: TestUser = { ...user, keycloakSub: doc.keycloakSub as string }
  const token = await accessToken(t, roles)
  return { user, token, device: await registerDevice(t, token) }
}
const headers = (m: Mobile) => ({ Authorization: `Bearer ${m.token}`, 'X-Device-Id': m.device, 'X-App-Version': '1.0.0' })

async function selfie(m: Mobile): Promise<number> {
  const bytes = await sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: Math.floor(Math.random() * 255), g: 90, b: 40 } } }).jpeg().toBuffer()
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'selfie.jpg')
  const { handleEndpoints } = await import('payload')
  const config = (await import('@payload-config')).default
  const res = await handleEndpoints({ config, request: new Request('http://localhost:3000/api/v1/media/selfies', { method: 'POST', headers: headers(m), body: form }) })
  const body = (await res.json()) as { id: number }
  expect(res.status, JSON.stringify(body)).toBe(201)
  return body.id
}

const item = (type: string, payload: Record<string, unknown>) => ({ client_uuid: randomUUID(), type, schema_version: 1, offline: false, device_time: new Date().toISOString(), elapsed_ms: 10_000_000, payload })

async function sync(m: Mobile, items: Array<Record<string, unknown>>) {
  resetRateLimits()
  const now = Date.now()
  const clock = { device_time: new Date(now).toISOString(), elapsed_ms: 10_000_000, boot_id: 'boot-s', last_server_time: new Date(now - 60_000).toISOString(), last_server_elapsed_ms: 10_000_000 - 60_000 }
  const r = await http('POST', '/api/v1/sync/batch', { headers: headers(m), json: { batch_id: randomUUID(), device_id: m.device, clock, items } })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return (r.body as { results: Array<{ status: string; server_id: string | null; errors: Array<{ code: string; message: string; field?: string }> }> }).results
}

const at = (loc: { lat: number; lng: number }, dLat = 0) => ({ lat: loc.lat + dLat, lng: loc.lng, accuracy_m: 8, is_mocked: false })

async function setAttendance(enabled: boolean) {
  await updateCompany({ syncAttendanceEnabled: enabled })
  resetAppConfigCache()
}

beforeAll(async () => {
  installLocalJwks()
  w = await makeWorld('sit')
  const p = await getTestPayload()
  siteSchedule = await sysCreate('work-schedules', { name: 'sit Cabang 07-16', startTime: '07:00', endTime: '16:00', lateToleranceMin: 10, workDays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false } })
  ptSchedule = await sysCreate('work-schedules', { name: 'sit Pusat 08-17', startTime: '08:00', endTime: '17:00', lateToleranceMin: 15, workDays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: false } })
  siteCc = await sysCreate('cost-centers', { code: 'sit-CCB', name: 'sit Ops Cabang', type: 'operational' })
  siteA = await sysCreate('sites', { code: 'sit-BPN', name: 'sit Cabang Balikpapan', address: 'Jl. Contoh 1', lat: BRANCH.lat, lng: BRANCH.lng, radiusM: 120, defaultWorkSchedule: siteSchedule, costCenter: siteCc })
  siteB = await sysCreate('sites', { code: 'sit-KDI', name: 'sit Cabang Kendari' })
  otherCompany = (await p.create({ collection: 'companies', data: { name: 'PT Sites Lain', shortCode: 'SITX', timezone: 'Asia/Makassar', active: false } as never, depth: 0, overrideAccess: true, context: { [SKIP_COMPANY_DEFAULTS]: true } })).id as number
  siteForeign = await sysCreate('sites', { company: otherCompany, code: 'sit-X', name: 'sit Cabang PT lain' })
  // staff A: stationed at the branch (home site); staff B: assigned to the branch for a period; noAccount: home site too
  await p.update({ collection: 'employees', id: w.emp.a, data: { homeSite: siteA }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  await p.update({ collection: 'employees', id: w.emp.noAccount, data: { homeSite: siteA }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  await sysCreate('team-assignments', { employee: w.emp.b, site: siteA, roleInProject: 'staff' })
  // the world project belongs to the branch (its PM = `pm`: may record on-behalf at the branch); it keeps its own point
  await p.update({ collection: 'projects', id: w.project, data: { site: siteA, lat: PROJ.lat, lng: PROJ.lng, radiusM: 100 }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  plainProject = await sysCreate('projects', { code: 'sit-P3', name: 'sit Tanpa site', pm: w.users.otherPm.id, status: 'berjalan' })
  await p.update({ collection: 'cost-centers', id: w.costCenter, data: { lat: PROJ.lat + 0.5, lng: PROJ.lng, radiusM: 150 }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  siteAccount = await sysCreate('cash-accounts', { name: 'sit Kas Kecil Cabang', kind: 'cash', openingBalance: 2_500_000, site: siteA })
  staffA = await mobile(w.users.staffA, ['pk-staff'])
  staffB = await mobile(w.users.staffB, ['pk-staff'])
  pm = await mobile(w.users.pm, ['pk-pm'])
  otherPm = await mobile(w.users.otherPm, ['pk-pm'])
  await setAttendance(true)
})

afterAll(async () => {
  await setAttendance(false)
})

describe('master + DB guards', () => {
  it('code unique per PT, company immutable, no delete, default cost center operational, same-PT references', async () => {
    expect((await sqlError('app', `INSERT INTO sites (company_id, code, name, updated_at, created_at) VALUES ((SELECT company_id FROM sites WHERE id = ${siteA}), 'sit-BPN', 'dup', now(), now())`))?.code).toBe('23505')
    expect((await sqlError('app', `INSERT INTO sites (code, name, updated_at, created_at) VALUES ('sit-NOPT', 'tanpa PT', now(), now())`))?.code).toBe('23502')
    expect((await sqlError('app', `UPDATE sites SET company_id = ${otherCompany} WHERE id = ${siteA}`))?.code).toBe('42501')
    expect((await sqlError('app', `DELETE FROM sites WHERE id = ${siteB}`))?.code).toBe('42501')
    const dept = await sysCreate('cost-centers', { code: 'sit-DEPT', name: 'sit Departemen', type: 'department' })
    expect((await sqlError('app', `UPDATE sites SET cost_center_id = ${dept} WHERE id = ${siteB}`))?.message).toContain('operational')
    for (const q of [
      `UPDATE employees SET home_site_id = ${siteForeign} WHERE id = ${w.emp.b}`,
      `UPDATE projects SET site_id = ${siteForeign} WHERE id = ${w.otherProject}`,
      `UPDATE cash_accounts SET site_id = ${siteForeign} WHERE id = ${w.cashAccount}`,
      `UPDATE team_assignments SET site_id = ${siteForeign}, project_id = NULL WHERE id = (SELECT id FROM team_assignments WHERE employee_id = ${w.emp.b} AND site_id = ${siteA} LIMIT 1)`,
    ]) {
      expect((await sqlError('app', q))?.message, q).toContain('cross-company reference')
    }
  })

  it('service: a site of another PT is refused on project / employee / cash account / assignment (company hook)', async () => {
    const p = await getTestPayload()
    for (const [collection, id, data] of [
      ['projects', w.otherProject, { site: siteForeign }],
      ['employees', w.emp.b, { homeSite: siteForeign }],
      ['cash-accounts', w.cashAccount, { site: siteForeign }],
    ] as const) {
      await expect(p.update({ collection, id, data: data as never, overrideAccess: true }), collection).rejects.toThrow()
    }
    await expect(p.create({ collection: 'team-assignments', data: { employee: w.emp.b, site: siteForeign, roleInProject: 'staff' } as never, overrideAccess: true })).rejects.toThrow()
  })

  it('team assignment: exactly one of project / cost center / site (hook + DB CHECK)', async () => {
    const p = await getTestPayload()
    await expect(p.create({ collection: 'team-assignments', data: { employee: w.emp.b, site: siteA, project: w.project, roleInProject: 'staff' } as never, overrideAccess: true })).rejects.toThrow(/salah satu/)
    const e = await sqlError('app', `INSERT INTO team_assignments (company_id, employee_id, site_id, cost_center_id, role_in_project, updated_at, created_at) SELECT company_id, ${w.emp.b}, ${siteA}, ${w.costCenter}, 'staff', now(), now() FROM sites WHERE id = ${siteA}`)
    expect(e?.code).toBe('23514')
  })

  it('every member of the PT reads the sites (staff included); Admin creates; staff cannot', async () => {
    const list = await api('GET', '/api/sites?limit=50', w.users.staffB)
    expect(list.status).toBe(200)
    expect(((list.body as { docs: Array<{ id: number }> }).docs.map((d) => d.id))).toEqual(expect.arrayContaining([siteA, siteB]))
    expect(((list.body as { docs: Array<{ id: number }> }).docs.map((d) => d.id))).not.toContain(siteForeign)
    const denied = await api('POST', '/api/sites', w.users.staffA, { code: 'sit-STF', name: 'tidak boleh' })
    expect(denied.status).toBe(403)
    const ok = await api('POST', '/api/sites', w.users.admin, { code: 'sit-ADM', name: 'sit Cabang Admin' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
  })
})

describe('attendance at a site (ADR 0023 §3)', () => {
  it('home site, inside the radius: applied; the row carries site_id without project / cost center', async () => {
    const [r] = await sync(staffA, [item('attendance.check_in', { site_id: siteA, ...at(BRANCH, 0.0003), selfie_media_id: await selfie(staffA) })])
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'applied' })
    const row = (await sqlAs('app', 'SELECT project_id, cost_center_id, site_id, schedule FROM attendances WHERE id = $1', [Number(r!.server_id)])).rows[0]
    expect(row).toMatchObject({ project_id: null, cost_center_id: null, site_id: siteA })
    // schedule fallback: no own schedule → the home site's default schedule
    expect((row.schedule as { name?: string }).name).toBe('sit Cabang 07-16')
    const dup = await sync(staffA, [item('attendance.check_in', { site_id: siteA, ...at(BRANCH), selfie_media_id: await selfie(staffA) })])
    expect(dup[0]!.errors[0]!.code).toBe('ALREADY_CHECKED_IN')
    const [out] = await sync(staffA, [item('attendance.check_out', { site_id: siteA, ...at(BRANCH), selfie_media_id: await selfie(staffA) })])
    expect(out!.status).toBe('applied')
  })

  it('outside the radius → OUTSIDE_GEOFENCE; a site without point → NO_GEOFENCE', async () => {
    const [far] = await sync(staffB, [item('attendance.check_in', { site_id: siteA, ...at(BRANCH, 0.01), selfie_media_id: await selfie(staffB) })])
    expect(far!.errors[0]!.code).toBe('OUTSIDE_GEOFENCE')
    const [noPoint] = await sync(staffA, [item('attendance.check_in', { site_id: siteB, ...at(BRANCH), selfie_media_id: await selfie(staffA) })])
    expect(noPoint!.errors[0]!.code).toBe('NO_GEOFENCE')
  })

  it('site assignment (no home site) allows the check-in; DRMS 13/10 A2: any registered site of the PT, no assignment', async () => {
    const [r] = await sync(staffB, [item('attendance.check_in', { site_id: siteA, ...at(BRANCH), selfie_media_id: await selfie(staffB) })])
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'applied' })
    const p = await getTestPayload()
    const other = await sysCreate('sites', { code: 'sit-SMD', name: 'sit Cabang Samarinda', lat: BRANCH.lat, lng: BRANCH.lng, radiusM: 100 })
    const [any] = await sync(staffA, [item('attendance.check_in', { site_id: other, ...at(BRANCH), selfie_media_id: await selfie(staffA) })])
    expect(any, JSON.stringify(any)).toMatchObject({ status: 'applied' })
    await p.update({ collection: 'sites', id: other, data: { active: false, changeReason: 'uji nonaktif' } as never, overrideAccess: true })
    const [inactive] = await sync(staffA, [item('attendance.check_in', { site_id: other, ...at(BRANCH), selfie_media_id: await selfie(staffA) })])
    expect(inactive!.errors[0]!.code).toBe('VALIDATION')
  })

  it('a site of another PT is answered like a missing one (NOT_FOUND)', async () => {
    const [r] = await sync(staffA, [item('attendance.check_in', { site_id: siteForeign, ...at(BRANCH), selfie_media_id: await selfie(staffA) })])
    expect(r!.status).toBe('rejected')
    expect(['NOT_FOUND', 'COMPANY_NOT_ALLOWED']).toContain(r!.errors[0]!.code)
  })

  it('two locations in one payload → rejected VALIDATION (exactly one of project / cost center / site)', async () => {
    const [r] = await sync(staffA, [item('attendance.check_in', { site_id: siteA, project_id: w.project, ...at(BRANCH), selfie_media_id: await selfie(staffA) })])
    expect(r!.status).toBe('rejected')
    expect(r!.errors[0]!.code).toBe('VALIDATION')
    const web = await api('POST', '/api/v1/attendance/check-in', w.users.staffA, { site_id: siteA, cost_center_id: w.costCenter, lat: BRANCH.lat, lng: BRANCH.lng, selfie_media_id: 1 })
    expect(web.status).toBe(400)
  })

  it('old payload (project) unchanged: the row gets the project\'s site; a cost-center check-in has no site', async () => {
    const [r] = await sync(staffB, [item('attendance.check_in', { project_id: w.project, ...at(PROJ), selfie_media_id: await selfie(staffB) })])
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'applied' })
    expect((await sqlAs('app', 'SELECT project_id, site_id FROM attendances WHERE id = $1', [Number(r!.server_id)])).rows[0]).toEqual({ project_id: w.project, site_id: siteA })
    const [c] = await sync(staffA, [item('attendance.check_in', { cost_center_id: w.costCenter, ...at({ lat: PROJ.lat + 0.5, lng: PROJ.lng }), selfie_media_id: await selfie(staffA) })])
    expect(c, JSON.stringify(c)).toMatchObject({ status: 'applied' })
    expect((await sqlAs('app', 'SELECT cost_center_id, site_id FROM attendances WHERE id = $1', [Number(c!.server_id)])).rows[0]).toEqual({ cost_center_id: w.costCenter, site_id: null })
    // the app cannot smuggle a site onto a cost-center row (DB derives it)
    const e = await sqlError('app', `INSERT INTO attendances (employee_id, user_id, kind, cost_center_id, site_id, local_date, attendance_time, received_at, time_trust, offline, lat, lng, distance_m, selfie_id, client_uuid, source, updated_at, created_at)
      SELECT ${w.emp.b}, ${w.users.staffB.id}, 'check_out', ${w.costCenter}, ${siteA}, '2026-01-05', now(), now(), 'server', false, 0, 0, 1, a.selfie_id, '${randomUUID()}', 'self', now(), now()
        FROM attendances a WHERE a.id = ${Number(c!.server_id)}`)
    expect(e).toBeNull()
    expect((await sqlAs('owner', `SELECT site_id FROM attendances WHERE employee_id = ${w.emp.b} AND local_date = '2026-01-05'`)).rows[0]).toEqual({ site_id: null })
  })

  it('PM on-behalf at a site: PM of a project of the site OK; PM without the site in his team → FORBIDDEN', async () => {
    const ob = (over: Record<string, unknown>) => ({ employee_id: w.emp.noAccount, kind: 'check_in', site_id: siteA, ...at(BRANCH), camera_lens: 'back', reason: 'Tidak punya HP (uji site)', ...over })
    const [r] = await sync(pm, [item('attendance.on_behalf', ob({ selfie_media_id: await selfie(pm) }))])
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'applied' })
    expect((await sqlAs('app', 'SELECT source, site_id, project_id FROM attendances WHERE id = $1', [Number(r!.server_id)])).rows[0]).toEqual({ source: 'pm', site_id: siteA, project_id: null })
    const [no] = await sync(otherPm, [item('attendance.on_behalf', ob({ kind: 'check_out', selfie_media_id: await selfie(otherPm) }))])
    expect(no!.errors[0]!.code).toBe('FORBIDDEN')
    // T10 correction of the site check-in by the team PM; he reads it back (collection rule through the attendance)
    const id = Number(r!.server_id)
    const t = new Date(Date.now() - 60_000).toISOString()
    const c = await api('POST', `/api/v1/attendance/${id}/correct`, w.users.pm, { new_time: t, reason: 'Jam HP salah (uji site)' }, { 'Idempotency-Key': randomUUID() })
    expect(c.status, JSON.stringify(c.body)).toBe(201)
    const list = await api('GET', `/api/attendance-corrections?where[attendance][equals]=${id}`, w.users.pm)
    expect((list.body as { totalDocs: number }).totalDocs).toBe(1)
    expect((await api('POST', `/api/v1/attendance/${id}/correct`, w.users.otherPm, { new_time: t, reason: 'bukan tim' }, { 'Idempotency-Key': randomUUID() })).status).toBe(404)
  })

  it('PM on-behalf via a pm-role site assignment', async () => {
    const otherPmEmp = await sysCreate('employees', { code: 'sit-OPM', name: 'sit PM lain' })
    const p = await getTestPayload()
    await p.update({ collection: 'company-memberships', where: { user: { equals: w.users.otherPm.id } }, data: { employee: otherPmEmp } as never, overrideAccess: true })
    await sysCreate('team-assignments', { employee: otherPmEmp, site: siteA, roleInProject: 'pm' })
    const m = await mobile(w.users.otherPm, ['pk-pm'])
    const [r] = await sync(m, [item('attendance.on_behalf', { employee_id: w.emp.noAccount, kind: 'check_out', site_id: siteA, ...at(BRANCH), camera_lens: 'back', reason: 'Pulang dicatat PM cabang', selfie_media_id: await selfie(m) })])
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'applied' })
  })

  it('schedule resolution: own → home site → PT default', async () => {
    await updateCompany({ defaultWorkSchedule: ptSchedule })
    const p = await getTestPayload()
    const name = async (emp: number) => (await asUser(null, (req) => scheduleOfEmployee(req, emp)))?.name ?? null
    expect(await name(w.emp.a)).toBe('sit Cabang 07-16') // home site
    expect(await name(w.emp.b)).toBe('sit Pusat 08-17') // no home site → PT default
    await p.update({ collection: 'employees', id: w.emp.a, data: { workSchedule: ptSchedule }, overrideAccess: true })
    expect(await name(w.emp.a)).toBe('sit Pusat 08-17') // own
    await p.update({ collection: 'employees', id: w.emp.a, data: { workSchedule: null }, overrideAccess: true })
    await updateCompany({ defaultWorkSchedule: null })
  })
})

describe('locations API (masters / sites / projects / me)', () => {
  it('GET /sites: flags home / assigned / team per caller; ?company narrows to selected PTs', async () => {
    const asA = await api('GET', '/api/v1/sites', w.users.staffA)
    expect(asA.status).toBe(200)
    const a = (asA.body as { docs: Array<{ id: number; home: boolean; assigned: boolean; team: boolean; radiusM: number | null }> }).docs.find((d) => d.id === siteA)!
    expect(a).toMatchObject({ home: true, assigned: false, team: false, radiusM: 120 })
    const asB = (await api('GET', '/api/v1/sites', w.users.staffB)).body as { docs: Array<{ id: number; home: boolean; assigned: boolean }> }
    expect(asB.docs.find((d) => d.id === siteA)).toMatchObject({ home: false, assigned: true })
    const asPm = (await api('GET', '/api/v1/sites', w.users.pm)).body as { docs: Array<{ id: number; team: boolean }> }
    expect(asPm.docs.find((d) => d.id === siteA)?.team).toBe(true)
    expect(asPm.docs.map((d) => d.id)).not.toContain(siteForeign)
  })

  it('GET /masters?types=sites,projects,employees,team-assignments carries the site fields', async () => {
    const r = await http('GET', '/api/v1/masters?types=sites,projects,employees,team-assignments', { headers: headers(staffA) })
    expect(r.status).toBe(200)
    const t = (r.body as { types: Record<string, { items: Array<Record<string, unknown>> }> }).types
    expect(t.sites!.items.find((i) => i.id === siteA)).toMatchObject({ code: 'sit-BPN', home: true, assigned: false, lat: BRANCH.lat, radiusM: 120, costCenter: siteCc })
    expect(t.projects!.items.find((i) => i.id === w.project)).toMatchObject({ site: siteA })
  })

  it('GET /projects?site= narrows; project detail and /me carry the site', async () => {
    const list = await api('GET', `/api/v1/projects?site=${siteA}&limit=50`, w.users.owner)
    const docs = (list.body as { docs: Array<{ id: number; site: { id: number } | null }> }).docs
    expect(docs.map((d) => d.id)).toEqual([w.project])
    expect(docs[0]!.site).toMatchObject({ id: siteA, code: 'sit-BPN' })
    const det = await api('GET', `/api/v1/projects/${w.project}`, w.users.pm)
    expect((det.body as { site: unknown }).site).toMatchObject({ id: siteA, name: 'sit Cabang Balikpapan' })
    const me = await api('GET', '/api/v1/me', w.users.staffA)
    expect((me.body as { employee: { homeSite: unknown } }).employee.homeSite).toMatchObject({ id: siteA, code: 'sit-BPN' })
  })
})

describe('site filter only narrows (ADR 0023 §5)', () => {
  it('office scope narrowed to the site: only the site\'s projects; PM with a site filter still only team projects', async () => {
    const office = narrowToSite(await asUser(w.users.owner, (req) => officeScope(req)), siteA)
    const ids = await asUser(w.users.owner, async (req) => (await rows(req, sql`SELECT p.id FROM projects p WHERE ${projectScopeSql(office)} ORDER BY p.id`)).map((r) => Number(r.id)))
    expect(ids).toEqual([w.project])
    // otherPm: team = otherProject + plainProject (no site) → with the site filter nothing
    const unfiltered = await asUser(w.users.otherPm, (req) => teamScope(req))
    expect(unfiltered.kind === 'team' && unfiltered.projects).toEqual(expect.arrayContaining([w.otherProject, plainProject]))
    const team = narrowToSite(unfiltered, siteA)
    const teamIds = await asUser(w.users.otherPm, async (req) => (await rows(req, sql`SELECT p.id FROM projects p WHERE ${projectScopeSql(team)}`)).map((r) => Number(r.id)))
    expect(teamIds).toEqual([])
    const reqIds = await asUser(w.users.otherPm, async (req) => rows(req, sql`SELECT er.id FROM expense_requests er WHERE ${requestScopeSql(team)}`))
    expect(reqIds).toEqual([])
    // a site of another PT matches nothing (never widens to that PT)
    const foreign = narrowToSite(await asUser(w.users.owner, (req) => officeScope(req)), siteForeign)
    expect(await asUser(w.users.owner, async (req) => rows(req, sql`SELECT p.id FROM projects p WHERE ${projectScopeSql(foreign)}`))).toEqual([])
  })

  it('reports: anggaran-project / rekap-kas / absensi with ?site=; the filter field lists the PT sites', async () => {
    const budget = await api('GET', `/api/v1/reports/anggaran-project?site=${siteA}`, w.users.owner)
    expect(budget.status, JSON.stringify(budget.body)).toBe(200)
    const projects = (budget.body as { main: { rows: Array<{ project?: string }> } }).main.rows
    expect(projects.length).toBe(1)
    const kas = await api('GET', `/api/v1/reports/rekap-kas?site=${siteA}`, w.users.finance)
    expect(kas.status).toBe(200)
    const saldo = (kas.body as { extra: Array<{ key: string; rows: Array<{ akun: string; saldo: number }> }> }).extra.find((t) => t.key === 'saldo')!
    expect(saldo.rows.map((r) => r.akun)).toEqual(['sit Kas Kecil Cabang'])
    const abs = await api('GET', `/api/v1/reports/absensi?site=${siteA}`, w.users.admin)
    expect(abs.status).toBe(200)
    const names = (abs.body as { main: { rows: Array<{ karyawan: string }> } }).main.rows.map((r) => r.karyawan)
    expect(names.some((n) => n.startsWith('sit Staff A'))).toBe(true) // home site employee
    expect(names.some((n) => n.startsWith('sit Staff B'))).toBe(true) // site assignment
    const pmAbs = await api('GET', `/api/v1/reports/absensi?site=${siteA}`, w.users.otherPm)
    expect(pmAbs.status).toBe(200)
  })

  it('dashboards: owner per-site cash + summary; finance per-site cash; ?site narrows; bad site → 400', async () => {
    const o = await api('GET', '/api/v1/dashboard/owner', w.users.owner)
    expect(o.status).toBe(200)
    const sites = (o.body as { sites: { options: Array<{ id: number }>; cash: Array<{ siteId: number | null; balance: number }>; summary: Array<{ siteId: number; projectsRunning: number }> } }).sites
    expect(sites.options.map((s) => s.id)).toEqual(expect.arrayContaining([siteA, siteB]))
    expect(sites.cash.find((c) => c.siteId === siteA)?.balance).toBe(2_500_000)
    expect(sites.cash.find((c) => c.siteId === null)).toBeTruthy() // "Tanpa site"
    expect(sites.summary.find((s) => s.siteId === siteA)?.projectsRunning).toBe(1)
    const f = await api('GET', `/api/v1/dashboard/finance?site=${siteA}`, w.users.finance)
    expect(f.status).toBe(200)
    expect((f.body as { cashTotal: number; sites: { selected: number } }).sites.selected).toBe(siteA)
    expect((f.body as { cashTotal: number }).cashTotal).toBe(2_500_000)
    expect((await api('GET', '/api/v1/dashboard/finance?site=abc', w.users.finance)).status).toBe(400)
    const pmD = await api('GET', `/api/v1/dashboard/pm?site=${siteA}`, w.users.otherPm)
    expect(pmD.status).toBe(200)
    expect((pmD.body as { projects: unknown[] }).projects).toEqual([])
  })

  it('team today narrowed by site_id lists home-site + site-assigned members', async () => {
    const r = await api('GET', `/api/v1/attendance/team-today?site_id=${siteA}`, w.users.admin)
    expect(r.status).toBe(200)
    const ids = (r.body as { members: Array<{ employee: { id: number } }> }).members.map((m) => m.employee.id)
    expect(ids).toEqual(expect.arrayContaining([w.emp.a, w.emp.b, w.emp.noAccount]))
  })

  it('cash balances API ?site= returns only the site accounts', async () => {
    const r = await api('GET', `/api/v1/cash-accounts/balances?site=${siteA}`, w.users.finance)
    expect(r.status).toBe(200)
    expect((r.body as { items: Array<{ cashAccountId: number; siteId: number }> }).items).toEqual([expect.objectContaining({ cashAccountId: siteAccount, siteId: siteA })])
  })
})

describe('transfer Pusat Biaya (ADR 0031 replaces the ADR 0023 §1 cost-center default)', () => {
  it('the Pusat Biaya of a request is its project\'s cash account; none without a mapping', async () => {
    const proj = await sysCreate('projects', { code: 'sit-P4', name: 'sit Cabang tanpa PB', pm: w.users.pm.id, status: 'berjalan', site: siteA, cashAccount: null })
    expect((await asUser(null, (req) => requestPusatBiaya(req, { project: w.project })))?.id).toBe(w.cashAccount)
    expect(await asUser(null, (req) => requestPusatBiaya(req, { project: proj }))).toBeNull()
    expect(await asUser(null, (req) => requestPusatBiaya(req, {}))).toBeNull()
  })
})
