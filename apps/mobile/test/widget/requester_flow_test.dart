import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/app/providers.dart';
import 'package:proyekkas/core/network/api_client.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_api.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/presentation/receipt_capture.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/expense/presentation/requester_actions.dart';
import 'package:proyekkas/features/expense/presentation/widgets/receipt_thumb.dart';

import '../support/fake_dio_adapter.dart';
import '../support/fixtures.dart';
import '../support/harness.dart';
import '../support/widget_harness.dart';

/// F4 gate "transfer (web) → receipts → LPJ" on the phone: the requester sees Finance's transfer,
/// adds/removes receipts online, marks receipts complete and (re)submits the LPJ.
Map<String, dynamic> advanceJson({
  String status = 'transferred',
  List<String> allowed = const ['add_receipt', 'receipts_complete'],
  Map<String, dynamic>? settlement,
  List<Map<String, dynamic>>? transfers,
}) => {
  ...detailJson(status: status, allowed: allowed, currentLevel: null),
  'type': 'advance',
  'typeLabel': 'Uang Muka',
  'statusLabel': 'Ditransfer',
  'approvedAmount': 1447500,
  'transferredTotal': 1447500,
  'transfers':
      transfers ??
      [
        {
          'id': 77,
          'docNo': 'TRF/2026/IX/0007',
          'kind': 'advance',
          'amount': 1447500,
          'transferDate': '2026-09-22',
          'bankRef': 'MDR-889900',
          'status': 'posted',
          'cashEntryId': 5,
          'proofId': 9,
          'voidReason': null,
        },
      ],
  'settlement': settlement,
};

class FakeExpenseApi {
  FakeExpenseApi() {
    adapter = FakeDioAdapter((c) => (200, advanceJson()));
    final dio = Dio(BaseOptions(baseUrl: 'https://example.test/api/v1'))..httpClientAdapter = adapter;
    api = ExpenseApi(
      ApiClient(baseUrl: 'https://example.test/api/v1', tokens: StaticTokens(), headers: testDevice(), dio: dio),
    );
  }
  late final FakeDioAdapter adapter;
  late final ExpenseApi api;
}

Future<void> pumpDetail(WidgetTester tester, Map<String, dynamic> json, FakeExpenseApi api, {bool online = true}) =>
    pumpScreen(
      tester,
      const RequestDetailScreen(id: 42),
      online: online,
      overrides: [
        requestDetailProvider(42).overrideWith((ref) async => detailFromJson(json)),
        receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
        expenseApiProvider.overrideWithValue(api.api),
      ],
    );

