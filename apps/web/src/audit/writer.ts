import { randomUUID } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres'
import { createLocalReq, type PayloadRequest } from 'payload'

import { rolesIn, rolesOf } from '@/access/roles'
import { AUDIT_ACTOR_DISPLAY } from '@/domain/direktur-rules'
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
  // ADR 0021 (owner 2026-10-10): the narrow G1 exception `direktur_via_pm` was applied at submit (a
  // Direktur's request filed by the PM project: PM approves as PM project, then the Direktur).
  'approval_policy_exception',
  // E6 S2 (Q-33): the selfieRetention job deleted selfie files past the retention period (one
  // summary row per run, counts only).
  'retention_purge',
  // S3b / E11: go-live data import (one row per changed master + one summary row per run).
  'import',
  // ADR 0017: optional self-service 2FA — a user turned TOTP on/off for their own account
  // (Keycloak application-initiated action, outcome verified through the Admin API).
  '2fa_enabled',
  '2fa_disabled',
  // ADR 0018 (Q-46, ASVS 8.3.3): a user acknowledged the employee privacy notice ("Saya mengerti", web or APK).
  'privacy_ack',
  // QA report 2026-10-08 (owner decisions): a cash-out confirmed although the account balance goes below 0
  // (QA-04), a transfer confirmed to an employee bank account that is not verified (QA-17).
  'overdraft_confirmed',
  'bank_unverified_confirmed',
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
  /** PT of the document (ADR 0016 §4, nullable: logins, shared masters, app-wide settings). */
  companyId?: number | null
}

type UserLike = { id?: unknown; roles?: unknown } | null | undefined

/**
 * MC4 QA (QA-MC4-03) + UAT MC4-04: `docType` → [per-PT table whose row id is the `docId`, column holding that
 * row's PT]. A row about such a document written WITHOUT `companyId` (domain call sites: request lines,
 * signatures, PDF export, flags, decisions, corrections, the import cut-over …) gets the document's PT, so it
 * is shown to the office roles of THAT PT only (untagged rows are visible beyond one PT). Covers every per-PT
 * collection audited by `withAudit` (the hook tags those rows from `doc.company` already), `company` (the PT
 * itself) and the five owner-linked media collections (`owner_company_id`, derived by DB triggers).
 * App-wide doc types (user, device, web_session, users, company_settings, report, import, audit_log, banks,
 * UoM, notification templates, signatures, logos) are deliberately absent. Constant identifiers, no user input
 * reaches them. The backfill migration `20261003_090000_mc4_audit_company_backfill` holds a frozen copy of
 * this map (a test keeps the two equal).
 */
