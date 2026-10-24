import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0032 (DRMS 24/10, user decision): new role `pk-admin-staff` ("Admin Staff", per PT — attendance of the whole PT:
 * read incl. selfies, corrections, check-in / check-out on behalf of any employee of the PT; no finance / request
 * access) and the attendance source `admin` ("Diabsenkan Admin Staff"). ENUM ONLY, ADDITIVE / staging-safe (pattern of
 * 20261010_080000_p2s_operator_role / 20261013_630000_d1310_owner_role): `company_memberships.roles[]`, the approval-rule
 * role selects whose options come from ROLES (`approval_rules_steps.approver_role`, `approval_rules.acknowledge_role`;
 * the rule hook still allows only decision roles there) and `attendances.source`. No row changes value. Its own
 * migration (= its own transaction): Postgres refuses to USE a new enum value in the transaction that added it, and
 * the guard migration that follows (20261024_210100) does.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_company_memberships_roles" ADD VALUE IF NOT EXISTS 'pk-admin-staff';
  ALTER TYPE "public"."enum_approval_rules_steps_approver_role" ADD VALUE IF NOT EXISTS 'pk-admin-staff';
  ALTER TYPE "public"."enum_approval_rules_acknowledge_role" ADD VALUE IF NOT EXISTS 'pk-admin-staff';
  ALTER TYPE "public"."enum_attendances_source" ADD VALUE IF NOT EXISTS 'admin';`)
}

export async function down({}: MigrateDownArgs): Promise<void> {
  // Postgres cannot drop an enum value (and a down-migration run after any row uses it would break on the reload) —
  // hand-written no-op like 20261010_080000_p2s_operator_role. The extra values are harmless without the role.
}
