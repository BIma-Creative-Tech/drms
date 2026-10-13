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

Future<void> _pump(WidgetTester tester, Map<String, dynamic> json, {Set<Role> roles = const {Role.owner}}) =>
    pumpScreen(
      tester,
      const RequestDetailScreen(id: 42),
      auth: AuthSignedIn(profile: profile(roles), sub: 's'),
      overrides: [
        requestDetailProvider(42).overrideWith((ref) async => detailFromJson(json)),
        receiptThumbProvider(901).overrideWith((ref) => Future.error(const NetworkException())),
      ],
    );

double _top(WidgetTester tester, String key) => tester.getTopLeft(find.byKey(Key(key))).dy;

String? _text(WidgetTester tester, String key) => tester.widget<Text>(find.byKey(Key(key))).data;

/// DRMS 13/10 Persetujuan on the APK request detail: one stepper (right column on tablets, after the summary on
/// phones), grand total as the footer row of "Rincian item", flags on their line, "Tahapan saat ini".
void main() {
  testWidgets('tablet: stepper in the right-hand column, grand total in the lines footer', (tester) async {
    await _pump(tester, detailJson());
    final stepper = find.byKey(const Key('request-stepper'));
    expect(find.descendant(of: find.byKey(const Key('detail-side')), matching: stepper), findsOneWidget);
    expect(find.descendant(of: find.byKey(const Key('detail-main')), matching: stepper), findsNothing);
    expect(find.byKey(const Key('step-current')), findsOneWidget);
    expect(find.text('Alur pengajuan'), findsOneWidget);
    expect(_text(tester, 'turn-title'), 'Menunggu keputusan Anda');
    expect(find.text('Tahapan saat ini'), findsOneWidget, reason: 'the label of the current step');

    expect(_text(tester, 'lines-grand-total'), 'Rp 1.447.500');
    expect(_top(tester, 'lines-footer'), greaterThan(_top(tester, 'line-2-meta')));
    expect(find.text('Grand total'), findsOneWidget, reason: 'no grand total row in the summary any more');
  });

  testWidgets('phone: the stepper follows the summary in the single column', (tester) async {
    await _pump(tester, detailJson());
    tester.view.physicalSize = const Size(390, 3200);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('detail-side')), findsNothing);
    final stepper = _top(tester, 'section-stepper');
    expect(stepper, greaterThan(_top(tester, 'section-bank')));
    expect(stepper, lessThan(_top(tester, 'section-lines')));
    expect(_top(tester, 'lines-footer'), greaterThan(_top(tester, 'line-2-meta')));
  });

  testWidgets('requester: "Tahapan saat ini"; a line flag sits on its line, no summary', (tester) async {
    await _pump(tester, detailJson(allowed: const []), roles: const {Role.staff});
    expect(_text(tester, 'turn-title'), 'Tahapan saat ini');
    expect(_text(tester, 'turn-text'), 'Approval (Direktur)');
    expect(find.byKey(const Key('line-1-flag-1')), findsOneWidget);
    expect(find.text('Satuan tidak wajar'), findsOneWidget);
    expect(find.byKey(const Key('section-flags')), findsNothing, reason: 'only request-level flags are listed');
    expect(find.byKey(const Key('detail-receipt-mismatch')), findsNothing);
    expect(find.byKey(const Key('detail-rap-over')), findsNothing);
  });
}
