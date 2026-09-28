import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { POST as accountAction } from '@/app/(auth)/auth/account-action/route'
import { GET as oidcCallback } from '@/app/(auth)/auth/callback/route'
import { setKeycloakAdmin, type OtpCredential } from '@/auth/keycloak-admin'
import { setAiaOidcPortForTests } from '@/auth/two-factor'
import { resetRateLimits } from '@/lib/rate-limit'

import { accessToken, installLocalJwks, makeUser, sqlAs, webSessionCookie, type TestUser } from './helpers'

/**
 * ADR 0017 — optional self-service 2FA (web). Keycloak is mocked: the Admin API (credential
 * metadata per subject) and the OIDC port (authorization URL + code exchange). What is tested here:
 * CSRF/ownership/rate-limit guards of POST /auth/account-action, the AIA request parameters, and the
 * return leg in /auth/callback (own cookie + state; no second web session / login row; audit
 * 2fa_enabled / 2fa_disabled only for a VERIFIED change of the caller's own account).
 * The real Keycloak round trip is covered by tests/kc/two-factor.kc.test.ts.
 */
const ORIGIN = 'http://localhost:3000'
const creds = new Map<string, OtpCredential[]>()
let adminDown = false
let exchangeSub: string | undefined
let authParams: Record<string, string> = {}

const otp = (id: string, label = 'HP uji'): OtpCredential => ({ id, type: 'otp', userLabel: label, createdDate: Date.now() })

function installFakes() {
  // Only the credential listing is used on this path; every other Admin API call is a no-op.
  setKeycloakAdmin(
    new Proxy({} as never, {
      get: (_t, prop) => {
        if (prop === 'listUserCredentials')
          return async (id: string) => {
            if (adminDown) throw new Error('kc down')
            return creds.get(id) ?? []
          }
        return async () => undefined
      },
    }),
  )
  setAiaOidcPortForTests({
    async authorizationUrl(params) {
      authParams = params
      const u = new URL('http://kc.pk-f1.test/realms/drms-test/protocol/openid-connect/auth')
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
      return u
    },
    async exchange(_url, check) {
      if (!exchangeSub) throw new Error('bad code')
      return { sub: exchangeSub, sid: 'sid-after-reauth', idToken: `id-token-for-${check.state.slice(0, 4)}` }
    },
  })
}

async function start(cookie: string | null, form: Record<string, string>, headers: Record<string, string> = { origin: ORIGIN }) {
  return accountAction(
    new NextRequest(`${ORIGIN}/auth/account-action`, {
      method: 'POST',
      headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(form).toString(),
    }),
  )
}

function aiaCookie(res: Response): string {
  const c = res.headers.getSetCookie().find((x) => x.startsWith('pk_aia_tx='))
  if (!c) throw new Error('no aia cookie')
  return c.split(';')[0]!
}

async function callback(cookie: string, query: Record<string, string>) {
  const q = new URLSearchParams(query).toString()
  return oidcCallback(new NextRequest(`${ORIGIN}/auth/callback?${q}`, { headers: { cookie } }))
}

const statusOf = (res: Response) => new URL(res.headers.get('location') ?? 'http://x/').searchParams.get('status')

async function count(sql: string, params: unknown[]) {
  return (await sqlAs('app', sql, params)).rows[0].n as number
}

