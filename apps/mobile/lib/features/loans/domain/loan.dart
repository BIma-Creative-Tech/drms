// ADR 0022 Pinjaman antar project (openapi `ProjectLoanSummary` / `ProjectLoanDetail` / `ProjectLoanOptions`).
// A recorded claim of the lender project on the borrower project of the same PT: the PM of the borrower submits,
// one Direktur decides (G1), repayments by the borrower PM / Finance. ADR 0031 (DRMS 21/10): money between two
// different Pusat Biaya (cash accounts) is "cash-backed" — Finance disburses it ("Cairkan": KK lender, KM borrower)
// and records its repayments (KK borrower, KM lender); a transfer paid from another account than the project's Pusat
// Biaya records an automatic loan (origin `transfer`, lender = the paying account, no lender project). Goods or the
// same account stay a claim without cash. Parsing is tolerant (unknown fields ignored, missing ones defaulted).

int _int(Object? v, [int fallback = 0]) =>
    v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? fallback : fallback);
int? _intN(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
String? _strN(Object? v) => v == null ? null : '$v';
Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
List<dynamic> _list(Object? v) => v is List ? v : const [];

enum LoanStatus {
  draft('draft'),
  pendingApproval('pending_approval'),
  approved('approved'),
  partiallyRepaid('partially_repaid'),
  repaid('repaid'),
  rejected('rejected'),
  cancelled('cancelled');

  const LoanStatus(this.code);
  final String code;

  static LoanStatus fromCode(String? c) => LoanStatus.values.where((s) => s.code == c).firstOrNull ?? draft;

  /// Web `LOAN_STATUS_LABELS` (list filter; a loan carries the server's `statusLabel`).
  String get label => switch (this) {
    draft => 'Draft',
    pendingApproval => 'Menunggu persetujuan Direktur',
    approved => 'Disetujui',
    partiallyRepaid => 'Sebagian kembali',
    repaid => 'Lunas',
    rejected => 'Ditolak',
    cancelled => 'Dibatalkan',
  };
}

/// Actions of `allowedActions` (the server decides; the APK only shows the buttons). `repay` = "Catat pengembalian"
/// (phase 3, user 2026-10-19); `disburse` = "Cairkan" (ADR 0031, Finance, approved cash-backed loan, once).
enum LoanAction {
  edit,
  submit,
  cancel,
  approve,
  reject,
  disburse,
  repay;

  static LoanAction? fromCode(String c) => LoanAction.values.where((a) => a.name == c).firstOrNull;
}

class LoanUserRef {
  const LoanUserRef({required this.id, this.name});
  final int id;
  final String? name;

  static LoanUserRef? fromJson(Object? v) {
    final j = _map(v);
    final id = _intN(j['id']);
    return id == null ? null : LoanUserRef(id: id, name: _strN(j['name']));
  }
}

class LoanProjectRef {
  const LoanProjectRef({required this.id, this.code, this.name, this.pm});
  final int id;
  final String? code;
  final String? name;
  final LoanUserRef? pm;

  String get label {
    final s = [code, name].whereType<String>().where((e) => e.isNotEmpty).join(' ');
    return s.isEmpty ? '#$id' : s;
  }

  factory LoanProjectRef.fromJson(Object? v) {
    final j = _map(v);
    return LoanProjectRef(
      id: _int(j['id']),
      code: _strN(j['code']),
      name: _strN(j['name']),
      pm: LoanUserRef.fromJson(j['pm']),
    );
  }
}

/// ADR 0031 `{id, name}` of a Pusat Biaya (cash account) of a loan side.
class LoanAccountRef {
  const LoanAccountRef({required this.id, this.name});
  final int id;
  final String? name;

  String get label => name == null || name!.isEmpty ? '#$id' : name!;

  static LoanAccountRef? fromJson(Object? v) {
    final j = _map(v);
    final id = _intN(j['id']);
    return id == null ? null : LoanAccountRef(id: id, name: _strN(j['name']));
  }
}

/// ADR 0031 entry numbers of a loan's cash pair: `disbursement {kk, km}` (KK lender, KM borrower) or a repayment's
/// `cash {kk, km}` (KK borrower, KM lender); null when no cash moved.
class LoanCash {
  const LoanCash({this.kk, this.km});
  final String? kk;
  final String? km;

  static LoanCash? fromJson(Object? v) =>
      v is Map<String, dynamic> ? LoanCash(kk: _strN(v['kk']), km: _strN(v['km'])) : null;
}

class LoanRepayment {
  const LoanRepayment({
    required this.id,
    this.seq,
    required this.repayDate,
    required this.amount,
    this.note,
    required this.posted,
    required this.statusLabel,
    this.voidReason,
    this.recordedByName,
    this.voidedByName,
    this.cash,
  });
  final int id;

  /// "Pengembalian ke-n" among the posted repayments (null when void).
  final int? seq;
  final String repayDate;
  final int amount;
  final String? note;
  final bool posted;
  final String statusLabel;
  final String? voidReason;
  final String? recordedByName;
  final String? voidedByName;

  /// ADR 0031: KK (borrower) / KM (lender) numbers of a cash-backed loan's repayment; null for a claim or a void.
  final LoanCash? cash;

  factory LoanRepayment.fromJson(Map<String, dynamic> j) => LoanRepayment(
    id: _int(j['id']),
    seq: _intN(j['seq']),
    repayDate: '${j['repayDate'] ?? ''}',
    amount: _int(j['amount']),
    note: _strN(j['note']),
    posted: j['status'] != 'void',
    statusLabel: '${j['statusLabel'] ?? ''}',
    voidReason: _strN(j['voidReason']),
    recordedByName: _strN(_map(j['recordedBy'])['name']),
    voidedByName: _strN(_map(j['voidedBy'])['name']),
    cash: LoanCash.fromJson(j['cash']),
  );
}

class LoanDecision {
  const LoanDecision({required this.approved, this.actorName, this.reason, this.decidedAt});
  final bool approved;
  final String? actorName;
  final String? reason;
  final String? decidedAt;

  factory LoanDecision.fromJson(Map<String, dynamic> j) => LoanDecision(
    approved: j['decision'] != 'rejected',
    actorName: _strN(_map(j['actor'])['name']),
    reason: _strN(j['reason']),
    decidedAt: _strN(j['decidedAt']),
  );
}

class Loan {
  const Loan({
    required this.id,
    this.companyId,
    this.docNo,
    required this.status,
    required this.statusLabel,
    this.overdue = false,
    this.overdueLabel,
    this.daysOverdue = 0,
    required this.kind,
    required this.kindLabel,
    this.origin = 'manual',
    this.originLabel = '',
    this.lender,
    required this.borrower,
    this.lenderCashAccount,
    this.borrowerCashAccount,
    this.cashBacked = false,
    this.disbursedAt,
    this.disbursedBy,
    this.awaitingDisbursement = false,
    this.transfer,
    this.disbursement,
    required this.amount,
    this.repaidTotal = 0,
    this.outstanding = 0,
    required this.reason,
    required this.loanDate,
    required this.dueDate,
    this.samePm = false,
    this.samePmNote,
    this.g1Exception,
    this.g1Note,
    this.createdBy,
    this.submittedAt,
    this.decidedAt,
    this.decidedBy,
    this.rejectReason,
    this.cancelReason,
    this.allowedActions = const {},
    this.mayVoidRepayment = false,
    this.today,
    this.repayments = const [],
    this.decisions = const [],
  });

  final int id;
  final int? companyId;
  final String? docNo;
  final LoanStatus status;
  final String statusLabel;

  /// Derived "Terlambat" (server): due date before today, outstanding > 0, approved / partially repaid.
  final bool overdue;
  final String? overdueLabel;
  final int daysOverdue;
  final String kind; // dana | barang
  final String kindLabel;

  /// ADR 0031: `manual` (PM → Direktur) | `transfer` (automatic: Finance paid a project request from another account).
  final String origin;
  final String originLabel;

  /// Null for an automatic loan — its lender is [lenderCashAccount] (ADR 0031).
  final LoanProjectRef? lender;
  final LoanProjectRef borrower;

  /// ADR 0031: Pusat Biaya of each side (frozen at the approval / the transfer).
  final LoanAccountRef? lenderCashAccount;
  final LoanAccountRef? borrowerCashAccount;

  /// ADR 0031: money between two different accounts — the disbursement and the repayments post KK / KM.
  final bool cashBacked;
  final String? disbursedAt;
  final LoanUserRef? disbursedBy;

  /// Approved, cash-backed, not yet disbursed by Finance ("Disetujui – menunggu pencairan").
  final bool awaitingDisbursement;

  /// ADR 0031: the transfer of an automatic loan (`{id, docNo}`; [LoanTransferRef]).
  final LoanTransferRef? transfer;

  /// ADR 0031 (detail): KK (lender) / KM (borrower) numbers of the disbursement; null when no cash moved.
  final LoanCash? disbursement;
  final int amount;
  final int repaidTotal;
  final int outstanding;
  final String reason;
  final String loanDate;
  final String dueDate;
  final bool samePm;
  final String? samePmNote;
  final String? g1Exception;
  final String? g1Note;
  final LoanUserRef? createdBy;
  final String? submittedAt;
  final String? decidedAt;
  final LoanUserRef? decidedBy;
  final String? rejectReason;
  final String? cancelReason;
  final Set<LoanAction> allowedActions;

  /// Direktur / Finance may void a posted repayment (ADR 0022 §7).
  final bool mayVoidRepayment;

  /// Business date of the loan's PT (the repayment date picker's last day); null from an older server.
  final String? today;
  final List<LoanRepayment> repayments;
  final List<LoanDecision> decisions;

  /// `PJ/…` or "Draft #id" before submit (same text as the web).
  String get title => docNo ?? 'Draft #$id';

  /// Automatic loan of a transfer (ADR 0031).
  bool get automatic => origin == 'transfer';

  /// Web `lenderText`: the lender project, else "Akun <name>" (an automatic loan's paying account).
  String get lenderLabel => lender?.label ?? 'Akun ${lenderCashAccount?.label ?? '—'}';

  /// Whether [projectId] borrows (true) or lends (false) in this loan.
  bool borrowedBy(int projectId) => borrower.id == projectId;

  factory Loan.fromJson(Map<String, dynamic> j) => Loan(
    id: _int(j['id']),
    companyId: _intN(j['companyId']),
    docNo: _strN(j['docNo']),
    status: LoanStatus.fromCode(_strN(j['status'])),
    statusLabel: '${j['statusLabel'] ?? ''}',
    overdue: j['overdue'] == true,
    overdueLabel: _strN(j['overdueLabel']),
    daysOverdue: _int(j['daysOverdue']),
    kind: '${j['kind'] ?? 'dana'}',
    kindLabel: '${j['kindLabel'] ?? ''}',
    origin: '${j['origin'] ?? 'manual'}',
    originLabel: '${j['originLabel'] ?? ''}',
    lender: j['lenderProject'] is Map<String, dynamic> ? LoanProjectRef.fromJson(j['lenderProject']) : null,
    borrower: LoanProjectRef.fromJson(j['borrowerProject']),
    lenderCashAccount: LoanAccountRef.fromJson(j['lenderCashAccount']),
    borrowerCashAccount: LoanAccountRef.fromJson(j['borrowerCashAccount']),
    cashBacked: j['cashBacked'] == true,
    disbursedAt: _strN(j['disbursedAt']),
    disbursedBy: LoanUserRef.fromJson(j['disbursedBy']),
    awaitingDisbursement: j['awaitingDisbursement'] == true,
    transfer: LoanTransferRef.fromJson(j['transfer']),
    disbursement: LoanCash.fromJson(j['disbursement']),
    amount: _int(j['amount']),
    repaidTotal: _int(j['repaidTotal']),
    outstanding: _int(j['outstanding']),
    reason: '${j['reason'] ?? ''}',
    loanDate: '${j['loanDate'] ?? ''}',
    dueDate: '${j['dueDate'] ?? ''}',
    samePm: j['samePm'] == true,
    samePmNote: _strN(j['samePmNote']),
    g1Exception: _strN(j['g1Exception']),
    g1Note: _strN(j['g1Note']),
    createdBy: LoanUserRef.fromJson(j['createdBy']),
    submittedAt: _strN(j['submittedAt']),
    decidedAt: _strN(j['decidedAt']),
    decidedBy: LoanUserRef.fromJson(j['decidedBy']),
    rejectReason: _strN(j['rejectReason']),
    cancelReason: _strN(j['cancelReason']),
    allowedActions: {for (final a in _list(j['allowedActions'])) ?LoanAction.fromCode('$a')},
    mayVoidRepayment: j['mayVoidRepayment'] == true,
    today: _strN(j['today']),
    repayments: [for (final r in _list(j['repayments'])) LoanRepayment.fromJson(_map(r))],
    decisions: [for (final d in _list(j['decisions'])) LoanDecision.fromJson(_map(d))],
  );
}

/// ADR 0031 `transfer {id, docNo}` of an automatic loan.
class LoanTransferRef {
  const LoanTransferRef({required this.id, this.docNo});
  final int id;
  final String? docNo;

  String get label => docNo ?? '#$id';

  static LoanTransferRef? fromJson(Object? v) {
    final j = _map(v);
    final id = _intN(j['id']);
    return id == null ? null : LoanTransferRef(id: id, docNo: _strN(j['docNo']));
  }
}

class LoanPage {
  const LoanPage({required this.items, this.page = 1, this.totalPages = 0, this.totalDocs = 0, this.summary});
  final List<Loan> items;
  final int page;
  final int totalPages;
  final int totalDocs;

  /// `?summary=1`: the web list's KPI tiles and buttons.
  final LoanSummary? summary;

  factory LoanPage.fromJson(Map<String, dynamic> j) => LoanPage(
    items: [for (final i in _list(j['items'])) Loan.fromJson(_map(i))],
    page: _int(j['page'], 1),
    totalPages: _int(j['totalPages']),
    totalDocs: _int(j['totalDocs']),
    summary: j['summary'] is Map<String, dynamic> ? LoanSummary.fromJson(j['summary'] as Map<String, dynamic>) : null,
  );
}

/// Web "Pinjaman antar project" tiles: Menunggu persetujuan, Sisa pinjaman (disetujui · kembali), Terlambat.
class LoanSummary {
  const LoanSummary({
    this.pending = 0,
    this.amount = 0,
    this.repaid = 0,
    this.outstanding = 0,
    this.overdueCount = 0,
    this.overdue = 0,
    this.inboxCount = 0,
    this.canCreate = false,
  });
  final int pending;
  final int amount;
  final int repaid;
  final int outstanding;
  final int overdueCount;
  final int overdue;
  final int inboxCount;
  final bool canCreate;

  factory LoanSummary.fromJson(Map<String, dynamic> j) {
    final t = _map(j['totals']);
    return LoanSummary(
      pending: _int(t['pending']),
      amount: _int(t['amount']),
      repaid: _int(t['repaid']),
      outstanding: _int(t['outstanding']),
      overdueCount: _int(t['overdueCount']),
      overdue: _int(t['overdue']),
      inboxCount: _int(j['inboxCount']),
      canCreate: j['canCreate'] == true,
    );
  }
}

/// "Catat pengembalian" checks (web RepaymentAction messages; the server re-checks).
Map<String, String> validateRepayment({required int? amount, required int outstanding, required String? repayDate}) => {
  if (amount == null || amount <= 0) 'amount': 'Nominal pengembalian wajib diisi (> 0).',
  if (amount != null && amount > outstanding) 'amount': 'Nominal melebihi sisa pinjaman.',
  if (repayDate == null || repayDate.isEmpty) 'repayDate': 'Tanggal pengembalian wajib diisi.',
};

class LoanProjectOption {
  const LoanProjectOption({required this.id, required this.code, required this.name, required this.companyId});
  final int id;
  final String code;
  final String name;
  final int companyId;

  String get label => '$code $name'.trim();

  factory LoanProjectOption.fromJson(Map<String, dynamic> j) => LoanProjectOption(
    id: _int(j['id']),
    code: '${j['code'] ?? ''}',
    name: '${j['name'] ?? ''}',
    companyId: _int(j['companyId']),
  );
}

/// `GET /project-loans/options`: borrower projects of the caller (PM) and the open projects of the same PT(s).
class LoanOptions {
  const LoanOptions({this.borrowers = const [], this.lenders = const []});
  final List<LoanProjectOption> borrowers;
  final List<LoanProjectOption> lenders;

  bool canBorrowFor(int projectId) => borrowers.any((b) => b.id == projectId);

  /// Lenders for [borrowerId]: same PT, never the borrower itself (server re-checks: 400 COMPANY_MISMATCH).
  List<LoanProjectOption> lendersFor(int? borrowerId) {
    final b = borrowers.where((x) => x.id == borrowerId).firstOrNull;
    if (b == null) return const [];
    return [
      for (final l in lenders)
        if (l.companyId == b.companyId && l.id != b.id) l,
    ];
  }

  factory LoanOptions.fromJson(Map<String, dynamic> j) => LoanOptions(
    borrowers: [for (final b in _list(j['borrowers'])) LoanProjectOption.fromJson(_map(b))],
    lenders: [for (final l in _list(j['lenders'])) LoanProjectOption.fromJson(_map(l))],
  );
}

/// Client checks of the loan form (server re-checks, same messages as `loanInputErrors`).
Map<String, String> validateLoan({
  required int? borrowerId,
  required int? lenderId,
  required int? amount,
  required String reason,
  required String? loanDate,
  required String? dueDate,
  required String today,
}) => {
  if (borrowerId == null) 'borrower': 'Project peminjam wajib dipilih.',
  if (lenderId == null) 'lender': 'Project pemberi pinjaman wajib dipilih.',
  if (lenderId != null && lenderId == borrowerId) 'lender': 'Project pemberi dan peminjam harus berbeda.',
  if (amount == null || amount <= 0) 'amount': 'Nilai pinjaman wajib diisi (bilangan bulat Rupiah > 0).',
  if (amount != null && amount > 1000000000000) 'amount': 'Nilai pinjaman terlalu besar.',
  if (reason.trim().length < 3) 'reason': 'Alasan wajib diisi (min. 3 karakter).',
  if (reason.trim().length > 1000) 'reason': 'Alasan maks. 1000 karakter.',
  if (loanDate == null || loanDate.isEmpty) 'loanDate': 'Tanggal pinjaman wajib diisi.',
  if (loanDate != null && loanDate.compareTo(today) > 0) 'loanDate': 'Tanggal pinjaman tidak boleh di masa depan.',
  if (dueDate == null || dueDate.isEmpty) 'dueDate': 'Jatuh tempo wajib diisi.',
  if (dueDate != null && dueDate.isNotEmpty && loanDate != null && dueDate.compareTo(loanDate) < 0)
    'dueDate': 'Jatuh tempo tidak boleh sebelum tanggal pinjaman.',
};
