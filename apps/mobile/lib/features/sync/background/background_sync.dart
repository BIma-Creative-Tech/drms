import 'dart:async';
import 'dart:io' show Platform;
import 'dart:isolate';
import 'dart:ui' show IsolateNameServer;

import 'package:flutter/widgets.dart';
import 'package:workmanager/workmanager.dart';

import '../../../core/config/app_env.dart';
import '../../../core/db/app_database.dart';
import '../../../core/device/device_identity.dart';
import '../../../core/logging/log.dart';
import '../../../core/network/api_client.dart';
import '../../../core/storage/secure_store.dart';
import '../../../core/time/device_clock.dart';
import '../../../core/util/async_lock.dart';
import '../../auth/data/token_manager.dart';
import '../../expense/data/draft_repository.dart';
import '../../expense/data/expense_api.dart';
import '../../progress/data/progress_repository.dart';
import '../application/sync_engine.dart';
import '../data/outbox_repository.dart';
import '../data/sync_api.dart';
import '../domain/sync_models.dart';

/// Background sync with Android WorkManager (E3-b, ADR 0010 decision 12): the offline outbox is sent
/// while the app is closed. A periodic task (Android minimum 15 min, network required) is the safety
/// net; a one-off task (network required) is queued when a foreground run could not finish.
///
/// Concurrency with the running app (same process, separate isolates — WorkManager starts its own
/// Flutter engine): the refresh token rotates (Keycloak "Revoke Refresh Token"), so two isolates must
/// never refresh at the same time. Rules, via [IsolateNameServer] (process-wide):
/// - the UI isolate registers [foregroundPortName] at start; a background run that finds it does not
///   sync itself but asks the UI isolate to sync (one token owner);
/// - a background run registers [backgroundPortName] while it works; the UI isolate's token refresh
///   waits until that name is gone ([waitForBackgroundSync]).
abstract final class BackgroundSyncNames {
  static const periodicUnique = 'pk.sync.periodic';
  static const oneOffUnique = 'pk.sync.once';
  static const task = 'pk.sync';
  static const foregroundPortName = 'pk.sync.foreground';
  static const backgroundPortName = 'pk.sync.background';
}

/// WorkManager entry point (must be top level, kept by the AOT tree shaker).
@pragma('vm:entry-point')
void backgroundSyncDispatcher() {
  Workmanager().executeTask((task, input) async {
    WidgetsFlutterBinding.ensureInitialized();
    try {
      return await BackgroundSyncRunner.platform().run();
    } on Object catch (e) {
      Log.w('bg-sync: failed', e);
      return false; // WorkManager retries with back-off
    }
  });
}

/// Name registry seam (tests use a map; production uses [IsolateNameServer]).
abstract interface class PortRegistry {
  SendPort? lookup(String name);
  bool register(SendPort port, String name);
  void remove(String name);
}

class IsolatePortRegistry implements PortRegistry {
  const IsolatePortRegistry();
  @override
  SendPort? lookup(String name) => IsolateNameServer.lookupPortByName(name);
  @override
  bool register(SendPort port, String name) => IsolateNameServer.registerPortWithName(port, name);
  @override
  void remove(String name) => IsolateNameServer.removePortNameMapping(name);
}

/// What one background run needs; opened lazily (the DB only when there is a session).
class BackgroundSyncDeps {
  const BackgroundSyncDeps({required this.engine, required this.close});
  final SyncEngine engine;
  final Future<void> Function() close;
}

/// Outcome of one background run (for tests and logs).
enum BackgroundRunOutcome { delegatedToForeground, alreadyRunning, notLoggedIn, synced, retryLater }

class BackgroundSyncRunner {
  BackgroundSyncRunner({required this.store, required this.registry, required this.openDeps});

  /// Production wiring: platform secure storage, encrypted DB, real token manager + API client.
  factory BackgroundSyncRunner.platform() {
    final store = PlatformSecureStore();
    return BackgroundSyncRunner(
      store: store,
      registry: const IsolatePortRegistry(),
      openDeps: () async {
        final env = AppEnv.fromEnvironment();
        final (device, db) = await (DeviceIdentity.load(store), openEncryptedDatabase(store)).wait;
        return platformDeps(env: env, store: store, device: device, db: db, clock: AndroidDeviceClock());
      },
    );
  }

