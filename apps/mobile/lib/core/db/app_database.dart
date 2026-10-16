import 'dart:convert';
import 'dart:math';

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:sqlite3/common.dart' show CommonDatabase;

import '../storage/secure_store.dart';

part 'app_database.g.dart';

/// Local draft expense request (header). Every row is locked to the Keycloak `sub` that created it
/// (ADR 0010 decision 3: after a remote logout the queue is kept but only usable by the same user).
class LocalDrafts extends Table {
  TextColumn get clientUuid => text()();
  TextColumn get userSub => text()();

  /// MC3 (schema v3): PT of the draft. Null = written before v3 and not yet assigned ("needs PT" when
  /// the user has several PTs; see `CompanyBackfill`). Lines and receipts belong to the draft's PT.
  IntColumn get companyId => integer().nullable()();
  TextColumn get type => text()(); // advance | reimburse
  TextColumn get title => text().withDefault(const Constant(''))();
  IntColumn get projectId => integer().nullable()();
  IntColumn get costCenterId => integer().nullable()();
  TextColumn get neededDate => text().nullable()();

  /// Schema v4 (owner decision 2026-10-09): "Tingkat urgensi" of the draft; null = not chosen.
  IntColumn get urgencyLevelId => integer().nullable()();
  TextColumn get notes => text().nullable()();
  TextColumn get requesterIdsJson => text().withDefault(const Constant('[]'))();
  IntColumn get bankAccountId => integer().nullable()();

  /// Schema v10 (ADR 0027 "Pembayaran vendor"): payee type + vendor / vendor account / invoice of the draft as JSON
  /// (`DraftRepository` vendorToJson); null = an employee payment (every draft before v10).
  TextColumn get vendorJson => text().nullable()();
  IntColumn get serverId => integer().nullable()();
  IntColumn get serverRev => integer().nullable()();

  /// local | queued | synced | conflict | rejected | submitted
  TextColumn get syncState => text().withDefault(const Constant('local'))();
  TextColumn get lastError => text().nullable()();
  TextColumn get conflictCopyJson => text().nullable()();
  BoolColumn get deleted => boolean().withDefault(const Constant(false))();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {clientUuid};
}

