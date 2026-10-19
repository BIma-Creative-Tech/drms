import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_client.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/cash/application/cash_providers.dart';
import 'package:proyekkas/features/cash/data/cash_api.dart';
import 'package:proyekkas/features/cash/domain/cash_book.dart';
import 'package:proyekkas/features/cash/presentation/cash_book_screen.dart';
import 'package:proyekkas/features/cash/presentation/period_closing_screen.dart';
import 'package:proyekkas/features/cash/presentation/voidable_transfers_view.dart';
import 'package:proyekkas/features/home/domain/web_route_map.dart';
import 'package:proyekkas/features/loans/domain/loan.dart';
import 'package:proyekkas/features/loans/presentation/loan_providers.dart';
import 'package:proyekkas/features/loans/presentation/loan_screens.dart';
import 'package:proyekkas/features/records/data/records_providers.dart';
import 'package:proyekkas/features/records/domain/record_list.dart';
import 'package:proyekkas/features/records/presentation/record_list_screens.dart';

import '../support/d1010_d_loans_fixtures.dart';
import '../support/widget_harness.dart';

Map<String, dynamic> _bookJson({bool write = true}) => {
  'today': '2026-10-19',
  'canWrite': write,
  'pts': [
    {
      'companyId': 1,
      'lockDate': '2026-08-31',
      'today': '2026-10-19',
      'minDate': '2026-09-01',
      'write': write,
      'reopen': !write,
      'intercompanyReceiving': 'BCA Operasional',
    },
  ],
  'lookups': {
    'accounts': [
      {'id': 3, 'label': 'Kas Kecil', 'active': true, 'companyId': 1, 'openingDate': '2026-01-01'},
    ],
    'projects': [
      {'id': 7, 'label': 'PRJ-07 Gedung A', 'active': true, 'companyId': 1},
    ],
    'costCenters': [],
    'categories': [
      {'id': 9, 'label': 'BBM', 'active': true, 'companyId': 1, 'requiresVehicle': true},
    ],
    'sources': [],
    'vehicles': [],
    'sites': [],
  },
  'total': 1250000,
  'byPt': [
    {'companyId': 1, 'total': 1250000},
  ],
  'flowPeriod': '2026-10',
  'accounts': [
    {
      'cashAccountId': 3,
      'companyId': 1,
      'name': 'Kas Kecil',
      'balance': 1250000,
      'flowIn': 0,
      'flowOut': 50000,
      'n': 1,
    },
  ],
  'page': {
    'rows': [
      {
        'id': 41,
        'companyId': 1,
        'entryNo': 'KK/CS1/2026/10/0001',
        'entryDate': '2026-10-02',
        'direction': 'out',
        'amount': 50000,
        'status': 'posted',
        'sourceType': 'manual',
        'description': 'BBM genset',
        'cashAccountId': 3,
        'projectId': 7,
        'categoryId': 9,
        'reversalOf': null,
        'reversedBy': null,
        'request': null,
        'intercompany': null,
        'canEdit': write,
        'canVoid': write,
        'voidHint': null,
      },
      {
        'id': 40,
        'companyId': 1,
        'entryNo': 'KK/CS1/2026/10/0000',
        'entryDate': '2026-10-01',
        'direction': 'out',
        'amount': 900000,
        'status': 'posted',
        'sourceType': 'transfer',
        'cashAccountId': 3,
        'request': {'id': 88, 'docNo': 'PB/CS1/2026/10/0003'},
        'canEdit': false,
        'canVoid': false,
        'voidHint': write ? 'Batalkan lewat transfer pengajuan' : null,
      },
    ],
    'totalDocs': 2,
    'page': 1,
    'totalPages': 1,
  },
};

class _FakeCashApi implements CashApi {
  final calls = <String>[];

  @override
  ApiClient get client => throw UnimplementedError();

  @override
  Future<CashBook> book(CashFilter filter, {int page = 1}) async => CashBook.fromJson(_bookJson());

  @override
  Future<String> create(Map<String, dynamic> body, {required String idempotencyKey}) async {
    calls.add('create:${body['direction']}:${body['amount']}');
    return 'KM/CS1/2026/10/0009';
  }