Future<void> scrollTo(WidgetTester tester, Finder f) async {
  await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('requester sees the transfer (web) with amount, date, bank ref and total', (tester) async {
    await pumpDetail(tester, advanceJson(), FakeExpenseApi());
    await scrollTo(tester, find.byKey(const Key('transfer-section')));
    expect(find.text('Uang muka · Rp 1.447.500'), findsOneWidget);
    expect(find.textContaining('TRF/2026/IX/0007 · 22 Sep 2026'), findsOneWidget);
    expect(find.textContaining('Ref. bank: MDR-889900'), findsOneWidget);
    expect(find.text('Tercatat'), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const Key('transfer-total'))).data, 'Total ditransfer: Rp 1.447.500');
  });

  testWidgets('voided transfer shows its reason', (tester) async {
    await pumpDetail(
      tester,
      advanceJson(
        status: 'approved',
        allowed: const [],
        transfers: [
          {
            'id': 78,
            'docNo': 'TRF/2026/IX/0008',
            'kind': 'advance',
            'amount': 1447500,
            'transferDate': '2026-09-22',
            'bankRef': 'X',
            'status': 'void',
            'voidReason': 'Rekening salah',
          },
        ],
      ),
      FakeExpenseApi(),
    );
    await scrollTo(tester, find.byKey(const Key('transfer-section')));
    expect(find.text('Dibatalkan'), findsOneWidget);
    expect(find.textContaining('Alasan batal: Rekening salah'), findsOneWidget);
    expect(find.byKey(const Key('receipt-add-camera')), findsNothing);
  });

  testWidgets('approved advance without a transfer yet says so', (tester) async {
    await pumpDetail(tester, advanceJson(status: 'approved', allowed: const [], transfers: const []), FakeExpenseApi());
    await scrollTo(tester, find.byKey(const Key('transfer-section')));
    expect(find.text('Belum ada transfer.'), findsOneWidget);
  });

  testWidgets('"Nota sudah lengkap" → confirm → POST receipts-complete with an Idempotency-Key', (tester) async {
    final api = FakeExpenseApi();
    await pumpDetail(tester, advanceJson(), api);
    await scrollTo(tester, find.byKey(const Key('action-receipts-complete')));
    expect(find.byKey(const Key('receipt-add-camera')), findsOneWidget);
    expect(find.byKey(const Key('receipt-add-gallery')), findsOneWidget);
    await tester.tap(find.text('Nota sudah lengkap'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('confirm-action')));
    await tester.pumpAndSettle();
    final call = api.adapter.calls.single;
    expect(call.method, 'POST');
    expect(call.uri.path, '/api/v1/expense-requests/42/receipts-complete');
    expect(call.headers['Idempotency-Key'], matches(RegExp(r'^[0-9a-f-]{36}$')));
    expect(find.text('Tersimpan.'), findsOneWidget);
  });

  testWidgets('first LPJ submit requires usage notes; the notes are sent', (tester) async {
    final api = FakeExpenseApi();
    await pumpDetail(tester, advanceJson(status: 'receipts_complete', allowed: const ['lpj_submit']), api);
    await scrollTo(tester, find.byKey(const Key('action-lpj-submit')));
    await tester.tap(find.text('Kirim LPJ'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('prompt-ok')));
    await tester.pumpAndSettle();
    expect(find.text('Wajib diisi (minimal 3 karakter).'), findsOneWidget);
    expect(api.adapter.calls, isEmpty);
    await tester.enterText(find.byKey(const Key('lpj-usage-notes')), 'BBM dan penginapan tim survei');
    await tester.tap(find.byKey(const Key('prompt-ok')));
    await tester.pumpAndSettle();
    expect(api.adapter.calls.single.uri.path, '/api/v1/expense-requests/42/lpj/submit');
    expect(api.adapter.calls.single.headers['Idempotency-Key'], isNotNull);
  });

  testWidgets('LPJ revision: Finance note shown, "Kirim ulang LPJ" prefilled, receipts removable', (tester) async {
    final api = FakeExpenseApi();
    final json = advanceJson(
      status: 'lpj_revision',
      allowed: const ['add_receipt', 'lpj_submit'],
      settlement: {
        'id': 3,
        'docNo': 'LPJ/2026/IX/0003',
        'status': 'revision',
        'statusLabel': 'Revisi',
        'usageNotes': 'BBM dan penginapan',
        'transferredTotal': 1447500,
        'receiptsTotal': 1447376,
        'verifiedReceiptsTotal': 600000,
        'difference': 847500,
        'settlementType': 'refund',
        'financeNotes': 'Nota hotel buram, foto ulang.',
        'submitCount': 1,
      },
    );
    await pumpDetail(tester, json, api);
    await scrollTo(tester, find.byKey(const Key('lpj-section')));
    expect(find.textContaining('LPJ/2026/IX/0003 · Revisi'), findsOneWidget);
    expect(find.text('Nota hotel buram, foto ulang.'), findsOneWidget);
    expect(find.text('Sisa dana dikembalikan ke kas'), findsOneWidget);
    await scrollTo(tester, find.byKey(const Key('action-lpj-submit')));
    expect(find.text('Kirim ulang LPJ'), findsOneWidget);

    await scrollTo(tester, find.byKey(const Key('receipt-remove-501')));
    await tester.tap(find.byKey(const Key('receipt-remove-501')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('receipt-remove-reason')), 'Foto buram');
    await tester.tap(find.byKey(const Key('prompt-ok')));
    await tester.pumpAndSettle();
    final call = api.adapter.calls.single;
    expect(call.uri.path, '/api/v1/expense-requests/42/receipts/501/remove');
    expect(find.text('Nota dihapus.'), findsOneWidget);
  });

  testWidgets('offline: receipt/LPJ actions disabled, no delete buttons', (tester) async {
    await pumpDetail(tester, advanceJson(), FakeExpenseApi(), online: false);
    await scrollTo(tester, find.byKey(const Key('action-receipts-complete')));
    final btn = find.descendant(
      of: find.byKey(const Key('action-receipts-complete')),
      matching: find.bySubtype<FilledButton>(),
    );
    expect(tester.widget<FilledButton>(btn).onPressed, isNull);
    expect(find.byKey(const Key('receipt-remove-501')), findsNothing);
  });

  testWidgets('approver view (pending approval): no requester actions', (tester) async {
    await pumpDetail(tester, detailJson(), FakeExpenseApi());
    expect(find.byKey(const Key('receipt-add-camera')), findsNothing);
    expect(find.byKey(const Key('transfer-section')), findsNothing);
  });

  test('uploadServerReceipt: media first, then the receipt row with that imageId', () async {
    final api = FakeExpenseApi();
    api.adapter.respond = (c) => c.uri.path.endsWith('/media/receipts') ? (201, {'id': 905}) : (201, advanceJson());
    final bytes = Uint8List.fromList(List.filled(64, 7));
    final d = await uploadServerReceipt(
      api.api,
      requestId: 42,
      lineId: 'l2',
      jpeg: bytes,
      fields: const ReceiptFields(
        vendorName: 'POP! Hotel',
        receiptNo: '9876',
        receiptDate: '2026-09-20',
        amount: 676876,
      ),
      idempotencyKey: 'k-1',
    );
    expect(d.id, 42);
    expect(api.adapter.calls.map((c) => c.uri.path), [
      '/api/v1/media/receipts',
      '/api/v1/expense-requests/42/receipts',
    ]);
    expect(api.adapter.calls.last.headers['Idempotency-Key'], 'k-1');
  });

  test('mapper: transfers + settlement', () {
    final d = detailFromJson(advanceJson(settlement: {'id': 3, 'status': 'submitted', 'statusLabel': 'Diajukan'}));
    expect(d.transfers.single.kindLabel, 'Uang muka');
    expect(d.transfers.single.isVoid, isFalse);
    expect(d.transferredTotal, 1447500);
    expect(d.settlement?.statusLabel, 'Diajukan');
    expect(d.settlement?.submitCount, 0);
    expect(settlementFromJson(null), isNull);
    expect(jsonEncode(detailFromJson(detailJson()).transfers), '[]');
  });
}
