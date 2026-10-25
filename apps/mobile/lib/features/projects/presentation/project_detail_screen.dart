import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/list_search.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_proyek.dart';
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

Widget _row(BuildContext context, String k, String v, {Key? key}) => PkKeyRow(k, v, valueKey: key);

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
          final pb = d.pusatBiaya;
          final rap = d.rap;
          final over = (rap.overBudgetItems ?? 0) > 0;
          return ListView(
            key: const Key('project-info'),
            padding: const EdgeInsets.all(16),
            children: [
              // headline card: icon, code (+ PT), name, status
              PkCard(
                radius: PkRadius.lg,
                padding: const EdgeInsets.all(16),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const PkIconChip(icon: Icons.apartment, tone: PkTone.primary, size: 44),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              CompanyChipLead(companyId: p.companyId),
                              ProjectStatusChip(project: p),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            p.name,
                            style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700, height: 1.25),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              PkCard(
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _row(context, t.projectCode, p.code, key: const Key('project-code')),
                    _row(context, t.projectName, p.name),
                    _row(context, t.draftCompany, ptText, key: const Key('project-company')),
                    _row(context, t.projectKind, projectKindLabel(p.kind)),
                    _row(context, t.projectPm, p.pm?.name ?? '-', key: const Key('project-pm')),
                    _row(context, t.projectStatus, p.statusText),
                    // owner 2026-10-11: no contract value (RAB) for Staff — the server sends null, the row is left out
                    if (p.contractValue != null || (pt?.seesProjectMoney ?? account?.seesProjectMoney ?? false))
                      _row(
                        context,
                        t.projectContractValue,
                        _money(p.contractValue),
                        key: const Key('project-contract'),
                      ),
                    // ADR 0031: the Pusat Biaya = the project's cash account (mapped in the project data on the web)
                    _row(
                      context,
                      t.fieldCostCenter,
                      pb?.name ?? t.pusatBiayaUnmapped,
                      key: const Key('project-cost-center'),
                    ),
                    if (d.client != null) _row(context, t.projectClient, d.client!.name ?? '-'),
                    if (d.startDate != null || d.targetDate != null)
                      _row(
                        context,
                        t.projectPeriod,
                        '${formatDateOnly(d.startDate)} – ${formatDateOnly(d.targetDate)}',
                      ),
                    if (p.progressPct != null) _row(context, t.projectProgress, formatPercent(p.progressPct!)),
                    if (d.address != null && d.address!.trim().isNotEmpty) _row(context, t.projectAddress, d.address!),
                  ],
                ),
              ),
              PkSectionCard(
                key: const Key('project-rap-summary'),
                title: t.projectRapSummary,
                icon: Icons.pie_chart_outline,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (rap.planned == null)
                      Text(t.rapItemsCount(rap.items), style: pkMetaStyle(context))
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
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: PkProgressBar(
                                value: rap.percent! / 100,
                                color: rap.percent! > 100 ? context.pk.badText : null,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Text(
                              formatPercent(rap.percent!, digits: 0),
                              style: theme.textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w700),
                            ),
                          ],
                        ),
                      ],
                      if (over)
                        Padding(
                          padding: const EdgeInsets.only(top: 10),
                          child: Align(
                            alignment: Alignment.centerLeft,
                            child: PkPill(
                              label: t.projectRapOverItems(rap.overBudgetItems!),
                              tone: PkTone.bad,
                              icon: Icons.warning_amber_rounded,
                            ),
                          ),
                        ),
                    ],
                  ],
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
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            children: [
              ListSearchField(key: const Key('rap-tab-search'), onChanged: (v) => setState(() => _q = v)),
              // phase 5b (user 2026-10-19): the web "RAP proyek" page — editing where the server allows it
              if (ref.watch(currentProfileProvider) case final p?
                  when [Role.pm, Role.owner, Role.admin, Role.finance].any(p.has))
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    key: const Key('rap-tab-manage'),
                    onPressed: () async {
                      await context.push('/projects/${widget.id}/rap');
                      ref.invalidate(provider);
                    },
                    icon: const Icon(Icons.edit_note),
                    label: Text(t.rapManageTitle),
                  ),
                ),
              if (load.offline || noMoney)
                PkNote(load.offline ? t.rapOfflineNoBudget : t.rapNoPrices, margin: const EdgeInsets.only(top: 8)),
              const SizedBox(height: 12),
              if (load.items.isEmpty && load.missing)
                PkCard(
                  key: const Key('project-rap-missing'),
                  color: context.pk.badBg,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.block, color: context.pk.badOn),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              t.rapMissingBlock,
                              style: TextStyle(fontWeight: FontWeight.w700, color: context.pk.badOn),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              t.rapMissingProjectDetail,
                              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: context.pk.badOn),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                )
              else if (load.items.isEmpty)
                PkEmptyState(icon: Icons.table_rows_outlined, message: t.rapNoItemsProject)
              else if (items.isEmpty)
                PkEmptyState(icon: Icons.search_off, message: t.noSearchResults)
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
          Text(k, style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          const SizedBox(height: 2),
          Text(
            v,
            style: pkMoneyStyle(context, base: theme.textTheme.bodyMedium, color: color),
          ),
        ],
      ),
    );
    return PkCard(
      key: Key('rap-item-${i.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      color: i.active ? null : theme.colorScheme.surfaceContainerHighest,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              PkIconChip(icon: Icons.table_rows_outlined, tone: over ? PkTone.bad : PkTone.info, size: 34),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(i.label, style: pkTitleStyle(context)),
                    if (i.qty != null || i.uom.isNotEmpty)
                      Text(
                        [if (i.qty != null) formatQty(i.qty!), i.uom].where((e) => e.isNotEmpty).join(' '),
                        style: pkMetaStyle(context),
                      ),
                  ],
                ),
              ),
              if (!i.active) ...[const SizedBox(width: 6), PkPill(label: t.rapInactive)],
            ],
          ),
          if (i.planned != null) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                fig(t.rapPlanned, _money(i.planned)),
                fig(t.rapRealised, _money(i.realised ?? 0)),
                fig(t.rapRemainingLabel, _money(i.remaining), color: over ? context.pk.badText : null),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: PkProgressBar(value: i.progress ?? 0, color: over ? context.pk.badText : null),
                ),
                const SizedBox(width: 10),
                Text(
                  i.percent == null ? '-' : formatPercent(i.percent!, digits: 0),
                  style: theme.textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: over ? context.pk.badText : null,
                  ),
                ),
              ],
            ),
            if (over)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: RapOverBudgetChip(key: Key('rap-item-${i.id}-over')),
              ),
          ],
        ],
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
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
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
                        PkEmptyState(
                          icon: Icons.receipt_long_outlined,
                          message: _q.isEmpty && _status == null ? t.projectNoRequests : t.projectsNoMatch,
                        ),
                      ],
                    )
                  : ListView.separated(
                      key: const Key('project-requests'),
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                      itemCount: s.items.length + (s.hasMore ? 1 : 0),
                      separatorBuilder: (_, _) => const SizedBox(height: 10),
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

/// Soft tone of a request status (draft neutral, waiting warn, approved / done ok, rejected / cancelled bad).
PkTone _requestTone(RequestStatus s) => switch (s) {
  RequestStatus.draft || RequestStatus.unknown => PkTone.neutral,
  RequestStatus.pendingAck || RequestStatus.pendingApproval => PkTone.warn,
  RequestStatus.receiptRevision || RequestStatus.lpjRevision => PkTone.warn,
  RequestStatus.rejected || RequestStatus.cancelled => PkTone.bad,
  RequestStatus.completed || RequestStatus.lpjVerified || RequestStatus.transferred => PkTone.ok,
  _ => PkTone.info,
};

class _RequestTile extends StatelessWidget {
  const _RequestTile({required this.r, required this.theme});
  final ExpenseSummary r;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) => PkCard(
    key: Key('project-request-${r.id}'),
    padding: const EdgeInsets.all(14),
    onTap: () => context.push('/requests/${r.id}'),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        PkIconChip(
          icon: r.type == RequestType.reimburse ? Icons.receipt_outlined : Icons.request_quote_outlined,
          size: 36,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${r.docNo ?? '-'} · ${r.typeLabel}', style: pkMetaStyle(context)),
              const SizedBox(height: 2),
              Text(r.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: pkTitleStyle(context)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  PkPill(label: r.statusLabel, tone: _requestTone(r.status)),
                  if (r.neededDate != null) Text(formatDateOnly(r.neededDate), style: pkMetaStyle(context)),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Text(formatRupiah(r.grandTotal), style: pkMoneyStyle(context)),
      ],
    ),
  );
}
