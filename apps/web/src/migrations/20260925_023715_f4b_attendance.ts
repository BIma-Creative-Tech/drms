import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * F4b (ADR 0010 decisions 7/8, F4 gate "offline check-in synced"): new table `attendances` (written
 * only by the sync service) + company_settings.sync_attendance_enabled (default false).
 * ADDITIVE / staging-safe: a new table, one nullable column on payload_locked_documents_rels and one
 * defaulted column on company_settings; no existing row is rewritten. Guards: f4b_attendance_security.
 */

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_attendances_kind" AS ENUM('check_in', 'check_out');
  CREATE TYPE "public"."enum_attendances_time_trust" AS ENUM('server', 'estimated', 'device_only');
  CREATE TABLE "attendances" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"employee_id" integer NOT NULL,
  	"user_id" integer NOT NULL,
  	"kind" "enum_attendances_kind" NOT NULL,
  	"project_id" integer NOT NULL,
  	"local_date" varchar NOT NULL,
  	"attendance_time" timestamp(3) with time zone NOT NULL,
  	"received_at" timestamp(3) with time zone NOT NULL,
  	"device_time" timestamp(3) with time zone,
  	"estimated_time" timestamp(3) with time zone,
  	"time_trust" "enum_attendances_time_trust" NOT NULL,
  	"offline" boolean DEFAULT false,
  	"lat" numeric NOT NULL,
  	"lng" numeric NOT NULL,
  	"accuracy_m" numeric,
  	"distance_m" numeric NOT NULL,
  	"selfie_id" integer NOT NULL,
  	"device_id" integer,
  	"flags" jsonb,
  	"client_uuid" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "attendances_id" integer;
  ALTER TABLE "company_settings" ADD COLUMN "sync_attendance_enabled" boolean DEFAULT false;
  ALTER TABLE "attendances" ADD CONSTRAINT "attendances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "attendances" ADD CONSTRAINT "attendances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "attendances" ADD CONSTRAINT "attendances_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "attendances" ADD CONSTRAINT "attendances_selfie_id_media_selfies_id_fk" FOREIGN KEY ("selfie_id") REFERENCES "public"."media_selfies"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "attendances" ADD CONSTRAINT "attendances_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "attendances_employee_idx" ON "attendances" USING btree ("employee_id");
  CREATE INDEX "attendances_user_idx" ON "attendances" USING btree ("user_id");
  CREATE INDEX "attendances_project_idx" ON "attendances" USING btree ("project_id");
  CREATE INDEX "attendances_local_date_idx" ON "attendances" USING btree ("local_date");
  CREATE INDEX "attendances_offline_idx" ON "attendances" USING btree ("offline");
  CREATE INDEX "attendances_selfie_idx" ON "attendances" USING btree ("selfie_id");
  CREATE INDEX "attendances_device_idx" ON "attendances" USING btree ("device_id");
  CREATE UNIQUE INDEX "attendances_client_uuid_idx" ON "attendances" USING btree ("client_uuid");
  CREATE INDEX "attendances_updated_at_idx" ON "attendances" USING btree ("updated_at");
  CREATE INDEX "attendances_created_at_idx" ON "attendances" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_attendances_fk" FOREIGN KEY ("attendances_id") REFERENCES "public"."attendances"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_attendances_id_idx" ON "payload_locked_documents_rels" USING btree ("attendances_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "attendances" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "attendances" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_attendances_fk";
  
  DROP INDEX "payload_locked_documents_rels_attendances_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "attendances_id";
  ALTER TABLE "company_settings" DROP COLUMN "sync_attendance_enabled";
  DROP TYPE "public"."enum_attendances_kind";
  DROP TYPE "public"."enum_attendances_time_trust";`)
}