class LocalLines extends Table {
  TextColumn get clientUuid => text()();
  TextColumn get draftUuid => text().references(LocalDrafts, #clientUuid)();
  IntColumn get no => integer()();
  TextColumn get description => text().withDefault(const Constant(''))();
  RealColumn get qty => real().nullable()();
  IntColumn get uomId => integer().nullable()();
  IntColumn get unitPrice => integer().nullable()();
  IntColumn get total => integer().nullable()();

  /// Schema v7 (DRMS 10/10 D3): "Nominal sesuai nota", nullable. `total` is qty × unit price from v7 on.
  IntColumn get receiptAmount => integer().nullable()();

  /// Schema v8 (DRMS 10/10 D4): RAP item of the line, nullable. Lines written before v8 keep NULL and must pick
  /// one before the draft can be submitted.
  IntColumn get rapItemId => integer().nullable()();
  IntColumn get categoryId => integer().nullable()();
  IntColumn get vehicleId => integer().nullable()();
  TextColumn get notes => text().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {clientUuid};
}

class LocalReceipts extends Table {
  TextColumn get clientUuid => text()();
  TextColumn get lineUuid => text().references(LocalLines, #clientUuid)();
  TextColumn get draftUuid => text().references(LocalDrafts, #clientUuid)();
  TextColumn get receiptNo => text().nullable()();
  TextColumn get vendorName => text().withDefault(const Constant(''))();
  TextColumn get receiptDate => text()(); // YYYY-MM-DD
  TextColumn get receiptTime => text().nullable()(); // HH:mm
  IntColumn get amount => integer()();
  TextColumn get mediaUuid => text()();
  IntColumn get serverReceiptId => integer().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {clientUuid};
}

/// Compressed photos waiting for upload, stored inside the encrypted DB (ADR 0010 decision 4 default).
class MediaBlobs extends Table {
  TextColumn get clientUuid => text()();
  TextColumn get userSub => text()();
  TextColumn get kind => text()(); // receipt | signature | ...
  TextColumn get mimeType => text().withDefault(const Constant('image/jpeg'))();
  BlobColumn get bytes => blob()();
  TextColumn get sha256 => text()();
  IntColumn get sizeBytes => integer()();
  BoolColumn get uploaded => boolean().withDefault(const Constant(false))();
  TextColumn get serverMediaId => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {clientUuid};
}

/// E4 progress report written on the phone (US-10): a new report or an edit (≤ 24 h) of a server report,
/// kept until the server applied it. Locked to the Keycloak `sub` like every queued row.
class LocalProgressReports extends Table {
  TextColumn get clientUuid => text()();
  TextColumn get userSub => text()();

  /// MC3 (schema v3): PT of the report (= PT of its project). Null = written before v3, not yet assigned.
  IntColumn get companyId => integer().nullable()();
  IntColumn get projectId => integer()();
  TextColumn get projectLabel => text().withDefault(const Constant(''))();
  IntColumn get stageId => integer()();
  TextColumn get stageLabel => text().withDefault(const Constant(''))();

  /// Stage % known when the report was written (client guard: pctAfter ≥ pctBefore).
  RealColumn get pctBefore => real().nullable()();
  RealColumn get pctAfter => real()();
  TextColumn get work => text().withDefault(const Constant(''))();
  TextColumn get issues => text().nullable()();

  /// Local photo ids (media_blobs, kind `progress`) not yet on the server.
  TextColumn get photoUuidsJson => text().withDefault(const Constant('[]'))();

  /// Photos already on the server report (edit: total ≤ 5).
  IntColumn get serverPhotoCount => integer().withDefault(const Constant(0))();

  /// Edit reason (required once the server knows the report).
  TextColumn get reason => text().nullable()();
  IntColumn get serverId => integer().nullable()();
  IntColumn get serverRev => integer().nullable()();
  TextColumn get docNo => text().nullable()();
  TextColumn get editableUntil => text().nullable()();

  /// Server pct_after of the report at the time the edit started (pct_after is only sent when changed).
  RealColumn get serverPctAfter => real().nullable()();

  /// local | queued | synced | conflict | rejected
  TextColumn get syncState => text().withDefault(const Constant('local'))();
  TextColumn get lastError => text().nullable()();
  TextColumn get lastErrorCode => text().nullable()();

  /// `server_report` of a conflict / NOT_EDITABLE (server wins; the local version is kept beside it).
  TextColumn get conflictCopyJson => text().nullable()();
  BoolColumn get offline => boolean().withDefault(const Constant(false))();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {clientUuid};
}

/// FR1 (schema v5, ADR 0020): a field report written on the phone — `service_report`, `unit_timesheet` or
/// `aftersales_activity` ([reportType]) — from the autosaved draft until the server applied it. The
/// type-specific fields live in [contentJson]; the columns beside it are the ones the app filters on
/// (unit + date for the HM prefill, client for the aftersales list). Locked to the Keycloak `sub`.
/// Money: no contract rate is ever stored; an aftersales value only as the reporter typed it.
class LocalFieldReports extends Table {
  TextColumn get clientUuid => text()();
  TextColumn get userSub => text()();
  IntColumn get companyId => integer().nullable()();

  /// service_report | unit_timesheet | aftersales_activity | daily_report (v6)
  TextColumn get reportType => text()();
  IntColumn get projectId => integer()();
  TextColumn get projectLabel => text().withDefault(const Constant(''))();
  IntColumn get unitId => integer().nullable()();
  IntColumn get clientId => integer().nullable()();

  /// Business date `YYYY-MM-DD` (company TZ).
  TextColumn get reportDate => text()();

  /// Timesheet: HM akhir; service report: HM saat servis (prefill / HM floor of later reports).
  RealColumn get hourMeter => real().nullable()();
  TextColumn get contentJson => text().withDefault(const Constant('{}'))();

  /// Every local photo id (media_blobs, kind `field`) of the report, for clean-up.
  TextColumn get photoUuidsJson => text().withDefault(const Constant('[]'))();
  IntColumn get serverPhotoCount => integer().withDefault(const Constant(0))();
  TextColumn get reason => text().nullable()();
  IntColumn get serverId => integer().nullable()();
  IntColumn get serverRev => integer().nullable()();
  TextColumn get docNo => text().nullable()();
  TextColumn get editableUntil => text().nullable()();

  /// local (draft) | queued | synced | conflict | rejected
  TextColumn get syncState => text().withDefault(const Constant('local'))();
  TextColumn get lastError => text().nullable()();
  TextColumn get lastErrorCode => text().nullable()();

  /// `server_service_report` / `server_unit_timesheet` / `server_aftersales_activity` of a conflict / NOT_EDITABLE.
  TextColumn get conflictCopyJson => text().nullable()();
  BoolColumn get offline => boolean().withDefault(const Constant(false))();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {clientUuid};
}

/// FR1 cache of `GET /units` (Unit & Kendaraan, no rates) per user — unit pickers offline.
@DataClassName('FieldUnitRow')
class FieldUnits extends Table {
  TextColumn get userSub => text()();
  IntColumn get id => integer()();
  IntColumn get companyId => integer()();
  TextColumn get kind => text().withDefault(const Constant('alat_berat'))();
  TextColumn get label => text().withDefault(const Constant(''))();
  TextColumn get unitCode => text().nullable()();
  TextColumn get plateDisplay => text().nullable()();
  TextColumn get unitType => text().nullable()();
  TextColumn get brandModel => text().nullable()();
  TextColumn get serialNo => text().nullable()();

  /// sendiri | pelanggan
  TextColumn get owner => text().withDefault(const Constant('sendiri'))();
  IntColumn get clientId => integer().nullable()();
  TextColumn get clientName => text().nullable()();

  /// siap | rusak | menunggu_part
  TextColumn get status => text().withDefault(const Constant('siap'))();
  RealColumn get lastHourMeter => real().nullable()();
  TextColumn get lastHourMeterAt => text().nullable()();
  BoolColumn get active => boolean().withDefault(const Constant(true))();
  TextColumn get updatedAt => text().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {userSub, id};
}

/// FR1 cache of `GET /projects/{id}/contract-units` WITHOUT rate, rate basis or minimum hours (ADR 0020 §7).
@DataClassName('FieldContractUnitRow')
class FieldContractUnits extends Table {
  TextColumn get userSub => text()();
  IntColumn get id => integer()();
  IntColumn get companyId => integer()();
  IntColumn get projectId => integer()();
  IntColumn get unitId => integer()();
  TextColumn get unitLabel => text().withDefault(const Constant(''))();
  TextColumn get unitCode => text().nullable()();
  TextColumn get startDate => text()();
  TextColumn get endDate => text().nullable()();
  BoolColumn get active => boolean().withDefault(const Constant(true))();

  @override
  Set<Column<Object>> get primaryKey => {userSub, id};
}

/// FR1 cache of `GET /aftersales/open-pos` (no value: money never cached on the phone).
@DataClassName('FieldOpenPoRow')
class FieldOpenPos extends Table {
  TextColumn get userSub => text()();
  IntColumn get id => integer()();
  IntColumn get companyId => integer()();
  IntColumn get projectId => integer()();
  IntColumn get clientId => integer()();
  TextColumn get clientName => text().withDefault(const Constant(''))();
  TextColumn get activityDate => text()();
  TextColumn get docNo => text().nullable()();
  TextColumn get itemsJson => text().withDefault(const Constant('[]'))();
  TextColumn get poStatus => text().withDefault(const Constant('belum_kirim'))();
  IntColumn get ageDays => integer().withDefault(const Constant(0))();
  IntColumn get deliveries => integer().withDefault(const Constant(0))();

  @override
  Set<Column<Object>> get primaryKey => {userSub, id};
}

/// FR1 customers for the aftersales picker (names seen in units / POs / activities of the user's scope).
@DataClassName('FieldClientRow')
class FieldClients extends Table {
  TextColumn get userSub => text()();
  IntColumn get id => integer()();
  IntColumn get companyId => integer()();
  TextColumn get name => text().withDefault(const Constant(''))();

  @override
  Set<Column<Object>> get primaryKey => {userSub, id};
}

/// FR1 recent server timesheets (≈ 15 days) per user: HM awal prefill, "Salin dari kemarin", unit tabs
/// "✓ / belum" while offline.
@DataClassName('FieldRecentTimesheetRow')
class FieldRecentTimesheets extends Table {
  TextColumn get userSub => text()();
  IntColumn get id => integer()();
  IntColumn get companyId => integer()();
  IntColumn get projectId => integer()();
  IntColumn get unitId => integer()();
  TextColumn get reportDate => text()();
  RealColumn get hmStart => real()();
  RealColumn get hmEnd => real()();
  TextColumn get operatorName => text().nullable()();
  TextColumn get location => text().nullable()();
  RealColumn get fuelLiters => real().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {userSub, id};
}

/// P3 cache of `GET /projects/{id}/rap` items (konstruksi): code, stage, kind, uom, volume and realisation for
/// the daily-report pickers WITHOUT unit prices (never stored on the phone).
@DataClassName('FieldRapItemRow')
class FieldRapItems extends Table {
  TextColumn get userSub => text()();
  IntColumn get id => integer()();
  IntColumn get companyId => integer()();
  IntColumn get projectId => integer()();
  TextColumn get code => text()();
  TextColumn get description => text().withDefault(const Constant(''))();

  /// pekerjaan | material
  TextColumn get kind => text()();
  TextColumn get uom => text().withDefault(const Constant(''))();
  TextColumn get stageName => text().withDefault(const Constant(''))();
  RealColumn get volume => real().withDefault(const Constant(0))();
  RealColumn get realised => real().withDefault(const Constant(0))();
  RealColumn get received => real().withDefault(const Constant(0))();
  RealColumn get used => real().withDefault(const Constant(0))();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();
  BoolColumn get active => boolean().withDefault(const Constant(true))();

  @override
  Set<Column<Object>> get primaryKey => {userSub, id};
}

/// P3 cache of the manpower / equipment types of a PT (`resourceTypes` of `GET /projects/{id}/rap`).
@DataClassName('FieldResourceTypeRow')
class FieldResourceTypes extends Table {
  TextColumn get userSub => text()();
  IntColumn get id => integer()();
  IntColumn get companyId => integer()();

  /// tenaga | alat
  TextColumn get kind => text()();
  TextColumn get code => text().withDefault(const Constant(''))();
  TextColumn get name => text().withDefault(const Constant(''))();

  @override
  Set<Column<Object>> get primaryKey => {userSub, id};
}

/// Schema v11 (owner 2026-10-17): cache of the service types ("Jenis servis") of the user's PTs (`GET /service-types
/// ?includeInactive=1`). The service report offers the active types of the project's PT; inactive ones keep the names
/// of reports that use them.
@DataClassName('FieldServiceTypeRow')
class FieldServiceTypes extends Table {
  TextColumn get userSub => text()();
  IntColumn get id => integer()();
  IntColumn get companyId => integer()();
  TextColumn get code => text().withDefault(const Constant(''))();
  TextColumn get name => text().withDefault(const Constant(''))();
  BoolColumn get active => boolean().withDefault(const Constant(true))();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();

  @override
  Set<Column<Object>> get primaryKey => {userSub, id};
}

/// Offline outbox (`POST /api/v1/sync/batch` items). `opUuid` = item `client_uuid` = idempotency key.
class Outbox extends Table {
  TextColumn get opUuid => text()();
  TextColumn get userSub => text()();

  /// MC3 (schema v3): PT of the item, sent as `company_id` (the item's own PT, never the switcher
  /// selection). Null = queued before v3: assigned when the user has one PT, else held until chosen.
  IntColumn get companyId => integer().nullable()();

  /// Schema v9 (ADR 0023): site (kantor cabang) of an attendance item at a site — the same id as `payload.site_id`,
  /// kept as a column so the attendance history resolves the location without parsing the payload. Null for every
  /// other item (projects, cost centers, expense / report items) and for rows queued before v9.
  IntColumn get siteId => integer().nullable()();
  TextColumn get type => text()();
  TextColumn get targetUuid => text()();
  TextColumn get payloadJson => text()();
  IntColumn get baseRev => integer().nullable()();
  TextColumn get dependsOnJson => text().withDefault(const Constant('[]'))();
  TextColumn get deviceTime => text()();
  IntColumn get elapsedMs => integer()();
  TextColumn get bootId => text()();
  BoolColumn get offline => boolean().withDefault(const Constant(true))();

  /// pending | applied | rejected | conflict | failed
  TextColumn get status => text().withDefault(const Constant('pending'))();
  IntColumn get attempts => integer().withDefault(const Constant(0))();
  DateTimeColumn get nextAttemptAt => dateTime().nullable()();
  TextColumn get lastErrorCode => text().nullable()();
  TextColumn get lastErrorMessage => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {opUuid};
}

/// Small key/value cache (masters JSON, last server time pair, …).
class KvEntries extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column<Object>> get primaryKey => {key};
}

@DriftDatabase(
  tables: [
    LocalDrafts,
    LocalLines,
    LocalReceipts,
    MediaBlobs,
    Outbox,
    KvEntries,
    LocalProgressReports,
    // v5 (FR1 field reports)
    LocalFieldReports,
    FieldUnits,
    FieldContractUnits,
    FieldOpenPos,
    FieldClients,
    FieldRecentTimesheets,
    // v6 (P3 konstruksi daily reports)
    FieldRapItems,
    FieldResourceTypes,
    // v11 (service types per PT)
    FieldServiceTypes,
  ],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase(super.e);

  @override
  int get schemaVersion => 11;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) => m.createAll(),
    onUpgrade: (m, from, to) async {
      // v2 (E4): local progress reports. Additive; existing drafts/outbox rows stay untouched.
      // (Created with the current columns, so v3's company_id is already part of it.)
      if (from < 2) await m.createTable(localProgressReports);
      // v3 (MC3): company_id, nullable. Existing rows keep NULL here — the PT is only known after `/me`:
      // one PT → assigned automatically, several PTs → the user chooses (never guessed; CompanyBackfill).
      if (from < 3) {
        await m.addColumn(localDrafts, localDrafts.companyId);
        await m.addColumn(outbox, outbox.companyId);
        if (from >= 2) await m.addColumn(localProgressReports, localProgressReports.companyId);
      }
      // v4 (2026-10-09): urgency level of a draft, nullable — existing drafts keep NULL ("not chosen").
      if (from < 4) await m.addColumn(localDrafts, localDrafts.urgencyLevelId);
      // v5 (FR1, ADR 0020): field reports (drafts + queue) and their offline caches. Additive only: every
      // existing table and row stays untouched.
      if (from < 5) {
        await m.createTable(localFieldReports);
        await m.createTable(fieldUnits);
        await m.createTable(fieldContractUnits);
        await m.createTable(fieldOpenPos);
        await m.createTable(fieldClients);
        await m.createTable(fieldRecentTimesheets);
      }
      // v6 (P3 konstruksi): RAP items + resource types caches of the daily report. Additive only; daily reports
      // themselves live in local_field_reports (report_type `daily_report`, content_json).
      if (from < 6) {
        await m.createTable(fieldRapItems);
        await m.createTable(fieldResourceTypes);
      }
      // v7 (DRMS 10/10 D3): "Nominal sesuai nota" per line, nullable. Existing lines keep their total; a line
      // without a unit price is completed in the line editor before it can be submitted.
      if (from < 7) await m.addColumn(localLines, localLines.receiptAmount);
      // v8 (DRMS 10/10 D4): RAP item per line, nullable. Existing lines keep NULL — the editor asks for the item
      // ("Pilih item RAP") and submit stays blocked until every line has one.
      if (from < 8) await m.addColumn(localLines, localLines.rapItemId);
      // v9 (ADR 0023 sites): site of an attendance outbox item, nullable. Queued rows keep NULL (they were queued for a
      // project or a cost center — an APK before v9 had no site locations).
      if (from < 9) await m.addColumn(outbox, outbox.siteId);
      // v10 (ADR 0027 "Pembayaran vendor"): vendor data of a draft (JSON), nullable. Existing drafts keep NULL = paid
      // to an employee account, exactly as before.
      if (from < 10) await m.addColumn(localDrafts, localDrafts.vendorJson);
      // v11 (owner 2026-10-17): service types ("Jenis servis") per PT. Additive only; a service report queued by an
      // older APK keeps its single legacy code and is mapped to the PT's type of the same code when it is sent.
      if (from < 11) await m.createTable(fieldServiceTypes);
    },
    beforeOpen: (details) async {
      await customStatement('PRAGMA foreign_keys = ON');
    },
  );

