import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/theme.dart';
import '../../../app/theme_mode.dart';
import '../../../core/format/dates.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/icons/iconsax.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_akun.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
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
    final scheme = Theme.of(context).colorScheme;
    final p = ref.watch(currentProfileProvider);
    final account = ref.watch(accountProfileProvider);
    final device = ref.watch(deviceIdentityProvider);
    final push = ref.watch(pushServiceProvider);
    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          _ProfileHero(profile: p),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // User 2026-10-19: the web avatar menu, 1:1 (own signature; 2FA status → web page).
                if (p != null)
                  PkMenuGroup(
                    title: t.akunGroupAccount,
                    children: [
                      // MC3: every PT membership with its roles; several PTs → the switcher opens from here too.
                      if (account != null && account.companies.isNotEmpty)
                        PkMenuRow(
                          key: const Key('profile-companies'),
                          icon: Icons.business_outlined,
                          title: t.profileCompanies,
                          subtitle: [for (final c in account.companies) t.profileCompanyRoles(c.code, c.roleLabels)]
                              .join('\n'),
                          trailing: account.isMultiCompany
                              ? PkPill(
                                  label: companySelectionLabel(t, account, ref.watch(companySelectionProvider)),
                                  tone: PkTone.info,
                                )
                              : null,
                          onTap: account.isMultiCompany ? () => showCompanySwitcherSheet(context) : null,
                        ),
                      if (p.employee != null)
                        PkMenuRow(
                          icon: Icons.work_outline,
                          tone: PkTone.neutral,
                          title: t.profileEmployee,
                          subtitle: '${p.employee!.code} — ${p.employee!.name}',
                        ),
                      PkMenuRow(
                        key: const Key('profile-account'),
                        icon: Icons.draw_outlined,
                        title: t.accountTitle,
                        subtitle: t.accountSubtitle,
                        onTap: () => context.push('/account'),
                      ),
                      PkMenuRow(
                        key: const Key('profile-security'),
                        icon: Icons.shield_outlined,
                        tone: PkTone.ok,
                        title: t.securityTitle,
                        subtitle: t.security2faTitle,
                        onTap: () => context.push('/security'),
                      ),
                    ],
                  ),
                PkMenuGroup(
                  title: t.akunGroupApp,
                  children: [
                    // User 2026-10-18: the offline sync queue (formerly a bottom-bar tab) lives here.
                    if (p != null && (p.canCreateRequests || p.hasOwnAttendance)) const _QueueTile(),
                    // ADR 0018 (Q-46): re-read the employee privacy notice; status = the server's acknowledgement
                    PkMenuRow(
                      key: const Key('profile-privacy'),
                      icon: Icons.privacy_tip_outlined,
                      title: t.privacyTitle,
                      subtitle: _privacySubtitle(t, account?.privacy, account?.timezone),
                      onTap: () => context.push('$privacyRoute?from=profile'),
                    ),
                    if (!push.available)
                      PkMenuRow(icon: Icons.notifications_off_outlined, tone: PkTone.warn, title: t.pushDisabled),
                    PkMenuRow(
                      icon: Icons.info_outline,
                      tone: PkTone.neutral,
                      title: t.profileVersion,
                      subtitle: device.appVersion,
                    ),
                    PkMenuRow(
                      icon: Icons.phone_android,
                      tone: PkTone.neutral,
                      title: t.profileDevice,
                      subtitle: device.deviceId.substring(0, 8),
                    ),
                  ],
                ),
                const _AppearanceSetting(),
                const SizedBox(height: 20),
                OutlinedButton.icon(
                  key: const Key('logout-button'),
                  onPressed: _loggingOut ? null : _logout,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: scheme.error,
                    backgroundColor: context.pk.card,
                    side: BorderSide(color: context.pk.border),
                    minimumSize: const Size.fromHeight(52),
                  ),
                  icon: _loggingOut
                      ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.logout),
                  label: Text(_loggingOut ? t.logoutInProgress : t.logout),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// D2510 (Banani "AppSideMenu" header): hero band with the page title, avatar, name, email and the role pill.
class _ProfileHero extends StatelessWidget {
  const _ProfileHero({required this.profile});
  final UserProfile? profile;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final pk = context.pk;
    final p = profile;
    return PkHeroHeader(
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            t.profileTitle,
            style: theme.textTheme.titleLarge?.copyWith(color: pk.onHero, fontSize: 20, letterSpacing: -0.2),
          ),
          if (p != null) ...[
            const SizedBox(height: 18),
            Row(
              children: [
                PkAvatar(name: p.displayName, size: 56, onHero: true),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        p.displayName,
                        style: theme.textTheme.titleMedium?.copyWith(
                          color: pk.onHero,
                          fontWeight: FontWeight.w700,
                          fontSize: 18,
                        ),
                      ),
                      if (p.email.isNotEmpty)
                        Text(
                          p.email,
                          style: theme.textTheme.bodySmall?.copyWith(color: pk.onHero.withValues(alpha: 0.8)),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            if (p.roleLabels.isNotEmpty) ...[
              const SizedBox(height: 14),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [PkHeroPill(label: p.roleLabels, icon: Icons.verified_user, strong: true)],
              ),
            ],
          ],
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
    return PkCard(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const PkIconChip(icon: PkIcons.sun, tone: PkTone.warn, size: 38),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      t.profileAppearance,
                      style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700, fontSize: 15),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      t.profileAppearanceHint,
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
            ],
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
    return PkMenuRow(
      key: const Key('profile-queue'),
      icon: PkIcons.queue,
      tone: (c?.attention ?? 0) > 0 ? PkTone.warn : PkTone.info,
      title: t.navQueue,
      subtitle: n == 0 ? t.profileQueueEmpty : t.profileQueueCount(n),
      badge: c?.attention ?? 0,
      onTap: () => context.push('/queue'),
    );
  }
}
