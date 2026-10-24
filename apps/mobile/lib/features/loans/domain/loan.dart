// ADR 0022 Pinjaman antar project (openapi `ProjectLoanSummary` / `ProjectLoanDetail` / `ProjectLoanOptions`).
// A recorded claim of the lender project on the borrower project of the same PT: the PM of the borrower submits,
// one Direktur decides (G1), repayments by the borrower PM / Finance. ADR 0031 (DRMS 21/10): money between two
// different Pusat Biaya (cash accounts) is "cash-backed" — Finance disburses it ("Cairkan": KK lender, KM borrower)
// and records its repayments (KK borrower, KM lender); a transfer paid from another account than the project's Pusat
// Biaya records an automatic loan (origin `transfer`, lender = the paying account, no lender project). Goods or the
// same account stay a claim without cash. Parsing is tolerant (unknown fields ignored, missing ones defaulted).
// User decision 2026-10-24: the borrower PM or Finance submits; Direktur (level 1) then Owner (level 2) approve; a
// cash-backed loan then becomes a transfer order in Finance's "Antrian Transfer" (executed there: KK lender, KM
// borrower). A cash-backed repayment follows the same path (request → Direktur → Owner → Antrian Transfer).

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

/// Repayment lifecycle (user decision 2026-10-24): the repayment of a cash-backed loan is a REQUEST — Direktur →
/// Owner → transfer order in Finance's "Antrian Transfer" → `posted` (executed: KK borrower, KM lender); a claim's
/// repayment is `posted` at once (ADR 0022). Rows of an older server carry `posted` / `void` only (a missing code is
/// read as `posted`, as before); an unknown code of a newer server counts as still pending — never as paid.
enum LoanRepaymentStatus {
  pendingApproval('pending_approval'),
  approved('approved'),
  posted('posted'),
  voided('void'),
  rejected('rejected'),
  cancelled('cancelled');

  const LoanRepaymentStatus(this.code);
  final String code;

  static LoanRepaymentStatus fromCode(String? c) =>
      LoanRepaymentStatus.values.where((s) => s.code == c).firstOrNull ?? (c == null ? posted : pendingApproval);

  /// Void / rejected / cancelled: shown struck through, never counted.
  bool get closed => this == voided || this == rejected || this == cancelled;
}

/// Row actions of a repayment (`repayments[].allowedActions`, the server decides): Setujui / Tolak (Direktur, Owner),
/// Batalkan (submitter; Finance once approved), execute (Finance — done in the Antrian Transfer), void (posted).
enum LoanRepaymentAction {
  approve('approve'),
  reject('reject'),
  cancel('cancel'),
  execute('execute'),
  voidRepayment('void');

  const LoanRepaymentAction(this.code);
  final String code;

  static LoanRepaymentAction? fromCode(String c) => LoanRepaymentAction.values.where((a) => a.code == c).firstOrNull;
}

class LoanRepayment {
  const LoanRepayment({
    required this.id,
    this.seq,
    required this.repayDate,
    required this.amount,
    this.note,
    this.status = LoanRepaymentStatus.posted,
    required this.statusLabel,
    this.approvalLevel,
    this.plannedDate,
    this.voidReason,
    this.rejectReason,
    this.cancelReason,
    this.recordedByName,
    this.voidedByName,
    this.executedAt,
    this.executedByName,
    this.cash,
    this.allowedActions = const {},
    this.decisions = const [],
  });
  final int id;

  /// "Pengembalian ke-n" among the posted repayments (null otherwise).
  final int? seq;

  /// The planned date until the transfer is executed, then the execution date.
  final String repayDate;
  final int amount;
  final String? note;
  final LoanRepaymentStatus status;
  final String statusLabel;

  /// 1 = waiting for the Direktur, 2 = waiting for the Owner (pending only).
  final int? approvalLevel;
  final String? plannedDate;
  final String? voidReason;
  final String? rejectReason;
  final String? cancelReason;

  /// The submitter (a request) or the recorder (a claim's repayment).
  final String? recordedByName;
  final String? voidedByName;
  final String? executedAt;
  final String? executedByName;

  /// ADR 0031: KK (borrower) / KM (lender) numbers of a cash-backed loan's repayment; null for a claim or a void.
  final LoanCash? cash;
  final Set<LoanRepaymentAction> allowedActions;

  /// Direktur / Owner decisions of the request (level order).
  final List<LoanDecision> decisions;

  /// Executed / recorded (counts in the repaid total).
  bool get posted => status == LoanRepaymentStatus.posted;

