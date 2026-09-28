import { APIError } from 'payload'

import { getEnv } from '@/lib/env'

/**
 * Keycloak Admin REST client for realm-scoped user administration (ADR 0003 §2/§5), using the
 * `proyekkas-admin-api` service account (client_credentials; least privilege per spike b:
 * realm-management `manage-users`). Base URL = KC_ADMIN_BASE_URL (dedicated internal network,
 * infra decision 2026-09-23 — never the hairpin to the public host).
 * Endpoints: Keycloak 26.7.4 Admin REST (docs-api 26.7.4; exercised against a throwaway
 * Keycloak in tests/integration/keycloak-admin.kc.test.ts).
 *
 * Infra constraints of the admin router (Lead, infra main d53c87d): only
 * `${KC_ADMIN_BASE_URL}/admin/realms/<realm>/…` (slash after the realm REQUIRED) and the realm token
 * endpoint are allowed; percent-encoded characters in the PATH are rejected → path segments are
 * validated against a safe charset and never encoded; rate limit 20/s burst 40 → 429 is retried
 * with backoff.
 */
export interface KeycloakAdmin {
  findUserByEmail(email: string): Promise<{ id: string; enabled: boolean } | null>
  createUser(u: { email: string; firstName?: string; enabled: boolean }): Promise<string>
  updateUser(id: string, patch: { email?: string; firstName?: string; enabled?: boolean }): Promise<void>
  deleteUser(id: string): Promise<void>
  getRealmRoles(id: string): Promise<string[]>
  addRealmRoles(id: string, roles: string[]): Promise<void>
  removeRealmRoles(id: string, roles: string[]): Promise<void>
  logoutUser(id: string): Promise<void>
  revokeConsent(id: string, clientId: string): Promise<boolean>
  /** Deletes an online (offline=false) or offline session; false when it does not exist (404). */
  deleteSession(sid: string, offline: boolean): Promise<boolean>
  executeActionsEmail(id: string, actions: string[]): Promise<void>
  /**
   * Optional self-service 2FA (ADR 0017): the user's OTP credentials — metadata only (id, label,
   * created). Never secretData/credentialData. Needs realm-management `view-users`.
   */
  listUserCredentials(id: string): Promise<OtpCredential[]>
}

/** Metadata of one OTP authenticator of a user (Keycloak CredentialRepresentation, type `otp`). */
export type OtpCredential = { id: string; type: 'otp'; userLabel: string | null; createdDate: number | null }

export class KeycloakAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

type Fetch = typeof fetch

export function realmOf(issuer: string): string {
  const m = /\/realms\/([^/]+)\/?$/.exec(issuer)
  if (!m?.[1]) throw new Error('issuer has no realm')
  return decodeURIComponent(m[1])
}

/** Path segment guard: the admin router rejects percent-encoding, so segments are never encoded. */
export function seg(value: string): string {
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(value)) throw new KeycloakAdminError('unsafe keycloak path segment', 400)
  return value
}

