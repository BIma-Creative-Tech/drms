import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:uuid/uuid.dart';

import '../../../core/db/app_database.dart';
import '../domain/sync_models.dart';

class OutboxCounts {
  const OutboxCounts({this.pending = 0, this.failed = 0, this.rejected = 0});
  final int pending;
  final int failed;
  final int rejected;
  int get attention => failed + rejected;
}

class OutboxRepository {
  OutboxRepository(this.db);
  final AppDatabase db;

  /// Queues (or refreshes) the upsert of one draft. A still-pending operation for the same draft is
  /// updated in place (same idempotency key, never sent successfully). The first operation of a draft
  /// uses the draft uuid as `client_uuid` (ADR 0010 Example B); later edits get a new UUIDv7.
  Future<String> enqueueDraftUpsert({
    required String sub,
    required String draftUuid,
    required Map<String, dynamic> Function(bool includeDraftId) payload,
    required List<String> dependsOn,
    required String deviceTime,
    required int elapsedMs,
    required String bootId,
    required bool offline,
    int? baseRev,
    DateTime? now,
  }) => db.transaction(() async {
    final ts = now ?? DateTime.now();
    final pending =
        await (db.select(db.outbox)..where(
              (t) =>
                  t.targetUuid.equals(draftUuid) &
                  t.userSub.equals(sub) &
                  t.type.equals(SyncItemType.expenseDraftUpsert) &
                  t.status.equals('pending'),
            ))
            .getSingleOrNull();
    if (pending != null) {
      await (db.update(db.outbox)..where((t) => t.opUuid.equals(pending.opUuid))).write(
        OutboxCompanion(
          payloadJson: Value(jsonEncode(payload(pending.opUuid != draftUuid))),
          dependsOnJson: Value(jsonEncode(dependsOn)),
          deviceTime: Value(deviceTime),
          elapsedMs: Value(elapsedMs),
          bootId: Value(bootId),
          offline: Value(offline),
          baseRev: Value(baseRev),
          nextAttemptAt: const Value(null),
        ),
      );
      return pending.opUuid;
    }
    final anyBefore = await (db.select(db.outbox)..where((t) => t.opUuid.equals(draftUuid))).getSingleOrNull();
    final opUuid = anyBefore == null ? draftUuid : const Uuid().v7();
    await db
        .into(db.outbox)
        .insert(
          OutboxCompanion.insert(
            opUuid: opUuid,
            userSub: sub,
            type: SyncItemType.expenseDraftUpsert,
            targetUuid: draftUuid,
            payloadJson: jsonEncode(payload(opUuid != draftUuid)),
            baseRev: Value(baseRev),
            dependsOnJson: Value(jsonEncode(dependsOn)),
            deviceTime: deviceTime,
            elapsedMs: elapsedMs,
            bootId: bootId,
            offline: Value(offline),
            createdAt: ts,
          ),
        );
    return opUuid;
  });

  /// True when an operation for [target] was delivered (the server knows the draft).
  Future<bool> wasApplied(String sub, String target) async => (await (db.select(
    db.outbox,
  )..where((t) => t.userSub.equals(sub) & t.targetUuid.equals(target) & t.status.equals('applied'))).get()).isNotEmpty;

  Future<String> enqueueDraftDelete({
    required String sub,
    required String draftUuid,
    required Map<String, dynamic> payload,
    required String deviceTime,
    required int elapsedMs,
    required String bootId,
    required bool offline,
  }) async {
    final opUuid = const Uuid().v7();
    await db
        .into(db.outbox)
        .insert(
          OutboxCompanion.insert(
            opUuid: opUuid,
            userSub: sub,
            type: SyncItemType.expenseDraftDelete,
            targetUuid: draftUuid,
            payloadJson: jsonEncode(payload),
            deviceTime: deviceTime,
            elapsedMs: elapsedMs,
            bootId: bootId,
            offline: Value(offline),
            createdAt: DateTime.now(),
          ),
        );
    return opUuid;
  }

