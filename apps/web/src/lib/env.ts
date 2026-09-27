import { readFileSync } from 'node:fs'

import { z } from 'zod'

/**
 * Boot-time environment validation (fail fast). Error messages contain variable NAMES only,
 * never values. No secrets in NEXT_PUBLIC_* (assertNoPublicSecrets).
 *
 * Secrets may be given as `<NAME>_FILE` (path of a file holding the value, e.g. a Compose
 * `secrets:` mount); the file content is used with trailing newlines stripped. Setting both
 * `<NAME>` and `<NAME>_FILE` is an error.
 */
export const FILE_SECRETS = [
  'DATABASE_URL',
  'PAYLOAD_SECRET',
  'OIDC_WEB_CLIENT_SECRET',
  'KC_ADMIN_CLIENT_SECRET',
  'SMTP_PASSWORD',
  'MEDIA_URL_KEYS',
] as const

const postgresUrl = z.string().regex(/^postgres(ql)?:\/\/\S+$/, 'must be a postgres:// URL')
const httpUrl = z.url({ protocol: /^https?$/, message: 'must be an http(s) URL' })
const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true')
const clientId = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)

/**
 * Outbound SMTP (mailbox no-reply@bimacreative.tech on mail.bimacreative.tech; limits and design in
 * src/email/adapter.ts + src/email/rate-guard.ts). All-or-nothing: without SMTP_HOST (dev/tests/migrate) Payload
 * keeps its console adapter. The From address MUST equal the authenticated mailbox (SMTP_USER):
 * the mail server rejects/flags other senders (SPF/DMARC alignment + sender login maps).
 */
const SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_ADDRESS', 'SMTP_FROM_NAME'] as const
const smtpFields = {
  SMTP_HOST: z
    .string()
    .regex(/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/, 'must be a hostname')
    .optional(),
  /** 465 = implicit TLS; any other port = STARTTLS, which is REQUIRED (requireTLS) before AUTH. */
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.email().optional(),
  SMTP_PASSWORD: z.string().min(8, 'min 8 chars').optional(),
  SMTP_FROM_ADDRESS: z.email().optional(),
  /** Display name only; no characters that could break or inject into the From header. */
  SMTP_FROM_NAME: z.string().regex(/^[^\r\n<>"@\\]{1,64}$/, 'max 64 chars, no CR/LF < > " @ \\').optional(),
}
type SmtpFieldsOut = { [K in keyof typeof smtpFields]?: z.output<(typeof smtpFields)[K]> }

function refineSmtp(env: SmtpFieldsOut, ctx: z.RefinementCtx): void {
  const set = SMTP_KEYS.filter((k) => env[k] !== undefined && env[k] !== '')
  if (set.length === 0) return
  for (const k of SMTP_KEYS) {
    if (!set.includes(k)) ctx.addIssue({ code: 'custom', path: [k], message: 'required when any SMTP_* is set (all-or-nothing)' })
  }
  if (env.SMTP_FROM_ADDRESS && env.SMTP_USER && env.SMTP_FROM_ADDRESS.toLowerCase() !== env.SMTP_USER.toLowerCase()) {
    ctx.addIssue({ code: 'custom', path: ['SMTP_FROM_ADDRESS'], message: 'must equal SMTP_USER (the authenticated mailbox)' })
  }
}

export type SmtpConfig = {
  host: string
  port: number
  user: string
  password: string
  fromAddress: string
  fromName: string
  /** EHLO name = APP_URL host (a real FQDN); nodemailer's fallback is "[127.0.0.1]" in containers. */
  ehloName?: string
}

function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname || undefined : undefined
  } catch {
    return undefined
  }
}

/** Validated SMTP settings, or null when SMTP is not configured. */
export function smtpConfigOf(env: SmtpFieldsOut & { APP_URL?: string }): SmtpConfig | null {
  if (!env.SMTP_HOST) return null
  const ehloName = hostOf(env.APP_URL)
  return {
    ...(ehloName ? { ehloName } : {}),
    host: env.SMTP_HOST,
    port: env.SMTP_PORT!,
    user: env.SMTP_USER!,
    password: env.SMTP_PASSWORD!,
    fromAddress: env.SMTP_FROM_ADDRESS!,
    fromName: env.SMTP_FROM_NAME!,
  }
}

/**
 * Android App Links (ADR 0003 §1 redirect `https://<pk-host>/app/callback`, ADR 0010 decision 3):
 * SHA-256 fingerprints of the APK signing certificate(s), comma separated, `AA:BB:…` (32 bytes).
 * Normalised to upper case; empty = none (assetlinks.json then serves `[]`).
 */
