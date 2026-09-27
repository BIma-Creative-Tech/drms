import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/app_env.dart';
import '../core/db/app_database.dart';
import '../core/device/device_identity.dart';
import '../core/device/device_integrity.dart';
import '../core/media/photo_compressor.dart';
import '../core/network/api_client.dart';
import '../core/storage/secure_store.dart';
import '../core/time/device_clock.dart';
import '../core/util/async_lock.dart';
import '../features/app_config/data/app_config_api.dart';
import '../features/approvals/data/approvals_api.dart';
import '../features/auth/data/oidc_client.dart';
import '../features/auth/data/password_login_client.dart';
import '../features/auth/data/profile_api.dart';
import '../features/auth/data/token_manager.dart';
import '../features/expense/application/draft_service.dart';
import '../features/expense/data/draft_repository.dart';
import '../features/expense/data/expense_api.dart';
import '../features/masters/data/masters_repository.dart';
import '../features/attendance/data/attendance_api.dart';
import '../features/notifications/data/push_service.dart';
import '../features/progress/data/progress_api.dart';
import '../features/progress/data/progress_repository.dart';
import '../features/sync/domain/sync_models.dart';
import '../features/sync/application/sync_engine.dart';
import '../features/sync/background/background_sync.dart';
import '../features/sync/data/outbox_repository.dart';
import '../features/sync/data/sync_api.dart';
import '../core/connectivity/connectivity_controller.dart';

/// Bootstrapped singletons — overridden in main() / tests.
final appEnvProvider = Provider<AppEnv>((ref) => throw UnimplementedError('appEnvProvider'));
final secureStoreProvider = Provider<SecureStore>((ref) => throw UnimplementedError('secureStoreProvider'));
final deviceIdentityProvider = Provider<DeviceIdentity>((ref) => throw UnimplementedError('deviceIdentityProvider'));
final databaseProvider = Provider<AppDatabase>((ref) => throw UnimplementedError('databaseProvider'));

final deviceClockProvider = Provider<DeviceClock>((ref) => AndroidDeviceClock());
final integrityProbeProvider = Provider<DeviceIntegrityProbe>((ref) => AndroidIntegrityProbe());

/// Last integrity report of this device (null = unknown). Q-43 proposal: warn + flag, never block.
final integrityReportProvider = FutureProvider<DeviceIntegrityReport?>(
  (ref) => ref.watch(integrityProbeProvider).check(),
);
final oidcBrowserClientProvider = Provider<OidcBrowserClient>((ref) => AppAuthBrowserClient(ref.watch(appEnvProvider)));

/// In-app login (`PK_LOGIN_MODE=password`, staging only — ADR 0012).
final passwordLoginClientProvider = Provider<PasswordLoginClient>(
  (ref) => KeycloakPasswordClient(ref.watch(appEnvProvider)),
);
final photoCompressorProvider = Provider<PhotoCompressor>((ref) => DevicePhotoCompressor());
final syncLockProvider = Provider<AsyncLock>((ref) => AsyncLock());

/// Set by the ApiClient when the server answers 426; the router then shows the update screen.
final upgradeRequiredProvider = NotifierProvider<UpgradeRequired, String?>(UpgradeRequired.new);

class UpgradeRequired extends Notifier<String?> {
  @override
  String? build() => null;
  void set(String? minVersion) => state = minVersion ?? '?';
}

final tokenManagerProvider = Provider<TokenManager>(
  (ref) => TokenManager(
    env: ref.watch(appEnvProvider),
    store: ref.watch(secureStoreProvider),
    beforeRefresh: ref.watch(backgroundSchedulerProvider) is NoopBackgroundScheduler ? null : waitForBackgroundSync,
  ),
);

/// WorkManager scheduling (E3-b); no-op off Android (tests).
final backgroundSchedulerProvider = Provider<BackgroundScheduler>((ref) => defaultBackgroundScheduler());

final apiClientProvider = Provider<ApiClient>((ref) {
  final env = ref.watch(appEnvProvider);
  return ApiClient(
    baseUrl: env.apiV1,
    tokens: ref.watch(tokenManagerProvider),
    headers: ref.watch(deviceIdentityProvider),
    onReachability: (ok) => ref.read(connectivityProvider.notifier).reportServerReachable(ok),
    onUpgradeRequired: (min) => ref.read(upgradeRequiredProvider.notifier).set(min),
  );
});

final profileApiProvider = Provider((ref) => ProfileApi(ref.watch(apiClientProvider)));
final appConfigApiProvider = Provider((ref) => AppConfigApi(ref.watch(apiClientProvider)));
final expenseApiProvider = Provider((ref) => ExpenseApi(ref.watch(apiClientProvider)));
final approvalsApiProvider = Provider((ref) => ApprovalsApi(ref.watch(apiClientProvider)));
final syncApiProvider = Provider((ref) => SyncApi(ref.watch(apiClientProvider)));

final draftRepositoryProvider = Provider((ref) => DraftRepository(ref.watch(databaseProvider)));
final progressRepositoryProvider = Provider((ref) => ProgressRepository(ref.watch(databaseProvider)));
final progressApiProvider = Provider((ref) => ProgressApi(ref.watch(apiClientProvider)));
final attendanceApiProvider = Provider((ref) => AttendanceApi(ref.watch(apiClientProvider)));
final outboxRepositoryProvider = Provider((ref) => OutboxRepository(ref.watch(databaseProvider)));
final mastersRepositoryProvider = Provider(
  (ref) => MastersRepository(ref.watch(apiClientProvider), ref.watch(databaseProvider)),
);

final syncEngineProvider = Provider((ref) {
  final device = ref.watch(deviceIdentityProvider);
  return SyncEngine(
    outbox: ref.watch(outboxRepositoryProvider),
    drafts: ref.watch(draftRepositoryProvider),
    api: ref.watch(syncApiProvider),
    db: ref.watch(databaseProvider),
    clock: ref.watch(deviceClockProvider),
    deviceId: () => device.deviceId,
    lock: ref.watch(syncLockProvider),
    progress: ref.watch(progressRepositoryProvider),
    // Local kind → `POST /media/{kind}`: receipts, attendance selfies (F4b/E6), progress photos (E4).
    uploadMedia: (blob) => ref
        .read(expenseApiProvider)
        .uploadMedia(mediaUploadPath(blob.kind), blob.bytes, filename: '${blob.clientUuid}.jpg', mime: blob.mimeType),
  );
});

final draftServiceProvider = Provider(
  (ref) => DraftService(
    drafts: ref.watch(draftRepositoryProvider),
    outbox: ref.watch(outboxRepositoryProvider),
    api: ref.watch(expenseApiProvider),
    clock: ref.watch(deviceClockProvider),
    lock: ref.watch(syncLockProvider),
  ),
);

/// Push is behind the build flag PK_PUSH_ENABLED (Firebase project pending, Q-44).
final pushServiceProvider = Provider<PushService>(
  (ref) => createPushService(enabled: ref.watch(appEnvProvider).pushEnabled),
);
