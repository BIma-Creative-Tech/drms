import 'fixtures.dart';

/// DRMS 13/10 Phase C (ADR 0029) payloads shaped after packages/api-contract/openapi.json (`ExpenseRequestDetail.fundCheck`,
/// `IntercompanyLoanDetail`, `IntercompanyLoanQueue`, `IntercompanyLenderOptions`, problem FUND_INSUFFICIENT). Fictional
/// PTs (DRMS = PT Contoh Dirgantara, LAS = PT Contoh Lestari, MKS = PT Contoh Makmur) and numbers.

/// The request (42, Rp 1.447.500) waits at the Owner level of PT DRMS; DRMS has Rp 1.000.000 available → short Rp 447.500.
/// [loanStatusLabel] = the linked loan's server `statusLabel` (null: an older server, the code only).
Map<String, dynamic> fundCheckJson({
  bool blocked = true,
  bool enabled = true,
  bool applies = true,
  String? loanStatusLabel = 'Menunggu pencairan',
}) => {
  'companyId': 1,
  'company': {'id': 1, 'shortCode': 'DRMS', 'name': 'PT Contoh Dirgantara'},
  'enabled': enabled,
  'applies': applies,
  'status': 'insufficient',
  'blocked': blocked,
  'blockedText': blocked ? 'Dana PT tidak cukup — kurang Rp 447.500. Tolak, atau perintahkan pinjaman antar-PT.' : null,
  'balance': 5000000,
  'commitments': 4000000,
  'available': 1000000,
  'needed': 1447500,
  'gap': 447500,
  'accountCount': 2,
  'excludedSiteAccounts': {'count': 1, 'balance': 750000},
  'waitingAtOwner': {'count': 1, 'amount': 2500000},
  'commitmentItems': [
    {'kind': 'request', 'id': 39, 'docNo': 'PB/DRMS/2610/0009', 'amount': 3000000, 'status': 'approved'},
    {'kind': 'loan', 'id': 5, 'docNo': 'PJA/DRMS/2610/0001', 'amount': 1000000, 'status': 'instructed'},
  ],
  'loans': [
    {
      'id': 77,
      'docNo': 'PJA/LAS/2610/0002',
      'status': 'instructed',
      'statusLabel': ?loanStatusLabel,
      'amount': 500000,
      'lender': {'id': 2, 'shortCode': 'LAS'},
    },
  ],
};

/// ADR 0031 amendment (user 2026-10-22, "PB dulu, lalu PT"): the same request of a project mapped to the Pusat Biaya
/// "CSR SEPASO/KUTIM" (cash account 12). [route]: pusat_biaya = its Dana bebas Rp 2.500.000 covers the Rp 1.447.500;
/// other_account = Dana bebas Rp 400.000, the PT's Rp 2.000.000 covers it; short = Dana bebas Rp 400.000 and the PT's
/// Rp 1.000.000 → short Rp 447.500 (against the larger figure).
Map<String, dynamic> fundCheckPbJson({String route = 'pusat_biaya'}) {
  final pbAvailable = route == 'pusat_biaya' ? 2500000 : 400000;
  final ptAvailable = route == 'other_account' ? 2000000 : 1000000;
  final short = route == 'short';
  return {
    ...fundCheckJson(blocked: short),
    'status': short ? 'insufficient' : 'ok',
    'blockedText': short
        ? 'Dana pusat biaya CSR SEPASO/KUTIM maupun dana PT tidak cukup — kurang Rp 447.500. Tolak, atau perintahkan '
              'pinjaman antar-PT.'
        : null,
    'available': ptAvailable,
    'gap': short ? 447500 : 0,
    'loans': const [],
    'route': route,
    'routeText': switch (route) {
      'pusat_biaya' => 'Dana pusat biaya CSR SEPASO/KUTIM cukup — Finance membayar dari akun ini.',
      'other_account' =>
        'Dana pusat biaya CSR SEPASO/KUTIM kurang Rp 1.047.500, tetapi dana PT cukup — Finance membayar dari akun lain '
            'di PT ini (tercatat sebagai pinjaman antar project otomatis).',
      _ => null,
    },
    'pusatBiaya': {
      'accountId': 12,
      'name': 'CSR SEPASO/KUTIM',
      'balance': pbAvailable + 600000,
      'commitments': 600000,
      'available': pbAvailable,
      'commitmentItems': [
        {'kind': 'project_loan', 'id': 8, 'docNo': 'PJP/DRMS/2610/0003', 'amount': 400000, 'status': 'approved'},
        {'kind': 'request', 'id': 40, 'docNo': 'PB/DRMS/2610/0010', 'amount': 200000, 'status': 'approved'},
      ],
    },
  };
}

