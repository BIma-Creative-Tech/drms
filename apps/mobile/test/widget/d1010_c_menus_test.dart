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
import '../support/fixtures.dart';
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

    testWidgets(
      'D4 (2026-10-11): RAP tab of a project with a RAB but no RAP says "Project belum punya RAP — hubungi PM"',
      (tester) async {
        final api = FakeProjectsApi()..rapItems = const [];
        await pumpRouted(
          tester,
          '/projects/9',
          roles: {Role.staff},
          overrides: [projectsApiProvider.overrideWithValue(api)],
        );
        await tester.tap(find.byKey(const Key('tab-project-rap')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('project-rap-missing')), findsOneWidget);
        expect(find.text('Project belum punya RAP — hubungi PM'), findsOneWidget);
      },
    );

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
      // Proyek: code, name, PM, status, contract value, Pusat Biaya (ADR 0031: the project's cash account)
      expect(find.text('PRJ-09'), findsWidgets);
      expect(tester.widget<Text>(find.byKey(const Key('project-pm'))).data, 'Rudi Hartono');
      expect(tester.widget<Text>(find.byKey(const Key('project-contract'))).data, 'Rp 2.500.000.000');
      expect(tester.widget<Text>(find.byKey(const Key('project-cost-center'))).data, 'Bank Mandiri Operasional');
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
      expect(api.requestCalls.last, (projectId: 9, q: '', status: null, mine: false, page: 1));
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

    testWidgets(
      'project tabs for Staff (owner 2026-10-11): no contract value, no RAP money, no Pinjaman, own requests',
      (tester) async {
        final api = FakeProjectsApi(noMoney: true);
        await pumpRouted(
          tester,
          '/projects/9',
          roles: {Role.staff},
          overrides: [projectsApiProvider.overrideWithValue(api)],
        );
        expect(find.byKey(const Key('tab-project-info')), findsOneWidget);
        expect(find.byKey(const Key('tab-project-rap')), findsOneWidget);
        expect(find.byKey(const Key('tab-project-requests')), findsOneWidget);
        expect(find.byKey(const Key('tab-project-loans')), findsNothing);
        expect(find.text('PRJ-09'), findsWidgets);
        expect(tester.widget<Text>(find.byKey(const Key('project-pm'))).data, 'Rudi Hartono');
        expect(find.byKey(const Key('project-contract')), findsNothing);
        expect(find.byKey(const Key('project-rap-remaining')), findsNothing);
        expect(find.textContaining('Rp'), findsNothing);

        await tester.tap(find.byKey(const Key('tab-project-requests')));
        await tester.pumpAndSettle();
        expect(api.requestCalls.last, (projectId: 9, q: '', status: null, mine: true, page: 1));
      },
    );

    testWidgets('home: Staff has Proyek (owner 2026-10-11), no Persetujuan', (tester) async {
      await home(tester, {Role.staff});
      expect(find.byKey(const Key('home-module-proyek')), findsOneWidget);
      expect(find.byKey(const Key('home-module-persetujuan')), findsNothing);
    });

    testWidgets('home: Operator/Anggota has neither Proyek nor Persetujuan', (tester) async {
      await home(tester, {Role.operator});
      expect(find.byKey(const Key('home-module-proyek')), findsNothing);
      expect(find.byKey(const Key('home-module-persetujuan')), findsNothing);
      expect(find.byKey(const Key('home-module-absensi')), findsOneWidget);
    });

    testWidgets('home: PM has Proyek and Persetujuan (ADR 0021)', (tester) async {
      await home(tester, {Role.pm});
      expect(find.byKey(const Key('home-module-proyek')), findsOneWidget);
      expect(find.byKey(const Key('home-module-persetujuan')), findsOneWidget);
    });

    testWidgets('home: Finance has Proyek and Persetujuan (Antrian Transfer inside)', (tester) async {
      await home(tester, {Role.finance});
      expect(find.byKey(const Key('home-module-proyek')), findsOneWidget);
      expect(find.byKey(const Key('home-module-persetujuan')), findsOneWidget);
    });
  });

  group('point 10: Finance', () {
    testWidgets('Antrian Transfer: SLA badge, Selisih nota (n), Pusat biaya, search + jenis filter', (tester) async {
      await pumpRouted(tester, '/finance', overrides: [financeApiProvider.overrideWithValue(FakeFinanceApi())]);
      expect(find.text('Antrian Transfer (2)'), findsOneWidget);
      expect(find.text('1 hr 6 jam sejak disetujui · lewat SLA 24 jam'), findsOneWidget);
      expect(find.text('5 jam sejak disetujui'), findsOneWidget);
      expect(find.byKey(const Key('tq-42-mismatch')), findsOneWidget);
      expect(find.text('Selisih nota (2)'), findsOneWidget);
      expect(find.byKey(const Key('tq-43-mismatch')), findsNothing);
      expect(tester.widget<Text>(find.byKey(const Key('tq-42-cc'))).data, 'Pusat biaya: Bank Mandiri Operasional');
      expect(
        tester.widget<Text>(find.byKey(const Key('tq-43-cc'))).data,
        'Pusat biaya: dipilih Finance (tanpa project)',
      );
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

    testWidgets('Catat transfer: amount from the server, required fields, Pusat Biaya default, confirm 409', (
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
      // ADR 0031: "Dibayar dari akun" pre-selected with the project's Pusat Biaya; no cost center picker
      expect(find.text('Bank Mandiri Operasional · Rp 52.000.000 (pusat biaya project)'), findsOneWidget);
      expect(find.text('Pusat biaya project: Bank Mandiri Operasional.'), findsOneWidget);
      expect(find.byKey(const Key('transfer-loan-panel')), findsNothing);

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
      expect(body.containsKey('costCenterId'), isFalse, reason: 'ADR 0031: deprecated, never sent');
      expect(body.containsKey('loanReason'), isFalse, reason: 'paid from the Pusat Biaya: no loan');
      expect(body['bankRef'], 'REF-778899');
      expect(body['proofMediaId'], 9001);
      expect(body['confirmUnverifiedAccount'], isTrue);
      expect(body.containsKey('amount'), isFalse, reason: 'G3: the server sets the amount');
      expect(body['transferAt'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\+08:00$')));
      expect(api.transfers.first.key, isNot(api.transfers.last.key), reason: 'another body → another key');
      expect(find.byType(TransferFormScreen), findsNothing, reason: 'back to the queue');
    });

    testWidgets('ADR 0031: paid from another account → loan panel, reason required, sent with the transfer', (
      tester,
    ) async {
      final api = FakeFinanceApi();
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
      await tester.tap(find.byKey(const Key('transfer-cash-account')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Kas Kecil · Rp 1.500.000'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('transfer-loan-panel')), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const Key('transfer-loan-note'))).data,
        'Akun ini bukan pusat biaya project (Bank Mandiri Operasional). Akan tercatat otomatis pinjaman antar project: '
        'kas keluar dari akun pembayar dan kas masuk ke pusat biaya project.',
      );

      await tester.tap(find.byKey(const Key('transfer-at')));
      await tester.pumpAndSettle();
      final ok = MaterialLocalizations.of(tester.element(find.byType(TransferFormScreen))).okButtonLabel;
      await tester.tap(find.text(ok));
      await tester.pumpAndSettle();
      await tester.tap(find.text(ok));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('transfer-bank-ref')), 'REF-1');
      await tester.tap(find.byKey(const Key('transfer-proof-gallery')));
      await tester.pumpAndSettle();
      final submit = find.descendant(
        of: find.byKey(const Key('transfer-submit')),
        matching: find.bySubtype<FilledButton>(),
      );
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(
        find.text('Isi alasan membayar dari akun lain (tercatat sebagai pinjaman antar project).'),
        findsOneWidget,
      );
      expect(api.transfers, isEmpty);

      await tester.enterText(find.byKey(const Key('transfer-loan-reason')), ' saldo pusat biaya belum cukup ');
      await tester.tap(submit);
      await tester.pumpAndSettle();
      final body = api.transfers.single.body;
      expect(body['cashAccountId'], 4);
      expect(body['loanReason'], 'saldo pusat biaya belum cukup');
      expect(body.containsKey('loanDueDate'), isFalse, reason: 'empty = server default (+30 days)');
      expect(body.containsKey('costCenterId'), isFalse);
      expect(find.byType(TransferFormScreen), findsNothing, reason: 'back to the queue');
    });

    testWidgets('ADR 0031: project without Pusat Biaya — the transfer is blocked', (tester) async {
      final api = FakeFinanceApi()
        ..queue = [transferQueueItemFromJson(queueJson(45, pusatBiaya: null, pusatBiayaMissing: true))];
      await pumpRouted(tester, '/finance', overrides: [financeApiProvider.overrideWithValue(api)]);
      expect(tester.widget<Text>(find.byKey(const Key('tq-45-cc'))).data, 'Pusat biaya: project belum dipetakan');
      await tester.tap(find.byKey(const Key('tq-45-transfer')));
      await tester.pumpAndSettle();
      expect(
        find.text('Project belum punya pusat biaya (akun kas) — transfer ditolak sampai dipetakan di data project.'),
        findsOneWidget,
      );
      await tester.tap(
        find.descendant(of: find.byKey(const Key('transfer-submit')), matching: find.bySubtype<FilledButton>()),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('Project belum dipetakan ke pusat biaya (akun kas). Petakan dulu di data project.'),
        findsOneWidget,
      );
      expect(api.transfers, isEmpty);
    });
  });

  group('transfer form rules (pure)', () {
    const wita = Duration(hours: 8);
    final now = DateTime.utc(2026, 10, 11, 4, 0); // 12.00 WITA
    Map<String, String> v({
      DateTime? at,
      int? account = 3,
      int? pb = 3,
      bool missing = false,
      String reason = '',
      String? due,
      String ref = 'R1',
      bool proof = true,
    }) => validateTransferForm(
      cashAccountId: account,
      pusatBiayaId: pb,
      pusatBiayaMissing: missing,
      loanReason: reason,
      loanDueDate: due,
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
      expect(v(at: null, account: null, ref: ' ', proof: false).keys.toSet(), {
        'cashAccountId',
        'transferAt',
        'bankRef',
        'proof',
      });
      expect(v(at: DateTime(2026, 10, 11, 9), ref: 'x' * 65)['bankRef'], isNotNull);
    });

    test('ADR 0031: another account than the Pusat Biaya needs a loan reason; unmapped project blocks', () {
      final at = DateTime(2026, 10, 11, 9);
      expect(v(at: at, pb: null, account: 4), isEmpty, reason: 'no project: Finance picks the paying account');
      expect(
        v(at: at, account: 4)['loanReason'],
        'Isi alasan membayar dari akun lain (tercatat sebagai pinjaman antar project).',
      );
      expect(
        v(at: at, account: 4, reason: ' ab ')['loanReason'],
        isNotNull,
        reason: 'min 3 after trim',
      );
      expect(v(at: at, account: 4, reason: 'saldo kurang'), isEmpty);
      expect(v(at: at, account: 4, reason: 'saldo kurang', due: '2026-11-10'), isEmpty);
      expect(
        v(at: at, account: 4, reason: 'saldo kurang', due: '2026-10-10')['loanDueDate'],
        'Jatuh tempo pinjaman tidak boleh sebelum tanggal transfer.',
      );
      expect(
        v(at: at, reason: '', due: '2026-10-01'),
        isEmpty,
        reason: 'paid from the Pusat Biaya: no loan fields',
      );
      expect(
        v(at: at, pb: null, missing: true)['pusatBiaya'],
        'Project belum dipetakan ke pusat biaya (akun kas). Petakan dulu di data project.',
      );
      expect(transferNeedsLoan(pusatBiayaId: 3, cashAccountId: 4), isTrue);
      expect(transferNeedsLoan(pusatBiayaId: 3, cashAccountId: 3), isFalse);
      expect(transferNeedsLoan(pusatBiayaId: null, cashAccountId: 4), isFalse);
    });

    test('ADR 0031: transfer body — no cost center; loan reason / due date only with a reason', () {
      Map<String, dynamic> b({String? reason, String? due}) => transferBody(
        cashAccountId: 4,
        transferAt: '2026-10-11T09:00+08:00',
        bankRef: ' R1 ',
        proofMediaId: 9,
        loanReason: reason,
        loanDueDate: due,
      );
      expect(b().keys.toSet(), {'cashAccountId', 'transferAt', 'bankRef', 'proofMediaId'});
      expect(b(reason: ' saldo kurang ', due: '2026-11-10'), {
        'cashAccountId': 4,
        'transferAt': '2026-10-11T09:00+08:00',
        'bankRef': 'R1',
        'proofMediaId': 9,
        'loanReason': 'saldo kurang',
        'loanDueDate': '2026-11-10',
      });
      expect(b(reason: ' ', due: '2026-11-10').containsKey('loanDueDate'), isFalse);
    });

    test('ADR 0031: transfer result — the automatic loan number (result, else the latest transfer)', () {
      final withLoan = transferOutcomeFromJson({
        'request': detailJson(status: 'transferred', allowed: const []),
        'projectLoan': {'id': 61, 'docNo': 'PJ/DRMS/2610/0007', 'kk': 'KK/0101', 'km': 'KM/0102'},
      });
      expect(withLoan.loanNo, 'PJ/DRMS/2610/0007');
      expect((withLoan.projectLoan?.kk, withLoan.projectLoan?.km), ('KK/0101', 'KM/0102'));
      final fromTransfer = transferOutcomeFromJson({
        'request': {
          ...detailJson(status: 'transferred', allowed: const []),
          'transfers': [
            {
              'id': 1,
              'docNo': 'TRF/1',
              'kind': 'advance',
              'amount': 1,
              'status': 'posted',
              'cashAccount': {'id': 3, 'name': 'Bank Mandiri Operasional'},
              'paidFromCashAccount': {'id': 4, 'name': 'Kas Kecil'},
              'projectLoan': {'id': 61, 'docNo': 'PJ/DRMS/2610/0007', 'status': 'approved'},
            },
          ],
        },
        'projectLoan': null,
      });
      expect(fromTransfer.loanNo, 'PJ/DRMS/2610/0007');
      final t = fromTransfer.request.transfers.single;
      expect(t.cashAccount?.label, 'Bank Mandiri Operasional');
      expect((t.paidFromCashAccount?.label, t.projectLoan?.id), ('Kas Kecil', 61));
      final plain = transferOutcomeFromJson({'request': detailJson(status: 'transferred', allowed: const [])});
      expect((plain.loanNo, plain.projectLoan), (null, null));
    });

    test('transferAt = PT wall clock + zone offset; SLA hours like the web', () {
      expect(transferAtString(DateTime(2026, 10, 11, 9, 5), wita), '2026-10-11T09:05+08:00');
      expect(transferAtString(DateTime(2026, 1, 2, 23, 59), const Duration(hours: 7)), '2026-01-02T23:59+07:00');
      expect(
        [formatSlaHours(null), formatSlaHours(0.5), formatSlaHours(5.2), formatSlaHours(30.5), formatSlaHours(48)],
        ['—', '< 1 jam', '5 jam', '1 hr 6 jam', '2 hr'],
      );
    });

    test('queue item JSON: flags, SLA, Pusat Biaya (ADR 0031); older server without the extras', () {
      final i = queueFixture().first;
      expect((i.receiptMismatch, i.warningFlags, i.sla.over, i.pusatBiaya?.id, i.amount), (2, 1, true, 3, 1447500));
      expect((i.pusatBiaya?.label, i.pusatBiayaMissing), ('Bank Mandiri Operasional', false));
      final missing = transferQueueItemFromJson(queueJson(45, pusatBiaya: null, pusatBiayaMissing: true));
      expect((missing.pusatBiaya, missing.pusatBiayaMissing), (null, true));
      final old = transferQueueItemFromJson(
        {...queueJson(5)}..removeWhere((k, _) => ['flags', 'sla', 'pusatBiaya', 'pusatBiayaMissing'].contains(k)),
      );
      expect((old.receiptMismatch, old.warningFlags, old.sla.ageHours), (0, 1, null));
      expect((old.pusatBiaya, old.pusatBiayaMissing), (null, false));
    });
  });
}
