import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/connectivity/connectivity_controller.dart';
import 'package:proyekkas/core/device/device_identity.dart';
import 'package:proyekkas/core/device/device_integrity.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/core/time/device_clock.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';

import '../support/fixtures.dart';
import '../support/harness.dart';
import '../support/mock_server.dart';
import '../support/widget_harness.dart' show FakeConnectivity;

String _jwt(Map<String, dynamic> c) =>
    'eyJhbGciOiJub25lIn0.${base64Url.encode(utf8.encode(jsonEncode(c))).replaceAll('=', '')}.s';

/// F4 gate "revoked device blocked ≤ 1 request": app start registers the install with integrity
/// signals; after an Admin revoke the NEXT API call ends the session with the Indonesian notice and a
/// fresh install id (a revoked id is never re-activated server-side).
void main() {
  late MockServer server;
  setUp(() async => server = await MockServer.start());
  tearDown(() => server.close());

  test('start → register (integrity) → revoke → next call → signed out, new install id', () async {
    var revoked = false;
    server.on(
      'POST',
      '/realms/drms-staging/protocol/openid-connect/token',
      (req, body) => (
        200,
        {
          'access_token': _jwt({'sub': 'u1', 'exp': 4102444800}),
          'refresh_token': 'r2',
          'expires_in': 300,
        },
      ),
    );
    server.on('POST', '/api/v1/devices/register', (req, body) => (200, {'id': 1}));
    server.on(
      'GET',
      '/api/v1/me',
      (req, body) => revoked
          ? (401, {'type': 'about:blank', 'title': 'Unauthorized', 'status': 401, 'code': 'DEVICE_REVOKED'})
          : (200, meJson()),
    );
    final store = MemorySecureStore()
      ..data[SecureKeys.refreshToken] = 'r1'
      ..data[SecureKeys.sessionSub] = 'u1';
    const firstId = '5b0c2f7e-2d1a-4e0b-8f5e-7a9d3c1b2e44';
    final device = DeviceIdentity.fixed(store, deviceId: firstId);
    final db = memoryDb();
    addTearDown(db.close);
    final c = ProviderContainer(
      overrides: [
        appEnvProvider.overrideWithValue(testEnv(server.base)),
        secureStoreProvider.overrideWithValue(store),
        deviceIdentityProvider.overrideWithValue(device),
        databaseProvider.overrideWithValue(db),
        deviceClockProvider.overrideWithValue(FakeDeviceClock()),
        connectivityProvider.overrideWith(() => FakeConnectivity(true)),
        integrityProbeProvider.overrideWithValue(
          const FixedIntegrityProbe(
            DeviceIntegrityReport(rooted: true, emulator: false, developerMode: true, adbEnabled: false),
          ),
        ),
      ],
    );
    addTearDown(c.dispose);
    final states = <AuthState>[];
    c.listen(authControllerProvider, (_, s) => states.add(s), fireImmediately: true);
    for (var i = 0; i < 100 && c.read(authControllerProvider) is! AuthSignedIn; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
    expect(c.read(authControllerProvider), isA<AuthSignedIn>());
    final register = server.calls.firstWhere((x) => x.$2 == '/api/v1/devices/register');
    expect(jsonDecode(register.$4)['integrity'], {
      'rooted': true,
      'emulator': false,
      'developerMode': true,
      'adbEnabled': false,
      'mockLocation': null,
    });

    revoked = true;
    final before = server.calls.length;
    await c.read(authControllerProvider.notifier).refreshProfile();
    final after = server.calls.skip(before).map((x) => x.$2).toList();
    expect(after, ['/api/v1/me'], reason: 'one request, no token refresh, no retry');
    final s = c.read(authControllerProvider);
    expect(s, isA<AuthSignedOut>().having((x) => x.message, 'message', signedOutDeviceRevoked));
    expect(device.deviceId, isNot(firstId));
    expect(store.data[SecureKeys.installId], device.deviceId);
    expect(store.data.containsKey(SecureKeys.refreshToken), isFalse);
  });
}
