/// KPI summaries of the role homes (US-27), read from the same `/api/v1/dashboard/*` data as the web
/// "Beranda" (`apps/web/src/admin/views/Dashboard.tsx`). Parsing is tolerant: a missing block reads as 0.
library;

typedef Json = Map<String, dynamic>;

int _i(Object? v) => v is num ? v.toInt() : 0;
int? _iN(Object? v) => v is num ? v.toInt() : null;
Json _m(Object? v) => v is Map<String, dynamic> ? v : const {};
List<Json> _l(Object? v) => v is List ? [for (final e in v) _m(e)] : const [];

/// One month of the cash book (`cashFlow.rows[]`, K-02a/K-02b).
class CashFlowPoint {
  const CashFlowPoint(this.period, this.masuk, this.keluar);
  final String period; // YYYY-MM
  final int masuk;
  final int keluar;
}

/// One month of a single series (saldo akhir bulan, pencairan bersih, jumlah pengajuan).
class TrendPoint {
  const TrendPoint(this.period, this.value);
  final String period;
  final int value;
}

List<CashFlowPoint> _cashFlow(Object? block) => [
  for (final r in _l(_m(block)['rows'])) CashFlowPoint('${r['period'] ?? ''}', _i(r['masuk']), _i(r['keluar'])),
];

List<TrendPoint> _trend(Object? rows, String key) => [
  for (final r in _l(rows)) TrendPoint('${r['period'] ?? ''}', _i(r[key])),
];

/// Σ over running projects with a budget (`viz.budgetTotals`).
class BudgetTotals {
  const BudgetTotals({this.projects = 0, this.budget = 0, this.committed = 0, this.realized = 0});
  final int projects;
  final int budget;
  final int committed;
  final int realized;

  static BudgetTotals fromJson(Object? v) {
    final m = _m(v);
    return BudgetTotals(
      projects: _i(m['projects']),
      budget: _i(m['budget']),
      committed: _i(m['committed']),
      realized: _i(m['realized']),
    );
  }
}

/// One PT of a multi-PT dashboard (MC2/MC4 per-PT fields, joined by `companyId`). Label = `companies[].shortCode`.
class CompanySplit {
  const CompanySplit({
    required this.companyId,
    required this.code,
    this.cash,
    this.count = 0,
    this.sum = 0,
    this.waiting,
  });
  final int companyId;
  final String code;

  /// Cash balance of the PT (Direktur `cash.byCompany[].total`, Finance `cashByCompany[].total`); null for PM.
  final int? cash;

  /// Direktur: waiting approvals; Finance: transfer queue; PM: team requests this month.
  final int count;
  final int sum;

  /// PM only: team requests waiting for approval.
  final int? waiting;
}

/// Per-PT rows in the order of `companies[]`; empty unless the payload covers ≥ 2 PTs (one PT = the totals).
List<CompanySplit> _splits(Object? companies, {Object? cash, Object? counts}) {
  final cos = _l(companies);
  if (cos.length < 2) return const [];
  Json byId(Object? rows, int id) => _l(rows).firstWhere((r) => _iN(r['companyId']) == id, orElse: () => const {});
  return [
    for (final c in cos)
      if (_iN(c['id']) case final id?)
        CompanySplit(
          companyId: id,
          code: '${c['shortCode'] ?? c['name'] ?? '#$id'}',
          cash: cash == null ? null : _i(byId(cash, id)['total']),
          count: _i(byId(counts, id)['count']),
          sum: _i(byId(counts, id)['sum']),
          waiting: _iN(byId(counts, id)['waiting']),
        ),
  ];
}

/// Web `share()`: percentage with one decimal, null without a whole.
double? share(int part, int whole) => whole <= 0 ? null : (part / whole * 1000).round() / 10;

/// `GET /dashboard/owner` — Direktur home.
class DirekturDashboard {
  const DirekturDashboard({
    required this.asOf,
    required this.cashTotal,
    required this.monthIn,
    required this.monthOut,
    required this.waitingCount,
    required this.waitingSum,
    required this.waitingForMe,
    required this.oldestDays,
    required this.pendingAckCount,
    required this.pendingApprovalCount,
    required this.balanceTrend,
    required this.disbursed,
    required this.budgetTotals,
    required this.budgetOver,
    required this.budgetWarn,
    required this.cashFlow,
    required this.transferQueueCount,
    this.byCompany = const [],
  });

  final String asOf;
  final int cashTotal;
  final int monthIn;
  final int monthOut;
  final int waitingCount;
  final int waitingSum;
  final int waitingForMe;
  final int? oldestDays;
  final int pendingAckCount;
  final int pendingApprovalCount;
  final List<TrendPoint> balanceTrend;
  final List<TrendPoint> disbursed;
  final BudgetTotals budgetTotals;
  final int budgetOver;
  final int budgetWarn;
  final List<CashFlowPoint> cashFlow;
  final int transferQueueCount;

