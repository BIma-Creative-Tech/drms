// ADR 0022 Pinjaman antar project (openapi `ProjectLoanSummary` / `ProjectLoanDetail` / `ProjectLoanOptions`).
// A recorded claim of the lender project on the borrower project of the same PT: the PM of the borrower submits,
// one Direktur decides (G1), repayments are recorded on the web (borrower PM / Finance). No cash entry exists for a
// loan. Parsing is tolerant (unknown fields ignored, missing ones defaulted).

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
}

/// Actions of `allowedActions` (the server decides; the APK only shows the buttons). `repay` is web-only in v1.
enum LoanAction {
  edit,
  submit,
  cancel,
  approve,
  reject,
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
    required this.lender,
    required this.borrower,
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
  final LoanProjectRef lender;
  final LoanProjectRef borrower;
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
  final List<LoanRepayment> repayments;
  final List<LoanDecision> decisions;

  /// `PJ/…` or "Draft #id" before submit (same text as the web).
  String get title => docNo ?? 'Draft #$id';

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
    lender: LoanProjectRef.fromJson(j['lenderProject']),
    borrower: LoanProjectRef.fromJson(j['borrowerProject']),
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
    repayments: [for (final r in _list(j['repayments'])) LoanRepayment.fromJson(_map(r))],
    decisions: [for (final d in _list(j['decisions'])) LoanDecision.fromJson(_map(d))],
  );
}

class LoanPage {
  const LoanPage({required this.items, this.page = 1, this.totalPages = 0, this.totalDocs = 0});
  final List<Loan> items;
  final int page;
  final int totalPages;
  final int totalDocs;

  factory LoanPage.fromJson(Map<String, dynamic> j) => LoanPage(
    items: [for (final i in _list(j['items'])) Loan.fromJson(_map(i))],
    page: _int(j['page'], 1),
    totalPages: _int(j['totalPages']),
    totalDocs: _int(j['totalDocs']),
  );
}

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
