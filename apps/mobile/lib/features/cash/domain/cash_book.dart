// User 2026-10-19 (APK ↔ web parity, phase 3 Keuangan): "Buku kas", "Tutup buku" and "Transfer tercatat" — the
// shapes of `GET /kas/book`, `GET /kas/periods` and `GET /transfers/voidable` (the web pages Kas.tsx / TransferQueue.tsx
// read the same server helpers). Parsing is tolerant (unknown fields ignored, missing ones defaulted).

int _int(Object? v, [int fallback = 0]) =>
    v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? fallback : fallback);
int? _intN(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
String? _strN(Object? v) => v == null ? null : '$v';
Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
Map<String, dynamic>? _mapN(Object? v) => v is Map<String, dynamic> ? v : null;
List<dynamic> _list(Object? v) => v is List ? v : const [];

/// Web `SOURCE` labels of `cash_entries.source_type`.
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

/// Web IC_LOAN_LEG_LABELS (ADR 0029).
const _loanLegLabels = {
  'given': 'Pinjaman antar-PT diberikan',
  'received': 'Pinjaman antar-PT diterima',
  'repaid_in': 'Pengembalian pinjaman antar-PT diterima',
  'repaid_out': 'Pembayaran hutang antar-PT',
};

/// A picker / label option of the book (`lookups.*`).
class CashOption {
  const CashOption({
    required this.id,
    required this.label,
    this.active = true,
    this.companyId,
    this.openingDate,
    this.siteId,
    this.requiresVehicle = false,
  });
  final int id;
  final String label;
  final bool active;
  final int? companyId;

  /// Accounts: opening-balance (go-live) date — the earliest entry date (QA-05).
  final String? openingDate;
  final int? siteId;

  /// Categories: "Kendaraan" is required.
  final bool requiresVehicle;

  /// Shared master (no PT) or one of [companyId].
  bool belongsTo(int companyId) => this.companyId == null || this.companyId == companyId;

  factory CashOption.fromJson(Map<String, dynamic> j) => CashOption(
    id: _int(j['id']),
    label: '${j['label'] ?? ''}',
    active: j['active'] != false,
    companyId: _intN(j['companyId']),
    openingDate: _strN(j['openingDate']),
    siteId: _intN(j['siteId']),
    requiresVehicle: j['requiresVehicle'] == true,
  );
}

class CashLookups {
  const CashLookups({
    this.accounts = const [],
    this.sites = const [],
    this.projects = const [],
    this.costCenters = const [],
    this.categories = const [],
    this.sources = const [],
    this.vehicles = const [],
  });
  final List<CashOption> accounts;
  final List<CashOption> sites;
  final List<CashOption> projects;
  final List<CashOption> costCenters;
  final List<CashOption> categories;
  final List<CashOption> sources;
  final List<CashOption> vehicles;

  static List<CashOption> _opts(Object? v) => [for (final o in _list(v)) CashOption.fromJson(_map(o))];

  factory CashLookups.fromJson(Map<String, dynamic> j) => CashLookups(
    accounts: _opts(j['accounts']),
    sites: _opts(j['sites']),
    projects: _opts(j['projects']),
    costCenters: _opts(j['costCenters']),
    categories: _opts(j['categories']),
    sources: _opts(j['sources']),
    vehicles: _opts(j['vehicles']),
  );

  static String? labelOf(List<CashOption> list, int? id) =>
      id == null ? null : list.where((o) => o.id == id).firstOrNull?.label;
}

/// One shown PT of the book: its lock date ("tutup buku s/d"), business today, first allowed posting date and the
/// caller's rights there (Finance writes, Direktur reopens).
class CashPt {
  const CashPt({
    required this.companyId,
    this.lockDate,
    required this.today,
    this.minDate,
    this.write = false,
    this.reopen = false,
    this.intercompanyReceiving,
  });
  final int companyId;
  final String? lockDate;
  final String today;
  final String? minDate;
  final bool write;
  final bool reopen;

  /// ADR 0028: label of the PT's "Rekening penerimaan antar-PT" (null = not designated).
  final String? intercompanyReceiving;

  factory CashPt.fromJson(Map<String, dynamic> j) => CashPt(
    companyId: _int(j['companyId']),
    lockDate: _strN(j['lockDate']),
    today: '${j['today'] ?? ''}',
    minDate: _strN(j['minDate']),
    write: j['write'] == true,
    reopen: j['reopen'] == true,
    intercompanyReceiving: _strN(j['intercompanyReceiving']),
  );
}

/// A balance tile: the account's balance and its flows in [CashBook.flowPeriod].
class CashAccountTile {
  const CashAccountTile({
    required this.cashAccountId,
    this.companyId,
    required this.name,
    required this.balance,
    this.flowIn = 0,
    this.flowOut = 0,
    this.n = 0,
  });
  final int cashAccountId;
  final int? companyId;
  final String name;
  final int balance;
  final int flowIn;
  final int flowOut;
  final int n;

  factory CashAccountTile.fromJson(Map<String, dynamic> j) => CashAccountTile(
    cashAccountId: _int(j['cashAccountId']),
    companyId: _intN(j['companyId']),
    name: '${j['name'] ?? ''}',
    balance: _int(j['balance']),
    flowIn: _int(j['flowIn']),
    flowOut: _int(j['flowOut']),
    n: _int(j['n']),
  );
}

class CashLink {
  const CashLink({required this.id, required this.no});
  final int id;
  final String no;

  static CashLink? fromJson(Object? v, String noKey) {
    final j = _mapN(v);
    final id = _intN(j?['id']);
    return j == null || id == null ? null : CashLink(id: id, no: '${j[noKey] ?? '#$id'}');
  }
}

/// ADR 0028/0029: the other leg of an intercompany entry (`intercompany`).
class CashCounterpart {
  const CashCounterpart({
    required this.direction,
    required this.voided,
    this.counterpartCode,
    required this.sourceDocType,
    this.loanLeg,
    this.sourceDocNo,
    this.transferDocNo,
    required this.counterpartEntryNo,
  });
  final String direction;
  final bool voided;
  final String? counterpartCode;
  final String sourceDocType;
  final String? loanLeg;
  final String? sourceDocNo;
  final String? transferDocNo;
  final String counterpartEntryNo;

  /// The web IntercompanyLinks text ("Dari PT LAS · PB/… · TRF/… · KK/…").
  String get text {
    final pt = counterpartCode ?? 'lain';
    final tail = voided ? ' (dibatalkan)' : '';
    if (sourceDocType == 'intercompany_loan') {
      final leg = _loanLegLabels[loanLeg] ?? 'Pinjaman antar-PT';
      return [leg, ?sourceDocNo, '${direction == 'out' ? 'ke' : 'dari'} PT $pt', counterpartEntryNo].join(' · ') + tail;
    }
    if (direction == 'out') return 'Ke PT $pt · $counterpartEntryNo$tail';
    return ['Dari PT $pt', ?sourceDocNo, ?transferDocNo, counterpartEntryNo].join(' · ') + tail;
  }

  static CashCounterpart? fromJson(Object? v) {
    final j = _mapN(v);
    if (j == null) return null;
    return CashCounterpart(
      direction: '${j['direction'] ?? 'in'}',
      voided: j['status'] == 'void',
      counterpartCode: _strN(_map(j['counterpartCompany'])['shortCode']),
      sourceDocType: '${j['sourceDocType'] ?? 'expense_request'}',
      loanLeg: _strN(j['loanLeg']),
      sourceDocNo: _strN(j['sourceDocNo']),
      transferDocNo: _strN(j['transferDocNo']),
      counterpartEntryNo: '${j['counterpartEntryNo'] ?? ''}',
    );
  }
}

/// One ledger row (web `BookRow`) with the caller's row actions.
class CashRow {
  const CashRow({
    required this.id,
    this.companyId,
    required this.entryNo,
    required this.entryDate,
    required this.inbound,
    required this.amount,
    required this.voided,
    required this.sourceType,
    this.description,
    required this.cashAccountId,
    this.projectId,
    this.costCenterId,
    this.categoryId,
    this.cashInSourceId,
    this.vehicleId,
    this.proofId,
    this.voidReason,
    this.reversalOf,
    this.reversedBy,
    this.request,
    this.intercompany,
    this.canEdit = false,
    this.canVoid = false,
    this.voidHint,
  });
  final int id;
  final int? companyId;
  final String entryNo;
  final String entryDate;

  /// direction `in` (Kas masuk) vs `out` (Kas keluar).
  final bool inbound;
  final int amount;
  final bool voided;
  final String sourceType;
  final String? description;
  final int cashAccountId;
  final int? projectId;
  final int? costCenterId;
  final int? categoryId;
  final int? cashInSourceId;
  final int? vehicleId;
  final int? proofId;
  final String? voidReason;
  final CashLink? reversalOf;
  final CashLink? reversedBy;
  final CashLink? request;
  final CashCounterpart? intercompany;
  final bool canEdit;
  final bool canVoid;
  final String? voidHint;

  bool get isReversal => sourceType == 'reversal';
  String get sourceLabel => cashSourceLabels[sourceType] ?? sourceType;

  factory CashRow.fromJson(Map<String, dynamic> j) => CashRow(
    id: _int(j['id']),
    companyId: _intN(j['companyId']),
    entryNo: '${j['entryNo'] ?? ''}',
    entryDate: '${j['entryDate'] ?? ''}',
    inbound: j['direction'] == 'in',
    amount: _int(j['amount']),
    voided: j['status'] == 'void',
    sourceType: '${j['sourceType'] ?? 'manual'}',
    description: _strN(j['description']),
    cashAccountId: _int(j['cashAccountId']),
    projectId: _intN(j['projectId']),
    costCenterId: _intN(j['costCenterId']),
    categoryId: _intN(j['categoryId']),
    cashInSourceId: _intN(j['cashInSourceId']),
    vehicleId: _intN(j['vehicleId']),
    proofId: _intN(j['proofId']),
    voidReason: _strN(j['voidReason']),
    reversalOf: CashLink.fromJson(j['reversalOf'], 'entryNo'),
    reversedBy: CashLink.fromJson(j['reversedBy'], 'entryNo'),
    request: CashLink.fromJson(j['request'], 'docNo'),
    intercompany: CashCounterpart.fromJson(j['intercompany']),
    canEdit: j['canEdit'] == true,
    canVoid: j['canVoid'] == true,
    voidHint: _strN(j['voidHint']),
  );
}

class CashBook {
  const CashBook({
    required this.today,
    this.canWrite = false,
    this.pts = const [],
    this.lookups = const CashLookups(),
    this.total = 0,
    this.byPt = const {},
    required this.flowPeriod,
    this.accounts = const [],
    this.rows = const [],
    this.totalDocs = 0,
    this.page = 1,
    this.totalPages = 0,
  });
  final String today;
  final bool canWrite;
  final List<CashPt> pts;
  final CashLookups lookups;
  final int total;
  final Map<int, int> byPt;
  final String flowPeriod;
  final List<CashAccountTile> accounts;
  final List<CashRow> rows;
  final int totalDocs;
  final int page;
  final int totalPages;

  CashPt? pt(int? companyId) => pts.where((p) => p.companyId == companyId).firstOrNull;

  /// PTs where the caller records cash (Finance).
  List<CashPt> get writePts => [
    for (final p in pts)
      if (p.write) p,
  ];

  factory CashBook.fromJson(Map<String, dynamic> j) {
    final page = _map(j['page']);
    return CashBook(
      today: '${j['today'] ?? ''}',
      canWrite: j['canWrite'] == true,
      pts: [for (final p in _list(j['pts'])) CashPt.fromJson(_map(p))],
      lookups: CashLookups.fromJson(_map(j['lookups'])),
      total: _int(j['total']),
      byPt: {for (final b in _list(j['byPt'])) ?_intN(_map(b)['companyId']): _int(_map(b)['total'])},
      flowPeriod: '${j['flowPeriod'] ?? ''}',
      accounts: [for (final a in _list(j['accounts'])) CashAccountTile.fromJson(_map(a))],
      rows: [for (final r in _list(page['rows'])) CashRow.fromJson(_map(r))],
      totalDocs: _int(page['totalDocs']),
      page: _int(page['page'], 1),
      totalPages: _int(page['totalPages']),
    );
  }
}

/// Filters of the book — the web `/admin/kas` query string (multi-select = comma separated).
class CashFilter {
  const CashFilter({
    this.accounts = const {},
    this.period,
    this.direction,
    this.status,
    this.sources = const {},
    this.pt,
    this.q = '',
  });
  final Set<int> accounts;
  final String? period;

  /// `masuk` | `keluar` | null (both).
  final String? direction;

  /// `posted` | `void` | null (both).
  final String? status;
  final Set<String> sources;
  final int? pt;
  final String q;

  bool get active =>
      accounts.isNotEmpty || period != null || direction != null || status != null || sources.isNotEmpty || pt != null;

  Map<String, dynamic> query({int page = 1, int per = 50}) => {
    if (accounts.isNotEmpty) 'akun': accounts.join(','),
    'periode': ?period,
    'arah': ?direction,
    'status': ?status,
    if (sources.isNotEmpty) 'sumber': sources.join(','),
    'pt': ?pt,
    if (q.trim().isNotEmpty) 'q': q.trim(),
    'per': per,
    'hal': page,
  };

  CashFilter copyWith({
    Set<int>? accounts,
    String? Function()? period,
    String? Function()? direction,
    String? Function()? status,
    Set<String>? sources,
    int? Function()? pt,
    String? q,
  }) => CashFilter(
    accounts: accounts ?? this.accounts,
    period: period == null ? this.period : period(),
    direction: direction == null ? this.direction : direction(),
    status: status == null ? this.status : status(),
    sources: sources ?? this.sources,
    pt: pt == null ? this.pt : pt(),
    q: q ?? this.q,
  );

  @override
  bool operator ==(Object other) =>
      other is CashFilter &&
      _setEq(other.accounts, accounts) &&
      other.period == period &&
      other.direction == direction &&
      other.status == status &&
      _setEq(other.sources, sources) &&
      other.pt == pt &&
      other.q == q;

  @override
  int get hashCode => Object.hash(
    Object.hashAllUnordered(accounts),
    period,
    direction,
    status,
    Object.hashAllUnordered(sources),
    pt,
    q,
  );
}

bool _setEq<T>(Set<T> a, Set<T> b) => a.length == b.length && a.containsAll(b);

/// "Dibebankan ke" of the cash form (web scope radio).
enum CashScope { project, costCenter, none }

/// Client checks of "Catat kas" / "Edit" — the web CashEntryForm messages (the server re-checks).
Map<String, String> validateCashEntry({
  required bool edit,
  required bool inbound,
  required int? cashAccountId,
  required int? amount,
  required String description,
  required String? entryDate,
  required String today,
  required String? lockDate,
  required String? openingDate,
  required int? categoryId,
  required int? cashInSourceId,
  required CashScope scope,
  required int? projectId,
  required int? costCenterId,
  String reason = '',
}) {
  final found = <String, String>{};
  if (description.trim().isEmpty) found['description'] = 'Keterangan wajib diisi.';
  if (scope == CashScope.project && projectId == null) found['projectId'] = 'Pilih project.';
  if (scope == CashScope.costCenter && costCenterId == null) found['costCenterId'] = 'Pilih pusat biaya.';
  if (!inbound && categoryId == null) found['categoryId'] = 'Kategori wajib untuk kas keluar.';
  if (inbound && cashInSourceId == null) found['cashInSourceId'] = 'Sumber wajib untuk kas masuk.';
  if (!edit) {
    if (amount == null || amount <= 0) found['amount'] = 'Nominal wajib diisi (Rupiah, bilangan bulat > 0).';
    if (cashAccountId == null) found['cashAccountId'] = 'Pilih akun kas.';
    final date = entryDate ?? '';
    if (date.isEmpty) {
      found['entryDate'] = 'Tanggal wajib diisi.';
    } else if (date.compareTo(today) > 0) {
      found['entryDate'] = 'Tanggal tidak boleh di masa depan.';
    } else if (lockDate != null && date.compareTo(lockDate) <= 0) {
      found['entryDate'] = 'Periode sudah ditutup (tutup buku s/d $lockDate).';
    } else if (openingDate != null && date.compareTo(openingDate) < 0) {
      found['entryDate'] = 'Tanggal sebelum tanggal saldo awal akun (${dmy(openingDate)}).';
    }
  } else if (reason.trim().length < 3) {
    found['reason'] = 'Alasan perubahan wajib diisi (minimal 3 karakter).';
  }
  return found;
}

/// `2026-09-30` → `30/09/2026` (ledger.ts dmy).
String dmy(String d) => d.length < 10 ? d : '${d.substring(8, 10)}/${d.substring(5, 7)}/${d.substring(0, 4)}';

// ---------------------------------------------------------------------------------------------------- Tutup buku

enum PeriodState {
  closed,
  open,
  current;

  static PeriodState fromCode(String? c) => PeriodState.values.where((s) => s.name == c).firstOrNull ?? open;
}

class PeriodRow {
  const PeriodRow({
    required this.period,
    required this.state,
    this.explicit = false,
    this.n = 0,
    this.tin = 0,
    this.tout = 0,
    this.voids = 0,
    this.nKoreksi = 0,
    this.koreksi = 0,
    this.canClose = false,
    this.canReopen = false,
  });
  final String period;
  final PeriodState state;

  /// A "Ditutup" closing row exists for this month (else a closed month is only "Terkunci" by a later close).
  final bool explicit;
  final int n;
  final int tin;
  final int tout;
  final int voids;
  final int nKoreksi;
  final int koreksi;
  final bool canClose;
  final bool canReopen;

  factory PeriodRow.fromJson(Map<String, dynamic> j) => PeriodRow(
    period: '${j['period'] ?? ''}',
    state: PeriodState.fromCode(_strN(j['state'])),
    explicit: j['explicit'] == true,
    n: _int(j['n']),
    tin: _int(j['tin']),
    tout: _int(j['tout']),
    voids: _int(j['voids']),
    nKoreksi: _int(j['nKoreksi']),
    koreksi: _int(j['koreksi']),
    canClose: j['canClose'] == true,
    canReopen: j['canReopen'] == true,
  );
}

class ClosingHistory {
  const ClosingHistory({
    required this.id,
    required this.period,
    required this.closed,
    this.note,
    this.closedBy,
    this.closedAt,
    this.reopenedBy,
    this.reopenedAt,
    this.reopenReason,
  });
  final int id;
  final String period;

  /// status `closed` (else `reopened`).
  final bool closed;
  final String? note;
  final String? closedBy;
  final String? closedAt;
  final String? reopenedBy;
  final String? reopenedAt;
  final String? reopenReason;

  factory ClosingHistory.fromJson(Map<String, dynamic> j) => ClosingHistory(
    id: _int(j['id']),
    period: '${j['period'] ?? ''}',
    closed: j['status'] != 'reopened',
    note: _strN(j['note']),
    closedBy: _strN(j['closedBy']),
    closedAt: _strN(j['closedAt']),
    reopenedBy: _strN(j['reopenedBy']),
    reopenedAt: _strN(j['reopenedAt']),
    reopenReason: _strN(j['reopenReason']),
  );
}

/// `GET /kas/periods`: one PT's closing overview, or (company null) the PT chooser of a multi-PT caller.
class PeriodOverview {
  const PeriodOverview({
    this.company,
    this.locks = const {},
    this.today,
    this.lockDate,
    this.booksStart,
    this.latestClosed,
    this.canReopen = false,
    this.closable = const [],
    this.rows = const [],
    this.history = const [],
  });
  final int? company;

  /// Lock date per closable PT (the chooser).
  final Map<int, String?> locks;
  final String? today;
  final String? lockDate;
  final String? booksStart;
  final String? latestClosed;
  final bool canReopen;
  final List<String> closable;
  final List<PeriodRow> rows;
  final List<ClosingHistory> history;

  factory PeriodOverview.fromJson(Map<String, dynamic> j) => PeriodOverview(
    company: _intN(j['company']),
    locks: {for (final p in _list(j['pts'])) ?_intN(_map(p)['companyId']): _strN(_map(p)['lockDate'])},
    today: _strN(j['today']),
    lockDate: _strN(j['lockDate']),
    booksStart: _strN(j['booksStart']),
    latestClosed: _strN(j['latestClosed']),
    canReopen: j['canReopen'] == true,
    closable: [for (final p in _list(j['closable'])) '$p'],
    rows: [for (final r in _list(j['rows'])) PeriodRow.fromJson(_map(r))],
    history: [for (final h in _list(j['history'])) ClosingHistory.fromJson(_map(h))],
  );
}

const _monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const _monthsLong = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/// Web `periodLabel`: `2026-09` → "September 2026".
String periodLabel(String period) {
  final m = int.tryParse(period.length >= 7 ? period.substring(5, 7) : '');
  if (m == null || m < 1 || m > 12) return period;
  return '${_monthsLong[m - 1]} ${period.substring(0, 4)}';
}

/// Web `dayMonth`: `2026-09-30` → "30 Sep 2026".
String dayMonth(String? date) {
  if (date == null || date.length < 10) return date ?? '-';
  final m = int.tryParse(date.substring(5, 7));
  if (m == null || m < 1 || m > 12) return date;
  return '${int.parse(date.substring(8, 10))} ${_monthsShort[m - 1]} ${date.substring(0, 4)}';
}

/// Last day of a `YYYY-MM` period.
String periodEnd(String period) {
  final y = int.parse(period.substring(0, 4));
  final m = int.parse(period.substring(5, 7));
  final last = DateTime.utc(y, m + 1, 0).day;
  return '$period-${last.toString().padLeft(2, '0')}';
}

// ---------------------------------------------------------------------------------------------------- void transfer

/// A recorded transfer whose request is still "Sudah Ditransfer" (web "Transfer tercatat — dapat dibatalkan").
class VoidableTransfer {
  const VoidableTransfer({
    required this.transferId,
    this.companyId,
    required this.transferNo,
    required this.transferDate,
    required this.amount,
    required this.requestId,
    this.requestNo,
    required this.requestTitle,
    required this.advance,
    this.canVoid = false,
  });
  final int transferId;
  final int? companyId;
  final String transferNo;
  final String transferDate;
  final int amount;
  final int requestId;
  final String? requestNo;
  final String requestTitle;

  /// requestType `advance` (Pengajuan Baru) vs `reimburse`.
  final bool advance;
  final bool canVoid;

  factory VoidableTransfer.fromJson(Map<String, dynamic> j) => VoidableTransfer(
    transferId: _int(j['transferId']),
    companyId: _intN(j['companyId']),
    transferNo: '${j['transferNo'] ?? ''}',
    transferDate: '${j['transferDate'] ?? ''}',
    amount: _int(j['amount']),
    requestId: _int(j['requestId']),
    requestNo: _strN(j['requestNo']),
    requestTitle: '${j['requestTitle'] ?? ''}',
    advance: j['requestType'] != 'reimburse',
    canVoid: j['canVoid'] == true,
  );
}

class VoidablePage {
  const VoidablePage({this.items = const [], this.total = 0, this.page = 1, this.totalPages = 0});
  final List<VoidableTransfer> items;
  final int total;
  final int page;
  final int totalPages;

  factory VoidablePage.fromJson(Map<String, dynamic> j) => VoidablePage(
    items: [for (final i in _list(j['items'])) VoidableTransfer.fromJson(_map(i))],
    total: _int(j['total']),
    page: _int(j['page'], 1),
    totalPages: _int(j['totalPages']),
  );
}
