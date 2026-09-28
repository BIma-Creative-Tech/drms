import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../expense/domain/expense_request.dart';
import '../data/approvals_api.dart';

final inboxProvider = FutureProvider.autoDispose<InboxPage>((ref) => ref.watch(approvalsApiProvider).inbox());

/// MC3: LPJ waiting for verification (Finance / Direktur), `GET /lpj-queue`.
final lpjQueueProvider = FutureProvider.autoDispose<List<ExpenseSummary>>(
  (ref) => ref.watch(approvalsApiProvider).lpjQueue(),
);
