import 'dart:convert';

import 'package:dio/dio.dart' show Options;
import 'package:drift/drift.dart' show Value;

import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/network/api_client.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/core/time/device_clock.dart';
import 'package:proyekkas/core/util/async_lock.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/companies/application/company_selection.dart';
import 'package:proyekkas/features/companies/data/company_backfill.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/expense/data/expense_api.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/draft.dart';
import 'package:proyekkas/features/expense/domain/request_status.dart';
import 'package:proyekkas/features/masters/data/masters_repository.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/features/progress/data/progress_repository.dart';
import 'package:proyekkas/features/progress/domain/progress.dart';
import 'package:proyekkas/features/sync/application/sync_engine.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/features/sync/data/sync_api.dart';
import 'package:proyekkas/features/sync/domain/sync_models.dart';

import '../support/harness.dart';
import '../support/mock_server.dart';
import '../support/schema_v2.dart';

const sub = 'user-sub-1';

/// `GET /me` of a fictional account: PT 1 "CS6" (Staff + PM, employee 12) and PT 2 "CS7" (Finance,
/// employee 40). Deprecated top-level fields = union (as the MC3-1 server sends them).
Map<String, dynamic> meJson({List<int> pts = const [1, 2]}) => {
  'id': 5,
  'email': 'rina@example.test',
  'name': 'Rina Contoh',
  'roles': ['pk-staff', 'pk-pm', 'pk-finance'],
  'capabilities': {'approvalInbox': true, 'teamMonitor': true, 'progressReportCreate': true},
  'employee': {'id': 12, 'code': 'E12', 'name': 'Rina Contoh'},
  'settings': {'timezone': 'Asia/Makassar', 'minAppVersion': null},
  'companies': [
    if (pts.contains(1))
      {
        'id': 1,
        'code': 'CS6',
        'name': 'PT Contoh Enam',
        'timezone': 'Asia/Makassar',
        'selected': true,
        'roles': ['pk-staff', 'pk-pm'],
        'employeeId': 12,
        'employee': {'id': 12, 'code': 'E12', 'name': 'Rina Contoh'},
        'capabilities': {'approvalInbox': false, 'teamMonitor': true, 'progressReportCreate': true},
        'settings': {
          'defaultGeofenceRadiusM': 150,
          'receiptRoundingTolerance': 1000,
          'receiptMaxAgeDays': 60,
          'budgetWarnPct': 85,
          'syncExpenseDraftsEnabled': true,
          'syncAttendanceEnabled': true,
          'syncProgressReportsEnabled': false,
        },
      },
    if (pts.contains(2))
      {
        'id': 2,
        'code': 'CS7',
        'name': 'PT Contoh Tujuh',
        'timezone': 'Asia/Makassar',
        'selected': true,
        'roles': ['pk-finance'],
        'employeeId': 40,
        'employee': null,
        'capabilities': {'approvalInbox': true, 'teamMonitor': false, 'progressReportCreate': false},
        'settings': {
          'defaultGeofenceRadiusM': 100,
          'receiptRoundingTolerance': 0,
          'receiptMaxAgeDays': 30,
          'budgetWarnPct': 90,
          'syncExpenseDraftsEnabled': true,
          'syncAttendanceEnabled': false,
          'syncProgressReportsEnabled': true,
        },
      },
  ],
  'activeCompanyIds': pts,
};

