// D2510 APK UI restyle, group "lapangan" (Absensi, Laporan Lapangan, Progress): visual preview WITHOUT a device.
// Pumps the real screens with fake providers and the bundled fonts, 390×844 logical px, light and dark.
//
// Not part of CI (outside test/). Run by hand or by the `mobile-preview` workflow:
//   flutter test test_preview/d2510_lapangan_preview_test.dart --dart-define=PK_SHOTS_DIR=/some/dir
import 'dart:io';
import 'dart:typed_data';
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
import 'package:proyekkas/core/format/dates.dart';
import 'package:proyekkas/core/location/location_service.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/features/app_config/application/app_config_providers.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/attendance/application/attendance_providers.dart';
import 'package:proyekkas/features/attendance/application/attendance_service.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/attendance/domain/attendance_recap.dart';
import 'package:proyekkas/features/attendance/presentation/attendance_screen.dart';
import 'package:proyekkas/features/attendance/presentation/on_behalf_screen.dart';
import 'package:proyekkas/features/attendance/presentation/recap_view.dart';
import 'package:proyekkas/features/attendance/presentation/schedule_screen.dart';
import 'package:proyekkas/features/attendance/presentation/team_view.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/field_reports/application/field_providers.dart';
import 'package:proyekkas/features/field_reports/domain/field_models.dart';
import 'package:proyekkas/features/field_reports/domain/field_rules.dart' show timesheetMinDate;
import 'package:proyekkas/features/field_reports/presentation/aftersales_screen.dart';
import 'package:proyekkas/features/field_reports/presentation/field_hub_screen.dart';
import 'package:proyekkas/features/field_reports/presentation/service_report_screen.dart';
import 'package:proyekkas/features/field_reports/presentation/timesheet_screen.dart';
import 'package:proyekkas/features/field_reports/presentation/widgets/field_widgets.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/features/privacy/application/privacy_providers.dart';
import 'package:proyekkas/features/progress/application/progress_providers.dart';
import 'package:proyekkas/features/progress/domain/progress.dart';
import 'package:proyekkas/features/progress/presentation/progress_detail_screen.dart';
import 'package:proyekkas/features/progress/presentation/progress_editor_screen.dart';
import 'package:proyekkas/features/progress/presentation/progress_screen.dart';
import 'package:proyekkas/features/sync/application/sync_coordinator.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../test/support/e4_e6_fixtures.dart';
import '../test/support/harness.dart';
import '../test/support/widget_harness.dart' show FakeAuth, FakeConnectivity, profile;
import '../test/widget/field_reports_screens_test.dart'
    as fr
    show FakeFieldService, aftersalesProject, cu, dz01, ex01, ex02, fieldProfile, kontrak, serviceTypes, today;

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
        appConfigProvider.overrideWith((ref) async => const AppConfig(syncAttendance: true, syncProgressReports: true)),
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

// ---- attendance -------------------------------------------------------------------------------------------------

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

OutboxData _mark(String kind, DateTime at, String status, {bool offline = false}) => OutboxData(
  opUuid: 'op-$kind-${at.millisecondsSinceEpoch}',
  userSub: 'preview-sub',
  type: 'attendance.$kind',
  targetUuid: 'op-$kind',
  payloadJson: '{"project_id":9}',
  dependsOnJson: '[]',
  deviceTime: isoWithOffset(at),
  elapsedMs: 1,
  bootId: 'b-1',
  offline: offline,
  status: status,
  attempts: 0,
  createdAt: at,
);

List<Override> _attendance(List<OutboxData> items) => [
  attendanceSitesProvider.overrideWith((ref) async => const [_project, _cc]),
  attendanceItemsProvider.overrideWith((ref) => Stream.value(items)),
  // 22 m from the project point: the auto-detection picks it and shows the distance card
  locationServiceProvider.overrideWithValue(
    FixedLocationService(const LocationFix(lat: -1.2702, lng: 116.84, accuracyM: 6, isMocked: false)),
  ),
];

// ---- progress ---------------------------------------------------------------------------------------------------

