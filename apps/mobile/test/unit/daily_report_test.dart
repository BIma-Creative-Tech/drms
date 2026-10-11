import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/media/compress_plan.dart';
import 'package:proyekkas/core/media/photo_compressor.dart';
import 'package:proyekkas/core/time/device_clock.dart';
import 'package:proyekkas/core/util/async_lock.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/expense/data/expense_api.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/field_reports/application/field_service.dart';
import 'package:proyekkas/features/field_reports/data/field_api.dart';
import 'package:proyekkas/features/field_reports/data/field_repository.dart';
import 'package:proyekkas/features/field_reports/domain/field_models.dart';
import 'package:proyekkas/features/field_reports/domain/field_rules.dart';
import 'package:proyekkas/features/sync/application/sync_engine.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/features/sync/data/sync_api.dart';
import 'package:proyekkas/features/sync/domain/sync_models.dart';

import '../support/harness.dart';
import '../support/mock_server.dart';
import '../support/schema_v2.dart';

/// P3 konstruksi Laporan Harian on the APK (0.5.0): rules (over-RAP needs notes, item kinds, empty report),
/// the `daily_report.upsert` payload (new vs edit with zeros for removed volumes), Drift v6 (RAP / resource
/// caches from a v5 phone), the offline path through the sync engine against a loopback mock server and the
/// realisation learned after delivery. Fictional data only.
class FakeCompressor implements PhotoCompressor {
  @override
  Future<CompressedPhoto> compress(Uint8List raw, PhotoTarget target) async =>
      CompressedPhoto(Uint8List.fromList(raw.take(6).toList()), 'sha-${raw.length}');
}

const sub = 'user-sub-mandor';
const today = '2026-10-10';

const galian = RapItem(
  id: 11,
  companyId: 3,
  projectId: 51,
  code: 'A.1',
  kind: 'pekerjaan',
  uom: 'M3',
  stageName: 'Tanah',
  volume: 100,
  realised: 60,
);
const beton = RapItem(
  id: 12,
  companyId: 3,
  projectId: 51,
  code: 'B.1',
  kind: 'pekerjaan',
  uom: 'M3',
  stageName: 'Struktur',
  volume: 20,
);
const semen = RapItem(
  id: 13,
  companyId: 3,
  projectId: 51,
  code: 'M.1',
  kind: 'material',
  uom: 'SAK',
  stageName: 'Struktur',
  volume: 300,
  received: 100,
  used: 40,
);
final items = {
  for (final i in [galian, beton, semen]) i.id: i,
};

FieldDraft daily(DailyContent c, {int? serverId, String date = today}) => FieldDraft(
  clientUuid: 'lh-1',
  type: FieldReportType.dailyReport,
  companyId: 3,
  projectId: 51,
  projectLabel: 'KS-01 — Gudang beton',
  reportDate: date,
  content: c,
  serverId: serverId,
  serverRev: serverId == null ? null : 1,
);

