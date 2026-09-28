import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../auth/application/auth_controller.dart';
import '../data/company_backfill.dart';

final companyBackfillProvider = Provider((ref) => CompanyBackfill(ref.watch(databaseProvider)));

/// Offline rows written before the multi-PT update that still wait for the user's PT choice (only an
/// account with several PTs can have them; one PT is assigned automatically).
final unassignedCountProvider = StreamProvider<int>((ref) {
  final sub = ref.watch(currentSubProvider);
  final multi = ref.watch(accountProfileProvider)?.isMultiCompany ?? false;
  if (sub == null || !multi) return Stream.value(0);
  return ref.watch(companyBackfillProvider).watchUnassignedCount(sub);
});

final unassignedItemsProvider = FutureProvider.autoDispose<List<UnassignedItem>>((ref) async {
  ref.watch(unassignedCountProvider);
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return const [];
  return ref.watch(companyBackfillProvider).unassigned(sub);
});
