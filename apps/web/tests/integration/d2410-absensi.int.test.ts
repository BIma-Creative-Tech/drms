import { randomUUID } from 'node:crypto'

import { PgDialect } from 'drizzle-orm/pg-core'
import pg from 'pg'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetAppConfigCache } from '@/api/v1/endpoints/app'
import { resetRateLimits } from '@/lib/rate-limit'
import { down as siteAssignmentsDown, up as siteAssignmentsUp } from '@/migrations/20261024_200000_d2410_site_assignments'

import { accessToken, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, type TestUser, updateCompany } from './helpers'
import { api, makeFlowUser, makeWorld, sysCreate, upload, type FlowUser, type World } from './flow-world'

/**
 * ADR 0032 (DRMS 24/10, user decisions) through the real DB + API:
 * 1. sites removed — the data migration turns site team assignments into assignments of the site's active projects
 *    (one project, two projects) or ends a running one without a project (an ended one is kept); audited, idempotent,
 *    reversible; no new site assignment over HTTP; /api/v1/sites and masters `sites` still answer (empty / tombstones);
 *    a site check-in of an old APK is refused for OnSite;
 * 2. role Admin Staff — reads the PT's attendance, team today, employees (not bank accounts, no finance); on-behalf
 *    options (employees incl. those without an account, locations); web on-behalf (source admin, recorder, reason,
 *    employee without account; own employee / no reason / no role refused); APK sync on-behalf; corrections.
 * Coordinates, names and codes are fictional. syncAttendanceEnabled is switched ON for this file and OFF afterwards.
 */
let w: World
let tag = ''
const PRJ = { lat: -3.11, lng: 115.11 }
let adminStaff: FlowUser
let adminStaffEmp = 0
const site: Record<'one' | 'two' | 'none', number> = { one: 0, two: 0, none: 0 }
const prj: Record<'one' | 'twoA' | 'twoB' | 'done', number> = { one: 0, twoA: 0, twoB: 0, done: 0 }
const asg: Record<'one' | 'two' | 'running' | 'ended', number> = { one: 0, two: 0, running: 0, ended: 0 }
const emp: Record<'one' | 'two' | 'none', number> = { one: 0, two: 0, none: 0 }

type Mobile = { user: FlowUser; token: string; device: string }

async function mobile(user: FlowUser): Promise<Mobile> {
  const p = await getTestPayload()
  const doc = await p.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
  const t: TestUser = { ...user, keycloakSub: doc.keycloakSub as string }
  const token = await accessToken(t, ['pk-user'])
  return { user, token, device: await registerDevice(t, token) }
}
const headers = (m: Mobile) => ({ Authorization: `Bearer ${m.token}`, 'X-Device-Id': m.device, 'X-App-Version': '1.0.0' })

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 640, height: 800, channels: 3, background: { r: Math.floor(Math.random() * 255), g: 110, b: 70 } } }).jpeg().toBuffer()
}

async function selfie(user: FlowUser): Promise<number> {
  const r = await upload('/api/v1/media/selfies', user, await jpeg(), 'image/jpeg')
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return (r.body as { id: number }).id
}

async function mobileSelfie(m: Mobile): Promise<number> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(await jpeg())], { type: 'image/jpeg' }), 'selfie.jpg')
  const { handleEndpoints } = await import('payload')
  const config = (await import('@payload-config')).default
  const res = await handleEndpoints({ config, request: new Request('http://localhost:3000/api/v1/media/selfies', { method: 'POST', headers: headers(m), body: form }) })
  const body = (await res.json()) as { id: number }
  expect(res.status, JSON.stringify(body)).toBe(201)
  return body.id
}

async function sync(m: Mobile, items: Array<Record<string, unknown>>) {
  resetRateLimits()
  const now = Date.now()
  const clock = { device_time: new Date(now).toISOString(), elapsed_ms: 10_000_000, boot_id: 'boot-d24', last_server_time: new Date(now - 60_000).toISOString(), last_server_elapsed_ms: 10_000_000 - 60_000 }
  const r = await http('POST', '/api/v1/sync/batch', { headers: headers(m), json: { batch_id: randomUUID(), device_id: m.device, clock, items } })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return (r.body as { results: Array<{ status: string; server_id: string | null; errors: Array<{ code: string; message: string }> }> }).results
}
const item = (type: string, payload: Record<string, unknown>) => ({ client_uuid: randomUUID(), type, schema_version: 1, offline: false, device_time: new Date().toISOString(), elapsed_ms: 10_000_000, payload })