  /// Per PT: cash total + waiting approvals (count/sum).
  final List<CompanySplit> byCompany;

  static DirekturDashboard fromJson(Json j) {
    final cash = _m(j['cash']);
    final a = _m(j['approvals']);
    final viz = _m(j['viz']);
    final budget = _m(j['budget']);
    return DirekturDashboard(
      asOf: '${j['asOf'] ?? ''}',
      cashTotal: _i(cash['total']),
      monthIn: _i(cash['monthIn']),
      monthOut: _i(cash['monthOut']),
      waitingCount: _i(a['count']),
      waitingSum: _i(a['sum']),
      waitingForMe: _i(a['waitingForMe']),
      oldestDays: _iN(a['oldestDays']),
      pendingAckCount: _i(_m(a['pendingAck'])['count']),
      pendingApprovalCount: _i(_m(a['pendingApproval'])['count']),
      balanceTrend: _trend(viz['balanceTrend'], 'balance'),
      disbursed: _trend(viz['disbursed'], 'net'),
      budgetTotals: BudgetTotals.fromJson(viz['budgetTotals']),
      budgetOver: _i(budget['over']),
      budgetWarn: _i(budget['warn']),
      cashFlow: _cashFlow(j['cashFlow']),
      transferQueueCount: _i(_m(j['transferQueue'])['count']),
      byCompany: _splits(j['companies'], cash: cash['byCompany'], counts: a['byCompany']),
    );
  }
}

/// `GET /dashboard/finance` — Finance home.
class FinanceDashboard {
  const FinanceDashboard({
    required this.asOf,
    required this.cashTotal,
    required this.transferCount,
    required this.transferSum,
    required this.transferOverdue,
    required this.lpjToVerify,
    required this.reimburseToVerify,
    required this.lpjToSettle,
    required this.advancesOverdue,
    required this.balanceTrend,
    required this.cashFlow,
    this.byCompany = const [],
  });

  final String asOf;
  final int cashTotal;
  final int transferCount;
  final int transferSum;
  final int transferOverdue;
  final int lpjToVerify;
  final int reimburseToVerify;
  final int lpjToSettle;
  final int advancesOverdue;
  final List<TrendPoint> balanceTrend;
  final List<CashFlowPoint> cashFlow;

  /// Per PT: cash total + transfer queue (count/sum).
  final List<CompanySplit> byCompany;

  static FinanceDashboard fromJson(Json j) {
    final q = _m(j['transferQueue']);
    return FinanceDashboard(
      asOf: '${j['asOf'] ?? ''}',
      cashTotal: _i(j['cashTotal']),
      transferCount: _i(q['count']),
      transferSum: _i(q['sum']),
      transferOverdue: _i(q['overdue']),
      lpjToVerify: _i(j['lpjToVerify']),
      reimburseToVerify: _i(_m(j['reimburseToVerify'])['count']),
      lpjToSettle: _i(_m(j['lpjToSettle'])['count']),
      advancesOverdue: _l(j['advancesWithoutLpj']).where((a) => a['overdue'] == true).length,
      balanceTrend: _trend(_m(j['viz'])['balanceTrend'], 'balance'),
      cashFlow: _cashFlow(j['cashFlow']),
      byCompany: _splits(j['companies'], cash: j['cashByCompany'], counts: q['byCompany']),
    );
  }
}

/// `GET /dashboard/pm` — PM team monitor (US-17, read-only; ADR 0013: no decisions).
class PmDashboard {
  const PmDashboard({
    required this.asOf,
    required this.hasScope,
    required this.teamCount,
    required this.teamSum,
    required this.teamWaiting,
    required this.withoutLpj,
    required this.lpjOverdue,
    required this.requestTrend,
    required this.budgetTotals,
    this.byCompany = const [],
  });

  final String asOf;
  final bool hasScope;
  final int teamCount;
  final int teamSum;
  final int teamWaiting;
  final int withoutLpj;
  final int lpjOverdue;
  final List<TrendPoint> requestTrend;
  final BudgetTotals budgetTotals;

  /// Per PT: team requests this month (count/sum/waiting).
  final List<CompanySplit> byCompany;

  static PmDashboard fromJson(Json j) {
    final team = _m(j['teamMonth']);
    final lpj = _m(j['lpj']);
    final viz = _m(j['viz']);
    return PmDashboard(
      asOf: '${j['asOf'] ?? ''}',
      hasScope: j['hasScope'] != false,
      teamCount: _i(team['count']),
      teamSum: _i(team['sum']),
      teamWaiting: _i(team['waiting']),
      withoutLpj: _i(lpj['withoutLpj']),
      lpjOverdue: _i(lpj['overdue']),
      requestTrend: _trend(viz['requestTrend'], 'count'),
      budgetTotals: BudgetTotals.fromJson(viz['budgetTotals']),
      byCompany: _splits(j['companies'], counts: j['teamMonthByCompany']),
    );
  }
}
