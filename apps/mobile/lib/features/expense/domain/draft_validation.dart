import 'draft.dart';
import 'request_status.dart';

/// Client-side checks that mirror the server rules (US-03, US-37, US-38, US-53) so the user sees
/// problems early. The server re-validates everything and remains authoritative.
class DraftIssue {
  const DraftIssue(this.field, this.message, {this.lineNo});
  final String field;
  final String message;
  final int? lineNo;
  @override
  String toString() => lineNo == null ? message : 'Baris $lineNo: $message';
}

/// Minimum to store a draft locally/offline: a title and a type.
List<DraftIssue> validateForSave(DraftRequest d) => [
  if (d.title.trim().isEmpty) const DraftIssue('title', 'Judul wajib diisi.'),
  if (d.title.length > 200) const DraftIssue('title', 'Judul maksimal 200 karakter.'),
];

/// Everything required before "Ajukan" (online submit).
List<DraftIssue> validateForSubmit(DraftRequest d) {
  final issues = <DraftIssue>[...validateForSave(d)];
  final hasProject = d.projectId != null;
  final hasCostCenter = d.costCenterId != null;
  if (hasProject == hasCostCenter) {
    issues.add(const DraftIssue('scope', 'Pilih salah satu: project atau pusat biaya.'));
  }
  if (d.bankAccountId == null) {
    issues.add(const DraftIssue('bankAccountId', 'Rekening tujuan wajib dipilih.'));
  }
  if (d.lines.isEmpty) {
    issues.add(const DraftIssue('lines', 'Minimal 1 baris item.'));
  }
  for (final l in d.lines) {
    if (l.description.trim().isEmpty) {
      issues.add(DraftIssue('description', 'Uraian wajib diisi.', lineNo: l.no));
    }
    if (l.categoryId == null) {
      issues.add(DraftIssue('categoryId', 'Kategori wajib dipilih.', lineNo: l.no));
    }
    if (l.total == null || l.total! <= 0) {
      issues.add(DraftIssue('total', 'Total harus lebih dari 0.', lineNo: l.no));
    }
    if (l.qty != null && l.qty! <= 0) {
      issues.add(DraftIssue('qty', 'Jumlah harus lebih dari 0.', lineNo: l.no));
    }
    if (d.type == RequestType.reimburse && l.receipts.isEmpty) {
      issues.add(DraftIssue('receipts', 'Reimburse wajib melampirkan minimal 1 nota.', lineNo: l.no));
    }
    for (final r in l.receipts) {
      if (r.vendorName.trim().isEmpty) {
        issues.add(DraftIssue('vendorName', 'Nama toko/vendor nota wajib diisi.', lineNo: l.no));
      }
      if (r.amount <= 0) {
        issues.add(DraftIssue('amount', 'Nominal nota harus lebih dari 0.', lineNo: l.no));
      }
    }
  }
  return issues;
}

/// Renumbers lines 1..n after add/remove (the "No" column is automatic, US-37).
List<DraftLine> renumber(List<DraftLine> lines) => [
  for (var i = 0; i < lines.length; i++) lines[i].copyWith(no: i + 1),
];

/// Line total vs. Σ receipts (US-47 preview; the server computes the real flag with its tolerance).
int receiptDifference(DraftLine l) => (l.total ?? 0) - l.receipts.fold(0, (s, r) => s + r.amount);