describe('optional self-service 2FA (web, Keycloak mocked)', () => {
  let alice: TestUser
  let bob: TestUser
  let aliceCookie: string
  let bobCookie: string

  beforeAll(async () => {
    installFakes()
    await installLocalJwks()
    alice = await makeUser(['pk-staff'], { label: 'tfa-alice' })
    bob = await makeUser(['pk-pm'], { label: 'tfa-bob' })
    aliceCookie = await webSessionCookie(alice)
    bobCookie = await webSessionCookie(bob)
  })
  afterAll(() => {
    setAiaOidcPortForTests(undefined)
    setKeycloakAdmin(undefined)
  })
  beforeEach(() => {
    resetRateLimits()
    adminDown = false
    exchangeSub = undefined
    creds.clear()
  })

  it('start: cross-site / missing Origin → 403; no session or a bearer token only → forbidden', async () => {
    expect((await start(aliceCookie, { action: 'enable' }, {})).status).toBe(403)
    expect((await start(aliceCookie, { action: 'enable' }, { origin: 'https://evil.test' })).status).toBe(403)
    expect((await start(aliceCookie, { action: 'enable' }, { origin: ORIGIN, 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    const anon = await start(null, { action: 'enable' })
    expect(anon.status).toBe(303)
    expect(statusOf(anon)).toBe('forbidden')
    const token = await accessToken(alice, ['pk-staff'])
    const bearer = await start(null, { action: 'enable' }, { origin: ORIGIN, authorization: `Bearer ${token}` })
    expect(statusOf(bearer)).toBe('forbidden')
  })

  it('enable: 303 to Keycloak with kc_action=CONFIGURE_TOTP + prompt=login + PKCE; own tx cookie; already active → no round trip', async () => {
    const res = await start(aliceCookie, { action: 'enable' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toMatch(/^http:\/\/kc\.pk-f1\.test\//)
    expect(authParams).toMatchObject({
      kc_action: 'CONFIGURE_TOTP',
      prompt: 'login',
      scope: 'openid',
      code_challenge_method: 'S256',
      redirect_uri: `${ORIGIN}/auth/callback`,
      login_hint: alice.email,
    })
    expect(authParams.state).toBeTruthy()
    expect(authParams.nonce).toBeTruthy()
    const setCookie = res.headers.getSetCookie().find((x) => x.startsWith('pk_aia_tx='))!
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/SameSite=Lax/)
    expect(setCookie).not.toMatch(/pk_oidc_tx/)

    creds.set(alice.keycloakSub, [otp('otp-alice-0001')])
    expect(statusOf(await start(aliceCookie, { action: 'enable' }))).toBe('already_active')
  })

  it('disable: only one of the caller’s OWN credential ids; unknown status → unavailable; bad input → invalid', async () => {
    creds.set(alice.keycloakSub, [otp('otp-alice-0001')])
    creds.set(bob.keycloakSub, [otp('otp-bob-00000001')])
    expect(statusOf(await start(aliceCookie, { action: 'disable', credentialId: 'otp-bob-00000001' }))).toBe('invalid')
    expect(statusOf(await start(aliceCookie, { action: 'disable', credentialId: '../../x' }))).toBe('invalid')
    expect(statusOf(await start(aliceCookie, { action: 'disable' }))).toBe('invalid')
    expect(statusOf(await start(aliceCookie, { action: 'nope' }))).toBe('invalid')
    const ok = await start(aliceCookie, { action: 'disable', credentialId: 'otp-alice-0001' })
    expect(ok.status).toBe(303)
    expect(authParams).toMatchObject({ kc_action: 'delete_credential:otp-alice-0001', prompt: 'login' })
    adminDown = true
    expect(statusOf(await start(aliceCookie, { action: 'disable', credentialId: 'otp-alice-0001' }))).toBe('unavailable')
  })

  it('rate limit: 6 starts per 10 minutes per user', async () => {
    for (let i = 0; i < 6; i++) expect(statusOf(await start(aliceCookie, { action: 'enable' }))).toBeNull()
    expect(statusOf(await start(aliceCookie, { action: 'enable' }))).toBe('rate_limited')
    expect(statusOf(await start(bobCookie, { action: 'enable' }))).toBeNull()
  })

  it('return leg (enable, verified): page ?status=enabled, tx cookie cleared, 2fa_enabled audit, NO new web session / login row', async () => {
    const res = await start(aliceCookie, { action: 'enable' })
    const tx = aiaCookie(res)
    const sessionsBefore = await count('SELECT count(*)::int AS n FROM web_sessions WHERE user_id = $1', [alice.id])
    const loginsBefore = await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'login' AND user_id = $1", [alice.id])
    creds.set(alice.keycloakSub, [otp('otp-alice-new1', 'HP Alice')])
    exchangeSub = alice.keycloakSub
    const back = await callback(`${aliceCookie}; ${tx}`, { code: 'c', state: authParams.state!, kc_action: 'CONFIGURE_TOTP', kc_action_status: 'success' })
    expect(back.status).toBe(303)
    expect(back.headers.get('location')).toBe(`${ORIGIN}/admin/keamanan-akun?status=enabled`)
    expect(back.headers.getSetCookie().some((c) => c.startsWith('pk_aia_tx=;') && /Max-Age=0/.test(c))).toBe(true)
    expect(back.headers.getSetCookie().some((c) => c.startsWith('pk_session='))).toBe(false)
    expect(await count('SELECT count(*)::int AS n FROM web_sessions WHERE user_id = $1', [alice.id])).toBe(sessionsBefore)
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'login' AND user_id = $1", [alice.id])).toBe(loginsBefore)
    const rows = await sqlAs('app', "SELECT doc_type, doc_id, field, new_value, source FROM audit_logs WHERE action = '2fa_enabled' AND user_id = $1", [alice.id])
    expect(rows.rows).toEqual([
      { doc_type: 'user', doc_id: String(alice.id), field: 'two_factor', new_value: { v: { authenticator: 'HP Alice', verifiedByAdminApi: true } }, source: 'web' },
    ])
    // the web session follows the re-authenticated Keycloak session (id_token hint for logout)
    const s = await sqlAs('app', "SELECT id FROM web_sessions WHERE user_id = $1 AND id_token_hint LIKE 'id-token-for-%'", [alice.id])
    expect(s.rows.length).toBe(1)
    // replaying the same return URL: the tx cookie is gone → normal login callback → refused
    expect((await callback(aliceCookie, { code: 'c', state: authParams.state! })).status).toBe(400)
  })

  it('cancelled / not verified / other subject / other session → no audit row', async () => {
    const auditCount = () => count("SELECT count(*)::int AS n FROM audit_logs WHERE action IN ('2fa_enabled','2fa_disabled') AND user_id = $1", [bob.id])
    const base = await auditCount()

    let tx = aiaCookie(await start(bobCookie, { action: 'enable' }))
    exchangeSub = bob.keycloakSub
    expect(statusOf(await callback(`${bobCookie}; ${tx}`, { code: 'c', state: authParams.state!, kc_action_status: 'cancelled' }))).toBe('cancelled')

    // Keycloak says success but no new credential is listed → error
    tx = aiaCookie(await start(bobCookie, { action: 'enable' }))
    expect(statusOf(await callback(`${bobCookie}; ${tx}`, { code: 'c', state: authParams.state!, kc_action_status: 'success' }))).toBe('error')

    // someone else authenticated at Keycloak in this browser
    tx = aiaCookie(await start(bobCookie, { action: 'enable' }))
    creds.set(bob.keycloakSub, [otp('otp-bob-new-0001')])
    exchangeSub = alice.keycloakSub
    expect(statusOf(await callback(`${bobCookie}; ${tx}`, { code: 'c', state: authParams.state!, kc_action_status: 'success' }))).toBe('error')

    // Bob's tx presented with Alice's session cookie
    creds.clear()
    tx = aiaCookie(await start(bobCookie, { action: 'enable' }))
    exchangeSub = bob.keycloakSub
    creds.set(bob.keycloakSub, [otp('otp-bob-new-0002')])
    expect(statusOf(await callback(`${aliceCookie}; ${tx}`, { code: 'c', state: authParams.state!, kc_action_status: 'success' }))).toBe('forbidden')

    // Keycloak error response (e.g. failed re-authentication)
    creds.clear()
    tx = aiaCookie(await start(bobCookie, { action: 'enable' }))
    expect(statusOf(await callback(`${bobCookie}; ${tx}`, { error: 'access_denied', state: authParams.state! }))).toBe('error')

    // state mismatch → not ours: the normal login callback answers (no login tx → 400)
    tx = aiaCookie(await start(bobCookie, { action: 'enable' }))
    expect((await callback(`${bobCookie}; ${tx}`, { code: 'c', state: 'other-state' })).status).toBe(400)

    expect(await auditCount()).toBe(base)
  })

  it('return leg (disable, verified): ?status=disabled and a 2fa_disabled row', async () => {
    creds.set(bob.keycloakSub, [otp('otp-bob-00000001')])
    const tx = aiaCookie(await start(bobCookie, { action: 'disable', credentialId: 'otp-bob-00000001' }))
    creds.set(bob.keycloakSub, [])
    exchangeSub = bob.keycloakSub
    const back = await callback(`${bobCookie}; ${tx}`, { code: 'c', state: authParams.state!, kc_action: 'delete_credential', kc_action_status: 'success' })
    expect(statusOf(back)).toBe('disabled')
    const rows = await sqlAs('app', "SELECT new_value FROM audit_logs WHERE action = '2fa_disabled' AND user_id = $1", [bob.id])
    expect(rows.rows).toEqual([{ new_value: { v: { remainingAuthenticators: 0, verifiedByAdminApi: true } } }])
  })
})
