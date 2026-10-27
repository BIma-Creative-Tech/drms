import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/loans_api.dart';
import '../domain/loan.dart';

final loansApiProvider = Provider((ref) => LoansApi(ref.watch(apiClientProvider)));

/// Loans and repayment requests waiting for the caller's decision (Direktur level 1, Owner level 2).
final loanInboxProvider = FutureProvider.autoDispose<LoanInbox>((ref) => ref.watch(loansApiProvider).inbox());

/// User decision 2026-10-24: approved cash-backed loans / repayments waiting in the "Antrian Transfer" (PT switcher
/// selection, like the transfer queue).
final loanTransferOrdersProvider = FutureProvider.autoDispose<LoanTransferOrders>(
  (ref) => ref.watch(loansApiProvider).transferOrders(),
);

/// Loans of one project (as lender and as borrower), newest first.
final projectLoansProvider = FutureProvider.autoDispose.family<LoanPage, int>(
  (ref, projectId) => ref.watch(loansApiProvider).list(projectId: projectId, limit: 100),
);

final loanDetailProvider = FutureProvider.autoDispose.family<Loan, int>(
  (ref, id) => ref.watch(loansApiProvider).detail(id),
);

/// Create-form options (borrower projects of the caller, lender projects of the same PT).
final loanOptionsProvider = FutureProvider.autoDispose<LoanOptions>((ref) => ref.watch(loansApiProvider).options());
