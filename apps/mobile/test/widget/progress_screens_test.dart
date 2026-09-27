import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/app_config/application/app_config_providers.dart';
import 'package:proyekkas/features/app_config/domain/app_config.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/dashboard/presentation/kpi_home.dart';
import 'package:proyekkas/features/home/presentation/home_screen.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';
import 'package:proyekkas/features/progress/application/progress_providers.dart';
import 'package:proyekkas/features/progress/application/progress_service.dart';
import 'package:proyekkas/features/progress/domain/progress.dart';
import 'package:proyekkas/features/progress/presentation/progress_conflict_screen.dart';
import 'package:proyekkas/features/progress/presentation/progress_detail_screen.dart';
import 'package:proyekkas/features/progress/presentation/progress_editor_screen.dart';
import 'package:proyekkas/features/progress/presentation/progress_screen.dart';

import '../support/e4_e6_fixtures.dart';
import '../support/widget_harness.dart';

/// E4 APK screens. Services are fakes so no drift/HTTP work runs inside the fake-async widget zone; the
/// queue and sync side is covered by test/unit/progress_sync_test.dart.
class FakeProgressService extends Fake implements ProgressService {
  final saved = <(ProgressDraft, bool online, bool queue)>[];
  final usedServer = <String>[];
  final resent = <(String, String)>[];
  int photos = 0;

  @override
  ProgressDraft newDraft({required int projectId, String projectLabel = '', required int stageId}) =>
      ProgressDraft(clientUuid: 'new-uuid', projectId: projectId, stageId: stageId, pctAfter: 0);

  @override
  Future<String> addPhoto(String sub, Uint8List raw) async => 'ph-${++photos}';

  @override
  Future<Uint8List?> photoBytes(String uuid) async => null;

  @override
  Future<ProgressSaveOutcome> save(
    String sub,
    ProgressDraft d, {
    required bool online,
    required bool queueEnabled,
  }) async {
    saved.add((d, online, queueEnabled));
    return queueEnabled ? ProgressSaveOutcome.queued : ProgressSaveOutcome.sent;
  }

  @override
  Future<void> useServerVersion(String sub, String uuid) async => usedServer.add(uuid);

  @override
  Future<ProgressSaveOutcome> resendMine(
    String sub,
    String uuid, {
    required String reason,
    required bool online,
    required bool queueEnabled,
  }) async {
    resent.add((uuid, reason));
    return ProgressSaveOutcome.queued;
  }
}

AuthSignedIn _as(Set<Role> roles) => AuthSignedIn(profile: profile(roles), sub: 'user-sub-1');

const _projects = [
  MasterItem(7, 'P-07 — Gudang Contoh', code: 'P-07', extra: {'status': 'berjalan'}),
];

ProgressDraft _local(ProgressSyncState s, {ServerReportCopy? copy, String uuid = 'l-1'}) => ProgressDraft(
  clientUuid: uuid,
  projectId: 7,
  projectLabel: 'P-07 — Gudang Contoh',
  stageId: 32,
  stageLabel: 'Struktur',
  pctBefore: 40,
  pctAfter: 55,
  work: 'Pengecoran kolom lantai 2',
  photoUuids: const ['ph-a'],
  syncState: s,
  conflictCopy: copy,
  lastError: s == ProgressSyncState.conflict ? 'Laporan ini sudah diubah di server. Pilih versi yang dipakai.' : null,
);

ServerReportCopy _copy({String until = '2099-01-01T00:00:00Z'}) => ServerReportCopy(
  id: 501,
  rev: 2,
  pctBefore: 40,
  pctAfter: 60,
  work: 'Pengecoran kolom (versi web)',
  photoCount: 2,
  editableUntil: until,
);

