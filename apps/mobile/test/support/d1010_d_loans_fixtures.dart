// ADR 0022 Pinjaman antar project: server JSON as `/api/v1/project-loans*` answers (openapi ProjectLoanSummary /
// ProjectLoanDetail / ProjectLoanOptions) and a fake LoansApi recording the calls.
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/loans/data/loans_api.dart';
import 'package:proyekkas/features/loans/domain/loan.dart';

const _labels = {
  'draft': 'Draft',
  'pending_approval': 'Menunggu persetujuan Direktur',
  'approved': 'Disetujui',
  'partially_repaid': 'Sebagian kembali',
  'repaid': 'Lunas',
  'rejected': 'Ditolak',
  'cancelled': 'Dibatalkan',
};

Map<String, dynamic> loanJson({
  int id = 41,
  String status = 'pending_approval',
  String? docNo = 'PJ/DRMS/2610/0001',
  List<String> actions = const [],
  bool overdue = false,
  int daysOverdue = 0,
  int amount = 150000000,
  int repaid = 0,
  bool samePm = false,
  String? g1Note,
  List<Map<String, dynamic>> repayments = const [],
  List<Map<String, dynamic>> decisions = const [],
  String? rejectReason,
}) => {
  'id': id,
  'uuid': 'u-$id',
  'companyId': 1,
  'docNo': status == 'draft' ? null : docNo,
  'status': status,
  'statusLabel': _labels[status],
  'overdue': overdue,
  'overdueLabel': overdue ? 'Terlambat' : null,
  'daysOverdue': daysOverdue,
  'kind': 'dana',
  'kindLabel': 'Dana',
  'lenderProject': {
    'id': 9,
    'code': 'PRJ-A',
    'name': 'Gudang Balikpapan',
    'pm': {'id': 7, 'name': 'Rudi Hartono'},
  },
  'borrowerProject': {
    'id': 10,
    'code': 'PRJ-B',
    'name': 'Jalan Tambang Blok B',
    'pm': {'id': 5, 'name': 'Doni Pratama'},
  },
  'amount': amount,
  'repaidTotal': repaid,
  'outstanding': ['rejected', 'cancelled'].contains(status) ? 0 : amount - repaid,
  'reason': 'Termin pertama klien B belum cair; upah pekerja minggu ini.',
  'loanDate': '2026-10-05',
  'dueDate': '2026-11-05',
  'samePm': samePm,
  'samePmNote': samePm ? 'PM peminjam = PM pemberi' : null,
  'g1Exception': g1Note == null ? null : 'direktur_self',
  'g1Note': g1Note,
  'createdBy': {'id': 5, 'name': 'Doni Pratama'},
  'submittedAt': status == 'draft' ? null : '2026-10-05T02:10:00.000Z',
  'decidedAt': decisions.isEmpty ? null : '2026-10-06T03:00:00.000Z',
  'decidedBy': null,
  'rejectReason': rejectReason,
  'cancelReason': null,
  'source': 'apk',
  'createdAt': '2026-10-05T02:00:00.000Z',
  'allowedActions': actions,
  'mayVoidRepayment': false,
  'repayments': repayments,
  'decisions': decisions,
};

Map<String, dynamic> repaymentJson(int id, {int? seq, int amount = 50000000, bool void_ = false}) => {
  'id': id,
  'seq': void_ ? null : seq,
  'repayDate': '2026-10-08',
  'amount': amount,
  'note': null,
  'status': void_ ? 'void' : 'posted',
  'statusLabel': void_ ? 'Dibatalkan (void)' : 'Tercatat',
  'voidReason': void_ ? 'Salah nominal' : null,
  'recordedBy': {'id': 3, 'name': 'Fina Keuangan'},
  'voidedBy': void_ ? {'id': 4, 'name': 'Dedi Direktur'} : null,
  'voidedAt': void_ ? '2026-10-09T01:00:00.000Z' : null,
  'createdAt': '2026-10-08T01:00:00.000Z',
};

Map<String, dynamic> decisionJson({bool approved = true}) => {
  'id': 1,
  'actor': {'id': 4, 'name': 'Dedi Direktur'},
  'decision': approved ? 'approved' : 'rejected',
  'reason': approved ? null : 'Pakai kas umum saja',
  'decidedAt': '2026-10-06T03:00:00.000Z',
  'signatureSource': 'profile',
};

/// Approved, partly repaid (one void), overdue.
Map<String, dynamic> loanApprovedJson() => loanJson(
  id: 42,
  status: 'partially_repaid',
  docNo: 'PJ/DRMS/2609/0003',
  repaid: 50000000,
  overdue: true,
  daysOverdue: 6,
  samePm: true,
  decisions: [decisionJson()],
  repayments: [repaymentJson(1, seq: 1), repaymentJson(2, amount: 20000000, void_: true)],
);

/// ADR 0031: a cash-backed manual loan approved by the Direktur, waiting for Finance's "Cairkan".
Map<String, dynamic> loanAwaitingJson({List<String> actions = const ['disburse']}) => {
  ...loanJson(id: 43, status: 'approved', docNo: 'PJ/DRMS/2610/0004', actions: actions, decisions: [decisionJson()]),
  'statusLabel': 'Disetujui – menunggu pencairan',
  'origin': 'manual',
  'originLabel': 'Diajukan PM',
  'lenderCashAccount': {'id': 3, 'name': 'Bank Mandiri Operasional'},
  'borrowerCashAccount': {'id': 4, 'name': 'Bank BRI Blok B'},
  'cashBacked': true,
  'disbursedAt': null,
  'disbursedBy': null,
  'awaitingDisbursement': true,
  'transfer': null,
  'disbursement': null,
};

