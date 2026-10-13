import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/application/expense_providers.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/presentation/request_detail_screen.dart';
import 'package:proyekkas/features/expense/presentation/widgets/receipt_thumb.dart';

import '../support/fixtures.dart';
import '../support/widget_harness.dart';

/// DRMS 13/10 Wave 4a (ADR 0025): the request detail of a vendor payment — vendor + invoice section, the destination
/// = the vendor account, a stepper without the LPJ step. Fictional data.
Map<String, dynamic> _vendor() => {
  ...detailJson(status: 'completed', allowed: const []),
  'type': 'advance',
  'typeLabel': 'Pembayaran vendor',
  'statusLabel': 'Selesai',
  'payeeType': 'vendor',
  'vendor': {'id': 3, 'name': 'CV Contoh Material'},
  'vendorBankAccountId': 31,
  'invoice': {'no': 'INV/2026/0012', 'date': '2026-10-10', 'dueDate': '2026-10-31', 'fileId': 77, 'fileName': 'invoice.jpg'},
  'bank': {'bankName': 'Mandiri', 'accountNo': '•••4321', 'accountHolder': 'CV Contoh Material'},
  'settlement': null,
  'transfers': [
    {'id': 5, 'docNo': 'TRF/CS1/2610/0001', 'kind': 'advance', 'amount': 1447500, 'transferDate': '2026-10-12', 'status': 'posted'},
  ],
};

void main() {
  testWidgets('vendor payment: vendor + invoice rows, "Rekening vendor", no LPJ step', (tester) async {
    await pumpScreen(
      tester,
      const RequestDetailScreen(id: 42),
      auth: AuthSignedIn(profile: profile(const {Role.pm}), sub: 's'),
      overrides: [
        requestDetailProvider(42).overrideWith((ref) async => detailFromJson(_vendor())),
        receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
      ],
    );
    expect(find.byKey(const Key('section-vendor')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('detail-vendor')), matching: find.text('CV Contoh Material')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('detail-invoice-no')), matching: find.text('INV/2026/0012')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('detail-invoice-file')), matching: find.text('invoice.jpg')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('section-bank')), matching: find.text('Rekening vendor')), findsOneWidget);
    expect(find.text('LPJ'), findsNothing, reason: 'a vendor payment has no LPJ step');
    expect(find.textContaining('pembayaran vendor selesai saat ditransfer'), findsOneWidget);
  });
}
