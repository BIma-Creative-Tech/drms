import 'package:freezed_annotation/freezed_annotation.dart';

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
  }) = _ExpenseLine;
}

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
    String? bankRef,
    required String status, // posted | void
    String? voidReason,
  }) = _TransferInfo;

  bool get isVoid => status == 'void';

  String get kindLabel => switch (kind) {
    'advance' => 'Uang muka',
    'reimburse' => 'Reimburse',
    'lpj_shortfall' => 'Kekurangan LPJ',
    _ => kind,
  };
}

/// `ExpenseRequestDetail.settlement` — LPJ of an Uang Muka (T5).
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
  }) = _SettlementInfo;

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
    String? acknowledgeBy, // scope_manager (pre-E1 PM) | role | user
    String? acknowledgeRole, // pk-owner = Direktur (ADR 0013)
    @Default([]) List<String> decisionRoles, // [pk-owner, pk-finance]; empty = pre-E1 snapshot
    @Default([]) List<SkippedPosition> skipped,
    @Default([]) List<RuleStep> steps,
  }) = _ApprovalRuleInfo;

  /// Snapshot taken under ADR 0013 (Direktur "Diketahui" = approval, then Finance).
  bool get decisionFlow => decisionRoles.isNotEmpty;

  /// Pre-E1 snapshot where the PM / cost-center manager gave "Diketahui".
  bool get legacyPmAcknowledge => acknowledgeBy == 'scope_manager';

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
    String? periodFrom,
    String? periodTo,
    int? bankAccountId,
  }) = _ExpenseDetail;
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
