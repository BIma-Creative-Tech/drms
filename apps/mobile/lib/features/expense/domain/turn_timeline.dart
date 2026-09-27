import 'expense_request.dart';
import 'request_status.dart';

enum TurnState { done, current, pending, rejected, skipped }

class TimelineStep {
  const TimelineStep({required this.title, required this.state, this.actor, this.at, this.note});
  final String title;
  final TurnState state;
  final String? actor;
  final String? at;
  final String? note;
}

/// Signature positions of the current approval cycle, in form order (Diajukan → Dibuat → Diketahui →
/// Approval 1..n), with who acted and whose turn it is ("Giliran", US-05).
List<TimelineStep> buildTimeline(ExpenseDetail d) {
  final cycle = d.approvals.where((a) => a.cycle == d.approvalCycle).toList();
  ApprovalEntry? find(SignPosition p, [int? level]) {
    for (final a in cycle) {
      if (a.position == p && (level == null || a.level == level)) return a;
    }
    return null;
  }

  String actorOf(ApprovalEntry a) => '${a.actorName ?? '-'}${a.onBehalf ? ' (atas nama)' : ''}';
  final steps = <TimelineStep>[];
  final submitted = d.status != RequestStatus.draft;

  for (final pos in [SignPosition.diajukan, SignPosition.dibuat]) {
    final a = find(pos);
    final title = pos == SignPosition.diajukan ? 'Diajukan Oleh' : 'Dibuat Oleh';
    steps.add(
      a != null
          ? TimelineStep(title: title, state: TurnState.done, actor: actorOf(a), at: a.decidedAt)
          : TimelineStep(title: title, state: submitted ? TurnState.skipped : TurnState.current),
    );
  }

  final rule = d.approvalRule;
  final ackTitle = acknowledgeTitle(rule);
  final ackSkipped = rule?.isSkipped(SignPosition.diketahui) ?? false;
  final ackMode = rule?.acknowledge ?? 'none';
  if (ackSkipped) {
    steps.add(TimelineStep(title: ackTitle, state: TurnState.skipped, note: skippedNote));
  } else if (ackMode != 'none') {
    final a = find(SignPosition.diketahui);
    final delegated = rule?.acknowledgeDelegatedTo != null ? 'dilimpahkan ke ${rule!.acknowledgeDelegatedTo}' : null;
    if (a != null) {
      steps.add(
        TimelineStep(
          title: ackTitle,
          state: a.decision == 'rejected' ? TurnState.rejected : TurnState.done,
          actor: actorOf(a),
          at: a.decidedAt,
          note: a.reason ?? delegated,
        ),
      );
    } else {
      final state = d.status == RequestStatus.pendingAck
          ? TurnState.current
          : (!submitted || d.status.waitsForDecision ? TurnState.pending : TurnState.skipped);
      steps.add(TimelineStep(title: ackTitle, state: state, note: delegated));
    }
  }

  final levels = rule?.steps.map((s) => s.level).toList() ?? const <int>[];
  final skippedApprovals = rule?.skipped.where((s) => s.position == SignPosition.approval).toList() ?? const [];
  // All approval levels skipped (ADR 0013: the only Finance holder is the requester) → no level left.
  final allLevels = levels.isEmpty ? (skippedApprovals.isEmpty ? [1] : const <int>[]) : levels;
  for (final level in allLevels) {
    final a = find(SignPosition.approval, level);
    final title = approvalTitle(rule, level, multi: allLevels.length > 1);
    if (a != null) {
      steps.add(
        TimelineStep(
          title: title,
          state: a.decision == 'rejected' ? TurnState.rejected : TurnState.done,
          actor: actorOf(a),
          at: a.decidedAt,
          note: a.reason,
        ),
      );
    } else {
      final isCurrent = d.status == RequestStatus.pendingApproval && (d.currentLevel ?? allLevels.first) == level;
      final ended = d.status == RequestStatus.rejected || d.status == RequestStatus.cancelled;
      steps.add(
        TimelineStep(
          title: title,
          state: isCurrent ? TurnState.current : (ended ? TurnState.skipped : TurnState.pending),
        ),
      );
    }
  }
  // Skipped approval levels were removed from `steps` at submit; show them once, after the rest.
  for (final _ in skippedApprovals) {
    steps.add(TimelineStep(title: approvalTitle(rule, 1, multi: false), state: TurnState.skipped, note: skippedNote));
  }
  return steps;
}

/// ADR 0013 G1-2 wording (web PDF/Riwayat use the same text).
const skippedNote = '(tidak berlaku — pemohon)';

/// "Diketahui" position title: Direktur approval since ADR 0013, PM on pre-E1 snapshots.
String acknowledgeTitle(ApprovalRuleInfo? rule) {
  if (rule == null) return 'Diketahui Oleh';
  if (rule.decisionFlow || rule.acknowledgeRole == 'pk-owner') return 'Diketahui (Direktur)';
  if (rule.legacyPmAcknowledge) return 'Diketahui Oleh (PM / penanggung jawab)';
  return 'Diketahui Oleh';
}

/// Approval position title: Finance since ADR 0013; pre-E1 snapshots name the role of the level.
String approvalTitle(ApprovalRuleInfo? rule, int level, {required bool multi}) {
  final base = multi ? 'Approval level $level' : 'Approval';
  final role = rule?.steps.where((s) => s.level == level).firstOrNull?.approverRole;
  final label = switch (role) {
    'pk-finance' => 'Finance',
    'pk-owner' => 'Direktur',
    _ => rule?.decisionFlow ?? false ? 'Finance' : null,
  };
  return label == null ? base : '$base ($label)';
}

/// One-line "Giliran" text: who has to act next.
String currentTurn(ExpenseDetail d) => switch (d.status) {
  RequestStatus.draft => 'Pemohon — belum diajukan',
  RequestStatus.pendingAck =>
    d.approvalRule?.legacyPmAcknowledge ?? false
        ? 'Diketahui Oleh (PM / penanggung jawab)'
        : 'Direktur — persetujuan (Diketahui)',
  RequestStatus.pendingApproval => approvalTitle(
    d.approvalRule,
    d.currentLevel ?? 1,
    multi: (d.approvalRule?.steps.length ?? 1) > 1,
  ),
  RequestStatus.approved => d.type == RequestType.reimburse ? 'Finance — verifikasi nota' : 'Finance — antri transfer',
  RequestStatus.receiptRevision => 'Pemohon — perbaiki nota',
  RequestStatus.receiptsVerified => 'Finance — antri transfer',
  RequestStatus.transferred =>
    d.type == RequestType.advance ? 'Pemohon — lengkapi nota' : 'Pemohon/Finance — konfirmasi selesai',
  RequestStatus.receiptsComplete => 'Pemohon — kirim LPJ',
  RequestStatus.lpjSubmitted => 'Finance — verifikasi LPJ',
  RequestStatus.lpjRevision => 'Pemohon — revisi LPJ',
  RequestStatus.lpjVerified => 'Finance — penyelesaian selisih',
  RequestStatus.completed || RequestStatus.rejected || RequestStatus.cancelled => 'Selesai — tidak ada giliran',
  RequestStatus.unknown => '-',
};
