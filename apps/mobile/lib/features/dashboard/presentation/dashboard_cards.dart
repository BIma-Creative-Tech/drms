import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/icons/iconsax.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_akun.dart';
import '../../auth/application/auth_controller.dart';
import '../../expense/domain/request_status.dart';
import '../../home/domain/route_access.dart';
import '../domain/dashboard.dart';
import 'charts.dart';

/// DRMS 13/10 Wave 3 (dashboard parity APK ↔ web): the web dashboard cards for the phone home, fed by the same
/// `/api/v1/dashboard/*` blocks as `apps/web/src/admin/views/Dashboard.tsx`. Cards state full Rupiah values
/// (DRMS 13/10 #10); compact amounts stay on chart axes only.

/// Titled card of a home section (one web dashboard card).
class DashSection extends StatelessWidget {
  const DashSection({super.key, required this.title, required this.child, this.subtitle});
  final String title;
  final String? subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      elevation: 0,
      color: theme.colorScheme.surfaceContainerLow,
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            if (subtitle != null)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  subtitle!,
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}

Widget _line(BuildContext context, String text, {Color? color, Key? key}) => Padding(
  padding: const EdgeInsets.only(top: 3),
  child: Text(
    key: key,
    text,
    style: Theme.of(context).textTheme.bodySmall?.copyWith(
      color: color ?? Theme.of(context).colorScheme.onSurfaceVariant,
      fontWeight: color == null ? null : FontWeight.w600,
    ),
  ),
);

Widget _big(BuildContext context, String text, {Key? key}) => Text(
  key: key,
  text,
  style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
);

Widget _empty(BuildContext context, String text) => Text(
  text,
  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
);

/// D2510: rows of a card separated by hairlines (inset past the icon chip).
Widget _rows(List<Widget> rows) => Column(
  crossAxisAlignment: CrossAxisAlignment.stretch,
  children: [
    for (final (i, r) in rows.indexed) ...[if (i > 0) const PkRowDivider(indent: 46), r],
  ],
);

/// Bold right-aligned figure of a row (amount, percentage).
Widget _figure(BuildContext context, String text, {Color? color, TextDecoration? decoration}) => Text(
  text,
  style: Theme.of(context).textTheme.bodyMedium
      ?.copyWith(fontWeight: FontWeight.w700, color: color, decoration: decoration),
);

/// List row of a card: tonal icon chip, bold title, muted supporting lines, trailing figure; tappable when it leads
/// somewhere.
class _Row extends StatelessWidget {
  const _Row({
    super.key,
    required this.title,
    this.lines = const [],
    this.trailing,
    this.onTap,
    this.icon = Icons.folder_outlined,
    this.tone = PkTone.info,
  });
  final String title;
  final List<Widget> lines;
  final Widget? trailing;
  final VoidCallback? onTap;
  final Object icon;
  final PkTone tone;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(PkRadius.sm),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            PkIconChip(icon: icon, tone: tone, size: 34),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
                  ...lines,
                ],
              ),
            ),
            if (trailing != null) ...[const SizedBox(width: 8), trailing!],
            if (onTap != null) Icon(Icons.chevron_right, size: 20, color: theme.colorScheme.outline),
          ],
        ),
      ),
    );
  }
}

String _project(String code, String name) => '$code $name'.trim();

/// "Status pengajuan" (K-13 stages). [money] = Σ grand total next to the count (Staff: own requests only).
class PipelineCard extends StatelessWidget {
  const PipelineCard({
    super.key,
    required this.pipeline,
    required this.title,
    required this.subtitle,
    this.money = true,
  });
  final Pipeline pipeline;
  final String title;
  final String subtitle;
  final bool money;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return DashSection(
      key: const Key('dash-pipeline'),
      title: title,
      subtitle: subtitle,
      child: HBarList(
        empty: t.kpiPipelineEmpty,
        items: [
          if (pipeline.rows.any((s) => s.count > 0))
            for (final s in pipeline.rows)
              HBarItem(
                label: s.label,
                value: s.count,
                valueText: money ? t.kpiCountSum(s.count, formatRupiah(s.sum)) : formatDecimal(s.count),
                muted: s.key == 'exit',
              ),
        ],
      ),
    );
  }
}

