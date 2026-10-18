import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/account_api.dart';
import '../domain/account.dart';

final accountApiProvider = Provider((ref) => AccountApi(ref.watch(apiClientProvider)));

/// Online only (like the web page): account data is never cached on the phone.
final meAccountProvider = FutureProvider.autoDispose<MeAccount>((ref) => ref.watch(accountApiProvider).account());

/// Profile signature image (authorized file endpoint, kept in memory only).
final profileSignatureImageProvider = FutureProvider.autoDispose.family<Uint8List, int>(
  (ref, id) => ref.watch(accountApiProvider).signatureImage(id),
);

final meSecurityProvider = FutureProvider.autoDispose<MeSecurity>((ref) => ref.watch(accountApiProvider).security());
