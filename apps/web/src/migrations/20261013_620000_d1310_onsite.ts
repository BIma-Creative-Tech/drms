import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 13/10 A2 (ADR 0023 amendment 2026-10-13) schema, run as <prefix>_owner (Payload-style; snapshot
 * 20261013_620000_d1310_onsite.json):
 * - `employees.attendance_type` ("Tipe absensi": `onsite` | `non_onsite`), NOT NULL DEFAULT 'onsite'. The default
 *   backfills every existing employee as OnSite: OnSite allows every location the assignment rule allowed before
 *   (assigned project / cost center / site, home site — all registered locations of the own PT), so no check-in that
 *   worked before is refused. The Admin switches office staff to Non-OnSite.
 * - `sites.is_head_office` ("Kantor pusat"), DEFAULT false: no site is a head office until the Admin flags one.
 * - `attendances.outside_area` ("Di luar area", owner 2026-10-14), DEFAULT false: a Non-OnSite attendance outside
 *   every registered location; its location columns then hold the reference (home site / head office / the open
 *   check-in's location) and `distance_m` the distance to it. Existing rows: false (all were inside a geofence).
 * Guard (one head office per PT): 20261013_620100_d1310_onsite_guard.
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
   CREATE TYPE "public"."enum_employees_attendance_type" AS ENUM('onsite', 'non_onsite');
  ALTER TABLE "employees" ADD COLUMN "attendance_type" "enum_employees_attendance_type" DEFAULT 'onsite' NOT NULL;
  ALTER TABLE "sites" ADD COLUMN "is_head_office" boolean DEFAULT false;
  ALTER TABLE "attendances" ADD COLUMN "outside_area" boolean DEFAULT false;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "employees" DROP COLUMN "attendance_type";
  ALTER TABLE "sites" DROP COLUMN "is_head_office";
  ALTER TABLE "attendances" DROP COLUMN "outside_area";
  DROP TYPE "public"."enum_employees_attendance_type";`)
}
