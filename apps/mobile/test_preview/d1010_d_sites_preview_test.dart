// ADR 0023 (DRMS 10/10 Phase D) visual preview WITHOUT a device: sites (kantor cabang) on the APK — the attendance
// location picker (home site first with the "Penempatan" badge, picker opened), "Diabsenkan PM" at a site, the project
// detail with its site and the profile with "Site penempatan". 390×844 logical px, light and dark, bundled fonts.
//
// Not part of CI (outside test/). Run by hand:
//   flutter test test_preview/d1010_d_sites_preview_test.dart --dart-define=PK_SHOTS_DIR=/some/dir
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
import 'package:proyekkas/app/theme.dart';
import 'package:proyekkas/core/connectivity/connectivity_controller.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/features/app_config/application/app_config_providers.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/attendance/application/attendance_service.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/attendance/presentation/attendance_screen.dart';
import 'package:proyekkas/features/attendance/presentation/on_behalf_screen.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/privacy/application/privacy_providers.dart';
import 'package:proyekkas/features/projects/application/projects_providers.dart';
import 'package:proyekkas/features/projects/data/projects_api.dart';
import 'package:proyekkas/features/projects/domain/project.dart';
import 'package:proyekkas/features/projects/presentation/project_detail_screen.dart';
import 'package:proyekkas/features/settings/presentation/profile_screen.dart';
import 'package:proyekkas/features/sync/application/sync_coordinator.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../test/support/d1010_c_fixtures.dart';
import '../test/support/harness.dart';
import '../test/support/widget_harness.dart' show FakeAuth, FakeConnectivity, profile;

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

Future<void> _shot(
  WidgetTester tester, {
  required String name,
  required Brightness brightness,
  required Widget child,
  List<Override> overrides = const [],
  Future<void> Function(WidgetTester tester)? act,
  UserProfile? user,
}) async {
  debugDisableShadows = false;
  await initializeDateFormatting('id');
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final db = memoryDb();
  final key = GlobalKey();
  await tester.pumpWidget(
    ProviderScope(
      retry: (_, _) => null,
      overrides: [
        appEnvProvider.overrideWithValue(testEnv('https://example.test')),
        secureStoreProvider.overrideWithValue(MemorySecureStore()),
        deviceIdentityProvider.overrideWithValue(testDevice()),
        databaseProvider.overrideWithValue(db),
        connectivityProvider.overrideWith(() => FakeConnectivity(true)),
        authControllerProvider.overrideWith(
          () => FakeAuth(AuthSignedIn(profile: user ?? profile({Role.staff}), sub: 'preview-sub')),
        ),
        appConfigProvider.overrideWith((ref) async => const AppConfig(syncAttendance: true)),
        attendanceBlockedByPrivacyProvider.overrideWithValue(false),
        outboxCountsProvider.overrideWith((ref) => Stream.value(const OutboxCounts())),
        ...overrides,
      ],
      child: RepaintBoundary(
        key: key,
        child: MaterialApp(
          theme: buildTheme(Brightness.light),
          darkTheme: buildTheme(Brightness.dark),
          themeMode: brightness == Brightness.dark ? ThemeMode.dark : ThemeMode.light,
          locale: const Locale('id'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          debugShowCheckedModeBanner: false,
          home: child,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  if (act != null) {
    await act(tester);
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
  debugDisableShadows = true;
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump(const Duration(milliseconds: 50));
  await db.close();
}

const _home = ProjectSite(
  id: 2,
  label: 'BPN — Cabang Balikpapan',
  lat: -1.2654,
  lng: 116.8312,
  radiusM: 120,
  kind: SiteKind.site,
  companyId: 1,
  home: true,
);
const _assigned = ProjectSite(
  id: 5,
  label: 'KDI — Cabang Kendari',
  lat: -3.99,
  lng: 122.51,
  radiusM: 100,
  kind: SiteKind.site,
  companyId: 1,
  assigned: true,
);
const _project = ProjectSite(
  id: 9,
  label: 'PRJ-09 — Jalan Tambang Blok B',
  lat: -1.27,
  lng: 116.84,
  radiusM: 150,
  companyId: 1,
);
const _cc = ProjectSite(
  id: 3,
  label: 'OPS-PB — Ops Palangka Banjar',
  lat: -2.2,
  lng: 113.9,
  radiusM: 80,
  kind: SiteKind.costCenter,
  companyId: 1,
);

OutboxData _item(String status, Map<String, Object> payload, {int? siteId}) => OutboxData(
  opUuid: 'op-$status-$siteId',
  userSub: 'preview-sub',
  siteId: siteId,
  type: 'attendance.check_in',
  targetUuid: 'op-$status',
  payloadJson: '{"site_id":${siteId ?? 0}}',
  dependsOnJson: '[]',
  deviceTime: '2026-10-11T07:52:10+08:00',
  elapsedMs: 1,
  bootId: 'b-1',
  offline: false,
  status: status,
  attempts: 0,
  createdAt: DateTime(2026, 10, 11, 7, 52),
);

class _SiteProjectsApi extends FakeProjectsApi {
  @override
  Future<ProjectDetail> detail(int id) async => projectDetailFromJson({
    ...projectDetailJson(),
    'site': {'id': 2, 'code': 'BPN', 'name': 'Cabang Balikpapan'},
  });
}

void main() {
  setUpAll(_loadFonts);

  for (final b in Brightness.values) {
    testWidgets('attendance picker with sites (${b.name})', (tester) async {
      final over = <Override>[
        attendanceSitesProvider.overrideWith((ref) async => const [_home, _assigned, _project, _cc]),
        attendanceItemsProvider.overrideWith((ref) => Stream.value([_item('applied', const {}, siteId: 2)])),
      ];
      await _shot(tester, name: 'd-attendance-sites', brightness: b, child: const AttendanceScreen(), overrides: over);
      await _shot(
        tester,
        name: 'd-attendance-sites-open',
        brightness: b,
        child: const AttendanceScreen(),
        overrides: over,
        act: (t) => t.tap(find.byKey(const Key('attendance-project'))),
      );
    });

    testWidgets('on-behalf at a site (${b.name})', (tester) async {
      await _shot(
        tester,
        name: 'd-on-behalf-site',
        brightness: b,
        user: profile({Role.pm}),
        child: const OnBehalfScreen(employeeId: 44),
        overrides: [
          onBehalfCandidatesProvider.overrideWith(
            (ref) async => const [
              OnBehalfCandidate(employeeId: 44, name: 'Budi Contoh', sites: [_home, _project]),
            ],
          ),
        ],
      );
    });

    testWidgets('project detail with site (${b.name})', (tester) async {
      await _shot(
        tester,
        name: 'd-project-site',
        brightness: b,
        user: profile({Role.pm}),
        child: const ProjectDetailScreen(id: 9),
        overrides: [projectsApiProvider.overrideWithValue(_SiteProjectsApi()..totalPages = 1)],
      );
    });

    testWidgets('profile with site penempatan (${b.name})', (tester) async {
      await _shot(
        tester,
        name: 'd-profile-site',
        brightness: b,
        user: profile({Role.staff}).copyWith(
          employee: const Employee(
            id: 12,
            code: 'E12',
            name: 'Doni Pratama',
            homeSiteId: 2,
            homeSiteLabel: 'BPN — Cabang Balikpapan',
          ),
        ),
        child: const ProfileScreen(),
      );
    });
  }
}
