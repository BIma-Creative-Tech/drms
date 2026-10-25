import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/dates.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../auth/application/auth_controller.dart';
import '../../companies/presentation/company_chip.dart';
import '../../home/domain/route_access.dart';
import '../application/notifications_providers.dart';
import '../domain/app_notification.dart';
import '../../../shared/icons/iconsax.dart';
import '../../../shared/widgets/pk_ui.dart';

/// Bell icon with the unread count (home app bar).
class NotificationBell extends ConsumerWidget {
  const NotificationBell({super.key, this.onHero = false});

  /// D2510: round translucent button on the Beranda hero band instead of an app bar icon.
  final bool onHero;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final unread = ref.watch(notificationsProvider).value?.unreadCount ?? 0;
    if (onHero) {
      return PkHeroIconButton(
        key: const Key('notification-bell'),
        tooltip: t.notificationsTitle,
        onPressed: () => context.push('/notifications'),
        child: Badge(
          isLabelVisible: unread > 0,
          label: Text(unread > 99 ? '99+' : '$unread'),
          child: const PkIcon(PkIcons.bell),
        ),
      );
    }
    return IconButton(
      key: const Key('notification-bell'),
      tooltip: t.notificationsTitle,
      onPressed: () => context.push('/notifications'),
      icon: Badge(
        isLabelVisible: unread > 0,
        label: Text(unread > 99 ? '99+' : '$unread'),
        child: const PkIcon(PkIcons.bell),
      ),
    );
  }
}

/// In-app notifications (server texts, Bahasa Indonesia). Tap → mark read → the document's screen
/// ([AppNotification.route]); rows without a target only mark read.
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
                  children: [PkEmptyState(icon: PkIcons.bell, message: t.notificationsEmpty)],
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                  itemCount: page.items.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
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
    final profile = ref.watch(currentProfileProvider);
    final route = n.route(
      canReadProgress: profile?.canReadProgress ?? false,
      ownAttendance: profile?.hasOwnAttendance ?? true,
      canSeeProjects: profile?.canSeeProjects ?? false,
      canOpen: (r) => canOpenApkRoute(r, profile),
    );
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    return PkCard(
      padding: EdgeInsets.zero,
      child: ListTile(
        key: Key('notification-${n.id}'),
        contentPadding: const EdgeInsets.fromLTRB(14, 6, 10, 6),
        leading: PkIconChip(icon: PkIcons.bell, tone: n.unread ? PkTone.info : PkTone.neutral, size: 40),
        title: Row(
          children: [
            CompanyChipLead(companyId: n.companyId),
            Expanded(
              child: Text(
                n.title,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: n.unread ? FontWeight.w700 : FontWeight.w500,
                  fontSize: 15,
                ),
              ),
            ),
            if (n.unread)
              Container(
                width: 8,
                height: 8,
                margin: const EdgeInsets.only(left: 6),
                decoration: BoxDecoration(color: theme.colorScheme.primary, shape: BoxShape.circle),
              ),
          ],
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Text.rich(
            TextSpan(
              children: [
                TextSpan(text: '${n.body}\n'),
                TextSpan(
                  text: formatServerDateTime(n.createdAt, zone: zone),
                  style: theme.textTheme.labelSmall?.copyWith(color: muted, fontSize: 12),
                ),
              ],
            ),
            style: theme.textTheme.bodySmall?.copyWith(color: muted, height: 1.35),
          ),
        ),
        isThreeLine: true,
        trailing: route == null ? null : Icon(Icons.chevron_right, color: muted),
        // Unknown document types only mark read; a read row without a target is not tappable.
        onTap: !n.unread && route == null
            ? null
            : () async {
                if (n.unread) {
                  try {
                    await ref.read(notificationsApiProvider).markRead(n.id);
                  } on Object {
                    // Reading still works offline-first: the row stays unread until the next refresh.
                  }
                  ref.invalidate(notificationsProvider);
                }
                if (route != null && context.mounted) await GoRouter.maybeOf(context)?.push(route);
              },
      ),
    );
  }
}
