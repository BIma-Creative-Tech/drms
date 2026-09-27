import 'dart:typed_data';

import 'package:uuid/uuid.dart';

import '../../../core/format/dates.dart';
import '../../../core/media/compress_plan.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/time/device_clock.dart';
import '../../../core/util/async_lock.dart';
import '../../expense/data/draft_repository.dart';
import '../../expense/data/expense_api.dart';
import '../../sync/data/outbox_repository.dart';
import '../data/progress_api.dart';
import '../data/progress_repository.dart';
import '../domain/progress.dart';

enum ProgressSaveOutcome {
  /// In the offline queue (`progress_report.draft_upsert`), sent by the sync engine.
  queued,

  /// Sent online right away (POST / PATCH /progress-reports) — queue disabled on the server.
  sent,
}

/// Writes progress reports (E4, US-10). Offline-first when the server allows it
/// (`/app/config` `features.syncProgressReports`): the report + compressed photos stay encrypted on the
/// phone and one outbox item carries it. When the flag is off the report is sent online (photos first,
/// then POST/PATCH with an Idempotency-Key); without a connection it is kept locally and can be sent later.
/// Every write runs under the sync lock so a running sync never loses an edit made meanwhile.
class ProgressService {
  ProgressService({
    required this.repo,
    required this.drafts,
    required this.outbox,
    required this.api,
    required this.media,
    required this.clock,
    required this.compressor,
    required this.lock,
  });

  final ProgressRepository repo;
  final DraftRepository drafts;
  final OutboxRepository outbox;
  final ProgressApi api;
  final ExpenseApi media;
  final DeviceClock clock;
  final PhotoCompressor compressor;
  final AsyncLock lock;

  /// Rear-camera photo → JPEG ≤ 1600 px / ≤ 400 KB, EXIF dropped (ADR 0010 decision 11), stored encrypted.
  Future<String> addPhoto(String sub, Uint8List raw) async {
    final photo = await compressor.compress(raw, PhotoTarget.receipt);
    final uuid = const Uuid().v7();
    await drafts.addMedia(
      sub,
      uuid: uuid,
      kind: ProgressRepository.photoKind,
      bytes: photo.bytes,
      sha256: photo.sha256Hex,
    );
    return uuid;
  }

  Future<Uint8List?> photoBytes(String uuid) async => (await drafts.media(uuid))?.bytes;

  /// A new, empty report.
  ProgressDraft newDraft({required int projectId, String projectLabel = '', required int stageId}) => ProgressDraft(
    clientUuid: const Uuid().v7(),
    projectId: projectId,
    projectLabel: projectLabel,
    stageId: stageId,
    pctAfter: 0,
  );

  /// Local edit of a server report (only the reporter within 24 h; the server re-checks). An existing
  /// local edit of the same report is continued.
  Future<ProgressDraft> startEdit(String sub, ProgressReport r) async {
    final existing = await repo.byServerId(sub, r.id);
    if (existing != null) return existing;
    return ProgressDraft(
      clientUuid: r.clientUuid ?? const Uuid().v7(),
      projectId: r.projectId,
      projectLabel: r.projectLabel,
      stageId: r.stageId,
      stageLabel: r.stageName ?? '',
      pctBefore: r.pctBefore,
      pctAfter: r.pctAfter,
      work: r.work,
      issues: r.issues,
      serverPhotoCount: r.photos.length,
      serverId: r.id,
      serverRev: r.rev,
      serverPctAfter: r.pctAfter,
      docNo: r.docNo,
      editableUntil: r.editableUntil,
    );
  }

  Future<ProgressSaveOutcome> save(String sub, ProgressDraft d, {required bool online, required bool queueEnabled}) =>
      lock.run(() async {
        if (queueEnabled) {
          final queued = _withState(d, ProgressSyncState.queued, offline: !online);
          await repo.save(sub, queued, now: clock.now(), clearConflict: true);
          await outbox.enqueueProgress(
            sub: sub,
            reportUuid: d.clientUuid,
            payload: progressPayload(d),
            photoUuids: d.photoUuids,
            deviceTime: isoWithOffset(clock.now()),
            elapsedMs: await clock.elapsedMs(),
            bootId: await clock.bootId(),
            offline: !online,
            baseRev: d.isEdit ? d.serverRev : null,
          );
          return ProgressSaveOutcome.queued;
        }
        // Queue disabled by the server: keep the report locally first (nothing is lost offline), then send.
        await repo.save(sub, _withState(d, ProgressSyncState.local), now: clock.now(), clearConflict: true);
        if (!online) throw const NetworkException();
        await _sendOnline(sub, d);
        return ProgressSaveOutcome.sent;
      });

