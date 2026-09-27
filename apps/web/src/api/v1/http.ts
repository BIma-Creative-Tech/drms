import { addDataAndFileToRequest, APIError, ValidationError, type Endpoint, type PayloadRequest } from 'payload'
import type { z } from 'zod'

import { hasRole, type Role } from '@/access/roles'
import { AUTH_FAILURE_KEY } from '@/auth/strategies'
import { claimKey, IDEMPOTENCY_KEY_RE, requestHash, storeResponse } from '@/lib/idempotency'
import { requestMeta } from '@/lib/request-meta'
import { takeToken } from '@/lib/rate-limit'
import { withReqTransaction } from '@/lib/system-tx'

export const DEVICE_REVOKED_DETAIL = 'Perangkat ini sudah dicabut dari akun Anda. Silakan masuk kembali atau hubungi Admin.'

/** RFC 9457 problem details (architecture §6.2). Never echoes internals. */
export function problem(status: number, title: string, extra: Record<string, unknown> = {}): Response {
  return Response.json(
    { type: 'about:blank', title, status, ...extra },
    { status, headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' } },
  )
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** Carries an error response out of the transaction so that it rolls back. */
class RolledBack extends Error {
  constructor(readonly response: Response) {
    super('rolled back')
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(title)
  }
}

/** Compares dotted numeric versions ("1.2.10" > "1.2.9"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0)
  const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

let minVersionCache: { value: string | null; at: number } | undefined
/** Test seam. */
export function resetMinVersionCache(): void {
  minVersionCache = undefined
}
async function minAppVersion(req: PayloadRequest): Promise<string | null> {
  if (minVersionCache && Date.now() - minVersionCache.at < 60_000) return minVersionCache.value
  const s = await req.payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ */, req })
  minVersionCache = { value: s.minAppVersion || null, at: Date.now() }
  return minVersionCache.value
}

export type V1Options<B extends z.ZodType | undefined> = {
  path: string
  method: 'get' | 'post' | 'patch' | 'put'
  /** 'public' = no authentication (health only). Default: any authenticated user. */
  auth?: 'public' | 'user'
  roles?: Role[]
  body?: B
  /** Per-user token bucket: [requests, windowMs]. */
  rateLimit?: [number, number]
  /** Run the handler inside ONE DB transaction on this req (mutations). */
  transactional?: boolean
  /**
   * Honour `Idempotency-Key` (G15): the first 2xx response is stored and replayed for retries
   * with the same key and body; a different body → 422. Requires `transactional`. The APK must
   * send the header on these endpoints (400 without it); web callers may omit it.
   */
  idempotent?: boolean
  /**
   * E9 (ADR 0004 §4): a request carrying `sig` in its query is a SIGNED URL — no session/bearer
   * needed; the wrapper skips the user checks (rate limit keyed on the claimed `uid`) and the
   * handler MUST verify the signature and re-check access for that user (see lib/signed-url.ts).
   */
  signedAccess?: boolean
  /** multipart/form-data upload (file in field `file`, JSON fields in `_payload`); no zod body. */
  multipart?: boolean
  /** Upper bound of the JSON body in bytes (413 above it). */
  maxBodyBytes?: number
  handler: (ctx: {
    req: PayloadRequest
    body: B extends z.ZodType ? z.infer<B> : undefined
    params: Record<string, string>
  }) => Promise<Response>
}

/**
 * Root custom endpoint under /api/v1 (architecture §6.1). Payload docs: "custom endpoints are not
 * authenticated by default" → every handler goes through this wrapper: auth + role check,
 * APK minimum version (426), rate limit, zod body validation, transaction, problem+json errors.
 */