export function createHttpKeycloakAdmin(cfg: {
  baseUrl: string
  realm: string
  clientId: string
  clientSecret: string
  fetchImpl?: Fetch
  sleep?: (ms: number) => Promise<void>
}): KeycloakAdmin {
  const f = cfg.fetchImpl ?? fetch
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const base = cfg.baseUrl.replace(/\/+$/, '')
  const realm = seg(cfg.realm)
  const adminBase = `${base}/admin/realms/${realm}`
  let token: { value: string; exp: number } | undefined

  /** fetch with retry on 429 (Retry-After seconds, else 250/500/1000 ms). */
  async function send(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await f(url, { ...init, signal: AbortSignal.timeout(10_000) })
      if (res.status !== 429 || attempt >= 3) return res
      const ra = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 5) * 1000 : 250 * 2 ** attempt)
    }
  }

  async function accessToken(): Promise<string> {
    if (token && token.exp - 30_000 > Date.now()) return token.value
    const res = await send(`${base}/realms/${realm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret }),
    })
    if (!res.ok) throw new KeycloakAdminError('keycloak token request failed', res.status)
    const body = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!body.access_token) throw new KeycloakAdminError('keycloak token missing', 502)
    token = { value: body.access_token, exp: Date.now() + (body.expires_in ?? 60) * 1000 }
    return token.value
  }

  async function call(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<Response> {
    const res = await send(`${adminBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok && !okStatuses.includes(res.status)) {
      // Never include response bodies/tokens in the message (may contain PII).
      throw new KeycloakAdminError(`keycloak admin ${method} ${path.split('?')[0]?.replace(/[0-9a-f-]{36}/g, ':id')} → ${res.status}`, res.status)
    }
    return res
  }

  type RoleRep = { id: string; name: string }
  const reps = (list: RoleRep[], names: string[]) => list.filter((r) => names.includes(r.name)).map((r) => ({ id: r.id, name: r.name }))
  const assignedRoles = async (id: string) => (await (await call('GET', `/users/${seg(id)}/role-mappings/realm`)).json()) as RoleRep[]

  const uid = seg

  return {
    async findUserByEmail(email) {
      const res = await call('GET', `/users?email=${encodeURIComponent(email)}&exact=true&briefRepresentation=true`)
      const list = (await res.json()) as Array<{ id: string; email?: string; enabled?: boolean }>
      const u = list.find((x) => x.email?.toLowerCase() === email.toLowerCase())
      return u ? { id: u.id, enabled: u.enabled !== false } : null
    },
    async createUser(u) {
      const res = await call('POST', '/users', {
        username: u.email,
        email: u.email,
        firstName: u.firstName,
        enabled: u.enabled,
        emailVerified: true,
      })
      const loc = res.headers.get('location') ?? ''
      const id = loc.split('/').pop()
      if (!id) throw new KeycloakAdminError('keycloak create user: no Location header', 502)
      return id
    },
    async updateUser(id, patch) {
      await call('PUT', `/users/${uid(id)}`, patch)
    },
    async deleteUser(id) {
      await call('DELETE', `/users/${uid(id)}`, undefined, [404])
    },
    async getRealmRoles(id) {
      return (await assignedRoles(id)).map((r) => r.name)
    },
    /**
     * Role ids come from `users/{id}/role-mappings/realm/available` (works with manage-users/
     * view-users); `GET /roles/{name}` needs `view-realm` and returns 403 for the least-privilege
     * service account (verified against Keycloak 26.7.4, tests/kc).
     */
    async addRealmRoles(id, roles) {
      if (roles.length === 0) return
      const available = (await (await call('GET', `/users/${uid(id)}/role-mappings/realm/available`)).json()) as RoleRep[]
      const current = (await assignedRoles(id)).map((r) => r.name)
      const missing = roles.filter((r) => !current.includes(r))
      const toAdd = reps(available, missing)
      if (toAdd.length !== missing.length) throw new KeycloakAdminError('keycloak realm role not found', 422)
      if (toAdd.length > 0) await call('POST', `/users/${uid(id)}/role-mappings/realm`, toAdd)
    },
    async removeRealmRoles(id, roles) {
      if (roles.length === 0) return
      const toRemove = reps(await assignedRoles(id), roles)
      if (toRemove.length > 0) await call('DELETE', `/users/${uid(id)}/role-mappings/realm`, toRemove)
    },
    async logoutUser(id) {
      await call('POST', `/users/${uid(id)}/logout`)
    },
    async revokeConsent(id, clientId) {
      const res = await call('DELETE', `/users/${uid(id)}/consents/${seg(clientId)}`, undefined, [404])
      return res.status !== 404
    },
    async deleteSession(sid, offline) {
      const res = await call('DELETE', `/sessions/${seg(sid)}?isOffline=${offline}`, undefined, [404])
      return res.status !== 404
    },
    async executeActionsEmail(id, actions) {
      await call('PUT', `/users/${uid(id)}/execute-actions-email`, actions)
    },
    async listUserCredentials(id) {
      const list = (await (await call('GET', `/users/${uid(id)}/credentials`)).json()) as Array<Record<string, unknown>>
      return toOtpCredentials(list)
    },
  }
}

/** Keeps only OTP credentials and only their metadata (the representation also carries credentialData). */
export function toOtpCredentials(list: unknown): OtpCredential[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && (c as Record<string, unknown>).type === 'otp' && typeof (c as Record<string, unknown>).id === 'string')
    .map((c) => ({
      id: c.id as string,
      type: 'otp' as const,
      userLabel: typeof c.userLabel === 'string' && c.userLabel.trim() ? c.userLabel.slice(0, 100) : null,
      createdDate: typeof c.createdDate === 'number' && Number.isFinite(c.createdDate) ? c.createdDate : null,
    }))
}

let override: KeycloakAdmin | null | undefined
let cached: KeycloakAdmin | undefined

/** Test seam: inject a fake (or `null` = "not configured"); `undefined` restores env-based. */
export function setKeycloakAdmin(impl: KeycloakAdmin | null | undefined): void {
  override = impl
  cached = undefined
}

/** Returns the configured client or throws 503 (user administration needs Keycloak). */
export function getKeycloakAdmin(): KeycloakAdmin {
  if (override !== undefined) {
    if (override === null) throw new APIError('Keycloak Admin API belum dikonfigurasi.', 503, null, true)
    return override
  }
  if (cached) return cached
  const env = getEnv()
  if (!env.KC_ADMIN_BASE_URL || !env.KC_ADMIN_CLIENT_SECRET) {
    throw new APIError('Keycloak Admin API belum dikonfigurasi.', 503, null, true)
  }
  cached = createHttpKeycloakAdmin({
    baseUrl: env.KC_ADMIN_BASE_URL,
    realm: env.KC_REALM ?? realmOf(env.OIDC_ISSUER),
    clientId: env.KC_ADMIN_CLIENT_ID,
    clientSecret: env.KC_ADMIN_CLIENT_SECRET,
  })
  return cached
}
