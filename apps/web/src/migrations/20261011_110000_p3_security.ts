import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * P3 konstruksi — DB guards + per-PT data (hand-written, run as <prefix>_owner):
 * 1. daily_reports: same field-report guards as FR1 (DB clock received_at / editable_until, kind
 *    `konstruksi` only, 24 h window with `pk.field_override`, no DELETE/TRUNCATE, identity + PT immutable,
 *    reporter is a member of the PT, same-PT project).
 * 2. daily_report_lines = APPEND-ONLY ledger: no UPDATE/DELETE/TRUNCATE; on insert the line is checked
 *    against its report and RAP item (same project, `work` ↔ pekerjaan, `material_*` ↔ material, qty ≠ 0,
 *    report_date copied from the report) and an AFTER INSERT trigger moves rap_items.realised_qty /
 *    received_qty / used_qty. Those three columns change ONLY through that trigger (`pk.rap_ledger`).
 * 3. rap_items: per-PT, stage of the same project, never deleted (deactivate), identity immutable,
 *    volume > 0, price ≥ 0 whole rupiah. resource_types / rap_templates: PT immutable, no delete
 *    (template rows: Payload rewrites the child table → DELETE stays on rap_templates_items).
 * 4. projects.kind frozen also once daily reports / RAP items exist.
 * 5. Media: PT of daily-report photos, ≤ 10 photos.
 * 6. Data: sequence LH/YYMM/#### and the default manpower/equipment types for every existing PT.
 */
const RESOURCE_DEFAULTS: ReadonlyArray<[kind: string, code: string, name: string]> = [
  ['tenaga', 'MANDOR', 'Mandor'],
  ['tenaga', 'TK-BATU', 'Tukang batu'],
  ['tenaga', 'TK-BESI', 'Tukang besi'],
  ['tenaga', 'TK-KAYU', 'Tukang kayu'],
  ['tenaga', 'KENEK', 'Kenek / pekerja'],
  ['tenaga', 'OPERATOR', 'Operator alat'],
  ['alat', 'EXCAVATOR', 'Excavator'],
  ['alat', 'MOLEN', 'Molen / mixer'],
  ['alat', 'VIBRATOR', 'Vibrator beton'],
  ['alat', 'DUMP-TRUCK', 'Dump truck'],
]

/** Per-PT tables added by P3 (company_id NOT NULL + immutable). */
export const P3_PER_PT_TABLES = ['rap_items', 'rap_templates', 'resource_types', 'daily_reports', 'daily_report_lines'] as const

const DATE_RE = `'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'`

const FIELD_INSERT_FN = (withDaily: boolean) => `
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
        RAISE EXCEPTION 'aftersales_activities: project % is of kind % (aftersales only)', NEW.project_id, k USING ERRCODE = '23514';${
          withDaily
            ? `
      ELSIF TG_TABLE_NAME = 'daily_reports' AND coalesce(k, '') <> 'konstruksi' THEN
        RAISE EXCEPTION 'daily_reports: project % is of kind % (konstruksi only)', NEW.project_id, k USING ERRCODE = '23514';`
            : ''
        }
      END IF;
      NEW.received_at := clock_timestamp();
      NEW.editable_until := NEW.received_at + interval '24 hours';
      RETURN NEW;
    END
    $fn$;`

const KIND_GUARD_FN = (withP3: boolean) => `
    CREATE OR REPLACE FUNCTION pk_project_kind_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.kind IS DISTINCT FROM OLD.kind AND (
           EXISTS (SELECT 1 FROM contract_units x WHERE x.project_id = OLD.id)
        OR EXISTS (SELECT 1 FROM service_reports x WHERE x.project_id = OLD.id)
        OR EXISTS (SELECT 1 FROM unit_timesheets x WHERE x.project_id = OLD.id)
        OR EXISTS (SELECT 1 FROM aftersales_activities x WHERE x.project_id = OLD.id)${
          withP3
            ? `
        OR EXISTS (SELECT 1 FROM daily_reports x WHERE x.project_id = OLD.id)
        OR EXISTS (SELECT 1 FROM rap_items x WHERE x.project_id = OLD.id)`
            : ''
        }) THEN
        RAISE EXCEPTION 'projects: kind of project % cannot change (contract units / field reports exist)', OLD.id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $fn$;`

