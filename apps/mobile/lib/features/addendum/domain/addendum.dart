// E5 Addendum RAB (T12, US-18/30; openapi `BudgetAddendumSummary` / `BudgetAddendumDetail` / inbox item).
// Approval flow ADR 0013: Direktur "Setujui" (step acknowledge) → Finance approval (step approve); the last level
// raises `projects.budget` on the server. Parsing is tolerant.

int _int(Object? v, [int fallback = 0]) =>
    v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? fallback : fallback);
int? _intN(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
double? _dblN(Object? v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) : null);
String? _strN(Object? v) => v == null ? null : '$v';
Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
List<dynamic> _list(Object? v) => v is List ? v : const [];

enum AddendumStatus {
  draft,
  pendingAck,
  pendingApproval,
  approved,
  rejected,
  cancelled;

  static AddendumStatus fromCode(String? c) => switch (c) {
    'pending_ack' => pendingAck,
    'pending_approval' => pendingApproval,
    'approved' => approved,
    'rejected' => rejected,
    'cancelled' => cancelled,
    _ => draft,
  };

  bool get isOpen => this == pendingAck || this == pendingApproval;
}

/// Actions of `allowedActions` (server decides; the APK only shows the buttons).
enum AddendumAction {
  edit,
  submit,
  cancel,
  acknowledge,
  approve,
  reject;

  static AddendumAction? fromCode(String c) => AddendumAction.values.where((a) => a.name == c).firstOrNull;
}

class AddendumBudget {
  const AddendumBudget({
    required this.current,
    required this.afterAddition,
    this.committed,
    this.committedPctBefore,
    this.committedPctAfter,
  });
  final int current;
  final int afterAddition;
  final int? committed;
  final double? committedPctBefore;
  final double? committedPctAfter;

  static AddendumBudget? fromJson(Object? v) {
    final j = _map(v);
    if (j.isEmpty) return null;
    return AddendumBudget(
      current: _int(j['current']),
      afterAddition: _int(j['afterAddition']),
      committed: _intN(j['committed']),
      committedPctBefore: _dblN(j['committedPctBefore']),
      committedPctAfter: _dblN(j['committedPctAfter']),
    );
  }
}

class AddendumDecision {
  const AddendumDecision({
    required this.position,
    required this.level,
    this.actorName,
    required this.decision,
    this.reason,
    this.decidedAt,
  });
  final String position; // diketahui | approval
  final int level;
  final String? actorName;
  final String decision; // acknowledged | approved | rejected
  final String? reason;
  final String? decidedAt;

  factory AddendumDecision.fromJson(Map<String, dynamic> j) => AddendumDecision(
    position: '${j['position'] ?? ''}',
    level: _int(j['level'], 1),
    actorName: _strN(_map(j['actor'])['name']),
    decision: '${j['decision'] ?? ''}',
    reason: _strN(j['reason']),
    decidedAt: _strN(j['decidedAt']),
  );
}

class Addendum {
  const Addendum({
    required this.id,
    this.docNo,
    required this.status,
    required this.statusLabel,
    this.stepLabel,
    required this.projectId,
    this.projectCode,
    this.projectName,
    this.projectBudget,
    required this.addition,
    required this.reason,
    this.oldBudget,
    this.newBudget,
    this.createdByName,
    this.submittedAt,
    this.decidedAt,
    this.rejectReason,
    this.cancelReason,
    this.step,
    this.budget,
    this.allowedActions = const {},
    this.decisions = const [],
    this.createdAt,
  });

  final int id;
  final String? docNo;
  final AddendumStatus status;
  final String statusLabel;
  final String? stepLabel;
  final int projectId;
  final String? projectCode;
  final String? projectName;
  final int? projectBudget;
  final int addition;
  final String reason;
  final int? oldBudget;
  final int? newBudget;
  final String? createdByName;
  final String? submittedAt;
  final String? decidedAt;
  final String? rejectReason;
  final String? cancelReason;

  /// Inbox only: `acknowledge` (Direktur) | `approve` (Finance).
  final String? step;
  final AddendumBudget? budget;
  final Set<AddendumAction> allowedActions;
  final List<AddendumDecision> decisions;
  final String? createdAt;

  String get projectLabel => [projectCode, projectName].whereType<String>().where((e) => e.isNotEmpty).join(' — ');

  factory Addendum.fromJson(Map<String, dynamic> j) {
    final p = _map(j['project']);
    return Addendum(
      id: _int(j['id']),
      docNo: _strN(j['docNo']),
      status: AddendumStatus.fromCode(_strN(j['status'])),
      statusLabel: '${j['statusLabel'] ?? ''}',
      stepLabel: _strN(j['stepLabel']),
      projectId: _int(p['id']),
      projectCode: _strN(p['code']),
      projectName: _strN(p['name']),
      projectBudget: _intN(p['budget']),
      addition: _int(j['addition']),
      reason: '${j['reason'] ?? ''}',
      oldBudget: _intN(j['oldBudget']),
      newBudget: _intN(j['newBudget']),
      createdByName: _strN(_map(j['createdBy'])['name']),
      submittedAt: _strN(j['submittedAt']),
      decidedAt: _strN(j['decidedAt']),
      rejectReason: _strN(j['rejectReason']),
      cancelReason: _strN(j['cancelReason']),
      step: _strN(j['step']),
      budget: AddendumBudget.fromJson(j['budget']),
      allowedActions: {for (final a in _list(j['allowedActions'])) ?AddendumAction.fromCode('$a')},
      decisions: [for (final d in _list(j['decisions'])) AddendumDecision.fromJson(_map(d))],
      createdAt: _strN(j['createdAt']),
    );
  }
}

class AddendumPage {
  const AddendumPage({required this.items, this.nextCursor});
  final List<Addendum> items;
  final String? nextCursor;

  factory AddendumPage.fromJson(Map<String, dynamic> j) => AddendumPage(
    items: [for (final i in _list(j['items'])) Addendum.fromJson(_map(i))],
    nextCursor: _strN(j['nextCursor']),
  );
}

/// Client checks of the create form (server re-checks): addition > 0 and ≤ 1e12, reason 3–1000.
Map<String, String> validateAddendum({required int? projectId, required int? addition, required String reason}) => {
  if (projectId == null) 'project': 'Pilih project.',
  if (addition == null || addition <= 0) 'addition': 'Tambahan RAB harus lebih dari Rp 0.',
  if (addition != null && addition > 1000000000000) 'addition': 'Tambahan RAB terlalu besar.',
  if (reason.trim().length < 3) 'reason': 'Alasan wajib diisi (min. 3 karakter).',
  if (reason.trim().length > 1000) 'reason': 'Alasan maks. 1000 karakter.',
};
