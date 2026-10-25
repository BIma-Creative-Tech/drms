import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/list_search.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_proyek.dart';
import '../domain/intercompany_loan.dart';
import '../domain/loan.dart';
import 'intercompany_loan_providers.dart';
import 'intercompany_loan_screens.dart';
import 'loan_providers.dart';
import 'loan_widgets.dart';

/// Filters of a loan list (web ListToolbar: status, peran, terlambat, search).
class LoanListFilter {
  const LoanListFilter({this.status, this.role, this.overdue = false, this.q = ''});
  final String? status;

  /// `borrower` | `lender` | null.
  final String? role;
  final bool overdue;
  final String q;

  bool get active => status != null || role != null || overdue || q.isNotEmpty;

  @override
  bool operator ==(Object other) =>
      other is LoanListFilter &&
      other.status == status &&
      other.role == role &&
      other.overdue == overdue &&
      other.q == q;

  @override
  int get hashCode => Object.hash(status, role, overdue, q);
}

/// First page (+ summary) of "Pinjaman antar project" for a filter.
final loanListProvider = FutureProvider.autoDispose.family<LoanPage, LoanListFilter>(
  (ref, f) => ref
      .watch(loansApiProvider)
      .list(status: f.status, role: f.role, overdue: f.overdue, q: f.q, limit: 25, summary: true),
);

/// First page (+ summary) of "Pinjaman antar-PT" for a filter.
final icLoanListProvider = FutureProvider.autoDispose.family<IcLoanPage, LoanListFilter>(
  (ref, f) => ref
      .watch(intercompanyLoansApiProvider)
      .list(status: f.status, role: f.role, overdue: f.overdue, q: f.q, summary: true),
);

/// Shared filter row: status (single pick), Peminjam / Pemberi, Terlambat.
class _LoanFilterBar extends StatelessWidget {
  const _LoanFilterBar({
    required this.filter,
    required this.statuses,
    required this.roleLabels,
    required this.onChanged,
    required this.keyPrefix,
  });
  final LoanListFilter filter;
  final List<(String, String)> statuses;
  final (String, String) roleLabels;
  final ValueChanged<LoanListFilter> onChanged;
  final String keyPrefix;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final f = filter;
    LoanListFilter copy({String? Function()? status, String? Function()? role, bool? overdue}) => LoanListFilter(
      status: status == null ? f.status : status(),
      role: role == null ? f.role : role(),
      overdue: overdue ?? f.overdue,
      q: f.q,
    );
    final statusLabel = statuses.where((s) => s.$1 == f.status).firstOrNull?.$2;
    return SizedBox(
      height: 60,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: FilterChip(
              key: Key('$keyPrefix-filter-status'),
              label: Text(statusLabel ?? t.filterAllStatuses),
              selected: f.status != null,
              onSelected: (_) async {
                final v = await showModalBottomSheet<String>(
                  context: context,
                  showDragHandle: true,
                  builder: (c) => SafeArea(
                    child: ListView(
                      shrinkWrap: true,
                      children: [
                        ListTile(title: Text(t.filterAllStatuses), onTap: () => Navigator.pop(c, '')),
                        for (final (code, label) in statuses)
                          ListTile(
                            key: Key('$keyPrefix-status-$code'),
                            title: Text(label),
                            trailing: code == f.status ? const Icon(Icons.check) : null,
                            onTap: () => Navigator.pop(c, code),
                          ),
                      ],
                    ),
                  ),
                );
                if (v != null) onChanged(copy(status: () => v.isEmpty ? null : v));
              },
            ),
          ),
          for (final (role, label) in [('borrower', roleLabels.$1), ('lender', roleLabels.$2)])
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: FilterChip(
                key: Key('$keyPrefix-filter-$role'),
                label: Text(label),
                selected: f.role == role,
                onSelected: (_) => onChanged(copy(role: () => f.role == role ? null : role)),
              ),
            ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: FilterChip(
              key: Key('$keyPrefix-filter-overdue'),
              label: Text(t.loanOverdueOnly),
              selected: f.overdue,
              onSelected: (v) => onChanged(copy(overdue: v)),
            ),
          ),
        ],
      ),
    );
  }
}

