import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:drift/drift.dart' show Value;
import 'package:uuid/uuid.dart';

import '../../../core/db/app_database.dart';
import '../../../core/format/dates.dart';
import '../../../core/logging/log.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/time/device_clock.dart';
import '../../../core/util/async_lock.dart';
import '../../companies/data/company_backfill.dart';
import '../../expense/data/draft_repository.dart';
import '../../expense/data/expense_mappers.dart';
import '../../expense/domain/draft.dart';
import '../../progress/data/progress_repository.dart';
import '../data/outbox_repository.dart';
import '../data/sync_api.dart';
import '../domain/sync_models.dart';

enum SyncRunOutcome { nothingToDo, offline, done, partial, serverUnsupported, notLoggedIn }

class SyncRunResult {
  const SyncRunResult(
    this.outcome, {
    this.applied = 0,
    this.rejected = 0,
    this.deferred = 0,
    this.conflicts = 0,
    this.needsCompany = 0,
  });
  final SyncRunOutcome outcome;
  final int applied;
  final int rejected;
  final int deferred;
  final int conflicts;

  /// MC3: items held because they have no PT yet and the user has several PTs (never sent, never guessed).
  final int needsCompany;
}

/// Sends the offline outbox: receipt photos first (`POST /media/receipts` → `media_id`), then JSON items in batches
/// (`POST /sync/batch`), and applies the per-item result rules of ADR 0010:
/// applied/duplicate → done; rejected → never retried, message shown; deferred → back-off;
/// conflict → server wins, local version kept as "Salinan konflik".
///
/// MC3 (ADR 0016 §8, ADR 0010 MC revision): every item carries `company_id` = the PT stored on ITS row
/// (never the PT switcher selection); batches are grouped per PT and sent without `X-Company-Ids` (the
/// server processes each item under its own `company_id`). Rows queued before schema v3 (no PT) get the
/// user's only PT, or are held until the user picks one (several PTs). `COMPANY_MISMATCH` /
/// `COMPANY_NOT_ALLOWED` are final rejections; a batch 409 `COMPANY_REQUIRED` holds the PT-less items.
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
    this.memberships,
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

  /// PT ids of the account (default: the cached `/me`); null = unknown / server before MC3.
  final Future<List<int>?> Function(String sub)? memberships;

  static const _lastServerKey = 'sync:last_server';
  static String _companyRequiredKey(String sub) => 'sync:company_required:$sub';

  Future<SyncRunResult> run(String? sub) {
    if (sub == null) return Future.value(const SyncRunResult(SyncRunOutcome.notLoggedIn));
    return lock.run(() => _run(sub));
  }

  Future<SyncRunResult> _run(String sub) async {
    final now = clock.now();
    final queued = await outbox.due(sub, now);
    if (queued.isEmpty) return const SyncRunResult(SyncRunOutcome.nothingToDo);

    // 0) MC3: the PT of every item. Legacy rows (queued before schema v3) have none.
    final (due, held) = await _withCompanies(sub, queued);
    if (due.isEmpty) return SyncRunResult(SyncRunOutcome.partial, needsCompany: held);

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
    if (ready.isEmpty) return SyncRunResult(SyncRunOutcome.partial, needsCompany: held);

    // 2) batches, one PT per batch (queue order kept inside each PT; a draft's operations share its PT)
    final byCompany = <int?, List<QueuedItem>>{};
    for (final r in ready) {
      byCompany.putIfAbsent(r.companyId, () => []).add(OutboxRepository.toQueued(r, payloads[r.opUuid]!));
    }
    final batches = <List<QueuedItem>>[];
    for (final group in byCompany.values) {
      final plan = planBatches(group);
      batches.addAll(plan.batches);
      for (final o in plan.oversized) {
        await outbox.setStatus(
          o.clientUuid,
          'rejected',
          code: 'TOO_LARGE',
          message: 'Data terlalu besar untuk dikirim.',
        );
      }
    }
    var applied = 0, rejected = 0, deferred = 0, conflicts = 0, needsCompany = held;
    final byUuid = {for (final r in ready) r.opUuid: r};
    for (final batch in batches) {
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
          needsCompany: needsCompany,
        );
      } on ProblemException catch (e) {
        final rows = [for (final q in batch) byUuid[q.clientUuid]!];
        if (e.status == 409 && e.code == companyRequiredCode) {
          // Nothing of this batch was processed: the account has several PTs and some item had no PT.
          // Those wait for the user's choice; the others go again in the next run.
          await db.kvPut(_companyRequiredKey(sub), '1');
          for (final r in rows.where((r) => r.companyId == null)) {
            await outbox.holdForCompany(r.opUuid, companyRequiredMessage);
            needsCompany++;
          }
          continue;
        }
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
    Log.i(
      'sync: applied=$applied rejected=$rejected deferred=$deferred conflict=$conflicts needsCompany=$needsCompany',
    );
    final outcome = (rejected + deferred + conflicts + needsCompany) == 0
        ? SyncRunOutcome.done
        : SyncRunOutcome.partial;
    return SyncRunResult(
      outcome,
      applied: applied,
      rejected: rejected,
      deferred: deferred,
      conflicts: conflicts,
      needsCompany: needsCompany,
    );
  }

  /// Items that may be sent now + the number held for a PT choice. An item without PT is
  /// - given the account's ONLY PT (stored on the item, its draft / report and every other PT-less row),
  /// - held when the account has several PTs (or the server answered 409 `COMPANY_REQUIRED` before),
  /// - sent without `company_id` only when no PT is known at all (server before MC3: nothing to choose).
  Future<(List<OutboxData>, int)> _withCompanies(String sub, List<OutboxData> due) async {
    if (due.every((r) => r.companyId != null)) return (due, 0);
    final ids = await (memberships ?? (s) => cachedMembershipIds(db, s))(sub);
    if (ids != null && ids.length == 1) {
      final only = ids.single;
      await CompanyBackfill(db).assignAll(sub, only);
      return ([for (final r in due) r.companyId == null ? r.copyWith(companyId: Value(only)) : r], 0);
    }
    final mustChoose = (ids != null && ids.length > 1) || await db.kvGet(_companyRequiredKey(sub)) == '1';
    if (!mustChoose) return (due, 0);
    final out = <OutboxData>[];
    var held = 0;
    for (final r in due) {
      if (r.companyId != null) {
        out.add(r);
      } else {
        held++;
        await outbox.holdForCompany(r.opUuid, companyRequiredMessage);
      }
    }
    return (out, held);
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
