import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/auth/application/auth_controller.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/loans/data/intercompany_loans_api.dart';
import 'package:proyekkas/features/loans/domain/intercompany_loan.dart';
import 'package:proyekkas/features/loans/presentation/intercompany_loan_providers.dart';
import 'package:proyekkas/features/loans/presentation/intercompany_loan_screens.dart';
import 'package:proyekkas/features/loans/presentation/loan_list_screens.dart';

import '../support/d1310_c_fixtures.dart';
import '../support/widget_harness.dart';

/// User 2026-11-13: APK parity with the web's "+ Perintahkan pinjaman" on "Pinjaman antar-PT" — the list offers the
/// instruction to an Owner of ≥ 2 PTs (server `summary.canInstruct`), and the form opened without a borrower lets the
/// Owner pick it among the PTs where he is Owner. Fictional PTs and numbers.

const _ownerCaps = Capabilities(instructIntercompanyLoan: true);

AuthSignedIn _ownerOf(List<CompanyMembership> companies) {
  final p = profile(Role.effective({Role.principal}));
  return AuthSignedIn(
    profile: p.copyWith(companies: companies),
    sub: 's',
  );
}

final _twoPts = [
  const CompanyMembership(id: 1, code: 'DRMS', name: 'PT Contoh Dirgantara', capabilities: _ownerCaps),
  const CompanyMembership(id: 4, code: 'TBK', name: 'PT Contoh Tambak', capabilities: _ownerCaps),
  // Finance only here: never a borrower the Owner instructs for
  const CompanyMembership(id: 3, code: 'KRDB', name: 'PT Contoh Karunia'),
];

class _FakeLoansApi extends Fake implements IntercompanyLoansApi {
  final instructed = <Map<String, dynamic>>[];

  @override
  Future<IcLoan> instruct(Map<String, dynamic> body, {required String idempotencyKey}) async {
    instructed.add(body);
    return IcLoan.fromJson(icLoanDetailJson());
  }
}

Finder _button(String key) => find.descendant(of: find.byKey(Key(key)), matching: find.bySubtype<ButtonStyleButton>());

void main() {
  group('"Pinjaman antar-PT" list', () {
    Future<void> open(WidgetTester tester, {required bool canInstruct}) => pumpScreen(
      tester,
      const IcLoanListScreen(),
      auth: _ownerOf(_twoPts),
      overrides: [
        icLoanListProvider.overrideWith((ref, f) async => IcLoanPage(summary: IcLoanSummary(canInstruct: canInstruct))),
      ],
    );

    testWidgets('Owner of ≥ 2 PTs: "Perintahkan pinjaman" button', (tester) async {
      await open(tester, canInstruct: true);
      expect(find.byKey(const Key('icloan-list-empty')), findsOneWidget);
      expect(find.byKey(const Key('icloan-list-new')), findsOneWidget);
      expect(find.text('Perintahkan pinjaman'), findsOneWidget);
    });

    testWidgets('anyone else: no button', (tester) async {
      await open(tester, canInstruct: false);
      expect(find.byKey(const Key('icloan-list-new')), findsNothing);
    });
  });

  group('instruction opened from the list (no borrower)', () {
    testWidgets('borrower picker = the Owner PTs; picking another PT reloads the lenders and is sent', (tester) async {
      final api = _FakeLoansApi();
      final queried = <int>[];
      await pumpScreen(
        tester,
        const IcLoanInstructScreen(),
        auth: _ownerOf(_twoPts),
        overrides: [
          intercompanyLoansApiProvider.overrideWithValue(api),
          icLenderOptionsProvider.overrideWith((ref, q) async {
            queried.add(q.borrower);
            return IcLenderOptions.fromJson(icLenderOptionsJson(defaultDueDate: '2099-12-31'));
          }),
        ],
      );
      expect(find.byKey(const Key('icloan-borrower-pick')), findsOneWidget);
      expect(queried, [1]);

      await tester.tap(find.byKey(const Key('icloan-borrower-pick')));
      await tester.pumpAndSettle();
      expect(find.text('KRDB — PT Contoh Karunia'), findsNothing);
      await tester.tap(find.text('TBK — PT Contoh Tambak').last);
      await tester.pumpAndSettle();
      expect(queried.last, 4);

      await tester.tap(find.byKey(const Key('icloan-lender-2')));
      await tester.enterText(find.byKey(const Key('icloan-amount')), '500000');
      await tester.enterText(find.byKey(const Key('icloan-reason')), 'Modal kerja proyek');
      await tester.pumpAndSettle();
      await tester.tap(_button('icloan-submit'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('icloan-confirm')));
      await tester.pumpAndSettle();
      expect(api.instructed, hasLength(1));
      expect(api.instructed.single['borrowerCompanyId'], 4);
      expect(api.instructed.single['requestIds'] ?? const <int>[], isEmpty);
    });

    testWidgets('not an Owner anywhere: explained, no form', (tester) async {
      await pumpScreen(
        tester,
        const IcLoanInstructScreen(),
        auth: _ownerOf([const CompanyMembership(id: 3, code: 'KRDB', name: 'PT Contoh Karunia')]),
      );
      expect(find.byKey(const Key('icloan-not-owner')), findsOneWidget);
      expect(find.byKey(const Key('icloan-form')), findsNothing);
    });
  });
}
