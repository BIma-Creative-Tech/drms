import 'package:drift/native.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:sqlite3/common.dart' show CommonDatabase;

/// DDL of drift schema v2 (mobile-v0.2.x, before MC3) exactly as `AppDatabase` v2 created it — dumped
/// from `sqlite_master` of the v2 code. Used to open an "old phone" database and upgrade it to v3.
const schemaV2 = <String>[
  'CREATE TABLE "kv_entries" ("key" TEXT NOT NULL, "value" TEXT NOT NULL, PRIMARY KEY ("key"))',
  'CREATE TABLE "local_drafts" ("client_uuid" TEXT NOT NULL, "user_sub" TEXT NOT NULL, "type" TEXT NOT NULL, "title" TEXT NOT NULL DEFAULT \'\', "project_id" INTEGER NULL, "cost_center_id" INTEGER NULL, "needed_date" TEXT NULL, "notes" TEXT NULL, "requester_ids_json" TEXT NOT NULL DEFAULT \'[]\', "bank_account_id" INTEGER NULL, "server_id" INTEGER NULL, "server_rev" INTEGER NULL, "sync_state" TEXT NOT NULL DEFAULT \'local\', "last_error" TEXT NULL, "conflict_copy_json" TEXT NULL, "deleted" INTEGER NOT NULL DEFAULT 0 CHECK ("deleted" IN (0, 1)), "created_at" INTEGER NOT NULL, "updated_at" INTEGER NOT NULL, PRIMARY KEY ("client_uuid"))',
  'CREATE TABLE "local_lines" ("client_uuid" TEXT NOT NULL, "draft_uuid" TEXT NOT NULL REFERENCES local_drafts (client_uuid), "no" INTEGER NOT NULL, "description" TEXT NOT NULL DEFAULT \'\', "qty" REAL NULL, "uom_id" INTEGER NULL, "unit_price" INTEGER NULL, "total" INTEGER NULL, "category_id" INTEGER NULL, "vehicle_id" INTEGER NULL, "notes" TEXT NULL, PRIMARY KEY ("client_uuid"))',
  'CREATE TABLE "local_progress_reports" ("client_uuid" TEXT NOT NULL, "user_sub" TEXT NOT NULL, "project_id" INTEGER NOT NULL, "project_label" TEXT NOT NULL DEFAULT \'\', "stage_id" INTEGER NOT NULL, "stage_label" TEXT NOT NULL DEFAULT \'\', "pct_before" REAL NULL, "pct_after" REAL NOT NULL, "work" TEXT NOT NULL DEFAULT \'\', "issues" TEXT NULL, "photo_uuids_json" TEXT NOT NULL DEFAULT \'[]\', "server_photo_count" INTEGER NOT NULL DEFAULT 0, "reason" TEXT NULL, "server_id" INTEGER NULL, "server_rev" INTEGER NULL, "doc_no" TEXT NULL, "editable_until" TEXT NULL, "server_pct_after" REAL NULL, "sync_state" TEXT NOT NULL DEFAULT \'local\', "last_error" TEXT NULL, "last_error_code" TEXT NULL, "conflict_copy_json" TEXT NULL, "offline" INTEGER NOT NULL DEFAULT 0 CHECK ("offline" IN (0, 1)), "created_at" INTEGER NOT NULL, "updated_at" INTEGER NOT NULL, PRIMARY KEY ("client_uuid"))',
  'CREATE TABLE "local_receipts" ("client_uuid" TEXT NOT NULL, "line_uuid" TEXT NOT NULL REFERENCES local_lines (client_uuid), "draft_uuid" TEXT NOT NULL REFERENCES local_drafts (client_uuid), "receipt_no" TEXT NULL, "vendor_name" TEXT NOT NULL DEFAULT \'\', "receipt_date" TEXT NOT NULL, "receipt_time" TEXT NULL, "amount" INTEGER NOT NULL, "media_uuid" TEXT NOT NULL, "server_receipt_id" INTEGER NULL, PRIMARY KEY ("client_uuid"))',
  'CREATE TABLE "media_blobs" ("client_uuid" TEXT NOT NULL, "user_sub" TEXT NOT NULL, "kind" TEXT NOT NULL, "mime_type" TEXT NOT NULL DEFAULT \'image/jpeg\', "bytes" BLOB NOT NULL, "sha256" TEXT NOT NULL, "size_bytes" INTEGER NOT NULL, "uploaded" INTEGER NOT NULL DEFAULT 0 CHECK ("uploaded" IN (0, 1)), "server_media_id" TEXT NULL, "created_at" INTEGER NOT NULL, PRIMARY KEY ("client_uuid"))',
  'CREATE TABLE "outbox" ("op_uuid" TEXT NOT NULL, "user_sub" TEXT NOT NULL, "type" TEXT NOT NULL, "target_uuid" TEXT NOT NULL, "payload_json" TEXT NOT NULL, "base_rev" INTEGER NULL, "depends_on_json" TEXT NOT NULL DEFAULT \'[]\', "device_time" TEXT NOT NULL, "elapsed_ms" INTEGER NOT NULL, "boot_id" TEXT NOT NULL, "offline" INTEGER NOT NULL DEFAULT 1 CHECK ("offline" IN (0, 1)), "status" TEXT NOT NULL DEFAULT \'pending\', "attempts" INTEGER NOT NULL DEFAULT 0, "next_attempt_at" INTEGER NULL, "last_error_code" TEXT NULL, "last_error_message" TEXT NULL, "created_at" INTEGER NOT NULL, PRIMARY KEY ("op_uuid"))',
];

