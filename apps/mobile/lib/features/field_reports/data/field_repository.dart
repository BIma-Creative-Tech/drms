import 'dart:convert';

import 'package:drift/drift.dart';

import '../../../core/db/app_database.dart';
import '../../expense/data/expense_mappers.dart' show Json;
import '../../sync/domain/sync_models.dart';
import '../domain/field_models.dart';
import '../domain/field_rules.dart';

/// FR1 field reports in the encrypted DB (schema v5), always scoped to one Keycloak `sub`: the local reports
/// (autosaved drafts, queued, conflicts, rejections) and the offline caches (units, contract units WITHOUT
/// rates, open POs without value, customers, recent timesheets). Photos live in `media_blobs` (kind `field`)
/// until the server applied the report.
class FieldRepository {
  FieldRepository(this.db);
  final AppDatabase db;

  static const photoKind = 'field';

  // ------------------------------------------------------------------ local reports

  /// Reports not (yet) on the server: drafts, queued, conflicts, rejections — newest first.
  Stream<List<FieldDraft>> watchOpen(String sub) {
    final q = db.select(db.localFieldReports)
      ..where((t) => t.userSub.equals(sub) & t.syncState.isNotValue(FieldSyncState.synced.name))
      ..orderBy([(t) => OrderingTerm.desc(t.updatedAt)]);
    return q.watch().map((rows) => rows.map(_toDraft).toList());
  }

  Future<List<FieldDraft>> open(String sub) async {
    final rows =
        await (db.select(db.localFieldReports)
              ..where((t) => t.userSub.equals(sub) & t.syncState.isNotValue(FieldSyncState.synced.name))
              ..orderBy([(t) => OrderingTerm.desc(t.updatedAt)]))
            .get();
    return rows.map(_toDraft).toList();
  }

  Future<FieldDraft?> load(String sub, String uuid) async {
    final row = await (db.select(
      db.localFieldReports,
    )..where((t) => t.clientUuid.equals(uuid) & t.userSub.equals(sub))).getSingleOrNull();
    return row == null ? null : _toDraft(row);
  }

  /// Local row editing server record [serverId] of [type], if any.
  Future<FieldDraft?> byServerId(String sub, FieldReportType type, int serverId) async {
    final row =
        await (db.select(db.localFieldReports)
              ..where((t) => t.userSub.equals(sub) & t.reportType.equals(type.code) & t.serverId.equals(serverId)))
            .getSingleOrNull();
    return row == null ? null : _toDraft(row);
  }

  /// Local timesheet (any state) of unit [unitId] on [date] of project [projectId].
  Future<FieldDraft?> timesheetFor(
    String sub, {
    required int projectId,
    required int unitId,
    required String date,
  }) async {
    final rows =
        await (db.select(db.localFieldReports)
              ..where(
                (t) =>
                    t.userSub.equals(sub) &
                    t.reportType.equals(FieldReportType.unitTimesheet.code) &
                    t.projectId.equals(projectId) &
                    t.unitId.equals(unitId) &
                    t.reportDate.equals(date),
              )
              ..orderBy([(t) => OrderingTerm.desc(t.updatedAt)]))
            .get();
    return rows.isEmpty ? null : _toDraft(rows.first);
  }

  FieldDraft _toDraft(LocalFieldReport r) {
    final type = FieldReportType.fromCode(r.reportType) ?? FieldReportType.serviceReport;
    return FieldDraft(
      clientUuid: r.clientUuid,
      type: type,
      companyId: r.companyId,
      projectId: r.projectId,
      projectLabel: r.projectLabel,
      reportDate: r.reportDate,
      content: FieldContent.fromJson(type, fMap(jsonDecode(r.contentJson))),
      serverPhotoCount: r.serverPhotoCount,
      reason: r.reason,
      serverId: r.serverId,
      serverRev: r.serverRev,
      docNo: r.docNo,
      editableUntil: r.editableUntil,
      syncState: FieldSyncState.fromCode(r.syncState),
      lastError: r.lastError,
      lastErrorCode: r.lastErrorCode,
      conflictCopy: r.conflictCopyJson == null ? null : fMap(jsonDecode(r.conflictCopyJson!)),
      offline: r.offline,
      updatedAt: r.updatedAt,
    );
  }

