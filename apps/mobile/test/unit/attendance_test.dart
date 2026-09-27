import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/location/location_service.dart';
import 'package:proyekkas/core/media/compress_plan.dart';
import 'package:proyekkas/core/media/photo_compressor.dart';
import 'package:proyekkas/core/time/device_clock.dart';
import 'package:proyekkas/core/util/async_lock.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/attendance/application/attendance_service.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/expense/data/expense_api.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/features/sync/application/sync_engine.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/features/sync/data/sync_api.dart';

import '../support/harness.dart';
import '../support/mock_server.dart';

/// F4 gate "offline check-in synced with 'offline' flag and server time" — APK side.
class FakeCompressor implements PhotoCompressor {
  PhotoTarget? lastTarget;
  @override
  Future<CompressedPhoto> compress(Uint8List raw, PhotoTarget target) async {
    lastTarget = target;
    return CompressedPhoto(Uint8List.fromList(raw.take(8).toList()), 'sha-selfie');
  }
}

const sub = 'user-sub-1';
const site = ProjectSite(id: 7, label: 'P-01 — Gudang Contoh', lat: -2.21, lng: 113.91, radiusM: 100);
LocationFix fixAt(double dLat, {double accuracy = 10, bool mocked = false}) =>
    LocationFix(lat: -2.21 + dLat, lng: 113.91, accuracyM: accuracy, isMocked: mocked);

