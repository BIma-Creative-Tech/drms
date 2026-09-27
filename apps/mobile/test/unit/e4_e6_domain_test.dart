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
import 'package:proyekkas/features/attendance/data/attendance_api.dart';
import 'package:proyekkas/features/attendance/domain/attendance.dart';
import 'package:proyekkas/features/attendance/domain/attendance_recap.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/data/draft_repository.dart';
import 'package:proyekkas/features/expense/data/expense_api.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/features/progress/domain/progress.dart';
import 'package:proyekkas/features/sync/application/sync_engine.dart';
import 'package:proyekkas/features/sync/data/outbox_repository.dart';
import 'package:proyekkas/features/sync/data/sync_api.dart';
import 'package:proyekkas/features/sync/domain/sync_models.dart';

import '../support/e4_e6_fixtures.dart';
import '../support/harness.dart';
import '../support/mock_server.dart';

class _Compressor implements PhotoCompressor {
  PhotoTarget? target;
  @override
  Future<CompressedPhoto> compress(Uint8List raw, PhotoTarget target) async {
    this.target = target;
    return CompressedPhoto(Uint8List.fromList(raw.take(4).toList()), 'sha');
  }
}

const cc = ProjectSite(id: 3, label: 'Ops Palangka', lat: -2.2, lng: 113.9, radiusM: 80, kind: SiteKind.costCenter);
const fix = LocationFix(lat: -2.2003, lng: 113.9, accuracyM: 7.26, isMocked: false);

const _draft = ProgressDraft(
  clientUuid: 'r-1',
  projectId: 7,
  stageId: 31,
  pctBefore: 40,
  pctAfter: 55,
  work: 'Pengecoran kolom',
);

