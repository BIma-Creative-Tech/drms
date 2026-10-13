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
Map<String, dynamic> _step(int level, String role) => {'level': level, 'approverRole': role, 'approverUserId': null};

Map<String, dynamic> _ownerRule() {
  final rule = pmRuleJson();
  rule['decisionRoles'] = ['pk-owner', 'pk-finance', 'pk-principal'];
  rule['steps'] = [_step(1, 'pk-owner'), _step(2, 'pk-principal')];
  return rule;
}

ExpenseDetail _detail(int level) {
  final json = pmDetailJson(status: 'pending_approval', allowed: const ['approve', 'reject']);
  json['currentLevel'] = level;
  json['approvalRule'] = _ownerRule();
  return detailFromJson(json);
}

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
