import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../app/providers.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/logging/log.dart';
import '../../../core/network/api_exception.dart';
import '../../auth/application/auth_controller.dart';
import '../data/privacy_api.dart';
import '../domain/privacy.dart';

/// Employee privacy notice on the APK (Q-46, ADR 0018):
/// - after login / at every app start, a full-screen notice while the current version is not acknowledged
///   ([privacyPromptProvider], router redirect); "Nanti" hides it for this app run only;
/// - attendance (own check-in/out, on-behalf, selfie capture) is blocked until acknowledged
///   ([attendanceBlockedByPrivacyProvider]); everything else works;
/// - "Saya mengerti" posts the acknowledgement; offline it is retried when the server is reachable again and the
///   app keeps blocking attendance meanwhile — the acknowledgement is never assumed locally;
/// - a server without the feature (`/me` without `privacy`, 404 on the endpoints) blocks nothing.
final privacyApiProvider = Provider((ref) => PrivacyApi(ref.watch(apiClientProvider)));
final privacyNoticeCacheProvider = Provider((ref) => PrivacyNoticeCache(ref.watch(databaseProvider)));

/// Gate of the signed-in account (`/me` `privacy`; app-wide, not per PT).
final privacyGateProvider = Provider<PrivacyGate>(
  (ref) => privacyGateOf(ref.watch(accountProfileProvider.select((p) => p?.privacy))),
);

/// True while attendance must stay blocked (current notice not acknowledged on the server).
final attendanceBlockedByPrivacyProvider = Provider<bool>(
  (ref) => ref.watch(privacyGateProvider) == PrivacyGate.required,
);

/// "Nanti" on the full-screen notice: not shown again during THIS app run (a new start shows it again). Reset when
/// another user signs in.
final privacyPromptDismissedProvider = NotifierProvider<PrivacyPromptDismissed, bool>(PrivacyPromptDismissed.new);

class PrivacyPromptDismissed extends Notifier<bool> {
  @override
  bool build() {
    ref.watch(currentSubProvider);
    return false;
  }

  void dismiss() => state = true;
}

/// The router shows the full-screen notice (instead of the home screen) while this is true.
final privacyPromptProvider = Provider<bool>(
  (ref) => ref.watch(privacyGateProvider) == PrivacyGate.required && !ref.watch(privacyPromptDismissedProvider),
);

/// The notice text: the server's copy (stored for offline reading), else the stored copy. Null = the server has no
/// notice (404). Throws only when there is neither a server answer nor a stored copy.
final privacyNoticeProvider = FutureProvider<PrivacyNotice?>((ref) async {
  final cache = ref.watch(privacyNoticeCacheProvider);
  final api = ref.watch(privacyApiProvider);
  if (!ref.read(connectivityProvider)) {
    final stored = await cache.read();
    if (stored != null) return stored;
  }
  try {
    final notice = await api.notice();
    if (notice != null) {
      try {
        await cache.write(notice);
      } on Object catch (e) {
        Log.w('privacy: notice not cached', e);
      }
    }
    return notice;
  } on ApiException {
    final stored = await cache.read();
    if (stored != null) return stored;
    rethrow;
  }
});

enum PrivacyAckPhase { idle, sending, waitingForNetwork, versionChanged, unavailable, failed, done }

class PrivacyAckState {
  const PrivacyAckState(this.phase, {this.message});
  final PrivacyAckPhase phase;

  /// Server message for [PrivacyAckPhase.failed].
  final String? message;
}

final privacyAckControllerProvider = NotifierProvider<PrivacyAckController, PrivacyAckState>(PrivacyAckController.new);

/// Sends "Saya mengerti". One Idempotency-Key per acknowledged version (retries reuse it). Offline: waits for the
/// server to be reachable again ([connectivityProvider] false → true) and retries by itself.
class PrivacyAckController extends Notifier<PrivacyAckState> {
  String? _key;
  int? _keyVersion;
  int? _pendingVersion;

  @override
  PrivacyAckState build() {
    ref.watch(currentSubProvider);
    _key = null;
    _keyVersion = null;
    _pendingVersion = null;
    ref.listen<bool>(connectivityProvider, (prev, online) {
      final pending = _pendingVersion;
      if (online && prev == false && pending != null && state.phase == PrivacyAckPhase.waitingForNetwork) {
        unawaited(acknowledge(pending));
      }
    });
    return const PrivacyAckState(PrivacyAckPhase.idle);
  }

  /// True when the server recorded the acknowledgement.
  Future<bool> acknowledge(int version) async {
    if (state.phase == PrivacyAckPhase.sending) return false;
    if (_keyVersion != version || _key == null) {
      _key = const Uuid().v4();
      _keyVersion = version;
    }
    state = const PrivacyAckState(PrivacyAckPhase.sending);
    try {
      final r = await ref.read(privacyApiProvider).acknowledge(version, idempotencyKey: _key!);
      _pendingVersion = null;
      if (r == null) {
        state = const PrivacyAckState(PrivacyAckPhase.unavailable);
        return false;
      }
      await ref.read(authControllerProvider.notifier).applyPrivacyAck(version: r.version, ackAt: r.ackAt);
      _key = null;
      state = const PrivacyAckState(PrivacyAckPhase.done);
      return true;
    } on NetworkException {
      _pendingVersion = version;
      state = const PrivacyAckState(PrivacyAckPhase.waitingForNetwork);
      return false;
    } on ProblemException catch (e) {
      _pendingVersion = null;
      if (e.status == 409 && (e.code == null || e.code == privacyVersionMismatchCode)) {
        _key = null;
        ref.invalidate(privacyNoticeProvider);
        unawaited(ref.read(authControllerProvider.notifier).refreshProfile());
        state = const PrivacyAckState(PrivacyAckPhase.versionChanged);
      } else {
        state = PrivacyAckState(PrivacyAckPhase.failed, message: e.message);
      }
      return false;
    } on ApiException catch (e) {
      // 401 (session ended: the auth layer signs out), 426 (update screen) …
      _pendingVersion = null;
      state = PrivacyAckState(PrivacyAckPhase.failed, message: e.message);
      return false;
    }
  }
}
