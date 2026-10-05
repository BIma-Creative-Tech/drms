import { randomUUID } from 'node:crypto'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetAppConfigCache } from '@/api/v1/endpoints/app'
import { resetMinVersionCache } from '@/api/v1/http'
import { PRIVACY_ACK_REQUIRED, PRIVACY_ACK_REQUIRED_DETAIL } from '@/legal/privacy-enforcement'
import { PRIVACY_NOTICE } from '@/legal/privacy-notice'
import { resetRateLimits } from '@/lib/rate-limit'

import { accessToken, companyId, getTestPayload, http, installLocalJwks, registerDevice, sqlAs, type TestUser, updateCompany } from './helpers'
import { api, makeWorld, upload, type FlowUser, type World } from './flow-world'

/**
 * ADR 0018, owner decision 2026-10-05 — server-side enforcement of the privacy acknowledgement: while the app
 * setting "Versi APK minimum" is ≥ 0.3.3, attendance captures (selfie upload, sync check-in/out, on-behalf: the
 * acting PM) of a user without an acknowledgement of the current notice are refused `PRIVACY_ACK_REQUIRED`
 * (403 / final per-item rejection) and audited `access_denied`. Below 0.3.3, unset or unreadable → unchanged.
 * The minimum is reset and syncAttendanceEnabled switched off again afterwards. Coordinates are fictional.
 */
const V = PRIVACY_NOTICE.version
const ACK = '/api/v1/me/privacy-ack'
let w: World
let drms: number
type Mobile = { user: FlowUser; token: string; device: string }
let staffA: Mobile
let staffB: Mobile
let pm: Mobile
let otherPm: Mobile
const SITE = { lat: -2.21, lng: 113.91 }
const OPS = { lat: -2.5, lng: 114.2 }

async function mobile(user: FlowUser, roles: string[]): Promise<Mobile> {
  const p = await getTestPayload()
  const doc = await p.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true /* SYSTEM-READ: fixture */ })
  const t: TestUser = { ...user, keycloakSub: doc.keycloakSub as string }
  const token = await accessToken(t, roles)
  return { user, token, device: await registerDevice(t, token) }
}
const headers = (m: Mobile, version = '1.0.0') => ({ Authorization: `Bearer ${m.token}`, 'X-Device-Id': m.device, 'X-App-Version': version })

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: Math.floor(Math.random() * 255), g: 100, b: 60 } } })
    .jpeg()
    .toBuffer()
}

/** POST /api/v1/media/selfies as the APK. */
async function uploadSelfie(m: Mobile, version = '1.0.0'): Promise<{ status: number; body: { id?: number; code?: string; detail?: string; title?: string } }> {
  resetRateLimits()
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(await jpeg())], { type: 'image/jpeg' }), 'selfie.jpg')
  const { handleEndpoints } = await import('payload')
  const config = (await import('@payload-config')).default
  const res = await handleEndpoints({ config, request: new Request('http://localhost:3000/api/v1/media/selfies', { method: 'POST', headers: headers(m, version), body: form }) })
  return { status: res.status, body: (await res.json()) as never }
}
async function selfie(m: Mobile, version = '1.0.0'): Promise<number> {
  const r = await uploadSelfie(m, version)
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.id!
}

function item(type: string, payload: Record<string, unknown>) {
  return { client_uuid: randomUUID(), type, company_id: drms, schema_version: 1, offline: false, device_time: new Date().toISOString(), elapsed_ms: 10_000_000, payload }
}
const own = (selfieId: number) => ({ project_id: w.project, lat: SITE.lat, lng: SITE.lng, accuracy_m: 8, is_mocked: false, selfie_media_id: selfieId })
const ob = (over: Record<string, unknown>) => ({ employee_id: w.emp.noAccount, kind: 'check_in', project_id: w.project, lat: SITE.lat, lng: SITE.lng, accuracy_m: 8, is_mocked: false, camera_lens: 'back', reason: 'Tidak punya HP', ...over })

type ItemResult = { status: string; original_status?: string | null; server_id: string | null; errors: Array<{ code: string; message: string }> }
async function sync(m: Mobile, items: Array<Record<string, unknown>>, version = '1.0.0'): Promise<ItemResult[]> {
  resetRateLimits()
  const now = Date.now()
  const clock = { device_time: new Date(now).toISOString(), elapsed_ms: 10_000_000, boot_id: 'boot-1', last_server_time: new Date(now - 60_000).toISOString(), last_server_elapsed_ms: 10_000_000 - 60_000 }
  const r = await http('POST', '/api/v1/sync/batch', { headers: headers(m, version), json: { batch_id: randomUUID(), device_id: m.device, clock, items } })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return (r.body as { results: ItemResult[] }).results
}

