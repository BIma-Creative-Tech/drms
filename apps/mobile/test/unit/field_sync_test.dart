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
import 'package:proyekkas/features/field_reports/application/field_service.dart';
import 'package:proyekkas/features/field_reports/data/field_api.dart';
import 'package:proyekkas/features/field_reports/data/field_repository.dart';
import 'package:proyekkas/features/field_reports/domain/field_models.dart';
import 'package:proyekkas/features/masters/data/masters_repository.dart';
import 'package:proyekkas/features/sync/application/sync_engine.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/features/sync/data/sync_api.dart';
import 'package:proyekkas/features/sync/domain/sync_models.dart';

import '../support/harness.dart';
import '../support/mock_server.dart';
import '../support/schema_v2.dart';

/// FR1 APK offline path: Drift v5 (migration from a v4 phone), local reports + caches (no rates), the outbox
/// items `service_report.upsert` / `unit_timesheet.upsert` / `aftersales_activity.upsert` (photos first), and
/// the per-item results (applied / conflict / rejected) — against a loopback mock server. Fictional data only.
class FakeCompressor implements PhotoCompressor {
  final targets = <PhotoTarget>[];
  @override
  Future<CompressedPhoto> compress(Uint8List raw, PhotoTarget target) async {
    targets.add(target);
    return CompressedPhoto(Uint8List.fromList(raw.take(6).toList()), 'sha-${raw.length}');
  }
}

const sub = 'user-sub-mekanik';
const today = '2026-10-09';

