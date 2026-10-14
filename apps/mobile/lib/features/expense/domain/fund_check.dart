import 'package:freezed_annotation/freezed_annotation.dart';

import '../../../core/format/rupiah.dart';
import '../../../core/network/api_exception.dart';

part 'fund_check.freezed.dart';

/// ADR 0029 §2 "Ketersediaan dana PT" on the APK: the request detail's `fundCheck` (Finance / Direktur / Owner of the
/// request's PT while it waits for a decision, or the Owner's own Draft), the inbox badge `fundShort` and the Indonesian
/// text of the server's 409 `FUND_INSUFFICIENT`. The server is the authority: it refuses the final approval (and the
/// Owner's own submit) while the PT is short; the APK only explains it and disables "Setujui".

/// `fundCheck.status`.
enum FundCheckStatus {
  ok('ok'),
  insufficient('insufficient'),
  notApplicable('not_applicable');

  const FundCheckStatus(this.code);
  final String code;

  static FundCheckStatus fromCode(String? c) =>
      FundCheckStatus.values.where((s) => s.code == c).firstOrNull ?? FundCheckStatus.notApplicable;
}

/// One commitment behind "Komitmen" (`fundCheck.commitmentItems[]`, largest first, max 20).
@freezed
abstract class FundCommitmentItem with _$FundCommitmentItem {
  const FundCommitmentItem._();
  const factory FundCommitmentItem({
    /// request | shortfall | loan (loan: [id] = the inter-PT loan the PT lends, not yet disbursed).
    required String kind,
    required int id,
    String? docNo,
    required int amount,
    @Default('') String status,
  }) = _FundCommitmentItem;

  /// Same texts as the web panel (`FundPanel.tsx` KIND).
  String get kindLabel => switch (kind) {
    'request' => 'Pengajuan disetujui, belum ditransfer',
    'shortfall' => 'Kekurangan LPJ belum dibayar',
    'loan' => 'Perintah pinjaman (PT ini pemberi), belum dicairkan',
    _ => kind,
  };

  String get label => docNo ?? '#$id';
}

/// An inter-PT loan instructed for this request (`fundCheck.loans[]`).
@freezed
abstract class FundLoanRef with _$FundLoanRef {
  const FundLoanRef._();
  const factory FundLoanRef({
    required int id,
    required String docNo,
    required String status,
    required int amount,
    String? lenderCode,
  }) = _FundLoanRef;

  /// Status label of the loan (`loan-rules.ts` IC_LOAN_STATUS_LABELS; the panel sends the code only).
  String get statusLabel => icLoanStatusLabel(status);
}

/// Labels of the inter-PT loan statuses (web `IC_LOAN_STATUS_LABELS`).
String icLoanStatusLabel(String code) => switch (code) {
  'instructed' => 'Menunggu pencairan',
  'disbursed' => 'Dicairkan',
  'partially_repaid' => 'Sebagian dikembalikan',
  'repaid' => 'Lunas',
  'cancelled' => 'Dibatalkan',
  _ => code,
};

/// `ExpenseRequestDetail.fundCheck` (openapi). Figures are integer Rupiah; [available] may be negative.
@freezed
abstract class FundCheck with _$FundCheck {
  const FundCheck._();
  const factory FundCheck({
    required int companyId,
    String? companyCode,
    String? companyName,

    /// `companies.fundCheckEnabled` — off: the panel is information only (no block).
    @Default(false) bool enabled,

    /// The request's NEXT decision makes it "Disetujui" (Owner level / final level), or the Owner's own Draft.
    @Default(false) bool applies,
    @Default(FundCheckStatus.notApplicable) FundCheckStatus status,

    /// enabled ∧ applies ∧ insufficient: "Setujui" (or "Kirim") is refused by the server (409 FUND_INSUFFICIENT).
    @Default(false) bool blocked,
    String? blockedText,
    @Default(0) int balance,
    @Default(0) int commitments,
    @Default(0) int available,
    @Default(0) int needed,
    @Default(0) int gap,

    /// "n akun, tanpa akun site".
    @Default(0) int accountCount,
    @Default(0) int excludedSiteCount,
    @Default(0) int excludedSiteBalance,

    /// Other requests of the PT waiting at their final decision (not committed).
    @Default(0) int waitingCount,
    @Default(0) int waitingAmount,
    @Default(<FundCommitmentItem>[]) List<FundCommitmentItem> commitmentItems,
    @Default(<FundLoanRef>[]) List<FundLoanRef> loans,
  }) = _FundCheck;

  /// "Kurang Rp X" (red) instead of "Cukup".
  bool get short => status == FundCheckStatus.insufficient || gap > 0;

  /// PT short code for the title ("Ketersediaan dana PT DRMS").
  String get code => companyCode ?? '#$companyId';

  /// Text of the disabled "Setujui": the server's `blockedText`, else the same sentence built locally.
  String? get blockedReason => !blocked ? null : (blockedText?.trim().isNotEmpty == true ? blockedText : fundBlockedText(gap));
}

/// Web `blockedDecisionText` (`domain/fundcheck/rules.ts`).
String fundBlockedText(int gap) =>
    'Dana PT tidak cukup — kurang ${formatRupiah(gap)}. Tolak, atau perintahkan pinjaman antar-PT.';

/// Draft variant of the web panel (the Owner's own request is checked at submit and stays Draft).
String fundBlockedDraftText(int gap) =>
    'Dana PT tidak cukup — kurang ${formatRupiah(gap)}. Pengajuan Anda tidak dapat dikirim sampai dana tersedia; '
    'perintahkan pinjaman antar-PT.';

/// Machine code of the refusal (openapi; `domain/fundcheck/rules.ts`).
const fundInsufficientCode = 'FUND_INSUFFICIENT';

/// A real Indonesian sentence of the server (not an HTTP reason phrase), else null.
String? serverSentence(Object? v) {
  final s = v is String ? v.trim() : '';
  return s.length > 10 && s.endsWith('.') ? s : null;
}

int? _num(Object? v) => v is num ? v.toInt() : null;

/// Indonesian message of a 409 `FUND_INSUFFICIENT` (final approval, the Owner's own submit, a repayment), null for any
/// other problem. The server's sentence names the PT and the figures, so it wins; the local text is the fallback for a
/// body with the figures only (`available`, `needed`, `gap`), then a generic sentence. [draft] = the refused step was
/// the Owner's own submit (the request stays Draft).
String? fundProblemMessage(ProblemException e, {bool draft = false}) {
  if (e.code != fundInsufficientCode) return null;
  final server = serverSentence(e.detail) ?? serverSentence(e.title);
  if (server != null) return server;
  final b = e.body;
  final available = _num(b['available']);
  final needed = _num(b['needed']);
  final tail = draft
      ? 'Pengajuan tetap Draft — perintahkan pinjaman antar-PT, lalu kirim lagi.'
      : 'Tolak, atau perintahkan pinjaman antar-PT.';
  if (available == null || needed == null) return 'Dana PT tidak cukup untuk langkah ini. $tail';
  final gap = _num(b['gap']) ?? (needed - available < 0 ? 0 : needed - available);
  return 'Dana PT tidak cukup: tersedia ${formatRupiah(available)}, dibutuhkan ${formatRupiah(needed)}, '
      'kurang ${formatRupiah(gap)}. $tail';
}
