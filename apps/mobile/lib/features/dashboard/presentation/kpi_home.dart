import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../app/theme.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../data/dashboard_api.dart';
import '../domain/dashboard.dart';
import 'charts.dart';
import 'dashboard_cards.dart';

final dashboardApiProvider = Provider((ref) => DashboardApi(ref.watch(apiClientProvider)));

final direkturDashboardProvider = FutureProvider.autoDispose<DirekturDashboard>(
  (ref) => ref.watch(dashboardApiProvider).direktur(),
);
final financeDashboardProvider = FutureProvider.autoDispose<FinanceDashboard>(
  (ref) => ref.watch(dashboardApiProvider).finance(),
);
final pmDashboardProvider = FutureProvider.autoDispose<PmDashboard>((ref) => ref.watch(dashboardApiProvider).pm());
final staffDashboardProvider = FutureProvider.autoDispose<StaffDashboard>(
  (ref) => ref.watch(dashboardApiProvider).me(),
);
final adminDashboardProvider = FutureProvider.autoDispose<AdminDashboard>(
  (ref) => ref.watch(dashboardApiProvider).admin(),
);

/// KPI card: icon + label, big value, supporting lines and an optional sparkline. Tappable when it
/// leads somewhere (whole card = one ≥ 48 dp target).
class KpiCard extends StatelessWidget {
  const KpiCard({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    this.lines = const [],
    this.footer,
    this.onTap,
    this.emphasis = false,
  });
  final IconData icon;
  final String label;
  final String value;
  final List<Widget> lines;
  final Widget? footer;
  final VoidCallback? onTap;
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Card(
      elevation: 0,
      color: emphasis ? scheme.primaryContainer : scheme.surfaceContainerLow,
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, size: 20, color: emphasis ? scheme.onPrimaryContainer : scheme.primary),
                  const SizedBox(width: 8),
                  Expanded(child: Text(label, style: theme.textTheme.labelLarge)),
                  if (onTap != null) Icon(Icons.chevron_right, size: 20, color: scheme.outline),
                ],
              ),
              const SizedBox(height: 8),
              Text(value, style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
              for (final l in lines) Padding(padding: const EdgeInsets.only(top: 4), child: l),
              if (footer != null) Padding(padding: const EdgeInsets.only(top: 8), child: footer),
            ],
          ),
        ),
      ),
    );
  }
}

/// Two cards per row on phones ≥ 360 dp wide, one per row below (large text stays readable).
class KpiGrid extends StatelessWidget {
  const KpiGrid({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, c) {
      final twoCols = c.maxWidth >= 360 && MediaQuery.textScalerOf(context).scale(16) <= 20;
      if (!twoCols) {
        return Column(
          children: [for (final w in children) Padding(padding: const EdgeInsets.only(bottom: 12), child: w)],
        );
      }
      final rows = <Widget>[];
      for (var i = 0; i < children.length; i += 2) {
        rows.add(
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(child: children[i]),
                  const SizedBox(width: 12),
                  Expanded(child: i + 1 < children.length ? children[i + 1] : const SizedBox.shrink()),
                ],
              ),
            ),
          ),
        );
      }
      return Column(children: rows);
    },
  );
}

