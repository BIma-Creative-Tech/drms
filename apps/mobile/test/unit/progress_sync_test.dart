import 'dart:convert';
import 'dart:typed_data';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/media/compress_plan.dart';
import 'package:proyekkas/core/media/photo_compressor.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/core/time/device_clock.dart';
import 'package:proyekkas/core/util/async_lock.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/expense/data/expense_api.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/progress/application/progress_service.dart';
import 'package:proyekkas/features/progress/data/progress_api.dart';
import 'package:proyekkas/features/progress/data/progress_repository.dart';
import 'package:proyekkas/features/progress/domain/progress.dart';
import 'package:proyekkas/features/sync/application/sync_engine.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/features/sync/data/sync_api.dart';
import 'package:proyekkas/features/sync/domain/sync_models.dart';

import '../support/harness.dart';
import '../support/mock_server.dart';
import '../support/seed.dart';

/// E4 APK: progress reports through the offline queue (`progress_report.draft_upsert`) and the online
/// fallback when `features.syncProgressReports` is off. Fictional data only.
class FakeCompressor implements PhotoCompressor {
  final targets = <PhotoTarget>[];
  @override
  Future<CompressedPhoto> compress(Uint8List raw, PhotoTarget target) async {
    targets.add(target);
    return CompressedPhoto(Uint8List.fromList(raw.take(6).toList()), 'sha-${raw.length}');
  }
}

const sub = 'user-sub-pm';

Map<String, dynamic> serverCopy({int id = 501, int rev = 2, double pctAfter = 60, String? editableUntil}) => {
  'id': id,
  'client_uuid': null,
  'rev': rev,
  'doc_no': 'LP/2609/0007',
  'project_id': 7,
  'stage_id': 31,
  'report_date': '2026-09-26',
  'pct_before': 40,
  'pct_after': pctAfter,
  'project_pct_after': 52.5,
  'work': 'Pengecoran kolom lantai 2 (versi web)',
  'issues': null,
  'photo_media_ids': [901, 902],
  'offline': false,
  'editable_until': editableUntil ?? '2026-09-27T02:00:00Z',
  'updated_at': '2026-09-26T03:00:00Z',
};