  /// Queues (or refreshes) the one pending `progress_report.draft_upsert` of a local report (E4). While an
  /// operation is still pending it is updated in place (same idempotency key, never delivered); after a
  /// delivery the next edit gets a new UUIDv7 with `base_rev` = the server rev. The first operation of a
  /// report uses the report uuid as `client_uuid` (= `report_client_uuid` on the server).
  Future<String> enqueueProgress({
    required String sub,
    required String reportUuid,
    required Map<String, dynamic> payload,
    required List<String> photoUuids,
    required String deviceTime,
    required int elapsedMs,
    required String bootId,
    required bool offline,
    int? baseRev,
  }) => db.transaction(() async {
    final pending =
        await (db.select(db.outbox)..where(
              (t) =>
                  t.targetUuid.equals(reportUuid) &
                  t.userSub.equals(sub) &
                  t.type.equals(SyncItemType.progressReportUpsert) &
                  (t.status.equals('pending') | t.status.equals('failed')),
            ))
            .getSingleOrNull();
    if (pending != null) {
      await (db.update(db.outbox)..where((t) => t.opUuid.equals(pending.opUuid))).write(
        OutboxCompanion(
          payloadJson: Value(jsonEncode(payload)),
          dependsOnJson: Value(jsonEncode(photoUuids)),
          deviceTime: Value(deviceTime),
          elapsedMs: Value(elapsedMs),
          bootId: Value(bootId),
          offline: Value(offline),
          baseRev: Value(baseRev),
          status: const Value('pending'),
          attempts: const Value(0),
          nextAttemptAt: const Value(null),
        ),
      );
      return pending.opUuid;
    }
    // An edit (base_rev set) never reuses the report uuid: the server may already hold the creating item
    // under that client_uuid and would answer `duplicate` with the old result.
    final anyBefore = await (db.select(db.outbox)..where((t) => t.opUuid.equals(reportUuid))).getSingleOrNull();
    final opUuid = anyBefore == null && baseRev == null ? reportUuid : const Uuid().v7();
    await db
        .into(db.outbox)
        .insert(
          OutboxCompanion.insert(
            opUuid: opUuid,
            userSub: sub,
            type: SyncItemType.progressReportUpsert,
            targetUuid: reportUuid,
            payloadJson: jsonEncode(payload),
            baseRev: Value(baseRev),
            dependsOnJson: Value(jsonEncode(photoUuids)),
            deviceTime: deviceTime,
            elapsedMs: elapsedMs,
            bootId: bootId,
            offline: Value(offline),
            createdAt: DateTime.now(),
          ),
        );
    return opUuid;
  });

  /// Queues one attendance item: own check-in/out (ADR 0010 Example A) or a PM on-behalf record (E6).
  /// Never merged or edited: every tap is its own item; the photo is uploaded first ([dependsOn] = local
  /// media uuid).
  Future<String> enqueueAttendance({
    required String sub,
    required String type,
    required Map<String, dynamic> payload,
    required String selfieUuid,
    required String deviceTime,
    required int elapsedMs,
    required String bootId,
    required bool offline,
  }) async {
    final opUuid = const Uuid().v7();
    await db
        .into(db.outbox)
        .insert(
          OutboxCompanion.insert(
            opUuid: opUuid,
            userSub: sub,
            type: type,
            targetUuid: opUuid,
            payloadJson: jsonEncode(payload),
            dependsOnJson: Value(jsonEncode([selfieUuid])),
            deviceTime: deviceTime,
            elapsedMs: elapsedMs,
            bootId: bootId,
            offline: Value(offline),
            createdAt: DateTime.now(),
          ),
        );
    return opUuid;
  }

  /// Attendance items of [sub], newest first (attendance screen).
  Stream<List<OutboxData>> watchAttendance(String sub) =>
      (db.select(db.outbox)
            ..where(
              (t) =>
                  t.userSub.equals(sub) &
                  t.type.isIn([
                    SyncItemType.attendanceCheckIn,
                    SyncItemType.attendanceCheckOut,
                    SyncItemType.attendanceOnBehalf,
                  ]),
            )
            ..orderBy([(t) => OrderingTerm.desc(t.createdAt)])
            ..limit(20))
          .watch();

