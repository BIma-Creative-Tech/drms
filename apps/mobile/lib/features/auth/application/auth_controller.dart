import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/logging/log.dart';
import '../../../core/logging/startup_trace.dart';
import '../../../core/network/api_exception.dart';
import '../../expense/data/expense_mappers.dart';
import '../data/oidc_client.dart';
import '../data/password_login_client.dart';
import '../data/token_manager.dart';
import '../domain/user_profile.dart';

sealed class AuthState {
  const AuthState();
}

class AuthStarting extends AuthState {
  const AuthStarting();
}

/// [AuthSignedOut.message] after a 401 `DEVICE_REVOKED` (login screen shows the `deviceRevoked` text).
const signedOutDeviceRevoked = 'device_revoked';

class AuthSignedOut extends AuthState {
  const AuthSignedOut({this.message});
  final String? message;
}

class AuthSignedIn extends AuthState {
  const AuthSignedIn({required this.profile, required this.sub, this.fromCache = false});
  final UserProfile profile;
  final String sub;

  /// Profile restored from the encrypted cache because the server was unreachable at start.
  final bool fromCache;
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(AuthController.new);

/// Current user's `sub` (queue owner) or null.
final currentSubProvider = Provider<String?>((ref) {
  final s = ref.watch(authControllerProvider);
  return s is AuthSignedIn ? s.sub : null;
});

final currentProfileProvider = Provider<UserProfile?>((ref) {
  final s = ref.watch(authControllerProvider);
  return s is AuthSignedIn ? s.profile : null;
});

class AuthController extends Notifier<AuthState> {
  bool _busy = false;
  Future<void>? _logout;

  /// Upper bound for the network part of [logout] (device revoke + Keycloak logout). The local
  /// session is cleared afterwards in every case (ADR 0010 "Phone test fixes").
  Duration get logoutNetworkBudget => const Duration(seconds: 5);

  /// Upper bound for each local clean-up step of [logout] (Keystore / secure storage calls).
  Duration get logoutLocalStepBudget => const Duration(seconds: 3);

  /// How long device registration waits for the integrity report / push token before sending
  /// without them (both are optional fields of `POST /devices/register`).
  Duration get registerExtrasBudget => const Duration(seconds: 2);

  @override
  AuthState build() {
    final tokens = ref.read(tokenManagerProvider);
    tokens.onSessionEnded = _onSessionEnded;
    Future.microtask(_restore);
    return const AuthStarting();
  }

  static String _profileKey(String sub) => 'profile:$sub';

  /// App start. With a cached profile the home screen is shown at once (tokens + profile known) and
  /// device registration + `/me` run in the background; only a first start without a cached profile
  /// waits for the network.
  Future<void> _restore() async {
    StartupTrace.mark('auth restore start');
    final tokens = ref.read(tokenManagerProvider);
    final (hasSession, sub) = await (tokens.hasSession(), tokens.sessionSub()).wait;
    if (!hasSession) {
      state = const AuthSignedOut();
      StartupTrace.mark('auth restore: signed out');
      return;
    }
    if (sub == null) {
      await tokens.clear();
      state = const AuthSignedOut();
      return;
    }
    final cached = await _cachedProfile(sub);
    if (cached != null) {
      state = AuthSignedIn(profile: cached, sub: sub, fromCache: true);
      StartupTrace.mark('auth restore: signed in from cache');
      unawaited(_refreshInBackground(sub));
      return;
    }
    try {
      final profile = await _loadProfileOnline(sub, register: true);
      state = AuthSignedIn(profile: profile, sub: sub);
      StartupTrace.mark('auth restore: signed in online');
    } on NetworkException {
      state = const AuthSignedOut(message: 'Butuh koneksi internet untuk memuat profil.');
    } on UnauthorizedException {
      // _onSessionEnded already switched the state.
    } on ApiException catch (e) {
      Log.w('auth: restore failed', e);
      state = AuthSignedOut(message: e.message);
    }
  }

