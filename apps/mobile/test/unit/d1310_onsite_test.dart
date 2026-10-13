import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/location/location_service.dart';
import 'package:proyekkas/features/attendance/application/attendance_service.dart';
import 'package:proyekkas/features/attendance/data/attendance_api.dart';
import 'package:proyekkas/features/attendance/data/attendance_locations_repository.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/masters/data/masters_repository.dart';

import '../support/harness.dart';
import '../support/mock_server.dart';
import '../support/widget_harness.dart';

/// DRMS 13/10 A2 (ADR 0023 amendment 2026-10-13): attendance type OnSite / Non-OnSite on the APK — the eligible
/// locations of `GET /attendance/locations` (cached for offline use) and the automatic area detection (the location
/// whose geofence contains the fix; nearest when several overlap; manual fallback). Screen:
/// test/widget/d1310_onsite_screen_test.dart. Points and names are fictional.
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
const _noPoint = ProjectSite(id: 9, label: 'P-09 — Tanpa titik', companyId: 1);

LocationFix _at(double lat, double lng, {double acc = 5, bool mocked = false}) =>
    LocationFix(lat: lat, lng: lng, accuracyM: acc, isMocked: mocked);

Map<String, dynamic> _locationsJson() => {
  'employees': [
    {'id': 12, 'company': 1, 'attendanceType': 'onsite', 'homeSiteId': 2},
    {'id': 31, 'company': 4, 'attendanceType': 'non_onsite', 'homeSiteId': null},
  ],
  'items': [
    {
      'kind': 'site',
      'id': 2,
      'company': 1,
      'employeeId': 12,
      'code': 'CAB',
      'name': 'Kantor Cabang Contoh',
      'lat': -1.2,
      'lng': 116.8,
      'radiusM': 100,
      'isHeadOffice': false,
      'home': true,
    },
    {
      'kind': 'site',
      'id': 1,
      'company': 1,
      'employeeId': 12,
      'code': 'HO',
      'name': 'Kantor Pusat Contoh',
      'lat': -1.25,
      'lng': 116.85,
      'radiusM': 150,
      'isHeadOffice': true,
      'home': false,
    },
    {
      'kind': 'project',
      'id': 7,
      'company': 1,
      'employeeId': 12,
      'code': 'P-07',
      'name': 'Proyek Contoh',
      'lat': -2.21,
      'lng': 113.91,
      'radiusM': 100,
      'isHeadOffice': false,
      'home': false,
    },
    {
      'kind': 'site',
      'id': 40,
      'company': 4,
      'employeeId': 31,
      'code': 'HO2',
      'name': 'Kantor Pusat PT Dua',
      'lat': -3.0,
      'lng': 114.0,
      'radiusM': 100,
      'isHeadOffice': true,
      'home': false,
    },
  ],
};

