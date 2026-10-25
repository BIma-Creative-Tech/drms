/// KPI summaries of the role homes (US-27), read from the same `/api/v1/dashboard/*` data as the web
/// "Beranda" (`apps/web/src/admin/views/Dashboard.tsx`). Parsing is tolerant: a missing block reads as 0.
library;

typedef Json = Map<String, dynamic>;

int _i(Object? v) => v is num ? v.toInt() : 0;
int? _iN(Object? v) => v is num ? v.toInt() : null;
double? _dN(Object? v) => v is num ? v.toDouble() : null;
String _s(Object? v) => v == null ? '' : '$v';
Json _m(Object? v) => v is Map<String, dynamic> ? v : const {};
List<Json> _l(Object? v) => v is List ? [for (final e in v) _m(e)] : const [];

/// A block that an older server does not send yet reads as null (its card stays hidden).
T? _block<T>(Object? v, T Function(Json) parse) => v is Map<String, dynamic> ? parse(v) : null;

/// One month of the cash book (`cashFlow.rows[]`, K-02a/K-02b).
class CashFlowPoint {
  const CashFlowPoint(this.period, this.masuk, this.keluar, {this.masukAntarPt = 0, this.keluarAntarPt = 0});
  final String period; // YYYY-MM
  final int masuk;
  final int keluar;

  /// ADR 0028 (owner decision 3, "count and label"): the part of [masuk] / [keluar] that are payments between PTs of
  /// the group ("Antar PT"); 0 from a server before ADR 0028.
  final int masukAntarPt;
  final int keluarAntarPt;

  bool get hasAntarPt => masukAntarPt != 0 || keluarAntarPt != 0;
}

/// ADR 0028 (owner decision 3) "tanpa antar-PT": the rows without both legs of payments between PTs — the web Direktur
/// card's `withoutIntercompany` (masuk − masukAntarPt, keluar − keluarAntarPt; no other elimination). The Antar PT parts
/// become 0 (nothing left to name).
List<CashFlowPoint> withoutIntercompany(List<CashFlowPoint> rows) => [
  for (final r in rows) CashFlowPoint(r.period, r.masuk - r.masukAntarPt, r.keluar - r.keluarAntarPt),
];

/// One month of a single series (saldo akhir bulan, pencairan bersih, jumlah pengajuan).
class TrendPoint {
  const TrendPoint(this.period, this.value);
  final String period;
  final int value;
}

