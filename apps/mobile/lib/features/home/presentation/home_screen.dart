import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/theme.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/icons/iconsax.dart';
import '../../../shared/widgets/module_tile.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../addendum/presentation/addendum_providers.dart';
import '../../app_config/application/app_config_providers.dart';
import '../../app_config/domain/app_config.dart';
import '../../app_config/presentation/release_notes.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../approvals/data/approvals_api.dart' show Decision;
import '../../approvals/presentation/decision_sheet.dart' show quickDecision;
import '../../approvals/presentation/inbox_screen.dart' show inboxStepLabel;
import '../../auth/application/auth_controller.dart';
import '../../auth/domain/user_profile.dart';
import '../../companies/application/company_selection.dart';
import '../../companies/presentation/company_switcher.dart';
import '../../companies/presentation/unassigned_screen.dart';
import '../../dashboard/domain/dashboard.dart' show share;
import '../../dashboard/presentation/charts.dart' show formatRupiahShort, pctText;
import '../../dashboard/presentation/dashboard_screen.dart' show DashboardRole, dashboardRolesOf;
import '../../dashboard/presentation/kpi_home.dart';
import '../../expense/domain/expense_request.dart' show InboxItem;
import '../../expense/domain/request_status.dart';
import '../../finance/application/finance_providers.dart';
import '../../notifications/application/notifications_providers.dart';
import '../../notifications/presentation/notifications_screen.dart';
import '../../progress/application/progress_providers.dart';
import '../../progress/domain/progress.dart';
import '../../progress/presentation/widgets/progress_widgets.dart' show ProjectProgressCompactCard;
import '../application/menu_providers.dart';
import 'module_landing_screen.dart';

/// Beranda (D2510, Banani reference "Dashboard Home", user 2026-10-25 — supersedes the launcher-only home of
/// 2026-10-18): hero band (PT, greeting, role), the role summary with its two main actions, quick actions, KPI tiles,
/// projects that need attention, cash accounts, the latest approvals with Setujui / Tolak, then one tile per web module
/// (`GET /me/modules`). Every server block hides itself while loading or on error, so the menu always works offline.
/// The Dashboard tab keeps the full role charts (dashboard_screen.dart).
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
    final views = dashboardRolesOf(profile);
    final role = views.isEmpty ? null : views.first;
    final pk = context.pk;

    return Scaffold(
      body: RefreshIndicator(
        edgeOffset: MediaQuery.paddingOf(context).top,
        onRefresh: () async {
          await ref.read(authControllerProvider.notifier).refreshProfile();
          ref.invalidate(menuProvider);
          ref.invalidate(notificationsProvider);
          if (profile.hasApprovalInbox) {
            ref.invalidate(inboxProvider);
            ref.invalidate(addendumInboxProvider);
          }
          if (profile.hasFinanceMenu) ref.invalidate(transferQueueProvider);
          if (profile.canReadProgress) ref.invalidate(projectProgressProvider);
          switch (role) {
            case DashboardRole.direktur:
              ref.invalidate(direkturDashboardProvider);
            case DashboardRole.finance:
              ref.invalidate(financeDashboardProvider);
            case DashboardRole.pm:
              ref.invalidate(pmDashboardProvider);
            case DashboardRole.staff:
              ref.invalidate(staffDashboardProvider);
            case DashboardRole.admin:
              ref.invalidate(adminDashboardProvider);
            case null:
              break;
          }
        },
        child: ListView(
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            _HomeHero(profile: profile),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  UnassignedBanner(onOpen: () => context.push('/companies/unassigned')),
                  if (ref.watch(integrityReportProvider).value?.risky ?? false)
                    PkCard(
                      key: const Key('integrity-warning'),
                      color: pk.badBg,
                      margin: const EdgeInsets.only(bottom: 12),
                      child: Row(
                        children: [
                          Icon(Icons.gpp_maybe, color: pk.badOn),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(t.integrityWarning, style: TextStyle(color: pk.badOn)),
                          ),
                        ],
                      ),
                    ),
                  if (gate == VersionGate.updateAvailable && appConfig != null && latest != null)
                    _UpdateBanner(
                      title: t.updateAvailable(latest),
                      onTap: () => showUpdateAvailableSheet(context, appConfig),
                    ),
                  if (role != null) _RoleSummary(role: role, profile: profile),
                  _QuickActionRow(profile: profile),
                  if (role != null) _RoleKpis(role: role),
                  if (profile.canReadProgress) const _ProjectsSection(),
                  if (role == DashboardRole.direktur || role == DashboardRole.finance) _AccountsSection(role: role!),
                  if (profile.hasApprovalInbox) const _ApprovalsSection(),
                  PkSectionHeader(title: t.homeMenuTitle),
                  switch (menu) {
                    AsyncData(:final value) when value.isEmpty => Text(
                      t.homeMenuEmpty,
                      key: const Key('home-menu-empty'),
                    ),
                    AsyncData(:final value) => ModuleGrid(
                      key: const Key('home-menu'),
                      compact: true,
                      children: [
                        for (final m in value)
                          ModuleTile(
                            key: Key('home-module-${m.id}'),
                            module: m.module,
                            icon: m.icon,
                            label: m.label,
                            subtitle: m.hint.isEmpty ? null : m.hint,
                            badge: _badge(m.badge + localModuleBadge(m, local)),
                            compact: true,
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
          ],
        ),
      ),
    );
  }

  static String? _badge(int n) => n > 0 ? '$n' : null;
}