void main() {
  group('detectArea (auto-detect)', () {
    test('one geofence contains the fix → that location', () {
      final d = detectArea(const [_home, _head, _project], _at(-2.2102, 113.91));
      expect(d.single, isTrue);
      expect(d.inside.single.site.key, 'p7');
      expect(d.inside.single.distanceM, 22);
      expect(d.nearest!.site.key, 'p7');
    });

    test('overlapping geofences → every containing location, nearest first', () {
      final d = detectArea(const [_project, _overlap], _at(-2.2103, 113.91));
      expect(d.overlap, isTrue);
      expect(d.inside.map((m) => m.site.key), ['c3', 'p7'], reason: 'cost center 11 m, project 33 m');
    });

    test('equal distance keeps the list order (home site first)', () {
      const twin = ProjectSite(id: 8, label: 'P-08', lat: -1.2, lng: 116.8, radiusM: 100, companyId: 1);
      final d = detectArea(const [_home, twin], _at(-1.2, 116.8));
      expect(d.inside.map((m) => m.site.key), ['s2', 'p8']);
      final reversed = detectArea(const [twin, _home], _at(-1.2, 116.8));
      expect(reversed.inside.map((m) => m.site.key), ['p8', 's2']);
    });

    test('outside every geofence → nothing inside, the nearest as a hint; no point → ignored', () {
      final d = detectArea(const [_noPoint, _home, _project], _at(-2.2112, 113.91));
      expect(d.inside, isEmpty);
      expect(d.nearest!.site.key, 'p7');
      expect(d.nearest!.distanceM, 133);
      expect(detectArea(const [_noPoint], _at(0, 0)).nearest, isNull);
    });

    test('GPS accuracy allowance (capped at 50 m) like the server; a mocked fix detects nothing', () {
      expect(detectArea(const [_project], _at(-2.2112, 113.91, acc: 40)).single, isTrue, reason: '133 ≤ 100 + 40');
      expect(detectArea(const [_project], _at(-2.2116, 113.91, acc: 500)).inside, isEmpty, reason: '178 > 100 + 50');
      final mocked = detectArea(const [_project], _at(-2.21, 113.91, mocked: true));
      expect(mocked.inside, isEmpty);
      expect(mocked.nearest, isNull);
    });
  });

  group('eligible locations (GET /attendance/locations)', () {
    test('parse: label, kind, head office / home flags, PT, type per PT; scoped to the selected PTs', () {
      final e = EligibleLocations.fromJson(_locationsJson());
      expect(e.sites.map((s) => s.key), ['s2', 's1', 'p7', 's40']);
      final head = e.sites[1];
      expect(head.label, 'HO — Kantor Pusat Contoh');
      expect(head.isHeadOffice, isTrue);
      expect(head.home, isFalse);
      expect(head.hasGeofence, isTrue);
      expect(head.companyId, 1);
      expect(e.sites.first.home, isTrue);
      expect(e.types, {1: AttendanceType.onsite, 4: AttendanceType.nonOnsite});
      expect(e.sites.last.attendanceType, AttendanceType.nonOnsite);
      expect(e.sites.first.attendanceType, AttendanceType.onsite);
      final scoped = e.scoped(const [4]);
      expect(scoped.sites.map((s) => s.key), ['s40']);
      expect(scoped.types.keys, [4]);
      expect(AttendanceType.fromCode(null), AttendanceType.onsite, reason: 'default OnSite');
    });

    test('repository: fetched for every PT (no X-Company-Ids), cached; offline / old server keep the cache', () async {
      final server = await MockServer.start();
      addTearDown(server.close);
      final db = memoryDb();
      addTearDown(db.close);
      server.on('GET', '/api/v1/attendance/locations', (req, body) => (200, _locationsJson()));
      final repo = AttendanceLocationsRepository(AttendanceApi(testClient(server.base, StaticTokens())), db);
      expect(await repo.cached('sub-1'), isNull);
      expect(await repo.refresh('sub-1'), isTrue);
      expect(server.calls.single.$3.containsKey('x-company-ids'), isFalse, reason: 'all membership PTs');
      expect((await repo.cached('sub-1'))!.sites, hasLength(4));

      // server before A2: 404 → false, the cache stays
      server.routes.clear();
      expect(await repo.refresh('sub-1'), isFalse);
      expect((await repo.cached('sub-1'))!.sites, hasLength(4));
      // offline: false, the cache stays (area detection keeps working without signal)
      final offlineApi = AttendanceApi(testClient('http://127.0.0.1:9', StaticTokens()));
      final offline = AttendanceLocationsRepository(offlineApi, db);
      expect(await offline.refresh('sub-1'), isFalse);
      expect((await offline.cached('sub-1'))!.sites.map((s) => s.key), ['s2', 's1', 'p7', 's40']);
    });
  });

  group('picker source', () {
    late AppDatabase db;
    late ProviderContainer c;

    setUp(() {
      db = memoryDb();
      c = ProviderContainer(
        overrides: [
          databaseProvider.overrideWithValue(db),
          authControllerProvider.overrideWith(
            () => FakeAuth(AuthSignedIn(profile: profile({Role.staff}), sub: 'st-sub')),
          ),
          mastersRepositoryProvider.overrideWith(
            (ref) => MastersRepository(testClient('http://127.0.0.1:9', StaticTokens()), db),
          ),
        ],
      );
    });
    tearDown(() async {
      c.dispose();
      await db.close();
    });

    test('the cached eligible list (offline) wins over the assignment-based masters; none cached → masters', () async {
      await db.kvPut(
        'masters:st-sub',
        jsonEncode({
          'projects': {
            'items': [
              {'id': 70, 'code': 'P-70', 'name': 'Ditugaskan', 'lat': -2.0, 'lng': 113.0, 'radiusM': 100},
            ],
            'hasMore': false,
          },
        }),
      );
      expect((await c.read(attendanceSitesProvider.future)).map((s) => s.key), ['p70'], reason: 'fallback');

      await db.kvPut(AttendanceLocationsRepository.key('st-sub'), jsonEncode(_locationsJson()));
      c.invalidate(eligibleLocationsProvider);
      final list = await c.read(attendanceSitesProvider.future);
      expect(list.map((s) => s.key), ['s2', 's1', 'p7', 's40'], reason: 'no assignment needed (OnSite)');
      expect(list.first.home, isTrue, reason: 'home site first');
    });
  });
}
