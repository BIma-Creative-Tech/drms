import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/app/route_error_screen.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/approvals/application/inbox_providers.dart';
import 'package:proyekkas/features/approvals/data/approvals_api.dart';
import 'package:proyekkas/features/approvals/presentation/decision_sheet.dart';
import 'package:proyekkas/features/approvals/presentation/inbox_screen.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/dashboard/domain/dashboard.dart';
import 'package:proyekkas/features/dashboard/presentation/kpi_home.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_api.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/presentation/history_screen.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/expense/presentation/requests_screen.dart';
import 'package:proyekkas/features/expense/presentation/widgets/receipt_thumb.dart';
import 'package:proyekkas/features/home/presentation/home_screen.dart';
import 'package:proyekkas/l10n/gen/app_localizations.dart';

import '../support/fixtures.dart';
import '../support/harness.dart';
import '../support/widget_harness.dart';

class FakeExpenseApi extends ExpenseApi {
  FakeExpenseApi() : super(testClient('http://127.0.0.1:9', StaticTokens()));
  final calls = <String>[];

  @override
  Future<ExpensePage> list({String scope = 'mine', String? cursor, int limit = 30}) async {
    calls.add('list:$scope');
    return ExpensePage([summaryFromJson(detailJson())], null);
  }

  @override
  Future<ExpenseDetail> withdraw(int requestId, String reason, {required String idempotencyKey}) async {
    calls.add('withdraw:$requestId:$reason');
    return detailFromJson(detailJson(status: 'draft', allowed: const ['edit', 'submit', 'cancel']));
  }

  @override
  Future<ExpenseDetail> cancel(int requestId, String reason, {required String idempotencyKey}) async {
    calls.add('cancel:$requestId:$reason');
    return detailFromJson(detailJson(status: 'cancelled', allowed: const []));
  }

  @override
  Future<List<HistoryEntry>> history(int requestId) async => [
    for (final i in historyJson()['items'] as List) historyFromJson(i as Map<String, dynamic>),
  ];
}

class ForbiddenApprovalsApi extends ApprovalsApi {
  ForbiddenApprovalsApi() : super(testClient('http://127.0.0.1:9', StaticTokens()));
  var decisions = 0;

  @override
  Future<int> uploadSignature(Uint8List png) async => 1;

  @override
  Future<ExpenseDetail> decide(
    int requestId,
    Decision decision, {
    required String idempotencyKey,
    int? signatureMediaId,
    String? reason,
  }) async {
    decisions++;
    throw const ProblemException(status: 403, title: 'Forbidden');
  }
}

InboxPage inboxPage({Map<String, dynamic> extra = const {}}) => InboxPage([
  inboxItemFromJson({...(inboxJson()['items'] as List).first as Map<String, dynamic>, ...extra}),
], 85);

AuthSignedIn signedIn(Set<Role> roles) => AuthSignedIn(profile: profile(roles), sub: 's');

