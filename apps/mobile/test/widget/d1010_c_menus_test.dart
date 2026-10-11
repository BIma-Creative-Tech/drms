import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/app/theme.dart';
import 'package:proyekkas/core/connectivity/connectivity_controller.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/features/approvals/data/approvals_api.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/dashboard/presentation/kpi_home.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/finance/application/finance_providers.dart';
import 'package:proyekkas/features/finance/domain/transfer_queue.dart';
import 'package:proyekkas/features/finance/presentation/finance_screen.dart';
import 'package:proyekkas/features/finance/presentation/transfer_form_screen.dart';
import 'package:proyekkas/features/home/presentation/home_screen.dart';
import 'package:proyekkas/features/projects/application/projects_providers.dart';
import 'package:proyekkas/features/projects/presentation/project_detail_screen.dart';
import 'package:proyekkas/features/projects/presentation/projects_screen.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../support/d1010_c_fixtures.dart';
import '../support/harness.dart';
import '../support/widget_harness.dart';

/// DRMS 10/10 Phase C on the APK: point 6 "Proyek" (list with search / status filter / infinite scroll, project
/// with tabs Proyek / RAP / Pengajuan) and point 10 "Finance" (Antrian Transfer, Catat transfer with cost center
/// D2 + transfer date-time D11, LPJ list).

