/// Push notifications (FCM data messages, ADR 0011). F4a ships only this seam: there is no Firebase
/// project yet (Q-44), so no `google-services.json` and no firebase packages in the APK. When the
/// project exists, an FCM implementation registers the token via `PUT /api/v1/devices/me/push-token`
/// and renders only server-fetched text (`GET /api/v1/notifications/{uuid}`).
abstract interface class PushService {
  bool get available;

  /// FCM registration token for `POST /devices/register` (`fcmToken`), or null.
  Future<String?> token();

  Future<void> onLogout();
}

class DisabledPushService implements PushService {
  const DisabledPushService();
  @override
  bool get available => false;
  @override
  Future<String?> token() async => null;
  @override
  Future<void> onLogout() async {}
}

PushService createPushService({required bool enabled}) {
  // Even with the flag on, F4a has no FCM implementation: stays disabled until F4b (Firebase).
  return const DisabledPushService();
}