  Future<UserProfile?> _cachedProfile(String sub) async {
    try {
      final raw = await ref.read(databaseProvider).kvGetJson(_profileKey(sub));
      return raw == null ? null : userProfileFromJson(raw);
    } on Object catch (e) {
      Log.w('auth: cached profile unreadable', e);
      return null;
    }
  }

  /// Background half of a cached start: registers the install and refreshes the profile. Offline or
  /// a server error keeps the cached profile ([refreshProfile] retries the registration later); a
  /// rejected session is handled by [_onSessionEnded].
  Future<void> _refreshInBackground(String sub) async {
    try {
      final profile = await _loadProfileOnline(sub, register: true);
      final s = state;
      if (s is AuthSignedIn && s.sub == sub) state = AuthSignedIn(profile: profile, sub: sub);
      StartupTrace.mark('auth: background profile refresh done');
    } on ApiException catch (e) {
      Log.i('auth: background refresh skipped (${e.runtimeType})');
    } on Object catch (e) {
      Log.w('auth: background refresh failed', e);
    }
  }

  Future<UserProfile> _loadProfileOnline(String sub, {required bool register}) async {
    if (register) await _registerDevice();
    final raw = await ref.read(profileApiProvider).meRaw();
    await ref.read(databaseProvider).kvPut(_profileKey(sub), jsonEncode(raw));
    final profile = userProfileFromJson(raw);
    unawaited(ref.read(syncEngineProvider).rememberServerTime(profile.serverTime));
    return profile;
  }

  /// Registers this install; a revoked install id (403) is replaced by a fresh one once.
  Future<void> _registerDevice() async {
    final device = ref.read(deviceIdentityProvider);
    final api = ref.read(profileApiProvider);
    // ADR 0010 decision 10: reported at every start/login, recorded server-side, never blocking —
    // both extras are optional, so a slow platform channel only drops them from this registration.
    final (fcm, integrity) = await (
      _optional(() => ref.read(pushServiceProvider).token()),
      _optional(() => ref.read(integrityReportProvider.future)),
    ).wait;
    Future<void> attempt() => api.registerDevice(
      deviceId: device.deviceId,
      model: device.model,
      appVersion: device.appVersion,
      fcmToken: fcm,
      integrity: integrity?.toJson(),
    );
    try {
      await attempt();
    } on ProblemException catch (e) {
      if (e.status != 403 && e.status != 409) rethrow;
      Log.i('auth: install id rejected (${e.status}), rotating');
      await device.rotate();
      await attempt();
    }
  }

  Future<T?> _optional<T>(Future<T?> Function() f) async {
    try {
      return await f().timeout(registerExtrasBudget);
    } on Object {
      return null;
    }
  }

  /// Browser login (AppAuth, `PK_LOGIN_MODE=browser`). Returns null on success or an error code /
  /// Indonesian message for the login screen.
  Future<String?> login() => _guardedLogin(() => ref.read(oidcBrowserClientProvider).login());

  /// In-app login (`PK_LOGIN_MODE=password`, ADR 0012). The password is passed straight to the token
  /// request and is never stored or logged.
  Future<String?> loginWithPassword({required String username, required String password}) =>
      _guardedLogin(() => ref.read(passwordLoginClientProvider).login(username: username.trim(), password: password));

  Future<String?> _guardedLogin(Future<OidcTokens> Function() obtainTokens) async {
    if (_busy) return null;
    _busy = true;
    try {
      final tokens = await obtainTokens();
      final tm = ref.read(tokenManagerProvider);
      await tm.saveLogin(tokens);
      final sub = await tm.sessionSub();
      if (sub == null) throw StateError('sub hilang dari token');
      final profile = await _loadProfileOnline(sub, register: true);
      state = AuthSignedIn(profile: profile, sub: sub);
      return null;
    } on LoginCancelled {
      return 'cancelled';
    } on PasswordLoginException catch (e) {
      // Nothing was stored: the token request itself failed.
      return e.message;
    } on NetworkException {
      await ref.read(tokenManagerProvider).clear();
      return 'network';
    } on ApiException catch (e) {
      await ref.read(tokenManagerProvider).clear();
      return e.message;
    } on Object catch (e) {
      Log.w('auth: login failed', e);
      await ref.read(tokenManagerProvider).clear();
      return 'failed';
    } finally {
      _busy = false;
    }
  }

