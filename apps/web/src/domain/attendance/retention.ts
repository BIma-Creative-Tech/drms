import { unlink } from 'node:fs/promises'

import { sql } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'

import { writeAudit } from '@/audit/writer'
import { mediaPath } from '@/lib/media-files'
import { withSystemTransaction } from '@/lib/system-tx'
import { getRequestTx } from '@/lib/tx'

import { retentionCutoff } from './schedule'

/**
 * E6 — selfie retention (Q-33, UU No. 27/2022 PDP; plan fase1-golive E6 "selfie > retensi terhapus
 * dari volume, baris absensi tetap"). Candidates = selfies whose upload (`received_at`, server clock)
 * is older than `selfieRetentionMonths` months and whose file is still there (`removed_at` empty).
 * Face reference photos (`employees.face_ref_photo`, same media collection) are never candidates.
 *
 * Deletion (only when company-settings.selfieRetentionDeleteEnabled, default OFF = dry run):
 * at most `selfieRetentionBatch` files per run (oldest first). For each candidate the FILE is unlinked
 * first (a missing file counts as deleted), then the media row gets `removed_at` = DB clock and one
 * `retention_purge` audit row summarises the run (counts only, no ids/PII) — all in one transaction.
 * A crash between unlink and commit leaves a row without file, which the next run marks (idempotent);
 * the reverse order could leave a marked row whose file still exists (personal data kept).
 * The media ROW stays as a tombstone: `attendances.selfie_id` is NOT NULL and the attendance table
 * is append-only (DB triggers), so deleting media rows would require relaxing those guarantees.
 * Attendance rows (time, GPS, distance) are never touched; GET /attendance/{id}/selfie answers 404.
 */
export type RetentionPlan = { months: number; cutoff: string; candidates: number; oldestReceivedAt: string | null; sampleIds: number[] }

export type RetentionSettings = { months: number; deleteEnabled: boolean; batch: number }

export async function retentionSettings(payload: Payload, req?: PayloadRequest): Promise<RetentionSettings> {
  const s = (await payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: retention settings (job) */, req })) as {
    selfieRetentionMonths?: number | null
    selfieRetentionDeleteEnabled?: boolean | null
    selfieRetentionBatch?: number | null
  }
  const months = typeof s.selfieRetentionMonths === 'number' && s.selfieRetentionMonths >= 1 ? s.selfieRetentionMonths : 12
  const batch = typeof s.selfieRetentionBatch === 'number' && s.selfieRetentionBatch >= 1 ? Math.min(2000, Math.floor(s.selfieRetentionBatch)) : 200
  return { months, deleteEnabled: s.selfieRetentionDeleteEnabled === true, batch }
}

const candidateWhere = (cutoff: Date) => sql`
  m.received_at < ${cutoff.toISOString()}::timestamptz
  AND m.removed_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.face_ref_photo_id = m.id)`

export async function selfieRetentionPlan(payload: Payload, now: Date = new Date()): Promise<RetentionPlan> {
  const { months } = await retentionSettings(payload)
  const cutoff = retentionCutoff(now, months)
  const res = (await payload.db.drizzle.execute(sql`
    SELECT count(*)::int AS n, min(m.received_at) AS oldest,
           (array_agg(m.id ORDER BY m.received_at, m.id))[1:20] AS sample
    FROM media_selfies m
    WHERE ${candidateWhere(cutoff)}`)) as unknown as {
    rows: Array<{ n: number; oldest: string | Date | null; sample: number[] | null }>
  }
  const r = res.rows[0] ?? { n: 0, oldest: null, sample: null }
  return {
    months,
    cutoff: cutoff.toISOString(),
    candidates: Number(r.n),
    oldestReceivedAt: r.oldest ? new Date(r.oldest).toISOString() : null,
    sampleIds: (r.sample ?? []).map(Number),
  }
}

export type PurgeResult = {
  months: number
  cutoff: string
  dryRun: boolean
  candidates: number
  deleted: number
  failed: number
  remaining: number
}

type Candidate = { id: number; filename: string | null }

/** Unlinks one stored file; ENOENT = already gone (counts as deleted). Other errors → false. */
async function removeFile(payload: Payload, filename: string | null): Promise<boolean> {
  const file = mediaPath(payload, 'media-selfies', filename)
  if (!file) return filename === null // no stored name = nothing on disk; an unexpected name is never touched
  try {
    await unlink(file)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

/**
 * One retention run (the daily job). `now` = injectable clock (fake-clock tests). Dry run unless the
 * company setting is on; `forceEnabled` overrides the switch (tests only).
 */
export async function purgeExpiredSelfies(payload: Payload, opts: { now?: Date; forceEnabled?: boolean } = {}): Promise<PurgeResult> {
  const now = opts.now ?? new Date()
  const st = await retentionSettings(payload)
  const cutoff = retentionCutoff(now, st.months)
  const enabled = opts.forceEnabled ?? st.deleteEnabled
  if (!enabled) {
    const plan = await selfieRetentionPlan(payload, now)
    return { months: st.months, cutoff: plan.cutoff, dryRun: true, candidates: plan.candidates, deleted: 0, failed: 0, remaining: plan.candidates }
  }
  return withSystemTransaction(
    payload,
    null,
    async (req) => {
      const tx = await getRequestTx(req)
      // One retention run at a time (a second worker tick waits, then finds nothing left to do).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('pk:selfie-retention', 0))`)
      const total = (await tx.execute(sql`SELECT count(*)::int AS n FROM media_selfies m WHERE ${candidateWhere(cutoff)}`)) as unknown as { rows: Array<{ n: number }> }
      const candidates = Number(total.rows[0]?.n ?? 0)
      const pick = (await tx.execute(sql`
        SELECT m.id, m.filename FROM media_selfies m
        WHERE ${candidateWhere(cutoff)}
        ORDER BY m.received_at, m.id
        LIMIT ${st.batch}
        FOR UPDATE SKIP LOCKED`)) as unknown as { rows: Candidate[] }
      const done: number[] = []
      let failed = 0
      for (const c of pick.rows) {
        if (await removeFile(payload, c.filename)) done.push(Number(c.id))
        else failed++
      }
      if (done.length > 0) {
        await tx.execute(
          sql`UPDATE media_selfies SET removed_at = clock_timestamp() WHERE id IN (${sql.join(
            done.map((i) => sql`${i}`),
            sql`, `,
          )})`,
        )
      }
      const result: PurgeResult = { months: st.months, cutoff: cutoff.toISOString(), dryRun: false, candidates, deleted: done.length, failed, remaining: candidates - done.length }
      if (pick.rows.length > 0) {
        await writeAudit(req, [
          {
            action: 'retention_purge',
            docType: 'media_selfies',
            docId: 'retention',
            field: 'file',
            newValue: { months: st.months, cutoff: result.cutoff, deleted: result.deleted, failed: result.failed, remaining: result.remaining, batch: st.batch },
            reason: `Retensi selfie ${st.months} bulan (Q-33)`,
          },
        ])
      }
      return result
    },
    { auditSource: 'job' },
  )
}