  /// "Kirim" of a report kept locally while the queue is disabled.
  Future<void> sendLocal(String sub, String uuid) => lock.run(() async {
    final d = await repo.load(sub, uuid);
    if (d != null) await _sendOnline(sub, d);
  });

  Future<void> _sendOnline(String sub, ProgressDraft d) async {
    final ids = <int>[];
    for (final p in d.photoUuids) {
      final blob = await drafts.media(p);
      if (blob == null) continue;
      final known = int.tryParse(blob.serverMediaId ?? '');
      if (known != null) {
        ids.add(known);
        continue;
      }
      final id = await media.uploadMedia('progress-photos', blob.bytes, filename: '${blob.clientUuid}.jpg');
      await drafts.markMediaUploaded(blob.clientUuid, serverMediaId: '$id');
      ids.add(id);
    }
    try {
      if (d.isEdit) {
        await api.update(d.serverId!, progressUpdateBody(d, ids), idempotencyKey: const Uuid().v7());
      } else {
        // Idempotency-Key = report uuid: a retry after a lost answer returns the stored report.
        await api.create(progressCreateBody(d, ids), idempotencyKey: d.clientUuid);
      }
    } on ProblemException catch (e) {
      if (e.status != 429 && e.status < 500) await repo.markRejected(d.clientUuid, e.message, code: 'HTTP_${e.status}');
      rethrow;
    }
    await repo.remove(sub, d.clientUuid);
  }

  /// Conflict / NOT_EDITABLE: the server version stays; the local copy and its photos are dropped.
  Future<void> useServerVersion(String sub, String uuid) => lock.run(() async {
    await outbox.closeTarget(sub, uuid);
    await repo.remove(sub, uuid);
  });

  /// Conflict: send the phone's version again as an edit of the CURRENT server version (base_rev =
  /// server rev), with the mandatory reason. Only while the 24 h window is open.
  Future<ProgressSaveOutcome> resendMine(
    String sub,
    String uuid, {
    required String reason,
    required bool online,
    required bool queueEnabled,
  }) async {
    final d = await repo.load(sub, uuid);
    final c = d?.conflictCopy;
    if (d == null || c == null) throw StateError('Tidak ada konflik untuk laporan ini');
    final rebased = ProgressDraft(
      clientUuid: d.clientUuid,
      projectId: d.projectId,
      projectLabel: d.projectLabel,
      stageId: d.stageId,
      stageLabel: d.stageLabel,
      pctBefore: c.pctBefore,
      pctAfter: d.pctAfter,
      work: d.work,
      issues: d.issues,
      photoUuids: d.photoUuids,
      serverPhotoCount: c.photoCount,
      reason: reason,
      serverId: c.id,
      serverRev: c.rev,
      serverPctAfter: c.pctAfter,
      docNo: c.docNo,
      editableUntil: c.editableUntil,
    );
    return save(sub, rebased, online: online, queueEnabled: queueEnabled);
  }

  /// Deletes a report that the server never received (local / queued / rejected new report).
  Future<void> discard(String sub, String uuid) => lock.run(() async {
    await outbox.closeTarget(sub, uuid);
    await repo.remove(sub, uuid);
  });

  ProgressDraft _withState(ProgressDraft d, ProgressSyncState s, {bool? offline}) => ProgressDraft(
    clientUuid: d.clientUuid,
    projectId: d.projectId,
    projectLabel: d.projectLabel,
    stageId: d.stageId,
    stageLabel: d.stageLabel,
    pctBefore: d.pctBefore,
    pctAfter: d.pctAfter,
    work: d.work,
    issues: d.issues,
    photoUuids: d.photoUuids,
    serverPhotoCount: d.serverPhotoCount,
    reason: d.reason,
    serverId: d.serverId,
    serverRev: d.serverRev,
    serverPctAfter: d.serverPctAfter,
    docNo: d.docNo,
    editableUntil: d.editableUntil,
    syncState: s,
    offline: offline ?? d.offline,
  );
}