void main() {
  late MockServer server;
  late AppDatabase db;
  late DraftRepository drafts;
  late OutboxRepository outbox;
  late ProgressRepository repo;
  late ProgressService service;
  late SyncEngine engine;
  late FakeDeviceClock clock;
  late FakeCompressor compressor;
  final uploads = <String>[];
  final batches = <Map<String, dynamic>>[];

  setUp(() async {
    server = await MockServer.start();
    db = memoryDb();
    drafts = DraftRepository(db);
    outbox = OutboxRepository(db);
    repo = ProgressRepository(db);
    clock = FakeDeviceClock(now: DateTime(2026, 9, 26, 10, 15), elapsed: 5000000, boot: 'b-9');
    compressor = FakeCompressor();
    final client = testClient(server.base, StaticTokens());
    final media = ExpenseApi(client);
    final lock = AsyncLock();
    uploads.clear();
    batches.clear();
    service = ProgressService(
      repo: repo,
      drafts: drafts,
      outbox: outbox,
      api: ProgressApi(client),
      media: media,
      clock: clock,
      compressor: compressor,
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
      progress: repo,
      uploadMedia: (b) {
        uploads.add(mediaUploadPath(b.kind));
        return media.uploadMedia(mediaUploadPath(b.kind), b.bytes, filename: '${b.clientUuid}.jpg');
      },
    );
    var nextMedia = 700;
    server.on('POST', '/api/v1/media/progress-photos', (req, body) => (201, {'id': ++nextMedia}));
  });

  tearDown(() async {
    await db.close();
    await server.close();
  });

  /// Answers every batch item with [status] (+ extra fields) and records the request.
  void answerBatch(String status, {Map<String, dynamic> Function(Map<String, dynamic> item)? extra}) {
    server.on('POST', '/api/v1/sync/batch', (req, body) {
      final j = jsonDecode(body) as Map<String, dynamic>;
      batches.add(j);
      return (
        200,
        {
          'batch_id': j['batch_id'],
          'server_time': '2026-09-26T02:15:03Z',
          'results': [
            for (final i in (j['items'] as List).cast<Map<String, dynamic>>())
              {
                'client_uuid': i['client_uuid'],
                'status': status,
                'server_id': '501',
                'rev': 1,
                'received_at': '2026-09-26T02:15:03Z',
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

  Future<ProgressDraft> newReport({int photos = 2, bool online = false, bool queue = true}) async {
    final ids = <String>[];
    for (var i = 0; i < photos; i++) {
      ids.add(await service.addPhoto(sub, Uint8List.fromList(List.filled(40 + i, i))));
    }
    final d = service
        .newDraft(projectId: 7, projectLabel: 'P-07 — Gudang Contoh', stageId: 31)
        .copyWith(
          stageLabel: 'Struktur',
          pctBefore: 40,
          pctAfter: 55.5,
          work: 'Pengecoran kolom lantai 2',
          issues: 'Hujan sore',
          photoUuids: ids,
        );
    await service.save(sub, d, online: online, queueEnabled: queue);
    return d;
  }

  group('offline queue (features.syncProgressReports = true)', () {
    test('saved offline: photos compressed to the progress target and kept encrypted; one queued item', () async {
      final d = await newReport();
      expect(compressor.targets, everyElement(PhotoTarget.receipt), reason: '1600 px / ≤ 400 KB, EXIF dropped');
      final row = (await outbox.all(sub)).single;
      expect(row.type, SyncItemType.progressReportUpsert);
      expect(row.opUuid, d.clientUuid, reason: 'first op of a report uses the report uuid');
      expect(row.offline, isTrue);
      expect(row.baseRev, isNull);
      expect(OutboxRepository.mediaDeps(row), d.photoUuids);
      final local = await repo.load(sub, d.clientUuid);
      expect(local!.syncState, ProgressSyncState.queued);
      expect((await drafts.media(d.photoUuids.first))!.kind, 'progress');
      expect(await repo.load('other-user', d.clientUuid), isNull, reason: 'locked to the sub');
    });

    test('editing before sending updates the same queued operation', () async {
      final d = await newReport(photos: 1);
      await service.save(sub, d.copyWith(work: 'Pengecoran kolom + balok'), online: false, queueEnabled: true);
      final rows = await outbox.all(sub);
      expect(rows, hasLength(1));
      expect((jsonDecode(rows.single.payloadJson) as Map)['work'], 'Pengecoran kolom + balok');
    });

    test(
      'online again: photos → /media/progress-photos, item with photo_media_ids; applied → local copy gone',
      () async {
        answerBatch('applied');
        final d = await newReport();
        final r = await engine.run(sub);
        expect(r.outcome, SyncRunOutcome.done);
        expect(uploads, ['progress-photos', 'progress-photos']);
        final item = ((batches.single['items'] as List).single as Map).cast<String, dynamic>();
        expect(item['type'], 'progress_report.draft_upsert');
        expect(item['offline'], isTrue);
        expect(item['base_rev'], isNull);
        final p = (item['payload'] as Map).cast<String, dynamic>();
        expect(p['report_client_uuid'], d.clientUuid);
        expect(p['project_id'], 7);
        expect(p['stage_id'], 31);
        expect(p['pct_after'], 55.5);
        expect(p['photo_media_ids'], [701, 702]);
        expect(p.containsKey(progressPhotosPlaceholderKey), isFalse);
        expect(await repo.load(sub, d.clientUuid), isNull);
        expect(await drafts.media(d.photoUuids.first), isNull, reason: 'photos are on the server now');
        expect((await outbox.all(sub)).single.status, 'applied');
      },
    );

    test('replay after a lost answer: duplicate counts as applied (idempotent per client_uuid)', () async {
      server.on('POST', '/api/v1/sync/batch', (req, body) {
        final j = jsonDecode(body) as Map<String, dynamic>;
        final i = (j['items'] as List).single as Map;
        return (
          200,
          {
            'batch_id': j['batch_id'],
            'server_time': '2026-09-26T02:15:03Z',
            'results': [
              {
                'client_uuid': i['client_uuid'],
                'status': 'duplicate',
                'original_status': 'applied',
                'server_id': '501',
              },
            ],
          },
        );
      });
      final d = await newReport(photos: 0);
      expect((await engine.run(sub)).applied, 1);
      expect(await repo.load(sub, d.clientUuid), isNull);
    });

    test('stale base_rev → conflict: server wins, local version kept beside server_report', () async {
      answerBatch('conflict', extra: (_) => {'rev': 2, 'server_report': serverCopy()});
      final d = await newReport(photos: 1);
      final r = await engine.run(sub);
      expect(r.conflicts, 1);
      final local = (await repo.load(sub, d.clientUuid))!;
      expect(local.syncState, ProgressSyncState.conflict);
      expect(local.conflictCopy!.rev, 2);
      expect(local.conflictCopy!.pctAfter, 60);
      expect(local.conflictCopy!.photoCount, 2);
      expect(local.work, 'Pengecoran kolom lantai 2', reason: 'the phone version is not overwritten');
      expect((await outbox.all(sub)).single.status, 'conflict');
    });

    test('conflict → "kirim versi HP": new op, base_rev = server rev, report_id + reason, only new photos', () async {
      answerBatch('conflict', extra: (_) => {'rev': 2, 'server_report': serverCopy()});
      final d = await newReport(photos: 1);
      await engine.run(sub);
      await service.resendMine(sub, d.clientUuid, reason: 'Angka dari lapangan', online: true, queueEnabled: true);
      final pending = (await outbox.all(sub)).where((r) => r.status == 'pending').single;
      expect(pending.opUuid, isNot(d.clientUuid));
      expect(pending.baseRev, 2);
      final p = jsonDecode(pending.payloadJson) as Map<String, dynamic>;
      expect(p['report_id'], 501);
      expect(p['reason'], 'Angka dari lapangan');
      expect(p['pct_after'], 55.5, reason: 'differs from the server 60 → sent');
      expect(p.containsKey('project_id'), isFalse);
      answerBatch('applied');
      await engine.run(sub);
      final sent = ((batches.last['items'] as List).single as Map).cast<String, dynamic>();
      expect(sent['base_rev'], 2);
      expect((sent['payload'] as Map)['photo_media_ids'], [701]);
      expect(await repo.load(sub, d.clientUuid), isNull);
    });

    test('conflict → "pakai versi server": local copy + photos removed, queue no longer asks for attention', () async {
      answerBatch('conflict', extra: (_) => {'rev': 2, 'server_report': serverCopy()});
      final d = await newReport(photos: 1);
      await engine.run(sub);
      await service.useServerVersion(sub, d.clientUuid);
      expect(await repo.load(sub, d.clientUuid), isNull);
      expect(await drafts.media(d.photoUuids.single), isNull);
      expect((await outbox.all(sub)).single.status, 'superseded');
    });

    test('edit of a server report after 24 h: NOT_EDITABLE → rejected with the server message and copy', () async {
      answerBatch(
        'rejected',
        extra: (_) => {
          'errors': [
            {'code': 'NOT_EDITABLE', 'message': 'Laporan hanya dapat diedit 24 jam setelah dibuat.'},
          ],
          'server_report': serverCopy(editableUntil: '2026-09-25T00:00:00Z'),
        },
      );
      final server = ProgressReport.fromJson({
        'id': 501,
        'project': {'id': 7, 'code': 'P-07', 'name': 'Gudang Contoh'},
        'stage': {'id': 31, 'name': 'Struktur', 'weightPct': 30},
        'reportDate': '2026-09-24',
        'pctBefore': 40,
        'pctAfter': 60,
        'work': 'Pengecoran',
        'photos': [
          {'id': 901},
        ],
        'rev': 3,
        'editable': true,
        'editableUntil': '2026-09-25T00:00:00Z',
        'clientUuid': '0192f6d0-aaaa-7bbb-8ccc-00000000e501',
      });
      final edit = (await service.startEdit(sub, server)).copyWith(work: 'Pengecoran (koreksi)', reason: 'Salah ketik');
      expect(edit.isEdit, isTrue);
      expect(edit.serverPhotoCount, 1);
      await service.save(sub, edit, online: true, queueEnabled: true);
      final row = (await outbox.all(sub)).single;
      expect(row.baseRev, 3);
      final p = jsonDecode(row.payloadJson) as Map<String, dynamic>;
      expect(p.containsKey('pct_after'), isFalse, reason: 'unchanged → not sent (only the latest report may change %)');
      await engine.run(sub);
      final local = (await repo.load(sub, edit.clientUuid))!;
      expect(local.syncState, ProgressSyncState.rejected);
      expect(local.lastError, 'Laporan hanya dapat diedit 24 jam setelah dibuat.');
      expect(local.conflictCopy!.editableAt(DateTime.utc(2026, 9, 26)), isFalse);
    });

    test('server without the item type (unsupported) keeps it queued without counting an attempt', () async {
      answerBatch('unsupported');
      final d = await newReport(photos: 0);
      final r = await engine.run(sub);
      expect(r.deferred, 1);
      final row = (await outbox.all(sub)).single;
      expect(row.status, 'pending');
      expect(row.attempts, 0);
      expect((await repo.load(sub, d.clientUuid))!.syncState, ProgressSyncState.queued);
    });

    test('photo upload refused (413) → report rejected with the message, nothing sent', () async {
      server.on(
        'POST',
        '/api/v1/media/progress-photos',
        (req, body) => (413, {'title': 'Too large', 'status': 413, 'detail': 'Ukuran file terlalu besar.'}),
      );
      answerBatch('applied');
      final d = await newReport(photos: 1);
      await engine.run(sub);
      expect(batches, isEmpty);
      final local = (await repo.load(sub, d.clientUuid))!;
      expect(local.syncState, ProgressSyncState.rejected);
      expect(local.lastErrorCode, 'MEDIA_413');
    });

    test('discard of an unsent report removes it, its photos and closes the queued op', () async {
      final d = await newReport(photos: 2);
      await service.discard(sub, d.clientUuid);
      expect(await repo.load(sub, d.clientUuid), isNull);
      for (final p in d.photoUuids) {
        expect(await drafts.media(p), isNull);
      }
      expect((await outbox.all(sub)).single.status, 'superseded');
      expect(await outbox.due(sub, clock.now()), isEmpty);
    });
  });

  group('online only (features.syncProgressReports = false)', () {
    test('POST /progress-reports with Idempotency-Key = report uuid and uploaded photo ids', () async {
      Map<String, dynamic>? sent;
      String? idem;
      server.on('POST', '/api/v1/progress-reports', (req, body) {
        sent = jsonDecode(body) as Map<String, dynamic>;
        idem = req.headers.value('idempotency-key');
        return (
          201,
          {
            'id': 77,
            'project': {'id': 7},
            'stage': {'id': 31},
            'reportDate': '2026-09-26',
            'pctBefore': 40,
            'pctAfter': 55.5,
            'work': 'x',
            'rev': 1,
          },
        );
      });
      final d = await newReport(online: true, queue: false);
      expect(idem, d.clientUuid);
      expect(sent!['clientUuid'], d.clientUuid);
      expect(sent!['photoIds'], [701, 702]);
      expect(sent!['pctAfter'], 55.5);
      expect(await outbox.all(sub), isEmpty, reason: 'nothing queued when the server disabled the queue');
      expect(await repo.load(sub, d.clientUuid), isNull);
    });

    test('offline: NetworkException, report kept on the phone as "belum terkirim", sent later', () async {
      await expectLater(newReport(photos: 1, online: false, queue: false), throwsA(isA<NetworkException>()));
      final open = await repo.watchOpen(sub).first;
      expect(open.single.syncState, ProgressSyncState.local);
      server.on(
        'POST',
        '/api/v1/progress-reports',
        (req, body) => (
          201,
          {
            'id': 78,
            'project': {'id': 7},
            'stage': {'id': 31},
            'reportDate': '2026-09-26',
            'pctBefore': 40,
            'pctAfter': 55.5,
            'work': 'x',
          },
        ),
      );
      await service.sendLocal(sub, open.single.clientUuid);
      expect(await repo.load(sub, open.single.clientUuid), isNull);
    });

    test('PROGRESS_DECREASED from the server marks the local report rejected', () async {
      server.on(
        'POST',
        '/api/v1/progress-reports',
        (req, body) => (
          409,
          {
            'title': 'Conflict',
            'status': 409,
            'code': 'PROGRESS_DECREASED',
            'detail': 'Progress tahapan tidak boleh turun (sekarang 60%).',
          },
        ),
      );
      await expectLater(newReport(photos: 0, online: true, queue: false), throwsA(isA<ProblemException>()));
      final local = (await repo.watchOpen(sub).first).single;
      expect(local.syncState, ProgressSyncState.rejected);
      expect(local.lastError, contains('tidak boleh turun'));
    });

    test('online edit: PATCH with reason, only new photos as addPhotoIds', () async {
      Map<String, dynamic>? sent;
      server.on('PATCH', '/api/v1/progress-reports/501', (req, body) {
        sent = jsonDecode(body) as Map<String, dynamic>;
        return (
          200,
          {
            'id': 501,
            'project': {'id': 7},
            'stage': {'id': 31},
            'reportDate': '2026-09-26',
            'pctBefore': 40,
            'pctAfter': 60,
            'work': 'x',
          },
        );
      });
      final photo = await service.addPhoto(sub, Uint8List.fromList(List.filled(50, 1)));
      final d = ProgressDraft(
        clientUuid: '0192f6d0-aaaa-7bbb-8ccc-00000000e502',
        projectId: 7,
        stageId: 31,
        pctBefore: 40,
        pctAfter: 62,
        work: 'Pengecoran selesai',
        photoUuids: [photo],
        serverPhotoCount: 2,
        reason: 'Tambah foto',
        serverId: 501,
        serverRev: 2,
        serverPctAfter: 60,
      );
      await service.save(sub, d, online: true, queueEnabled: false);
      expect(sent!['reason'], 'Tambah foto');
      expect(sent!['pctAfter'], 62);
      expect(sent!['addPhotoIds'], [701]);
    });
  });

  test('regression: saving an expense draft never deletes pending selfie / progress photos', () async {
    await drafts.addMedia(sub, uuid: 'selfie-1', kind: 'selfie', bytes: Uint8List.fromList([1]), sha256: 's');
    await drafts.addMedia(sub, uuid: 'prog-1', kind: 'progress', bytes: Uint8List.fromList([2]), sha256: 'p');
    await drafts.save(sub, seedDraft(withReceipts: false));
    expect(await drafts.media('selfie-1'), isNotNull);
    expect(await drafts.media('prog-1'), isNotNull);
  });

  test('database v1 → v2: local_progress_reports is created, existing rows untouched', () async {
    final old = AppDatabase(
      NativeDatabase.memory(
        setup: (raw) {
          if (raw.select('PRAGMA user_version').first.values.first == 0) {
            raw.execute('CREATE TABLE kv_entries (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL)');
            raw.execute("INSERT INTO kv_entries VALUES ('masters:x', '{}')");
            raw.execute('PRAGMA user_version = 1');
          }
        },
      ),
    );
    addTearDown(old.close);
    expect(await old.kvGet('masters:x'), '{}');
    final r = ProgressRepository(old);
    await r.save(sub, const ProgressDraft(clientUuid: 'u1', projectId: 7, stageId: 31, pctAfter: 10));
    expect((await r.load(sub, 'u1'))!.pctAfter, 10);
    expect(old.schemaVersion, 2);
  });
}
