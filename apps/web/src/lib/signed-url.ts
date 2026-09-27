import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

/**
 * E9 — signed, time-limited media URLs (ADR 0004 §4): our own HMAC scheme for contexts that cannot
 * send an Authorization header or the session cookie (notification deep links, `<img>` in a
 * WebView, a link handed to the system viewer).
 *
 *   GET /api/v1/media/{collection}/{id}/file?[variant=thumb&]exp=<unix s>&uid=<user id>&sig=<b64url>
 *   sig = base64url(HMAC-SHA256(key, "pk-media-v1|collection|id|variant|exp|uid"))
 *
 * The signature binds the file (collection, id, variant), the expiry and the user it was minted
 * FOR; the file endpoint re-checks that this user (still active) may read the file — a leaked URL
 * is useless after ≤ 5 min and never widens access (defence in depth against key compromise).
 * Pure module (unit-tested); keys come from env (MEDIA_URL_KEYS, rotation with overlap) or are
 * derived from PAYLOAD_SECRET.
 */
export const SIGNED_URL_TTL_S = 300
/** Tolerated clock skew for `exp` in the future (a URL never lives longer than TTL + skew). */
export const SIGNED_URL_MAX_SKEW_S = 60

export type SignedMediaTarget = {
  collection: string
  id: number
  variant: string | null
  userId: number
}

export type SignedParams = { exp: number; uid: number; sig: string }

export type VerifyResult = 'ok' | 'expired' | 'invalid'

const SIG_RE = /^[A-Za-z0-9_-]{43}$/ // 32-byte HMAC, base64url without padding
const INT_RE = /^\d{1,12}$/

/** Signing keys: MEDIA_URL_KEYS (first signs, all verify) or HKDF(PAYLOAD_SECRET, "pk-media-url-v1"). */
export function signingKeys(env: { MEDIA_URL_KEYS?: string; PAYLOAD_SECRET: string }): Buffer[] {
  const listed = (env.MEDIA_URL_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  if (listed.length > 0) return listed.map((k) => Buffer.from(k, 'utf8'))
  if (!env.PAYLOAD_SECRET) throw new Error('signed media URLs: no key (PAYLOAD_SECRET empty)')
  return [Buffer.from(hkdfSync('sha256', env.PAYLOAD_SECRET, 'pk-media-url', 'pk-media-url-v1', 32))]
}

function canonical(t: SignedMediaTarget, exp: number): string {
  return ['pk-media-v1', t.collection, String(t.id), t.variant ?? '', String(exp), String(t.userId)].join('|')
}

export function mediaSignature(key: Buffer, t: SignedMediaTarget, exp: number): string {
  return createHmac('sha256', key).update(canonical(t, exp), 'utf8').digest('base64url')
}

/** Mints `{exp, uid, sig}` valid for `ttlS` seconds from `nowS` (always with the first key). */
export function signMedia(t: SignedMediaTarget, keys: Buffer[], nowS: number, ttlS = SIGNED_URL_TTL_S): SignedParams {
  const key = keys[0]
  if (!key) throw new Error('signed media URLs: no key')
  const exp = Math.floor(nowS) + Math.min(Math.max(1, ttlS), SIGNED_URL_TTL_S)
  return { exp, uid: t.userId, sig: mediaSignature(key, t, exp) }
}

/**
 * Parses the query of a signed request: every one of exp/uid/sig present and well-formed, else
 * null (the caller answers 403 — a request that TRIES to be signed never falls back to cookies).
 */
export function parseSignedParams(q: URLSearchParams): SignedParams | null {
  const exp = q.get('exp')
  const uid = q.get('uid')
  const sig = q.get('sig')
  if (!exp || !uid || !sig || !INT_RE.test(exp) || !INT_RE.test(uid) || !SIG_RE.test(sig)) return null
  const uidN = Number(uid)
  if (uidN <= 0) return null
  return { exp: Number(exp), uid: uidN, sig }
}

/**
 * Constant-time check against every key. Order matters for the answer only: a bad signature is
 * 'invalid' whatever `exp` says; a good signature past `exp` is 'expired'; an `exp` further in the
 * future than TTL + skew is 'invalid' (not minted by us with the current TTL).
 */
export function verifyMedia(t: SignedMediaTarget, p: SignedParams, keys: Buffer[], nowS: number): VerifyResult {
  if (p.uid !== t.userId) return 'invalid'
  const got = Buffer.from(p.sig, 'base64url')
  const match = keys.some((k) => {
    const want = Buffer.from(mediaSignature(k, t, p.exp), 'base64url')
    return want.length === got.length && timingSafeEqual(want, got)
  })
  if (!match) return 'invalid'
  if (p.exp > Math.floor(nowS) + SIGNED_URL_TTL_S + SIGNED_URL_MAX_SKEW_S) return 'invalid'
  if (p.exp <= Math.floor(nowS)) return 'expired'
  return 'ok'
}

/** Relative URL of the signed file (same origin as the API; the APK prefixes its base URL). */
export function signedMediaPath(apiRoute: string, t: SignedMediaTarget, p: SignedParams): string {
  const q = new URLSearchParams()
  if (t.variant) q.set('variant', t.variant)
  q.set('exp', String(p.exp))
  q.set('uid', String(p.uid))
  q.set('sig', p.sig)
  return `${apiRoute}/v1/media/${t.collection}/${t.id}/file?${q.toString()}`
}
