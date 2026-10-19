import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../domain/record_form.dart';
import '../domain/record_list.dart';
import 'records_api.dart';

final recordsApiProvider = Provider((ref) => RecordsApi(ref.watch(apiClientProvider)));

final recordPageProvider = FutureProvider.autoDispose.family<RecordPage, RecordQuery>(
  (ref, q) => ref.watch(recordsApiProvider).list(q.collection, q: q.q),
);

final recordDetailProvider = FutureProvider.autoDispose.family<RecordDetail, (String, String)>(
  (ref, k) => ref.watch(recordsApiProvider).detail(k.$1, k.$2),
);

/// The edit form of a collection (id null = "Tambah").
final recordFormProvider = FutureProvider.autoDispose.family<RecordFormDef, (String, String?)>(
  (ref, k) => ref.watch(recordsApiProvider).form(k.$1, id: k.$2),
);