/// "Komposisi biaya per kategori" (K-17 Dicairkan, top 6 + "Lainnya").
class CategoryCard extends StatelessWidget {
  const CategoryCard({super.key, required this.mix, required this.subtitle});
  final CategoryMix mix;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return DashSection(
      key: const Key('dash-categories'),
      title: t.kpiCategoriesTitle,
      subtitle: subtitle,
      child: HBarList(
        empty: t.kpiCategoriesEmpty,
        items: [
          for (final c in mix.items)
            HBarItem(
              label: c.label,
              value: c.total,
              valueText: formatRupiah(c.total),
              sub: switch (share(c.total, mix.total)) {
                final p? => formatPercent(p),
                null => null,
              },
              muted: c.other,
            ),
        ],
      ),
    );
  }
}

/// Item 11 "SLA transfer": share of this month's transfers within the PT's SLA, average duration, late count.
class SlaCard extends StatelessWidget {
  const SlaCard({super.key, required this.sla});
  final SlaSummary sla;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final pk = context.pk;
    final pct = sla.pctWithin;
    final tone = pct == null
        ? null
        : pct >= 90
        ? pk.ok
        : pct >= 70
        ? pk.warn
        : pk.bad;
    return DashSection(
      key: const Key('dash-sla'),
      title: t.kpiSlaTitle,
      subtitle: sla.slaHours.length == 1 ? t.kpiSlaSubtitleTarget(sla.slaHours.first) : t.kpiSlaSubtitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _big(context, sla.text, key: const Key('dash-sla-pct')),
          _line(context, sla.count == 0 ? t.kpiSlaNone : t.kpiSlaOf(sla.count)),
          const SizedBox(height: 8),
          Meter(value: ((pct ?? 0) * 10).round(), max: 1000, color: tone),
          _line(context, t.kpiSlaAvgLate(sla.avgText, sla.late), key: const Key('dash-sla-late')),
        ],
      ),
    );
  }
}

/// DRMS 10/10 "Monitoring RAP": realisation vs plan per project with a RAP; a row opens the project's RAP tab.
class RapMonitorCard extends StatelessWidget {
  const RapMonitorCard({super.key, required this.data});
  final RapMonitor data;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final pk = context.pk;
    return DashSection(
      key: const Key('dash-rap-monitor'),
      title: t.kpiRapMonitorTitle,
      subtitle: data.projects == 0
          ? t.kpiRapMonitorSubtitleEmpty
          : t.kpiRapMonitorSubtitle(data.projects, data.overProjects),
      child: data.rows.isEmpty
          ? _empty(context, t.kpiRapMonitorEmpty)
          : _rows([
              for (final r in data.rows)
                _Row(
                  key: Key('dash-rap-monitor-${r.projectId}'),
                  title: _project(r.code, r.name),
                  icon: PkIcons.project,
                  tone: r.overBudget
                      ? PkTone.bad
                      : (r.percent ?? 0) >= 85
                      ? PkTone.warn
                      : PkTone.ok,
                  onTap: () => context.push('/projects/${r.projectId}?tab=rap'),
                  trailing: _figure(context, r.percent == null ? '—' : formatPercent(r.percent!)),
                  lines: [
                    _line(
                      context,
                      t.kpiRapRealised(formatRupiah(r.realised), r.planned == null ? '—' : formatRupiah(r.planned!)),
                    ),
                    const SizedBox(height: 4),
                    Meter(
                      value: r.realised,
                      max: math.max(1, r.planned ?? 0),
                      color: r.overBudget
                          ? pk.bad
                          : (r.percent ?? 0) >= 85
                          ? pk.warn
                          : pk.ok,
                    ),
                    r.overBudgetItems > 0
                        ? _line(context, t.kpiRapOverItems(r.overBudgetItems), color: pk.warnText)
                        : _line(context, t.kpiRapSafe, color: pk.okText),
                  ],
                ),
            ]),
    );
  }
}

