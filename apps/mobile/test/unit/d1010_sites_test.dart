import 'dart:convert';
import 'dart:typed_data';

import 'package:drift/drift.dart' show Value;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/location/location_service.dart';
import 'package:proyekkas/core/media/compress_plan.dart';
import 'package:proyekkas/core/media/photo_compressor.dart';
import 'package:proyekkas/core/time/device_clock.dart';
import 'package:proyekkas/core/util/async_lock.dart';
import 'package:proyekkas/features/attendance/application/attendance_service.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/expense/data/expense_api.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/masters/data/masters_repository.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/features/projects/data/projects_api.dart';
import 'package:proyekkas/features/sync/application/sync_engine.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/features/sync/data/sync_api.dart';

import '../support/fixtures.dart';
import '../support/harness.dart';
import '../support/mock_server.dart';
import '../support/schema_v2.dart';
import '../support/widget_harness.dart';

/// ADR 0023 (DRMS 10/10 Phase D): sites (kantor cabang) per PT on the APK — drift v9 `outbox.site_id`, the `sites`
/// masters with the caller's flags (home / assigned / team), the location picker (home site first), the
/// "diabsenkan PM" candidates of a site, the sync payload (exactly one of project_id / cost_center_id / site_id) and
/// the site on the project detail / employee profile.
const sub = 'kc-sub-v9';
const _site = ProjectSite(
  id: 2,
  label: 'BPN — Cabang Balikpapan',
  lat: -1.2654,
  lng: 116.8312,
  radiusM: 120,
  kind: SiteKind.site,
  companyId: 1,
  home: true,
);
const _fix = LocationFix(lat: -1.2655, lng: 116.8312, accuracyM: 6, isMocked: false);

class _Compressor implements PhotoCompressor {
  @override
  Future<CompressedPhoto> compress(Uint8List raw, PhotoTarget target) async =>
      CompressedPhoto(Uint8List.fromList(raw.take(8).toList()), 'sha-site');
}

Map<String, dynamic> _items(List<Map<String, dynamic>> rows) => {'items': rows, 'hasMore': false};

