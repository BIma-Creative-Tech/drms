import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../domain/report.dart';
import 'reports_api.dart';

final reportsApiProvider = Provider((ref) => ReportsApi(ref.watch(apiClientProvider)));

/// The caller's report list (PT switcher selection).
final reportIndexProvider = FutureProvider.autoDispose<List<ReportSummary>>(
  (ref) => ref.watch(reportsApiProvider).index(),
);

/// One report page for a filter set + cursor.
final reportPageProvider = FutureProvider.autoDispose.family<ReportPage, ReportQuery>(
  (ref, q) => ref.watch(reportsApiProvider).page(q),
);
