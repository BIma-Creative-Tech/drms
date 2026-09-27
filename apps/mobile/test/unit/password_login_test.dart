import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/config/app_env.dart';
import 'package:proyekkas/core/connectivity/connectivity_controller.dart';
import 'package:proyekkas/core/network/api_client.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/core/time/device_clock.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/data/oidc_client.dart';
import 'package:proyekkas/features/auth/data/password_login_client.dart';
import 'package:proyekkas/features/auth/data/profile_api.dart';

import '../support/fake_dio_adapter.dart';
import '../support/fixtures.dart';
import '../support/harness.dart';
import '../support/widget_harness.dart' show FakeConnectivity;

const _issuer = 'https://idp.example.test/realms/drms-staging';

AppEnv _env({LoginMode mode = LoginMode.password}) => AppEnv(
  flavor: 'staging',
  apiBaseUrl: 'https://api.example.test',
  oidcIssuer: _issuer,
  oidcClientId: 'proyekkas-mobile',
  oidcRedirectUri: 'id.co.drms.proyekkas:/oauth2redirect',
  pushEnabled: false,
  loginMode: mode,
);

String _jwt(Map<String, dynamic> c) =>
    'eyJhbGciOiJub25lIn0.${base64Url.encode(utf8.encode(jsonEncode(c))).replaceAll('=', '')}.s';

Matcher _fails(PasswordLoginError e) => throwsA(
  isA<PasswordLoginException>().having((x) => x.error, 'error', e).having((x) => x.message, 'message', e.message),
);

