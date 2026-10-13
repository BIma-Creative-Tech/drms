import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/features/expense/data/expense_mappers.dart';
import 'package:proyekkas/features/expense/domain/expense_request.dart';
import 'package:proyekkas/features/expense/domain/request_status.dart';
import 'package:proyekkas/features/expense/domain/turn_timeline.dart';

import '../support/fixtures.dart';

List<String> _titles(List<TimelineStep> steps) => [for (final s in steps) s.title];

List<TurnState> _states(List<TimelineStep> steps) => [for (final s in steps) s.state];

/// While someone has to act exactly one step is "Tahapan saat ini"; none once the request has ended.
int _currents(List<TimelineStep> steps) => steps.where((s) => s.state == TurnState.current).length;

const _done = TurnState.done;
const _current = TurnState.current;
const _pending = TurnState.pending;
const _skipped = TurnState.skipped;
const _rejected = TurnState.rejected;

/// ADR 0021 approvals: PM project approved (acknowledged), then the Direktur.
final _pmApprovals = [
  {'id': 1, 'cycle': 1, 'position': 'diajukan', 'level': 0, 'actorName': 'Budi', 'decision': 'signed'},
  {'id': 2, 'cycle': 1, 'position': 'dibuat', 'level': 0, 'actorName': 'Citra', 'decision': 'signed'},
  {'id': 3, 'cycle': 1, 'position': 'diketahui', 'level': 0, 'actorName': 'Pandu', 'decision': 'acknowledged'},
  {'id': 4, 'cycle': 1, 'position': 'approval', 'level': 1, 'actorName': 'Dedi', 'decision': 'approved'},
];

const _posted = TransferInfo(
  id: 77,
  docNo: 'TRF/2026/X/0001',
  kind: 'advance',
  amount: 1447500,
  transferDate: '2026-10-12',
  status: 'posted',
);

ExpenseDetail _pmAdvance(RequestStatus status, {List<TransferInfo> transfers = const [], SettlementInfo? lpj}) {
  final d = detailFromJson(pmDetailJson(status: 'approved', allowed: const [], approvals: _pmApprovals));
  return d.copyWith(type: RequestType.advance, status: status, transfers: transfers, settlement: lpj);
}

