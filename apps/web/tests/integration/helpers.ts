import { randomUUID } from 'node:crypto'

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import { getPayload, handleEndpoints, type Payload } from 'payload'
import pg from 'pg'

import type { Role } from '@/access/roles'
import { setKeycloakAdmin, type KeycloakAdmin } from '@/auth/keycloak-admin'
import { createWebSession } from '@/auth/sessions'
import { setJwksForTests } from '@/auth/strategies'
import config from '@/payload.config'

export const ALL_ROLES: Role[] = ['pk-staff', 'pk-pm', 'pk-finance', 'pk-owner', 'pk-admin']

let payload: Payload | undefined
export async function getTestPayload(): Promise<Payload> {
  payload ??= await getPayload({ config })
  return payload
}

// ---- fake Keycloak Admin API (records calls) --------------------------------------------------
export type KcCall = { op: string; args: unknown[] }
export function installFakeKeycloak(): { calls: KcCall[]; users: Map<string, { email: string; enabled: boolean; roles: Set<string> }> } {
  const calls: KcCall[] = []
  const users = new Map<string, { email: string; enabled: boolean; roles: Set<string> }>()
  const rec = (op: string, ...args: unknown[]) => void calls.push({ op, args })
  const fake: KeycloakAdmin = {
    async findUserByEmail(email) {
      rec('findUserByEmail', email)
      for (const [id, u] of users) if (u.email === email) return { id, enabled: u.enabled }
      return null
    },
    async createUser(u) {
      const id = randomUUID()
      users.set(id, { email: u.email, enabled: u.enabled, roles: new Set() })
      rec('createUser', u.email)
      return id
    },
    async updateUser(id, patch) {
      rec('updateUser', id, patch)
      const u = users.get(id)
      if (u && patch.enabled !== undefined) u.enabled = patch.enabled
    },
    async deleteUser(id) {
      rec('deleteUser', id)
      users.delete(id)
    },
    async getRealmRoles(id) {
      return [...(users.get(id)?.roles ?? [])]
    },
    async addRealmRoles(id, roles) {
      if (roles.length) rec('addRealmRoles', id, roles)
      for (const r of roles) users.get(id)?.roles.add(r)
    },
    async removeRealmRoles(id, roles) {
      if (roles.length) rec('removeRealmRoles', id, roles)
      for (const r of roles) users.get(id)?.roles.delete(r)
    },
    async logoutUser(id) {
      rec('logoutUser', id)
    },
    async revokeConsent(id, clientId) {
      rec('revokeConsent', id, clientId)
      return true
    },
    async deleteSession(sid, offline) {
      rec('deleteSession', sid, offline)
      return true
    },
    async executeActionsEmail(id, actions) {
      rec('executeActionsEmail', id, actions)
      throw new Error('SMTP not configured') // mirrors the realm today (runbook): must be non-fatal
    },
    async listUserCredentials(id) {
      rec('listUserCredentials', id)
      return []
    },
  }
  setKeycloakAdmin(fake)
  return { calls, users }
}

// ---- users per role (bootstrap path: existing Keycloak user linked by sub) ---------------------
export type TestUser = { id: number; email: string; keycloakSub: string; roles: Role[]; employee?: number | null; collection: 'users' }

export async function makeUser(roles: Role[], opts: { employee?: number; active?: boolean; label?: string } = {}): Promise<TestUser> {
  const p = await getTestPayload()
  const email = `${opts.label ?? roles.join('+') ?? 'user'}-${randomUUID().slice(0, 8)}@drms.test`.toLowerCase()
  const doc = await p.create({
    collection: 'users',
    data: { email, keycloakSub: randomUUID(), roles, active: opts.active ?? true, employee: opts.employee },
    depth: 0,
    overrideAccess: true, // SYSTEM-WRITE: test fixture (bootstrap path)
    context: { skipKeycloakSync: true },
  })
  return { ...(doc as unknown as TestUser), collection: 'users' }
}

// ---- HTTP through Payload's REST handler (same code path as the Next route) --------------------
export async function http(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; json?: unknown } = {},
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const headers = new Headers(opts.headers ?? {})
  let body: string | undefined
  if (opts.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(opts.json)
  }
  const request = new Request(`http://localhost:3000${path}`, { method, headers, body })
  const res = await handleEndpoints({ config, request })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed, headers: res.headers }
}

/** Real admin web session (web-sessions row + cookie), as created by /auth/callback. */
export async function webSessionCookie(user: TestUser): Promise<string> {
  const p = await getTestPayload()
  const s = await createWebSession(p, { id: user.id, roles: user.roles }, { keycloakSid: randomUUID() })
  return `pk_session=${s.id}`
}

// ---- mobile bearer tokens signed by a local "Keycloak" key --------------------------------------
let signer: { key: CryptoKey; kid: string } | undefined
export async function installLocalJwks(): Promise<void> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const kid = 'pk-f1-test'
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }
  setJwksForTests(createLocalJWKSet({ keys: [jwk] }))
  signer = { key: privateKey, kid }
}

export async function accessToken(
  user: Pick<TestUser, 'keycloakSub'>,
  roles: string[],
  over: { azp?: string; typ?: string; iss?: string; expiresIn?: string; sid?: string; key?: CryptoKey } = {},
): Promise<string> {
  if (!signer) throw new Error('installLocalJwks() first')
  return new SignJWT({
    typ: over.typ ?? 'Bearer',
    azp: over.azp ?? 'proyekkas-mobile',
    sid: over.sid ?? randomUUID(),
    realm_access: { roles: ['offline_access', ...roles] },
  })
    .setProtectedHeader({ alg: 'RS256', kid: signer.kid })
    .setIssuer(over.iss ?? process.env.OIDC_ISSUER!)
    .setSubject(user.keycloakSub)
    .setAudience('account')
    .setIssuedAt()
    .setExpirationTime(over.expiresIn ?? '5m')
    .sign(over.key ?? signer.key)
}

export async function registerDevice(user: TestUser, token: string, deviceId = randomUUID()): Promise<string> {
  const res = await http('POST', '/api/v1/devices/register', {
    headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': deviceId },
    json: { deviceId, platform: 'android', model: 'Test Phone', appVersion: '1.0.0' },
  })
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`)
  return deviceId
}

// ---- raw SQL as a given role ---------------------------------------------------------------------
export async function sqlAs(role: 'app' | 'owner' | 'ro', query: string, params: unknown[] = []) {
  const url = { app: process.env.PK_TEST_DATABASE_URL, owner: process.env.PK_TEST_DATABASE_URL_OWNER, ro: process.env.PK_TEST_DATABASE_URL_RO }[role]
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    return await c.query(query, params)
  } finally {
    await c.end()
  }
}

export async function sqlError(role: 'app' | 'owner' | 'ro', query: string, params: unknown[] = []): Promise<{ code?: string; message: string } | null> {
  try {
    await sqlAs(role, query, params)
    return null
  } catch (e) {
    const err = e as { code?: string; message: string }
    return { code: err.code, message: err.message }
  }
}

export async function auditRows(docType: string, docId: string | number) {
  const r = await sqlAs('app', 'SELECT action, field, old_value, new_value, reason, source, user_id, tx_id::text AS tx_id, server_time FROM audit_logs WHERE doc_type = $1 AND doc_id = $2 ORDER BY id', [docType, String(docId)])
  return r.rows as Array<{ action: string; field: string | null; old_value: { v: unknown } | null; new_value: { v: unknown } | null; reason: string | null; source: string; user_id: string | null; tx_id: string; server_time: Date }>
}
