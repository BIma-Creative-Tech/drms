import 'dart:convert';

import 'package:drift/drift.dart';

import '../../../core/db/app_database.dart';
import '../domain/draft.dart';
import '../domain/request_status.dart';

class QueueFullException implements Exception {
  const QueueFullException();
  String get message => 'Penyimpanan offline penuh (100 MB). Kirim data yang tertunda dulu.';
}

/// Local drafts + photos in the encrypted DB, always scoped to one Keycloak `sub`.
class DraftRepository {
  DraftRepository(this.db);
  final AppDatabase db;

  /// ADR 0010 decision 4: queue budget 100 MB, warning at 80 %.
  static const maxQueueBytes = 100 * 1024 * 1024;
  static const warnQueueBytes = 80 * 1024 * 1024;

  Stream<List<DraftRequest>> watchOpenDrafts(String sub) {
    final q = db.select(db.localDrafts)
      ..where((t) => t.userSub.equals(sub) & t.deleted.equals(false) & t.syncState.isNotValue('submitted'))
      ..orderBy([(t) => OrderingTerm.desc(t.updatedAt)]);
    return q.watch().asyncMap((rows) => Future.wait(rows.map(_assemble)));
  }

  Future<DraftRequest?> load(String sub, String uuid) async {
    final row = await (db.select(
      db.localDrafts,
    )..where((t) => t.clientUuid.equals(uuid) & t.userSub.equals(sub))).getSingleOrNull();
    return row == null ? null : _assemble(row);
  }

  Future<DraftRequest> _assemble(LocalDraft row) async {
    final lines =
        await (db.select(db.localLines)
              ..where((t) => t.draftUuid.equals(row.clientUuid))
              ..orderBy([(t) => OrderingTerm.asc(t.no)]))
            .get();
    final receipts = await (db.select(db.localReceipts)..where((t) => t.draftUuid.equals(row.clientUuid))).get();
    return DraftRequest(
      clientUuid: row.clientUuid,
      type: RequestType.fromCode(row.type),
      title: row.title,
      projectId: row.projectId,
      costCenterId: row.costCenterId,
      neededDate: row.neededDate,
      notes: row.notes,
      requesterIds: (jsonDecode(row.requesterIdsJson) as List<dynamic>).map((e) => (e as num).toInt()).toList(),
      bankAccountId: row.bankAccountId,
      serverId: row.serverId,
      serverRev: row.serverRev,
      syncState: DraftSyncState.fromCode(row.syncState),
      lastError: row.lastError,
      updatedAt: row.updatedAt,
      lines: [
        for (final l in lines)
          DraftLine(
            clientUuid: l.clientUuid,
            no: l.no,
            description: l.description,
            qty: l.qty,
            uomId: l.uomId,
            unitPrice: l.unitPrice,
            total: l.total,
            categoryId: l.categoryId,
            vehicleId: l.vehicleId,
            notes: l.notes,
            receipts: [
              for (final r in receipts.where((r) => r.lineUuid == l.clientUuid))
                DraftReceipt(
                  clientUuid: r.clientUuid,
                  receiptNo: r.receiptNo,
                  vendorName: r.vendorName,
                  receiptDate: r.receiptDate,
                  receiptTime: r.receiptTime,
                  amount: r.amount,
                  mediaUuid: r.mediaUuid,
                  serverReceiptId: r.serverReceiptId,
                ),
            ],
          ),
      ],
    );
  }

  /// Replaces header, lines and receipts of the draft in one transaction; photos no longer
  /// referenced by any receipt of this user are removed.
  Future<void> save(String sub, DraftRequest d, {DateTime? now}) => db.transaction(() async {
    final ts = now ?? DateTime.now();
    final existing = await (db.select(
      db.localDrafts,
    )..where((t) => t.clientUuid.equals(d.clientUuid))).getSingleOrNull();
    if (existing != null && existing.userSub != sub) {
      throw StateError('Draft milik pengguna lain');
    }
    await db
        .into(db.localDrafts)
        .insertOnConflictUpdate(
          LocalDraftsCompanion.insert(
            clientUuid: d.clientUuid,
            userSub: sub,
            type: d.type.code,
            title: Value(d.title),
            projectId: Value(d.projectId),
            costCenterId: Value(d.costCenterId),
            neededDate: Value(d.neededDate),
            notes: Value(d.notes),
            requesterIdsJson: Value(jsonEncode(d.requesterIds)),
            bankAccountId: Value(d.bankAccountId),
            serverId: Value(d.serverId),
            serverRev: Value(d.serverRev),
            syncState: Value(d.syncState.name),
            lastError: Value(d.lastError),
            // Saving always means "open draft" (re-importing a server draft revives a deleted local copy).
            deleted: const Value(false),
            createdAt: existing?.createdAt ?? ts,
            updatedAt: ts,
          ),
        );
    await (db.delete(db.localReceipts)..where((t) => t.draftUuid.equals(d.clientUuid))).go();
    await (db.delete(db.localLines)..where((t) => t.draftUuid.equals(d.clientUuid))).go();
    for (final l in d.lines) {
      await db
          .into(db.localLines)
          .insert(
            LocalLinesCompanion.insert(
              clientUuid: l.clientUuid,
              draftUuid: d.clientUuid,
              no: l.no,
              description: Value(l.description),
              qty: Value(l.qty),
              uomId: Value(l.uomId),
              unitPrice: Value(l.unitPrice),
              total: Value(l.total),
              categoryId: Value(l.categoryId),
              vehicleId: Value(l.vehicleId),
              notes: Value(l.notes),
            ),
          );
      for (final r in l.receipts) {
        await db
            .into(db.localReceipts)
            .insert(
              LocalReceiptsCompanion.insert(
                clientUuid: r.clientUuid,
                lineUuid: l.clientUuid,
                draftUuid: d.clientUuid,
                receiptNo: Value(r.receiptNo),
                vendorName: Value(r.vendorName),
                receiptDate: r.receiptDate,
                receiptTime: Value(r.receiptTime),
                amount: r.amount,
                mediaUuid: r.mediaUuid,
                serverReceiptId: Value(r.serverReceiptId),
              ),
            );
      }
    }
    await _dropOrphanMedia(sub);
  });

