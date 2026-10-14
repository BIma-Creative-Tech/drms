import { randomUUID } from 'node:crypto'

import { generateKeyPair } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetMinVersionCache } from '@/api/v1/http'

import {
  accessToken,
  auditRows,
  getTestPayload,
  http,
  installFakeKeycloak,
  installLocalJwks,
  makeUser,
  registerDevice,
  webSessionCookie,
  type KcCall,
  type TestUser,
} from './helpers'

/**
 * HTTP-level tests through Payload's REST handler (handleEndpoints — the exact code behind
 * src/app/(payload)/api/[...slug]/route.ts): strategies, generic REST, /api/v1.
 */
let staff: TestUser
let admin: TestUser
let kcCalls: KcCall[]
let staffToken: string
let staffDevice: string

beforeAll(async () => {
  const p = await getTestPayload()
  kcCalls = installFakeKeycloak().calls
  await installLocalJwks()
  const emp = await p.create({ collection: 'employees', data: { code: 'API-EMP', name: 'Api Staff', attendanceType: 'onsite' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  staff = await makeUser(['pk-staff'], { employee: emp.id, label: 'api-staff' })
  admin = await makeUser(['pk-admin'], { label: 'api-admin' })
  await p.create({ collection: 'uoms', data: { code: 'API-L', name: 'liter' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  staffToken = await accessToken(staff, ['pk-staff'])
  staffDevice = await registerDevice(staff, staffToken)
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

const bearer = (token: string, device?: string, extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${token}`,
  ...(device ? { 'X-Device-Id': device } : {}),
  ...extra,
})

describe('mobileBearer on /api/v1 (ADR 0003 §4)', () => {
  it('valid token + registered device → 200 /api/v1/me', async () => {
    const r = await http('GET', '/api/v1/me', { headers: bearer(staffToken, staffDevice) })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: staff.id, roles: ['pk-staff'], authMethod: 'mobileBearer', employee: { code: 'API-EMP' }, device: { deviceId: staffDevice } })
  })

  it('401 without device, unknown device, tampered/foreign-key token, wrong azp, id token, expired', async () => {
    const { privateKey } = await generateKeyPair('RS256')
    const cases: Array<[string, Record<string, string>]> = [
      ['no device', bearer(staffToken)],
      ['unknown device', bearer(staffToken, randomUUID())],
      ['foreign key', bearer(await accessToken(staff, ['pk-staff'], { key: privateKey }), staffDevice)],
      ['wrong azp', bearer(await accessToken(staff, ['pk-staff'], { azp: 'proyekkas-web' }), staffDevice)],
      ['typ ID', bearer(await accessToken(staff, ['pk-staff'], { typ: 'ID' }), staffDevice)],
      ['wrong iss', bearer(await accessToken(staff, ['pk-staff'], { iss: 'http://evil.test/realms/drms-test' }), staffDevice)],
      ['expired', bearer(await accessToken(staff, ['pk-staff'], { expiresIn: '-10m' }), staffDevice)],
    ]
    for (const [name, headers] of cases) {
      const r = await http('GET', '/api/v1/me', { headers })
      expect(r.status, name).toBe(401)
    }
  })

  it('effective roles = token roles ∩ stored roles (token claiming pk-admin gains nothing)', async () => {
    const t = await accessToken(staff, ['pk-staff', 'pk-admin'])
    const r = await http('GET', '/api/v1/me', { headers: bearer(t, staffDevice) })
    expect((r.body as { roles: string[] }).roles).toEqual(['pk-staff'])
  })

  it('bearer on generic /api/<slug> NEVER authenticates (403 / {user:null})', async () => {
    const h = bearer(staffToken, staffDevice)
    expect((await http('GET', '/api/uoms', { headers: h })).status).toBe(403)
    expect((await http('POST', '/api/uoms', { headers: h, json: { code: 'EVIL', name: 'x' } })).status).toBe(403)
    expect((await http('GET', '/api/audit-logs', { headers: h })).status).toBe(403)
    expect((await http('GET', '/api/employee-bank-accounts', { headers: h })).status).toBe(403)
    const me = await http('GET', '/api/users/me', { headers: h })
    expect(me.status).toBe(200)
    expect((me.body as { user: unknown }).user).toBeNull()
  })

  it('inactive user → 401 on the next request (same valid token and device)', async () => {
    const p = await getTestPayload()
    const u = await makeUser(['pk-staff'], { label: 'to-deactivate' })
    const t = await accessToken(u, ['pk-staff'])
    const dev = await registerDevice(u, t)
    expect((await http('GET', '/api/v1/me', { headers: bearer(t, dev) })).status).toBe(200)
    await p.update({ collection: 'users', id: u.id, data: { active: false, changeReason: 'keluar' }, overrideAccess: true /* SYSTEM-WRITE: test */ })
    expect((await http('GET', '/api/v1/me', { headers: bearer(t, dev) })).status).toBe(401)
    // cascade: device revoked + Keycloak logout + mobile consent revoked (ADR 0003 §5)
    const d = await p.find({ collection: 'devices', where: { deviceId: { equals: dev } }, overrideAccess: true /* SYSTEM-READ: assertion */ })
    expect(d.docs[0]?.status).toBe('revoked')
    expect(kcCalls.some((c) => c.op === 'logoutUser' && c.args[0] === u.keycloakSub)).toBe(true)
    expect(kcCalls.some((c) => c.op === 'revokeConsent' && c.args[0] === u.keycloakSub && c.args[1] === 'proyekkas-mobile')).toBe(true)
    const rows = await auditRows('user', u.id)
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['deactivate', 'session_revoked']))
  })

  it('APK below company minAppVersion → 426 with problem+json; at/above → 200', async () => {
    const p = await getTestPayload()
    await p.updateGlobal({ slug: 'company-settings', data: { minAppVersion: '2.0.0' }, overrideAccess: true /* SYSTEM-WRITE: test */ })
    resetMinVersionCache()
    const low = await http('GET', '/api/v1/me', { headers: bearer(staffToken, staffDevice, { 'X-App-Version': '1.9.9' }) })
    const none = await http('GET', '/api/v1/me', { headers: bearer(staffToken, staffDevice) })
    const high = await http('GET', '/api/v1/me', { headers: bearer(staffToken, staffDevice, { 'X-App-Version': '2.0.0' }) })
    const web = await http('GET', '/api/v1/me', { headers: { Cookie: await webSessionCookie(admin) } })
    await p.updateGlobal({ slug: 'company-settings', data: { minAppVersion: '' }, overrideAccess: true /* SYSTEM-WRITE: test */ })
    resetMinVersionCache()
    expect(low.status).toBe(426)
    expect(low.body).toMatchObject({ status: 426, minAppVersion: '2.0.0' })
    expect(none.status).toBe(426)
    expect(high.status).toBe(200)
    expect(web.status).toBe(200) // web sessions are not version-gated
  })
})

describe('devices register / revoke', () => {
  it('register is idempotent, header must match body, other user cannot take the id', async () => {
    const again = await http('POST', '/api/v1/devices/register', {
      headers: bearer(staffToken, staffDevice),
      json: { deviceId: staffDevice, platform: 'android', model: 'Test Phone 2', appVersion: '1.0.1' },
    })
    expect(again.status).toBe(200)
    expect((again.body as { model: string }).model).toBe('Test Phone 2')
    const other = randomUUID()
    const mismatch = await http('POST', '/api/v1/devices/register', { headers: bearer(staffToken, other), json: { deviceId: randomUUID(), platform: 'android' } })
    expect(mismatch.status).toBe(400)
    const u2 = await makeUser(['pk-staff'], { label: 'thief' })
    const t2 = await accessToken(u2, ['pk-staff'])
    const steal = await http('POST', '/api/v1/devices/register', { headers: bearer(t2, staffDevice), json: { deviceId: staffDevice, platform: 'android' } })
    expect(steal.status).toBe(409)
    const junk = await http('POST', '/api/v1/devices/register', { headers: bearer(staffToken, staffDevice), json: { deviceId: staffDevice, platform: 'ios' } })
    expect(junk.status).toBe(400)
  })

  it('register is bearer-only (web session → 403)', async () => {
    const cookie = await webSessionCookie(admin)
    const id = randomUUID()
    const r = await http('POST', '/api/v1/devices/register', { headers: { Cookie: cookie, Origin: 'http://localhost:3000', 'X-Device-Id': id }, json: { deviceId: id, platform: 'android' } })
    expect(r.status).toBe(403)
  })

  it('self-revoke requires a reason; afterwards the device is rejected (401) and Keycloak sessions are ended', async () => {
    const u = await makeUser(['pk-staff'], { label: 'self-revoke' })
    const sid = randomUUID()
    const t = await accessToken(u, ['pk-staff'], { sid })
    const dev = await registerDevice(u, t)
    expect((await http('POST', `/api/v1/devices/${dev}/revoke`, { headers: bearer(t, dev), json: {} })).status).toBe(400)
    const r = await http('POST', `/api/v1/devices/${dev}/revoke`, { headers: bearer(t, dev), json: { reason: 'HP hilang' } })
    expect(r.status).toBe(200)
    expect((r.body as { status: string }).status).toBe('revoked')
    expect((await http('GET', '/api/v1/me', { headers: bearer(t, dev) })).status).toBe(401)
    expect(kcCalls.filter((c) => c.op === 'deleteSession' && c.args[0] === sid).map((c) => c.args[1])).toEqual([true, false])
  })

  it("staff cannot revoke someone else's device (404); admin can (web session)", async () => {
    const u = await makeUser(['pk-staff'], { label: 'victim' })
    const t = await accessToken(u, ['pk-staff'])
    const dev = await registerDevice(u, t)
    expect((await http('POST', `/api/v1/devices/${dev}/revoke`, { headers: bearer(staffToken, staffDevice), json: { reason: 'iseng' } })).status).toBe(404)
    const cookie = await webSessionCookie(admin)
    const r = await http('POST', `/api/v1/devices/${dev}/revoke`, { headers: { Cookie: cookie, Origin: 'http://localhost:3000' }, json: { reason: 'dicabut admin' } })
    expect(r.status).toBe(200)
  })
})

describe('web session (oidcSession) and CSRF', () => {
  it('cookie session works on /api/v1 and generic REST; cross-origin POST is not authenticated', async () => {
    const cookie = await webSessionCookie(admin)
    expect((await http('GET', '/api/v1/me', { headers: { Cookie: cookie } })).status).toBe(200)
    const ok = await http('POST', '/api/uoms', { headers: { Cookie: cookie, Origin: 'http://localhost:3000' }, json: { code: 'WEB-1', name: 'web' } })
    expect(ok.status).toBe(201)
    const csrf = await http('POST', '/api/uoms', { headers: { Cookie: cookie, Origin: 'https://evil.test' }, json: { code: 'WEB-2', name: 'web' } })
    expect(csrf.status).toBe(403)
    const site = await http('POST', '/api/uoms', { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' }, json: { code: 'WEB-3', name: 'web' } })
    expect(site.status).toBe(403)
  })

  it('inactive user or revoked session → 401', async () => {
    const p = await getTestPayload()
    const u = await makeUser(['pk-finance'], { label: 'web-deact' })
    const cookie = await webSessionCookie(u)
    expect((await http('GET', '/api/v1/me', { headers: { Cookie: cookie } })).status).toBe(200)
    await p.update({ collection: 'users', id: u.id, data: { active: false, changeReason: 'cuti panjang' }, overrideAccess: true /* SYSTEM-WRITE: test */ })
    expect((await http('GET', '/api/v1/me', { headers: { Cookie: cookie } })).status).toBe(401)
    const s = await p.find({ collection: 'web-sessions', where: { user: { equals: u.id } }, overrideAccess: true /* SYSTEM-READ: assertion */ })
    expect(s.docs.every((d) => d.revokedAt)).toBe(true)
  })
})

describe('/api/v1 misc', () => {
  it('health is public; ready checks DB + media', async () => {
    expect((await http('GET', '/api/v1/health')).body).toEqual({ status: 'ok' })
    const ready = await http('GET', '/api/v1/health/ready')
    expect(ready.status).toBe(200)
    expect(ready.body).toEqual({ status: 'ok', checks: { db: true, media: true } })
  })

  it('HEAD health/ready: same status as GET, empty body, public (uptime monitors)', async () => {
    const h = await http('HEAD', '/api/v1/health')
    expect(h.status).toBe(200)
    expect(h.body).toBeNull()
    const ready = await http('HEAD', '/api/v1/health/ready')
    expect(ready.status).toBe(200)
    expect(ready.body).toBeNull()
    const media = process.env.MEDIA_DIR
    process.env.MEDIA_DIR = '/nonexistent/pk-head-media'
    try {
      const g = await http('GET', '/api/v1/health/ready')
      const hd = await http('HEAD', '/api/v1/health/ready')
      expect(g.status).toBe(503)
      expect(g.body).toEqual({ status: 'degraded', checks: { db: true, media: false } })
      expect(hd.status).toBe(503)
      expect(hd.body).toBeNull()
    } finally {
      process.env.MEDIA_DIR = media
    }
    // other v1 routes get no implicit HEAD
    expect((await http('HEAD', '/api/v1/me', { headers: bearer(staffToken, staffDevice) })).status).toBe(404)
  })

  it('openapi.json requires authentication outside development and is OpenAPI 3.1', async () => {
    expect((await http('GET', '/api/v1/openapi.json')).status).toBe(401)
    const r = await http('GET', '/api/v1/openapi.json', { headers: bearer(staffToken, staffDevice) })
    expect(r.status).toBe(200)
    expect((r.body as { openapi: string }).openapi).toBe('3.1.0')
    expect(Object.keys((r.body as { paths: object }).paths)).toEqual(expect.arrayContaining(['/me', '/masters', '/devices/register', '/devices/{id}/revoke']))
  })

  it('masters: access-filtered per type, unknown types rejected, delta via since', async () => {
    const r = await http('GET', '/api/v1/masters?types=uoms,employees,cash-accounts-x', { headers: bearer(staffToken, staffDevice) })
    expect(r.status).toBe(400)
    const ok = await http('GET', '/api/v1/masters?types=uoms,bank-accounts,projects', { headers: bearer(staffToken, staffDevice) })
    expect(ok.status).toBe(200)
    const types = (ok.body as { types: Record<string, { items: Array<Record<string, unknown>> }> }).types
    expect(types.uoms?.items.some((u) => u.code === 'API-L')).toBe(true)
    expect(types['bank-accounts']?.items).toEqual([]) // staff has no own account in this suite
    expect(types.projects?.items).toEqual([]) // no assignment
    const later = await http('GET', `/api/v1/masters?types=uoms&since=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`, { headers: bearer(staffToken, staffDevice) })
    expect((later.body as { types: { uoms: { items: unknown[] } } }).types.uoms.items).toEqual([])
  })

  it('custom endpoints reject anonymous callers (401 problem+json)', async () => {
    const r = await http('GET', '/api/v1/me')
    expect(r.status).toBe(401)
    expect(r.headers.get('content-type')).toContain('application/problem+json')
  })
})
