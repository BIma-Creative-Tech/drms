import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/fund_check.dart';
import 'package:proyekkas/features/loans/domain/intercompany_loan.dart';

import '../support/d1310_c_fixtures.dart';

/// ADR 0029 API gaps closed on 2026-10-15: the loan detail carries `destination` (the queue item's shape, for the
/// same readers) and `fundCheck.loans[]` carries `statusLabel`. The APK prefers both from the server and falls back
/// (queue item / local label map) only when a server before that sends neither. Fictional PTs and numbers.
void main() {
  const mandiri = 'Mandiri · ••••0123 · PT Contoh Dirgantara';

  group('fundCheck.loans[].statusLabel', () {
    test('the server label wins (a status the APK does not know yet still reads right)', () {
      final j = fundCheckJson();
      final loan = Map<String, dynamic>.of((j['loans'] as List).single as Map<String, dynamic>);
      loan['status'] = 'on_hold';
      loan['statusLabel'] = 'Ditahan';
      final loans = [loan];
      final f = fundCheckFromJson({...j, 'loans': loans})!;
      expect(f.loans.single.serverStatusLabel, 'Ditahan');
      expect(f.loans.single.statusLabel, 'Ditahan');
    });

    test('an older server (code only) or a blank label: the local map', () {
      final old = fundCheckFromJson(fundCheckJson(loanStatusLabel: null))!.loans.single;
      expect(old.serverStatusLabel, isNull);
      expect(old.statusLabel, 'Menunggu pencairan');
      const blank = FundLoanRef(id: 1, docNo: 'X', status: 'repaid', amount: 1, serverStatusLabel: ' ');
      expect(blank.statusLabel, 'Lunas');
      const unknown = FundLoanRef(id: 1, docNo: 'X', status: 'on_hold', amount: 1);
      expect(unknown.statusLabel, 'on_hold');
    });

    test('the server label is part of the value (freezed equality / copyWith)', () {
      const a = FundLoanRef(id: 1, docNo: 'X', status: 'disbursed', amount: 1, serverStatusLabel: 'Dicairkan');
      expect(a, a.copyWith());
      expect(a.hashCode, a.copyWith().hashCode);
      final b = a.copyWith(serverStatusLabel: null);
      expect(a == b, isFalse);
      expect(b.statusLabel, 'Dicairkan');
      expect(a.toString(), contains('serverStatusLabel: Dicairkan'));
    });
  });

  group('loan detail destination', () {
    test('parsed from the detail: a value, null, or absent (an older server)', () {
      final withDest = IcLoan.fromJson(icLoanDetailJson(destination: icDestinationJson));
      expect(withDest.destinationKnown, isTrue);
      expect(withDest.destination?.text, mandiri);
      final none = IcLoan.fromJson(icLoanDetailJson(destination: null));
      expect(none.destinationKnown, isTrue);
      expect(none.destination, isNull);
      final old = IcLoan.fromJson(icLoanDetailJson());
      expect(old.destinationKnown, isFalse);
      expect(old.destination, isNull);
      expect(IcLoanQueue.fromJson(icLoanQueueJson()).items.every((i) => i.destinationKnown), isTrue);
    });

    test('readers = the queue item\'s: Finance of the lender while instructed (G1 creator included)', () {
      expect(IcLoan.fromJson(icLoanDetailJson()).readsDestination, isTrue, reason: 'disburse offered');
      expect(IcLoan.fromJson(icLoanDetailJson(g1: true)).readsDestination, isTrue, reason: 'G1 creator');
      expect(IcLoan.fromJson(icLoanDetailJson(allowed: const ['cancel'])).readsDestination, isFalse);
      expect(IcLoan.fromJson(icLoanDetailJson(status: 'disbursed')).readsDestination, isFalse);
    });

    test('the detail\'s own value wins; the queue item only for an older server; else unknown', () {
      final queued = IcLoanQueue.fromJson(icLoanQueueJson()).items.first;
      final other = IcLoan.fromJson(icLoanDetailJson(destination: {'bankName': 'BRI', 'accountHolder': 'PT Lain'}));
      final detail = IcLoan.fromJson(icLoanDetailJson(destination: icDestinationJson));

      final own = icLoanDestinationOf(detail, queued: other);
      expect(own.known, isTrue);
      expect(own.destination?.text, mandiri);

      final noneOnDetail = icLoanDestinationOf(IcLoan.fromJson(icLoanDetailJson(destination: null)), queued: queued);
      expect(noneOnDetail.known, isTrue);
      expect(noneOnDetail.destination, isNull, reason: 'null on the detail = none designated');

      final fallback = icLoanDestinationOf(IcLoan.fromJson(icLoanDetailJson()), queued: queued);
      expect(fallback.known, isTrue);
      expect(fallback.destination?.text, mandiri);

      final unknown = icLoanDestinationOf(IcLoan.fromJson(icLoanDetailJson()));
      expect(unknown.known, isFalse);
      expect(unknown.destination, isNull);
    });
  });
}