  Future<String?> kvGet(String key) async =>
      (await (select(kvEntries)..where((t) => t.key.equals(key))).getSingleOrNull())?.value;

  Future<void> kvPut(String key, String value) =>
      into(kvEntries).insertOnConflictUpdate(KvEntriesCompanion.insert(key: key, value: value));

  Future<Map<String, dynamic>?> kvGetJson(String key) async {
    final v = await kvGet(key);
    if (v == null) return null;
    final decoded = jsonDecode(v);
    return decoded is Map<String, dynamic> ? decoded : null;
  }
}

/// Opens the encrypted database (drift + SQLite3MultipleCiphers, ADR 0010 decision 4). The 256-bit
/// key is generated on first run and kept in [SecureStore] (Android Keystore-backed). Fails closed
/// when the SQLite library has no cipher support.
Future<AppDatabase> openEncryptedDatabase(SecureStore store) async {
  final key = await loadOrCreateDbKey(store);
  return AppDatabase(
    driftDatabase(
      name: 'proyekkas',
      native: DriftNativeOptions(setup: (CommonDatabase db) => applyCipherKey(db, key)),
    ),
  );
}

/// Applied in the drift background isolate; must only capture sendable values (drift_flutter docs).
void applyCipherKey(CommonDatabase db, String key) {
  final cipher = db.select('PRAGMA cipher;');
  if (cipher.isEmpty) {
    throw StateError('SQLite tanpa enkripsi (sqlite3mc tidak aktif)');
  }
  db.execute("PRAGMA key = '${key.replaceAll("'", "''")}';");
  // E3-b: a WorkManager run may open a second connection to this file (own isolate); wait for its lock
  // instead of failing with SQLITE_BUSY.
  db.execute('PRAGMA busy_timeout = 5000;');
}

Future<String> loadOrCreateDbKey(SecureStore store) async {
  final existing = await store.read(SecureKeys.dbKey);
  if (existing != null && existing.isNotEmpty) return existing;
  final rnd = Random.secure();
  final bytes = List<int>.generate(32, (_) => rnd.nextInt(256));
  final key = base64Url.encode(bytes).replaceAll('=', '');
  await store.write(SecureKeys.dbKey, key);
  return key;
}