  /// Request still on its way (approval or transfer order).
  bool get open => status == LoanRepaymentStatus.pendingApproval || status == LoanRepaymentStatus.approved;

  factory LoanRepayment.fromJson(Map<String, dynamic> j) => LoanRepayment(
    id: _int(j['id']),
    seq: _intN(j['seq']),
    repayDate: '${j['repayDate'] ?? ''}',
    amount: _int(j['amount']),
    note: _strN(j['note']),
    status: LoanRepaymentStatus.fromCode(_strN(j['status'])),
    statusLabel: '${j['statusLabel'] ?? ''}',
    approvalLevel: _intN(j['approvalLevel']),
    plannedDate: _strN(j['plannedDate']),
    voidReason: _strN(j['voidReason']),
    rejectReason: _strN(j['rejectReason']),
    cancelReason: _strN(j['cancelReason']),
    recordedByName: _strN(_map(j['recordedBy'])['name']),
    voidedByName: _strN(_map(j['voidedBy'])['name']),
    executedAt: _strN(j['executedAt']),
    executedByName: _strN(_map(j['executedBy'])['name']),
    cash: LoanCash.fromJson(j['cash']),
    allowedActions: {for (final a in _list(j['allowedActions'])) ?LoanRepaymentAction.fromCode('$a')},
    decisions: [for (final d in _list(j['decisions'])) LoanDecision.fromJson(_map(d))],
  );
}

class LoanDecision {
  const LoanDecision({
    required this.approved,
    this.level = 1,
    this.levelLabel,
    this.actorName,
    this.reason,
    this.decidedAt,
  });
  final bool approved;

  /// 1 = Direktur, 2 = Owner (user decision 2026-10-24); an older server's single decision is level 1.
  final int level;
  final String? levelLabel;
  final String? actorName;
  final String? reason;
  final String? decidedAt;