/// Hero band: PT block (opens the PT switcher with several PTs), bell, avatar; greeting; role + staging pills.
class _HomeHero extends ConsumerWidget {
  const _HomeHero({required this.profile});
  final UserProfile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final pk = context.pk;
    final account = ref.watch(accountProfileProvider);
    final companies = account?.companies ?? const [];
    final multi = account?.isMultiCompany ?? false;
    final ptLabel = companies.isEmpty
        ? t.appTitle
        : multi
        ? companySelectionLabel(t, account!, ref.watch(companySelectionProvider))
        : companies.single.name;
    final ptCode = companies.isEmpty ? t.appTitle : (multi ? ptLabel : companies.single.code);
    // MC3 (wireframe §1b): "Direktur · DRMS   Finance · CS1" when the scope spans several PTs.
    final roles = profile.showCompanyChips
        ? [
            for (final c in profile.scopedCompanies)
              if (c.roles.isNotEmpty) '${c.roleLabels} · ${c.code}',
          ].join('   ')
        : profile.roleLabels;

    final ptBlock = Row(
      children: [
        Container(
          width: 42,
          height: 42,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: pk.heroPill, borderRadius: BorderRadius.circular(PkRadius.md)),
          child: Text(
            ptCode.isEmpty ? 'R' : ptCode.characters.first.toUpperCase(),
            style: TextStyle(
              fontFamily: PkFonts.heading,
              fontWeight: FontWeight.w700,
              fontSize: 18,
              color: pk.onHeroPill,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Text(
                      ptLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleMedium?.copyWith(color: pk.onHero, fontWeight: FontWeight.w700),
                    ),
                  ),
                  if (multi) Icon(Icons.unfold_more, size: 18, color: pk.onHero),
                ],
              ),
              if (ptLabel != t.appTitle)
                Text(t.appTitle, style: theme.textTheme.bodySmall?.copyWith(color: pk.onHero.withValues(alpha: 0.75))),
            ],
          ),
        ),
      ],
    );

    return PkHeroHeader(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: companies.isEmpty
                    ? ptBlock
                    : multi
                    ? InkWell(
                        key: const Key('pt-switcher'),
                        borderRadius: BorderRadius.circular(PkRadius.md),
                        onTap: () => showCompanySwitcherSheet(context),
                        child: ptBlock,
                      )
                    : Tooltip(key: const Key('pt-switcher-static'), message: companies.single.name, child: ptBlock),
              ),
              const SizedBox(width: 8),
              const NotificationBell(onHero: true),
              const SizedBox(width: 8),
              PkAvatar(name: profile.displayName, size: 40, onHero: true),
            ],
          ),
          const SizedBox(height: 18),
          Text(
            t.greeting(profile.displayName),
            style: theme.textTheme.headlineSmall?.copyWith(color: pk.onHero, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (roles.isNotEmpty)
                PkHeroPill(key: const Key('home-roles'), label: roles, icon: Icons.verified_user, strong: true),
              if (!ref.watch(appEnvProvider).isProd) PkHeroPill(label: t.stagingBadge, dot: true),
            ],
          ),
        ],
      ),
    );
  }
}

