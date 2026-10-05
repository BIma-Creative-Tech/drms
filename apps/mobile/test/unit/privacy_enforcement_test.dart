import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/location/location_service.dart';
import 'package:proyekkas/core/media/compress_plan.dart';
import 'package:proyekkas/core/media/photo_compressor.dart';
import 'package:proyekkas/core/network/api_client.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/core/time/device_clock.dart';
import 'package:proyekkas/core/util/async_lock.dart';
import 'package:proyekkas/features/attendance/application/attendance_service.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/expense/data/expense_api.dart';
import 'package:proyekkas/features/sync/application/sync_engine.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/features/sync/data/sync_api.dart';
import 'package:proyekkas/features/sync/domain/sync_models.dart';

import '../support/harness.dart';
import '../support/mock_server.dart';

/// ADR 0018, owner decision 2026-10-05: while the minimum APK version is ≥ 0.3.3 the server refuses attendance
/// captures without the current privacy acknowledgement (`PRIVACY_ACK_REQUIRED`: 403 on the selfie upload, final
/// per-item rejection on /sync/batch). The APK maps it to a clear Indonesian text, never retries it and reloads
/// `/me` so the privacy notice screen comes back.
class _Compressor implements PhotoCompressor {
  @override
  Future<CompressedPhoto> compress(Uint8List raw, PhotoTarget target) async =>
      CompressedPhoto(Uint8List.fromList(raw.take(4).toList()), 'sha');
}

const _site = ProjectSite(id: 3, label: 'Ops Palangka', lat: -2.2, lng: 113.9, radiusM: 80, kind: SiteKind.costCenter);
const _fix = LocationFix(lat: -2.2003, lng: 113.9, accuracyM: 7.26, isMocked: false);
const _sub = 'staff-sub';
const _serverText = 'Absensi ditolak: Anda belum menekan "Saya mengerti" pada pemberitahuan privasi terbaru.';

Map<String, Object?> _problem() => {
  'type': 'about:blank',
  'title': 'Forbidden',
  'status': 403,
  'code': privacyAckRequiredCode,
  'detail': _serverText,
};

void main() {
  test('problem 403 PRIVACY_ACK_REQUIRED → the fixed Indonesian text (points to the notice)', () {
    final e = ProblemException.fromJson(403, _problem());
    expect(e.code, privacyAckRequiredCode);
    expect(e.message, privacyAckRequiredMessage);
    expect(privacyAckRequiredMessage, contains('Pemberitahuan privasi'));
    expect(privacyAckRequiredMessage, contains('Saya mengerti'));
  });

  test('sync rejection PRIVACY_ACK_REQUIRED → same text for every attendance type (not the generic error)', () {
    for (final type in ['attendance.check_in', 'attendance.check_out', 'attendance.on_behalf']) {
      expect(
        rejectionMessage(const [SyncError(code: privacyAckRequiredCode, message: _serverText)], type: type),
        privacyAckRequiredMessage,
      );
    }
  });

  group('SyncEngine + ApiClient', () {
    late MockServer server;
    late AppDatabase db;
    late DraftRepository drafts;
    late OutboxRepository outbox;
    late SyncEngine engine;
    late int callbacks;

    setUp(() async {
      server = await MockServer.start();
      db = memoryDb();
      drafts = DraftRepository(db);
      outbox = OutboxRepository(db);
      callbacks = 0;
      final clock = FakeDeviceClock(now: DateTime(2026, 10, 5, 7, 50), elapsed: 1000, boot: 'b-1');
      final client = ApiClient(
        baseUrl: '${server.base}/api/v1',
        tokens: StaticTokens(),
        headers: testDevice(),
        onPrivacyAckRequired: () => callbacks++,
      );
      final media = ExpenseApi(client);
      engine = SyncEngine(
        outbox: outbox,
        drafts: drafts,
        api: SyncApi(client),
        db: db,
        clock: clock,
        deviceId: () => 'd',
        lock: AsyncLock(),
        uploadMedia: (b) => media.uploadMedia(mediaUploadPath(b.kind), b.bytes, filename: 'x.jpg'),
      );
      await AttendanceService(drafts: drafts, outbox: outbox, clock: clock, compressor: _Compressor()).record(
        sub: _sub,
        kind: AttendanceKind.checkIn,
        site: _site,
        fix: _fix,
        rawSelfie: Uint8List.fromList(List.filled(20, 1)),
        online: true,
      );
    });

    tearDown(() async {
      await db.close();
      await server.close();
    });

    test('selfie upload 403 PRIVACY_ACK_REQUIRED → item rejected (final, no batch, no retry), /me reload', () async {
      server.on('POST', '/api/v1/media/selfies', (req, body) => (403, _problem()));
      final r = await engine.run(_sub);
      expect(server.pathsCalled(), ['POST /api/v1/media/selfies']);
      expect(r.privacyAckRequired, isTrue);
      expect(callbacks, 1, reason: 'ApiClient reports the code (foreground: refreshProfile)');
      final row = (await outbox.all(_sub)).single;
      expect(row.status, 'rejected');
      expect(row.lastErrorCode, privacyAckRequiredCode);
      expect(row.lastErrorMessage, privacyAckRequiredMessage);
      // a second run sends nothing (rejected is never retried)
      final again = await engine.run(_sub);
      expect(again.outcome, SyncRunOutcome.nothingToDo);
      expect(server.pathsCalled(), ['POST /api/v1/media/selfies']);
    });

    test('item rejected PRIVACY_ACK_REQUIRED by /sync/batch → final, clear text, flag for the /me reload', () async {
      server.on('POST', '/api/v1/media/selfies', (req, body) => (201, {'id': 66}));
      server.on('POST', '/api/v1/sync/batch', (req, body) {
        final j = jsonDecode(body) as Map<String, dynamic>;
        final item = (j['items'] as List).single as Map<String, dynamic>;
        return (
          200,
          {
            'batch_id': j['batch_id'],
            'server_time': '2026-10-05T00:00:00Z',
            'results': [
              {
                'client_uuid': item['client_uuid'],
                'status': 'rejected',
                'errors': [
                  {'code': privacyAckRequiredCode, 'message': _serverText},
                ],
              },
            ],
          },
        );
      });
      final r = await engine.run(_sub);
      expect(r.rejected, 1);
      expect(r.privacyAckRequired, isTrue);
      final row = (await outbox.all(_sub)).single;
      expect(row.status, 'rejected');
      expect(row.lastErrorCode, privacyAckRequiredCode);
      expect(row.lastErrorMessage, privacyAckRequiredMessage);
    });

    test('other rejections do not ask for the notice', () async {
      server.on('POST', '/api/v1/media/selfies', (req, body) => (201, {'id': 67}));
      server.on('POST', '/api/v1/sync/batch', (req, body) {
        final j = jsonDecode(body) as Map<String, dynamic>;
        final item = (j['items'] as List).single as Map<String, dynamic>;
        return (
          200,
          {
            'batch_id': j['batch_id'],
            'server_time': '2026-10-05T00:00:00Z',
            'results': [
              {
                'client_uuid': item['client_uuid'],
                'status': 'rejected',
                'errors': [
                  {'code': 'OUTSIDE_GEOFENCE', 'message': 'Di luar radius.'},
                ],
              },
            ],
          },
        );
      });
      final r = await engine.run(_sub);
      expect(r.privacyAckRequired, isFalse);
      expect(callbacks, 0);
    });
  });
}