List<CashFlowPoint> _cashFlow(Object? block) => [
  for (final r in _l(_m(block)['rows']))
    CashFlowPoint(
      '${r['period'] ?? ''}',
      _i(r['masuk']),
      _i(r['keluar']),
      masukAntarPt: _i(r['masukAntarPt']),
      keluarAntarPt: _i(r['keluarAntarPt']),
    ),
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

/// PT short codes of a multi-PT payload (`companies[]`), empty for one PT — prefixes account rows like the web
/// (`[CS1] Kas kecil`).
Map<int, String> _codes(Object? companies) {
  final cos = _l(companies);
  if (cos.length < 2) return const {};
  return {for (final c in cos) _i(c['id']): '${c['shortCode'] ?? c['name'] ?? '#${c['id']}'}'};
}

/// One month of `viz.requestTrend` (K-13): number of requests and Σ grand total (money roles only).
class RequestTrendPoint {
  const RequestTrendPoint(this.period, this.count, this.sum);
  final String period;
  final int count;
  final int sum;
}

List<RequestTrendPoint> _requestTrend(Object? rows) => [
  for (final r in _l(rows)) RequestTrendPoint(_s(r['period']), _i(r['count']), _i(r['sum'])),
];

/// One stage of `viz.pipeline` (K-13 per status folded into ordered stages; `exit` = rejected/cancelled).
class PipelineStage {
  const PipelineStage({required this.key, required this.label, this.count = 0, this.sum = 0});
  final String key;
  final String label;
  final int count;
  final int sum;

  static PipelineStage fromJson(Json j) =>
      PipelineStage(key: _s(j['key']), label: _s(j['label']), count: _i(j['count']), sum: _i(j['sum']));
}

class Pipeline {
  const Pipeline({this.stages = const [], this.exit, this.total = 0});
  final List<PipelineStage> stages;
  final PipelineStage? exit;
  final int total;

  int count(String key) => stages.where((s) => s.key == key).fold(0, (a, s) => a + s.count);

  /// Stages in web order with the exit row last.
  List<PipelineStage> get rows => [...stages, ?exit];

  static Pipeline fromJson(Object? v) {
    final m = _m(v);
    return Pipeline(
      stages: [for (final s in _l(m['stages'])) PipelineStage.fromJson(s)],
      exit: _block(m['exit'], PipelineStage.fromJson),
      total: _i(m['total']),
    );
  }
}

/// `viz.categories` (K-17 Dicairkan per category, top 6 + "Lainnya").
class CategoryShare {
  const CategoryShare(this.label, this.total, {this.other = false});
  final String label;
  final int total;
  final bool other;
}

class CategoryMix {
  const CategoryMix({this.from = '', this.total = 0, this.items = const []});
  final String from;
  final int total;
  final List<CategoryShare> items;

  static CategoryMix fromJson(Object? v) {
    final m = _m(v);
    return CategoryMix(
      from: _s(m['from']),
      total: _i(m['total']),
      items: [for (final i in _l(m['items'])) CategoryShare(_s(i['label']), _i(i['total']), other: i['other'] == true)],
    );
  }
}

/// "Saldo per akun" (K-01 per account; inactive accounts with balance 0 are already left out by the server).
class AccountBalance {
  const AccountBalance({
    required this.id,
    required this.name,
    this.code,
    this.active = true,
    this.balance = 0,
    this.monthIn,
    this.monthOut,
  });
  final int id;
  final String name;

  /// PT short code when the payload spans several PTs.
  final String? code;
  final bool active;
  final int balance;

  /// Finance only: book in/out this month.
  final int? monthIn;
  final int? monthOut;

  static List<AccountBalance> listFromJson(Object? rows, Map<int, String> codes) => [
    for (final a in _l(rows))
      AccountBalance(
        id: _i(a['id']),
        name: _s(a['name']),
        code: codes[_iN(a['companyId'])],
        active: a['active'] != false,
        balance: _i(a['balance']),
        monthIn: _iN(a['monthIn']),
        monthOut: _iN(a['monthOut']),
      ),
  ]..sort((x, y) => y.balance.compareTo(x.balance));
}

/// "Kelengkapan nota/LPJ" (K-12, this month).
class Completeness {
  const Completeness({
    this.ratioDone = 0,
    this.ratioTotal = 0,
    this.withoutLpj = 0,
    this.overdue = 0,
    this.reimburseToVerify = 0,
    this.openWarnings = 0,
  });
  final int ratioDone;
  final int ratioTotal;
  final int withoutLpj;
  final int overdue;
  final int reimburseToVerify;
  final int openWarnings;

  static Completeness fromJson(Json m) => Completeness(
    ratioDone: _i(m['ratioDone']),
    ratioTotal: _i(m['ratioTotal']),
    withoutLpj: _i(m['withoutLpj']),
    overdue: _i(m['overdue']),
    reimburseToVerify: _i(m['reimburseToVerify']),
    openWarnings: _i(m['openWarnings']),
  );
}

/// Item 11 (DRMS 10/10) "SLA transfer" (`sla`): this month's transfers within the PT's SLA since the final approval.
class SlaSummary {
  const SlaSummary({
    this.count = 0,
    this.pctWithin,
    this.text = '—',
    this.avgText = '—',
    this.late = 0,
    this.slaHours = const [],
  });
  final int count;
  final double? pctWithin;

  /// Server-formatted share (`92,5%`, `—`) and average duration (`1 hr 3 jam`) — same text as the web card.
  final String text;
  final String avgText;
  final int late;
  final List<int> slaHours;

  static SlaSummary fromJson(Json m) => SlaSummary(
    count: _i(m['count']),
    pctWithin: _dN(m['pctWithin']),
    text: m['text'] is String ? m['text'] as String : '—',
    avgText: m['avgText'] is String ? m['avgText'] as String : '—',
    late: _i(m['late']),
    slaHours: [for (final h in m['slaHours'] is List ? m['slaHours'] as List : const []) _i(h)],
  );
}

/// One project of "Pinjaman antar project" (top 5 by outstanding).
class LoanProjectRow {
  const LoanProjectRow({
    required this.projectId,
    required this.code,
    required this.name,
    this.outstandingBorrowed = 0,
    this.outstandingLent = 0,
    this.overdueBorrowed = 0,
    this.overdueCount = 0,
  });
  final int projectId;
  final String code;
  final String name;
  final int outstandingBorrowed;
  final int outstandingLent;
  final int overdueBorrowed;
  final int overdueCount;
}

/// ADR 0022 §9 "Pinjaman antar project" (`loans`): office roles their PTs, PM the team projects.
class LoanMonitor {
  const LoanMonitor({
    this.outstanding = 0,
    this.overdue = 0,
    this.overdueCount = 0,
    this.pending = 0,
    this.waitingForMe = 0,
    this.projects = const [],
  });
  final int outstanding;
  final int overdue;
  final int overdueCount;
  final int pending;
  final int waitingForMe;
  final List<LoanProjectRow> projects;

  static LoanMonitor fromJson(Json m) {
    final t = _m(m['totals']);
    return LoanMonitor(
      outstanding: _i(t['outstanding']),
      overdue: _i(t['overdue']),
      overdueCount: _i(t['overdueCount']),
      pending: _i(t['pending']),
      waitingForMe: _i(m['waitingForMe']),
      projects: [
        for (final p in _l(m['projects']))
          LoanProjectRow(
            projectId: _i(p['projectId']),
            code: _s(p['code']),
            name: _s(p['name']),
            outstandingBorrowed: _i(p['outstandingBorrowed']),
            outstandingLent: _i(p['outstandingLent']),
            overdueBorrowed: _i(p['overdueBorrowed']),
            overdueCount: _i(p['overdueCount']),
          ),
      ],
    );
  }
}

/// D4 (owner 2026-10-11) "Project ber-RAB belum punya RAP" (`rapMissing`; `team` = PM nudge).
class RapMissingRow {
  const RapMissingRow({required this.id, required this.code, required this.name, this.kindLabel = '', this.budget});
  final int id;
  final String code;
  final String name;
  final String kindLabel;
  final int? budget;
}

class RapMissing {
  const RapMissing({this.team = false, this.total = 0, this.rows = const []});
  final bool team;
  final int total;
  final List<RapMissingRow> rows;

  static RapMissing fromJson(Json m) => RapMissing(
    team: m['team'] == true,
    total: _i(m['total']),
    rows: [
      for (final r in _l(m['rows']))
        RapMissingRow(
          id: _i(r['id']),
          code: _s(r['code']),
          name: _s(r['name']),
          kindLabel: _s(r['kindLabel']),
          budget: _iN(r['budget']),
        ),
    ],
  );
}

/// DRMS 10/10 "Monitoring RAP" (`rapMonitoring`): realisation vs plan per project with a RAP.
class RapMonitorRow {
  const RapMonitorRow({
    required this.projectId,
    required this.code,
    required this.name,
    this.planned,
    this.realised = 0,
    this.percent,
    this.overBudget = false,
    this.overBudgetItems = 0,
  });
  final int projectId;
  final String code;
  final String name;
  final int? planned;
  final int realised;
  final double? percent;
  final bool overBudget;
  final int overBudgetItems;
}

class RapMonitor {
  const RapMonitor({this.projects = 0, this.overProjects = 0, this.rows = const []});
  final int projects;
  final int overProjects;
  final List<RapMonitorRow> rows;

  static RapMonitor fromJson(Json m) => RapMonitor(
    projects: _i(m['projects']),
    overProjects: _i(m['overProjects']),
    rows: [
      for (final r in _l(m['rows']))
        RapMonitorRow(
          projectId: _i(r['projectId']),
          code: _s(r['code']),
          name: _s(r['name']),
          planned: _iN(r['planned']),
          realised: _i(r['realised']),
          percent: _dN(r['percent']),
          overBudget: r['overBudget'] == true,
          overBudgetItems: _i(r['overBudgetItems']),
        ),
    ],
  );
}

/// Web `SOURCE` labels of `cash_entries.source_type` (Dashboard / Kas "Sumber"; ADR 0028 adds "Antar PT").
const cashSourceLabels = {
  'transfer': 'Transfer',
  'settlement_refund': 'Pengembalian LPJ',
  'manual': 'Manual',
  'reversal': 'Jurnal balik',
  'opening': 'Saldo awal',
  'intercompany': 'Antar PT',
  // ADR 0031: the KK / KM legs of an inter-project loan (disbursement, repayment)
  'project_loan': 'Pinjaman antar project',
};

/// ADR 0028 cash-entry `intercompany` counterpart (the other leg of a payment between PTs): numbers and PT only.
class CashCounterpart {
  const CashCounterpart({
    required this.incoming,
    this.companyCode,
    this.sourceDocNo,
    this.transferDocNo,
    this.entryNo = '',
    this.voided = false,
  });

  /// true = this entry is the Kas Masuk of the receiving PT ("Dari PT …"), false = the paying PT's KK ("Ke PT …").
  final bool incoming;
  final String? companyCode;
  final String? sourceDocNo;
  final String? transferDocNo;
  final String entryNo;
  final bool voided;

  static CashCounterpart? fromJson(Object? v) {
    if (v is! Map<String, dynamic>) return null;
    String? s(Object? x) => x == null || '$x'.isEmpty ? null : '$x';
    return CashCounterpart(
      incoming: v['direction'] == 'in',
      companyCode: s(_m(v['counterpartCompany'])['shortCode']),
      sourceDocNo: s(v['sourceDocNo']),
      transferDocNo: s(v['transferDocNo']),
      entryNo: _s(v['counterpartEntryNo']),
      voided: v['status'] == 'void',
    );
  }

  /// Web Kas row: "Dari PT DRMS · PB/… · TRF/… · KK/…" (Kas Masuk of the receiving PT) or "Ke PT LAS · KM/LAS/…" (KK of
  /// the paying PT); "(dibatalkan)" after a void.
  String get text {
    final pt = companyCode ?? 'lain';
    final parts = incoming
        ? ['Dari PT $pt', ?sourceDocNo, ?transferDocNo, if (entryNo.isNotEmpty) entryNo]
        : ['Ke PT $pt', if (entryNo.isNotEmpty) entryNo];
    return '${parts.join(' · ')}${voided ? ' (dibatalkan)' : ''}';
  }
}

/// "Transaksi kas terbaru" (`viz.recentCash`, office roles).
class RecentCashEntry {
  const RecentCashEntry({
    required this.id,
    this.entryNo,
    this.entryDate = '',
    this.incoming = true,
    this.amount = 0,
    this.voided = false,
    this.account = '',
    this.label = '',
    this.sourceType = '',
    this.counterpart,
    this.requestId,
  });
  final int id;
  final String? entryNo;
  final String entryDate;
  final bool incoming;
  final int amount;
  final bool voided;
  final String account;
  final String label;

  /// `cash_entries.source_type` (`transfer`, `manual`, …, ADR 0028 `intercompany`); '' from an older server.
  final String sourceType;

  /// ADR 0028: the other leg of a payment between PTs, when the server sends it (`intercompany`).
  final CashCounterpart? counterpart;

  /// D2510: the expense request the entry belongs to (`requestId`; null for a manual entry / older server).
  final int? requestId;

  /// D2510: what a tap opens — the request when the entry has one, else the cash entry record.
  String get route => requestId != null ? '/requests/$requestId' : '/data/cash-entries/$id';

  /// "Sumber" label (web `SOURCE`): "Antar PT" for the Kas Masuk of a payment from another PT and for the paying PT's
  /// KK (source type `transfer`, marked by its counterpart).
  String get sourceLabel =>
      isIntercompany ? cashSourceLabels['intercompany']! : (cashSourceLabels[sourceType] ?? sourceType);

  bool get isIntercompany => sourceType == 'intercompany' || counterpart != null;

  static List<RecentCashEntry> listFromJson(Object? rows) => [
    for (final r in _l(rows))
      RecentCashEntry(
        id: _i(r['id']),
        entryNo: r['entryNo'] as String?,
        entryDate: _s(r['entryDate']),
        incoming: r['direction'] == 'in',
        amount: _i(r['amount']),
        voided: r['status'] == 'void',
        account: _s(r['account']),
        label: _s(r['requestDocNo'] ?? r['label']),
        sourceType: _s(r['sourceType']),
        counterpart: CashCounterpart.fromJson(r['intercompany']),
        requestId: r['requestId'] is num ? (r['requestId'] as num).toInt() : null,
      ),
  ];
}

/// "Pusat biaya bulan ini" (K-15). ADR 0031: one row per Pusat Biaya = cash account (`code` is empty — name only).
class CostCenterMonth {
  const CostCenterMonth(this.id, this.code, this.name, this.total);
  final int id;
  final String code;
  final String name;
  final int total;

  static List<CostCenterMonth> listFromJson(Object? rows) => [
    for (final c in _l(rows))
      if (_i(c['total']) != 0) CostCenterMonth(_i(c['id']), _s(c['code']), _s(c['name']), _i(c['total'])),
  ]..sort((a, b) => b.total.compareTo(a.total));
}

/// Finance "Pengajuan baru belum LPJ" (K-12a/b).
class AdvanceWithoutLpj {
  const AdvanceWithoutLpj({
    required this.id,
    this.docNo,
    this.requesters = '',
    this.amount = 0,
    this.ageDays,
    this.overdue = false,
  });
  final int id;
  final String? docNo;
  final String requesters;
  final int amount;
  final int? ageDays;
  final bool overdue;
}

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
    this.pipeline = const Pipeline(),
    this.categories = const CategoryMix(),
    this.sla,
    this.rapMonitor,
    this.loans,
    this.rapMissing,
    this.requestTrend = const [],
    this.accounts = const [],
    this.completeness = const Completeness(),
    this.recentCash = const [],
    this.costCenters = const [],
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

  // DRMS 13/10 Wave 3: the rest of the web "Ringkasan Direktur", in web order.
  final Pipeline pipeline;
  final CategoryMix categories;
  final SlaSummary? sla;
  final RapMonitor? rapMonitor;
  final LoanMonitor? loans;
  final RapMissing? rapMissing;
  final List<RequestTrendPoint> requestTrend;
  final List<AccountBalance> accounts;
  final Completeness completeness;
  final List<RecentCashEntry> recentCash;
  final List<CostCenterMonth> costCenters;

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
      pipeline: Pipeline.fromJson(viz['pipeline']),
      categories: CategoryMix.fromJson(viz['categories']),
      sla: _block(j['sla'], SlaSummary.fromJson),
      rapMonitor: _block(j['rapMonitoring'], RapMonitor.fromJson),
      loans: _block(j['loans'], LoanMonitor.fromJson),
      rapMissing: _block(j['rapMissing'], RapMissing.fromJson),
      requestTrend: _requestTrend(viz['requestTrend']),
      accounts: AccountBalance.listFromJson(cash['accounts'], _codes(j['companies'])),
      completeness: Completeness.fromJson(_m(j['completeness'])),
      recentCash: RecentCashEntry.listFromJson(viz['recentCash']),
      costCenters: CostCenterMonth.listFromJson(j['costCenters']),
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
    this.accounts = const [],
    this.pipeline = const Pipeline(),
    this.advancesWithoutLpj = const [],
    this.lpjDueDays = 0,
    this.recentCash = const [],
    this.categories = const CategoryMix(),
    this.sla,
    this.loans,
    this.lastClosedPeriod,
    this.nextClosable = '',
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

  // DRMS 13/10 Wave 3: the rest of the web "Ringkasan Finance", in web order.
  final List<AccountBalance> accounts;
  final Pipeline pipeline;

  /// Top 8 of `advancesWithoutLpj` (the web card shows 8).
  final List<AdvanceWithoutLpj> advancesWithoutLpj;
  final int lpjDueDays;
  final List<RecentCashEntry> recentCash;
  final CategoryMix categories;
  final SlaSummary? sla;
  final LoanMonitor? loans;
  final String? lastClosedPeriod;
  final String nextClosable;

  static FinanceDashboard fromJson(Json j) {
    final q = _m(j['transferQueue']);
    final viz = _m(j['viz']);
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
      balanceTrend: _trend(viz['balanceTrend'], 'balance'),
      cashFlow: _cashFlow(j['cashFlow']),
      byCompany: _splits(j['companies'], cash: j['cashByCompany'], counts: q['byCompany']),
      accounts: AccountBalance.listFromJson(j['accounts'], _codes(j['companies'])),
      pipeline: Pipeline.fromJson(viz['pipeline']),
      advancesWithoutLpj: [
        for (final a in _l(j['advancesWithoutLpj']).take(8))
          AdvanceWithoutLpj(
            id: _i(a['id']),
            docNo: a['docNo'] as String?,
            requesters: _s(a['requesters']),
            amount: _i(a['transferredTotal']),
            ageDays: _iN(a['ageDays']),
            overdue: a['overdue'] == true,
          ),
      ],
      lpjDueDays: _i(j['lpjDueDays']),
      recentCash: RecentCashEntry.listFromJson(viz['recentCash']),
      categories: CategoryMix.fromJson(viz['categories']),
      sla: _block(j['sla'], SlaSummary.fromJson),
      loans: _block(j['loans'], LoanMonitor.fromJson),
      lastClosedPeriod: j['lastClosedPeriod'] as String?,
      nextClosable: _s(j['nextClosable']),
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
    this.rapMissing,
    this.pipeline = const Pipeline(),
    this.trend = const [],
    this.categories = const CategoryMix(),
    this.loans,
    this.costCenters = const [],
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

  // DRMS 13/10 Wave 3: the rest of the web "Ringkasan PM", in web order.
  final RapMissing? rapMissing;
  final Pipeline pipeline;

  /// `viz.requestTrend` with Σ grand total (the "Tren pengajuan tim" card; [requestTrend] = counts for the sparkline).
  final List<RequestTrendPoint> trend;
  final CategoryMix categories;
  final LoanMonitor? loans;
  final List<CostCenterMonth> costCenters;

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
      rapMissing: _block(j['rapMissing'], RapMissing.fromJson),
      pipeline: Pipeline.fromJson(viz['pipeline']),
      trend: _requestTrend(viz['requestTrend']),
      categories: CategoryMix.fromJson(viz['categories']),
      loans: _block(j['loans'], LoanMonitor.fromJson),
      costCenters: CostCenterMonth.listFromJson(j['costCenters']),
    );
  }
}