/// ADR 0022 §9 "Pinjaman antar project": outstanding / overdue / waiting, top 5 projects (row → project "Pinjaman").
class LoanCard extends StatelessWidget {
  const LoanCard({super.key, required this.data});
  final LoanMonitor data;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final pk = context.pk;
    return DashSection(
      key: const Key('dash-loans'),
      title: t.kpiLoansTitle,
      subtitle: t.kpiLoansSubtitle(formatRupiah(data.outstanding), data.overdueCount, data.pending),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (data.overdueCount > 0)
            _line(context, t.kpiLoansOverdueSum(formatRupiah(data.overdue)), color: pk.badText),
          if (data.waitingForMe > 0)
            Align(
              alignment: Alignment.centerLeft,
              child: ActionChip(
                key: const Key('dash-loans-waiting'),
                avatar: const Icon(Icons.pending_actions, size: 18),
                label: Text(t.kpiLoansWaiting(data.waitingForMe)),
                onPressed: () => context.go('/inbox'),
              ),
            ),
          if (data.projects.isEmpty)
            _empty(context, t.kpiLoansEmpty)
          else
            _rows([
              for (final p in data.projects)
                _Row(
                  key: Key('dash-loan-${p.projectId}'),
                  title: _project(p.code, p.name),
                  icon: Icons.swap_horiz,
                  tone: p.overdueCount > 0 ? PkTone.bad : PkTone.info,
                  onTap: () => context.push('/projects/${p.projectId}?tab=loans'),
                  lines: [
                    _line(context, t.kpiLoanRow(formatRupiah(p.outstandingBorrowed), formatRupiah(p.outstandingLent))),
                    p.overdueCount > 0
                        ? _line(
                            context,
                            t.kpiLoanOverdue(p.overdueCount, formatRupiah(p.overdueBorrowed)),
                            color: pk.badText,
                          )
                        : _line(context, t.kpiLoanOnTime, color: pk.okText),
                  ],
                ),
            ]),
        ],
      ),
    );
  }
}

/// D4 "Project ber-RAB belum punya RAP" (Direktur) / "Project Anda belum punya RAP" (PM). Nothing when all have one.
class RapMissingCard extends StatelessWidget {
  const RapMissingCard({super.key, required this.data});
  final RapMissing data;

  @override
  Widget build(BuildContext context) {
    if (data.total == 0) return const SizedBox.shrink();
    final t = AppLocalizations.of(context);
    return DashSection(
      key: const Key('dash-rap-missing'),
      title: data.team ? t.kpiRapMissingTeamTitle : t.kpiRapMissingTitle,
      subtitle: data.team ? t.kpiRapMissingTeamSubtitle(data.total) : t.kpiRapMissingSubtitle(data.total),
      child: _rows([
        for (final r in data.rows)
          _Row(
            key: Key('dash-rap-missing-${r.id}'),
            title: _project(r.code, r.name),
            icon: PkIcons.project,
            tone: PkTone.warn,
            onTap: () => context.push('/projects/${r.id}?tab=rap'),
            trailing: PkPill(label: t.kpiRapFill, tone: PkTone.warn),
            lines: [
              _line(
                context,
                r.budget == null ? r.kindLabel : t.kpiRapMissingBudget(r.kindLabel, formatRupiah(r.budget!)),
              ),
            ],
          ),
      ]),
    );
  }
}

/// "Tren pengajuan": requests per month as columns; [money] adds Σ grand total to the readout (Staff: own requests).
class TrendCard extends StatelessWidget {
  const TrendCard({super.key, required this.rows, required this.title, required this.subtitle, this.money = true});
  final List<RequestTrendPoint> rows;
  final String title;
  final String subtitle;
  final bool money;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return DashSection(
      key: const Key('dash-trend'),
      title: title,
      subtitle: subtitle,
      child: TrendBarChart(
        rows: rows,
        empty: t.kpiTrendEmpty,
        readout: (r) => money
            ? t.kpiTrendReadoutSum(periodLong(r.period), r.count, formatRupiah(r.sum))
            : t.kpiTrendReadout(periodLong(r.period), r.count),
      ),
    );
  }
}