void main() {
  test('v8 → v9: queued outbox rows survive with site_id NULL; a site item stores its site', () async {
    const ts = 1790000000;
    final db = oldPhoneDb(8, (raw) {
      raw.execute(
        'INSERT INTO outbox (op_uuid, user_sub, company_id, type, target_uuid, payload_json, device_time, elapsed_ms, '
        "boot_id, created_at) VALUES ('op-old', '$sub', 1, 'attendance.check_in', 'op-old', '{\"project_id\":7}', "
        "'2026-10-01T08:00:00+08:00', 1, 'b-1', $ts)",
      );
    });
    addTearDown(db.close);
    expect(db.schemaVersion, 10);
    final outbox = OutboxRepository(db);
    final old = (await outbox.all(sub)).single;
    expect((old.opUuid, old.siteId, old.status, old.companyId), ('op-old', null, 'pending', 1));
    await outbox.enqueueAttendance(
      sub: sub,
      type: 'attendance.check_in',
      payload: attendancePayload(site: _site, fix: _fix, selfieUuid: 'sel-1'),
      selfieUuid: 'sel-1',
      deviceTime: '2026-10-11T08:00:00+08:00',
      elapsedMs: 2,
      bootId: 'b-1',
      offline: true,
      companyId: 1,
      siteId: 2,
    );
    final rows = await outbox.all(sub);
    expect(rows.map((r) => r.siteId).toSet(), {null, 2});
  });

  test('payload: exactly one location key (site_id for a site), key prefix s', () {
    final p = attendancePayload(site: _site, fix: _fix, selfieUuid: 'sel-1');
    expect(p['site_id'], 2);
    expect(p.keys.where((k) => k.endsWith('_id') && k != 'site_id'), isEmpty);
    final ob = onBehalfPayload(
      employeeId: 44,
      kind: AttendanceKind.checkOut,
      site: _site,
      fix: _fix,
      photoUuid: 'ph-1',
      lens: CameraLens.back,
      reason: 'tidak punya HP',
    );
    expect((ob['site_id'], ob.containsKey('project_id'), ob.containsKey('cost_center_id')), (2, false, false));
    expect(_site.key, 's2');
    expect(SiteKind.fromCode('site'), SiteKind.site);
    expect(SiteKind.fromCode('cost_center'), SiteKind.costCenter);
    expect(SiteKind.fromCode(null), SiteKind.project);
  });

  test('masters: site row with the caller flags; older rows without flags stay false', () {
    final m = masterFromJson(MasterTypes.sites, {
      'id': 2,
      'company': 1,
      'code': 'BPN',
      'name': 'Cabang Balikpapan',
      'lat': -1.2654,
      'lng': 116.8312,
      'radiusM': 120,
      'home': true,
      'assigned': false,
      'team': true,
      'active': true,
    });
    final s = ProjectSite.fromMaster(m, kind: SiteKind.site);
    expect(
      (s.label, s.key, s.home, s.assigned, s.team, s.hasGeofence, s.companyId),
      ('BPN — Cabang Balikpapan', 's2', true, false, true, true, 1),
    );
    final bare = ProjectSite.fromMaster(const MasterItem(3, 'x'), kind: SiteKind.site);
    expect((bare.home, bare.assigned, bare.team, bare.hasGeofence), (false, false, false, false));
    expect(MasterTypes.forApp, contains(MasterTypes.sites));
  });

  group('providers from the cached masters', () {
    late AppDatabase db;
    late ProviderContainer c;

    Future<void> seed(Map<String, dynamic> types) => db.kvPut('masters:pm-sub', jsonEncode(types));

    setUp(() {
      db = memoryDb();
      c = ProviderContainer(
        overrides: [
          databaseProvider.overrideWithValue(db),
          authControllerProvider.overrideWith(() => FakeAuth(AuthSignedIn(profile: profile({Role.pm}), sub: 'pm-sub'))),
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

    test('own picker: home site first, then assigned sites, projects, cost centers; other sites hidden', () async {
      await seed({
        'projects': _items([
          {
            'id': 7,
            'code': 'P-07',
            'name': 'Gudang',
            'lat': -2.21,
            'lng': 113.91,
            'radiusM': 100,
            'status': 'berjalan',
            'site': 2,
          },
        ]),
        'cost-centers': _items([
          {'id': 3, 'code': 'CC-3', 'name': 'Ops', 'lat': -2.2, 'lng': 113.9, 'radiusM': 80, 'active': true},
        ]),
        'sites': _items([
          {
            'id': 5,
            'code': 'KDI',
            'name': 'Cabang Kendari',
            'lat': -3.99,
            'lng': 122.51,
            'radiusM': 100,
            'assigned': true,
            'active': true,
          },
          {
            'id': 2,
            'code': 'BPN',
            'name': 'Cabang Balikpapan',
            'lat': -1.26,
            'lng': 116.83,
            'radiusM': 120,
            'home': true,
            'active': true,
          },
          {
            'id': 6,
            'code': 'SMD',
            'name': 'Cabang Samarinda',
            'lat': -0.5,
            'lng': 117.1,
            'radiusM': 100,
            'team': true,
            'active': true,
          },
          {'id': 8, 'code': 'OLD', 'name': 'Tutup', 'lat': 0, 'lng': 0, 'radiusM': 100, 'home': true, 'active': false},
        ]),
      });
      final list = await c.read(attendanceSitesProvider.future);
      expect(list.map((s) => s.key), [
        's2',
        's5',
        'p7',
        'c3',
      ], reason: 'team-only and inactive sites are not own locations');
      expect(list.first.home, isTrue);
    });

    test('on-behalf: a team site lists its stationed employees and site assignments (never the PM self)', () async {
      await seed({
        'projects': _items([
          {
            'id': 7,
            'code': 'P-07',
            'name': 'Gudang',
            'lat': -2.21,
            'lng': 113.91,
            'radiusM': 100,
            'status': 'berjalan',
          },
        ]),
        'sites': _items([
          {
            'id': 6,
            'code': 'SMD',
            'name': 'Cabang Samarinda',
            'lat': -0.5,
            'lng': 117.1,
            'radiusM': 100,
            'team': true,
            'active': true,
          },
          {'id': 9, 'code': 'JKT', 'name': 'Cabang Jakarta', 'lat': -6.2, 'lng': 106.8, 'radiusM': 100, 'active': true},
        ]),
        'employees': _items([
          {'id': 12, 'name': 'Doni Pratama', 'homeSite': 6}, // the PM → excluded
          {'id': 44, 'name': 'Budi Contoh', 'homeSite': 6},
          {'id': 45, 'name': 'Citra Contoh'},
          {'id': 46, 'name': 'Eko Contoh', 'homeSite': 9}, // not a team site
        ]),
        'team-assignments': _items([
          {'id': 1, 'employee': 45, 'site': 6},
          {'id': 2, 'employee': 44, 'project': 7},
          {'id': 3, 'employee': 46, 'site': 9},
        ]),
      });
      final list = await c.read(onBehalfCandidatesProvider.future);
      expect(list.map((e) => e.employeeId), [44, 45]);
      expect(list.first.sites.map((s) => s.key), ['p7', 's6']);
      expect(list.last.sites.single.kind, SiteKind.site);
    });
  });

  group('outbox replay with site_id', () {
    late MockServer server;
    late AppDatabase db;
    late OutboxRepository outbox;
    late AttendanceService service;
    late SyncEngine engine;

    setUp(() async {
      server = await MockServer.start();
      db = memoryDb();
      final drafts = DraftRepository(db);
      outbox = OutboxRepository(db);
      final clock = FakeDeviceClock(now: DateTime(2026, 10, 11, 7, 58), elapsed: 1000, boot: 'b-9');
      service = AttendanceService(drafts: drafts, outbox: outbox, clock: clock, compressor: _Compressor());
      final client = testClient(server.base, StaticTokens());
      final api = ExpenseApi(client);
      engine = SyncEngine(
        uploadMedia: (b) => api.uploadMedia('selfies', b.bytes, filename: '${b.clientUuid}.jpg'),
        outbox: outbox,
        drafts: drafts,
        api: SyncApi(client),
        db: db,
        clock: clock,
        deviceId: () => '5b0c2f7e-2d1a-4e0b-8f5e-7a9d3c1b2e44',
        lock: AsyncLock(),
      );
    });
    tearDown(() async {
      await db.close();
      await server.close();
    });

    test('a check-in at the home site is queued offline with site_id and sent as site_id only', () async {
      server.on('POST', '/api/v1/media/selfies', (req, body) => (201, {'id': 777}));
      Map<String, dynamic>? sent;
      server.on('POST', '/api/v1/sync/batch', (req, body) {
        final j = jsonDecode(body) as Map<String, dynamic>;
        sent = (j['items'] as List).single as Map<String, dynamic>;
        return (
          200,
          {
            'batch_id': j['batch_id'],
            'server_time': '2026-10-11T00:00:00Z',
            'results': [
              {'client_uuid': sent!['client_uuid'], 'status': 'applied', 'server_id': '5', 'flags': [], 'errors': []},
            ],
          },
        );
      });
      await service.record(
        sub: sub,
        kind: AttendanceKind.checkIn,
        site: _site,
        fix: _fix,
        rawSelfie: Uint8List.fromList(List.filled(16, 1)),
        online: false,
      );
      final queued = (await outbox.all(sub)).single;
      expect((queued.siteId, queued.companyId), (2, 1));
      await engine.run(sub);
      final payload = sent!['payload'] as Map<String, dynamic>;
      expect((payload['site_id'], payload['selfie_media_id']), (2, 777));
      expect(payload.containsKey('project_id') || payload.containsKey('cost_center_id'), isFalse);
      expect((await outbox.all(sub)).single.status, 'applied');
    });

    test('a project check-in keeps site_id NULL in the outbox', () async {
      await service.record(
        sub: sub,
        kind: AttendanceKind.checkIn,
        site: const ProjectSite(id: 7, label: 'P-07', lat: -2.21, lng: 113.91, radiusM: 100),
        fix: _fix,
        rawSelfie: Uint8List.fromList(List.filled(16, 1)),
        online: false,
      );
      expect((await outbox.all(sub)).single.siteId, isNull);
    });
  });

  test('read models: project site and the employee "Site penempatan" (absent on older servers)', () {
    final p = projectFromJson({
      'id': 7,
      'code': 'P-07',
      'name': 'Gudang',
      'site': {'id': 2, 'code': 'BPN', 'name': 'Cabang Balikpapan'},
    });
    expect((p.site?.id, p.site?.code), (2, 'BPN'));
    expect(projectFromJson({'id': 8, 'code': 'P-08', 'name': 'x'}).site, isNull);
    final me = meJson();
    (me['employee'] as Map<String, dynamic>)['homeSite'] = {'id': 2, 'code': 'BPN', 'name': 'Cabang Balikpapan'};
    final u = userProfileFromJson(me);
    expect((u.employee?.homeSiteId, u.employee?.homeSiteLabel), (2, 'BPN — Cabang Balikpapan'));
    expect(userProfileFromJson(meJson()).employee?.homeSiteLabel, isNull);
    final m = companyMembershipFromJson({
      'id': 1,
      'code': 'DRMS',
      'roles': ['pk-staff'],
      'employee': {
        'id': 12,
        'code': 'E12',
        'name': 'Doni',
        'homeSite': {'id': 2, 'code': 'BPN', 'name': 'Cabang Balikpapan'},
      },
    });
    expect(m.employee?.homeSiteId, 2);
  });

  test('outbox companion accepts siteId (drift v9 column)', () {
    const row = OutboxCompanion(siteId: Value(3));
    expect(row.siteId.value, 3);
  });
}
