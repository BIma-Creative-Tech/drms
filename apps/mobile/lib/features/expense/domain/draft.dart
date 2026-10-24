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

    /// D3: computed = qty × [unitPrice] (see [lineTotalOf]); never typed. A draft written before D3 may
    /// still carry a typed total without a unit price ([DraftLineD3.needsUnitPrice]).
    int? total,

    /// D3 "Nominal sesuai nota" (optional): what the receipt says. Approval and transfer use [total];
    /// a different value only raises the "Selisih nota" awareness flag for Finance.
    int? receiptAmount,

    /// DRMS 10/10 D4: RAP item of the draft's project this line is charged to (required to submit). Null on a
    /// line written before D4 — the editor asks to pick one.
    int? rapItemId,
    int? categoryId,
    int? vehicleId,
    String? notes,
    @Default([]) List<DraftReceipt> receipts,
  }) = _DraftLine;
}

/// DRMS 10/10 D3: line total = qty × harga satuan in whole rupiah (qty has at most 3 decimals; half a
/// rupiah rounds up). Null while qty or the unit price is missing. The server computes the official value.
int? lineTotalOf(double? qty, int? unitPrice) {
  if (qty == null || unitPrice == null || !qty.isFinite || qty <= 0 || unitPrice < 0) return null;
  final milli = BigInt.from((qty * 1000).round());
  final total = (milli * BigInt.from(unitPrice) + BigInt.from(500)) ~/ BigInt.from(1000);
  return total.isValidInt ? total.toInt() : null;
}

/// "Nominal sesuai nota" differs from the computed line total (D3 awareness flag "Selisih nota").
bool receiptAmountDiffers(int? receiptAmount, int? total) =>
    receiptAmount != null && total != null && receiptAmount != total;

extension DraftLineD3 on DraftLine {
  /// qty × harga satuan (null while one of them is missing).
  int? get computedTotal => lineTotalOf(qty, unitPrice);

  /// A line saved before D3 (typed total, no unit price): the editor asks to fill qty and harga satuan.
  bool get needsUnitPrice => unitPrice == null;

  bool get receiptMismatch => receiptAmountDiffers(receiptAmount, computedTotal ?? total);

  /// D4: no RAP item chosen yet (a line written before D4, or the project changed) — submit is blocked.
  bool get needsRapItem => rapItemId == null;
}

@freezed
abstract class DraftRequest with _$DraftRequest {
  const DraftRequest._();
  const factory DraftRequest({
    required String clientUuid,
    required RequestType type,

    /// MC3: PT of the draft (chosen when it is created; projects / cost centers / accounts come from that
    /// PT's masters). Null = draft written before the multi-PT update, not yet assigned.
    int? companyId,
    @Default('') String title,

    /// D2 (DRMS 10/10): required — every request belongs to a project (no non-project requests).
    int? projectId,

    /// D2: no longer chosen by the requester (Finance sets the cost center at transfer). Kept only for drafts
    /// written before D2; never sent to the server any more.
    int? costCenterId,
    String? neededDate,

    /// Owner decision 2026-10-09: "Tingkat urgensi" (`urgency-levels` master of the draft's PT).
    int? urgencyLevelId,
    String? notes,
    @Default([]) List<int> requesterIds,
    int? bankAccountId,

    /// ADR 0027 "Jenis penerima": vendor = "Pembayaran vendor" (Staff / Finance / PM; type is always Pengajuan Baru,
    /// no employee account, no LPJ). ADR 0028: ptGrup = "Pembayaran antar-PT" (Finance / PM / Direktur; same shape,
    /// the receiving PT instead of vendor + account). Stored in `local_drafts.vendor_json` (schema v10, the payee JSON).
    @Default(PayeeType.karyawan) PayeeType payeeType,
    int? vendorId,
    int? vendorBankAccountId,

    /// ADR 0028: the receiving PT (`payeeCompanyId`, payee directory / masters `intercompany-payees`).
    int? payeeCompanyId,

    /// Invoice of a vendor payment (ADR 0027) / the receiving PT's document — tagihan / memo — of a PT grup payment
    /// (ADR 0028, owner 2026-10-14: number, date and file required; due date optional).
    String? invoiceNo,
    String? invoiceDate, // YYYY-MM-DD
    String? invoiceDueDate, // YYYY-MM-DD
    /// Local invoice photo (`media_blobs` kind `invoice`) until it is on the server.
    String? invoiceMediaUuid,

    /// Server media id of the invoice (`media-attachments`): imported from the server or uploaded by the sync.
    int? invoiceFileId,
    // D2410 (point 6): general attachments ("Lampiran", photo / PDF) — optional for Pengajuan Baru, at least one for a
    // Reimburse ([maxDraftAttachments] at most). Stored in `local_drafts.vendor_json` (no drift schema change).
    @Default([]) List<DraftAttachment> attachments,
    @Default([]) List<DraftLine> lines,
    int? serverId,
    int? serverRev,
    @Default(DraftSyncState.local) DraftSyncState syncState,
    String? lastError,
    DateTime? updatedAt,
  }) = _DraftRequest;