/// A v2 (mobile-v0.2.x) phone: one queued draft (+ line, no receipt), one queued progress report, one
/// queued check-in — all without PT, the way 0.2.x stored them.
void seedV2(dynamic raw) {
  const ts = 1790000000; // drift stores DateTime as unix seconds
  raw.execute(
    'INSERT INTO local_drafts (client_uuid, user_sub, type, title, cost_center_id, requester_ids_json, sync_state, '
    "created_at, updated_at) VALUES ('d-1', '$sub', 'advance', 'Pengajuan BBM', 7, '[12]', 'queued', $ts, $ts)",
  );
  raw.execute(
    "INSERT INTO local_lines (client_uuid, draft_uuid, no, description, total) VALUES ('l-1', 'd-1', 1, 'BBM', 500000)",
  );
  raw.execute(
    'INSERT INTO local_progress_reports (client_uuid, user_sub, project_id, stage_id, pct_after, work, sync_state, '
    "created_at, updated_at) VALUES ('r-1', '$sub', 70, 31, 40, 'Pengecoran', 'queued', ${ts + 1}, ${ts + 1})",
  );
  for (final (op, type, target, payload, t) in [
    ('d-1', SyncItemType.expenseDraftUpsert, 'd-1', '{"kind":"advance","title":"Pengajuan BBM"}', ts),
    ('r-1', SyncItemType.progressReportUpsert, 'r-1', '{"project_id":70,"stage_id":31,"pct_after":40}', ts + 1),
    ('a-1', SyncItemType.attendanceCheckIn, 'a-1', '{"project_id":70}', ts + 2),
  ]) {
    raw.execute(
      'INSERT INTO outbox (op_uuid, user_sub, type, target_uuid, payload_json, device_time, elapsed_ms, boot_id, '
      "created_at) VALUES ('$op', '$sub', '$type', '$target', '$payload', '2026-09-21T12:00:00+08:00', 1000, 'b-1', $t)",
    );
  }
}

