import 'expense_request.dart';
import 'request_status.dart';

enum TurnState { done, current, pending, rejected, skipped }

class TimelineStep {
  const TimelineStep({required this.title, required this.state, this.actor, this.at, this.note, this.decision});
  final String title;
  final TurnState state;
  final String? actor;
  final String? at;
  final String? note;

  /// DRMS 13/10 Persetujuan #3: decision of an approval step ("Disetujui" / "Ditolak" / "Diketahui").
  final String? decision;

  TimelineStep withState(TurnState state) {
    return TimelineStep(title: title, state: state, actor: actor, at: at, note: note, decision: decision);
  }
}

/// Decision label of a signature (web wording); null for a plain signature (Diajukan / Dibuat).
/// [approvalFlow]: since ADR 0013 the "Diketahui" position is an approval (Direktur, or the PM under ADR 0021).
String? decisionLabel(ApprovalEntry a, {required bool approvalFlow}) => switch (a.decision) {
  'approved' => 'Disetujui',
  'rejected' => 'Ditolak',
  'acknowledged' => approvalFlow ? 'Disetujui' : 'Diketahui',
  _ => null,
};

/// Signature positions of the current approval cycle, in form order (Diajukan → Dibuat → Diketahui →
/// Approval 1..n), with who acted and which step is current ("Tahapan saat ini", US-05).
/// ADR 0021 snapshots (PM project → Direktur) read exactly like the web ApprovalTimeline
/// (`apps/web/src/domain/expense/approval-timeline.ts`): Diajukan → Persetujuan PM → Persetujuan Direktur →
/// Transfer Finance. Older snapshots keep their wording (Diajukan Oleh / Dibuat Oleh / Diketahui / Approval).
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
  final pmFlow = d.approvalRule?.pmApproval ?? false;
  // ADR 0024: a Direktur's own request without approval reads like the web: Diajukan → Persetujuan (dilewati,
  // "Tanpa persetujuan — pengajuan Direktur (kebijakan PT)") → Transfer Finance. ADR 0026: the Owner's own request.
  final noApproval = d.approvalRule?.noApproval ?? false;
  final approvalFlow = d.approvalRule?.decisionFlow ?? false;

  if (pmFlow || noApproval) {
    // web: one "Diajukan" step; the creator is named in the note when it is someone else
    final diajukan = find(SignPosition.diajukan);
    final dibuat = find(SignPosition.dibuat);
    final creatorNote = dibuat != null && dibuat.actorName != diajukan?.actorName
        ? 'dibuat oleh ${actorOf(dibuat)}'
        : null;
    steps.add(
      TimelineStep(
        title: 'Diajukan',
        state: submitted ? TurnState.done : TurnState.current,
        actor: diajukan != null ? actorOf(diajukan) : null,
        at: diajukan?.decidedAt ?? dibuat?.decidedAt,
        note: submitted ? creatorNote : 'belum diajukan',
      ),
    );
  } else {
    for (final pos in [SignPosition.diajukan, SignPosition.dibuat]) {
      final a = find(pos);
      final title = pos == SignPosition.diajukan ? 'Diajukan Oleh' : 'Dibuat Oleh';
      steps.add(
        a != null
            ? TimelineStep(title: title, state: TurnState.done, actor: actorOf(a), at: a.decidedAt)
            : TimelineStep(title: title, state: submitted ? TurnState.skipped : TurnState.current),
      );
    }
  }

  if (noApproval) {
    final note = (d.approvalRule?.ownerNoApproval ?? false) ? ownerNoApprovalNote : noApprovalNote;
    steps.add(TimelineStep(title: noApprovalStepTitle, state: TurnState.skipped, note: note));
    steps.add(transferStep(d, submitted: submitted, rejected: false));
    return steps;
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
          decision: decisionLabel(a, approvalFlow: approvalFlow),
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
          decision: decisionLabel(a, approvalFlow: approvalFlow),
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
  if (pmFlow) {
    final rejected = steps.any((s) => s.state == TurnState.rejected);
    steps.add(transferStep(d, submitted: submitted, rejected: rejected));
  }
  return steps;
}

/// Step titles after the approvals (DRMS 13/10 Persetujuan #3, same wording as the web stepper).
const transferStepTitle = 'Transfer Finance';
const receiptCheckStepTitle = 'Verifikasi nota Finance';
const lpjStepTitle = 'LPJ';
const doneStepTitle = 'Selesai';
const rejectedStepTitle = 'Ditolak';
const cancelledStepTitle = 'Dibatalkan';

