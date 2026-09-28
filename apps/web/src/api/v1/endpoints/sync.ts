import { CompanyRequiredError, processBatch } from '@/domain/sync/service'

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
 * MC3-1: each item carries `company_id` and is processed under that PT (domain/sync/service.ts);
 * a batch with items WITHOUT `company_id` from an account with ≠ 1 PT → 409 COMPANY_REQUIRED.
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
    try {
      return json(await processBatch(req, body, u._pkDevice.deviceId))
    } catch (err) {
      // MC3-1: items without company_id (released APK) from an account with several PTs — nothing
      // processed; the old APK keeps them queued (retry with back-off) and shows `detail`.
      if (err instanceof CompanyRequiredError) {
        return problem(409, 'Conflict', {
          code: 'COMPANY_REQUIRED',
          detail: 'Akun Anda terdaftar di lebih dari satu PT. Perbarui aplikasi untuk mengirim data offline (setiap data harus menyebut PT-nya).',
          errors: err.indexes.map((i) => ({ path: `items.${i}.company_id`, message: 'company_id wajib untuk akun dengan lebih dari satu PT.' })),
        })
      }
      throw err
    }
  },
})
