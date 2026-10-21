import 'fixtures.dart';

/// DRMS 13/10 Wave 3 (dashboard parity APK ↔ web): `/dashboard/*` payloads with the blocks the web view renders —
/// shapes as in packages/api-contract/openapi.json (OwnerDashboard / FinanceDashboard / PmDashboard / StaffDashboard /
/// AdminDashboard). Fictional data only.

const pipelineJson = {
  'stages': [
    {'key': 'ack', 'label': 'Menunggu PM/Direktur', 'count': 2, 'sum': 5000000, 'statuses': <String>[]},
    {'key': 'approval', 'label': 'Menunggu Approval', 'count': 1, 'sum': 2250000, 'statuses': <String>[]},
    {'key': 'queue', 'label': 'Antri transfer', 'count': 1, 'sum': 1000000, 'statuses': <String>[]},
    {'key': 'lpj', 'label': 'LPJ', 'count': 3, 'sum': 4500000, 'statuses': <String>[]},
    {'key': 'done', 'label': 'Selesai', 'count': 7, 'sum': 21000000, 'statuses': <String>[]},
  ],
  'exit': {'key': 'exit', 'label': 'Ditolak/dibatalkan', 'count': 1, 'sum': 800000, 'statuses': <String>[]},
  'total': 15,
};

const categoriesJson = {
  'from': '2026-04-01',
  'to': '2026-09-26',
  'total': 20000000,
  'includesManual': true,
  'items': [
    {'label': 'Material', 'total': 15000000, 'other': false, 'categoryId': 3},
    {'label': 'Lainnya', 'total': 5000000, 'other': true, 'categoryId': null},
  ],
};

const requestTrendJson = [
  {'period': '2026-08', 'count': 4, 'sum': 10000000},
  {'period': '2026-09', 'count': 6, 'sum': 18750000},
];

const slaJson = {
  'month': '2026-09',
  'count': 8,
  'pctWithin': 87.5,
  'avgHours': 30.2,
  'avgText': '1 hr 6 jam',
  'late': 1,
  'slaHours': [24],
  'text': '87,5%',
};

const loansJson = {
  'totals': {
    'count': 3,
    'amount': 27500000,
    'repaid': 5000000,
    'outstanding': 22500000,
    'overdue': 2500000,
    'overdueCount': 1,
    'pending': 1,
    'byCompany': <Object>[],
  },
  'projects': [
    {
      'projectId': 31,
      'companyId': 1,
      'code': 'PRJ-01',
      'name': 'Gudang Utara',
      'borrowed': 20000000,
      'lent': 0,
      'outstandingBorrowed': 15000000,
      'outstandingLent': 0,
      'overdueBorrowed': 2500000,
      'overdueCount': 1,
    },
    {
      'projectId': 32,
      'companyId': 1,
      'code': 'PRJ-02',
      'name': 'Jalan Desa',
      'borrowed': 0,
      'lent': 20000000,
      'outstandingBorrowed': 0,
      'outstandingLent': 15000000,
      'overdueBorrowed': 0,
      'overdueCount': 0,
    },
  ],
  'waitingForMe': 1,
};

Map<String, dynamic> rapMissingJson({bool team = false}) => {
  'team': team,
  'total': 2,
  'rows': [
    {
      'id': 41,
      'companyId': 1,
      'code': 'PRJ-41',
      'name': 'Trading semen',
      'kind': 'trading',
      'kindLabel': 'Trading',
      'budget': 9000000,
      'pm': 7,
    },
    {
      'id': 42,
      'companyId': 1,
      'code': 'PRJ-42',
      'name': 'Konstruksi pos',
      'kind': 'konstruksi',
      'kindLabel': 'Konstruksi',
      'budget': null,
      'pm': null,
    },
  ],
};

const rapMonitoringJson = {
  'projects': 1,
  'overProjects': 1,
  'rows': [
    {
      'projectId': 31,
      'companyId': 1,
      'code': 'PRJ-01',
      'name': 'Gudang Utara',
      'status': 'berjalan',
      'planned': 40000000,
      'realised': 42000000,
      'transferred': 30000000,
      'verified': 20000000,
      'remaining': -2000000,
      'percent': 105,
      'overBudget': true,
      'items': 4,
      'activeItems': 4,
      'overBudgetItems': 2,
    },
  ],
};

const recentCashJson = [
  {
    'id': 501,
    'companyId': 1,
    'entryNo': 'KK/DRMS/2609/0001',
    'entryDate': '2026-09-25',
    'direction': 'out',
    'amount': 1250000,
    'status': 'posted',
    'sourceType': 'transfer',
    'account': 'Kas Kecil',
    'label': 'Transfer pengajuan',
    'requestId': 9,
    'requestDocNo': 'PB/DRMS/2609/0009',
  },
];

