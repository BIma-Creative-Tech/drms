import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/location/location_service.dart';
import 'package:proyekkas/features/app_config/application/app_config_providers.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/attendance/application/attendance_service.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/attendance/presentation/attendance_screen.dart';

import '../support/widget_harness.dart';

/// Attendance screen (F4 slice). The queue/DB side is covered by test/unit/attendance_test.dart;
/// here the service is a fake so no real async I/O runs inside the widget test's fake-async zone.
const _site = ProjectSite(id: 7, label: 'P-01 — Gudang Contoh', lat: -2.21, lng: 113.91, radiusM: 100);

class FakeAttendanceService extends Fake implements AttendanceService {
  final calls = <(AttendanceKind, int, LocationFix, bool)>[];
  @override
  Future<String> record({
    required String sub,
    required AttendanceKind kind,
    required ProjectSite site,
    required LocationFix fix,
    required Uint8List rawSelfie,
    required bool online,
  }) async {
    calls.add((kind, site.id, fix, online));
    return 'op-1';
  }
}

OutboxData _row(String status, {String? error, bool offline = true}) => OutboxData(
  opUuid: 'op-$status',
  userSub: 'user-sub-1',
  type: 'attendance.check_in',
  targetUuid: 'op-$status',
  payloadJson: '{"project_id":7}',
  dependsOnJson: '[]',
  deviceTime: '2026-09-21T07:58:31+08:00',
  elapsedMs: 1,
  bootId: 'b-1',
  offline: offline,
  status: status,
  attempts: 0,
  lastErrorMessage: error,
  createdAt: DateTime(2026, 9, 21, 7, 58, 31),
);

void main() {
  late FixedLocationService location;
  late FakeAttendanceService service;
  late int selfies;

  setUp(() {
    location = FixedLocationService(const LocationFix(lat: -2.2102, lng: 113.91, accuracyM: 8, isMocked: false));
    service = FakeAttendanceService();
    selfies = 0;
  });

  Future<void> pump(
    WidgetTester tester, {
    bool enabled = true,
    bool online = false,
    List<ProjectSite> sites = const [_site],
    List<OutboxData> history = const [],
  }) => pumpScreen(
    tester,
    const AttendanceScreen(),
    online: online,
    overrides: [
      appConfigProvider.overrideWith((ref) async => AppConfig(syncAttendance: enabled)),
      attendanceSitesProvider.overrideWith((ref) async => sites),
      attendanceItemsProvider.overrideWith((ref) => Stream.value(history)),
      attendanceServiceProvider.overrideWithValue(service),
      locationServiceProvider.overrideWithValue(location),
      selfieCaptureProvider.overrideWithValue((context, title) async {
        selfies++;
        return Uint8List.fromList(List.filled(16, 3));
      }),
    ],
  );

  testWidgets('offline check-in inside the radius: selfie taken, queued offline, Indonesian notice', (tester) async {
    await pump(tester);
    expect(find.text('P-01 — Gudang Contoh'), findsOneWidget);
    await tester.tap(find.byKey(const Key('attendance-checkIn')));
    await tester.pumpAndSettle();
    expect(selfies, 1);
    expect(service.calls.single.$1, AttendanceKind.checkIn);
    expect(service.calls.single.$2, 7);
    expect(service.calls.single.$4, isFalse, reason: 'online flag = connectivity at capture time');
    expect(find.textContaining('Di dalam radius lokasi (22 m dari titik, radius 100 m)'), findsOneWidget);
    expect(find.textContaining('Absen tersimpan di HP (offline)'), findsOneWidget);
  });

  testWidgets('online check-out: "sedang dikirim"', (tester) async {
    await pump(tester, online: true);
    await tester.tap(find.byKey(const Key('attendance-checkOut')));
    await tester.pumpAndSettle();
    expect(service.calls.single.$1, AttendanceKind.checkOut);
    expect(service.calls.single.$4, isTrue);
    expect(find.text('Absen tersimpan dan sedang dikirim.'), findsOneWidget);
  });

  testWidgets('outside the radius: no selfie, nothing queued, distance shown', (tester) async {
    location.fix = const LocationFix(lat: -2.2112, lng: 113.91, accuracyM: 8, isMocked: false);
    await pump(tester);
    await tester.tap(find.byKey(const Key('attendance-checkOut')));
    await tester.pumpAndSettle();
    expect(selfies, 0);
    expect(service.calls, isEmpty);
    expect(find.textContaining('Anda di luar radius lokasi (133 m dari titik, radius 100 m)'), findsOneWidget);
  });

  testWidgets('mock location and GPS off are refused on the phone', (tester) async {
    location.fix = const LocationFix(lat: -2.21, lng: 113.91, accuracyM: 3, isMocked: true);
    await pump(tester);
    await tester.tap(find.byKey(const Key('attendance-checkIn')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Lokasi palsu (mock location) terdeteksi'), findsOneWidget);
    location.error = const LocationException(LocationProblem.serviceDisabled);
    await tester.tap(find.byKey(const Key('attendance-checkIn')));
    await tester.pumpAndSettle();
    expect(find.text('GPS/lokasi HP mati. Nyalakan lokasi lalu coba lagi.'), findsOneWidget);
    expect(selfies, 0);
    expect(service.calls, isEmpty);
  });

  testWidgets('switched off by the server: notice and disabled buttons', (tester) async {
    await pump(tester, enabled: false);
    expect(find.textContaining('belum diaktifkan Admin'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byKey(const Key('attendance-checkIn'))).onPressed, isNull);
  });

  testWidgets('project without a geofence: notice and disabled buttons', (tester) async {
    await pump(tester, sites: const [ProjectSite(id: 8, label: 'P-02 — Tanpa titik')]);
    expect(find.textContaining('Titik lokasi/radius belum diatur Admin'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byKey(const Key('attendance-checkIn'))).onPressed, isNull);
  });

  testWidgets('no assigned project', (tester) async {
    await pump(tester, sites: const []);
    expect(find.text('Anda belum ditugaskan di project atau pusat biaya mana pun. Hubungi PM/Admin.'), findsOneWidget);
  });

  testWidgets('history: queued offline item and a rejection with the server text', (tester) async {
    await pump(
      tester,
      history: [
        _row('pending'),
        _row('rejected', error: 'Di luar radius project (140 m dari titik, radius 100 m).', offline: false),
      ],
    );
    expect(find.textContaining('Absen masuk · P-01 — Gudang Contoh · offline'), findsOneWidget);
    expect(find.textContaining('Menunggu'), findsOneWidget);
    expect(find.textContaining('Di luar radius project (140 m dari titik, radius 100 m).'), findsOneWidget);
  });
}
