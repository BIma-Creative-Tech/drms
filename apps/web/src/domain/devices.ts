import { APIError, type PayloadRequest, type Where } from 'payload'

import { hasRole, relId } from '@/access/roles'
import { getKeycloakAdmin } from '@/auth/keycloak-admin'
import { writeAudit } from '@/audit/writer'

export const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type RegisterInput = {
  deviceId: string
  platform: 'android'
  model?: string
  appVersion?: string
  fcmToken?: string | null
  integrity?: DeviceIntegrityInput
}

export type DeviceIntegrityInput = {
  rooted: boolean
  emulator: boolean
  developerMode: boolean
  adbEnabled: boolean
  mockLocation?: boolean | null
}

/** Risk = signals that matter for fraud (root, emulator, mocked GPS); dev options/ADB alone do not. */
export function integrityRisk(i: DeviceIntegrityInput): boolean {
  return i.rooted || i.emulator || i.mockLocation === true
}

/** Stored integrity fields for a register call; nothing when the APK sent no integrity report. */
function integrityData(input: RegisterInput, now: string) {
  const i = input.integrity
  if (!i) return {}
  return {
    integrity: { rooted: i.rooted, emulator: i.emulator, developerMode: i.developerMode, adbEnabled: i.adbEnabled, mockLocation: i.mockLocation ?? null },
    integrityRisk: integrityRisk(i),
    integrityCheckedAt: now,
  }
}

type DeviceDoc = {
  id: number
  deviceId: string
  user: unknown
  status: 'active' | 'revoked' | 'lost'
  keycloakSid?: string | null
}

/**
 * POST /api/v1/devices/register (ADR 0003 §5). Idempotent per (user, deviceId): re-registering
 * refreshes model/version/FCM token/sid. A revoked/lost deviceId can never be re-activated (the
 * APK must generate a new install id). Must run inside a transaction (`req.transactionID`).
 */
export async function registerDevice(req: PayloadRequest, input: RegisterInput, keycloakSid?: string) {
  const uid = relId(req.user)
  if (uid === undefined) throw new APIError('Unauthorized', 401)
  const found = await req.payload.find({
    collection: 'devices',
    where: { deviceId: { equals: input.deviceId.toLowerCase() } },
    limit: 1,
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: device lookup by id (ownership checked below)
    req,
  })
  const existing = found.docs[0] as DeviceDoc | undefined
  const now = new Date().toISOString()
  if (existing) {
    if (relId(existing.user) !== uid) throw new APIError('Perangkat terdaftar untuk pengguna lain.', 409, null, true)
    if (existing.status !== 'active') throw new APIError('Perangkat sudah dicabut. Pasang ulang aplikasi.', 403, null, true)
    const updated = await req.payload.update({
      collection: 'devices',
      id: existing.id,
      data: {
        model: input.model,
        appVersion: input.appVersion,
        fcmToken: input.fcmToken,
        keycloakSid: keycloakSid ?? existing.keycloakSid,
        lastSeenAt: now,
        ...integrityData(input, now),
      },
      depth: 0,
      req,
      overrideAccess: true, // SYSTEM-WRITE: device registry (owner verified above)
    })
    return { device: updated, created: false }
  }
  const created = await req.payload.create({
    collection: 'devices',
    data: {
      deviceId: input.deviceId.toLowerCase(),
      user: uid,
      platform: input.platform,
      model: input.model,
      appVersion: input.appVersion,
      fcmToken: input.fcmToken,
      keycloakSid,
      status: 'active',
      registeredAt: now,
      lastSeenAt: now,
      ...integrityData(input, now),
    },
    depth: 0,
    req,
    overrideAccess: true, // SYSTEM-WRITE: device registry (create access is false for HTTP)
  })
  await writeAudit(req, [{ action: 'device_register', docType: 'device', docId: String(created.id), newValue: created.deviceId }])
  return { device: created, created: true }
}

/** Who may revoke: Admin/Owner any device, everyone else only their own. */
export function canRevoke(req: PayloadRequest, device: { user: unknown }): boolean {
  return hasRole(req, 'pk-admin', 'pk-owner') || relId(device.user) === relId(req.user)
}

/**
 * POST /api/v1/devices/{id}/revoke. DB first (effective immediately for our API — access tokens
 * stay valid ≤ 300 s by signature, so the strategy's device check is what matters), then the
 * Keycloak offline + online session of the device (best effort, spike b: offline needs
 * `?isOffline=true`). Must run inside a transaction.
 */
export async function revokeDevice(req: PayloadRequest, ref: string, reason: string) {
  const where: Where = DEVICE_ID_RE.test(ref) ? { deviceId: { equals: ref.toLowerCase() } } : { id: { equals: Number(ref) } }
  const found = await req.payload.find({
    collection: 'devices',
    where,
    limit: 1,
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: ownership/role checked by canRevoke
    req,
  })
  const device = found.docs[0] as DeviceDoc | undefined
  if (!device || !canRevoke(req, device)) throw new APIError('Perangkat tidak ditemukan.', 404, null, true)
  if (device.status !== 'active') return { device, alreadyRevoked: true }
  const updated = await req.payload.update({
    collection: 'devices',
    id: device.id,
    data: { status: 'revoked', revokeReason: reason, changeReason: reason },
    depth: 0,
    req,
    overrideAccess: true, // SYSTEM-WRITE: revocation after canRevoke()
  })
  return { device: updated, alreadyRevoked: false }
}

/** Keycloak side of a revocation (called from the devices afterChange hook). Never throws. */
export async function endKeycloakDeviceSession(req: PayloadRequest, sid: string | null | undefined): Promise<string> {
  if (!sid) return 'no_sid'
  try {
    const kc = getKeycloakAdmin()
    const offline = await kc.deleteSession(sid, true)
    const online = await kc.deleteSession(sid, false)
    return `offline:${offline ? 'deleted' : 'absent'},online:${online ? 'deleted' : 'absent'}`
  } catch (err) {
    req.payload.logger.warn({ msg: 'keycloak device session delete failed', err: (err as Error).message })
    return 'keycloak_error'
  }
}
