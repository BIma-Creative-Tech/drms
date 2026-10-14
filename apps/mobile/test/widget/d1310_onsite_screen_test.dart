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

/// DRMS 13/10 A2: the Absen tab recognises the area — the location whose geofence contains the GPS fix is selected
/// on open (nearest when several overlap, chips to pick another; none → manual picker with the nearest as a hint);
/// "Pusat" badge and the attendance-type hint; Non-OnSite outside every registered location → "Di luar area" (no
/// refusal). The service is a fake (no I/O in the widget zone). Fictional points.
const _home = ProjectSite(
  id: 2,
  label: 'CAB — Kantor Cabang Contoh',
  lat: -1.2,
  lng: 116.8,
  radiusM: 100,
  kind: SiteKind.site,
  companyId: 1,
  home: true,
);
const _head = ProjectSite(
  id: 1,
  label: 'HO — Kantor Pusat Contoh',
  lat: -1.25,
  lng: 116.85,
  radiusM: 150,
  kind: SiteKind.site,
  companyId: 1,
  isHeadOffice: true,
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
      await pump(tester, const [_home, _head, _project]);
      expect(find.textContaining('Lokasi terdeteksi otomatis: P-07 — Proyek Contoh (22 m dari titik)'), findsOneWidget);
      await tester.tap(find.byKey(const Key('attendance-checkIn')));
      await tester.pumpAndSettle();
      expect(service.calls.single, (AttendanceKind.checkIn, 'p7'));
    });

    testWidgets('overlapping areas: nearest chosen, chips to pick another one', (tester) async {
      location.fix = _at(-2.2103, 113.91);
      await pump(tester, const [_home, _project, _overlap]);
      expect(find.textContaining('Anda berada di 2 area absen yang bertumpuk'), findsOneWidget);
      expect(find.byKey(const Key('attendance-area-c3')), findsOneWidget);
      expect(find.byKey(const Key('attendance-area-p7')), findsOneWidget);
      expect(tester.widget<ChoiceChip>(find.byKey(const Key('attendance-area-c3'))).selected, isTrue);
      await tester.tap(find.byKey(const Key('attendance-area-p7')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('attendance-checkIn')));
      await tester.pumpAndSettle();
      expect(service.calls.single, (AttendanceKind.checkIn, 'p7'));
    });

    testWidgets('outside every area: hint with the nearest, manual picker stays; offline queue still works', (
      tester,
    ) async {
      location.fix = _at(-1.2005, 116.8);
      await pump(tester, const [_project, _home], online: false);
      // 56 m from the home site: inside (radius 100) → detected even offline (cached list, GPS needs no data)
      expect(find.textContaining('Lokasi terdeteksi otomatis: CAB — Kantor Cabang Contoh'), findsOneWidget);
      expect(find.byKey(const Key('home-site-badge')), findsOneWidget);
      location.fix = _at(-1.3, 116.8);
      await tester.tap(find.byKey(const Key('attendance-detect')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Posisi Anda di luar semua area absen terdaftar. Terdekat: CAB'), findsOneWidget);
      await tester.tap(find.byKey(const Key('attendance-checkIn')));
      await tester.pumpAndSettle();
      expect(service.calls, isEmpty, reason: 'outside the radius: nothing queued');
    });

    testWidgets('head office badge and the attendance-type hint of the eligible list', (tester) async {
      location.fix = _at(-1.25, 116.85);
      const head = ProjectSite(
        id: 1,
        label: 'HO — Kantor Pusat Contoh',
        lat: -1.25,
        lng: 116.85,
        radiusM: 150,
        kind: SiteKind.site,
        companyId: 1,
        isHeadOffice: true,
        attendanceType: AttendanceType.nonOnsite,
      );
      await pump(tester, const [head]);
      expect(find.byKey(const Key('head-office-badge')), findsOneWidget);
      expect(find.byKey(const Key('attendance-type-hint')), findsOneWidget);
      expect(find.textContaining('Karyawan Non-OnSite: boleh absen di mana saja'), findsOneWidget);
      expect(find.textContaining('Kantor pusat · radius 150 m'), findsOneWidget);
    });

    group('Non-OnSite (no location restriction)', () {
      const head = ProjectSite(
        id: 1,
        label: 'HO — Kantor Pusat Contoh',
        lat: -1.25,
        lng: 116.85,
        radiusM: 150,
        kind: SiteKind.site,
        companyId: 1,
        isHeadOffice: true,
        attendanceType: AttendanceType.nonOnsite,
      );
      const outside = ProjectSite(
        id: 2,
        label: 'CAB — Kantor Cabang Contoh',
        kind: SiteKind.site,
        companyId: 1,
        attendanceType: AttendanceType.nonOnsite,
        outsideArea: true,
      );

      testWidgets('outside every registered location: "Di luar area" selected, check-in allowed and queued', (
        tester,
      ) async {
        location.fix = _at(-1.6, 116.85);
        await pump(tester, const [head, outside], online: false);
        expect(find.textContaining('absen dicatat "Di luar area" (ref. CAB — Kantor Cabang Contoh)'), findsOneWidget);
        await tester.tap(find.byKey(const Key('attendance-checkIn')));
        await tester.pumpAndSettle();
        expect(service.calls.single, (AttendanceKind.checkIn, 'o2'));
      });

      testWidgets('inside a registered location: recorded there, even when "Di luar area" was chosen', (tester) async {
        location.fix = _at(-1.6, 116.85);
        await pump(tester, const [head, outside]);
        location.fix = _at(-1.2501, 116.85);
        await tester.tap(find.byKey(const Key('attendance-checkIn')));
        await tester.pumpAndSettle();
        expect(service.calls.single, (AttendanceKind.checkIn, 's1'));
        expect(find.textContaining('Di dalam radius lokasi'), findsOneWidget);
      });

      testWidgets('mock location is still refused', (tester) async {
        location.fix = _at(-1.6, 116.85, mocked: true);
        await pump(tester, const [head, outside]);
        await tester.tap(find.byKey(const Key('attendance-checkIn')));
        await tester.pumpAndSettle();
        expect(service.calls, isEmpty);
        expect(find.textContaining('Lokasi palsu (mock location) terdeteksi'), findsOneWidget);
      });
    });
  });
}
