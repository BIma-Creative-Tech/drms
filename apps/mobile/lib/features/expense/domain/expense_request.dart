import 'package:freezed_annotation/freezed_annotation.dart';

import 'fund_check.dart';
import 'request_status.dart';

part 'expense_request.freezed.dart';

@freezed
abstract class RefItem with _$RefItem {
  const factory RefItem({required int id, String? code, String? name}) = _RefItem;
}

/// `ExpenseRequestListItem`.
@freezed
abstract class ExpenseSummary with _$ExpenseSummary {
  const factory ExpenseSummary({
    required int id,
    String? docNo,
    required RequestType type,
    required String typeLabel,
    required RequestStatus status,
    required String statusLabel,
    required String title,
    required int grandTotal,
    int? approvedAmount,
    String? requestDate,
    String? neededDate,
    String? updatedAt,
    @Default(0) int openWarningFlags,

    /// MC3: PT of the request (`companyId`); null from a server before MC3.
    int? companyId,

    /// ADR 0027: vendor payment (`payeeType`); karyawan from a server before Wave 4.
    @Default(PayeeType.karyawan) PayeeType payeeType,
  }) = _ExpenseSummary;
}

@freezed
abstract class ExpenseLine with _$ExpenseLine {
  const factory ExpenseLine({
    required String id,
    required int no,
    String? description,
    double? qty,
    RefItem? uom,
    int? unitPrice,
    int? unitPriceDisplay,
    required int total,
    String? notes,
    RefItem? category,
    String? vehiclePlate,
    int? vehicleId,

    /// D3 "Nominal sesuai nota" (null = not filled).
    int? receiptAmount,

    /// D3: server read model `receiptMismatch` (receiptAmount ≠ total); null from an older server.
    bool? receiptMismatch,

    /// DRMS 10/10 D4: RAP item of the line (`rapItem {id, code, name}`); null before D4.
    RefItem? rapItem,

    /// D4: server read model `rapOverBudget` (live "Melebihi RAP"; always false for Staff); null from an older server.
    bool? rapOverBudget,
  }) = _ExpenseLine;
}

/// D3: a line saved before D3 (no reproducible unit price) in an editable request (Draft / Revisi Nota) —
/// "Lengkapi Qty & Harga satuan"; the server refuses (re)submit until it is completed.
bool lineNeedsCompletion(ExpenseDetail d, ExpenseLine l) =>
    (d.status == RequestStatus.draft || d.status == RequestStatus.receiptRevision) && l.unitPrice == null;

/// Flag code of D3 "Nominal sesuai nota ≠ total baris" (awareness for Finance, never blocks).
const receiptAmountMismatchFlag = 'receipt_amount_mismatch';

/// D3 "Selisih nota" on a line of [d]: the server's per-line `receiptMismatch`, a `receipt_amount_mismatch`
/// flag of that line, or — from a server without either — receiptAmount ≠ total.
bool lineReceiptMismatch(ExpenseDetail d, ExpenseLine l) =>
    l.receiptMismatch ??
    (d.flags.any((f) => f.kind == receiptAmountMismatchFlag && f.lineNo == l.no) ||
        (l.receiptAmount != null && l.receiptAmount != l.total));

/// D4 flag code: the line's amount is above the remaining budget of its RAP item ("Melebihi RAP"; awareness).
const rapOverBudgetFlag = 'rap_over_budget';

/// D4 "Melebihi RAP" on a line of [d]: the server's live `rapOverBudget` of the line or a `rap_over_budget` flag of it.
bool lineRapOverBudget(ExpenseDetail d, ExpenseLine l) =>
    (l.rapOverBudget ?? false) ||
    d.flags.any((f) => f.kind == rapOverBudgetFlag && f.lineNo == l.no && f.status != 'resolved');

/// D4: a line of an editable request (Draft / Revisi Nota) without a RAP item — "Pilih item RAP".
bool lineNeedsRapItem(ExpenseDetail d, ExpenseLine l) =>
    (d.status == RequestStatus.draft || d.status == RequestStatus.receiptRevision) && l.rapItem == null;

@freezed
abstract class ReceiptInfo with _$ReceiptInfo {
  const factory ReceiptInfo({
    required int id,
    required String lineId,
    int? lineNo,
    String? receiptNo,
    required String vendorName,
    required String receiptDate,
    required int amount,
    int? imageId,
    required String status,
  }) = _ReceiptInfo;
}

