import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/loans_api.dart';
import '../domain/loan.dart';

final loansApiProvider = Provider((ref) => LoansApi(ref.watch(apiClientProvider)));

/// Loans waiting for the caller's decision (Direktur pool).
final loanInboxProvider = FutureProvider.autoDispose<List<Loan>>((ref) => ref.watch(loansApiProvider).inbox());

/// Loans of one project (as lender and as borrower), newest first.
final projectLoansProvider = FutureProvider.autoDispose.family<LoanPage, int>(
  (ref, projectId) => ref.watch(loansApiProvider).list(projectId: projectId, limit: 100),
);

final loanDetailProvider = FutureProvider.autoDispose.family<Loan, int>(
  (ref, id) => ref.watch(loansApiProvider).detail(id),
);

/// Create-form options (borrower projects of the caller, lender projects of the same PT).
final loanOptionsProvider = FutureProvider.autoDispose<LoanOptions>((ref) => ref.watch(loansApiProvider).options());