export const PER_PT_DOC_TYPES: Readonly<Record<string, readonly [table: string, column: string]>> = {
  expense_request: ['expense_requests', 'company_id'],
  urgency_level: ['urgency_levels', 'company_id'],
  budget_addendum: ['budget_addenda', 'company_id'],
  progress_report: ['progress_reports', 'company_id'],
  settlement: ['settlements', 'company_id'],
  transfer: ['transfers', 'company_id'],
  receipt: ['receipts', 'company_id'],
  attendance: ['attendances', 'company_id'],
  attendance_correction: ['attendance_corrections', 'company_id'],
  cash_entry: ['cash_entries', 'company_id'],
  period_closing: ['period_closings', 'company_id'],
  project: ['projects', 'company_id'],
  project_stage: ['project_stages', 'company_id'],
  team_assignment: ['team_assignments', 'company_id'],
  employee: ['employees', 'company_id'],
  employee_bank_account: ['employee_bank_accounts', 'company_id'],
  // UAT MC4-04: the remaining per-PT collections (masters / configuration) and the PT itself
  budget_line: ['budget_lines', 'company_id'],
  client: ['clients', 'company_id'],
  vendor: ['vendors', 'company_id'],
  stage_template: ['stage_templates', 'company_id'],
  expense_category: ['expense_categories', 'company_id'],
  cash_in_source: ['cash_in_sources', 'company_id'],
  cash_account: ['cash_accounts', 'company_id'],
  work_schedule: ['work_schedules', 'company_id'],
  approval_rule: ['approval_rules', 'company_id'],
  vehicle: ['vehicles', 'company_id'],
  cost_center: ['cost_centers', 'company_id'],
  document_sequence: ['document_sequences', 'company_id'],
  company_membership: ['company_memberships', 'company_id'],
  company: ['companies', 'id'],
  // owner-linked media (QA-MC4-07 `ownerCompany`): uploads, `view_sensitive`, signed-URL `access_denied`
  media_receipts: ['media_receipts', 'owner_company_id'],
  media_transfer_proofs: ['media_transfer_proofs', 'owner_company_id'],
  media_selfies: ['media_selfies', 'owner_company_id'],
  media_progress_photos: ['media_progress_photos', 'owner_company_id'],
  media_attachments: ['media_attachments', 'owner_company_id'],
  // FR1 (ADR 0020): contract units + field reports (rows written after the MC4 backfill — not in its frozen copy)
  contract_unit: ['contract_units', 'company_id'],
  service_report: ['service_reports', 'company_id'],
  unit_timesheet: ['unit_timesheets', 'company_id'],
  aftersales_activity: ['aftersales_activities', 'company_id'],
  // P3: konstruksi RAP + Laporan Harian
  daily_report: ['daily_reports', 'company_id'],
  rap_item: ['rap_items', 'company_id'],
  rap_template: ['rap_templates', 'company_id'],
  resource_type: ['resource_types', 'company_id'],
  // ADR 0022: inter-project loans + their repayments
  project_loan: ['project_loans', 'company_id'],
  project_loan_repayment: ['project_loan_repayments', 'company_id'],
  site: ['sites', 'company_id'],
}

/** Doc types added after the MC4 audit backfill (migration 20261003): absent from its frozen BY_ID copy. */
export const POST_MC4_DOC_TYPES: readonly string[] = ['contract_unit', 'service_report', 'unit_timesheet', 'aftersales_activity', 'daily_report', 'rap_item', 'rap_template', 'resource_type', 'project_loan', 'project_loan_repayment', 'site']

async function derivedCompany(tx: Awaited<ReturnType<typeof getRequestTx>>, row: AuditRow, cache: Map<string, number | null>): Promise<number | null | undefined> {
  if (row.companyId !== undefined) return row.companyId
  const target = Object.hasOwn(PER_PT_DOC_TYPES, row.docType) ? PER_PT_DOC_TYPES[row.docType] : undefined
  if (!target || !row.docId || !/^\d{1,9}$/.test(row.docId)) return undefined
  const k = `${row.docType}:${row.docId}`
  if (!cache.has(k)) {
    const [table, column] = target
    const r = (await tx.execute(sql`SELECT ${sql.identifier(column)} AS company_id FROM ${sql.identifier(table)} WHERE id = ${Number(row.docId)}`)) as unknown as { rows: Array<{ company_id: number | null }> }
    cache.set(k, r.rows[0]?.company_id ?? null)
  }
  return cache.get(k) ?? undefined
}

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
  const rolesAny = rolesOf(u).join(',')
  const eventId = randomUUID()
  // ADR 0025: a representative deciding a Direktur step as the PT's definitive Direktur — the rows keep the real
  // user id (forensics), the history shows the Direktur's name (only for rows of the request's own user)
  const shown = user === undefined ? req.context?.[AUDIT_ACTOR_DISPLAY] : undefined
  const actorDisplayName = typeof shown === 'string' && shown.trim() ? shown.trim().slice(0, 200) : undefined
  const companies = new Map<string, number | null>()
  for (const given of rows) {
    const row: AuditRow = { ...given, companyId: await derivedCompany(tx, given, companies) }
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
        actorDisplayName,
        // actor roles IN the row's PT when known (ADR 0016), else in any selected PT
        userRoles: (typeof row.companyId === 'number' ? rolesIn({ user: u } as never, row.companyId).join(',') : rolesAny) || undefined,
        company: row.companyId ?? undefined,
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
