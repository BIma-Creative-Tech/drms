import 'dart:convert';

import 'package:drift/drift.dart';

import '../../../core/db/app_database.dart';
import '../../sync/domain/sync_models.dart';
import '../domain/progress.dart';

/// Local progress reports (E4) in the encrypted DB, always scoped to one Keycloak `sub`. Photos live in
/// `media_blobs` (kind `progress`) until the server applied the report.
class ProgressRepository {
  ProgressRepository(this.db);
  final AppDatabase db;

  static const photoKind = 'progress';

  /// Reports not yet (fully) on the server: local, queued, conflict, rejected — newest first.
  Stream<List<ProgressDraft>> watchOpen(String sub) {
    final q = db.select(db.localProgressReports)
      ..where((t) => t.userSub.equals(sub) & t.syncState.isNotValue(ProgressSyncState.synced.name))
      ..orderBy([(t) => OrderingTerm.desc(t.updatedAt)]);
    return q.watch().map((rows) => rows.map(_toDraft).toList());
  }

  Future<ProgressDraft?> load(String sub, String uuid) async {
    final row = await (db.select(
      db.localProgressReports,
    )..where((t) => t.clientUuid.equals(uuid) & t.userSub.equals(sub))).getSingleOrNull();
    return row == null ? null : _toDraft(row);
  }

  /// Local row that edits server report [serverId], if any.
  Future<ProgressDraft?> byServerId(String sub, int serverId) async {
    final row = await (db.select(
      db.localProgressReports,
    )..where((t) => t.serverId.equals(serverId) & t.userSub.equals(sub))).getSingleOrNull();
    return row == null ? null : _toDraft(row);
  }

  ProgressDraft _toDraft(LocalProgressReport r) => ProgressDraft(
    clientUuid: r.clientUuid,
    projectId: r.projectId,
    projectLabel: r.projectLabel,
    stageId: r.stageId,
    stageLabel: r.stageLabel,
    pctBefore: r.pctBefore,
    pctAfter: r.pctAfter,
    work: r.work,
    issues: r.issues,
    photoUuids: (jsonDecode(r.photoUuidsJson) as List<dynamic>).map((e) => '$e').toList(),
    serverPhotoCount: r.serverPhotoCount,
    reason: r.reason,
    serverId: r.serverId,
    serverRev: r.serverRev,
    serverPctAfter: r.serverPctAfter,
    docNo: r.docNo,
    editableUntil: r.editableUntil,
    syncState: ProgressSyncState.fromCode(r.syncState),
    lastError: r.lastError,
    lastErrorCode: r.lastErrorCode,
    conflictCopy: r.conflictCopyJson == null
        ? null
        : ServerReportCopy.fromJson(jsonDecode(r.conflictCopyJson!) as Map<String, dynamic>),
    offline: r.offline,
    updatedAt: r.updatedAt,
  );

  /// Inserts or replaces the report; photos no longer referenced by this report are removed.
  Future<void> save(String sub, ProgressDraft d, {DateTime? now, bool clearConflict = false}) =>
      db.transaction(() async {
        final ts = now ?? DateTime.now();
        final existing = await (db.select(
          db.localProgressReports,
        )..where((t) => t.clientUuid.equals(d.clientUuid))).getSingleOrNull();
        if (existing != null && existing.userSub != sub) throw StateError('Laporan milik pengguna lain');
        await db
            .into(db.localProgressReports)
            .insertOnConflictUpdate(
              LocalProgressReportsCompanion.insert(
                clientUuid: d.clientUuid,
                userSub: sub,
                projectId: d.projectId,
                projectLabel: Value(d.projectLabel),
                stageId: d.stageId,
                stageLabel: Value(d.stageLabel),
                pctBefore: Value(d.pctBefore),
                pctAfter: d.pctAfter,
                work: Value(d.work),
                issues: Value(d.issues),
                photoUuidsJson: Value(jsonEncode(d.photoUuids)),
                serverPhotoCount: Value(d.serverPhotoCount),
                reason: Value(d.reason),
                serverId: Value(d.serverId),
                serverRev: Value(d.serverRev),
                serverPctAfter: Value(d.serverPctAfter),
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
          final before = (jsonDecode(existing.photoUuidsJson) as List<dynamic>).map((e) => '$e').toSet();
          final gone = before.difference(d.photoUuids.toSet()).toList();
          if (gone.isNotEmpty) await (db.delete(db.mediaBlobs)..where((t) => t.clientUuid.isIn(gone))).go();
        }
      });

  /// Removes the local report and its photos (after the server applied it, or "pakai versi server").
  Future<void> remove(String sub, String uuid) => db.transaction(() async {
    final row = await (db.select(
      db.localProgressReports,
    )..where((t) => t.clientUuid.equals(uuid) & t.userSub.equals(sub))).getSingleOrNull();
    if (row == null) return;
    final photos = (jsonDecode(row.photoUuidsJson) as List<dynamic>).map((e) => '$e').toList();
    if (photos.isNotEmpty) await (db.delete(db.mediaBlobs)..where((t) => t.clientUuid.isIn(photos))).go();
    await (db.delete(db.localProgressReports)..where((t) => t.clientUuid.equals(uuid))).go();
  });

  Future<void> markRejected(String uuid, String message, {String? code, Map<String, dynamic>? serverReport}) =>
      (db.update(db.localProgressReports)..where((t) => t.clientUuid.equals(uuid))).write(
        LocalProgressReportsCompanion(
          syncState: Value(ProgressSyncState.rejected.name),
          lastError: Value(message),
          lastErrorCode: Value(code),
          conflictCopyJson: serverReport == null ? const Value.absent() : Value(jsonEncode(serverReport)),
          serverId: serverReport == null ? const Value.absent() : Value((serverReport['id'] as num?)?.toInt()),
        ),
      );

  /// Applies one `/sync/batch` result of this report (ADR 0010 per-item rules):
  /// applied/duplicate → the server has it: local copy + photos removed (read from the server from now on);
  /// conflict → server wins, the local version is kept beside `server_report` for the conflict screen;
  /// rejected → message shown, local version kept (NOT_EDITABLE also keeps `server_report`).
  Future<void> applyResult(String sub, String uuid, SyncItemResult r) async {
    switch (r.status) {
      case SyncItemStatus.applied || SyncItemStatus.duplicate:
        await remove(sub, uuid);
      case SyncItemStatus.conflict:
        await (db.update(db.localProgressReports)..where((t) => t.clientUuid.equals(uuid))).write(
          LocalProgressReportsCompanion(
            syncState: Value(ProgressSyncState.conflict.name),
            serverId: Value(int.tryParse(r.serverId ?? '') ?? (r.serverReport?['id'] as num?)?.toInt()),
            serverRev: Value(r.rev),
            conflictCopyJson: Value(r.serverReport == null ? null : jsonEncode(r.serverReport)),
            lastError: const Value('Laporan ini sudah diubah di server. Pilih versi yang dipakai.'),
            lastErrorCode: const Value('STALE_REV'),
          ),
        );
      case SyncItemStatus.rejected:
        await markRejected(
          uuid,
          rejectionMessage(r.errors, type: SyncItemType.progressReportUpsert),
          code: r.errors.firstOrNull?.code,
          serverReport: r.serverReport,
        );
      default:
        break;
    }
  }
}