/// ADR 0031: the automatic loan of a transfer paid from another account — no lender project, the paying account lends;
/// disbursed with the transfer (KK on the paying account, KM on the borrower's Pusat Biaya), one repayment with cash.
Map<String, dynamic> loanAutoJson({List<String> actions = const []}) => {
  ...loanJson(
    id: 44,
    status: 'partially_repaid',
    docNo: 'PJ/DRMS/2610/0007',
    actions: actions,
    repaid: 50000000,
    repayments: [
      {
        ...repaymentJson(1, seq: 1),
        'cash': {'kk': 'KK/DRMS/2610/0031', 'km': 'KM/DRMS/2610/0032'},
      },
    ],
  ),
  'lenderProject': null,
  'origin': 'transfer',
  'originLabel': 'Otomatis (transfer)',
  'lenderCashAccount': {'id': 4, 'name': 'Kas Kecil'},
  'borrowerCashAccount': {'id': 3, 'name': 'Bank Mandiri Operasional'},
  'cashBacked': true,
  'disbursedAt': '2026-10-05T02:10:00.000Z',
  'disbursedBy': {'id': 3, 'name': 'Fina Keuangan'},
  'awaitingDisbursement': false,
  'transfer': {'id': 77, 'docNo': 'TRF/DRMS/2610/0012'},
  'disbursement': {'kk': 'KK/DRMS/2610/0021', 'km': 'KM/DRMS/2610/0022'},
  'today': '2026-10-21',
};

/// The server's 409 when a loan's cash move would take the paying account below 0 (QA-04).
ProblemException loanOverdraft409() => ProblemException.fromJson(409, {
  'title': 'Conflict',
  'code': 'CASH_OVERDRAFT_CONFIRM_REQUIRED',
  'balance': 1000000,
  'after': -149000000,
});

LoanOptions loanOptionsFixture() => LoanOptions.fromJson({
  'borrowers': [
    {'id': 10, 'code': 'PRJ-B', 'name': 'Jalan Tambang Blok B', 'companyId': 1},
  ],
  'lenders': [
    {'id': 9, 'code': 'PRJ-A', 'name': 'Gudang Balikpapan', 'companyId': 1},
    {'id': 10, 'code': 'PRJ-B', 'name': 'Jalan Tambang Blok B', 'companyId': 1},
    {'id': 30, 'code': 'LAS-1', 'name': 'Proyek PT lain', 'companyId': 2},
  ],
});

class FakeLoansApi extends Fake implements LoansApi {
  final calls = <String>[];

  /// Idempotency keys of the "Cairkan" / repayment calls (a confirmed retry is another body → another key).
  final keys = <String>[];

  /// ADR 0031: answer the next "Cairkan" / repayment with a 409 overdraft (then succeed).
  bool overdraftFirst = false;

  @override
  Future<Loan> create({
    required int borrowerProjectId,
    required int lenderProjectId,
    required String kind,
    required int amount,
    required String reason,
    required String loanDate,
    required String dueDate,
    required bool submit,
    required String idempotencyKey,
  }) async {
    calls.add('create:$borrowerProjectId:$lenderProjectId:$kind:$amount:$dueDate:$submit');
    return Loan.fromJson(loanJson(status: submit ? 'pending_approval' : 'draft'));
  }

  @override
  Future<Loan> submit(int id, {required String idempotencyKey}) async {
    calls.add('submit:$id');
    return Loan.fromJson(loanJson(id: id));
  }

  @override
  Future<Loan> cancel(int id, {required String reason, required String idempotencyKey}) async {
    calls.add('cancel:$id:$reason');
    return Loan.fromJson(loanJson(id: id, status: 'cancelled'));
  }

  @override
  Future<Loan> approve(int id, {required String idempotencyKey}) async {
    calls.add('approve:$id');
    return Loan.fromJson(loanJson(id: id, status: 'approved'));
  }

  @override
  Future<Loan> reject(int id, {required String reason, required String idempotencyKey}) async {
    calls.add('reject:$id:$reason');
    return Loan.fromJson(loanJson(id: id, status: 'rejected'));
  }

  @override
  Future<Loan> addRepayment(
    int id, {
    required int amount,
    required String repayDate,
    String? note,
    bool confirmOverdraft = false,
    required String idempotencyKey,
  }) async {
    calls.add('repay:$id:$amount:$repayDate:${note ?? ''}${confirmOverdraft ? ':confirm' : ''}');
    keys.add(idempotencyKey);
    if (overdraftFirst) {
      overdraftFirst = false;
      throw loanOverdraft409();
    }
    return Loan.fromJson(loanApprovedJson());
  }

  @override
  Future<Loan> disburse(
    int id, {
    String? disburseDate,
    String? note,
    bool confirmOverdraft = false,
    required String idempotencyKey,
  }) async {
    calls.add('disburse:$id${confirmOverdraft ? ':confirm' : ''}');
    keys.add(idempotencyKey);
    if (overdraftFirst) {
      overdraftFirst = false;
      throw loanOverdraft409();
    }
    return Loan.fromJson({
      ...loanAwaitingJson(actions: const []),
      'statusLabel': 'Disetujui',
      'awaitingDisbursement': false,
      'disbursedAt': '2026-10-21T03:00:00.000Z',
      'disbursedBy': {'id': 3, 'name': 'Fina Keuangan'},
      'disbursement': {'kk': 'KK/DRMS/2610/0041', 'km': 'KM/DRMS/2610/0042'},
    });
  }

  @override
  Future<Loan> voidRepayment(int id, int repaymentId, {required String reason, required String idempotencyKey}) async {
    calls.add('void-repayment:$id:$repaymentId:$reason');
    return Loan.fromJson(loanApprovedJson());
  }
}
