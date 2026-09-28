import { createHash, createHmac, randomBytes } from 'node:crypto'

import { decodeJwt } from 'jose'
import { describe, expect, it } from 'vitest'

import { createHttpKeycloakAdmin } from '@/auth/keycloak-admin'

/**
 * ADR 0017 against a REAL throwaway Keycloak 26.7.4 (realm pk-f1 from test-env/kc-setup.sh = default
 * flows, same structure as the drms exports). Drives the browser pages like a user would (HTML forms,
 * cookie jar) and checks what the web + APK code relies on:
 * - AIA `kc_action=CONFIGURE_TOTP` + `prompt=login`: re-login, QR page, back with kc_action_status
 *   (cancelled | success) and a code that exchanges;
 * - the service account (view-users) lists the OTP credential (metadata only);
 * - direct grant (APK): without / wrong / reused code → 400 invalid_grant "Invalid user credentials"
 *   (indistinguishable from a wrong password), correct `totp` form parameter → 200;
 * - AIA `delete_credential:<id>` + `prompt=login`: password AND code asked again, Keycloak's own
 *   confirmation page, then gone; a foreign/unknown id → kc_action_status=error.
 * Env: PK_KC_BASE, PK_KC_SA_SECRET, PK_KC_USER_PASSWORD, PK_KC_WEB_SECRET.
 */
const base = process.env.PK_KC_BASE!
const realm = 'pk-f1'
const USER = 'kc.tfa@drms.test'
const PW = process.env.PK_KC_USER_PASSWORD!
const RU = 'http://app.pk-f1.test/auth/callback'
const kc = createHttpKeycloakAdmin({ baseUrl: base, realm, clientId: 'proyekkas-admin-api', clientSecret: process.env.PK_KC_SA_SECRET! })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---- minimal browser -------------------------------------------------------------------------------
const jar = new Map<string, string>()
function store(res: Response) {
  for (const c of res.headers.getSetCookie()) {
    const kv = c.split(';')[0]!
    const i = kv.indexOf('=')
    const v = kv.slice(i + 1)
    if (v === '' || /Max-Age=0/i.test(c)) jar.delete(kv.slice(0, i))
    else jar.set(kv.slice(0, i), v)
  }
}
async function hit(url: string, form?: Record<string, string>): Promise<Response> {
  const res = await fetch(url, {
    redirect: 'manual',
    method: form ? 'POST' : 'GET',
    headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
  })
  store(res)
  return res
}
type Page = { cb?: URL; html: string; url: string }
async function go(url: string, form?: Record<string, string>): Promise<Page> {
  let res = await hit(url, form)
  while ([301, 302, 303].includes(res.status)) {
    const loc = new URL(res.headers.get('location')!, url).toString()
    if (loc.startsWith(RU)) return { cb: new URL(loc), html: '', url: loc }
    url = loc
    res = await hit(url)
  }
  return { html: await res.text(), url }
}
const action = (p: Page) => p.html.match(/<form[^>]*action="([^"]+)"/)![1]!.replace(/&amp;/g, '&')
const template = (p: Page) => p.html.match(/<!-- template: ([\w.-]+)/)?.[1]
function hidden(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const n = m[0].match(/name="([^"]+)"/)?.[1]
    if (n) out[n] = m[0].match(/value="([^"]*)"/)?.[1] ?? ''
  }
  return out
}

function authorize(extra: Record<string, string>) {
  const verifier = randomBytes(32).toString('base64url')
  const u = new URL(`${base}/realms/${realm}/protocol/openid-connect/auth`)
  const p = { client_id: 'proyekkas-web', redirect_uri: RU, response_type: 'code', scope: 'openid', state: randomBytes(8).toString('hex'), nonce: 'n', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', ...extra }
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v)
  return { url: u.toString(), verifier }
}
async function exchange(cb: URL, verifier: string) {
  const res = await fetch(`${base}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`proyekkas-web:${process.env.PK_KC_WEB_SECRET}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: cb.searchParams.get('code')!, redirect_uri: RU, code_verifier: verifier }),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as { id_token: string }
}

// ---- RFC 6238 (HmacSHA1, 6 digits, 30 s = realm OTP policy) ------------------------------------------
function base32(s: string): Buffer {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of s.replace(/[\s=]/g, '').toUpperCase()) bits += a.indexOf(ch).toString(2).padStart(5, '0')
  const out: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(out)
}
function totp(key: Buffer, t = Date.now()): string {
  const c = Buffer.alloc(8)
  c.writeBigUInt64BE(BigInt(Math.floor(t / 30_000)))
  const h = createHmac('sha1', key).update(c).digest()
  const o = h[19]! & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}
/** Waits for the next 30 s window (codes are single-use: otpPolicyCodeReusable=false). */
async function nextWindow() {
  await sleep(30_000 - (Date.now() % 30_000) + 500)
}