/** `payload migrate` style: one owner connection + transaction (drizzle SQL rendered by the pg dialect), committed. */
async function asOwner(fn: (db: { execute: (q: unknown) => Promise<unknown> }) => Promise<void>): Promise<void> {
  const c = new pg.Client({ connectionString: process.env.PK_TEST_DATABASE_URL_OWNER })
  await c.connect()
  const dialect = new PgDialect()
  const db = {
    execute: async (q: unknown) => {
      const x = dialect.sqlToQuery(q as never)
      return c.query(x.sql, x.params as unknown[])
    },
  }
  try {
    await c.query('BEGIN')
    await fn(db)
    await c.query('COMMIT')
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    await c.end()
  }
}
const migrateUp = () => asOwner((db) => siteAssignmentsUp({ db, payload: undefined } as never))
const migrateDown = () => asOwner((db) => siteAssignmentsDown({ db, payload: undefined } as never))

const rowOf = async (id: number) => (await sqlAs('app', 'SELECT id, employee_id, project_id, site_id, role_in_project::text AS role, start_date, end_date FROM team_assignments WHERE id = $1', [id])).rows[0]
const rowsOfEmployee = async (e: number) => (await sqlAs('app', 'SELECT id, project_id, site_id, role_in_project::text AS role, start_date, end_date FROM team_assignments WHERE employee_id = $1 ORDER BY id', [e])).rows

async function setAttendance(enabled: boolean) {
  await updateCompany({ syncAttendanceEnabled: enabled })
  resetAppConfigCache()
}

beforeAll(async () => {
  installLocalJwks()
  tag = `d24${Date.now() % 100000}`
  w = await makeWorld(tag)
  const p = await getTestPayload()
  await p.update({ collection: 'projects', id: w.project, data: { lat: PRJ.lat, lng: PRJ.lng, radiusM: 100 }, overrideAccess: true /* SYSTEM-WRITE: fixture geofence */ })
  // legacy sites (system writes: the master is hidden and closed for HTTP since ADR 0032)
  site.one = await sysCreate('sites', { code: `${tag}-S1`, name: `${tag} Cabang satu` })
  site.two = await sysCreate('sites', { code: `${tag}-S2`, name: `${tag} Cabang dua` })
  site.none = await sysCreate('sites', { code: `${tag}-S0`, name: `${tag} Cabang tanpa project` })
  prj.one = await sysCreate('projects', { code: `${tag}-A1`, name: `${tag} Proyek site satu`, pm: w.users.pm.id, status: 'berjalan', site: site.one })
  prj.twoA = await sysCreate('projects', { code: `${tag}-B1`, name: `${tag} Proyek site dua A`, pm: w.users.pm.id, status: 'berjalan', site: site.two })
  prj.twoB = await sysCreate('projects', { code: `${tag}-B2`, name: `${tag} Proyek site dua B`, pm: w.users.pm.id, status: 'perencanaan', site: site.two })
  // a finished project of the third site does not count
  prj.done = await sysCreate('projects', { code: `${tag}-C1`, name: `${tag} Proyek selesai`, pm: w.users.pm.id, status: 'selesai', site: site.none })
  emp.one = await sysCreate('employees', { code: `${tag}-E1`, name: `${tag} Karyawan satu` })
  emp.two = await sysCreate('employees', { code: `${tag}-E2`, name: `${tag} Karyawan dua` })
  emp.none = await sysCreate('employees', { code: `${tag}-E0`, name: `${tag} Karyawan tanpa project` })
  asg.one = await sysCreate('team-assignments', { employee: emp.one, site: site.one, roleInProject: 'staff', startDate: '2026-10-01T00:00:00.000Z' })
  asg.two = await sysCreate('team-assignments', { employee: emp.two, site: site.two, roleInProject: 'mandor', startDate: '2026-10-02T00:00:00.000Z', endDate: '2027-01-31T00:00:00.000Z' })
  asg.running = await sysCreate('team-assignments', { employee: emp.none, site: site.none, roleInProject: 'staff', startDate: '2026-09-01T00:00:00.000Z' })
  asg.ended = await sysCreate('team-assignments', { employee: emp.none, site: site.none, roleInProject: 'pm', startDate: '2026-08-01T00:00:00.000Z', endDate: '2026-08-31T00:00:00.000Z' })

  adminStaffEmp = await sysCreate('employees', { code: `${tag}-ADS`, name: `${tag} Admin Staff` })
  adminStaff = await makeFlowUser(['pk-admin-staff'], `${tag}-admin-staff`, adminStaffEmp)
  await setAttendance(true)
})

afterAll(async () => {
  await setAttendance(false)
})

