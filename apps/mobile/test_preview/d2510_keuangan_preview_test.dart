// D2510 keuangan (requests, approvals, Finance, addenda) visual preview WITHOUT a device — same harness as
// screens_preview_test.dart (ADR 0015 refresh preview): pumps the real router + screens with fake
// providers and the bundled fonts, 390×844 logical px, light and dark, and writes PNGs.
//
// Not part of CI (lives outside test/, so `flutter test` does not pick it up). Run by hand:
//   flutter test test_preview/screens_preview_test.dart --dart-define=PK_SHOTS_DIR=/some/dir
// The PNGs are review material only and are not committed.
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/app/router.dart';
import 'package:proyekkas/app/theme.dart';
import 'package:proyekkas/core/config/app_env.dart';
import 'package:proyekkas/core/connectivity/connectivity_controller.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/features/addendum/domain/addendum.dart';
import 'package:proyekkas/features/addendum/presentation/addendum_providers.dart';
import 'package:proyekkas/features/app_config/application/app_config_providers.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/features/attendance/application/attendance_providers.dart';
import 'package:proyekkas/features/attendance/application/attendance_service.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/attendance/domain/attendance_recap.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/dashboard/domain/dashboard.dart';
import 'package:proyekkas/features/dashboard/presentation/kpi_home.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/presentation/history_screen.dart';
import 'package:proyekkas/features/home/presentation/home_screen.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/features/notifications/application/notifications_providers.dart';
import 'package:proyekkas/features/notifications/domain/app_notification.dart';
import 'package:proyekkas/features/progress/application/progress_providers.dart';
import 'package:proyekkas/features/progress/domain/progress.dart';
import 'package:proyekkas/features/sync/application/sync_coordinator.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../test/support/e4_e6_fixtures.dart';
import '../test/support/fixtures.dart';
import '../test/support/harness.dart';
import '../test/support/widget_harness.dart' show FakeAuth, FakeConnectivity, profile;
import '../test/widget/e1_e3_screens_test.dart' as e1 show FakeExpenseApi, inboxPage;

const _dir = String.fromEnvironment('PK_SHOTS_DIR', defaultValue: 'build/preview-shots');

Future<void> _loadFonts() async {
  Future<ByteData> asset(String p) => rootBundle.load(p);
  final sg = FontLoader('SpaceGrotesk')
    ..addFont(asset('assets/fonts/SpaceGrotesk-SemiBold.ttf'))
    ..addFont(asset('assets/fonts/SpaceGrotesk-Bold.ttf'));
  final dm = FontLoader('DMSans')
    ..addFont(asset('assets/fonts/DMSans-Regular.ttf'))
    ..addFont(asset('assets/fonts/DMSans-Medium.ttf'))
    ..addFont(asset('assets/fonts/DMSans-Bold.ttf'));
  final root = Platform.environment['FLUTTER_ROOT']!;
  final icons = FontLoader('MaterialIcons')
    ..addFont(
      File('$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf')
          .readAsBytes()
          .then((b) => ByteData.view(b.buffer)),
    );
  await Future.wait([sg.load(), dm.load(), icons.load()]);
}

const _site = ProjectSite(id: 7, label: 'P-07 — Gudang Contoh', lat: -2.21, lng: 113.91, radiusM: 100);
const _cc = ProjectSite(id: 3, label: 'Ops Palangka', lat: -2.2, lng: 113.9, radiusM: 80, kind: SiteKind.costCenter);