/// DRMS 13/10 Persetujuan #3: ONE stepper = overall flow + approval steps, for the flows the request DTO carries.
void main() {
  test('legacy reimburse waiting for approval: approvals, then Verifikasi nota → Transfer → Selesai', () {
    final steps = buildRequestStepper(detailFromJson(detailJson()));
    const titles = [
      'Diajukan Oleh',
      'Dibuat Oleh',
      'Diketahui Oleh',
      'Approval (Direktur)',
      'Verifikasi nota Finance',
      'Transfer Finance',
      'Selesai',
    ];
    expect(_titles(steps), titles);
    expect(_states(steps), [_done, _done, _done, _current, _pending, _pending, _pending]);
    expect(steps[2].actor, 'Eko');
    expect(steps[2].decision, 'Diketahui');
    expect(steps[2].at, isNotNull);
    expect(_currents(steps), 1);
  });

  test('ADR 0021 waiting for the PM: "Persetujuan PM" is the current step', () {
    final steps = buildRequestStepper(detailFromJson(pmDetailJson()));
    const titles = [
      'Diajukan',
      'Persetujuan PM',
      'Persetujuan Direktur',
      'Verifikasi nota Finance',
      'Transfer Finance',
      'Selesai',
    ];
    expect(_titles(steps), titles);
    expect(_states(steps), [_done, _current, _pending, _pending, _pending, _pending]);
  });

  test('ADR 0021 approved reimburse: PM / Direktur "Disetujui", Finance checks the receipts', () {
    final d = detailFromJson(pmDetailJson(status: 'approved', allowed: const [], approvals: _pmApprovals));
    final steps = buildRequestStepper(d);
    final pm = steps.firstWhere((s) => s.title == 'Persetujuan PM');
    final direktur = steps.firstWhere((s) => s.title == 'Persetujuan Direktur');
    expect((pm.actor, pm.decision, pm.state), ('Pandu', 'Disetujui', _done));
    expect((direktur.actor, direktur.decision, direktur.state), ('Dedi', 'Disetujui', _done));
    final check = steps.firstWhere((s) => s.title == 'Verifikasi nota Finance');
    expect(check.state, _current);
    expect(check.note, 'Finance — verifikasi nota');
    expect(_currents(steps), 1);
  });

  test('Pengajuan Baru: transfer queue, then LPJ while the requester completes it, then Selesai', () {
    final queued = buildRequestStepper(_pmAdvance(RequestStatus.approved));
    expect(_titles(queued).sublist(3), ['Transfer Finance', 'LPJ', 'Selesai']);
    expect(_states(queued).sublist(3), [_current, _pending, _pending]);

    const lpj = SettlementInfo(id: 3, docNo: 'LPJ/2026/X/0003', status: 'revision', statusLabel: 'Revisi');
    final inRevision = _pmAdvance(RequestStatus.lpjRevision, transfers: const [_posted], lpj: lpj);
    final revision = buildRequestStepper(inRevision);
    expect(_states(revision).sublist(3), [_done, _current, _pending]);
    expect(revision[3].note, 'TRF/2026/X/0001');
    expect(revision[4].note, 'LPJ/2026/X/0003 · Pemohon — revisi LPJ');
    expect(_currents(revision), 1);

    const settled = SettlementInfo(id: 3, status: 'settled', statusLabel: 'Lunas', settledAt: '2026-10-20T03:00:00Z');
    final done = _pmAdvance(RequestStatus.completed, transfers: const [_posted], lpj: settled);
    final completed = buildRequestStepper(done);
    expect(_states(completed), everyElement(_done));
    expect(completed.last.at, '2026-10-20T03:00:00Z');
    expect(_currents(completed), 0);
  });

  test('transferred Reimburse: Selesai is current (confirm completion)', () {
    final approved = detailFromJson(pmDetailJson(status: 'approved', allowed: const [], approvals: _pmApprovals));
    final d = approved.copyWith(status: RequestStatus.transferred, transfers: const [_posted]);
    final steps = buildRequestStepper(d);
    expect(_states(steps).sublist(3), [_done, _done, _current]);
    expect(steps.last.title, 'Selesai');
  });

  test('ADR 0024 no approval: Persetujuan skipped, Transfer current, then LPJ and Selesai', () {
    final steps = buildRequestStepper(detailFromJson(noApprovalDetailJson()));
    expect(_titles(steps), ['Diajukan', 'Persetujuan', 'Transfer Finance', 'LPJ', 'Selesai']);
    expect(_states(steps), [_done, _skipped, _current, _pending, _pending]);
  });

  test('rejected: the rejecting step keeps its reason, later steps are skipped, the flow ends "Ditolak"', () {
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
    final steps = buildRequestStepper(d);
    final approval = steps.firstWhere((s) => s.title == 'Approval (Direktur)');
    expect((approval.state, approval.decision, approval.note), (_rejected, 'Ditolak', 'Nota kurang'));
    expect(steps.firstWhere((s) => s.title == 'Transfer Finance').state, _skipped);
    expect((steps.last.title, steps.last.state), ('Ditolak', _rejected));
    expect(_currents(steps), 0);
  });

  test('cancelled: the flow ends "Dibatalkan" with the reason', () {
    final d = detailFromJson(detailJson(status: 'cancelled')).copyWith(cancelReason: 'Tidak jadi');
    final steps = buildRequestStepper(d);
    expect((steps.last.title, steps.last.state, steps.last.note), ('Dibatalkan', _rejected, 'Tidak jadi'));
    expect(_currents(steps), 0);
  });

  test('draft: Diajukan is the current step', () {
    final steps = buildRequestStepper(detailFromJson(detailJson(status: 'draft', approvals: const [])));
    expect(steps.first.state, _current);
    expect(_currents(steps), 1);
  });
}
