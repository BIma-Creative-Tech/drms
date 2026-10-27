import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * D2410 (user 2026-10-24, ADR 0020 amendment 2026-10-24) "HM mingguan": operators read the hour meter about once a
 * week, so HM awal / HM akhir (and the HM photo) of a daily unit timesheet become OPTIONAL. Run as <prefix>_owner
 * (snapshot of the Payload schema in the .json: unit_timesheets.hm_start / hm_end without NOT NULL).
 * - `hm_start` / `hm_end` DROP NOT NULL. The existing CHECK `unit_timesheets_hm` (hm_start ≥ 0 AND hm_end ≥ hm_start)
 *   stays: it is NULL — i.e. passes — for a row without HM.
 * - New CHECK `unit_timesheets_hm_pair`: both values or none (the service rule `timesheetErrors`; a half reading would
 *   break HM_GAP, the unit's last HM and the weekly recap).
 * The photo needs no DB change (photo_count ≤ 1 already; the "photo only with HM" rule is the service's).
 * ADDITIVE for the previous image: every existing row has both values; the 0.19 image always writes both (its form /
 * API still require them) and reads non-null values only.
 * Down: refused while a timesheet without HM exists (not representable before) — restore the pre-deploy dump instead.
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
  ALTER TABLE "unit_timesheets" ALTER COLUMN "hm_start" DROP NOT NULL;
  ALTER TABLE "unit_timesheets" ALTER COLUMN "hm_end" DROP NOT NULL;
  ALTER TABLE "unit_timesheets" ADD CONSTRAINT unit_timesheets_hm_pair CHECK ((hm_start IS NULL) = (hm_end IS NULL));`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DO $pk$
  BEGIN
    IF EXISTS (SELECT 1 FROM unit_timesheets WHERE hm_start IS NULL OR hm_end IS NULL) THEN
      RAISE EXCEPTION 'd2410 down: unit timesheets without HM exist (not representable before 20261024_100000) — restore the pre-deploy dump instead';
    END IF;
  END
  $pk$;
  ALTER TABLE "unit_timesheets" DROP CONSTRAINT IF EXISTS unit_timesheets_hm_pair;
  ALTER TABLE "unit_timesheets" ALTER COLUMN "hm_start" SET NOT NULL;
  ALTER TABLE "unit_timesheets" ALTER COLUMN "hm_end" SET NOT NULL;`)
}