void main() {
  group('client geofence (same rule as the server)', () {
    test('0.001° latitude ≈ 111 m', () {
      final d = haversineM(-2.21, 113.91, -2.211, 113.91);
      expect(d, greaterThan(110));
      expect(d, lessThan(112));
    });

    test('inside / outside / accuracy capped at 50 m / mocked / no geofence', () {
      expect(checkSite(site, fixAt(0.0005)).check, SiteCheck.ok); // ≈ 56 m
      expect(checkSite(site, fixAt(0.0012)).check, SiteCheck.outside); // ≈ 133 m, accuracy 10
      expect(checkSite(site, fixAt(0.0012, accuracy: 40)).check, SiteCheck.ok);
      expect(checkSite(site, fixAt(0.0016, accuracy: 5000)).check, SiteCheck.outside); // ≈ 178 m > 150
      expect(checkSite(site, fixAt(0, mocked: true)).check, SiteCheck.mocked);
      expect(checkSite(const ProjectSite(id: 8, label: 'x'), fixAt(0)).check, SiteCheck.noGeofence);
      expect(checkSite(site, fixAt(0.0012)).distanceM, inInclusiveRange(132, 135));
    });

    test('site from the cached masters row; app config flag', () {
      final s = ProjectSite.fromMaster(
        const MasterItem(7, 'P-01', extra: {'lat': -2.21, 'lng': 113.91, 'radiusM': 100}),
      );
      expect(s.hasGeofence, isTrue);
      expect(ProjectSite.fromMaster(const MasterItem(8, 'P-02')).hasGeofence, isFalse);
      expect(
        AppConfig.fromJson({
          'features': {'syncAttendance': true},
        }).syncAttendance,
        isTrue,
      );
      expect(AppConfig.fromJson({}).syncAttendance, isFalse);
    });

    test('payload: selfie placeholder replaced by selfie_media_id; missing upload → null', () {
      final p = attendancePayload(site: site, fix: fixAt(0.0001, accuracy: 12.54), selfieUuid: 'sel-1');
      expect(p['accuracy_m'], 12.5);
      expect(p['camera_lens'], 'front');
      final resolved = resolveMediaIds(p, {'sel-1': 55})!;
      expect(resolved['selfie_media_id'], 55);
      expect(resolved.containsKey(selfiePlaceholderKey), isFalse);
      expect(resolveMediaIds(p, {}), isNull);
    });
  });

  group('offline check-in → queue → sync', () {
    late MockServer server;
    late AppDatabase db;
    late DraftRepository drafts;
    late OutboxRepository outbox;
    late FakeDeviceClock clock;
    late AttendanceService service;
    late SyncEngine engine;
    final uploads = <String>[];

    setUp(() async {
      server = await MockServer.start();
      db = memoryDb();
      drafts = DraftRepository(db);
      outbox = OutboxRepository(db);
      clock = FakeDeviceClock(now: DateTime(2026, 9, 21, 7, 58, 31), elapsed: 71711000, boot: 'b-7f3e');
      final compressor = FakeCompressor();
      service = AttendanceService(drafts: drafts, outbox: outbox, clock: clock, compressor: compressor);
      final client = testClient(server.base, StaticTokens());
      final api = ExpenseApi(client);
      uploads.clear();
      engine = SyncEngine(
        uploadMedia: (b) {
          uploads.add(b.kind);
          return api.uploadMedia(b.kind == 'selfie' ? 'selfies' : 'receipts', b.bytes, filename: '${b.clientUuid}.jpg');
        },
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

    test('recorded offline: selfie kept encrypted locally, item offline=true with device clock facts', () async {
      final id = await service.record(
        sub: sub,
        kind: AttendanceKind.checkIn,
        site: site,
        fix: fixAt(0.0002),
        rawSelfie: Uint8List.fromList(List.filled(32, 9)),
        online: false,
      );
      final row = (await outbox.all(sub)).single;
      expect(row.opUuid, id);
      expect(row.type, 'attendance.check_in');
      expect(row.offline, isTrue);
      expect(row.deviceTime, '2026-09-21T07:58:31${row.deviceTime.substring(19)}');
      expect(row.elapsedMs, 71711000);
      expect(row.bootId, 'b-7f3e');
      final selfieUuid = (jsonDecode(row.dependsOnJson) as List).single as String;
      final blob = await drafts.media(selfieUuid);
      expect(blob?.kind, 'selfie');
      expect(blob?.userSub, sub);
    });

    test('online again: selfie → POST /media/selfies, then the item with selfie_media_id; applied', () async {
      server.on('POST', '/api/v1/media/selfies', (req, body) => (201, {'id': 314, 'kind': 'selfies'}));
      Map<String, dynamic>? sent;
      server.on('POST', '/api/v1/sync/batch', (req, body) {
        final j = jsonDecode(body) as Map<String, dynamic>;
        sent = (j['items'] as List).single as Map<String, dynamic>;
        return (
          200,
          {
            'batch_id': j['batch_id'],
            'server_time': '2026-09-21T04:05:11Z',
            'results': [
              {
                'client_uuid': sent!['client_uuid'],
                'status': 'applied',
                'server_id': '91',
                'time_trust': 'estimated',
                'flags': ['OFFLINE'],
                'errors': [],
              },
            ],
          },
        );
      });
      await service.record(
        sub: sub,
        kind: AttendanceKind.checkIn,
        site: site,
        fix: fixAt(0.0002),
        rawSelfie: Uint8List.fromList(List.filled(32, 9)),
        online: false,
      );
      final r = await engine.run(sub);
      expect(r.outcome, SyncRunOutcome.done);
      expect(uploads, ['selfie']);
      expect(server.pathsCalled(), ['POST /api/v1/media/selfies', 'POST /api/v1/sync/batch']);
      expect(sent!['type'], 'attendance.check_in');
      expect(sent!['offline'], isTrue);
      expect(sent!['payload'], containsPair('selfie_media_id', 314));
      expect(sent!['payload'], containsPair('project_id', 7));
      expect((sent!['payload'] as Map).containsKey(selfiePlaceholderKey), isFalse);
      expect((await outbox.all(sub)).single.status, 'applied');
    });

    test('server rejection (outside radius) is final and shown with the server text', () async {
      server.on('POST', '/api/v1/media/selfies', (req, body) => (201, {'id': 315}));
      server.on('POST', '/api/v1/sync/batch', (req, body) {
        final j = jsonDecode(body) as Map<String, dynamic>;
        final item = (j['items'] as List).single as Map<String, dynamic>;
        return (
          200,
          {
            'batch_id': j['batch_id'],
            'server_time': '2026-09-21T04:05:11Z',
            'results': [
              {
                'client_uuid': item['client_uuid'],
                'status': 'rejected',
                'errors': [
                  {'code': 'OUTSIDE_GEOFENCE', 'message': 'Di luar radius project (1112 m dari titik, radius 100 m).'},
                ],
              },
            ],
          },
        );
      });
      await service.record(
        sub: sub,
        kind: AttendanceKind.checkOut,
        site: site,
        fix: fixAt(0.0002),
        rawSelfie: Uint8List.fromList(List.filled(32, 9)),
        online: true,
      );
      await engine.run(sub);
      final row = (await outbox.all(sub)).single;
      expect(row.status, 'rejected');
      expect(row.offline, isFalse);
      expect(row.lastErrorMessage, 'Di luar radius project (1112 m dari titik, radius 100 m).');
    });
  });
}
