import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Owner decision 2026-10-09 (ADR 0021): new role `pk-operator` ("Operator/Anggota"), attendance-only
 * (web + APK) — see `access/roles.ts`. ADDITIVE / staging-safe: extends the Postgres enum backing
 * `company_memberships.roles[]` (the only live column typed with it — `users_roles`/`enum_users_roles`
 * was dropped in MC1, 20260927_230033_mc1_companies.ts). No existing row changes value.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_company_memberships_roles" ADD VALUE IF NOT EXISTS 'pk-operator';`)
}

export async function down({}: MigrateDownArgs): Promise<void> {
  // Postgres cannot drop an enum value (and a down-migration run after any company-memberships row
  // uses 'pk-operator' would break on the reload) — hand-written no-op, same pattern as
  // 20260926_022918_e1_approval_direktur_finance.ts. The extra value is harmless without the role.
}
