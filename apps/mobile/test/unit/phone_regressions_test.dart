// Regressions from the staging phone test (2026-09-25): "offline" on working mobile data, logout
// that never finished, and a slow first load.
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/app/router.dart';
import 'package:proyekkas/core/config/app_env.dart';
import 'package:proyekkas/core/connectivity/connectivity_controller.dart';
import 'package:proyekkas/core/device/device_identity.dart';
import 'package:proyekkas/core/device/device_integrity.dart';
import 'package:proyekkas/core/network/api_client.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/core/time/device_clock.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/data/oidc_client.dart';
import 'package:proyekkas/features/auth/data/password_login_client.dart';
import 'package:proyekkas/features/auth/data/token_manager.dart';

import '../support/fixtures.dart';
import '../support/harness.dart';

String _jwt(Map<String, dynamic> c) =>
    'eyJhbGciOiJub25lIn0.${base64Url.encode(utf8.encode(jsonEncode(c))).replaceAll('=', '')}.s';

const _base = 'https://api.example.test';

/// dio adapter whose answer is async: it can hang (never complete), fail like a dead network, or
/// answer after a delay.
class _AsyncAdapter implements HttpClientAdapter {
  _AsyncAdapter(this.respond);
  Future<(int, Object?)> Function(RequestOptions o) respond;
  final List<String> paths = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (requestStream != null) await requestStream.drain<void>();
    paths.add('${options.method} ${options.uri.path}');
    final (status, body) = await respond(options);
    return ResponseBody.fromString(
      body == null ? '' : jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Never _offline(RequestOptions o) => throw DioException.connectionError(requestOptions: o, reason: 'offline');

Future<(int, Object?)> _hang(RequestOptions _) => Completer<(int, Object?)>().future;

class _MockConnectivity extends Mock implements Connectivity {}

class _TestConnectivity extends ConnectivityController {
  _TestConnectivity(this.platform);
  final Connectivity platform;
  @override
  Connectivity createConnectivity() => platform;
  @override
  List<Duration> get probeBackoff => const [Duration(milliseconds: 20)];
}

class _FastAuth extends AuthController {
  @override
  Duration get logoutNetworkBudget => const Duration(milliseconds: 300);
  @override
  Duration get logoutLocalStepBudget => const Duration(milliseconds: 200);
  @override
  Duration get registerExtrasBudget => const Duration(milliseconds: 100);
}

class _PasswordClient implements PasswordLoginClient {
  _PasswordClient({this.hangLogout = false, this.failLogout = false});
  final bool hangLogout;
  final bool failLogout;
  int logouts = 0;

  @override
  Future<OidcTokens> login({required String username, required String password}) async =>
      OidcTokens(accessToken: _jwt({'sub': 'u1', 'exp': 4102444800}), refreshToken: 'r1');

  @override
  Future<void> logout({required String refreshToken}) {
    logouts++;
    if (hangLogout) return Completer<void>().future;
    if (failLogout) return Future.error(StateError('keycloak down'));
    return Future.value();
  }
}

class _NoBrowser implements OidcBrowserClient {
  @override
  Future<OidcTokens> login() => throw UnimplementedError();
  @override
  Future<void> endSession({required String? idTokenHint}) async {}
}

/// Secure storage whose deletes throw (a broken Keystore entry).
class _BrokenDeleteStore extends MemorySecureStore {
  @override
  Future<void> delete(String key) async => throw StateError('keystore');
}

class _HangingProbe implements DeviceIntegrityProbe {
  @override
  Future<DeviceIntegrityReport?> check() => Completer<DeviceIntegrityReport?>().future;
}

AppEnv _env() => AppEnv(
  flavor: 'staging',
  apiBaseUrl: _base,
  oidcIssuer: '$_base/realms/drms-staging',
  oidcClientId: 'proyekkas-mobile',
  oidcRedirectUri: 'id.co.drms.proyekkas:/oauth2redirect',
  pushEnabled: false,
  loginMode: LoginMode.password,
);

void main() {
  group('A. online state', () {
    ProviderContainer container(Connectivity platform, {required Future<bool> Function() probe}) {
      final c = ProviderContainer(
        overrides: [
          appEnvProvider.overrideWithValue(_env()),
          connectivityProvider.overrideWith(() => _TestConnectivity(platform)),
          reachabilityProbeProvider.overrideWithValue(probe),
        ],
      );
      addTearDown(c.dispose);
      return c;
    }

    _MockConnectivity platform(List<ConnectivityResult> initial, [Stream<List<ConnectivityResult>>? changes]) {
      final p = _MockConnectivity();
      when(p.checkConnectivity).thenAnswer((_) async => initial);
      when(() => p.onConnectivityChanged).thenAnswer((_) => changes ?? const Stream.empty());
      return p;
    }

    test('mobile data only (connectivity_plus 7: [mobile]) counts as online', () async {
      final c = container(platform([ConnectivityResult.mobile]), probe: () async => true);
      c.read(connectivityProvider);
      await pumpEventQueue();
      expect(c.read(connectivityProvider), isTrue);
    });

    test('every non-none interface counts (vpn, other, mobile+vpn)', () async {
      for (final r in [
        [ConnectivityResult.vpn],
        [ConnectivityResult.other],
        [ConnectivityResult.mobile, ConnectivityResult.vpn],
      ]) {
        final c = container(platform([ConnectivityResult.none]), probe: () async => false);
        c.read(connectivityProvider);
        await pumpEventQueue();
        c.read(connectivityProvider.notifier).onInterfaces(r);
        expect(c.read(connectivityProvider), isTrue, reason: '$r');
      }
    });

    test('a wrong `none` from the OS does not stick: a successful API call makes the app online', () async {
      // Phone bug: connectivity_plus said none while mobile data worked; before the fix only an OS
      // network event could clear it, so every successful API call still showed "Offline".
      final c = container(platform([ConnectivityResult.none]), probe: () async => false);
      c.read(connectivityProvider);
      await pumpEventQueue();
      expect(c.read(connectivityProvider), isFalse);

      final adapter = _AsyncAdapter((_) async => (200, {'ok': true}));
      final client = ApiClient(
        baseUrl: '$_base/api/v1',
        tokens: StaticTokens(),
        headers: testDevice(),
        dio: Dio(BaseOptions(baseUrl: '$_base/api/v1'))..httpClientAdapter = adapter,
        onReachability: (ok) => c.read(connectivityProvider.notifier).reportServerReachable(ok),
      );
      await client.run((d) => d.get<dynamic>('/me'), (d) => d);
      expect(c.read(connectivityProvider), isTrue);
    });

    test('a wrong `none` is corrected by the /health probe without any user action', () async {
      final c = container(platform([ConnectivityResult.none]), probe: () async => true);
      var again = 0;
      c.read(onlineAgainProvider).listen((_) => again++);
      c.read(connectivityProvider);
      await pumpEventQueue();
      expect(c.read(connectivityProvider), isFalse);
      await Future<void>.delayed(const Duration(milliseconds: 60));
      expect(c.read(connectivityProvider), isTrue);
      expect(again, 1, reason: 'coming back online triggers a sync run');
    });

    test('offline after a failed call; the probe keeps retrying until the server answers', () async {
      var up = false;
      var probes = 0;
      final c = container(
        platform([ConnectivityResult.mobile]),
        probe: () async {
          probes++;
          return up;
        },
      );
      c.read(connectivityProvider);
      await pumpEventQueue();
      c.read(connectivityProvider.notifier).reportServerReachable(false);
      expect(c.read(connectivityProvider), isFalse);
      await Future<void>.delayed(const Duration(milliseconds: 70));
      expect(probes, greaterThanOrEqualTo(2));
      expect(c.read(connectivityProvider), isFalse);
      up = true;
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(c.read(connectivityProvider), isTrue);
    });

    test('recheck() probes immediately', () async {
      final c = container(platform([ConnectivityResult.none]), probe: () async => true);
      c.read(connectivityProvider);
      await pumpEventQueue();
      expect(await c.read(connectivityProvider.notifier).recheck(), isTrue);
    });

    test('the default probe is GET <api>/api/v1/health with a short timeout', () async {
      final c = ProviderContainer(overrides: [appEnvProvider.overrideWithValue(testEnv('http://127.0.0.1:9'))]);
      addTearDown(c.dispose);
      // Port 9 (discard) is closed on the test host: connection refused → false, no exception.
      expect(await c.read(reachabilityProbeProvider)(), isFalse);
      expect(_env().apiV1, '$_base/api/v1');
    });

    test('ApiClient: a cancelled request is not reported as offline', () async {
      final reports = <bool>[];
      final client = ApiClient(
        baseUrl: '$_base/api/v1',
        tokens: StaticTokens(),
        headers: testDevice(),
        dio: Dio()
          ..httpClientAdapter = _AsyncAdapter(
            (o) => throw DioException.requestCancelled(requestOptions: o, reason: 'user left'),
          ),
        onReachability: reports.add,
      );
      await expectLater(client.run((d) => d.get<dynamic>('/x'), (d) => d), throwsA(anything));
      expect(reports, isEmpty);
    });
  });

  group('B. logout always completes', () {
    late MemorySecureStore store;
    late DeviceIdentity device;
    const firstId = '5b0c2f7e-2d1a-4e0b-8f5e-7a9d3c1b2e44';

    ProviderContainer container(
      _AsyncAdapter api,
      _PasswordClient password, {
      SecureStore? secure,
      AuthController Function()? auth,
    }) {
      final s = secure ?? store;
      device = DeviceIdentity.fixed(s, deviceId: firstId);
      final db = memoryDb();
      addTearDown(db.close);
      final c = ProviderContainer(
        overrides: [
          appEnvProvider.overrideWithValue(_env()),
          secureStoreProvider.overrideWithValue(s),
          deviceIdentityProvider.overrideWithValue(device),
          databaseProvider.overrideWithValue(db),
          deviceClockProvider.overrideWithValue(FakeDeviceClock()),
          connectivityProvider.overrideWith(() => _TestConnectivity(_MockConnectivity())),
          reachabilityProbeProvider.overrideWithValue(() async => false),
          passwordLoginClientProvider.overrideWithValue(password),
          oidcBrowserClientProvider.overrideWithValue(_NoBrowser()),
          integrityProbeProvider.overrideWithValue(const FixedIntegrityProbe(null)),
          apiClientProvider.overrideWith(
            (ref) => ApiClient(
              baseUrl: '$_base/api/v1',
              tokens: ref.watch(tokenManagerProvider),
              headers: device,
              dio: Dio(BaseOptions(baseUrl: '$_base/api/v1'))..httpClientAdapter = api,
            ),
          ),
          if (auth != null) authControllerProvider.overrideWith(auth),
        ],
      );
      addTearDown(c.dispose);
      return c;
    }

    Future<AuthController> signedIn(ProviderContainer c) async {
      final ctrl = c.read(authControllerProvider.notifier);
      await pumpEventQueue();
      expect(await ctrl.loginWithPassword(username: 'doni', password: 'pw'), isNull);
      expect(c.read(authControllerProvider), isA<AuthSignedIn>());
      return ctrl;
    }

    setUp(() => store = MemorySecureStore());

    (int, Object?) online(RequestOptions o) => o.path.endsWith('/me') ? (200, meJson()) : (204, null);

    test('default network budget is 5 s', () {
      expect(AuthController().logoutNetworkBudget, const Duration(seconds: 5));
    });

    test('offline: revoke and Keycloak fail → still signed out, tokens gone, new install id', () async {
      var down = false;
      final api = _AsyncAdapter((o) async => down ? _offline(o) : online(o));
      final password = _PasswordClient(failLogout: true);
      final c = container(api, password, auth: _FastAuth.new);
      final ctrl = await signedIn(c);
      down = true;
      await ctrl.logout();
      expect(c.read(authControllerProvider), isA<AuthSignedOut>());
      expect(store.data.containsKey(SecureKeys.refreshToken), isFalse);
      expect(device.deviceId, isNot(firstId));
      expect(api.paths, contains(endsWith('/revoke')), reason: 'revoke was attempted');
    });

    test('API and Keycloak hang forever → signed out after the network budget', () async {
      var hang = false;
      final api = _AsyncAdapter((o) => hang ? _hang(o) : Future.value(online(o)));
      final password = _PasswordClient(hangLogout: true);
      final c = container(api, password, auth: _FastAuth.new);
      final ctrl = await signedIn(c);
      hang = true;
      final sw = Stopwatch()..start();
      await ctrl.logout();
      expect(sw.elapsed, lessThan(const Duration(seconds: 3)));
      expect(c.read(authControllerProvider), isA<AuthSignedOut>());
      expect(store.data.containsKey(SecureKeys.refreshToken), isFalse);
    });

    test('Keycloak hangs but the API works → revoke sent, then signed out', () async {
      final api = _AsyncAdapter((o) async => online(o));
      final password = _PasswordClient(hangLogout: true);
      final c = container(api, password, auth: _FastAuth.new);
      final ctrl = await signedIn(c);
      await ctrl.logout();
      expect(password.logouts, 1);
      expect(api.paths.last, endsWith('/revoke'));
      expect(c.read(authControllerProvider), isA<AuthSignedOut>());
    });

    test('a failing Keystore delete does not keep the user signed in', () async {
      final broken = _BrokenDeleteStore();
      final api = _AsyncAdapter((o) async => online(o));
      final c = container(api, _PasswordClient(), secure: broken, auth: _FastAuth.new);
      final ctrl = await signedIn(c);
      await ctrl.logout();
      expect(c.read(authControllerProvider), isA<AuthSignedOut>());
    });

    test('double tap runs one logout', () async {
      final api = _AsyncAdapter((o) async => online(o));
      final password = _PasswordClient();
      final c = container(api, password, auth: _FastAuth.new);
      final ctrl = await signedIn(c);
      await Future.wait([ctrl.logout(), ctrl.logout()]);
      expect(password.logouts, 1);
      expect(api.paths.where((p) => p.endsWith('/revoke')), hasLength(1));
    });

    test('pending offline items are kept (locked to the user), not deleted', () async {
      final api = _AsyncAdapter((o) async => online(o));
      final c = container(api, _PasswordClient(), auth: _FastAuth.new);
      final ctrl = await signedIn(c);
      await c
          .read(outboxRepositoryProvider)
          .enqueueDraftDelete(
            sub: 'u1',
            draftUuid: '0190a0c0-0000-7000-8000-000000000001',
            payload: const {'id': 7},
            deviceTime: '2026-09-25T10:00:00+08:00',
            elapsedMs: 1,
            bootId: 'b',
            offline: true,
          );
      await ctrl.logout();
      expect(await c.read(outboxRepositoryProvider).all('u1'), hasLength(1));
      expect(store.data[SecureKeys.sessionSub], 'u1', reason: 'queue owner is remembered');
    });
  });

  group('B2. token manager', () {
    test('a refresh still in flight when the session is cleared cannot write tokens back', () async {
      final gate = Completer<void>();
      final store = MemorySecureStore()..data[SecureKeys.refreshToken] = 'r1';
      final adapter = _AsyncAdapter((o) async {
        await gate.future;
        return (
          200,
          {
            'access_token': _jwt({'sub': 'u1'}),
            'refresh_token': 'r2',
            'expires_in': 300,
          },
        );
      });
      final tm = TokenManager(
        env: _env(),
        store: store,
        tokenDio: Dio(BaseOptions(validateStatus: (_) => true))..httpClientAdapter = adapter,
      );
      final pending = tm.refreshAccessToken();
      await pumpEventQueue();
      await tm.clear();
      gate.complete();
      expect(await pending, isNull);
      expect(store.data.containsKey(SecureKeys.refreshToken), isFalse);
    });
  });

  group('C. start-up does not wait for non-critical calls', () {
    test('cached profile: signed in at once while register and /me still hang', () async {
      final store = MemorySecureStore()
        ..data[SecureKeys.refreshToken] = 'r1'
        ..data[SecureKeys.sessionSub] = 'u1';
      final release = Completer<void>();
      final api = _AsyncAdapter((o) async {
        await release.future;
        return o.path.endsWith('/me') ? (200, meJson()) : (204, null);
      });
      final tokenAdapter = _AsyncAdapter(
        (_) async => (
          200,
          {
            'access_token': _jwt({'sub': 'u1', 'exp': 4102444800}),
            'refresh_token': 'r2',
          },
        ),
      );
      final db = memoryDb();
      addTearDown(db.close);
      await db.kvPut('profile:u1', jsonEncode(meJson()));
      final device = DeviceIdentity.fixed(store, deviceId: '5b0c2f7e-2d1a-4e0b-8f5e-7a9d3c1b2e44');
      final c = ProviderContainer(
        overrides: [
          appEnvProvider.overrideWithValue(_env()),
          secureStoreProvider.overrideWithValue(store),
          deviceIdentityProvider.overrideWithValue(device),
          databaseProvider.overrideWithValue(db),
          deviceClockProvider.overrideWithValue(FakeDeviceClock()),
          connectivityProvider.overrideWith(() => _TestConnectivity(_MockConnectivity())),
          reachabilityProbeProvider.overrideWithValue(() async => true),
          integrityProbeProvider.overrideWithValue(_HangingProbe()),
          tokenManagerProvider.overrideWith(
            (ref) => TokenManager(
              env: _env(),
              store: store,
              tokenDio: Dio(BaseOptions(validateStatus: (_) => true))..httpClientAdapter = tokenAdapter,
            ),
          ),
          apiClientProvider.overrideWith(
            (ref) => ApiClient(
              baseUrl: '$_base/api/v1',
              tokens: ref.watch(tokenManagerProvider),
              headers: device,
              dio: Dio(BaseOptions(baseUrl: '$_base/api/v1'))..httpClientAdapter = api,
            ),
          ),
          authControllerProvider.overrideWith(_FastAuth.new),
        ],
      );
      addTearDown(c.dispose);
      c.read(authControllerProvider);
      await pumpEventQueue();
      final s = c.read(authControllerProvider);
      expect(s, isA<AuthSignedIn>().having((x) => x.fromCache, 'fromCache', isTrue));
      // The router leaves the splash now: it does not wait for /app/config either.
      expect(redirectFor(location: '/splash', auth: s, gate: VersionGate.ok), '/home');

      // Registration still happens in the background (integrity report skipped after its budget).
      await Future<void>.delayed(const Duration(milliseconds: 200));
      release.complete();
      for (var i = 0; i < 50 && (c.read(authControllerProvider) as AuthSignedIn).fromCache; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
      expect((c.read(authControllerProvider) as AuthSignedIn).fromCache, isFalse);
      expect(api.paths, ['POST /api/v1/devices/register', 'GET /api/v1/me']);
    });
  });
}