void main() {
  group('rules', () {
    test('konstruksi offers the daily report; type wiring', () {
      expect(ProjectKind.konstruksi.reportTypes, [FieldReportType.dailyReport]);
      final t = FieldReportType.dailyReport;
      expect(
        (t.syncType, t.idKey, t.uuidKey, t.path, t.segment, t.maxPhotos),
        ('daily_report.upsert', 'daily_report_id', 'daily_report_client_uuid', '/daily-reports', 'daily', 10),
      );
      expect(FieldReportType.fromSyncType('daily_report.upsert'), t);
      expect(SyncItemType.isField(SyncItemType.dailyReportUpsert), isTrue);
    });

    test('over the RAP volume needs notes; material item in work refused; empty new report refused', () {
      final over = daily(const DailyContent(work: {11: 45})); // 60 + 45 > 100
      expect(overRapItems(over.daily, items).map((i) => i.code), ['A.1']);
      expect(validateDaily(over, today: today, items: items)['notes'], contains('A.1'));
      expect(
        validateDaily(
          daily(const DailyContent(work: {11: 45}, notes: 'Instruksi konsultan')),
          today: today,
          items: items,
        ),
        isEmpty,
      );
      expect(
        validateDaily(
          daily(const DailyContent(work: {13: 5})),
          today: today,
          items: items,
        )['work'],
        contains('material'),
      );
      expect(validateDaily(daily(const DailyContent()), today: today, items: items)['work'], isNotNull);
      expect(
        validateDaily(
          daily(const DailyContent(rainHours: 25, manpower: {1: 3})),
          today: today,
          items: items,
        )['rainHours'],
        isNotNull,
      );
      expect(
        validateDaily(
          daily(const DailyContent(manpower: {1: 3}), date: '2026-10-11'),
          today: today,
          items: items,
        )['date'],
        isNotNull,
      );
    });

    test('edit: the booked value does not count twice for the over-RAP check', () {
      // realised 60 already contains this report's 30; raising it to 35 → 65 ≤ 100
      final edit = daily(const DailyContent(work: {11: 35}, baseWork: {11: 30}), serverId: 7);
      expect(overRapItems(edit.daily, items), isEmpty);
      expect(validateDaily(edit, today: today, items: items), isEmpty);
    });
  });

  group('sync payload', () {
    test('new report: identity + booked values only, photos via the placeholder key', () {
      final p = fieldSyncPayload(
        daily(
          const DailyContent(
            weatherMorning: Weather.cerah,
            weatherAfternoon: Weather.hujan,
            rainHours: 1.5,
            work: {11: 12.5, 12: 0},
            materials: {13: DailyMaterial(received: 50, used: 20)},
            manpower: {1: 1, 2: 4},
            equipment: {9: DailyEquipment(count: 1, hours: 6)},
            issues: 'Hujan sore',
            photos: ['ph-1'],
          ),
        ),
      );
      expect(p['daily_report_client_uuid'], 'lh-1');
      expect(p['project_id'], 51);
      expect(p['report_date'], today);
      expect(p['weather_morning'], 'cerah');
      expect(p['weather_noon'], isNull);
      expect(p['work'], [
        {'rap_item_id': 11, 'qty': 12.5},
      ]);
      expect(p['materials'], [
        {'rap_item_id': 13, 'received': 50.0, 'used': 20.0},
      ]);
      expect(p['manpower'], [
        {'resource_type_id': 1, 'count': 1},
        {'resource_type_id': 2, 'count': 4},
      ]);
      expect(p['equipment'], [
        {'resource_type_id': 9, 'count': 1, 'hours': 6.0},
      ]);
      expect(p[progressPhotosPlaceholderKey], ['ph-1']);
    });

    test('edit: server id, no identity, a removed volume is sent as 0', () {
      final p = fieldSyncPayload(daily(const DailyContent(work: {12: 3}, baseWork: {11: 30, 12: 2}), serverId: 7));
      expect(p['daily_report_id'], 7);
      expect(p.containsKey('project_id'), isFalse);
      expect(p.containsKey('report_date'), isFalse);
      expect(p['work'], [
        {'rap_item_id': 12, 'qty': 3.0},
        {'rap_item_id': 11, 'qty': 0},
      ]);
    });

    test('content JSON round trip (local draft) and server record → edit draft', () {
      const c = DailyContent(
        weatherNoon: Weather.berawan,
        work: {11: 1.25},
        materials: {13: DailyMaterial(used: 3)},
        manpower: {2: 5},
        equipment: {9: DailyEquipment(count: 2)},
        notes: 'x',
        baseWork: {11: 1},
      );
      final back = DailyContent.fromJson(jsonDecode(jsonEncode(c.toJson())) as Map<String, dynamic>);
      expect(back.weatherNoon, Weather.berawan);
      expect(back.work, {11: 1.25});
      expect(back.materials[13]!.used, 3.0);
      expect(back.manpower, {2: 5});
      expect(back.equipment[9]!.count, 2);
      expect(back.baseWork, {11: 1.0});
      final r = FieldRecord(FieldReportType.dailyReport, {
        'id': 7,
        'companyId': 3,
        'docNo': 'LH/2610/0001',
        'project': {'id': 51, 'code': 'KS-01', 'name': 'Gudang beton'},
        'reportDate': today,
        'weather': {'morning': 'cerah', 'noon': null, 'afternoon': 'hujan'},
        'work': [
          {
            'item': {'id': 11, 'code': 'A.1', 'uom': 'M3'},
            'qty': 30,
          },
        ],
        'materials': <Object>[],
        'manpower': [
          {'resourceTypeId': 2, 'name': 'Tukang batu', 'count': 4},
        ],
        'equipment': <Object>[],
        'workerCount': 4,
        'photos': [
          {'id': 90},
        ],
        'rev': 2,
        'editable': true,
      });
      expect(r.title, 'A.1 30 M3');
      expect(r.subtitle, contains('4 pekerja'));
      final d = r.toDraft(clientUuid: 'lh-edit');
      expect((d.serverId, d.serverRev, d.serverPhotoCount), (7, 2, 1));
      expect(d.daily.work, {11: 30.0});
      expect(d.daily.baseWork, {11: 30.0});
      expect(d.daily.manpower, {2: 4});
    });
  });

  test('database v5 → v6: RAP / resource caches created; a v5 field report survives', () async {
    const ts = 1790000000;
    final db = oldPhoneDb(5, (raw) {
      raw.execute(
        'INSERT INTO local_field_reports (client_uuid, user_sub, company_id, report_type, project_id, report_date, '
        "content_json, sync_state, created_at, updated_at) VALUES ('sv-5', '$sub', 3, 'service_report', 41, '$today', "
        "'{\"unitId\":9,\"action\":\"Cek\"}', 'queued', $ts, $ts)",
      );
    });
    addTearDown(db.close);
    expect(db.schemaVersion, 8);
    final repo = FieldRepository(db);
    expect((await repo.load(sub, 'sv-5'))!.service.action, 'Cek');
    await repo.putRap(
      sub,
      51,
      3,
      [galian, beton, semen],
      const [
        ResourceType(id: 1, companyId: 3, kind: 'tenaga', code: 'MANDOR', name: 'Mandor'),
        ResourceType(id: 9, companyId: 3, kind: 'alat', code: 'EXCAVATOR', name: 'Excavator'),
      ],
    );
    expect((await repo.rapItems(sub, 51)).map((i) => i.code), ['A.1', 'B.1', 'M.1']);
    expect((await repo.resourceTypes(sub, 3)).map((r) => r.isManpower), [false, true]); // EXCAVATOR, MANDOR
    // a refresh replaces the project's items (deactivated / removed items disappear)
    await repo.putRap(sub, 51, 3, [galian], const []);
    expect((await repo.rapItems(sub, 51)).single.code, 'A.1');
    expect(await repo.resourceTypes(sub, 3), isEmpty);
  });

  group('offline queue + sync', () {
    late MockServer server;
    late AppDatabase db;
    late OutboxRepository outbox;
    late FieldRepository repo;
    late FieldService service;
    late SyncEngine engine;
    final batches = <Map<String, dynamic>>[];

    setUp(() async {
      server = await MockServer.start();
      db = memoryDb();
      final drafts = DraftRepository(db);
      outbox = OutboxRepository(db);
      repo = FieldRepository(db);
      final clock = FakeDeviceClock(now: DateTime(2026, 10, 10, 16, 5), elapsed: 7000000, boot: 'b-7');
      final client = testClient(server.base, StaticTokens());
      final media = ExpenseApi(client);
      final lock = AsyncLock();
      batches.clear();
      service = FieldService(
        repo: repo,
        drafts: drafts,
        outbox: outbox,
        api: FieldApi(client),
        clock: clock,
        compressor: FakeCompressor(),
        lock: lock,
      );
      engine = SyncEngine(
        outbox: outbox,
        drafts: drafts,
        api: SyncApi(client),
        db: db,
        clock: clock,
        deviceId: () => '5b0c2f7e-2d1a-4e0b-8f5e-7a9d3c1b2e44',
        lock: lock,
        field: repo,
        uploadMedia: (b) => media.uploadMedia(mediaUploadPath(b.kind), b.bytes, filename: '${b.clientUuid}.jpg'),
      );
      var nextMedia = 900;
      server.on('POST', '/api/v1/media/progress-photos', (req, body) => (201, {'id': ++nextMedia}));
      await repo.putRap(sub, 51, 3, [galian, beton, semen], const []);
    });

    tearDown(() async {
      await db.close();
      await server.close();
    });

    test('photo first, then one daily_report.upsert; applied → local copy gone, realisation learned', () async {
      server.on('POST', '/api/v1/sync/batch', (req, body) {
        final j = jsonDecode(body) as Map<String, dynamic>;
        batches.add(j);
        final i = (j['items'] as List).cast<Map<String, dynamic>>().single;
        return (
          200,
          {
            'batch_id': j['batch_id'],
            'server_time': '2026-10-10T08:05:03Z',
            'results': [
              {
                'client_uuid': i['client_uuid'],
                'status': 'applied',
                'server_id': '77',
                'rev': 1,
                'received_at': '2026-10-10T08:05:03Z',
                'time_trust': 'estimated',
                'flags': ['OFFLINE'],
                'errors': <Object>[],
                'server_daily_report': {
                  'id': 77,
                  'client_uuid': (i['payload'] as Map)['daily_report_client_uuid'],
                  'rev': 1,
                  'doc_no': 'LH/2610/0003',
                  'project_id': 51,
                  'report_date': today,
                  'work': [
                    {'rap_item_id': 11, 'qty': 12.5},
                  ],
                  'materials': <Object>[],
                  'worker_count': 4,
                  'photo_media_ids': [901],
                  'flags': ['OFFLINE'],
                  'offline': true,
                  'editable_until': '2026-10-11T08:05:03Z',
                  'updated_at': '2026-10-10T08:05:03Z',
                },
              },
            ],
          },
        );
      });
      final photo = await service.addPhoto(sub, Uint8List.fromList(List.filled(40, 7)));
      final d = service.newDraft(
        FieldReportType.dailyReport,
        projectId: 51,
        companyId: 3,
        reportDate: today,
        content: DailyContent(work: const {11: 12.5}, manpower: const {2: 4}, photos: [photo]),
      );
      await service.submit(sub, d, online: false);
      expect((await outbox.all(sub)).single.type, 'daily_report.upsert');
      await engine.run(sub);
      final item = (batches.single['items'] as List).single as Map<String, dynamic>;
      expect(item['type'], 'daily_report.upsert');
      expect(item['company_id'], 3);
      final payload = item['payload'] as Map<String, dynamic>;
      expect(payload['photo_media_ids'], [901]);
      expect(payload.containsKey(progressPhotosPlaceholderKey), isFalse);
      expect(payload['work'], [
        {'rap_item_id': 11, 'qty': 12.5},
      ]);
      expect(await repo.load(sub, d.clientUuid), isNull);
      expect((await outbox.all(sub)).map((o) => o.status), everyElement('applied'));
      expect((await repo.rapItems(sub, 51)).firstWhere((i) => i.id == 11).realised, 72.5);
    });

    test('rejected DAILY_EXISTS keeps the report with an Indonesian message', () async {
      server.on('POST', '/api/v1/sync/batch', (req, body) {
        final j = jsonDecode(body) as Map<String, dynamic>;
        final i = (j['items'] as List).cast<Map<String, dynamic>>().single;
        return (
          200,
          {
            'batch_id': j['batch_id'],
            'server_time': '2026-10-10T08:05:03Z',
            'results': [
              {
                'client_uuid': i['client_uuid'],
                'status': 'rejected',
                'server_id': null,
                'rev': null,
                'received_at': '2026-10-10T08:05:03Z',
                'time_trust': 'estimated',
                'flags': <Object>[],
                'errors': [
                  {'code': 'DAILY_EXISTS', 'field': 'reportDate', 'message': 'x'},
                ],
              },
            ],
          },
        );
      });
      final d = service.newDraft(
        FieldReportType.dailyReport,
        projectId: 51,
        companyId: 3,
        reportDate: today,
        content: const DailyContent(manpower: {2: 3}),
      );
      await service.submit(sub, d, online: true);
      await engine.run(sub);
      final left = (await repo.load(sub, d.clientUuid))!;
      expect(left.syncState, FieldSyncState.rejected);
      expect(left.lastErrorCode, 'DAILY_EXISTS');
      expect(left.lastError, contains('sudah ada'));
    });
  });
}