  Future<void> refreshProfile() async {
    final s = state;
    if (s is! AuthSignedIn) return;
    try {
      final p = await _loadProfileOnline(s.sub, register: s.fromCache);
      state = AuthSignedIn(profile: p, sub: s.sub);
    } on ApiException {
      // keep current
    }
  }

  /// Logout. ALWAYS ends in [AuthSignedOut] — offline, when Keycloak or the API hangs or fails, or
  /// when a Keystore call throws:
  /// 1. best effort, at most [logoutNetworkBudget] in total: revoke this device server-side (also
  ///    ends the Keycloak offline session, ADR 0003 §5), then end the Keycloak session (browser mode:
  ///    RP-initiated logout via AppAuth; password mode: `POST …/logout` with the refresh token, ADR 0012);
  /// 2. local, each step bounded and isolated: drop tokens, push clean-up, new install id for the next
  ///    login (a revoked id can never be re-activated).
  /// The encrypted offline queue and drafts are NOT deleted: they stay locked to this user's `sub`
  /// (ADR 0010 decision 3) and are sent after the same user signs in again. The profile screen warns
  /// before logout when unsent items exist. Concurrent calls share one run.
  Future<void> logout() => _logout ??= _runLogout().whenComplete(() => _logout = null);

  Future<void> _runLogout() async {
    final sw = Stopwatch()..start();
    try {
      await _endRemoteSession().timeout(logoutNetworkBudget);
    } on Object catch (e) {
      Log.i('auth: remote logout incomplete (${e.runtimeType})');
    }
    final tm = ref.read(tokenManagerProvider);
    final device = ref.read(deviceIdentityProvider);
    await _localStep('tokens', tm.clear);
    await _localStep('push', () => ref.read(pushServiceProvider).onLogout());
    await _localStep('install id', device.rotate);
    state = const AuthSignedOut();
    Log.i('auth: signed out in ${sw.elapsedMilliseconds} ms');
  }

  Future<void> _endRemoteSession() async {
    final tm = ref.read(tokenManagerProvider);
    final device = ref.read(deviceIdentityProvider);
    try {
      await ref.read(profileApiProvider).revokeDevice(device.deviceId);
    } on Object catch (e) {
      Log.i('auth: device revoke skipped (${e.runtimeType})');
    }
    try {
      if (ref.read(appEnvProvider).usesPasswordLogin) {
        final refresh = await tm.refreshToken();
        if (refresh != null) await ref.read(passwordLoginClientProvider).logout(refreshToken: refresh);
      } else {
        final idToken = await tm.idToken();
        await ref.read(oidcBrowserClientProvider).endSession(idTokenHint: idToken);
      }
    } on Object catch (e) {
      Log.i('auth: end session skipped (${e.runtimeType})');
    }
  }

  Future<void> _localStep(String name, Future<void> Function() f) async {
    try {
      await f().timeout(logoutLocalStepBudget);
    } on Object catch (e) {
      Log.w('auth: logout step "$name" failed', e);
    }
  }

  Future<void> _onSessionEnded(String reason) async {
    Log.i('auth: session ended ($reason)');
    if (_logout != null) return; // logout in progress sets the final state itself
    if (reason == TokenManager.sessionEndedDeviceRevoked) {
      // The server never re-activates a revoked install id: use a fresh one for the next login.
      await ref.read(pushServiceProvider).onLogout();
      await ref.read(deviceIdentityProvider).rotate();
      state = const AuthSignedOut(message: signedOutDeviceRevoked);
      return;
    }
    state = const AuthSignedOut(message: 'session_ended');
  }
}