  @override
  Future<void> update(int id, Map<String, dynamic> body, {required String idempotencyKey}) async =>
      calls.add('update:$id:${body['reason']}');

  @override
  Future<String?> voidEntry(int id, String reason, {required String idempotencyKey}) async {
    calls.add('void:$id:$reason');
    return 'KM/CS1/2026/10/0002';
  }

  @override
  Future<int> uploadAttachment(Uint8List bytes, {required String filename}) async => 5;

  @override
  Future<Uint8List> attachment(int id) async => Uint8List(0);

  @override
  Future<PeriodOverview> periods(int? company) async => PeriodOverview.fromJson(_periodsJson);

  @override
  Future<void> close(String period, int company, {String? note, required String idempotencyKey}) async =>
      calls.add('close:$period:$company:${note ?? ''}');

  @override
  Future<void> reopen(String period, int company, String reason, {required String idempotencyKey}) async =>
      calls.add('reopen:$period:$company:$reason');

  @override
  Future<VoidablePage> voidableTransfers({String q = '', int page = 1, int per = 20}) async =>
      VoidablePage.fromJson(_voidableJson);

  @override
  Future<void> voidTransfer(int requestId, int transferId, String reason, {required String idempotencyKey}) async =>
      calls.add('void-transfer:$requestId:$transferId:$reason');
}

const _periodsJson = {
  'company': 1,
  'pts': [
    {'companyId': 1, 'lockDate': '2026-08-31'},
  ],
  'today': '2026-10-19',
  'lockDate': '2026-08-31',
  'booksStart': '2026-01-01',
  'latestClosed': '2026-08',
  'canReopen': true,
  'closable': ['2026-09'],
  'rows': [
    {'period': '2026-10', 'state': 'current', 'n': 2, 'tin': 0, 'tout': 950000},
    {'period': '2026-09', 'state': 'open', 'n': 4, 'tin': 2000000, 'tout': 500000, 'canClose': true},
    {
      'period': '2026-08',
      'state': 'closed',
      'explicit': true,
      'n': 3,
      'voids': 1,
      'nKoreksi': 2,
      'koreksi': 0,
      'canReopen': true,
    },
  ],
  'history': [
    {'id': 2, 'period': '2026-08', 'status': 'closed', 'closedBy': 'Fina', 'closedAt': '01/09/2026 08:00 WITA'},
  ],
};

const _voidableJson = {
  'items': [
    {
      'transferId': 15,
      'companyId': 1,
      'transferNo': 'TRF/CS1/2026/10/0004',
      'transferDate': '2026-10-03',
      'amount': 900000,
      'requestId': 88,
      'requestNo': 'PB/CS1/2026/10/0003',
      'requestTitle': 'Material besi',
      'requestType': 'advance',
      'canVoid': true,
    },
  ],
  'total': 1,
  'page': 1,
  'totalPages': 1,
};

