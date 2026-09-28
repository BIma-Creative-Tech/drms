import { createHash } from 'node:crypto'

import config from '@payload-config'
import { EncryptJWT, jwtDecrypt } from 'jose'
import * as client from 'openid-client'
import { createLocalReq, getPayload, type Payload } from 'payload'

import { writeAudit } from '@/audit/writer'
import { getEnv } from '@/lib/env'
import { takeToken } from '@/lib/rate-limit'
import { withReqTransaction } from '@/lib/system-tx'

import { hashSessionId, readCookie, serializeCookie, sessionCookieName } from './cookies'
import { getKeycloakAdmin, type OtpCredential } from './keycloak-admin'
import { getWebOidcConfig, redirectUri } from './oidc'

/**
 * Optional self-service 2FA (TOTP) for the web — ADR 0017. Each user turns it on/off for their OWN
 * account on /admin/keamanan-akun; nobody enforces it. The app never sees a TOTP secret or code:
 *
 * - enable  = Keycloak application-initiated action (AIA) `kc_action=CONFIGURE_TOTP` (QR on the
 *   Keycloak page, the user confirms with a first code);
 * - disable = AIA `kc_action=delete_credential:<id>` — Keycloak checks that the credential belongs
 *   to the authenticated user and shows its own confirmation page.
 * Both requests carry `prompt=login`: Keycloak re-authenticates the user (password AND, with 2FA
 * active, the current code) right before the action, so a stolen/unattended web session alone cannot
 * add or remove a factor. No Admin API write is needed (the service account only lists metadata).
 *
 * The round trip reuses the registered redirect URI `/auth/callback`. Its transaction lives in a
 * SEPARATE encrypted cookie (pk_aia_tx, own derived key) bound to the user, the Keycloak subject and
 * the web session; the callback hands over to handleAccountActionCallback when `state` matches, which
 * exchanges the code (PKCE + nonce checked), verifies the outcome through the Admin API, writes the
 * audit row (2fa_enabled / 2fa_disabled) and returns to the page — no second web session, no
 * `login` audit row.
 */

export const SECURITY_PATH = '/admin/keamanan-akun'
export type TwoFactorAction = 'enable' | 'disable'
export type TwoFactorResult =
  | 'enabled'
  | 'disabled'
  | 'cancelled'
  | 'error'
  | 'already_active'
  | 'invalid'
  | 'rate_limited'
  | 'unavailable'
  | 'forbidden'