/// "Versi baru tersedia" (soft info card) → sheet with release notes + link.
class _UpdateBanner extends StatelessWidget {
  const _UpdateBanner({required this.title, required this.onTap});
  final String title;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return PkCard(
      key: const Key('update-available-banner'),
      onTap: onTap,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
      child: Row(
        children: [
          const PkIconChip(icon: Icons.system_update, size: 38),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                Text(
                  AppLocalizations.of(context).updateAvailableTap,
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right, color: theme.colorScheme.outline),
        ],
      ),
    );
  }
}

/// `value.let(f)`: f(value), or null while loading / on error (the block hides itself).
extension _Let<T extends Object> on T? {
  R? let<R>(R? Function(T) f) {
    final v = this;
    return v == null ? null : f(v);
  }
}

/// Summary card button: the label shrinks to fit instead of being cut ("Pengajuan Baru" on a 360 dp phone).
Widget _summaryButton(_SummaryAction a) {
  final label = FittedBox(fit: BoxFit.scaleDown, child: Text(a.label, maxLines: 1));
  final style = FilledButton.styleFrom(
    minimumSize: const Size.fromHeight(46),
    padding: const EdgeInsets.symmetric(horizontal: 12),
  );
  return a.primary
      ? FilledButton.icon(
          key: Key('home-summary-${a.label}'),
          onPressed: a.onTap,
          icon: Icon(a.icon, size: 18),
          label: label,
          style: style,
        )
      : FilledButton.tonalIcon(
          key: Key('home-summary-${a.label}'),
          onPressed: a.onTap,
          icon: Icon(a.icon, size: 18),
          label: label,
          style: style,
        );
}

class _SummaryAction {
  const _SummaryAction(this.icon, this.label, this.onTap, {this.primary = false});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool primary;
}

typedef _Summary = ({String label, String value, String? sub, Color? subColor, List<_SummaryAction> actions});

