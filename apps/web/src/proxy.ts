/**
 * Next.js 16 proxy (formerly middleware): per-request nonce + CSP + request id for pages
 * (admin, auth routes). Authorization is NOT done here (Payload strategies/access) — except the
 * E9 coarse gate: an /admin page request WITHOUT a session cookie gets a real 302 to the login
 * page instead of Payload's 200 shell (src/lib/admin-gate.ts). The cookie itself is validated by
 * the Payload strategy as before (a stale/revoked cookie still ends on Payload's own redirect).
 * API responses (/api/**) get their request id in the Payload layer (src/lib/request-meta.ts).
 */
import { NextResponse, type NextRequest } from 'next/server'

import { adminLoginRedirect } from '@/lib/admin-gate'
import { buildCsp, generateNonce } from '@/lib/csp'

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/

export function proxy(request: NextRequest) {
  const login = adminLoginRedirect({
    method: request.method,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    cookieHeader: request.headers.get('cookie'),
    insecureCookie: process.env.AUTH_COOKIE_INSECURE === 'true',
  })
  if (login) {
    // Next's proxy runtime rejects a relative Location (TypeError: Invalid URL → 500), so the path is
    // resolved against the public APP_URL — never request.url, whose origin is the internal one
    // behind Traefik. Fallback to request.nextUrl only when APP_URL is unset (dev).
    const location = new URL(login, process.env.APP_URL || request.nextUrl.origin)
    return new NextResponse(null, { status: 302, headers: { Location: location.toString(), 'Cache-Control': 'no-store' } })
  }
  const nonce = generateNonce()
  const idp = process.env.OIDC_ISSUER ? new URL(process.env.OIDC_ISSUER).origin : undefined
  const csp = buildCsp(nonce, { isDev: process.env.NODE_ENV === 'development', formActionOrigins: idp ? [idp] : [] })
  const incoming = request.headers.get('x-request-id')
  const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID()

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('x-request-id', requestId)
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('X-Request-Id', requestId)
  return response
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