/** Bahasa Indonesia messages for `?status=` on the page (unknown values are ignored). */
export const RESULT_MESSAGES: Record<TwoFactorResult, { tone: 'ok' | 'warn' | 'bad'; text: string }> = {
  enabled: { tone: 'ok', text: '2FA aktif. Mulai login berikutnya, masukkan kode dari aplikasi autentikator setelah kata sandi.' },
  disabled: { tone: 'ok', text: '2FA dinonaktifkan. Login berikutnya cukup dengan email dan kata sandi.' },
  cancelled: { tone: 'warn', text: 'Dibatalkan. Tidak ada perubahan pada 2FA Anda.' },
  error: { tone: 'bad', text: 'Perubahan 2FA gagal atau tidak dapat dipastikan. Periksa status di bawah lalu coba lagi.' },
  already_active: { tone: 'warn', text: '2FA sudah aktif di akun Anda.' },
  invalid: { tone: 'bad', text: 'Permintaan tidak valid. Muat ulang halaman lalu coba lagi.' },
  rate_limited: { tone: 'bad', text: 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.' },
  unavailable: { tone: 'bad', text: 'Status 2FA tidak dapat diperiksa saat ini, jadi 2FA belum dapat dinonaktifkan. Coba lagi nanti atau hubungi Admin.' },
  forbidden: { tone: 'bad', text: 'Sesi Anda tidak valid. Silakan login ulang.' },
}

export function isTwoFactorResult(v: unknown): v is TwoFactorResult {
  return typeof v === 'string' && Object.hasOwn(RESULT_MESSAGES, v)
}

// ------------------------------------------------------------------------------------ status

export type TwoFactorStatus =
  | { state: 'active'; authenticators: OtpCredential[] }
  | { state: 'inactive'; authenticators: [] }
  | { state: 'unknown'; authenticators: [] }

/** Status from Keycloak (Admin API, metadata only). Never throws: unreachable/not configured → unknown. */
export async function getTwoFactorStatus(keycloakSub: string | null | undefined, log?: Payload['logger']): Promise<TwoFactorStatus> {
  if (!keycloakSub) return { state: 'unknown', authenticators: [] }
  try {
    const creds = await getKeycloakAdmin().listUserCredentials(keycloakSub)
    return creds.length > 0 ? { state: 'active', authenticators: creds } : { state: 'inactive', authenticators: [] }
  } catch (err) {
    log?.warn({ msg: '2fa status unavailable', err: (err as Error).message })
    return { state: 'unknown', authenticators: [] }
  }
}

// ------------------------------------------------------------------------------------ transaction cookie

type AiaTx = {
  state: string
  nonce: string
  verifier: string
  action: TwoFactorAction
  credentialId?: string
  userId: number
  sub: string
  /** sha256 of the web session id the action was started from. */
  sessionHash: string
  /** OTP credential ids before the action (null = could not be listed). */
  before: string[] | null
}

export function aiaTxCookieName(insecure: boolean): string {
  return insecure ? 'pk_aia_tx' : '__Host-pk_aia_tx'
}

function aiaKey(): Uint8Array {
  return createHash('sha256').update(`pk-oidc-aia:${getEnv().PAYLOAD_SECRET}`).digest()
}

export async function sealAiaTx(tx: AiaTx): Promise<string> {
  return new EncryptJWT({ ...tx }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setIssuedAt().setExpirationTime('10m').encrypt(aiaKey())
}

export async function openAiaTx(value: string): Promise<AiaTx> {
  const { payload: p } = await jwtDecrypt(value, aiaKey(), { maxTokenAge: '10m' })
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : undefined)
  const action = str('action')
  const state = str('state')
  const nonce = str('nonce')
  const verifier = str('verifier')
  const sub = str('sub')
  const sessionHash = str('sessionHash')
  if (!state || !nonce || !verifier || !sub || !sessionHash || (action !== 'enable' && action !== 'disable') || typeof p.userId !== 'number') {
    throw new Error('invalid aia tx')
  }
  const before = Array.isArray(p.before) ? p.before.filter((x): x is string => typeof x === 'string') : null
  return { state, nonce, verifier, action, credentialId: str('credentialId'), userId: p.userId, sub, sessionHash, before }
}

// ------------------------------------------------------------------------------------ OIDC port (test seam)

export type AiaOidcPort = {
  authorizationUrl(params: Record<string, string>): Promise<URL>
  /** Code exchange with PKCE/state/nonce checks; returns the ID token subject (+ sid, raw id_token). */
  exchange(currentUrl: URL, check: { verifier: string; state: string; nonce: string }): Promise<{ sub: string; sid?: string; idToken?: string }>
}

const defaultPort: AiaOidcPort = {
  async authorizationUrl(params) {
    return client.buildAuthorizationUrl(await getWebOidcConfig(), params)
  },
  async exchange(currentUrl, check) {
    const tokens = await client.authorizationCodeGrant(await getWebOidcConfig(), currentUrl, {
      pkceCodeVerifier: check.verifier,
      expectedState: check.state,
      expectedNonce: check.nonce,
      idTokenExpected: true,
    })
    const claims = tokens.claims()
    if (!claims?.sub) throw new Error('no subject')
    return { sub: claims.sub, sid: typeof claims.sid === 'string' ? claims.sid : undefined, idToken: tokens.id_token }
  },
}

let port: AiaOidcPort = defaultPort
export function setAiaOidcPortForTests(p: AiaOidcPort | undefined): void {
  port = p ?? defaultPort
}

// ------------------------------------------------------------------------------------ helpers

const CREDENTIAL_ID = /^[A-Za-z0-9-]{8,64}$/

type WebUser = { id: number; email?: string | null; keycloakSub?: string | null; roles?: unknown }

function redirectTo(result: TwoFactorResult, extraCookies: string[] = []): Response {
  const headers = new Headers({ Location: new URL(`${SECURITY_PATH}?status=${result}`, getEnv().APP_URL).toString(), 'Cache-Control': 'no-store' })
  for (const c of extraCookies) headers.append('Set-Cookie', c)
  return new Response(null, { status: 303, headers })
}

/** Same-origin form post only (CSRF): Origin must be the app; Sec-Fetch-Site, when sent, same-origin. */
export function isSameOriginPost(headers: Headers): boolean {
  const appOrigin = new URL(getEnv().APP_URL).origin
  const fetchSite = headers.get('sec-fetch-site')
  return headers.get('origin') === appOrigin && (!fetchSite || fetchSite === 'same-origin')
}

/** The logged-in WEB user (session cookie strategy only — never a bearer token) + its session hash. */
async function currentWebUser(payload: Payload, headers: Headers): Promise<{ user: WebUser; sessionHash: string } | null> {
  const env = getEnv()
  const raw = readCookie(headers.get('cookie'), sessionCookieName(env.AUTH_COOKIE_INSECURE))
  if (!raw) return null
  const { user } = await payload.auth({ headers })
  const u = user as (WebUser & { _strategy?: string; collection?: string }) | null
  if (!u || u.collection !== 'users' || u._strategy !== 'oidcSession' || typeof u.id !== 'number') return null
  return { user: u, sessionHash: hashSessionId(raw) }
}

async function audit(payload: Payload, headers: Headers, user: WebUser, action: '2fa_enabled' | '2fa_disabled', info: Record<string, unknown>): Promise<void> {
  try {
    const req = await createLocalReq({ req: { headers } as never, user: { ...user, collection: 'users' } as never, context: { auditSource: 'web' } }, payload)
    await withReqTransaction(req, () =>
      writeAudit(req, [{ action, docType: 'user', docId: String(user.id), field: 'two_factor', newValue: info }], user as never),
    )
  } catch (err) {
    payload.logger.error({ msg: '2fa audit write failed', action, err: (err as Error).message })
  }
}

// ------------------------------------------------------------------------------------ start

/**
 * POST /auth/account-action (form: action=enable|disable, credentialId for disable). Same-origin,
 * logged-in web user only, ≤ 6 starts per 10 min per user. The credential to delete must be one of
 * the caller's OWN OTP credentials as listed by Keycloak (Keycloak re-checks ownership).
 */
export async function startAccountAction(request: Request): Promise<Response> {
  const env = getEnv()
  if (!isSameOriginPost(request.headers)) return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } })
  const payload = await getPayload({ config })
  const me = await currentWebUser(payload, request.headers)
  if (!me || !me.user.keycloakSub) return redirectTo('forbidden')
  const { user, sessionHash } = me
  const sub = me.user.keycloakSub
  if (!takeToken(`2fa-start:${user.id}`, 6, 10 * 60_000)) return redirectTo('rate_limited')

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return redirectTo('invalid')
  }
  const action = form.get('action')
  if (action !== 'enable' && action !== 'disable') return redirectTo('invalid')

  const status = await getTwoFactorStatus(sub, payload.logger)
  let credentialId: string | undefined
  if (action === 'enable') {
    if (status.state === 'active') return redirectTo('already_active')
  } else {
    // Deleting needs a verified list: the id is only accepted when it is one of THIS user's credentials.
    if (status.state === 'unknown') return redirectTo('unavailable')
    const wanted = form.get('credentialId')
    if (typeof wanted !== 'string' || !CREDENTIAL_ID.test(wanted)) return redirectTo('invalid')
    const own = status.authenticators.find((c) => c.id === wanted)
    if (!own) return redirectTo('invalid')
    credentialId = own.id
  }

  const verifier = client.randomPKCECodeVerifier()
  const state = client.randomState()
  const nonce = client.randomNonce()
  const url = await port.authorizationUrl({
    redirect_uri: redirectUri(),
    scope: 'openid',
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
    nonce,
    prompt: 'login',
    kc_action: action === 'enable' ? 'CONFIGURE_TOTP' : `delete_credential:${credentialId}`,
    ...(user.email ? { login_hint: user.email } : {}),
  })
  const sealed = await sealAiaTx({
    state,
    nonce,
    verifier,
    action,
    credentialId,
    userId: user.id,
    sub,
    sessionHash,
    before: status.state === 'unknown' ? null : status.authenticators.map((c) => c.id),
  })
  const headers = new Headers({ Location: url.toString(), 'Cache-Control': 'no-store' })
  headers.append('Set-Cookie', serializeCookie(aiaTxCookieName(env.AUTH_COOKIE_INSECURE), sealed, { maxAge: 600, insecure: env.AUTH_COOKIE_INSECURE }))
  return new Response(null, { status: 303, headers })
}