  /// Inserts or replaces the report; photos no longer referenced by it are removed from the phone.
  Future<void> save(String sub, FieldDraft d, {DateTime? now, bool clearConflict = false}) => db.transaction(() async {
    final ts = now ?? DateTime.now();
    final existing = await (db.select(
      db.localFieldReports,
    )..where((t) => t.clientUuid.equals(d.clientUuid))).getSingleOrNull();
    if (existing != null && existing.userSub != sub) throw StateError('Laporan milik pengguna lain');
    final photos = d.content.photoUuids;
    await db
        .into(db.localFieldReports)
        .insertOnConflictUpdate(
          LocalFieldReportsCompanion.insert(
            clientUuid: d.clientUuid,
            userSub: sub,
            companyId: Value(d.companyId ?? existing?.companyId),
            reportType: d.type.code,
            projectId: d.projectId,
            projectLabel: Value(d.projectLabel),
            unitId: Value(d.unitId),
            clientId: Value(d.clientId),
            reportDate: d.reportDate,
            hourMeter: Value(d.hourMeter),
            contentJson: Value(jsonEncode(d.content.toJson())),
            photoUuidsJson: Value(jsonEncode(photos)),
            serverPhotoCount: Value(d.serverPhotoCount),
            reason: Value(d.reason),
            serverId: Value(d.serverId),
            serverRev: Value(d.serverRev),
            docNo: Value(d.docNo),
            editableUntil: Value(d.editableUntil),
            syncState: Value(d.syncState.name),
            lastError: const Value(null),
            lastErrorCode: const Value(null),
            conflictCopyJson: Value(clearConflict ? null : existing?.conflictCopyJson),
            offline: Value(d.offline),
            createdAt: existing?.createdAt ?? ts,
            updatedAt: ts,
          ),
        );
    if (existing != null) {
      final before = _strings(existing.photoUuidsJson).toSet();
      final gone = before.difference(photos.toSet()).toList();
      if (gone.isNotEmpty) await (db.delete(db.mediaBlobs)..where((t) => t.clientUuid.isIn(gone))).go();
    }
  });

  static List<String> _strings(String json) => [for (final e in fList(jsonDecode(json))) '$e'];

  /// Removes the local report and its photos (server applied it, "pakai versi server", discard).
  Future<void> remove(String sub, String uuid) => db.transaction(() async {
    final row = await (db.select(
      db.localFieldReports,
    )..where((t) => t.clientUuid.equals(uuid) & t.userSub.equals(sub))).getSingleOrNull();
    if (row == null) return;
    final photos = _strings(row.photoUuidsJson);
    if (photos.isNotEmpty) await (db.delete(db.mediaBlobs)..where((t) => t.clientUuid.isIn(photos))).go();
    await (db.delete(db.localFieldReports)..where((t) => t.clientUuid.equals(uuid))).go();
  });

  Future<void> markRejected(String uuid, String message, {String? code, Json? serverCopy}) =>
      (db.update(db.localFieldReports)..where((t) => t.clientUuid.equals(uuid))).write(
        LocalFieldReportsCompanion(
          syncState: Value(FieldSyncState.rejected.name),
          lastError: Value(message),
          lastErrorCode: Value(code),
          conflictCopyJson: serverCopy == null ? const Value.absent() : Value(jsonEncode(serverCopy)),
          serverId: serverCopy == null ? const Value.absent() : Value(fIntN(serverCopy['id'])),
          serverRev: serverCopy == null ? const Value.absent() : Value(fIntN(serverCopy['rev'])),
        ),
      );

  /// Applies one `/sync/batch` result of this report (ADR 0010 per-item rules, as progress reports):
  /// applied/duplicate → the server has it: the local copy + photos are removed (the caches learn the new HM /
  /// unit status so the next report is prefilled right while offline); conflict → server wins, the local
  /// version is kept beside the server copy for the conflict screen; rejected → message shown, local version kept.
  Future<void> applyResult(String sub, String uuid, SyncItemResult r) async {
    final row = await (db.select(
      db.localFieldReports,
    )..where((t) => t.clientUuid.equals(uuid) & t.userSub.equals(sub))).getSingleOrNull();
    if (row == null) return;
    final type = FieldReportType.fromCode(row.reportType) ?? FieldReportType.serviceReport;
    switch (r.status) {
      case SyncItemStatus.applied || SyncItemStatus.duplicate:
        await _learn(sub, _toDraft(row), r.serverField, int.tryParse(r.serverId ?? ''));
        await remove(sub, uuid);
      case SyncItemStatus.conflict:
        await (db.update(db.localFieldReports)..where((t) => t.clientUuid.equals(uuid))).write(
          LocalFieldReportsCompanion(
            syncState: Value(FieldSyncState.conflict.name),
            serverId: Value(int.tryParse(r.serverId ?? '') ?? fIntN(r.serverField?['id'])),
            serverRev: Value(r.rev ?? fIntN(r.serverField?['rev'])),
            conflictCopyJson: Value(r.serverField == null ? null : jsonEncode(r.serverField)),
            lastError: const Value('Laporan ini sudah ada/diubah di server. Pilih versi yang dipakai.'),
            lastErrorCode: const Value('STALE_REV'),
          ),
        );
      case SyncItemStatus.rejected:
        await markRejected(
          uuid,
          rejectionMessage(r.errors, type: type.syncType),
          code: r.errors.firstOrNull?.code,
          serverCopy: r.serverField,
        );
      default:
        break;
    }
  }

