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

ProjectSummary projectFromJson(Map<String, dynamic> j) {
  final pm = _map(j['pm']);
  final rap = _map(j['rap']);
  return ProjectSummary(
    id: _intN(j['id']) ?? 0,
    code: '${j['code'] ?? ''}',
    name: '${j['name'] ?? ''}',
    companyId: companyIdOf(j),
    pm: pm == null || _intN(pm['id']) == null ? null : RefItem(id: _intN(pm['id'])!, name: _strN(pm['name'])),
    status: _strN(j['status']),
    statusLabel: _strN(j['statusLabel']),
    contractValue: _intN(j['contractValue']),
    rapPlanned: _intN(j['rapPlanned'] ?? rap?['planned']),
    rapRealised: _intN(j['rapRealised'] ?? rap?['realised']),
  );
}

ProjectDetail projectDetailFromJson(Map<String, dynamic> j) {
  final rap = _map(j['rap']) ?? _map(j['rapSummary']);
  final cc = _map(j['costCenter']);
  return ProjectDetail(
    project: projectFromJson(j),
    companyName: _strN(_map(j['company'])?['name']),
    costCenter: cc == null || _intN(cc['id']) == null
        ? null
        : RefItem(id: _intN(cc['id'])!, code: _strN(cc['code']), name: _strN(cc['name'])),
    rapRemaining: _intN(j['rapRemaining'] ?? rap?['remaining']),
    rapItems: _intN(rap?['items'] ?? rap?['count']),
  );
}

/// One item of `GET /projects/{id}/rap` (D4 cost realisation). Also reads the P3 item shape (`description`,
/// `uom {code}`, `volume`, `value`) so the picker works against a server that only has the daily-report RAP.
RapBudgetItem rapBudgetItemFromJson(Map<String, dynamic> j) {
  final uom = j['uom'];
  final planned = _intN(j['planned'] ?? j['value']);
  // `realised` of the P3 shape is a quantity (daily reports); the money realisation comes with `planned`.
  final realised = _intN(j['realisedAmount'] ?? (j.containsKey('planned') ? j['realised'] : null));
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

  /// `GET /projects/{id}/rap` — active items with plan / realisation / remaining.
  Future<List<RapBudgetItem>> rap(int projectId) => client.run(
    (d) => d.get<dynamic>('/projects/$projectId/rap', options: ApiClient.allCompanies()),
    (data) => [
      for (final i in _list(_map(data)?['items']))
        if (_map(i) case final j? when j['active'] != false) rapBudgetItemFromJson(j),
    ],
  );

  /// `GET /expense-requests?project=&q=&status=&page=` — requests of one project (tab "Pengajuan").
  Future<PageResult<ExpenseSummary>> requests(
    int projectId, {
    String q = '',
    String? status,
    int page = 1,
    String? cursor,
  }) => client.run(
    (d) => d.get<dynamic>(
      '/expense-requests',
      queryParameters: {
        'scope': 'all',
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