  final SecureStore store;
  final PortRegistry registry;
  final Future<BackgroundSyncDeps> Function() openDeps;

  BackgroundRunOutcome? lastOutcome;

  /// How long a registered port may take to answer before it is treated as stale (its isolate is gone
  /// but the process-wide name mapping stayed behind).
  Duration pingTimeout = const Duration(seconds: 5);

  /// true = done (WorkManager success), false = retry later.
  Future<bool> run() async {
    final own = ReceivePort();
    // Answer liveness pings of the UI isolate while this run holds the token.
    own.listen((m) {
      if (m is SendPort) m.send('busy');
    });
    // Register first, then look for the UI isolate: with this order the two can never both proceed.
    if (!registry.register(own.sendPort, BackgroundSyncNames.backgroundPortName)) {
      final other = registry.lookup(BackgroundSyncNames.backgroundPortName);
      if (other != null && await pingPort(other, pingTimeout)) {
        own.close();
        lastOutcome = BackgroundRunOutcome.alreadyRunning;
        return true;
      }
      registry.remove(BackgroundSyncNames.backgroundPortName); // stale mapping
      registry.register(own.sendPort, BackgroundSyncNames.backgroundPortName);
    }
    try {
      final fg = registry.lookup(BackgroundSyncNames.foregroundPortName);
      if (fg != null) {
        if (await pingPort(fg, pingTimeout)) {
          lastOutcome = BackgroundRunOutcome.delegatedToForeground;
          return true;
        }
        registry.remove(BackgroundSyncNames.foregroundPortName); // UI engine gone, mapping stale
      }
      final sub = await store.read(SecureKeys.sessionSub);
      final hasSession = await store.read(SecureKeys.refreshToken) != null;
      if (sub == null || !hasSession) {
        // Signed out: the queue stays locked to its user (ADR 0010) until the same user signs in.
        lastOutcome = BackgroundRunOutcome.notLoggedIn;
        return true;
      }
      final deps = await openDeps();
      try {
        final r = await deps.engine.run(sub);
        Log.i('bg-sync: ${r.outcome.name} applied=${r.applied} deferred=${r.deferred}');
        final retry = r.outcome == SyncRunOutcome.offline;
        lastOutcome = retry ? BackgroundRunOutcome.retryLater : BackgroundRunOutcome.synced;
        return !retry;
      } finally {
        await deps.close();
      }
    } finally {
      registry.remove(BackgroundSyncNames.backgroundPortName);
      own.close();
    }
  }
}

/// Sends a reply port to [target] and waits for any answer. The UI isolate treats this message as
/// "please sync now" and answers at once; a background run answers "busy".
Future<bool> pingPort(SendPort target, Duration timeout) async {
  final reply = ReceivePort();
  try {
    target.send(reply.sendPort);
    await reply.first.timeout(timeout);
    return true;
  } on TimeoutException {
    return false;
  } finally {
    reply.close();
  }
}

/// The same SyncEngine wiring as `app/providers.dart`, without Riverpod (background isolate).
BackgroundSyncDeps platformDeps({
  required AppEnv env,
  required SecureStore store,
  required DeviceIdentity device,
  required AppDatabase db,
  required DeviceClock clock,
}) {
  final tokens = TokenManager(env: env, store: store);
  final client = ApiClient(baseUrl: env.apiV1, tokens: tokens, headers: device);
  final expenseApi = ExpenseApi(client);
  final engine = SyncEngine(
    outbox: OutboxRepository(db),
    drafts: DraftRepository(db),
    api: SyncApi(client),
    db: db,
    clock: clock,
    deviceId: () => device.deviceId,
    lock: AsyncLock(),
    progress: ProgressRepository(db),
    uploadMedia: (blob) => expenseApi.uploadMedia(
      mediaUploadPath(blob.kind),
      blob.bytes,
      filename: '${blob.clientUuid}.jpg',
      mime: blob.mimeType,
    ),
  );
  return BackgroundSyncDeps(engine: engine, close: db.close);
}

