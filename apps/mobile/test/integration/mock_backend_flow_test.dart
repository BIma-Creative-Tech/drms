// Login-less end-to-end flows against a stateful mock of `/api/v1` (loopback HttpServer):
// app config gate, offline draft → sync (media first, idempotent replay), online "Ajukan",
// Owner inbox → approve with drawn signature / reject with reason. Real ApiClient, repositories,
// SyncEngine and DraftService; encrypted-DB code path uses an in-memory drift DB.
import 'dart:convert';
import 'dart:typed_data';

import 'package:drift/drift.dart' show Value;
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/time/device_clock.dart';
import 'package:proyekkas/core/util/async_lock.dart';
import 'package:proyekkas/features/app_config/data/app_config_api.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/approvals/data/approvals_api.dart';
import 'package:proyekkas/features/expense/application/draft_service.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/expense/data/expense_api.dart';
import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/sync/application/sync_engine.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/features/sync/data/sync_api.dart';
import 'package:proyekkas/features/sync/domain/sync_models.dart';

import '../support/fixtures.dart';
import '../support/harness.dart';
import '../support/mock_server.dart';
import '../support/seed.dart';

const sub = 'user-sub-1';

/// Minimal stateful backend implementing the ADR 0010 sync rules.
class FakeBackend {
  FakeBackend(this.server);
  final MockServer server;
  final media = <String, String>{}; // uuid → sha256
  final receipts = <String, Map<String, dynamic>>{}; // client_uuid → stored result
  int applies = 0;
  bool syncDown = false;

  void install() {
    server.on('POST', '/api/v1/media/receipts', (req, body) {
      final id = 900 + media.length + 1;
      media['$id'] = 'uploaded';
      return (
        201,
        {
          'id': id,
          'kind': 'receipts',
          'mimeType': 'image/jpeg',
          'filesize': 10,
          'width': 1,
          'height': 1,
          'sha256Original': null,
        },
      );
    });
    server.on('POST', '/api/v1/sync/batch', (req, body) {
      if (syncDown) return (503, {'type': 'about:blank', 'title': 'Unavailable', 'status': 503});
      final j = jsonDecode(body) as Map<String, dynamic>;
      final results = <Map<String, dynamic>>[];
      for (final item in (j['items'] as List).cast<Map<String, dynamic>>()) {
        final id = item['client_uuid'] as String;
        final stored = receipts[id];
        if (stored != null) {
          results.add({...stored, 'status': 'duplicate'});
          continue;
        }
        final ids = [
          for (final l in ((item['payload'] as Map)['lines'] as List? ?? const []))
            for (final r in ((l as Map)['receipts'] as List? ?? const [])) '${(r as Map)['media_id']}',
        ];
        final missing = ids.where((m) => !media.containsKey(m));
        if (missing.isNotEmpty) {
          results.add({
            'client_uuid': id,
            'status': 'deferred',
            'errors': [
              {'code': 'MEDIA_MISSING'},
            ],
          });
          continue;
        }
        applies++;
        final r = {
          'client_uuid': id,
          'status': 'applied',
          'server_id': '4$applies',
          'rev': 1,
          'received_at': '2026-09-21T05:10:02Z',
          'time_trust': 'estimated',
          'flags': ['OFFLINE'],
          'errors': [],
        };
        receipts[id] = r;
        results.add(r);
      }
      return (200, {'batch_id': j['batch_id'], 'server_time': '2026-09-21T05:10:02Z', 'results': results});
    });
  }
}

