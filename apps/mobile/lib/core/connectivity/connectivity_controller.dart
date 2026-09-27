import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../logging/log.dart';

/// Online state (ADR 0010 decision 12: "real check = API call"). The server is the source of truth:
/// - any HTTP answer from `/api/v1` (success or problem) means ONLINE, whatever connectivity_plus says;
/// - a request without an answer (timeout, DNS, no route) means OFFLINE until a later call or the
///   `/api/v1/health` probe gets an answer again;
/// - connectivity_plus is only a hint: an interface event re-arms the online state, and a `none` event
///   is verified with the probe instead of being trusted forever (a wrong `none` used to stick until
///   the next OS network event, even while every API call succeeded).
final connectivityProvider = NotifierProvider<ConnectivityController, bool>(ConnectivityController.new);

/// Fires when connectivity comes back (sync trigger).
final onlineAgainProvider = Provider<Stream<void>>((ref) => ref.watch(connectivityProvider.notifier).onlineAgain);

/// Returns true when the API answered at all (any HTTP status). Must never throw.
typedef ReachabilityProbe = Future<bool> Function();

/// `GET /api/v1/health` (public liveness endpoint, apps/web/src/api/v1/endpoints/health.ts) on its own
/// dio with a short timeout: no auth header, no token refresh, no device headers.
final reachabilityProbeProvider = Provider<ReachabilityProbe>((ref) {
  final url = '${ref.watch(appEnvProvider).apiV1}/health';
  final dio = Dio(
    BaseOptions(
      connectTimeout: const Duration(seconds: 5),
      sendTimeout: const Duration(seconds: 5),
      receiveTimeout: const Duration(seconds: 5),
      validateStatus: (_) => true,
    ),
  );
  ref.onDispose(dio.close);
  return () async {
    try {
      await dio.get<dynamic>(url);
      return true;
    } on Object {
      return false;
    }
  };
});

class ConnectivityController extends Notifier<bool> {
  StreamSubscription<List<ConnectivityResult>>? _sub;
  final _onlineAgain = StreamController<void>.broadcast();
  bool _hasInterface = true;
  bool _serverReachable = true;
  Timer? _probeTimer;
  int _probeAttempt = 0;
  bool _disposed = false;

  /// Delays between health probes while offline (the last value repeats).
  static const defaultProbeBackoff = [
    Duration(seconds: 3),
    Duration(seconds: 10),
    Duration(seconds: 20),
    Duration(seconds: 30),
    Duration(seconds: 60),
  ];

  /// Overridable for tests.
  List<Duration> get probeBackoff => defaultProbeBackoff;

  Stream<void> get onlineAgain => _onlineAgain.stream;

  /// Overridable for tests.
  Connectivity createConnectivity() => Connectivity();

  @override
  bool build() {
    ref.onDispose(() {
      _disposed = true;
      _probeTimer?.cancel();
      _sub?.cancel();
      _onlineAgain.close();
    });
    try {
      final c = createConnectivity();
      _sub = c.onConnectivityChanged.listen(onInterfaces, onError: (_) {});
      c.checkConnectivity().then(onInterfaces, onError: (_) {});
    } on Object {
      // No platform channel (tests): assume online until an API call says otherwise.
    }
    return true;
  }

  /// connectivity_plus result (a list since connectivity_plus 6; 7.3.1 `checkConnectivity` /
  /// `onConnectivityChanged`). Every value except `none` — `mobile`, `wifi`, `ethernet`, `vpn`,
  /// `other`, … — counts as a network interface.
  void onInterfaces(List<ConnectivityResult> r) {
    if (_disposed) return;
    if (r.any((e) => e != ConnectivityResult.none)) {
      _hasInterface = true;
      _serverReachable = true; // optimistic; the next call (or the probe) confirms
      _probeAttempt = 0;
      _emit();
    } else {
      _hasInterface = false;
      _emit();
      _scheduleProbe();
    }
  }

  /// Called by the ApiClient after every request: true = the server answered (any HTTP status).
  void reportServerReachable(bool ok) {
    if (_disposed) return;
    if (ok) {
      // An answer proves a working network, even if connectivity_plus said `none`.
      _hasInterface = true;
      _serverReachable = true;
      _probeAttempt = 0;
      _probeTimer?.cancel();
      _probeTimer = null;
      _emit();
      return;
    }
    _serverReachable = false;
    _emit();
    _scheduleProbe();
  }

  /// Probes the server now (e.g. the user taps the offline banner). Returns the new state.
  Future<bool> recheck() async {
    _probeTimer?.cancel();
    _probeTimer = null;
    await _probe();
    return !_disposed && state;
  }

  void _scheduleProbe() {
    if (_disposed || state || (_probeTimer?.isActive ?? false)) return;
    final backoff = probeBackoff;
    final i = _probeAttempt < backoff.length ? _probeAttempt : backoff.length - 1;
    _probeAttempt++;
    _probeTimer = Timer(backoff[i], () => unawaited(_probe()));
  }

  Future<void> _probe() async {
    if (_disposed) return;
    bool ok;
    try {
      ok = await ref.read(reachabilityProbeProvider)();
    } on Object {
      ok = false;
    }
    if (_disposed) return;
    Log.d('connectivity: health probe ${ok ? 'ok' : 'failed'}');
    if (ok) {
      reportServerReachable(true);
    } else {
      _probeTimer = null;
      _scheduleProbe();
    }
  }

  void _emit() {
    final next = _hasInterface && _serverReachable;
    final was = state;
    if (was == next) return;
    state = next;
    if (!was && next && !_onlineAgain.isClosed) _onlineAgain.add(null);
  }
}