void main() {
  group('E4 domain', () {
    test('validation: never below the stage % before, 0–100, work ≥ 3, ≤ 5 photos', () {
      expect(validateProgress(_draft), isEmpty);
      expect(validateProgress(_draft.copyWith(pctAfter: 39.99))['pctAfter'], contains('tidak boleh turun'));
      expect(validateProgress(_draft.copyWith(pctAfter: 40)), isEmpty, reason: 'equal is allowed');
      expect(validateProgress(_draft.copyWith(pctAfter: 100.5))['pctAfter'], 'Progress harus 0–100%.');
      expect(validateProgress(_draft.copyWith(work: ' ab '))['work'], isNotNull);
      expect(
        validateProgress(_draft.copyWith(photoUuids: ['a', 'b', 'c', 'd', 'e', 'f']))['photos'],
        'Maksimal 5 foto per laporan.',
      );
    });

    test('validation: an edit needs a reason and an open 24 h window', () {
      const edit = ProgressDraft(
        clientUuid: 'r-2',
        projectId: 7,
        stageId: 31,
        pctBefore: 40,
        pctAfter: 60,
        work: 'Pengecoran',
        serverId: 501,
        serverRev: 2,
        serverPhotoCount: 4,
        editableUntil: '2026-09-27T02:00:00Z',
      );
      final now = DateTime.utc(2026, 9, 26, 12);
      expect(validateProgress(edit, now: now)['reason'], contains('Alasan edit wajib'));
      expect(validateProgress(edit.copyWith(reason: 'Salah ketik'), now: now), isEmpty);
      expect(
        validateProgress(edit.copyWith(reason: 'Salah ketik'), now: DateTime.utc(2026, 9, 27, 3))['reason'],
        contains('24 jam'),
      );
      expect(
        validateProgress(
          edit.copyWith(reason: 'ok!', photoUuids: ['a', 'b']),
          now: now,
        )['photos'],
        isNotNull,
      );
    });

    test('validation: incomplete stage weights block a new report (server set only, not the offline cache)', () {
      const incomplete = ProjectStageSet(projectId: 7, weightSum: 80, complete: false, progressPct: 10, stages: []);
      expect(validateProgress(_draft, stages: incomplete)['stage'], contains('80%'));
      final cached = ProjectStageSet.fromMasters(7, const []);
      expect(validateProgress(_draft, stages: cached), isEmpty);
    });

    test('payload: new report vs edit (pct only when changed, reason, report_id)', () {
      final p = progressPayload(_draft.copyWith(issues: '  ', photoUuids: ['ph-1']));
      expect(p, containsPair('report_client_uuid', 'r-1'));
      expect(p, containsPair('project_id', 7));
      expect(p['issues'], isNull);
      expect(p[progressPhotosPlaceholderKey], ['ph-1']);
      const edit = ProgressDraft(
        clientUuid: 'r-2',
        projectId: 7,
        stageId: 31,
        pctAfter: 60,
        work: 'Pengecoran',
        serverId: 501,
        serverPctAfter: 60,
        reason: ' Salah ketik ',
      );
      final e = progressPayload(edit);
      expect(e, containsPair('report_id', 501));
      expect(e.containsKey('pct_after'), isFalse);
      expect(e.containsKey('project_id'), isFalse);
      expect(e['reason'], 'Salah ketik');
      expect(progressPayload(edit.copyWith(pctAfter: 61.256))['pct_after'], 61.26);
      final body = progressUpdateBody(edit, const []);
      expect(body.containsKey('addPhotoIds'), isFalse);
      expect(progressCreateBody(_draft, const [3])['photoIds'], [3]);
    });

    test('media resolver: local photos appended to photo_media_ids; missing upload → null', () {
      final p = {
        'work': 'x',
        progressPhotosPlaceholderKey: ['a', 'b'],
      };
      expect(resolveMediaIds(p, {'a': 1, 'b': 2})!['photo_media_ids'], [1, 2]);
      expect(resolveMediaIds(p, {'a': 1}), isNull);
      expect(resolveMediaIds({progressPhotosPlaceholderKey: <String>[]}, {})!.containsKey('photo_media_ids'), isFalse);
    });

    test('parsing: report, stage set, K-09 list, server copy, percent text', () {
      final r = ProgressReport.fromJson(progressReportJson());
      expect(r.docNo, 'LP/2609/0007');
      expect(r.projectLabel, 'P-07 — Gudang Contoh');
      expect(r.photos.map((p) => p.id), [901, 902]);
      expect(r.editable, isTrue);
      final set = ProjectStageSet.fromJson(stageSetJson());
      expect(set.activeStages.map((s) => s.name), ['Persiapan', 'Struktur']);
      expect(set.complete, isTrue);
      final k = ProjectProgressList.fromJson(projectProgressJson());
      expect(k.projects.first.tone, ProgressTone.bad);
      expect(k.projects.first.gap, 27.5);
      expect(k.projects.last.budgetPct, isNull);
      expect(fmtPct(45.5), '45,5%');
      expect(fmtPct(50), '50%');
      expect(fmtPct(12.25), '12,25%');
    });

    test('stage set from the cached masters (offline): weights summed, progress weighted', () {
      final set = ProjectStageSet.fromMasters(7, [
        {'id': 1, 'project': 7, 'name': 'A', 'weightPct': 30, 'sequence': 1, 'progressPct': 50, 'active': true},
        {'id': 2, 'project': 7, 'name': 'B', 'weightPct': 70, 'sequence': 2, 'progressPct': 0, 'active': true},
        {'id': 3, 'project': 8, 'name': 'Lain', 'weightPct': 100, 'sequence': 1, 'progressPct': 0},
      ]);
      expect(set.stages, hasLength(2));
      expect(set.complete, isTrue);
      expect(set.progressPct, 15, reason: '50 % on a 30 % stage = 15 points');
      expect(set.fromCache, isTrue);
    });

    test('capabilities and flags: progressReportCreate (PM/Direktur, not Staff), syncProgressReports', () {
      expect(Capabilities.fromRoles({Role.staff}).progressReportCreate, isFalse);
      expect(Capabilities.fromRoles({Role.pm}).progressReportCreate, isTrue);
      expect(Capabilities.fromRoles({Role.owner}).progressReportCreate, isTrue);
      final me = userProfileFromJson({
        'id': 1,
        'email': 'a@b.test',
        'roles': ['pk-finance'],
        'capabilities': {'approvalInbox': true, 'teamMonitor': false, 'progressReportCreate': false},
      });
      expect(me.canReadProgress, isTrue);
      expect(me.canCreateProgress, isFalse);
      expect(AppConfig.fromJson({}).syncProgressReports, isFalse, reason: 'older server → online only');
      expect(
        AppConfig.fromJson({
          'features': {'syncProgressReports': true},
        }).syncProgressReports,
        isTrue,
      );
      expect(SyncItemType.label(SyncItemType.progressReportUpsert), 'Laporan progress');
      expect(mediaUploadPath('progress'), 'progress-photos');
      expect(mediaUploadPath('selfie'), 'selfies');
      expect(mediaUploadPath('receipt'), 'receipts');
    });

    test('sync result keeps server_report; progress rejections prefer the server text', () {
      final r = SyncItemResult.fromJson({
        'client_uuid': 'x',
        'status': 'conflict',
        'server_report': {'id': 5},
      });
      expect(r.serverReport, {'id': 5});
      const errs = [SyncError(code: 'NOT_EDITABLE', message: 'Laporan hanya dapat diedit 24 jam setelah dibuat.')];
      expect(rejectionMessage(errs, type: SyncItemType.progressReportUpsert), errs.first.message);
      expect(rejectionMessage(errs), contains('Draft'));
      expect(rejectionMessage(const [SyncError(code: 'PHOTO_LIMIT')]), 'Maksimal 5 foto per laporan.');
    });
  });

  group('E6 domain', () {
    test('check-in at a cost center sends cost_center_id only', () {
      final p = attendancePayload(site: cc, fix: fix, selfieUuid: 's-1');
      expect(p['cost_center_id'], 3);
      expect(p.containsKey('project_id'), isFalse);
      expect(cc.key, 'c3');
      expect(checkSite(cc, fix).check, SiteCheck.ok);
      expect(ProjectSite.fromMaster(const MasterItem(3, 'x'), kind: SiteKind.costCenter).kind, SiteKind.costCenter);
    });

    test('on-behalf payload: employee, kind, lens, trimmed reason, photo placeholder', () {
      final p = onBehalfPayload(
        employeeId: 44,
        kind: AttendanceKind.checkOut,
        site: cc,
        fix: fix,
        photoUuid: 'ph-9',
        lens: CameraLens.back,
        reason: ' tidak punya HP ',
      );
      expect(p['employee_id'], 44);
      expect(p['kind'], 'check_out');
      expect(p['camera_lens'], 'back');
      expect(p['reason'], 'tidak punya HP');
      expect(p['accuracy_m'], 7.3);
      expect(resolveMediaIds(p, {'ph-9': 12})!['selfie_media_id'], 12);
    });

    test('recap parsing and calendar helpers', () {
      final r = AttendanceRecap.fromJson(recapJson());
      expect(r.month, '2026-09');
      expect(r.days.first.status, DayStatus.selesai);
      expect(r.days[1].status, DayStatus.tidakHadir);
      expect(r.days[2].onBehalf, isTrue);
      expect(r.days.first.locations.single.checkIn!.id, 9001);
      expect(r.summary.lateMinutes, 12);
      expect(leadingBlanks('2026-09'), 1, reason: '1 Sep 2026 is a Tuesday');
      expect(daysInMonth('2026-02'), 28);
      expect(shiftMonth('2026-01', -1), '2025-12');
      expect(shiftMonth('2026-12', 1), '2027-01');
      expect(hoursMinutes(125), '2 j 5 m');
      expect(hoursMinutes(45), '45 m');
      expect(localHm('2026-09-01T00:02:00Z', 'Asia/Makassar'), '08.02');
    });

    test('correction time: local date + HH:mm in the company zone → UTC', () {
      expect(localToUtcIso('2026-09-26', 7, 45, const Duration(hours: 8)), '2026-09-25T23:45:00.000Z');
      expect(localToUtcIso('2026-09-26', 17, 0, const Duration(hours: 7)), '2026-09-26T10:00:00.000Z');
    });

    test('team today parsing', () {
      final t = TeamToday.fromJson(teamTodayJson());
      expect(t.total, 3);
      expect(t.members.map((m) => m.status), [MemberStatus.belumAbsen, MemberStatus.hadir, MemberStatus.selesai]);
      expect(t.members[1].locations.single.checkIn!.id, 9101);
      expect(t.members[1].assigned.single.kind, SiteKind.project);
    });
  });

  group('E6 API + queue', () {
    late MockServer server;
    late AppDatabase db;

    setUp(() async {
      server = await MockServer.start();
      db = memoryDb();
    });
    tearDown(() async {
      await db.close();
      await server.close();
    });

    test('recap / team today / correction requests', () async {
      final api = AttendanceApi(testClient(server.base, StaticTokens()));
      server.on('GET', '/api/v1/attendance/me', (req, body) {
        expect(req.uri.queryParameters['month'], '2026-09');
        return (200, recapJson());
      });
      server.on('GET', '/api/v1/attendance/recap', (req, body) {
        expect(req.uri.queryParameters['employee_id'], '44');
        return (200, recapJson());
      });
      server.on('GET', '/api/v1/attendance/team-today', (req, body) => (200, teamTodayJson()));
      Map<String, dynamic>? corr;
      String? idem;
      server.on('POST', '/api/v1/attendance/9101/correct', (req, body) {
        corr = jsonDecode(body) as Map<String, dynamic>;
        idem = req.headers.value('idempotency-key');
        return (201, {'id': 1});
      });
      expect((await api.me(month: '2026-09')).days, hasLength(3));
      expect((await api.recap(44)).employee.name, 'Budi Contoh');
      expect((await api.teamToday()).members, hasLength(3));
      await api.correct(9101, newTimeUtc: '2026-09-25T23:45:00.000Z', reason: ' lupa absen ', idempotencyKey: 'k-1');
      expect(corr, {'new_time': '2026-09-25T23:45:00.000Z', 'reason': 'lupa absen'});
      expect(idem, 'k-1');
    });

    test(
      'PM on-behalf: queued offline (photo encrypted locally), then photo → /media/selfies, item on_behalf',
      () async {
        final drafts = DraftRepository(db);
        final outbox = OutboxRepository(db);
        final clock = FakeDeviceClock(now: DateTime(2026, 9, 26, 7, 50), elapsed: 1000, boot: 'b-1');
        final compressor = _Compressor();
        final service = AttendanceService(drafts: drafts, outbox: outbox, clock: clock, compressor: compressor);
        await service.recordOnBehalf(
          sub: 'pm-sub',
          employeeId: 44,
          kind: AttendanceKind.checkIn,
          site: cc,
          fix: fix,
          rawPhoto: Uint8List.fromList(List.filled(20, 1)),
          lens: CameraLens.back,
          reason: 'HP rusak',
          online: false,
        );
        expect(compressor.target, PhotoTarget.selfie);
        final row = (await outbox.all('pm-sub')).single;
        expect(row.type, SyncItemType.attendanceOnBehalf);
        expect(row.offline, isTrue);
        final client = testClient(server.base, StaticTokens());
        final media = ExpenseApi(client);
        final engine = SyncEngine(
          outbox: outbox,
          drafts: drafts,
          api: SyncApi(client),
          db: db,
          clock: clock,
          deviceId: () => 'd',
          lock: AsyncLock(),
          uploadMedia: (b) => media.uploadMedia(mediaUploadPath(b.kind), b.bytes, filename: 'x.jpg'),
        );
        server.on('POST', '/api/v1/media/selfies', (req, body) => (201, {'id': 66}));
        Map<String, dynamic>? item;
        server.on('POST', '/api/v1/sync/batch', (req, body) {
          final j = jsonDecode(body) as Map<String, dynamic>;
          item = (j['items'] as List).single as Map<String, dynamic>;
          return (
            200,
            {
              'batch_id': j['batch_id'],
              'server_time': '2026-09-26T00:00:00Z',
              'results': [
                {
                  'client_uuid': item!['client_uuid'],
                  'status': 'rejected',
                  'errors': [
                    {
                      'code': 'NOT_ASSIGNED',
                      'message': 'Karyawan ini tidak ditugaskan di pusat biaya ini pada tanggal tersebut.',
                    },
                  ],
                },
              ],
            },
          );
        });
        await engine.run('pm-sub');
        expect(server.pathsCalled(), ['POST /api/v1/media/selfies', 'POST /api/v1/sync/batch']);
        final p = item!['payload'] as Map<String, dynamic>;
        expect(item!['type'], 'attendance.on_behalf');
        expect(p['selfie_media_id'], 66);
        expect(p['employee_id'], 44);
        expect(p['cost_center_id'], 3);
        expect(p['camera_lens'], 'back');
        final after = (await outbox.all('pm-sub')).single;
        expect(after.status, 'rejected');
        expect(
          after.lastErrorMessage,
          contains('tidak ditugaskan di pusat biaya'),
          reason: 'server text for attendance',
        );
      },
    );
  });
}
