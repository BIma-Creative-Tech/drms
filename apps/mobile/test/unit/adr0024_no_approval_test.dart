import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/draft_validation.dart';
import 'package:proyekkas/features/expense/domain/request_status.dart';
import 'package:proyekkas/features/expense/domain/turn_timeline.dart';
import 'package:proyekkas/features/finance/domain/transfer_queue.dart';
import 'package:proyekkas/features/masters/domain/master_item.dart';

import '../support/d1010_c_fixtures.dart';
import '../support/fixtures.dart';

/// ADR 0024 (owner 2026-10-11): a Direktur's own request without approval — same timeline / labels as the web
/// (`apps/web/src/domain/expense/approval-timeline.ts`), Direktur employees not offered as requester to others.
void main() {
  group('timeline (web parity)', () {
    test('Diajukan → Persetujuan (dilewati, kebijakan PT) → Transfer Finance (giliran)', () {
      final d = detailFromJson(noApprovalDetailJson());
      expect(d.approvalRule!.noApproval, isTrue);
      expect(d.approvalRule!.direkturViaPm, isFalse);
      final steps = buildTimeline(d);
      expect(steps.map((s) => s.title), ['Diajukan', 'Persetujuan', 'Transfer Finance']);
      expect(steps.map((s) => s.state), [TurnState.done, TurnState.skipped, TurnState.current]);
      expect(steps[0].actor, 'Dedi Direktur');
      expect(steps[0].note, isNull); // creator = requester
      expect(steps[1].note, 'Tanpa persetujuan — pengajuan Direktur (kebijakan PT)');
      expect(currentTurn(d), 'Finance — antri transfer');
      expect(d.statusLabel, 'Tanpa persetujuan (Antri Transfer)');
    });

    test('after the transfer the last step is done with the transfer number', () {
      final d = detailFromJson(
        noApprovalDetailJson(
          status: 'transferred',
          transfers: [
            {
              'id': 1,
              'docNo': 'TRF/DRMS/2610/0001',
              'kind': 'advance',
              'amount': 1447500,
              'transferDate': '2026-10-11',
              'status': 'posted',
            },
          ],
        ),
      );
      final steps = buildTimeline(d);
      expect(steps.last.state, TurnState.done);
      expect(steps.last.note, 'TRF/DRMS/2610/0001');
    });

    test('legacy direktur_via_pm snapshots keep their flow', () {
      final d = detailFromJson(pmDetailJson(rule: pmRuleJson(selfApproval: 'direktur_via_pm')));
      expect(d.approvalRule!.noApproval, isFalse);
      expect(buildTimeline(d).map((s) => s.title), contains('Persetujuan PM'));
    });

    test('status label fallback mirrors web NO_APPROVAL_STATUS_LABELS', () {
      expect(
        statusLabelFallback(RequestType.advance, RequestStatus.approved, noApproval: true),
        'Tanpa persetujuan (Antri Transfer)',
      );
      expect(
        statusLabelFallback(RequestType.reimburse, RequestStatus.approved, noApproval: true),
        'Tanpa persetujuan (Verifikasi Nota)',
      );
      expect(statusLabelFallback(RequestType.advance, RequestStatus.approved), 'Disetujui');
    });
  });

  group('parsing', () {
    test('/me companies[].ownRequestNoApproval', () {
      final c = companyMembershipFromJson({
        'id': 1,
        'code': 'DRMS',
        'name': 'PT DRMS',
        'roles': ['pk-owner'],
        'ownRequestNoApproval': true,
      });
      expect(c.ownRequestNoApproval, isTrue);
      expect(companyMembershipFromJson({'id': 1, 'code': 'DRMS', 'name': 'PT DRMS'}).ownRequestNoApproval, isFalse);
    });

    test('/transfer-queue noApproval (absent on older servers = false)', () {
      expect(transferQueueItemFromJson({...queueJson(44, type: 'advance'), 'noApproval': true}).noApproval, isTrue);
      expect(transferQueueItemFromJson(queueJson(45)).noApproval, isFalse);
    });
  });

  group('requester choices', () {
    const all = [
      MasterItem(11, 'Budi'),
      MasterItem(15, 'Dedi Direktur', extra: {'direktur': true}),
      MasterItem(16, 'Rina Direktur', extra: {'direktur': true}),
    ];
    bool dir(MasterItem e) => e.extra['direktur'] == true;

    test('a Direktur employee is offered only to that Direktur', () {
      expect(requesterChoices(all, (e) => e.id, isDirektur: dir, ownEmployee: 11).map((e) => e.id), [11]);
      expect(requesterChoices(all, (e) => e.id, isDirektur: dir, ownEmployee: 15).map((e) => e.id), [11, 15]);
      expect(requesterChoices(all, (e) => e.id, isDirektur: dir).map((e) => e.id), [11]);
    });

    test('QA-15 Staff-only rule unchanged', () {
      expect(
        requesterChoices(all, (e) => e.id, selfOnlyEmployee: 11, isDirektur: dir, ownEmployee: 11).map((e) => e.id),
        [11],
      );
    });
  });
}
