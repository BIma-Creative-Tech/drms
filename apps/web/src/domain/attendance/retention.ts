import { unlink } from 'node:fs/promises'

import { sql } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'

import { writeAudit } from '@/audit/writer'
import { mediaPath } from '@/lib/media-files'
import { withSystemTransaction } from '@/lib/system-tx'
import { getRequestTx } from '@/lib/tx'

import { retentionCutoff } from './schedule'
import { activeCompanyIds, settingsOf } from '@/domain/companies'

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

/**
 * Retention settings of ONE PT (ADR 0016 §7: months / delete switch per PT — the company is the UU PDP
 * controller; the batch size is app-wide). Default: company #1.
 */
export async function retentionSettings(payload: Payload, req?: PayloadRequest, companyId?: number | null): Promise<RetentionSettings> {
  const s = await settingsOf(payload, companyId ?? null, req)
  const months = typeof s.selfieRetentionMonths === 'number' && s.selfieRetentionMonths >= 1 ? s.selfieRetentionMonths : 12
  const batch = typeof s.selfieRetentionBatch === 'number' && s.selfieRetentionBatch >= 1 ? Math.min(2000, Math.floor(s.selfieRetentionBatch)) : 200
  return { months, deleteEnabled: s.selfieRetentionDeleteEnabled === true, batch }
}

/**
 * Candidates of PT `companyId`: selfies referenced by an attendance of that PT. The FIRST active PT
 * (`withOrphans`) also takes selfies without attendance (uploaded, never used) and selfies of
 * attendances of INACTIVE PTs — so every selfie belongs to exactly one run.
 */
const candidateWhere = (cutoff: Date, companyId: number, withOrphans: boolean) => sql`
  m.received_at < ${cutoff.toISOString()}::timestamptz
  AND m.removed_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.face_ref_photo_id = m.id)
  AND (EXISTS (SELECT 1 FROM attendances a WHERE a.selfie_id = m.id AND a.company_id = ${companyId})
       OR (${withOrphans} AND NOT EXISTS (SELECT 1 FROM attendances a JOIN companies co ON co.id = a.company_id AND co.active WHERE a.selfie_id = m.id)))`

/** Active PTs (id order) — the first one also owns the orphans (see candidateWhere). */
async function retentionCompanies(payload: Payload, companyId?: number): Promise<Array<{ id: number; orphans: boolean }>> {
  const all = await activeCompanyIds(payload)
  return (companyId !== undefined ? all.filter((c) => c === companyId) : all).map((id) => ({ id, orphans: id === all[0] }))
}