/// "Pengajuan saya" (web Staff home, 10 latest): the caller's own requests — number (or `Draft "judul"`), status and
/// Nominal (grand total, full Rupiah); a row opens the request.
class MyRequestsCard extends StatelessWidget {
  const MyRequestsCard({super.key, required this.rows});
  final List<OwnRequest> rows;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return DashSection(
      key: const Key('dash-my-requests'),
      title: t.kpiMyLatestTitle,
      subtitle: t.kpiMyLatestSubtitle,
      child: rows.isEmpty
          ? _empty(context, t.kpiMyLatestEmpty)
          : _rows([
              for (final r in rows)
                _Row(
                  key: Key('dash-my-request-${r.id}'),
                  title: r.docNo ?? t.kpiMyDraftTitle(r.title),
                  icon: PkIcons.requests,
                  tone: _statusTone(r.status),
                  lines: [
                    _line(
                      context,
                      [
                        if (r.docNo != null) r.title,
                        statusLabelFallback(RequestType.fromCode(r.type), RequestStatus.fromCode(r.status)),
                      ].where((x) => x.isNotEmpty).join(' · '),
                    ),
                  ],
                  trailing: _figure(context, formatRupiah(r.grandTotal)),
                  onTap: () => context.push('/requests/${r.id}'),
                ),
            ]),
    );
  }
}

/// "Saldo per akun" (K-01 per account, highest first; `[PT]` prefix when the home spans several PTs).
class AccountsCard extends StatelessWidget {
  const AccountsCard({super.key, required this.accounts, this.subtitle});
  final List<AccountBalance> accounts;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return DashSection(
      key: const Key('dash-accounts'),
      title: t.kpiAccountsTitle,
      subtitle: subtitle ?? t.kpiAccountsSubtitle,
      child: HBarList(
        empty: t.kpiAccountsEmpty,
        items: [
          for (final a in accounts)
            HBarItem(
              label: '${a.code == null ? '' : '[${a.code}] '}${a.active ? a.name : t.kpiAccountInactive(a.name)}',
              value: math.max(0, a.balance),
              valueText: formatRupiah(a.balance),
              sub: a.monthIn == null
                  ? null
                  : t.kpiAccountMonth(formatRupiah(a.monthIn!), formatRupiah(a.monthOut ?? 0)),
            ),
        ],
      ),
    );
  }
}

/// "Kelengkapan nota/LPJ" (K-12, this month).
class CompletenessCard extends StatelessWidget {
  const CompletenessCard({super.key, required this.data});
  final Completeness data;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final pk = context.pk;
    final c = data;
    return DashSection(
      key: const Key('dash-completeness'),
      title: t.kpiCompletenessTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _big(context, '${formatDecimal(c.ratioDone)} / ${formatDecimal(c.ratioTotal)}', key: const Key('dash-k12g')),
          _line(context, t.kpiCompletenessRatio),
          const SizedBox(height: 8),
          Meter(value: c.ratioDone, max: math.max(1, c.ratioTotal)),
          c.overdue > 0
              ? _line(context, t.kpiCompletenessOverdue(c.overdue), color: pk.badText)
              : _line(context, t.kpiCompletenessNoneOverdue, color: pk.okText),
          _line(context, t.kpiCompletenessWithoutLpj(c.withoutLpj)),
          _line(context, t.kpiCompletenessReimburse(c.reimburseToVerify)),
          _line(context, t.kpiCompletenessWarnings(c.openWarnings)),
        ],
      ),
    );
  }
}

/// "Transaksi kas terbaru" (cash book incl. void & reversal). D2510: a row opens its request (else the cash entry).
class RecentCashCard extends ConsumerWidget {
  const RecentCashCard({super.key, required this.rows});
  final List<RecentCashEntry> rows;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final pk = context.pk;
    final profile = ref.watch(currentProfileProvider);
    return DashSection(
      key: const Key('dash-recent-cash'),
      title: t.kpiRecentCashTitle,
      subtitle: t.kpiRecentCashSubtitle,
      child: rows.isEmpty
          ? _empty(context, t.kpiRecentCashEmpty)
          : _rows([
              for (final r in rows)
                _Row(
                  key: Key('dash-cash-${r.id}'),
                  title: r.entryNo ?? '#${r.id}',
                  onTap: canOpenApkRoute(r.route, profile) ? () => context.push(r.route) : null,
                  icon: r.incoming ? Icons.south_west : Icons.north_east,
                  tone: r.voided
                      ? PkTone.neutral
                      : r.incoming
                      ? PkTone.ok
                      : PkTone.info,
                  lines: [
                    _line(
                      context,
                      [formatDateOnly(r.entryDate), r.label, r.account].where((x) => x.isNotEmpty).join(' · '),
                    ),
                    // ADR 0028: "Antar PT" (+ the other leg "Dari PT … · KK/…" / "Ke PT … · KM/…" when sent)
                    if (r.isIntercompany)
                      _line(
                        context,
                        [cashSourceLabels['intercompany']!, ?r.counterpart?.text].join(' · '),
                        key: Key('dash-cash-${r.id}-ic'),
                      ),
                    if (r.voided) _line(context, t.kpiVoid, color: pk.badText),
                  ],
                  trailing: _figure(
                    context,
                    '${r.incoming ? '+' : '−'}${formatRupiah(r.amount)}',
                    color: r.incoming ? pk.okText : null,
                    decoration: r.voided ? TextDecoration.lineThrough : null,
                  ),
                ),
            ]),
    );
  }
}

