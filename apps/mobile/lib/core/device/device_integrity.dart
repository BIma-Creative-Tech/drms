import 'package:flutter/services.dart';

/// Best-effort device integrity signals (ADR 0010 decision 10, QM-4). Root-hiding tools defeat
/// client checks, so these are only REPORTED (POST /devices/register `integrity`) and recorded
/// server-side; the app never blocks on them. Mock location needs a GPS fix (`Position.isMocked`)
/// and is measured with attendance (F5): until then [mockLocation] is null ("not measured").
class DeviceIntegrityReport {
  const DeviceIntegrityReport({
    required this.rooted,
    required this.emulator,
    required this.developerMode,
    required this.adbEnabled,
    this.mockLocation,
  });

  final bool rooted;
  final bool emulator;
  final bool developerMode;
  final bool adbEnabled;
  final bool? mockLocation;

  /// Same rule as the server (`integrityRisk`): developer options / USB debugging alone are no risk.
  bool get risky => rooted || emulator || mockLocation == true;

  /// Body of `DeviceRegister.integrity` (openapi `DeviceIntegrity`).
  Map<String, Object?> toJson() => {
    'rooted': rooted,
    'emulator': emulator,
    'developerMode': developerMode,
    'adbEnabled': adbEnabled,
    'mockLocation': mockLocation,
  };

  static DeviceIntegrityReport? fromChannel(Object? raw) {
    if (raw is! Map) return null;
    bool b(String k) => raw[k] == true;
    return DeviceIntegrityReport(
      rooted: b('rooted'),
      emulator: b('emulator'),
      developerMode: b('developerMode'),
      adbEnabled: b('adbEnabled'),
    );
  }
}

abstract interface class DeviceIntegrityProbe {
  /// Null when the platform check is unavailable (tests, non-Android): nothing is reported.
  Future<DeviceIntegrityReport?> check();
}

/// Kotlin method channel in `MainActivity` (no third-party plugin: see docs/proyekkas/f4/f4-gap-analysis.md).
class AndroidIntegrityProbe implements DeviceIntegrityProbe {
  static const _channel = MethodChannel('id.co.drms.proyekkas/integrity');

  @override
  Future<DeviceIntegrityReport?> check() async {
    try {
      return DeviceIntegrityReport.fromChannel(await _channel.invokeMethod<Object?>('check'));
    } on Object {
      return null;
    }
  }
}

class FixedIntegrityProbe implements DeviceIntegrityProbe {
  const FixedIntegrityProbe(this.report);
  final DeviceIntegrityReport? report;
  @override
  Future<DeviceIntegrityReport?> check() async => report;
}
