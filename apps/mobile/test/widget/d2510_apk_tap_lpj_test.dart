import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/network/api_client.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_api.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/expense/presentation/widgets/receipt_thumb.dart';
import 'package:proyekkas/features/reports/data/reports_api.dart';
import 'package:proyekkas/features/reports/data/reports_providers.dart';
import 'package:proyekkas/features/reports/domain/report.dart';
import 'package:proyekkas/features/reports/presentation/report_screens.dart';

import '../support/fake_dio_adapter.dart';
import '../support/fixtures.dart';
import '../support/harness.dart';
import '../support/widget_harness.dart';

/// D2510 (user 2026-10-25, APK 0.13.1): Finance LPJ actions on the request detail and tappable report rows.

/// A Pengajuan Baru whose LPJ waits for Finance (`lpj_submitted`), one pending receipt (501) and one open flag (1).
Map<String, dynamic> lpjJson({
  List<String> allowed = const ['receipt_verify', 'review_flag', 'lpj_request_revision', 'lpj_verify'],
  String receiptStatus = 'pending',
}) {
  final base = detailJson(status: 'lpj_submitted', allowed: allowed, currentLevel: null);
  return {
    ...base,
    'type': 'advance',
    'typeLabel': 'Pengajuan Baru',
    'statusLabel': 'LPJ diajukan',
    'approvedAmount': 1447500,
    'transferredTotal': 1447500,
    'receipts': [
      {...(base['receipts'] as List).first as Map<String, dynamic>, 'status': receiptStatus},
    ],
    'settlement': {
      'id': 3,
      'docNo': 'LPJ/2026/IX/0003',
      'status': 'submitted',
      'statusLabel': 'Diajukan',
      'usageNotes': 'BBM dan penginapan',
      'transferredTotal': 1447500,
      'receiptsTotal': 600000,
      'submitCount': 1,
    },
  };
}

class _Api {
  _Api() {
    adapter = FakeDioAdapter((c) {
      if (c.uri.path.endsWith('/lpj/verify')) {
        return (
          409,
          {'type': 'about:blank', 'title': 'Masih ada 1 nota yang belum diputuskan (valid/tolak).', 'status': 409},
        );
      }
      return (200, lpjJson());
    });
    final dio = Dio(BaseOptions(baseUrl: 'https://example.test/api/v1'))..httpClientAdapter = adapter;
    api = ExpenseApi(
      ApiClient(baseUrl: 'https://example.test/api/v1', tokens: StaticTokens(), headers: testDevice(), dio: dio),
    );
  }
  late final FakeDioAdapter adapter;
  late final ExpenseApi api;
}

Future<void> _pumpLpj(WidgetTester tester, Map<String, dynamic> json, _Api api) => pumpScreen(
  tester,
  const RequestDetailScreen(id: 42),
  auth: AuthSignedIn(profile: profile({Role.finance}), sub: 'user-sub-1'),
  overrides: [
    requestDetailProvider(42).overrideWith((ref) async => detailFromJson(json)),
    receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
    expenseApiProvider.overrideWithValue(api.api),
  ],
);

Map<String, dynamic> _body(FakeCall c) => jsonDecode(c.form.keys.single) as Map<String, dynamic>;

Map<String, dynamic> _auditPage() => {
  'code': 'audit-log',
  'title': 'Audit log',
  'description': 'Jejak perubahan',
  'scope': 'all',
  'count': 2,
  'nextCursor': null,
  'main': {
    'key': 'main',
    'title': 'Perubahan',
    'columns': [
      {'key': 'waktu', 'label': 'Waktu', 'type': 'text', 'primary': true},
      {'key': 'dokumen', 'label': 'Dokumen', 'type': 'text'},
    ],
    'rows': [
      {'waktu': '25/10/2026 09.00', 'dokumen': 'KK/CS1/2026/10/0005'},
      {'waktu': '25/10/2026 09.05', 'dokumen': 'Pengguna #2'},
    ],
    'totals': null,
    // Row 0: the row link has no APK screen (users) — the "dokumen" cell link (a cash entry) opens instead.
    'rowLinks': [
      {'_row': '/admin/collections/users/2', 'dokumen': '/admin/collections/cash-entries/5'},
      {'dokumen': '/admin/collections/users/2'},
    ],
    'empty': null,
  },
  'extra': [],
  'notes': [],
  'formats': ['csv'],
  'filters': [
    {'name': 'dari', 'label': 'Dari', 'kind': 'date', 'value': ''},
  ],
  'letterhead': {'kind': 'company', 'name': 'PT Contoh Satu', 'companies': []},
  'rowCount': 2,
  'limits': {'xlsx': 10000, 'pdf': 500},
};

