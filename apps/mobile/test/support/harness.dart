import 'package:drift/native.dart';
import 'package:proyekkas/core/config/app_env.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/device/device_identity.dart';
import 'package:proyekkas/core/network/api_client.dart';
import 'package:proyekkas/core/storage/secure_store.dart';

AppDatabase memoryDb() => AppDatabase(NativeDatabase.memory());

AppEnv testEnv(String base) => AppEnv(
  flavor: 'staging',
  apiBaseUrl: base,
  oidcIssuer: '$base/realms/drms-staging',
  oidcClientId: 'proyekkas-mobile',
  oidcRedirectUri: 'https://example.test/app/callback',
  pushEnabled: false,
);

class StaticTokens implements TokenSource {
  StaticTokens([this.token = 'access-1']);
  String? token;
  int refreshes = 0;
  int unauthorized = 0;
  String? nextToken = 'access-2';

  @override
  Future<String?> accessToken() async => token;
  @override
  Future<String?> refreshAccessToken() async {
    refreshes++;
    token = nextToken;
    return token;
  }

  @override
  Future<void> onUnauthorized() async => unauthorized++;

  int deviceRevoked = 0;
  @override
  Future<void> onDeviceRevoked() async => deviceRevoked++;
}

DeviceIdentity testDevice() =>
    DeviceIdentity.fixed(MemorySecureStore(), deviceId: '5b0c2f7e-2d1a-4e0b-8f5e-7a9d3c1b2e44');

ApiClient testClient(String base, TokenSource tokens, {void Function(bool)? reach, void Function(String?)? upgrade}) =>
    ApiClient(
      baseUrl: '$base/api/v1',
      tokens: tokens,
      headers: testDevice(),
      onReachability: reach,
      onUpgradeRequired: upgrade,
    );
