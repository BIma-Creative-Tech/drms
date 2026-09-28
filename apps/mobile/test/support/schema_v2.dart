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

/// An in-memory database that starts as schema [version] (1 or 2) with rows from [seed], then is opened by
/// the current `AppDatabase` (runs the drift migration to the current schema version).
AppDatabase oldPhoneDb(int version, void Function(CommonDatabase raw) seed) => AppDatabase(
  NativeDatabase.memory(
    setup: (raw) {
      if (raw.select('PRAGMA user_version').first.values.first == 0) {
        for (final s in version == 1 ? schemaV1 : schemaV2) {
          raw.execute(s);
        }
        seed(raw);
        raw.execute('PRAGMA user_version = $version');
      }
    },
  ),
);
