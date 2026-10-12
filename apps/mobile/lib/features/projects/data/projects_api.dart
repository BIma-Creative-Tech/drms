import '../../../core/network/api_client.dart';
import '../../expense/data/expense_mappers.dart';
import '../../expense/domain/expense_request.dart';
import '../domain/project.dart';

int? _intN(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
double? _dblN(Object? v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) : null);
String? _strN(Object? v) => v == null ? null : '$v';
List<dynamic> _list(Object? v) => v is List ? v : const [];
Map<String, dynamic>? _map(Object? v) => v is Map<String, dynamic> ? v : null;

/// `{docs|items, totalDocs, page, totalPages, nextCursor}` → page (tolerant: Payload-style pages and the older
/// cursor lists both work).
PageResult<T> pageFromJson<T>(Object? data, T Function(Map<String, dynamic>) item, {required int page}) {
  final m = _map(data) ?? const <String, dynamic>{};
  final raw = m['docs'] ?? m['items'];
  final items = [
    for (final i in _list(raw))
      if (_map(i) case final j?) item(j),
  ];
  final totalPages = _intN(m['totalPages']);
  final cur = _intN(m['page']) ?? page;
  final hasMore = totalPages != null
      ? cur < totalPages
      : (m['hasNextPage'] == true || (m['nextCursor'] is String && (m['nextCursor'] as String).isNotEmpty));
  final cursor = m['nextCursor'];
  return PageResult(
    items: items,
    page: cur,
    hasMore: hasMore,
    total: _intN(m['totalDocs']),
    nextCursor: cursor is String && cursor.isNotEmpty ? cursor : null,
  );
}

RefItem? _ref(Object? v) {
  final m = _map(v);
  final id = _intN(m?['id']);
  return id == null ? null : RefItem(id: id, code: _strN(m!['code']), name: _strN(m['name']));
}

ProjectSummary projectFromJson(Map<String, dynamic> j) => ProjectSummary(
  id: _intN(j['id']) ?? 0,
  code: '${j['code'] ?? ''}',
  name: '${j['name'] ?? ''}',
  kind: _strN(j['kind']),
  companyId: companyIdOf(j),
  pm: _ref(j['pm']),
  status: _strN(j['status']),
  statusLabel: _strN(j['statusLabel']),
  contractValue: _intN(j['contractValue']),
  progressPct: _dblN(j['progressPct']),
  costCenter: _ref(j['costCenter']),
  site: _ref(j['site']),
  rapPlanned: _intN(j['rapPlanned'] ?? _map(j['rap'])?['planned']),
  rapRealised: _intN(j['rapRealised'] ?? _map(j['rap'])?['realised']),
  rapPercentServer: _dblN(j['rapPercent'] ?? _map(j['rap'])?['percent']),
  rapOverBudgetItems: _intN(j['rapOverBudgetItems'] ?? _map(j['rap'])?['overBudgetItems']),
  rapItems: _intN(j['rapItems'] ?? _map(j['rap'])?['items']) ?? 0,
);

ProjectDetail projectDetailFromJson(Map<String, dynamic> j) {
  final rap = _map(j['rap']) ?? const <String, dynamic>{};
  return ProjectDetail(
    project: projectFromJson(j),
    client: _ref(j['client']),
    address: _strN(j['address']),
    startDate: _strN(j['startDate']),
    targetDate: _strN(j['targetDate']),
    rap: RapSummary(
      items: _intN(rap['items']) ?? 0,
      planned: _intN(rap['planned']),
      realised: _intN(rap['realised']),
      transferred: _intN(rap['transferred']),
      remaining: _intN(rap['remaining']),
      percent: _dblN(rap['percent']),
      overBudgetItems: _intN(rap['overBudgetItems']),
    ),
  );
}

/// One item of `GET /projects/{id}/rap` (D4 cost realisation). Also reads the P3 item shape (`description`,
/// `uom {code}`, `volume`, `value`) so the picker works against a server that only has the daily-report RAP.
RapBudgetItem rapBudgetItemFromJson(Map<String, dynamic> j) {
  final uom = j['uom'];
  final planned = _intN(j['planned'] ?? j['value']);
  // `realised` stays the realised QUANTITY of the daily reports (P3); the money is `realisedAmount` (D4).
  final realised = _intN(j['realisedAmount']);
  final remaining = _intN(j['remaining']) ?? (planned == null ? null : planned - (realised ?? 0));
  return RapBudgetItem(
    id: _intN(j['id']) ?? 0,
    code: '${j['code'] ?? ''}',
    name: '${j['name'] ?? j['description'] ?? ''}',
    uom: uom is String ? uom : '${_map(uom)?['code'] ?? _map(uom)?['name'] ?? ''}',
    qty: _dblN(j['qty'] ?? j['volume']),
    unitPrice: _intN(j['unitPrice']),
    planned: planned,
    realised: realised,
    remaining: remaining,
    percent: _dblN(j['percent']),
    active: j['active'] != false,
  );
}

/// DRMS 10/10 point 6/7 + D4: projects, their RAP with cost realisation and their requests. Online reads.
class ProjectsApi {
  ProjectsApi(this.client);
  final ApiClient client;

  static const pageSize = 20;

  /// `GET /projects?q=&page=&limit=&status=` — projects of the PT switcher selection the caller may see.
  Future<PageResult<ProjectSummary>> list({String q = '', String? status, int page = 1}) => client.run(
    (d) => d.get<dynamic>(
      '/projects',
      queryParameters: {if (q.trim().isNotEmpty) 'q': q.trim(), 'status': ?status, 'page': page, 'limit': pageSize},
    ),
    (data) => pageFromJson(data, projectFromJson, page: page),
  );

  /// `GET /projects/{id}` (one document: the role in its PT counts, not the PT switcher).
  Future<ProjectDetail> detail(int id) => client.run(
    (d) => d.get<dynamic>('/projects/$id', options: ApiClient.allCompanies()),
    (data) => projectDetailFromJson(_map(data) ?? const {}),
  );

  /// `GET /projects/{id}/rap` — items with plan / realisation / remaining (deactivated ones too when they carry
  /// realisation; see [RapBudgetItem.active]).
  Future<List<RapBudgetItem>> rap(int projectId) => client.run(
    (d) => d.get<dynamic>('/projects/$projectId/rap', options: ApiClient.allCompanies()),
    (data) => [
      for (final i in _list(_map(data)?['items']))
        if (_map(i) case final j?) rapBudgetItemFromJson(j),
    ],
  );

  /// `GET /expense-requests?project=&q=&status=&page=` — requests of one project (tab "Pengajuan"); [mine] = only the
  /// caller's own (`scope=mine`, Staff).
  Future<PageResult<ExpenseSummary>> requests(
    int projectId, {
    String q = '',
    String? status,
    bool mine = false,
    int page = 1,
    String? cursor,
  }) => client.run(
    (d) => d.get<dynamic>(
      '/expense-requests',
      queryParameters: {
        'scope': mine ? 'mine' : 'all',
        'project': projectId,
        if (q.trim().isNotEmpty) 'q': q.trim(),
        'status': ?status,
        'page': page,
        'cursor': ?cursor,
        'limit': pageSize,
      },
      options: ApiClient.allCompanies(),
    ),
    (data) => pageFromJson(data, summaryFromJson, page: page),
  );
}
