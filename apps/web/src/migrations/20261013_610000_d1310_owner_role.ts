import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0025 (owner decision 2026-10-13): new role `pk-principal` ("Owner", the approval level above the Direktur —
 * see `access/roles.ts`). ENUM ONLY, ADDITIVE / staging-safe (same pattern as 20261010_080000_p2s_operator_role):
 * extends the Postgres enums whose Payload select options come from ROLES / REQUESTER_ROLE_OPTIONS —
 * `company_memberships.roles[]`, the approval-rule role selects (`approval_rules_steps.approver_role`,
 * `approval_rules.acknowledge_role`) and "Peran pemohon" (`approval_rules_requester_roles`). No row changes value.
 * Its own migration (= its own transaction): Postgres refuses to USE a new enum value in the transaction that added
 * it, and the guard / data migrations that follow (20261013_6101xx / 6102xx) do.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_company_memberships_roles" ADD VALUE IF NOT EXISTS 'pk-principal' AFTER 'pk-owner';
  ALTER TYPE "public"."enum_approval_rules_steps_approver_role" ADD VALUE IF NOT EXISTS 'pk-principal' AFTER 'pk-owner';
  ALTER TYPE "public"."enum_approval_rules_acknowledge_role" ADD VALUE IF NOT EXISTS 'pk-principal' AFTER 'pk-owner';
  ALTER TYPE "public"."enum_approval_rules_requester_roles" ADD VALUE IF NOT EXISTS 'pk-principal' AFTER 'pk-owner';`)
}

export async function down({}: MigrateDownArgs): Promise<void> {
  // Postgres cannot drop an enum value (and a down-migration run after any row uses 'pk-principal' would break on
  // the reload) — hand-written no-op like 20261010_080000_p2s_operator_role. The extra value is harmless without the role.
}