/// UI isolate side: owns [BackgroundSyncNames.foregroundPortName] for the app lifetime and forwards
/// "sync" requests (a [SendPort] to acknowledge on) from a background run to the coordinator.
class ForegroundSyncPort {
  ForegroundSyncPort._(this._registry, this._port) {
    _port.listen((m) {
      if (m is SendPort) {
        m.send('ok');
        _requests.add(null);
      }
    });
  }

  static ForegroundSyncPort? _instance;

  /// Registered once in `main()` before `runApp` (before the first token refresh).
  static ForegroundSyncPort register({PortRegistry registry = const IsolatePortRegistry()}) {
    final existing = _instance;
    if (existing != null) return existing;
    final port = ReceivePort();
    registry.remove(BackgroundSyncNames.foregroundPortName);
    registry.register(port.sendPort, BackgroundSyncNames.foregroundPortName);
    return _instance = ForegroundSyncPort._(registry, port);
  }

  /// Requests from background runs (empty when the port was never registered, e.g. in widget tests).
  static Stream<void> get requests => _instance?._requests.stream ?? const Stream.empty();

  final PortRegistry _registry;
  final ReceivePort _port;
  final _requests = StreamController<void>.broadcast();

  void dispose() {
    _registry.remove(BackgroundSyncNames.foregroundPortName);
    _port.close();
    _requests.close();
    _instance = null;
  }
}

/// Token-refresh guard of the UI isolate: waits (bounded) while a live background run holds the
/// token; a mapping that does not answer is stale and removed.
Future<void> waitForBackgroundSync({
  PortRegistry registry = const IsolatePortRegistry(),
  Duration poll = const Duration(milliseconds: 250),
  Duration pingTimeout = const Duration(seconds: 2),
  Duration max = const Duration(seconds: 30),
}) async {
  final sw = Stopwatch()..start();
  while (sw.elapsed < max) {
    final bg = registry.lookup(BackgroundSyncNames.backgroundPortName);
    if (bg == null) return;
    if (!await pingPort(bg, pingTimeout)) {
      registry.remove(BackgroundSyncNames.backgroundPortName);
      return;
    }
    await Future<void>.delayed(poll);
  }
}

/// Scheduling seam (WorkManager on Android, no-op elsewhere — tests, desktop).
abstract interface class BackgroundScheduler {
  Future<void> initialize();
  Future<void> schedulePeriodic();
  Future<void> scheduleOnce();
  Future<void> cancelAll();
}

class NoopBackgroundScheduler implements BackgroundScheduler {
  const NoopBackgroundScheduler();
  @override
  Future<void> initialize() async {}
  @override
  Future<void> schedulePeriodic() async {}
  @override
  Future<void> scheduleOnce() async {}
  @override
  Future<void> cancelAll() async {}
}

class WorkmanagerScheduler implements BackgroundScheduler {
  const WorkmanagerScheduler();

  static final _network = Constraints(networkType: NetworkType.connected);

  @override
  Future<void> initialize() => Workmanager().initialize(backgroundSyncDispatcher);

  /// Every 15 min (the Android minimum; the OS may batch/delay it — Doze, battery saver).
  @override
  Future<void> schedulePeriodic() => Workmanager().registerPeriodicTask(
    BackgroundSyncNames.periodicUnique,
    BackgroundSyncNames.task,
    frequency: const Duration(minutes: 15),
    constraints: _network,
    existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
    backoffPolicy: BackoffPolicy.exponential,
    backoffPolicyDelay: const Duration(minutes: 1),
  );

  /// Runs as soon as there is network (also after the app was closed).
  @override
  Future<void> scheduleOnce() => Workmanager().registerOneOffTask(
    BackgroundSyncNames.oneOffUnique,
    BackgroundSyncNames.task,
    constraints: _network,
    existingWorkPolicy: ExistingWorkPolicy.keep,
    backoffPolicy: BackoffPolicy.exponential,
    backoffPolicyDelay: const Duration(minutes: 1),
  );

  @override
  Future<void> cancelAll() => Workmanager().cancelAll();
}

BackgroundScheduler defaultBackgroundScheduler() =>
    Platform.isAndroid ? const WorkmanagerScheduler() : const NoopBackgroundScheduler();