/// QA-27 (owner decision 2026-10-08): a receipt Finance marked valid is locked — the requester can no
/// longer remove it (server answers 409 "Nota sudah divalidasi Finance"); removed ones are gone already.
/// d1010 (13): maximum photos on one LPJ (same limit as the server).
const maxLpjPhotos = 10;

bool receiptRemovable(String status) => status != 'valid' && status != 'removed';

/// Receipt status labels (server `receipts.status`).
String receiptStatusLabel(String status) => switch (status) {
  'pending' => 'Menunggu verifikasi',
  'valid' => 'Valid',
  'rejected' => 'Ditolak',
  'removed' => 'Dihapus',
  _ => status,
};

/// `ExpenseRequestDetail.transfers[]` — what the requester sees of Finance's transfer (US-08, T3).
@freezed
abstract class TransferInfo with _$TransferInfo {
  const TransferInfo._();
  const factory TransferInfo({
    required int id,
    String? docNo,
    required String kind, // advance | reimburse | lpj_shortfall
    required int amount,
    String? transferDate,

    /// Item 11: date + time of the bank proof (UTC ISO); null = recorded without a time.
    String? transferAt,

    /// D2 legacy: cost center chosen by Finance at the transfer (transfers of 10/10–21/10/2026 only).
    RefItem? costCenter,
    String? bankRef,
    required String status, // posted | void
    String? voidReason,

    /// ADR 0031: the account the transfer is charged to (the project's Pusat Biaya).
    AccountRef? cashAccount,

    /// ADR 0031: the account actually paid from when it is not the Pusat Biaya (null = paid from it).
    AccountRef? paidFromCashAccount,

    /// ADR 0031: the automatic inter-project loan of a transfer paid from another account.
    TransferLoanRef? projectLoan,
  }) = _TransferInfo;

  bool get isVoid => status == 'void';

  String get kindLabel => switch (kind) {
    'advance' => 'Pengajuan Baru', // D1 (was "Uang muka")
    'reimburse' => 'Reimburse',
    'lpj_shortfall' => 'Kekurangan LPJ',
    _ => kind,
  };
}

/// `ExpenseRequestDetail.settlement` — LPJ of a Pengajuan Baru (`advance`, T5).
@freezed
abstract class SettlementInfo with _$SettlementInfo {
  const SettlementInfo._();
  const factory SettlementInfo({
    required int id,
    String? docNo,
    required String status, // draft | submitted | revision | verified | settled
    required String statusLabel,
    String? usageNotes,
    int? transferredTotal,
    int? receiptsTotal,
    int? verifiedReceiptsTotal,
    int? difference,
    String? settlementType, // none | refund | shortfall
    String? financeNotes,
    @Default(0) int submitCount,
    String? submittedAt,
    String? verifiedAt,
    String? settledAt,

    /// d1010 (13): LPJ photos (media ids, served like receipt images), at most [maxLpjPhotos].
    @Default([]) List<int> photos,
  }) = _SettlementInfo;

  /// Requester may still change the LPJ (not submitted yet, or sent back for revision).
  bool get editable => status == 'draft' || status == 'revision';

  String? get settlementTypeLabel => switch (settlementType) {
    'none' => 'Pas — tanpa selisih',
    'refund' => 'Sisa dana dikembalikan ke kas',
    'shortfall' => 'Kekurangan dibayar dengan transfer',
    _ => null,
  };
}

enum SignPosition { diajukan, dibuat, diketahui, approval }

@freezed
abstract class ApprovalEntry with _$ApprovalEntry {
  const factory ApprovalEntry({
    required int id,
    required int cycle,
    required SignPosition position,
    required int level,
    String? actorName,
    @Default(false) bool onBehalf,
    required String decision, // signed | acknowledged | approved | rejected
    String? reason,
    String? decidedAt,
  }) = _ApprovalEntry;
}

@freezed
abstract class RuleStep with _$RuleStep {
  const factory RuleStep({required int level, String? approverRole, int? approverUserId}) = _RuleStep;
}

/// A decision position skipped at submit because its only holders are the requester/creator (ADR 0013
/// G1-2). Shown as "(tidak berlaku — pemohon)".
@freezed
abstract class SkippedPosition with _$SkippedPosition {
  const factory SkippedPosition({required SignPosition position, required int level, String? role, String? reason}) =
      _SkippedPosition;
}

