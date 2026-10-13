import type {
  CollectionAfterChangeHook,
  CollectionBeforeChangeHook,
  PayloadRequest,
} from 'payload'
import { APIError } from 'payload'

import { hasRoleAny, isGroupAdmin, LOGIN_ROLE } from '@/access/roles'
import { getKeycloakAdmin, KeycloakAdminError, type KeycloakAdmin } from '@/auth/keycloak-admin'
import { writeAudit } from '@/audit/writer'
import { getEnv } from '@/lib/env'

/**
 * users ↔ Keycloak (ADR 0003 §2/§5 as revised by ADR 0016 §2). Keycloak keeps IDENTITY only
 * (account, enabled flag, sessions) + the coarse realm role `pk-user`; per-PT roles live in
 * `company-memberships` and are never synced. Writes are Keycloak-first, then DB: the Keycloak
 * calls run in `beforeChange` (inside the DB transaction, before the row is written); a Keycloak
 * failure aborts the save. If the DB write fails afterwards, the REST `afterError` hook compensates
 * (created KC user deleted, role mapping / enabled flag reverted) — best effort, logged.
 *
 * Context flags (server code only, never from HTTP input):
 * - `skipKeycloakSync`: bootstrap/seed of an EXISTING Keycloak user (keycloakSub given).
 * - `pkTemporaryPassword` (DRMS 13/10 W3 onboarding, ADR 0003 revision 2026-10-13): a NEWLY created Keycloak user gets
 *   this password as TEMPORARY (Keycloak adds `UPDATE_PASSWORD`) instead of the execute-actions mail; a linked
 *   existing Keycloak user keeps its password. The hook reports `pkKcNewUser` (the new Keycloak id) in the context.
 *   Compensation is the same `deleteUser` (the password goes with the user).
 */
type UserData = {
  email?: string
  name?: string | null
  active?: boolean | null
  keycloakSub?: string | null
}

type Compensation =
  | { kind: 'deleteUser'; kcId: string }
  | { kind: 'roles'; kcId: string; added: string[]; removed: string[] }
  | { kind: 'enabled'; kcId: string; enabled: boolean }

const CTX_COMP = 'pkKcCompensate'
/** Context: temporary password for a NEW Keycloak user (server code only). */
export const CTX_TEMP_PASSWORD = 'pkTemporaryPassword'
/** Context (set by the hook): Keycloak id of a user this request CREATED in Keycloak. */
export const CTX_KC_NEW_USER = 'pkKcNewUser'

function mobileClientId(): string {
  try {
    return getEnv().OIDC_MOBILE_CLIENT_ID
  } catch {
    return 'proyekkas-mobile'
  }
}

/**
 * Grants the login marker role (ADR 0016 §2). MC1 TRANSITION: while the realm does not define
 * `pk-user` yet (infra change pending, Keycloak answers 422 "realm role not found"), the legacy role
 * `pk-staff` is assigned instead — the app accepts any pk-* realm role as the login marker only
 * (auth/strategies.ts tokenAllowsLogin); permissions always come from the memberships.
 */
async function grantLoginRole(req: PayloadRequest, kc: KeycloakAdmin, kcId: string): Promise<string[]> {
  const current = await kc.getRealmRoles(kcId)
  if (current.includes(LOGIN_ROLE)) return []
  try {
    await kc.addRealmRoles(kcId, [LOGIN_ROLE])
    return [LOGIN_ROLE]
  } catch (err) {
    if (!(err instanceof KeycloakAdminError) || err.status !== 422) throw err
    req.payload.logger.warn({ msg: 'keycloak realm role pk-user missing — legacy login marker pk-staff assigned (MC1 transition)' })
    if (current.some((r) => r.startsWith('pk-'))) return []
    await kc.addRealmRoles(kcId, ['pk-staff'])
    return ['pk-staff']
  }
}

function pushComp(req: PayloadRequest, c: Compensation) {
  const list = (req.context[CTX_COMP] ??= []) as Compensation[]
  list.push(c)
}