export function v1<B extends z.ZodType | undefined = undefined>(opts: V1Options<B>): Endpoint {
  return {
    path: `/v1${opts.path}`,
    method: opts.method,
    handler: async (req) => {
      try {
        const signed = opts.signedAccess === true && req.searchParams?.has('sig') === true
        if (signed && opts.rateLimit) {
          const [n, windowMs] = opts.rateLimit
          const claimed = (req.searchParams.get('uid') ?? '').slice(0, 12)
          if (!takeToken(`v1:${opts.method}:${opts.path}:signed:${claimed}`, n, windowMs)) return problem(429, 'Too Many Requests')
        }
        if (opts.auth !== 'public' && !signed) {
          if (!req.user) {
            // Valid token, revoked/lost device (mobileBearer): a code the APK maps to a forced logout
            // without trying a token refresh. Nothing else about the caller is disclosed.
            if (req.context?.[AUTH_FAILURE_KEY] === 'device_revoked') {
              return problem(401, 'Unauthorized', { code: 'DEVICE_REVOKED', detail: DEVICE_REVOKED_DETAIL })
            }
            return problem(401, 'Unauthorized')
          }
          if (opts.roles && !hasRole(req, ...opts.roles)) return problem(403, 'Forbidden')
          const meta = requestMeta(req)
          if (meta.source === 'apk') {
            const min = await minAppVersion(req)
            const have = req.headers.get('x-app-version')
            if (min && (!have || compareVersions(have, min) < 0)) {
              return problem(426, 'Upgrade Required', { minAppVersion: min })
            }
          }
          if (opts.rateLimit) {
            const [n, windowMs] = opts.rateLimit
            const uid = (req.user as { id?: number }).id
            if (!takeToken(`v1:${opts.method}:${opts.path}:${uid}`, n, windowMs)) return problem(429, 'Too Many Requests')
          }
        }
        let body: unknown = undefined
        let rawText = ''
        if (opts.multipart) {
          await addDataAndFileToRequest(req)
        } else if (opts.body) {
          let raw: unknown
          try {
            rawText = (await req.text?.()) ?? ''
            if (opts.maxBodyBytes !== undefined && Buffer.byteLength(rawText, 'utf8') > opts.maxBodyBytes) {
              return problem(413, 'Content Too Large', { detail: `Body maksimal ${opts.maxBodyBytes} byte.` })
            }
            raw = rawText ? JSON.parse(rawText) : {}
          } catch {
            return problem(400, 'Bad Request', { detail: 'Body harus JSON.' })
          }
          const parsed = opts.body.safeParse(raw)
          if (!parsed.success) {
            const errors = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
            // S3e (S-06): `detail` = the field messages, so a client that shows only `detail` (web
            // ActionButton, APK snackbar) tells the user WHAT is wrong.
            return problem(400, 'Bad Request', { detail: bodyErrorDetail(errors), errors })
          }
          body = parsed.data
        }
        const params = Object.fromEntries(Object.entries(req.routeParams ?? {}).map(([k, v]) => [k, String(v)]))
        const run = () => opts.handler({ req, body: body as never, params })
        const key = opts.idempotent ? req.headers.get('idempotency-key')?.trim() : undefined
        if (opts.idempotent) {
          if (key !== undefined && !IDEMPOTENCY_KEY_RE.test(key)) return problem(400, 'Bad Request', { detail: 'Idempotency-Key harus UUID.' })
          if (key === undefined && requestMeta(req).source === 'apk') return problem(400, 'Bad Request', { detail: 'Idempotency-Key wajib untuk aplikasi Android.' })
        }
        if (!opts.transactional) return await run()
        if (!key) return await withReqTransaction(req, run)
        const uid = (req.user as { id: number }).id
        const path = new URL(req.url ?? 'http://local/').pathname
        const hash = requestHash(opts.method, path, rawText)
        try {
          return await withReqTransaction(req, async () => {
            const claim = await claimKey(req, uid, key, opts.method, path, hash)
            if (claim.kind === 'mismatch') throw new RolledBack(problem(422, 'Unprocessable Content', { detail: 'Idempotency-Key sudah dipakai untuk permintaan lain.' }))
            if (claim.kind === 'replay') {
              const res = json(claim.body, claim.status)
              res.headers.set('Idempotent-Replayed', 'true')
              return res
            }
            const res = await run()
            if (res.status >= 400) throw new RolledBack(res) // never store errors; undo the claim
            await storeResponse(req, uid, key, res.status, await res.clone().json().catch(() => null))
            return res
          })
        } catch (err) {
          if (err instanceof RolledBack) return err.response
          throw err
        }
      } catch (err) {
        if (err instanceof HttpError) return problem(err.status, err.title, err.extra)
        if (err instanceof ValidationError) {
          const errors = ((err.data as { errors?: Array<{ path?: string; message?: string }> } | undefined)?.errors ?? []).map((e) => ({ path: e.path ?? '', message: e.message ?? '' }))
          return problem(400, 'Bad Request', { detail: 'Data tidak valid.', errors })
        }
        if (err instanceof APIError && err.status < 500) {
          const errors = (err.data as { errors?: unknown } | null | undefined)?.errors
          // Domain errors may carry a stable machine code (e.g. E4 ProgressError: PHOTO_LIMIT, WEIGHTS_INCOMPLETE).
          const code = (err as { pkCode?: unknown }).pkCode
          return problem(err.status, err.isPublic ? err.message : 'Request rejected', {
            ...(err.isPublic && Array.isArray(errors) ? { errors } : {}),
            ...(err.isPublic && typeof code === 'string' ? { code } : {}),
          })
        }
        const pg = err as { code?: string; message?: string }
        if (typeof pg.code === 'string' && /^(42501|23505|23514|P0001)$/.test(pg.code)) {
          // DB guards (triggers/constraints) are the last line of defence → 409, never a 500.
          req.payload.logger.warn({ msg: 'v1 db guard', path: opts.path, code: pg.code, err: pg.message })
          return problem(409, 'Conflict', { detail: 'Ditolak oleh aturan integritas data.' })
        }
        req.payload.logger.error({ msg: 'v1 handler failed', path: opts.path, err: (err as Error).message })
        return problem(500, 'Internal Server Error')
      }
    },
  }
}

/**
 * HEAD twin of a GET endpoint built with v1() (uptime monitors send `HEAD /api/v1/health`).
 * Next.js serves HEAD through the route's GET export but keeps `request.method === 'HEAD'`, and
 * Payload matches root endpoints by method, so without a 'head' endpoint the request is a 404.
 * The twin runs the SAME handler (same auth/role checks, same rate-limit bucket key — v1() keys on
 * opts.method = 'get' — same status and headers) and drops the body (RFC 9110 §9.3.2).
 */
export function headOf(endpoint: Endpoint): Endpoint {
  if (endpoint.method !== 'get') throw new Error(`headOf: ${endpoint.path} is not a GET endpoint`)
  return {
    path: endpoint.path,
    method: 'head',
    handler: async (req) => {
      const res = await endpoint.handler(req)
      await res.body?.cancel()
      return new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers })
    },
  }
}

/** S3e (S-06): human `detail` of a body validation error — distinct messages joined, max 3. */
export function bodyErrorDetail(errors: Array<{ path: string; message: string }>): string {
  const msgs = [...new Set(errors.map((e) => e.message).filter(Boolean))]
  if (msgs.length === 0) return 'Data tidak valid.'
  return msgs.slice(0, 3).join(' ') + (msgs.length > 3 ? ` (+${msgs.length - 3} lainnya)` : '')
}