/// "Pusat biaya bulan ini" (K-15).
class CostCentersCard extends StatelessWidget {
  const CostCentersCard({super.key, required this.rows, required this.title, this.empty});
  final List<CostCenterMonth> rows;
  final String title;

  /// Empty text (default "Belum ada biaya pusat biaya bulan ini."; PM: his projects are not mapped yet, ADR 0031).
  final String? empty;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return DashSection(
      key: const Key('dash-cost-centers'),
      title: title,
      child: HBarList(
        empty: empty ?? t.kpiCostCentersEmpty,
        items: [
          // ADR 0031: a Pusat Biaya is a cash account — `code` is empty, the label is its name
          for (final c in rows)
            HBarItem(label: _project(c.code, c.name), value: math.max(0, c.total), valueText: formatRupiah(c.total)),
        ],
      ),
    );
  }
}

/// Finance "Pengajuan baru belum LPJ" (top 8, late when older than the PT's LPJ due days).
class AdvancesWithoutLpjCard extends StatelessWidget {
  const AdvancesWithoutLpjCard({super.key, required this.rows, required this.dueDays});
  final List<AdvanceWithoutLpj> rows;
  final int dueDays;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final pk = context.pk;
    return DashSection(
      key: const Key('dash-advances'),
      title: t.kpiAdvancesTitle,
      subtitle: t.kpiAdvancesSubtitle(dueDays),
      child: rows.isEmpty
          ? _empty(context, t.kpiAdvancesEmpty)
          : _rows([
              for (final r in rows)
                _Row(
                  key: Key('dash-advance-${r.id}'),
                  title: r.docNo ?? '#${r.id}',
                  icon: PkIcons.advance,
                  tone: r.overdue ? PkTone.bad : PkTone.warn,
                  onTap: () => context.push('/requests/${r.id}'),
                  trailing: _figure(context, formatRupiah(r.amount)),
                  lines: [
                    if (r.requesters.isNotEmpty) _line(context, r.requesters),
                    if (r.ageDays != null)
                      r.overdue
                          ? _line(context, t.kpiAdvanceLate(r.ageDays!), color: pk.badText)
                          : _line(context, t.kpiAdvanceAge(r.ageDays!)),
                  ],
                ),
            ]),
    );
  }
}

/// Finance "Tutup buku": last closed month (the closing itself stays on the web).
class PeriodCloseCard extends StatelessWidget {
  const PeriodCloseCard({super.key, required this.last, required this.next});
  final String? last;
  final String next;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return DashSection(
      key: const Key('dash-period-close'),
      title: t.kpiPeriodCloseTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            last == null ? t.kpiPeriodNever : t.kpiPeriodClosed(last!),
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          if (next.isNotEmpty) _line(context, t.kpiPeriodNext(next)),
        ],
      ),
    );
  }
}

/// Tone of a request status in "Pengajuan saya" (draft neutral, waiting info, transferred / done ok, rejected bad).
PkTone _statusTone(String code) => switch (code) {
  'draft' => PkTone.neutral,
  'approved' || 'transferred' || 'receipts_complete' || 'lpj_verified' || 'completed' => PkTone.ok,
  'rejected' || 'cancelled' => PkTone.bad,
  'receipt_revision' || 'lpj_revision' => PkTone.warn,
  _ => PkTone.info,
};
