import { randomUUID } from 'node:crypto'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetAppConfigCache } from '@/api/v1/endpoints/app'
import { selfieRetentionPlan } from '@/domain/attendance/retention'
import { resetRateLimits } from '@/lib/rate-limit'

import { accessToken, auditRows, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, sqlError, type TestUser } from './helpers'
import { api, makeWorld, sysCreate, type FlowUser, type World } from './flow-world'

/**
 * E6 — absensi lengkap (plan fase1-golive E6): cost-center geofence (Q-40), "diabsenkan PM" (US-14),
 * T10 correction (US-15), monthly recap (US-09) + report reconciled with SQL (M13), team today
 * (US-13), selfie viewer (Q-33), retention plan. syncAttendanceEnabled is switched ON for this file
 * and OFF again afterwards. Coordinates, names and dates are fictional.
 */
let w: World
type Mobile = { user: FlowUser; token: string; device: string }
let staffA: Mobile
let staffB: Mobile
let pm: Mobile
let otherPm: Mobile
const SITE = { lat: -2.21, lng: 113.91 }
const OPS = { lat: -2.5, lng: 114.2 }
let noGeoCc: number
let unassignedCc: number
let schedule: number
const TZ = 'Asia/Makassar'
const MONTH = '2026-08' // fully in the past (fixture rows below)
const HOLIDAY = '2026-08-17'

async function mobile(user: FlowUser, roles: string[]): Promise<Mobile> {
  const p = await getTestPayload()
  const doc = await p.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
  const t: TestUser = { ...user, keycloakSub: doc.keycloakSub as string }
  const token = await accessToken(t, roles)
  return { user, token, device: await registerDevice(t, token) }
}
const headers = (m: Mobile) => ({ Authorization: `Bearer ${m.token}`, 'X-Device-Id': m.device, 'X-App-Version': '1.0.0' })

async function jpeg(seed: number): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: seed % 255, g: 100, b: 60 } } }).jpeg().toBuffer()
}

async function selfie(m: Mobile): Promise<number> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(await jpeg(Math.floor(Math.random() * 255)))], { type: 'image/jpeg' }), 'selfie.jpg')
  const { handleEndpoints } = await import('payload')
  const config = (await import('@payload-config')).default
  const res = await handleEndpoints({ config, request: new Request('http://localhost:3000/api/v1/media/selfies', { method: 'POST', headers: headers(m), body: form }) })
  const body = (await res.json()) as { id: number }
  expect(res.status, JSON.stringify(body)).toBe(201)
  return body.id
}

function item(type: string, payload: Record<string, unknown>) {
  return { client_uuid: randomUUID(), type, schema_version: 1, offline: false, device_time: new Date().toISOString(), elapsed_ms: 10_000_000, payload }
}

async function sync(m: Mobile, items: Array<Record<string, unknown>>) {
  resetRateLimits()
  const now = Date.now()
  const clock = { device_time: new Date(now).toISOString(), elapsed_ms: 10_000_000, boot_id: 'boot-1', last_server_time: new Date(now - 60_000).toISOString(), last_server_elapsed_ms: 10_000_000 - 60_000 }
  const r = await http('POST', '/api/v1/sync/batch', { headers: headers(m), json: { batch_id: randomUUID(), device_id: m.device, clock, items } })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return (r.body as { results: Array<{ status: string; server_id: string | null; errors: Array<{ code: string; message: string; field?: string }> }> }).results
}