describe('ADR 0032 §3: site team assignments → project assignments (migration 20261024_200000)', () => {
  it('one project → the row becomes that project; two → the row + one new row; none → a running row ends, an ended row stays', async () => {
    await migrateUp()
    expect(await rowOf(asg.one)).toMatchObject({ project_id: prj.one, site_id: null, role: 'staff' })
    const two = await rowsOfEmployee(emp.two)
    expect(two.map((r) => [r.project_id, r.site_id, r.role])).toEqual([
      [prj.twoA, null, 'mandor'],
      [prj.twoB, null, 'mandor'],
    ])
    // same period on the added row
    expect(new Date(two[1].start_date).toISOString()).toBe(new Date(two[0].start_date).toISOString())
    expect(new Date(two[1].end_date).toISOString()).toBe('2027-01-31T00:00:00.000Z')
    const running = await rowOf(asg.running)
    expect(running).toMatchObject({ site_id: site.none, project_id: null })
    expect(running.end_date).not.toBeNull()
    expect(Math.abs(new Date(running.end_date).getTime() - Date.now())).toBeLessThan(10 * 60_000)
    const ended = await rowOf(asg.ended)
    expect(new Date(ended.end_date).toISOString()).toBe('2026-08-31T00:00:00.000Z')
  })

  it('every change is audited (source system, old → new); nothing for the kept row', async () => {
    const audit = (await sqlAs('owner', "SELECT doc_id, action::text AS action, field, old_value, new_value, source::text AS source FROM audit_logs WHERE doc_type = 'team_assignment' AND new_value -> 'v' ->> 'migration' = '20261024_200000_d2410_site_assignments' AND doc_id = ANY($1::text[]) ORDER BY id", [[asg.one, asg.two, asg.running, asg.ended].map(String)])).rows
    expect(audit.map((a) => [Number(a.doc_id), a.action, a.field, a.source])).toEqual([
      [asg.one, 'update', 'project', 'system'],
      [asg.two, 'update', 'project', 'system'],
      [asg.running, 'update', 'endDate', 'system'],
    ])
    expect(audit[0].old_value).toMatchObject({ v: { siteId: site.one, projectId: null } })
    expect(audit[0].new_value).toMatchObject({ v: { siteId: null, projectId: prj.one } })
    const added = (await rowsOfEmployee(emp.two))[1]
    const create = (await sqlAs('owner', "SELECT action::text AS action, source::text AS source, new_value FROM audit_logs WHERE doc_type = 'team_assignment' AND doc_id = $1", [String(added.id)])).rows
    expect(create).toEqual([expect.objectContaining({ action: 'create', source: 'system' })])
    expect(create[0].new_value).toMatchObject({ v: { fromAssignment: asg.two, projectId: prj.twoB } })
  })

  it('idempotent (a second run changes nothing); down() restores the site rows from the audit', async () => {
    const before = [await rowsOfEmployee(emp.one), await rowsOfEmployee(emp.two), await rowsOfEmployee(emp.none)]
    await migrateUp()
    expect([await rowsOfEmployee(emp.one), await rowsOfEmployee(emp.two), await rowsOfEmployee(emp.none)]).toEqual(before)
    await migrateDown()
    expect(await rowOf(asg.one)).toMatchObject({ project_id: null, site_id: site.one })
    expect((await rowsOfEmployee(emp.two)).map((r) => [r.project_id, r.site_id])).toEqual([[null, site.two]])
    expect((await rowOf(asg.running)).end_date).toBeNull()
    // and up again (the state the rest of the file sees)
    await migrateUp()
    expect(await rowOf(asg.one)).toMatchObject({ project_id: prj.one, site_id: null })
  })

  it('no new site assignment over HTTP; a project / cost-center assignment still works', async () => {
    const r = await api('POST', '/api/team-assignments', w.users.admin, { employee: emp.one, site: site.one, roleInProject: 'staff' })
    expect(r.status, JSON.stringify(r.body)).toBe(400)
    const n = (await sqlAs('app', 'SELECT count(*)::int AS n FROM team_assignments WHERE employee_id = $1 AND site_id IS NOT NULL', [emp.one])).rows[0].n
    expect(n).toBe(0)
    const ok = await api('POST', '/api/team-assignments', w.users.admin, { employee: emp.one, costCenter: w.costCenter, roleInProject: 'staff' })
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
  })
})