/// One own request of the Staff home (`latest[]`, web "Pengajuan saya": number, status, Nominal).
class OwnRequest {
  const OwnRequest({
    required this.id,
    this.docNo,
    this.title = '',
    this.type = '',
    this.status = '',
    this.grandTotal = 0,
  });
  final int id;

  /// null for a draft (web: `Draft "title"`).
  final String? docNo;
  final String title;

  /// `advance` / `reimburse` and the status code (labels: `statusLabelFallback`).
  final String type;
  final String status;
  final int grandTotal;

  static List<OwnRequest> listFromJson(Object? rows) => [
    for (final r in _l(rows))
      OwnRequest(
        id: _i(r['id']),
        docNo: r['docNo'] is String ? r['docNo'] as String : null,
        title: _s(r['title']),
        type: _s(r['type']),
        status: _s(r['status']),
        grandTotal: _i(r['grandTotal']),
      ),
  ];
}

/// `GET /dashboard/me` — Staff home ("Ringkasan pengajuan saya"). The server scopes every block to the caller's OWN
/// requests (`ownScope`). Owner decision 2026-10-13: the phone shows the amounts of those own requests like the web
/// Staff home (month Σ, stage Σ, Σ per month, Nominal of the latest requests) — and no other money (no project
/// budgets, no cash, no other people's requests: `/dashboard/me` carries none).
class StaffDashboard {
  const StaffDashboard({
    this.actions = 0,
    this.pipeline = const Pipeline(),
    this.trend = const [],
    this.latest = const [],
  });