void main() {
  late FakeProgressService service;
  setUp(() => service = FakeProgressService());

  group('hub', () {
    Future<void> pumpHub(WidgetTester tester, Set<Role> roles, {List<ProgressDraft> local = const []}) => pumpScreen(
      tester,
      const ProgressScreen(),
      auth: _as(roles),
      stubProgress: false,
      overrides: [
        openProgressDraftsProvider.overrideWith((ref) => Stream.value(local)),
        progressReportsProvider.overrideWith(
          (ref, project) async => ProgressReportPage.fromJson({
            'items': [progressReportJson()],
          }),
        ),
        progressProjectsProvider.overrideWith((ref) async => _projects),
        projectProgressProvider.overrideWith((ref) async => ProjectProgressList.fromJson(projectProgressJson())),
        progressPhotoProvider.overrideWith((ref, key) async => throw const NetworkException()),
      ],
    );

    testWidgets('PM: reports waiting on the phone (queued + conflict), server list with photo thumb, FAB', (
      tester,
    ) async {
      await pumpHub(
        tester,
        {Role.pm},
        local: [
          _local(ProgressSyncState.queued),
          _local(ProgressSyncState.conflict, copy: _copy(), uuid: 'l-2'),
        ],
      );
      expect(find.text('Di HP ini (belum diterima server)'), findsOneWidget);
      expect(find.text('Menunggu kirim'), findsOneWidget);
      expect(find.text('Konflik'), findsOneWidget);
      expect(find.text('Ketuk untuk memilih versi yang dipakai.'), findsOneWidget);
      expect(find.byKey(const Key('progress-report-501')), findsOneWidget);
      expect(find.textContaining('LP/2609/0007'), findsOneWidget);
      expect(find.textContaining('Struktur · 40% → 55,5%'), findsOneWidget);
      expect(find.byIcon(Icons.broken_image), findsOneWidget, reason: 'thumb failed → icon, no crash');
      expect(find.byKey(const Key('progress-new')), findsOneWidget);
    });

    testWidgets('Finance reads only (no "Laporan baru"); project tab: physical vs budget with tone label', (
      tester,
    ) async {
      await pumpHub(tester, {Role.finance});
      expect(find.byKey(const Key('progress-new')), findsNothing);
      await tester.tap(find.byKey(const Key('progress-tab-projects')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('project-progress-7')), findsOneWidget);
      expect(find.text('Merah'), findsOneWidget);
      expect(find.text('Selisih +27,5%'), findsOneWidget);
      expect(find.text('24,5%'), findsOneWidget);
      expect(find.text('52%'), findsOneWidget);
      expect(find.text('Belum bisa dihitung'), findsOneWidget, reason: 'no RAB → tone none with its label');
      expect(find.text('Bobot tahapan baru 60% (harus 100%).'), findsOneWidget);
    });
  });

  group('editor', () {
    Future<void> pumpEditor(WidgetTester tester, {ProgressDraft? initial, bool queue = true, bool online = true}) =>
        pumpScreen(
          tester,
          ProgressEditorScreen(initial: initial),
          auth: _as({Role.pm}),
          online: online,
          overrides: [
            progressServiceProvider.overrideWithValue(service),
            appConfigProvider.overrideWith((ref) async => AppConfig(syncProgressReports: queue)),
            progressProjectsProvider.overrideWith((ref) async => _projects),
            stageSetProvider.overrideWith((ref, id) async => ProjectStageSet.fromJson(stageSetJson())),
            progressPhotoCaptureProvider.overrideWithValue((context) async => Uint8List.fromList([1, 2, 3])),
            localPhotoProvider.overrideWith((ref, uuid) async => null),
          ],
        );

    Future<void> pick(WidgetTester tester, Key dropdown, String item) async {
      await tester.tap(find.byKey(dropdown));
      await tester.pumpAndSettle();
      await tester.tap(find.text(item).last);
      await tester.pumpAndSettle();
    }

    testWidgets('new report: stage % before shown, guard against lower %, photo added, queued offline', (tester) async {
      await pumpEditor(tester, online: false);
      await pick(tester, const Key('progress-project'), 'P-07 — Gudang Contoh');
      await pick(tester, const Key('progress-stage'), 'Struktur (bobot 30%, sekarang 40%)');
      expect(find.text('Sebelum laporan: 40%'), findsOneWidget);
      final slider = tester.widget<Slider>(find.byKey(const Key('progress-slider')));
      expect(slider.min, 40, reason: 'the slider cannot go below the stage % before');
      await tester.enterText(find.byKey(const Key('progress-pct')), '35');
      await tester.enterText(find.byKey(const Key('progress-work')), 'Pengecoran kolom');
      await tester.tap(find.byKey(const Key('progress-save')));
      await tester.pumpAndSettle();
      expect(find.text('Progress tidak boleh turun (sebelumnya 40%).'), findsOneWidget);
      expect(service.saved, isEmpty);
      await tester.enterText(find.byKey(const Key('progress-pct')), '55,5');
      await tester.tap(find.byKey(const Key('progress-add-photo')));
      await tester.pumpAndSettle();
      expect(find.text('Foto (1/5)'), findsOneWidget);
      await tester.tap(find.byKey(const Key('progress-save')));
      await tester.pumpAndSettle();
      final (d, online, queue) = service.saved.single;
      expect(d.projectId, 7);
      expect(d.stageId, 32);
      expect(d.pctBefore, 40);
      expect(d.pctAfter, 55.5);
      expect(d.photoUuids, ['ph-1']);
      expect(d.isEdit, isFalse);
      expect(online, isFalse);
      expect(queue, isTrue);
      expect(find.textContaining('Laporan tersimpan di HP (offline)'), findsOneWidget);
    });

    testWidgets('queue disabled by the server + offline: send button disabled with "Butuh koneksi internet"', (
      tester,
    ) async {
      await pumpEditor(tester, queue: false, online: false);
      expect(find.textContaining('server belum mengizinkan kirim offline'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.byKey(const Key('progress-save'))).onPressed, isNull);
      expect(find.text('Butuh koneksi internet'), findsOneWidget);
    });

    testWidgets('edit of a server report: project/stage locked, reason required, server photos counted', (
      tester,
    ) async {
      await pumpEditor(
        tester,
        initial: const ProgressDraft(
          clientUuid: 'e-1',
          projectId: 7,
          projectLabel: 'P-07 — Gudang Contoh',
          stageId: 32,
          stageLabel: 'Struktur',
          pctBefore: 40,
          pctAfter: 55.5,
          work: 'Pengecoran kolom',
          serverId: 501,
          serverRev: 1,
          serverPctAfter: 55.5,
          serverPhotoCount: 4,
          editableUntil: '2099-01-01T00:00:00Z',
        ),
      );
      expect(find.text('Edit laporan progress'), findsOneWidget);
      expect(find.text('Foto (4/5)'), findsOneWidget);
      expect(find.textContaining('4 foto sudah di server'), findsOneWidget);
      await tester.tap(find.byKey(const Key('progress-save')));
      await tester.pumpAndSettle();
      expect(find.text('Alasan edit wajib diisi (min. 3 karakter).'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('progress-reason')), 'Salah ketik volume');
      await tester.tap(find.byKey(const Key('progress-save')));
      await tester.pumpAndSettle();
      final d = service.saved.single.$1;
      expect(d.isEdit, isTrue);
      expect(d.reason, 'Salah ketik volume');
      expect(d.serverRev, 1);
    });
  });

  group('conflict + detail', () {
    testWidgets('conflict: both versions side by side; keep server version', (tester) async {
      await pumpScreen(
        tester,
        const ProgressConflictScreen(uuid: 'l-2'),
        auth: _as({Role.pm}),
        stubProgress: false,
        overrides: [
          progressServiceProvider.overrideWithValue(service),
          openProgressDraftsProvider.overrideWith(
            (ref) => Stream.value([_local(ProgressSyncState.conflict, copy: _copy(), uuid: 'l-2')]),
          ),
          progressReportsProvider.overrideWith((ref, p) async => const ProgressReportPage(items: [])),
        ],
      );
      expect(find.text('60%'), findsOneWidget);
      expect(find.text('55%'), findsOneWidget);
      expect(find.text('Pengecoran kolom (versi web)'), findsOneWidget);
      expect(find.text('+1 foto baru'), findsOneWidget);
      await tester.tap(find.byKey(const Key('conflict-resend')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('reason-field')), 'Data lapangan');
      await tester.tap(find.byKey(const Key('reason-ok')));
      await tester.pumpAndSettle();
      expect(service.resent.single, ('l-2', 'Data lapangan'));
      await tester.tap(find.byKey(const Key('conflict-use-server')));
      await tester.pumpAndSettle();
      expect(service.usedServer.single, 'l-2');
    });

    testWidgets('after 24 h only the server version can be kept', (tester) async {
      await pumpScreen(
        tester,
        const ProgressConflictScreen(uuid: 'l-3'),
        auth: _as({Role.pm}),
        stubProgress: false,
        overrides: [
          openProgressDraftsProvider.overrideWith(
            (ref) => Stream.value([
              _local(
                ProgressSyncState.rejected,
                copy: _copy(until: '2020-01-01T00:00:00Z'),
                uuid: 'l-3',
              ),
            ]),
          ),
        ],
      );
      expect(tester.widget<OutlinedButton>(find.byKey(const Key('conflict-resend'))).onPressed, isNull);
      expect(find.textContaining('Batas edit 24 jam sudah lewat'), findsOneWidget);
    });

    testWidgets('detail: bars, work/issues, photos, edit button for the reporter within 24 h', (tester) async {
      await pumpScreen(
        tester,
        const ProgressDetailScreen(id: 501),
        auth: _as({Role.pm}),
        overrides: [
          progressDetailProvider.overrideWith((ref, id) async => ProgressReport.fromJson(progressReportJson())),
          progressPhotoProvider.overrideWith((ref, key) async => throw const NetworkException()),
        ],
      );
      expect(find.text('LP/2609/0007'), findsOneWidget);
      expect(find.text('Tahapan (sebelumnya 40%)'), findsOneWidget);
      expect(find.text('55,5%'), findsOneWidget);
      expect(find.text('Hujan sore, pengecoran tertunda 1 jam'), findsOneWidget);
      expect(find.byKey(const Key('photo-901')), findsOneWidget);
      expect(find.byKey(const Key('photo-902')), findsOneWidget);
      expect(find.byKey(const Key('progress-edit')), findsOneWidget);
    });

    testWidgets('detail: Finance never sees the edit button', (tester) async {
      await pumpScreen(
        tester,
        const ProgressDetailScreen(id: 501),
        auth: _as({Role.finance}),
        overrides: [
          progressDetailProvider.overrideWith((ref, id) async => ProgressReport.fromJson(progressReportJson())),
          progressPhotoProvider.overrideWith((ref, key) async => throw const NetworkException()),
        ],
      );
      expect(find.byKey(const Key('progress-edit')), findsNothing);
    });
  });

  group('home', () {
    Future<void> pumpHome(WidgetTester tester, Set<Role> roles) => pumpScreen(
      tester,
      const HomeScreen(),
      auth: _as(roles),
      stubProgress: false,
      overrides: [
        openProgressDraftsProvider.overrideWith((ref) => Stream.value([_local(ProgressSyncState.queued)])),
        projectProgressProvider.overrideWith((ref) async => ProjectProgressList.fromJson(projectProgressJson())),
        appConfigProvider.overrideWith((ref) async => const AppConfig(syncAttendance: false)),
        integrityReportProvider.overrideWith((ref) async => null),
        pmDashboardProvider.overrideWith((ref) async => throw const NetworkException()),
      ],
    );

    testWidgets('Staff: no progress button; attendance stays open for the recap when the flag is off', (tester) async {
      await pumpHome(tester, {Role.staff});
      expect(find.byKey(const Key('home-progress')), findsNothing);
      expect(find.byKey(const Key('home-project-progress')), findsNothing);
      expect(find.textContaining('Rekap bulanan (absen dari aplikasi belum diaktifkan Admin)'), findsOneWidget);
    });

    testWidgets('PM: progress button with the unsent count and the progress-vs-budget summary', (tester) async {
      await pumpHome(tester, {Role.pm});
      expect(find.byKey(const Key('home-progress')), findsOneWidget);
      expect(find.text('1 laporan belum terkirim'), findsOneWidget);
      expect(find.byKey(const Key('home-project-progress')), findsOneWidget);
      expect(find.byKey(const Key('project-progress-7')), findsOneWidget);
    });
  });
}