  /// After a delivery: the recent-timesheet cache gets the new timesheet, the unit cache its HM / status.
  Future<void> _learn(String sub, FieldDraft d, Json? copy, int? serverId) async {
    final unitId = d.unitId;
    final company = d.companyId;
    if (d.content case final TimesheetContent c when unitId != null && company != null && c.hmEnd != null) {
      final id = fIntN(copy?['id']) ?? serverId ?? d.serverId;
      if (id != null) {
        await db
            .into(db.fieldRecentTimesheets)
            .insertOnConflictUpdate(
              FieldRecentTimesheetsCompanion.insert(
                userSub: sub,
                id: id,
                companyId: company,
                projectId: d.projectId,
                unitId: unitId,
                reportDate: d.reportDate,
                hmStart: fDblN(copy?['hm_start']) ?? c.hmStart ?? 0,
                hmEnd: fDblN(copy?['hm_end']) ?? c.hmEnd!,
                operatorName: Value(c.operatorName.trim().isEmpty ? null : c.operatorName.trim()),
                location: Value(c.location.trim().isEmpty ? null : c.location.trim()),
                fuelLiters: Value(c.fuelLiters),
              ),
            );
      }
    }
    if (unitId == null) return;
    final unit = await (db.select(
      db.fieldUnits,
    )..where((t) => t.userSub.equals(sub) & t.id.equals(unitId))).getSingleOrNull();
    if (unit == null) return;
    final hm = d.hourMeter;
    final at = unit.lastHourMeterAt?.substring(0, 10);
    final newer = hm != null && (at == null || d.reportDate.compareTo(at) >= 0);
    final status = d.content is ServiceContent ? d.service.unitStatusAfter?.code : null;
    if (!newer && status == null) return;
    await (db.update(db.fieldUnits)..where((t) => t.userSub.equals(sub) & t.id.equals(unitId))).write(
      FieldUnitsCompanion(
        lastHourMeter: newer ? Value(hm) : const Value.absent(),
        lastHourMeterAt: newer ? Value(d.reportDate) : const Value.absent(),
        status: status == null ? const Value.absent() : Value(status),
      ),
    );
  }

  // ------------------------------------------------------------------ caches

  /// Upserts units of `GET /units` (delta pulls keep deactivated rows as inactive).
  Future<void> putUnits(String sub, List<FieldUnit> units) => db.batch((b) {
    for (final u in units) {
      b.insert(
        db.fieldUnits,
        FieldUnitsCompanion.insert(
          userSub: sub,
          id: u.id,
          companyId: u.companyId,
          kind: Value(u.kind),
          label: Value(u.label),
          unitCode: Value(u.unitCode),
          plateDisplay: Value(u.plateDisplay),
          unitType: Value(u.type),
          brandModel: Value(u.brandModel),
          serialNo: Value(u.serialNo),
          owner: Value(u.owner),
          clientId: Value(u.clientId),
          clientName: Value(u.clientName),
          status: Value(u.status.code),
          lastHourMeter: Value(u.lastHourMeter),
          lastHourMeterAt: Value(u.lastHourMeterAt),
          active: Value(u.active),
          updatedAt: Value(u.updatedAt),
        ),
        mode: InsertMode.insertOrReplace,
      );
    }
  });

  Future<List<FieldUnit>> units(String sub, {int? companyId, Iterable<int>? ids}) async {
    final q = db.select(db.fieldUnits)..where((t) => t.userSub.equals(sub) & t.active.equals(true));
    if (companyId != null) q.where((t) => t.companyId.equals(companyId));
    if (ids != null) q.where((t) => t.id.isIn(ids.toList()));
    final rows = await q.get();
    return [
      for (final r in rows)
        FieldUnit(
          id: r.id,
          companyId: r.companyId,
          kind: r.kind,
          label: r.label,
          unitCode: r.unitCode,
          plateDisplay: r.plateDisplay,
          type: r.unitType,
          brandModel: r.brandModel,
          serialNo: r.serialNo,
          owner: r.owner,
          clientId: r.clientId,
          clientName: r.clientName,
          status: UnitStatus.fromCode(r.status) ?? UnitStatus.siap,
          lastHourMeter: r.lastHourMeter,
          lastHourMeterAt: r.lastHourMeterAt,
          active: r.active,
          updatedAt: r.updatedAt,
        ),
    ]..sort((a, b) => a.code.compareTo(b.code));
  }

