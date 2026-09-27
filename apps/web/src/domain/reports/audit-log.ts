import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

import { AUDIT_ACTIONS, type AuditAction } from '@/audit/writer'
import { addDays, isBusinessDate } from '@/domain/expense/types'

import { inSequence, num, reportContext, rows } from './kpi'
import { daysBetween } from './rules'
import type { SQL } from './scope'

/**
 * K-16 global audit log (requirements §8 "Tampilan log", wireframe §6): read-only view over
 * `audit_logs` for Owner/Admin/Finance (Q-F3-4, user 2026-09-24). Filters: WITA date range
 * (default the last 7 days — never an unbounded count), user, document type, action, document
 * number prefix, source. Newest first, keyset paging on (server_time, id), ≤ 100 rows per page.
 */
export const AUDIT_SOURCES = ['web', 'apk', 'system', 'job'] as const
export const AUDIT_PAGE = 100
export const AUDIT_EXPORT_MAX_DAYS = 31

export type AuditFilter = {
  from: string
  to: string
  userId?: number
  docType?: string
  action?: AuditAction
  docNo?: string
  source?: (typeof AUDIT_SOURCES)[number]
}

export function parseAuditFilter(sp: URLSearchParams, today: string): AuditFilter {
  let from = sp.get('dari') ?? ''
  let to = sp.get('sampai') ?? ''
  if (!isBusinessDate(to)) to = today
  if (!isBusinessDate(from)) from = addDays(to, -6)
  if (from > to) [from, to] = [to, from]
  const f: AuditFilter = { from, to }
  const user = sp.get('user') ?? ''
  if (/^\d{1,10}$/.test(user)) f.userId = Number(user)
  const docType = sp.get('jenis') ?? ''
  if (/^[a-z_]{1,40}$/.test(docType)) f.docType = docType
  const action = sp.get('aksi') ?? ''
  if ((AUDIT_ACTIONS as readonly string[]).includes(action)) f.action = action as AuditAction
  const docNo = (sp.get('nodok') ?? '').trim()
  if (docNo && docNo.length <= 60) f.docNo = docNo
  const source = sp.get('sumber') ?? ''
  if ((AUDIT_SOURCES as readonly string[]).includes(source)) f.source = source as AuditFilter['source']
  return f
}

export const auditRangeDays = (f: AuditFilter) => daysBetween(f.from, f.to) + 1

function where(f: AuditFilter, tz: string): SQL {
  const w: SQL[] = [
    sql`a.server_time >= (${f.from}::date::timestamp AT TIME ZONE ${tz})`,
    sql`a.server_time < ((${f.to}::date + 1)::timestamp AT TIME ZONE ${tz})`,
  ]
  if (f.userId !== undefined) w.push(sql`a.user_id = ${f.userId}`)
  if (f.docType) w.push(sql`a.doc_type = ${f.docType}`)
  if (f.action) w.push(sql`a.action = ${f.action}`)
  // prefix match without LIKE wildcards from user input
  if (f.docNo) w.push(sql`left(a.doc_no, length(${f.docNo})) = ${f.docNo}`)
  if (f.source) w.push(sql`a.source = ${f.source}`)
  return sql.join(w, sql` AND `)
}

export type AuditRow = {
  id: number
  serverTime: string
  localTime: string
  userId: number | null
  userName: string | null
  userRoles: string | null
  action: string
  docType: string
  docId: string | null
  docNo: string | null
  field: string | null
  lineNo: number | null
  oldValue: unknown
  newValue: unknown
  statusFrom: string | null
  statusTo: string | null
  reason: string | null
  source: string | null
  appVersion: string | null
  ip: string | null
  deviceId: string | null
  requestId: string | null
}

export function encodeAuditCursor(r: Pick<AuditRow, 'serverTime' | 'id'>): string {
  return Buffer.from(`${r.serverTime}|${r.id}`).toString('base64url')
}

