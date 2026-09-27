import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../auth/application/auth_controller.dart';
import '../data/notifications_api.dart';
import '../domain/app_notification.dart';

final notificationsApiProvider = Provider((ref) => NotificationsApi(ref.watch(apiClientProvider)));

/// Poll interval of the in-app bell while the home screen is shown (push is off, ADR 0011).
const notificationPollInterval = Duration(minutes: 2);

/// Latest page of the caller's notifications; re-fetched every [notificationPollInterval] while
/// watched. Offline → error state, the bell simply shows no count.
final notificationsProvider = FutureProvider.autoDispose<NotificationPage>((ref) async {
  if (ref.watch(currentSubProvider) == null) return const NotificationPage([], 0, null);
  final timer = Timer(notificationPollInterval, ref.invalidateSelf);
  ref.onDispose(timer.cancel);
  return ref.watch(notificationsApiProvider).list();
});
