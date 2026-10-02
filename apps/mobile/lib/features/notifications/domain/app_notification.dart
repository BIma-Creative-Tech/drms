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
  ///   (reminder.budget_threshold) → "Progress fisik vs anggaran" tab
  /// - `attendance` → attendance screen (no id needed; team tab for users without own attendance)
  /// [canReadProgress] = the caller may open the progress screens (PM / Direktur / Finance).
  String? route({bool canReadProgress = true, bool ownAttendance = true}) {
    final id = _numericId;
    switch (docType) {
      case 'expense_request':
        return id == null ? null : '/requests/$id';
      case 'budget_addendum':
        return id == null ? null : '/addenda/$id';
      case 'progress_report':
        return id == null || !canReadProgress ? null : '/progress/report/$id';
      case 'project':
        if (id == null || !canReadProgress) return null;
        return event == 'progress.late_report' ? '/progress?project=$id' : '/progress?tab=projects';
      case 'attendance':
        return ownAttendance ? '/attendance' : '/attendance?tab=team';
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