const _projects = [
  MasterItem(7, 'P-07 — Gudang Contoh', code: 'P-07', extra: {'status': 'berjalan'}),
];

ProgressDraft _local(ProgressSyncState s, {String uuid = 'l-1', String? error}) => ProgressDraft(
  clientUuid: uuid,
  projectId: 7,
  projectLabel: 'P-07 — Gudang Contoh',
  stageId: 32,
  stageLabel: 'Struktur',
  pctBefore: 40,
  pctAfter: 55,
  work: 'Pengecoran kolom lantai 2',
  photoUuids: const ['ph-a'],
  syncState: s,
  lastError: error,
);

List<Override> _progress({List<ProgressDraft> local = const []}) => [
  openProgressDraftsProvider.overrideWith((ref) => Stream.value(local)),
  progressReportsProvider.overrideWith(
    (ref, project) async => ProgressReportPage.fromJson({
      'items': [progressReportJson(), progressReportJson(id: 502, editable: false)],
    }),
  ),
  progressProjectsProvider.overrideWith((ref) async => _projects),
  projectProgressProvider.overrideWith((ref) async => ProjectProgressList.fromJson(projectProgressJson())),
  progressPhotoProvider.overrideWith((ref, key) async => throw const NetworkException()),
  progressDetailProvider.overrideWith((ref, id) async => ProgressReport.fromJson(progressReportJson())),
  stageSetProvider.overrideWith((ref, id) async => ProjectStageSet.fromJson(stageSetJson())),
  localPhotoProvider.overrideWith((ref, uuid) async => null),
];

// ---- field reports ----------------------------------------------------------------------------------------------

List<Override> _field({List<FieldDraft> local = const []}) => [
  fieldServiceProvider.overrideWithValue(fr.FakeFieldService()),
  fieldTodayProvider.overrideWithValue(fr.today),
  fieldProjectsProvider.overrideWith((ref) async => const [fr.kontrak, fr.aftersalesProject]),
  fieldCacheRefreshProvider.overrideWith((ref) async => true),
  fieldUnitsProvider.overrideWith((ref, key) async => const [fr.ex01, fr.ex02, fr.dz01]),
  fieldContractUnitsProvider.overrideWith((ref, id) async => [fr.cu(fr.ex01), fr.cu(fr.ex02), fr.cu(fr.dz01)]),
  fieldTimesheetMarksProvider.overrideWith((ref, id) async => const []),
  fieldTimesheetMinDateProvider.overrideWith((ref, id) async => timesheetMinDate(fr.today, null)),
  openFieldDraftsProvider.overrideWith((ref) => Stream.value(local)),
  fieldClientsProvider.overrideWith((ref, c) async => const [FieldClient(id: 4, companyId: 3, name: 'CV Maju Jaya')]),
  fieldOpenPosProvider.overrideWith((ref, key) async => const []),
  aftersalesDayProvider.overrideWith(
    (ref, key) async => (
      today: [
        const FieldRecord(FieldReportType.aftersalesActivity, {
          'id': 3,
          'kind': 'penawaran',
          'client': {'id': 6, 'name': 'PT Kalteng Coal'},
          'docNo': 'Q-0388',
          'followUpDate': fr.today,
          'valueVisible': false,
        }),
      ],
      followUpsDue: 1,
    ),
  ),
  myFieldRecordsProvider.overrideWith(
    (ref) async => const [
      FieldRecord(FieldReportType.serviceReport, {
        'id': 77,
        'docNo': 'SR/2610/0012',
        'reportDate': fr.today,
        'project': {'id': 41, 'code': 'K-001', 'name': 'Sewa Kalteng Coal'},
        'unit': {'id': 9, 'label': 'EX-01'},
        'serviceTypes': [
          {'id': 7, 'name': 'Perbaikan'},
        ],
        'action': 'Ganti seal silinder bucket',
        'flags': ['OFFLINE'],
        'editable': true,
      }),
    ],
  ),
  fieldServiceTypesProvider.overrideWith((ref, c) async => c == 3 ? fr.serviceTypes : const <ServiceType>[]),
  fieldServiceTypeNamesProvider.overrideWith((ref) async => {for (final t in fr.serviceTypes) t.id: t.name}),
  fieldPhotoCaptureProvider.overrideWithValue((context, title) async => Uint8List.fromList([1, 2, 3])),
  localPhotoProvider.overrideWith((ref, uuid) async => null),
];

