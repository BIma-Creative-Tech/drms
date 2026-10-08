import { unlink } from 'node:fs/promises'

import { sql } from '@payloadcms/db-postgres'
import type { CollectionSlug, Payload } from 'payload'
import { z } from 'zod'

import { writeAudit } from '@/audit/writer'
import { mediaPath } from '@/lib/media-files'
import { withSystemTransaction } from '@/lib/system-tx'
import { getRequestTx } from '@/lib/tx'

/**
 * QA-11 — orphan general attachments (`media-attachments`). The web forms upload the file FIRST and
 * then post the action that links it (claimMedia); when the action fails (e.g. the LPJ refund before
 * QA-11, a closed period, a network drop) the uploaded file stays behind, linked to nothing.
 *
 * Candidate = a media-attachments row
 * - never claimed (`owner_doc_id` IS NULL),
 * - received more than `minAgeDays` days ago (server clock), and
 * - referenced by NO foreign key at all (cash_entries.proof_id, the expense-request "Lampiran umum"
 *   relation table, …) — the referencing columns are read from the Postgres catalog at run time, so a
 *   future reference is honoured without touching this job.
 *
 * Like the selfie retention (domain/attendance/retention.ts): OFF by default = DRY RUN (count only,
 * logged). With MEDIA_ORPHAN_PURGE_ENABLED=true one run handles at most `batch` rows (oldest first):
 * in ONE transaction the rows are locked (SKIP LOCKED), TOMBSTONED — owner link set once to
 * `orphan_purged` / `purged` (the owner columns are immutable once set: DB trigger
 * pk_protect_columns, so a tombstone can never be claimed by a document afterwards; claimMedia answers
 * 409 "File sudah dihapus …") — and one `retention_purge` audit row (counts + up to 20 ids, no PII) is
 * written; after the commit the files (and their thumbnails) are unlinked. A failed unlink leaves an
 * unreferenced file behind (logged as `failed`), never a document pointing at a missing file. The
 * media ROW stays (the app role has no DELETE on media tables).
 */
export const ORPHAN_MARK = { type: 'orphan_purged', id: 'purged' } as const

/** Collections handled by the job (table = Payload's snake_case table). */
export const ORPHAN_COLLECTIONS: ReadonlyArray<{ slug: CollectionSlug; table: string }> = [{ slug: 'media-attachments', table: 'media_attachments' }]

const orphanEnv = z.object({
  MEDIA_ORPHAN_PURGE_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  MEDIA_ORPHAN_MIN_AGE_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  MEDIA_ORPHAN_BATCH: z.coerce.number().int().min(1).max(2000).default(200),
})

export type OrphanConfig = { enabled: boolean; minAgeDays: number; batch: number }

/** Job settings from the environment (unset = defaults: dry run, 7 days, 200 per run). Invalid → throws (variable names only, like lib/env.ts). */
export function orphanConfig(source: Record<string, string | undefined> = process.env): OrphanConfig {
  const r = orphanEnv.safeParse({
    MEDIA_ORPHAN_PURGE_ENABLED: source.MEDIA_ORPHAN_PURGE_ENABLED || undefined,
    MEDIA_ORPHAN_MIN_AGE_DAYS: source.MEDIA_ORPHAN_MIN_AGE_DAYS || undefined,
    MEDIA_ORPHAN_BATCH: source.MEDIA_ORPHAN_BATCH || undefined,
  })
  if (!r.success) throw new Error(`Invalid env: ${r.error.issues.map((i) => i.path.join('.')).join(', ')}`)
  return { enabled: r.data.MEDIA_ORPHAN_PURGE_ENABLED, minAgeDays: r.data.MEDIA_ORPHAN_MIN_AGE_DAYS, batch: r.data.MEDIA_ORPHAN_BATCH }
}

export function orphanCutoff(now: Date, minAgeDays: number): Date {
  return new Date(now.getTime() - minAgeDays * 86_400_000)
}

type Tx = Awaited<ReturnType<typeof getRequestTx>>
type Db = { execute: Tx['execute'] }

/** Foreign-key columns referencing `table` (catalog lookup; identifiers come from Postgres, not from input). */
async function referencingColumns(db: Db, table: string): Promise<Array<{ tbl: string; col: string }>> {
  const r = (await db.execute(sql`
    SELECT cl.relname AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f' AND c.confrelid = to_regclass(${table})
     ORDER BY 1, 2`)) as unknown as { rows: Array<{ tbl: string; col: string }> }
  return r.rows
}

async function candidateWhere(db: Db, table: string, cutoff: Date) {
  const refs = await referencingColumns(db, table)
  const notReferenced = refs.map((x) => sql` AND NOT EXISTS (SELECT 1 FROM ${sql.identifier(x.tbl)} ref WHERE ref.${sql.identifier(x.col)} = m.id)`)
  return sql`m.owner_doc_id IS NULL AND coalesce(m.received_at, m.created_at) < ${cutoff.toISOString()}::timestamptz${sql.join(notReferenced, sql``)}`
}