/** Through the admin field (validated x.y.z or empty). */
async function setMin(v: string | null): Promise<void> {
  const p = await getTestPayload()
  await p.updateGlobal({ slug: 'company-settings', data: { minAppVersion: v ?? '' }, overrideAccess: true /* SYSTEM-WRITE: test */ })
  resetMinVersionCache()
}
/** Raw DB value (bypasses the field validation): values an import / manual SQL could leave behind. */
async function setMinRaw(v: string | null): Promise<void> {
  await sqlAs('owner', 'UPDATE company_settings SET min_app_version = $1', [v])
  resetMinVersionCache()
}

type DeniedRow = { doc_type: string; field: string; reason: string; new_value: { v: Record<string, unknown> }; company_id: number | null; source: string }
async function denied(uid: number): Promise<DeniedRow[]> {
  return (
    await sqlAs('app', "SELECT doc_type, field, reason, new_value, company_id, source FROM audit_logs WHERE action = 'access_denied' AND reason = $1 AND user_id = $2 ORDER BY id", [
      PRIVACY_ACK_REQUIRED,
      String(uid),
    ])
  ).rows as DeniedRow[]
}
const attendanceCount = async (uid: number) => (await sqlAs('app', 'SELECT count(*)::int AS n FROM attendances WHERE user_id = $1', [uid])).rows[0].n as number
const ack = async (u: FlowUser) => expect((await api('POST', ACK, u, { version: V })).status).toBe(200)

beforeAll(async () => {
  installLocalJwks()
  w = await makeWorld('pen')
  drms = await companyId()
  const p = await getTestPayload()
  await p.update({ collection: 'projects', id: w.project, data: { lat: SITE.lat, lng: SITE.lng, radiusM: 100 }, overrideAccess: true /* SYSTEM-WRITE: fixture geofence */ })
  await p.update({ collection: 'cost-centers', id: w.costCenter, data: { lat: OPS.lat, lng: OPS.lng, radiusM: 150 }, overrideAccess: true /* SYSTEM-WRITE: fixture geofence */ })
  await p.create({ collection: 'team-assignments', data: { employee: w.emp.noAccount, project: w.project, roleInProject: 'staff' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  staffA = await mobile(w.users.staffA, ['pk-staff'])
  staffB = await mobile(w.users.staffB, ['pk-staff'])
  pm = await mobile(w.users.pm, ['pk-pm'])
  otherPm = await mobile(w.users.otherPm, ['pk-pm'])
  await updateCompany({ syncAttendanceEnabled: true })
  resetAppConfigCache()
  await setMin(null)
})

afterAll(async () => {
  await setMin(null)
  await updateCompany({ syncAttendanceEnabled: false })
  resetAppConfigCache()
})

describe('no enforcement below 0.3.3 (older APKs keep working)', () => {
  it('minimum unset: APK 0.3.2 uploads a selfie and checks in without an acknowledgement', async () => {
    const [r] = await sync(staffA, [item('attendance.check_in', own(await selfie(staffA, '0.3.2')))], '0.3.2')
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'applied' })
    expect(await denied(w.users.staffA.id)).toHaveLength(0)
  })

  it('minimum 0.3.2: still accepted (check-out of the same user, no acknowledgement)', async () => {
    await setMin('0.3.2')
    const [r] = await sync(staffA, [item('attendance.check_out', own(await selfie(staffA, '0.3.2')))], '0.3.2')
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'applied' })
    expect(await attendanceCount(w.users.staffA.id)).toBe(2)
    expect(await denied(w.users.staffA.id)).toHaveLength(0)
  })
})

