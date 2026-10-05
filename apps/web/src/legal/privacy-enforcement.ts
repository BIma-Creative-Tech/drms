import { sql } from '@payloadcms/db-postgres'
import { APIError, type PayloadRequest } from 'payload'

import { writeAuditDetached } from '@/audit/writer'
import { cachedMinAppVersion, compareAppVersions, parseAppVersion, type AppVersion } from '@/lib/app-min-version'
import { withReqTransaction } from '@/lib/system-tx'
import { getRequestTx } from '@/lib/tx'

import { PRIVACY_NOTICE_VERSION, privacyAckCurrent } from './privacy-notice'

/**
 * Server-side enforcement of the privacy-notice acknowledgement (ADR 0018, owner decision 2026-10-05).
 *
 * While the app-wide "Versi APK minimum" (`company-settings.minAppVersion`) is ≥ 0.3.3 — the first APK that shows
 * the notice and blocks attendance itself — the server refuses attendance captures (selfie + location) of a user
 * whose `users.privacyAckVersion` is below the current notice version:
 * - sync items `attendance.check_in` / `attendance.check_out` / `attendance.on_behalf` (the ACTING user, i.e. the PM
 *   for on-behalf) → per-item `rejected` `PRIVACY_ACK_REQUIRED` (final, stored like every rejection);
 * - selfie uploads (`POST /api/v1/media/selfies`, and the generic Payload REST create of `media-selfies`) → 403
 *   `PRIVACY_ACK_REQUIRED`.
 * Every refusal is audited `access_denied` (reason `PRIVACY_ACK_REQUIRED`) in its own transaction.
 * Below 0.3.3, or with no / an unreadable minimum, nothing is enforced: APK ≤ 0.3.2 has no notice screen.
 * Corrections by PM/Admin (no selfie/location capture) are not affected.
 */
export const PRIVACY_ACK_REQUIRED = 'PRIVACY_ACK_REQUIRED'

/** First APK version with the notice screen + local attendance gate (apps/mobile 0.3.3). */
export const PRIVACY_ENFORCEMENT_FROM_APK = '0.3.3'
const FROM: AppVersion = parseAppVersion(PRIVACY_ENFORCEMENT_FROM_APK)!

export const PRIVACY_ACK_REQUIRED_DETAIL =
  'Absensi ditolak: Anda belum menekan "Saya mengerti" pada pemberitahuan privasi terbaru. Buka aplikasi, baca pemberitahuan privasi (Profil → Pemberitahuan privasi), lalu absen ulang.'

/** Pure: is the enforcement on for this "Versi APK minimum"? Missing / garbage → false. */
export function privacyEnforcementActive(minAppVersion: unknown): boolean {
  const min = parseAppVersion(minAppVersion)
  return min !== null && compareAppVersions(min, FROM) >= 0
}

export type PrivacyAckCheck = { required: boolean; minAppVersion: string | null; ackVersion: number | null }

/** Acknowledged version of `uid` from the DB (joins the request transaction, opens a short one otherwise). */
async function ackVersionOf(req: PayloadRequest, uid: number): Promise<number | null> {
  return withReqTransaction(req, async () => {
    const tx = await getRequestTx(req)
    const r = (await tx.execute(sql`SELECT privacy_ack_version FROM users WHERE id = ${uid}`)) as unknown as { rows: Array<{ privacy_ack_version: string | number | null }> }
    const v = r.rows[0]?.privacy_ack_version
    return v === null || v === undefined ? null : Number(v)
  })
}

/** Must `uid` acknowledge the current notice before capturing attendance? (no DB read while enforcement is off) */
export async function privacyAckCheck(req: PayloadRequest, uid: number): Promise<PrivacyAckCheck> {
  const minAppVersion = await cachedMinAppVersion(req)
  if (!privacyEnforcementActive(minAppVersion)) return { required: false, minAppVersion, ackVersion: null }
  const ackVersion = await ackVersionOf(req, uid)
  return { required: !privacyAckCurrent(ackVersion), minAppVersion, ackVersion }
}

/** `access_denied` row of a refusal, written in its own transaction (the refused write rolls back). */
export async function auditPrivacyDenied(req: PayloadRequest, check: PrivacyAckCheck, where: { docType: string; field: string; companyId: number | null }): Promise<void> {
  await writeAuditDetached(req, [
    {
      action: 'access_denied',
      docType: where.docType,
      field: where.field,
      reason: PRIVACY_ACK_REQUIRED,
      newValue: { currentVersion: PRIVACY_NOTICE_VERSION, ackVersion: check.ackVersion, minAppVersion: check.minAppVersion },
      companyId: where.companyId,
    },
  ])
}

/** Refusal of a Payload operation (generic REST create of `media-selfies`): 403 with the stable code. */
export class PrivacyAckRequiredError extends APIError {
  readonly pkCode = PRIVACY_ACK_REQUIRED
  constructor() {
    super(PRIVACY_ACK_REQUIRED_DETAIL, 403, null, true)
  }
}

/** Set by POST /api/v1/media/selfies after its own check, so the collection hook does not check (and audit) twice. */
export const PRIVACY_CHECKED_KEY = 'pkPrivacyAckChecked'

/**
 * `beforeOperation` guard of selfie uploads (`media-selfies` create). Requests without a user (system/seed) are
 * not affected; the /api/v1 endpoint checks first and marks the request ([PRIVACY_CHECKED_KEY]).
 */
export async function assertSelfieUploadAllowed(req: PayloadRequest): Promise<void> {
  if (req.context?.[PRIVACY_CHECKED_KEY] === true) return
  const uid = (req.user as { id?: unknown } | null | undefined)?.id
  if (typeof uid !== 'number') return
  const check = await privacyAckCheck(req, uid)
  if (!check.required) return
  await auditPrivacyDenied(req, check, { docType: 'media_selfies', field: 'upload', companyId: null })
  throw new PrivacyAckRequiredError()
}
