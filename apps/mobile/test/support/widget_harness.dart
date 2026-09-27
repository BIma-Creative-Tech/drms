import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/config/app_env.dart';
import 'package:proyekkas/core/connectivity/connectivity_controller.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/addendum/domain/addendum.dart';
import 'package:proyekkas/features/addendum/presentation/addendum_providers.dart';
import 'package:proyekkas/features/progress/application/progress_providers.dart';
import 'package:proyekkas/features/progress/domain/progress.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import 'harness.dart';

class FakeConnectivity extends ConnectivityController {
  FakeConnectivity(this.initial);
  final bool initial;
  @override
  bool build() => initial;

  /// No platform channel and no health-probe timers in widget tests.
  @override
  void reportServerReachable(bool ok) => state = ok;

  @override
  Future<bool> recheck() async => state;
}

class FakeAuth extends AuthController {
  FakeAuth(this.initial);
  final AuthState initial;
  @override
  AuthState build() => initial;
}

UserProfile profile(Set<Role> roles) => UserProfile(
  id: 5,
  email: 'doni@example.test',
  name: 'Doni Pratama',
  roles: roles,
  capabilities: Capabilities.fromRoles(roles),
  employee: const Employee(id: 12, code: 'E12', name: 'Doni Pratama'),
);

Future<void> pumpScreen(
  WidgetTester tester,
  Widget child, {
  bool online = true,
  AuthState? auth,
  List<Override> overrides = const [],
  AppEnv? env,
  AuthController Function()? authController,
  bool stubProgress = true,
}) async {
  await initializeDateFormatting('id');
  tester.view.physicalSize = const Size(1200, 3200);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final db = memoryDb();
  addTearDown(db.close);
  await tester.pumpWidget(
    ProviderScope(
      retry: (_, _) => null,
      overrides: [
        appEnvProvider.overrideWithValue(env ?? testEnv('https://example.test')),
        secureStoreProvider.overrideWithValue(MemorySecureStore()),
        deviceIdentityProvider.overrideWithValue(testDevice()),
        databaseProvider.overrideWithValue(db),
        connectivityProvider.overrideWith(() => FakeConnectivity(online)),
        authControllerProvider.overrideWith(
          authController ?? () => FakeAuth(auth ?? AuthSignedIn(profile: profile({Role.staff}), sub: 'user-sub-1')),
        ),
        // E4: the home reads local progress drafts (drift stream) and /projects/progress; stubbed so tests
        // that do not care stay free of DB timers and network.
        if (stubProgress) ...[
          openProgressDraftsProvider.overrideWith((ref) => Stream.value(const <ProgressDraft>[])),
          projectProgressProvider.overrideWith((ref) async => throw const NetworkException()),
          addendumInboxProvider.overrideWith((ref) async => const <Addendum>[]),
        ],
        ...overrides,
      ],
      child: MaterialApp(
        locale: const Locale('id'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: child,
      ),
    ),
  );
  await tester.pumpAndSettle();
}
