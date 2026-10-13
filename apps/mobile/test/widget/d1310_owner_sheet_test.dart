import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/approvals/data/approvals_api.dart';
import 'package:proyekkas/features/approvals/presentation/decision_sheet.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';

import '../support/fixtures.dart';
import '../support/widget_harness.dart';

/// ADR 0025 (owner decision 2026-10-13): decision sheet of a PM project → Direktur → Owner request. The Direktur
/// level is no longer final (no "diteruskan ke Finance" hint); the Owner level is ("Setujui sebagai Owner").
Map<String, dynamic> _ownerRule() => {
  ...pmRuleJson(),
  'decisionRoles': ['pk-owner', 'pk-finance', 'pk-principal'],
  'steps': [
    {'level': 1, 'approverRole': 'pk-owner', 'approverUserId': null},
    {'level': 2, 'approverRole': 'pk-principal', 'approverUserId': null},
  ],
};

ExpenseDetail _detail(int level) => detailFromJson({
  ...pmDetailJson(status: 'pending_approval', allowed: const ['approve', 'reject']),
  'currentLevel': level,
  'approvalRule': _ownerRule(),
});

void main() {
  testWidgets('Direktur level of an Owner flow: Direktur wording, not the final step', (tester) async {
    await pumpScreen(tester, Scaffold(body: DecisionSheet(detail: _detail(1), decision: Decision.approve)));
    expect(find.text('Setujui sebagai Direktur'), findsWidgets);
    expect(find.byKey(const Key('decision-hint-direktur-final')), findsNothing);
    expect(find.byKey(const Key('decision-hint-owner-final')), findsNothing);
  });

  testWidgets('Owner level: "Setujui sebagai Owner", forwarded to Finance for transfer', (tester) async {
    await pumpScreen(tester, Scaffold(body: DecisionSheet(detail: _detail(2), decision: Decision.approve)));
    expect(find.text('Setujui sebagai Owner'), findsWidgets);
    expect(find.byKey(const Key('decision-hint-owner-final')), findsOneWidget);
    expect(find.text('Pengajuan diteruskan ke Finance untuk transfer.'), findsOneWidget);
  });
}