  Future<void> _dropOrphanMedia(String sub) async {
    await db.customStatement(
      // Only receipt photos: selfies and progress photos have their own owners (outbox / progress reports).
      "DELETE FROM media_blobs WHERE user_sub = ? AND kind = 'receipt' "
      'AND client_uuid NOT IN (SELECT media_uuid FROM local_receipts)',
      [sub],
    );
  }

  Future<void> setSyncState(
    String uuid,
    DraftSyncState state, {
    int? serverId,
    int? serverRev,
    String? error,
    String? conflictCopyJson,
    bool clearError = false,
  }) => (db.update(db.localDrafts)..where((t) => t.clientUuid.equals(uuid))).write(
    LocalDraftsCompanion(
      syncState: Value(state.name),
      serverId: serverId == null ? const Value.absent() : Value(serverId),
      serverRev: serverRev == null ? const Value.absent() : Value(serverRev),
      lastError: clearError ? const Value(null) : (error == null ? const Value.absent() : Value(error)),
      conflictCopyJson: conflictCopyJson == null ? const Value.absent() : Value(conflictCopyJson),
    ),
  );

  Future<void> setServerReceiptId(String receiptUuid, int id) => (db.update(
    db.localReceipts,
  )..where((t) => t.clientUuid.equals(receiptUuid))).write(LocalReceiptsCompanion(serverReceiptId: Value(id)));

  Future<void> softDelete(String sub, String uuid) =>
      (db.update(db.localDrafts)..where((t) => t.clientUuid.equals(uuid) & t.userSub.equals(sub))).write(
        const LocalDraftsCompanion(deleted: Value(true)),
      );

  // --- photos -------------------------------------------------------------------------------

  Future<int> queueBytes(String sub) async {
    final sum = db.mediaBlobs.sizeBytes.sum();
    final q = db.selectOnly(db.mediaBlobs)
      ..addColumns([sum])
      ..where(db.mediaBlobs.userSub.equals(sub) & db.mediaBlobs.uploaded.equals(false));
    return (await q.getSingle()).read(sum) ?? 0;
  }

  Future<void> addMedia(
    String sub, {
    required String uuid,
    required String kind,
    required Uint8List bytes,
    required String sha256,
    String mime = 'image/jpeg',
  }) async {
    if (await queueBytes(sub) + bytes.length > maxQueueBytes) throw const QueueFullException();
    await db
        .into(db.mediaBlobs)
        .insertOnConflictUpdate(
          MediaBlobsCompanion.insert(
            clientUuid: uuid,
            userSub: sub,
            kind: kind,
            mimeType: Value(mime),
            bytes: bytes,
            sha256: sha256,
            sizeBytes: bytes.length,
            createdAt: DateTime.now(),
          ),
        );
  }

  Future<MediaBlob?> media(String uuid) =>
      (db.select(db.mediaBlobs)..where((t) => t.clientUuid.equals(uuid))).getSingleOrNull();

  Future<void> markMediaUploaded(String uuid, {String? serverMediaId}) =>
      (db.update(db.mediaBlobs)..where((t) => t.clientUuid.equals(uuid))).write(
        MediaBlobsCompanion(
          uploaded: const Value(true),
          serverMediaId: serverMediaId == null ? const Value.absent() : Value(serverMediaId),
        ),
      );

  /// After a successful online submit the photos are on the server; free the local copies.
  Future<void> purgeMediaOf(DraftRequest d) async {
    final ids = d.mediaUuids.toList();
    if (ids.isEmpty) return;
    await (db.delete(db.mediaBlobs)..where((t) => t.clientUuid.isIn(ids))).go();
  }
}