function decodeCursor(c: string | undefined): { t: string; id: number } | null {
  if (!c) return null
  const [t, id] = Buffer.from(c, 'base64url').toString('utf8').split('|')
  if (!t || !id || !/^\d{1,12}$/.test(id) || Number.isNaN(Date.parse(t))) return null
  return { t, id: Number(id) }
}

export async function auditLogPage(req: PayloadRequest, f: AuditFilter, page: { cursor?: string; limit: number }): Promise<{ rows: AuditRow[]; next: string | null }> {
  const ctx = await reportContext(req)
  const c = decodeCursor(page.cursor)
  const r = await rows(
    req,
    sql`SELECT a.id, to_char(a.server_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS server_time,
          to_char(a.server_time AT TIME ZONE ${ctx.tz}, 'YYYY-MM-DD HH24:MI:SS') AS local_time,
          a.user_id, coalesce(e.name, u.name, u.email) AS user_name, a.user_roles, a.action::text AS action, a.doc_type, a.doc_id, a.doc_no,
          a.field, a.line_no, a.old_value, a.new_value, a.status_from, a.status_to, a.reason, a.source::text AS source, a.app_version,
          a.ip, a.device_id, a.request_id
        FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN employees e ON e.id = u.employee_id
        WHERE ${where(f, ctx.tz)} ${c ? sql`AND (a.server_time, a.id) < (${c.t}::timestamptz, ${c.id})` : sql``}
        ORDER BY a.server_time DESC, a.id DESC LIMIT ${page.limit + 1}`,
  )
  const list: AuditRow[] = r.slice(0, page.limit).map((x) => ({
    id: num(x.id),
    serverTime: String(x.server_time),
    localTime: String(x.local_time),
    userId: x.user_id === null ? null : num(x.user_id),
    userName: (x.user_name as string | null) ?? null,
    userRoles: (x.user_roles as string | null) ?? null,
    action: String(x.action),
    docType: String(x.doc_type),
    docId: (x.doc_id as string | null) ?? null,
    docNo: (x.doc_no as string | null) ?? null,
    field: (x.field as string | null) ?? null,
    lineNo: x.line_no === null ? null : num(x.line_no),
    oldValue: unwrap(x.old_value),
    newValue: unwrap(x.new_value),
    statusFrom: (x.status_from as string | null) ?? null,
    statusTo: (x.status_to as string | null) ?? null,
    reason: (x.reason as string | null) ?? null,
    source: (x.source as string | null) ?? null,
    appVersion: (x.app_version as string | null) ?? null,
    ip: (x.ip as string | null) ?? null,
    deviceId: (x.device_id as string | null) ?? null,
    requestId: (x.request_id as string | null) ?? null,
  }))
  const last = list.at(-1)
  return { rows: list, next: r.length > page.limit && last ? encodeAuditCursor(last) : null }
}

/** writeAudit wraps values as { v } (json fields reject bare strings) → show the inner value. */
function unwrap(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && 'v' in v) return (v as { v: unknown }).v
  return v ?? null
}

export async function auditLogCount(req: PayloadRequest, f: AuditFilter): Promise<number> {
  const ctx = await reportContext(req)
  const r = await rows(req, sql`SELECT count(*)::int AS n FROM audit_logs a WHERE ${where(f, ctx.tz)}`)
  return num(r[0]?.n)
}

/** Filter dropdowns: users that appear in the log, document types in use. */
export async function auditFilterOptions(req: PayloadRequest) {
  const [users, types] = await inSequence(
    () => rows(req, sql`SELECT u.id, coalesce(e.name, u.name, u.email) AS name FROM users u LEFT JOIN employees e ON e.id = u.employee_id ORDER BY 2`),
    () => rows(req, sql`SELECT DISTINCT doc_type FROM audit_logs ORDER BY 1`),
  )
  return {
    users: users.map((x) => ({ value: String(x.id), label: String(x.name) })),
    docTypes: types.map((x) => ({ value: String(x.doc_type), label: String(x.doc_type) })),
  }
}
