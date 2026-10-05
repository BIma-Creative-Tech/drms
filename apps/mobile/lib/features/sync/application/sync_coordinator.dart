import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/logging/log.dart';
import '../../auth/application/auth_controller.dart';
import '../data/outbox_repository.dart';
import '../background/background_sync.dart';
import 'sync_engine.dart';

class SyncStatus {
  const SyncStatus({this.running = false, this.last, this.serverUnsupported = false});
  final bool running;
  final SyncRunResult? last;
  final bool serverUnsupported;
}

/// Sync triggers (ADR 0010 decision 12): after login/app start, when connectivity returns, after each
/// enqueue ([requestSync]), manually, and — E3-b — WorkManager: a periodic task while signed in, a
/// one-off task when a foreground run leaves items behind, and background runs that find this app
/// alive ask it to sync ([ForegroundSyncPort]).
final syncCoordinatorProvider = NotifierProvider<SyncCoordinator, SyncStatus>(SyncCoordinator.new);

final outboxCountsProvider = StreamProvider<OutboxCounts>((ref) {
  final sub = ref.watch(currentSubProvider);
  if (sub == null) return Stream.value(const OutboxCounts());
  return ref.watch(outboxRepositoryProvider).watchCounts(sub);
});

/// Membership PT ids of the account as one comparable value ('' = none known).
final _membershipKeyProvider = Provider<String>(
  (ref) => (ref.watch(accountProfileProvider)?.companies.map((c) => c.id).toList() ?? const <int>[]).join(','),
);

class SyncCoordinator extends Notifier<SyncStatus> {
  StreamSubscription<void>? _online;
  StreamSubscription<void>? _background;
  Timer? _debounce;

  @override
  SyncStatus build() {
    _online = ref.watch(onlineAgainProvider).listen((_) => requestSync());
    _background = ForegroundSyncPort.requests.listen((_) => requestSync(delay: Duration.zero));
    final scheduler = ref.watch(backgroundSchedulerProvider);
    ref.listen<String?>(currentSubProvider, (prev, next) {
      if (next == null && prev != null) {
        // Signed out: nothing may run in the background for this user until they sign in again.
        unawaited(scheduler.cancelAll().then<void>((_) {}, onError: (Object e) => Log.w('bg-sync: cancel failed', e)));
      }
      if (next != null && prev != next) {
        unawaited(
          scheduler.schedulePeriodic().then<void>((_) {}, onError: (Object e) => Log.w('bg-sync: schedule failed', e)),
        );
        _refreshMasters(next);
        requestSync();
      }
    }, fireImmediately: true);
    // MC3: a membership added / removed on the server → masters of the new PT set (caches per PT).
    ref.listen<String>(_membershipKeyProvider, (prev, next) {
      final sub = ref.read(currentSubProvider);
      if (prev != null && prev != next && sub != null) _refreshMasters(sub);
    });
    ref.onDispose(() {
      _online?.cancel();
      _background?.cancel();
      _debounce?.cancel();
    });
    return const SyncStatus();
  }

  /// Best effort: a 401/5xx here must not become an unhandled async error. Every membership PT is cached
  /// (not only the selected ones): drafts of any PT must work offline.
  void _refreshMasters(String sub) {
    final ids = ref.read(accountProfileProvider)?.companies.map((c) => c.id).toList();
    unawaited(
      ref.read(mastersRepositoryProvider).refresh(sub, companyIds: ids).then<void>((ok) {
        if (ok && ref.mounted) ref.read(mastersRevisionProvider.notifier).bump();
      }, onError: (Object e) => Log.w('masters: refresh failed', e)),
    );
  }

  void _scheduleBackground() {
    if (ref.read(currentSubProvider) == null) return;
    unawaited(
      ref
          .read(backgroundSchedulerProvider)
          .scheduleOnce()
          .then<void>((_) {}, onError: (Object e) => Log.w('bg-sync: one-off failed', e)),
    );
  }

  void requestSync({Duration delay = const Duration(milliseconds: 500)}) {
    _debounce?.cancel();
    _debounce = Timer(delay, () => unawaited(runNow()));
  }

  Future<SyncRunResult?> runNow() async {
    final sub = ref.read(currentSubProvider);
    if (sub == null || state.running) return null;
    if (!ref.read(connectivityProvider)) {
      _scheduleBackground(); // the app may be closed before the network returns
      return const SyncRunResult(SyncRunOutcome.offline);
    }
    state = SyncStatus(running: true, last: state.last, serverUnsupported: state.serverUnsupported);
    try {
      final r = await ref.read(syncEngineProvider).run(sub);
      state = SyncStatus(last: r, serverUnsupported: r.outcome == SyncRunOutcome.serverUnsupported);
      // ADR 0018: attendance refused PRIVACY_ACK_REQUIRED → reload /me (privacy gate: notice screen, attendance lock).
      if (r.privacyAckRequired) unawaited(ref.read(authControllerProvider.notifier).refreshProfile());
      if (r.outcome == SyncRunOutcome.offline || r.deferred > 0) _scheduleBackground();
      return r;
    } on Object catch (e) {
      Log.w('sync: run failed', e);
      state = SyncStatus(last: state.last, serverUnsupported: state.serverUnsupported);
      return null;
    }
  }
}