async function planOne(payload: Payload, now: Date, c: { id: number; orphans: boolean }): Promise<RetentionPlan> {
  const { months } = await retentionSettings(payload, undefined, c.id)
  const cutoff = retentionCutoff(now, months)
  const res = (await payload.db.drizzle.execute(sql`
    SELECT count(*)::int AS n, min(m.received_at) AS oldest,
           (array_agg(m.id ORDER BY m.received_at, m.id))[1:20] AS sample
    FROM media_selfies m
    WHERE ${candidateWhere(cutoff, c.id, c.orphans)}`)) as unknown as {
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

/**
 * Dry-run plan over every active PT (or `companyId`); `months`/`cutoff` = those of the first PT, the
 * counts are summed (`byCompany` = per PT).
 */
export async function selfieRetentionPlan(payload: Payload, now: Date = new Date(), companyId?: number): Promise<RetentionPlan & { byCompany: Array<{ companyId: number } & RetentionPlan> }> {
  const byCompany: Array<{ companyId: number } & RetentionPlan> = []
  for (const c of await retentionCompanies(payload, companyId)) byCompany.push({ companyId: c.id, ...(await planOne(payload, now, c)) })
  const first = byCompany[0]
  const oldest = byCompany.map((b) => b.oldestReceivedAt).filter((x): x is string => !!x).sort()[0] ?? null
  return {
    months: first?.months ?? 12,
    cutoff: first?.cutoff ?? retentionCutoff(now, 12).toISOString(),
    candidates: byCompany.reduce((a, b) => a + b.candidates, 0),
    oldestReceivedAt: oldest,
    sampleIds: byCompany.flatMap((b) => b.sampleIds).slice(0, 20),
    byCompany,
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

/** One PT: dry run or delete up to `budget` files (the app-wide batch is shared by the PTs of a run). */
async function purgeOne(payload: Payload, now: Date, c: { id: number; orphans: boolean }, forceEnabled: boolean | undefined, budget: number): Promise<PurgeResult & { batch: number }> {
  const st = await retentionSettings(payload, undefined, c.id)
  const cutoff = retentionCutoff(now, st.months)
  const enabled = forceEnabled ?? st.deleteEnabled
  if (!enabled || budget <= 0) {
    const plan = await planOne(payload, now, c)
    return { months: st.months, cutoff: plan.cutoff, dryRun: !enabled, candidates: plan.candidates, deleted: 0, failed: 0, remaining: plan.candidates, batch: st.batch }
  }
  return withSystemTransaction(
    payload,
    null,
    async (req) => {
      const tx = await getRequestTx(req)
      // One retention run at a time (a second worker tick waits, then finds nothing left to do).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('pk:selfie-retention', 0))`)
      const total = (await tx.execute(sql`SELECT count(*)::int AS n FROM media_selfies m WHERE ${candidateWhere(cutoff, c.id, c.orphans)}`)) as unknown as { rows: Array<{ n: number }> }
      const candidates = Number(total.rows[0]?.n ?? 0)
      const pick = (await tx.execute(sql`
        SELECT m.id, m.filename FROM media_selfies m
        WHERE ${candidateWhere(cutoff, c.id, c.orphans)}
        ORDER BY m.received_at, m.id
        LIMIT ${Math.min(st.batch, budget)}
        FOR UPDATE SKIP LOCKED`)) as unknown as { rows: Candidate[] }
      const done: number[] = []
      let failed = 0
      for (const x of pick.rows) {
        if (await removeFile(payload, x.filename)) done.push(Number(x.id))
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
      const result = { months: st.months, cutoff: cutoff.toISOString(), dryRun: false, candidates, deleted: done.length, failed, remaining: candidates - done.length, batch: st.batch }
      if (pick.rows.length > 0) {
        await writeAudit(req, [
          {
            action: 'retention_purge',
            docType: 'media_selfies',
            docId: 'retention',
            field: 'file',
            newValue: { months: st.months, cutoff: result.cutoff, deleted: result.deleted, failed: result.failed, remaining: result.remaining, batch: st.batch },
            reason: `Retensi selfie ${st.months} bulan (Q-33)`,
            companyId: c.id,
          },
        ])
      }
      return result
    },
    { auditSource: 'job' },
  )
}

/**
 * One retention run (the daily job) over every active PT with that PT's months / switch (or
 * `companyId` only). `now` = injectable clock (fake-clock tests); `forceEnabled` overrides the switch
 * (tests only). The app-wide batch caps the files deleted per run across all PTs; a failing PT is
 * logged, the others continue. The result sums the PTs (`months`/`cutoff` of the first PT).
 */
export async function purgeExpiredSelfies(payload: Payload, opts: { now?: Date; forceEnabled?: boolean; companyId?: number } = {}): Promise<PurgeResult> {
  const now = opts.now ?? new Date()
  const parts: PurgeResult[] = []
  let budget: number | null = null
  for (const c of await retentionCompanies(payload, opts.companyId)) {
    try {
      const r = await purgeOne(payload, now, c, opts.forceEnabled, budget ?? Number.MAX_SAFE_INTEGER)
      budget = (budget ?? r.batch) - r.deleted - r.failed
      parts.push(r)
    } catch (err) {
      payload.logger.error({ msg: 'selfie retention failed for a PT', companyId: c.id, err: (err as Error).message })
    }
  }
  const first = parts[0]
  return {
    months: first?.months ?? 12,
    cutoff: first?.cutoff ?? retentionCutoff(now, 12).toISOString(),
    dryRun: parts.every((p) => p.dryRun),
    candidates: parts.reduce((a, p) => a + p.candidates, 0),
    deleted: parts.reduce((a, p) => a + p.deleted, 0),
    failed: parts.reduce((a, p) => a + p.failed, 0),
    remaining: parts.reduce((a, p) => a + p.remaining, 0),
  }
}
