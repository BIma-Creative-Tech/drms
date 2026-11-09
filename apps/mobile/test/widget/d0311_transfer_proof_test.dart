import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/presentation/widgets/transfer_lpj.dart';

import '../support/fixtures.dart';
import '../support/widget_harness.dart';

/// D0311 (user 2026-11-03) "Ganti bukti transfer" on the APK: offered per posted transfer only when the server lists
/// `transfer_proof_replace` (Finance / Admin of the PT, request "Selesai"); the screen asks a new photo + reason.
ExpenseDetail _detail({required List<String> allowed, String transferStatus = 'posted'}) => detailFromJson({
  ...detailJson(status: 'completed', allowed: allowed),
  'statusLabel': 'Selesai',
  'transferredTotal': 1447500,
  'transfers': [
    {
      'id': 61,
      'docNo': 'TRF/DRMS/2611/0002',
      'kind': 'reimburse',
      'amount': 1447500,
      'transferDate': '2026-11-02',
      'bankRef': '0',
      'status': transferStatus,
      if (transferStatus == 'void') 'voidReason': 'salah',
    },
  ],
});

Future<void> _pump(WidgetTester tester, ExpenseDetail d) => pumpScreen(
  tester,
  Scaffold(
    body: SingleChildScrollView(child: TransferSection(detail: d)),
  ),
  auth: AuthSignedIn(profile: profile(const {Role.finance}), sub: 's'),
);

void main() {
  testWidgets('allowed → "Ganti bukti transfer" opens the screen; photo and reason required', (tester) async {
    await _pump(tester, _detail(allowed: const ['transfer_proof_replace']));
    expect(find.byKey(const Key('replace-proof-61')), findsOneWidget);
    await tester.tap(find.byKey(const Key('replace-proof-61')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('replace-proof-summary')), findsOneWidget);
    expect(find.textContaining('TRF/DRMS/2611/0002'), findsWidgets);
    await tester.tap(find.byKey(const Key('replace-proof-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Wajib diisi (minimal 3 karakter).'), findsOneWidget);
  });

  testWidgets('not allowed (e.g. Sudah Ditransfer, other role) → no button', (tester) async {
    await _pump(tester, _detail(allowed: const []));
    expect(find.byKey(const Key('replace-proof-61')), findsNothing);
  });

  testWidgets('a void transfer never offers it', (tester) async {
    await _pump(tester, _detail(allowed: const ['transfer_proof_replace'], transferStatus: 'void'));
    expect(find.byKey(const Key('replace-proof-61')), findsNothing);
  });
}
