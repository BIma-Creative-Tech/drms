import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/device/device_integrity.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/features/auth/data/profile_api.dart';
import 'package:proyekkas/features/auth/data/token_manager.dart';

import '../support/harness.dart';
import '../support/mock_server.dart';

/// F4b: remote revocation (ADR 0003 §5) is effective on the NEXT request, and integrity signals
/// are reported at register (ADR 0010 decision 10).
void main() {
  late MockServer server;
  setUp(() async => server = await MockServer.start());
  tearDown(() => server.close());

  const revoked = {
    'type': 'about:blank',
    'title': 'Unauthorized',
    'status': 401,
    'code': 'DEVICE_REVOKED',
    'detail': 'Perangkat ini sudah dicabut dari akun Anda. Silakan masuk kembali atau hubungi Admin.',
  };

  group('401 DEVICE_REVOKED', () {
    test('one request, no token refresh, session ended once', () async {
      server.on('GET', '/api/v1/me', (req, body) => (401, revoked));
      final tokens = StaticTokens();
      final c = testClient(server.base, tokens);
      await expectLater(
        c.run((d) => d.get<dynamic>('/me'), (d) => d),
        throwsA(isA<DeviceRevokedException>().having((e) => e.message, 'message', deviceRevokedMessage)),
      );
      expect(server.calls, hasLength(1), reason: 'blocked within 1 request');
      expect(tokens.refreshes, 0);
      expect(tokens.deviceRevoked, 1);
      expect(tokens.unauthorized, 0);
    });

    test('also when the code only arrives after a refresh (token expired first)', () async {
      var n = 0;
      server.on('GET', '/api/v1/me', (req, body) {
        n++;
        return n == 1 ? (401, {'type': 'about:blank', 'title': 'Unauthorized', 'status': 401}) : (401, revoked);
      });
      final tokens = StaticTokens();
      await expectLater(
        testClient(server.base, tokens).run((d) => d.get<dynamic>('/me'), (d) => d),
        throwsA(isA<DeviceRevokedException>()),
      );
      expect(tokens.refreshes, 1);
      expect(tokens.deviceRevoked, 1);
      expect(tokens.unauthorized, 0);
    });

    test('is an UnauthorizedException for existing handlers; plain 401 keeps the generic text', () {
      expect(const DeviceRevokedException(), isA<UnauthorizedException>());
      expect(const UnauthorizedException().message, 'Sesi berakhir. Silakan masuk kembali.');
    });

    test('TokenManager.onDeviceRevoked wipes tokens once and reports device_revoked', () async {
      final store = MemorySecureStore()
        ..data[SecureKeys.refreshToken] = 'r1'
        ..data[SecureKeys.sessionSub] = 'u1';
      final reasons = <String>[];
      final tm = TokenManager(env: testEnv(server.base), store: store, onSessionEnded: (r) async => reasons.add(r));
      await tm.onDeviceRevoked();
      await tm.onDeviceRevoked();
      expect(reasons, [TokenManager.sessionEndedDeviceRevoked]);
      expect(store.data.containsKey(SecureKeys.refreshToken), isFalse);
      expect(store.data[SecureKeys.sessionSub], 'u1', reason: 'queue stays locked to the same user');
    });
  });

  group('device integrity report', () {
    test('channel map → report; risk rule matches the server', () {
      final r = DeviceIntegrityReport.fromChannel({
        'rooted': false,
        'emulator': false,
        'developerMode': true,
        'adbEnabled': true,
      })!;
      expect(r.risky, isFalse);
      expect(r.toJson(), {
        'rooted': false,
        'emulator': false,
        'developerMode': true,
        'adbEnabled': true,
        'mockLocation': null,
      });
      expect(DeviceIntegrityReport.fromChannel({'rooted': true})!.risky, isTrue);
      expect(DeviceIntegrityReport.fromChannel({'emulator': true})!.risky, isTrue);
      expect(
        const DeviceIntegrityReport(
          rooted: false,
          emulator: false,
          developerMode: false,
          adbEnabled: false,
          mockLocation: true,
        ).risky,
        isTrue,
      );
      expect(DeviceIntegrityReport.fromChannel(null), isNull);
      expect(DeviceIntegrityReport.fromChannel('x'), isNull);
    });

    test('register sends the integrity object (omitted when unknown)', () async {
      server.on('POST', '/api/v1/devices/register', (req, body) => (200, {'id': 1}));
      final api = ProfileApi(testClient(server.base, StaticTokens()));
      const report = DeviceIntegrityReport(rooted: true, emulator: false, developerMode: false, adbEnabled: false);
      await api.registerDevice(deviceId: 'd', model: 'm', appVersion: '0.1.0', integrity: report.toJson());
      await api.registerDevice(deviceId: 'd', model: 'm', appVersion: '0.1.0');
      expect(server.calls[0].$4, contains('"integrity":{"rooted":true,"emulator":false'));
      expect(server.calls[1].$4, isNot(contains('integrity')));
    });
  });
}
