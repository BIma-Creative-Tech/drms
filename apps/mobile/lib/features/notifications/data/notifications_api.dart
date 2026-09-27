import '../../../core/network/api_client.dart';
import '../domain/app_notification.dart';

/// `GET /api/v1/notifications`, `POST …/{id}/read`, `POST …/read-all` — the caller's own rows only.
/// Until FCM exists (ADR 0011, Q-44) this polling path is how the phone learns about approvals,
/// transfers and LPJ results.
class NotificationsApi {
  NotificationsApi(this.client);
  final ApiClient client;

  Future<NotificationPage> list({bool unreadOnly = false, int limit = 30}) => client.run(
    (d) => d.get<dynamic>('/notifications', queryParameters: {'limit': limit, if (unreadOnly) 'unread': 'true'}),
    (data) {
      final m = data as Map<String, dynamic>;
      return NotificationPage(
        [
          for (final i in (m['items'] as List<dynamic>? ?? const []))
            AppNotification.fromJson(i as Map<String, dynamic>),
        ],
        (m['unreadCount'] as num?)?.toInt() ?? 0,
        m['nextCursor'] as String?,
      );
    },
  );

  Future<void> markRead(int id) => client.run((d) => d.post<dynamic>('/notifications/$id/read'), (_) {});

  Future<void> markAllRead() => client.run((d) => d.post<dynamic>('/notifications/read-all'), (_) {});
}
