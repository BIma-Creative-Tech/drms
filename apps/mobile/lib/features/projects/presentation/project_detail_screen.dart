import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/list_search.dart';
import '../../auth/application/auth_controller.dart';
import '../../companies/presentation/company_chip.dart';
import '../../expense/domain/expense_request.dart';
import '../../expense/domain/request_status.dart';
import '../../expense/presentation/widgets/rap_item_picker.dart';
import '../../auth/domain/user_profile.dart';
import '../../loans/presentation/loan_screens.dart';
import '../application/projects_providers.dart';
import '../domain/project.dart';
import 'projects_screen.dart';

/// DRMS 10/10 point 6/7: one project with the tabs of the web project page — "Proyek" (info), "RAP" (items with
/// plan / realisation / sisa / %, over budget in red) and "Pengajuan" (requests of the project, search + status
/// filter, tap → request detail). Read-only, online. Owner decision 2026-10-11: Staff open it too — without money
/// (the server withholds the contract value and RAP amounts) and with only their own requests.
/// ADR 0022: a fourth tab "Pinjaman" (inter-project loans of the project, as lender and borrower; the borrower PM
/// creates one there) for the money roles only — Staff / Operator never see loans (owner 2026-10-10).
class ProjectDetailScreen extends ConsumerWidget {
  const ProjectDetailScreen({super.key, required this.id, this.initialTab = 0});
  final int id;
  final int initialTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final head = ref.watch(projectDetailProvider(id)).value?.project;
    final p = ref.watch(currentProfileProvider);
    final loans = p != null && [Role.pm, Role.owner, Role.finance, Role.admin].any(p.has);
    final tabs = loans ? 4 : 3;
    return DefaultTabController(
      length: tabs,
      initialIndex: initialTab.clamp(0, tabs - 1),
      child: Scaffold(
        appBar: AppBar(
          title: Text(head?.code ?? t.projectTitle, overflow: TextOverflow.ellipsis),
          bottom: TabBar(
            // four tabs do not fit 360–390 dp without truncating "Pengajuan"
            isScrollable: loans,
            tabAlignment: loans ? TabAlignment.start : null,
            tabs: [
              Tab(key: const Key('tab-project-info'), text: t.projectTabInfo),
              Tab(key: const Key('tab-project-rap'), text: t.projectTabRap),
              Tab(key: const Key('tab-project-requests'), text: t.projectTabRequests),
              if (loans) Tab(key: const Key('tab-project-loans'), text: t.loanTab),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _InfoTab(id: id),
            _RapTab(id: id),
            _RequestsTab(id: id),
            if (loans) ProjectLoansTab(projectId: id),
          ],
        ),
      ),
    );
  }
}

Widget _row(BuildContext context, String k, String v, {Key? key}) => Padding(
  padding: const EdgeInsets.symmetric(vertical: 5),
  child: Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SizedBox(width: 130, child: Text(k, style: Theme.of(context).textTheme.bodySmall)),
      Expanded(child: Text(v, key: key)),
    ],
  ),
);

String _money(int? v) => v == null ? '-' : formatRupiah(v);