  /// Preview only — the server computes the official grand total (US-03, US-37).
  int get previewGrandTotal => lines.fold(0, (sum, l) => sum + (l.computedTotal ?? l.total ?? 0));

  int get receiptCount => lines.fold(0, (n, l) => n + l.receipts.length);

  /// ADR 0027: a vendor payment ("Pembayaran vendor").
  bool get isVendor => payeeType == PayeeType.vendor;

  /// ADR 0028: a payment to another PT of the group ("Pembayaran antar-PT").
  bool get isPtGrup => payeeType == PayeeType.ptGrup;

  /// ADR 0027 / 0028: vendor or PT grup — Pengajuan Baru, Pemohon = the filer, no employee account, project or cost
  /// center, invoice / document as the proof, no receipts and no LPJ.
  bool get isDirectPayment => payeeType.isDirect;

  /// ADR 0027 / 0028: the invoice / document file is attached (local photo or already on the server).
  bool get hasInvoiceFile => invoiceFileId != null || invoiceMediaUuid != null;

  /// Local photos of this draft (server receipts of an imported draft have no local photo; ADR 0027 / 0028: + the
  /// invoice / document photo).
  Iterable<String> get mediaUuids => [
    ...lines.expand((l) => l.receipts).where((r) => !r.isServerReceipt).map((r) => r.mediaUuid),
    if (isDirectPayment && invoiceFileId == null && invoiceMediaUuid != null) invoiceMediaUuid!,
    ...attachments.where((a) => a.isLocal).map((a) => a.mediaUuid!),
  ];
}

/// D2410 (point 6): file types of a general attachment (`media-attachments`: JPG / PNG photo or PDF).
const attachmentMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'];

/// Server `DraftInput.attachmentIds` maximum.
const maxDraftAttachments = 20;

/// `media-attachments` PDF limit (5 MB); photos are compressed on the phone like a receipt photo.
const maxAttachmentPdfBytes = 5 * 1024 * 1024;

/// D2410 (point 6): type of a picked file by its name (JPG / PNG / PDF); null = not allowed.
String? attachmentMimeOf(String fileName) => switch (fileName.split('.').last.toLowerCase()) {
  'jpg' || 'jpeg' => 'image/jpeg',
  'png' => 'image/png',
  'pdf' => 'application/pdf',
  _ => null,
};

/// A PDF starts with `%PDF-` (the server refuses anything else).
bool isPdfFile(List<int> bytes) => bytes.length >= 5 && String.fromCharCodes(bytes.take(5)) == '%PDF-';

/// D2410 (point 6): one general attachment ("Lampiran") of a draft — a photo / PDF picked on the phone ([mediaUuid]:
/// `media_blobs` kind `attachment`, uploaded to `POST /media/attachments` by the sync or at "Ajukan") or a file already
/// on the server ([serverFileId]: uploaded, or imported from a server draft).
class DraftAttachment {
  const DraftAttachment({required this.fileName, required this.mimeType, this.mediaUuid, this.serverFileId});

  final String fileName;
  final String mimeType;
  final String? mediaUuid;
  final int? serverFileId;

  /// Still only on the phone (the upload replaces it by [serverFileId]).
  bool get isLocal => serverFileId == null && mediaUuid != null;

  bool get isPdf => mimeType == 'application/pdf';

  DraftAttachment uploaded(int id) =>
      DraftAttachment(fileName: fileName, mimeType: mimeType, mediaUuid: mediaUuid, serverFileId: id);

  Map<String, Object?> toJson() => {
    'fileName': fileName,
    'mimeType': mimeType,
    'mediaUuid': mediaUuid,
    'serverFileId': serverFileId,
  };

  /// null = unreadable entry (skipped).
  static DraftAttachment? fromJson(Object? j) {
    if (j is! Map<String, dynamic>) return null;
    final media = j['mediaUuid'];
    final server = j['serverFileId'];
    if (media is! String && server is! num) return null;
    return DraftAttachment(
      fileName: j['fileName'] is String ? j['fileName'] as String : 'lampiran',
      mimeType: j['mimeType'] is String ? j['mimeType'] as String : 'image/jpeg',
      mediaUuid: media is String ? media : null,
      serverFileId: server is num ? server.toInt() : null,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is DraftAttachment &&
      other.fileName == fileName &&
      other.mimeType == mimeType &&
      other.mediaUuid == mediaUuid &&
      other.serverFileId == serverFileId;

  @override
  int get hashCode => Object.hash(fileName, mimeType, mediaUuid, serverFileId);
}
