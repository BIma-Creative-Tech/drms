import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:uuid/uuid.dart';

import '../../../core/db/app_database.dart';
import '../../../core/format/dates.dart';
import '../../../core/logging/log.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/time/device_clock.dart';
import '../../../core/util/async_lock.dart';
import '../../expense/data/draft_repository.dart';
import '../../expense/data/expense_mappers.dart';
import '../../expense/domain/draft.dart';
import '../../progress/data/progress_repository.dart';
import '../data/outbox_repository.dart';
import '../data/sync_api.dart';
import '../domain/sync_models.dart';

enum SyncRunOutcome { nothingToDo, offline, done, partial, serverUnsupported, notLoggedIn }

class SyncRunResult {
  const SyncRunResult(this.outcome, {this.applied = 0, this.rejected = 0, this.deferred = 0, this.conflicts = 0});
  final SyncRunOutcome outcome;
  final int applied;
  final int rejected;
  final int deferred;
  final int conflicts;
}

/// Sends the offline outbox: receipt photos first (`POST /media/receipts` → `media_id`), then JSON items in batches
/// (`POST /sync/batch`), and applies the per-item result rules of ADR 0010:
/// applied/duplicate → done; rejected → never retried, message shown; deferred → back-off;
/// conflict → server wins, local version kept as "Salinan konflik".
class SyncEngine {
  SyncEngine({
    required this.outbox,
    required this.drafts,
    required this.api,
    required this.db,
    required this.clock,
    required this.deviceId,
    required this.lock,
    required this.uploadMedia,
    this.progress,
    Random? random,
  }) : _random = random ?? Random();

  final OutboxRepository outbox;
  final DraftRepository drafts;
  final SyncApi api;
  final AppDatabase db;
  final DeviceClock clock;
  final String Function() deviceId;
  final AsyncLock lock;

  /// Uploads one local photo (`POST /api/v1/media/receipts` or `/media/selfies` by kind) → media id.
  final Future<int> Function(MediaBlob blob) uploadMedia;

  /// E4 progress reports: per-item results are applied to the local report rows.
  final ProgressRepository? progress;
  final Random _random;

  static const _lastServerKey = 'sync:last_server';

  Future<SyncRunResult> run(String? sub) {
    if (sub == null) return Future.value(const SyncRunResult(SyncRunOutcome.notLoggedIn));
    return lock.run(() => _run(sub));
  }

