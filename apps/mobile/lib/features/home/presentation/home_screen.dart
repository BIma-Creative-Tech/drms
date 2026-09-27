import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../app/theme.dart';
import '../../../shared/icons/iconsax.dart';
import '../../../shared/widgets/module_tile.dart';
import '../../addendum/presentation/addendum_providers.dart';
import '../../app_config/application/app_config_providers.dart';
import '../../app_config/domain/app_config.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../../dashboard/presentation/kpi_home.dart';
import '../../expense/domain/request_status.dart';
import '../../notifications/application/notifications_providers.dart';
import '../../notifications/presentation/notifications_screen.dart';
import '../../progress/application/progress_providers.dart';
import '../../progress/presentation/widgets/project_progress_summary.dart';

/// Role home: KPI summary (Direktur / Finance, US-27; PM team monitor, US-17) above the module launcher
/// (gradient tiles in the web admin look, ADR 0015). Visibility rules, badges and routes per tile are
/// unchanged from the former big action buttons; the tile keys (`home-inbox`, …) are kept for tests.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final profile = ref.watch(currentProfileProvider);
    if (profile == null) return const SizedBox.shrink();
    final gate = ref.watch(versionGateProvider);
    final latest = ref.watch(appConfigProvider).value?.latestAppVersion;
    final kind = profile.homeKind;
    final attendanceOn = ref.watch(appConfigProvider).value?.syncAttendance ?? false;
    final openProgress = profile.canReadProgress ? (ref.watch(openProgressDraftsProvider).value?.length ?? 0) : 0;
    final expenseInbox = profile.hasApprovalInbox ? ref.watch(inboxProvider).value?.items.length : null;
    final addendumInbox = profile.hasApprovalInbox ? (ref.watch(addendumInboxProvider).value?.length ?? 0) : 0;
    final inboxCount = expenseInbox == null ? null : expenseInbox + addendumInbox;

    final actions = <Widget>[
      if (profile.hasApprovalInbox)
        ModuleTile(
          key: const Key('home-inbox'),
          module: PkModule.persetujuan,
          icon: PkIcons.approval,
          label: t.actionInbox,
          badge: inboxCount == null || inboxCount == 0 ? null : '$inboxCount',
          subtitle: inboxCount == null ? null : t.inboxCount(inboxCount),
          onPressed: () => context.go('/inbox'),
        ),
      if (profile.canCreateRequests) ...[
        ModuleTile(
          key: const Key('home-new-advance'),
          module: PkModule.keuangan,
          icon: PkIcons.advance,
          label: t.actionNewAdvance,
          onPressed: () => context.push('/drafts/new?type=${RequestType.advance.code}'),
        ),
        ModuleTile(
          key: const Key('home-new-reimburse'),
          module: PkModule.keuangan,
          icon: PkIcons.reimburse,
          label: t.actionNewReimburse,
          onPressed: () => context.push('/drafts/new?type=${RequestType.reimburse.code}'),
        ),
      ],
      ModuleTile(
        key: const Key('home-requests'),
        module: PkModule.laporan,
        icon: PkIcons.requests,
        label: kind == HomeKind.direktur || kind == HomeKind.finance ? t.actionAllRequests : t.actionMyRequests,
        onPressed: () => context.go('/requests'),
      ),
      if (profile.canReadProgress)
        ModuleTile(
          key: const Key('home-progress'),
          module: PkModule.proyek,
          icon: PkIcons.progress,
          label: profile.canCreateProgress ? t.actionProgress : t.actionProgressRead,
          subtitle: openProgress > 0 ? t.progressPendingCount(openProgress) : null,
          badge: openProgress > 0 ? '$openProgress' : null,
          onPressed: () => context.push('/progress'),
        ),
      // E5 Addendum RAB: PM creates (team projects), Direktur/Finance follow all (decisions via the inbox).
      if (profile.has(Role.pm) || profile.hasApprovalInbox)
        ModuleTile(
          key: const Key('home-addenda'),
          module: PkModule.proyek,
          icon: PkIcons.addendum,
          label: t.addendumTitle,
          subtitle: addendumInbox > 0 ? t.addendumWaitingCount(addendumInbox) : null,
          onPressed: () => context.push('/addenda'),
        ),
      // E6: the recap (own month) and "Tim hari ini" are online reads and stay available when the company
      // setting "Absensi dari APK" is off; only check-in / on-behalf follow the flag.
      if (profile.hasOwnAttendance || profile.canSeeTeamAttendance)
        ModuleTile(
          key: const Key('home-attendance'),
          module: PkModule.absensi,
          icon: PkIcons.attendance,
          label: t.actionAttendance,
          subtitle: profile.hasOwnAttendance
              ? (attendanceOn ? t.actionAttendanceSub : t.actionAttendanceOffSub)
              : t.actionAttendanceTeamSub,
          onPressed: () => context.push(profile.hasOwnAttendance ? '/attendance' : '/attendance?tab=team'),
        ),
    ];
    final kpis = switch (kind) {
      HomeKind.direktur => const DirekturKpis(),
      HomeKind.finance => const FinanceKpis(),
      _ when profile.hasTeamMonitor => const PmTeamKpis(),
      _ => null,
    };

    return Scaffold(
      appBar: AppBar(
        title: Text(t.appTitle),
        actions: [
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
          ref.invalidate(inboxProvider);
          ref.invalidate(addendumInboxProvider);
          ref.invalidate(notificationsProvider);
          ref.invalidate(direkturDashboardProvider);
          ref.invalidate(financeDashboardProvider);
          ref.invalidate(pmDashboardProvider);
          ref.invalidate(projectProgressProvider);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
          children: [
            _Greeting(name: profile.displayName, roles: profile.roleLabels),
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
            if (gate == VersionGate.updateAvailable && latest != null)
              Padding(padding: const EdgeInsets.only(top: 8), child: Text(t.updateAvailable(latest))),
            const SizedBox(height: 20),
            // Launcher tiles first so every role reaches its menu without scrolling (user decision 2026-09-27).
            if (kpis != null) _SectionTitle(t.homeActionsTitle),
            ModuleGrid(children: actions),
            if (kpis != null) ...[
              const SizedBox(height: 20),
              _SectionTitle(kind == HomeKind.pm || kind == HomeKind.staff ? t.kpiTeamTitle : t.kpiSummaryTitle),
              kpis,
            ],
            if (profile.has(Role.pm) || profile.has(Role.owner)) ...[
              const SizedBox(height: 20),
              const ProjectProgressSummary(),
            ],
          ],
        ),
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
