import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0032 (DRMS 24/10): DB guard of the attendance source `admin` ("Diabsenkan Admin Staff", enum value added by
 * 20261024_210000). `attendances_source_fields` (migration e6_attendance) accepted `self` (own account, no recorder)
 * and `pm` (recorder + reason ≥ 3); `admin` gets the same rule as `pm` — the Admin Staff who recorded it and the
 * mandatory reason; the employee may have no account (tukang harian). Replaced in one statement pair, run as
 * <prefix>_owner. Existing rows are `self` / `pm` and satisfy the new check.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE attendances DROP CONSTRAINT IF EXISTS attendances_source_fields;
    ALTER TABLE attendances ADD CONSTRAINT attendances_source_fields CHECK (
      (source = 'self' AND user_id IS NOT NULL AND recorded_by_id IS NULL)
      OR (source IN ('pm', 'admin') AND recorded_by_id IS NOT NULL AND length(btrim(coalesce(on_behalf_reason, ''))) >= 3)
    );`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Refused while an `admin` row exists (the old check rejects it) — the error names the constraint.
  await db.execute(sql`
    ALTER TABLE attendances DROP CONSTRAINT IF EXISTS attendances_source_fields;
    ALTER TABLE attendances ADD CONSTRAINT attendances_source_fields CHECK (
      (source = 'self' AND user_id IS NOT NULL AND recorded_by_id IS NULL)
      OR (source = 'pm' AND recorded_by_id IS NOT NULL AND length(btrim(coalesce(on_behalf_reason, ''))) >= 3)
    );`)
}