void main() {
  group('E1 AC-10: inbox by capability, PM monitors only', () {
    testWidgets('Direktur home: KPI summary with chart + inbox button', (tester) async {
      await pumpScreen(
        tester,
        const HomeScreen(),
        auth: signedIn({Role.owner}),
        overrides: [
          inboxProvider.overrideWith((ref) async => inboxPage()),
          direkturDashboardProvider.overrideWith((ref) async => DirekturDashboard.fromJson(direkturDashboardJson())),
        ],
      );
      expect(find.byKey(const Key('home-inbox')), findsOneWidget);
      expect(find.byKey(const Key('kpi-direktur')), findsOneWidget);
      expect(find.text('Rp 152,5 jt'), findsOneWidget);
      expect(find.text('2 menunggu saya · tertua 4 hari'), findsOneWidget);
      expect(find.text('Diketahui 2 · Approval 1'), findsOneWidget);
      expect(find.text('42,5%'), findsOneWidget);
      final readout = find.byKey(const Key('cashflow-readout'));
      expect(tester.widget<Text>(readout).data, 'September 2026: Masuk Rp 40.000.000 · Keluar Rp 12.500.000');
      // Tap the first month column → its values (the readout is the chart's table view).
      final chart = tester.getRect(find.byKey(const Key('cashflow-chart')));
      await tester.tapAt(Offset(chart.left + 10, chart.center.dy));
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(readout).data, 'Juli 2026: Masuk Rp 30.000.000 · Keluar Rp 20.000.000');
    });

    testWidgets('Finance home: inbox (Approval) + Finance KPIs', (tester) async {
      await pumpScreen(
        tester,
        const HomeScreen(),
        auth: signedIn({Role.finance}),
        overrides: [
          inboxProvider.overrideWith((ref) async => inboxPage()),
          financeDashboardProvider.overrideWith((ref) async => FinanceDashboard.fromJson(financeDashboardJson())),
        ],
      );
      expect(find.byKey(const Key('home-inbox')), findsOneWidget);
      expect(find.byKey(const Key('kpi-finance')), findsOneWidget);
      expect(find.text('3 LPJ · 2 nota reimburse'), findsOneWidget);
      expect(find.text('1 lewat tanggal dibutuhkan'), findsOneWidget);
      expect(find.byKey(const Key('home-new-advance')), findsNothing);
    });

    testWidgets('PM home: no inbox, team monitor instead', (tester) async {
      await pumpScreen(
        tester,
        const HomeScreen(),
        auth: signedIn({Role.pm}),
        overrides: [pmDashboardProvider.overrideWith((ref) async => PmDashboard.fromJson(pmDashboardJson()))],
      );
      expect(find.byKey(const Key('home-inbox')), findsNothing);
      expect(find.byKey(const Key('kpi-pm')), findsOneWidget);
      expect(find.text('Pantauan tim'), findsOneWidget);
      expect(find.text('2 menunggu persetujuan'), findsOneWidget);
      expect(find.byKey(const Key('home-new-reimburse')), findsOneWidget, reason: 'PM still creates own requests');
    });

    testWidgets('dashboard failure does not break the home', (tester) async {
      await pumpScreen(
        tester,
        const HomeScreen(),
        auth: signedIn({Role.owner}),
        overrides: [
          inboxProvider.overrideWith((ref) async => inboxPage()),
          direkturDashboardProvider.overrideWith((ref) async => throw const NetworkException()),
        ],
      );
      expect(find.text('Ringkasan belum bisa dimuat'), findsOneWidget);
      expect(find.byKey(const Key('home-inbox')), findsOneWidget);
    });

    testWidgets('PM "Pengajuan": team tab (scope=team) is read-only monitoring', (tester) async {
      final api = FakeExpenseApi();
      await pumpScreen(
        tester,
        const RequestsScreen(initialTab: 'team'),
        auth: signedIn({Role.pm}),
        overrides: [expenseApiProvider.overrideWithValue(api)],
      );
      expect(find.byKey(const Key('tab-team')), findsOneWidget);
      expect(find.byKey(const Key('team-readonly-hint')), findsOneWidget);
      expect(api.calls, contains('list:team'));
      expect(find.text('Service Tronton'), findsOneWidget);
    });

    testWidgets('Staff "Pengajuan": no team tab', (tester) async {
      await pumpScreen(
        tester,
        const RequestsScreen(),
        auth: signedIn({Role.staff}),
        overrides: [expenseApiProvider.overrideWithValue(FakeExpenseApi())],
      );
      expect(find.byKey(const Key('tab-team')), findsNothing);
      // Unmount so drift's stream-query timers of the "Draft di HP" tab finish before the DB closes.
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(milliseconds: 10));
    });

    testWidgets('inbox card uses the server stepLabel', (tester) async {
      await pumpScreen(
        tester,
        const InboxScreen(),
        auth: signedIn({Role.owner}),
        overrides: [
          inboxProvider.overrideWith(
            (ref) async => inboxPage(
              extra: {
                'step': 'acknowledge',
                'level': null,
                'stepLabel': 'Persetujuan Direktur (Diketahui)',
                'decisionFlow': true,
              },
            ),
          ),
        ],
      );
      expect(find.text('Persetujuan Direktur (Diketahui)'), findsOneWidget);
    });
  });

  group('E1 decisions', () {
    testWidgets('detail: "Setujui (Diketahui)" for the Direktur, timeline "Diketahui (Direktur)"', (tester) async {
      await pumpScreen(
        tester,
        const RequestDetailScreen(id: 42),
        auth: signedIn({Role.owner}),
        overrides: [
          requestDetailProvider(42).overrideWith((ref) async => detailFromJson(e1DetailJson())),
          receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
        ],
      );
      expect(find.text('Setujui (Diketahui)'), findsOneWidget);
      expect(find.text('Diketahui (Direktur)'), findsOneWidget);
      expect(find.text('Approval (Finance)'), findsWidgets);
      expect(tester.widget<Text>(find.byKey(const Key('turn-text'))).data, 'Direktur — persetujuan (Diketahui)');
      expect(find.byKey(const Key('open-history')), findsOneWidget);
    });

    testWidgets('decision sheet: Direktur wording; 403 is explained, nothing crashes', (tester) async {
      final api = ForbiddenApprovalsApi();
      await pumpScreen(
        tester,
        Scaffold(
          body: DecisionSheet(detail: detailFromJson(e1DetailJson()), decision: Decision.acknowledge),
        ),
        overrides: [approvalsApiProvider.overrideWithValue(api)],
      );
      expect(find.text('Setujui sebagai Direktur (Diketahui)'), findsWidgets);
      expect(find.byKey(const Key('decision-hint-direktur')), findsOneWidget);
      await tester.tap(
        find.descendant(of: find.byKey(const Key('decision-confirm')), matching: find.bySubtype<FilledButton>()),
      );
      await tester.pumpAndSettle();
      expect(api.decisions, 1);
      expect(find.textContaining('Hanya Direktur (Diketahui) dan Finance (Approval)'), findsOneWidget);
    });
  });

  group('E3-d requester parity', () {
    testWidgets('withdraw asks for a reason (≥ 3) and calls /withdraw', (tester) async {
      final api = FakeExpenseApi();
      await pumpScreen(
        tester,
        const RequestDetailScreen(id: 42),
        overrides: [
          expenseApiProvider.overrideWithValue(api),
          requestDetailProvider(42).overrideWith(
            (ref) async => detailFromJson(detailJson(status: 'pending_ack', allowed: const ['withdraw', 'cancel'])),
          ),
          receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
        ],
      );
      expect(find.byKey(const Key('action-cancel')), findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('action-withdraw')));
      await tester.tap(find.text('Tarik kembali ke Draft'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('withdraw-reason')), 'ok');
      await tester.tap(find.byKey(const Key('prompt-ok')));
      await tester.pumpAndSettle();
      expect(find.text('Wajib diisi (minimal 3 karakter).'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('withdraw-reason')), 'Salah project');
      await tester.tap(find.byKey(const Key('prompt-ok')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('withdraw:42:Salah project'));
      expect(find.text('Pengajuan ditarik kembali ke Draft; silakan ubah lalu kirim lagi.'), findsOneWidget);
    });

    testWidgets('server draft: "Ubah & ajukan di HP"; rejected: "Ajukan ulang"', (tester) async {
      await pumpScreen(
        tester,
        const RequestDetailScreen(id: 42),
        overrides: [
          requestDetailProvider(
            42,
          ).overrideWith((ref) async => detailFromJson(detailJson(status: 'draft', allowed: const ['edit', 'submit']))),
          receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
        ],
      );
      expect(find.byKey(const Key('action-edit-on-phone')), findsOneWidget);
      expect(find.byKey(const Key('action-resubmit')), findsNothing);
    });

    testWidgets('rejected request offers "Ajukan ulang"', (tester) async {
      await pumpScreen(
        tester,
        const RequestDetailScreen(id: 42),
        overrides: [
          requestDetailProvider(42)
              .overrideWith((ref) async => detailFromJson(detailJson(status: 'rejected', allowed: const ['resubmit']))),
          receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
        ],
      );
      expect(find.byKey(const Key('action-resubmit')), findsOneWidget);
    });

    testWidgets('Riwayat: field-level rows, newest first, same labels as the web', (tester) async {
      await pumpScreen(
        tester,
        const HistoryScreen(id: 42),
        overrides: [expenseApiProvider.overrideWithValue(FakeExpenseApi())],
      );
      expect(find.text('disetujui Direktur (Diketahui)'), findsOneWidget);
      expect(find.text('677000 → 676876'), findsOneWidget);
      expect(find.text('Salah ketik'), findsOneWidget);
      expect(find.text('amount (baris 2)'), findsOneWidget);
      final first = tester.getTopLeft(find.text('disetujui Direktur (Diketahui)')).dy;
      final last = tester.getTopLeft(find.text('status')).dy;
      expect(first, lessThan(last), reason: 'newest first');
    });
  });

  testWidgets('unknown deep link shows an Indonesian error, not a blank screen (WIP login-fix)', (tester) async {
    final router = GoRouter(
      initialLocation: '/app/callback?code=secret-code&state=s',
      errorBuilder: (_, _) => const RouteErrorScreen(),
      routes: [GoRoute(path: '/home', builder: (_, _) => const Text('home-page'))],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: router,
        locale: const Locale('id'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Halaman tidak bisa dibuka'), findsOneWidget);
    expect(find.textContaining('secret-code'), findsNothing);
    await tester.tap(find.byKey(const Key('route-error-home')));
    await tester.pumpAndSettle();
    expect(find.text('home-page'), findsOneWidget);
  });

  testWidgets('FatalBuildErrorView is readable without Localizations', (tester) async {
    await tester.pumpWidget(const FatalBuildErrorView());
    expect(find.textContaining('Terjadi kesalahan saat menampilkan layar ini'), findsOneWidget);
  });
}