Future<void> _shot(
  WidgetTester tester, {
  required String name,
  required Brightness brightness,
  required Set<Role> roles,
  String location = '/home',
  bool signedIn = true,
  String? showKey,
  List<Override> overrides = const [],
  AuthController Function()? authController,
  Future<void> Function(WidgetTester tester)? act,
  AppConfig appConfig = const AppConfig(syncAttendance: true),
  List<Addendum> addendumInbox = const [],
}) async {
  // flutter_test paints shadows as solid black outlines unless this is off.
  debugDisableShadows = false;
  await initializeDateFormatting('id');
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final db = memoryDb();
  final key = GlobalKey();
  final auth = signedIn
      ? AuthSignedIn(profile: profile(roles), sub: 'preview-sub')
      : const AuthSignedOut() as AuthState;
  late ProviderContainer container;
  await tester.pumpWidget(
    ProviderScope(
      retry: (_, _) => null,
      overrides: [
        appEnvProvider.overrideWithValue(
          AppEnv(
            flavor: 'staging',
            apiBaseUrl: 'https://example.test',
            oidcIssuer: 'https://example.test/realms/drms-staging',
            oidcClientId: 'proyekkas-mobile',
            oidcRedirectUri: 'https://example.test/app/callback',
            pushEnabled: false,
            loginMode: LoginMode.password,
          ),
        ),
        secureStoreProvider.overrideWithValue(MemorySecureStore()),
        deviceIdentityProvider.overrideWithValue(testDevice()),
        databaseProvider.overrideWithValue(db),
        connectivityProvider.overrideWith(() => FakeConnectivity(true)),
        authControllerProvider.overrideWith(authController ?? () => FakeAuth(auth)),
        appConfigProvider.overrideWith((ref) async => appConfig),
        integrityReportProvider.overrideWith((ref) async => null),
        notificationsProvider.overrideWith((ref) async => const NotificationPage([], 3, null)),
        outboxCountsProvider.overrideWith((ref) => Stream.value(const OutboxCounts())),
        openProgressDraftsProvider.overrideWith((ref) => Stream.value(const <ProgressDraft>[])),
        projectProgressProvider.overrideWith((ref) async => ProjectProgressList.fromJson(projectProgressJson())),
        addendumInboxProvider.overrideWith((ref) async => addendumInbox),
        direkturDashboardProvider.overrideWith((ref) async => DirekturDashboard.fromJson(direkturDashboardJson())),
        pmDashboardProvider.overrideWith((ref) async => PmDashboard.fromJson(pmDashboardJson())),
        inboxProvider.overrideWith((ref) async => e1.inboxPage()),
        expenseApiProvider.overrideWithValue(e1.FakeExpenseApi()),
        // B-2 integration: the current ADR 0021 snapshot (legacy wording only for legacy snapshots)
        requestDetailProvider(42).overrideWith(
          (ref) async => detailFromJson(pmDetailJson(status: 'pending_approval', allowed: const ['approve', 'reject'])),
        ),
        attendanceSitesProvider.overrideWith((ref) async => const [_site, _cc]),
        attendanceItemsProvider.overrideWith((ref) => Stream.value(const [])),
        attendanceRecapProvider.overrideWith((ref, key) async => AttendanceRecap.fromJson(recapJson())),
        teamTodayProvider.overrideWith((ref, date) async => TeamToday.fromJson(teamTodayJson())),
        progressReportsProvider.overrideWith(
          (ref, project) async => ProgressReportPage.fromJson({
            'items': [progressReportJson()],
          }),
        ),
        progressProjectsProvider.overrideWith(
          (ref) async => const [
            MasterItem(7, 'P-07 — Gudang Contoh', code: 'P-07', extra: {'status': 'berjalan'}),
          ],
        ),
        progressPhotoProvider.overrideWith((ref, key) async => throw const NetworkException()),
        ...overrides,
      ],
      child: Consumer(
        builder: (context, ref, _) {
          container = ProviderScope.containerOf(context);
          return RepaintBoundary(
            key: key,
            child: MaterialApp.router(
              theme: buildTheme(Brightness.light),
              darkTheme: buildTheme(Brightness.dark),
              themeMode: brightness == Brightness.dark ? ThemeMode.dark : ThemeMode.light,
              routerConfig: ref.watch(routerProvider),
              locale: const Locale('id'),
              supportedLocales: AppLocalizations.supportedLocales,
              localizationsDelegates: const [
                AppLocalizations.delegate,
                GlobalMaterialLocalizations.delegate,
                GlobalWidgetsLocalizations.delegate,
                GlobalCupertinoLocalizations.delegate,
              ],
              debugShowCheckedModeBanner: false,
            ),
          );
        },
      ),
    ),
  );
  await tester.pumpAndSettle();
  if (location != '/home') {
    container.read(routerProvider).go(location);
    await tester.pumpAndSettle();
  }
  if (act != null) {
    await act(tester);
    await tester.pumpAndSettle();
  }
  if (showKey != null) {
    // Bring that widget to the middle of the viewport (launcher tiles below the KPI section).
    final list = find.descendant(of: find.byType(HomeScreen), matching: find.byType(Scrollable)).first;
    // Jump (not drag: the KPI charts own horizontal/vertical drags) until the tile is built, then centre it.
    final position = tester.state<ScrollableState>(list).position;
    while (find.byKey(Key(showKey)).evaluate().isEmpty && position.pixels < position.maxScrollExtent) {
      position.jumpTo(position.pixels + 300);
      await tester.pump();
    }
    await Scrollable.ensureVisible(tester.element(find.byKey(Key(showKey))), alignment: 0.5);
    await tester.pumpAndSettle();
  }
  final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(key));
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 2);
    final png = await image.toByteData(format: ui.ImageByteFormat.png);
    final f = File('$_dir/$name-${brightness.name}.png');
    f.parent.createSync(recursive: true);
    f.writeAsBytesSync(png!.buffer.asUint8List());
  });
  debugDisableShadows = true; // restored before the binding checks its debug invariants
  // Unmount before the in-memory DB closes (drift stream timers).
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump(const Duration(milliseconds: 50));
  await db.close();
}