describe('minimum ≥ 0.3.3: attendance needs the current acknowledgement', () => {
  it('selfie upload 403 + check-in rejected PRIVACY_ACK_REQUIRED (final, audited); accepted after the acknowledgement', async () => {
    await setMin(null)
    const early = await selfie(staffB) // uploaded before the minimum was raised
    await setMin('0.3.3')

    const up = await uploadSelfie(staffB, '0.3.3')
    expect(up.status).toBe(403)
    expect(up.body).toMatchObject({ title: 'Forbidden', code: PRIVACY_ACK_REQUIRED, detail: PRIVACY_ACK_REQUIRED_DETAIL })

    const it1 = item('attendance.check_in', own(early))
    const [r] = await sync(staffB, [it1], '0.3.3')
    expect(r).toMatchObject({ status: 'rejected', server_id: null })
    expect(r!.errors).toEqual([{ code: PRIVACY_ACK_REQUIRED, message: PRIVACY_ACK_REQUIRED_DETAIL }])
    // final: a replay returns the stored rejection, nothing is re-evaluated (no second audit row)
    const [again] = await sync(staffB, [it1], '0.3.3')
    expect(again).toMatchObject({ status: 'duplicate', original_status: 'rejected' })
    expect(await attendanceCount(w.users.staffB.id)).toBe(0)

    const rows = await denied(w.users.staffB.id)
    expect(rows.map((x) => [x.doc_type, x.field])).toEqual([
      ['media_selfies', 'upload'],
      ['attendance', 'attendance.check_in'],
    ])
    expect(rows[0]).toMatchObject({ company_id: null, source: 'apk', new_value: { v: { currentVersion: V, ackVersion: null, minAppVersion: '0.3.3' } } })
    expect(rows[1]).toMatchObject({ company_id: drms, source: 'apk' })
    // the sync receipt / sync_offline audit carries the code as well
    const so = await sqlAs('app', "SELECT new_value FROM audit_logs WHERE action = 'sync_offline' AND user_id = $1", [String(w.users.staffB.id)])
    expect(JSON.stringify(so.rows)).toContain(PRIVACY_ACK_REQUIRED)

    // other features are not affected
    expect((await http('GET', '/api/v1/me', { headers: headers(staffB, '0.3.3') })).status).toBe(200)

    await ack(w.users.staffB)
    const [ok] = await sync(staffB, [item('attendance.check_in', own(await selfie(staffB, '0.3.3')))], '0.3.3')
    expect(ok, JSON.stringify(ok)).toMatchObject({ status: 'applied' })
    expect(await attendanceCount(w.users.staffB.id)).toBe(1)
    expect(await denied(w.users.staffB.id)).toHaveLength(2)
  })

  it('on-behalf checks the ACTING PM, not the employee', async () => {
    await setMin(null)
    const early = await selfie(pm)
    await setMin('0.3.3')
    const [r] = await sync(pm, [item('attendance.on_behalf', ob({ selfie_media_id: early }))], '0.3.3')
    expect(r!.status).toBe('rejected')
    expect(r!.errors[0]!.code).toBe(PRIVACY_ACK_REQUIRED)
    expect((await denied(w.users.pm.id)).map((x) => x.field)).toEqual(['attendance.on_behalf'])
    expect((await sqlAs('app', 'SELECT count(*)::int AS n FROM attendances WHERE employee_id = $1', [w.emp.noAccount])).rows[0].n).toBe(0)

    await ack(w.users.pm)
    // employee without an account (cannot acknowledge anything) → applied
    const [ok] = await sync(pm, [item('attendance.on_behalf', ob({ selfie_media_id: await selfie(pm) }))], '0.3.3')
    expect(ok, JSON.stringify(ok)).toMatchObject({ status: 'applied' })
    // employee whose own account has NOT acknowledged (staff A) → applied as well: only the actor counts
    const [ok2] = await sync(
      pm,
      [item('attendance.on_behalf', ob({ employee_id: w.emp.a, project_id: undefined, cost_center_id: w.costCenter, lat: OPS.lat, lng: OPS.lng, selfie_media_id: await selfie(pm) }))],
      '0.3.3',
    )
    expect(ok2, JSON.stringify(ok2)).toMatchObject({ status: 'applied' })
    expect((await sqlAs('app', 'SELECT privacy_ack_version FROM users WHERE id = $1', [w.users.staffA.id])).rows[0].privacy_ack_version).toBeNull()
  })

  it('generic Payload REST create of media-selfies is refused too (web session)', async () => {
    await setMin('0.3.3')
    const r = await upload('/api/media-selfies', w.users.otherPm, await jpeg(), 'image/jpeg')
    expect(r.status).toBe(403)
    expect(JSON.stringify(r.body)).toContain('pemberitahuan privasi')
    const rows = await denied(w.users.otherPm.id)
    expect(rows.at(-1)).toMatchObject({ doc_type: 'media_selfies', field: 'upload', source: 'web' })
  })
})

describe('version comparison edge cases (probe: selfie upload of a user without acknowledgement)', () => {
  it.each([
    ['0.3.10', 403], // numeric, not lexicographic: 0.3.10 > 0.3.3
    ['0.4.0', 403],
    ['1.0.0', 403],
    ['0.3.3', 403],
    ['0.3.2', 201],
    ['0.2.99', 201],
  ])('valid minimum %s → %i', async (min, status) => {
    await setMin(min)
    expect((await uploadSelfie(otherPm)).status).toBe(status)
  })

  it.each([null, '', 'garbage', '0.3', '0.3.3-beta', 'v0.4.0', ' 0.4.0'])('missing / garbage minimum %j → no enforcement', async (min) => {
    await setMinRaw(min)
    expect((await uploadSelfie(otherPm)).status).toBe(201)
  })

  it('cleanup: unset minimum', async () => {
    await setMin(null)
    expect((await uploadSelfie(otherPm)).status).toBe(201)
  })
})