void main() {
  group('profile (GET /me companies[])', () {
    test('companies[] with per-PT roles, capabilities, employee and settings', () {
      final p = userProfileFromJson(meJson());
      expect(p.companies.map((c) => c.code), ['CS6', 'CS7']);
      final cs6 = p.company(1)!;
      expect(cs6.roles, {Role.staff, Role.pm});
      expect(cs6.capabilities.teamMonitor, isTrue);
      expect(cs6.capabilities.approvalInbox, isFalse);
      expect(cs6.employee!.code, 'E12');
      expect(cs6.settings.syncAttendanceEnabled, isTrue);
      expect(cs6.settings.defaultGeofenceRadiusM, 150);
      final cs7 = p.company(2)!;
      expect(cs7.employee!.id, 40, reason: 'employeeId alone is enough to know the employee of that PT');
      expect(cs7.settings.budgetWarnPct, 90);
      expect(cs7.settings.syncProgressReportsEnabled, isTrue);
      expect(p.isMultiCompany, isTrue);
      expect(p.employeeIds, {12, 40});
    });

    test('scope = union over the selected PTs for navigation; actions use the roles IN the item PT', () {
      final p = userProfileFromJson(meJson());
      final all = p.scopedTo(null);
      expect(all.roles, {Role.staff, Role.pm, Role.finance});
      expect(all.hasApprovalInbox, isTrue);
      expect(all.showCompanyChips, isTrue);

      final onlyCs6 = p.scopedTo({1});
      expect(onlyCs6.roles, {Role.staff, Role.pm});
      expect(onlyCs6.hasApprovalInbox, isFalse, reason: 'Finance is held in CS7 only');
      expect(onlyCs6.employee!.id, 12);
      expect(onlyCs6.showCompanyChips, isFalse);
      expect(onlyCs6.requestCompanies.map((c) => c.id), [1]);

      expect(p.forCompany(2).canCreateRequests, isFalse, reason: 'Finance only in CS7');
      expect(p.forCompany(1).canCreateRequests, isTrue);
      expect(p.forCompany(99).roles, isEmpty, reason: 'a PT that is not a membership grants nothing');
      expect(p.scopedTo({99}).scopeCompanyIds, [1, 2], reason: 'no overlap → all PTs');
      expect(all.progressCompanies.map((c) => c.id), [1]);
    });

    test('a /me without companies[] (server before MC3, cached 0.2.x profile) keeps the old behaviour', () {
      final j = meJson()..remove('companies');
      final p = userProfileFromJson(j);
      expect(p.companies, isEmpty);
      expect(p.scopedTo({1}), p);
      expect(p.forCompany(1), p);
      expect(p.showCompanyChips, isFalse);
      expect(p.hasApprovalInbox, isTrue);
    });

    test('capabilities missing in a membership → derived from the roles of that PT', () {
      final j = meJson();
      ((j['companies'] as List).first as Map).remove('capabilities');
      final p = userProfileFromJson(j);
      expect(p.company(1)!.capabilities, Capabilities.fromRoles({Role.staff, Role.pm}));
    });
  });

  group('PT selection (switcher) + X-Company-Ids', () {
    test('normalize: only memberships; every PT or none = "Semua PT" (no header)', () {
      final p = userProfileFromJson(meJson());
      expect(CompanySelection.normalize({1}, p), {1});
      expect(CompanySelection.normalize({1, 2}, p), isNull);
      expect(CompanySelection.normalize({3}, p), isNull);
      expect(CompanySelection.normalize({1, 3}, p), {1});
      expect(CompanySelection.normalize(null, p), isNull);
      expect(companyHeaderValue({2, 1}), '1,2');
      expect(companyHeaderValue(null), isNull);
    });

    late MockServer server;
    setUp(() async => server = await MockServer.start());
    tearDown(() => server.close());

    test('interceptor: selection header by default, the item PT when pinned, none for allCompanies', () async {
      server.on('GET', '/api/v1/x', (req, body) => (200, {'ok': true}));
      String? selection = '1';
      final client = ApiClient(
        baseUrl: '${server.base}/api/v1',
        tokens: StaticTokens(),
        headers: testDevice(),
        companyHeader: () => selection,
      );
      Future<void> get([Options? o]) => client.run((d) => d.get<dynamic>('/x', options: o), (_) {});
      await get();
      await get(ApiClient.forCompany(2));
      await get(ApiClient.allCompanies());
      selection = null;
      await get();
      final sent = [for (final c in server.calls) c.$3['x-company-ids']];
      expect(sent, ['1', '2', null, null]);
    });

    test('403 COMPANY_NOT_ALLOWED → callback (reset + /me) and a clear Indonesian message', () async {
      server.on(
        'GET',
        '/api/v1/expense-requests',
        (req, body) => (403, {'title': 'Forbidden', 'status': 403, 'code': 'COMPANY_NOT_ALLOWED', 'detail': 'x'}),
      );
      var called = 0;
      final client = ApiClient(
        baseUrl: '${server.base}/api/v1',
        tokens: StaticTokens(),
        headers: testDevice(),
        companyHeader: () => '3',
        onCompanyNotAllowed: () => called++,
      );
      await expectLater(
        ExpenseApi(client).list(),
        throwsA(
          isA<ProblemException>()
              .having((e) => e.code, 'code', 'COMPANY_NOT_ALLOWED')
              .having((e) => e.message, 'message', companyNotAllowedMessage),
        ),
      );
      expect(called, 1);
    });
  });

  group('drift v2 → v3 migration of existing offline data', () {
    late MockServer server;
    late FakeDeviceClock clock;
    setUp(() async {
      server = await MockServer.start();
      clock = FakeDeviceClock(now: DateTime(2026, 9, 28, 9));
    });
    tearDown(() => server.close());

    SyncEngine engineFor(AppDatabase db, {List<int>? memberships}) {
      final client = testClient(server.base, StaticTokens());
      return SyncEngine(
        outbox: OutboxRepository(db),
        drafts: DraftRepository(db),
        api: SyncApi(client),
        db: db,
        clock: clock,
        deviceId: () => testDevice().deviceId,
        lock: AsyncLock(),
        progress: ProgressRepository(db),
        uploadMedia: (_) async => 1,
        memberships: memberships == null ? null : (_) async => memberships,
      );
    }

    List<Map<String, dynamic>> sentItems() => [
      for (final c in server.calls.where((c) => c.$2 == '/api/v1/sync/batch'))
        for (final i in (jsonDecode(c.$4) as Map<String, dynamic>)['items'] as List) i as Map<String, dynamic>,
    ];

    void answerApplied() => server.on('POST', '/api/v1/sync/batch', (req, body) {
      final j = jsonDecode(body) as Map<String, dynamic>;
      return (
        200,
        {
          'batch_id': j['batch_id'],
          'server_time': '2026-09-28T01:00:00Z',
          'results': [
            for (final i in j['items'] as List)
              {
                'client_uuid': (i as Map)['client_uuid'],
                'status': 'applied',
                'server_id': '9',
                'rev': 1,
                'company_id': i['company_id'],
              },
          ],
        },
      );
    });

    test('rows survive the upgrade unchanged with company_id NULL (payload, ids, status)', () async {
      final db = oldPhoneDb(2, seedV2);
      addTearDown(db.close);
      expect(db.schemaVersion, 11); // v2 → v3 (company_id) → v4 (urgency level, 2026-10-09) → v5 (FR1 field reports) → v6 (P3) → v7 (D3) → v8 (D4) → v9 (sites) → v10 (vendor) → v11 (service types)
      final out = await db.select(db.outbox).get();
      expect(out.map((r) => r.opUuid), unorderedEquals(['d-1', 'r-1', 'a-1']));
      expect(out.every((r) => r.companyId == null && r.status == 'pending'), isTrue);
      expect(out.firstWhere((r) => r.opUuid == 'd-1').payloadJson, contains('Pengajuan BBM'));
      final draft = await DraftRepository(db).load(sub, 'd-1');
      expect(draft!.companyId, isNull);
      expect(draft.lines.single.total, 500000);
      expect((await ProgressRepository(db).load(sub, 'r-1'))!.companyId, isNull);
    });

    test('one PT: every old row gets it (after /me) and is sent with that company_id', () async {
      final db = oldPhoneDb(2, seedV2);
      addTearDown(db.close);
      final profile = userProfileFromJson(meJson(pts: [1]));
      expect(await CompanyBackfill(db).assignSoleCompany(sub, profile), 5, reason: '1 draft + 1 report + 3 items');
      expect((await DraftRepository(db).load(sub, 'd-1'))!.companyId, 1);
      expect((await ProgressRepository(db).load(sub, 'r-1'))!.companyId, 1);
      answerApplied();
      final r = await engineFor(db).run(sub); // memberships unknown to the engine: rows already carry the PT
      expect(r.applied, 3);
      expect(sentItems().map((i) => i['company_id']), [1, 1, 1]);
      expect(server.calls.where((c) => c.$2 == '/api/v1/sync/batch').single.$3['x-company-ids'], isNull);
    });

    test('one PT known only to the engine (cached /me): assigned right before sending, never lost', () async {
      final db = oldPhoneDb(2, seedV2);
      addTearDown(db.close);
      await db.kvPut(profileCacheKey(sub), jsonEncode(meJson(pts: [2])));
      answerApplied();
      final r = await engineFor(db).run(sub);
      expect(r.outcome, SyncRunOutcome.done);
      expect(sentItems().map((i) => i['company_id']), [2, 2, 2]);
      expect((await DraftRepository(db).load(sub, 'd-1'))!.companyId, 2);
    });

    test('several PTs: nothing is guessed — items held (not sent, no attempt) until the user picks', () async {
      final db = oldPhoneDb(2, seedV2);
      addTearDown(db.close);
      final profile = userProfileFromJson(meJson());
      final backfill = CompanyBackfill(db);
      expect(await backfill.assignSoleCompany(sub, profile), 0);
      answerApplied();
      final engine = engineFor(db, memberships: [1, 2]);

      final first = await engine.run(sub);
      expect(first.needsCompany, 3);
      expect(first.outcome, SyncRunOutcome.partial);
      expect(server.calls, isEmpty, reason: 'no batch without company_id');
      final held = await db.select(db.outbox).get();
      expect(held.every((r) => r.status == 'pending' && r.attempts == 0), isTrue);
      expect(held.every((r) => r.lastErrorCode == companyRequiredCode), isTrue);
      expect(await backfill.watchUnassignedCount(sub).first, 3);

      final items = await backfill.unassigned(sub);
      expect(items.map((i) => (i.kind, i.targetUuid)), [
        (UnassignedKind.draft, 'd-1'),
        (UnassignedKind.progress, 'r-1'),
        (UnassignedKind.attendance, 'a-1'),
      ]);

      // The user picks CS7 for the draft and CS6 for the report; the check-in stays open.
      await backfill.assign(sub, UnassignedKind.draft, 'd-1', 2);
      await backfill.assign(sub, UnassignedKind.progress, 'r-1', 1);
      expect(await backfill.watchUnassignedCount(sub).first, 1);
      final second = await engine.run(sub);
      expect(second.applied, 2);
      expect(second.needsCompany, 1);
      expect({for (final i in sentItems()) i['client_uuid']: i['company_id']}, {'d-1': 2, 'r-1': 1});
      expect(server.calls.where((c) => c.$2 == '/api/v1/sync/batch'), hasLength(2), reason: 'one batch per PT');
      final checkIn = (await db.select(db.outbox).get()).firstWhere((r) => r.opUuid == 'a-1');
      expect(checkIn.status, 'pending', reason: 'still waiting, not lost');
    });

    test('v1 phone (no progress table) upgrades straight to v3', () async {
      final db = oldPhoneDb(1, (raw) {});
      addTearDown(db.close);
      await ProgressRepository(db)
          .save(sub, const ProgressDraft(clientUuid: 'p-9', companyId: 4, projectId: 70, stageId: 31, pctAfter: 5));
      expect((await ProgressRepository(db).load(sub, 'p-9'))!.companyId, 4);
    });
  });

  group('sync: company_id per item', () {
    late MockServer server;
    late AppDatabase db;
    late OutboxRepository outbox;
    late SyncEngine engine;
    final clock = FakeDeviceClock(now: DateTime(2026, 9, 28, 9));

    setUp(() async {
      server = await MockServer.start();
      db = memoryDb();
      outbox = OutboxRepository(db);
      final client = ApiClient(
        baseUrl: '${server.base}/api/v1',
        tokens: StaticTokens(),
        headers: testDevice(),
        companyHeader: () => '1', // the switcher shows CS6 only — must not affect the batch
      );
      engine = SyncEngine(
        outbox: outbox,
        drafts: DraftRepository(db),
        api: SyncApi(client),
        db: db,
        clock: clock,
        deviceId: () => testDevice().deviceId,
        lock: AsyncLock(),
        progress: ProgressRepository(db),
        uploadMedia: (_) async => 1,
        memberships: (_) async => [1, 2],
      );
    });
    tearDown(() async {
      await db.close();
      await server.close();
    });

    Future<void> queueDraft(String uuid, int? company) async {
      await DraftRepository(
        db,
      ).save(sub, DraftRequest(clientUuid: uuid, type: RequestType.advance, title: 'Draft $uuid', companyId: company));
      await outbox.enqueueDraftUpsert(
        sub: sub,
        draftUuid: uuid,
        payload: (_) => {'title': 'Draft $uuid'},
        dependsOn: const [],
        deviceTime: '2026-09-28T09:00:00+08:00',
        elapsedMs: 1,
        bootId: 'b-1',
        offline: true,
        companyId: company,
      );
      clock.current = clock.current.add(const Duration(seconds: 1));
    }

    List<(String?, List<(String, int?)>)> batches() => [
      for (final c in server.calls.where((c) => c.$2 == '/api/v1/sync/batch'))
        (
          c.$3['x-company-ids'],
          [
            for (final i in (jsonDecode(c.$4) as Map<String, dynamic>)['items'] as List)
              ('${(i as Map)['client_uuid']}', i['company_id'] as int?),
          ],
        ),
    ];

    void answer(Map<String, (String, List<Map<String, String>>)> byUuid) =>
        server.on('POST', '/api/v1/sync/batch', (req, body) {
          final j = jsonDecode(body) as Map<String, dynamic>;
          return (
            200,
            {
              'batch_id': j['batch_id'],
              'server_time': '2026-09-28T01:00:00Z',
              'results': [
                for (final i in j['items'] as List)
                  {
                    'client_uuid': (i as Map)['client_uuid'],
                    'status': byUuid[i['client_uuid']]?.$1 ?? 'applied',
                    'errors': byUuid[i['client_uuid']]?.$2 ?? const [],
                    'company_id': i['company_id'],
                  },
              ],
            },
          );
        });

    test('mixed-PT outbox: one batch per PT, each item carries its OWN PT, no X-Company-Ids', () async {
      await queueDraft('a', 1);
      await queueDraft('b', 2);
      await queueDraft('c', 1);
      answer(const {});
      final r = await engine.run(sub);
      expect(r.applied, 3);
      final sent = batches();
      expect(sent.map((b) => b.$1), [null, null], reason: 'no X-Company-Ids on sync/batch');
      expect(sent.map((b) => b.$2), [
        [('a', 1), ('c', 1)],
        [('b', 2)],
      ]);
    });

    test('COMPANY_MISMATCH / COMPANY_NOT_ALLOWED are final: rejected with a clear message, never retried', () async {
      await queueDraft('a', 1);
      await queueDraft('b', 2);
      answer({
        'a': (
          'rejected',
          [
            {'code': 'COMPANY_MISMATCH', 'message': 'company mismatch'},
          ],
        ),
        'b': (
          'rejected',
          [
            {'code': 'COMPANY_NOT_ALLOWED', 'message': 'not allowed'},
          ],
        ),
      });
      final r = await engine.run(sub);
      expect(r.rejected, 2);
      final rows = {for (final o in await db.select(db.outbox).get()) o.opUuid: o};
      expect(rows['a']!.status, 'rejected');
      expect(rows['a']!.lastErrorCode, 'COMPANY_MISMATCH');
      expect(rows['a']!.lastErrorMessage, contains('PT data ini tidak sama'));
      expect(rows['b']!.lastErrorMessage, contains('tidak terdaftar di PT'));
      final draft = await DraftRepository(db).load(sub, 'a');
      expect(draft!.syncState, DraftSyncState.rejected);
      server.calls.clear();
      expect((await engine.run(sub)).outcome, SyncRunOutcome.nothingToDo);
      expect(server.calls, isEmpty);
    });

    test('attendance / progress rejections with a PT code also use the clear PT text', () {
      final msg = rejectionMessage(const [
        SyncError(code: 'COMPANY_MISMATCH', message: 'raw'),
      ], type: SyncItemType.attendanceCheckIn);
      expect(msg, startsWith('PT data ini tidak sama'));
    });

    test('batch 409 COMPANY_REQUIRED: PT-less items held, the others retried next run — nothing lost', () async {
      final legacy = SyncEngine(
        outbox: outbox,
        drafts: DraftRepository(db),
        api: engine.api,
        db: db,
        clock: clock,
        deviceId: () => testDevice().deviceId,
        lock: AsyncLock(),
        uploadMedia: (_) async => 1,
        memberships: (_) async => null, // PTs unknown (profile not refreshed yet)
      );
      await queueDraft('old', null);
      await queueDraft('new', 2);
      server.on(
        'POST',
        '/api/v1/sync/batch',
        (req, body) => (
          409,
          {
            'title': 'Conflict',
            'status': 409,
            'code': 'COMPANY_REQUIRED',
            'detail': 'Akun Anda terdaftar di lebih dari satu PT.',
            'errors': [
              {'path': 'items.0.company_id', 'message': 'PT wajib'},
            ],
          },
        ),
      );
      final r = await legacy.run(sub);
      expect(r.needsCompany, 1);
      final rows = {for (final o in await db.select(db.outbox).get()) o.opUuid: o};
      expect(rows['old']!.status, 'pending');
      expect(rows['old']!.lastErrorCode, companyRequiredCode);
      expect(rows['new']!.status, 'pending');
      expect(rows['new']!.attempts, 0);

      answer(const {});
      server.calls.clear();
      final again = await legacy.run(sub);
      expect(again.applied, 1);
      expect(again.needsCompany, 1, reason: 'the server said PT is required: the PT-less item waits');
      expect(batches().single.$2, <(String, int?)>[('new', 2)]);
    });

    test('idempotency kept: the same client_uuid is re-sent after a network loss', () async {
      await queueDraft('a', 1);
      final r1 = await engine.run(sub); // no route → 404 → server unsupported (kept queued)
      expect(r1.outcome, SyncRunOutcome.serverUnsupported);
      await (db.update(db.outbox)).write(const OutboxCompanion(nextAttemptAt: Value(null)));
      answer(const {});
      await engine.run(sub);
      final ids = [
        for (final b in batches())
          for (final i in b.$2) i.$1,
      ];
      expect(ids, ['a', 'a']);
    });
  });

  group('masters cache per user + PT with ETag', () {
    late MockServer server;
    late AppDatabase db;
    late MastersRepository repo;

    setUp(() async {
      server = await MockServer.start();
      db = memoryDb();
      repo = MastersRepository(testClient(server.base, StaticTokens()), db);
      server.on('GET', '/api/v1/masters', (req, body) {
        final pt = int.parse(req.headers.value('x-company-ids')!);
        final etag = 'W/"m1-$pt-v1"';
        if (req.headers.value('if-none-match') == etag) return (304, null);
        req.response.headers.set('ETag', etag);
        return (
          200,
          {
            'serverTime': '2026-09-28T01:00:00Z',
            'companies': [
              {'id': pt, 'code': 'CS$pt', 'defaultGeofenceRadiusM': 100, 'version': 'v1-$pt'},
            ],
            'sharedVersion': 's1',
            'types': {
              MasterTypes.projects: {
                'items': [
                  {'id': 70 + pt, 'code': 'P-$pt', 'name': 'Proyek $pt', 'company': pt, 'shared': false},
                ],
                'hasMore': false,
              },
              MasterTypes.uoms: {
                'items': [
                  {'id': 3, 'code': 'LTR', 'name': 'Liter', 'company': null, 'shared': true},
                ],
                'hasMore': false,
              },
            },
          },
        );
      });
    });
    tearDown(() async {
      await db.close();
      await server.close();
    });

    test('one request per PT (X-Company-Ids), ETag stored, If-None-Match → 304 keeps the cache', () async {
      expect(await repo.refresh(sub, companyIds: [1, 2]), isTrue);
      expect(server.calls.map((c) => c.$3['x-company-ids']), ['1', '2']);
      expect(server.calls.every((c) => c.$3['if-none-match'] == null), isTrue);
      expect(await repo.etagOf(sub, 1), 'W/"m1-1-v1"');
      expect(await db.kvGet(MastersRepository.companyKey(sub, 2)), contains('v1-2'));

      server.calls.clear();
      expect(await repo.refresh(sub, companyIds: [1, 2]), isTrue);
      expect(server.calls.map((c) => c.$3['if-none-match']), ['W/"m1-1-v1"', 'W/"m1-2-v1"']);
      final one = await repo.cached(sub, companyId: 1);
      expect(one[MasterTypes.projects]!.map((m) => m.id), [71], reason: '304 kept the cache');
    });

    test('pickers read ONE PT (+ shared rows); lists read the selected PTs; shared rows once', () async {
      await repo.refresh(sub, companyIds: [1, 2]);
      final cs7 = await repo.cached(sub, companyId: 2);
      expect(cs7[MasterTypes.projects]!.map((m) => m.label), ['P-2 — Proyek 2']);
      expect(cs7[MasterTypes.projects]!.single.companyId, 2);
      expect(cs7[MasterTypes.uoms]!.single.shared, isTrue);
      final all = await repo.cached(sub);
      expect(all[MasterTypes.projects]!.map((m) => m.id), [71, 72]);
      expect(all[MasterTypes.uoms], hasLength(1));
      expect((await repo.cached(sub, companyIds: [1]))[MasterTypes.projects]!.map((m) => m.id), [71]);
      expect(await repo.cached('other-sub'), {for (final t in MasterTypes.forApp) t: isEmpty});
    });

    test('no PTs known (server before MC3): the single 0.2.x cache keeps working', () async {
      server.on(
        'GET',
        '/api/v1/masters',
        (req, body) => (
          200,
          {
            'types': {
              MasterTypes.projects: {
                'items': [
                  {'id': 5, 'code': 'P-5', 'name': 'Lama'},
                ],
              },
            },
          },
        ),
      );
      expect(await repo.refresh(sub), isTrue);
      expect(server.calls.single.$3['x-company-ids'], isNull);
      expect((await repo.cached(sub, companyId: 1))[MasterTypes.projects]!.single.id, 5);
    });
  });
}
