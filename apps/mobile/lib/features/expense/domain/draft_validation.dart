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

/// QA-15: message when a Staff-only user lists someone else as requester (same text as the server).
const staffSelfOnlyMessage = 'Staff hanya dapat mengajukan untuk dirinya sendiri: "Diajukan Oleh" harus hanya Anda.';

/// QA-15: "Diajukan Oleh" of a Staff-only user must be exactly [selfOnlyEmployee] (null = no restriction;
/// a Staff-only user without an employee in the PT passes -1 → always an issue).
List<DraftIssue> requesterIssues(DraftRequest d, {int? selfOnlyEmployee}) => [
  if (selfOnlyEmployee != null && !(d.requesterIds.length == 1 && d.requesterIds.single == selfOnlyEmployee))
    const DraftIssue('requesterIds', staffSelfOnlyMessage),
];

/// QA-15: employees a user may pick as requester — own employee only for a Staff-only user.
/// ADR 0024 (owner 2026-10-11): a Direktur files his own request himself — a Direktur employee ([isDirektur],
/// masters `employees.direktur`) is offered only to that Direktur ([ownEmployee]), never to a PM / Admin / Finance.
List<T> requesterChoices<T>(
  List<T> employees,
  int Function(T) idOf, {
  int? selfOnlyEmployee,
  bool Function(T)? isDirektur,
  int? ownEmployee,
}) {
  if (selfOnlyEmployee != null) return employees.where((e) => idOf(e) == selfOnlyEmployee).toList();
  if (isDirektur == null) return employees;
  return employees.where((e) => !isDirektur(e) || idOf(e) == ownEmployee).toList();
}

/// D4 (owner 2026-10-11): message when the project has a RAB but no RAP yet (same text as the server and the web).
const rapMissingMessage = 'Project belum punya RAP — hubungi PM';

/// D4: what the project's RAP asks of the lines (from `GET /projects/{id}/rap`; [strict] when unknown, e.g. offline).
enum RapCheck {
  /// Every line names a RAP item (the project has a RAP, or nothing is known — the server decides).
  strict,

  /// The project needs a RAP (RAB) but has none → submit refused with [rapMissingMessage].
  missing,

  /// No RAP and none required (project without RAB) → lines without an item are fine.
  optional,
}

