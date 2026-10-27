/// `Notification` of openapi v1 (in-app row written with every business event, ADR 0011 §5 step 1).
class AppNotification {
  const AppNotification({
    required this.id,
    required this.uuid,
    required this.event,
    required this.title,
    required this.body,
    this.docType,
    this.docId,
    this.docNo,
    this.readAt,
    required this.createdAt,
    this.companyId,
  });

  final int id;
  final String uuid;
  final String event;
  final String title;
  final String body;
  final String? docType;
  final String? docId;
  final String? docNo;
  final String? readAt;
  final String createdAt;

  /// MC3: PT of the event (`companyId`) — chip when several PTs are shown.
  final int? companyId;

  bool get unread => readAt == null;

  /// Expense request id when the notification points at one (tap → detail).
  int? get requestId => docType == 'expense_request' ? _numericId : null;

  int? get _numericId {
    final id = docId;
    return id != null && RegExp(r'^\d{1,10}$').hasMatch(id) ? int.tryParse(id) : null;
  }

  /// In-app route a tap opens, or null (row not tappable). Same doc types as the web
  /// `notificationHref` (apps/web/src/domain/notifications.ts) plus attendance:
  /// - `expense_request` (expense.*, reminder.lpj_overdue, reminder.revision_pending) → request detail
  /// - `budget_addendum` (addendum.*) → addendum detail
  /// - `progress_report` → report detail
  /// - `project`: `progress.late_report` → reports of that project; other project events
  ///   (reminder.budget_threshold) → "Progress fisik vs anggaran" tab; D2510: without progress access → the project
  /// - `attendance` → attendance screen (no id needed; team tab for users without own attendance)
  /// - `intercompany_loan` (icloan.*, ADR 0029) → inter-PT loan detail
  /// - D2510: `project_loan` → loan detail, `cash_entry` (ADR 0028 Kas Masuk) → the cash entry record, the field
  ///   reports (`service_report`, `daily_report`, `aftersales_activity`, `unit_timesheet`) → their record detail
  /// [canReadProgress] = the caller may open the progress screens (PM / Direktur / Finance); [canSeeProjects] = the
  /// project screens; [canOpen] = the caller may open a target route at all (`canOpenApkRoute`; a target the caller
  /// cannot read is not linked).
  String? route({
    bool canReadProgress = true,
    bool ownAttendance = true,
    bool canSeeProjects = true,
    bool Function(String route)? canOpen,
  }) {
    final r = _route(canReadProgress: canReadProgress, ownAttendance: ownAttendance, canSeeProjects: canSeeProjects);
    return r == null || (canOpen?.call(r) ?? true) ? r : null;
  }

  String? _route({required bool canReadProgress, required bool ownAttendance, required bool canSeeProjects}) {
    final id = _numericId;
    switch (docType) {
      case 'expense_request':
        return id == null ? null : '/requests/$id';
      case 'budget_addendum':
        return id == null ? null : '/addenda/$id';
      case 'progress_report':
        return id == null || !canReadProgress ? null : '/progress/report/$id';
      case 'project':
        if (id == null) return null;
        if (!canReadProgress) return canSeeProjects ? '/projects/$id' : null;
        return event == 'progress.late_report' ? '/progress?project=$id' : '/progress?tab=projects';
      case 'attendance':
        return ownAttendance ? '/attendance' : '/attendance?tab=team';
      case 'intercompany_loan':
        return id == null ? null : '/intercompany-loans/$id';
      case 'project_loan':
        return id == null ? null : '/loans/$id';
      case 'cash_entry':
        return id == null ? null : '/data/cash-entries/$id';
      case 'service_report':
        return id == null ? null : '/data/service-reports/$id';
      case 'daily_report':
        return id == null ? null : '/data/daily-reports/$id';
      case 'aftersales_activity':
        return id == null ? null : '/data/aftersales-activities/$id';
      case 'unit_timesheet':
        return id == null ? null : '/data/unit-timesheets/$id';
      default:
        return null;
    }
  }

  static AppNotification fromJson(Map<String, dynamic> j) => AppNotification(
    id: (j['id'] as num?)?.toInt() ?? 0,
    uuid: '${j['uuid'] ?? ''}',
    event: '${j['event'] ?? ''}',
    title: '${j['title'] ?? ''}',
    body: '${j['body'] ?? ''}',
    docType: j['docType'] as String?,
    docId: j['docId']?.toString(),
    docNo: j['docNo'] as String?,
    readAt: j['readAt'] as String?,
    createdAt: '${j['createdAt'] ?? ''}',
    companyId: (j['companyId'] as num?)?.toInt(),
  );
}

class NotificationPage {
  const NotificationPage(this.items, this.unreadCount, this.nextCursor);
  final List<AppNotification> items;
  final int unreadCount;
  final String? nextCursor;
}