  /// Replaces the contract units of [projectId] (full pull; rates are never part of the row).
  Future<void> putContractUnits(String sub, int projectId, List<FieldContractUnit> list) => db.transaction(() async {
    await (db.delete(db.fieldContractUnits)..where((t) => t.userSub.equals(sub) & t.projectId.equals(projectId))).go();
    await db.batch((b) {
      for (final c in list) {
        b.insert(
          db.fieldContractUnits,
          FieldContractUnitsCompanion.insert(
            userSub: sub,
            id: c.id,
            companyId: c.companyId,
            projectId: projectId,
            unitId: c.unitId,
            unitLabel: Value(c.unitLabel),
            unitCode: Value(c.unitCode),
            startDate: c.startDate,
            endDate: Value(c.endDate),
            active: Value(c.active),
          ),
          mode: InsertMode.insertOrReplace,
        );
      }
    });
  });

  Future<List<FieldContractUnit>> contractUnits(String sub, int projectId) async {
    final rows = await (db.select(
      db.fieldContractUnits,
    )..where((t) => t.userSub.equals(sub) & t.projectId.equals(projectId))).get();
    return [
      for (final r in rows)
        FieldContractUnit(
          id: r.id,
          companyId: r.companyId,
          projectId: r.projectId,
          unitId: r.unitId,
          unitLabel: r.unitLabel,
          unitCode: r.unitCode,
          startDate: r.startDate,
          endDate: r.endDate,
          active: r.active,
        ),
    ]..sort((a, b) => a.code.compareTo(b.code));
  }

  /// Replaces the open POs of [projectId] (no value is stored).
  Future<void> putOpenPos(String sub, int projectId, List<FieldOpenPo> list) => db.transaction(() async {
    await (db.delete(db.fieldOpenPos)..where((t) => t.userSub.equals(sub) & t.projectId.equals(projectId))).go();
    await db.batch((b) {
      for (final p in list) {
        b.insert(
          db.fieldOpenPos,
          FieldOpenPosCompanion.insert(
            userSub: sub,
            id: p.id,
            companyId: p.companyId,
            projectId: projectId,
            clientId: p.clientId,
            clientName: Value(p.clientName),
            activityDate: p.activityDate,
            docNo: Value(p.docNo),
            itemsJson: Value(jsonEncode([for (final i in p.items) i.toJson()])),
            poStatus: Value(p.poStatus.code),
            ageDays: Value(p.ageDays),
            deliveries: Value(p.deliveries),
          ),
          mode: InsertMode.insertOrReplace,
        );
      }
    });
  });

  Future<List<FieldOpenPo>> openPos(String sub, {required int projectId, int? clientId}) async {
    final q = db.select(db.fieldOpenPos)..where((t) => t.userSub.equals(sub) & t.projectId.equals(projectId));
    if (clientId != null) q.where((t) => t.clientId.equals(clientId));
    q.orderBy([(t) => OrderingTerm.asc(t.activityDate)]);
    return [
      for (final r in await q.get())
        FieldOpenPo(
          id: r.id,
          companyId: r.companyId,
          projectId: r.projectId,
          clientId: r.clientId,
          clientName: r.clientName,
          activityDate: r.activityDate,
          docNo: r.docNo,
          items: [for (final i in fList(jsonDecode(r.itemsJson))) PartLine.fromJson(i)],
          poStatus: PoStatus.fromCode(r.poStatus) ?? PoStatus.belumKirim,
          ageDays: r.ageDays,
          deliveries: r.deliveries,
        ),
    ];
  }

  /// Adds customers seen in units / POs / activities (names refreshed; never deleted — history keeps them).
  Future<void> putClients(String sub, Iterable<FieldClient> clients) => db.batch((b) {
    for (final c in clients) {
      if (c.name.trim().isEmpty) continue;
      b.insert(
        db.fieldClients,
        FieldClientsCompanion.insert(userSub: sub, id: c.id, companyId: c.companyId, name: Value(c.name.trim())),
        mode: InsertMode.insertOrReplace,
      );
    }
  });