/// v1 (F4a): the same tables without `local_progress_reports`.
final schemaV1 = [
  for (final s in schemaV2)
    if (!s.contains('"local_progress_reports"')) s,
];

/// v3 (MC3, mobile-v0.3.x): v2 + `company_id` exactly as drift's `addColumn` added it.
final schemaV3 = [
  ...schemaV2,
  'ALTER TABLE "local_drafts" ADD COLUMN "company_id" INTEGER NULL',
  'ALTER TABLE "outbox" ADD COLUMN "company_id" INTEGER NULL',
  'ALTER TABLE "local_progress_reports" ADD COLUMN "company_id" INTEGER NULL',
];

/// v4 (mobile-v0.3.6, 2026-10-09): v3 + the urgency level of a draft, as drift's `addColumn` added it.
final schemaV4 = [...schemaV3, 'ALTER TABLE "local_drafts" ADD COLUMN "urgency_level_id" INTEGER NULL'];

/// v5 (FR1 field reports, mobile-v0.4.0): the six field tables as drift created them.
final schemaV5 = [
  ...schemaV4,
  r'''CREATE TABLE "field_clients" ("user_sub" TEXT NOT NULL, "id" INTEGER NOT NULL, "company_id" INTEGER NOT NULL, "name" TEXT NOT NULL DEFAULT '', PRIMARY KEY ("user_sub", "id"))''',
  r'''CREATE TABLE "field_contract_units" ("user_sub" TEXT NOT NULL, "id" INTEGER NOT NULL, "company_id" INTEGER NOT NULL, "project_id" INTEGER NOT NULL, "unit_id" INTEGER NOT NULL, "unit_label" TEXT NOT NULL DEFAULT '', "unit_code" TEXT NULL, "start_date" TEXT NOT NULL, "end_date" TEXT NULL, "active" INTEGER NOT NULL DEFAULT 1 CHECK ("active" IN (0, 1)), PRIMARY KEY ("user_sub", "id"))''',
  r'''CREATE TABLE "field_open_pos" ("user_sub" TEXT NOT NULL, "id" INTEGER NOT NULL, "company_id" INTEGER NOT NULL, "project_id" INTEGER NOT NULL, "client_id" INTEGER NOT NULL, "client_name" TEXT NOT NULL DEFAULT '', "activity_date" TEXT NOT NULL, "doc_no" TEXT NULL, "items_json" TEXT NOT NULL DEFAULT '[]', "po_status" TEXT NOT NULL DEFAULT 'belum_kirim', "age_days" INTEGER NOT NULL DEFAULT 0, "deliveries" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("user_sub", "id"))''',
  r'''CREATE TABLE "field_recent_timesheets" ("user_sub" TEXT NOT NULL, "id" INTEGER NOT NULL, "company_id" INTEGER NOT NULL, "project_id" INTEGER NOT NULL, "unit_id" INTEGER NOT NULL, "report_date" TEXT NOT NULL, "hm_start" REAL NOT NULL, "hm_end" REAL NOT NULL, "operator_name" TEXT NULL, "location" TEXT NULL, "fuel_liters" REAL NULL, PRIMARY KEY ("user_sub", "id"))''',
  r'''CREATE TABLE "field_units" ("user_sub" TEXT NOT NULL, "id" INTEGER NOT NULL, "company_id" INTEGER NOT NULL, "kind" TEXT NOT NULL DEFAULT 'alat_berat', "label" TEXT NOT NULL DEFAULT '', "unit_code" TEXT NULL, "plate_display" TEXT NULL, "unit_type" TEXT NULL, "brand_model" TEXT NULL, "serial_no" TEXT NULL, "owner" TEXT NOT NULL DEFAULT 'sendiri', "client_id" INTEGER NULL, "client_name" TEXT NULL, "status" TEXT NOT NULL DEFAULT 'siap', "last_hour_meter" REAL NULL, "last_hour_meter_at" TEXT NULL, "active" INTEGER NOT NULL DEFAULT 1 CHECK ("active" IN (0, 1)), "updated_at" TEXT NULL, PRIMARY KEY ("user_sub", "id"))''',
  r'''CREATE TABLE "local_field_reports" ("client_uuid" TEXT NOT NULL, "user_sub" TEXT NOT NULL, "company_id" INTEGER NULL, "report_type" TEXT NOT NULL, "project_id" INTEGER NOT NULL, "project_label" TEXT NOT NULL DEFAULT '', "unit_id" INTEGER NULL, "client_id" INTEGER NULL, "report_date" TEXT NOT NULL, "hour_meter" REAL NULL, "content_json" TEXT NOT NULL DEFAULT '{}', "photo_uuids_json" TEXT NOT NULL DEFAULT '[]', "server_photo_count" INTEGER NOT NULL DEFAULT 0, "reason" TEXT NULL, "server_id" INTEGER NULL, "server_rev" INTEGER NULL, "doc_no" TEXT NULL, "editable_until" TEXT NULL, "sync_state" TEXT NOT NULL DEFAULT 'local', "last_error" TEXT NULL, "last_error_code" TEXT NULL, "conflict_copy_json" TEXT NULL, "offline" INTEGER NOT NULL DEFAULT 0 CHECK ("offline" IN (0, 1)), "created_at" INTEGER NOT NULL, "updated_at" INTEGER NOT NULL, PRIMARY KEY ("client_uuid"))''',
];