const _history = [
  HistoryEntry(
    serverTime: '2026-09-20T02:01:00Z',
    action: 'create',
    docType: 'expense_request',
    userName: 'Citra',
    source: 'apk',
    appVersion: '0.12.0',
    deviceId: 'a1b2c3d4e5f6',
  ),
  HistoryEntry(
    serverTime: '2026-09-20T03:15:00Z',
    action: 'status_change',
    docType: 'expense_request',
    statusFrom: 'draft',
    statusTo: 'pending_approval',
    userName: 'Citra',
    source: 'apk',
  ),
  HistoryEntry(
    serverTime: '2026-09-21T01:00:00Z',
    action: 'reject',
    docType: 'receipt',
    docNo: '7654321',
    reason: 'Nota buram, mohon foto ulang',
    userName: 'Dedi Direktur',
    source: 'web',
  ),
];

void main() {
  setUpAll(_loadFonts);

  final approved = Addendum.fromJson(addendumJson(status: 'approved', step: null, actions: const []));
  final pending = Addendum.fromJson(addendumJson());
  final shots = <(String, Set<Role>, String, List<Override>, Future<void> Function(WidgetTester)?)>[
    ('k-requests-team', {Role.pm}, '/requests?tab=team', const [], null),
    (
      'k-history',
      {Role.staff},
      '/requests/42/history',
      [requestHistoryProvider(42).overrideWith((ref) async => _history)],
      null,
    ),
    ('k-inbox-addendum', {Role.owner}, '/inbox', const [], null),
    (
      'k-addenda',
      {Role.pm},
      '/addenda',
      [
        addendumListProvider.overrideWith((ref) async => AddendumPage(items: [pending, approved])),
      ],
      null,
    ),
    (
      'k-addendum-detail',
      {Role.owner},
      '/addenda/61',
      [addendumDetailProvider(61).overrideWith((ref) async => approved)],
      null,
    ),
    (
      'k-request-detail-lines',
      {Role.staff},
      '/requests/42',
      const [],
      (tester) async {
        final list = find.byKey(const Key('detail-main'));
        await tester.drag(list, const Offset(0, -1400));
      },
    ),
    (
      'k-decision-approve',
      {Role.owner},
      '/requests/42',
      const [],
      (tester) => tester.tap(find.byKey(const Key('action-approve'))),
    ),
    (
      'k-decision-reject',
      {Role.owner},
      '/requests/42',
      const [],
      (tester) => tester.tap(find.byKey(const Key('action-reject'))),
    ),
  ];
  for (final (name, roles, location, overrides, act) in shots) {
    for (final b in Brightness.values) {
      testWidgets('$name ${b.name}', (tester) async {
        await _shot(
          tester,
          name: name,
          brightness: b,
          roles: roles,
          location: location,
          overrides: overrides,
          act: act,
          addendumInbox: name == 'k-inbox-addendum' ? [pending] : const [],
        );
      });
    }
  }
}
