import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * ADR 0023 (sites = kantor cabang per PT) — DB guards, hand-written, run as <prefix>_owner after
 * 20261013_200000_d1010_sites.
 *
 * 1. `sites` is a per-PT master: company_id NOT NULL + immutable (with uuid), code unique per PT, no DELETE /
 *    TRUNCATE (deactivate instead; trigger + REVOKE for the app role), default work schedule and default cost
 *    center of the same PT, the default cost center operational.
 * 2. Same-PT triggers (`pk_same_company`) for every new site reference: employees.home_site_id, projects.site_id,
 *    cash_accounts.site_id, team_assignments.site_id, attendances.site_id.
 * 3. `team_assignments`: exactly one of project / cost center / site (`team_assignments_location_one`; validated
 *    when no legacy row breaks it, else enforced for new rows only — NOT VALID).
 * 4. `attendances`: the location is a project, a cost center, or (both empty) a site. `site_id` is filled by the DB
 *    on insert (`pk_attendance_site`, fires before the same-PT check): the project's site for a project check-in,
 *    NULL for a cost-center check-in, the site itself for a site check-in (required then). One check-in /
 *    check-out per employee, site and local date (`attendances_one_per_day_site`).
 * Rows of existing PTs are untouched (all new columns nullable; no data move — ADR 0023 §7.3).
 */
const SITE_REFS: Array<[table: string, column: string]> = [
  ['employees', 'home_site_id'],
  ['projects', 'site_id'],
  ['cash_accounts', 'site_id'],
  ['team_assignments', 'site_id'],
  ['attendances', 'site_id'],
]

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;

    ALTER TABLE sites ALTER COLUMN company_id SET NOT NULL;
    CREATE UNIQUE INDEX sites_company_code_uq ON sites (company_id, code);
    ALTER TABLE sites
      ADD CONSTRAINT sites_radius CHECK (radius_m IS NULL OR (radius_m >= 10 AND radius_m <= 5000)),
      ADD CONSTRAINT sites_point CHECK ((lat IS NULL OR (lat >= -90 AND lat <= 90)) AND (lng IS NULL OR (lng >= -180 AND lng <= 180)));
    CREATE TRIGGER sites_company_protect BEFORE UPDATE ON sites FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('company_id', 'uuid');
    CREATE TRIGGER sites_no_delete BEFORE DELETE ON sites FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER sites_no_truncate BEFORE TRUNCATE ON sites FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER sites_company_refs BEFORE INSERT OR UPDATE ON sites FOR EACH ROW EXECUTE FUNCTION pk_same_company('default_work_schedule_id', 'work_schedules', 'cost_center_id', 'cost_centers');

    CREATE OR REPLACE FUNCTION pk_site_cost_center_operational() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.cost_center_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id)
         AND NOT EXISTS (SELECT 1 FROM cost_centers cc WHERE cc.id = NEW.cost_center_id AND cc.type = 'operational') THEN
        RAISE EXCEPTION 'sites: default cost center % is not an operational cost center (ADR 0023)', NEW.cost_center_id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER sites_cost_center_operational BEFORE INSERT OR UPDATE ON sites FOR EACH ROW EXECUTE FUNCTION pk_site_cost_center_operational();

    -- 3. team assignments: exactly one location (validated when the existing rows allow it)
    ALTER TABLE team_assignments ADD CONSTRAINT team_assignments_location_one CHECK (num_nonnulls(project_id, cost_center_id, site_id) = 1) NOT VALID;
    DO $pk$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM team_assignments WHERE num_nonnulls(project_id, cost_center_id, site_id) <> 1) THEN
        ALTER TABLE team_assignments VALIDATE CONSTRAINT team_assignments_location_one;
      END IF;
    END
    $pk$;

    -- 4. attendances: project | cost center | site; site_id server-filled
    ALTER TABLE attendances DROP CONSTRAINT attendances_one_location;
    ALTER TABLE attendances ADD CONSTRAINT attendances_one_location CHECK (
      (project_id IS NOT NULL AND cost_center_id IS NULL)
      OR (cost_center_id IS NOT NULL AND project_id IS NULL AND site_id IS NULL)
      OR (site_id IS NOT NULL AND project_id IS NULL AND cost_center_id IS NULL)
    );
    CREATE UNIQUE INDEX attendances_one_per_day_site ON attendances (employee_id, site_id, local_date, kind) WHERE project_id IS NULL AND cost_center_id IS NULL;

    CREATE OR REPLACE FUNCTION pk_attendance_site() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.project_id IS NOT NULL THEN
        NEW.site_id := (SELECT p.site_id FROM projects p WHERE p.id = NEW.project_id);
      ELSIF NEW.cost_center_id IS NOT NULL THEN
        NEW.site_id := NULL;
      END IF;
      RETURN NEW;
    END
    $fn$;
    -- named to fire before attendances_site_same_company (same-PT check of the derived value)
    CREATE TRIGGER attendances_site_derive BEFORE INSERT ON attendances FOR EACH ROW EXECUTE FUNCTION pk_attendance_site();

    DO $pk$
    DECLARE
      app_role text := regexp_replace(current_user, '_owner$', '_app');
    BEGIN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON sites FROM %I', app_role);
    END
    $pk$;`)
  for (const [t, c] of SITE_REFS) {
    await db.execute(sql.raw(`CREATE TRIGGER ${t}_site_same_company BEFORE INSERT OR UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION pk_same_company('${c}', 'sites');`))
  }
}

/** Rollback (pre-production only, ADR 0023 §7.4). Refused while site check-ins exist: they would lose their location. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF EXISTS (SELECT 1 FROM attendances WHERE project_id IS NULL AND cost_center_id IS NULL) THEN
        RAISE EXCEPTION 'site check-ins exist: restore the pre-migration dump instead of migrating down (ADR 0023 §7.4)';
      END IF;
    END
    $pk$;`)
  for (const [t] of SITE_REFS) await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${t}_site_same_company ON ${t};`))
  await db.execute(sql`
    DROP TRIGGER IF EXISTS attendances_site_derive ON attendances;
    DROP FUNCTION IF EXISTS pk_attendance_site();
    DROP INDEX IF EXISTS attendances_one_per_day_site;
    ALTER TABLE attendances DROP CONSTRAINT attendances_one_location;
    ALTER TABLE attendances ADD CONSTRAINT attendances_one_location CHECK ((project_id IS NULL) <> (cost_center_id IS NULL));
    ALTER TABLE team_assignments DROP CONSTRAINT IF EXISTS team_assignments_location_one;
    DROP TRIGGER IF EXISTS sites_cost_center_operational ON sites;
    DROP FUNCTION IF EXISTS pk_site_cost_center_operational();
    DROP TRIGGER IF EXISTS sites_company_refs ON sites;
    DROP TRIGGER IF EXISTS sites_no_truncate ON sites;
    DROP TRIGGER IF EXISTS sites_no_delete ON sites;
    DROP TRIGGER IF EXISTS sites_company_protect ON sites;
    DROP INDEX IF EXISTS sites_company_code_uq;`)
}
