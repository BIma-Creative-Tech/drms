import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * F4b attendance guards (ADR 0006 style), run as <prefix>_owner:
 * - `attendances` is append-only: no UPDATE/DELETE/TRUNCATE for the app role, reject triggers for
 *   everyone (corrections are a separate T10 record in F5, never an edit).
 * - `received_at` is the DB clock (ADR 0010 decision 7: the server stamps the authoritative time).
 * - One check-in and one check-out per employee / project / local date (last line of defence behind
 *   the sync service's own check).
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

    CREATE OR REPLACE FUNCTION pk_attendance_received_at() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      NEW.received_at := clock_timestamp();
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER attendances_received_at BEFORE INSERT ON attendances FOR EACH ROW EXECUTE FUNCTION pk_attendance_received_at();
    CREATE TRIGGER attendances_no_update BEFORE UPDATE OR DELETE ON attendances FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER attendances_no_truncate BEFORE TRUNCATE ON attendances FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();
    CREATE UNIQUE INDEX attendances_one_per_day ON attendances (employee_id, project_id, local_date, kind);

    DO $pk$
    DECLARE
      app_role text := regexp_replace(current_user, '_owner$', '_app');
    BEGIN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON attendances FROM %I', app_role);
    END
    $pk$;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS attendances_one_per_day;
    DROP TRIGGER IF EXISTS attendances_no_truncate ON attendances;
    DROP TRIGGER IF EXISTS attendances_no_update ON attendances;
    DROP TRIGGER IF EXISTS attendances_received_at ON attendances;
    DROP FUNCTION IF EXISTS pk_attendance_received_at();
  `)
}
