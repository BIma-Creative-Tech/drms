import '../../../core/network/api_client.dart';
import '../../expense/data/expense_mappers.dart';
import '../domain/user_profile.dart';

class ProfileApi {
  ProfileApi(this.client);
  final ApiClient client;

  Future<UserProfile> me() async => userProfileFromJson(await meRaw());

  /// Raw `/me` JSON (cached in the encrypted DB for offline start).
  Future<Map<String, dynamic>> meRaw() =>
      client.run((d) => d.get<dynamic>('/me'), (data) => data as Map<String, dynamic>);

  /// `POST /api/v1/devices/register` (ADR 0003 §5). `deviceId` must equal `X-Device-Id`.
  Future<void> registerDevice({
    required String deviceId,
    required String model,
    required String appVersion,
    String? fcmToken,
    Map<String, Object?>? integrity,
  }) => client.run(
    (d) => d.post<dynamic>(
      '/devices/register',
      data: {
        'deviceId': deviceId,
        'platform': 'android',
        'model': model,
        'appVersion': appVersion,
        'fcmToken': ?fcmToken,
        'integrity': ?integrity,
      },
    ),
    (_) {},
  );

  /// Own-device revoke on logout — the server also ends the Keycloak offline session.
  Future<void> revokeDevice(String deviceId, {String reason = 'Keluar dari aplikasi'}) =>
      client.run((d) => d.post<dynamic>('/devices/$deviceId/revoke', data: {'reason': reason}), (_) {});
}
