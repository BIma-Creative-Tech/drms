import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/features/auth/data/oidc_client.dart';
import 'package:proyekkas/features/auth/data/token_manager.dart';

import '../support/harness.dart';
import '../support/mock_server.dart';

String jwt(Map<String, dynamic> c) =>
    'eyJhbGciOiJub25lIn0.${base64Url.encode(utf8.encode(jsonEncode(c))).replaceAll('=', '')}.s';

void main() {
  late MockServer server;
  setUp(() async => server = await MockServer.start());
  tearDown(() => server.close());

  group('TokenManager (rotation, single-flight)', () {
    test('saveLogin stores refresh + sub; access only in memory', () async {
      final store = MemorySecureStore();
      final tm = TokenManager(env: testEnv(server.base), store: store);
      await tm.saveLogin(
        OidcTokens(accessToken: jwt({'sub': 'u1', 'exp': 4102444800}), refreshToken: 'r1', idToken: 'id1'),
      );
      expect(store.data[SecureKeys.refreshToken], 'r1');
      expect(store.data[SecureKeys.sessionSub], 'u1');
      expect(store.data.values.any((v) => v.startsWith('eyJ')), isFalse, reason: 'access token never persisted');
      expect(await tm.accessToken(), startsWith('eyJ'));
    });

    test('concurrent refreshes hit the token endpoint once and persist the rotated token', () async {
      var hits = 0;
      final gate = Completer<void>();
      server.on('POST', '/realms/drms-staging/protocol/openid-connect/token', (req, body) async {
        hits++;
        expect(body, contains('grant_type=refresh_token'));
        expect(body, contains('client_id=proyekkas-mobile'));
        expect(body, contains('refresh_token=r1'));
        await gate.future;
        return (
          200,
          {
            'access_token': jwt({'sub': 'u1'}),
            'refresh_token': 'r2',
            'expires_in': 300,
          },
        );
      });
      final store = MemorySecureStore()..data[SecureKeys.refreshToken] = 'r1';
      final tm = TokenManager(env: testEnv(server.base), store: store);
      final a = tm.refreshAccessToken();
      final b = tm.refreshAccessToken();
      gate.complete();
      final results = await Future.wait([a, b]);
      expect(results[0], results[1]);
      expect(hits, 1);
      expect(store.data[SecureKeys.refreshToken], 'r2');
    });

    test('invalid_grant ends the session (tokens wiped, sub kept for queue lock)', () async {
      server.on(
        'POST',
        '/realms/drms-staging/protocol/openid-connect/token',
        (req, body) => (400, {'error': 'invalid_grant'}),
      );
      final store = MemorySecureStore()
        ..data[SecureKeys.refreshToken] = 'r1'
        ..data[SecureKeys.sessionSub] = 'u1';
      String? ended;
      final tm = TokenManager(env: testEnv(server.base), store: store, onSessionEnded: (r) async => ended = r);
      expect(await tm.refreshAccessToken(), isNull);
      expect(ended, 'refresh_rejected');
      expect(store.data.containsKey(SecureKeys.refreshToken), isFalse);
      expect(store.data[SecureKeys.sessionSub], 'u1');
    });

    test('offline refresh keeps the session', () async {
      final store = MemorySecureStore()..data[SecureKeys.refreshToken] = 'r1';
      final tm = TokenManager(env: testEnv(server.base), store: store);
      await server.close();
      await expectLater(tm.refreshAccessToken(), throwsA(isA<NetworkException>()));
      expect(store.data[SecureKeys.refreshToken], 'r1');
      expect(await tm.accessToken(), isNull);
    });
  });

  group('ApiClient', () {
    test('sends bearer + device headers; 401 → refresh → retry once', () async {
      var n = 0;
      server.on('GET', '/api/v1/me', (req, body) {
        n++;
        return n == 1 ? (401, {'type': 'about:blank', 'title': 'Unauthorized', 'status': 401}) : (200, {'ok': true});
      });
      final tokens = StaticTokens();
      final c = testClient(server.base, tokens);
      final res = await c.run((d) => d.get<dynamic>('/me'), (d) => d);
      expect(res, {'ok': true});
      expect(tokens.refreshes, 1);
      expect(server.calls.first.$3['authorization'], 'Bearer access-1');
      expect(server.calls.last.$3['authorization'], 'Bearer access-2');
      expect(server.calls.last.$3['x-device-id'], '5b0c2f7e-2d1a-4e0b-8f5e-7a9d3c1b2e44');
      expect(server.calls.last.$3['x-app-version'], '0.1.0');
    });

    test('401 after refresh → session ended (revoked device / user)', () async {
      server.on(
        'GET',
        '/api/v1/me',
        (req, body) => (401, {'type': 'about:blank', 'title': 'Unauthorized', 'status': 401}),
      );
      final tokens = StaticTokens();
      final c = testClient(server.base, tokens);
      await expectLater(c.run((d) => d.get<dynamic>('/me'), (d) => d), throwsA(isA<UnauthorizedException>()));
      expect(tokens.unauthorized, 1);
    });

    test('426 → upgrade required callback with minAppVersion', () async {
      server.on(
        'GET',
        '/api/v1/me',
        (req, body) => (426, {'type': 'about:blank', 'title': 'Upgrade', 'status': 426, 'minAppVersion': '0.2.0'}),
      );
      String? min;
      final c = testClient(server.base, StaticTokens(), upgrade: (v) => min = v);
      await expectLater(c.run((d) => d.get<dynamic>('/me'), (d) => d), throwsA(isA<UpgradeRequiredException>()));
      expect(min, '0.2.0');
    });

    test('problem details → Indonesian message; network error → NetworkException + reachability', () async {
      server.on(
        'POST',
        '/api/v1/x',
        (req, body) => (409, {'type': 'about:blank', 'title': 'Conflict', 'status': 409, 'detail': 'Sudah diproses.'}),
      );
      final reach = <bool>[];
      final c = testClient(server.base, StaticTokens(), reach: reach.add);
      await expectLater(
        c.run((d) => d.post<dynamic>('/x'), (d) => d),
        throwsA(isA<ProblemException>().having((e) => e.message, 'message', 'Sudah diproses.')),
      );
      expect(const ProblemException(status: 403).message, 'Anda tidak berhak melakukan aksi ini.');
      await server.close();
      await expectLater(c.run((d) => d.get<dynamic>('/y'), (d) => d), throwsA(isA<NetworkException>()));
      expect(reach.last, isFalse);
    });
  });
}