void main() {
  test('database v4 → v5: field tables created, drafts / outbox / progress rows of the v4 phone untouched', () async {
    const ts = 1790000000;
    final db = oldPhoneDb(4, (raw) {
      raw.execute(
        'INSERT INTO local_drafts (client_uuid, user_sub, company_id, type, title, urgency_level_id, requester_ids_json, '
        "sync_state, created_at, updated_at) VALUES ('d-5', '$sub', 3, 'advance', 'BBM genset', 2, '[]', 'local', $ts, $ts)",
      );
      raw.execute(
        'INSERT INTO outbox (op_uuid, user_sub, company_id, type, target_uuid, payload_json, device_time, elapsed_ms, '
        "boot_id, created_at) VALUES ('op-1', '$sub', 3, 'expense_request.draft_upsert', 'd-5', '{}', "
        "'2026-10-09T08:00:00+08:00', 1, 'b', $ts)",
      );
      raw.execute("INSERT INTO kv_entries VALUES ('masters:$sub:3', '{}')");
    });
    addTearDown(db.close);
    expect(db.schemaVersion, 8); // v5 field tables; v6 (P3) + v7 (D3) + v8 (D4) on top
    final draft = (await (db.select(db.localDrafts)..where((t) => t.clientUuid.equals('d-5'))).getSingle());
    expect((draft.title, draft.urgencyLevelId, draft.companyId), ('BBM genset', 2, 3));
    expect((await OutboxRepository(db).all(sub)).single.opUuid, 'op-1');
    expect(await db.kvGet('masters:$sub:3'), '{}');
    final repo = FieldRepository(db);
    final d = FieldDraft(
      clientUuid: 'sv-new',
      type: FieldReportType.serviceReport,
      companyId: 3,
      projectId: 41,
      reportDate: today,
      content: const ServiceContent(unitId: 9, unitLabel: 'EX-01', hourMeter: 1025, action: 'Ganti seal'),
    );
    await repo.save(sub, d);
    expect((await repo.load(sub, 'sv-new'))!.service.hourMeter, 1025);
    await repo.putUnits(sub, [const FieldUnit(id: 9, companyId: 3, unitCode: 'EX-01', lastHourMeter: 1023)]);
    expect((await repo.units(sub)).single.lastHourMeter, 1023);
  });

  group('offline queue + sync', () {
    late MockServer server;
    late AppDatabase db;
    late DraftRepository drafts;
    late OutboxRepository outbox;
    late FieldRepository repo;
    late FieldService service;
    late SyncEngine engine;
    late FakeCompressor compressor;
    final uploads = <String>[];
    final batches = <Map<String, dynamic>>[];

    setUp(() async {
      server = await MockServer.start();
      db = memoryDb();
      drafts = DraftRepository(db);
      outbox = OutboxRepository(db);
      repo = FieldRepository(db);
      compressor = FakeCompressor();
      final clock = FakeDeviceClock(now: DateTime(2026, 10, 9, 14, 5), elapsed: 7000000, boot: 'b-7');
      final client = testClient(server.base, StaticTokens());
      final media = ExpenseApi(client);
      final lock = AsyncLock();
      uploads.clear();
      batches.clear();
      service = FieldService(
        repo: repo,
        drafts: drafts,
        outbox: outbox,
        api: FieldApi(client),
        clock: clock,
        compressor: compressor,
        lock: lock,
        masters: MastersRepository(client, db),
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
        uploadMedia: (b) {
          uploads.add(mediaUploadPath(b.kind));
          return media.uploadMedia(mediaUploadPath(b.kind), b.bytes, filename: '${b.clientUuid}.jpg');
        },
      );
      var nextMedia = 900;
      server.on('POST', '/api/v1/media/progress-photos', (req, body) => (201, {'id': ++nextMedia}));
    });

    tearDown(() async {
      await db.close();
      await server.close();
    });

    void answerBatch(String status, {Map<String, dynamic> Function(Map<String, dynamic> item)? extra}) {
      server.on('POST', '/api/v1/sync/batch', (req, body) {
        final j = jsonDecode(body) as Map<String, dynamic>;
        batches.add(j);
        return (
          200,
          {
            'batch_id': j['batch_id'],
            'server_time': '2026-10-09T06:05:03Z',
            'results': [
              for (final i in (j['items'] as List).cast<Map<String, dynamic>>())
                {
                  'client_uuid': i['client_uuid'],
                  'status': status,
                  'server_id': '77',
                  'rev': 1,
                  'received_at': '2026-10-09T06:05:03Z',
                  'time_trust': 'estimated',
                  'flags': ['OFFLINE'],
                  'errors': <Object>[],
                  ...?extra?.call(i),
                },
            ],
          },
        );
      });
    }

    Future<FieldDraft> serviceReport({int photos = 2}) async {
      final before = <String>[];
      for (var i = 0; i < photos; i++) {
        before.add(await service.addPhoto(sub, Uint8List.fromList(List.filled(30 + i, i))));
      }
      final d = service.newDraft(
        FieldReportType.serviceReport,
        projectId: 41,
        projectLabel: 'K-001 — Sewa Kalteng Coal',
        companyId: 3,
        reportDate: today,
        content: ServiceContent(
          unitId: 9,
          unitLabel: 'EX-01',
          hourMeter: 1025,
          serviceType: ServiceType.perbaikan,
          action: 'Ganti seal kit boom',
          unitStatusAfter: UnitStatus.menungguPart,
          spareparts: const [PartLine(name: 'Seal kit boom', qty: 1, uom: 'set')],
          beforePhotos: before,
        ),
      );
      await service.submit(sub, d, online: false);
      return d;
    }

    test('autosaved draft stays local (no outbox item); "Kirim" → one queued service_report.upsert', () async {
      final d = service.newDraft(
        FieldReportType.serviceReport,
        projectId: 41,
        companyId: 3,
        reportDate: today,
        content: const ServiceContent(unitId: 9, action: 'Cek'),
      );
      await service.saveDraft(sub, d);
      expect((await repo.load(sub, d.clientUuid))!.syncState, FieldSyncState.local);
      expect(await outbox.all(sub), isEmpty);
      final q = await serviceReport();
      final row = (await outbox.all(sub)).single;
      expect(row.type, 'service_report.upsert');
      expect(row.opUuid, q.clientUuid, reason: 'first op of a report uses the report uuid');
      expect(row.companyId, 3);
      expect(row.baseRev, isNull);
      expect(OutboxRepository.mediaDeps(row), q.service.photoUuids);
      expect(compressor.targets, everyElement(PhotoTarget.receipt), reason: '≤ 1600 px / ≤ 400 KB, no EXIF');
      expect((await drafts.media(q.service.photoUuids.first))!.kind, 'field');
      // autosave never downgrades a queued report back to a draft
      await service.saveDraft(sub, q.copyWith(content: const ServiceContent(action: 'x')));
      expect((await repo.load(sub, q.clientUuid))!.syncState, FieldSyncState.queued);
      expect(await repo.load('other-user', q.clientUuid), isNull, reason: 'locked to the sub');
    });

    test(
      'online: photos first → progress-photos, item with photo_media_ids; applied → local gone, unit cache learns',
      () async {
        await repo.putUnits(sub, [
          const FieldUnit(id: 9, companyId: 3, unitCode: 'EX-01', lastHourMeter: 1023, lastHourMeterAt: '2026-10-08'),
        ]);
        answerBatch('applied');
        final d = await serviceReport();
        final r = await engine.run(sub);
        expect(r.outcome, SyncRunOutcome.done);
        expect(uploads, ['progress-photos', 'progress-photos']);
        final item = ((batches.single['items'] as List).single as Map).cast<String, dynamic>();
        expect(item['type'], 'service_report.upsert');
        expect(item['company_id'], 3);
        final p = (item['payload'] as Map).cast<String, dynamic>();
        expect(p['report_client_uuid'], d.clientUuid);
        expect(p['photo_media_ids'], [901, 902]);
        expect(p['unit_status_after'], 'menunggu_part');
        expect(await repo.load(sub, d.clientUuid), isNull);
        expect(await drafts.media(d.service.photoUuids.first), isNull, reason: 'photos are on the server now');
        final unit = (await repo.units(sub)).single;
        expect((unit.lastHourMeter, unit.status), (1025, UnitStatus.menungguPart));
      },
    );

    test('timesheet: HM photo → hm_photo_media_id; applied → recent-timesheet cache prefills the next day', () async {
      answerBatch(
        'applied',
        extra: (_) => {
          'server_unit_timesheet': {'id': 77, 'rev': 1, 'hm_start': 1023, 'hm_end': 1031.5},
        },
      );
      final hm = await service.addPhoto(sub, Uint8List.fromList(List.filled(20, 7)));
      final d = service.newDraft(
        FieldReportType.unitTimesheet,
        projectId: 41,
        companyId: 3,
        reportDate: today,
        content: TimesheetContent(
          unitId: 9,
          unitLabel: 'EX-01',
          hmStart: 1023,
          hmEnd: 1031.5,
          workHours: 8,
          standbyHours: 1.5,
          operatorName: 'Slamet',
          location: 'Pit 3',
          hmPhoto: hm,
        ),
      );
      await service.submit(sub, d, online: true);
      await engine.run(sub);
      final p = (((batches.single['items'] as List).single as Map)['payload'] as Map).cast<String, dynamic>();
      expect(p['hm_photo_media_id'], 901);
      expect(p['timesheet_client_uuid'], d.clientUuid);
      final next = await service.timesheetStart(sub, projectId: 41, unitId: 9, date: '2026-10-10');
      expect((next.local, next.prevHm, next.prevDate), (null, 1031.5, today));
      expect(next.marks.single.operatorName, 'Slamet');
    });

    test('rejected HM_DECREASED → clear Indonesian message, local version kept (state ditolak)', () async {
      answerBatch(
        'rejected',
        extra: (_) => {
          'server_id': null,
          'errors': [
            {'code': 'HM_DECREASED', 'field': 'hourMeter', 'message': 'HM 1020 lebih kecil dari HM terakhir 1023.'},
          ],
        },
      );
      final d = await serviceReport(photos: 0);
      final r = await engine.run(sub);
      expect(r.rejected, 1);
      final local = (await repo.load(sub, d.clientUuid))!;
      expect(local.syncState, FieldSyncState.rejected);
      expect(local.lastErrorCode, 'HM_DECREASED');
      expect(local.lastError, contains('HM terakhir unit'));
      expect((await outbox.all(sub)).single.status, 'rejected');
    });

    test('edit conflict → server wins; "kirim ulang versi saya" = edit of the server rev with reason', () async {
      final copy = {
        'id': 77,
        'client_uuid': null,
        'rev': 3,
        'doc_no': 'SV/2610/0004',
        'project_id': 41,
        'unit_id': 9,
        'report_date': today,
        'hour_meter': 1026,
        'service_type': 'perbaikan',
        'action': 'Versi web',
        'unit_status_after': 'siap',
        'photo_media_ids': [901],
        'flags': <String>[],
        'offline': false,
        'editable_until': '2099-01-01T00:00:00Z',
        'updated_at': '2026-10-09T05:00:00Z',
      };
      answerBatch('conflict', extra: (_) => {'rev': 3, 'server_service_report': copy});
      final record = FieldRecord(FieldReportType.serviceReport, {
        'id': 77,
        'companyId': 3,
        'project': {'id': 41, 'code': 'K-001', 'name': 'Sewa'},
        'unit': {'id': 9, 'unitCode': 'EX-01'},
        'reportDate': today,
        'hourMeter': 1025,
        'serviceType': 'perbaikan',
        'action': 'Ganti seal',
        'unitStatusAfter': 'menunggu_part',
        'photos': [
          {'id': 901},
        ],
        'rev': 2,
        'editable': true,
        'editableUntil': '2099-01-01T00:00:00Z',
        'clientUuid': '0192f6d0-aaaa-7bbb-8ccc-00000000f077',
      });
      final edit = await service.startEdit(sub, record);
      expect((edit.isEdit, edit.serverRev, edit.serverPhotoCount), (true, 2, 1));
      await service.submit(sub, edit, online: true);
      expect((await outbox.all(sub)).single.baseRev, 2);
      final r = await engine.run(sub);
      expect(r.conflicts, 1);
      final local = (await repo.load(sub, edit.clientUuid))!;
      expect(local.syncState, FieldSyncState.conflict);
      expect(local.conflictCopy!['rev'], 3);
      await service.resendMine(sub, edit.clientUuid, reason: 'HM dari lapangan', online: true);
      final pending = (await outbox.all(sub)).where((o) => o.status == 'pending').single;
      expect(pending.baseRev, 3);
      expect(pending.opUuid, isNot(edit.clientUuid));
      final p = jsonDecode(pending.payloadJson) as Map<String, dynamic>;
      expect((p['report_id'], p['reason']), (77, 'HM dari lapangan'));
      expect(p.containsKey('project_id'), isFalse);
      // "pakai versi server" closes every open item of the report
      await service.useServerVersion(sub, edit.clientUuid);
      expect(await repo.load(sub, edit.clientUuid), isNull);
      expect((await outbox.all(sub)).where((o) => o.status == 'pending'), isEmpty);
    });

    test(
      'aftersales: delivery against a PO; FEATURE_DISABLED (PT flag off) → rejected with the flag message',
      () async {
        answerBatch(
          'rejected',
          extra: (_) => {
            'errors': [
              {
                'code': 'FEATURE_DISABLED',
                'message': 'Laporan lapangan belum diaktifkan untuk PT ini (Setting perusahaan).',
              },
            ],
          },
        );
        final d = service.newDraft(
          FieldReportType.aftersalesActivity,
          projectId: 52,
          companyId: 3,
          reportDate: today,
          content: const ActivityContent(
            clientId: 4,
            clientName: 'CV Maju Jaya',
            kind: ActivityKind.pengiriman,
            docNo: 'SJ-0441',
            relatesTo: 907,
            poDelivered: true,
          ),
        );
        await service.submit(sub, d, online: true);
        await engine.run(sub);
        final item = ((batches.single['items'] as List).single as Map).cast<String, dynamic>();
        expect(item['type'], 'aftersales_activity.upsert');
        final p = (item['payload'] as Map).cast<String, dynamic>();
        expect((p['relates_to'], p['po_delivered'], p['kind']), (907, true, 'pengiriman'));
        expect(p.containsKey('photo_media_ids'), isFalse);
        final local = (await repo.load(sub, d.clientUuid))!;
        expect(local.syncState, FieldSyncState.rejected);
        expect(local.lastError, contains('belum diaktifkan'));
      },
    );

    test(
      'cache refresh: units (delta marker), contract units WITHOUT rates, timesheets, open POs, customers',
      () async {
        String? since;
        server.on('GET', '/api/v1/units', (req, body) {
          since = req.uri.queryParameters['updatedSince'];
          return (
            200,
            {
              'serverTime': '2026-10-09T06:00:00Z',
              'items': [
                {
                  'id': 9,
                  'companyId': 3,
                  'kind': 'alat_berat',
                  'label': 'EX-01',
                  'unitCode': 'EX-01',
                  'owner': 'pelanggan',
                  'client': {'id': 4, 'name': 'CV Maju Jaya'},
                  'status': 'siap',
                  'lastHourMeter': 1023,
                  'active': true,
                },
              ],
            },
          );
        });
        server.on(
          'GET',
          '/api/v1/projects/41/contract-units',
          (req, body) => (
            200,
            {
              'projectId': 41,
              'items': [
                {
                  'id': 1,
                  'companyId': 3,
                  'projectId': 41,
                  'unit': {'id': 9, 'label': 'EX-01', 'unitCode': 'EX-01'},
                  'startDate': '2026-10-01',
                  'endDate': null,
                  'active': true,
                  'rateBasis': 'per_jam',
                  'rate': 350000,
                  'minHoursPerMonth': 200,
                  'ratesVisible': true,
                },
              ],
            },
          ),
        );
        server.on(
          'GET',
          '/api/v1/unit-timesheets',
          (req, body) => (
            200,
            {
              'items': [
                {
                  'id': 70,
                  'companyId': 3,
                  'project': {'id': 41},
                  'unit': {'id': 9},
                  'reportDate': '2026-10-08',
                  'hmStart': 1015,
                  'hmEnd': 1023,
                  'operatorName': 'Slamet',
                },
              ],
              'nextCursor': null,
            },
          ),
        );
        server.on(
          'GET',
          '/api/v1/aftersales/open-pos',
          (req, body) => (
            200,
            {
              'asOf': today,
              'items': [
                {
                  'id': 907,
                  'companyId': 3,
                  'project': {'id': 52},
                  'client': {'id': 5, 'name': 'PT Sumber Tambang'},
                  'activityDate': '2026-10-04',
                  'docNo': 'PO-0907',
                  'items': <Object>[],
                  'value': 4250000,
                  'valueVisible': true,
                  'poStatus': 'belum_kirim',
                  'ageDays': 5,
                  'deliveries': 0,
                },
              ],
            },
          ),
        );
        server.on(
          'GET',
          '/api/v1/aftersales-activities',
          (req, body) => (200, {'items': <Object>[], 'nextCursor': null}),
        );
        const projects = [
          FieldProject(id: 41, label: 'K-001', kind: ProjectKind.kontrakUnit, companyId: 3),
          FieldProject(id: 52, label: 'AS-2026', kind: ProjectKind.aftersales, companyId: 3),
        ];
        String? masterTypes;
        server.on('GET', '/api/v1/masters', (req, body) {
          masterTypes = req.uri.queryParameters['types'];
          return (
            200,
            {
              'serverTime': '2026-10-09T06:00:00Z',
              'companies': [
                {'id': 3, 'code': 'DRMS', 'defaultGeofenceRadiusM': 100, 'version': 'v1'},
              ],
              'sharedVersion': 's1',
              'types': {
                'clients': {
                  'items': [
                    {'id': 4, 'name': 'CV Maju Jaya', 'company': 3, 'active': true},
                    {'id': 8, 'name': 'PT Pelanggan Baru', 'company': 3, 'active': true},
                    {'id': 9, 'name': 'CV Nonaktif', 'company': 3, 'active': false},
                  ],
                  'hasMore': false,
                },
              },
            },
          );
        });
        // a customer cached earlier that the master no longer lists (deactivated) is dropped
        await repo.putClients(sub, const [FieldClient(id: 9, companyId: 3, name: 'CV Nonaktif')]);
        expect(await service.refreshCaches(sub, projects, today: today, membershipIds: [3]), isTrue);
        expect(masterTypes, contains('clients'));
        expect(since, isNull);
        await service.refreshCaches(sub, projects, today: today, membershipIds: [3]);
        expect(since, '2026-10-09T06:00:00Z', reason: 'second pull is a delta');
        expect((await repo.contractUnits(sub, 41)).single.unitId, 9);
        final cols = await db.customSelect('PRAGMA table_info(field_contract_units)').get();
        expect(cols.map((c) => c.read<String>('name')), isNot(anyOf(contains('rate'), contains('rate_basis'))));
        final poCols = await db.customSelect('PRAGMA table_info(field_open_pos)').get();
        expect(poCols.map((c) => c.read<String>('name')), isNot(contains('value')));
        expect((await repo.openPos(sub, projectId: 52)).single.docNo, 'PO-0907');
        // master `clients` (incl. a customer without any unit / PO yet) + names seen in open POs as merge source
        expect((await repo.clients(sub, companyId: 3)).map((c) => c.name), [
          'CV Maju Jaya',
          'PT Pelanggan Baru',
          'PT Sumber Tambang',
        ]);
        final marks = await repo.timesheetMarks(sub, unitIds: [9]);
        expect(marks.single.hmEnd, 1023);
        final st = await service.timesheetStart(sub, projectId: 41, unitId: 9, date: today);
        expect(st.prevHm, 1023);
      },
    );

    test('offline refresh returns false and keeps the caches', () async {
      await repo.putClients(sub, [const FieldClient(id: 4, companyId: 3, name: 'CV Maju Jaya')]);
      await server.close();
      expect(
        await service.refreshCaches(sub, const [
          FieldProject(id: 52, label: 'AS', kind: ProjectKind.aftersales),
        ], today: today),
        isFalse,
      );
      expect((await repo.clients(sub)).single.name, 'CV Maju Jaya');
      server = await MockServer.start(); // tearDown closes it
    });
  });

  test('rejected create can be fixed and sent again (new op, same report uuid in the payload)', () async {
    final db = memoryDb();
    addTearDown(db.close);
    final outbox = OutboxRepository(db);
    await outbox.enqueueReport(
      type: SyncItemType.serviceReportUpsert,
      sub: sub,
      reportUuid: 'r-1',
      payload: const {'report_client_uuid': 'r-1'},
      photoUuids: const [],
      deviceTime: 't',
      elapsedMs: 1,
      bootId: 'b',
      offline: true,
      companyId: 3,
    );
    await outbox.setStatus('r-1', 'rejected', code: 'HM_DECREASED');
    final op = await outbox.enqueueReport(
      type: SyncItemType.serviceReportUpsert,
      sub: sub,
      reportUuid: 'r-1',
      payload: const {'report_client_uuid': 'r-1', 'hour_meter': 1030},
      photoUuids: const [],
      deviceTime: 't',
      elapsedMs: 2,
      bootId: 'b',
      offline: false,
      companyId: 3,
    );
    expect(op, isNot('r-1'));
    final rows = await outbox.all(sub);
    expect(rows.map((r) => r.status), containsAll(['rejected', 'pending']));
  });
}
