import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/expense/presentation/widgets/receipt_thumb.dart';
import 'package:proyekkas/features/finance/application/finance_providers.dart';
import 'package:proyekkas/features/loans/domain/intercompany_loan.dart';
import 'package:proyekkas/features/loans/presentation/intercompany_loan_providers.dart';
import 'package:proyekkas/features/loans/presentation/intercompany_loan_screens.dart';

import '../support/d1010_c_fixtures.dart';
import '../support/d1310_c_fixtures.dart';
import '../support/widget_harness.dart';

/// ADR 0029 API gaps closed on 2026-10-15, on the APK: the loan detail and the disbursement form show the borrower's
/// receiving account from the detail's own `destination` (a form opened from a notification no longer waits for the
/// queue; the queue is read only for an older server's detail), and the fund panel shows the server's loan
/// `statusLabel`. Fictional PTs and numbers.

const _mandiri = 'Mandiri · ••••0123 · PT Contoh Dirgantara';
const _none = 'PT peminjam belum menetapkan rekening penerimaan antar-PT — pencairan akan ditolak.';

AuthSignedIn _finance() {
  final p = profile(const {Role.finance});
  return AuthSignedIn(
    profile: p.copyWith(capabilities: p.capabilities.copyWith(disburseIntercompanyLoan: true)),
    sub: 's',
  );
}

AuthSignedIn _owner() => AuthSignedIn(profile: profile(Role.effective({Role.principal})), sub: 's');

String? _text(WidgetTester tester, String key) => tester.widget<Text>(find.byKey(Key(key))).data;

Override _detail(Map<String, dynamic> j) => icLoanDetailProvider(77).overrideWith((ref) async => IcLoan.fromJson(j));

/// The disbursement queue, counting its reads (the detail must not need it).
class _Queue {
  var reads = 0;

  Future<IcLoanQueue> load() async {
    reads++;
    return IcLoanQueue.fromJson(icLoanQueueJson());
  }

  Override get asOverride => icLoanQueueProvider.overrideWith((ref) => load());
}

void main() {
  group('loan detail', () {
    testWidgets('Finance of the lender: the receiving account from the detail, no queue read', (tester) async {
      final queue = _Queue();
      final overrides = <Override>[_detail(icLoanDetailJson(destination: icDestinationJson)), queue.asOverride];
      await pumpScreen(tester, const IcLoanDetailScreen(id: 77), auth: _finance(), overrides: overrides);
      expect(_text(tester, 'icloan-destination-value'), _mandiri);
      expect(find.byKey(const Key('icloan-destination-none')), findsNothing);
      expect(queue.reads, 0);
    });

    testWidgets('none designated (null for a reader): the warning', (tester) async {
      final overrides = <Override>[_detail(icLoanDetailJson(destination: null))];
      await pumpScreen(tester, const IcLoanDetailScreen(id: 77), auth: _finance(), overrides: overrides);
      expect(find.byKey(const Key('icloan-destination-value')), findsNothing);
      expect(find.byKey(const Key('icloan-destination-none')), findsOneWidget);
      expect(find.text(_none), findsOneWidget);
    });

    testWidgets('not a reader (the Owner without Finance in the lender): nothing, no warning', (tester) async {
      final queue = _Queue();
      final json = icLoanDetailJson(allowed: const ['cancel'], destination: null);
      final overrides = <Override>[_detail(json), queue.asOverride];
      await pumpScreen(tester, const IcLoanDetailScreen(id: 77), auth: _owner(), overrides: overrides);
      expect(find.byKey(const Key('icloan-destination-value')), findsNothing);
      expect(find.byKey(const Key('icloan-destination-none')), findsNothing);
      expect(queue.reads, 0);
    });

    testWidgets('an older server (no field): the queue item as the fallback', (tester) async {
      final queue = _Queue();
      final overrides = <Override>[_detail(icLoanDetailJson()), queue.asOverride];
      await pumpScreen(tester, const IcLoanDetailScreen(id: 77), auth: _finance(), overrides: overrides);
      expect(_text(tester, 'icloan-destination-value'), _mandiri);
      expect(queue.reads, 1);
    });
  });

  group('disbursement form opened from a notification', () {
    Override finance() => financeApiProvider.overrideWithValue(FakeFinanceApi());

    testWidgets('the destination comes with the detail — shown at once, the queue is not read', (tester) async {
      final queue = _Queue();
      final json = icLoanDetailJson(destination: icDestinationJson);
      final overrides = <Override>[_detail(json), queue.asOverride, finance()];
      await pumpScreen(tester, const IcLoanDisburseRoute(id: 77), auth: _finance(), overrides: overrides);
      expect(find.byType(IcLoanDisburseScreen), findsOneWidget);
      expect(_text(tester, 'icloan-destination'), 'Rekening tujuan: $_mandiri');
      expect(queue.reads, 0);
    });

    testWidgets('null on the detail: "none designated" without waiting for the queue', (tester) async {
      final queue = _Queue();
      final overrides = <Override>[_detail(icLoanDetailJson(destination: null)), queue.asOverride, finance()];
      await pumpScreen(tester, const IcLoanDisburseRoute(id: 77), auth: _finance(), overrides: overrides);
      expect(find.byKey(const Key('icloan-destination')), findsNothing);
      expect(find.byKey(const Key('icloan-destination-none')), findsOneWidget);
      expect(queue.reads, 0);
    });

    testWidgets('an older server (no field): the queue item once the queue has loaded', (tester) async {
      final queue = _Queue();
      final overrides = <Override>[_detail(icLoanDetailJson()), queue.asOverride, finance()];
      await pumpScreen(tester, const IcLoanDisburseRoute(id: 77), auth: _finance(), overrides: overrides);
      expect(_text(tester, 'icloan-destination'), 'Rekening tujuan: $_mandiri');
      expect(queue.reads, 1);
    });
  });

  testWidgets('fund panel: the linked loan shows the server\'s statusLabel', (tester) async {
    final fund = fundCheckJson();
    final loan = Map<String, dynamic>.of((fund['loans'] as List).single as Map<String, dynamic>);
    loan['status'] = 'on_hold';
    loan['statusLabel'] = 'Ditahan';
    fund['loans'] = [loan];
    final detail = detailFromJson(fundDetailJson(fundCheck: fund));
    final thumb = receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException()));
    final overrides = <Override>[requestDetailProvider(42).overrideWith((ref) async => detail), thumb];
    await pumpScreen(tester, const RequestDetailScreen(id: 42), auth: _owner(), overrides: overrides);
    expect(_text(tester, 'fund-loan-77'), 'PJA/LAS/2610/0002 · LAS · Rp 500.000 · Ditahan');
  });
}
