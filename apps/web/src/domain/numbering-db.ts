import { sql } from '@payloadcms/db-postgres'
import { APIError, type PayloadRequest } from 'payload'

import { writeAudit } from '@/audit/writer'
import { settings } from '@/domain/companies'
import { DEFAULT_TZ, localDateInTz, type LocalDate } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

import { formatDocNo, periodKey, validatePattern, type ResetPolicy, type SequenceConfig } from './numbering'

export type Allocation = { docNo: string; seq: number; periodKey: string; docType: string }

/** Active sequence config of `docType` (SYSTEM-READ inside the request transaction). */
export async function loadSequence(req: PayloadRequest, docType: string): Promise<SequenceConfig> {
  const res = await req.payload.find({
    collection: 'document-sequences',
    where: { and: [{ docType: { equals: docType } }, { active: { equals: true } }] },
    limit: 1,
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: numbering configuration
    req,
  })
  const s = res.docs[0]
  if (!s) throw new APIError(`Penomoran untuk ${docType} belum dikonfigurasi.`, 500)
  return {
    docType: s.docType,
    docCode: s.docCode ?? undefined,
    pattern: s.pattern,
    resetPolicy: s.resetPolicy as ResetPolicy,
    padding: s.padding ?? 0,
    startAt: s.startAt ?? 1,
    timezone: s.timezone || DEFAULT_TZ,
  }
}

async function companyCode(req: PayloadRequest): Promise<string> {
  return (await settings(req)).shortCode || 'DRMS'
}

/**
 * Allocates the next number INSIDE the request transaction (ADR 0007 §5):
 * `INSERT … ON CONFLICT DO NOTHING` + `UPDATE … RETURNING` takes a row lock held until commit,
 * so concurrent allocations serialise and a rollback of the business transaction also rolls the
 * counter back (no gap). Throws when `req` has no transaction (getRequestTx).
 * The document date is the business date in the sequence timezone (default: now).
 */
export async function allocateDocNo(
  req: PayloadRequest,
  docType: string,
  opts: { date?: LocalDate; docId?: string; audit?: boolean } = {},
): Promise<Allocation> {
  const tx = await getRequestTx(req)
  const cfg = await loadSequence(req, docType)
  validatePattern(cfg.pattern, cfg.resetPolicy)
  const date = opts.date ?? localDateInTz(new Date(), cfg.timezone)
  const key = periodKey(cfg.resetPolicy, date)
  await tx.execute(sql`
    INSERT INTO document_sequence_counters (doc_type, period_key, next_value)
    VALUES (${cfg.docType}, ${key}, ${cfg.startAt})
    ON CONFLICT (doc_type, period_key) DO NOTHING`)
  const res = await tx.execute(sql`
    UPDATE document_sequence_counters SET next_value = next_value + 1
    WHERE doc_type = ${cfg.docType} AND period_key = ${key}
    RETURNING next_value - 1 AS allocated`)
  const row = (res as unknown as { rows: Array<{ allocated: number | string }> }).rows[0]
  if (!row) throw new Error('numbering: counter row missing')
  const seq = Number(row.allocated)
  const docNo = formatDocNo(cfg, seq, date, await companyCode(req))
  if (opts.audit !== false) {
    await writeAudit(req, [
      { action: 'number_issued', docType: cfg.docType, docId: opts.docId, docNo, field: 'docNo', newValue: docNo },
    ])
  }
  return { docNo, seq, periodKey: key, docType: cfg.docType }
}
