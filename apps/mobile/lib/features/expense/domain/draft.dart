import 'package:freezed_annotation/freezed_annotation.dart';

import 'request_status.dart';

part 'draft.freezed.dart';

/// Where a local draft stands relative to the server.
enum DraftSyncState {
  local, // only on this phone, nothing queued
  queued, // waiting in the offline queue
  synced, // server has this version (serverId known)
  conflict, // edited on the web meanwhile — server copy won, local "Salinan konflik" kept
  rejected, // server refused the draft (message in lastError)
  submitted; // submitted online ("Ajukan") — read from the server from now on

  static DraftSyncState fromCode(String c) =>
      DraftSyncState.values.firstWhere((s) => s.name == c, orElse: () => DraftSyncState.local);
}

@freezed
abstract class DraftReceipt with _$DraftReceipt {
  const factory DraftReceipt({
    required String clientUuid,
    String? receiptNo,
    required String vendorName,
    required String receiptDate, // YYYY-MM-DD
    String? receiptTime, // HH:mm
    required int amount,
    required String mediaUuid,
    int? serverReceiptId,
  }) = _DraftReceipt;
}

/// Placeholder `mediaUuid` of a receipt imported from a server draft (E3-d): the photo is already on
/// the server, nothing is stored or uploaded from the phone.
const serverMediaPrefix = 'server:';

extension DraftReceiptServer on DraftReceipt {
  /// Imported from the server (withdrawn / re-submitted draft): read-only on the phone, never re-sent in
  /// `draft_upsert` (the server keeps receipts that are missing from the payload).
  bool get isServerReceipt => mediaUuid.startsWith(serverMediaPrefix);
}

@freezed
abstract class DraftLine with _$DraftLine {
  const factory DraftLine({
    required String clientUuid,
    required int no,
    @Default('') String description,
    double? qty,
    int? uomId,
    int? unitPrice,
    int? total,
    int? categoryId,
    int? vehicleId,
    String? notes,
    @Default([]) List<DraftReceipt> receipts,
  }) = _DraftLine;
}

@freezed
abstract class DraftRequest with _$DraftRequest {
  const DraftRequest._();
  const factory DraftRequest({
    required String clientUuid,
    required RequestType type,
    @Default('') String title,
    int? projectId,
    int? costCenterId,
    String? neededDate,
    String? notes,
    @Default([]) List<int> requesterIds,
    int? bankAccountId,
    @Default([]) List<DraftLine> lines,
    int? serverId,
    int? serverRev,
    @Default(DraftSyncState.local) DraftSyncState syncState,
    String? lastError,
    DateTime? updatedAt,
  }) = _DraftRequest;

  /// Preview only — the server computes the official grand total (US-03, US-37).
  int get previewGrandTotal => lines.fold(0, (sum, l) => sum + (l.total ?? 0));

  int get receiptCount => lines.fold(0, (n, l) => n + l.receipts.length);

  /// Local photos of this draft (server receipts of an imported draft have no local photo).
  Iterable<String> get mediaUuids =>
      lines.expand((l) => l.receipts).where((r) => !r.isServerReceipt).map((r) => r.mediaUuid);
}
