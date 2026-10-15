import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

import { companyCodes, type Exec } from '@/reroute/db'
import { applyInflightTrim, revertInflightTrim } from '@/reroute/trim-db'
import { payloadFinalizer } from '@/reroute/trim-finalize'
import { trimSummary } from '@/reroute/trim-plan'

/**
 * d1510 — owner decision 2026-10-15 (ADR 0026 amendment), follow-up of 20261015_200000_d1510_approval_reroute: "Pastikan
 * ini berlaku dengan transaksi yg existing; jika masih berjalan lanjutkan penyesuaian approval flow". DATA ONLY,
 * hand-written, IDEMPOTENT, run as <prefix>_owner AFTER 200000 (no schema change → no Payload snapshot JSON).
 * Finance never approves: every in-flight request (`pending_ack` / `pending_approval`, any rule, G1 exceptions excluded)
 * whose snapshot still has an UNDECIDED Finance approval level is trimmed (src/reroute/trim-plan.ts):
 *  1. waiting before the Finance level → the Finance level(s) are dropped (status, level, decisions kept);
 *  2. waiting at a Finance level, no Owner level → that level becomes the Owner's; the Owners are notified;
 *  3. waiting at a Finance level after the Owner approved → "Disetujui" through the app's finalisation (fund check
 *     ADR 0029 first: refused → kept and listed), into the Finance transfer queue;
 *  4. an old-flow request the Direktur decided is never sent back to the PM project (noted in the audit / stepper).
 * Doc no, lines, amounts, signatures, approval cycle and every decision are kept. Draft / rejected / cancelled /
 * approved and later requests are never read for writing.
 * Read-only preview: `src/reroute/cli.ts -- --dry-run` (exact, both migrations) / `src/reroute/preview-trim.sql` (psql).
 * Runbook: docs/proyekkas/runbooks/alur-persetujuan-2026-10-15.md.
 * Down: refused when a trimmed request moved since or went "Disetujui" (case 3); else the old snapshots come back.
 */
const NAME = '20261015_210000_d1510_approval_inflight_trim'

async function ownerOnly(db: MigrateUpArgs['db']): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)
}

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await ownerOnly(db)
  const exec = db as unknown as Exec
  // case 3 needs the app's finalisation in THIS transaction: the Payload req of `payload migrate`
  const finalizer = payload && req?.transactionID ? payloadFinalizer(req) : undefined
  const r = await applyInflightTrim(exec, { push: process.env.PUSH_FCM_ENABLED === 'true', appUrl: process.env.APP_URL, finalizer })
  payload?.logger?.info?.({ msg: `${NAME}: owner decision 2026-10-15`, trimmed: r.trimmed, ownerLevels: r.ownerLevels, approved: r.approved, kept: r.plans.filter((p) => p.kind === 'keep').length, notifications: r.notifications })
  payload?.logger?.info?.(trimSummary(r, await companyCodes(exec)))
}

export async function down({ db, payload }: MigrateDownArgs): Promise<void> {
  await ownerOnly(db as unknown as MigrateUpArgs['db'])
  const r = await revertInflightTrim(db as unknown as Exec)
  payload?.logger?.info?.({ msg: `${NAME} down`, ...r })
}
