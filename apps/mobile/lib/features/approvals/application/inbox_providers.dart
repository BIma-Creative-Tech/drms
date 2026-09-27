import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/approvals_api.dart';

final inboxProvider = FutureProvider.autoDispose<InboxPage>((ref) => ref.watch(approvalsApiProvider).inbox());
