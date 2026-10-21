import 'dart:typed_data';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../expense/presentation/receipt_capture.dart';
import '../data/finance_api.dart';
import '../domain/transfer_queue.dart';

final financeApiProvider = Provider((ref) => FinanceApi(ref.watch(apiClientProvider)));

/// "Antrian Transfer" of the PT switcher selection (reloads with the selection, like every server list).
final transferQueueProvider = FutureProvider.autoDispose<List<TransferQueueItem>>(
  (ref) => ref.watch(financeApiProvider).transferQueue(),
);

/// Cash accounts of one PT for the transfer form.
final cashAccountsProvider = FutureProvider.autoDispose.family<List<CashAccountOption>, int?>(
  (ref, companyId) => ref.watch(financeApiProvider).cashAccounts(companyId),
);

/// Camera / gallery picker of the transfer proof (same capture as receipts; replaced in tests).
typedef ProofPicker = Future<Uint8List?> Function(BuildContext context, {required bool fromCamera});

final proofPickerProvider = Provider<ProofPicker>((ref) => pickReceiptImage);
