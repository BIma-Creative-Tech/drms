import { randomUUID } from 'node:crypto'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetAppConfigCache } from '@/api/v1/endpoints/app'
import { resetRateLimits } from '@/lib/rate-limit'

import { accessToken, auditRows, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, sqlError, type TestUser } from './helpers'
import { api, makeWorld, type FlowUser, type World } from './flow-world'

/**
 * F4 gate "offline check-in synced with 'offline' flag and server time" — F4 slice of attendance
 * (items attendance.check_in / attendance.check_out of POST /api/v1/sync/batch, ADR 0010 decision 8).
 * Coordinates are fictional.
 */
let w: World
type Mobile = { user: FlowUser; token: string; device: string }
let staffA: Mobile
let staffB: Mobile
const SITE = { lat: -2.21, lng: 113.91 }
let noGeoProject: number

async function mobile(user: FlowUser, roles: string[]): Promise<Mobile> {
  const p = await getTestPayload()
  const doc = await p.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
  const t: TestUser = { ...user, keycloakSub: doc.keycloakSub as string }
  const token = await accessToken(t, roles)
  return { user, token, device: await registerDevice(t, token) }
}

const headers = (m: Mobile) => ({ Authorization: `Bearer ${m.token}`, 'X-Device-Id': m.device, 'X-App-Version': '1.0.0' })

/** Selfie through the real endpoint (bearer, multipart, kind `selfies`). */
async function selfie(m: Mobile, seed = Math.floor(Math.random() * 255)): Promise<number> {
  const jpeg = await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: seed, g: 120, b: 90 } } }).jpeg().toBuffer()
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'selfie.jpg')
  const { handleEndpoints } = await import('payload')
  const config = (await import('@payload-config')).default
  const res = await handleEndpoints({ config, request: new Request('http://localhost:3000/api/v1/media/selfies', { method: 'POST', headers: headers(m), body: form }) })
  const body = (await res.json()) as { id: number; kind: string; width: number }
  expect(res.status, JSON.stringify(body)).toBe(201)
  expect(body.kind).toBe('selfies')
  expect(body.width).toBeLessThanOrEqual(720) // server resize (ADR 0004)
  return body.id
}

function payload(selfieId: number, over: Record<string, unknown> = {}) {
  return { project_id: w.project, lat: SITE.lat + 0.0002, lng: SITE.lng, accuracy_m: 12.5, is_mocked: false, selfie_media_id: selfieId, camera_lens: 'front', ...over }
}

/** Offline item recorded 5 min ago on the same boot as the last online call (10 min ago). */
function item(type: string, p: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return { client_uuid: randomUUID(), type, schema_version: 1, offline: true, device_time: new Date(Date.now() - 300_000).toISOString(), elapsed_ms: 10_000_000 - 300_000, payload: p, ...over }
}

async function sync(m: Mobile, items: Array<Record<string, unknown>>) {
  resetRateLimits()
  const now = Date.now()
  const clock = { device_time: new Date(now).toISOString(), elapsed_ms: 10_000_000, boot_id: 'boot-1', last_server_time: new Date(now - 600_000).toISOString(), last_server_elapsed_ms: 10_000_000 - 600_000 }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return http('POST', '/api/v1/sync/batch', { headers: headers(m), json: { batch_id: randomUUID(), device_id: m.device, clock, items } }) as Promise<{ status: number; body: any }>
}

