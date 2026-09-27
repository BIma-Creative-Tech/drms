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

final dashboardApiProvider = Provider((ref) => DashboardApi(ref.watch(apiClientProvider)));

final direkturDashboardProvider = FutureProvider.autoDispose<DirekturDashboard>(
  (ref) => ref.watch(dashboardApiProvider).direktur(),
);
final financeDashboardProvider = FutureProvider.autoDispose<FinanceDashboard>(
  (ref) => ref.watch(dashboardApiProvider).finance(),
);
final pmDashboardProvider = FutureProvider.autoDispose<PmDashboard>((ref) => ref.watch(dashboardApiProvider).pm());

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
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
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

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.title, required this.child, this.subtitle});
  final String title;
  final String? subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      elevation: 0,
      color: theme.colorScheme.surfaceContainerLow,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: theme.textTheme.titleMedium),
            if (subtitle != null) Text(subtitle!, style: theme.textTheme.bodySmall),
            const SizedBox(height: 12),
            child,
          ],
        ),
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
                value: formatRupiahShort(d.cashTotal),
                lines: [
                  _small(context, formatRupiah(d.cashTotal)),
                  _small(context, t.kpiMonthInOut(formatRupiahShort(d.monthIn), formatRupiahShort(d.monthOut))),
                ],
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
                value: formatRupiahShort(disb),
                lines: [_small(context, t.kpiDisbursedNet(formatRupiah(disb)))],
                footer: Sparkline(values: [for (final p in d.disbursed) p.value], semanticsLabel: t.kpiDisbursedTrend),
              ),
              KpiCard(
                icon: Icons.track_changes,
                label: t.kpiBudgetRealized,
                value: pctText(share(bt.realized, bt.budget)),
                lines: [
                  _small(context, t.kpiOfBudget(formatRupiahShort(bt.realized), formatRupiahShort(bt.budget))),
                  if (d.budgetOver > 0 || d.budgetWarn > 0)
                    _small(context, t.kpiBudgetAlerts(d.budgetOver, d.budgetWarn), color: StatusColors.warning),
                ],
                footer: Meter(value: bt.realized, max: bt.budget),
              ),
            ],
          ),
          if (d.cashFlow.isNotEmpty)
            _SectionCard(
              title: t.kpiCashFlowTitle,
              subtitle: t.kpiCashFlowSubtitle,
              child: CashFlowChart(rows: d.cashFlow, labelIn: t.kpiIn, labelOut: t.kpiOut),
            ),
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
                value: formatRupiahShort(d.cashTotal),
                lines: [_small(context, formatRupiah(d.cashTotal))],
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
                    color: d.transferOverdue > 0 ? StatusColors.warning : null,
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
                    _small(context, t.kpiAdvancesOverdue(d.advancesOverdue), color: StatusColors.danger),
                ],
              ),
            ],
          ),
          if (cur != null)
            _SectionCard(
              title: t.kpiCashFlowTitle,
              subtitle: t.kpiCashFlowSubtitleFinance,
              child: CashFlowChart(rows: d.cashFlow, labelIn: t.kpiIn, labelOut: t.kpiOut),
            ),
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
      return KpiGrid(
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
                color: d.lpjOverdue > 0 ? StatusColors.danger : null,
              ),
            ],
          ),
          KpiCard(
            icon: Icons.track_changes,
            label: t.kpiTeamBudget,
            value: pctText(share(bt.realized, bt.budget)),
            lines: [_small(context, t.kpiOfBudget(formatRupiahShort(bt.realized), formatRupiahShort(bt.budget)))],
            footer: Meter(value: bt.realized, max: bt.budget),
          ),
        ],
      );
    });
  }
}