describe('ADR 0032 §1: sites stay answerable for APK ≤ 0.11.1', () => {
  it('GET /api/v1/sites → empty list; masters `sites`: empty full read, tombstones on a delta read', async () => {
    resetRateLimits()
    const sites = await api('GET', '/api/v1/sites', w.users.staffA)
    expect(sites.status, JSON.stringify(sites.body)).toBe(200)
    expect(sites.body).toEqual({ docs: [], totalDocs: 0 })
    const full = await api('GET', '/api/v1/masters?types=sites', w.users.staffA)
    expect(full.status, JSON.stringify(full.body)).toBe(200)
    expect((full.body as { types: { sites: { items: unknown[] } } }).types.sites.items).toEqual([])
    const delta = await api('GET', `/api/v1/masters?types=sites&since=${encodeURIComponent('2020-01-01T00:00:00.000Z')}`, w.users.staffA)
    const items = (delta.body as { types: { sites: { items: Array<{ id: number; deleted?: boolean; active?: boolean; lat?: unknown }> } } }).types.sites.items
    expect(items.find((i) => i.id === site.one)).toMatchObject({ deleted: true, active: false })
    expect(items.every((i) => i.deleted === true && i.lat === undefined)).toBe(true)
  })

  it('/me has no homeSite; projects carry no site; the Site master cannot be created', async () => {
    resetRateLimits()
    const me = await api('GET', '/api/v1/me', w.users.staffA)
    expect(JSON.stringify(me.body)).not.toContain('homeSite')
    const list = await api('GET', '/api/v1/projects?limit=100', w.users.owner)
    expect((list.body as { docs: Array<Record<string, unknown>> }).docs.every((d) => !('site' in d))).toBe(true)
    const create = await api('POST', '/api/sites', w.users.admin, { code: `${tag}-SX`, name: 'Baru' })
    expect(create.status).toBe(403)
  })

  it('an old APK sending site_id: OnSite → rejected VALIDATION (site is no longer a location)', async () => {
    const staff = await mobile(w.users.staffA)
    const r = await sync(staff, [item('attendance.check_in', { site_id: site.one, ...PRJ, accuracy_m: 8, is_mocked: false, selfie_media_id: await mobileSelfie(staff) })])
    expect(r[0]).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'VALIDATION', message: expect.stringContaining('Site tidak lagi dipakai') })] })
  })
})

