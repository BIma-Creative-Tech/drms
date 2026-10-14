import '../../../core/format/rupiah.dart';
import '../../../core/network/api_exception.dart';
import '../../expense/domain/fund_check.dart';
import '../../expense/domain/intercompany.dart' show intercompanyNoAccountCode, intercompanyPeriodClosedCode;

// ADR 0029 "Pinjaman antar-PT" (`PJA/{LENDER}/{YY}{MM}/####`) on the APK (openapi `IntercompanyLoanSummary` /
// `IntercompanyLoanDetail` / `IntercompanyLoanQueue` / `IntercompanyLenderOptions`). The Owner instructs (his instruction
// is the decision); Finance of the LENDER disburses (KK in the lender, automatic KM in the borrower — never the
// instruction's creator, G1); repayments, cancel and both voids stay on the web in this phase (read-only here). Parsing
// is tolerant (unknown fields ignored, missing ones defaulted). Online only.

int _int(Object? v, [int fallback = 0]) =>
    v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? fallback : fallback);
int? _intN(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
String? _strN(Object? v) => v == null ? null : '$v';
Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
Map<String, dynamic>? _mapN(Object? v) => v is Map<String, dynamic> ? v : null;
List<dynamic> _list(Object? v) => v is List ? v : const [];

/// `intercompany_loans.status` (§3.3).
enum IcLoanStatus {
  instructed('instructed'),
  disbursed('disbursed'),
  partiallyRepaid('partially_repaid'),
  repaid('repaid'),
  cancelled('cancelled');

  const IcLoanStatus(this.code);
  final String code;

  static IcLoanStatus fromCode(String? c) =>
      IcLoanStatus.values.where((s) => s.code == c).firstOrNull ?? IcLoanStatus.instructed;

  /// Web `IC_LOAN_STATUS_LABELS` (the server also sends `statusLabel`).
  String get label => icLoanStatusLabel(code);

  /// Money has moved (repaid / outstanding are meaningful).
  bool get active => this == disbursed || this == partiallyRepaid || this == repaid;
}

/// `allowedActions` of the loan detail. Only [disburse] is an APK action in this phase; the others are web-only.
enum IcLoanAction {
  cancel('cancel'),
  disburse('disburse'),
  voidDisbursement('void_disbursement'),
  repay('repay'),
  voidRepayment('void_repayment');

  const IcLoanAction(this.code);
  final String code;

  static IcLoanAction? fromCode(String c) => IcLoanAction.values.where((a) => a.code == c).firstOrNull;
}

/// A PT reference `{id, shortCode, name}`.
class IcCompanyRef {
  const IcCompanyRef({required this.id, required this.shortCode, this.name = ''});
  final int id;
  final String shortCode;
  final String name;

  /// "LAS — PT Contoh Lestari".
  String get label => [shortCode, name].where((e) => e.isNotEmpty).join(' — ');

  static IcCompanyRef? fromJson(Object? v) {
    final j = _mapN(v);
    final id = _intN(j?['id']);
    if (j == null || id == null) return null;
    return IcCompanyRef(id: id, shortCode: _strN(j['shortCode'] ?? j['code']) ?? '#$id', name: _strN(j['name']) ?? '');
  }

  @override
  bool operator ==(Object other) =>
      other is IcCompanyRef && other.id == id && other.shortCode == shortCode && other.name == name;

  @override
  int get hashCode => Object.hash(id, shortCode, name);
}

/// The borrower's designated receiving account (masked; queue item `destination`).
class IcLoanDestination {
  const IcLoanDestination({this.bankName, this.accountNoMasked, this.accountHolder = ''});
  final String? bankName;
  final String? accountNoMasked;
  final String accountHolder;

  /// "Mandiri · ••••4321 · PT Contoh Lestari".
  String get text => [?bankName, ?accountNoMasked, accountHolder].where((e) => e.isNotEmpty).join(' · ');

  static IcLoanDestination? fromJson(Object? v) {
    final j = _mapN(v);
    if (j == null) return null;
    return IcLoanDestination(
      bankName: _strN(j['bankName']),
      accountNoMasked: _strN(j['accountNoMasked']),
      accountHolder: _strN(j['accountHolder']) ?? '',
    );
  }
}

/// A request of the borrower PT linked to the loan (informational). Title / status / total only for the borrower's
/// people.
class IcLoanRequestRef {
  const IcLoanRequestRef({required this.id, this.docNo, this.title, this.statusLabel, this.grandTotal});
  final int id;
  final String? docNo;
  final String? title;
  final String? statusLabel;
  final int? grandTotal;

  String get label => docNo ?? '#$id';

  factory IcLoanRequestRef.fromJson(Map<String, dynamic> j) => IcLoanRequestRef(
    id: _int(j['id']),
    docNo: _strN(j['docNo']),
    title: _strN(j['title']),
    statusLabel: _strN(j['statusLabel']),
    grandTotal: _intN(j['grandTotal']),
  );
}

/// One money movement of a loan: "Pencairan" or "Pengembalian ke-n" with its KK (paying PT) / KM (receiving PT).
class IcLoanMovement {
  const IcLoanMovement({
    required this.id,
    required this.kind,
    required this.label,
    required this.amount,
    required this.transferDate,
    this.transferAt,
    this.bankRef,
    this.posted = true,
    this.voidReason,
    this.fromAccountName,
    this.toAccountName,
    this.toAccountNoMasked,
    this.kkNo,
    this.kmNo,
    this.executedByName,
    this.voidedByName,
  });

  final int id;

  /// disbursement | repayment
  final String kind;
  final String label;
  final int amount;
  final String transferDate;
  final String? transferAt;

  /// Paying-side readers only.
  final String? bankRef;
  final bool posted;
  final String? voidReason;
  final String? fromAccountName;
  final String? toAccountName;
  final String? toAccountNoMasked;
  final String? kkNo;
  final String? kmNo;
  final String? executedByName;
  final String? voidedByName;

  bool get isDisbursement => kind == 'disbursement';

  factory IcLoanMovement.fromJson(Map<String, dynamic> j) => IcLoanMovement(
    id: _int(j['id']),
    kind: '${j['kind'] ?? 'disbursement'}',
    label: _strN(j['label']) ?? (j['kind'] == 'repayment' ? 'Pengembalian' : 'Pencairan'),
    amount: _int(j['amount']),
    transferDate: '${j['transferDate'] ?? ''}',
    transferAt: _strN(j['transferAt']),
    bankRef: _strN(j['bankRef']),
    posted: j['status'] != 'void',
    voidReason: _strN(j['voidReason']),
    fromAccountName: _strN(_mapN(j['fromAccount'])?['name']),
    toAccountName: _strN(_mapN(j['toAccount'])?['name']),
    toAccountNoMasked: _strN(_mapN(j['toAccount'])?['accountNoMasked']),
    kkNo: _strN(_mapN(j['kk'])?['entryNo']),
    kmNo: _strN(_mapN(j['km'])?['entryNo']),
    executedByName: _strN(_mapN(j['executedBy'])?['name']),
    voidedByName: _strN(_mapN(j['voidedBy'])?['name']),
  );
}

/// A loan: the summary fields (list / queue) plus the detail fields when read from `GET /intercompany-loans/{id}`, and
/// the queue fields (`canDisburse`, `g1Note`, `destination`) when read from `GET /intercompany-loans/queue`.
class IcLoan {
  const IcLoan({
    required this.id,
    required this.docNo,
    required this.status,
    required this.statusLabel,
    this.overdue = false,
    this.overdueLabel,
    this.daysOverdue = 0,
    this.lender,
    this.borrower,
    required this.amount,
    this.repaidTotal = 0,
    this.outstanding = 0,
    required this.instructionDate,
    required this.dueDate,
    this.reason = '',
    this.createdByName,
    this.side,
    this.cancelReason,
    this.cancelledAt,
    this.cancelledByName,
    this.ownRequestNote,
    this.droppedRequestNote,
    this.lenderHasReceivingAccount = true,
    this.requests = const [],
    this.movements = const [],
    this.allowedActions = const {},
    this.disburseBlockedByG1 = false,
    this.canDisburse,
    this.g1Note,
    this.destination,
  });

  final int id;
  final String docNo;
  final IcLoanStatus status;
  final String statusLabel;

  /// Derived "Terlambat" (server): due date before today, outstanding > 0, disbursed / partially repaid.
  final bool overdue;
  final String? overdueLabel;
  final int daysOverdue;
  final IcCompanyRef? lender;
  final IcCompanyRef? borrower;
  final int amount;
  final int repaidTotal;

  /// amount − posted repayments once disbursed; 0 while instructed / cancelled.
  final int outstanding;
  final String instructionDate;
  final String dueDate;
  final String reason;
  final String? createdByName;

  /// The caller's side: lender (piutang antar-PT), borrower (hutang antar-PT), both.
  final String? side;
  final String? cancelReason;
  final String? cancelledAt;
  final String? cancelledByName;
  final String? ownRequestNote;
  final String? droppedRequestNote;
  final bool lenderHasReceivingAccount;
  final List<IcLoanRequestRef> requests;
  final List<IcLoanMovement> movements;
  final Set<IcLoanAction> allowedActions;

  /// The caller is Finance of the lender AND the instruction's creator (G1: someone else disburses).
  final bool disburseBlockedByG1;

  /// Queue only: false for the instruction's creator (G1); null when read from the detail.
  final bool? canDisburse;
  final String? g1Note;

  /// Queue only: the borrower's designated receiving account (null = none designated → the disbursement is refused).
  final IcLoanDestination? destination;

  String get lenderCode => lender?.shortCode ?? '-';
  String get borrowerCode => borrower?.shortCode ?? '-';
  String get label => statusLabel.isEmpty ? status.label : statusLabel;

  /// The posted disbursement (KK / KM numbers after "Catat pencairan").
  IcLoanMovement? get disbursement => movements.where((m) => m.isDisbursement && m.posted).lastOrNull;

  factory IcLoan.fromJson(Map<String, dynamic> j) {
    final status = IcLoanStatus.fromCode(_strN(j['status']));
    return IcLoan(
      id: _int(j['id']),
      docNo: _strN(j['docNo']) ?? '#${j['id']}',
      status: status,
      statusLabel: _strN(j['statusLabel']) ?? status.label,
      overdue: j['overdue'] == true,
      overdueLabel: _strN(j['overdueLabel']),
      daysOverdue: _int(j['daysOverdue']),
      lender: IcCompanyRef.fromJson(j['lender']),
      borrower: IcCompanyRef.fromJson(j['borrower']),
      amount: _int(j['amount']),
      repaidTotal: _int(j['repaidTotal']),
      outstanding: _int(j['outstanding']),
      instructionDate: '${j['instructionDate'] ?? ''}',
      dueDate: '${j['dueDate'] ?? ''}',
      reason: '${j['reason'] ?? ''}',
      createdByName: _strN(_mapN(j['createdBy'])?['name']),
      side: _strN(j['side']),
      cancelReason: _strN(j['cancelReason']),
      cancelledAt: _strN(j['cancelledAt']),
      cancelledByName: _strN(_mapN(j['cancelledBy'])?['name']),
      ownRequestNote: _strN(j['ownRequestNote']),
      droppedRequestNote: _strN(j['droppedRequestNote']),
      lenderHasReceivingAccount: j['lenderHasReceivingAccount'] != false,
      requests: [for (final r in _list(j['requests'])) IcLoanRequestRef.fromJson(_map(r))],
      movements: [for (final m in _list(j['movements'])) IcLoanMovement.fromJson(_map(m))],
      allowedActions: {for (final a in _list(j['allowedActions'])) ?IcLoanAction.fromCode('$a')},
      disburseBlockedByG1: j['disburseBlockedByG1'] == true,
      canDisburse: j['canDisburse'] is bool ? j['canDisburse'] as bool : null,
      g1Note: _strN(j['g1Note']),
      destination: IcLoanDestination.fromJson(j['destination']),
    );
  }
}

/// `GET /intercompany-loans/queue`: instructed loans waiting for the caller's (lender) Finance PTs.
class IcLoanQueue {
  const IcLoanQueue({this.items = const [], this.count = 0});
  final List<IcLoan> items;
  final int count;

  factory IcLoanQueue.fromJson(Map<String, dynamic> j) {
    final items = [for (final i in _list(j['items'])) IcLoan.fromJson(_map(i))];
    return IcLoanQueue(items: items, count: _intN(j['count']) ?? items.length);
  }
}

/// A request of the borrower PT waiting at its final decision (`borrower.waiting[]`).
class IcWaitingRequest {
  const IcWaitingRequest({required this.id, this.docNo, this.title = '', required this.needed, this.gap = 0});
  final int id;
  final String? docNo;
  final String title;
  final int needed;

  /// Kurang of this request alone against the borrower's availability.
  final int gap;

  String get label => docNo ?? '#$id';

  factory IcWaitingRequest.fromJson(Map<String, dynamic> j) => IcWaitingRequest(
    id: _int(j['id']),
    docNo: _strN(j['docNo']),
    title: '${j['title'] ?? ''}',
    needed: _int(j['needed']),
    gap: _int(j['gap']),
  );
}

/// "Dana tersedia" of the borrower PT (`borrower` of the lender options).
class IcBorrowerFunds {
  const IcBorrowerFunds({
    this.company,
    this.balance = 0,
    this.commitments = 0,
    this.available = 0,
    this.fundCheckEnabled = false,
    this.hasReceivingAccount = true,
    this.waiting = const [],
    this.gapAll = 0,
  });
  final IcCompanyRef? company;
  final int balance;
  final int commitments;
  final int available;
  final bool fundCheckEnabled;

  /// false → the instruction is refused (400 INTERCOMPANY_NO_ACCOUNT).
  final bool hasReceivingAccount;
  final List<IcWaitingRequest> waiting;

  /// "Hitung untuk semua pengajuan yang menunggu": Σ needed − available (≥ 0).
  final int gapAll;

  factory IcBorrowerFunds.fromJson(Map<String, dynamic> j) => IcBorrowerFunds(
    company: IcCompanyRef.fromJson(j['company']),
    balance: _int(j['balance']),
    commitments: _int(j['commitments']),
    available: _int(j['available']),
    fundCheckEnabled: j['fundCheckEnabled'] == true,
    hasReceivingAccount: j['hasReceivingAccount'] != false,
    waiting: [for (final w in _list(j['waiting'])) IcWaitingRequest.fromJson(_map(w))],
    gapAll: _int(j['gapAll']),
  );
}

/// One lender candidate: another active PT where the caller is Owner, with its "Dana tersedia".
class IcLenderOption {
  const IcLenderOption({
    required this.company,
    this.balance = 0,
    this.commitments = 0,
    required this.available,
    this.sufficient = false,
    this.hasReceivingAccount = true,
    this.warning,
  });
  final IcCompanyRef company;
  final int balance;
  final int commitments;
  final int available;

  /// Server: available ≥ the amount of the query.
  final bool sufficient;
  final bool hasReceivingAccount;

  /// "Pengembalian belum dapat dicatat sampai PT ini menetapkan rekening penerimaan antar-PT." (repayments need it).
  final String? warning;

  /// Same rule as the server's `sufficient` for an amount typed in the form (the list is fetched once): available ≥
  /// amount; without an amount, available > 0.
  bool sufficientFor(int? amount) => amount == null || amount <= 0 ? available > 0 : available >= amount;

  factory IcLenderOption.fromJson(Map<String, dynamic> j) {
    final c = IcCompanyRef.fromJson(j['company']);
    return IcLenderOption(
      company: c ?? const IcCompanyRef(id: 0, shortCode: '-'),
      balance: _int(j['balance']),
      commitments: _int(j['commitments']),
      available: _int(j['available']),
      sufficient: j['sufficient'] == true,
      hasReceivingAccount: j['hasReceivingAccount'] != false,
      warning: _strN(j['warning']),
    );
  }
}

/// `GET /intercompany-loans/lenders?borrower=&amount=` (Owner only).
class IcLenderOptions {
  const IcLenderOptions({required this.borrower, required this.defaultDueDate, this.lenders = const []});
  final IcBorrowerFunds borrower;

  /// Today (borrower PT) + 30 days.
  final String defaultDueDate;
  final List<IcLenderOption> lenders;

  factory IcLenderOptions.fromJson(Map<String, dynamic> j) => IcLenderOptions(
    borrower: IcBorrowerFunds.fromJson(_map(j['borrower'])),
    defaultDueDate: '${j['defaultDueDate'] ?? ''}',
    lenders: [
      for (final l in _list(j['lenders']))
        if (IcCompanyRef.fromJson(_map(l)['company']) != null) IcLenderOption.fromJson(_map(l)),
    ],
  );
}

/// Sanity bound of the amount (Rp 1 T, `MAX_IC_LOAN_AMOUNT`).
const maxIcLoanAmount = 1000000000000;

/// Client checks of the instruction form (the server re-checks every one; same texts as the web form).
Map<String, String> validateIcLoanInstruction({
  required int? lenderId,
  required int? amount,
  required String? dueDate,
  required String reason,
  required String today,
  IcLenderOption? lender,
  bool borrowerHasReceivingAccount = true,
}) => {
  if (!borrowerHasReceivingAccount) 'borrower': 'PT peminjam belum menetapkan rekening penerimaan antar-PT.',
  if (lenderId == null)
    'lender': 'Pilih PT pemberi.'
  else if (lender != null && amount != null && amount > 0 && !lender.sufficientFor(amount))
    'lender': 'Dana tersedia PT ${lender.company.shortCode} ${formatRupiah(lender.available)} — kurang untuk pinjaman ini.',
  if (amount == null || amount <= 0)
    'amount': 'Nilai harus lebih dari 0.'
  else if (amount > maxIcLoanAmount)
    'amount': 'Nilai maksimal Rp 1 triliun.',
  if (dueDate == null || dueDate.isEmpty)
    'dueDate': 'Jatuh tempo wajib diisi.'
  else if (dueDate.compareTo(today) < 0)
    'dueDate': 'Jatuh tempo tidak boleh sebelum tanggal perintah.',
  if (reason.trim().length < 3)
    'reason': 'Alasan wajib diisi, minimal 3 karakter.'
  else if (reason.trim().length > 1000)
    'reason': 'Alasan maksimal 1000 karakter.',
};

/// Body of `POST /intercompany-loans` (openapi `IntercompanyLoanCreate`).
Map<String, dynamic> icLoanCreateBody({
  required int borrowerCompanyId,
  required int lenderCompanyId,
  required int amount,
  required String dueDate,
  required String reason,
  List<int> requestIds = const [],
}) => {
  'borrowerCompanyId': borrowerCompanyId,
  'lenderCompanyId': lenderCompanyId,
  'amount': amount,
  'dueDate': dueDate,
  'reason': reason.trim(),
  if (requestIds.isNotEmpty) 'requestIds': [...{...requestIds}],
};

/// Body of `POST /intercompany-loans/{id}/disburse` (openapi `IntercompanyLoanDisburse`): the amount is never sent (one
/// disbursement of the loan amount); the destination is the borrower's designated receiving account.
Map<String, dynamic> icLoanDisburseBody({
  required int cashAccountId,
  required String transferAt,
  required String bankRef,
  required int proofMediaId,
  bool confirmOverdraft = false,
}) => {
  'cashAccountId': cashAccountId,
  'transferAt': transferAt,
  'bankRef': bankRef.trim(),
  'proofMediaId': proofMediaId,
  if (confirmOverdraft) 'confirmOverdraft': true,
};

/// Machine codes of the loan refusals (openapi; `loan-rules.ts`).
const loanLenderInsufficientCode = 'LOAN_LENDER_INSUFFICIENT';
const loanHasRepaymentsCode = 'LOAN_HAS_REPAYMENTS';
const loanVoidBorrowerShortfallCode = 'LOAN_VOID_BORROWER_SHORTFALL_CONFIRM_REQUIRED';
const loanRepaymentExceedsOutstandingCode = 'LOAN_REPAYMENT_EXCEEDS_OUTSTANDING';

int? _numN(Object? v) => v is num ? v.toInt() : null;

/// Indonesian message of a loan refusal (instruction, disbursement — and the web-only steps, should a server answer
/// them here), null for any other problem (then [ProblemException.message]). The server's sentence names the PT and
/// the figures, so it wins when it is a real sentence; the local texts are the fallback for a body with the code and
/// figures only. `FUND_INSUFFICIENT` (a repayment) goes through [fundProblemMessage].
String? icLoanProblemMessage(ProblemException e) {
  final server = serverSentence(e.detail) ?? serverSentence(e.title);
  final b = e.body;
  String rp(Object? v) => formatRupiah(_numN(v) ?? 0);
  switch (e.code) {
    case fundInsufficientCode:
      return fundProblemMessage(e);
    case loanLenderInsufficientCode:
      if (server != null) return server;
      return b['available'] is num
          ? 'Dana tersedia PT pemberi ${rp(b['available'])} — kurang ${rp(b['gap'])} untuk pinjaman ${rp(b['needed'])}. '
                'Pilih PT lain atau kurangi nilainya.'
          : 'Dana tersedia PT pemberi tidak cukup untuk pinjaman ini. Pilih PT lain atau kurangi nilainya.';
    case loanHasRepaymentsCode:
      return server ??
          'Pinjaman sudah punya pengembalian — batalkan pengembaliannya dulu (Finance PT peminjam), atau catat '
              'pengembalian sisa.';
    case loanVoidBorrowerShortfallCode:
      return server ??
          'Dana tersedia PT peminjam menjadi ${rp(b['after'])} sesudah pencairan dibatalkan. Konfirmasi di web untuk '
              'tetap membatalkan.';
    case loanRepaymentExceedsOutstandingCode:
      return server ?? 'Pengembalian ${rp(b['amount'])} melebihi sisa pinjaman ${rp(b['outstanding'])}.';
    case intercompanyNoAccountCode:
      return server ??
          'PT peminjam belum menetapkan rekening penerimaan antar-PT — pinjaman tidak dapat diterima. Minta Finance / '
              'Admin PT itu menandai rekening penerimaannya.';
    case intercompanyPeriodClosedCode:
      final lock = b['lockDate'] is String ? ' (tutup buku s/d ${b['lockDate']})' : '';
      return server ??
          'Periode PT penerima sudah ditutup$lock. Pencairan tidak dapat dicatat pada tanggal ini — catat dengan tanggal '
              'di periode terbuka, atau minta Direktur PT itu membuka kembali periodenya.';
  }
  return null;
}

/// [error] as text: a loan / fund refusal in its own words, else the usual API message.
String icLoanAwareError(Object error, String Function(Object) fallback) =>
    (error is ProblemException ? icLoanProblemMessage(error) : null) ?? fallback(error);
