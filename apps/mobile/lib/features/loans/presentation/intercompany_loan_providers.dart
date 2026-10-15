import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/intercompany_loans_api.dart';
import '../domain/intercompany_loan.dart';

final intercompanyLoansApiProvider = Provider((ref) => IntercompanyLoansApi(ref.watch(apiClientProvider)));

/// ADR 0029: "Pencairan pinjaman antar-PT" — instructed loans waiting for the caller's (lender) Finance PTs (the PT
/// switcher selection, like the transfer queue).
final icLoanQueueProvider = FutureProvider.autoDispose<IcLoanQueue>(
  (ref) => ref.watch(intercompanyLoansApiProvider).queue(),
);

final icLoanDetailProvider = FutureProvider.autoDispose.family<IcLoan, int>(
  (ref, id) => ref.watch(intercompanyLoansApiProvider).detail(id),
);

/// Lender list of the instruction form for a borrower PT and the needed amount (Owner only).
final icLenderOptionsProvider = FutureProvider.autoDispose.family<IcLenderOptions, ({int borrower, int? amount})>(
  (ref, q) => ref.watch(intercompanyLoansApiProvider).lenders(q.borrower, amount: q.amount),
);
