import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/location/location_service.dart';
import 'package:proyekkas/features/app_config/application/app_config_providers.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/attendance/application/attendance_providers.dart';
import 'package:proyekkas/features/attendance/application/attendance_service.dart';
import 'package:proyekkas/features/attendance/data/attendance_api.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/attendance/domain/attendance_recap.dart';
import 'package:proyekkas/features/attendance/presentation/attendance_screen.dart';
import 'package:proyekkas/features/attendance/presentation/on_behalf_screen.dart';
import 'package:proyekkas/features/attendance/presentation/recap_view.dart';
import 'package:proyekkas/features/attendance/presentation/team_view.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';

import '../support/e4_e6_fixtures.dart';
import '../support/widget_harness.dart';

/// E6 APK screens: hub tabs per role, monthly recap calendar, team today + correction, PM on-behalf and the
/// cost-center geofence feedback. Services/APIs are fakes (no I/O in the widget zone).
const _cc = ProjectSite(id: 3, label: 'Ops Palangka', lat: -2.2, lng: 113.9, radiusM: 80, kind: SiteKind.costCenter);
const _project = ProjectSite(id: 7, label: 'P-07 — Gudang Contoh', lat: -2.21, lng: 113.91, radiusM: 100);

class FakeAttendanceApi extends Fake implements AttendanceApi {
  final corrections = <(int, String, String)>[];
  @override
  Future<void> correct(
    int attendanceId, {
    required String newTimeUtc,
    required String reason,
    required String idempotencyKey,
  }) async => corrections.add((attendanceId, newTimeUtc, reason));
}

class FakeOnBehalfService extends Fake implements AttendanceService {
  final calls =
      <({int employee, AttendanceKind kind, ProjectSite site, CameraLens lens, String reason, bool online})>[];
  @override
  Future<String> recordOnBehalf({
    required String sub,
    required int employeeId,
    required AttendanceKind kind,
    required ProjectSite site,
    required LocationFix fix,
    required Uint8List rawPhoto,
    required CameraLens lens,
    required String reason,
    required bool online,
  }) async {
    calls.add((employee: employeeId, kind: kind, site: site, lens: lens, reason: reason, online: online));
    return 'op';
  }
}

AuthSignedIn _as(Set<Role> roles) => AuthSignedIn(profile: profile(roles), sub: 'user-sub-1');