  /// Items of [sub] that may be sent now, in creation order.
  Future<List<OutboxData>> due(String sub, DateTime now) =>
      (db.select(db.outbox)
            ..where(
              (t) =>
                  t.userSub.equals(sub) &
                  t.status.equals('pending') &
                  (t.nextAttemptAt.isNull() | t.nextAttemptAt.isSmallerOrEqualValue(now)),
            )
            ..orderBy([(t) => OrderingTerm.asc(t.createdAt), (t) => OrderingTerm.asc(t.opUuid)]))
          .get();

  Future<List<OutboxData>> all(String sub) =>
      (db.select(db.outbox)
            ..where((t) => t.userSub.equals(sub))
            ..orderBy([(t) => OrderingTerm.desc(t.createdAt)]))
          .get();

  Future<OutboxData?> pendingForTarget(String sub, String target) => (db.select(
    db.outbox,
  )..where((t) => t.userSub.equals(sub) & t.targetUuid.equals(target) & t.status.equals('pending'))).getSingleOrNull();

  Future<void> setStatus(String opUuid, String status, {String? code, String? message}) =>
      (db.update(db.outbox)..where((t) => t.opUuid.equals(opUuid))).write(
        OutboxCompanion(status: Value(status), lastErrorCode: Value(code), lastErrorMessage: Value(message)),
      );

  Future<void> defer(String opUuid, int attempts, DateTime next, {String? code, String? message}) =>
      (db.update(db.outbox)..where((t) => t.opUuid.equals(opUuid))).write(
        OutboxCompanion(
          attempts: Value(attempts),
          nextAttemptAt: Value(next),
          status: Value(attempts >= maxSyncAttempts ? 'failed' : 'pending'),
          lastErrorCode: Value(code),
          lastErrorMessage: Value(message),
        ),
      );

  /// Manual "Coba lagi" for items shown as "Gagal dikirim".
  Future<void> retryFailed(String sub) =>
      (db.update(db.outbox)..where((t) => t.userSub.equals(sub) & t.status.equals('failed'))).write(
        const OutboxCompanion(status: Value('pending'), attempts: Value(0), nextAttemptAt: Value(null)),
      );

  /// Pending ops of a draft that was submitted online are obsolete.
  Future<void> supersede(String sub, String target) =>
      (db.update(db.outbox)
            ..where((t) => t.userSub.equals(sub) & t.targetUuid.equals(target) & t.status.equals('pending')))
          .write(const OutboxCompanion(status: Value('superseded')));

  /// The user resolved the item(s) of [target] (kept the server version / discarded the report): every
  /// open or refused operation is closed, so the queue no longer asks for attention.
  Future<void> closeTarget(String sub, String target) =>
      (db.update(db.outbox)..where(
            (t) =>
                t.userSub.equals(sub) &
                t.targetUuid.equals(target) &
                t.status.isIn(const ['pending', 'failed', 'rejected', 'conflict']),
          ))
          .write(const OutboxCompanion(status: Value('superseded')));

  Stream<OutboxCounts> watchCounts(String sub) {
    final q = db.select(db.outbox)..where((t) => t.userSub.equals(sub));
    return q.watch().map(
      (rows) => OutboxCounts(
        pending: rows.where((r) => r.status == 'pending').length,
        failed: rows.where((r) => r.status == 'failed').length,
        rejected: rows.where((r) => r.status == 'rejected' || r.status == 'conflict').length,
      ),
    );
  }

  /// Local photo ids this item needs uploaded first (kept local; the wire `depends_on` lists items).
  static List<String> mediaDeps(OutboxData r) =>
      (jsonDecode(r.dependsOnJson) as List<dynamic>).map((e) => '$e').toList();

  static QueuedItem toQueued(OutboxData r, Map<String, dynamic> payload) => QueuedItem(
    clientUuid: r.opUuid,
    type: r.type,
    payload: payload,
    deviceTime: r.deviceTime,
    elapsedMs: r.elapsedMs,
    bootId: r.bootId,
    offline: r.offline,
    baseRev: r.baseRev,
  );
}
