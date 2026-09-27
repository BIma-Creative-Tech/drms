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

final mastersProvider = FutureProvider<Map<String, List<MasterItem>>>((ref) async {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const {};
  return ref.watch(mastersRepositoryProvider).cached(sub);
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