const CERT_FP_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/
export function parseCertFingerprints(value: string | undefined): string[] | null {
  const list = (value ?? '')
    .split(',')
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean)
  return list.every((v) => CERT_FP_RE.test(v)) ? [...new Set(list)] : null
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    DATABASE_URL: postgresUrl,
    /** Pool size per process. Staging app role has CONNECTION LIMIT 10 → web 5 + worker 3 + seed 2 (≥ 2: a tx holds one). */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(6),
    PAYLOAD_SECRET: z.string().min(32, 'min 32 chars'),
    APP_URL: httpUrl,
    OIDC_ISSUER: httpUrl,
    /** Optional internal base URL of Keycloak for OIDC back-channel calls (staging: unset = public issuer). */
    OIDC_INTERNAL_URL: httpUrl.optional(),
    OIDC_WEB_CLIENT_ID: clientId,
    OIDC_WEB_CLIENT_SECRET: z.string().min(16),
    OIDC_MOBILE_CLIENT_ID: clientId,
    /**
     * Keycloak Admin REST base URL (without /admin), kept separate from the issuer even when the
     * value is equal: the admin path is reachable only via a dedicated internal network
     * (infra decision 2026-09-23), never via hairpin.
     */
    KC_ADMIN_BASE_URL: httpUrl.optional(),
    /** Realm for the Admin API; default = realm of OIDC_ISSUER. */
    KC_REALM: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).optional(),
    KC_ADMIN_CLIENT_ID: clientId.default('proyekkas-admin-api'),
    KC_ADMIN_CLIENT_SECRET: z.string().min(16).optional(),
    /** Only for plain-http throwaway environments. Refused when APP_URL is https. */
    AUTH_COOKIE_INSECURE: bool,
    MEDIA_DIR: z.string().startsWith('/').default('/data/media'),
    /**
     * E9 P-1 (lib/image-queue.ts): image uploads re-encoded by sharp at once in this process; more
     * wait in a FIFO queue. With web cpus 0.75, 1–2 keeps the other requests p95 < 2 s.
     */
    IMAGE_RESIZE_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    /** E9 P-1: uploads allowed to WAIT for a slot; one more → 503 + Retry-After (APK retries). */
    IMAGE_RESIZE_MAX_QUEUE: z.coerce.number().int().min(0).max(500).default(20),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** Android application id of the APK (ADR 0010 decision 1 proposal; client to confirm the domain). */
    ANDROID_APP_PACKAGE: z
      .string()
      .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'must be an Android application id')
      .default('id.co.drms.proyekkas'),
    ANDROID_APP_CERT_SHA256: z
      .string()
      .default('')
      .refine((v) => parseCertFingerprints(v) !== null, 'comma separated SHA-256 fingerprints AA:BB:… (32 bytes)')
      .transform((v) => parseCertFingerprints(v) ?? []),
    /** F3 rollback switch (export-library-decision §7): 'false' hides Excel buttons, /reports/…/xlsx → 404. */
    EXPORT_XLSX_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    /**
     * FCM push (ADR 0011). Stays false: there is no Firebase project (Q-44) and no FCM dispatcher
     * yet, so `true` is refused at boot (rows would stay push_status=pending forever). The APK reads
     * the effective value from GET /api/v1/app/config `features.pushEnabled`.
     */
    PUSH_FCM_ENABLED: bool,
    /**
     * E9 (ADR 0004 §4): HMAC keys for signed, time-limited media URLs, comma separated, each ≥ 32
     * chars. The FIRST key signs, every key verifies (rotation = prepend the new key, drop the old
     * one after the 5-min TTL). Unset → a key derived from PAYLOAD_SECRET (HKDF, own label).
     */
    MEDIA_URL_KEYS: z
      .string()
      .optional()
      .refine((v) => !v || v.split(',').every((k) => k.trim().length >= 32), 'comma separated keys, each min 32 chars'),
    ...smtpFields,
  })
  .superRefine((env, ctx) => {
    refineSmtp(env, ctx)
    if (env.AUTH_COOKIE_INSECURE && env.APP_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['AUTH_COOKIE_INSECURE'], message: 'not allowed with https APP_URL' })
    }
    if (env.NODE_ENV === 'production' && !env.AUTH_COOKIE_INSECURE) {
      for (const key of ['APP_URL', 'OIDC_ISSUER'] as const) {
        if (!env[key].startsWith('https://')) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'https required in production' })
        }
      }
    }
    if (!/\/realms\/[^/]+$/.test(env.OIDC_ISSUER.replace(/\/$/, ''))) {
      ctx.addIssue({ code: 'custom', path: ['OIDC_ISSUER'], message: 'must look like <base>/realms/<realm>' })
    }
    if (env.PUSH_FCM_ENABLED) {
      ctx.addIssue({ code: 'custom', path: ['PUSH_FCM_ENABLED'], message: 'not supported yet: no FCM dispatcher / Firebase project (ADR 0011, Q-44)' })
    }
    if (env.KC_ADMIN_BASE_URL && !env.KC_ADMIN_CLIENT_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['KC_ADMIN_CLIENT_SECRET'], message: 'required when KC_ADMIN_BASE_URL is set' })
    }
  })

