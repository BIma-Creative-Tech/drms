import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * FR1 security (ADR 0020 §6, ADR 0006 style — defence in depth behind domain/field/*), hand-written,
 * run as <prefix>_owner:
 *
 * 1. Field reports (`service_reports`, `unit_timesheets`, `aftersales_activities`):
 *    - `received_at` = DB clock, `editable_until` = received_at + 24 h (insert trigger, any app value
 *      is replaced);
 *    - no DELETE / TRUNCATE (trigger + REVOKE for the app role);
 *    - no UPDATE after `editable_until`, EXCEPT inside a transaction that set the transaction-local
 *      `pk.field_override`: 'correction' (PM/Direktur correction with reason, domain/field/common.ts)
 *      or 'system' (status side effects, e.g. a delivery closing an incoming PO: only po_status,
 *      flags, sync_rev, updated_at may change);
 *    - identity columns immutable (pk_protect_columns), company immutable, reporter must be an
 *      active member of the PT, every per-PT reference in the row's PT (pk_same_company);
 *    - project kind checked on insert (service: kontrak_unit | aftersales; timesheet: kontrak_unit;
 *      activity: aftersales); a timesheet's contract unit must be ACTIVE for that project/unit and
 *      cover the date; an activity's `relates_to` must be an incoming PO (po_masuk) of the SAME
 *      customer; `po_status` exists only on po_masuk; ranges/formats as CHECKs (hours Σ ≤ 24, HM end ≥
 *      start, photo counts 10 / 1 / 5).
 * 2. `contract_units`: one unit is never ACTIVE in two contracts on overlapping dates (trigger under
 *    a per-unit advisory lock — no btree_gist extension needed on the platform DB); project kind
 *    kontrak_unit, own unit only; project/unit/company immutable; no DELETE.
 * 3. `projects.kind` cannot change once the project has contract units or field reports.
 * 4. `vehicles.client_id` must be a client of the vehicle's PT (cross-company trigger re-created).
 * 5. Media: `pk_media_owner_company()` also derives the PT of field-report photos; at most 10 / 1 / 5
 *    photos per service report / timesheet / activity.
 * 6. `reminder_deliveries.rule` accepts `aftersales_followup` (follow-up of quotations).
 */
const REPORTS = ['service_reports', 'unit_timesheets', 'aftersales_activities'] as const

/** Per-PT tables added by FR1 (company_id NOT NULL + immutable) — tests pin them next to MC1's PER_PT_TABLES. */
export const FR1_PER_PT_TABLES = ['contract_units', ...REPORTS] as const

const REFS: Record<string, Array<[string, string]>> = {
  contract_units: [['project_id', 'projects'], ['unit_id', 'vehicles']],
  service_reports: [['project_id', 'projects'], ['unit_id', 'vehicles']],
  unit_timesheets: [['project_id', 'projects'], ['unit_id', 'vehicles'], ['contract_unit_id', 'contract_units']],
  aftersales_activities: [['project_id', 'projects'], ['client_id', 'clients'], ['relates_to_id', 'aftersales_activities']],
}

const COMMON_PROTECT = ['received_at', 'editable_until', 'device_time', 'time_trust', 'offline', 'source', 'client_uuid', 'uuid']
const PROTECT: Record<string, string[]> = {
  service_reports: ['doc_no', 'project_id', 'unit_id', 'reporter_id', 'report_date', ...COMMON_PROTECT],
  unit_timesheets: ['project_id', 'unit_id', 'contract_unit_id', 'reporter_id', 'report_date', ...COMMON_PROTECT],
  aftersales_activities: ['project_id', 'client_id', 'kind', 'reporter_id', 'activity_date', 'relates_to_id', ...COMMON_PROTECT],
  contract_units: ['project_id', 'unit_id', 'uuid'],
}

const pairs = (list: Array<[string, string]>) => list.flatMap(([c, t]) => [`'${c}'`, `'${t}'`]).join(', ')
const DATE_RE = `'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)

  // ---- 1. field reports: clock, window, override
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION pk_field_report_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      k text;
    BEGIN
      SELECT p.kind::text INTO k FROM projects p WHERE p.id = NEW.project_id;
      IF TG_TABLE_NAME = 'service_reports' AND coalesce(k, '') NOT IN ('kontrak_unit', 'aftersales') THEN
        RAISE EXCEPTION 'service_reports: project % is of kind % (kontrak_unit/aftersales only)', NEW.project_id, k USING ERRCODE = '23514';
      ELSIF TG_TABLE_NAME = 'unit_timesheets' AND coalesce(k, '') <> 'kontrak_unit' THEN
        RAISE EXCEPTION 'unit_timesheets: project % is of kind % (kontrak_unit only)', NEW.project_id, k USING ERRCODE = '23514';
      ELSIF TG_TABLE_NAME = 'aftersales_activities' AND coalesce(k, '') <> 'aftersales' THEN
        RAISE EXCEPTION 'aftersales_activities: project % is of kind % (aftersales only)', NEW.project_id, k USING ERRCODE = '23514';
      END IF;
      NEW.received_at := clock_timestamp();
      NEW.editable_until := NEW.received_at + interval '24 hours';
      RETURN NEW;
    END
    $fn$;

    CREATE OR REPLACE FUNCTION pk_field_report_window() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      mode text := coalesce(current_setting('pk.field_override', true), '');
      free text[] := ARRAY['po_status', 'flags', 'sync_rev', 'updated_at'];
    BEGIN
      IF OLD.editable_until IS NULL OR clock_timestamp() <= OLD.editable_until THEN
        RETURN NEW;
      END IF;
      IF mode = 'correction' THEN
        RETURN NEW;
      END IF;
      IF mode = 'system' AND (to_jsonb(NEW) - free) = (to_jsonb(OLD) - free) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION '%: edit window (24 h) closed — corrections only by PM/Direktur with a reason', TG_TABLE_NAME USING ERRCODE = '42501';
    END
    $fn$;

    CREATE OR REPLACE FUNCTION pk_unit_timesheet_contract() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM contract_units cu
         WHERE cu.id = NEW.contract_unit_id AND cu.project_id = NEW.project_id AND cu.unit_id = NEW.unit_id
           AND coalesce(cu.active, true) AND cu.start_date <= NEW.report_date
           AND (cu.end_date IS NULL OR cu.end_date >= NEW.report_date)) THEN
        RAISE EXCEPTION 'unit_timesheets: unit % is not in an active contract unit of project % on %', NEW.unit_id, NEW.project_id, NEW.report_date
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;

    CREATE OR REPLACE FUNCTION pk_aftersales_relates_to() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.relates_to_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM aftersales_activities po
         WHERE po.id = NEW.relates_to_id AND po.kind = 'po_masuk' AND po.client_id = NEW.client_id AND po.company_id = NEW.company_id) THEN
        RAISE EXCEPTION 'aftersales_activities: relates_to % is not an incoming PO of client %', NEW.relates_to_id, NEW.client_id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;
  `)

  for (const t of REPORTS) {
    await db.execute(
      sql.raw(`
      CREATE TRIGGER ${t}_insert BEFORE INSERT ON ${t} FOR EACH ROW EXECUTE FUNCTION pk_field_report_insert();
      CREATE TRIGGER ${t}_window BEFORE UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION pk_field_report_window();
      CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
      CREATE TRIGGER ${t}_no_truncate BEFORE TRUNCATE ON ${t} FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();
      CREATE TRIGGER ${t}_company_members BEFORE INSERT OR UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION pk_company_member('reporter_id');`),
    )
  }

  await db.execute(
    sql.raw(`
    CREATE TRIGGER unit_timesheets_contract BEFORE INSERT ON unit_timesheets FOR EACH ROW EXECUTE FUNCTION pk_unit_timesheet_contract();
    CREATE TRIGGER aftersales_activities_relates_to BEFORE INSERT OR UPDATE ON aftersales_activities FOR EACH ROW EXECUTE FUNCTION pk_aftersales_relates_to();

    ALTER TABLE service_reports
      ADD CONSTRAINT service_reports_report_date CHECK (report_date ~ ${DATE_RE}),
      ADD CONSTRAINT service_reports_hour_meter CHECK (hour_meter IS NULL OR hour_meter >= 0),
      ADD CONSTRAINT service_reports_times CHECK ((start_time IS NULL OR start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND (end_time IS NULL OR end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')),
      ADD CONSTRAINT service_reports_photo_count CHECK (photo_count IS NULL OR (photo_count >= 0 AND photo_count <= 10)),
      ADD CONSTRAINT service_reports_spareparts CHECK (spareparts IS NULL OR jsonb_typeof(spareparts) = 'array');

    ALTER TABLE unit_timesheets
      ADD CONSTRAINT unit_timesheets_report_date CHECK (report_date ~ ${DATE_RE}),
      ADD CONSTRAINT unit_timesheets_hm CHECK (hm_start >= 0 AND hm_end >= hm_start),
      ADD CONSTRAINT unit_timesheets_hours CHECK (
        work_hours >= 0 AND coalesce(standby_hours, 0) >= 0 AND coalesce(breakdown_hours, 0) >= 0
        AND work_hours + coalesce(standby_hours, 0) + coalesce(breakdown_hours, 0) <= 24),
      ADD CONSTRAINT unit_timesheets_breakdown_reason CHECK (coalesce(breakdown_hours, 0) = 0 OR length(btrim(coalesce(breakdown_reason, ''))) > 0),
      ADD CONSTRAINT unit_timesheets_fuel CHECK (fuel_liters IS NULL OR fuel_liters >= 0),
      ADD CONSTRAINT unit_timesheets_photo_count CHECK (photo_count IS NULL OR (photo_count >= 0 AND photo_count <= 1));

    ALTER TABLE aftersales_activities
      ADD CONSTRAINT aftersales_activities_activity_date CHECK (activity_date ~ ${DATE_RE}),
      ADD CONSTRAINT aftersales_activities_follow_up_date CHECK (follow_up_date IS NULL OR follow_up_date ~ ${DATE_RE}),
      ADD CONSTRAINT aftersales_activities_value CHECK (value IS NULL OR (value >= 0 AND value = trunc(value))),
      ADD CONSTRAINT aftersales_activities_po_status CHECK ((kind = 'po_masuk') = (po_status IS NOT NULL)),
      ADD CONSTRAINT aftersales_activities_relates_kind CHECK (relates_to_id IS NULL OR kind IN ('pengiriman', 'penagihan')),
      ADD CONSTRAINT aftersales_activities_items CHECK (items IS NULL OR jsonb_typeof(items) = 'array'),
      ADD CONSTRAINT aftersales_activities_photo_count CHECK (photo_count IS NULL OR (photo_count >= 0 AND photo_count <= 5));`),
  )

  for (const [t, cols] of Object.entries(PROTECT)) {
    await db.execute(sql.raw(`CREATE TRIGGER ${t}_protect BEFORE UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION pk_protect_columns(${cols.map((c) => `'${c}'`).join(', ')});`))
  }
  for (const t of FR1_PER_PT_TABLES) {
    await db.execute(sql.raw(`CREATE TRIGGER ${t}_company_protect BEFORE UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('company_id');`))
  }
  for (const [t, list] of Object.entries(REFS)) {
    await db.execute(sql.raw(`CREATE TRIGGER ${t}_company_refs BEFORE INSERT OR UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION pk_same_company(${pairs(list)});`))
  }

  // ---- 2. contract units: overlap, kind, own unit
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION pk_contract_unit_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      other integer;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.kind = 'kontrak_unit') THEN
          RAISE EXCEPTION 'contract_units: project % is not of kind kontrak_unit', NEW.project_id USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = NEW.unit_id AND v.owner = 'sendiri') THEN
          RAISE EXCEPTION 'contract_units: unit % is not an own unit', NEW.unit_id USING ERRCODE = '23514';
        END IF;
      END IF;
      IF coalesce(NEW.active, true) THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('pk-contract-unit:' || NEW.unit_id, 0));
        SELECT cu.id INTO other FROM contract_units cu
         WHERE cu.unit_id = NEW.unit_id AND cu.id <> NEW.id AND coalesce(cu.active, true)
           AND cu.start_date <= coalesce(NEW.end_date, '9999-12-31')
           AND coalesce(cu.end_date, '9999-12-31') >= NEW.start_date
         LIMIT 1;
        IF other IS NOT NULL THEN
          RAISE EXCEPTION 'contract_units: unit % is already active in contract unit % on overlapping dates', NEW.unit_id, other USING ERRCODE = '23514';
        END IF;
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER contract_units_guard BEFORE INSERT OR UPDATE ON contract_units FOR EACH ROW EXECUTE FUNCTION pk_contract_unit_guard();
    CREATE TRIGGER contract_units_no_delete BEFORE DELETE ON contract_units FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();

    -- 3. the project kind is frozen once the project has field data
    CREATE OR REPLACE FUNCTION pk_project_kind_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.kind IS DISTINCT FROM OLD.kind AND (
           EXISTS (SELECT 1 FROM contract_units x WHERE x.project_id = OLD.id)
        OR EXISTS (SELECT 1 FROM service_reports x WHERE x.project_id = OLD.id)
        OR EXISTS (SELECT 1 FROM unit_timesheets x WHERE x.project_id = OLD.id)
        OR EXISTS (SELECT 1 FROM aftersales_activities x WHERE x.project_id = OLD.id)) THEN
        RAISE EXCEPTION 'projects: kind of project % cannot change (contract units / field reports exist)', OLD.id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER projects_kind_guard BEFORE UPDATE OF kind ON projects FOR EACH ROW EXECUTE FUNCTION pk_project_kind_guard();

    -- 4. vehicles: the customer of a customer-owned unit is a client of the same PT
    DROP TRIGGER IF EXISTS vehicles_company_refs ON vehicles;
    CREATE TRIGGER vehicles_company_refs BEFORE INSERT OR UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION pk_same_company('project_id', 'projects', 'cost_center_id', 'cost_centers', 'client_id', 'clients');
  `)

  // ---- 5. media: PT of field-report photos + photo limits
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION pk_media_owner_company() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF TG_TABLE_NAME = 'media_selfies' THEN
        NEW.owner_company_id := (SELECT a.company_id FROM attendances a WHERE a.selfie_id = NEW.id ORDER BY a.id LIMIT 1);
      ELSIF NEW.owner_doc_id IS NULL OR NEW.owner_doc_id !~ '^[0-9]{1,10}$' THEN
        NEW.owner_company_id := NULL;
      ELSIF NEW.owner_doc_type = 'expense_request' THEN
        NEW.owner_company_id := (SELECT e.company_id FROM expense_requests e WHERE e.id = NEW.owner_doc_id::bigint);
      ELSIF NEW.owner_doc_type = 'progress_report' THEN
        NEW.owner_company_id := (SELECT r.company_id FROM progress_reports r WHERE r.id = NEW.owner_doc_id::bigint);
      ELSIF NEW.owner_doc_type = 'cash_entry' THEN
        NEW.owner_company_id := (SELECT c.company_id FROM cash_entries c WHERE c.id = NEW.owner_doc_id::bigint);
      ELSIF NEW.owner_doc_type = 'service_report' THEN
        NEW.owner_company_id := (SELECT r.company_id FROM service_reports r WHERE r.id = NEW.owner_doc_id::bigint);
      ELSIF NEW.owner_doc_type = 'unit_timesheet' THEN
        NEW.owner_company_id := (SELECT r.company_id FROM unit_timesheets r WHERE r.id = NEW.owner_doc_id::bigint);
      ELSIF NEW.owner_doc_type = 'aftersales_activity' THEN
        NEW.owner_company_id := (SELECT r.company_id FROM aftersales_activities r WHERE r.id = NEW.owner_doc_id::bigint);
      ELSE
        NEW.owner_company_id := NULL;
      END IF;
      RETURN NEW;
    END
    $fn$;

    CREATE OR REPLACE FUNCTION pk_field_photo_limit() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      lim integer := CASE NEW.owner_doc_type WHEN 'service_report' THEN 10 WHEN 'unit_timesheet' THEN 1 WHEN 'aftersales_activity' THEN 5 ELSE NULL END;
    BEGIN
      IF lim IS NOT NULL AND NEW.owner_doc_id IS NOT NULL AND NEW.owner_doc_id IS DISTINCT FROM OLD.owner_doc_id THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('pk-field-photos:' || NEW.owner_doc_type || ':' || NEW.owner_doc_id, 0));
        IF (SELECT count(*) FROM media_progress_photos m
             WHERE m.owner_doc_type = NEW.owner_doc_type AND m.owner_doc_id = NEW.owner_doc_id AND m.id <> NEW.id) >= lim THEN
          RAISE EXCEPTION '% % already has % photo(s)', NEW.owner_doc_type, NEW.owner_doc_id, lim USING ERRCODE = '23514';
        END IF;
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER media_progress_photos_field_limit BEFORE UPDATE ON media_progress_photos FOR EACH ROW EXECUTE FUNCTION pk_field_photo_limit();

    -- 6. reminder rule of the aftersales follow-ups
    ALTER TABLE reminder_deliveries DROP CONSTRAINT IF EXISTS reminder_deliveries_rule_check;
    ALTER TABLE reminder_deliveries ADD CONSTRAINT reminder_deliveries_rule_check
      CHECK (rule IN ('late_progress', 'lpj_overdue', 'revision_pending', 'budget_threshold', 'aftersales_followup'));

    DO $pk$
    DECLARE
      app_role text := regexp_replace(current_user, '_owner$', '_app');
    BEGIN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON service_reports, unit_timesheets, aftersales_activities, contract_units FROM %I', app_role);
    END
    $pk$;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS media_progress_photos_field_limit ON media_progress_photos;
    DROP FUNCTION IF EXISTS pk_field_photo_limit();
    CREATE OR REPLACE FUNCTION pk_media_owner_company() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF TG_TABLE_NAME = 'media_selfies' THEN
        NEW.owner_company_id := (SELECT a.company_id FROM attendances a WHERE a.selfie_id = NEW.id ORDER BY a.id LIMIT 1);
      ELSIF NEW.owner_doc_id IS NULL OR NEW.owner_doc_id !~ '^[0-9]{1,10}$' THEN
        NEW.owner_company_id := NULL;
      ELSIF NEW.owner_doc_type = 'expense_request' THEN
        NEW.owner_company_id := (SELECT e.company_id FROM expense_requests e WHERE e.id = NEW.owner_doc_id::bigint);
      ELSIF NEW.owner_doc_type = 'progress_report' THEN
        NEW.owner_company_id := (SELECT r.company_id FROM progress_reports r WHERE r.id = NEW.owner_doc_id::bigint);
      ELSIF NEW.owner_doc_type = 'cash_entry' THEN
        NEW.owner_company_id := (SELECT c.company_id FROM cash_entries c WHERE c.id = NEW.owner_doc_id::bigint);
      ELSE
        NEW.owner_company_id := NULL;
      END IF;
      RETURN NEW;
    END
    $fn$;
    ALTER TABLE reminder_deliveries DROP CONSTRAINT IF EXISTS reminder_deliveries_rule_check;
    ALTER TABLE reminder_deliveries ADD CONSTRAINT reminder_deliveries_rule_check
      CHECK (rule IN ('late_progress', 'lpj_overdue', 'revision_pending', 'budget_threshold'));
    DROP TRIGGER IF EXISTS vehicles_company_refs ON vehicles;
    CREATE TRIGGER vehicles_company_refs BEFORE INSERT OR UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION pk_same_company('project_id', 'projects', 'cost_center_id', 'cost_centers');
    DROP TRIGGER IF EXISTS projects_kind_guard ON projects;
    DROP FUNCTION IF EXISTS pk_project_kind_guard();
    DROP TRIGGER IF EXISTS contract_units_guard ON contract_units;
    DROP TRIGGER IF EXISTS contract_units_no_delete ON contract_units;
    DROP FUNCTION IF EXISTS pk_contract_unit_guard();
    DROP TRIGGER IF EXISTS unit_timesheets_contract ON unit_timesheets;
    DROP TRIGGER IF EXISTS aftersales_activities_relates_to ON aftersales_activities;
  `)
  for (const t of REPORTS) {
    await db.execute(
      sql.raw(`
      DROP TRIGGER IF EXISTS ${t}_insert ON ${t};
      DROP TRIGGER IF EXISTS ${t}_window ON ${t};
      DROP TRIGGER IF EXISTS ${t}_no_delete ON ${t};
      DROP TRIGGER IF EXISTS ${t}_no_truncate ON ${t};
      DROP TRIGGER IF EXISTS ${t}_company_members ON ${t};`),
    )
  }
  for (const t of Object.keys(PROTECT)) await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${t}_protect ON ${t};`))
  for (const t of FR1_PER_PT_TABLES) await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${t}_company_protect ON ${t};`))
  for (const t of Object.keys(REFS)) await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${t}_company_refs ON ${t};`))
  await db.execute(sql`
    DROP FUNCTION IF EXISTS pk_field_report_insert();
    DROP FUNCTION IF EXISTS pk_field_report_window();
    DROP FUNCTION IF EXISTS pk_unit_timesheet_contract();
    DROP FUNCTION IF EXISTS pk_aftersales_relates_to();
  `)
}
