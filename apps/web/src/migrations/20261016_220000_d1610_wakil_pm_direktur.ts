import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * D1610 wakil PM + Direktur (owner decision 2026-10-16, amends ADR 0025 / supersedes the 2026-10-14 answer "a
 * representative who approved as PM can't decide the Direktur step") — DB guards, hand-written, run as <prefix>_owner.
 *
 * G1 "one decision position per person per cycle" now counts a user's PERSONAL decisions and their decisions AS THE
 * PT's DEFINITIVE DIREKTUR (`signature_source = 'company'`, ADR 0025) separately: a designated representative who
 * decided the PM step with their own signature may also decide the Direktur step of the same request / LPJ shortfall
 * signed as the definitive Direktur — never two positions under the same identity. The key gains the boolean
 * `coalesce(signature_source = 'company', false)`; `approvals_signature_company` (BEFORE INSERT) still allows a
 * company-signed row only for a designated representative with the Direktur role, and the requester/creator G1
 * trigger is unchanged. Addendum and loan decisions keep the strict index (no PM step there).
 *
 * Existing rows cannot violate the new (weaker) indexes. Down restores the strict indexes; refused while a cycle holds
 * a personal and a company-signed decision of the same user (restore the dump instead).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;

    DROP INDEX IF EXISTS approvals_one_position_per_person;
    CREATE UNIQUE INDEX approvals_one_position_per_person ON approvals (request_id, cycle, actor_id, (coalesce(signature_source = 'company', false)))
      WHERE position IN ('diketahui', 'approval');
    DROP INDEX IF EXISTS approvals_settlement_one_position_per_person;
    CREATE UNIQUE INDEX approvals_settlement_one_position_per_person ON approvals (settlement_id, cycle, actor_id, (coalesce(signature_source = 'company', false)))
      WHERE settlement_id IS NOT NULL AND position IN ('diketahui', 'approval');
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM approvals
         WHERE position IN ('diketahui', 'approval') AND (request_id IS NOT NULL OR settlement_id IS NOT NULL)
         GROUP BY request_id, settlement_id, cycle, actor_id HAVING count(*) > 1
      ) THEN
        RAISE EXCEPTION 'down refused: a user holds a personal and a definitive-Direktur decision in one cycle (restore the dump instead)';
      END IF;
    END
    $pk$;

    DROP INDEX IF EXISTS approvals_one_position_per_person;
    CREATE UNIQUE INDEX approvals_one_position_per_person ON approvals (request_id, cycle, actor_id)
      WHERE position IN ('diketahui', 'approval');
    DROP INDEX IF EXISTS approvals_settlement_one_position_per_person;
    CREATE UNIQUE INDEX approvals_settlement_one_position_per_person ON approvals (settlement_id, cycle, actor_id)
      WHERE settlement_id IS NOT NULL AND position IN ('diketahui', 'approval');
  `)
}