describe('ADR 0032 §5: role Admin Staff', () => {
  it('reads the attendance and employees of its PT, not bank accounts / requests / cash', async () => {
    resetRateLimits()
    expect((await api('GET', '/api/attendances?limit=1', adminStaff)).status).toBe(200)
    const emps = await api('GET', '/api/employees?limit=500&depth=0', adminStaff)
    expect(emps.status).toBe(200)
    expect((emps.body as { docs: Array<{ id: number }> }).docs.map((d) => d.id)).toEqual(expect.arrayContaining([w.emp.noAccount, w.emp.a]))
    for (const c of ['employee-bank-accounts', 'expense-requests', 'cash-entries', 'cash-accounts', 'team-assignments']) {
      expect((await api('GET', `/api/${c}?limit=1`, adminStaff)).status, c).toBe(403)
    }
    expect((await api('POST', '/api/expense-requests', adminStaff, { title: 'x' })).status).toBe(403)
    const team = await api('GET', '/api/v1/attendance/team-today', adminStaff)
    expect(team.status, JSON.stringify(team.body)).toBe(200)
    expect((team.body as { scope: string }).scope).toBe('all')
    const me = await api('GET', '/api/v1/me', adminStaff)
    expect((me.body as { companies: Array<{ roles: string[]; capabilities: { attendanceOnBehalf: boolean; attendanceAdminStaff: boolean } }> }).companies[0]).toMatchObject({
      roles: ['pk-admin-staff'],
      capabilities: { attendanceOnBehalf: true, attendanceAdminStaff: true },
    })
  })

  it('on-behalf options: active employees of the PT (own excluded, without account flagged) + registered locations', async () => {
    resetRateLimits()
    const r = await api('GET', '/api/v1/attendance/on-behalf/options', adminStaff)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    const body = r.body as { companies: Array<{ id: number; attendanceEnabled: boolean }>; employees: Array<{ id: number; hasAccount: boolean }>; locations: Array<{ kind: string; id: number }> }
    expect(body.companies).toEqual([expect.objectContaining({ attendanceEnabled: true })])
    expect(body.employees.find((e) => e.id === w.emp.noAccount)).toMatchObject({ hasAccount: false })
    expect(body.employees.find((e) => e.id === w.emp.a)).toMatchObject({ hasAccount: true })
    expect(body.employees.some((e) => e.id === adminStaffEmp)).toBe(false)
    expect(body.locations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'project', id: w.project })]))
    // other roles: 403
    expect((await api('GET', '/api/v1/attendance/on-behalf/options', w.users.pm)).status).toBe(403)
  })

  it('web on-behalf for an employee WITHOUT an account → 201, source admin, recorder + reason; recap says "diabsenkan"', async () => {
    resetRateLimits()
    const r = await api('POST', '/api/v1/attendance/on-behalf', adminStaff, {
      employee_id: w.emp.noAccount,
      kind: 'check_in',
      project_id: w.project,
      ...PRJ,
      accuracy_m: 8,
      selfie_media_id: await selfie(adminStaff),
      reason: 'tukang harian tanpa HP',
    })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const row = (await sqlAs('app', 'SELECT employee_id, user_id, source::text AS source, recorded_by_id, on_behalf_reason, project_id FROM attendances WHERE id = $1', [(r.body as { id: number }).id])).rows[0]
    expect(row).toEqual({ employee_id: w.emp.noAccount, user_id: null, source: 'admin', recorded_by_id: adminStaff.id, on_behalf_reason: 'tukang harian tanpa HP', project_id: w.project })
    resetRateLimits()
    const recap = await api('GET', `/api/v1/attendance/recap?employee_id=${w.emp.noAccount}`, adminStaff)
    expect(recap.status, JSON.stringify(recap.body)).toBe(200)
    const day = (recap.body as { days: Array<{ onBehalf: boolean; onBehalfBy: string[] }> }).days.find((d) => d.onBehalf)
    expect(day?.onBehalfBy).toEqual([expect.stringContaining(tag)])
  })

  it('refused: own employee (403), no reason (400), outside the location (409), a PM / staff caller (403)', async () => {
    resetRateLimits()
    const base = { kind: 'check_in', project_id: w.project, ...PRJ, accuracy_m: 8, reason: 'uji penolakan' }
    const own = await api('POST', '/api/v1/attendance/on-behalf', adminStaff, { ...base, employee_id: adminStaffEmp, selfie_media_id: await selfie(adminStaff) })
    expect(own.status, JSON.stringify(own.body)).toBe(403)
    const noReason = await api('POST', '/api/v1/attendance/on-behalf', adminStaff, { ...base, reason: undefined, employee_id: w.emp.b, selfie_media_id: await selfie(adminStaff) })
    expect(noReason.status).toBe(400)
    const far = await api('POST', '/api/v1/attendance/on-behalf', adminStaff, { ...base, lat: PRJ.lat + 0.2, employee_id: w.emp.b, selfie_media_id: await selfie(adminStaff) })
    expect((far.body as { code?: string }).code).toBe('OUTSIDE_GEOFENCE')
    for (const u of [w.users.pm, w.users.staffA]) {
      expect((await api('POST', '/api/v1/attendance/on-behalf', u, { ...base, employee_id: w.emp.b, selfie_media_id: 1 })).status).toBe(403)
    }
  })

  it('APK sync attendance.on_behalf by the Admin Staff → applied with source admin (employee not in any team)', async () => {
    const m = await mobile(adminStaff)
    const r = await sync(m, [item('attendance.on_behalf', { employee_id: w.emp.b, kind: 'check_in', project_id: w.project, ...PRJ, accuracy_m: 8, is_mocked: false, selfie_media_id: await mobileSelfie(m), camera_lens: 'back', reason: 'HP rusak' })])
    expect(r[0], JSON.stringify(r[0])).toMatchObject({ status: 'applied' })
    const row = (await sqlAs('app', 'SELECT source::text AS source, recorded_by_id, employee_id FROM attendances WHERE id = $1', [Number(r[0]!.server_id)])).rows[0]
    expect(row).toEqual({ source: 'admin', recorded_by_id: adminStaff.id, employee_id: w.emp.b })
  })

  it('corrects the attendance of the PT with a reason (never its own)', async () => {
    const att = (await sqlAs('app', "SELECT id, attendance_time FROM attendances WHERE employee_id = $1 AND source = 'admin' ORDER BY id DESC LIMIT 1", [w.emp.b])).rows[0]
    const newTime = new Date(new Date(att.attendance_time).getTime() - 5 * 60_000).toISOString()
    resetRateLimits()
    const r = await api('POST', `/api/v1/attendance/${att.id}/correct`, adminStaff, { new_time: newTime, reason: 'jam HP salah' }, { 'Idempotency-Key': randomUUID() })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const c = (await sqlAs('app', 'SELECT corrected_by_id, reason FROM attendance_corrections WHERE id = $1', [(r.body as { id: number }).id])).rows[0]
    expect(c).toEqual({ corrected_by_id: adminStaff.id, reason: 'jam HP salah' })
  })
})
