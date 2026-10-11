import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/network/api_exception.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/domain/expense_request.dart';
import '../data/projects_api.dart';
import '../domain/project.dart';

final projectsApiProvider = Provider((ref) => ProjectsApi(ref.watch(apiClientProvider)));

/// Loaded pages of a server list (infinite scroll, D8).
class PagedState<T> {
  const PagedState({
    this.items = const [],
    this.page = 1,
    this.hasMore = false,
    this.nextCursor,
    this.loadingMore = false,
  });
  final List<T> items;
  final int page;
  final bool hasMore;
  final String? nextCursor;
  final bool loadingMore;

  PagedState<T> append(PageResult<T> next) =>
      PagedState(items: [...items, ...next.items], page: next.page, hasMore: next.hasMore, nextCursor: next.nextCursor);
}

/// Search text + status filter of a list.
typedef ListFilter = ({String q, String? status});

/// "Proyek" list of the PT switcher selection, `GET /projects` (search, status filter, pages of 20).
final projectListProvider = AsyncNotifierProvider.autoDispose
    .family<ProjectList, PagedState<ProjectSummary>, ListFilter>(ProjectList.new);

class ProjectList extends AsyncNotifier<PagedState<ProjectSummary>> {
  ProjectList(this.filter);
  final ListFilter filter;

  @override
  Future<PagedState<ProjectSummary>> build() async {
    final first = await ref.watch(projectsApiProvider).list(q: filter.q, status: filter.status);
    return const PagedState<ProjectSummary>().append(first);
  }

  Future<void> loadMore() async {
    final cur = state.value;
    if (cur == null || !cur.hasMore || cur.loadingMore) return;
    state = AsyncData(
      PagedState(items: cur.items, page: cur.page, hasMore: cur.hasMore, nextCursor: cur.nextCursor, loadingMore: true),
    );
    try {
      final next = await ref.read(projectsApiProvider).list(q: filter.q, status: filter.status, page: cur.page + 1);
      state = AsyncData(cur.append(next));
    } on Object {
      state = AsyncData(cur);
      rethrow;
    }
  }
}

final projectDetailProvider = FutureProvider.autoDispose.family<ProjectDetail, int>(
  (ref, id) => ref.watch(projectsApiProvider).detail(id),
);

/// Tab "Pengajuan" of a project: `GET /expense-requests?project=` with search + status filter.
typedef ProjectRequestsArgs = ({int projectId, String q, String? status});

final projectRequestsProvider = AsyncNotifierProvider.autoDispose
    .family<ProjectRequests, PagedState<ExpenseSummary>, ProjectRequestsArgs>(ProjectRequests.new);

class ProjectRequests extends AsyncNotifier<PagedState<ExpenseSummary>> {
  ProjectRequests(this.args);
  final ProjectRequestsArgs args;

  @override
  Future<PagedState<ExpenseSummary>> build() async {
    final first = await ref.watch(projectsApiProvider).requests(args.projectId, q: args.q, status: args.status);
    return const PagedState<ExpenseSummary>().append(first);
  }

  Future<void> loadMore() async {
    final cur = state.value;
    if (cur == null || !cur.hasMore || cur.loadingMore) return;
    state = AsyncData(
      PagedState(items: cur.items, page: cur.page, hasMore: cur.hasMore, nextCursor: cur.nextCursor, loadingMore: true),
    );
    try {
      final next = await ref
          .read(projectsApiProvider)
          .requests(args.projectId, q: args.q, status: args.status, page: cur.page + 1, cursor: cur.nextCursor);
      state = AsyncData(cur.append(next));
    } on Object {
      state = AsyncData(cur);
      rethrow;
    }
  }
}

/// RAP items of a project for the line editor (D4) and the "RAP" tab.
class RapLoad {
  const RapLoad(this.items, {this.offline = false});
  final List<RapBudgetItem> items;

  /// From the offline cache: codes and names only, no money (remaining budget unknown).
  final bool offline;

  RapBudgetItem? byId(int? id) => id == null ? null : items.where((i) => i.id == id).firstOrNull;

  /// Items a line may be charged to (active ones).
  List<RapBudgetItem> get pickable => items.where((i) => i.active).toList();
}

/// kv key of the offline RAP item list of [projectId] (per user, no money).
String rapCacheKey(String sub, int projectId) => 'rap-budget:$sub:$projectId';

/// `GET /projects/{id}/rap`; each successful read refreshes the offline copy (code / name / satuan only) so a
/// draft line can still pick its RAP item without signal.
final projectRapProvider = FutureProvider.autoDispose.family<RapLoad, int>((ref, projectId) async {
  final sub = ref.watch(currentSubProvider);
  final db = ref.watch(databaseProvider);
  try {
    final items = await ref.watch(projectsApiProvider).rap(projectId);
    if (sub != null) {
      await db.kvPut(
        rapCacheKey(sub, projectId),
        jsonEncode([
          for (final i in items)
            if (i.active) i.toCacheJson(),
        ]),
      );
    }
    return RapLoad(items);
  } on NetworkException {
    final cached = sub == null ? null : await db.kvGet(rapCacheKey(sub, projectId));
    if (cached == null) rethrow;
    return RapLoad([
      for (final r in (jsonDecode(cached) as List<dynamic>).whereType<Map<String, dynamic>>())
        RapBudgetItem(
          id: (r['id'] as num).toInt(),
          code: '${r['code'] ?? ''}',
          name: '${r['name'] ?? ''}',
          uom: '${r['uom'] ?? ''}',
        ),
    ], offline: true);
  }
});
