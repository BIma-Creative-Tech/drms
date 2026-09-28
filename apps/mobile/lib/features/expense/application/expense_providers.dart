import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../masters/domain/master_item.dart';
import '../domain/draft.dart';
import '../domain/expense_request.dart';

final openDraftsProvider = StreamProvider<List<DraftRequest>>((ref) {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return Stream.value(const []);
  return ref.watch(draftRepositoryProvider).watchOpenDrafts(sub);
});

/// Cached masters of the PT switcher scope (MC3: union of the selected PTs + shared masters).
final mastersProvider = FutureProvider<Map<String, List<MasterItem>>>((ref) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const {};
  ref.watch(mastersRevisionProvider);
  final profile = ref.watch(currentProfileProvider);
  final scope = profile == null || profile.companies.isEmpty ? null : profile.scopedCompanies.map((c) => c.id);
  return ref.watch(mastersRepositoryProvider).cached(sub, companyIds: scope);
});

/// Cached masters of ONE PT (pickers of a draft / report of that PT). Null = no PT known (server before
/// MC3 / legacy draft of a single-PT account): the whole cache, as before.
final mastersForCompanyProvider = FutureProvider.family<Map<String, List<MasterItem>>, int?>((ref, companyId) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const {};
  ref.watch(mastersRevisionProvider);
  return ref.watch(mastersRepositoryProvider).cached(sub, companyId: companyId);
});

final requestDetailProvider = FutureProvider.autoDispose.family<ExpenseDetail, int>(
  (ref, id) => ref.watch(expenseApiProvider).detail(id),
);

class RequestListState {
  const RequestListState({this.items = const [], this.nextCursor, this.loadingMore = false});
  final List<ExpenseSummary> items;
  final String? nextCursor;
  final bool loadingMore;
}

/// Server list, scope `mine` (Staff/PM) or `all` (Direktur/Finance), cursor paging.
final requestListProvider = AsyncNotifierProvider.family<RequestList, RequestListState, String>(RequestList.new);

class RequestList extends AsyncNotifier<RequestListState> {
  RequestList(this.scope);
  final String scope;

  @override
  Future<RequestListState> build() async {
    // The API client follows the PT switcher (X-Company-Ids): a new selection re-loads the list.
    final page = await ref.watch(expenseApiProvider).list(scope: scope);
    return RequestListState(items: page.items, nextCursor: page.nextCursor);
  }

  Future<void> loadMore() async {
    final cur = state.value;
    if (cur == null || cur.nextCursor == null || cur.loadingMore) return;
    state = AsyncData(RequestListState(items: cur.items, nextCursor: cur.nextCursor, loadingMore: true));
    try {
      final page = await ref.read(expenseApiProvider).list(scope: scope, cursor: cur.nextCursor);
      state = AsyncData(RequestListState(items: [...cur.items, ...page.items], nextCursor: page.nextCursor));
    } on Object {
      state = AsyncData(RequestListState(items: cur.items, nextCursor: cur.nextCursor));
      rethrow;
    }
  }
}