export type OrphanResult = {
  collection: string
  dryRun: boolean
  minAgeDays: number
  cutoff: string
  candidates: number
  marked: number
  deleted: number
  failed: number
  remaining: number
  sampleIds: number[]
}

type Row = { id: number; filename: string | null; thumb: string | null }

async function unlinkQuiet(payload: Payload, slug: CollectionSlug, filename: string | null): Promise<boolean> {
  const file = mediaPath(payload, slug, filename)
  if (!file) return filename === null // no stored name = nothing on disk; an unexpected name is never touched
  try {
    await unlink(file)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

async function runOne(payload: Payload, c: { slug: CollectionSlug; table: string }, cfg: OrphanConfig, now: Date): Promise<OrphanResult> {
  const cutoff = orphanCutoff(now, cfg.minAgeDays)
  const base = { collection: c.slug, minAgeDays: cfg.minAgeDays, cutoff: cutoff.toISOString() }
  const t = sql.identifier(c.table)
  if (!cfg.enabled) {
    const db = payload.db.drizzle as unknown as Db
    const where = await candidateWhere(db, c.table, cutoff)
    const r = (await db.execute(sql`
      SELECT count(*)::int AS n, (array_agg(m.id ORDER BY m.received_at, m.id))[1:20] AS sample
        FROM ${t} m WHERE ${where}`)) as unknown as { rows: Array<{ n: number; sample: number[] | null }> }
    const n = Number(r.rows[0]?.n ?? 0)
    return { ...base, dryRun: true, candidates: n, marked: 0, deleted: 0, failed: 0, remaining: n, sampleIds: (r.rows[0]?.sample ?? []).map(Number) }
  }
  const { rows, candidates } = await withSystemTransaction(
    payload,
    null,
    async (req) => {
      const tx = await getRequestTx(req)
      // one cleanup run at a time (a second worker tick waits, then finds nothing left to do)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pk:media-orphans:${c.table}`}, 0))`)
      const where = await candidateWhere(tx, c.table, cutoff)
      const total = (await tx.execute(sql`SELECT count(*)::int AS n FROM ${t} m WHERE ${where}`)) as unknown as { rows: Array<{ n: number }> }
      const pick = (await tx.execute(sql`
        SELECT m.id FROM ${t} m WHERE ${where}
         ORDER BY m.received_at, m.id
         LIMIT ${cfg.batch}
         FOR UPDATE SKIP LOCKED`)) as unknown as { rows: Array<{ id: number }> }
      const ids = pick.rows.map((x) => Number(x.id))
      let marked: Row[] = []
      if (ids.length > 0) {
        const upd = (await tx.execute(sql`
          UPDATE ${t} SET owner_doc_type = ${ORPHAN_MARK.type}, owner_doc_id = ${ORPHAN_MARK.id}, updated_at = now()
           WHERE owner_doc_id IS NULL AND id IN (${sql.join(
             ids.map((i) => sql`${i}`),
             sql`, `,
           )})
          RETURNING id, filename, sizes_thumb_filename AS thumb`)) as unknown as { rows: Row[] }
        marked = upd.rows.map((x) => ({ id: Number(x.id), filename: x.filename, thumb: x.thumb }))
        await writeAudit(req, [
          {
            action: 'retention_purge',
            docType: c.table,
            docId: 'orphans',
            field: 'file',
            newValue: { minAgeDays: cfg.minAgeDays, cutoff: cutoff.toISOString(), marked: marked.length, candidates: Number(total.rows[0]?.n ?? 0), sampleIds: marked.slice(0, 20).map((x) => x.id) },
            reason: `Lampiran yatim (tidak dipakai dokumen apa pun) > ${cfg.minAgeDays} hari dihapus (QA-11)`,
            companyId: null,
          },
        ])
      }
      return { rows: marked, candidates: Number(total.rows[0]?.n ?? 0) }
    },
    { auditSource: 'job' },
  )
  let deleted = 0
  let failed = 0
  for (const r of rows) {
    const main = await unlinkQuiet(payload, c.slug, r.filename)
    const thumb = r.thumb ? await unlinkQuiet(payload, c.slug, r.thumb) : true
    if (main && thumb) deleted++
    else failed++
  }
  return { ...base, dryRun: false, candidates, marked: rows.length, deleted, failed, remaining: candidates - rows.length, sampleIds: rows.slice(0, 20).map((r) => r.id) }
}

/**
 * One cleanup run over ORPHAN_COLLECTIONS (the daily job). `now` / `config` are injectable for tests;
 * a failing collection is logged, the others continue.
 */
export async function purgeOrphanMedia(payload: Payload, opts: { now?: Date; config?: OrphanConfig } = {}): Promise<OrphanResult[]> {
  const cfg = opts.config ?? orphanConfig()
  const now = opts.now ?? new Date()
  const out: OrphanResult[] = []
  for (const c of ORPHAN_COLLECTIONS) {
    try {
      out.push(await runOne(payload, c, cfg, now))
    } catch (err) {
      payload.logger.error({ msg: 'media orphan cleanup failed', collection: c.slug, err: (err as Error).message })
    }
  }
  return out
}