class _FakeReports implements ReportsApi {
  final queries = <ReportQuery>[];

  @override
  ApiClient get client => throw UnimplementedError();

  @override
  Future<({List<ReportSummary> items, bool auditLog})> index() async => (items: <ReportSummary>[], auditLog: false);

  @override
  Future<ReportPage> page(ReportQuery q) async {
    queries.add(q);
    return ReportPage.fromJson(_auditPage());
  }

  @override
  Future<({Uint8List bytes, String? disposition})> export(ReportQuery q, String format) async =>
      (bytes: Uint8List(0), disposition: null);
}

Future<void> _pumpReport(WidgetTester tester, _FakeReports api, Set<Role> roles) async {
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (_, _) => const ReportScreen(code: 'audit-log'),
      ),
      GoRoute(
        path: '/data/:c/:id',
        builder: (_, s) => Text('record ${s.pathParameters['c']} ${s.pathParameters['id']}'),
      ),
    ],
  );
  addTearDown(router.dispose);
  await pumpScreen(
    tester,
    Router.withConfig(config: router),
    auth: AuthSignedIn(profile: profile(roles), sub: 'user-sub-1'),
    overrides: [reportsApiProvider.overrideWithValue(api)],
  );
}

void main() {
  group('Finance LPJ actions (request detail)', () {
    testWidgets('bar: "Verifikasi LPJ" asks first and shows the server refusal (409) in the result popup', (
      tester,
    ) async {
      final api = _Api();
      await _pumpLpj(tester, lpjJson(), api);
      expect(find.byKey(const Key('lpj-finance-bar')), findsOneWidget);
      expect(find.byKey(const Key('action-lpj-revision')), findsOneWidget);
      expect(find.text('1 nota belum diputuskan (valid / tolak).'), findsOneWidget);

      await tester.tap(find.byKey(const Key('action-lpj-verify')));
      await tester.pumpAndSettle();
      expect(find.text('Yakin ingin verifikasi LPJ?'), findsOneWidget);
      expect(api.adapter.calls, isEmpty, reason: 'nothing is sent before the confirmation');
      await tester.tap(find.byKey(const Key('confirm-action')));
      await tester.pumpAndSettle();
      final call = api.adapter.calls.single;
      expect('${call.method} ${call.uri.path}', 'POST /api/v1/expense-requests/42/lpj/verify');
      expect(call.headers['Idempotency-Key'], isNotNull);
      expect(find.byKey(const Key('result-failed')), findsOneWidget);
      expect(find.text('Masih ada 1 nota yang belum diputuskan (valid/tolak).'), findsOneWidget);
      await dismissResult(tester);
    });

    testWidgets('bar: "Minta revisi" needs a note (the dialog is the confirmation), then posts it', (tester) async {
      final api = _Api();
      await _pumpLpj(tester, lpjJson(), api);
      await tester.tap(find.byKey(const Key('action-lpj-revision')));
      await tester.pumpAndSettle();
      expect(find.text('Yakin ingin minta revisi?'), findsOneWidget);
      await tester.tap(find.byKey(const Key('prompt-ok')));
      await tester.pumpAndSettle();
      expect(find.text('Wajib diisi (minimal 3 karakter).'), findsOneWidget);
      expect(api.adapter.calls, isEmpty);
      await tester.enterText(find.byKey(const Key('lpj-revision-note')), 'Nota hotel buram');
      await tester.tap(find.byKey(const Key('prompt-ok')));
      await tester.pumpAndSettle();
      final call = api.adapter.calls.single;
      expect(call.uri.path, '/api/v1/expense-requests/42/lpj/request-revision');
      expect(_body(call), {'note': 'Nota hotel buram'});
      expect(find.text('Berhasil: minta revisi'), findsOneWidget);
      expect(find.text('LPJ dikembalikan ke pemohon untuk direvisi.'), findsOneWidget);
    });

    testWidgets('receipt Valid / Tolak and "Tandai flag diperiksa" post to their endpoints', (tester) async {
      final api = _Api();
      await _pumpLpj(tester, lpjJson(), api);
      await tester.ensureVisible(find.byKey(const Key('receipt-verify-501')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('receipt-verify-501')));
      await tester.pumpAndSettle();
      expect(find.text('Yakin ingin validasi nota?'), findsOneWidget);
      await tester.tap(find.byKey(const Key('confirm-action')));
      await tester.pumpAndSettle();
      expect(api.adapter.calls.last.uri.path, '/api/v1/expense-requests/42/receipts/501/verify');
      expect(find.text('Nota ditandai valid.'), findsOneWidget);
      await dismissResult(tester);

      await tester.ensureVisible(find.byKey(const Key('receipt-reject-501')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('receipt-reject-501')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('receipt-reject-reason')), 'Foto tidak terbaca');
      await tester.tap(find.byKey(const Key('prompt-ok')));
      await tester.pumpAndSettle();
      expect(api.adapter.calls.last.uri.path, '/api/v1/expense-requests/42/receipts/501/reject');
      expect(_body(api.adapter.calls.last), {'reason': 'Foto tidak terbaca'});
      await dismissResult(tester);

      await tester.ensureVisible(find.byKey(const Key('flag-review-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('flag-review-1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('prompt-ok')));
      await tester.pumpAndSettle();
      expect(api.adapter.calls.last.uri.path, '/api/v1/expense-requests/42/flags/1/review');
      expect(_body(api.adapter.calls.last), isEmpty, reason: 'the note is optional');
      expect(find.text('Flag ditandai sudah diperiksa.'), findsOneWidget);
      expect(api.adapter.calls.length, 3);
    });

    testWidgets('Valid hidden on a valid receipt; nothing for a user the server allows none of it', (tester) async {
      final api = _Api();
      await _pumpLpj(tester, lpjJson(receiptStatus: 'valid'), api);
      expect(find.byKey(const Key('receipt-verify-501')), findsNothing);
      expect(find.byKey(const Key('receipt-reject-501')), findsOneWidget);
      expect(find.byKey(const Key('lpj-pending-receipts')), findsNothing);
    });

    testWidgets('requester view: no LPJ bar, no receipt or flag actions', (tester) async {
      await _pumpLpj(tester, lpjJson(allowed: const []), _Api());
      expect(find.byKey(const Key('lpj-finance-bar')), findsNothing);
      expect(find.byKey(const Key('receipt-verify-501')), findsNothing);
      expect(find.byKey(const Key('receipt-reject-501')), findsNothing);
      expect(find.byKey(const Key('flag-review-1')), findsNothing);
    });
  });

  group('report rows', () {
    testWidgets('audit log: the "dokumen" link opens when the row link has no APK screen', (tester) async {
      await _pumpReport(tester, _FakeReports(), {Role.finance});
      final row0 = find.byKey(const Key('report-main-row-0'));
      expect(find.descendant(of: row0, matching: find.byIcon(Icons.chevron_right)), findsOneWidget);
      final row1 = find.byKey(const Key('report-main-row-1'));
      expect(find.descendant(of: row1, matching: find.byIcon(Icons.chevron_right)), findsNothing);
      await tester.tap(row0);
      await tester.pumpAndSettle();
      expect(find.text('record cash-entries 5'), findsOneWidget);
    });

    testWidgets('a target the user cannot read is not linked (Staff, cash entry)', (tester) async {
      await _pumpReport(tester, _FakeReports(), {Role.staff});
      final row0 = find.byKey(const Key('report-main-row-0'));
      expect(find.descendant(of: row0, matching: find.byIcon(Icons.chevron_right)), findsNothing);
      await tester.tap(row0);
      await tester.pumpAndSettle();
      expect(find.text('record cash-entries 5'), findsNothing);
    });

    testWidgets('report → report: the route filters are the first query', (tester) async {
      final api = _FakeReports();
      await pumpScreen(
        tester,
        const ReportScreen(
          code: 'audit-log',
          initialParams: {
            'dari': ['2026-10-01'],
          },
        ),
        overrides: [reportsApiProvider.overrideWithValue(api)],
      );
      expect(api.queries.first.params, {
        'dari': ['2026-10-01'],
      });
    });
  });
}