  factory LoanDecision.fromJson(Map<String, dynamic> j) => LoanDecision(
    approved: j['decision'] != 'rejected',
    level: _int(j['level'], 1),
    levelLabel: _strN(j['levelLabel']),
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
    this.approvalLevel,
    this.submitterRole,
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
    this.repayableAmount = 0,
    this.repaymentNeedsApproval = false,
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

  /// User decision 2026-10-24: 1 = waiting for the Direktur, 2 = waiting for the Owner (pending only; null from an
  /// older server = the Direktur step).
  final int? approvalLevel;

  /// `pm` | `finance` — who submitted a manual loan (null: automatic loan or older server).
  final String? submitterRole;

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

  /// Highest amount of a NEW repayment: outstanding minus the repayments still pending / approved (older server: the
  /// outstanding).
  final int repayableAmount;

  /// Cash-backed loan: a repayment is a request (Direktur → Owner → Antrian Transfer), not an immediate record.
  final bool repaymentNeedsApproval;
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

  /// Waiting for the Owner (level 2) — else a pending loan waits for the Direktur.
  bool get waitingOwner => status == LoanStatus.pendingApproval && approvalLevel == 2;

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
    approvalLevel: _intN(j['approvalLevel']),
    submitterRole: _strN(j['submitterRole']),
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
    repayableAmount: _int(j['repayableAmount'] ?? j['outstanding']),
    repaymentNeedsApproval: j['repaymentNeedsApproval'] == true,
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

/// User decision 2026-10-24 `GET /project-loans/inbox`: loans AND cash-backed repayment requests waiting for the
/// caller's decision (Direktur level 1, Owner level 2). An older server answers the loans only.
class LoanInbox {
  const LoanInbox({this.loans = const [], this.repayments = const []});
  final List<Loan> loans;
  final List<LoanRepaymentInboxItem> repayments;

  int get count => loans.length + repayments.length;

  factory LoanInbox.fromJson(Map<String, dynamic> j) => LoanInbox(
    loans: [for (final i in _list(j['items'])) Loan.fromJson(_map(i))],
    repayments: [for (final r in _list(j['repayments'])) LoanRepaymentInboxItem.fromJson(_map(r))],
  );
}

/// One repayment request in the inbox (decided on the loan detail).
class LoanRepaymentInboxItem {
  const LoanRepaymentInboxItem({
    required this.id,
    required this.loanId,
    this.companyId,
    this.loanDocNo,
    this.lender,
    required this.borrower,
    required this.amount,
    this.plannedDate,
    this.note,
    this.approvalLevel,
    this.statusLabel = '',
    this.submittedBy,
    this.submittedAt,
  });
  final int id;
  final int loanId;
  final int? companyId;
  final String? loanDocNo;
  final LoanProjectRef? lender;
  final LoanProjectRef borrower;
  final int amount;
  final String? plannedDate;
  final String? note;
  final int? approvalLevel;
  final String statusLabel;
  final LoanUserRef? submittedBy;
  final String? submittedAt;

  factory LoanRepaymentInboxItem.fromJson(Map<String, dynamic> j) => LoanRepaymentInboxItem(
    id: _int(j['id']),
    loanId: _int(j['loanId']),
    companyId: _intN(j['companyId']),
    loanDocNo: _strN(j['loanDocNo']),
    lender: j['lenderProject'] is Map<String, dynamic> ? LoanProjectRef.fromJson(j['lenderProject']) : null,
    borrower: LoanProjectRef.fromJson(j['borrowerProject']),
    amount: _int(j['amount']),
    plannedDate: _strN(j['plannedDate']),
    note: _strN(j['note']),
    approvalLevel: _intN(j['approvalLevel']),
    statusLabel: '${j['statusLabel'] ?? ''}',
    submittedBy: LoanUserRef.fromJson(j['submittedBy']),
    submittedAt: _strN(j['submittedAt']),
  );
}

/// User decision 2026-10-24 `GET /project-loans/transfer-orders`: an approved cash-backed loan (`loan`: KK lender
/// account, KM borrower account) or repayment (`repayment`: KK borrower, KM lender) waiting in Finance's "Antrian
/// Transfer". Executed by Finance of the PT (`canExecute`); the submitter, when Finance, may execute it himself.
class LoanTransferOrder {
  const LoanTransferOrder({
    required this.kind,
    required this.id,
    required this.loanId,
    this.companyId,
    this.docNo,
    this.title = '',
    required this.amount,
    this.date,
    this.minDate,
    this.today,
    this.fromAccount,
    this.toAccount,
    this.fromProject,
    this.toProject,
    this.note,
    this.reason = '',
    this.submittedBy,
    this.approvedAt,
    this.selfSubmitted = false,
    this.canExecute = false,
  });

  /// `loan` | `repayment`.
  final String kind;

  /// Loan id (`loan`) or repayment id (`repayment`).
  final int id;
  final int loanId;
  final int? companyId;
  final String? docNo;
  final String title;
  final int amount;
  final String? date;

  /// Earliest execution date (the loan date) and the PT's business date (latest).
  final String? minDate;
  final String? today;
  final LoanAccountRef? fromAccount;
  final LoanAccountRef? toAccount;
  final LoanProjectRef? fromProject;
  final LoanProjectRef? toProject;
  final String? note;
  final String reason;
  final LoanUserRef? submittedBy;
  final String? approvedAt;
  final bool selfSubmitted;
  final bool canExecute;

  bool get repayment => kind == 'repayment';

  /// Unique within the list (a loan and a repayment may share an id).
  String get key => '$kind-$id';

  factory LoanTransferOrder.fromJson(Map<String, dynamic> j) => LoanTransferOrder(
    kind: '${j['kind'] ?? 'loan'}',
    id: _int(j['id']),
    loanId: _int(j['loanId'] ?? j['id']),
    companyId: _intN(j['companyId']),
    docNo: _strN(j['docNo']),
    title: '${j['title'] ?? ''}',
    amount: _int(j['amount']),
    date: _strN(j['date']),
    minDate: _strN(j['minDate']),
    today: _strN(j['today']),
    fromAccount: LoanAccountRef.fromJson(j['fromAccount']),
    toAccount: LoanAccountRef.fromJson(j['toAccount']),
    fromProject: j['fromProject'] is Map<String, dynamic> ? LoanProjectRef.fromJson(j['fromProject']) : null,
    toProject: j['toProject'] is Map<String, dynamic> ? LoanProjectRef.fromJson(j['toProject']) : null,
    note: _strN(j['note']),
    reason: '${j['reason'] ?? ''}',
    submittedBy: LoanUserRef.fromJson(j['submittedBy']),
    approvedAt: _strN(j['approvedAt']),
    selfSubmitted: j['selfSubmitted'] == true,
    canExecute: j['canExecute'] == true,
  );
}

class LoanTransferOrders {
  const LoanTransferOrders({this.items = const []});
  final List<LoanTransferOrder> items;

  factory LoanTransferOrders.fromJson(Map<String, dynamic> j) =>
      LoanTransferOrders(items: [for (final i in _list(j['items'])) LoanTransferOrder.fromJson(_map(i))]);
}

/// "Catat pengembalian" / "Ajukan pengembalian" checks (web RepaymentAction messages; the server re-checks).
/// [outstanding] is the highest amount allowed now (`Loan.repayableAmount`).
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