/// The role's headline figure with its two main actions (Banani "BalanceHero").
class _RoleSummary extends ConsumerWidget {
  const _RoleSummary({required this.role, required this.profile});
  final DashboardRole role;
  final UserProfile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final pk = context.pk;
    void newRequest() => context.push('/drafts/new?type=${RequestType.advance.code}');
    final canRequest = profile.canCreateRequests;
    final _Summary? s = switch (role) {
      DashboardRole.direktur =>
        ref
            .watch(direkturDashboardProvider)
            .value
            .let<_Summary>(
              (d) => (
                label: t.kpiCashTotal,
                value: formatRupiah(d.cashTotal),
                sub: t.kpiMonthInOut(formatRupiahShort(d.monthIn), formatRupiahShort(d.monthOut)),
                subColor: pk.okText,
                actions: [
                  if (canRequest) _SummaryAction(Icons.add, t.actionNewAdvance, newRequest, primary: true),
                  if (profile.hasApprovalInbox)
                    _SummaryAction(Icons.fact_check_outlined, t.navInbox, () => context.go('/inbox')),
                ],
              ),
            ),
      DashboardRole.finance =>
        ref
            .watch(financeDashboardProvider)
            .value
            .let<_Summary>(
              (d) => (
                label: t.kpiCashTotal,
                value: formatRupiah(d.cashTotal),
                sub: t.homeTransferWaiting(d.transferCount),
                subColor: d.transferOverdue > 0 ? pk.warnText : pk.okText,
                actions: [
                  _SummaryAction(Icons.send, t.navTransfer, () => context.go('/tab/transfer'), primary: true),
                  _SummaryAction(Icons.description_outlined, t.navRequests, () => context.go('/requests')),
                ],
              ),
            ),
      DashboardRole.pm =>
        ref
            .watch(pmDashboardProvider)
            .value
            .let<_Summary>(
              (d) => d.hasScope
                  ? (
                      label: t.kpiTeamMonth,
                      value: formatRupiah(d.teamSum),
                      sub: t.kpiTeamWaiting(d.teamWaiting),
                      subColor: d.teamWaiting > 0 ? pk.warnText : pk.okText,
                      actions: [
                        if (canRequest) _SummaryAction(Icons.add, t.actionNewAdvance, newRequest, primary: true),
                        if (profile.hasApprovalInbox)
                          _SummaryAction(Icons.fact_check_outlined, t.navInbox, () => context.go('/inbox'))
                        else
                          _SummaryAction(Icons.description_outlined, t.navRequests, () => context.go('/requests')),
                      ],
                    )
                  : null,
            ),
      DashboardRole.staff =>
        ref
            .watch(staffDashboardProvider)
            .value
            .let<_Summary>(
              (d) => (
                label: t.kpiMyActions,
                value: formatDecimal(d.actions),
                sub: d.actions == 0 ? t.kpiMyActionsNone : t.kpiMyActionsHint,
                subColor: d.actions == 0 ? pk.okText : pk.warnText,
                actions: [
                  if (canRequest) _SummaryAction(Icons.add, t.actionNewAdvance, newRequest, primary: true),
                  _SummaryAction(Icons.description_outlined, t.navRequests, () => context.go('/requests')),
                ],
              ),
            ),
      DashboardRole.admin => null,
    };
    if (s == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    return PkCard(
      key: const Key('home-summary'),
      radius: PkRadius.lg,
      margin: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            s.label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 4),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              s.value,
              key: const Key('home-summary-value'),
              style: theme.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.5),
            ),
          ),
          if (s.sub case final sub?)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                sub,
                style: theme.textTheme.labelMedium?.copyWith(color: s.subColor, fontWeight: FontWeight.w700),
              ),
            ),
          if (s.actions.isNotEmpty) ...[
            const SizedBox(height: 14),
            Row(
              children: [
                for (final (i, a) in s.actions.indexed) ...[
                  if (i > 0) const SizedBox(width: 10),
                  Expanded(child: _summaryButton(a)),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// Up to four shortcuts for the role (Banani "QuickActions").
class _QuickActionRow extends ConsumerWidget {
  const _QuickActionRow({required this.profile});
  final UserProfile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final inbox = profile.hasApprovalInbox ? ref.watch(inboxProvider).value?.items.length ?? 0 : 0;
    final transfer = profile.hasFinanceMenu ? ref.watch(transferQueueProvider).value?.length ?? 0 : 0;
    final actions = <Widget>[
      if (profile.hasApprovalInbox)
        PkQuickAction(
          key: const Key('quick-inbox'),
          icon: PkIcons.approval,
          label: t.navInbox,
          badge: inbox,
          onTap: () => context.go('/inbox'),
        ),
      if (profile.hasFinanceMenu)
        PkQuickAction(
          key: const Key('quick-transfer'),
          icon: PkIcons.finance,
          label: t.navTransfer,
          badge: transfer,
          onTap: () => context.go('/tab/transfer'),
        ),
      if (profile.canCreateRequests) ...[
        PkQuickAction(
          key: const Key('quick-advance'),
          icon: PkIcons.advance,
          label: t.actionNewAdvance,
          onTap: () => context.push('/drafts/new?type=${RequestType.advance.code}'),
        ),
        PkQuickAction(
          key: const Key('quick-reimburse'),
          icon: PkIcons.reimburse,
          label: t.actionNewReimburse,
          onTap: () => context.push('/drafts/new?type=${RequestType.reimburse.code}'),
        ),
      ],
      if (profile.canCreateProgress)
        PkQuickAction(
          key: const Key('quick-progress'),
          icon: PkIcons.progress,
          label: t.progressTitle,
          onTap: () => context.push('/progress'),
        ),
      if (profile.hasFieldReports)
        PkQuickAction(
          key: const Key('quick-field'),
          icon: PkIcons.report,
          label: t.fieldHubTitle,
          onTap: () => context.push('/field'),
        ),
      if (profile.hasOwnAttendance)
        PkQuickAction(
          key: const Key('quick-attendance'),
          icon: PkIcons.attendance,
          label: t.navAttendance,
          onTap: () => context.push('/attendance'),
        ),
      if (profile.canSeeProjects)
        PkQuickAction(
          key: const Key('quick-projects'),
          icon: PkIcons.project,
          label: t.projectsTitle,
          onTap: () => context.push('/projects'),
        ),
    ];
    if (actions.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: PkQuickActions(key: const Key('home-quick-actions'), children: actions.take(4).toList()),
    );
  }
}

/// Up to four KPI tiles of the role (Banani "KpiGrid"); the full set + charts stay in the Dashboard tab.
class _RoleKpis extends ConsumerWidget {
  const _RoleKpis({required this.role});
  final DashboardRole role;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final pk = context.pk;
    final List<Widget>? tiles = switch (role) {
      DashboardRole.direktur =>
        ref
            .watch(direkturDashboardProvider)
            .value
            .let<List<Widget>>(
              (d) => [
                PkKpiTile(
                  icon: Icons.pending_actions,
                  tone: d.waitingCount > 0 ? PkTone.bad : PkTone.ok,
                  label: t.kpiWaiting,
                  value: formatDecimal(d.waitingCount),
                  sub: t.kpiWaitingForMe(d.waitingForMe),
                  onTap: () => context.go('/inbox'),
                ),
                PkKpiTile(
                  icon: Icons.send,
                  label: t.kpiDisbursedMonth,
                  value: formatRupiahShort(d.disbursed.isEmpty ? 0 : d.disbursed.last.value),
                ),
                PkKpiTile(
                  icon: Icons.track_changes,
                  tone: d.budgetOver > 0 ? PkTone.warn : PkTone.ok,
                  label: t.kpiBudgetRealized,
                  value: pctText(share(d.budgetTotals.realized, d.budgetTotals.budget)),
                  sub: d.budgetOver > 0 || d.budgetWarn > 0 ? t.kpiBudgetAlerts(d.budgetOver, d.budgetWarn) : null,
                  subColor: pk.warnText,
                ),
                PkKpiTile(
                  icon: Icons.receipt_long_outlined,
                  tone: d.completeness.overdue > 0 ? PkTone.warn : PkTone.info,
                  label: t.kpiCompletenessTitle,
                  value: pctText(share(d.completeness.ratioDone, d.completeness.ratioTotal)),
                  sub: d.completeness.overdue > 0
                      ? t.kpiCompletenessOverdue(d.completeness.overdue)
                      : t.kpiCompletenessNoneOverdue,
                  subColor: d.completeness.overdue > 0 ? pk.badText : null,
                ),
              ],
            ),
      DashboardRole.finance =>
        ref
            .watch(financeDashboardProvider)
            .value
            .let<List<Widget>>(
              (d) => [
                PkKpiTile(
                  icon: Icons.send,
                  tone: d.transferOverdue > 0 ? PkTone.warn : PkTone.info,
                  label: t.kpiTransferQueue,
                  value: formatDecimal(d.transferCount),
                  sub: d.transferOverdue > 0 ? t.kpiOverdue(d.transferOverdue) : t.kpiOnTime,
                  subColor: d.transferOverdue > 0 ? pk.warnText : null,
                  onTap: () => context.go('/tab/transfer'),
                ),
                PkKpiTile(
                  icon: Icons.fact_check_outlined,
                  label: t.kpiToVerify,
                  value: formatDecimal(d.lpjToVerify + d.reimburseToVerify),
                  sub: t.kpiToVerifySplit(d.lpjToVerify, d.reimburseToVerify),
                ),
                PkKpiTile(
                  icon: Icons.balance,
                  tone: PkTone.neutral,
                  label: t.kpiLpjToSettle,
                  value: formatDecimal(d.lpjToSettle),
                ),
                PkKpiTile(
                  icon: Icons.schedule,
                  tone: d.advancesOverdue > 0 ? PkTone.bad : PkTone.ok,
                  label: t.kpiCompletenessTitle,
                  value: formatDecimal(d.advancesOverdue),
                  sub: d.advancesOverdue > 0
                      ? t.kpiCompletenessOverdue(d.advancesOverdue)
                      : t.kpiCompletenessNoneOverdue,
                  subColor: d.advancesOverdue > 0 ? pk.badText : null,
                ),
              ],
            ),
      DashboardRole.pm =>
        ref
            .watch(pmDashboardProvider)
            .value
            .let<List<Widget>>(
              (d) => d.hasScope
                  ? [
                      PkKpiTile(
                        icon: Icons.groups_outlined,
                        label: t.kpiTeamMonth,
                        value: formatDecimal(d.teamCount),
                        sub: formatRupiahShort(d.teamSum),
                        onTap: () => context.go('/requests?tab=team'),
                      ),
                      PkKpiTile(
                        icon: Icons.description_outlined,
                        tone: d.lpjOverdue > 0 ? PkTone.bad : PkTone.ok,
                        label: t.kpiTeamLpj,
                        value: formatDecimal(d.withoutLpj),
                        sub: d.lpjOverdue > 0 ? t.kpiLpjOverdue(d.lpjOverdue) : t.kpiLpjNoneOverdue,
                        subColor: d.lpjOverdue > 0 ? pk.badText : null,
                      ),
                      PkKpiTile(
                        icon: Icons.track_changes,
                        tone: PkTone.warn,
                        label: t.kpiTeamBudget,
                        value: pctText(share(d.budgetTotals.realized, d.budgetTotals.budget)),
                      ),
                      PkKpiTile(
                        icon: Icons.hourglass_top,
                        tone: d.teamWaiting > 0 ? PkTone.warn : PkTone.ok,
                        label: t.kpiWaiting,
                        value: formatDecimal(d.teamWaiting),
                      ),
                    ]
                  : null,
            ),
      DashboardRole.staff =>
        ref
            .watch(staffDashboardProvider)
            .value
            .let<List<Widget>>(
              (d) => [
                PkKpiTile(
                  icon: Icons.schedule,
                  label: t.kpiMyProcess,
                  value: formatDecimal(d.inProcess),
                  sub: t.kpiMyProcessWaiting(d.waitingDecision),
                ),
                PkKpiTile(
                  icon: Icons.check_circle_outline,
                  tone: PkTone.ok,
                  label: t.kpiMyDone,
                  value: formatDecimal(d.done),
                ),
              ],
            ),
      DashboardRole.admin =>
        ref
            .watch(adminDashboardProvider)
            .value
            .let<List<Widget>>(
              (d) => [
                PkKpiTile(
                  icon: Icons.people_outline,
                  tone: d.usersIncomplete > 0 ? PkTone.warn : PkTone.ok,
                  label: t.kpiAdminUsers,
                  value: formatDecimal(d.usersIncomplete),
                ),
                PkKpiTile(
                  icon: Icons.track_changes,
                  tone: d.projectsWithoutPm > 0 ? PkTone.warn : PkTone.ok,
                  label: t.kpiAdminProjects,
                  value: formatDecimal(d.projectsWithoutPm),
                ),
              ],
            ),
    };
    if (tiles == null) return const SizedBox.shrink();
    return PkTwoColumnGrid(key: const Key('home-kpis'), children: tiles);
  }
}

/// Projects that need attention first (largest gap budget vs physical progress), up to 3 (Banani "ProjectCard").
class _ProjectsSection extends ConsumerWidget {
  const _ProjectsSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final list = ref.watch(projectProgressProvider).value;
    if (list == null || list.projects.isEmpty) return const SizedBox.shrink();
    int rank(ProgressTone tone) => switch (tone) {
      ProgressTone.bad => 0,
      ProgressTone.warn => 1,
      ProgressTone.ok => 2,
      ProgressTone.none => 3,
    };
    final sorted = [...list.projects]
      ..sort((a, b) {
        final r = rank(a.tone).compareTo(rank(b.tone));
        return r != 0 ? r : (b.gap ?? -999).compareTo(a.gap ?? -999);
      });
    return Column(
      key: const Key('home-project-progress'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PkSectionHeader(
          title: t.progressHomeTitle,
          actionLabel: t.seeAll,
          onAction: () => context.push('/progress?tab=projects'),
        ),
        for (final p in sorted.take(3))
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: ProjectProgressCompactCard(item: p, onTap: () => context.push('/progress?tab=projects')),
          ),
      ],
    );
  }
}

