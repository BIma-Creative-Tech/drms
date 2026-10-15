import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * DRMS 16/10 "Kontak PIC" of clients and vendors (owner 2026-10-16: Klien / Vendor tabbed pages) — schema + backfill,
 * run as <prefix>_owner (snapshot of the Payload schema in the .json; same tables Payload creates for an `array` field):
 * - `clients_contacts` / `vendors_contacts` (field `contacts`: nama, jabatan, No. HP, email, catatan, utama; rows
 *   cascade with their client / vendor, which is never deleted). No company column: a row belongs to its parent's PT
 *   (parent access + the parent's PT triggers apply). The app role gets DELETE on both — Payload rewrites the rows of
 *   an array on every update of the parent (like stage_templates_items / rap_templates_items).
 * - Backfill: the single `contact` (+ clients' `phone`) of every existing record becomes its first, primary contact.
 *   A client with only a phone gets a row named after the client (note says so), so no number is lost when the
 *   single columns are next derived from the primary contact (fields/contacts.ts). The single columns stay (list
 *   columns, APK masters, Odoo mirror) and keep their values.
 * ADDITIVE for the previous image (it never reads the new tables; the single columns keep working).
 * Down: drops the tables (contacts added since are lost; the single columns hold the primary one).
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
  CREATE TABLE "clients_contacts" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"position" varchar,
  	"phone" varchar,
  	"email" varchar,
  	"notes" varchar,
  	"is_primary" boolean DEFAULT false
  );

  CREATE TABLE "vendors_contacts" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"position" varchar,
  	"phone" varchar,
  	"email" varchar,
  	"notes" varchar,
  	"is_primary" boolean DEFAULT false
  );

  ALTER TABLE "clients_contacts" ADD CONSTRAINT "clients_contacts_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "vendors_contacts" ADD CONSTRAINT "vendors_contacts_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "clients_contacts_order_idx" ON "clients_contacts" USING btree ("_order");
  CREATE INDEX "clients_contacts_parent_id_idx" ON "clients_contacts" USING btree ("_parent_id");
  CREATE INDEX "vendors_contacts_order_idx" ON "vendors_contacts" USING btree ("_order");
  CREATE INDEX "vendors_contacts_parent_id_idx" ON "vendors_contacts" USING btree ("_parent_id");

  DO $pk$
  DECLARE
    app_role text := regexp_replace(current_user, '_owner$', '_app');
  BEGIN
    EXECUTE format('GRANT DELETE ON clients_contacts, vendors_contacts TO %I', app_role);
  END
  $pk$;

  -- backfill: the single contact becomes the first, primary "Kontak PIC" (row id = 24 hex chars, like Payload's)
  INSERT INTO "clients_contacts" ("_order", "_parent_id", "id", "name", "phone", "notes", "is_primary")
  SELECT 1, c.id, substr(md5(c.id::text || ':client-contact:' || clock_timestamp()::text || random()::text), 1, 24),
         left(coalesce(nullif(btrim(c.contact), ''), btrim(c.name)), 128),
         nullif(left(btrim(c.phone), 32), ''),
         CASE WHEN nullif(btrim(c.contact), '') IS NULL THEN 'Dipindahkan dari kolom No. HP (tanpa nama kontak).' END,
         true
  FROM "clients" c
  WHERE nullif(btrim(c.contact), '') IS NOT NULL OR nullif(btrim(c.phone), '') IS NOT NULL;

  INSERT INTO "vendors_contacts" ("_order", "_parent_id", "id", "name", "is_primary")
  SELECT 1, v.id, substr(md5(v.id::text || ':vendor-contact:' || clock_timestamp()::text || random()::text), 1, 24),
         left(btrim(v.contact), 128), true
  FROM "vendors" v
  WHERE nullif(btrim(v.contact), '') IS NOT NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP TABLE "clients_contacts" CASCADE;
  DROP TABLE "vendors_contacts" CASCADE;`)
}
