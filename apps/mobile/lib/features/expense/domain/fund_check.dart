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

/// `fundCheck.route` (ADR 0031 amendment, user 2026-10-22 "PB dulu, lalu PT"): where Finance pays the request from at
/// its approval, or that neither the Pusat Biaya nor the PT covers it. Null = an older server (no field).
enum FundCheckRoute {
  /// The project's Pusat Biaya covers the need: Finance pays from that account.
  pusatBiaya('pusat_biaya'),

  /// The Pusat Biaya does not, the PT does: Finance pays from another account of the PT (automatic inter-project loan).
  otherAccount('other_account'),

  /// No Pusat Biaya; the PT covers it.
  pt('pt'),

  /// Neither covers it.
  short('short');

  const FundCheckRoute(this.code);
  final String code;

  static FundCheckRoute? fromCode(String? c) => FundCheckRoute.values.where((r) => r.code == c).firstOrNull;
}

/// One commitment behind "Komitmen" (`fundCheck.commitmentItems[]` / `fundCheck.pusatBiaya.commitmentItems[]`, largest
/// first, max 20).
@freezed
abstract class FundCommitmentItem with _$FundCommitmentItem {
  const FundCommitmentItem._();
  const factory FundCommitmentItem({
    /// request | shortfall | loan | project_loan (loan: [id] = the inter-PT loan the PT lends, not yet disbursed;
    /// project_loan: [id] = the approved inter-project loan the Pusat Biaya lends, not yet disbursed).
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
    'project_loan' => 'Pinjaman antar project disetujui, belum dicairkan',
    _ => kind,
  };

  String get label => docNo ?? '#$id';
}

/// An inter-PT loan instructed for this request (`fundCheck.loans[]`). [serverStatusLabel] = the server's `statusLabel`
/// (web `IC_LOAN_STATUS_LABELS`); absent on a server before 2026-10-15.
@freezed
abstract class FundLoanRef with _$FundLoanRef {
  const FundLoanRef._();
  const factory FundLoanRef({
    required int id,
    required String docNo,
    required String status,
    required int amount,
    String? lenderCode,
    String? serverStatusLabel,
  }) = _FundLoanRef;

  /// Status label of the loan: the server's `statusLabel`, else the local map (an older server sends the code only).
  String get statusLabel {
    final s = serverStatusLabel?.trim() ?? '';
    return s.isNotEmpty ? s : icLoanStatusLabel(status);
  }
}

/// Labels of the inter-PT loan statuses (web `IC_LOAN_STATUS_LABELS`) — the fallback when the server sends no
/// `statusLabel`.
String icLoanStatusLabel(String code) => switch (code) {
  'instructed' => 'Menunggu pencairan',
  'disbursed' => 'Dicairkan',
  'partially_repaid' => 'Sebagian dikembalikan',
  'repaid' => 'Lunas',
  'cancelled' => 'Dibatalkan',
  _ => code,
};

/// `fundCheck.pusatBiaya` (ADR 0031 amendment): the project's Pusat Biaya (a cash account) and its figures — Saldo akun −
/// Komitmen = Dana bebas ([available], may be negative).
@freezed
abstract class FundPusatBiaya with _$FundPusatBiaya {
  const factory FundPusatBiaya({
    required int accountId,
    required String name,
    @Default(0) int balance,
    @Default(0) int commitments,
    @Default(0) int available,
    @Default(<FundCommitmentItem>[]) List<FundCommitmentItem> commitmentItems,
  }) = _FundPusatBiaya;
}

/// `ExpenseRequestDetail.fundCheck` (openapi). Figures are integer Rupiah; [available] (the PT's) may be negative.
/// [gap] / [status] / [blocked] are computed by the server against max(PT available, Pusat Biaya available).
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

    /// Where Finance pays from (null: an older server).
    FundCheckRoute? route,

    /// Indonesian one-liner of [route] (null when pt / short, or an older server).
    String? routeText,

    /// The project's Pusat Biaya; null = no project / not mapped (checked per PT only) or an older server.
    FundPusatBiaya? pusatBiaya,
  }) = _FundCheck;

  /// "Kurang Rp X" (red) instead of "Cukup".
  bool get short => status == FundCheckStatus.insufficient || gap > 0;

  /// PT short code for the title ("Ketersediaan dana PT DRMS").
  String get code => companyCode ?? '#$companyId';

  /// Text of the disabled "Setujui": the server's `blockedText`, else the same sentence built locally.
  String? get blockedReason => !blocked
      ? null
      : (blockedText?.trim().isNotEmpty == true ? blockedText : fundBlockedText(gap, pbName: pusatBiaya?.name));
}

/// Subject of the shortfall sentences: the Pusat Biaya and the PT, or the PT only (web `rules.ts` / `FundPanel.tsx`).
String _fundWho(String? pbName) =>
    pbName != null && pbName.isNotEmpty ? 'Dana pusat biaya $pbName maupun dana PT' : 'Dana PT';

/// Web `blockedDecisionText` (`domain/fundcheck/rules.ts`); [pbName] = the project's Pusat Biaya, if any.
String fundBlockedText(int gap, {String? pbName}) =>
    '${_fundWho(pbName)} tidak cukup — kurang ${formatRupiah(gap)}. Tolak, atau perintahkan pinjaman antar-PT.';

/// Draft variant of the web panel (the Owner's own request is checked at submit and stays Draft).
String fundBlockedDraftText(int gap, {String? pbName}) =>
    '${_fundWho(pbName)} tidak cukup — kurang ${formatRupiah(gap)}. Pengajuan Anda tidak dapat dikirim sampai dana '
    'tersedia; perintahkan pinjaman antar-PT.';

/// Machine code of the refusal (openapi; `domain/fundcheck/rules.ts`).
const fundInsufficientCode = 'FUND_INSUFFICIENT';

/// A real Indonesian sentence of the server (not an HTTP reason phrase), else null.
String? serverSentence(Object? v) {
  final s = v is String ? v.trim() : '';
  return s.length > 10 && s.endsWith('.') ? s : null;
}

int? _num(Object? v) => v is num ? v.toInt() : null;

/// Indonesian message of a 409 `FUND_INSUFFICIENT` (final approval, the Owner's own submit, a repayment), null for any
/// other problem. The server's sentence names the PT (and the Pusat Biaya) and the figures, so it wins; the local text is
/// the fallback for a body with the figures only (`available`, `needed`, `gap`, optionally `pusatBiayaName`), then a
/// generic sentence. [draft] = the refused step was the Owner's own submit (the request stays Draft).
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
  final pbName = b['pusatBiayaName'] is String ? (b['pusatBiayaName'] as String).trim() : null;
  final who = _fundWho(pbName);
  if (available == null || needed == null) return '$who tidak cukup untuk langkah ini. $tail';
  final gap = _num(b['gap']) ?? (needed - available < 0 ? 0 : needed - available);
  return '$who tidak cukup: tersedia ${formatRupiah(available)}, dibutuhkan ${formatRupiah(needed)}, '
      'kurang ${formatRupiah(gap)}. $tail';
}