void main() {
  setUpAll(_loadFonts);

  final now = DateTime.now();
  final checkedIn = [
    _mark('check_in', now.subtract(const Duration(minutes: 3)), 'pending', offline: true),
    _mark('check_out', now.subtract(const Duration(days: 1, hours: -9)), 'applied'),
    _mark('check_in', now.subtract(const Duration(days: 1)), 'applied'),
  ];
  final done = [
    _mark('check_out', now.subtract(const Duration(minutes: 1)), 'applied'),
    _mark('check_in', now.subtract(const Duration(hours: 8)), 'applied'),
  ];

  for (final b in Brightness.values) {
    testWidgets('attendance check tab (${b.name})', (tester) async {
      await _shot(
        tester,
        name: 'lap-attendance-hadir',
        brightness: b,
        child: const AttendanceScreen(),
        overrides: _attendance(checkedIn),
      );
      await _shot(
        tester,
        name: 'lap-attendance-hadir-scrolled',
        brightness: b,
        child: const AttendanceScreen(),
        overrides: _attendance(checkedIn),
        act: (t) => t.drag(find.byType(ListView).first, const Offset(0, -700)),
      );
      await _shot(
        tester,
        name: 'lap-attendance-selesai',
        brightness: b,
        child: const AttendanceScreen(),
        overrides: _attendance(done),
      );
    });

    testWidgets('attendance recap + day sheet (${b.name})', (tester) async {
      final over = [attendanceRecapProvider.overrideWith((ref, key) async => AttendanceRecap.fromJson(recapJson()))];
      await _shot(
        tester,
        name: 'lap-recap',
        brightness: b,
        child: const Scaffold(body: RecapView(initialMonth: '2026-09')),
        overrides: over,
      );
      await _shot(
        tester,
        name: 'lap-recap-day',
        brightness: b,
        child: const Scaffold(body: RecapView(initialMonth: '2026-09')),
        overrides: over,
        act: (t) => t.tap(find.byKey(const Key('recap-day-2026-09-01'))),
      );
    });

    testWidgets('attendance team + on-behalf + schedule (${b.name})', (tester) async {
      await _shot(
        tester,
        name: 'lap-team',
        brightness: b,
        user: profile({Role.pm}),
        child: const Scaffold(body: TeamTodayView()),
        overrides: [teamTodayProvider.overrideWith((ref, date) async => TeamToday.fromJson(teamTodayJson()))],
      );
      await _shot(
        tester,
        name: 'lap-on-behalf',
        brightness: b,
        user: profile({Role.pm}),
        child: const OnBehalfScreen(employeeId: 44),
        overrides: [
          onBehalfCandidatesProvider.overrideWith(
            (ref) async => const [
              OnBehalfCandidate(employeeId: 44, name: 'Budi Contoh', sites: [_project, _cc]),
            ],
          ),
        ],
      );
      await _shot(
        tester,
        name: 'lap-schedule',
        brightness: b,
        user: profile({Role.pm}),
        child: const AttendanceScheduleScreen(),
        overrides: [attendanceScheduleProvider.overrideWith((ref, year) async => _schedule)],
      );
    });

    testWidgets('progress hub, detail, editor (${b.name})', (tester) async {
      final local = [
        _local(ProgressSyncState.queued),
        _local(ProgressSyncState.rejected, uuid: 'l-2', error: 'Tahapan sudah 100% di server.'),
      ];
      await _shot(
        tester,
        name: 'lap-progress-reports',
        brightness: b,
        user: profile({Role.pm}),
        child: const ProgressScreen(),
        overrides: _progress(local: local),
      );
      await _shot(
        tester,
        name: 'lap-progress-projects',
        brightness: b,
        user: profile({Role.pm}),
        child: const ProgressScreen(initialTab: 1),
        overrides: _progress(),
      );
      await _shot(
        tester,
        name: 'lap-progress-detail',
        brightness: b,
        user: profile({Role.pm}),
        child: const ProgressDetailScreen(id: 501),
        overrides: _progress(),
      );
      await _shot(
        tester,
        name: 'lap-progress-editor',
        brightness: b,
        user: profile({Role.pm}),
        child: ProgressEditorScreen(initial: _local(ProgressSyncState.local)),
        overrides: _progress(),
      );
    });

    testWidgets('field reports hub + forms (${b.name})', (tester) async {
      final user = fr.fieldProfile();
      final local = [
        const FieldDraft(
          clientUuid: 'q-1',
          type: FieldReportType.unitTimesheet,
          projectId: 41,
          projectLabel: 'K-001 — Sewa Kalteng Coal',
          reportDate: fr.today,
          content: TimesheetContent(unitId: 9, unitLabel: 'EX-01', hmStart: 1023, hmEnd: 1031),
          syncState: FieldSyncState.queued,
        ),
        const FieldDraft(
          clientUuid: 'r-1',
          type: FieldReportType.serviceReport,
          projectId: 41,
          projectLabel: 'K-001 — Sewa Kalteng Coal',
          reportDate: fr.today,
          content: ServiceContent(unitId: 9, unitLabel: 'EX-01'),
          syncState: FieldSyncState.rejected,
          lastError: 'HM lebih kecil dari HM terakhir unit.',
        ),
      ];
      await _shot(
        tester,
        name: 'lap-field-hub',
        brightness: b,
        user: user,
        child: const FieldHubScreen(),
        overrides: _field(local: local),
      );
      await _shot(
        tester,
        name: 'lap-field-history',
        brightness: b,
        user: user,
        child: const FieldHubScreen(initialTab: 1),
        overrides: _field(local: local),
      );
      await _shot(
        tester,
        name: 'lap-field-service',
        brightness: b,
        user: user,
        child: const ServiceReportScreen(projectId: 41, unitId: 9),
        overrides: _field(),
      );
      await _shot(
        tester,
        name: 'lap-field-timesheet',
        brightness: b,
        user: user,
        child: const TimesheetScreen(projectId: 41),
        overrides: _field(),
      );
      await _shot(
        tester,
        name: 'lap-field-aftersales',
        brightness: b,
        user: user,
        child: const AftersalesScreen(projectId: 52),
        overrides: _field(),
        act: (t) => t.drag(find.byType(ListView).first, const Offset(0, -900)),
      );
    });
  }
}