  /// "Perlu tindakan saya": drafts, revisions, receipts or LPJ to send.
  final int actions;

  /// Own requests per stage: count and Σ grand total.
  final Pipeline pipeline;

  /// Own requests per month (6 months, no drafts): count and Σ grand total.
  final List<RequestTrendPoint> trend;

  /// "Pengajuan saya": the 10 latest own requests with their grand total.
  final List<OwnRequest> latest;

  /// "Sedang diproses" = waiting for a decision, in the transfer queue or in LPJ.
  int get inProcess =>
      pipeline.count('ack') + pipeline.count('approval') + pipeline.count('queue') + pipeline.count('lpj');
  int get waitingDecision => pipeline.count('ack') + pipeline.count('approval');
  int get done => pipeline.count('done');
  int get exit => pipeline.exit?.count ?? 0;

  /// The current month of [trend] (web KPI "Pengajuan `bulan`"), null without data.
  RequestTrendPoint? get month => trend.isEmpty ? null : trend.last;

  static StaffDashboard fromJson(Json j) {
    final viz = _m(j['viz']);
    return StaffDashboard(
      actions: _l(j['actions']).length,
      pipeline: Pipeline.fromJson(viz['pipeline']),
      trend: _requestTrend(viz['requestTrend']),
      latest: OwnRequest.listFromJson(j['latest']),
    );
  }
}

/// `GET /dashboard/admin` — Admin home: master-data gaps (the audit log stays on the web).
class AdminDashboard {
  const AdminDashboard({this.usersIncomplete = 0, this.projectsWithoutPm = 0, this.projectsWithoutPusatBiaya = 0});
  final int usersIncomplete;
  final int projectsWithoutPm;

  /// ADR 0031: open projects without Pusat Biaya (cash account) — their transfers are refused until mapped
  /// (`costCentersWithoutManager` is deprecated, always 0).
  final int projectsWithoutPusatBiaya;

  static AdminDashboard fromJson(Json j) {
    final g = _m(j['gaps']);
    return AdminDashboard(
      usersIncomplete: _i(g['usersIncomplete']),
      projectsWithoutPm: _i(g['projectsWithoutPm']),
      projectsWithoutPusatBiaya: _i(g['projectsWithoutPusatBiaya']),
    );
  }
}
