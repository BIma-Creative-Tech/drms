import { randomUUID } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres'
import { createLocalReq, type PayloadRequest } from 'payload'

import { rolesOf } from '@/access/roles'
import { requestMeta } from '@/lib/request-meta'
import { withReqTransaction } from '@/lib/system-tx'
import { getRequestTx } from '@/lib/tx'

/** Values of `audit_logs.action` (ADR 0006 §3 + requirements v1.1 §8). Postgres enum via select. */
export const AUDIT_ACTIONS = [
  'create',
  'update',
  'status_change',
  'deactivate',
  'reactivate',
  'delete_attempt',
  'void',
  'view_sensitive',
  'login',
  'logout',
  'login_failed',
  'session_revoked',
  'role_change',
  'role_sync',
  'device_register',
  'device_revoke',
  'number_issued',
  'export',
  'print',
  'sign',
  'acknowledge',
  'flag_raised',
  'flag_reviewed',
  'sync_odoo',
  'sync_offline',
  'period_close',
  'period_reopen',
  'schema_maintenance',
  'email_test',
  // F2a (requirements v1.1 §8 T2/T4): approval decisions and receipt verification
  'approve',
  'reject',
  'verify',
  // F2e: "Diketahui" delegated to Owner/Admin at submit (Q-07/Q-08 fallback); a guard refused an
  // action and the attempt is recorded in its own transaction (e.g. Finance on its own request).
  'acknowledge_delegated',
  'access_denied',
  // E1 (ADR 0013 G1-2): a decision position was skipped at submit because its only holders are the
  // requester/creator (e.g. the only Direktur is the requester).
  'approval_skipped',
  // E6 S2 (Q-33): the selfieRetention job deleted selfie files past the retention period (one
  // summary row per run, counts only).
  'retention_purge',
  // S3b / E11: go-live data import (one row per changed master + one summary row per run).
  'import',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export type AuditRow = {
  action: AuditAction
  docType: string
  docId?: string
  docNo?: string
  field?: string
  lineNo?: number
  oldValue?: unknown
  newValue?: unknown
  statusFrom?: string
  statusTo?: string
  reason?: string
  /** Device wall clock of an offline action (comparison only; server_time stays authoritative). */
  deviceTime?: string
}

type UserLike = { id?: unknown; roles?: unknown } | null | undefined

/**
 * Writes audit rows through Payload in the SAME transaction as the business change (`req`),
 * ADR 0006 §4. Requires an active transaction: without one each row would commit on its own
 * and a failing business write could leave orphan audit rows (or the reverse).
 * `server_time` is set by the DB trigger; any value passed here is ignored.
 */
export async function writeAudit(req: PayloadRequest, rows: AuditRow[], user?: UserLike): Promise<void> {
  if (rows.length === 0) return
  const tx = await getRequestTx(req) // throws when there is no transaction
  const r = (await tx.execute(sql`SELECT txid_current()::text AS tx`)) as unknown as { rows: Array<{ tx: string }> }
  const txId = Number(r.rows[0]?.tx)
  const meta = requestMeta(req)
  const u = user === undefined ? (req.user as UserLike) : user
  const uid = typeof u?.id === 'number' ? u.id : typeof u?.id === 'string' && /^\d+$/.test(u.id) ? Number(u.id) : undefined
  const roles = rolesOf(u).join(',')
  const eventId = randomUUID()
  for (const row of rows) {
    await req.payload.create({
      collection: 'audit-logs',
      data: {
        eventId,
        txId,
        requestId: meta.requestId,
        docType: row.docType,
        docId: row.docId,
        docNo: row.docNo,
        action: row.action,
        field: row.field,
        lineNo: row.lineNo,
        // Payload json fields reject bare strings (JSON.parse) → always wrap (spike finding c.4).
        oldValue: row.oldValue === undefined ? undefined : ({ v: row.oldValue } as never),
        newValue: row.newValue === undefined ? undefined : ({ v: row.newValue } as never),
        statusFrom: row.statusFrom,
        statusTo: row.statusTo,
        reason: row.reason,
        userId: uid,
        userRoles: roles || undefined,
        source: meta.source,
        appVersion: meta.appVersion,
        ip: meta.ip,
        deviceId: meta.deviceId,
        deviceTime: row.deviceTime,
      },
      req,
      depth: 0,
      // No `context` option here: Local API merges it into the SHARED req.context
      // (utilities/createLocalReq.js getRequestContext), which would leak into later operations.
      overrideAccess: true, // SYSTEM-WRITE: append-only audit (collection create access is false)
    })
  }
}

/**
 * Writes audit rows in their OWN transaction, for denied attempts: the business operation that
 * triggered them fails and rolls back, the record of the attempt must survive (architecture §7.4,
 * `delete_attempt` pattern). Never throws — a failing audit write is logged, the denial stands.
 */
export async function writeAuditDetached(req: PayloadRequest, rows: AuditRow[]): Promise<void> {
  if (rows.length === 0 || !req.user) return
  try {
    const meta = requestMeta(req)
    const logReq = await createLocalReq(
      { req: { headers: req.headers }, user: req.user, context: { pkRequestId: meta.requestId, auditSource: meta.source } },
      req.payload,
    )
    await withReqTransaction(logReq, () => writeAudit(logReq, rows))
  } catch (err) {
    req.payload.logger.error({ msg: 'detached audit write failed', action: rows[0]?.action, err: (err as Error).message })
  }
}
