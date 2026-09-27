import 'package:uuid/uuid.dart';

import '../../../core/format/dates.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/time/device_clock.dart';
import '../../../core/util/async_lock.dart';
import '../../sync/data/outbox_repository.dart';
import '../data/draft_repository.dart';
import '../data/expense_api.dart';
import '../data/expense_mappers.dart';
import '../domain/draft.dart';
import '../domain/draft_validation.dart';
import '../domain/request_status.dart';
import '../domain/expense_request.dart';

class DraftValidationException implements Exception {
  const DraftValidationException(this.issues);
  final List<DraftIssue> issues;
  String get message => issues.map((e) => e.toString()).join('\n');
}

/// Draft use-cases: save locally + queue for offline sync (works without signal), and the online-only
/// "Ajukan" (submit) which needs the server state machine (ADR 0010 decision 5).
class DraftService {
  DraftService({
    required this.drafts,
    required this.outbox,
    required this.api,
    required this.clock,
    required this.lock,
  });

  final DraftRepository drafts;
  final OutboxRepository outbox;
  final ExpenseApi api;
  final DeviceClock clock;
  final AsyncLock lock;

  static const _uuid = Uuid();

  DraftRequest newDraft(RequestType type, {List<int> requesterIds = const []}) =>
      DraftRequest(clientUuid: _uuid.v7(), type: type, requesterIds: requesterIds);

  DraftLine newLine(int no) => DraftLine(clientUuid: _uuid.v7(), no: no);

  String newId() => _uuid.v7();

  /// Stores the draft in the encrypted DB and queues `expense_request.draft_upsert`.
  Future<DraftRequest> save(
    String sub,
    DraftRequest draft, {
    required bool online,
    String timezone = 'Asia/Makassar',
  }) async {
    final issues = validateForSave(draft);
    if (issues.isNotEmpty) throw DraftValidationException(issues);
    final lines = renumber(draft.lines);
    final toSave = draft.copyWith(lines: lines, syncState: DraftSyncState.queued, lastError: null);
    await lock.run(() async {
      await drafts.save(sub, toSave);
      await outbox.enqueueDraftUpsert(
        sub: sub,
        draftUuid: toSave.clientUuid,
        payload: (includeId) => draftToSyncPayload(toSave, includeDraftId: includeId),
        dependsOn: toSave.mediaUuids.toList(),
        deviceTime: isoWithOffset(clock.now()),
        elapsedMs: await clock.elapsedMs(),
        bootId: await clock.bootId(),
        offline: !online,
        baseRev: toSave.serverRev,
      );
    });
    return toSave;
  }

  /// Removes the draft locally; when the server already knows it, queues `draft_delete` (the
  /// server cancels it — no hard delete, requirements §1.2 #6).
  Future<void> delete(String sub, DraftRequest d, {required bool online}) async {
    await lock.run(() async {
      final knownToServer = d.serverId != null || await outbox.wasApplied(sub, d.clientUuid);
      await outbox.supersede(sub, d.clientUuid);
      if (knownToServer) {
        await outbox.enqueueDraftDelete(
          sub: sub,
          draftUuid: d.clientUuid,
          payload: draftDeletePayload(d),
          deviceTime: isoWithOffset(clock.now()),
          elapsedMs: await clock.elapsedMs(),
          bootId: await clock.bootId(),
          offline: !online,
        );
      }
      await drafts.softDelete(sub, d.clientUuid);
    });
  }

  /// Opens a SERVER Draft in the offline editor (E3-d: after "Tarik kembali" or "Ajukan ulang", US-04/06).
  /// The server copy is authoritative: the local draft is (re)built from it, keeps the server id and
  /// `rev` (so the next offline edit is an ordinary `draft_upsert` with `base_rev`), and pending queue
  /// items of an older local copy are superseded. Receipts stay on the server (read-only on the phone).
  Future<DraftRequest> importServerDraft(String sub, ExpenseDetail detail) async {
    if (detail.status != RequestStatus.draft) {
      throw const ProblemException(status: 409, detail: 'Pengajuan ini bukan draft lagi. Muat ulang.');
    }
    final own = detail.clientUuid;
    final uuid = own != null && isUuid(own) ? own : _uuid.v7();
    final draft = draftFromServer(
      detail,
      clientUuid: uuid,
      receiptUuid: (id) => _uuid.v5(Namespace.url.value, 'pk-server-receipt:${detail.id}:$id'),
    );
    return lock.run(() async {
      await outbox.supersede(sub, uuid);
      await drafts.save(sub, draft);
      return draft;
    });
  }

  /// "Ajukan" — online only. Creates the server draft through `/api/v1` (idempotent by clientUuid)
  /// when the offline queue has not delivered it yet, uploads the receipts, then submits.
  Future<ExpenseDetail> submit(String sub, DraftRequest draft) async {
    final issues = validateForSubmit(draft);
    if (issues.isNotEmpty) throw DraftValidationException(issues);
    return lock.run(() async {
      final pending = await outbox.pendingForTarget(sub, draft.clientUuid);
      ExpenseDetail detail;
      if (draft.serverId != null && pending == null) {
        detail = await api.detail(draft.serverId!);
      } else if (draft.serverId != null && pending != null) {
        throw const ProblemException(
          status: 409,
          detail: 'Perubahan draft masih menunggu sinkron. Tekan "Kirim sekarang" lalu coba Ajukan lagi.',
        );
      } else {
        detail = await api.create(draftToCreateBody(draft), idempotencyKey: draft.clientUuid);
        await drafts.setSyncState(draft.clientUuid, DraftSyncState.synced, serverId: detail.id);
        await outbox.supersede(sub, draft.clientUuid);
      }

      final localReceipts = draft.lines.expand((l) => l.receipts).toList();
      final serverHasReceipts = detail.receipts.where((r) => r.status != 'removed').length >= localReceipts.length;
      if (!serverHasReceipts) {
        for (final line in draft.lines) {
          final serverLine = detail.lines.where((l) => l.no == line.no).firstOrNull;
          if (serverLine == null) continue;
          for (final r in line.receipts) {
            if (r.serverReceiptId != null) continue;
            final blob = await drafts.media(r.mediaUuid);
            if (blob == null) {
              throw const ProblemException(
                status: 422,
                detail: 'Foto nota tidak ditemukan di HP. Ambil ulang foto nota.',
              );
            }
            final imageId = await api.uploadMedia('receipts', blob.bytes, filename: '${r.mediaUuid}.jpg');
            detail = await api.addReceipt(detail.id, {
              'lineId': serverLine.id,
              'receiptNo': (r.receiptNo == null || r.receiptNo!.trim().isEmpty) ? null : r.receiptNo!.trim(),
              'vendorName': r.vendorName.trim(),
              'receiptDate': r.receiptDate,
              'receiptTime': r.receiptTime,
              'amount': r.amount,
              'imageId': imageId,
            }, idempotencyKey: r.clientUuid);
            final created = detail.receipts.where((x) => x.imageId == imageId).firstOrNull;
            if (created != null) await drafts.setServerReceiptId(r.clientUuid, created.id);
          }
        }
      }

      final submitted = await api.submit(
        detail.id,
        idempotencyKey: _uuid.v5(Namespace.url.value, 'pk-submit:${draft.clientUuid}'),
      );
      await drafts.setSyncState(draft.clientUuid, DraftSyncState.submitted, serverId: submitted.id, clearError: true);
      await outbox.supersede(sub, draft.clientUuid);
      await drafts.purgeMediaOf(draft);
      return submitted;
    });
  }
}
