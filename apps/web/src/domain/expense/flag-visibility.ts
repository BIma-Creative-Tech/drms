import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest, Where } from 'payload'

import { mappedCompanies, relId } from '@/access/roles'

/**
 * Duplicate-receipt flags across PTs (QA-MC4-06, owner decision 2026-10-02 = ADR 0016 "Scope rule").
 *
 * - Detection (`receipts.ts` `duplicateHits`) searches the request's own PT plus the PTs the
 *   UPLOADER of the receipt is mapped to. A hit in another PT is stored with `relatedCompany` = that
 *   PT (`receipt_flags.related_company_id`); a hit in the request's own PT leaves it empty.
 * - Display: a flag with `relatedCompany` is shown ONLY to viewers mapped to that PT. Everyone else
 *   sees NOTHING of it — no neutral "possible duplicate" text either: every reader of a PT A request is
 *   mapped to A, so a flag they cannot resolve would tell them that PT X holds the same receipt (an
 *   existence oracle for a PT outside their mapping). The same filter applies to every count, the
 *   verification gate, the internal PDF, the REST collection, reports and the "Riwayat" tab.
 * - Numbers stored for everyone (`approvals.openFlags`) count only flags without `relatedCompany`.
 */

/** Payload Where: flags the caller may see (null = system request, no filter). */
export function flagVisibleWhere(req: PayloadRequest): Where | null {
  const mapped = mappedCompanies(req)
  if (mapped === null) return null
  const none: Where = { relatedCompany: { exists: false } }
  return mapped.length > 0 ? { or: [none, { relatedCompany: { in: mapped } }] } : none
}

/** `and` of `where` with the caller's flag visibility. */
export function withFlagVisibility(req: PayloadRequest, where: Where): Where {
  const v = flagVisibleWhere(req)
  return v ? { and: [where, v] } : where
}

/** Flags every reader of the request may see (counts stored on decisions). */
export const SHARED_FLAG_WHERE: Where = { relatedCompany: { exists: false } }

/** SQL predicate on a `receipt_flags` alias column `related_company_id` (raw-SQL reports). */
export function flagVisibleSql(req: PayloadRequest, column: ReturnType<typeof sql>): ReturnType<typeof sql> {
  const mapped = mappedCompanies(req)
  if (mapped === null) return sql`TRUE`
  if (mapped.length === 0) return sql`${column} IS NULL`
  return sql`(${column} IS NULL OR ${column} IN (${sql.join(
    mapped.map((c) => sql`${c}`),
    sql`, `,
  )}))`
}

/** May the caller see a flag whose related request is in `relatedCompany`? */
export function mayViewFlag(req: PayloadRequest, flag: { relatedCompany?: unknown }): boolean {
  const c = relId(flag.relatedCompany)
  if (c === undefined) return true
  const mapped = mappedCompanies(req)
  return mapped === null || mapped.includes(c)
}

/**
 * Audit rows of a cross-PT flag (flag_raised / flag_reviewed) carry `relatedCompanyId` in `newValue`;
 * the "Riwayat" tab drops them for viewers not mapped to that PT (the rows are written WITHOUT a PT,
 * so the audit collection / report / dashboard show them only to group admins and to the Admin /
 * Direktur of every PT — see `mayReadUntaggedAudit`).
 */
export function auditRowVisible(req: PayloadRequest, row: { action: string; newValue: unknown }): boolean {
  if (row.action !== 'flag_raised' && row.action !== 'flag_reviewed') return true
  const v = row.newValue as { relatedCompanyId?: unknown } | null
  const c = v && typeof v === 'object' && typeof v.relatedCompanyId === 'number' ? v.relatedCompanyId : undefined
  if (c === undefined) return true
  const mapped = mappedCompanies(req)
  return mapped === null || mapped.includes(c)
}