/// `ExpenseRequestDetail.approvalRule` — the rule snapshot taken at submit.
@freezed
abstract class ApprovalRuleInfo with _$ApprovalRuleInfo {
  const ApprovalRuleInfo._();
  const factory ApprovalRuleInfo({
    required String name,
    required String acknowledge, // required | optional | none
    String? acknowledgeDelegatedTo,
    String? acknowledgeBy, // scope_manager (PM project; pre-E1 or ADR 0021) | role | user
    String? acknowledgeRole, // pk-owner = Direktur (ADR 0013)
    @Default([]) List<String> decisionRoles, // [pk-owner, pk-finance]; empty = pre-E1 snapshot
    @Default([]) List<SkippedPosition> skipped,
    @Default([]) List<RuleStep> steps,

    /// ADR 0021: narrow G1 exception — a Direktur's own request filed by the PM (`direktur_via_pm`; `direktur_via_pm_self` =
    /// the requester Direktur is the PT's only Direktur and approves himself, owner 2026-10-11).
    String? selfApproval,
  }) = _ApprovalRuleInfo;

  /// Snapshot taken under ADR 0013 (Direktur "Diketahui" = approval, then Finance).
  bool get decisionFlow => decisionRoles.isNotEmpty;

  /// "Diketahui" by the PM project / cost-center manager: pre-E1 snapshots and, since ADR 0021, the
  /// "PM project → Direktur" flow (where it is the PM's approval).
  bool get legacyPmAcknowledge => acknowledgeBy == 'scope_manager';

  /// ADR 0021 flow: the PM project approves first (snapshot with decision roles + scope_manager).
  bool get pmApproval => decisionFlow && acknowledgeBy == 'scope_manager';

  /// ADR 0021: Direktur request filed by the PM (owner policy 2026-10-10).
  bool get direkturViaPm => selfApproval == 'direktur_via_pm' || selfApproval == 'direktur_via_pm_self';

  /// ADR 0021 (owner 2026-10-11): the requester Direktur approves himself (only Direktur of the PT).
  bool get direkturViaPmSelf => selfApproval == 'direktur_via_pm_self';

  /// ADR 0024 (owner 2026-10-11): a Direktur's own request without any approval step — straight to the Finance
  /// transfer queue (audited policy exception, web `direktur_no_approval`). ADR 0026 (owner 2026-10-13): since then
  /// only the Owner's own request (`principal_no_approval`); a Direktur's own request goes to the Owner.
  bool get noApproval => selfApproval == 'direktur_no_approval' || selfApproval == 'principal_no_approval';

  /// ADR 0026: the request without approval is the Owner's own (else a Direktur's, ADR 0024).
  bool get ownerNoApproval => selfApproval == 'principal_no_approval';

  /// Approver role of an approval level (null = named user / unknown).
  String? roleOfLevel(int level) => steps.where((s) => s.level == level).firstOrNull?.approverRole;

  /// Highest approval level of the snapshot (0 = no approval level left).
  int get lastLevel => steps.fold(0, (m, s) => s.level > m ? s.level : m);

  bool isSkipped(SignPosition p, [int? level]) =>
      skipped.any((s) => s.position == p && (level == null || s.level == level));
}

@freezed
abstract class FlagInfo with _$FlagInfo {
  const factory FlagInfo({
    required int id,
    required String kind,
    required String kindLabel,
    required String level, // info | warning
    required String status,
    int? lineNo,
    required String message,
  }) = _FlagInfo;
}

@freezed
abstract class BudgetImpact with _$BudgetImpact {
  const BudgetImpact._();
  const factory BudgetImpact({required String basis, double? pctBefore, double? pctAfter}) = _BudgetImpact;

  bool get hasBudget => basis == 'project';
}