/// [initial] inside a GoRouter (so taps that navigate can be followed); other targets are stub pages.
Future<void> pumpRouted(
  WidgetTester tester,
  String initial, {
  Set<Role> roles = const {Role.finance},
  List<Override> overrides = const [],
}) async {
  await initializeDateFormatting('id');
  tester.view.physicalSize = const Size(1200, 3200);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final db = memoryDb();
  addTearDown(db.close);
  final router = GoRouter(
    initialLocation: initial,
    routes: [
      GoRoute(path: '/projects', builder: (_, _) => const ProjectsScreen()),
      GoRoute(
        path: '/projects/:id',
        builder: (_, s) => ProjectDetailScreen(id: int.parse(s.pathParameters['id']!)),
      ),
      GoRoute(path: '/finance', builder: (_, _) => const FinanceScreen()),
      GoRoute(
        path: '/finance/transfer/:id',
        builder: (_, s) => TransferFormRoute(id: int.parse(s.pathParameters['id']!)),
      ),
      GoRoute(path: '/requests/:id', builder: (_, s) => Text('request-page-${s.pathParameters['id']}')),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    ProviderScope(
      retry: (_, _) => null,
      overrides: [
        appEnvProvider.overrideWithValue(testEnv('https://example.test')),
        secureStoreProvider.overrideWithValue(MemorySecureStore()),
        deviceIdentityProvider.overrideWithValue(testDevice()),
        databaseProvider.overrideWithValue(db),
        connectivityProvider.overrideWith(() => FakeConnectivity(true)),
        authControllerProvider.overrideWith(() => FakeAuth(AuthSignedIn(profile: profile(roles), sub: 'user-sub-1'))),
        lpjQueueProvider.overrideWith((ref) async => const <ExpenseSummary>[]),
        ...overrides,
      ],
      child: MaterialApp.router(
        routerConfig: router,
        theme: buildTheme(),
        locale: const Locale('id'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// 1×1 transparent PNG.
final png = Uint8List.fromList(
  base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
);

void main() {
  group('point 6: Proyek', () {
    testWidgets('list: cards, search + status filter go to the server, infinite scroll loads page 2', (tester) async {
      final api = FakeProjectsApi();
      await pumpRouted(tester, '/projects', roles: {Role.pm}, overrides: [projectsApiProvider.overrideWithValue(api)]);
      expect(find.byKey(const Key('project-9')), findsOneWidget);
      expect(find.text('Jalan Tambang Blok B'), findsOneWidget);
      expect(find.text('PM: Rudi Hartono · Rp 2.500.000.000'), findsWidgets);
      expect(find.byKey(const Key('project-9-over')), findsOneWidget, reason: 'RAP items over plan');
      expect(api.listCalls.first, (q: '', status: null, page: 1));
      // the end of the list is visible on this tall test screen → page 2 is loaded
      expect(api.listCalls.any((c) => c.page == 2), isTrue);
      expect(find.byKey(const Key('project-11')), findsOneWidget);

      await tester.enterText(find.byKey(const Key('projects-search')), 'blok b');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(api.listCalls.last.q, 'blok b');
      expect(find.byKey(const Key('project-10')), findsNothing);

      await tester.tap(find.byKey(const Key('project-status-selesai')));
      await tester.pumpAndSettle();
      expect(api.listCalls, contains((q: 'blok b', status: 'selesai', page: 1)));

      await tester.tap(find.byKey(const Key('project-9')));
      await tester.pumpAndSettle();
      expect(find.byType(ProjectDetailScreen), findsOneWidget);
    });

    testWidgets('project tabs: Proyek info, RAP plan/realisation/sisa with over budget, Pengajuan filter + open', (
      tester,
    ) async {
      final api = FakeProjectsApi();
      await pumpRouted(
        tester,
        '/projects/9',
        roles: {Role.finance},
        overrides: [projectsApiProvider.overrideWithValue(api)],
      );
      expect(find.text('Proyek'), findsOneWidget);
      expect(find.text('RAP'), findsOneWidget);
      expect(find.text('Pengajuan'), findsOneWidget);
      // Proyek: code, name, PM, status, contract value, cost center
      expect(find.text('PRJ-09'), findsWidgets);
      expect(tester.widget<Text>(find.byKey(const Key('project-pm'))).data, 'Rudi Hartono');
      expect(tester.widget<Text>(find.byKey(const Key('project-contract'))).data, 'Rp 2.500.000.000');
      expect(tester.widget<Text>(find.byKey(const Key('project-cost-center'))).data, 'OPS-PB Ops Palangka Banjar');
      expect(tester.widget<Text>(find.byKey(const Key('project-rap-remaining'))).data, 'Rp 6.300.000');

      await tester.tap(find.byKey(const Key('tab-project-rap')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('rap-item-501')), findsOneWidget);
      expect(find.byKey(const Key('rap-item-501-over')), findsOneWidget);
      expect(find.byKey(const Key('rap-item-502-over')), findsNothing);
      expect(find.text('-Rp 1.200.000'), findsOneWidget);
      expect(find.text('108%'), findsOneWidget);

      await tester.tap(find.byKey(const Key('tab-project-requests')));
      await tester.pumpAndSettle();
      expect(api.requestCalls.last, (projectId: 9, q: '', status: null, page: 1));
      expect(find.byKey(const Key('project-request-42')), findsOneWidget);
      expect(find.byKey(const Key('project-request-44')), findsOneWidget);
      await tester.tap(find.byKey(const Key('project-requests-status')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Draft').last);
      await tester.pumpAndSettle();
      expect(api.requestCalls.last.status, 'draft');
      expect(find.byKey(const Key('project-request-42')), findsNothing);
      await tester.tap(find.byKey(const Key('project-request-44')));
      await tester.pumpAndSettle();
      expect(find.text('request-page-44'), findsOneWidget);
    });

    Future<void> home(WidgetTester tester, Set<Role> roles) => pumpScreen(
      tester,
      const HomeScreen(),
      auth: AuthSignedIn(profile: profile(roles), sub: 's'),
      overrides: [
        inboxProvider.overrideWith((ref) async => const InboxPage([], 85)),
        transferQueueProvider.overrideWith((ref) async => queueFixture()),
        direkturDashboardProvider.overrideWith((ref) async => throw UnimplementedError()),
        financeDashboardProvider.overrideWith((ref) async => throw UnimplementedError()),
        pmDashboardProvider.overrideWith((ref) async => throw UnimplementedError()),
      ],
    );

    testWidgets('home: Staff has neither Proyek nor Finance', (tester) async {
      await home(tester, {Role.staff});
      expect(find.byKey(const Key('home-projects')), findsNothing);
      expect(find.byKey(const Key('home-finance')), findsNothing);
    });

    testWidgets('home: PM has Proyek, no Finance', (tester) async {
      await home(tester, {Role.pm});
      expect(find.byKey(const Key('home-projects')), findsOneWidget);
      expect(find.byKey(const Key('home-finance')), findsNothing);
    });

    testWidgets('home: Finance has Proyek and Finance with the queue count', (tester) async {
      await home(tester, {Role.finance});
      expect(find.byKey(const Key('home-projects')), findsOneWidget);
      expect(find.byKey(const Key('home-finance')), findsOneWidget);
      expect(find.text('2 siap ditransfer'), findsOneWidget);
    });
  });

  group('point 10: Finance', () {
    testWidgets('Antrian Transfer: SLA badge, Selisih nota (n), cost center, search + jenis filter', (tester) async {
      await pumpRouted(tester, '/finance', overrides: [financeApiProvider.overrideWithValue(FakeFinanceApi())]);
      expect(find.text('Antrian Transfer (2)'), findsOneWidget);
      expect(find.text('1 hr 6 jam sejak disetujui · lewat SLA 24 jam'), findsOneWidget);
      expect(find.text('5 jam sejak disetujui'), findsOneWidget);
      expect(find.byKey(const Key('tq-42-mismatch')), findsOneWidget);
      expect(find.text('Selisih nota (2)'), findsOneWidget);
      expect(find.byKey(const Key('tq-43-mismatch')), findsNothing);
      expect(tester.widget<Text>(find.byKey(const Key('tq-42-cc'))).data, 'Pusat biaya: OPS-PB Ops Palangka Banjar');
      expect(tester.widget<Text>(find.byKey(const Key('tq-43-cc'))).data, 'Pusat biaya: dipilih Finance saat transfer');
      expect(find.text('Belum diverifikasi'), findsOneWidget);
      expect(find.byKey(const Key('tq-42-transfer')), findsOneWidget);

      await tester.tap(find.byKey(const Key('transfer-type-advance')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('tq-42')), findsNothing);
      expect(find.byKey(const Key('tq-43')), findsOneWidget);
      await tester.tap(find.byKey(const Key('transfer-type-all')));
      await tester.tap(find.byKey(const Key('transfer-sla-over')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('tq-43')), findsNothing);
      await tester.tap(find.byKey(const Key('transfer-sla-over')));
      await tester.enterText(find.byKey(const Key('transfer-search')), 'tronton');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('tq-42')), findsOneWidget);
      expect(find.byKey(const Key('tq-43')), findsNothing);
    });

    testWidgets('Direktur sees the queue but no "Catat transfer" (Finance only)', (tester) async {
      await pumpRouted(
        tester,
        '/finance',
        roles: {Role.owner},
        overrides: [financeApiProvider.overrideWithValue(FakeFinanceApi())],
      );
      expect(find.byKey(const Key('tq-42')), findsOneWidget);
      expect(find.byKey(const Key('tq-42-transfer')), findsNothing);
    });

    testWidgets('Catat transfer: amount from the server, required fields, cost center suggestion, confirm 409', (
      tester,
    ) async {
      final api = FakeFinanceApi()..confirmFirst.add('BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED');
      await pumpRouted(
        tester,
        '/finance',
        overrides: [
          financeApiProvider.overrideWithValue(api),
          photoCompressorProvider.overrideWithValue(FakeCompressor()),
          proofPickerProvider.overrideWithValue((context, {required fromCamera}) async => png),
        ],
      );
      await tester.tap(find.byKey(const Key('tq-42-transfer')));
      await tester.pumpAndSettle();
      expect(find.byType(TransferFormScreen), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('transfer-amount'))).data, 'Transfer Rp 1.447.500');
      // cost center pre-selected with the project default; first cash account selected
      expect(find.text('OPS-PB Ops Palangka Banjar'), findsOneWidget);
      expect(find.text('Usulan: pusat biaya default project. Ubah bila perlu.'), findsOneWidget);
      expect(find.text('Bank Mandiri Operasional · Rp 52.000.000'), findsOneWidget);

      await tester.tap(
        find.descendant(of: find.byKey(const Key('transfer-submit')), matching: find.bySubtype<FilledButton>()),
      );
      await tester.pumpAndSettle();
      expect(find.text('Isi tanggal & jam transfer sesuai bukti.'), findsOneWidget);
      expect(find.text('No. referensi bank wajib diisi.'), findsOneWidget);
      expect(find.text('Bukti wajib diunggah.'), findsOneWidget);
      expect(api.uploads, 0);
      expect(api.transfers, isEmpty);

      // date + time (pickers: OK twice)
      await tester.tap(find.byKey(const Key('transfer-at')));
      await tester.pumpAndSettle();
      final ok = MaterialLocalizations.of(tester.element(find.byType(TransferFormScreen))).okButtonLabel;
      await tester.tap(find.text(ok));
      await tester.pumpAndSettle();
      await tester.tap(find.text(ok));
      await tester.pumpAndSettle();
      expect(find.textContaining('WITA'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('transfer-bank-ref')), ' REF-778899 ');
      await tester.tap(find.byKey(const Key('transfer-proof-gallery')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('transfer-proof-thumb')), findsOneWidget);

      await tester.tap(
        find.descendant(of: find.byKey(const Key('transfer-submit')), matching: find.bySubtype<FilledButton>()),
      );
      await tester.pumpAndSettle();
      // QA-17: unverified account → confirm, then re-sent with the flag (proof not re-uploaded)
      expect(find.text('Rekening tujuan belum diverifikasi'), findsOneWidget);
      await tester.tap(find.byKey(const Key('transfer-override-confirm')));
      await tester.pumpAndSettle();
      expect(api.uploads, 1);
      expect(api.transfers, hasLength(2));
      final body = api.transfers.last.body;
      expect(body['cashAccountId'], 3);
      expect(body['costCenterId'], 7);
      expect(body['bankRef'], 'REF-778899');
      expect(body['proofMediaId'], 9001);
      expect(body['confirmUnverifiedAccount'], isTrue);
      expect(body.containsKey('amount'), isFalse, reason: 'G3: the server sets the amount');
      expect(body['transferAt'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\+08:00$')));
      expect(api.transfers.first.key, isNot(api.transfers.last.key), reason: 'another body → another key');
      expect(find.byType(TransferFormScreen), findsNothing, reason: 'back to the queue');
    });

    testWidgets('no project default: cost center must be picked', (tester) async {
      await pumpRouted(
        tester,
        '/finance/transfer/43',
        overrides: [financeApiProvider.overrideWithValue(FakeFinanceApi())],
      );
      expect(find.text('Project belum punya pusat biaya default — pilih.'), findsOneWidget);
      await tester.tap(
        find.descendant(of: find.byKey(const Key('transfer-submit')), matching: find.bySubtype<FilledButton>()),
      );
      await tester.pumpAndSettle();
      expect(find.text('Pilih pusat biaya.'), findsOneWidget);
    });
  });

  group('transfer form rules (pure)', () {
    const wita = Duration(hours: 8);
    final now = DateTime.utc(2026, 10, 11, 4, 0); // 12.00 WITA
    Map<String, String> v({DateTime? at, int? cc = 7, String ref = 'R1', bool proof = true}) => validateTransferForm(
      cashAccountId: 3,
      costCenterId: cc,
      transferAt: at,
      zoneOffset: wita,
      bankRef: ref,
      hasProof: proof,
      nowUtc: now,
    );

    test('every field required; not in the future (2 minutes skew like the server)', () {
      expect(v(at: DateTime(2026, 10, 11, 11, 30)), isEmpty);
      expect(v(at: DateTime(2026, 10, 11, 12, 2)), isEmpty, reason: 'within the skew');
      expect(v(at: DateTime(2026, 10, 11, 12, 5))['transferAt'], 'Tanggal & jam transfer tidak boleh di masa depan.');
      expect(v(at: null, cc: null, ref: ' ', proof: false).keys.toSet(), {
        'transferAt',
        'costCenterId',
        'bankRef',
        'proof',
      });
      expect(v(at: DateTime(2026, 10, 11, 9), ref: 'x' * 65)['bankRef'], isNotNull);
    });

    test('transferAt = PT wall clock + zone offset; SLA hours like the web', () {
      expect(transferAtString(DateTime(2026, 10, 11, 9, 5), wita), '2026-10-11T09:05+08:00');
      expect(transferAtString(DateTime(2026, 1, 2, 23, 59), const Duration(hours: 7)), '2026-01-02T23:59+07:00');
      expect(
        [formatSlaHours(null), formatSlaHours(0.5), formatSlaHours(5.2), formatSlaHours(30.5), formatSlaHours(48)],
        ['—', '< 1 jam', '5 jam', '1 hr 6 jam', '2 hr'],
      );
    });

    test('queue item JSON: flags, SLA, cost center suggestion; older server without the extras', () {
      final i = queueFixture().first;
      expect((i.receiptMismatch, i.warningFlags, i.sla.over, i.costCenter?.id, i.amount), (2, 1, true, 7, 1447500));
      final old = transferQueueItemFromJson(
        {...queueJson(5)}..removeWhere((k, _) => ['flags', 'sla', 'costCenter'].contains(k)),
      );
      expect((old.receiptMismatch, old.warningFlags, old.sla.ageHours, old.costCenter), (0, 1, null, null));
    });
  });
}
