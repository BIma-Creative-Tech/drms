import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/addendum_api.dart';
import '../domain/addendum.dart';

final addendumApiProvider = Provider((ref) => AddendumApi(ref.watch(apiClientProvider)));

/// Addenda waiting for the caller (Direktur / Finance).
final addendumInboxProvider = FutureProvider.autoDispose<List<Addendum>>(
  (ref) => ref.watch(addendumApiProvider).inbox(),
);

final addendumListProvider = FutureProvider.autoDispose<AddendumPage>((ref) => ref.watch(addendumApiProvider).list());

final addendumDetailProvider = FutureProvider.autoDispose.family<Addendum, int>(
  (ref, id) => ref.watch(addendumApiProvider).detail(id),
);
