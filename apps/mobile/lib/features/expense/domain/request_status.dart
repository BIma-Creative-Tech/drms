enum RequestType {
  advance('advance', 'Uang Muka'),
  reimburse('reimburse', 'Reimburse');

  const RequestType(this.code, this.label);
  final String code;
  final String label;

  static RequestType fromCode(String? c) => c == 'advance' ? advance : reimburse;
}

/// Status codes of openapi `RequestStatus`; labels are a fallback — the server's `statusLabel` wins.
enum RequestStatus {
  draft('draft', 'Draft'),
  pendingAck('pending_ack', 'Menunggu Diketahui'),
  pendingApproval('pending_approval', 'Menunggu Approval'),
  approved('approved', 'Disetujui'),
  receiptRevision('receipt_revision', 'Revisi Nota'),
  receiptsVerified('receipts_verified', 'Nota Terverifikasi'),
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
