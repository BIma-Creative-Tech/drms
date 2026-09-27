import { readCookie, sessionCookieName } from '@/auth/cookies'

/**
 * E9 (phase-plan F6 backlog, fase1-golive §E9 AC): `/admin/*` without a session → 302 to the login
 * page, instead of Payload rendering a 200 shell (page titles only) that redirects client-side.
 * Coarse and cheap (runs in the Next proxy, no DB): only the PRESENCE of the session cookie is
 * checked — the browser drops it at session expiry (Max-Age = session TTL, src/auth/sessions.ts),
 * so a missing cookie means "not logged in". A present but revoked/invalid cookie is still
 * rejected by the Payload strategy (src/auth/strategies.ts), whose redirect then applies.
 * Pure function (unit-tested).
 */

/** Payload admin routes that must stay reachable without a session (login and its helpers). */
const PUBLIC_ADMIN = /^\/admin\/(login|logout|logout-inactivity|forgot|reset|create-first-user|verify|unauthorized)(\/|$)/

export type AdminGateInput = {
  method: string
  pathname: string
  search: string
  cookieHeader: string | null
  insecureCookie: boolean
}

/** Location of the login redirect, or null when the request may pass. */
export function adminLoginRedirect(i: AdminGateInput): string | null {
  const m = i.method.toUpperCase()
  if (m !== 'GET' && m !== 'HEAD') return null // Server Actions / form posts: Payload answers (no session → no data)
  if (i.pathname !== '/admin' && !i.pathname.startsWith('/admin/')) return null
  if (PUBLIC_ADMIN.test(i.pathname)) return null
  if (readCookie(i.cookieHeader, sessionCookieName(i.insecureCookie))) return null
  const target = `${i.pathname}${i.search}`
  // Only same-site relative paths are echoed (safeReturnTo re-checks at /auth/login).
  const redirect = target.startsWith('/') && !target.startsWith('//') ? target : '/admin'
  return `/admin/login?redirect=${encodeURIComponent(redirect)}`
}