const MEDIA_OWNER_FN = (withDaily: boolean) => `
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
        NEW.owner_company_id := (SELECT r.company_id FROM aftersales_activities r WHERE r.id = NEW.owner_doc_id::bigint);${
          withDaily
            ? `
      ELSIF NEW.owner_doc_type = 'daily_report' THEN
        NEW.owner_company_id := (SELECT r.company_id FROM daily_reports r WHERE r.id = NEW.owner_doc_id::bigint);`
            : ''
        }
      ELSE
        NEW.owner_company_id := NULL;
      END IF;
      RETURN NEW;
    END
    $fn$;`

const PHOTO_LIMIT_FN = (withDaily: boolean) => `
    CREATE OR REPLACE FUNCTION pk_field_photo_limit() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      lim integer := CASE NEW.owner_doc_type WHEN 'service_report' THEN 10 WHEN 'unit_timesheet' THEN 1 WHEN 'aftersales_activity' THEN 5${withDaily ? ` WHEN 'daily_report' THEN 10` : ''} ELSE NULL END;
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
    $fn$;`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $pk$
    BEGIN
      IF current_user !~ '_owner$' THEN
        RAISE EXCEPTION 'migrations must run as the <prefix>_owner role (current_user=%)', current_user;
      END IF;
    END
    $pk$;`)

  // ---- 1. daily reports: field-report guards
  await db.execute(sql.raw(FIELD_INSERT_FN(true)))
  await db.execute(sql`
    CREATE TRIGGER daily_reports_insert BEFORE INSERT ON daily_reports FOR EACH ROW EXECUTE FUNCTION pk_field_report_insert();
    CREATE TRIGGER daily_reports_window BEFORE UPDATE ON daily_reports FOR EACH ROW EXECUTE FUNCTION pk_field_report_window();
    CREATE TRIGGER daily_reports_no_delete BEFORE DELETE ON daily_reports FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER daily_reports_no_truncate BEFORE TRUNCATE ON daily_reports FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER daily_reports_company_members BEFORE INSERT OR UPDATE ON daily_reports FOR EACH ROW EXECUTE FUNCTION pk_company_member('reporter_id');
    CREATE TRIGGER daily_reports_protect BEFORE UPDATE ON daily_reports FOR EACH ROW EXECUTE FUNCTION pk_protect_columns(
      'doc_no', 'project_id', 'reporter_id', 'report_date', 'received_at', 'editable_until', 'device_time', 'time_trust', 'offline', 'source', 'client_uuid', 'uuid');
    CREATE TRIGGER daily_reports_company_refs BEFORE INSERT OR UPDATE ON daily_reports FOR EACH ROW EXECUTE FUNCTION pk_same_company('project_id', 'projects');
    ALTER TABLE daily_reports
      ADD CONSTRAINT daily_reports_report_date CHECK (report_date ~ ${sql.raw(DATE_RE)}),
      ADD CONSTRAINT daily_reports_hours CHECK ((rain_hours IS NULL OR (rain_hours >= 0 AND rain_hours <= 24)) AND (stop_hours IS NULL OR (stop_hours >= 0 AND stop_hours <= 24))),
      ADD CONSTRAINT daily_reports_photo_count CHECK (photo_count IS NULL OR (photo_count >= 0 AND photo_count <= 10)),
      ADD CONSTRAINT daily_reports_resources CHECK ((manpower IS NULL OR jsonb_typeof(manpower) = 'array') AND (equipment IS NULL OR jsonb_typeof(equipment) = 'array')),
      ADD CONSTRAINT daily_reports_worker_count CHECK (worker_count IS NULL OR (worker_count >= 0 AND worker_count = trunc(worker_count)));
  `)

  // ---- 2. append-only ledger + RAP realisation
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION pk_daily_line_check() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      r record;
      i record;
    BEGIN
      SELECT d.project_id, d.report_date, d.company_id INTO r FROM daily_reports d WHERE d.id = NEW.report_id;
      SELECT it.project_id, it.kind::text AS kind INTO i FROM rap_items it WHERE it.id = NEW.rap_item_id;
      IF r.project_id IS NULL OR i.project_id IS NULL OR r.project_id <> i.project_id OR NEW.project_id <> r.project_id THEN
        RAISE EXCEPTION 'daily_report_lines: item %, report % and project % do not match', NEW.rap_item_id, NEW.report_id, NEW.project_id USING ERRCODE = '23514';
      END IF;
      IF (NEW.kind::text = 'work') <> (i.kind = 'pekerjaan') THEN
        RAISE EXCEPTION 'daily_report_lines: kind % does not fit RAP item % (%)', NEW.kind, NEW.rap_item_id, i.kind USING ERRCODE = '23514';
      END IF;
      IF NEW.qty = 0 THEN
        RAISE EXCEPTION 'daily_report_lines: qty 0 is not a change' USING ERRCODE = '23514';
      END IF;
      IF NEW.origin::text = 'correction' AND length(btrim(coalesce(NEW.reason, ''))) = 0 THEN
        RAISE EXCEPTION 'daily_report_lines: a correction needs a reason' USING ERRCODE = '23514';
      END IF;
      NEW.report_date := r.report_date;
      NEW.company_id := r.company_id;
      RETURN NEW;
    END
    $fn$;

    CREATE OR REPLACE FUNCTION pk_daily_line_apply() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      PERFORM set_config('pk.rap_ledger', 'on', true);
      UPDATE rap_items SET
        realised_qty = coalesce(realised_qty, 0) + CASE WHEN NEW.kind::text = 'work' THEN NEW.qty ELSE 0 END,
        received_qty = coalesce(received_qty, 0) + CASE WHEN NEW.kind::text = 'material_in' THEN NEW.qty ELSE 0 END,
        used_qty = coalesce(used_qty, 0) + CASE WHEN NEW.kind::text = 'material_used' THEN NEW.qty ELSE 0 END,
        updated_at = now()
      WHERE id = NEW.rap_item_id;
      PERFORM set_config('pk.rap_ledger', '', true);
      RETURN NULL;
    END
    $fn$;

    CREATE TRIGGER daily_report_lines_check BEFORE INSERT ON daily_report_lines FOR EACH ROW EXECUTE FUNCTION pk_daily_line_check();
    CREATE TRIGGER daily_report_lines_apply AFTER INSERT ON daily_report_lines FOR EACH ROW EXECUTE FUNCTION pk_daily_line_apply();
    CREATE TRIGGER daily_report_lines_no_change BEFORE UPDATE OR DELETE ON daily_report_lines FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER daily_report_lines_no_truncate BEFORE TRUNCATE ON daily_report_lines FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER daily_report_lines_company_refs BEFORE INSERT ON daily_report_lines FOR EACH ROW EXECUTE FUNCTION pk_same_company('report_id', 'daily_reports', 'project_id', 'projects', 'rap_item_id', 'rap_items');
    ALTER TABLE daily_report_lines ADD CONSTRAINT daily_report_lines_qty CHECK (qty = round(qty, 2));
  `)

  // ---- 3. RAP items, resource types, templates
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION pk_rap_item_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM project_stages s WHERE s.id = NEW.stage_id AND s.project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'rap_items: stage % is not a stage of project %', NEW.stage_id, NEW.project_id USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'INSERT' THEN
        NEW.realised_qty := 0;
        NEW.received_qty := 0;
        NEW.used_qty := 0;
      ELSIF coalesce(current_setting('pk.rap_ledger', true), '') <> 'on'
        AND (NEW.realised_qty IS DISTINCT FROM OLD.realised_qty OR NEW.received_qty IS DISTINCT FROM OLD.received_qty OR NEW.used_qty IS DISTINCT FROM OLD.used_qty) THEN
        RAISE EXCEPTION 'rap_items %: realised / received / used change only through the daily-report ledger', OLD.id USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END
    $fn$;

    CREATE TRIGGER rap_items_guard BEFORE INSERT OR UPDATE ON rap_items FOR EACH ROW EXECUTE FUNCTION pk_rap_item_guard();
    CREATE TRIGGER rap_items_no_delete BEFORE DELETE ON rap_items FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER rap_items_no_truncate BEFORE TRUNCATE ON rap_items FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER rap_items_protect BEFORE UPDATE ON rap_items FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('project_id', 'kind', 'uuid');
    CREATE TRIGGER rap_items_company_refs BEFORE INSERT OR UPDATE ON rap_items FOR EACH ROW EXECUTE FUNCTION pk_same_company('project_id', 'projects', 'stage_id', 'project_stages');
    ALTER TABLE rap_items
      ADD CONSTRAINT rap_items_volume CHECK (volume > 0 AND volume = round(volume, 2)),
      ADD CONSTRAINT rap_items_price CHECK (unit_price IS NULL OR (unit_price >= 0 AND unit_price = trunc(unit_price))),
      ADD CONSTRAINT rap_items_weight CHECK (weight_pct IS NULL OR (weight_pct >= 0 AND weight_pct <= 100));

    CREATE TRIGGER resource_types_no_delete BEFORE DELETE ON resource_types FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
    CREATE TRIGGER rap_templates_no_delete BEFORE DELETE ON rap_templates FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
  `)
  for (const t of P3_PER_PT_TABLES) {
    await db.execute(sql.raw(`CREATE TRIGGER ${t}_company_protect BEFORE UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('company_id');`))
  }

  // ---- 4 + 5. project kind frozen, media
  await db.execute(sql.raw(KIND_GUARD_FN(true)))
  await db.execute(sql.raw(MEDIA_OWNER_FN(true)))
  await db.execute(sql.raw(PHOTO_LIMIT_FN(true)))

  // ---- 6. data per PT + grants
  const values = RESOURCE_DEFAULTS.map(([k, c, n]) => `('${k}', '${c}', '${n.replace(/'/g, "''")}')`).join(', ')
  await db.execute(
    sql.raw(`
    INSERT INTO document_sequences (company_id, doc_type, doc_code, pattern, reset_policy, padding, start_at, timezone, active)
    SELECT c.id, 'daily_report', 'LH', 'LH/{YY}{MM}/{seq}', 'monthly', 4, 1, coalesce(nullif(c.timezone, ''), 'Asia/Makassar'), true
      FROM companies c
     WHERE NOT EXISTS (SELECT 1 FROM document_sequences d WHERE d.company_id = c.id AND d.doc_type::text = 'daily_report');

    INSERT INTO resource_types (company_id, kind, code, name, active, uuid)
    SELECT c.id, d.kind::enum_resource_types_kind, d.code, d.name, true, gen_random_uuid()::text
      FROM companies c CROSS JOIN (VALUES ${values}) AS d(kind, code, name)
     WHERE NOT EXISTS (SELECT 1 FROM resource_types r WHERE r.company_id = c.id);

    DO $pk$
    DECLARE
      app_role text := regexp_replace(current_user, '_owner$', '_app');
    BEGIN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON rap_items, rap_templates, resource_types, daily_reports, daily_report_lines FROM %I', app_role);
      EXECUTE format('REVOKE UPDATE ON daily_report_lines FROM %I', app_role);
      EXECUTE format('GRANT DELETE ON rap_templates_items TO %I', app_role);
    END
    $pk$;`),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DELETE FROM document_sequences WHERE doc_type::text = 'daily_report';`)
  await db.execute(sql.raw(FIELD_INSERT_FN(false)))
  await db.execute(sql.raw(KIND_GUARD_FN(false)))
  await db.execute(sql.raw(MEDIA_OWNER_FN(false)))
  await db.execute(sql.raw(PHOTO_LIMIT_FN(false)))
  await db.execute(sql`
    DROP TRIGGER IF EXISTS daily_report_lines_apply ON daily_report_lines;
    DROP TRIGGER IF EXISTS daily_report_lines_check ON daily_report_lines;
    DROP TRIGGER IF EXISTS rap_items_guard ON rap_items;
    DROP FUNCTION IF EXISTS pk_daily_line_apply();
    DROP FUNCTION IF EXISTS pk_daily_line_check();
    DROP FUNCTION IF EXISTS pk_rap_item_guard();`)
}
