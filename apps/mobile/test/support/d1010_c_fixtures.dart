import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/media/compress_plan.dart';
import 'package:proyekkas/core/media/photo_compressor.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/finance/data/finance_api.dart';
import 'package:proyekkas/features/finance/domain/transfer_queue.dart';
import 'package:proyekkas/features/projects/data/projects_api.dart';
import 'package:proyekkas/features/projects/domain/project.dart';

import 'fixtures.dart';

/// DRMS 10/10 Phase C fixtures (fictional): projects (`GET /projects`, `/projects/{id}`, `/projects/{id}/rap`),
/// project requests and the transfer queue — shaped after the web worktree contract (schemas-projects.ts,
/// TransferQueueItem).
Map<String, dynamic> projectJson(int id, {String status = 'berjalan', int? over}) => {
  'id': id,
  'code': 'PRJ-${id.toString().padLeft(2, '0')}',
  'name': id == 9 ? 'Jalan Tambang Blok B' : 'Proyek $id',
  'kind': 'konstruksi',
  'companyId': 1,
  'pm': {'id': 4, 'name': 'Rudi Hartono'},
  'status': status,
  'statusLabel': ProjectStatus.labelOf(status),
  'contractValue': 2500000000,
  'progressPct': 42.5,
  'costCenter': {'id': 7, 'code': 'OPS-PB', 'name': 'Ops Palangka Banjar'},
  'rapPlanned': 1800000000,
  'rapRealised': 810000000,
  'rapPercent': 45,
  'rapOverBudgetItems': over ?? 0,
  'rapItems': 12,
};

Map<String, dynamic> projectDetailJson() => {
  ...projectJson(9, over: 1),
  'client': {'id': 3, 'name': 'PT Batu Bara Sejahtera'},
  'address': 'Km 12, Palangka Raya',
  'startDate': '2026-07-01',
  'targetDate': '2027-03-31',
  'rap': {
    'items': 3,
    'planned': 22000000,
    'realised': 15700000,
    'transferred': 15000000,
    'verified': 12000000,
    'remaining': 6300000,
    'percent': 71.36,
    'overBudgetItems': 1,
  },
};

const rapItemsFixture = [
  RapBudgetItem(
    id: 501,
    code: 'A.1',
    name: 'Solar alat berat',
    uom: 'liter',
    qty: 1000,
    planned: 15000000,
    realised: 16200000,
    remaining: -1200000,
    percent: 108,
  ),
  RapBudgetItem(
    id: 502,
    code: 'A.2',
    name: 'Akomodasi tim',
    uom: 'malam',
    qty: 50,
    planned: 5000000,
    realised: 1000000,
    remaining: 4000000,
    percent: 20,
  ),
  RapBudgetItem(
    id: 503,
    code: 'A.3',
    name: 'Konsumsi lapangan',
    uom: 'ls',
    qty: 1,
    planned: 2000000,
    realised: 0,
    remaining: 2000000,
    percent: 0,
  ),
];

Map<String, dynamic> queueJson(
  int id, {
  String type = 'reimburse',
  bool over = false,
  int mismatch = 0,
  bool verified = true,
  Map<String, dynamic>? costCenter = const {'id': 7, 'code': 'OPS-PB', 'name': 'Ops Palangka Banjar'},
}) => {
  'id': id,
  'docNo': 'PB/DRMS/2610/${id.toString().padLeft(4, '0')}',
  'type': type,
  'typeLabel': type == 'advance' ? 'Pengajuan Baru' : 'Reimburse',
  'status': type == 'advance' ? 'approved' : 'receipts_verified',
  'statusLabel': type == 'advance' ? 'Disetujui (Antri Transfer)' : 'Nota Terverifikasi (Antri Transfer)',
  'title': id == 42 ? 'Service Tronton' : 'Pengajuan $id',
  'grandTotal': 1447500,
  'approvedAmount': 1447500,
  'neededDate': '2026-10-12',
  'companyId': 1,
  'openWarningFlags': 1,
  'project': {'id': 9, 'code': 'PRJ-09', 'name': 'Jalan Tambang Blok B'},
  'costCenter': costCenter,
  'bank': {'bankName': 'Mandiri', 'accountNo': '•••0123', 'accountHolder': 'Doni Pratama'},
  'bankVerification': verified ? 'verified' : 'unverified',
  'flags': {'warning': 1, 'info': 0, 'receiptMismatch': mismatch},
  'sla': {'approvedAt': '2026-10-10T02:00:00Z', 'slaHours': 24, 'ageHours': over ? 30.5 : 5.2, 'over': over},
};

List<TransferQueueItem> queueFixture() => [
  transferQueueItemFromJson(queueJson(42, over: true, mismatch: 2)),
  transferQueueItemFromJson(queueJson(43, type: 'advance', costCenter: null, verified: false)),
];

class FakeProjectsApi extends Fake implements ProjectsApi {
  FakeProjectsApi({this.noMoney = false});

