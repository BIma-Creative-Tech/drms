import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/location/location_service.dart';
import 'package:proyekkas/features/app_config/application/app_config_providers.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/attendance/application/attendance_service.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/attendance/presentation/attendance_screen.dart';

import '../support/widget_harness.dart';

/// DRMS 13/10 A2 + ADR 0032: the Absen tab recognises the area — the location whose geofence contains the GPS fix is
/// selected on open (nearest when several overlap, chips to pick another; none → manual picker with the nearest as a
/// hint); the attendance-type hint; Non-OnSite (DRMS 26/10) outside every registered location → NOT blocked: the
/// nearest one is used and the confirmation popup notes "Di luar area"; inside any → recorded there. The service is a
/// fake (no I/O in the widget zone). Fictional points.
const _office = ProjectSite(id: 2, label: 'P-02 — Proyek Kantor', lat: -1.2, lng: 116.8, radiusM: 100, companyId: 1);
const _ops = ProjectSite(
  id: 1,
  label: 'CC-1 — Ops Kantor Pusat',
  lat: -1.25,
  lng: 116.85,
  radiusM: 150,
  kind: SiteKind.costCenter,
  companyId: 1,
);
const _project = ProjectSite(id: 7, label: 'P-07 — Proyek Contoh', lat: -2.21, lng: 113.91, radiusM: 100, companyId: 1);
const _overlap = ProjectSite(
  id: 3,
  label: 'CC-3 — Ops Contoh',
  lat: -2.2104,
  lng: 113.91,
  radiusM: 120,
  kind: SiteKind.costCenter,
  companyId: 1,
);

LocationFix _at(double lat, double lng, {double acc = 5, bool mocked = false}) =>
    LocationFix(lat: lat, lng: lng, accuracyM: acc, isMocked: mocked);

class _FakeService extends Fake implements AttendanceService {
  final calls = <(AttendanceKind, String)>[];
  @override
  Future<String> record({
    required String sub,
    required AttendanceKind kind,
    required ProjectSite site,
    required LocationFix fix,
    required Uint8List rawSelfie,
    required bool online,
  }) async {
    calls.add((kind, site.key));
    return 'op-1';
  }
}