void main() {
  group('hub tabs by role', () {
    Future<void> pumpHub(WidgetTester tester, Set<Role> roles) => pumpScreen(
      tester,
      const AttendanceScreen(),
      auth: _as(roles),
      overrides: [
        appConfigProvider.overrideWith((ref) async => const AppConfig(syncAttendance: true)),
        attendanceSitesProvider.overrideWith((ref) async => const [_project, _cc]),
        attendanceItemsProvider.overrideWith((ref) => Stream.value(const [])),
        attendanceRecapProvider.overrideWith((ref, key) async => AttendanceRecap.fromJson(recapJson())),
        teamTodayProvider.overrideWith((ref, date) async => TeamToday.fromJson(teamTodayJson())),
      ],
    );

    testWidgets('Staff: Absen + Rekap only', (tester) async {
      await pumpHub(tester, {Role.staff});
      expect(find.byKey(const Key('attendance-tab-check')), findsOneWidget);
      expect(find.byKey(const Key('attendance-tab-recap')), findsOneWidget);
      expect(find.byKey(const Key('attendance-tab-team')), findsNothing);
    });

    testWidgets('PM: Absen + Rekap + Tim', (tester) async {
      await pumpHub(tester, {Role.pm});
      expect(find.byKey(const Key('attendance-tab-team')), findsOneWidget);
      await tester.tap(find.byKey(const Key('attendance-tab-team')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('team-member-45')), findsOneWidget);
    });

    testWidgets('Direktur: team view only (no own attendance)', (tester) async {
      await pumpHub(tester, {Role.owner});
      expect(find.byType(TabBar), findsNothing);
      expect(find.byKey(const Key('team-member-44')), findsOneWidget);
    });

    testWidgets('cost center as location: distance card with radius, then check-in enabled', (tester) async {
      await pumpScreen(
        tester,
        const AttendanceScreen(),
        overrides: [
          appConfigProvider.overrideWith((ref) async => const AppConfig(syncAttendance: true)),
          attendanceSitesProvider.overrideWith((ref) async => const [_cc]),
          attendanceItemsProvider.overrideWith((ref) => Stream.value(const [])),
          locationServiceProvider.overrideWithValue(
            FixedLocationService(const LocationFix(lat: -2.2003, lng: 113.9, accuracyM: 6, isMocked: false)),
          ),
        ],
      );
      expect(find.text('Pusat biaya · radius 80 m'), findsOneWidget);
      await tester.tap(find.byKey(const Key('attendance-check-distance')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('attendance-distance')), findsOneWidget);
      expect(find.text('Di dalam area absen'), findsOneWidget);
      expect(find.text('33 m'), findsOneWidget);
      expect(find.textContaining('Radius 80 m + toleransi GPS 6 m'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.byKey(const Key('attendance-checkIn'))).onPressed, isNotNull);
    });
  });

  group('recap', () {
    testWidgets('totals, calendar cells with status + time, day sheet with late / on-behalf / corrected', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        const Scaffold(body: RecapView(initialMonth: '2026-09')),
        overrides: [attendanceRecapProvider.overrideWith((ref, key) async => AttendanceRecap.fromJson(recapJson()))],
      );
      expect(find.text('September 2026'), findsOneWidget);
      expect(find.text('2/3'), findsOneWidget);
      expect(find.text('8 j 43 m'), findsOneWidget);
      expect(find.text('Jadwal Kantor: 08:00–17:00, toleransi 10 menit'), findsOneWidget);
      expect(find.byKey(const Key('recap-day-2026-09-01')), findsOneWidget);
      expect(find.text('08:22'), findsOneWidget);
      expect(find.text('Tidak hadir'), findsWidgets);
      await tester.tap(find.byKey(const Key('recap-day-2026-09-01')));
      await tester.pumpAndSettle();
      expect(find.text('Terlambat 12 menit'), findsOneWidget);
      expect(find.text('Masuk 08:22 · Pulang 17:05'), findsOneWidget);
      expect(find.textContaining('Absen masuk: 08.22'), findsOneWidget);
      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('recap-day-2026-09-03')));
      await tester.pumpAndSettle();
      expect(find.text('Diabsenkan oleh PM: Doni Pratama'), findsOneWidget);
      expect(find.text('Jam absen dikoreksi (T10).'), findsOneWidget);
    });

    testWidgets('month switcher: next is disabled on the current month, previous goes back', (tester) async {
      final asked = <String?>[];
      await pumpScreen(
        tester,
        const Scaffold(body: RecapView()),
        overrides: [
          attendanceRecapProvider.overrideWith((ref, key) async {
            asked.add(key.$2);
            return AttendanceRecap.fromJson(recapJson());
          }),
        ],
      );
      expect(tester.widget<IconButton>(find.byKey(const Key('recap-next'))).onPressed, isNull);
      await tester.tap(find.byKey(const Key('recap-prev')));
      await tester.pumpAndSettle();
      expect(asked, hasLength(2));
      expect(asked.last, shiftMonth(monthOf(DateTime.now()), -1));
    });
  });

  group('team today (PM)', () {
    late FakeAttendanceApi api;
    setUp(() => api = FakeAttendanceApi());

    Future<void> pumpTeam(WidgetTester tester, {bool attendanceOn = true, Set<Role> roles = const {Role.pm}}) =>
        pumpScreen(
          tester,
          const Scaffold(body: TeamTodayView()),
          auth: _as(roles),
          overrides: [
            appConfigProvider.overrideWith((ref) async => AppConfig(syncAttendance: attendanceOn)),
            teamTodayProvider.overrideWith((ref, date) async => TeamToday.fromJson(teamTodayJson())),
            attendanceApiProvider.overrideWithValue(api),
          ],
        );

    testWidgets('members with status; filter; absenkan only while not finished; correction with reason', (
      tester,
    ) async {
      await pumpTeam(tester);
      expect(find.text('Semua 3'), findsOneWidget);
      expect(find.byKey(const Key('team-absenkan-44')), findsOneWidget);
      expect(find.text('Absenkan masuk'), findsOneWidget);
      expect(find.byKey(const Key('team-absenkan-45')), findsOneWidget);
      expect(find.text('Absenkan pulang'), findsOneWidget);
      expect(find.byKey(const Key('team-absenkan-46')), findsNothing);
      expect(find.text('Oleh PM'), findsOneWidget);
      await tester.tap(find.byKey(const Key('team-filter-hadir')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('team-member-44')), findsNothing);
      expect(find.byKey(const Key('team-member-45')), findsOneWidget);

      await tester.tap(find.byKey(const Key('team-correct-9101')));
      await tester.pumpAndSettle();
      expect(find.text('Koreksi jam masuk'), findsOneWidget);
      expect(find.text('Tercatat: 26 Sep 2026 07.58'), findsOneWidget);
      await tester.tap(find.byKey(const Key('correction-save')));
      await tester.pumpAndSettle();
      expect(find.text('Wajib diisi (minimal 3 karakter).'), findsOneWidget);
      expect(api.corrections, isEmpty);
      await tester.enterText(find.byKey(const Key('correction-reason')), 'Lupa absen, datang 07.58');
      await tester.tap(find.byKey(const Key('correction-save')));
      await tester.pumpAndSettle();
      expect(api.corrections.single.$1, 9101);
      expect(api.corrections.single.$2, '2026-09-25T23:58:00.000Z', reason: 'same local date, WITA → UTC');
      expect(api.corrections.single.$3, 'Lupa absen, datang 07.58');
      expect(find.text('Koreksi absensi tersimpan.'), findsOneWidget);
    });

    testWidgets('flag off: no on-behalf actions, corrections stay available (online endpoint)', (tester) async {
      await pumpTeam(tester, attendanceOn: false);
      expect(find.byKey(const Key('team-absenkan-44')), findsNothing);
      expect(find.byKey(const Key('team-on-behalf')), findsNothing);
      expect(find.byKey(const Key('team-correct-9101')), findsOneWidget);
    });

    testWidgets('Finance sees the team but has no PM actions', (tester) async {
      await pumpTeam(tester, roles: {Role.finance});
      expect(find.byKey(const Key('team-member-44')), findsOneWidget);
      expect(find.byKey(const Key('team-absenkan-44')), findsNothing);
      expect(find.byKey(const Key('team-correct-9101')), findsNothing);
    });
  });

  group('on-behalf (US-14)', () {
    late FakeOnBehalfService service;
    late FixedLocationService location;
    late List<CameraLens> lenses;
    setUp(() {
      service = FakeOnBehalfService();
      location = FixedLocationService(const LocationFix(lat: -2.2003, lng: 113.9, accuracyM: 6, isMocked: false));
      lenses = [];
    });

    Future<void> pumpOnBehalf(WidgetTester tester, {bool enabled = true, bool online = false}) => pumpScreen(
      tester,
      const OnBehalfScreen(employeeId: 44),
      auth: _as({Role.pm}),
      online: online,
      overrides: [
        appConfigProvider.overrideWith((ref) async => AppConfig(syncAttendance: enabled)),
        onBehalfCandidatesProvider.overrideWith(
          (ref) async => const [
            OnBehalfCandidate(employeeId: 44, name: 'Budi Contoh', sites: [_cc, _project]),
          ],
        ),
        attendanceServiceProvider.overrideWithValue(service),
        locationServiceProvider.overrideWithValue(location),
        onBehalfCaptureProvider.overrideWithValue((context, title, lens) async {
          lenses.add(lens);
          return Uint8List.fromList([1, 2, 3]);
        }),
      ],
    );

    testWidgets('reason required; front camera chosen; queued offline with the PM GPS', (tester) async {
      await pumpOnBehalf(tester);
      expect(find.text('Budi Contoh'), findsOneWidget);
      expect(find.text('Pusat biaya · Ops Palangka'), findsOneWidget);
      await tester.tap(find.byKey(const Key('on-behalf-submit')));
      await tester.pumpAndSettle();
      expect(find.text('Wajib diisi (minimal 3 karakter).'), findsOneWidget);
      expect(location.calls, 0);
      await tester.enterText(find.byKey(const Key('on-behalf-reason')), 'Tidak punya HP');
      await tester.tap(find.text('Depan'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('on-behalf-submit')));
      await tester.pumpAndSettle();
      expect(lenses, [CameraLens.front]);
      final c = service.calls.single;
      expect(c.employee, 44);
      expect(c.kind, AttendanceKind.checkIn);
      expect(c.site.key, 'c3');
      expect(c.lens, CameraLens.front);
      expect(c.reason, 'Tidak punya HP');
      expect(c.online, isFalse);
      expect(find.textContaining('Absen Budi Contoh tersimpan di HP (offline)'), findsOneWidget);
    });

    testWidgets('outside the radius: no photo, nothing queued, distance + radius shown', (tester) async {
      location.fix = const LocationFix(lat: -2.203, lng: 113.9, accuracyM: 5, isMocked: false);
      await pumpOnBehalf(tester);
      await tester.enterText(find.byKey(const Key('on-behalf-reason')), 'HP rusak');
      await tester.tap(find.byKey(const Key('on-behalf-submit')));
      await tester.pumpAndSettle();
      expect(lenses, isEmpty);
      expect(service.calls, isEmpty);
      expect(find.textContaining('di luar radius lokasi (334 m dari titik, radius 80 m)'), findsOneWidget);
    });

    testWidgets('switched off by the server: submit disabled with the notice', (tester) async {
      await pumpOnBehalf(tester, enabled: false);
      expect(find.textContaining('belum diaktifkan Admin'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.byKey(const Key('on-behalf-submit'))).onPressed, isNull);
    });
  });
}