Widget _kpi(
  BuildContext context,
  String key,
  String label,
  String value,
  String sub, {
  required Object icon,
  PkTone tone = PkTone.info,
  VoidCallback? onTap,
}) => PkMiniKpi(key: Key(key), icon: icon, label: label, value: value, sub: sub, tone: tone, onTap: onTap);

/// User 2026-10-19 (phase 3): the web "Pinjaman antar project" list (`/admin/pinjaman`) — tiles, search + filters,
/// newest first, "+ Ajukan pinjaman" for a PM of a borrower project, "Menunggu saya (n)" for the Direktur.
class LoanListScreen extends ConsumerStatefulWidget {
  const LoanListScreen({super.key});

  @override
  ConsumerState<LoanListScreen> createState() => _LoanListScreenState();
}

class _LoanListScreenState extends ConsumerState<LoanListScreen> {
  LoanListFilter _f = const LoanListFilter();
  final List<Loan> _more = [];
  int _page = 1;
  bool _loadingMore = false;

  void _set(LoanListFilter f) => setState(() {
    _f = f;
    _more.clear();
    _page = 1;
  });

  Future<void> _loadMore(LoanPage first) async {
    if (_loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final next = await ref
          .read(loansApiProvider)
          .list(status: _f.status, role: _f.role, overdue: _f.overdue, q: _f.q, page: _page + 1, limit: 25);
      if (!mounted) return;
      setState(() {
        _page = next.page;
        _more.addAll(next.items.where((l) => !first.items.any((x) => x.id == l.id)));
      });
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(loanListProvider(_f));
    final s = value.value?.summary;
    return Scaffold(
      appBar: AppBar(title: Text(t.loanListTitle)),
      floatingActionButton: s?.canCreate == true
          ? FloatingActionButton.extended(
              key: const Key('loan-list-new'),
              onPressed: () async {
                await context.push('/loans/new');
                ref.invalidate(loanListProvider);
              },
              icon: const Icon(Icons.add),
              label: Text(t.loanNew),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () {
          setState(() {
            _more.clear();
            _page = 1;
          });
          return ref.refresh(loanListProvider(_f).future);
        },
        child: AsyncBody<LoanPage>(
          value: value,
          onRetry: () => ref.invalidate(loanListProvider(_f)),
          data: (page) {
            final items = [...page.items, ..._more];
            final sum = page.summary;
            return ListView(
              key: const Key('loan-list'),
              padding: const EdgeInsets.only(bottom: 88),
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: Text(t.loanListNote, style: pkMetaStyle(context)),
                ),
                if (sum != null) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    child: PkKpiRow(
                      children: [
                        _kpi(
                          context,
                          'loan-kpi-pending',
                          t.loanKpiPending,
                          '${sum.pending}',
                          sum.inboxCount == 0 ? t.loanKpiPendingNone : t.loanKpiPendingMine(sum.inboxCount),
                          icon: Icons.hourglass_top,
                          tone: sum.inboxCount > 0 ? PkTone.warn : PkTone.info,
                          onTap: () => _set(LoanListFilter(status: LoanStatus.pendingApproval.code)),
                        ),
                        _kpi(
                          context,
                          'loan-kpi-overdue',
                          t.loanOverdueOnly,
                          '${sum.overdueCount}',
                          sum.overdueCount == 0 ? t.loanKpiOverdueNone : t.loanKpiOverdueSum(formatRupiah(sum.overdue)),
                          icon: Icons.warning_amber_rounded,
                          tone: sum.overdueCount > 0 ? PkTone.bad : PkTone.ok,
                          onTap: () => _set(const LoanListFilter(overdue: true)),
                        ),
                        _kpi(
                          context,
                          'loan-kpi-outstanding',
                          t.loanOutstanding,
                          formatRupiah(sum.outstanding),
                          t.loanKpiOutstandingSub(formatRupiah(sum.amount), formatRupiah(sum.repaid)),
                          icon: Icons.account_balance_wallet_outlined,
                          tone: PkTone.primary,
                        ),
                      ],
                    ),
                  ),
                  if (sum.inboxCount > 0)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                      child: OutlinedButton.icon(
                        key: const Key('loan-list-inbox'),
                        onPressed: () => context.go('/inbox'),
                        icon: const Icon(Icons.inbox_outlined),
                        label: Text(t.loanWaitingMine(sum.inboxCount)),
                      ),
                    ),
                ],
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                  child: ListSearchField(
                    key: const Key('loan-list-search'),
                    hint: t.loanListSearchHint,
                    initial: _f.q,
                    onChanged: (v) => _set(LoanListFilter(status: _f.status, role: _f.role, overdue: _f.overdue, q: v)),
                  ),
                ),
                _LoanFilterBar(
                  filter: _f,
                  keyPrefix: 'loan',
                  statuses: [for (final st in LoanStatus.values) (st.code, st.label)],
                  roleLabels: (t.loanFilterBorrower, t.loanFilterLender),
                  onChanged: _set,
                ),
                if (items.isEmpty)
                  PkEmptyState(
                    key: const Key('loan-list-empty'),
                    icon: Icons.swap_horiz,
                    message: _f.active ? t.loanListEmptyFiltered : t.loanListEmpty,
                  ),
                for (final l in items)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: LoanCard(loan: l),
                  ),
                if (_page < page.totalPages)
                  _loadingMore
                      ? const Padding(
                          padding: EdgeInsets.all(16),
                          child: Center(child: CircularProgressIndicator()),
                        )
                      : LoadMoreTrigger(key: ValueKey('loan-more-${items.length}'), onLoad: () => _loadMore(page)),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// User 2026-10-19 (phase 3): the web "Pinjaman antar-PT" list (`/admin/pinjaman-antar-pt`) — Piutang / Hutang /
/// Terlambat tiles, search + filters, "Pencairan menunggu (n)" for Finance of a lender PT.
class IcLoanListScreen extends ConsumerStatefulWidget {
  const IcLoanListScreen({super.key});

  @override
  ConsumerState<IcLoanListScreen> createState() => _IcLoanListScreenState();
}

class _IcLoanListScreenState extends ConsumerState<IcLoanListScreen> {
  LoanListFilter _f = const LoanListFilter();
  final List<IcLoan> _more = [];
  int _page = 1;
  bool _loadingMore = false;

  void _set(LoanListFilter f) => setState(() {
    _f = f;
    _more.clear();
    _page = 1;
  });

  Future<void> _loadMore(IcLoanPage first) async {
    if (_loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final next = await ref
          .read(intercompanyLoansApiProvider)
          .list(status: _f.status, role: _f.role, overdue: _f.overdue, q: _f.q, page: _page + 1);
      if (!mounted) return;
      setState(() {
        _page = next.page;
        _more.addAll(next.items.where((l) => !first.items.any((x) => x.id == l.id)));
      });
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(icLoanListProvider(_f));
    return Scaffold(
      appBar: AppBar(title: Text(t.icLoanListTitle)),
      body: RefreshIndicator(
        onRefresh: () {
          setState(() {
            _more.clear();
            _page = 1;
          });
          return ref.refresh(icLoanListProvider(_f).future);
        },
        child: AsyncBody<IcLoanPage>(
          value: value,
          onRetry: () => ref.invalidate(icLoanListProvider(_f)),
          data: (page) {
            final items = [...page.items, ..._more];
            final sum = page.summary;
            return ListView(
              key: const Key('icloan-list'),
              padding: const EdgeInsets.only(bottom: 24),
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: Text(t.icLoanListNote, style: pkMetaStyle(context)),
                ),
                if (sum != null) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    child: PkKpiRow(
                      children: [
                        _kpi(
                          context,
                          'icloan-kpi-receivable',
                          t.icLoanKpiReceivable,
                          formatRupiah(sum.receivable),
                          t.icLoanSideLender,
                          icon: Icons.call_made,
                          tone: PkTone.ok,
                          onTap: () => _set(const LoanListFilter(role: 'lender')),
                        ),
                        _kpi(
                          context,
                          'icloan-kpi-payable',
                          t.icLoanKpiPayable,
                          formatRupiah(sum.payable),
                          t.icLoanSideBorrower,
                          icon: Icons.call_received,
                          tone: PkTone.warn,
                          onTap: () => _set(const LoanListFilter(role: 'borrower')),
                        ),
                        _kpi(
                          context,
                          'icloan-kpi-overdue',
                          t.loanOverdueOnly,
                          formatRupiah(sum.overdue),
                          t.icLoanKpiOverdueSub,
                          icon: Icons.warning_amber_rounded,
                          tone: sum.overdue > 0 ? PkTone.bad : PkTone.ok,
                          onTap: () => _set(const LoanListFilter(overdue: true)),
                        ),
                      ],
                    ),
                  ),
                  if (sum.queueCount > 0)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                      child: OutlinedButton.icon(
                        key: const Key('icloan-list-queue'),
                        onPressed: () => context.push('/finance'),
                        icon: const Icon(Icons.account_balance),
                        label: Text(t.icLoanQueueWaiting(sum.queueCount)),
                      ),
                    ),
                ],
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                  child: ListSearchField(
                    key: const Key('icloan-list-search'),
                    hint: t.icLoanListSearchHint,
                    initial: _f.q,
                    onChanged: (v) => _set(LoanListFilter(status: _f.status, role: _f.role, overdue: _f.overdue, q: v)),
                  ),
                ),
                _LoanFilterBar(
                  filter: _f,
                  keyPrefix: 'icloan',
                  statuses: [for (final st in IcLoanStatus.values) (st.code, st.label)],
                  roleLabels: (t.icLoanSideBorrower, t.icLoanSideLender),
                  onChanged: _set,
                ),
                if (items.isEmpty)
                  PkEmptyState(
                    key: const Key('icloan-list-empty'),
                    icon: Icons.business,
                    message: _f.active ? t.icLoanListEmptyFiltered : t.icLoanListEmpty,
                  ),
                for (final l in items)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: _IcLoanCard(loan: l),
                  ),
                if (_page < page.totalPages)
                  _loadingMore
                      ? const Padding(
                          padding: EdgeInsets.all(16),
                          child: Center(child: CircularProgressIndicator()),
                        )
                      : LoadMoreTrigger(key: ValueKey('icloan-more-${items.length}'), onLoad: () => _loadMore(page)),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// One inter-PT loan: PJA number, status, lender → borrower, amount / outstanding, due date.
class _IcLoanCard extends StatelessWidget {
  const _IcLoanCard({required this.loan});
  final IcLoan loan;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final l = loan;
    return PkCard(
      key: Key('icloan-${l.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: () => context.push(icLoanPath(l.id)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PkIconChip(icon: Icons.business, tone: l.overdue ? PkTone.bad : PkTone.info, size: 38),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l.docNo,
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(t.icLoanFlow(l.lenderCode, l.borrowerCode), style: pkTitleStyle(context)),
                const SizedBox(height: 2),
                Text(
                  l.status.active
                      ? t.icLoanCardFigures(formatRupiah(l.amount), formatRupiah(l.outstanding))
                      : formatRupiah(l.amount),
                  style: pkAmountStyle(
                    context,
                    base: theme.textTheme.bodyMedium,
                  )?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    IcLoanStatusChip(loan: l),
                    if (l.overdue)
                      PkPill(
                        icon: Icons.warning_amber_rounded,
                        tone: PkTone.bad,
                        label: t.loanOverdueDays(l.daysOverdue),
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(t.loanDueOn(formatDateOnly(l.dueDate)), style: pkMetaStyle(context)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
