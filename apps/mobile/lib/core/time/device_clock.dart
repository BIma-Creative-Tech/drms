import 'package:flutter/services.dart';

/// Device clock data for offline items (ADR 0010 decision 7). The server, not the phone, decides the
/// official time; these values only let it estimate when an offline action happened.
abstract interface class DeviceClock {
  DateTime now();

  /// Monotonic ms since boot (Android SystemClock.elapsedRealtime via method channel).
  Future<int> elapsedMs();

  /// Changes on every reboot (Android Settings.Global.BOOT_COUNT); elapsed values are only
  /// comparable within one boot.
  Future<String> bootId();
}

class AndroidDeviceClock implements DeviceClock {
  static const _channel = MethodChannel('id.co.drms.proyekkas/clock');
  final Stopwatch _fallback = Stopwatch()..start();
  final String _fallbackBoot = 'proc-${DateTime.now().microsecondsSinceEpoch}';

  @override
  DateTime now() => DateTime.now();

  @override
  Future<int> elapsedMs() async {
    try {
      final v = await _channel.invokeMethod<int>('elapsedRealtime');
      if (v != null) return v;
    } on Object {
      // fall through
    }
    return _fallback.elapsedMilliseconds;
  }

  @override
  Future<String> bootId() async {
    try {
      final v = await _channel.invokeMethod<int>('bootCount');
      if (v != null && v >= 0) return 'b-$v';
    } on Object {
      // fall through
    }
    return _fallbackBoot;
  }
}

class FakeDeviceClock implements DeviceClock {
  FakeDeviceClock({DateTime? now, this.elapsed = 1000, this.boot = 'b-1'}) : current = now ?? DateTime(2026, 9, 21, 12);
  DateTime current;
  int elapsed;
  String boot;
  @override
  DateTime now() => current;
  @override
  Future<int> elapsedMs() async => elapsed;
  @override
  Future<String> bootId() async => boot;
}