async function directGrant(extra: Record<string, string> = {}) {
  const res = await fetch(`${base}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'proyekkas-mobile', username: USER, password: PW, scope: 'openid', ...extra }),
  })
  const body = (await res.json()) as { error?: string; error_description?: string }
  return { status: res.status, error: body.error, description: body.error_description }
}

describe('ADR 0017 optional self-service 2FA — Keycloak 26.7.4 (real server)', () => {
  let userId = ''
  let key: Buffer = Buffer.alloc(0)
  let credentialId = ''
  let firstSid = ''

  it('login without 2FA; no OTP credential listed; direct grant needs no code', async () => {
    userId = (await kc.findUserByEmail(USER))!.id
    expect(await kc.listUserCredentials(userId)).toEqual([])
    const a = authorize({})
    const login = await go(a.url)
    const back = await go(action(login), { username: USER, password: PW })
    firstSid = decodeJwt((await exchange(back.cb!, a.verifier)).id_token).sid as string
    expect((await directGrant()).status).toBe(200)
  })

  it('AIA CONFIGURE_TOTP + prompt=login: cancel → kc_action_status=cancelled (code still exchanges)', async () => {
    const a = authorize({ kc_action: 'CONFIGURE_TOTP', prompt: 'login', login_hint: USER })
    const relogin = await go(a.url)
    expect(template(relogin)).toBe('login.ftl') // prompt=login: password asked again despite the SSO cookie
    const setup = await go(action(relogin), { username: USER, password: PW })
    expect(template(setup)).toBe('login-config-totp.ftl')
    const back = await go(action(setup), { ...hidden(setup.html), 'cancel-aia': 'true' })
    expect(back.cb?.searchParams.get('kc_action_status')).toBe('cancelled')
    await exchange(back.cb!, a.verifier)
    expect(await kc.listUserCredentials(userId)).toEqual([])
  })

  it('AIA CONFIGURE_TOTP + prompt=login: scan (manual key) + first code → success; Admin API lists metadata only', async () => {
    const a = authorize({ kc_action: 'CONFIGURE_TOTP', prompt: 'login', login_hint: USER })
    const relogin = await go(a.url)
    const setup = await go(action(relogin), { username: USER, password: PW })
    const manual = await go(`${setup.url}${setup.url.includes('?') ? '&' : '?'}mode=manual`)
    key = base32(manual.html.match(/id="kc-totp-secret-key"[^>]*>([^<]+)</)![1]!)
    const back = await go(action(manual), { ...hidden(manual.html), totp: totp(key), userLabel: 'HP uji' })
    expect(back.cb?.searchParams.get('kc_action')).toBe('CONFIGURE_TOTP')
    expect(back.cb?.searchParams.get('kc_action_status')).toBe('success')
    const sid = decodeJwt((await exchange(back.cb!, a.verifier)).id_token).sid
    console.info(`prompt=login kept the SSO session: ${sid === firstSid}`)
    const list = await kc.listUserCredentials(userId)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ type: 'otp', userLabel: 'HP uji' })
    expect(Object.keys(list[0]!).sort()).toEqual(['createdDate', 'id', 'type', 'userLabel'])
    credentialId = list[0]!.id
  })

  it('direct grant (APK): missing / wrong / reused code → 400 invalid_grant like a wrong password; `totp` → 200', { timeout: 120_000 }, async () => {
    await nextWindow() // the enrolment code must not be reused
    const denied = { status: 400, error: 'invalid_grant', description: 'Invalid user credentials' }
    expect(await directGrant()).toEqual(denied)
    await sleep(1500) // brute-force quick-login check: two failures < 1 s apart → temporary lockout
    expect(await directGrant({ totp: '000000' })).toEqual(denied)
    await sleep(1500)
    expect(await directGrant({ password: 'wrong-password', totp: totp(key) })).toEqual(denied)
    await sleep(1500)
    const code = totp(key)
    expect((await directGrant({ totp: code })).status).toBe(200)
    await sleep(1500)
    expect(await directGrant({ totp: code })).toEqual(denied) // single use
  })

  it('AIA delete_credential of an unknown / foreign id → kc_action_status=error', async () => {
    const a = authorize({ kc_action: 'delete_credential:00000000-0000-4000-8000-000000000000' })
    const back = await go(a.url)
    expect(back.cb?.searchParams.get('kc_action_status')).toBe('error')
  })

  it('AIA delete_credential:<own id> + prompt=login: password AND code again, Keycloak confirmation, then removed', { timeout: 120_000 }, async () => {
    await nextWindow()
    const a = authorize({ kc_action: `delete_credential:${credentialId}`, prompt: 'login', login_hint: USER })
    const relogin = await go(a.url)
    expect(template(relogin)).toBe('login.ftl')
    const otpPage = await go(action(relogin), { username: USER, password: PW })
    expect(template(otpPage)).toBe('login-otp.ftl')
    const confirm = await go(action(otpPage), { otp: totp(key) })
    expect(template(confirm)).toBe('delete-credential.ftl')
    expect(confirm.html).toContain('HP uji')
    const back = await go(action(confirm), { accept: '' })
    expect(back.cb?.searchParams.get('kc_action')).toBe('delete_credential')
    expect(back.cb?.searchParams.get('kc_action_status')).toBe('success')
    await exchange(back.cb!, a.verifier)
    expect(await kc.listUserCredentials(userId)).toEqual([])
    await sleep(1500)
    expect((await directGrant()).status).toBe(200) // back to password only
  })
})
