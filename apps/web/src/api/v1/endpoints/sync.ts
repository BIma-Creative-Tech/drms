import { processBatch } from '@/domain/sync/service'

import { HttpError, json, problem, v1 } from '../http'
import { SYNC_MAX_BYTES, SyncBatch } from '../schemas-sync'

/** Architecture §6.5: `sync/batch` 12/min per user. */
export const SYNC_RATE_LIMIT: [number, number] = [12, 60_000]

/**
 * POST /api/v1/sync/batch (ADR 0010 "Sync contract") — APK only (bearer + registered device whose
 * id equals `device_id`). Always 200 with one result per item; 4xx only for an invalid envelope or
 * auth. Per-item transactions: the endpoint itself is NOT transactional (domain/sync/service.ts).
 * `Idempotency-Key` (= batch_id) is accepted but not needed: every item is idempotent by its
 * `client_uuid` (a replayed batch answers `duplicate` per item).
 */
export const syncBatchEndpoint = v1({
  path: '/sync/batch',
  method: 'post',
  body: SyncBatch,
  maxBodyBytes: SYNC_MAX_BYTES,
  rateLimit: SYNC_RATE_LIMIT,
  handler: async ({ req, body }) => {
    const u = req.user as unknown as { _strategy?: string; _pkDevice?: { deviceId: string } }
    if (u._strategy !== 'mobileBearer' || !u._pkDevice) return problem(403, 'Forbidden', { detail: 'Hanya untuk aplikasi Android.' })
    if (u._pkDevice.deviceId.toLowerCase() !== body.device_id.toLowerCase()) {
      throw new HttpError(400, 'Bad Request', { detail: 'device_id tidak sama dengan X-Device-Id.' })
    }
    return json(await processBatch(req, body, u._pkDevice.deviceId))
  },
})
