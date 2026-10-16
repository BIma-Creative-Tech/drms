/// DRMS 10/10 D1 (owner 2026-10-11): `advance` is shown as "Pengajuan Baru" (was "Uang Muka"); the code is unchanged.
enum RequestType {
  advance('advance', 'Pengajuan Baru'),
  reimburse('reimburse', 'Reimburse');

  const RequestType(this.code, this.label);
  final String code;
  final String label;

  static RequestType fromCode(String? c) => c == 'advance' ? advance : reimburse;
}

/// ADR 0027 (DRMS 13/10 Wave 4) "Jenis penerima": `karyawan` (default, the requester's account) or `vendor` =
/// "Pembayaran vendor" (Staff / Finance / PM: vendor + vendor account + invoice, always Pengajuan Baru, no LPJ).
/// ADR 0028 (DRMS 13/10 Phase B): `pt_grup` = "Pembayaran antar-PT" (Finance / PM / Direktur of the paying PT: another
/// PT of the group, paid to its designated receiving account + the receiving PT's document; always Pengajuan Baru, no
/// LPJ; the transfer also posts a Kas Masuk in the receiving PT).
enum PayeeType {
  karyawan('karyawan', 'Karyawan'),
  vendor('vendor', 'Vendor'),
  ptGrup('pt_grup', 'PT grup');

  const PayeeType(this.code, this.label);
  final String code;
  final String label;

  /// Unknown / missing codes read as `karyawan` (servers before Wave 4).
  static PayeeType fromCode(String? c) => switch (c) {
    'vendor' => vendor,
    'pt_grup' => ptGrup,
    _ => karyawan,
  };

  /// ADR 0027 / 0028: paid straight to a vendor or another PT — always Pengajuan Baru, Pemohon = the filer, no employee
  /// account, project OR cost center, the invoice / document is the proof, no receipts and no LPJ.
  bool get isDirect => this != karyawan;
}

/// ADR 0027: kind label of a vendor payment (server `typeLabel`; fallback).
const vendorPaymentLabel = 'Pembayaran vendor';

/// ADR 0028: kind label of a PT grup payment (server `typeLabel`; fallback).
const intercompanyPaymentLabel = 'Pembayaran antar-PT';

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

/// ADR 0026: "Menunggu persetujuan" of the Owner level (web `OWNER_WAITING_LABEL`).
const ownerWaitingLabel = 'Menunggu persetujuan Owner';

/// Fallback status label when the server's `statusLabel` is missing (the server label wins). [ownerLevel]: the current
/// approval level is the Owner's (ADR 0026).
String statusLabelFallback(RequestType type, RequestStatus status, {bool noApproval = false, bool ownerLevel = false}) {
  if (noApproval && status == RequestStatus.approved) return noApprovalStatusLabels[type]!;
  if (ownerLevel && status == RequestStatus.pendingApproval) return ownerWaitingLabel;
  return status.label;
}