/// Everything required before "Ajukan" (online submit).
List<DraftIssue> validateForSubmit(DraftRequest d, {int? selfOnlyEmployee, RapCheck rap = RapCheck.strict}) {
  final issues = <DraftIssue>[...validateForSave(d), ...requesterIssues(d, selfOnlyEmployee: selfOnlyEmployee)];
  // D2: project required (no non-project requests; Finance sets the cost center at transfer). ADR 0027 (client
  // 2026-10-14): a vendor payment may name a cost center instead (e.g. office bills); ADR 0028: a PT grup payment too.
  if (d.projectId == null && !(d.isDirectPayment && d.costCenterId != null)) {
    final message = d.isVendor
        ? 'Pilih project atau pusat biaya (pembayaran vendor).'
        : d.isPtGrup
        ? 'Pilih project atau pusat biaya (pembayaran antar-PT).'
        : 'Project wajib dipilih.';
    issues.add(DraftIssue('projectId', message));
  } else if (d.projectId != null && rap == RapCheck.missing) {
    issues.add(const DraftIssue('projectId', rapMissingMessage));
  }
  if (d.isVendor) {
    issues.addAll(vendorIssues(d));
  } else if (d.isPtGrup) {
    issues.addAll(intercompanyIssues(d));
  } else if (d.bankAccountId == null) {
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
    // D4: every line is charged to a RAP item of the project.
    if (l.rapItemId == null && rap == RapCheck.strict) {
      issues.add(DraftIssue('rapItemId', 'Item RAP wajib dipilih.', lineNo: l.no));
    }
    // D3: total = qty × harga satuan — both required (a pre-D3 line asks for its unit price here).
    if (l.qty == null || l.qty! <= 0) {
      issues.add(DraftIssue('qty', 'Qty wajib diisi (lebih dari 0).', lineNo: l.no));
    } else if (l.uomId == null) {
      issues.add(DraftIssue('uomId', 'Satuan wajib dipilih.', lineNo: l.no));
    }
    if (l.unitPrice == null) {
      issues.add(DraftIssue('unitPrice', 'Harga satuan wajib diisi.', lineNo: l.no));
    } else if (l.unitPrice! <= 0) {
      issues.add(DraftIssue('unitPrice', 'Harga satuan harus lebih dari 0.', lineNo: l.no));
    } else if ((l.computedTotal ?? 0) <= 0) {
      issues.add(DraftIssue('total', 'Total harus lebih dari 0.', lineNo: l.no));
    }
    // a vendor / PT grup payment is always Pengajuan Baru (no receipts before the transfer, ADR 0027 / 0028)
    if (d.type == RequestType.reimburse && !d.isDirectPayment && l.receipts.isEmpty) {
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

/// ADR 0027 "Pembayaran vendor": vendor, vendor account, invoice number / date / photo before "Ajukan" (same rules as
/// the server; the server also refuses a duplicate invoice of the same vendor).
List<DraftIssue> vendorIssues(DraftRequest d) => [
  if (d.vendorId == null) const DraftIssue('vendorId', 'Vendor wajib dipilih.'),
  if (d.vendorBankAccountId == null) const DraftIssue('vendorBankAccountId', 'Rekening vendor wajib dipilih.'),
  ..._documentIssues(d, vendorDocumentTexts),
];

/// ADR 0028 "Pembayaran antar-PT": the receiving PT (another PT of the group) and the receiving PT's document —
/// number, date, file (owner decision 2026-10-14: mandatory; due date optional). Same texts as the server; the server
/// also checks the designated receiving account (400 INTERCOMPANY_NO_ACCOUNT) and a duplicate document (409).
List<DraftIssue> intercompanyIssues(DraftRequest d) => [
  if (d.payeeCompanyId == null)
    const DraftIssue('payeeCompanyId', 'PT penerima wajib dipilih.')
  else if (d.companyId != null && d.payeeCompanyId == d.companyId)
    const DraftIssue('payeeCompanyId', 'PT penerima harus PT lain di grup, bukan PT pengajuan ini.'),
  ..._documentIssues(d, intercompanyDocumentTexts),
];

/// Wording of the proof document: the vendor's invoice (ADR 0027) or the receiving PT's document (ADR 0028).
typedef DocumentTexts = ({String noRequired, String noInvalid, String dateRequired, String dueBefore, String file});

const vendorDocumentTexts = (
  noRequired: 'Nomor invoice wajib diisi.',
  noInvalid: 'Nomor invoice harus memuat huruf atau angka.',
  dateRequired: 'Tanggal invoice wajib diisi.',
  dueBefore: 'Jatuh tempo tidak boleh sebelum tanggal invoice.',
  file: 'Foto invoice wajib dilampirkan.',
);

const intercompanyDocumentTexts = (
  noRequired: 'Nomor dokumen (tagihan / memo PT penerima) wajib diisi.',
  noInvalid: 'Nomor dokumen harus memuat huruf atau angka.',
  dateRequired: 'Tanggal dokumen wajib diisi.',
  dueBefore: 'Jatuh tempo tidak boleh sebelum tanggal dokumen.',
  file: 'Foto dokumen (tagihan / memo PT penerima) wajib dilampirkan.',
);

List<DraftIssue> _documentIssues(DraftRequest d, DocumentTexts t) => [
  if ((d.invoiceNo ?? '').trim().isEmpty)
    DraftIssue('invoiceNo', t.noRequired)
  else if (normalizeInvoiceNo(d.invoiceNo).isEmpty)
    DraftIssue('invoiceNo', t.noInvalid),
  if (d.invoiceDate == null) DraftIssue('invoiceDate', t.dateRequired),
  if (d.invoiceDate != null && d.invoiceDueDate != null && d.invoiceDueDate!.compareTo(d.invoiceDate!) < 0)
    DraftIssue('invoiceDueDate', t.dueBefore),
  if (!d.hasInvoiceFile) DraftIssue('invoiceFile', t.file),
];

/// ADR 0027 / 0028: invoice / document key of the duplicate check (web `normalizeInvoiceNo`): letters + digits, upper
/// case.
String normalizeInvoiceNo(String? v) => (v ?? '').replaceAll(RegExp('[^A-Za-z0-9]'), '').toUpperCase();

/// Renumbers lines 1..n after add/remove (the "No" column is automatic, US-37).
List<DraftLine> renumber(List<DraftLine> lines) => [
  for (var i = 0; i < lines.length; i++) lines[i].copyWith(no: i + 1),
];

/// Line total vs. Σ receipts (US-47 preview; the server computes the real flag with its tolerance).
int receiptDifference(DraftLine l) => (l.computedTotal ?? l.total ?? 0) - l.receipts.fold(0, (s, r) => s + r.amount);
