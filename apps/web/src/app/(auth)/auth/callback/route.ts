import config from '@payload-config'
import { decodeJwt } from 'jose'
import type { NextRequest } from 'next/server'
import * as client from 'openid-client'
import { getPayload } from 'payload'

import { oidcTxCookieName, readCookie, serializeCookie, sessionCookieName } from '@/auth/cookies'
import { getWebOidcConfig, openTx } from '@/auth/oidc'
import { auditLoginFailed, createWebSession } from '@/auth/sessions'
import { tokenAllowsLogin } from '@/auth/strategies'
import { handleAccountActionCallback } from '@/auth/two-factor'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

const fail = (status: number, msg: string) =>
  new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })

export async function GET(request: NextRequest): Promise<Response> {
  // ADR 0017: return leg of a self-service 2FA action (own cookie + state) — no new session.
  const accountAction = await handleAccountActionCallback(request)
  if (accountAction) return accountAction
  const env = getEnv()
  const payload = await getPayload({ config })
  const txCookie = readCookie(request.headers.get('cookie'), oidcTxCookieName(env.AUTH_COOKIE_INSECURE))
  if (!txCookie) return fail(400, 'Sesi login tidak ditemukan. Silakan ulangi.')
  try {
    const tx = await openTx(txCookie)
    const cfg = await getWebOidcConfig()
    // Public callback URL (behind Traefik request.url may be internal).
    const currentUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, env.APP_URL)
    const tokens = await client.authorizationCodeGrant(cfg, currentUrl, {
      pkceCodeVerifier: tx.verifier,
      expectedState: tx.state,
      expectedNonce: tx.nonce,
      idTokenExpected: true,
    })
    const idClaims = tokens.claims()
    if (!idClaims?.sub) return fail(400, 'Login gagal.')
    const access = decodeJwt(tokens.access_token) as { realm_access?: { roles?: string[] } }
    const found = await payload.find({
      collection: 'users',
      where: { and: [{ keycloakSub: { equals: idClaims.sub } }, { active: { equals: true } }] },
      limit: 1,
      depth: 0,
      pagination: false,
      overrideAccess: true, // SYSTEM-READ: login mapping
    })
    const user = found.docs[0]
    if (!user) {
      payload.logger.warn({ msg: 'login denied: unknown or inactive user' })
      await auditLoginFailed(payload, request.headers, { reason: 'unknown_or_inactive_user', keycloakSub: idClaims.sub })
      return fail(403, 'Akun belum terdaftar atau tidak aktif di RR Teams.')
    }
    // ADR 0016 §2: the token proves identity + `pk-user` (MC1 transition: or a legacy pk-* role);
    // per-PT roles are DB-only (company-memberships) — no role sync from the token any more.
    if (!tokenAllowsLogin(access.realm_access?.roles)) {
      payload.logger.warn({ msg: 'login denied: no pk-user realm role' })
      await auditLoginFailed(payload, request.headers, { reason: 'no_login_role', userId: user.id, keycloakSub: idClaims.sub })
      return fail(403, 'Akun belum diberi akses RR Teams.')
    }
    const session = await createWebSession(payload, { id: user.id }, {
      keycloakSid: typeof idClaims.sid === 'string' ? idClaims.sid : undefined,
      idToken: tokens.id_token,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: request.headers.get('user-agent') ?? undefined,
    })
    const headers = new Headers({ Location: new URL(tx.returnTo, env.APP_URL).toString(), 'Cache-Control': 'no-store' })
    headers.append('Set-Cookie', serializeCookie(sessionCookieName(env.AUTH_COOKIE_INSECURE), session.id, { maxAge: session.maxAge, insecure: env.AUTH_COOKIE_INSECURE }))
    headers.append('Set-Cookie', serializeCookie(oidcTxCookieName(env.AUTH_COOKIE_INSECURE), '', { maxAge: 0, insecure: env.AUTH_COOKIE_INSECURE }))
    return new Response(null, { status: 302, headers })
  } catch (err) {
    payload.logger.warn({ msg: 'oidc callback failed', err: (err as Error).message })
    await auditLoginFailed(payload, request.headers, { reason: 'oidc_callback_error' })
    return fail(400, 'Login gagal. Silakan ulangi.')
  }
}
