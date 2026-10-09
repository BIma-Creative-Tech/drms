import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Owner decision 2026-10-09 (ADR 0021): new role `pk-operator` ("Operator/Anggota"), attendance-only
 * (web + APK) — see `access/roles.ts`. ADDITIVE / staging-safe: extends the Postgres enums whose
 * Payload select options come from ROLES — `company_memberships.roles[]` and the approval-rule role
 * selects (`approval_rules_steps.approver_role`, `approval_rules.acknowledge_role`; `enum_users_roles`
 * is unused since MC1). No existing row changes value.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_company_memberships_roles" ADD VALUE IF NOT EXISTS 'pk-operator';
  ALTER TYPE "public"."enum_approval_rules_steps_approver_role" ADD VALUE IF NOT EXISTS 'pk-operator';
  ALTER TYPE "public"."enum_approval_rules_acknowledge_role" ADD VALUE IF NOT EXISTS 'pk-operator';`)
}

export async function down({}: MigrateDownArgs): Promise<void> {
  // Postgres cannot drop an enum value (and a down-migration run after any company-memberships row
  // uses 'pk-operator' would break on the reload) — hand-written no-op, same pattern as
  // 20260926_022918_e1_approval_direktur_finance.ts. The extra value is harmless without the role.
}