/// User 2026-10-19 (APK ↔ web parity, phase 3 Keuangan): Buku kas, Tutup buku, Transfer tercatat, pinjaman, "Data …".
void main() {
  group('domain', () {
    test('book JSON, rules, labels', () {
      final b = CashBook.fromJson(_bookJson());
      expect(b.rows, hasLength(2));
      expect(b.rows.first.canVoid, isTrue);
      expect(b.writePts.single.companyId, 1);
      expect(CashLookups.labelOf(b.lookups.projects, 7), 'PRJ-07 Gedung A');
      expect(periodLabel('2026-09'), 'September 2026');
      expect(dayMonth('2026-09-30'), '30 Sep 2026');
      expect(periodEnd('2026-02'), '2026-02-28');
      final errs = validateCashEntry(
        edit: false,
        inbound: false,
        cashAccountId: 3,
        amount: 0,
        description: ' ',
        entryDate: '2026-08-15',
        today: '2026-10-19',
        lockDate: '2026-08-31',
        openingDate: null,
        categoryId: null,
        cashInSourceId: null,
        scope: CashScope.project,
        projectId: null,
        costCenterId: null,
      );
      expect(errs['entryDate'], 'Periode sudah ditutup (tutup buku s/d 2026-08-31).');
      expect(errs['categoryId'], 'Kategori wajib untuk kas keluar.');
      expect(errs['projectId'], 'Pilih project.');
      expect(errs['description'], 'Keterangan wajib diisi.');
      expect(errs['amount'], isNotNull);
      expect(validateRepayment(amount: 600, outstanding: 500, repayDate: '2026-10-01')['amount'], isNotNull);
    });

    test('Keuangan menu items open native screens', () {
      expect(apkTargetFor('/kas')!.route, '/cash');
      expect(apkTargetFor('/tutup-buku')!.route, '/closings');
      expect(apkTargetFor('/pinjaman')!.route, '/loans');
      expect(apkTargetFor('/pinjaman-antar-pt')!.route, '/intercompany-loans');
      expect(apkTargetFor('/collections/transfers')!.route, '/data/transfers');
      expect(apkTargetFor('/collections/receipts')!.route, '/data/receipts');
      expect(apkTargetFor('/collections/settlements')!.route, '/data/settlements');
    });

    test('loan list summary', () {
      final p = LoanPage.fromJson({
        'items': [],
        'summary': {
          'totals': {'pending': 2, 'amount': 10, 'repaid': 4, 'outstanding': 6, 'overdueCount': 1, 'overdue': 3},
          'inboxCount': 1,
          'canCreate': true,
        },
      });
      expect(p.summary!.pending, 2);
      expect(p.summary!.canCreate, isTrue);
      expect(LoanPage.fromJson({'items': []}).summary, isNull);
    });
  });

  group('Buku kas', () {
    Future<_FakeCashApi> pump(WidgetTester tester, {bool write = true}) async {
      final api = _FakeCashApi();
      await pumpScreen(
        tester,
        const CashBookScreen(),
        auth: AuthSignedIn(profile: profile({write ? Role.finance : Role.owner}), sub: 'user-sub-1'),
        overrides: [
          cashApiProvider.overrideWithValue(api),
          cashBookProvider.overrideWith((ref, filter) async => CashBook.fromJson(_bookJson(write: write))),
        ],
      );
      return api;
    }

    testWidgets('Finance: balance, rows, Kas masuk / keluar; Void asks a reason', (tester) async {
      final api = await pump(tester);
      expect(find.byKey(const Key('cash-total-value')), findsOneWidget);
      expect(find.text('Rp 1.250.000'), findsWidgets);
      expect(find.byKey(const Key('cash-new-in')), findsOneWidget);
      expect(find.byKey(const Key('cash-new-out')), findsOneWidget);
      expect(find.byKey(const Key('cash-read-only')), findsNothing);
      expect(find.text('Pengajuan PB/CS1/2026/10/0003'), findsOneWidget);

      await tester.tap(find.byKey(const Key('cash-row-41')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('cash-edit')), findsOneWidget);
      await tester.tap(find.byKey(const Key('cash-void')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('cash-void-ok')));
      await tester.pumpAndSettle();
      expect(api.calls, isEmpty, reason: 'reason required');
      await tester.enterText(find.byKey(const Key('cash-void-field')), 'salah catat');
      await tester.tap(find.byKey(const Key('cash-void-ok')));
      await tester.pumpAndSettle();
      expect(api.calls, ['void:41:salah catat']);
    });

    testWidgets('transfer row: no Void, the hint instead', (tester) async {
      await pump(tester);
      await tester.tap(find.byKey(const Key('cash-row-40')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('cash-void')), findsNothing);
      expect(find.text('Batalkan lewat transfer pengajuan'), findsOneWidget);
    });

    testWidgets('Direktur reads only', (tester) async {
      await pump(tester, write: false);
      expect(find.byKey(const Key('cash-read-only')), findsOneWidget);
      expect(find.byKey(const Key('cash-new-in')), findsNothing);
      await tester.tap(find.byKey(const Key('cash-row-41')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('cash-void')), findsNothing);
      expect(find.byKey(const Key('cash-edit')), findsNothing);
    });
  });

  group('Tutup buku', () {
    testWidgets('close a ready month (optional note), reopen the latest closed one', (tester) async {
      final api = _FakeCashApi();
      await pumpScreen(
        tester,
        const PeriodClosingScreen(),
        auth: AuthSignedIn(profile: profile({Role.owner}), sub: 'user-sub-1'),
        overrides: [cashApiProvider.overrideWithValue(api)],
      );
      expect(find.byKey(const Key('closing-state-2026-08')), findsOneWidget);
      expect(find.byKey(const Key('closing-close-2026-10')), findsNothing, reason: 'the current month cannot close');
      await tester.tap(find.byKey(const Key('closing-close-2026-09')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('close-2026-09-ok')));
      await tester.pumpAndSettle();
      expect(api.calls, ['close:2026-09:1:']);

      await tester.tap(find.byKey(const Key('closing-reopen-2026-08')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('reopen-2026-08-field')), 'koreksi nota');
      await tester.tap(find.byKey(const Key('reopen-2026-08-ok')));
      await tester.pumpAndSettle();
      expect(api.calls.last, 'reopen:2026-08:1:koreksi nota');
    });
  });

  testWidgets('Transfer tercatat: Void transfer with a reason', (tester) async {
    final api = _FakeCashApi();
    await pumpScreen(
      tester,
      const Scaffold(body: VoidableTransfersView()),
      auth: AuthSignedIn(profile: profile({Role.finance}), sub: 'user-sub-1'),
      overrides: [cashApiProvider.overrideWithValue(api)],
    );
    expect(find.text('TRF/CS1/2026/10/0004'), findsOneWidget);
    await tester.tap(find.byKey(const Key('void-transfer-15-action')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('void-transfer-15-field')), 'rekening salah');
    await tester.tap(find.byKey(const Key('void-transfer-15-ok')));
    await tester.pumpAndSettle();
    expect(api.calls, ['void-transfer:88:15:rekening salah']);
  });

  testWidgets('Data list: the web columns as label lines', (tester) async {
    await pumpScreen(
      tester,
      const RecordListScreen(collection: 'transfers'),
      overrides: [
        recordPageProvider.overrideWith(
          (ref, q) async => RecordPage.fromJson({
            'collection': 'transfers',
            'label': 'Transfer',
            'columns': [
              {'key': 'docNo', 'label': 'No. transfer'},
              {'key': 'amount', 'label': 'Nominal'},
            ],
            'items': [
              {
                'id': 15,
                'title': 'TRF/CS1/2026/10/0004',
                'cells': {'docNo': 'TRF/CS1/2026/10/0004', 'amount': 'Rp 900.000'},
              },
            ],
            'totalDocs': 1,
            'page': 1,
            'totalPages': 1,
          }),
        ),
      ],
    );
    expect(find.text('Transfer'), findsOneWidget);
    expect(find.text('TRF/CS1/2026/10/0004'), findsOneWidget);
    expect(find.textContaining('Rp 900.000'), findsOneWidget);
  });

  testWidgets('loan detail: "Catat pengembalian" (≤ sisa) and void of a repayment (reason)', (tester) async {
    final api = FakeLoansApi();
    await pumpScreen(
      tester,
      const LoanDetailScreen(id: 42),
      auth: AuthSignedIn(profile: profile({Role.finance}), sub: 'user-sub-1'),
      overrides: [
        loansApiProvider.overrideWithValue(api),
        loanDetailProvider.overrideWith(
          (ref, id) async => Loan.fromJson({
            ...loanApprovedJson(),
            'allowedActions': ['repay'],
            'mayVoidRepayment': true,
            'today': '2026-10-19',
          }),
        ),
      ],
    );
    await tester.tap(find.byKey(const Key('loan-action-repay')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('loan-repay-amount')), '999999999');
    await tester.tap(find.byKey(const Key('loan-repay-save')));
    await tester.pumpAndSettle();
    expect(find.text('Nominal melebihi sisa pinjaman.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('loan-repay-amount')), '25000000');
    await tester.tap(find.byKey(const Key('loan-repay-save')));
    await tester.pumpAndSettle();
    expect(api.calls, ['repay:42:25000000:2026-10-19:']);

    expect(find.byKey(const Key('loan-repayment-2-void')), findsNothing, reason: 'already void');
    await tester.tap(find.byKey(const Key('loan-repayment-1-void')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('loan-repayment-void-field')), 'salah nominal');
    await tester.tap(find.byKey(const Key('loan-repayment-void-ok')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'void-repayment:42:1:salah nominal');
  });
}
