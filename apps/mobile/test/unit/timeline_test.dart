import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/turn_timeline.dart';

import '../support/fixtures.dart';

void main() {
  test('pending approval: signatures done, approval level 1 is the current turn', () {
    final d = detailFromJson(detailJson());
    final steps = buildTimeline(d);
    expect(steps.map((s) => s.title), ['Diajukan Oleh', 'Dibuat Oleh', 'Diketahui Oleh', 'Approval (Direktur)']);
    expect(steps.map((s) => s.state), [TurnState.done, TurnState.done, TurnState.done, TurnState.current]);
    expect(steps.first.actor, 'Budi');
    expect(currentTurn(d), 'Approval (Direktur)');
  });

  test('pending acknowledge: Diketahui is current, approval pending', () {
    final d = detailFromJson(
      detailJson(
        status: 'pending_ack',
        approvals: [
          {'id': 1, 'cycle': 1, 'position': 'diajukan', 'level': 0, 'actorName': 'Budi', 'decision': 'signed'},
        ],
      ),
    );
    final steps = buildTimeline(d);
    expect(steps[2].state, TurnState.current);
    expect(steps[3].state, TurnState.pending);
    expect(currentTurn(d), 'Direktur — persetujuan (Diketahui)');
  });

  test('rejected at approval shows the reason', () {
    final d = detailFromJson(
      detailJson(
        status: 'rejected',
        approvals: [
          {
            'id': 1,
            'cycle': 1,
            'position': 'approval',
            'level': 1,
            'actorName': 'Direktur',
            'decision': 'rejected',
            'reason': 'Nota kurang',
          },
        ],
      ),
    );
    final last = buildTimeline(d).last;
    expect(last.state, TurnState.rejected);
    expect(last.note, 'Nota kurang');
    expect(currentTurn(d), contains('tidak ada giliran'));
  });

  test('draft: requester has the turn', () {
    final d = detailFromJson(detailJson(status: 'draft', approvals: const []));
    expect(buildTimeline(d).first.state, TurnState.current);
    expect(currentTurn(d), contains('belum diajukan'));
  });

  test('older approval cycles are ignored', () {
    final d = detailFromJson(
      detailJson(
        approvals: [
          {'id': 9, 'cycle': 0, 'position': 'approval', 'level': 1, 'actorName': 'X', 'decision': 'rejected'},
        ],
      ),
    );
    expect(buildTimeline(d).last.state, TurnState.current);
  });
}