  Future<SyncRunResult> _run(String sub) async {
    final now = clock.now();
    final due = await outbox.due(sub, now);
    if (due.isEmpty) return const SyncRunResult(SyncRunOutcome.nothingToDo);

    // 1) receipt photos → POST /media/receipts (media_id), then resolve the payloads
    final ready = <OutboxData>[];
    final payloads = <String, Map<String, dynamic>>{};
    for (final item in due) {
      final mediaIds = <String, int>{};
      var ok = true;
      for (final mediaUuid in OutboxRepository.mediaDeps(item)) {
        final m = await drafts.media(mediaUuid);
        if (m == null) continue;
        final known = int.tryParse(m.serverMediaId ?? '');
        if (known != null) {
          mediaIds[mediaUuid] = known;
          continue;
        }
        try {
          final id = await uploadMedia(m);
          await drafts.markMediaUploaded(m.clientUuid, serverMediaId: '$id');
          mediaIds[mediaUuid] = id;
        } on NetworkException {
          return const SyncRunResult(SyncRunOutcome.offline);
        } on ProblemException catch (e) {
          if (e.status == 413 || e.status == 400) {
            await outbox.setStatus(item.opUuid, 'rejected', code: 'MEDIA_${e.status}', message: e.message);
            await _markRejected(item, e.message, code: 'MEDIA_${e.status}');
          } else {
            await _deferOne(item, 'MEDIA_${e.status}', e.message);
          }
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      final resolved = resolveMediaIds(jsonDecode(item.payloadJson) as Map<String, dynamic>, mediaIds);
      if (resolved == null) {
        final msg = SyncItemType.isProgress(item.type)
            ? 'Foto laporan tidak ditemukan di HP. Ambil ulang foto.'
            : 'Foto nota tidak ditemukan di HP. Ambil ulang foto nota.';
        await outbox.setStatus(item.opUuid, 'rejected', code: 'MEDIA_MISSING', message: msg);
        await _markRejected(item, msg, code: 'MEDIA_MISSING');
        continue;
      }
      payloads[item.opUuid] = resolved;
      ready.add(item);
    }
    if (ready.isEmpty) return const SyncRunResult(SyncRunOutcome.partial);

    // 2) batches
    final plan = planBatches([for (final r in ready) OutboxRepository.toQueued(r, payloads[r.opUuid]!)]);
    for (final o in plan.oversized) {
      await outbox.setStatus(o.clientUuid, 'rejected', code: 'TOO_LARGE', message: 'Data terlalu besar untuk dikirim.');
    }
    var applied = 0, rejected = 0, deferred = 0, conflicts = 0;
    final byUuid = {for (final r in ready) r.opUuid: r};
    for (final batch in plan.batches) {
      final BatchResponse res;
      try {
        res = await api.postBatch(
          batchId: const Uuid().v7(),
          deviceId: deviceId(),
          clock: await _clockInfo(),
          items: batch,
        );
      } on NetworkException {
        return SyncRunResult(
          SyncRunOutcome.offline,
          applied: applied,
          rejected: rejected,
          deferred: deferred,
          conflicts: conflicts,
        );
      } on ProblemException catch (e) {
        final rows = [for (final q in batch) byUuid[q.clientUuid]!];
        if (e.status == 404 || e.status == 405 || e.status == 501) {
          await _deferAll(rows, 'SYNC_UNAVAILABLE', 'Server belum mendukung sinkron offline.');
          return const SyncRunResult(SyncRunOutcome.serverUnsupported);
        }
        // 423 cutover freeze, 429, 5xx, invalid envelope: retry later.
        await _deferAll(rows, 'HTTP_${e.status}', e.message);
        deferred += rows.length;
        continue;
      }
      await _rememberServerTime(res.serverTime);
      for (final r in res.results) {
        final row = byUuid[r.clientUuid];
        if (row == null) continue;
        if (SyncItemType.isProgress(row.type)) {
          switch (r.status) {
            case SyncItemStatus.applied || SyncItemStatus.duplicate:
              applied++;
              await outbox.setStatus(row.opUuid, 'applied');
            case SyncItemStatus.conflict:
              conflicts++;
              await outbox.setStatus(row.opUuid, 'conflict', code: 'CONFLICT', message: 'Laporan diubah di server.');
            case SyncItemStatus.rejected:
              rejected++;
              await outbox.setStatus(
                row.opUuid,
                'rejected',
                code: r.errors.firstOrNull?.code,
                message: rejectionMessage(r.errors, type: row.type),
              );
            case SyncItemStatus.unsupported:
              deferred++;
              await outbox.defer(
                row.opUuid,
                row.attempts,
                clock.now().add(const Duration(minutes: 30)),
                code: 'UNSUPPORTED',
                message: 'Server belum menerima jenis data ini.',
              );
              continue;
            case SyncItemStatus.deferred || SyncItemStatus.unknown:
              deferred++;
              await _deferOne(row, 'DEFERRED', r.errors.firstOrNull?.message);
              continue;
          }
          await progress?.applyResult(sub, row.targetUuid, r);
          continue;
        }
        switch (r.status) {
          case SyncItemStatus.applied || SyncItemStatus.duplicate:
            applied++;
            await outbox.setStatus(row.opUuid, 'applied');
            await drafts.setSyncState(
              row.targetUuid,
              DraftSyncState.synced,
              serverId: int.tryParse(r.serverId ?? ''),
              serverRev: r.rev,
              clearError: true,
            );
          case SyncItemStatus.rejected:
            rejected++;
            final msg = rejectionMessage(r.errors, type: row.type);
            await outbox.setStatus(row.opUuid, 'rejected', code: r.errors.firstOrNull?.code, message: msg);
            await _markDraft(row, DraftSyncState.rejected, error: msg);
          case SyncItemStatus.conflict:
            conflicts++;
            await outbox.setStatus(row.opUuid, 'conflict', code: 'CONFLICT', message: 'Draft diubah di web.');
            await drafts.setSyncState(
              row.targetUuid,
              DraftSyncState.conflict,
              serverId: int.tryParse(r.serverId ?? ''),
              serverRev: r.rev,
              error: 'Draft ini diubah di web. Versi server dipakai; versi HP disimpan sebagai salinan konflik.',
              conflictCopyJson: r.serverCopy == null ? null : jsonEncode(r.serverCopy),
            );
          case SyncItemStatus.unsupported:
            // Item type not enabled on this server yet: keep queued, not counted as an attempt.
            deferred++;
            await outbox.defer(
              row.opUuid,
              row.attempts,
              clock.now().add(const Duration(minutes: 30)),
              code: 'UNSUPPORTED',
              message: 'Server belum menerima jenis data ini.',
            );
          case SyncItemStatus.deferred || SyncItemStatus.unknown:
            deferred++;
            await _deferOne(row, 'DEFERRED', r.errors.firstOrNull?.message);
        }
      }
    }
    Log.i('sync: applied=$applied rejected=$rejected deferred=$deferred conflict=$conflicts');
    final outcome = (rejected + deferred + conflicts) == 0 ? SyncRunOutcome.done : SyncRunOutcome.partial;
    return SyncRunResult(outcome, applied: applied, rejected: rejected, deferred: deferred, conflicts: conflicts);
  }

  Future<void> _markDraft(OutboxData row, DraftSyncState s, {String? error}) =>
      drafts.setSyncState(row.targetUuid, s, error: error);

  Future<void> _markRejected(OutboxData row, String msg, {String? code}) async {
    if (SyncItemType.isProgress(row.type)) {
      await progress?.markRejected(row.targetUuid, msg, code: code);
    } else {
      await _markDraft(row, DraftSyncState.rejected, error: msg);
    }
  }

  Future<void> _deferOne(OutboxData row, String code, String? msg) {
    final attempts = row.attempts + 1;
    return outbox.defer(
      row.opUuid,
      attempts,
      clock.now().add(backoffFor(attempts, random: _random)),
      code: code,
      message: msg,
    );
  }

  Future<void> _deferAll(List<OutboxData> rows, String code, String msg) async {
    for (final r in rows) {
      await _deferOne(r, code, msg);
    }
  }

  Future<ClockInfo> _clockInfo() async {
    final last = await db.kvGetJson(_lastServerKey);
    final boot = await clock.bootId();
    final sameBoot = last?['boot_id'] == boot;
    return ClockInfo(
      deviceTime: isoWithOffset(clock.now()),
      elapsedMs: await clock.elapsedMs(),
      bootId: boot,
      lastServerTime: sameBoot ? last!['server_time'] as String? : null,
      lastServerElapsedMs: sameBoot ? (last!['elapsed_ms'] as num?)?.toInt() : null,
    );
  }

  /// Records the (server time, elapsed) pair of the last successful online call (ADR 0010 decision 7).
  Future<void> rememberServerTime(String? serverTime) => _rememberServerTime(serverTime);

  Future<void> _rememberServerTime(String? serverTime) async {
    if (serverTime == null || DateTime.tryParse(serverTime) == null) return;
    await db.kvPut(
      _lastServerKey,
      jsonEncode({'server_time': serverTime, 'elapsed_ms': await clock.elapsedMs(), 'boot_id': await clock.bootId()}),
    );
  }
}
