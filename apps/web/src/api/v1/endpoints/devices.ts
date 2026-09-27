import { registerDevice, revokeDevice } from '@/domain/devices'

import { DeviceRegister, DeviceRevoke } from '../schemas'
import { HttpError, json, problem, v1 } from '../http'

type DeviceDoc = {
  id: number
  deviceId: string
  status: 'active' | 'revoked' | 'lost'
  model?: string | null
  appVersion?: string | null
  registeredAt?: string | null
  lastSeenAt?: string | null
  revokedAt?: string | null
  integrityRisk?: boolean | null
  integrityCheckedAt?: string | null
}

const dto = (d: DeviceDoc) => ({
  id: d.id,
  deviceId: d.deviceId,
  status: d.status,
  model: d.model ?? null,
  appVersion: d.appVersion ?? null,
  registeredAt: d.registeredAt ?? null,
  lastSeenAt: d.lastSeenAt ?? null,
  revokedAt: d.revokedAt ?? null,
  integrityRisk: d.integrityRisk === true,
  integrityCheckedAt: d.integrityCheckedAt ?? null,
})

/**
 * POST /api/v1/devices/register (APK, bearer). The only bearer path allowed without an already
 * registered device (mobileBearer strategy); X-Device-Id must equal the body's deviceId.
 */
export const registerDeviceEndpoint = v1({
  path: '/devices/register',
  method: 'post',
  body: DeviceRegister,
  rateLimit: [10, 60_000],
  transactional: true,
  handler: async ({ req, body }) => {
    const u = req.user as unknown as { _strategy?: string; _pkKc?: { sid?: string | null } }
    if (u._strategy !== 'mobileBearer') return problem(403, 'Forbidden', { detail: 'Hanya untuk aplikasi Android.' })
    const header = req.headers.get('x-device-id')?.toLowerCase()
    if (header !== body.deviceId.toLowerCase()) throw new HttpError(400, 'Bad Request', { detail: 'X-Device-Id tidak sama dengan deviceId.' })
    const { device, created } = await registerDevice(req, body, u._pkKc?.sid ?? undefined)
    return json(dto(device as unknown as DeviceDoc), created ? 201 : 200)
  },
})

/** POST /api/v1/devices/{id}/revoke — Admin/Owner any device, users their own (id or deviceId). */
export const revokeDeviceEndpoint = v1({
  path: '/devices/:id/revoke',
  method: 'post',
  body: DeviceRevoke,
  rateLimit: [10, 60_000],
  transactional: true,
  handler: async ({ req, body, params }) => {
    const ref = params.id ?? ''
    if (!/^(\d{1,10}|[0-9a-f-]{36})$/i.test(ref)) throw new HttpError(404, 'Not Found')
    req.context.auditReason = body.reason
    const { device } = await revokeDevice(req, ref, body.reason)
    return json(dto(device as unknown as DeviceDoc))
  },
})
