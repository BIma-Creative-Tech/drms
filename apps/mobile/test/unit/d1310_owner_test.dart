import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/auth/domain/user_profile.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/domain/request_status.dart';
import 'package:proyekkas/features/expense/domain/turn_timeline.dart';

import '../support/fixtures.dart';

/// ADR 0026 (owner decision 2026-10-13): the Owner (`pk-principal`) one approval level above the Direktur — same
/// stepper / labels as the web (`apps/web/src/domain/expense/approval-timeline.ts`). Fictional names only.
Map<String, dynamic> _step(int level, String role) => {'level': level, 'approverRole': role, 'approverUserId': null};

Map<String, dynamic> _ownerRule() {
  final rule = pmRuleJson();
  rule['decisionRoles'] = ['pk-owner', 'pk-finance', 'pk-principal'];
  rule['steps'] = [_step(1, 'pk-owner'), _step(2, 'pk-principal')];
  return rule;
}

final List<Map<String, dynamic>> _approvals = [
  {'id': 1, 'cycle': 1, 'position': 'diajukan', 'level': 0, 'actorName': 'Budi', 'decision': 'signed'},
  {'id': 2, 'cycle': 1, 'position': 'dibuat', 'level': 0, 'actorName': 'Citra', 'decision': 'signed'},
  {'id': 3, 'cycle': 1, 'position': 'diketahui', 'level': 0, 'actorName': 'Pandu', 'decision': 'acknowledged'},
  {'id': 4, 'cycle': 1, 'position': 'approval', 'level': 1, 'actorName': 'Dedi', 'decision': 'approved'},
];

ExpenseDetail _waitingForOwner() {
  final json = pmDetailJson(status: 'pending_approval', allowed: const ['approve', 'reject'], approvals: _approvals);
  json['currentLevel'] = 2;
  json['statusLabel'] = ownerWaitingLabel;
  json['approvalRule'] = _ownerRule();
  return detailFromJson(json);
}

void main() {
  group('role Owner (pk-principal)', () {
    test('parsed from /me; implies the Direktur view; labelled "Owner"', () {
      expect(Role.fromCode('pk-principal'), Role.principal);
      expect(Role.principal.label, 'Owner');
      expect(Role.owner.label, 'Direktur');
      final c = companyMembershipFromJson({
        'id': 1,
        'code': 'DRMS',
        'name': 'PT DRMS',
        'roles': ['pk-principal'],
      });
      expect(c.roles, {Role.principal, Role.owner});
      expect(c.roleLabels, 'Owner');
      expect(c.canCreateRequests, isTrue);
      expect(c.seesProjectMoney, isTrue);
      expect(Role.labelsOf({Role.owner, Role.finance}), 'Finance, Direktur');
    });

    test('home + inbox of the Owner = the Direktur ones', () {
      final p = userProfileFromJson({
        'id': 5,
        'email': 'owner@example.test',
        'roles': ['pk-owner', 'pk-principal'],
      });
      expect(p.homeKind, HomeKind.direktur);
      expect(p.hasApprovalInbox, isTrue);
      expect(p.roleLabels, 'Owner');
    });
  });

  group('stepper with the Owner level (web parity)', () {
    test('Diajukan → Persetujuan PM → Persetujuan Direktur → Persetujuan Owner (current) → Transfer Finance', () {
      final d = _waitingForOwner();
      final steps = buildTimeline(d);
      final titles = [for (final s in steps) s.title];
      expect(titles, ['Diajukan', 'Persetujuan PM', 'Persetujuan Direktur', 'Persetujuan Owner', 'Transfer Finance']);
      final states = [for (final s in steps) s.state];
      expect(states, [TurnState.done, TurnState.done, TurnState.done, TurnState.current, TurnState.pending]);
      expect(steps[2].actor, 'Dedi');
      expect(steps[2].decision, 'Disetujui');
      expect(currentTurn(d), ownerStepTitle);
      expect(buildRequestStepper(d).where((s) => s.state == TurnState.current).map((s) => s.title), [ownerStepTitle]);
    });

    test('own request of the Owner: Persetujuan (dilewati, "pengajuan Owner") → Transfer Finance', () {
      final rule = {...noApprovalRuleJson(), 'name': 'Pengajuan Owner', 'selfApproval': 'principal_no_approval'};
      final d = detailFromJson({...noApprovalDetailJson(), 'approvalRule': rule});
      expect(d.approvalRule!.noApproval, isTrue);
      expect(d.approvalRule!.ownerNoApproval, isTrue);
      final steps = buildTimeline(d);
      expect(steps.map((s) => s.title), ['Diajukan', 'Persetujuan', 'Transfer Finance']);
      expect(steps[1].note, ownerNoApprovalNote);
      expect(ownerNoApprovalNote, 'Tanpa persetujuan — pengajuan Owner (kebijakan PT)');
    });

    test('status label fallback names the Owner level', () {
      final label = statusLabelFallback(RequestType.reimburse, RequestStatus.pendingApproval, ownerLevel: true);
      expect(label, 'Menunggu persetujuan Owner');
      final direktur = statusLabelFallback(RequestType.reimburse, RequestStatus.pendingApproval);
      expect(direktur, 'Menunggu persetujuan Direktur');
    });
  });
}