void main() {
  late MockServer server;
  late FakeBackend backend;
  late AppDatabase db;
  late DraftRepository drafts;
  late OutboxRepository outbox;
  late SyncEngine engine;
  late DraftService service;
  late SyncApi syncApi;
  late ExpenseApi expenseApi;
  late ApprovalsApi approvals;

  setUp(() async {
    server = await MockServer.start();
    backend = FakeBackend(server)..install();
    db = memoryDb();
    drafts = DraftRepository(db);
    outbox = OutboxRepository(db);
    final client = testClient(server.base, StaticTokens());
    final clock = FakeDeviceClock(now: DateTime(2026, 9, 21, 12, 50));
    final lock = AsyncLock();
    syncApi = SyncApi(client);
    expenseApi = ExpenseApi(client);
    approvals = ApprovalsApi(client);
    engine = SyncEngine(
      uploadMedia: (b) => expenseApi.uploadMedia('receipts', b.bytes, filename: '${b.clientUuid}.jpg'),
      outbox: outbox,
      drafts: drafts,
      api: syncApi,
      db: db,
      clock: clock,
      deviceId: () => '5b0c2f7e-2d1a-4e0b-8f5e-7a9d3c1b2e44',
      lock: lock,
    );
    service = DraftService(drafts: drafts, outbox: outbox, api: expenseApi, clock: clock, lock: lock);
  });

  tearDown(() async {
    await db.close();
    await server.close();
  });

  Future<DraftRequest> saveSeedOffline() async {
    final d = seedDraft();
    for (final m in d.mediaUuids) {
      await drafts.addMedia(
        sub,
        uuid: m,
        kind: 'receipt',
        bytes: Uint8List.fromList(utf8.encode('jpeg-$m')),
        sha256: 'sha-$m',
      );
    }
    return service.save(sub, d, online: false);
  }

  group('app config (before login, public)', () {
    test('endpoint not deployed yet → null, app continues', () async {
      final cfg = await AppConfigApi(testClient(server.base, StaticTokens())).fetch();
      expect(cfg, isNull);
      expect(evaluateVersion('0.1.0', cfg), VersionGate.ok);
      expect(server.calls.single.$3.containsKey('authorization'), isFalse);
    });

    test('min version above the APK → update required', () async {
      server.on(
        'GET',
        '/api/v1/app/config',
        (req, body) => (
          200,
          {'minAppVersion': '0.2.0', 'latestAppVersion': '0.3.0', 'appDownloadUrl': 'https://example.test/apk'},
        ),
      );
      final cfg = await AppConfigApi(testClient(server.base, StaticTokens())).fetch(version: '0.1.0');
      expect(server.calls.single.$2, '/api/v1/app/config');
      expect(evaluateVersion('0.1.0', cfg), VersionGate.updateRequired);
      expect(cfg!.pushEnabled, isFalse);
      expect(cfg.appDownloadUrl, 'https://example.test/apk');
    });
  });

  test('offline draft → server down (deferred) → online sync once → replay is duplicate', () async {
    await saveSeedOffline();
    backend.syncDown = true;
    final r1 = await engine.run(sub);
    expect(r1.deferred, 1);
    expect(backend.media, hasLength(3), reason: 'photos uploaded (POST /media/receipts) before the batch');

    backend.syncDown = false;
    // Back-off not elapsed → nothing due yet; force due by retrying the "failed" path manually.
    await (db.update(db.outbox)).write(const OutboxCompanion(nextAttemptAt: Value(null)));
    final r2 = await engine.run(sub);
    expect(r2.applied, 1);
    expect(backend.applies, 1);
    final d = await drafts.load(sub, seedDraft().clientUuid);
    expect(d!.syncState, DraftSyncState.synced);
    expect(d.serverId, 41);

    // Replay of the same batch (e.g. response lost) must not apply twice.
    final replay = await syncApi.postBatch(
      batchId: '0192f7b0-0000-7000-8000-000000000001',
      deviceId: '5b0c2f7e-2d1a-4e0b-8f5e-7a9d3c1b2e44',
      clock: const ClockInfo(deviceTime: '2026-09-21T13:10:00+08:00', elapsedMs: 1, bootId: 'b-1'),
      items: [
        QueuedItem(
          clientUuid: seedDraft().clientUuid,
          type: SyncItemType.expenseDraftUpsert,
          payload: const {},
          deviceTime: '2026-09-21T12:50:00+08:00',
          elapsedMs: 1,
        ),
      ],
    );
    expect(replay.results.single.status, SyncItemStatus.duplicate);
    expect(replay.results.single.serverId, '41');
    expect(backend.applies, 1);
  });

  test('online "Ajukan": create (idempotent by clientUuid) → receipts → submit', () async {
    final saved = await saveSeedOffline();
    var receiptPosts = 0;
    server.on('POST', '/api/v1/expense-requests', (req, body) {
      final b = jsonDecode(body) as Map<String, dynamic>;
      expect(b['clientUuid'], saved.clientUuid);
      expect(req.headers.value('idempotency-key'), saved.clientUuid);
      return (201, detailJson(status: 'draft', allowed: ['edit', 'submit'], approvals: const [])..['receipts'] = []);
    });
    var mediaId = 900;
    server.on('POST', '/api/v1/media/receipts', (req, body) {
      expect(body, contains('filename='));
      return (
        201,
        {
          'id': ++mediaId,
          'kind': 'receipts',
          'mimeType': 'image/jpeg',
          'filesize': 10,
          'width': 1,
          'height': 1,
          'sha256Original': null,
        },
      );
    });
    server.on('POST', '/api/v1/expense-requests/42/receipts', (req, body) {
      receiptPosts++;
      final b = jsonDecode(body) as Map<String, dynamic>;
      expect(b.keys.toSet(), {'lineId', 'receiptNo', 'vendorName', 'receiptDate', 'receiptTime', 'amount', 'imageId'});
      return (
        201,
        detailJson(status: 'draft', allowed: ['submit'], approvals: const [])
          ..['receipts'] = [
            {
              'id': 600 + receiptPosts,
              'lineId': b['lineId'],
              'lineNo': 1,
              'receiptNo': null,
              'vendorName': 'v',
              'receiptDate': '2026-09-21',
              'amount': b['amount'],
              'imageId': b['imageId'],
              'status': 'pending',
            },
          ],
      );
    });
    server.on('POST', '/api/v1/expense-requests/42/submit', (req, body) {
      expect(req.headers.value('idempotency-key'), isNotNull);
      return (200, detailJson(status: 'pending_ack', allowed: const []));
    });

    final detail = await service.submit(sub, saved);
    expect(detail.docNo, '228/PB-DRMS/20/IX/2026');
    // Only 2 of 3 local lines exist in the fixture's server lines (no 1 and 2) → 2 receipts posted.
    expect(receiptPosts, 2);
    final order = server.pathsCalled().toList();
    expect(order.first, 'POST /api/v1/expense-requests');
    expect(order.last, 'POST /api/v1/expense-requests/42/submit');
    final local = await drafts.load(sub, saved.clientUuid);
    expect(local!.syncState, DraftSyncState.submitted);
    expect(await drafts.media(saved.lines.first.receipts.first.mediaUuid), isNull, reason: 'local photos purged');
    expect(await outbox.due(sub, DateTime(2030)), isEmpty, reason: 'queued upsert superseded');
  });

  test('Owner: inbox → approve with drawn signature; reject sends the reason', () async {
    server.on('GET', '/api/v1/approvals/inbox', (req, body) => (200, inboxJson()));
    server.on('POST', '/api/v1/media/signatures', (req, body) {
      expect(body, contains('image/png'));
      return (
        201,
        {
          'id': 77,
          'kind': 'signatures',
          'mimeType': 'image/png',
          'filesize': 10,
          'width': 800,
          'height': 300,
          'sha256Original': null,
        },
      );
    });
    Map<String, dynamic>? approveBody;
    Map<String, dynamic>? rejectBody;
    server.on('POST', '/api/v1/expense-requests/42/approve', (req, body) {
      approveBody = jsonDecode(body) as Map<String, dynamic>;
      return (200, detailJson(status: 'approved', allowed: const []));
    });
    server.on('POST', '/api/v1/expense-requests/42/reject', (req, body) {
      rejectBody = jsonDecode(body) as Map<String, dynamic>;
      return (200, detailJson(status: 'rejected', allowed: const []));
    });

    final inbox = await approvals.inbox();
    expect(inbox.items.single.budget.pctAfter, 88.25);
    final sig = await approvals.uploadSignature(Uint8List.fromList([137, 80, 78, 71]));
    await approvals.decide(
      42,
      Decision.approve,
      idempotencyKey: '0192f7b0-0000-7000-8000-00000000000a',
      signatureMediaId: sig,
    );
    expect(approveBody, {'signatureMediaId': 77});
    await approvals.decide(
      42,
      Decision.reject,
      idempotencyKey: '0192f7b0-0000-7000-8000-00000000000b',
      reason: 'Nota kurang',
    );
    expect(rejectBody, {'reason': 'Nota kurang'}, reason: 'no signatureMediaId → profile signature');
    final idem = server.calls.where((c) => c.$2.endsWith('/approve')).single.$3['idempotency-key'];
    expect(idem, '0192f7b0-0000-7000-8000-00000000000a');
  });
}
