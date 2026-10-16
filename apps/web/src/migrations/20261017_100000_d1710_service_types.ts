import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS owner 2026-10-17 (ADR 0020 amendment 2026-10-17) "Laporan Servis": Jenis servis = per-PT master, MULTI-select;
 * photos 10 → 25. Run as <prefix>_owner (snapshot of the Payload schema in the .json: service_types + the soft-delete
 * columns of ADR 0030, service_reports_rels, payload_locked_documents_rels.service_types_id, service_type as varchar).
 *
 * Payload part (generated shape):
 * - `service_types` (company, code, name, sort_order, active, uuid + is_deleted / deleted_at / deleted_by_id /
 *   delete_reason);
 * - `service_reports_rels` (hasMany `serviceTypes`, `order` = selection order, FK → service_types ON DELETE cascade —
 *   a type is never hard-deleted, see below; the soft delete's usage check reads this FK → a used type is "used");
 * - `service_reports.service_type`: enum → varchar, NULL allowed (legacy single value = first selected LEGACY code,
 *   else the first code — written by the service; a PT's own codes no longer fit the old enum). The 0.13 image keeps reading/writing
 *   it as before (plain strings), so a rollback of the image needs no down migration.
 * Hand-written:
 * 1. service_types: company_id NOT NULL, unique (company_id, code), PT / code / uuid immutable (the code is how APK
 *    0.7.0's single `service_type` finds the row), no DELETE / TRUNCATE (trigger + REVOKE; "Hapus" = soft delete),
 *    soft-delete state CHECK like 20261016_200100_d1610_soft_delete.
 * 2. Data: the four legacy types for EVERY existing PT (codes servis_berkala / perbaikan / inspeksi / pemasangan,
 *    new PTs: ensureDefaultServiceTypes), then every existing report gets the row of its PT with its old code
 *    (order 1) — refused if one is left without a type.
 * 3. service_reports_rels guard (`pk_service_report_types_guard`, BEFORE INSERT/UPDATE/DELETE): the FR1 rules of the
 *    report itself (fr1_security) also hold for its types — after `editable_until` only inside a transaction with
 *    `pk.field_override = 'correction'` (PM/Direktur correction; 'system' never touches the types), the type of the
 *    report's PT (cross-company reference), only `serviceTypes` rows, parent immutable. Payload rewrites the rows on
 *    update (DELETE + INSERT in the same transaction) → DELETE is granted to the app role and passes the same window.
 *    Deferred constraint triggers: a report has ≥ 1 type at commit (insert of a report, update/delete of its rows); a
 *    report inserted WITHOUT types but with a legacy code (the 0.13 image after an image rollback) gets the PT's type
 *    with that code instead of being refused — the image rollback needs no down migration.
 * 4. Photos: CHECK service_reports_photo_count ≤ 25 and pk_field_photo_limit 'service_report' → 25 (other types as
 *    before: timesheet 1, aftersales 5, daily report 10).
 * Down: refused while a report has more than 10 photos, a type code outside the old enum or more than one type
 * (not representable before) — restore the pre-deploy dump instead; otherwise back to the enum + 10 photos.
 */
/** Former enum order = `sort_order` 1–4 (Urutan). */
const LEGACY: ReadonlyArray<[code: string, name: string]> = [
  ['servis_berkala', 'Servis berkala'],
  ['perbaikan', 'Perbaikan'],
  ['inspeksi', 'Inspeksi'],
  ['pemasangan', 'Pemasangan'],
]

/** Data step 2a (idempotent, exported for the integration test): the four legacy types for every PT without any type. */
export const SEED_SERVICE_TYPES_SQL = `
  INSERT INTO service_types (company_id, code, name, sort_order, active, uuid)
  SELECT c.id, d.code, d.name, d.sort_order, true, gen_random_uuid()::text
    FROM companies c CROSS JOIN (VALUES ${LEGACY.map(([c, n], i) => `('${c}', '${n}', ${i + 1})`).join(', ')}) AS d(code, name, sort_order)
   WHERE NOT EXISTS (SELECT 1 FROM service_types s WHERE s.company_id = c.id)
   ORDER BY c.id, d.code;`

/** Data step 2b (idempotent, exported for the integration test): a report without types → its PT's row of its legacy code. */
export const BACKFILL_SERVICE_REPORT_TYPES_SQL = `
  INSERT INTO service_reports_rels ("order", parent_id, path, service_types_id)
  SELECT 1, r.id, 'serviceTypes', st.id
    FROM service_reports r
    JOIN service_types st ON st.company_id = r.company_id AND st.code = r.service_type::text
   WHERE NOT EXISTS (SELECT 1 FROM service_reports_rels x WHERE x.parent_id = r.id)
   ORDER BY r.id;`

/** Tables of this migration that carry the ADR 0030 soft-delete columns (registry `master('service-types')`). */
export const D1710_SOFT_DELETE_TABLES = ['service_types'] as const

const PHOTO_LIMIT_FN = (service: number) => `
    CREATE OR REPLACE FUNCTION pk_field_photo_limit() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      lim integer := CASE NEW.owner_doc_type WHEN 'service_report' THEN ${service} WHEN 'unit_timesheet' THEN 1 WHEN 'aftersales_activity' THEN 5 WHEN 'daily_report' THEN 10 ELSE NULL END;
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

  // ---- Payload schema (snapshot 20261017_100000_d1710_service_types.json)
  await db.execute(sql`
  CREATE TABLE "service_types" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"company_id" integer,
  	"code" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"sort_order" numeric,
  	"active" boolean DEFAULT true,
  	"uuid" varchar,
  	"is_deleted" boolean DEFAULT false,
  	"deleted_at" timestamp(3) with time zone,
  	"deleted_by_id" integer,
  	"delete_reason" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "service_reports_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"service_types_id" integer
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "service_types_id" integer;
  ALTER TABLE "service_types" ADD CONSTRAINT "service_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "service_types" ADD CONSTRAINT "service_types_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "service_reports_rels" ADD CONSTRAINT "service_reports_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."service_reports"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "service_reports_rels" ADD CONSTRAINT "service_reports_rels_service_types_fk" FOREIGN KEY ("service_types_id") REFERENCES "public"."service_types"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_service_types_fk" FOREIGN KEY ("service_types_id") REFERENCES "public"."service_types"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "service_types_company_idx" ON "service_types" USING btree ("company_id");
  CREATE INDEX "service_types_code_idx" ON "service_types" USING btree ("code");
  CREATE INDEX "service_types_active_idx" ON "service_types" USING btree ("active");
  CREATE UNIQUE INDEX "service_types_uuid_idx" ON "service_types" USING btree ("uuid");
  CREATE INDEX "service_types_is_deleted_idx" ON "service_types" USING btree ("is_deleted");
  CREATE INDEX "service_types_deleted_by_idx" ON "service_types" USING btree ("deleted_by_id");
  CREATE INDEX "service_types_updated_at_idx" ON "service_types" USING btree ("updated_at");
  CREATE INDEX "service_types_created_at_idx" ON "service_types" USING btree ("created_at");
  CREATE INDEX "service_reports_rels_order_idx" ON "service_reports_rels" USING btree ("order");
  CREATE INDEX "service_reports_rels_parent_idx" ON "service_reports_rels" USING btree ("parent_id");
  CREATE INDEX "service_reports_rels_path_idx" ON "service_reports_rels" USING btree ("path");
  CREATE INDEX "service_reports_rels_service_types_id_idx" ON "service_reports_rels" USING btree ("service_types_id");
  CREATE INDEX "payload_locked_documents_rels_service_types_id_idx" ON "payload_locked_documents_rels" USING btree ("service_types_id");`)

  // ---- 1. service_types: per PT, natural key, immutable identity, no hard delete
  await db.execute(sql`
  ALTER TABLE service_types ALTER COLUMN company_id SET NOT NULL;
  CREATE UNIQUE INDEX service_types_company_code_uq ON service_types (company_id, code);
  ALTER TABLE service_types ADD CONSTRAINT service_types_soft_delete_state CHECK ("is_deleted" IS NOT TRUE OR ("deleted_at" IS NOT NULL AND char_length(btrim(coalesce("delete_reason", ''))) >= 3));
  ALTER TABLE service_types ADD CONSTRAINT service_types_code_format CHECK (code ~ '^[A-Za-z0-9._/-]{1,32}$' AND char_length(btrim(name)) > 0);
  ALTER TABLE service_types ADD CONSTRAINT service_types_sort_order CHECK (sort_order IS NULL OR (sort_order >= 0 AND sort_order <= 9999 AND sort_order = trunc(sort_order)));
  CREATE TRIGGER service_types_protect BEFORE UPDATE ON service_types FOR EACH ROW EXECUTE FUNCTION pk_protect_columns('company_id', 'code', 'uuid');
  CREATE TRIGGER service_types_no_delete BEFORE DELETE ON service_types FOR EACH ROW EXECUTE FUNCTION pk_reject_mutation();
  CREATE TRIGGER service_types_no_truncate BEFORE TRUNCATE ON service_types FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();`)

  // ---- 2. data: the four legacy types per PT, every existing report → its type (before the rels guard exists)
  await db.execute(
    sql.raw(`${SEED_SERVICE_TYPES_SQL}
${BACKFILL_SERVICE_REPORT_TYPES_SQL}

  DO $pk$
  DECLARE
    missing integer;
  BEGIN
    SELECT count(*) INTO missing FROM service_reports r WHERE NOT EXISTS (SELECT 1 FROM service_reports_rels x WHERE x.parent_id = r.id);
    IF missing > 0 THEN
      RAISE EXCEPTION '20261017_100000_d1710_service_types: % service report(s) without a service type after the backfill', missing;
    END IF;
  END
  $pk$;

  ALTER TABLE "service_reports" ALTER COLUMN "service_type" SET DATA TYPE varchar USING "service_type"::text;
  ALTER TABLE "service_reports" ALTER COLUMN "service_type" DROP NOT NULL;
  DROP TYPE "public"."enum_service_reports_service_type";`),
  )

  // ---- 3. the types of a report follow the report's DB rules (window / correction override, same PT, ≥ 1)
  await db.execute(sql`
  CREATE OR REPLACE FUNCTION pk_service_report_types_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
  DECLARE
    rid integer;
    pt integer;
    until timestamptz;
    mode text := coalesce(current_setting('pk.field_override', true), '');
  BEGIN
    IF TG_OP = 'DELETE' THEN
      rid := OLD.parent_id;
    ELSE
      rid := NEW.parent_id;
    END IF;
    SELECT s.company_id, s.editable_until INTO pt, until FROM service_reports s WHERE s.id = rid;
    IF NOT FOUND THEN
      -- FK cascade of a deleted report (reports are never deleted: no_delete trigger) — nothing left to guard
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END IF;
    IF until IS NOT NULL AND clock_timestamp() > until AND mode <> 'correction' THEN
      RAISE EXCEPTION 'service_reports_rels: edit window (24 h) of service report % closed — corrections only by PM/Direktur with a reason', rid USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
      RAISE EXCEPTION 'column service_reports_rels.parent_id is immutable' USING ERRCODE = '42501';
    END IF;
    IF NEW.path IS DISTINCT FROM 'serviceTypes' OR NEW.service_types_id IS NULL THEN
      RAISE EXCEPTION 'service_reports_rels: only serviceTypes rows (path %)', NEW.path USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM service_types t WHERE t.id = NEW.service_types_id AND t.company_id = pt) THEN
      RAISE EXCEPTION 'service_reports_rels: service type % is not of the PT of service report % (cross-company reference)', NEW.service_types_id, rid USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $fn$;
  CREATE TRIGGER service_reports_rels_guard BEFORE INSERT OR UPDATE OR DELETE ON service_reports_rels FOR EACH ROW EXECUTE FUNCTION pk_service_report_types_guard();
  CREATE TRIGGER service_reports_rels_no_truncate BEFORE TRUNCATE ON service_reports_rels FOR EACH STATEMENT EXECUTE FUNCTION pk_reject_mutation();

  CREATE OR REPLACE FUNCTION pk_service_report_types_present() RETURNS trigger LANGUAGE plpgsql AS $fn$
  DECLARE
    rid integer;
  BEGIN
    IF TG_TABLE_NAME = 'service_reports' THEN
      rid := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN
      rid := OLD.parent_id;
    ELSE
      rid := NEW.parent_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM service_reports s WHERE s.id = rid)
       OR EXISTS (SELECT 1 FROM service_reports_rels x WHERE x.parent_id = rid AND x.path = 'serviceTypes' AND x.service_types_id IS NOT NULL) THEN
      RETURN NULL;
    END IF;
    IF TG_TABLE_NAME = 'service_reports' THEN
      -- a writer that knows only the legacy column (the 0.13 image after an image rollback): its code → the PT's type
      INSERT INTO service_reports_rels ("order", parent_id, path, service_types_id)
      SELECT 1, s.id, 'serviceTypes', t.id
        FROM service_reports s JOIN service_types t ON t.company_id = s.company_id AND t.code = s.service_type
       WHERE s.id = rid;
      IF FOUND THEN
        RETURN NULL;
      END IF;
    END IF;
    RAISE EXCEPTION 'service report % needs at least one service type', rid USING ERRCODE = '23514';
  END
  $fn$;
  CREATE CONSTRAINT TRIGGER service_reports_types_present AFTER INSERT ON service_reports
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pk_service_report_types_present();
  CREATE CONSTRAINT TRIGGER service_reports_rels_types_present AFTER UPDATE OR DELETE ON service_reports_rels
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pk_service_report_types_present();`)

  // ---- 4. photos ≤ 25 per service report
  await db.execute(sql`
  ALTER TABLE service_reports DROP CONSTRAINT IF EXISTS service_reports_photo_count;
  ALTER TABLE service_reports ADD CONSTRAINT service_reports_photo_count CHECK (photo_count IS NULL OR (photo_count >= 0 AND photo_count <= 25));`)
  await db.execute(sql.raw(PHOTO_LIMIT_FN(25)))

  // ---- grants: Payload rewrites the hasMany rows on update; the master is never hard-deleted
  await db.execute(sql`
  DO $pk$
  DECLARE
    app_role text := regexp_replace(current_user, '_owner$', '_app');
  BEGIN
    EXECUTE format('GRANT DELETE ON service_reports_rels TO %I', app_role);
    EXECUTE format('REVOKE DELETE, TRUNCATE ON service_types FROM %I', app_role);
    EXECUTE format('REVOKE TRUNCATE ON service_reports_rels FROM %I', app_role);
  END
  $pk$;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  const legacy = LEGACY.map(([c]) => `'${c}'`).join(', ')
  await db.execute(
    sql.raw(`
  DO $pk$
  BEGIN
    IF EXISTS (SELECT 1 FROM service_reports WHERE photo_count > 10) THEN
      RAISE EXCEPTION '20261017_100000_d1710_service_types down: service reports with more than 10 photos exist — restore the pre-deploy dump instead';
    END IF;
    IF EXISTS (SELECT 1 FROM service_reports_rels x GROUP BY x.parent_id HAVING count(*) > 1)
       OR EXISTS (SELECT 1 FROM service_reports_rels x JOIN service_types t ON t.id = x.service_types_id WHERE t.code NOT IN (${legacy})) THEN
      RAISE EXCEPTION '20261017_100000_d1710_service_types down: service reports with several / non-legacy service types exist — restore the pre-deploy dump instead';
    END IF;
  END
  $pk$;`),
  )
  await db.execute(sql.raw(PHOTO_LIMIT_FN(10)))
  await db.execute(
    sql.raw(`
  ALTER TABLE service_reports DROP CONSTRAINT IF EXISTS service_reports_photo_count;
  ALTER TABLE service_reports ADD CONSTRAINT service_reports_photo_count CHECK (photo_count IS NULL OR (photo_count >= 0 AND photo_count <= 10));
  DROP TRIGGER IF EXISTS service_reports_types_present ON service_reports;
  DROP TRIGGER IF EXISTS service_reports_rels_types_present ON service_reports_rels;
  DROP TRIGGER IF EXISTS service_reports_rels_guard ON service_reports_rels;
  DROP TRIGGER IF EXISTS service_reports_rels_no_truncate ON service_reports_rels;
  DROP FUNCTION IF EXISTS pk_service_report_types_present();
  DROP FUNCTION IF EXISTS pk_service_report_types_guard();

  -- the legacy column already holds the first type's code; re-sync only a drifted row (FR1 window: correction override)
  SELECT set_config('pk.field_override', 'correction', true);
  UPDATE service_reports r SET service_type = t.code
    FROM service_reports_rels x JOIN service_types t ON t.id = x.service_types_id
   WHERE x.parent_id = r.id AND r.service_type IS DISTINCT FROM t.code;
  CREATE TYPE "public"."enum_service_reports_service_type" AS ENUM('servis_berkala', 'perbaikan', 'inspeksi', 'pemasangan');
  ALTER TABLE "service_reports" ALTER COLUMN "service_type" SET DATA TYPE "public"."enum_service_reports_service_type" USING "service_type"::"public"."enum_service_reports_service_type";
  ALTER TABLE "service_reports" ALTER COLUMN "service_type" SET NOT NULL;

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_service_types_fk";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_service_types_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "service_types_id";
  DROP TABLE "service_reports_rels" CASCADE;
  DROP TABLE "service_types" CASCADE;`),
  )
}
