import 'dart:async';

import 'package:flutter/foundation.dart' show kReleaseMode;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'app/app.dart';
import 'app/providers.dart';
import 'app/route_error_screen.dart';
import 'core/config/app_env.dart';
import 'core/db/app_database.dart';
import 'core/device/device_identity.dart';
import 'core/logging/startup_trace.dart';
import 'core/logging/log.dart';
import 'core/storage/secure_store.dart';
import 'features/sync/background/background_sync.dart';

Future<void> main() async {
  StartupTrace.mark('main');
  WidgetsFlutterBinding.ensureInitialized();
  // Release builds would otherwise paint a plain grey box for a build exception (looks like a blank screen).
  if (kReleaseMode) ErrorWidget.builder = (_) => const FatalBuildErrorView();
  final env = AppEnv.fromEnvironment();
  final store = PlatformSecureStore();
  // Only what the first frame needs, in parallel: install id + app version (request headers) and the
  // DB handle. The DB itself opens lazily in drift's background isolate on the first query, so the
  // SQLite3MultipleCiphers key derivation never runs on the UI thread.
  final (_, device, db) = await (
    initializeDateFormatting('id'),
    DeviceIdentity.load(store),
    openEncryptedDatabase(store),
  ).wait;
  StartupTrace.mark('bootstrap done');
  // E3-b: WorkManager background sync. The UI isolate's port is registered before the first token
  // refresh (see background_sync.dart); initialize() only stores the dispatcher handle.
  ForegroundSyncPort.register();
  unawaited(
    defaultBackgroundScheduler().initialize().then<void>(
      (_) {},
      onError: (Object e) => Log.w('bg-sync: initialize failed', e),
    ),
  );
  runApp(
    ProviderScope(
      overrides: [
        appEnvProvider.overrideWithValue(env),
        secureStoreProvider.overrideWithValue(store),
        deviceIdentityProvider.overrideWithValue(device),
        databaseProvider.overrideWithValue(db),
      ],
      child: const ProyekKasApp(),
    ),
  );
  WidgetsBinding.instance.addPostFrameCallback((_) => StartupTrace.mark('first frame'));
}