const costCentersJson = [
  {
    'id': 5,
    'companyId': 1,
    'code': 'CC-1',
    'name': 'Kantor',
    'fromRequests': 750000,
    'manualOut': 0,
    'manualIn': 0,
    'total': 750000,
  },
  {
    'id': 6,
    'companyId': 1,
    'code': 'CC-2',
    'name': 'Bengkel',
    'fromRequests': 0,
    'manualOut': 0,
    'manualIn': 0,
    'total': 0,
  },
];

Map<String, dynamic> ownerW3Json() {
  final j = direkturDashboardJson();
  return {
    ...j,
    'cash': {
      ...(j['cash'] as Map<String, dynamic>),
      'accounts': [
        {'id': 1, 'companyId': 1, 'name': 'Kas Kecil', 'active': true, 'balance': 2500000},
        {'id': 2, 'companyId': 1, 'name': 'Bank Operasional', 'active': true, 'balance': 150000000},
      ],
    },
    'completeness': {
      'ratioDone': 3,
      'ratioTotal': 5,
      'withoutLpj': 2,
      'overdue': 1,
      'reimburseToVerify': 4,
      'openWarnings': 0,
      'byCompany': <Object>[],
    },
    'costCenters': costCentersJson,
    'sla': slaJson,
    'loans': loansJson,
    'rapMonitoring': rapMonitoringJson,
    'rapMissing': rapMissingJson(),
    'viz': {
      ...(j['viz'] as Map<String, dynamic>),
      'requestTrend': requestTrendJson,
      'pipeline': pipelineJson,
      'categories': categoriesJson,
      'recentCash': recentCashJson,
    },
  };
}

Map<String, dynamic> financeW3Json() {
  final j = financeDashboardJson();
  return {
    ...j,
    'accounts': [
      {
        'id': 2,
        'companyId': 1,
        'name': 'Bank Operasional',
        'active': true,
        'balance': 98000000,
        'monthIn': 12000000,
        'monthOut': 9500000,
      },
    ],
    'advancesWithoutLpj': [
      {
        'id': 1,
        'docNo': 'PB/DRMS/2609/0001',
        'requesters': 'Budi',
        'transferredTotal': 1447500,
        'ageDays': 20,
        'overdue': true,
      },
      {
        'id': 2,
        'docNo': 'PB/DRMS/2609/0002',
        'requesters': 'Sari',
        'transferredTotal': 500000,
        'ageDays': 3,
        'overdue': false,
      },
    ],
    'sla': slaJson,
    'loans': {...loansJson, 'waitingForMe': 0},
    'viz': {
      ...(j['viz'] as Map<String, dynamic>),
      'pipeline': pipelineJson,
      'categories': categoriesJson,
      'recentCash': recentCashJson,
    },
  };
}

Map<String, dynamic> pmW3Json() {
  final j = pmDashboardJson();
  return {
    ...j,
    'costCenters': costCentersJson,
    'loans': {...loansJson, 'waitingForMe': 0},
    'rapMissing': rapMissingJson(team: true),
    'viz': {
      ...(j['viz'] as Map<String, dynamic>),
      'requestTrend': requestTrendJson,
      'pipeline': pipelineJson,
      'categories': categoriesJson,
    },
  };
}

/// `/dashboard/me`: the caller's own requests with their grand totals (owner 2026-10-13: shown like the web).
Map<String, dynamic> staffW3Json() => {
  'companies': [
    {'id': 1, 'shortCode': 'DRMS', 'name': 'PT DRMS Contoh'},
  ],
  'actions': [
    {
      'id': 1,
      'companyId': 1,
      'docNo': null,
      'title': 'Semen',
      'type': 'advance',
      'status': 'draft',
      'grandTotal': 1447500,
      'ageDays': 1,
    },
  ],
  'latest': [
    {
      'id': 1,
      'companyId': 1,
      'docNo': null,
      'title': 'Semen',
      'type': 'advance',
      'status': 'draft',
      'grandTotal': 1447500,
      'ageDays': 1,
    },
    {
      'id': 2,
      'companyId': 1,
      'docNo': 'PB/DRMS/2609/0007',
      'title': 'Besi beton',
      'type': 'advance',
      'status': 'transferred',
      'grandTotal': 2250000,
      'ageDays': 6,
    },
  ],
  'month': '2026-09',
  'viz': {'requestTrend': requestTrendJson, 'pipeline': pipelineJson},
};

Map<String, dynamic> adminW3Json() => {
  'companies': [
    {'id': 1, 'shortCode': 'DRMS', 'name': 'PT DRMS Contoh'},
  ],
  // ADR 0031: `projectsWithoutPusatBiaya` replaces `costCentersWithoutManager` (deprecated, always 0)
  'gaps': {
    'usersIncomplete': 2,
    'projectsWithoutPm': 0,
    'projectsWithoutPusatBiaya': 1,
    'costCentersWithoutManager': 0,
    'byCompany': <Object>[],
  },
  'latestAudit': <Object>[],
};