/// `ExpenseRequestDetail` — the subset the APK shows.
@freezed
abstract class ExpenseDetail with _$ExpenseDetail {
  const factory ExpenseDetail({
    required int id,
    String? docNo,
    String? clientUuid,
    required RequestType type,
    required String typeLabel,
    required RequestStatus status,
    required String statusLabel,
    required String title,
    required int grandTotal,
    int? approvedAmount,
    String? requestDate,
    String? neededDate,
    String? notes,
    RefItem? project,
    RefItem? costCenter,
    @Default([]) List<RefItem> requesters,
    String? createdByName,
    String? bankName,
    String? bankAccountNo,
    String? bankAccountHolder,
    @Default([]) List<ExpenseLine> lines,
    @Default([]) List<ReceiptInfo> receipts,
    @Default([]) List<ApprovalEntry> approvals,
    ApprovalRuleInfo? approvalRule,
    @Default(1) int approvalCycle,
    int? currentLevel,
    @Default([]) List<FlagInfo> flags,
    @Default(BudgetImpact(basis: 'none')) BudgetImpact budget,
    @Default([]) List<TransferInfo> transfers,
    @Default(0) int transferredTotal,
    SettlementInfo? settlement,
    @Default(<String>{}) Set<String> allowedActions,
    String? rejectReason,
    String? cancelReason,
    String? submittedAt,
    String? updatedAt,
    int? rev,
    int? resubmitOfId,
    int? createdById,

    /// Owner decision 2026-10-09: "Tingkat urgensi" (replaces the activity period).
    RefItem? urgencyLevel,
    int? bankAccountId,

    /// MC3: PT of the request (`companyId`).
    int? companyId,

    /// ADR 0027 "Pembayaran vendor": payee type, vendor, chosen vendor account (the destination snapshot is in
    /// `bankName` / `bankAccountNo` / `bankAccountHolder` after submit) and the invoice (the proof — no LPJ).
    @Default(PayeeType.karyawan) PayeeType payeeType,
    RefItem? vendor,
    int? vendorBankAccountId,
    String? invoiceNo,
    String? invoiceDate,
    String? invoiceDueDate,
    int? invoiceFileId,
    String? invoiceFileName,

    /// ADR 0028 "Pembayaran antar-PT": the receiving PT (`payeeCompany {id, shortCode → code, name}`; the destination
    /// snapshot = its designated receiving account) and, after the transfer, its Kas Masuk (`intercompany`).
    RefItem? payeeCompany,
    RequestIntercompany? intercompany,

    /// ADR 0025: the caller's next decision is signed as the PT's definitive Direktur (`direkturSignature`).
    DirekturSignature? direkturSignature,

    /// ADR 0029 "Ketersediaan dana PT" (`fundCheck`): Finance / Direktur / Owner of the PT while the request waits for a
    /// decision (or the Owner's own Draft); null otherwise and from a server before ADR 0029.
    FundCheck? fundCheck,

    /// ADR 0031 (DRMS 21/10): the Pusat Biaya = the project's cash account (read-only; null without project or while
    /// the project is not mapped). [costCenter] is a legacy non-project request's own cost center only.
    AccountRef? pusatBiaya,

    // D2410 (point 6): general attachments ("Lampiran", photo / PDF; empty from a server before 0.20).
    @Default([]) List<RequestAttachment> attachments,
  }) = _ExpenseDetail;
}

/// ADR 0027: a vendor payment — no receipts, no LPJ (the transfer completes it). ADR 0028: a PT grup payment the same
/// way (the transfer also posts the receiving PT's Kas Masuk).
extension ExpenseDetailVendor on ExpenseDetail {
  bool get isVendor => payeeType == PayeeType.vendor;
  bool get isPtGrup => payeeType == PayeeType.ptGrup;
  bool get isDirectPayment => payeeType.isDirect;
}

/// ADR 0028 `ExpenseRequestDetail.intercompany`: the receiving PT's Kas Masuk of the (latest) transfer of a PT grup
/// payment — numbers and PT only (the entry belongs to that PT). [voided]: the transfer was voided (reversal posted in
/// the receiving PT).
class RequestIntercompany {
  const RequestIntercompany({required this.targetEntryNo, this.voided = false, this.targetCompany, this.transferId});
  final String targetEntryNo;
  final bool voided;

  /// `targetCompany {id, shortCode → code, name}`.
  final RefItem? targetCompany;
  final int? transferId;

  /// Short code of the receiving PT ("LAS"), else null.
  String? get companyCode => targetCompany?.code ?? targetCompany?.name;

  @override
  bool operator ==(Object other) =>
      other is RequestIntercompany &&
      other.targetEntryNo == targetEntryNo &&
      other.voided == voided &&
      other.targetCompany == targetCompany &&
      other.transferId == transferId;

  @override
  int get hashCode => Object.hash(targetEntryNo, voided, targetCompany, transferId);
}

