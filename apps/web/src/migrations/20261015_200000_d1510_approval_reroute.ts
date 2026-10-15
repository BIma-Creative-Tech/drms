import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

import { applyReroute, companyCodes, revertReroute, type Exec } from '@/reroute/db'
import { planSummary } from '@/reroute/plan'

/**
 * d1510 — owner decision 2026-10-15 (ADR 0026 amendment), DATA ONLY, hand-written, IDEMPOTENT, run as <prefix>_owner
 * (no schema change → no Payload snapshot JSON, like 20261013_630200).
 *
 * 1. The default rules of EVERY PT ("Default — Direktur lalu Finance (semua nominal)" and the inactive example
 *    "Contoh — di atas Rp 10 juta: Direktur lalu Finance (Q-31, nonaktif)") — only while they still have exactly the
 *    ADR 0013 shape ("Diketahui" Direktur → Finance) or the ADR 0013 + Owner shape of 20261013_630200 (Direktur → Owner
 *    → Finance) — get the seed shape: "Diketahui" = PM project (`scope_manager`), level 1 Direktur, level 2 Owner;
 *    Finance only transfers. Ids kept (requests reference them), renamed to the seed names, one audit row each. A rule
 *    an Admin changed to another shape is left alone (listed in the log).
 * 2. In-flight requests under those rules that the Direktur has NOT decided yet (`pending_ack`, no decision in the
 *    current cycle, "Diketahui Direktur" snapshot, no G1 exception) are re-routed to the rule + snapshot a submit TODAY
 *    produces (same code: domain/expense/snapshot-plan.ts): the PM project approves first, unless the requester /
 *    creator is the PM (PM step skipped → "Menunggu persetujuan Direktur"); a Direktur's own request takes "Pengajuan
 *    Direktur" (→ Owner). Doc no, lines, amounts, attachments, signatures and the approval cycle are kept. Requests the
 *    submit would refuse (409) or send without approval (Owner's own) keep their flow (listed). Audit + notification of
 *    the new first approver as at submit. Requests past the Direktur are not touched.
 * Read-only preview: `src/reroute/cli.ts -- --dry-run` (exact, migrate image) / `src/reroute/preview.sql` (psql).
 * Runbook: docs/proyekkas/runbooks/alur-persetujuan-2026-10-15.md.
 * Down: refused when a re-routed request moved since; else the old rule / snapshot / status of every re-routed request
 * and the old name + shape of every aligned rule (while still aligned) come back from the audit rows.
 */
const NAME = '20261015_200000_d1510_approval_reroute'

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

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await ownerOnly(db)
  const exec = db as unknown as Exec
  const r = await applyReroute(exec, { push: process.env.PUSH_FCM_ENABLED === 'true', appUrl: process.env.APP_URL })
  payload?.logger?.info?.({ msg: `${NAME}: owner decision 2026-10-15`, rulesAligned: r.rulesAligned, requestsRerouted: r.requestsRerouted, notifications: r.notifications })
  payload?.logger?.info?.(planSummary(r.plan, await companyCodes(exec)))
}

export async function down({ db, payload }: MigrateDownArgs): Promise<void> {
  await ownerOnly(db as unknown as MigrateUpArgs['db'])
  const r = await revertReroute(db as unknown as Exec)
  payload?.logger?.info?.({ msg: `${NAME} down`, ...r })
}