async function setAttendance(enabled: boolean) {
  const p = await getTestPayload()
  await p.updateGlobal({ slug: 'company-settings', data: { syncAttendanceEnabled: enabled }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  resetAppConfigCache()
}

beforeAll(async () => {
  installLocalJwks()
  w = await makeWorld('att')
  const p = await getTestPayload()
  await p.update({ collection: 'projects', id: w.project, data: { lat: SITE.lat, lng: SITE.lng, radiusM: 100 }, overrideAccess: true /* SYSTEM-WRITE: fixture geofence */ })
  await p.update({ collection: 'projects', id: w.otherProject, data: { lat: SITE.lat, lng: SITE.lng, radiusM: 100 }, overrideAccess: true /* SYSTEM-WRITE: fixture geofence */ })
  noGeoProject = (await p.create({ collection: 'projects', data: { code: 'att-NG', name: 'att no geofence', pm: w.users.pm.id, budget: 1_000_000, status: 'berjalan' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })).id as number
  await p.create({ collection: 'team-assignments', data: { employee: w.emp.b, project: noGeoProject, roleInProject: 'staff' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  staffA = await mobile(w.users.staffA, ['pk-staff'])
  staffB = await mobile(w.users.staffB, ['pk-staff'])
})

afterAll(async () => {
  await setAttendance(false)
})

describe('attendance sync (F4 slice)', () => {
  it('switched off by default: app config says so and items are rejected FEATURE_DISABLED', async () => {
    await setAttendance(false)
    const cfg = await http('GET', '/api/v1/app/config')
    expect((cfg.body as { features: { syncAttendance: boolean } }).features.syncAttendance).toBe(false)
    const r = await sync(staffA, [item('attendance.check_in', payload(await selfie(staffA)))])
    expect(r.status).toBe(200)
    expect(r.body.results[0]).toMatchObject({ status: 'rejected', errors: [{ code: 'FEATURE_DISABLED' }] })
  })

  it('offline check-in → applied with OFFLINE + estimated server time; replay = duplicate; row is append-only', async () => {
    await setAttendance(true)
    expect(((await http('GET', '/api/v1/app/config')).body as { features: { syncAttendance: boolean } }).features.syncAttendance).toBe(true)
    const it1 = item('attendance.check_in', payload(await selfie(staffA)))
    const before = Date.now()
    const r = await sync(staffA, [it1])
    expect(r.body.results[0], JSON.stringify(r.body)).toMatchObject({ status: 'applied', time_trust: 'estimated', flags: ['OFFLINE'] })
    const id = Number(r.body.results[0].server_id)
    const row = (
      await sqlAs('app', 'SELECT kind, offline, time_trust, local_date, attendance_time, received_at, device_time, distance_m, client_uuid FROM attendances WHERE id = $1', [id])
    ).rows[0]
    expect(row).toMatchObject({ kind: 'check_in', offline: true, time_trust: 'estimated', client_uuid: it1.client_uuid })
    expect(Number(row.distance_m)).toBeGreaterThan(15)
    expect(Number(row.distance_m)).toBeLessThan(30)
    // estimate = last_server_time + Δelapsed = now − 10 min + 5 min; received_at = DB clock (now)
    expect(Math.abs(new Date(row.attendance_time).getTime() - (before - 300_000))).toBeLessThan(5_000)
    expect(Math.abs(new Date(row.received_at).getTime() - Date.now())).toBeLessThan(10_000)
    const again = await sync(staffA, [it1])
    expect(again.body.results[0]).toMatchObject({ status: 'duplicate', original_status: 'applied', server_id: String(id) })
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM attendances WHERE client_uuid = $1', [it1.client_uuid])).rows[0].n).toBe(1)
    const audit = await auditRows('attendance', id)
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['sync_offline']))
    expect((await sqlError('app', `UPDATE attendances SET lat = 0 WHERE id = ${id}`))?.message).toMatch(/permission denied/)
    expect((await sqlError('app', `DELETE FROM attendances WHERE id = ${id}`))?.message).toMatch(/permission denied/)
  })

  it('second check-in the same day is rejected; online check-out uses server time; second check-out rejected', async () => {
    const dup = await sync(staffA, [item('attendance.check_in', payload(await selfie(staffA)))])
    expect(dup.body.results[0]).toMatchObject({ status: 'rejected', errors: [{ code: 'ALREADY_CHECKED_IN' }] })
    const out = await sync(staffA, [item('attendance.check_out', payload(await selfie(staffA)), { offline: false, device_time: new Date().toISOString(), elapsed_ms: 10_000_000 })])
    expect(out.body.results[0], JSON.stringify(out.body)).toMatchObject({ status: 'applied', time_trust: 'server', flags: [] })
    const out2 = await sync(staffA, [item('attendance.check_out', payload(await selfie(staffA)), { offline: false, device_time: new Date().toISOString(), elapsed_ms: 10_000_000 })])
    expect(out2.body.results[0]).toMatchObject({ status: 'rejected', errors: [{ code: 'ALREADY_CHECKED_OUT' }] })
  })

  it('server-side rejections: mock location, outside radius, not assigned, no geofence, foreign selfie, check-out first', async () => {
    const s = await selfie(staffB)
    const results = (
      await sync(staffB, [
        item('attendance.check_in', payload(s, { is_mocked: true })),
        item('attendance.check_in', payload(s, { lat: SITE.lat + 0.01, accuracy_m: 2000 })),
        item('attendance.check_in', payload(s, { project_id: w.otherProject })),
        item('attendance.check_in', payload(s, { project_id: noGeoProject })),
        item('attendance.check_in', payload(await selfie(staffA))),
        item('attendance.check_out', payload(s)),
        item('attendance.check_in', payload(s, { selfie_media_id: 999_999 })),
        item('attendance.check_in', { ...payload(s), lat: 'x' }),
      ])
    ).body.results as Array<{ status: string; errors: Array<{ code: string; message: string }> }>
    expect(results.map((r) => r.errors[0]?.code)).toEqual(['MOCK_LOCATION', 'OUTSIDE_GEOFENCE', 'NOT_ASSIGNED', 'NO_GEOFENCE', 'FORBIDDEN', 'NO_CHECK_IN', 'MEDIA_MISSING', 'VALIDATION'])
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    expect(results[1]!.errors[0]!.message).toMatch(/Di luar radius project \(\d+ m dari titik, radius 100 m\)/)
    // nothing stored for B; each rejection is in the audit log (sync_offline with the error code)
    const n = await sqlAs('app', 'SELECT count(*)::int AS n FROM attendances WHERE user_id = $1', [w.users.staffB.id])
    expect(n.rows[0].n).toBe(0)
    const rej = await sqlAs('app', "SELECT new_value FROM audit_logs WHERE doc_type = 'attendance' AND action = 'sync_offline' AND user_id = $1", [String(w.users.staffB.id)])
    expect(JSON.stringify(rej.rows)).toContain('OUTSIDE_GEOFENCE')
  })

  it('read access: staff see only their own rows; the PM of the project sees the team; create is closed over HTTP', async () => {
    const own = await api('GET', '/api/attendances?depth=0', w.users.staffA)
    expect(own.status).toBe(200)
    const ownDocs = (own.body as { docs: Array<{ user: number }> }).docs
    expect(ownDocs.length).toBeGreaterThanOrEqual(2)
    expect(ownDocs.every((d) => d.user === w.users.staffA.id)).toBe(true)
    const other = await api('GET', '/api/attendances?depth=0', w.users.staffB)
    expect((other.body as { docs: unknown[] }).docs).toHaveLength(0)
    const pm = await api('GET', '/api/attendances?depth=0', w.users.pm)
    expect((pm.body as { totalDocs: number }).totalDocs).toBeGreaterThanOrEqual(2)
    const forged = await api('POST', '/api/attendances', w.users.admin, { kind: 'check_in' })
    expect(forged.status).toBe(403)
  })
})
