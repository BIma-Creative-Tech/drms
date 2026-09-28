import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'
import type { AuthStrategy, AuthStrategyResult, Payload } from 'payload'

import { attachCompanyContext, COMPANY_DENIED_KEY } from '@/access/company-context'
import { isRole, LOGIN_ROLE } from '@/access/roles'
import { getEnv } from '@/lib/env'

import { hashSessionId, readCookie, sessionCookieName } from './cookies'
import { rewriteToInternal } from './oidc'

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const NONE: AuthStrategyResult = { user: null }
const DEVICE_HEADER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `req.context` key set when a bearer token is valid but its device was revoked (http.ts → 401 DEVICE_REVOKED). */
export const AUTH_FAILURE_KEY = 'pkAuthFailure'

/** Paths a bearer token may use WITHOUT an already registered device (relative to routes.api). */
const DEVICELESS_PATHS = new Set(['/v1/devices/register'])

type SessionUserExtras = {
  _pkSessionExp?: number
  _pkSessionId?: number
  _pkKc?: Record<string, unknown>
  _pkDevice?: { id: number; deviceId: string }
}

async function loadActiveUser(payload: Payload, where: Record<string, unknown>) {
  const res = await payload.find({
    collection: 'users',
    where: { and: [where, { active: { equals: true } }] } as never,
    limit: 1,
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: authentication lookup
  })
  return res.docs[0]
}

/**
 * Browser sessions (ADR 0003 §3): opaque random id in an HttpOnly cookie, hashed in `web-sessions`.
 * Rejects revoked/expired sessions and inactive users (G16); CSRF: unsafe methods need same-origin.
 */