/// MC4: compact per-PT breakdown under the KPI totals when the dashboard covers several PTs
/// (one line per PT: short code, main figure, secondary figure). Nothing for a single PT.
class CompanySplitCard extends StatelessWidget {
  const CompanySplitCard({super.key, required this.rows, required this.primary, required this.secondary});
  final List<CompanySplit> rows;
  final String Function(CompanySplit) primary;
  final String Function(CompanySplit) secondary;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    return DashSection(
      key: const Key('kpi-by-company'),
      title: AppLocalizations.of(context).kpiPerCompanyTitle,
      child: Column(
        children: [
          for (final r in rows)
            Padding(
              key: Key('kpi-company-${r.companyId}'),
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 64,
                    child: Text(
                      r.code,
                      style: theme.textTheme.labelLarge?.copyWith(
                        color: theme.colorScheme.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  Expanded(child: Text(primary(r), style: theme.textTheme.bodyMedium)),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(secondary(r), textAlign: TextAlign.end, style: theme.textTheme.bodySmall),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

Widget _small(BuildContext context, String text, {Color? color, Key? key}) => Text(
  text,
  key: key,
  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: color),
);

/// Failure of a KPI block never breaks the home (the actions below keep working).
Widget _kpiAsync<T>(AsyncValue<T> v, VoidCallback retry, Widget Function(T) data) => switch (v) {
  AsyncData(:final value) => data(value),
  AsyncError() => Card(
    child: ListTile(
      leading: const Icon(Icons.insights),
      title: Builder(builder: (c) => Text(AppLocalizations.of(c).kpiUnavailable)),
      subtitle: Builder(builder: (c) => Text(errorText((v as AsyncError).error))),
      trailing: IconButton(icon: const Icon(Icons.refresh), onPressed: retry),
    ),
  ),
  _ => const Padding(
    padding: EdgeInsets.symmetric(vertical: 24),
    child: Center(child: CircularProgressIndicator()),
  ),
};

/// Direktur home summary (`/dashboard/owner`, web "Ringkasan Direktur").
class DirekturKpis extends ConsumerWidget {
  const DirekturKpis({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    return _kpiAsync(ref.watch(direkturDashboardProvider), () => ref.invalidate(direkturDashboardProvider), (d) {
      final bt = d.budgetTotals;
      final disb = d.disbursed.isEmpty ? 0 : d.disbursed.last.value;
      return Column(
        key: const Key('kpi-direktur'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KpiGrid(
            children: [
              KpiCard(
                key: const Key('kpi-cash'),
                emphasis: true,
                icon: Icons.account_balance_wallet,
                label: t.kpiCashTotal,
                value: formatRupiah(d.cashTotal),
                lines: [_small(context, t.kpiMonthInOut(formatRupiah(d.monthIn), formatRupiah(d.monthOut)))],
                footer: Sparkline(values: [for (final p in d.balanceTrend) p.value], semanticsLabel: t.kpiBalanceTrend),
              ),
              KpiCard(
                key: const Key('kpi-waiting'),
                icon: Icons.pending_actions,
                label: t.kpiWaiting,
                value: '${d.waitingCount}',
                onTap: () => context.go('/inbox'),
                lines: [
                  if (d.waitingCount > 0) _small(context, formatRupiah(d.waitingSum)),
                  _small(context, t.kpiWaitingSplit(d.pendingAckCount, d.pendingApprovalCount)),
                  _small(
                    context,
                    t.kpiWaitingForMe(d.waitingForMe) +
                        (d.oldestDays != null ? ' · ${t.kpiOldest(d.oldestDays!)}' : ''),
                    key: const Key('kpi-waiting-me'),
                  ),
                ],
              ),
              KpiCard(
                icon: Icons.send,
                label: t.kpiDisbursedMonth,
                value: formatRupiah(disb),
                lines: [_small(context, t.kpiDisbursedNet(formatRupiah(disb)))],
                footer: Sparkline(values: [for (final p in d.disbursed) p.value], semanticsLabel: t.kpiDisbursedTrend),
              ),
              KpiCard(
                icon: Icons.track_changes,
                label: t.kpiBudgetRealized,
                value: pctText(share(bt.realized, bt.budget)),
                lines: [
                  _small(context, t.kpiOfBudget(formatRupiah(bt.realized), formatRupiah(bt.budget))),
                  if (d.budgetOver > 0 || d.budgetWarn > 0)
                    _small(context, t.kpiBudgetAlerts(d.budgetOver, d.budgetWarn), color: context.pk.warnText),
                ],
                footer: Meter(value: bt.realized, max: bt.budget),
              ),
            ],
          ),
          CompanySplitCard(
            rows: d.byCompany,
            primary: (r) => t.kpiSplitCash(formatRupiah(r.cash ?? 0)),
            secondary: (r) => t.kpiSplitWaiting(r.count, formatRupiah(r.sum)),
          ),
          if (d.cashFlow.isNotEmpty)
            DashSection(
              title: t.kpiCashFlowTitle,
              subtitle: t.kpiCashFlowSubtitle,
              child: CashFlowChart(
                rows: d.cashFlow,
                labelIn: t.kpiIn,
                labelOut: t.kpiOut,
                intercompanyNote: t.kpiCashFlowAntarPt,
                // ADR 0028: the web Direktur card's "tanpa antar-PT" toggle
                withoutIntercompanyToggle: (
                  label: t.kpiCashFlowWithoutAntarPt,
                  excludedNote: t.kpiCashFlowAntarPtExcluded,
                ),
              ),
            ),
          // DRMS 13/10 Wave 3: the rest of the web "Ringkasan Direktur", same order as Dashboard.tsx Owner().
          PipelineCard(pipeline: d.pipeline, title: t.kpiPipelineTitle, subtitle: t.kpiPipelineSubtitle),
          CategoryCard(mix: d.categories, subtitle: t.kpiCategoriesSubtitle(periodShort(_month(d.categories.from)))),
          if (d.sla case final sla?) SlaCard(sla: sla),
          if (d.rapMonitor case final m?) RapMonitorCard(data: m),
          if (d.loans case final l?) LoanCard(data: l),
          if (d.rapMissing case final m?) RapMissingCard(data: m),
          TrendCard(rows: d.requestTrend, title: t.kpiTrendTitle, subtitle: t.kpiTrendSubtitle),
          AccountsCard(accounts: d.accounts),
          CompletenessCard(data: d.completeness),
          RecentCashCard(rows: d.recentCash),
          CostCentersCard(rows: d.costCenters, title: t.kpiCostCentersTitle),
        ],
      );
    });
  }
}

/// Finance home summary (`/dashboard/finance`, web "Ringkasan Finance"). Transfers, verification and
/// the cash book stay on the web admin; the phone shows the queue sizes.
class FinanceKpis extends ConsumerWidget {
  const FinanceKpis({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    return _kpiAsync(ref.watch(financeDashboardProvider), () => ref.invalidate(financeDashboardProvider), (d) {
      final cur = d.cashFlow.isEmpty ? null : d.cashFlow.last;
      return Column(
        key: const Key('kpi-finance'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KpiGrid(
            children: [
              KpiCard(
                key: const Key('kpi-cash'),
                emphasis: true,
                icon: Icons.account_balance_wallet,
                label: t.kpiCashTotal,
                value: formatRupiah(d.cashTotal),
                footer: Sparkline(values: [for (final p in d.balanceTrend) p.value], semanticsLabel: t.kpiBalanceTrend),
              ),
              KpiCard(
                key: const Key('kpi-transfer-queue'),
                icon: Icons.send,
                label: t.kpiTransferQueue,
                value: '${d.transferCount}',
                lines: [
                  if (d.transferCount > 0) _small(context, formatRupiah(d.transferSum)),
                  _small(
                    context,
                    d.transferOverdue > 0 ? t.kpiOverdue(d.transferOverdue) : t.kpiOnTime,
                    color: d.transferOverdue > 0 ? context.pk.warnText : null,
                  ),
                ],
              ),
              KpiCard(
                icon: Icons.fact_check,
                label: t.kpiToVerify,
                value: '${d.lpjToVerify + d.reimburseToVerify}',
                lines: [_small(context, t.kpiToVerifySplit(d.lpjToVerify, d.reimburseToVerify))],
              ),
              KpiCard(
                icon: Icons.balance,
                label: t.kpiLpjToSettle,
                value: '${d.lpjToSettle}',
                lines: [
                  if (d.advancesOverdue > 0)
                    _small(context, t.kpiAdvancesOverdue(d.advancesOverdue), color: context.pk.badText),
                ],
              ),
            ],
          ),
          CompanySplitCard(
            rows: d.byCompany,
            primary: (r) => t.kpiSplitCash(formatRupiah(r.cash ?? 0)),
            secondary: (r) => t.kpiSplitTransfer(r.count, formatRupiah(r.sum)),
          ),
          if (cur != null)
            DashSection(
              title: t.kpiCashFlowTitle,
              subtitle: t.kpiCashFlowSubtitleFinance,
              child: CashFlowChart(
                rows: d.cashFlow,
                labelIn: t.kpiIn,
                labelOut: t.kpiOut,
                intercompanyNote: t.kpiCashFlowAntarPt,
              ),
            ),
          // DRMS 13/10 Wave 3: the rest of the web "Ringkasan Finance", same order as Dashboard.tsx Finance().
          AccountsCard(accounts: d.accounts, subtitle: t.kpiAccountsSubtitle),
          PipelineCard(pipeline: d.pipeline, title: t.kpiPipelineTitle, subtitle: t.kpiPipelineSubtitle),
          AdvancesWithoutLpjCard(rows: d.advancesWithoutLpj, dueDays: d.lpjDueDays),
          RecentCashCard(rows: d.recentCash),
          CategoryCard(mix: d.categories, subtitle: t.kpiCategoriesSubtitleFinance),
          if (d.sla case final sla?) SlaCard(sla: sla),
          if (d.loans case final l?) LoanCard(data: l),
          PeriodCloseCard(last: d.lastClosedPeriod, next: d.nextClosable),
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(t.financeHint, style: Theme.of(context).textTheme.bodySmall),
          ),
        ],
      );
    });
  }
}

/// PM team monitor (`/dashboard/pm`, US-17): read-only — ADR 0013 gives PM no decisions.
class PmTeamKpis extends ConsumerWidget {
  const PmTeamKpis({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    return _kpiAsync(ref.watch(pmDashboardProvider), () => ref.invalidate(pmDashboardProvider), (d) {
      if (!d.hasScope) {
        return Card(
          child: ListTile(leading: const Icon(Icons.groups), title: Text(t.teamNoScope)),
        );
      }
      final bt = d.budgetTotals;
      final grid = KpiGrid(
        key: const Key('kpi-pm'),
        children: [
          KpiCard(
            key: const Key('kpi-team-month'),
            emphasis: true,
            icon: Icons.groups,
            label: t.kpiTeamMonth,
            value: '${d.teamCount}',
            onTap: () => context.go('/requests?tab=team'),
            lines: [_small(context, formatRupiah(d.teamSum)), _small(context, t.kpiTeamWaiting(d.teamWaiting))],
            footer: Sparkline(values: [for (final p in d.requestTrend) p.value], semanticsLabel: t.kpiTeamTrend),
          ),
          KpiCard(
            icon: Icons.description,
            label: t.kpiTeamLpj,
            value: '${d.withoutLpj}',
            lines: [
              _small(
                context,
                d.lpjOverdue > 0 ? t.kpiLpjOverdue(d.lpjOverdue) : t.kpiLpjNoneOverdue,
                color: d.lpjOverdue > 0 ? context.pk.badText : null,
              ),
            ],
          ),
          KpiCard(
            icon: Icons.track_changes,
            label: t.kpiTeamBudget,
            value: pctText(share(bt.realized, bt.budget)),
            lines: [_small(context, t.kpiOfBudget(formatRupiah(bt.realized), formatRupiah(bt.budget)))],
            footer: Meter(value: bt.realized, max: bt.budget),
          ),
        ],
      );
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          grid,
          CompanySplitCard(
            rows: d.byCompany,
            primary: (r) => t.kpiSplitTeam(r.count, formatRupiah(r.sum)),
            secondary: (r) => t.kpiTeamWaiting(r.waiting ?? 0),
          ),
          // DRMS 13/10 Wave 3: the rest of the web "Ringkasan PM", same order as Dashboard.tsx Pm().
          if (d.rapMissing case final m?) RapMissingCard(data: m),
          PipelineCard(pipeline: d.pipeline, title: t.kpiPipelineTeamTitle, subtitle: t.kpiPipelineTeamSubtitle),
          TrendCard(rows: d.trend, title: t.kpiTrendTeamTitle, subtitle: t.kpiTrendTeamSubtitle),
          CategoryCard(mix: d.categories, subtitle: t.kpiCategoriesSubtitleTeam),
          if (d.loans case final l?) LoanCard(data: l),
          CostCentersCard(rows: d.costCenters, title: t.kpiCostCentersTeamTitle),
        ],
      );
    });
  }
}

/// `2026-04-01` → `2026-04` (category range start → month label).
String _month(String date) => date.length >= 7 ? date.substring(0, 7) : date;

/// Staff home (`/dashboard/me`, web "Ringkasan pengajuan saya"): the caller's OWN requests with their amounts, the
/// same figures as the web Staff home (owner 2026-10-13) — no project budgets, cash or other people's requests.
class StaffKpis extends ConsumerWidget {
  const StaffKpis({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    return _kpiAsync(ref.watch(staffDashboardProvider), () => ref.invalidate(staffDashboardProvider), (d) {
      final cur = d.month;
      return Column(
        key: const Key('kpi-staff'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KpiGrid(
            children: [
              KpiCard(
                key: const Key('kpi-my-actions'),
                emphasis: true,
                icon: Icons.inbox,
                label: t.kpiMyActions,
                value: formatDecimal(d.actions),
                onTap: () => context.go('/requests'),
                lines: [_small(context, d.actions == 0 ? t.kpiMyActionsNone : t.kpiMyActionsHint)],
              ),
              KpiCard(
                key: const Key('kpi-my-process'),
                icon: Icons.schedule,
                label: t.kpiMyProcess,
                value: formatDecimal(d.inProcess),
                lines: [_small(context, t.kpiMyProcessWaiting(d.waitingDecision))],
              ),
              KpiCard(
                key: const Key('kpi-my-month'),
                icon: Icons.description,
                label: t.kpiMyMonth(cur == null ? '' : periodShort(cur.period)),
                value: formatDecimal(cur?.count ?? 0),
                lines: [_small(context, formatRupiah(cur?.sum ?? 0), key: const Key('kpi-my-month-sum'))],
                footer: Sparkline(values: [for (final p in d.trend) p.count], semanticsLabel: t.kpiTrendMineTitle),
              ),
              KpiCard(
                key: const Key('kpi-my-done'),
                icon: Icons.check_circle_outline,
                label: t.kpiMyDone,
                value: formatDecimal(d.done),
                lines: [_small(context, t.kpiMyExit(d.exit))],
              ),
            ],
          ),
          // web order (Dashboard.tsx Staff()): status → "Pengajuan saya" → per month
          PipelineCard(pipeline: d.pipeline, title: t.kpiPipelineMineTitle, subtitle: t.kpiPipelineMineSubtitle),
          MyRequestsCard(rows: d.latest),
          TrendCard(rows: d.trend, title: t.kpiTrendMineTitle, subtitle: t.kpiTrendMineSubtitle),
        ],
      );
    });
  }
}

/// Admin home (`/dashboard/admin`, web "Ringkasan Admin"): master-data gaps; fixing them and the audit log stay on
/// the web admin.
class AdminKpis extends ConsumerWidget {
  const AdminKpis({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    return _kpiAsync(ref.watch(adminDashboardProvider), () => ref.invalidate(adminDashboardProvider), (d) {
      Widget gap(Key key, IconData icon, String label, int n) => KpiCard(
        key: key,
        icon: icon,
        label: label,
        value: formatDecimal(n),
        lines: [
          _small(
            context,
            n == 0 ? t.kpiAdminComplete : t.kpiAdminIncomplete,
            color: n == 0 ? context.pk.okText : context.pk.warnText,
          ),
        ],
      );
      return Column(
        key: const Key('kpi-admin'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KpiGrid(
            children: [
              gap(const Key('kpi-admin-users'), Icons.people_outline, t.kpiAdminUsers, d.usersIncomplete),
              gap(const Key('kpi-admin-projects'), Icons.track_changes, t.kpiAdminProjects, d.projectsWithoutPm),
              gap(
                const Key('kpi-admin-cost-centers'),
                Icons.balance,
                t.kpiAdminCostCenters,
                d.costCentersWithoutManager,
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(t.kpiAdminWebHint, style: Theme.of(context).textTheme.bodySmall),
          ),
        ],
      );
    });
  }
}
