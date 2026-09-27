import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../auth/application/auth_controller.dart';
import '../../sync/application/sync_coordinator.dart';
import '../../sync/data/outbox_repository.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  bool _loggingOut = false;

  /// Unsent items of this user (pending + failed/rejected), from the same live DB query as the
  /// offline banner; a slow DB never blocks the dialog for more than a second.
  Future<int> _unsentCount() async {
    OutboxCounts? counts;
    // Keep the provider listened while waiting (an unlistened provider may stay paused).
    final keepAlive = ref.listenManual(outboxCountsProvider, (_, _) {});
    try {
      counts = await ref.read(outboxCountsProvider.future).timeout(const Duration(seconds: 1));
    } on Object {
      counts = ref.read(outboxCountsProvider).value;
    } finally {
      keepAlive.close();
    }
    return counts == null ? 0 : counts.pending + counts.attention;
  }

  /// Logout decision (ADR 0010 "Phone test fixes"): unsent items are never deleted. With unsent
  /// items the dialog says so and the confirm button reads "Tetap keluar".
  Future<void> _logout() async {
    if (_loggingOut) return;
    final t = AppLocalizations.of(context);
    final unsent = await _unsentCount();
    if (!mounted) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(t.logoutConfirm),
        content: unsent > 0 ? Text(t.logoutPendingWarning(unsent), key: const Key('logout-pending-warning')) : null,
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(t.cancel)),
          FilledButton(
            key: const Key('logout-confirm'),
            onPressed: () => Navigator.pop(c, true),
            child: Text(unsent > 0 ? t.logoutAnyway : t.logout),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _loggingOut = true);
    try {
      // Always ends signed out (bounded network part); the router then shows the login screen.
      await ref.read(authControllerProvider.notifier).logout();
    } finally {
      if (mounted) setState(() => _loggingOut = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final p = ref.watch(currentProfileProvider);
    final device = ref.watch(deviceIdentityProvider);
    final push = ref.watch(pushServiceProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t.profileTitle)),
      body: ListView(
        children: [
          if (p != null) ...[
            ListTile(leading: const Icon(Icons.person), title: Text(p.displayName), subtitle: Text(p.email)),
            ListTile(leading: const Icon(Icons.badge), title: Text(t.profileRoles), subtitle: Text(p.roleLabels)),
            if (p.employee != null)
              ListTile(
                leading: const Icon(Icons.work),
                title: Text(t.profileEmployee),
                subtitle: Text('${p.employee!.code} — ${p.employee!.name}'),
              ),
          ],
          ListTile(
            leading: const Icon(Icons.info_outline),
            title: Text(t.profileVersion),
            subtitle: Text(device.appVersion),
          ),
          ListTile(
            leading: const Icon(Icons.phone_android),
            title: Text(t.profileDevice),
            subtitle: Text(device.deviceId.substring(0, 8)),
          ),
          if (!push.available) ListTile(leading: const Icon(Icons.notifications_off), title: Text(t.pushDisabled)),
          const Divider(),
          Padding(
            padding: const EdgeInsets.all(16),
            child: OutlinedButton.icon(
              key: const Key('logout-button'),
              onPressed: _loggingOut ? null : _logout,
              icon: _loggingOut
                  ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.logout),
              label: Text(_loggingOut ? t.logoutInProgress : t.logout),
            ),
          ),
        ],
      ),
    );
  }
}