  Future<List<FieldClient>> clients(String sub, {int? companyId}) async {
    final q = db.select(db.fieldClients)..where((t) => t.userSub.equals(sub));
    if (companyId != null) q.where((t) => t.companyId.equals(companyId));
    q.orderBy([(t) => OrderingTerm.asc(t.name)]);
    return [for (final r in await q.get()) FieldClient(id: r.id, companyId: r.companyId, name: r.name)];
  }

  /// Replaces the cached server timesheets of [projectId] from [from] on.
  Future<void> putRecentTimesheets(String sub, int projectId, String from, List<FieldRecord> list) =>
      db.transaction(() async {
        await (db.delete(db.fieldRecentTimesheets)..where(
              (t) => t.userSub.equals(sub) & t.projectId.equals(projectId) & t.reportDate.isBiggerOrEqualValue(from),
            ))
            .go();
        // Older than the window: dropped (the prefill only needs the last days).
        await (db.delete(db.fieldRecentTimesheets)..where(
              (t) => t.userSub.equals(sub) & t.reportDate.isSmallerThanValue(addDays(from, -fieldBackdateMaxDays)),
            ))
            .go();
        await db.batch((b) {
          for (final r in list) {
            final unit = r.unitId;
            if (unit == null) continue;
            b.insert(
              db.fieldRecentTimesheets,
              FieldRecentTimesheetsCompanion.insert(
                userSub: sub,
                id: r.id,
                companyId: r.companyId ?? 0,
                projectId: projectId,
                unitId: unit,
                reportDate: r.date,
                hmStart: fDblN(r.raw['hmStart']) ?? 0,
                hmEnd: fDblN(r.raw['hmEnd']) ?? 0,
                operatorName: Value(fStrN(r.raw['operatorName'])),
                location: Value(fStrN(r.raw['location'])),
                fuelLiters: Value(fDblN(r.raw['fuelLiters'])),
              ),
              mode: InsertMode.insertOrReplace,
            );
          }
        });
      });

  /// Every timesheet known on the phone for [unitIds] (server cache + local reports of any open state).
  Future<List<TimesheetMark>> timesheetMarks(String sub, {Iterable<int>? unitIds}) async {
    final q = db.select(db.fieldRecentTimesheets)..where((t) => t.userSub.equals(sub));
    if (unitIds != null) q.where((t) => t.unitId.isIn(unitIds.toList()));
    final server = [
      for (final r in await q.get())
        TimesheetMark(
          unitId: r.unitId,
          reportDate: r.reportDate,
          hmStart: r.hmStart,
          hmEnd: r.hmEnd,
          operatorName: r.operatorName,
          location: r.location,
          fuelLiters: r.fuelLiters,
        ),
    ];
    final lq = db.select(db.localFieldReports)
      ..where((t) => t.userSub.equals(sub) & t.reportType.equals(FieldReportType.unitTimesheet.code));
    if (unitIds != null) lq.where((t) => t.unitId.isIn(unitIds.toList()));
    final local = <TimesheetMark>[];
    for (final r in await lq.get()) {
      final d = _toDraft(r);
      final c = d.timesheet;
      if (c.unitId == null || c.hmEnd == null || d.syncState == FieldSyncState.local) continue;
      local.add(
        TimesheetMark(
          unitId: c.unitId!,
          reportDate: d.reportDate,
          hmStart: c.hmStart ?? c.hmEnd!,
          hmEnd: c.hmEnd!,
          operatorName: c.operatorName,
          location: c.location,
          fuelLiters: c.fuelLiters,
          local: true,
        ),
      );
    }
    return [...server, ...local];
  }

  /// HM readings of a unit known on the phone (service reports + timesheets, local or cached).
  Future<List<(String, double)>> hmReadings(String sub, int unitId, {String? excludeUuid}) async {
    final marks = await timesheetMarks(sub, unitIds: [unitId]);
    final rows =
        await (db.select(db.localFieldReports)..where(
              (t) =>
                  t.userSub.equals(sub) &
                  t.unitId.equals(unitId) &
                  t.hourMeter.isNotNull() &
                  t.syncState.isNotValue(FieldSyncState.local.name),
            ))
            .get();
    return [
      for (final m in marks)
        if (!m.local) (m.reportDate, m.hmEnd),
      for (final r in rows)
        if (r.clientUuid != excludeUuid) (r.reportDate, r.hourMeter!),
    ];
  }

  /// Delta-sync marker of `GET /units?project=` (server time of the last pull).
  Future<String?> unitsSince(String sub, int projectId) => db.kvGet('field:units-since:$sub:$projectId');
  Future<void> setUnitsSince(String sub, int projectId, String serverTime) =>
      db.kvPut('field:units-since:$sub:$projectId', serverTime);
}
