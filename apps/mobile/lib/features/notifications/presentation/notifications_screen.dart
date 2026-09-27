import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/dates.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../auth/application/auth_controller.dart';
import '../application/notifications_providers.dart';
import '../domain/app_notification.dart';

/// Bell icon with the unread count (home app bar).
class NotificationBell extends ConsumerWidget {
  const NotificationBell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final unread = ref.watch(notificationsProvider).value?.unreadCount ?? 0;
    return IconButton(
      key: const Key('notification-bell'),
      tooltip: t.notificationsTitle,
      onPressed: () => context.push('/notifications'),
      icon: Badge(
        isLabelVisible: unread > 0,
        label: Text(unread > 99 ? '99+' : '$unread'),
        child: const Icon(Icons.notifications),
      ),
    );
  }
}

/// In-app notifications (server texts, Bahasa Indonesia). Tap → mark read → request detail.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(notificationsProvider);
    final zone = ref.watch(currentProfileProvider)?.timezone;
    final hasUnread = (value.value?.unreadCount ?? 0) > 0;
    return Scaffold(
      appBar: AppBar(
        title: Text(t.notificationsTitle),
        actions: [
          if (hasUnread)
            TextButton(
              key: const Key('notifications-read-all'),
              onPressed: () async {
                try {
                  await ref.read(notificationsApiProvider).markAllRead();
                } on Object catch (e) {
                  if (context.mounted) showSnack(context, errorText(e));
                }
                ref.invalidate(notificationsProvider);
              },
              child: Text(t.notificationsReadAll),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(notificationsProvider.future),
        child: AsyncBody(
          value: value,
          onRetry: () => ref.invalidate(notificationsProvider),
          data: (page) => page.items.isEmpty
              ? ListView(
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(32),
                      child: Text(t.notificationsEmpty, textAlign: TextAlign.center),
                    ),
                  ],
                )
              : ListView.separated(
                  itemCount: page.items.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (_, i) => _Tile(n: page.items[i], zone: zone),
                ),
        ),
      ),
    );
  }
}

class _Tile extends ConsumerWidget {
  const _Tile({required this.n, this.zone});
  final AppNotification n;
  final String? zone;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListTile(
      key: Key('notification-${n.id}'),
      leading: Icon(
        n.unread ? Icons.markunread : Icons.drafts,
        color: n.unread ? Theme.of(context).colorScheme.primary : null,
      ),
      title: Text(n.title, style: TextStyle(fontWeight: n.unread ? FontWeight.bold : FontWeight.normal)),
      subtitle: Text('${n.body}\n${formatServerDateTime(n.createdAt, zone: zone)}'),
      isThreeLine: true,
      onTap: () async {
        if (n.unread) {
          try {
            await ref.read(notificationsApiProvider).markRead(n.id);
          } on Object {
            // Reading still works offline-first: the row stays unread until the next refresh.
          }
          ref.invalidate(notificationsProvider);
        }
        final id = n.requestId;
        if (id != null && context.mounted) await GoRouter.maybeOf(context)?.push('/requests/$id');
      },
    );
  }
}