void main() {
  group('check-in screen: automatic area', () {
    late FixedLocationService location;
    late _FakeService service;

    setUp(() {
      location = FixedLocationService(_at(-2.2102, 113.91));
      service = _FakeService();
    });

    Future<void> pump(WidgetTester tester, List<ProjectSite> sites, {bool online = true}) => pumpScreen(
      tester,
      const AttendanceScreen(),
      online: online,
      overrides: [
        appConfigProvider.overrideWith((ref) async => const AppConfig(syncAttendance: true)),
        attendanceSitesProvider.overrideWith((ref) async => sites),
        attendanceItemsProvider.overrideWith((ref) => Stream.value(const [])),
        attendanceServiceProvider.overrideWithValue(service),
        locationServiceProvider.overrideWithValue(location),
        selfieCaptureProvider.overrideWithValue((context, title) async => Uint8List.fromList(List.filled(16, 3))),
      ],
    );

    testWidgets('on open the location containing the fix is selected (not the first of the list)', (tester) async {
      await pump(tester, const [_office, _ops, _project]);
      expect(find.textContaining('Lokasi terdeteksi otomatis: P-07 — Proyek Contoh (22 m dari titik)'), findsOneWidget);
      await tester.tap(find.byKey(const Key('attendance-checkIn')));
      await tester.pumpAndSettle();
      await confirmPopup(tester);
      expect(service.calls.single, (AttendanceKind.checkIn, 'p7'));
    });

    testWidgets('overlapping areas: nearest chosen, chips to pick another one', (tester) async {
      location.fix = _at(-2.2103, 113.91);
      await pump(tester, const [_office, _project, _overlap]);
      expect(find.textContaining('Anda berada di 2 area absen yang bertumpuk'), findsOneWidget);
      expect(find.byKey(const Key('attendance-area-c3')), findsOneWidget);
      expect(find.byKey(const Key('attendance-area-p7')), findsOneWidget);
      expect(tester.widget<ChoiceChip>(find.byKey(const Key('attendance-area-c3'))).selected, isTrue);
      await tester.tap(find.byKey(const Key('attendance-area-p7')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('attendance-checkIn')));
      await tester.pumpAndSettle();
      await confirmPopup(tester);
      expect(service.calls.single, (AttendanceKind.checkIn, 'p7'));
    });

    testWidgets('outside every area: hint with the nearest, manual picker stays; offline queue still works', (
      tester,
    ) async {
      location.fix = _at(-1.2005, 116.8);
      await pump(tester, const [_project, _office], online: false);
      // 56 m from the office project: inside (radius 100) → detected even offline (cached list, GPS needs no data)
      expect(find.textContaining('Lokasi terdeteksi otomatis: P-02 — Proyek Kantor'), findsOneWidget);
      location.fix = _at(-1.3, 116.8);
      await tester.tap(find.byKey(const Key('attendance-detect')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Posisi Anda di luar semua area absen terdaftar. Terdekat: P-02'), findsOneWidget);
      await tester.tap(find.byKey(const Key('attendance-checkIn')));
      await tester.pumpAndSettle();
      expect(service.calls, isEmpty, reason: 'outside the radius: nothing queued');
    });

    testWidgets('the attendance-type hint and the kind / radius line of the eligible list', (tester) async {
      location.fix = _at(-1.25, 116.85);
      const ops = ProjectSite(
        id: 1,
        label: 'CC-1 — Ops Kantor Pusat',
        lat: -1.25,
        lng: 116.85,
        radiusM: 150,
        kind: SiteKind.costCenter,
        companyId: 1,
        attendanceType: AttendanceType.nonOnsite,
      );
      await pump(tester, const [ops]);
      expect(find.byKey(const Key('attendance-type-hint')), findsOneWidget);
      expect(find.textContaining('Karyawan Non-OnSite: absen masuk / pulang di mana saja'), findsOneWidget);
      expect(find.textContaining('Pusat biaya · radius 150 m'), findsOneWidget);
    });

    group('Non-OnSite (DRMS 26/10: anywhere — outside all "Di luar area" at the nearest location)', () {
      const ops = ProjectSite(
        id: 1,
        label: 'CC-1 — Ops Kantor Pusat',
        lat: -1.25,
        lng: 116.85,
        radiusM: 150,
        kind: SiteKind.costCenter,
        companyId: 1,
        attendanceType: AttendanceType.nonOnsite,
      );
      const office = ProjectSite(
        id: 2,
        label: 'P-02 — Proyek Kantor',
        lat: -1.2,
        lng: 116.8,
        radiusM: 100,
        companyId: 1,
        attendanceType: AttendanceType.nonOnsite,
      );

      testWidgets(
        'outside every registered location: not blocked — the nearest one, "Di luar area" note before the popup',
        (tester) async {
          location.fix = _at(-1.6, 116.85);
          await pump(tester, const [office, ops], online: false);
          expect(
            find.textContaining('Di luar lokasi terdaftar — absen dicatat "Di luar area" (ref. CC-1'),
            findsOneWidget,
          );
          expect(find.textContaining('hanya bisa absen'), findsNothing);
          await tester.tap(find.byKey(const Key('attendance-checkIn')));
          await tester.pumpAndSettle();
          // the confirmation popup carries the note; nothing is queued before "Ya"
          expect(find.byKey(const Key('confirm-action')), findsOneWidget);
          expect(
            find.descendant(
              of: find.byType(AlertDialog),
              matching: find.textContaining('absen dicatat "Di luar area"'),
            ),
            findsOneWidget,
          );
          expect(service.calls, isEmpty);
          await confirmPopup(tester);
          // offline: queued at the nearest registered location (the server records it "Di luar area")
          expect(service.calls.single, (AttendanceKind.checkIn, 'c1'));
        },
      );

      testWidgets('check-out outside every location is not blocked either', (tester) async {
        location.fix = _at(-1.6, 116.85);
        await pump(tester, const [ops, office]);
        await tester.tap(find.byKey(const Key('attendance-checkOut')));
        await tester.pumpAndSettle();
        await confirmPopup(tester);
        expect(service.calls.single, (AttendanceKind.checkOut, 'c1'));
      });

      testWidgets('no registered location with a point at all: refused, nothing queued', (tester) async {
        location.fix = _at(-1.6, 116.85);
        const noPoint = ProjectSite(
          id: 9,
          label: 'P-09 — Tanpa titik',
          companyId: 1,
          attendanceType: AttendanceType.nonOnsite,
        );
        await pump(tester, const [noPoint]);
        await tester.tap(find.byKey(const Key('attendance-checkIn')));
        await tester.pumpAndSettle();
        expect(service.calls, isEmpty);
        expect(find.byKey(const Key('confirm-action')), findsNothing);
        expect(find.textContaining('Belum ada lokasi absen dengan titik koordinat'), findsOneWidget);
      });

      testWidgets('inside a registered location: recorded there, whatever was chosen', (tester) async {
        location.fix = _at(-1.6, 116.85);
        await pump(tester, const [office, ops]);
        location.fix = _at(-1.2501, 116.85);
        await tester.tap(find.byKey(const Key('attendance-checkIn')));
        await tester.pumpAndSettle();
        await confirmPopup(tester);
        expect(service.calls.single, (AttendanceKind.checkIn, 'c1'));
        expect(find.textContaining('Di dalam radius lokasi'), findsOneWidget);
      });

      testWidgets('mock location is still refused', (tester) async {
        location.fix = _at(-1.6, 116.85, mocked: true);
        await pump(tester, const [ops, office]);
        await tester.tap(find.byKey(const Key('attendance-checkIn')));
        await tester.pumpAndSettle();
        expect(service.calls, isEmpty);
        expect(find.textContaining('Lokasi palsu (mock location) terdeteksi'), findsOneWidget);
      });
    });
  });
}