class _InfoTab extends ConsumerWidget {
  const _InfoTab({required this.id});
  final int id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final account = ref.watch(accountProfileProvider);
    return RefreshIndicator(
      onRefresh: () => ref.refresh(projectDetailProvider(id).future),
      child: AsyncBody(
        value: ref.watch(projectDetailProvider(id)),
        onRetry: () => ref.invalidate(projectDetailProvider(id)),
        data: (d) {
          final p = d.project;
          final pt = account?.company(p.companyId);
          final ptText = p.companyId == null
              ? '-'
              : (pt == null ? account?.companyCode(p.companyId) ?? '-' : '${pt.code} — ${pt.name}');
          final cc = d.costCenter;
          final rap = d.rap;
          return ListView(
            key: const Key('project-info'),
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  CompanyChipLead(companyId: p.companyId),
                  ProjectStatusChip(project: p),
                ],
              ),
              const SizedBox(height: 6),
              Text(p.name, style: theme.textTheme.titleLarge),
              const SizedBox(height: 8),
              _row(context, t.projectCode, p.code, key: const Key('project-code')),
              _row(context, t.projectName, p.name),
              _row(context, t.draftCompany, ptText, key: const Key('project-company')),
              _row(context, t.projectKind, projectKindLabel(p.kind)),
              _row(context, t.projectPm, p.pm?.name ?? '-', key: const Key('project-pm')),
              _row(context, t.projectStatus, p.statusText),
              // owner 2026-10-11: no contract value (RAB) for Staff — the server sends null, the row is left out
              if (p.contractValue != null || (pt?.seesProjectMoney ?? account?.seesProjectMoney ?? false))
                _row(context, t.projectContractValue, _money(p.contractValue), key: const Key('project-contract')),
              _row(
                context,
                t.fieldCostCenter,
                cc == null ? t.projectNoCostCenter : '${cc.code ?? ''} ${cc.name ?? ''}'.trim(),
                key: const Key('project-cost-center'),
              ),
              if (d.client != null) _row(context, t.projectClient, d.client!.name ?? '-'),
              if (d.startDate != null || d.targetDate != null)
                _row(context, t.projectPeriod, '${formatDateOnly(d.startDate)} – ${formatDateOnly(d.targetDate)}'),
              if (p.progressPct != null)
                _row(context, t.projectProgress, '${p.progressPct!.toStringAsFixed(1).replaceAll('.', ',')}%'),
              if (d.address != null && d.address!.trim().isNotEmpty) _row(context, t.projectAddress, d.address!),
              const SizedBox(height: 16),
              Card(
                key: const Key('project-rap-summary'),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t.projectRapSummary, style: theme.textTheme.titleSmall),
                      const SizedBox(height: 6),
                      if (rap.planned == null)
                        Text(t.rapItemsCount(rap.items), style: theme.textTheme.bodySmall)
                      else ...[
                        _row(context, t.rapPlanned, _money(rap.planned)),
                        _row(context, t.rapRealised, _money(rap.realised)),
                        _row(
                          context,
                          t.rapRemainingLabel,
                          _money(rap.remaining),
                          key: const Key('project-rap-remaining'),
                        ),
                        if (rap.percent != null) ...[
                          const SizedBox(height: 6),
                          Row(
                            children: [
                              Expanded(
                                child: RapProgressBar(
                                  item: RapBudgetItem(
                                    id: 0,
                                    code: '',
                                    name: '',
                                    planned: rap.planned,
                                    realised: rap.realised,
                                    remaining: rap.remaining,
                                    percent: rap.percent,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text(
                                '${rap.percent!.toStringAsFixed(0)}%',
                                style: theme.textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w700),
                              ),
                            ],
                          ),
                        ],
                        if ((rap.overBudgetItems ?? 0) > 0)
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(
                              t.projectRapOverItems(rap.overBudgetItems!),
                              style: TextStyle(color: context.pk.badText, fontWeight: FontWeight.w600),
                            ),
                          ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _RapTab extends ConsumerStatefulWidget {
  const _RapTab({required this.id});
  final int id;

  @override
  ConsumerState<_RapTab> createState() => _RapTabState();
}

class _RapTabState extends ConsumerState<_RapTab> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final provider = projectRapProvider(widget.id);
    return RefreshIndicator(
      onRefresh: () => ref.refresh(provider.future),
      child: AsyncBody(
        value: ref.watch(provider),
        onRetry: () => ref.invalidate(provider),
        data: (load) {
          final q = _q.toLowerCase();
          final items = load.items.where((i) => q.isEmpty || i.label.toLowerCase().contains(q)).toList();
          final noMoney = load.items.isNotEmpty && load.items.every((i) => i.planned == null);
          return ListView(
            key: const Key('project-rap'),
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
            children: [
              ListSearchField(key: const Key('rap-tab-search'), onChanged: (v) => setState(() => _q = v)),
              if (load.offline || noMoney)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    load.offline ? t.rapOfflineNoBudget : t.rapNoPrices,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              const SizedBox(height: 8),
              if (load.items.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Center(child: Text(t.rapNoItemsProject)),
                )
              else if (items.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Center(child: Text(t.noSearchResults)),
                )
              else
                for (final i in items) RapItemCard(item: i),
            ],
          );
        },
      ),
    );
  }
}

/// One RAP item: code — uraian, volume, plan / realisation / sisa and the % bar (red + "Melebihi RAP" when over).
class RapItemCard extends StatelessWidget {
  const RapItemCard({super.key, required this.item});
  final RapBudgetItem item;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final i = item;
    final over = i.overBudget;
    Widget fig(String k, String v, {Color? color}) => Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(k, style: theme.textTheme.labelSmall),
          Text(
            v,
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w600,
              color: color,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
    return Card(
      key: Key('rap-item-${i.id}'),
      margin: const EdgeInsets.only(bottom: 8),
      shape: over
          ? RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(PkTokens.radius),
              side: BorderSide(color: context.pk.badText.withValues(alpha: 0.6)),
            )
          : null,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(i.label, style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                if (!i.active)
                  Padding(
                    padding: const EdgeInsets.only(left: 6),
                    child: Text(t.rapInactive, style: theme.textTheme.labelSmall),
                  ),
              ],
            ),
            if (i.qty != null || i.uom.isNotEmpty)
              Text(
                [if (i.qty != null) formatQty(i.qty!), i.uom].where((e) => e.isNotEmpty).join(' '),
                style: theme.textTheme.bodySmall,
              ),
            if (i.planned != null) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  fig(t.rapPlanned, _money(i.planned)),
                  fig(t.rapRealised, _money(i.realised ?? 0)),
                  fig(t.rapRemainingLabel, _money(i.remaining), color: over ? context.pk.badText : null),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(child: RapProgressBar(item: i)),
                  const SizedBox(width: 8),
                  Text(
                    i.percent == null ? '-' : '${i.percent!.toStringAsFixed(0)}%',
                    style: theme.textTheme.labelMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: over ? context.pk.badText : null,
                    ),
                  ),
                ],
              ),
              if (over)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: RapOverBudgetChip(key: Key('rap-item-${i.id}-over')),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _RequestsTab extends ConsumerStatefulWidget {
  const _RequestsTab({required this.id});
  final int id;

  @override
  ConsumerState<_RequestsTab> createState() => _RequestsTabState();
}

class _RequestsTabState extends ConsumerState<_RequestsTab> {
  String _q = '';
  String? _status;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    // owner 2026-10-11 (same as the web tab): a Staff (only role in the project's PT) sees only their own requests
    final account = ref.watch(accountProfileProvider);
    final companyId = ref.watch(projectDetailProvider(widget.id)).value?.project.companyId;
    final mine = account?.company(companyId)?.staffOnly ?? account?.requestsForSelfOnly ?? false;
    final provider = projectRequestsProvider((projectId: widget.id, q: _q, status: _status, mine: mine));
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
          child: Row(
            children: [
              Expanded(
                child: ListSearchField(
                  key: const Key('project-requests-search'),
                  hint: t.requestsSearchHint,
                  onChanged: (v) => setState(() => _q = v),
                ),
              ),
              const SizedBox(width: 8),
              PopupMenuButton<String>(
                key: const Key('project-requests-status'),
                tooltip: t.filterStatus,
                initialValue: _status ?? '',
                onSelected: (v) => setState(() => _status = v.isEmpty ? null : v),
                itemBuilder: (_) => [
                  PopupMenuItem(value: '', child: Text(t.filterAllStatuses)),
                  for (final s in RequestStatus.values)
                    if (s != RequestStatus.unknown) PopupMenuItem(value: s.code, child: Text(s.label)),
                ],
                child: Chip(
                  avatar: const Icon(Icons.filter_list, size: 18),
                  label: Text(
                    _status == null ? t.filterStatus : RequestStatus.fromCode(_status).label,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => ref.refresh(provider.future),
            child: AsyncBody(
              value: ref.watch(provider),
              onRetry: () => ref.invalidate(provider),
              data: (s) => s.items.isEmpty
                  ? ListView(
                      children: [
                        Padding(
                          padding: const EdgeInsets.all(32),
                          child: Center(
                            child: Text(
                              _q.isEmpty && _status == null ? t.projectNoRequests : t.projectsNoMatch,
                              textAlign: TextAlign.center,
                            ),
                          ),
                        ),
                      ],
                    )
                  : ListView.separated(
                      key: const Key('project-requests'),
                      padding: const EdgeInsets.only(bottom: 24),
                      itemCount: s.items.length + (s.hasMore ? 1 : 0),
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (_, i) {
                        if (i == s.items.length) {
                          return LoadMoreTrigger(
                            key: ValueKey('more-${s.items.length}'),
                            onLoad: () => loadMoreSafely(context, () => ref.read(provider.notifier).loadMore()),
                          );
                        }
                        final r = s.items[i];
                        return _RequestTile(r: r, theme: theme);
                      },
                    ),
            ),
          ),
        ),
      ],
    );
  }
}

class _RequestTile extends StatelessWidget {
  const _RequestTile({required this.r, required this.theme});
  final ExpenseSummary r;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) => ListTile(
    key: Key('project-request-${r.id}'),
    title: Text(r.title, maxLines: 2, overflow: TextOverflow.ellipsis),
    subtitle: Text(
      '${r.docNo ?? '-'} · ${r.typeLabel}\n${r.statusLabel}'
      '${r.neededDate != null ? ' · ${formatDateOnly(r.neededDate)}' : ''}',
    ),
    isThreeLine: true,
    trailing: Text(formatRupiah(r.grandTotal), style: const TextStyle(fontWeight: FontWeight.bold)),
    onTap: () => context.push('/requests/${r.id}'),
  );
}
