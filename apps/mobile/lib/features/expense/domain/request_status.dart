/// DRMS 10/10 D1 (owner 2026-10-11): `advance` is shown as "Pengajuan Baru" (was "Uang Muka"); the code is unchanged.
enum RequestType {
  advance('advance', 'Pengajuan Baru'),
  reimburse('reimburse', 'Reimburse');

  const RequestType(this.code, this.label);
  final String code;
  final String label;

  static RequestType fromCode(String? c) => c == 'advance' ? advance : reimburse;
}

/// ADR 0025 (DRMS 13/10 Wave 4) "Jenis penerima": `karyawan` (default, the requester's account) or `vendor` =
/// "Pembayaran vendor" (Finance / PM only: vendor + vendor account + invoice, always Pengajuan Baru, no LPJ).
enum PayeeType {
  karyawan('karyawan', 'Karyawan'),
  vendor('vendor', 'Vendor');

  const PayeeType(this.code, this.label);
  final String code;
  final String label;

  static PayeeType fromCode(String? c) => c == 'vendor' ? vendor : karyawan;
}

/// ADR 0025: kind label of a vendor payment (server `typeLabel`; fallback).
const vendorPaymentLabel = 'Pembayaran vendor';

/// Status codes of openapi `RequestStatus`; labels are a fallback — the server's `statusLabel` wins.
/// Same wording as the web (`apps/web/src/domain/expense/types.ts` STATUS_LABELS, ADR 0021).
enum RequestStatus {
  draft('draft', 'Draft'),
  pendingAck('pending_ack', 'Menunggu persetujuan PM'),
  pendingApproval('pending_approval', 'Menunggu persetujuan Direktur'),
  approved('approved', 'Disetujui'),
  receiptRevision('receipt_revision', 'Revisi Nota'),
  receiptsVerified('receipts_verified', 'Nota Terverifikasi (Antri Transfer)'),
  transferred('transferred', 'Ditransfer'),
  receiptsComplete('receipts_complete', 'Nota Lengkap'),
  lpjSubmitted('lpj_submitted', 'LPJ Diajukan'),
  lpjRevision('lpj_revision', 'LPJ Revisi'),
  lpjVerified('lpj_verified', 'LPJ Terverifikasi'),
  completed('completed', 'Selesai'),
  rejected('rejected', 'Ditolak'),
  cancelled('cancelled', 'Dibatalkan'),
  unknown('unknown', 'Tidak diketahui');

  const RequestStatus(this.code, this.label);
  final String code;
  final String label;

  static RequestStatus fromCode(String? c) {
    for (final s in RequestStatus.values) {
      if (s.code == c) return s;
    }
    return unknown;
  }

  bool get isFinal => this == completed || this == rejected || this == cancelled;
  bool get waitsForDecision => this == pendingAck || this == pendingApproval;
}

/// ADR 0024: "Disetujui" of a Direktur's own request without approval (web `NO_APPROVAL_STATUS_LABELS`).
const noApprovalStatusLabels = {
  RequestType.advance: 'Tanpa persetujuan (Antri Transfer)',
  RequestType.reimburse: 'Tanpa persetujuan (Verifikasi Nota)',
};

/// Fallback status label when the server's `statusLabel` is missing (the server label wins).
String statusLabelFallback(RequestType type, RequestStatus status, {bool noApproval = false}) =>
    noApproval && status == RequestStatus.approved ? noApprovalStatusLabels[type]! : status.label;
