import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/module_tile.dart';
import '../../addendum/presentation/addendum_providers.dart';
import '../../app_config/application/app_config_providers.dart';
import '../../app_config/domain/app_config.dart';
import '../../app_config/presentation/release_notes.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../companies/presentation/company_switcher.dart';
import '../../companies/presentation/unassigned_screen.dart';
import '../../finance/application/finance_providers.dart';
import '../../notifications/application/notifications_providers.dart';
import '../../notifications/presentation/notifications_screen.dart';
import '../application/menu_providers.dart';
import 'module_landing_screen.dart';

/// Beranda = the web launcher (user 2026-10-18): greeting, warnings and one tile per web module (`GET /me/modules`, same
/// visibility as `/admin`); a tile opens the module's landing page, or its only item directly. The role KPIs moved to
/// the Dashboard tab (dashboard_screen.dart).
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final profile = ref.watch(currentProfileProvider);
    if (profile == null) return const SizedBox.shrink();
    final gate = ref.watch(versionGateProvider);
    final appConfig = ref.watch(appConfigProvider).value;
    final latest = appConfig?.latestAppVersion;
    final menu = ref.watch(menuProvider);
    final local = ref.watch(localMenuBadgesProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(t.appTitle),
        actions: [
          // MC3: PT switcher (static code with one PT, nothing before MC3).
          const CompanySwitcherButton(),
          const NotificationBell(),
          if (!ref.watch(appEnvProvider).isProd)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Center(child: StagingBadge(label: t.stagingBadge)),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await ref.read(authControllerProvider.notifier).refreshProfile();
          ref.invalidate(menuProvider);
          ref.invalidate(notificationsProvider);
          if (profile.hasApprovalInbox) {
            ref.invalidate(inboxProvider);
            ref.invalidate(addendumInboxProvider);
          }
          if (profile.hasFinanceMenu) ref.invalidate(transferQueueProvider);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
          children: [
            _Greeting(
              name: profile.displayName,
              // MC3 (wireframe §1b): "Direktur · DRMS   Finance · CS1" when the scope spans several PTs.
              roles: profile.showCompanyChips
                  ? [
                      for (final c in profile.scopedCompanies)
                        if (c.roles.isNotEmpty) '${c.roleLabels} · ${c.code}',
                    ].join('   ')
                  : profile.roleLabels,
            ),
            UnassignedBanner(onOpen: () => context.push('/companies/unassigned')),
            if (ref.watch(integrityReportProvider).value?.risky ?? false)
              Card(
                key: const Key('integrity-warning'),
                color: Theme.of(context).colorScheme.errorContainer,
                child: ListTile(
                  leading: Icon(Icons.gpp_maybe, color: Theme.of(context).colorScheme.onErrorContainer),
                  title: Text(t.integrityWarning),
                  textColor: Theme.of(context).colorScheme.onErrorContainer,
                ),
              ),
            if (gate == VersionGate.updateAvailable && appConfig != null && latest != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: _UpdateBanner(
                  title: t.updateAvailable(latest),
                  onTap: () => showUpdateAvailableSheet(context, appConfig),
                ),
              ),
            const SizedBox(height: 20),
            _SectionTitle(t.homeMenuTitle),
            switch (menu) {
              AsyncData(:final value) when value.isEmpty => Text(t.homeMenuEmpty, key: const Key('home-menu-empty')),
              AsyncData(:final value) => ModuleGrid(
                key: const Key('home-menu'),
                children: [
                  for (final m in value)
                    ModuleTile(
                      key: Key('home-module-${m.id}'),
                      module: m.module,
                      icon: m.icon,
                      label: m.label,
                      subtitle: m.hint.isEmpty ? null : m.hint,
                      badge: _badge(m.badge + localModuleBadge(m, local)),
                      onPressed: () => openWebModule(context, m),
                    ),
                ],
              ),
              AsyncError() => Text(t.homeMenuEmpty),
              _ => const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(child: CircularProgressIndicator()),
              ),
            },
          ],
        ),
      ),
    );
  }

  static String? _badge(int n) => n > 0 ? '$n' : null;
}

/// "Versi baru tersedia" on home (primary tint, like the role pill) → sheet with release notes + link.
class _UpdateBanner extends StatelessWidget {
  const _UpdateBanner({required this.title, required this.onTap});
  final String title;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Card(
      key: const Key('update-available-banner'),
      margin: EdgeInsets.zero,
      color: Color.alphaBlend(
        scheme.primary.withValues(alpha: theme.brightness == Brightness.dark ? 0.18 : 0.08),
        scheme.surfaceContainerLow,
      ),
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        onTap: onTap,
        leading: Icon(Icons.system_update, color: scheme.primary),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(AppLocalizations.of(context).updateAvailableTap),
        trailing: const Icon(Icons.chevron_right),
      ),
    );
  }
}

/// Web launcher head: greeting + role pill (primary tint).
class _Greeting extends StatelessWidget {
  const _Greeting({required this.name, required this.roles});
  final String name;
  final String roles;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(AppLocalizations.of(context).greeting(name), style: theme.textTheme.headlineSmall),
        if (roles.isNotEmpty) ...[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: scheme.primary.withValues(alpha: theme.brightness == Brightness.dark ? 0.18 : 0.10),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              roles,
              key: const Key('home-roles'),
              style: theme.textTheme.labelMedium?.copyWith(color: scheme.primary, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ],
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Text(text, style: Theme.of(context).textTheme.titleMedium),
  );
}