/// Request detail at the Owner step (ADR 0026 rule Direktur → Owner) with the fund panel; [allowed] = the caller's
/// actions (the Owner: approve, reject, instruct_loan).
Map<String, dynamic> fundDetailJson({
  List<String> allowed = const ['approve', 'reject', 'instruct_loan'],
  Map<String, dynamic>? fundCheck,
  String status = 'pending_approval',
}) {
  final j = detailJson(status: status, allowed: allowed, currentLevel: 2);
  j['companyId'] = 1;
  j['approvalRule'] = {
    ...(j['approvalRule'] as Map<String, dynamic>),
    'decisionRoles': ['pk-owner', 'pk-principal'],
    'steps': [
      {'level': 1, 'approverRole': 'pk-owner', 'approverUserId': null},
      {'level': 2, 'approverRole': 'pk-principal', 'approverUserId': null},
    ],
  };
  j['fundCheck'] = fundCheck ?? fundCheckJson();
  return j;
}

/// 409 FUND_INSUFFICIENT as the server answers it (problem+json: Indonesian title, code, figures).
Map<String, dynamic> fundInsufficientProblem() => {
  'type': 'about:blank',
  'title':
      'Dana PT DRMS tidak cukup: tersedia Rp 1.000.000, dibutuhkan Rp 1.447.500, kurang Rp 447.500. Tolak, atau minta '
      'Owner memerintahkan pinjaman antar-PT.',
  'status': 409,
  'code': 'FUND_INSUFFICIENT',
  'companyId': 1,
  'balance': 5000000,
  'commitments': 4000000,
  'available': 1000000,
  'needed': 1447500,
  'gap': 447500,
};

const _las = {'id': 2, 'shortCode': 'LAS', 'name': 'PT Contoh Lestari'};
const _drms = {'id': 1, 'shortCode': 'DRMS', 'name': 'PT Contoh Dirgantara'};

/// The borrower's (DRMS) designated receiving account as the server sends it (`destination`, masked).
const icDestinationJson = {
  'bankName': 'Mandiri',
  'accountNoMasked': '••••0123',
  'accountHolder': 'PT Contoh Dirgantara',
};

const _absent = Object();

/// `IntercompanyLoanDetail` of loan 77 (LAS lends Rp 500.000 to DRMS for request 42). [destination]: omitted = an
/// older server (no field); null or a map = the server's value.
Map<String, dynamic> icLoanDetailJson({
  String status = 'instructed',
  List<String>? allowed,
  bool g1 = false,
  Object? destination = _absent,
}) {
  final disbursed = status != 'instructed' && status != 'cancelled';
  return {
    'id': 77,
    'uuid': '0192f6d0-cccc-7000-8000-000000000077',
    'docNo': 'PJA/LAS/2610/0002',
    'status': status,
    'statusLabel': switch (status) {
      'instructed' => 'Menunggu pencairan',
      'disbursed' => 'Dicairkan',
      'partially_repaid' => 'Sebagian dikembalikan',
      'repaid' => 'Lunas',
      _ => 'Dibatalkan',
    },
    'overdue': false,
    'overdueLabel': null,
    'daysOverdue': 0,
    'lender': _las,
    'borrower': _drms,
    'amount': 500000,
    'repaidTotal': 0,
    'outstanding': disbursed ? 500000 : 0,
    'instructionDate': '2026-10-14',
    'dueDate': '2026-11-13',
    'reason': 'Menutup kekurangan dana PB/DRMS/2610/0012',
    'createdBy': {'id': 9, 'name': 'Owner Grup'},
    'createdAt': '2026-10-14T02:00:00.000Z',
    'side': 'both',
    'snapshot': {'borrowerAvailable': 1000000, 'borrowerGap': 447500, 'lenderAvailable': 3000000},
    'cancelReason': null,
    'cancelledAt': null,
    'cancelledBy': null,
    'ownRequest': true,
    'ownRequestNote':
        'Pinjaman untuk pengajuan Owner sendiri — pencairan oleh Finance PT pemberi (orang kedua yang independen).',
    'droppedRequestNote': null,
    'lenderHasReceivingAccount': true,
    if (!identical(destination, _absent)) 'destination': destination,
    'requests': [
      {
        'id': 42,
        'docNo': 'PB/DRMS/2610/0012',
        'title': 'Service Tronton',
        'status': 'pending_approval',
        'statusLabel': 'Menunggu Approval Owner',
        'grandTotal': 1447500,
      },
    ],
    'movements': disbursed
        ? [
            {
              'id': 301,
              'kind': 'disbursement',
              'label': 'Pencairan',
              'seq': null,
              'amount': 500000,
              'transferDate': '2026-10-14',
              'transferAt': '2026-10-14T01:05:00.000Z',
              'bankRef': 'REF-9',
              'status': 'posted',
              'voidReason': null,
              'fromCompanyId': 2,
              'toCompanyId': 1,
              'fromAccount': {'id': 3, 'name': 'Bank Operasional LAS'},
              'toAccount': {'name': 'Rekening penerimaan DRMS', 'accountNoMasked': '••••0123'},
              'kk': {'id': 501, 'entryNo': 'KK/LAS/2610/0004'},
              'km': {'id': 502, 'entryNo': 'KM/DRMS/2610/0011'},
              'proofId': 9001,
              'executedBy': {'id': 8, 'name': 'Fina Keuangan'},
              'voidedBy': null,
              'voidedAt': null,
              'createdAt': '2026-10-14T01:06:00.000Z',
            },
          ]
        : <Map<String, dynamic>>[],
    'allowedActions': allowed ?? (status == 'instructed' ? (g1 ? <String>[] : ['disburse']) : ['void_disbursement']),
    'disburseBlockedByG1': g1,
  };
}