export type Env = z.infer<typeof envSchema>

const smtpEnvSchema = z.object(smtpFields).superRefine(refineSmtp)

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}

/**
 * SMTP subset only — used at Payload config build time (payload.config.ts), where the full env
 * is not available (`next build`, migrate/seed containers). Same rules as envSchema; throws
 * `Invalid env: …` (names only, never values) when SMTP is half-configured.
 */
export function parseSmtpEnv(
  source: Record<string, string | undefined>,
  read?: FileReader,
): SmtpConfig | null {
  const subset: Record<string, string | undefined> = { SMTP_PASSWORD_FILE: source.SMTP_PASSWORD_FILE }
  for (const k of SMTP_KEYS) subset[k] = source[k]
  const resolved = resolveFileSecrets(subset, read)
  // Empty strings (e.g. `SMTP_HOST=` from a compose default) count as unset.
  for (const k of SMTP_KEYS) if (resolved[k] === '') delete resolved[k]
  const result = smtpEnvSchema.safeParse(resolved)
  if (!result.success) throw new Error(`Invalid env: ${formatIssues(result.error)}`)
  return smtpConfigOf({ ...result.data, APP_URL: source.APP_URL })
}

const SECRET_LIKE = /(SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|DATABASE|_KEY$|^KEY)/i

export function assertNoPublicSecrets(source: Record<string, string | undefined>): void {
  const offenders = Object.keys(source).filter(
    (k) => k.startsWith('NEXT_PUBLIC_') && SECRET_LIKE.test(k.slice('NEXT_PUBLIC_'.length)),
  )
  if (offenders.length > 0) {
    throw new Error(`Invalid env: public variables look like secrets: ${offenders.join(', ')}`)
  }
}

type FileReader = (path: string) => string

/** Returns a copy of `source` with every `<NAME>_FILE` of FILE_SECRETS resolved into `<NAME>`. */
export function resolveFileSecrets(
  source: Record<string, string | undefined>,
  read: FileReader = (p) => readFileSync(p, 'utf8'),
): Record<string, string | undefined> {
  const out = { ...source }
  for (const name of FILE_SECRETS) {
    const file = source[`${name}_FILE`]
    if (!file) continue
    if (source[name]) throw new Error(`Invalid env: both ${name} and ${name}_FILE are set`)
    let value: string
    try {
      value = read(file)
    } catch {
      throw new Error(`Invalid env: ${name}_FILE is not readable`)
    }
    out[name] = value.replace(/[\r\n]+$/, '')
  }
  return out
}

/** Single secret at config build time (PAYLOAD_SECRET/DATABASE_URL); '' when absent (next build). */
export function readSecret(name: (typeof FILE_SECRETS)[number]): string {
  try {
    return (
      resolveFileSecrets({ [name]: process.env[name], [`${name}_FILE`]: process.env[`${name}_FILE`] })[name] ?? ''
    )
  } catch {
    return ''
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  assertNoPublicSecrets(source)
  const resolved = resolveFileSecrets(source)
  for (const k of SMTP_KEYS) if (resolved[k] === '') delete resolved[k]
  const result = envSchema.safeParse(resolved)
  if (!result.success) throw new Error(`Invalid env: ${formatIssues(result.error)}`)
  return result.data
}

let cache: Env | undefined
/** Lazy + memoised so `next build` does not need runtime secrets. */
export function getEnv(): Env {
  cache ??= parseEnv(process.env)
  return cache
}

/** Test seam: drop the memoised env (tests change process.env between suites). */
export function resetEnvCache(): void {
  cache = undefined
}
