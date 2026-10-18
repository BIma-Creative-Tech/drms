import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../../companies/presentation/company_switcher.dart';
import '../../notifications/presentation/notifications_screen.dart';
import '../../progress/application/progress_providers.dart';
import '../../progress/presentation/widgets/project_progress_summary.dart';
import 'kpi_home.dart';

/// One role view of the dashboard (web `Dashboard.tsx` layouts: Direktur > Finance > PM > Admin > Staff).
enum DashboardRole { direktur, finance, pm, admin, staff }

/// The role views [p] may open, highest first (ADR 0026: the Owner's roles carry `pk-owner` → Direktur view).
List<DashboardRole> dashboardRolesOf(UserProfile p) => [
  if (p.has(Role.owner)) DashboardRole.direktur,
  if (p.has(Role.finance)) DashboardRole.finance,
  if (p.hasTeamMonitor) DashboardRole.pm,
  if (p.has(Role.admin)) DashboardRole.admin,
  if (p.has(Role.staff)) DashboardRole.staff,
];

/// "Dashboard" (user 2026-10-18): the role KPIs that used to sit under the Beranda tiles, in their own tab (web module
/// Dashboard, /admin/dashboard). Several roles → one tab per role view, like the web `?peran=` tabs.
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final profile = ref.watch(currentProfileProvider);
    if (profile == null) return const SizedBox.shrink();
    final views = dashboardRolesOf(profile);
    const actions = <Widget>[CompanySwitcherButton(), NotificationBell()];
    if (views.length < 2) {
      return Scaffold(
        appBar: AppBar(title: Text(t.navDashboard), actions: actions),
        body: views.isEmpty
            ? Center(child: Text(t.dashboardEmpty, key: const Key('dashboard-empty')))
            : _DashboardBody(role: views.single, profile: profile),
      );
    }
    return DefaultTabController(
      length: views.length,
      child: Scaffold(
        appBar: AppBar(
          title: Text(t.navDashboard),
          actions: actions,
          bottom: TabBar(
            isScrollable: true,
            tabs: [for (final v in views) Tab(key: Key('dashboard-tab-${v.name}'), text: _label(v))],
          ),
        ),
        body: TabBarView(
          children: [for (final v in views) _DashboardBody(role: v, profile: profile)],
        ),
      ),
    );
  }

  static String _label(DashboardRole r) => switch (r) {
    DashboardRole.direktur => Role.owner.label,
    DashboardRole.finance => Role.finance.label,
    DashboardRole.pm => Role.pm.label,
    DashboardRole.admin => Role.admin.label,
    DashboardRole.staff => Role.staff.label,
  };
}

class _DashboardBody extends ConsumerWidget {
  const _DashboardBody({required this.role, required this.profile});
  final DashboardRole role;
  final UserProfile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final kpis = switch (role) {
      DashboardRole.direktur => const DirekturKpis(),
      DashboardRole.finance => const FinanceKpis(),
      DashboardRole.pm => const PmTeamKpis(),
      DashboardRole.admin => const AdminKpis(),
      DashboardRole.staff => const StaffKpis(),
    };
    // US-12 "Progress fisik vs anggaran": the office + PM views (`GET /projects/progress`: pk-finance / pk-owner / pk-pm).
    final progress = profile.canReadProgress && role != DashboardRole.admin && role != DashboardRole.staff;
    return RefreshIndicator(
      onRefresh: () async {
        await ref.read(authControllerProvider.notifier).refreshProfile();
        switch (role) {
          case DashboardRole.direktur:
            ref.invalidate(direkturDashboardProvider);
          case DashboardRole.finance:
            ref.invalidate(financeDashboardProvider);
          case DashboardRole.pm:
            ref.invalidate(pmDashboardProvider);
          case DashboardRole.admin:
            ref.invalidate(adminDashboardProvider);
          case DashboardRole.staff:
            ref.invalidate(staffDashboardProvider);
        }
        if (progress) ref.invalidate(projectProgressProvider);
      },
      child: ListView(
        key: Key('dashboard-${role.name}'),
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Text(switch (role) {
              DashboardRole.pm => t.kpiTeamTitle,
              DashboardRole.staff => t.kpiMineTitle,
              _ => t.kpiSummaryTitle,
            }, style: Theme.of(context).textTheme.titleMedium),
          ),
          kpis,
          if (progress) ...[const SizedBox(height: 20), const ProjectProgressSummary()],
        ],
      ),
    );
  }
}