/// Top cash accounts by balance (Banani "CashAccounts"), Direktur / Finance.
class _AccountsSection extends ConsumerWidget {
  const _AccountsSection({required this.role});
  final DashboardRole role;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final accounts = role == DashboardRole.direktur
        ? ref.watch(direkturDashboardProvider).value?.accounts
        : ref.watch(financeDashboardProvider).value?.accounts;
    if (accounts == null || accounts.isEmpty) return const SizedBox.shrink();
    final top = [...accounts]..sort((a, b) => b.balance.compareTo(a.balance));
    return Column(
      key: const Key('home-accounts'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PkSectionHeader(title: t.homeAccountsTitle, actionLabel: t.seeAll, onAction: () => context.go('/dashboard')),
        PkCard(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (i, a) in top.take(3).indexed) ...[
                if (i > 0) const Divider(height: 1),
                Padding(
                  key: Key('home-account-${a.id}'),
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Row(
                    children: [
                      PkIconChip(
                        icon: Icons.account_balance,
                        tone: a.balance < 0 ? PkTone.bad : PkTone.neutral,
                        size: 40,
                        round: true,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(a.name, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                            if (a.code case final code?)
                              Text(
                                code,
                                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        formatRupiahShort(a.balance),
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: a.balance < 0 ? context.pk.badText : null,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              if (accounts.length > 3)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(
                    t.homeAccountsCount(accounts.length),
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// The first two requests waiting for the caller, decided right here (Banani "ApprovalItem").
class _ApprovalsSection extends ConsumerWidget {
  const _ApprovalsSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final items = ref.watch(inboxProvider).value?.items;
    if (items == null || items.isEmpty) return const SizedBox.shrink();
    return Column(
      key: const Key('home-approvals'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PkSectionHeader(
          title: t.navInbox,
          count: items.length,
          actionLabel: t.seeAll,
          onAction: () => context.go('/inbox'),
        ),
        for (final it in items.take(2))
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: ApprovalQuickCard(item: it),
          ),
      ],
    );
  }
}

/// One waiting request with inline Setujui / Tolak ([quickDecision]: the same decision sheet as the detail screen —
/// signature, fund check, confirmation and result popups); a tap elsewhere opens the detail.
class ApprovalQuickCard extends ConsumerWidget {
  const ApprovalQuickCard({super.key, required this.item});
  final InboxItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final it = item;
    final ack = it.step == 'acknowledge';
    final risky = it.budgetOverWarn || it.fundShort != null;
    return PkCard(
      key: Key('home-approval-${it.id}'),
      onTap: () => context.push('/requests/${it.id}'),
      padding: const EdgeInsets.all(14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PkAvatar(name: it.requesters, size: 40),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      it.typeLabel,
                      style: theme.textTheme.labelMedium?.copyWith(
                        color: theme.colorScheme.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    PkPill(
                      label: inboxStepLabel(t, it),
                      tone: risky ? PkTone.bad : PkTone.info,
                      icon: risky ? Icons.warning_amber_rounded : null,
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  it.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700, height: 1.3),
                ),
                const SizedBox(height: 2),
                Text(
                  [it.requesters, ?it.docNo].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton(
                        key: Key('home-approve-${it.id}'),
                        onPressed: () =>
                            quickDecision(context, ref, it.id, ack ? Decision.acknowledge : Decision.approve),
                        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(44)),
                        child: Text(ack ? t.actionAcknowledge : t.actionApprove),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton(
                        key: Key('home-reject-${it.id}'),
                        onPressed: () => quickDecision(context, ref, it.id, Decision.reject),
                        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(44)),
                        child: Text(t.actionReject),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      formatRupiahShort(it.grandTotal),
                      style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
