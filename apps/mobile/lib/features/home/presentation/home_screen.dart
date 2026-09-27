import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/big_action_button.dart';
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

/// Role home: KPI summary (Direktur / Finance, US-27; PM team monitor, US-17) above big action buttons.
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
        BigActionButton(
          key: const Key('home-inbox'),
          icon: Icons.fact_check,
          label: t.actionInbox,
          badge: inboxCount == null || inboxCount == 0 ? null : '$inboxCount',
          subtitle: inboxCount == null ? null : t.inboxCount(inboxCount),
          onPressed: () => context.go('/inbox'),
        ),
      if (profile.canCreateRequests) ...[
        BigActionButton(
          key: const Key('home-new-advance'),
          icon: Icons.payments,
          label: t.actionNewAdvance,
          onPressed: () => context.push('/drafts/new?type=${RequestType.advance.code}'),
        ),
        BigActionButton(
          key: const Key('home-new-reimburse'),
          icon: Icons.receipt,
          label: t.actionNewReimburse,
          onPressed: () => context.push('/drafts/new?type=${RequestType.reimburse.code}'),
        ),
      ],
      BigActionButton(
        icon: Icons.list_alt,
        label: kind == HomeKind.direktur || kind == HomeKind.finance ? t.actionAllRequests : t.actionMyRequests,
        onPressed: () => context.go('/requests'),
      ),
      if (profile.canReadProgress)
        BigActionButton(
          key: const Key('home-progress'),
          icon: Icons.construction,
          label: profile.canCreateProgress ? t.actionProgress : t.actionProgressRead,
          subtitle: openProgress > 0 ? t.progressPendingCount(openProgress) : null,
          badge: openProgress > 0 ? '$openProgress' : null,
          onPressed: () => context.push('/progress'),
        ),
      // E5 Addendum RAB: PM creates (team projects), Direktur/Finance follow all (decisions via the inbox).
      if (profile.has(Role.pm) || profile.hasApprovalInbox)
        BigActionButton(
          key: const Key('home-addenda'),
          icon: Icons.request_quote,
          label: t.addendumTitle,
          subtitle: addendumInbox > 0 ? t.addendumWaitingCount(addendumInbox) : null,
          onPressed: () => context.push('/addenda'),
        ),
      // E6: the recap (own month) and "Tim hari ini" are online reads and stay available when the company
      // setting "Absensi dari APK" is off; only check-in / on-behalf follow the flag.
      if (profile.hasOwnAttendance || profile.canSeeTeamAttendance)
        BigActionButton(
          key: const Key('home-attendance'),
          icon: Icons.fingerprint,
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
              child: Chip(label: Text(t.stagingBadge)),
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
          padding: const EdgeInsets.all(16),
          children: [
            Text(t.greeting(profile.displayName), style: Theme.of(context).textTheme.titleLarge),
            if (ref.watch(integrityReportProvider).value?.risky ?? false)
              Card(
                key: const Key('integrity-warning'),
                color: Theme.of(context).colorScheme.errorContainer,
                child: ListTile(leading: const Icon(Icons.gpp_maybe), title: Text(t.integrityWarning)),
              ),
            if (gate == VersionGate.updateAvailable && latest != null)
              Padding(padding: const EdgeInsets.only(top: 8), child: Text(t.updateAvailable(latest))),
            const SizedBox(height: 16),
            if (kpis != null) ...[
              Text(
                kind == HomeKind.pm || kind == HomeKind.staff ? t.kpiTeamTitle : t.kpiSummaryTitle,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              kpis,
              const SizedBox(height: 8),
              Text(t.homeActionsTitle, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
            ],
            for (final a in actions) Padding(padding: const EdgeInsets.only(bottom: 12), child: a),
            if (profile.has(Role.pm) || profile.has(Role.owner)) ...[
              const SizedBox(height: 4),
              const ProjectProgressSummary(),
            ],
          ],
        ),
      ),
    );
  }
}
