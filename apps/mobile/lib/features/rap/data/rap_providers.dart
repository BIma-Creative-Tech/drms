import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../domain/rap_edit.dart';
import 'rap_api.dart';

final rapApiProvider = Provider((ref) => RapApi(ref.watch(apiClientProvider)));

final rapEditProvider = FutureProvider.autoDispose.family<RapEditData, int>(
  (ref, projectId) => ref.watch(rapApiProvider).load(projectId),
);

final rapUomsProvider = FutureProvider.autoDispose<List<(int, String)>>((ref) => ref.watch(rapApiProvider).uoms());