/// DRMS 13/10 Persetujuan #3: ONE vertical stepper of the whole request — the approval steps of [buildTimeline]
/// (Diajukan → Persetujuan PM / Diketahui → Persetujuan Direktur / Approval, each with actor, time, decision and
/// note), then "Verifikasi nota Finance" (Reimburse), "Transfer Finance", "LPJ" (Pengajuan Baru) and "Selesai" —
/// or "Ditolak" / "Dibatalkan". While someone has to act, that step is [TurnState.current] ("Tahapan saat ini").
/// Only data of `GET /expense-requests/{id}` (approvals, rule snapshot, transfers, settlement, status).
List<TimelineStep> buildRequestStepper(ExpenseDetail d) {
  final steps = buildTimeline(d);
  final rejected = d.status == RequestStatus.rejected;
  final cancelled = d.status == RequestStatus.cancelled;
  final ended = rejected || cancelled;
  final turn = currentTurn(d);
  if (!steps.any((s) => s.title == transferStepTitle)) {
    final decidedNo = steps.any((s) => s.state == TurnState.rejected);
    steps.add(transferStep(d, submitted: d.status != RequestStatus.draft, rejected: rejected || decidedNo));
  }
  // Finance checks the receipts of a Reimburse before its transfer.
  if (d.type == RequestType.reimburse) {
    final check = _receiptCheckStep(d, ended: ended, turn: turn);
    steps.insert(steps.indexWhere((s) => s.title == transferStepTitle), check);
  } else {
    steps.add(_lpjStep(d, ended: ended, turn: turn));
  }
  steps.add(_finalStep(d, rejected: rejected, cancelled: cancelled, turn: turn));
  // One "Tahapan saat ini": a later step marked current (Dibuat Oleh of a legacy draft) waits for it.
  final current = steps.indexWhere((s) => s.state == TurnState.current);
  for (var i = current + 1; current >= 0 && i < steps.length; i++) {
    if (steps[i].state == TurnState.current) steps[i] = steps[i].withState(TurnState.pending);
  }
  return steps;
}

/// Statuses of a Reimburse whose receipts Finance has verified.
const _receiptsChecked = {RequestStatus.receiptsVerified, RequestStatus.transferred, RequestStatus.completed};

TimelineStep _receiptCheckStep(ExpenseDetail d, {required bool ended, required String turn}) {
  final s = d.status;
  if (s == RequestStatus.approved || s == RequestStatus.receiptRevision) {
    return TimelineStep(title: receiptCheckStepTitle, state: TurnState.current, note: turn);
  }
  final checked = _receiptsChecked.contains(s);
  if (checked || d.transfers.any((t) => !t.isVoid)) {
    return const TimelineStep(title: receiptCheckStepTitle, state: TurnState.done);
  }
  return TimelineStep(title: receiptCheckStepTitle, state: ended ? TurnState.skipped : TurnState.pending);
}

/// Statuses of a Pengajuan Baru between its transfer and the end of its LPJ.
const _lpjPhase = {
  RequestStatus.transferred,
  RequestStatus.receiptRevision,
  RequestStatus.receiptsComplete,
  RequestStatus.lpjSubmitted,
  RequestStatus.lpjRevision,
  RequestStatus.lpjVerified,
};

TimelineStep _lpjStep(ExpenseDetail d, {required bool ended, required String turn}) {
  // The LPJ status itself is in the LPJ section; the step names the document and who acts.
  final lpj = d.settlement;
  final docNo = lpj?.docNo;
  if (d.status == RequestStatus.completed || lpj?.status == 'settled') {
    final at = lpj?.settledAt ?? lpj?.verifiedAt;
    return TimelineStep(title: lpjStepTitle, state: TurnState.done, at: at, note: docNo);
  }
  if (_lpjPhase.contains(d.status)) {
    return TimelineStep(
      title: lpjStepTitle,
      state: TurnState.current,
      at: lpj?.submittedAt,
      note: [?docNo, turn].join(' · '),
    );
  }
  return TimelineStep(title: lpjStepTitle, state: ended ? TurnState.skipped : TurnState.pending);
}

TimelineStep _finalStep(ExpenseDetail d, {required bool rejected, required bool cancelled, required String turn}) {
  // The reason is on the rejecting step (and in "Alasan ditolak").
  if (rejected) return const TimelineStep(title: rejectedStepTitle, state: TurnState.rejected);
  if (cancelled) return TimelineStep(title: cancelledStepTitle, state: TurnState.rejected, note: d.cancelReason);
  if (d.status == RequestStatus.completed) {
    return TimelineStep(title: doneStepTitle, state: TurnState.done, at: d.settlement?.settledAt);
  }
  // A transferred Reimburse waits for the requester / Finance to confirm completion.
  final confirm = d.type == RequestType.reimburse && d.status == RequestStatus.transferred;
  if (confirm) return TimelineStep(title: doneStepTitle, state: TurnState.current, note: turn);
  return const TimelineStep(title: doneStepTitle, state: TurnState.pending);
}

