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

  bool get unread => readAt == null;

  /// Expense request id when the notification points at one (tap → detail).
  int? get requestId => docType == 'expense_request' ? int.tryParse(docId ?? '') : null;

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
  );
}

class NotificationPage {
  const NotificationPage(this.items, this.unreadCount, this.nextCursor);
  final List<AppNotification> items;
  final int unreadCount;
  final String? nextCursor;
}