const _schedule = {
  'year': 2026,
  'today': '2026-10-19',
  'companyId': 1,
  'canWrite': true,
  'canCreate': true,
  'defaultScheduleId': 1,
  'defaultRadius': 100,
  'schedules': [
    {
      'id': 1,
      'name': 'Kantor',
      'start': '08:00',
      'end': '17:00',
      'tol': 15,
      'days': [1, 2, 3, 4, 5],
      'active': true,
      'used': 12,
    },
    {
      'id': 2,
      'name': 'Lapangan',
      'start': '07:00',
      'end': '16:00',
      'tol': 10,
      'days': [1, 2, 3, 4, 5, 6],
      'active': true,
      'used': 3,
    },
  ],
  'holidays': [
    {'id': 5, 'date': '2026-12-25', 'name': 'Natal'},
    {'id': 6, 'date': '2026-12-26', 'name': 'Cuti bersama Natal'},
  ],
  'costCenters': [
    {'id': 7, 'code': 'KTR', 'name': 'Kantor pusat', 'lat': -1.26, 'lng': 116.83, 'radiusM': 150, 'active': true},
    {'id': 8, 'code': 'WS', 'name': 'Workshop Banjar', 'lat': null, 'lng': null, 'active': true},
  ],
  'employees': [
    {'id': 9, 'code': 'E09', 'name': 'Budi Santoso', 'scheduleId': null},
    {'id': 10, 'code': 'E10', 'name': 'Sari Wulandari', 'scheduleId': 2},
  ],
};