export const keycloakSyncBeforeChange: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req, context }) => {
  const d = data as UserData
  if (d.email) d.email = d.email.trim().toLowerCase()
  if (operation !== 'create' && operation !== 'update') return data
  // F2c self-service profile (signature only — field access strips every Keycloak-relevant
  // field for non-admins, selfProfileGuard runs first): nothing to sync to Keycloak.
  if (operation === 'update' && req.user && !hasRoleAny(req, 'pk-admin') && !isGroupAdmin(req)) return data
  if (context?.skipKeycloakSync === true) {
    if (operation === 'create' && !d.keycloakSub) throw new APIError('keycloakSub wajib untuk bootstrap.', 400)
    return data
  }
  const kc = getKeycloakAdmin()

  if (operation === 'create') {
    if (!d.email) throw new APIError('Email wajib diisi.', 400, null, true)
    const existing = await kc.findUserByEmail(d.email)
    const kcId =
      existing?.id ?? (await kc.createUser({ email: d.email, firstName: d.name ?? undefined, enabled: d.active !== false }))
    if (!existing) pushComp(req, { kind: 'deleteUser', kcId })
    else if (existing.enabled !== (d.active !== false)) await kc.updateUser(kcId, { enabled: d.active !== false })
    const added = await grantLoginRole(req, kc, kcId)
    if (existing && added.length > 0) pushComp(req, { kind: 'roles', kcId, added, removed: [] })
    d.keycloakSub = kcId
    const temporary = context?.[CTX_TEMP_PASSWORD]
    if (!existing && typeof temporary === 'string' && temporary !== '') {
      // fatal on failure (policy / Keycloak down): the save aborts, the compensation deletes the new user
      await kc.resetPassword(kcId, temporary, true)
      req.context[CTX_KC_NEW_USER] = kcId
    } else if (!existing) {
      // Onboarding mail needs realm SMTP (not configured yet, runbook §Catatan) → non-fatal.
      try {
        await kc.executeActionsEmail(kcId, ['UPDATE_PASSWORD'])
      } catch (err) {
        req.payload.logger.warn({ msg: 'keycloak execute-actions-email failed (SMTP?)', err: (err as Error).message })
      }
    }
    return data
  }

  const kcId = originalDoc?.keycloakSub as string | undefined
  if (!kcId) throw new APIError('User belum tertaut ke Keycloak.', 409, null, true)
  const patch: { email?: string; firstName?: string; enabled?: boolean } = {}
  if (d.email !== undefined && d.email !== originalDoc?.email) patch.email = d.email
  if (d.name !== undefined && d.name !== originalDoc?.name) patch.firstName = d.name ?? ''
  const wasActive = originalDoc?.active !== false
  const willBeActive = d.active === undefined || d.active === null ? wasActive : d.active
  if (willBeActive !== wasActive) patch.enabled = willBeActive
  if (Object.keys(patch).length > 0) {
    await kc.updateUser(kcId, patch)
    if (patch.enabled !== undefined) pushComp(req, { kind: 'enabled', kcId, enabled: !patch.enabled })
  }
  if (wasActive && !willBeActive) {
    // Deactivation (ADR 0003 §5): end SSO sessions + offline tokens of the APK.
    await kc.logoutUser(kcId)
    await kc.revokeConsent(kcId, mobileClientId())
  }
  return data
}

/**
 * DB side of a deactivation, same transaction: every active device and web session of the user
 * is revoked (strategies then reject immediately — G16).
 */
export const deactivationAfterChange: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || previousDoc?.active === false || doc.active !== false) return doc
  const now = new Date().toISOString()
  const devices = await req.payload.update({
    collection: 'devices',
    where: { and: [{ user: { equals: doc.id } }, { status: { equals: 'active' } }] },
    data: { status: 'revoked', revokedAt: now, revokeReason: 'user_deactivated', changeReason: 'Pengguna dinonaktifkan' },
    depth: 0,
    req,
    overrideAccess: true, // SYSTEM-WRITE: deactivation cascade
  })
  const sessions = await req.payload.update({
    collection: 'web-sessions',
    where: { and: [{ user: { equals: doc.id } }, { revokedAt: { exists: false } }] },
    data: { revokedAt: now, revokeReason: 'user_deactivated' },
    depth: 0,
    req,
    overrideAccess: true, // SYSTEM-WRITE: deactivation cascade
  })
  await writeAudit(req, [
    {
      action: 'session_revoked',
      docType: 'user',
      docId: String(doc.id),
      field: 'sessions',
      newValue: { devices: devices.docs.length, webSessions: sessions.docs.length },
      reason: 'user_deactivated',
    },
  ])
  return doc
}

/**
 * Undo Keycloak writes of a failed save: REST error path (payload utilities/routeError.js → `afterError`) and the
 * user-onboarding endpoint (Local API writes in one transaction — `afterError` does not run there, the endpoint calls
 * this after the rollback).
 */
export async function compensateKeycloak(req: PayloadRequest): Promise<void> {
  const list = (req.context?.[CTX_COMP] ?? []) as Compensation[]
  if (list.length === 0) return
  req.context[CTX_COMP] = []
  let kc: KeycloakAdmin
  try {
    kc = getKeycloakAdmin()
  } catch {
    return
  }
  for (const c of list.reverse()) {
    try {
      if (c.kind === 'deleteUser') await kc.deleteUser(c.kcId)
      if (c.kind === 'roles') {
        await kc.removeRealmRoles(c.kcId, c.added)
        await kc.addRealmRoles(c.kcId, c.removed)
      }
      if (c.kind === 'enabled') await kc.updateUser(c.kcId, { enabled: c.enabled })
    } catch (err) {
      req.payload.logger.error({ msg: 'keycloak compensation failed — manual fix needed', kind: c.kind, err: (err as Error).message })
    }
  }
}
