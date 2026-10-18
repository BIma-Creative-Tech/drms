import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/theme_mode.dart';
import '../../../core/format/dates.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/icons/iconsax.dart';
import '../../auth/application/auth_controller.dart';
import '../../companies/application/company_selection.dart';
import '../../companies/presentation/company_switcher.dart';
import '../../privacy/domain/privacy.dart';
import '../../privacy/presentation/privacy_notice_screen.dart';
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
    final account = ref.watch(accountProfileProvider);
    final device = ref.watch(deviceIdentityProvider);
    final push = ref.watch(pushServiceProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t.profileTitle)),
      body: ListView(
        children: [
          if (p != null) ...[
            ListTile(leading: const Icon(Icons.person), title: Text(p.displayName), subtitle: Text(p.email)),
            ListTile(leading: const Icon(Icons.badge), title: Text(t.profileRoles), subtitle: Text(p.roleLabels)),
            // MC3: every PT membership with its roles; several PTs → the switcher opens from here too.
            if (account != null && account.companies.isNotEmpty)
              ListTile(
                key: const Key('profile-companies'),
                leading: const Icon(Icons.business),
                title: Text(t.profileCompanies),
                subtitle: Text(
                  [for (final c in account.companies) t.profileCompanyRoles(c.code, c.roleLabels)].join('\n'),
                ),
                trailing: account.isMultiCompany
                    ? Text(companySelectionLabel(t, account, ref.watch(companySelectionProvider)))
                    : null,
                onTap: account.isMultiCompany ? () => showCompanySwitcherSheet(context) : null,
              ),
            if (p.employee != null)
              ListTile(
                leading: const Icon(Icons.work),
                title: Text(t.profileEmployee),
                subtitle: Text('${p.employee!.code} — ${p.employee!.name}'),
              ),
            // ADR 0023: the branch office the employee is stationed at (default attendance location)
            if (p.employee?.homeSiteLabel != null)
              ListTile(
                key: const Key('profile-home-site'),
                leading: const Icon(Icons.home_work),
                title: Text(t.siteHome),
                subtitle: Text(p.employee!.homeSiteLabel!),
              ),
          ],
          // User 2026-10-19: the web avatar menu, 1:1 (own signature; 2FA status → web page).
          if (p != null) ...[
            ListTile(
              key: const Key('profile-account'),
              leading: const Icon(Icons.draw_outlined),
              title: Text(t.accountTitle),
              subtitle: Text(t.accountSubtitle),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/account'),
            ),
            ListTile(
              key: const Key('profile-security'),
              leading: const Icon(Icons.security_outlined),
              title: Text(t.securityTitle),
              subtitle: Text(t.security2faTitle),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/security'),
            ),
            const Divider(),
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
          // ADR 0018 (Q-46): re-read the employee privacy notice; status = the server's acknowledgement
          ListTile(
            key: const Key('profile-privacy'),
            leading: const Icon(Icons.privacy_tip_outlined),
            title: Text(t.privacyTitle),
            subtitle: Text(_privacySubtitle(t, account?.privacy, account?.timezone)),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('$privacyRoute?from=profile'),
          ),
          // User 2026-10-18: the offline sync queue (formerly a bottom-bar tab) lives here.
          if (p != null && (p.canCreateRequests || p.hasOwnAttendance)) const _QueueTile(),
          const Divider(),
          const _AppearanceSetting(),
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

String _privacySubtitle(AppLocalizations t, PrivacyStatus? s, String? zone) => switch (privacyGateOf(s)) {
  PrivacyGate.notAvailable => t.privacyIntro,
  PrivacyGate.acknowledged => t.privacyAcknowledgedOn(
    s!.ackVersion ?? s.currentVersion,
    formatServerDateTime(s.ackAt, zone: zone),
  ),
  PrivacyGate.required => s!.ackVersion == null ? t.privacyNotAcknowledged : t.privacyOutdated(s.currentVersion),
};

/// Profil → Tampilan: follow the phone (default), light or dark (ADR 0015). Stored on this phone only.
class _AppearanceSetting extends ConsumerWidget {
  const _AppearanceSetting();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final mode = ref.watch(themeModeProvider);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t.profileAppearance, style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            t.profileAppearanceHint,
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: SegmentedButton<ThemeMode>(
              key: const Key('theme-mode'),
              showSelectedIcon: false,
              segments: [
                ButtonSegment(
                  value: ThemeMode.system,
                  icon: const PkIcon(PkIcons.monitor, size: 20),
                  label: Text(t.themeSystem, key: const Key('theme-mode-system')),
                ),
                ButtonSegment(
                  value: ThemeMode.light,
                  icon: const PkIcon(PkIcons.sun, size: 20),
                  label: Text(t.themeLight, key: const Key('theme-mode-light')),
                ),
                ButtonSegment(
                  value: ThemeMode.dark,
                  icon: const PkIcon(PkIcons.moon, size: 20),
                  label: Text(t.themeDark, key: const Key('theme-mode-dark')),
                ),
              ],
              selected: {mode},
              onSelectionChanged: (s) => ref.read(themeModeProvider.notifier).set(s.single),
            ),
          ),
        ],
      ),
    );
  }
}

/// "Antrean sinkron": what this phone still has to send (drafts, attendance, reports) → `/queue`.
class _QueueTile extends ConsumerWidget {
  const _QueueTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final c = ref.watch(outboxCountsProvider).value;
    final n = (c?.pending ?? 0) + (c?.attention ?? 0);
    return ListTile(
      key: const Key('profile-queue'),
      leading: const Icon(Icons.cloud_sync_outlined),
      title: Text(t.navQueue),
      subtitle: Text(n == 0 ? t.profileQueueEmpty : t.profileQueueCount(n)),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if ((c?.attention ?? 0) > 0) Badge(label: Text('${c!.attention}')),
          const Icon(Icons.chevron_right),
        ],
      ),
      onTap: () => context.push('/queue'),
    );
  }
}