/// `GET /intercompany-loans/queue`: 77 (another Finance instructed it) and 78 (the caller instructed it — G1; DRMS
/// without a designated receiving account).
Map<String, dynamic> icLoanQueueJson() {
  Map<String, dynamic> item(int id, {required bool can}) {
    final d = icLoanDetailJson();
    return {
      for (final k in const [
        'uuid',
        'status',
        'statusLabel',
        'overdue',
        'overdueLabel',
        'daysOverdue',
        'lender',
        'borrower',
        'amount',
        'repaidTotal',
        'outstanding',
        'instructionDate',
        'dueDate',
        'reason',
        'createdBy',
        'createdAt',
        'side',
      ])
        k: d[k],
      'id': id,
      'docNo': 'PJA/LAS/2610/${id.toString().padLeft(4, '0')}',
      'canDisburse': can,
      'g1Note': can ? null : 'Anda yang memerintahkan pinjaman ini — pencairan oleh Finance lain (G1).',
      'destination': can ? icDestinationJson : null,
    };
  }

  return {
    'count': 2,
    'items': [item(77, can: true), item(78, can: false)],
  };
}

/// `GET /intercompany-loans/lenders?borrower=1&amount=447500`: LAS has enough, MKS does not (and has no receiving
/// account).
Map<String, dynamic> icLenderOptionsJson({bool borrowerHasAccount = true, String defaultDueDate = '2026-11-13'}) => {
  'borrower': {
    'company': _drms,
    'balance': 5000000,
    'commitments': 4000000,
    'available': 1000000,
    'fundCheckEnabled': true,
    'hasReceivingAccount': borrowerHasAccount,
    'waiting': [
      {'id': 42, 'docNo': 'PB/DRMS/2610/0012', 'title': 'Service Tronton', 'needed': 1447500, 'gap': 447500},
      {'id': 43, 'docNo': 'PB/DRMS/2610/0013', 'title': 'Sewa crane', 'needed': 2500000, 'gap': 1500000},
    ],
    'gapAll': 2947500,
  },
  'defaultDueDate': defaultDueDate,
  'lenders': [
    {
      'company': _las,
      'balance': 4000000,
      'commitments': 1000000,
      'available': 3000000,
      'sufficient': true,
      'hasReceivingAccount': true,
      'warning': null,
    },
    {
      'company': {'id': 3, 'shortCode': 'MKS', 'name': 'PT Contoh Makmur'},
      'balance': 300000,
      'commitments': 0,
      'available': 300000,
      'sufficient': false,
      'hasReceivingAccount': false,
      'warning': 'Pengembalian belum dapat dicatat sampai PT ini menetapkan rekening penerimaan antar-PT.',
    },
  ],
};