export const oidcSessionStrategy: AuthStrategy = {
  name: 'oidcSession',
  authenticate: async ({ headers, payload, req }) => {
    const env = getEnv()
    const raw = readCookie(headers.get('cookie'), sessionCookieName(env.AUTH_COOKIE_INSECURE))
    if (!raw) return NONE
    if (req?.method && UNSAFE.has(req.method.toUpperCase())) {
      const origin = headers.get('origin')
      const fetchSite = headers.get('sec-fetch-site')
      const appOrigin = new URL(env.APP_URL).origin
      if ((origin && origin !== appOrigin) || (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')) {
        return NONE
      }
    }
    const found = await payload.find({
      collection: 'web-sessions',
      where: { idHash: { equals: hashSessionId(raw) } },
      limit: 1,
      depth: 0,
      pagination: false,
      overrideAccess: true, // SYSTEM-READ
    })
    const s = found.docs[0]
    if (!s || s.revokedAt || new Date(s.expiresAt).getTime() <= Date.now()) return NONE
    const userId = typeof s.user === 'object' && s.user ? s.user.id : s.user
    const active = await loadActiveUser(payload, { id: { equals: userId } })
    if (!active) return NONE
    // ADR 0016 §5: per-PT roles from active memberships (DB only) + the PT selection.
    const { user, denied } = await attachCompanyContext(payload, active, headers, { insecureCookie: env.AUTH_COOKIE_INSECURE })
    if (denied && req?.context) req.context[COMPANY_DENIED_KEY] = true
    const extras: SessionUserExtras = {
      _pkSessionExp: Math.floor(new Date(s.expiresAt).getTime() / 1000),
      _pkSessionId: s.id,
    }
    return { user: { ...user, ...extras, collection: 'users', _strategy: 'oidcSession' } }
  },
}

let jwks: JWTVerifyGetKey | undefined
function getJwks(): JWTVerifyGetKey {
  const env = getEnv()
  jwks ??= createRemoteJWKSet(
    new URL(rewriteToInternal(`${env.OIDC_ISSUER.replace(/\/$/, '')}/protocol/openid-connect/certs`)),
    { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 },
  )
  return jwks
}

/** Test seam: verify against a local key set instead of the Keycloak JWKS endpoint. */
export function setJwksForTests(keys: JWTVerifyGetKey | undefined): void {
  jwks = keys
}

export type VerifiedAccessToken = JWTPayload & {
  azp?: string
  typ?: string
  sid?: string
  realm_access?: { roles?: string[] }
}

/**
 * Verifies a Keycloak access token for the mobile client (ADR 0003 §4 + spike b): signature via
 * JWKS, `iss`, RS256, exp/nbf with 60 s skew, `typ=Bearer`, `azp=proyekkas-mobile`
 * (`aud` is "account" by default in Keycloak 26.7.4, so it is not checked).
 */
export async function verifyMobileAccessToken(token: string): Promise<VerifiedAccessToken> {
  const env = getEnv()
  const { payload } = await jwtVerify<VerifiedAccessToken>(token, getJwks(), {
    issuer: env.OIDC_ISSUER,
    algorithms: ['RS256'],
    clockTolerance: 60,
    requiredClaims: ['exp', 'iat', 'sub', 'azp'],
  })
  if (payload.typ !== 'Bearer') throw new Error('not an access token')
  if (payload.azp !== env.OIDC_MOBILE_CLIENT_ID) throw new Error('unexpected azp')
  return payload
}

/**
 * ADR 0016 §2 login gate: the token must carry the realm role `pk-user`. MC1 TRANSITION (until the
 * infra change assigns `pk-user` to every account): any legacy `pk-*` realm role is accepted as the
 * same "may log in" marker. Token roles are NEVER used as permissions — per-PT roles come from
 * `company-memberships` only.
 */
export function tokenAllowsLogin(realmRoles: readonly string[] | undefined): boolean {
  return (realmRoles ?? []).some((r) => r === LOGIN_ROLE || isRole(r))
}

/**
 * APK bearer tokens — ONLY on /api/v1/* (never generic /api/<slug>, never admin views, which call
 * strategies without `req`). Requires an ACTIVE device of this user (`X-Device-Id`), except for
 * POST /api/v1/devices/register. The token proves identity + `pk-user` (tokenAllowsLogin); the
 * effective roles are the ACTIVE memberships in the DB (a role removed in the admin stops working
 * on the next request).
 */
export const mobileBearerStrategy: AuthStrategy = {
  name: 'mobileBearer',
  authenticate: async ({ headers, payload, req }) => {
    const authz = headers.get('authorization')
    if (!authz?.startsWith('Bearer ')) return NONE
    const apiRoute = payload.config.routes.api
    const pathname = req?.pathname
    if (!pathname || !pathname.startsWith(`${apiRoute}/v1/`)) return NONE
    let claims: VerifiedAccessToken
    try {
      claims = await verifyMobileAccessToken(authz.slice('Bearer '.length).trim())
    } catch (err) {
      payload.logger.info({ msg: 'mobileBearer rejected', reason: (err as Error).message })
      return NONE
    }
    if (!tokenAllowsLogin(claims.realm_access?.roles)) {
      payload.logger.info({ msg: 'mobileBearer rejected', reason: 'no pk-user realm role' })
      return NONE
    }
    const found = await loadActiveUser(payload, { keycloakSub: { equals: claims.sub } })
    if (!found) return NONE
    const { user, denied } = await attachCompanyContext(payload, found, headers, { insecureCookie: getEnv().AUTH_COOKIE_INSECURE })
    if (denied && req.context) req.context[COMPANY_DENIED_KEY] = true
    const extras: SessionUserExtras = {
      _pkKc: { sid: claims.sid ?? null, azp: claims.azp, iss: claims.iss, exp: claims.exp },
    }
    const deviceId = headers.get('x-device-id')
    const deviceless = req.method?.toUpperCase() === 'POST' && DEVICELESS_PATHS.has(pathname.slice(apiRoute.length))
    if (!deviceId || !DEVICE_HEADER_RE.test(deviceId)) return NONE
    const dev = await payload.find({
      collection: 'devices',
      where: { and: [{ deviceId: { equals: deviceId.toLowerCase() } }, { user: { equals: user.id } }] },
      limit: 1,
      depth: 0,
      pagination: false,
      overrideAccess: true, // SYSTEM-READ
    })
    const device = dev.docs[0]
    if (device?.status === 'active') extras._pkDevice = { id: device.id, deviceId: device.deviceId }
    else if (!deviceless) {
      // A revoked/lost install of THIS user (valid token): tell the APK so it ends the session at
      // once instead of refreshing (ADR 0003 §5). Unknown devices stay a plain 401.
      if (device && req.context) req.context[AUTH_FAILURE_KEY] = 'device_revoked'
      return NONE
    }
    return { user: { ...user, ...extras, collection: 'users', _strategy: 'mobileBearer' } }
  },
}
