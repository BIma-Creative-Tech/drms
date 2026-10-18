import { APIError, type PayloadRequest } from 'payload'

import { relId, userId } from '@/access/roles'
import { getTwoFactorStatus } from '@/auth/two-factor-status'
import { resolveDisplayName } from '@/domain/user-display-name'
import { getEnv } from '@/lib/env'

import { HttpError, json, v1 } from '../http'
import { MeSignatureBody } from '../schemas-account'

/** Web page of the same settings (ADR 0017, auth/two-factor.ts SECURITY_PATH). */
const SECURITY_PATH = '/admin/keamanan-akun'

type OwnRow = { id: number; email: string; name?: string | null; phone?: string | null; signature?: unknown; keycloakSub?: string | null }
type SignatureRow = { id: number; width?: number | null; height?: number | null }

async function ownRow(req: PayloadRequest): Promise<OwnRow> {
  const uid = userId(req)
  if (uid === undefined) throw new HttpError(401, 'Unauthorized')
  const row = await req.payload
    .findByID({ collection: 'users', id: uid, depth: 0, overrideAccess: true /* SYSTEM-READ: the caller's OWN row */, req })
    .catch(() => null)
  if (!row) throw new HttpError(401, 'Unauthorized')
  return row as unknown as OwnRow
}

/** `GET /me/account` body: the web "Profil & tanda tangan" fields (collections/Users.ts). */
async function accountOf(req: PayloadRequest, row: OwnRow) {
  const sigId = relId(row.signature)
  let signature: { id: number; width: number | null; height: number | null } | null = null
  if (sigId !== undefined) {
    const m = (await req.payload
      .findByID({ collection: 'media-signatures', id: sigId, depth: 0, overrideAccess: true /* SYSTEM-READ: the caller's own profile signature */, req })
      .catch(() => null)) as SignatureRow | null
    if (m) signature = { id: m.id, width: m.width ?? null, height: m.height ?? null }
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    phone: row.phone ?? null,
    displayName: await resolveDisplayName(req.payload, req.user),
    signature,
    editable: ['signature'] as const,
  }
}

/**
 * GET /api/v1/me/account — own account for the APK "Profil & tanda tangan" (user 2026-10-19, menus 1:1 with the
 * web avatar menu). Name, email and phone are Admin-managed (shown read-only); the signature is self-service.
 */
export const meAccountEndpoint = v1({
  path: '/me/account',
  method: 'get',
  rateLimit: [60, 60_000],
  handler: async ({ req }) => json(await accountOf(req, await ownRow(req))),
})

/**
 * PUT /api/v1/me/signature { signatureMediaId } — set (or, with null, remove) the own profile signature. Runs the
 * normal users update as the caller (overrideAccess:false), so the web rules apply unchanged: own row only, and
 * `selfProfileGuard` accepts only a media-signatures row the caller uploaded (else 403). Audit = the users hooks.
 */
export const meSignatureEndpoint = v1({
  path: '/me/signature',
  method: 'put',
  body: MeSignatureBody,
  rateLimit: [20, 60_000],
  maxBodyBytes: 1024,
  handler: async ({ req, body }) => {
    const row = await ownRow(req)
    if ((relId(row.signature) ?? null) !== body.signatureMediaId) {
      try {
        await req.payload.update({ collection: 'users', id: row.id, data: { signature: body.signatureMediaId } as never, depth: 0, user: req.user, overrideAccess: false, req })
      } catch (err) {
        if (err instanceof APIError && err.status === 403) throw new HttpError(403, 'Forbidden', { code: 'FORBIDDEN', detail: err.message })
        throw err
      }
    }
    return json(await accountOf(req, await ownRow(req)))
  },
})

/**
 * GET /api/v1/me/security — own 2FA status (ADR 0017: Keycloak Admin API, metadata only; never a secret) for the APK
 * "Keamanan akun". Turning 2FA on/off stays on the web page (`manageUrl`): Keycloak re-authenticates there
 * (`prompt=login`) and the callback writes the audit row — the APK opens it in the browser and re-reads this.
 */
export const meSecurityEndpoint = v1({
  path: '/me/security',
  method: 'get',
  rateLimit: [30, 60_000],
  handler: async ({ req }) => {
    const row = await ownRow(req)
    const status = await getTwoFactorStatus(row.keycloakSub, req.payload.logger)
    return json({
      twoFactor: {
        state: status.state,
        authenticators: status.authenticators.map((c) => ({ id: c.id, label: c.userLabel, createdAt: c.createdDate ? new Date(c.createdDate).toISOString() : null })),
      },
      manageUrl: new URL(SECURITY_PATH, getEnv().APP_URL).toString(),
    })
  },
})