// ------------------------------------------------------------------------------------ callback

/**
 * Called first by GET /auth/callback. Returns null when this is not an account-action round trip
 * (no pk_aia_tx cookie, or its state does not match) — the normal login callback then runs.
 */
export async function handleAccountActionCallback(request: Request): Promise<Response | null> {
  const env = getEnv()
  const cookieName = aiaTxCookieName(env.AUTH_COOKIE_INSECURE)
  const raw = readCookie(request.headers.get('cookie'), cookieName)
  if (!raw) return null
  const reqUrl = new URL(request.url)
  let tx: AiaTx
  try {
    tx = await openAiaTx(raw)
  } catch {
    return null
  }
  if (reqUrl.searchParams.get('state') !== tx.state) return null

  const clear = serializeCookie(cookieName, '', { maxAge: 0, insecure: env.AUTH_COOKIE_INSECURE })
  const payload = await getPayload({ config })
  const me = await currentWebUser(payload, request.headers)
  if (!me || me.user.id !== tx.userId || me.sessionHash !== tx.sessionHash || me.user.keycloakSub !== tx.sub) {
    payload.logger.warn({ msg: '2fa callback: session/user mismatch' })
    return redirectTo('forbidden', [clear])
  }
  const kcStatus = reqUrl.searchParams.get('kc_action_status')
  if (reqUrl.searchParams.get('error')) return redirectTo(kcStatus === 'cancelled' ? 'cancelled' : 'error', [clear])

  let exchanged: { sub: string; sid?: string; idToken?: string }
  try {
    // Public callback URL (behind Traefik request.url may be internal), like the login callback.
    exchanged = await port.exchange(new URL(reqUrl.pathname + reqUrl.search, env.APP_URL), { verifier: tx.verifier, state: tx.state, nonce: tx.nonce })
  } catch (err) {
    payload.logger.warn({ msg: '2fa callback: code exchange failed', err: (err as Error).message })
    return redirectTo('error', [clear])
  }
  if (exchanged.sub !== tx.sub) {
    // Someone else authenticated at Keycloak (shared browser): nothing is recorded for this user.
    payload.logger.warn({ msg: '2fa callback: subject mismatch' })
    return redirectTo('error', [clear])
  }
  await refreshSessionHint(payload, tx.sessionHash, exchanged)

  if (kcStatus === 'cancelled') return redirectTo('cancelled', [clear])
  const after = await getTwoFactorStatus(tx.sub, payload.logger)
  if (tx.action === 'enable') {
    const added = after.authenticators.filter((c) => !(tx.before ?? []).includes(c.id))
    const verified = after.state !== 'unknown' && tx.before !== null ? added.length > 0 : null
    if (verified === false || (verified === null && kcStatus !== 'success')) return redirectTo('error', [clear])
    await audit(payload, request.headers, me.user, '2fa_enabled', {
      authenticator: added[0]?.userLabel ?? null,
      verifiedByAdminApi: verified === true,
    })
    return redirectTo('enabled', [clear])
  }
  const stillThere = after.state === 'unknown' ? null : after.authenticators.some((c) => c.id === tx.credentialId)
  if (stillThere === true || (stillThere === null && kcStatus !== 'success')) return redirectTo('error', [clear])
  await audit(payload, request.headers, me.user, '2fa_disabled', {
    remainingAuthenticators: after.state === 'unknown' ? null : after.authenticators.length,
    verifiedByAdminApi: stillThere === false,
  })
  return redirectTo('disabled', [clear])
}

/**
 * `prompt=login` re-authenticates at Keycloak: keep the web session's id_token hint (used for
 * RP-initiated logout) in step with the latest ID token. `keycloak_sid` is immutable by design
 * (DB trigger, security migration) and stays the login's. Best effort.
 */
async function refreshSessionHint(payload: Payload, sessionHash: string, t: { idToken?: string }): Promise<void> {
  if (!t.idToken) return
  try {
    const found = await payload.find({ collection: 'web-sessions', where: { idHash: { equals: sessionHash } }, limit: 1, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ */ })
    const s = found.docs[0]
    if (!s) return
    await payload.update({
      collection: 'web-sessions',
      id: s.id,
      data: { idTokenHint: t.idToken },
      depth: 0,
      overrideAccess: true, // SYSTEM-WRITE: id_token hint refresh after re-authentication
    })
  } catch (err) {
    payload.logger.warn({ msg: '2fa callback: session hint refresh failed', err: (err as Error).message })
  }
}
