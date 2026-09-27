import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../domain/app_config.dart';

/// Fetched once at start (before login). Null = endpoint missing/unreachable → app continues.
final appConfigProvider = FutureProvider<AppConfig?>(
  (ref) => ref.watch(appConfigApiProvider).fetch(version: ref.watch(deviceIdentityProvider).appVersion),
);

final versionGateProvider = Provider<VersionGate>((ref) {
  if (ref.watch(upgradeRequiredProvider) != null) return VersionGate.updateRequired;
  final cfg = ref.watch(appConfigProvider);
  final current = ref.watch(deviceIdentityProvider).appVersion;
  return switch (cfg) {
    AsyncData(:final value) => evaluateVersion(current, value),
    _ => VersionGate.ok,
  };
});