/// ADR 0021 last step "Transfer Finance" (web approval-timeline.ts step 4): done with the posted
/// Pengajuan Baru / Reimburse transfers, current while the request waits in the transfer queue.
TimelineStep transferStep(ExpenseDetail d, {required bool submitted, required bool rejected}) {
  bool main(TransferInfo t) => t.kind == 'advance' || t.kind == 'reimburse';
  final posted = d.transfers.where((t) => main(t) && !t.isVoid).toList();
  final voided = d.transfers.where((t) => main(t) && t.isVoid).toList();
  final voidNote = voided.isEmpty ? null : 'void: ${voided.map((t) => t.docNo ?? '-').join(', ')}';
  if (posted.isNotEmpty) {
    return TimelineStep(
      title: transferStepTitle,
      state: TurnState.done,
      at: posted.last.transferDate,
      note: [posted.map((t) => t.docNo ?? '-').join(', '), ?voidNote].join(' · '),
    );
  }
  final queue =
      (d.type == RequestType.advance && d.status == RequestStatus.approved) ||
      (d.type == RequestType.reimburse && d.status == RequestStatus.receiptsVerified);
  final ended = d.status == RequestStatus.rejected || d.status == RequestStatus.cancelled || rejected;
  final note =
      d.type == RequestType.reimburse &&
          (d.status == RequestStatus.approved || d.status == RequestStatus.receiptRevision)
      ? 'setelah nota diverifikasi Finance'
      : voidNote;
  return TimelineStep(
    title: transferStepTitle,
    state: !submitted
        ? TurnState.pending
        : queue
        ? TurnState.current
        : (ended ? TurnState.skipped : TurnState.pending),
    note: note,
  );
}

/// ADR 0013 G1-2 wording (web PDF/Riwayat use the same text).
const skippedNote = '(tidak berlaku — pemohon)';

/// ADR 0024 step of a request without approval (web `NO_APPROVAL_STEP_TITLE` / `NO_APPROVAL_NOTE`).
const noApprovalStepTitle = 'Persetujuan';
const noApprovalNote = 'Tanpa persetujuan — pengajuan Direktur (kebijakan PT)';

/// ADR 0026: the Owner's own request without approval (web `PRINCIPAL_NO_APPROVAL_NOTE`).
const ownerNoApprovalNote = 'Tanpa persetujuan — pengajuan Owner (kebijakan PT)';

/// ADR 0026 (owner decision 2026-10-13): the approval level above the Direktur — role code and step title (web
/// `OWNER_STEP_LABEL`).
const ownerRoleCode = 'pk-principal';
const ownerStepTitle = 'Persetujuan Owner';
const ownerApproveTitle = 'Setujui sebagai Owner';

/// "Diketahui" position title: PM project approval since ADR 0021 (checked FIRST — those snapshots
/// also carry decision roles), Direktur approval under ADR 0013, PM on pre-E1 snapshots.
String acknowledgeTitle(ApprovalRuleInfo? rule) {
  if (rule == null) return 'Diketahui Oleh';
  if (rule.pmApproval) return 'Persetujuan PM';
  if (rule.decisionFlow || rule.acknowledgeRole == 'pk-owner') return 'Diketahui (Direktur)';
  if (rule.legacyPmAcknowledge) return 'Diketahui Oleh (PM / penanggung jawab)';
  return 'Diketahui Oleh';
}

/// Approval position title: Finance since ADR 0013; pre-E1 snapshots name the role of the level;
/// ADR 0021 (PM project → Direktur): the Direktur level is "Persetujuan Direktur"; ADR 0026: the Owner level is
/// "Persetujuan Owner". A role that holds a single level is named without "(level n)" (web approval-timeline.ts).
String approvalTitle(ApprovalRuleInfo? rule, int level, {required bool multi}) {
  final base = multi ? 'Approval level $level' : 'Approval';
  final role = rule?.roleOfLevel(level);
  final levelsOfRole = rule?.steps.where((s) => s.approverRole == role && s.approverUserId == null).length ?? 0;
  final suffix = multi && levelsOfRole > 1 ? ' (level $level)' : '';
  if (role == ownerRoleCode) return '$ownerStepTitle$suffix';
  if ((rule?.pmApproval ?? false) && role == 'pk-owner') return 'Persetujuan Direktur$suffix';
  final label = switch (role) {
    'pk-finance' => 'Finance',
    'pk-owner' => 'Direktur',
    _ => rule?.decisionFlow ?? false ? 'Finance' : null,
  };
  return label == null ? base : '$base ($label)';
}

/// One-line "Tahapan saat ini" text: who has to act next.
String currentTurn(ExpenseDetail d) => switch (d.status) {
  RequestStatus.draft => 'Pemohon — belum diajukan',
  RequestStatus.pendingAck =>
    d.approvalRule?.pmApproval ?? false
        ? 'PM project — persetujuan PM'
        : d.approvalRule?.legacyPmAcknowledge ?? false
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
  RequestStatus.completed || RequestStatus.rejected || RequestStatus.cancelled => 'Selesai — tidak ada tahapan aktif',
  RequestStatus.unknown => '-',
};
