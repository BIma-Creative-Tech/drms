import 'dart:convert';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/core/time/device_clock.dart';
import 'package:proyekkas/core/util/async_lock.dart';
import 'package:proyekkas/features/auth/data/token_manager.dart';
import 'package:proyekkas/features/expense/application/draft_service.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/expense/data/expense_api.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/sync/application/sync_engine.dart';
import 'package:proyekkas/features/sync/background/background_sync.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/features/sync/data/sync_api.dart';

import '../support/fixtures.dart';
import '../support/harness.dart';
import '../support/mock_server.dart';
import '../support/seed.dart';

const sub = 'user-sub-1';

/// Process-wide name registry stand-in.
class MapRegistry implements PortRegistry {
  final Map<String, SendPort> names = {};
  @override
  SendPort? lookup(String name) => names[name];
  @override
  bool register(SendPort port, String name) {
    if (names.containsKey(name)) return false;
    names[name] = port;
    return true;
  }

  @override
  void remove(String name) => names.remove(name);
}

void main() {
  late MockServer server;
  late AppDatabase db;
  late MemorySecureStore store;
  late MapRegistry registry;
  var opened = 0;
  var closed = 0;

  setUp(() async {
    server = await MockServer.start();
    db = memoryDb();
    store = MemorySecureStore();
    registry = MapRegistry();
    opened = 0;
    closed = 0;
  });

  tearDown(() async {
    await db.close();
    await server.close();
  });

  BackgroundSyncRunner runner() {
    final client = testClient(server.base, StaticTokens());
    final expenseApi = ExpenseApi(client);
    return BackgroundSyncRunner(
      store: store,
      registry: registry,
      openDeps: () async {
        opened++;
        return BackgroundSyncDeps(
          engine: SyncEngine(
            outbox: OutboxRepository(db),
            drafts: DraftRepository(db),
            api: SyncApi(client),
            db: db,
            clock: FakeDeviceClock(),
            deviceId: () => '5b0c2f7e-2d1a-4e0b-8f5e-7a9d3c1b2e44',
            lock: AsyncLock(),
            uploadMedia: (b) => expenseApi.uploadMedia('receipts', b.bytes, filename: '${b.clientUuid}.jpg'),
          ),
          close: () async => closed++,
        );
      },
    )..pingTimeout = const Duration(milliseconds: 200);
  }

  group('BackgroundSyncRunner (E3-b)', () {
    test('app alive in this process → the UI isolate is asked to sync; no DB, no token use here', () async {
      final fg = ForegroundSyncPort.register(registry: registry);
      addTearDown(fg.dispose);
      final asked = ForegroundSyncPort.requests.first;
      final r = runner();
      expect(await r.run(), isTrue);
      expect(r.lastOutcome, BackgroundRunOutcome.delegatedToForeground);
      await asked.timeout(const Duration(seconds: 2));
      expect(opened, 0);
      expect(registry.names.containsKey(BackgroundSyncNames.backgroundPortName), isFalse, reason: 'released');
    });

    test('stale UI mapping (engine gone) is removed and the run continues', () async {
      final dead = ReceivePort()..close();
      registry.names[BackgroundSyncNames.foregroundPortName] = dead.sendPort;
      final r = runner();
      expect(await r.run(), isTrue);
      expect(registry.names.containsKey(BackgroundSyncNames.foregroundPortName), isFalse);
      expect(r.lastOutcome, BackgroundRunOutcome.notLoggedIn);
    });

    test('signed out → nothing is opened (queue stays locked to its user)', () async {
      store.data[SecureKeys.sessionSub] = sub; // sub kept after logout, refresh token gone
      final r = runner();
      expect(await r.run(), isTrue);
      expect(r.lastOutcome, BackgroundRunOutcome.notLoggedIn);
      expect(opened, 0);
    });

    test('app closed + session: the queued draft is sent via /sync/batch, DB closed afterwards', () async {
      store.data[SecureKeys.sessionSub] = sub;
      store.data[SecureKeys.refreshToken] = 'r1';
      final drafts = DraftRepository(db);
      final service = DraftService(
        drafts: drafts,
        outbox: OutboxRepository(db),
        api: ExpenseApi(testClient(server.base, StaticTokens())),
        clock: FakeDeviceClock(),
        lock: AsyncLock(),
      );
      await service.save(sub, seedDraft(withReceipts: false), online: false);
      server.on('POST', '/api/v1/sync/batch', (req, body) {
        final j = jsonDecode(body) as Map<String, dynamic>;
        return (
          200,
          {
            'batch_id': j['batch_id'],
            'server_time': '2026-09-26T01:00:00Z',
            'results': [
              for (final i in j['items'] as List)
                {'client_uuid': (i as Map)['client_uuid'], 'status': 'applied', 'server_id': '42', 'rev': 1},
            ],
          },
        );
      });
      final r = runner();
      expect(await r.run(), isTrue);
      expect(r.lastOutcome, BackgroundRunOutcome.synced);
      expect(server.pathsCalled(), contains('POST /api/v1/sync/batch'));
      expect(opened, 1);
      expect(closed, 1);
      expect((await drafts.load(sub, seedDraft().clientUuid))!.syncState, DraftSyncState.synced);
    });

    test('server unreachable → WorkManager retries later (false)', () async {
      store.data[SecureKeys.sessionSub] = sub;
      store.data[SecureKeys.refreshToken] = 'r1';
      await DraftService(
        drafts: DraftRepository(db),
        outbox: OutboxRepository(db),
        api: ExpenseApi(testClient(server.base, StaticTokens())),
        clock: FakeDeviceClock(),
        lock: AsyncLock(),
      ).save(sub, seedDraft(withReceipts: false), online: false);
      final r = runner();
      await server.close(); // connection refused
      expect(await r.run(), isFalse);
      expect(r.lastOutcome, BackgroundRunOutcome.retryLater);
      expect(closed, 1);
      server = await MockServer.start(); // for tearDown
    });

    test('a second live run in the process is skipped', () async {
      final other = ReceivePort();
      addTearDown(other.close);
      other.listen((m) {
        if (m is SendPort) m.send('busy');
      });
      registry.names[BackgroundSyncNames.backgroundPortName] = other.sendPort;
      final r = runner();
      expect(await r.run(), isTrue);
      expect(r.lastOutcome, BackgroundRunOutcome.alreadyRunning);
    });
  });

  group('token refresh guard (UI isolate)', () {
    test('waits for a live background run; a stale mapping is dropped', () async {
      final bg = ReceivePort();
      bg.listen((m) {
        if (m is SendPort) m.send('busy');
      });
      registry.names[BackgroundSyncNames.backgroundPortName] = bg.sendPort;
      var done = false;
      final wait = waitForBackgroundSync(
        registry: registry,
        poll: const Duration(milliseconds: 20),
      ).then((_) => done = true);
      await Future<void>.delayed(const Duration(milliseconds: 120));
      expect(done, isFalse);
      registry.remove(BackgroundSyncNames.backgroundPortName);
      bg.close();
      await wait;
      expect(done, isTrue);

      registry.names[BackgroundSyncNames.backgroundPortName] = (ReceivePort()..close()).sendPort;
      await waitForBackgroundSync(registry: registry, pingTimeout: const Duration(milliseconds: 50));
      expect(registry.names.containsKey(BackgroundSyncNames.backgroundPortName), isFalse);
    });

    test('TokenManager reads the refresh token AFTER beforeRefresh (rotated by the background run)', () async {
      server.on('POST', '/realms/drms-staging/protocol/openid-connect/token', (req, body) {
        expect(body, contains('refresh_token=r2'), reason: 'must use the token rotated in the other isolate');
        return (200, {'access_token': 'a', 'refresh_token': 'r3', 'expires_in': 300});
      });
      final s = MemorySecureStore()..data[SecureKeys.refreshToken] = 'r1';
      final tm = TokenManager(
        env: testEnv(server.base),
        store: s,
        beforeRefresh: () async => s.data[SecureKeys.refreshToken] = 'r2',
      );
      expect(await tm.refreshAccessToken(), 'a');
      expect(s.data[SecureKeys.refreshToken], 'r3');
    });
  });

  group('DraftService.importServerDraft (E3-d)', () {
    test('rebuilds the local draft from the server copy and supersedes older queue items', () async {
      final drafts = DraftRepository(db);
      final outbox = OutboxRepository(db);
      final service = DraftService(
        drafts: drafts,
        outbox: outbox,
        api: ExpenseApi(testClient(server.base, StaticTokens())),
        clock: FakeDeviceClock(),
        lock: AsyncLock(),
      );
      // An older local copy with a pending edit and a photo.
      final local = seedDraft();
      for (final m in local.mediaUuids) {
        await drafts.addMedia(sub, uuid: m, kind: 'receipt', bytes: Uint8List(10), sha256: 'x');
      }
      await service.save(sub, local, online: false);
      final detail = detailFromJson({
        ...detailJson(status: 'draft', allowed: const ['edit', 'submit']),
        'rev': 3,
        'clientUuid': local.clientUuid,
      });
      final imported = await service.importServerDraft(sub, detail);
      expect(imported.clientUuid, local.clientUuid);
      expect(await outbox.pendingForTarget(sub, local.clientUuid), isNull);
      final loaded = (await drafts.load(sub, local.clientUuid))!;
      expect(loaded.serverId, 42);
      expect(loaded.serverRev, 3);
      expect(loaded.syncState, DraftSyncState.synced);
      expect(loaded.title, 'Service Tronton');
      expect(loaded.lines.map((l) => l.clientUuid), ['l1', 'l2']);
      expect(loaded.lines.first.receipts.single.isServerReceipt, isTrue);

      expect(
        () => service.importServerDraft(sub, detailFromJson(detailJson(status: 'pending_ack'))),
        throwsA(isA<Object>()),
        reason: 'only drafts can be edited',
      );
    });
  });
}