  /// Answer like the server answers a Staff (owner decision 2026-10-11): no contract value, no RAP money.
  final bool noMoney;
  final listCalls = <({String q, String? status, int page})>[];
  final requestCalls = <({int projectId, String q, String? status, bool mine, int page})>[];
  int totalPages = 2;

  @override
  Future<PageResult<ProjectSummary>> list({String q = '', String? status, int page = 1}) async {
    listCalls.add((q: q, status: status, page: page));
    final ids = page == 1 ? [9, 10] : [11];
    return pageFromJson(
      {
        'docs': [
          for (final id in ids)
            if (q.isEmpty ||
                'prj-${id.toString().padLeft(2, '0')} ${projectJson(id)['name']}'.toLowerCase().contains(
                  q.toLowerCase(),
                ))
              projectJson(id, status: status ?? 'berjalan', over: id == 9 ? 1 : 0),
        ],
        'totalDocs': 3,
        'page': page,
        'totalPages': totalPages,
      },
      projectFromJson,
      page: page,
    );
  }

  @override
  Future<ProjectDetail> detail(int id) async => projectDetailFromJson(
    noMoney
        ? {
            ...projectDetailJson(),
            'contractValue': null,
            'rapPlanned': null,
            'rapRealised': null,
            'rapPercent': null,
            'rapOverBudgetItems': null,
            'rap': {
              'items': 3,
              'planned': null,
              'realised': null,
              'transferred': null,
              'verified': null,
              'remaining': null,
              'percent': null,
              'overBudgetItems': null,
            },
          }
        : projectDetailJson(),
  );

  @override
  Future<List<RapBudgetItem>> rap(int projectId) async => rapItemsFixture;

  @override
  Future<PageResult<ExpenseSummary>> requests(
    int projectId, {
    String q = '',
    String? status,
    bool mine = false,
    int page = 1,
    String? cursor,
  }) async {
    requestCalls.add((projectId: projectId, q: q, status: status, mine: mine, page: page));
    final base = detailJson(status: 'approved');
    final items = [
      {...base, 'id': 42, 'title': 'Service Tronton', 'status': 'approved', 'statusLabel': 'Disetujui'},
      {
        ...base,
        'id': 44,
        'docNo': 'PB/DRMS/2610/0044',
        'title': 'Solar genset',
        'status': 'draft',
        'statusLabel': 'Draft',
      },
    ].where((j) => status == null || j['status'] == status).toList();
    return pageFromJson(
      {'items': items, 'nextCursor': null, 'page': 1, 'totalPages': 1, 'totalDocs': items.length},
      summaryFromJson,
      page: page,
    );
  }
}

class FakeFinanceApi extends Fake implements FinanceApi {
  final transfers = <({int id, Map<String, dynamic> body, String key})>[];
  int uploads = 0;

  /// Codes of 409 confirmations to answer first (e.g. BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED).
  final confirmFirst = <String>[];

  @override
  Future<List<TransferQueueItem>> transferQueue() async => queueFixture();

  @override
  Future<List<CashAccountOption>> cashAccounts(int? companyId) async => const [
    CashAccountOption(id: 3, name: 'Bank Mandiri Operasional', companyId: 1, balance: 52000000),
    CashAccountOption(id: 4, name: 'Kas Kecil', companyId: 1, balance: 1500000),
  ];

  @override
  Future<List<CostCenterOption>> costCenters(int? companyId, {String q = ''}) async => const [
    CostCenterOption(id: 7, code: 'OPS-PB', name: 'Ops Palangka Banjar', companyId: 1),
    CostCenterOption(id: 8, code: 'WS-PR', name: 'Workshop Palangka Raya', companyId: 1),
  ];

  @override
  Future<int> uploadProof(Uint8List bytes, {required String filename}) async {
    uploads++;
    return 9001;
  }

  @override
  Future<ExpenseDetail> recordTransfer(
    int requestId,
    Map<String, dynamic> body, {
    required String idempotencyKey,
  }) async {
    transfers.add((id: requestId, body: body, key: idempotencyKey));
    if (confirmFirst.isNotEmpty) {
      final code = confirmFirst.removeAt(0);
      throw problem409(code);
    }
    return detailFromJson({
      ...detailJson(status: 'transferred', allowed: const []),
      'transfers': [
        {'id': 1, 'docNo': 'TRF/DRMS/2610/0001', 'kind': 'reimburse', 'amount': 1447500, 'status': 'posted'},
      ],
    });
  }
}

/// A confirmable 409 as the server sends it (QA-04 / QA-17).
ProblemException problem409(String code) => ProblemException.fromJson(409, {
  'title': 'Conflict',
  'code': code,
  if (code == 'CASH_OVERDRAFT_CONFIRM_REQUIRED') ...{'balance': 1000000, 'after': -447500},
  if (code == 'BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED') ...{
    'bankName': 'Mandiri',
    'accountNo': '•••0123',
    'accountHolder': 'Doni Pratama',
  },
});

class FakeCompressor implements PhotoCompressor {
  @override
  Future<CompressedPhoto> compress(Uint8List raw, PhotoTarget target) async => CompressedPhoto(raw, 'sha');
}
