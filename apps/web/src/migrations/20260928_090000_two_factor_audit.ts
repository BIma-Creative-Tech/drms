import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0017 — optional self-service 2FA (TOTP). ADDITIVE / staging-safe, run as <prefix>_owner:
 * audit_logs.action += '2fa_enabled', '2fa_disabled' (a user turned TOTP on/off for their own
 * account; the factor itself lives in Keycloak, nothing else changes in the ProyekKas schema).
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

   ALTER TYPE "public"."enum_audit_logs_action" ADD VALUE IF NOT EXISTS '2fa_enabled';
   ALTER TYPE "public"."enum_audit_logs_action" ADD VALUE IF NOT EXISTS '2fa_disabled';`)
}

/**
 * Rollback: refused once a 2FA audit row exists (audit_logs is
 * append-only, the enum value cannot be removed): restore the pre-migration dump instead.
 */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "audit_logs" ALTER COLUMN "action" SET DATA TYPE text;
  DROP TYPE "public"."enum_audit_logs_action";
  CREATE TYPE "public"."enum_audit_logs_action" AS ENUM('create', 'update', 'status_change', 'deactivate', 'reactivate', 'delete_attempt', 'void', 'view_sensitive', 'login', 'logout', 'login_failed', 'session_revoked', 'role_change', 'role_sync', 'device_register', 'device_revoke', 'number_issued', 'export', 'print', 'sign', 'acknowledge', 'flag_raised', 'flag_reviewed', 'sync_odoo', 'sync_offline', 'period_close', 'period_reopen', 'schema_maintenance', 'email_test', 'approve', 'reject', 'verify', 'acknowledge_delegated', 'access_denied', 'approval_skipped', 'retention_purge', 'import');
  ALTER TABLE "audit_logs" ALTER COLUMN "action" SET DATA TYPE "public"."enum_audit_logs_action" USING "action"::"public"."enum_audit_logs_action";`)
}