/// D2410 (point 6) `ExpenseRequestDetail.attachments[]`: a general attachment of the request — opened through
/// `GET /media/attachments/{id}/file`.
class RequestAttachment {
  const RequestAttachment({required this.id, this.fileName, this.mimeType});
  final int id;
  final String? fileName;
  final String? mimeType;

  bool get isPdf => mimeType == 'application/pdf';

  /// The file name, else "Lampiran #id".
  String get label => fileName == null || fileName!.isEmpty ? 'Lampiran #$id' : fileName!;

  @override
  bool operator ==(Object other) =>
      other is RequestAttachment && other.id == id && other.fileName == fileName && other.mimeType == mimeType;

  @override
  int get hashCode => Object.hash(id, fileName, mimeType);
}

/// ADR 0031 `{id, name}` of a cash account (Pusat Biaya, the account a transfer was paid from).
class AccountRef {
  const AccountRef({required this.id, this.name});
  final int id;
  final String? name;

  /// The name, else "#id".
  String get label => name == null || name!.isEmpty ? '#$id' : name!;

  @override
  bool operator ==(Object other) => other is AccountRef && other.id == id && other.name == name;

  @override
  int get hashCode => Object.hash(id, name);
}

/// ADR 0031 `transfers[].projectLoan {id, docNo, status}`: the automatic inter-project loan of a transfer paid from an
/// account other than the project's Pusat Biaya.
class TransferLoanRef {
  const TransferLoanRef({required this.id, this.docNo, this.status});
  final int id;
  final String? docNo;
  final String? status;

  @override
  bool operator ==(Object other) =>
      other is TransferLoanRef && other.id == id && other.docNo == docNo && other.status == status;

  @override
  int get hashCode => Object.hash(id, docNo, status);
}

/// ADR 0025 `ExpenseRequestDetail.direkturSignature`: the caller is a designated representative deciding a Direktur
/// step — the server signs with the PT's definitive Direktur signature ([signatureId], `media-signatures`) and shows
/// [name]; the decision sheet shows it read-only instead of asking for a signature.
class DirekturSignature {
  const DirekturSignature({required this.name, this.title, required this.signatureId});
  final String name;
  final String? title;
  final int signatureId;

  /// "Nama (Jabatan)" as printed on the PDF.
  String get label => title == null || title!.isEmpty ? name : '$name ($title)';

  @override
  bool operator ==(Object other) =>
      other is DirekturSignature && other.name == name && other.title == title && other.signatureId == signatureId;

  @override
  int get hashCode => Object.hash(name, title, signatureId);
}

/// `ApprovalInbox.items[]`.
@freezed
abstract class InboxItem with _$InboxItem {
  const factory InboxItem({
    required int id,
    String? docNo,
    required RequestType type,
    required String typeLabel,
    required RequestStatus status,
    required String statusLabel,
    required String title,
    required String scope,
    required String requesters,
    required int grandTotal,
    String? neededDate,
    required String step, // acknowledge | approve
    int? level,
    String? stepLabel, // "Persetujuan Direktur (Diketahui)" | "Approval level n" (server text, E1)
    @Default(false) bool decisionFlow, // ADR 0013 request (acknowledge = Direktur approval)
    required BudgetImpact budget,
    @Default(false) bool budgetOverWarn,
    @Default(0) int warningFlags,
    @Default(0) int infoFlags,

    /// D3: lines whose "Nominal sesuai nota" ≠ total (`flags.receiptMismatch`) — badge "Selisih nota (n)".
    @Default(0) int receiptMismatchFlags,

    /// MC3: PT of the request (`company.id`) — chip + role check of that PT.
    int? companyId,

    /// ADR 0029: "Dana kurang Rp X" — the gap of a final-step row of a PT with the fund check on (Kas roles of the PT);
    /// null when enough / not applicable / a server before ADR 0029.
    int? fundShort,
  }) = _InboxItem;
}

/// `History.items[]` — one audit row of the request or a satellite (receipt, transfer, LPJ, cash entry).
@freezed
abstract class HistoryEntry with _$HistoryEntry {
  const factory HistoryEntry({
    required String serverTime,
    required String action,
    String? field,
    int? lineNo,
    Object? oldValue,
    Object? newValue,
    String? statusFrom,
    String? statusTo,
    String? reason,
    int? userId,
    String? userName,
    String? source,
    String? appVersion,
    String? deviceId,
    required String docType,
    String? docNo,
  }) = _HistoryEntry;
}