const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+08:00`).toISOString()

/** Past-month fixture row (the sync path always stamps "now"); written as the APP role like the service. */
async function fixtureRow(employee: number, user: number, kind: 'check_in' | 'check_out', date: string, hhmm: string, selfieId: number): Promise<number> {
  const r = await sqlAs(
    'app',
    `INSERT INTO attendances (employee_id, user_id, kind, project_id, local_date, attendance_time, received_at, time_trust, offline, lat, lng, distance_m, selfie_id, client_uuid, source, updated_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), 'server', false, $7, $8, 10, $9, $10, 'self', now(), now()) RETURNING id`,
    [employee, user, kind, w.project, date, at(date, hhmm), SITE.lat, SITE.lng, selfieId, randomUUID()],
  )
  return r.rows[0].id as number
}

async function setAttendance(enabled: boolean) {
  const p = await getTestPayload()
  await p.updateGlobal({ slug: 'company-settings', data: { syncAttendanceEnabled: enabled }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  resetAppConfigCache()
}

const fixture: Record<string, number> = {}

beforeAll(async () => {
  installLocalJwks()
  w = await makeWorld('abs')
  const p = await getTestPayload()
  await p.update({ collection: 'projects', id: w.project, data: { lat: SITE.lat, lng: SITE.lng, radiusM: 100 }, overrideAccess: true /* SYSTEM-WRITE: fixture geofence */ })
  await p.update({ collection: 'projects', id: w.otherProject, data: { lat: SITE.lat, lng: SITE.lng, radiusM: 100 }, overrideAccess: true /* SYSTEM-WRITE: fixture geofence */ })
  await p.update({ collection: 'cost-centers', id: w.costCenter, data: { lat: OPS.lat, lng: OPS.lng, radiusM: 150 }, overrideAccess: true /* SYSTEM-WRITE: fixture geofence (Q-40) */ })
  noGeoCc = await sysCreate('cost-centers', { code: 'e6-CCNG', name: 'e6 Ops tanpa titik', manager: w.users.pm.id })
  unassignedCc = await sysCreate('cost-centers', { code: 'e6-CCUA', name: 'e6 Ops lain', manager: w.users.pm.id, lat: OPS.lat, lng: OPS.lng, radiusM: 150 })
  await sysCreate('team-assignments', { employee: w.emp.a, costCenter: noGeoCc, roleInProject: 'staff' })
  await sysCreate('team-assignments', { employee: w.emp.noAccount, project: w.project, roleInProject: 'staff' })
  // Q-30 schedule for staff B (fixture month) — own schedule, the company default stays empty.
  schedule = await sysCreate('work-schedules', { name: 'e6 Kantor 08-17', startTime: '08:00', endTime: '17:00', lateToleranceMin: 15, workDays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: false } })
  await p.update({ collection: 'employees', id: w.emp.b, data: { workSchedule: schedule }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  await sysCreate('holidays', { date: HOLIDAY, name: 'e6 Hari libur contoh' })

  staffA = await mobile(w.users.staffA, ['pk-staff'])
  staffB = await mobile(w.users.staffB, ['pk-staff'])
  pm = await mobile(w.users.pm, ['pk-pm'])
  otherPm = await mobile(w.users.otherPm, ['pk-pm'])

  const s = await selfie(staffB)
  const b = w.emp.b
  const ub = w.users.staffB.id
  fixture.in03 = await fixtureRow(b, ub, 'check_in', '2026-08-03', '08:10', s)
  fixture.out03 = await fixtureRow(b, ub, 'check_out', '2026-08-03', '17:00', s)
  fixture.in04 = await fixtureRow(b, ub, 'check_in', '2026-08-04', '08:40', s) // late 40
  fixture.out04 = await fixtureRow(b, ub, 'check_out', '2026-08-04', '16:00', s) // early 60
  fixture.in05 = await fixtureRow(b, ub, 'check_in', '2026-08-05', '08:00', s) // no check-out
  fixture.in09 = await fixtureRow(b, ub, 'check_in', '2026-08-09', '08:00', s) // Sunday
  fixture.out09 = await fixtureRow(b, ub, 'check_out', '2026-08-09', '10:00', s)
  fixture.in17 = await fixtureRow(b, ub, 'check_in', HOLIDAY, '09:00', s) // holiday
  fixture.out17 = await fixtureRow(b, ub, 'check_out', HOLIDAY, '12:00', s)
  await setAttendance(true)
})

afterAll(async () => {
  await setAttendance(false)
})

describe('cost-center geofence (Q-40) with syncAttendanceEnabled = true', () => {
  it('check-in at an assigned cost center inside the radius is applied; project_id stays empty', async () => {
    const [r] = await sync(staffA, [item('attendance.check_in', { cost_center_id: w.costCenter, lat: OPS.lat + 0.0005, lng: OPS.lng, accuracy_m: 10, is_mocked: false, selfie_media_id: await selfie(staffA) })])
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'applied' })
    const row = (await sqlAs('app', 'SELECT project_id, cost_center_id, source, recorded_by_id, user_id FROM attendances WHERE id = $1', [Number(r!.server_id)])).rows[0]
    expect(row).toMatchObject({ project_id: null, cost_center_id: w.costCenter, source: 'self', recorded_by_id: null, user_id: w.users.staffA.id })
    const dup = await sync(staffA, [item('attendance.check_in', { cost_center_id: w.costCenter, lat: OPS.lat, lng: OPS.lng, is_mocked: false, selfie_media_id: await selfie(staffA) })])
    expect(dup[0]!.errors[0]!.code).toBe('ALREADY_CHECKED_IN')
  })

  it('rejections carry the distance; no geofence / not assigned / both locations', async () => {
    const s = await selfie(staffA)
    const res = await sync(staffA, [
      item('attendance.check_in', { cost_center_id: w.costCenter, lat: OPS.lat + 0.01, lng: OPS.lng, accuracy_m: 5, is_mocked: false, selfie_media_id: s }),
      item('attendance.check_in', { cost_center_id: noGeoCc, lat: OPS.lat, lng: OPS.lng, is_mocked: false, selfie_media_id: s }),
      item('attendance.check_in', { cost_center_id: unassignedCc, lat: OPS.lat, lng: OPS.lng, is_mocked: false, selfie_media_id: s }),
      item('attendance.check_in', { project_id: w.project, cost_center_id: w.costCenter, lat: OPS.lat, lng: OPS.lng, is_mocked: false, selfie_media_id: s }),
    ])
    expect(res.map((r) => r.errors[0]?.code)).toEqual(['OUTSIDE_GEOFENCE', 'NO_GEOFENCE', 'NOT_ASSIGNED', 'VALIDATION'])
    expect(res[0]!.errors[0]!.message).toMatch(/Di luar radius pusat biaya \(\d+ m dari titik, radius 150 m\)/)
  })
})

describe('company default radius (S3e, US-01, S-19)', () => {
  it('a point without its own radius uses company-settings.defaultGeofenceRadiusM (server check + masters)', async () => {
    const p = await getTestPayload()
    const s = (await p.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })) as { defaultGeofenceRadiusM?: number }
    const def = s.defaultGeofenceRadiusM ?? 100
    const cc = await sysCreate('cost-centers', { code: 'e6-CCDR', name: 'e6 Ops radius default', manager: w.users.pm.id, lat: OPS.lat, lng: OPS.lng })
    await sysCreate('team-assignments', { employee: w.emp.a, costCenter: cc, roleInProject: 'staff' })
    const m = await api('GET', '/api/v1/masters?types=cost-centers', w.users.admin)
    expect(m.body.types['cost-centers'].items.find((x: { id: number }) => x.id === cc)).toMatchObject({ lat: OPS.lat, lng: OPS.lng, radiusM: def })
    const far = OPS.lat + (def + 80) / 111_000 // ≈ def + 80 m north
    const [out] = await sync(staffA, [item('attendance.check_in', { cost_center_id: cc, lat: far, lng: OPS.lng, accuracy_m: 10, is_mocked: false, selfie_media_id: await selfie(staffA) })])
    expect(out!.errors[0]!.code).toBe('OUTSIDE_GEOFENCE')
    expect(out!.errors[0]!.message).toContain(`radius ${def} m`)
    const near = OPS.lat + (def - 30) / 111_000
    const [ok] = await sync(staffA, [item('attendance.check_in', { cost_center_id: cc, lat: near, lng: OPS.lng, accuracy_m: 10, is_mocked: false, selfie_media_id: await selfie(staffA) })])
    expect(ok, JSON.stringify(ok)).toMatchObject({ status: 'applied' })
  })
})

describe('diabsenkan oleh PM (US-14)', () => {
  const ob = (over: Record<string, unknown>) => ({ employee_id: w.emp.noAccount, kind: 'check_in', project_id: w.project, lat: SITE.lat, lng: SITE.lng, accuracy_m: 8, is_mocked: false, camera_lens: 'back', reason: 'Tidak punya HP (Q-29)', ...over })

  it('PM records a check-in of a team member without an account: source pm, recorded_by, reason, audit', async () => {
    const [r] = await sync(pm, [item('attendance.on_behalf', ob({ selfie_media_id: await selfie(pm) }))])
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'applied' })
    const id = Number(r!.server_id)
    const row = (await sqlAs('app', 'SELECT employee_id, user_id, source, recorded_by_id, on_behalf_reason, kind FROM attendances WHERE id = $1', [id])).rows[0]
    expect(row).toEqual({ employee_id: w.emp.noAccount, user_id: null, source: 'pm', recorded_by_id: w.users.pm.id, on_behalf_reason: 'Tidak punya HP (Q-29)', kind: 'check_in' })
    const audit = await auditRows('attendance', id)
    expect(audit.filter((a) => a.action === 'create').map((a) => a.field)).toEqual(expect.arrayContaining(['source', 'recordedBy', 'onBehalfReason']))
    expect(audit.some((a) => a.action === 'sync_offline' && a.user_id === String(w.users.pm.id))).toBe(true)
    // check-out on behalf too; the recap shows "diabsenkan PM" with the PM name
    const [out] = await sync(pm, [item('attendance.on_behalf', ob({ kind: 'check_out', selfie_media_id: await selfie(pm) }))])
    expect(out!.status).toBe('applied')
  })

  it('authz negatives: staff, PM of another team, own attendance, unassigned employee, foreign selfie, mock, missing reason', async () => {
    const sPm = await selfie(pm)
    const sOther = await selfie(otherPm)
    const staffRes = await sync(staffA, [item('attendance.on_behalf', ob({ employee_id: w.emp.b, selfie_media_id: await selfie(staffA) }))])
    expect(staffRes[0]!.errors[0]).toMatchObject({ code: 'FORBIDDEN' })
    const otherRes = await sync(otherPm, [item('attendance.on_behalf', ob({ employee_id: w.emp.b, selfie_media_id: sOther }))])
    expect(otherRes[0]!.errors[0]).toMatchObject({ code: 'FORBIDDEN', message: 'Hanya untuk project tim Anda.' })
    const res = await sync(pm, [
      item('attendance.on_behalf', ob({ employee_id: w.emp.pm, selfie_media_id: sPm })),
      item('attendance.on_behalf', ob({ employee_id: w.emp.admin, selfie_media_id: sPm })),
      item('attendance.on_behalf', ob({ employee_id: w.emp.b, selfie_media_id: await selfie(staffA) })),
      item('attendance.on_behalf', ob({ employee_id: w.emp.b, is_mocked: true, selfie_media_id: sPm })),
      item('attendance.on_behalf', ob({ employee_id: w.emp.b, reason: '', selfie_media_id: sPm })),
      item('attendance.on_behalf', ob({ employee_id: w.emp.b, lat: SITE.lat + 0.01, selfie_media_id: sPm })),
    ])
    expect(res.map((r) => r.errors[0]?.code)).toEqual(['FORBIDDEN', 'NOT_ASSIGNED', 'FORBIDDEN', 'MOCK_LOCATION', 'VALIDATION', 'OUTSIDE_GEOFENCE'])
    expect(res.every((r) => r.status === 'rejected')).toBe(true)
    // nothing stored for B today
    const n = await sqlAs('app', "SELECT count(*)::int AS n FROM attendances WHERE employee_id = $1 AND source = 'pm'", [w.emp.b])
    expect(n.rows[0].n).toBe(0)
  })

  it('DB guards: a pm row needs recorded_by + reason; a self row needs the account; one location only', async () => {
    const s = await selfie(pm)
    const base = `INSERT INTO attendances (employee_id, user_id, kind, project_id, cost_center_id, local_date, attendance_time, received_at, time_trust, lat, lng, distance_m, selfie_id, client_uuid, source, recorded_by_id, on_behalf_reason, updated_at, created_at)
                  VALUES ($1, $2, 'check_in', $3, $4, '2026-07-01', now(), now(), 'server', 0, 0, 0, $5, $6, $7, $8, $9, now(), now())`
    const e = w.emp.noAccount
    expect((await sqlError('app', base, [e, null, w.project, null, s, randomUUID(), 'pm', w.users.pm.id, null]))?.code).toBe('23514')
    expect((await sqlError('app', base, [e, null, w.project, null, s, randomUUID(), 'self', null, null]))?.code).toBe('23514')
    expect((await sqlError('app', base, [e, w.users.staffA.id, w.project, w.costCenter, s, randomUUID(), 'self', null, null]))?.code).toBe('23514')
    expect((await sqlError('app', base, [e, w.users.staffA.id, null, null, s, randomUUID(), 'self', null, null]))?.code).toBe('23514')
  })
})

describe('koreksi absensi T10 (US-15)', () => {
  const correct = (user: FlowUser, id: number, body: Record<string, unknown>, h: Record<string, string> = {}) => api('POST', `/api/v1/attendance/${id}/correct`, user, body, h)

  it('PM of the team corrects the time: 201, append-only row old → new, audit on the attendance; idempotent replay', async () => {
    const key = randomUUID()
    const body = { new_time: at('2026-08-04', '08:05'), reason: 'Jam HP salah, dikonfirmasi mandor' }
    const r = await correct(w.users.pm, fixture.in04!, body, { 'Idempotency-Key': key })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body).toMatchObject({ attendanceId: fixture.in04, kind: 'check_in', localDate: '2026-08-04', oldTime: at('2026-08-04', '08:40') })
    const replay = await correct(w.users.pm, fixture.in04!, body, { 'Idempotency-Key': key })
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true')
    const rows = (await sqlAs('app', 'SELECT old_time, new_time, reason, corrected_by_id, corrected_at FROM attendance_corrections WHERE attendance_id = $1', [fixture.in04])).rows
    expect(rows).toHaveLength(1)
    expect(new Date(rows[0].new_time).toISOString()).toBe(new Date(body.new_time).toISOString())
    expect(rows[0].corrected_by_id).toBe(w.users.pm.id)
    expect(Math.abs(new Date(rows[0].corrected_at).getTime() - Date.now())).toBeLessThan(60_000)
    const audit = (await auditRows('attendance', fixture.in04!)).filter((a) => a.action === 'update')
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ field: 'attendanceTime', reason: body.reason })
    expect(audit[0]!.old_value).toEqual({ v: new Date(at('2026-08-04', '08:40')).toISOString() })
    expect(audit[0]!.new_value).toEqual({ v: new Date(body.new_time).toISOString() })
    // the row itself is untouched (append-only)
    const att = (await sqlAs('app', 'SELECT attendance_time FROM attendances WHERE id = $1', [fixture.in04])).rows[0]
    expect(new Date(att.attendance_time).toISOString()).toBe(new Date(at('2026-08-04', '08:40')).toISOString())
  })

  it('validation: reason required (400), other date (400), check-in after check-out (400), future (400), unchanged (400)', async () => {
    expect((await correct(w.users.pm, fixture.in03!, { new_time: at('2026-08-03', '08:00') })).status).toBe(400)
    expect((await correct(w.users.pm, fixture.in03!, { new_time: at('2026-08-03', '08:00'), reason: ' ' })).status).toBe(400)
    const other = await correct(w.users.pm, fixture.in03!, { new_time: at('2026-08-02', '08:00'), reason: 'salah tanggal' })
    expect(other.status).toBe(400)
    expect(other.body.title).toMatch(/tanggal absensi yang sama/)
    expect((await correct(w.users.pm, fixture.in03!, { new_time: at('2026-08-03', '17:30'), reason: 'setelah pulang' })).status).toBe(400)
    expect((await correct(w.users.pm, fixture.out03!, { new_time: at('2026-08-03', '08:00'), reason: 'sebelum masuk' })).status).toBe(400)
    expect((await correct(w.users.pm, fixture.in03!, { new_time: new Date(Date.now() + 86_400_000).toISOString(), reason: 'masa depan' })).status).toBe(400)
    expect((await correct(w.users.pm, fixture.in03!, { new_time: at('2026-08-03', '08:10'), reason: 'sama saja' })).status).toBe(400)
  })

  it('authz: other PM 404, Finance/Direktur 403 + access_denied, Staff 403, own attendance 403, Admin allowed', async () => {
    const body = { new_time: at('2026-08-03', '08:00'), reason: 'koreksi uji' }
    expect((await correct(w.users.otherPm, fixture.in03!, body)).status).toBe(404)
    expect((await correct(w.users.finance, fixture.in03!, body)).status).toBe(403)
    expect((await correct(w.users.owner, fixture.in03!, body)).status).toBe(403)
    expect((await correct(w.users.staffA, fixture.in03!, body)).status).toBe(403)
    expect((await correct(w.users.staffB, fixture.in03!, body)).status).toBe(403) // own attendance, not a PM
    const denied = (await auditRows('attendance', fixture.in03!)).filter((a) => a.action === 'access_denied')
    expect(denied.length).toBeGreaterThanOrEqual(2)
    // PM correcting their OWN attendance → 403 (PM employee assigned to the team project)
    const s = await selfie(pm)
    await sysCreate('team-assignments', { employee: w.emp.pm, project: w.project, roleInProject: 'pm' })
    const own = await fixtureRow(w.emp.pm, w.users.pm.id, 'check_in', '2026-08-06', '09:00', s)
    const r = await correct(w.users.pm, own, { new_time: at('2026-08-06', '08:00'), reason: 'koreksi sendiri' })
    expect(r.status).toBe(403)
    expect(r.body.title).toMatch(/sendiri/)
    const adm = await correct(w.users.admin, own, { new_time: at('2026-08-06', '08:00'), reason: 'dikoreksi admin' })
    expect(adm.status, JSON.stringify(adm.body)).toBe(201)
    // unknown id → 404
    expect((await correct(w.users.pm, 99_999_999, body)).status).toBe(404)
  })

  it('attendance_corrections is append-only and must match its attendance (DB)', async () => {
    const id = (await sqlAs('app', 'SELECT id FROM attendance_corrections LIMIT 1')).rows[0].id
    expect((await sqlError('app', `UPDATE attendance_corrections SET reason = 'x' WHERE id = ${id}`))?.message).toMatch(/permission denied/)
    expect((await sqlError('app', `DELETE FROM attendance_corrections WHERE id = ${id}`))?.message).toMatch(/permission denied/)
    expect((await sqlError('owner', `UPDATE attendance_corrections SET reason = 'xyz' WHERE id = ${id}`))?.code).toBe('42501')
    const bad = await sqlError(
      'app',
      `INSERT INTO attendance_corrections (attendance_id, employee_id, project_id, kind, local_date, old_time, new_time, reason, corrected_by_id, corrected_at, updated_at, created_at)
       VALUES ($1, $2, $3, 'check_out', '2026-08-04', now(), now(), 'tidak cocok', $4, now(), now(), now())`,
      [fixture.in04, w.emp.b, w.project, w.users.pm.id],
    )
    expect(bad?.code).toBe('23514')
  })

  it('HTTP collection: create closed; staff read only their own corrections', async () => {
    expect((await api('POST', '/api/attendance-corrections', w.users.admin, { reason: 'x' })).status).toBe(403)
    const own = await api('GET', '/api/attendance-corrections?depth=0', w.users.staffB)
    expect(own.status).toBe(200)
    expect(own.body.docs.length).toBeGreaterThanOrEqual(1)
    expect(own.body.docs.every((d: { employee: number }) => d.employee === w.emp.b)).toBe(true)
    expect((await api('GET', '/api/attendance-corrections?depth=0', w.users.staffA)).body.docs).toHaveLength(0)
  })
})

describe('rekap bulanan (US-09) + laporan absensi (M13) reconciled with SQL', () => {
  it('GET /attendance/me: every day of the month, schedule, holiday/off-day flags, correction applied', async () => {
    const r = await api('GET', `/api/v1/attendance/me?month=${MONTH}`, w.users.staffB)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.days).toHaveLength(31)
    expect(r.body.schedule).toMatchObject({ start: '08:00', end: '17:00', toleranceMin: 15, workDays: [1, 2, 3, 4, 5, 6] })
    const day = (d: string) => r.body.days.find((x: { date: string }) => x.date === d)
    expect(day('2026-08-04')).toMatchObject({ checkInLocal: '08:05', checkOutLocal: '16:00', lateMinutes: 0, earlyLeaveMinutes: 60, corrected: true })
    expect(day(HOLIDAY)).toMatchObject({ kind: 'holiday', holidayName: 'e6 Hari libur contoh', status: 'selesai', lateMinutes: 0 })
    expect(day('2026-08-09')).toMatchObject({ kind: 'off', status: 'selesai' })
    expect(day('2026-08-05')).toMatchObject({ status: 'hadir', checkOut: null })
    expect(day('2026-08-06')).toMatchObject({ status: 'tidak_hadir' })
    // Aug 2026: 26 Mon–Sat days − 1 holiday = 25 working days; present on 3 of them (+ Sunday + holiday)
    expect(r.body.summary).toEqual({
      presentDays: 5,
      workingDays: 25,
      absentDays: 22,
      lateDays: 0, // the 08:40 check-in was corrected to 08:05 (within tolerance)
      lateMinutes: 0,
      earlyLeaveDays: 1,
      earlyLeaveMinutes: 60,
      workMinutes: 530 + 475 + 120 + 180,
      holidayWorkDays: 1,
      offDayWorkDays: 1,
      incompleteDays: 1,
      onBehalfDays: 0,
      correctedDays: 1,
    })
    expect((await api('GET', '/api/v1/attendance/me?month=2026-13', w.users.staffB)).status).toBe(400)
    expect((await api('GET', '/api/v1/attendance/me?month=2099-01', w.users.staffB)).status).toBe(400)
    expect((await api('GET', '/api/v1/attendance/me', w.users.finance)).status).toBe(409) // no employee link
  })

  it('report "absensi" and recap equal an independent SQL computation (effective times, schedule, holidays)', async () => {
    const sqlRecon = (
      await sqlAs(
        'ro',
        `WITH eff AS (
           SELECT a.local_date, a.kind, coalesce((SELECT c.new_time FROM attendance_corrections c WHERE c.attendance_id = a.id ORDER BY c.id DESC LIMIT 1), a.attendance_time) AS t
           FROM attendances a WHERE a.employee_id = $1 AND a.local_date LIKE $2),
         d AS (SELECT local_date, min(t) FILTER (WHERE kind = 'check_in') AS i, max(t) FILTER (WHERE kind = 'check_out') AS o FROM eff GROUP BY local_date),
         k AS (SELECT d.*, (extract(isodow FROM local_date::date) BETWEEN 1 AND 6 AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = d.local_date)) AS workday FROM d)
         SELECT count(*) FILTER (WHERE i IS NOT NULL)::int AS present,
                coalesce(sum(CASE WHEN workday AND floor(extract(epoch FROM ((i AT TIME ZONE $3)::time - time '08:00')) / 60) > 15
                                  THEN floor(extract(epoch FROM ((i AT TIME ZONE $3)::time - time '08:00')) / 60) ELSE 0 END), 0)::int AS late_minutes,
                coalesce(sum(CASE WHEN workday AND o IS NOT NULL AND (o AT TIME ZONE $3)::time < time '17:00'
                                  THEN ceil(extract(epoch FROM (time '17:00' - (o AT TIME ZONE $3)::time)) / 60) ELSE 0 END), 0)::int AS early_minutes,
                coalesce(sum(floor(extract(epoch FROM (o - i)) / 60)) FILTER (WHERE o IS NOT NULL), 0)::int AS work_minutes,
                count(*) FILTER (WHERE i IS NOT NULL AND o IS NULL)::int AS incomplete
         FROM k`,
        [w.emp.b, `${MONTH}-%`, TZ],
      )
    ).rows[0]
    const recap = (await api('GET', `/api/v1/attendance/recap?employee_id=${w.emp.b}&month=${MONTH}`, w.users.finance)).body
    expect({ present: recap.summary.presentDays, late_minutes: recap.summary.lateMinutes, early_minutes: recap.summary.earlyLeaveMinutes, work_minutes: recap.summary.workMinutes, incomplete: recap.summary.incompleteDays }).toEqual(sqlRecon)
    const rep = await api('GET', `/api/v1/reports/absensi?bulan=${MONTH}`, w.users.finance)
    expect(rep.status, JSON.stringify(rep.body)).toBe(200)
    const row = rep.body.main.rows.find((x: { karyawan: string }) => x.karyawan.includes('abs Staff B'))
    expect(row).toMatchObject({ hadir: sqlRecon.present, terlambatMenit: sqlRecon.late_minutes, pulangCepatMenit: sqlRecon.early_minutes, jamKerja: sqlRecon.work_minutes, tanpaPulang: sqlRecon.incomplete, hariLibur: 1, nonKerja: 1, koreksi: 1 })
    // CSV export works and is audited
    const csv = await api('GET', `/api/v1/reports/absensi/csv?bulan=${MONTH}`, w.users.finance)
    expect(csv.status).toBe(200)
    expect(String(csv.body)).toContain('abs Staff B')
  })

  it('recap / report scope: PM team only, other PM 404, staff 403 on others; Admin reads + exports all (S3e, S-23)', async () => {
    expect((await api('GET', `/api/v1/attendance/recap?employee_id=${w.emp.b}&month=${MONTH}`, w.users.pm)).status).toBe(200)
    expect((await api('GET', `/api/v1/attendance/recap?employee_id=${w.emp.b}&month=${MONTH}`, w.users.otherPm)).status).toBe(404)
    expect((await api('GET', `/api/v1/attendance/recap?employee_id=${w.emp.b}&month=${MONTH}`, w.users.staffA)).status).toBe(403)
    const pmRep = await api('GET', `/api/v1/reports/absensi?bulan=${MONTH}`, w.users.otherPm)
    expect(pmRep.status).toBe(200)
    expect(JSON.stringify(pmRep.body.main.rows)).not.toContain('abs Staff B')
    const adm = await api('GET', `/api/v1/reports/absensi?bulan=${MONTH}`, w.users.admin)
    expect(adm.status, JSON.stringify(adm.body)).toBe(200)
    expect(JSON.stringify(adm.body.main.rows)).toContain('abs Staff B') // scope all (requirements §4 Admin R/U absensi)
    const xlsx = await api('GET', `/api/v1/reports/absensi/xlsx?bulan=${MONTH}`, w.users.admin)
    expect(xlsx.status).toBe(200)
    expect(xlsx.headers.get('content-type')).toContain('spreadsheetml')
    // Admin still has no finance report
    expect((await api('GET', `/api/v1/reports/rekap-kas?dari=${MONTH}&sampai=${MONTH}`, w.users.admin)).status).toBe(403)
    expect((await api('GET', `/api/v1/reports/absensi?bulan=${MONTH}`, w.users.staffA)).status).toBe(403)
  })
})

describe('tim hari ini (US-13)', () => {
  it('PM: team members with belum absen / hadir / selesai; counts; on-behalf flagged', async () => {
    const r = await api('GET', '/api/v1/attendance/team-today', w.users.pm)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.scope).toBe('team')
    const by = (id: number) => r.body.members.find((m: { employee: { id: number } }) => m.employee.id === id)
    expect(by(w.emp.a)).toMatchObject({ status: 'hadir' }) // checked in at the cost center, not out
    expect(by(w.emp.b)).toMatchObject({ status: 'belum_absen' })
    expect(by(w.emp.noAccount)).toMatchObject({ status: 'selesai', onBehalf: true })
    expect(r.body.counts.total).toBe(r.body.members.length)
    expect(r.body.counts.hadir + r.body.counts.belum_absen + r.body.counts.selesai).toBe(r.body.counts.total)
  })

  it('scope: other PM sees none of this team; filters outside the team → empty; staff 403; finance all', async () => {
    const o = await api('GET', '/api/v1/attendance/team-today', w.users.otherPm)
    expect(o.status).toBe(200)
    expect(o.body.members.some((m: { employee: { id: number } }) => [w.emp.a, w.emp.b, w.emp.noAccount].includes(m.employee.id))).toBe(false)
    const f = await api('GET', `/api/v1/attendance/team-today?project_id=${w.otherProject}`, w.users.pm)
    expect(f.body.members).toHaveLength(0)
    expect((await api('GET', '/api/v1/attendance/team-today', w.users.staffA)).status).toBe(403)
    const fin = await api('GET', `/api/v1/attendance/team-today?project_id=${w.project}`, w.users.finance)
    expect(fin.body.members.map((m: { employee: { id: number } }) => m.employee.id)).toEqual(expect.arrayContaining([w.emp.a, w.emp.b, w.emp.noAccount]))
    expect((await api('GET', '/api/v1/attendance/team-today?date=2099-01-01', w.users.pm)).status).toBe(400)
    // past date: the fixture month
    const past = await api('GET', '/api/v1/attendance/team-today?date=2026-08-04', w.users.pm)
    expect(past.body.members.find((m: { employee: { id: number } }) => m.employee.id === w.emp.b)).toMatchObject({ status: 'selesai', checkInLocal: '08:05' })
  })
})

describe('selfie viewer (Q-33) and retention (dry run)', () => {
  it('own 200; other staff 404; PM team / Finance 200 with view_sensitive audit', async () => {
    const id = fixture.in03!
    const own = await api('GET', `/api/v1/attendance/${id}/selfie`, w.users.staffB)
    expect(own.status).toBe(200)
    expect(own.headers.get('content-type')).toBe('image/jpeg')
    expect(own.headers.get('cache-control')).toBe('private, no-store')
    expect((await api('GET', `/api/v1/attendance/${id}/selfie`, w.users.staffA)).status).toBe(404)
    expect((await api('GET', `/api/v1/attendance/${id}/selfie`, w.users.otherPm)).status).toBe(404)
    expect((await api('GET', `/api/v1/attendance/${id}/selfie`, w.users.pm)).status).toBe(200)
    expect((await api('GET', `/api/v1/attendance/${id}/selfie`, w.users.finance)).status).toBe(200)
    const views = (await auditRows('attendance', id)).filter((a) => a.action === 'view_sensitive')
    expect(views.map((v) => v.user_id).sort()).toEqual([String(w.users.pm.id), String(w.users.finance.id)].sort())
  })

  it('retention plan: nothing before 12 months; with a clock 13 months ahead every selfie except face reference photos', async () => {
    const p = await getTestPayload()
    const now = await selfieRetentionPlan(p)
    expect(now).toMatchObject({ months: 12, candidates: 0 })
    const face = (await sqlAs('app', 'SELECT id FROM media_selfies ORDER BY id LIMIT 1')).rows[0].id
    await p.update({ collection: 'employees', id: w.emp.admin, data: { faceRefPhoto: face }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    // removed_at: s2b-attendance-web-reminders may have purged selfies first (file order is not fixed)
    const total = (await sqlAs('app', 'SELECT count(*)::int AS n FROM media_selfies WHERE removed_at IS NULL')).rows[0].n
    const later = await selfieRetentionPlan(p, new Date(Date.now() + 400 * 86_400_000))
    expect(later.candidates).toBe(total - 1)
    expect(later.sampleIds).not.toContain(face)
    await p.updateGlobal({ slug: 'company-settings', data: { selfieRetentionMonths: 1 }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    try {
      expect((await selfieRetentionPlan(p, new Date(Date.now() + 40 * 86_400_000))).months).toBe(1)
    } finally {
      await p.updateGlobal({ slug: 'company-settings', data: { selfieRetentionMonths: 12 }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    }
    expect((await sqlError('app', 'UPDATE company_settings SET selfie_retention_months = 0'))?.code).toBe('23514')
  })
})