void main() {
  group('LoginMode / AppEnv', () {
    test('PK_LOGIN_MODE parsing falls back to browser', () {
      expect(LoginMode.parse('password'), LoginMode.password);
      expect(LoginMode.parse(' PASSWORD '), LoginMode.password);
      expect(LoginMode.parse('browser'), LoginMode.browser);
      expect(LoginMode.parse(''), LoginMode.browser);
      expect(LoginMode.parse('ropc'), LoginMode.browser);
    });

    test('default build (no dart-define) is browser mode; token/logout endpoints are on the issuer', () {
      final env = AppEnv.fromEnvironment();
      expect(env.loginMode, LoginMode.browser);
      expect(env.usesPasswordLogin, isFalse);
      expect(_env().usesPasswordLogin, isTrue);
      expect(_env().tokenEndpoint, '$_issuer/protocol/openid-connect/token');
      expect(_env().endSessionEndpoint, '$_issuer/protocol/openid-connect/logout');
    });
  });

  group('KeycloakPasswordClient.login', () {
    test('success: form-encoded password grant to the issuer token endpoint → OidcTokens', () async {
      final adapter = FakeDioAdapter(
        (_) => (
          200,
          {
            'access_token': _jwt({'sub': 'u1'}),
            'refresh_token': 'r1',
            'id_token': 'id1',
            'expires_in': 300,
            'token_type': 'Bearer',
          },
        ),
      );
      final client = KeycloakPasswordClient(_env(), dio: fakeDio(adapter));
      final before = DateTime.now().toUtc();
      final t = await client.login(username: 'doni@example.test', password: 's3cret pass');

      expect(t.accessToken, startsWith('eyJ'));
      expect(t.refreshToken, 'r1');
      expect(t.idToken, 'id1');
      expect(t.accessTokenExpiry!.isAfter(before.add(const Duration(seconds: 290))), isTrue);

      final call = adapter.calls.single;
      expect(call.method, 'POST');
      expect(call.uri.toString(), '$_issuer/protocol/openid-connect/token');
      expect(call.headers[Headers.contentTypeHeader], startsWith(Headers.formUrlEncodedContentType));
      expect(call.form, {
        'grant_type': 'password',
        'client_id': 'proyekkas-mobile',
        'username': 'doni@example.test',
        'password': 's3cret pass',
        'scope': 'openid offline_access',
      });
      expect(call.headers.containsKey('Authorization'), isFalse, reason: 'public client, no secret');
    });

    test('invalid_grant "Invalid user credentials" → wrong username/password', () async {
      final client = KeycloakPasswordClient(
        _env(),
        dio: fakeDio(
          FakeDioAdapter((_) => (400, {'error': 'invalid_grant', 'error_description': 'Invalid user credentials'})),
        ),
      );
      await expectLater(client.login(username: 'x', password: 'y'), _fails(PasswordLoginError.invalidCredentials));
      expect(PasswordLoginError.invalidCredentials.message, contains('Email/username atau kata sandi salah'));
    });

    test('invalid_grant variants: disabled account, pending required action, brute-force lockout', () async {
      final adapter = FakeDioAdapter((_) => (400, {'error': 'invalid_grant', 'error_description': 'Account disabled'}));
      final client = KeycloakPasswordClient(_env(), dio: fakeDio(adapter));
      await expectLater(client.login(username: 'x', password: 'y'), _fails(PasswordLoginError.accountDisabled));

      adapter.respond = (_) => (400, {'error': 'invalid_grant', 'error_description': 'Account is not fully set up'});
      await expectLater(client.login(username: 'x', password: 'y'), _fails(PasswordLoginError.accountNotSetUp));
      expect(PasswordLoginError.accountNotSetUp.message, allOf(contains('web'), contains('Admin')));

      // Keycloak answers a temporarily locked user with the same text (no user enumeration).
      adapter.respond = (_) => (401, {'error': 'invalid_request', 'error_description': 'Invalid user credentials'});
      await expectLater(client.login(username: 'x', password: 'y'), _fails(PasswordLoginError.invalidCredentials));
    });

    test('unauthorized_client (Direct Access Grants off) → "Login langsung belum diaktifkan di server"', () async {
      final client = KeycloakPasswordClient(
        _env(),
        dio: fakeDio(
          FakeDioAdapter(
            (_) => (
              400,
              {'error': 'unauthorized_client', 'error_description': 'Client not allowed for direct access grants'},
            ),
          ),
        ),
      );
      await expectLater(client.login(username: 'x', password: 'y'), _fails(PasswordLoginError.directGrantDisabled));
      expect(PasswordLoginError.directGrantDisabled.message, startsWith('Login langsung belum diaktifkan di server'));
    });

    test('invalid_client, 5xx and non-JSON bodies map to server-side errors', () async {
      final adapter = FakeDioAdapter((_) => (401, {'error': 'invalid_client'}));
      final client = KeycloakPasswordClient(_env(), dio: fakeDio(adapter));
      await expectLater(client.login(username: 'x', password: 'y'), _fails(PasswordLoginError.clientRejected));
      adapter.respond = (_) => (503, null);
      await expectLater(client.login(username: 'x', password: 'y'), _fails(PasswordLoginError.server));
      adapter.respond = (_) => (429, {'error': 'slow_down'});
      await expectLater(client.login(username: 'x', password: 'y'), _fails(PasswordLoginError.server));
    });

    test('network error and timeouts → Indonesian connectivity messages', () async {
      final adapter = FakeDioAdapter(
        (c) => throw DioException.connectionError(
          requestOptions: RequestOptions(path: c.uri.toString()),
          reason: 'Failed host lookup',
        ),
      );
      final client = KeycloakPasswordClient(_env(), dio: fakeDio(adapter));
      await expectLater(client.login(username: 'x', password: 'y'), _fails(PasswordLoginError.network));

      adapter.respond = (c) => throw DioException.connectionTimeout(
        timeout: const Duration(seconds: 15),
        requestOptions: RequestOptions(path: c.uri.toString()),
      );
      await expectLater(client.login(username: 'x', password: 'y'), _fails(PasswordLoginError.timeout));

      adapter.respond = (c) => throw DioException.receiveTimeout(
        timeout: const Duration(seconds: 20),
        requestOptions: RequestOptions(path: c.uri.toString()),
      );
      await expectLater(client.login(username: 'x', password: 'y'), _fails(PasswordLoginError.timeout));
    });

    test('missing refresh token (or access token) → incomplete response, nothing returned', () async {
      final adapter = FakeDioAdapter(
        (_) => (
          200,
          {
            'access_token': _jwt({'sub': 'u1'}),
            'expires_in': 300,
          },
        ),
      );
      final client = KeycloakPasswordClient(_env(), dio: fakeDio(adapter));
      await expectLater(client.login(username: 'x', password: 'y'), _fails(PasswordLoginError.incompleteResponse));
      adapter.respond = (_) => (200, {'refresh_token': 'r1'});
      await expectLater(client.login(username: 'x', password: 'y'), _fails(PasswordLoginError.incompleteResponse));
    });

    test('exceptions never carry the password', () {
      const e = PasswordLoginException(PasswordLoginError.invalidCredentials);
      expect(e.toString(), 'PasswordLoginException(invalidCredentials)');
    });
  });

  group('KeycloakPasswordClient.logout', () {
    test('POSTs client_id + refresh_token to the issuer logout endpoint (204)', () async {
      final adapter = FakeDioAdapter((_) => (204, null));
      await KeycloakPasswordClient(_env(), dio: fakeDio(adapter)).logout(refreshToken: 'r9');
      final call = adapter.calls.single;
      expect(call.method, 'POST');
      expect(call.uri.toString(), '$_issuer/protocol/openid-connect/logout');
      expect(call.form, {'client_id': 'proyekkas-mobile', 'refresh_token': 'r9'});
    });

    test('is best effort: error status and network failure do not throw', () async {
      final adapter = FakeDioAdapter(
        (_) => (400, {'error': 'invalid_grant', 'error_description': 'Invalid refresh token'}),
      );
      final client = KeycloakPasswordClient(_env(), dio: fakeDio(adapter));
      await client.logout(refreshToken: 'r9');
      adapter.respond = (c) => throw DioException.connectionError(
        requestOptions: RequestOptions(path: c.uri.toString()),
        reason: 'offline',
      );
      await client.logout(refreshToken: 'r9');
      expect(adapter.calls, hasLength(2));
    });
  });

  group('AuthController (password mode, no browser)', () {
    late MemorySecureStore store;
    late _FakePasswordClient password;
    late _FakeBrowserClient browser;
    late FakeDioAdapter api;

    ProviderContainer container({LoginMode mode = LoginMode.password}) {
      final db = memoryDb();
      addTearDown(db.close);
      final c = ProviderContainer(
        overrides: [
          appEnvProvider.overrideWithValue(_env(mode: mode)),
          secureStoreProvider.overrideWithValue(store),
          deviceIdentityProvider.overrideWithValue(testDevice()),
          databaseProvider.overrideWithValue(db),
          deviceClockProvider.overrideWithValue(FakeDeviceClock()),
          connectivityProvider.overrideWith(() => FakeConnectivity(true)),
          passwordLoginClientProvider.overrideWithValue(password),
          oidcBrowserClientProvider.overrideWithValue(browser),
          profileApiProvider.overrideWith(
            (ref) => ProfileApi(
              ApiClient(
                baseUrl: 'https://api.example.test/api/v1',
                tokens: ref.watch(tokenManagerProvider),
                headers: testDevice(),
                dio: fakeDio(api)..options.baseUrl = 'https://api.example.test/api/v1',
              ),
            ),
          ),
        ],
      );
      addTearDown(c.dispose);
      return c;
    }

    setUp(() {
      store = MemorySecureStore();
      password = _FakePasswordClient();
      browser = _FakeBrowserClient();
      api = FakeDioAdapter((c) => c.uri.path.endsWith('/me') ? (200, meJson()) : (204, null));
    });

    Future<AuthController> signedOutController(ProviderContainer c) async {
      final ctrl = c.read(authControllerProvider.notifier);
      await pumpEventQueue();
      expect(c.read(authControllerProvider), isA<AuthSignedOut>());
      return ctrl;
    }

    test('login stores the session and signs in; the password is not persisted', () async {
      final c = container();
      final ctrl = await signedOutController(c);
      final res = await ctrl.loginWithPassword(username: '  doni@example.test ', password: 'pw-123456');
      expect(res, isNull);
      expect(password.logins.single, ('doni@example.test', 'pw-123456'));
      expect(browser.logins, 0, reason: 'no browser in password mode');
      final s = c.read(authControllerProvider);
      expect(s, isA<AuthSignedIn>().having((x) => x.sub, 'sub', 'u1'));
      expect(store.data[SecureKeys.refreshToken], 'r1');
      expect(store.data.values.any((v) => v.contains('pw-123456')), isFalse);
      expect(api.calls.first.headers['Authorization'], startsWith('Bearer eyJ'));
    });

    test('rejected login returns the Indonesian message and stores nothing', () async {
      password.error = const PasswordLoginException(PasswordLoginError.invalidCredentials);
      final c = container();
      final ctrl = await signedOutController(c);
      final res = await ctrl.loginWithPassword(username: 'x', password: 'y');
      expect(res, 'Email/username atau kata sandi salah.');
      expect(store.data.containsKey(SecureKeys.refreshToken), isFalse);
      expect(c.read(authControllerProvider), isA<AuthSignedOut>());
    });

    test('logout ends the Keycloak session with the refresh token, without AppAuth', () async {
      final c = container();
      final ctrl = await signedOutController(c);
      await ctrl.loginWithPassword(username: 'doni', password: 'pw');
      await ctrl.logout();
      expect(password.logouts, ['r1']);
      expect(browser.endSessions, 0);
      expect(store.data.containsKey(SecureKeys.refreshToken), isFalse);
      expect(c.read(authControllerProvider), isA<AuthSignedOut>());
      expect(api.calls.map((x) => x.uri.path), contains(endsWith('/revoke')));
    });

    test('browser mode still uses AppAuth for login and logout', () async {
      final c = container(mode: LoginMode.browser);
      final ctrl = await signedOutController(c);
      expect(await ctrl.login(), isNull);
      await ctrl.logout();
      expect(browser.logins, 1);
      expect(browser.endSessions, 1);
      expect(password.logins, isEmpty);
      expect(password.logouts, isEmpty);
    });
  });
}

OidcTokens _tokens() =>
    OidcTokens(accessToken: _jwt({'sub': 'u1', 'exp': 4102444800}), refreshToken: 'r1', idToken: 'id1');

class _FakePasswordClient implements PasswordLoginClient {
  final logins = <(String, String)>[];
  final logouts = <String>[];
  PasswordLoginException? error;

  @override
  Future<OidcTokens> login({required String username, required String password}) async {
    logins.add((username, password));
    if (error != null) throw error!;
    return _tokens();
  }

  @override
  Future<void> logout({required String refreshToken}) async => logouts.add(refreshToken);
}

class _FakeBrowserClient implements OidcBrowserClient {
  int logins = 0;
  int endSessions = 0;

  @override
  Future<OidcTokens> login() async {
    logins++;
    return _tokens();
  }

  @override
  Future<void> endSession({required String? idTokenHint}) async => endSessions++;
}
