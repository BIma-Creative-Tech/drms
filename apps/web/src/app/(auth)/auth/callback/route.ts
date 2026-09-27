import config from '@payload-config'
import { decodeJwt } from 'jose'
import type { NextRequest } from 'next/server'
import * as client from 'openid-client'
import { getPayload } from 'payload'

import { isRole } from '@/access/roles'
import { oidcTxCookieName, readCookie, serializeCookie, sessionCookieName } from '@/auth/cookies'
import { getWebOidcConfig, openTx } from '@/auth/oidc'
import { auditLoginFailed, createWebSession } from '@/auth/sessions'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

const fail = (status: number, msg: string) =>
  new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })

export async function GET(request: NextRequest): Promise<Response> {
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
    const tokenRoles = (access.realm_access?.roles ?? []).filter(isRole).sort()
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
      return fail(403, 'Akun belum terdaftar atau tidak aktif di ProyekKas.')
    }
    if (JSON.stringify([...(user.roles ?? [])].sort()) !== JSON.stringify(tokenRoles)) {
      // Keycloak realm roles are the source of truth (ADR 0003 §2) → refresh the mirror; audited as role_sync.
      await payload.update({
        collection: 'users',
        id: user.id,
        data: { roles: tokenRoles },
        depth: 0,
        overrideAccess: true, // SYSTEM-WRITE: login-time role sync (no Keycloak write-back)
        context: { roleSync: true },
      })
    }
    const session = await createWebSession(payload, { id: user.id, roles: tokenRoles }, {
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