/// v6 (P3 konstruksi, mobile-v0.5.x): v5 + the RAP / resource-type caches as drift created them.
final schemaV6 = [
  ...schemaV5,
  r'''CREATE TABLE "field_rap_items" ("user_sub" TEXT NOT NULL, "id" INTEGER NOT NULL, "company_id" INTEGER NOT NULL, "project_id" INTEGER NOT NULL, "code" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '', "kind" TEXT NOT NULL, "uom" TEXT NOT NULL DEFAULT '', "stage_name" TEXT NOT NULL DEFAULT '', "volume" REAL NOT NULL DEFAULT 0.0, "realised" REAL NOT NULL DEFAULT 0.0, "received" REAL NOT NULL DEFAULT 0.0, "used" REAL NOT NULL DEFAULT 0.0, "sort_order" INTEGER NOT NULL DEFAULT 0, "active" INTEGER NOT NULL DEFAULT 1 CHECK ("active" IN (0, 1)), PRIMARY KEY ("user_sub", "id"))''',
  r'''CREATE TABLE "field_resource_types" ("user_sub" TEXT NOT NULL, "id" INTEGER NOT NULL, "company_id" INTEGER NOT NULL, "kind" TEXT NOT NULL, "code" TEXT NOT NULL DEFAULT '', "name" TEXT NOT NULL DEFAULT '', PRIMARY KEY ("user_sub", "id"))''',
];

/// v7 (DRMS 10/10 D3, mobile-v0.5.x): v6 + "Nominal sesuai nota" per line, as drift's `addColumn` added it.
final schemaV7 = [...schemaV6, 'ALTER TABLE "local_lines" ADD COLUMN "receipt_amount" INTEGER NULL'];

/// An in-memory database that starts as schema [version] (1 … 7) with rows from [seed], then is opened by
/// the current `AppDatabase` (runs the drift migration to the current schema version).
AppDatabase oldPhoneDb(int version, void Function(CommonDatabase raw) seed) => AppDatabase(
  NativeDatabase.memory(
    setup: (raw) {
      if (raw.select('PRAGMA user_version').first.values.first == 0) {
        for (final s in switch (version) {
          1 => schemaV1,
          2 => schemaV2,
          3 => schemaV3,
          4 => schemaV4,
          5 => schemaV5,
          6 => schemaV6,
          _ => schemaV7,
        }) {
          raw.execute(s);
        }
        seed(raw);
        raw.execute('PRAGMA user_version = $version');
      }
    },
  ),
);
