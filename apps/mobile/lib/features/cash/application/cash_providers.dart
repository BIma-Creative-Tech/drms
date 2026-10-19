import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/cash_api.dart';
import '../domain/cash_book.dart';

final cashApiProvider = Provider((ref) => CashApi(ref.watch(apiClientProvider)));

/// First page of "Buku kas" for a filter (PT switcher selection; reloads with it like every server list).
final cashBookProvider = FutureProvider.autoDispose.family<CashBook, CashFilter>(
  (ref, filter) => ref.watch(cashApiProvider).book(filter),
);

/// "Bukti" of an entry.
final cashAttachmentProvider = FutureProvider.autoDispose.family<Uint8List, int>(
  (ref, id) => ref.watch(cashApiProvider).attachment(id),
);

/// "Tutup buku" of one PT (null = the only PT, or the chooser).
final periodOverviewProvider = FutureProvider.autoDispose.family<PeriodOverview, int?>(
  (ref, company) => ref.watch(cashApiProvider).periods(company),
);

/// "Transfer tercatat — dapat dibatalkan" (first page per search text).
final voidableTransfersProvider = FutureProvider.autoDispose.family<VoidablePage, String>(
  (ref, q) => ref.watch(cashApiProvider).voidableTransfers(q: q),
);
