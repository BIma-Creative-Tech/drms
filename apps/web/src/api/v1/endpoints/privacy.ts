import { sql } from '@payloadcms/db-postgres'

import { userId } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { PRIVACY_NOTICE, PRIVACY_NOTICE_VERSION } from '@/legal/privacy-notice'
import { getRequestTx } from '@/lib/tx'

import { HttpError, json, v1 } from '../http'
import { PrivacyAckBody } from '../schemas-privacy'

/**
 * GET /api/v1/privacy-notice — the employee privacy notice (Q-46, ASVS 8.3.3), PUBLIC: shown before login, on
 * /privasi and in the APK (which caches it for offline display). The body is the build-time bundle of
 * docs/proyekkas/legal/pemberitahuan-privasi.md: `html` is the safe rendering (escaped text, attribute-less tags
 * only), `markdown` the source. No per-request DB/disk read.
 */
export const privacyNoticeEndpoint = v1({
  path: '/privacy-notice',
  method: 'get',
  auth: 'public',
  handler: async () =>
    Response.json(
      { version: PRIVACY_NOTICE.version, title: PRIVACY_NOTICE.title, html: PRIVACY_NOTICE.html, markdown: PRIVACY_NOTICE.markdown },
      { status: 200, headers: { 'Cache-Control': 'public, max-age=300' } },
    ),
})

export const PRIVACY_VERSION_MISMATCH_DETAIL = 'Pemberitahuan privasi sudah diperbarui. Muat ulang dan baca versi terbaru.'

/**
 * POST /api/v1/me/privacy-ack { version } — the caller acknowledges the CURRENT privacy notice (ADR 0018).
 * `version` must equal the bundled version, else 409 `PRIVACY_VERSION_MISMATCH` (the client showed an older or a
 * newer text). Stores `users.privacyAckVersion` + `privacyAckAt` (DB clock) of the caller only — those fields are
 * read-only in the admin/REST and this is their only writer — and writes one `privacy_ack` audit row, in one
 * transaction. Re-acknowledging an already acknowledged version changes nothing (200, `alreadyAcknowledged`,
 * original timestamp, no new audit row). Idempotency-Key: required from the APK, optional on the web.
 */
export const privacyAckEndpoint = v1({
  path: '/me/privacy-ack',
  method: 'post',
  body: PrivacyAckBody,
  rateLimit: [10, 60_000],
  transactional: true,
  idempotent: true,
  maxBodyBytes: 1024,
  handler: async ({ req, body }) => {
    const uid = userId(req)
    if (uid === undefined) throw new HttpError(401, 'Unauthorized')
    if (body.version !== PRIVACY_NOTICE_VERSION) {
      throw new HttpError(409, 'Conflict', { code: 'PRIVACY_VERSION_MISMATCH', detail: PRIVACY_VERSION_MISMATCH_DETAIL, currentVersion: PRIVACY_NOTICE_VERSION })
    }
    const tx = await getRequestTx(req)
    const cur = (await tx.execute(sql`SELECT privacy_ack_version, privacy_ack_at FROM users WHERE id = ${uid} FOR UPDATE`)) as unknown as {
      rows: Array<{ privacy_ack_version: string | number | null; privacy_ack_at: string | Date | null }>
    }
    const row = cur.rows[0]
    if (!row) throw new HttpError(401, 'Unauthorized')
    const had = row.privacy_ack_version === null ? null : Number(row.privacy_ack_version)
    if (had !== null && had >= body.version && row.privacy_ack_at !== null) {
      return json({ version: had, ackAt: new Date(row.privacy_ack_at).toISOString(), alreadyAcknowledged: true })
    }
    const upd = (await tx.execute(
      sql`UPDATE users SET privacy_ack_version = ${body.version}, privacy_ack_at = now() WHERE id = ${uid} RETURNING privacy_ack_at`,
    )) as unknown as { rows: Array<{ privacy_ack_at: string | Date }> }
    const ackAt = new Date(upd.rows[0]!.privacy_ack_at).toISOString()
    // App-wide account event (doc type `user`, no PT): visible to group admins and the Admin/Direktur of every PT.
    await writeAudit(req, [
      { action: 'privacy_ack', docType: 'user', docId: String(uid), field: 'privacyAckVersion', oldValue: had, newValue: body.version, companyId: null },
    ])
    return json({ version: body.version, ackAt, alreadyAcknowledged: false })
  },
})
