import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../app/theme.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/network/api_exception.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/list_search.dart';
import '../../../shared/widgets/photo_viewer.dart';
import '../../../shared/widgets/reason_dialog.dart';
import '../../auth/application/auth_controller.dart';
import '../../companies/presentation/company_chip.dart';
import '../application/cash_providers.dart';
import '../domain/cash_book.dart';

/// User 2026-10-19 (APK ↔ web parity, phase 3): the web "Kas" page (`/admin/kas`, Finance / Direktur) — balance per
/// account, filters (akun, periode, arah, status, sumber, PT, search), the ledger newest first with void rows and their
/// reversals linked, and the row actions of Finance of the row's PT (Bukti, Edit, Void). Direktur reads only.
class CashBookScreen extends ConsumerStatefulWidget {
  const CashBookScreen({super.key, this.initial = const CashFilter()});
  final CashFilter initial;

  @override
  ConsumerState<CashBookScreen> createState() => _CashBookScreenState();
}

class _CashBookScreenState extends ConsumerState<CashBookScreen> {
  late CashFilter _filter = widget.initial;

  /// Pages after the first one (load more), reset with the filter.
  final List<CashRow> _more = [];
  int _page = 1;
  bool _loadingMore = false;

  void _setFilter(CashFilter f) => setState(() {
    _filter = f;
    _more.clear();
    _page = 1;
  });

  Future<void> _refresh() async {
    setState(() {
      _more.clear();
      _page = 1;
    });
    ref.invalidate(cashBookProvider(_filter));
    await ref.read(cashBookProvider(_filter).future);
  }

  Future<void> _loadMore(CashBook first) async {
    if (_loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final next = await ref.read(cashApiProvider).book(_filter, page: _page + 1);
      if (!mounted) return;
      setState(() {
        _page = next.page;
        _more.addAll(next.rows.where((r) => !first.rows.any((x) => x.id == r.id) && !_more.any((x) => x.id == r.id)));
      });
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  Future<void> _newEntry(CashBook book, {required bool inbound}) async {
    final pt = _filter.pt;
    final saved = await context.push<bool>(
      '/cash/new?arah=${inbound ? 'masuk' : 'keluar'}${pt != null ? '&pt=$pt' : ''}',
    );
    if (saved == true && mounted) await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(cashBookProvider(_filter));
    final book = value.value;
    return Scaffold(
      appBar: AppBar(
        title: Text(t.cashTitle),
        actions: [
          IconButton(
            key: const Key('cash-closings'),
            tooltip: t.closingTitle,
            icon: const Icon(Icons.lock_clock_outlined),
            onPressed: () => context.push(_filter.pt == null ? '/closings' : '/closings?pt=${_filter.pt}'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: AsyncBody<CashBook>(
          value: value,
          onRetry: () => ref.invalidate(cashBookProvider(_filter)),
          data: (b) => _body(context, b),
        ),
      ),
      bottomNavigationBar: book != null && book.canWrite
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        key: const Key('cash-new-in'),
                        onPressed: () => _newEntry(book, inbound: true),
                        icon: const Icon(Icons.south),
                        label: Text(t.cashIn),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton.icon(
                        key: const Key('cash-new-out'),
                        onPressed: () => _newEntry(book, inbound: false),
                        icon: const Icon(Icons.north),
                        label: Text(t.cashOut),
                      ),
                    ),
                  ],
                ),
              ),
            )
          : null,
    );
  }

  Widget _body(BuildContext context, CashBook b) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final p = ref.watch(currentProfileProvider);
    final multi = b.pts.length > 1;
    String code(int? c) => p?.companyCode(c ?? -1) ?? '#$c';
    final lockText = b.pts.length == 1
        ? t.cashLockOne(
            b.pts.single.lockDate == null ? t.cashLockNone : t.cashLockUntil(dayMonth(b.pts.single.lockDate)),
          )
        : t.cashLockOne(
            b.pts
                .map(
                  (x) =>
                      '${code(x.companyId)} ${x.lockDate == null ? t.cashLockNone : t.cashLockUntil(dayMonth(x.lockDate))}',
                )
                .join(' · '),
          );
    final rows = [...b.rows, ..._more];
    final more = _page < b.totalPages;
    return ListView(
      key: const Key('cash-book'),
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
      children: [
        Text('${t.cashAsOf(dayMonth(b.today))} · $lockText', style: theme.textTheme.bodySmall),
        const SizedBox(height: 4),
        Text(
          t.cashIcReceiving(
            b.pts
                .map(
                  (x) => '${multi ? '${code(x.companyId)}: ' : ''}${x.intercompanyReceiving ?? t.cashIcReceivingNone}',
                )
                .join(' · '),
          ),
          key: const Key('cash-ic-receiving'),
          style: theme.textTheme.bodySmall,
        ),
        if (!b.canWrite)
          Card(
            key: const Key('cash-read-only'),
            margin: const EdgeInsets.only(top: 8),
            color: theme.colorScheme.secondaryContainer,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Text(multi ? t.cashReadOnlyMulti : t.cashReadOnly),
            ),
          ),
        const SizedBox(height: 8),
        _BalanceTiles(
          book: b,
          multi: multi && _filter.pt == null,
          selected: _filter.accounts,
          onAccount: (id) => _setFilter(_filter.copyWith(accounts: {id})),
        ),
        const SizedBox(height: 8),
        ListSearchField(
          key: const Key('cash-search'),
          hint: t.cashSearchHint,
          initial: _filter.q,
          onChanged: (v) => _setFilter(_filter.copyWith(q: v)),
        ),
        _FilterBar(book: b, filter: _filter, onChanged: _setFilter),
        const SizedBox(height: 4),
        Text(
          t.cashBookSub(b.totalDocs, _filter.active || _filter.q.isNotEmpty ? t.cashFiltered : ''),
          style: theme.textTheme.bodySmall,
        ),
        const SizedBox(height: 8),
        if (rows.isEmpty)
          Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              children: [
                Text(
                  _filter.active || _filter.q.isNotEmpty ? t.cashEmptyFiltered : t.cashEmpty,
                  key: const Key('cash-empty'),
                  textAlign: TextAlign.center,
                ),
                if (_filter.active || _filter.q.isNotEmpty)
                  TextButton(onPressed: () => _setFilter(const CashFilter()), child: Text(t.cashClearFilter)),
              ],
            ),
          )
        else ...[
          for (final r in rows)
            CashEntryCard(row: r, book: b, showPt: multi && _filter.pt == null, onChanged: _refresh),
          if (more)
            _loadingMore
                ? const Padding(
                    padding: EdgeInsets.all(16),
                    child: Center(child: CircularProgressIndicator()),
                  )
                : LoadMoreTrigger(key: ValueKey('cash-more-${rows.length}'), onLoad: () => _loadMore(b))
          else
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                t.cashShownOf(rows.length, b.totalDocs),
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall,
              ),
            ),
        ],
      ],
    );
  }
}

/// "Saldo kas total" + one tile per account (balance, this month's in / out). A tile filters the book to its account.
class _BalanceTiles extends ConsumerWidget {
  const _BalanceTiles({required this.book, required this.multi, required this.selected, required this.onAccount});
  final CashBook book;
  final bool multi;
  final Set<int> selected;
  final ValueChanged<int> onAccount;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final p = ref.watch(currentProfileProvider);
    final money = theme.textTheme.titleMedium?.copyWith(
      fontWeight: FontWeight.w700,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Card(
          key: const Key('cash-total'),
          margin: EdgeInsets.zero,
          color: theme.colorScheme.primaryContainer,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t.cashTotal, style: theme.textTheme.labelLarge),
                Text(formatRupiah(book.total), key: const Key('cash-total-value'), style: money),
                Text(t.cashTotalSub(book.accounts.length), style: theme.textTheme.bodySmall),
                if (multi)
                  for (final e in book.byPt.entries)
                    Text(
                      '${p?.companyCode(e.key) ?? '#${e.key}'} · ${formatRupiah(e.value)}',
                      style: theme.textTheme.bodySmall,
                    ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        LayoutBuilder(
          builder: (context, c) {
            final cols = c.maxWidth >= 600 ? 3 : 2;
            final w = (c.maxWidth - 8 * (cols - 1)) / cols;
            return Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final a in book.accounts)
                  SizedBox(
                    width: w,
                    child: Card(
                      key: Key('cash-acc-${a.cashAccountId}'),
                      margin: EdgeInsets.zero,
                      shape: selected.contains(a.cashAccountId)
                          ? RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                              side: BorderSide(color: theme.colorScheme.primary, width: 2),
                            )
                          : null,
                      child: InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: () => onAccount(a.cashAccountId),
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                multi ? '${p?.companyCode(a.companyId ?? -1) ?? ''} · ${a.name}' : a.name,
                                style: theme.textTheme.labelMedium,
                              ),
                              Text(
                                formatRupiah(a.balance),
                                style: theme.textTheme.bodyLarge?.copyWith(
                                  fontWeight: FontWeight.w700,
                                  fontFeatures: const [FontFeature.tabularFigures()],
                                ),
                              ),
                              Text(
                                t.cashFlows(
                                  periodLabel(book.flowPeriod),
                                  formatRupiah(a.flowIn),
                                  formatRupiah(a.flowOut),
                                ),
                                style: theme.textTheme.bodySmall,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

/// The web FilterBar as chips: Akun, Periode, Arah, Status, Sumber, PT (several PTs) and "Hapus filter".
class _FilterBar extends ConsumerWidget {
  const _FilterBar({required this.book, required this.filter, required this.onChanged});
  final CashBook book;
  final CashFilter filter;
  final ValueChanged<CashFilter> onChanged;

  Future<T?> _pick<T>(BuildContext context, String title, List<(T, String)> options, T? current) =>
      showModalBottomSheet<T>(
        context: context,
        showDragHandle: true,
        isScrollControlled: true,
        builder: (c) => SafeArea(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(c).height * 0.7),
            child: ListView(
              shrinkWrap: true,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
                  child: Text(title, style: Theme.of(c).textTheme.titleMedium),
                ),
                for (final (v, label) in options)
                  ListTile(
                    key: Key('cash-pick-$v'),
                    title: Text(label),
                    trailing: v == current ? const Icon(Icons.check) : null,
                    onTap: () => Navigator.pop(c, v),
                  ),
              ],
            ),
          ),
        ),
      );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final p = ref.watch(currentProfileProvider);
    final lk = book.lookups;
    final accountId = filter.accounts.length == 1 ? filter.accounts.first : null;
    final source = filter.sources.length == 1 ? filter.sources.first : null;
    // the last 13 months, newest first (the web month input)
    final now = DateTime.tryParse(book.today) ?? DateTime.now();
    final months = [
      for (var i = 0; i < 13; i++)
        '${DateTime(now.year, now.month - i).year}-${DateTime(now.year, now.month - i).month.toString().padLeft(2, '0')}',
    ];
    Widget chip(String key, String label, bool on, VoidCallback onTap) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: FilterChip(key: Key('cash-filter-$key'), label: Text(label), selected: on, onSelected: (_) => onTap()),
    );
    const all = -1;
    return SizedBox(
      height: 52,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(vertical: 6),
        children: [
          if (book.pts.length > 1)
            chip(
              'pt',
              filter.pt == null ? t.cashFilterPt : p?.companyCode(filter.pt!) ?? '#${filter.pt}',
              filter.pt != null,
              () async {
                final v = await _pick<int>(context, t.cashFilterPt, [
                  (all, t.cashAllPts),
                  for (final x in book.pts)
                    (x.companyId, '${p?.companyCode(x.companyId) ?? ''} ${p?.company(x.companyId)?.name ?? ''}'.trim()),
                ], filter.pt);
                if (v != null) onChanged(filter.copyWith(pt: () => v == all ? null : v, accounts: const {}));
              },
            ),
          chip(
            'account',
            accountId == null
                ? (filter.accounts.isEmpty ? t.cashFilterAccount : t.cashFilterAccounts(filter.accounts.length))
                : CashLookups.labelOf(lk.accounts, accountId) ?? '#$accountId',
            filter.accounts.isNotEmpty,
            () async {
              final v = await _pick<int>(context, t.cashFilterAccount, [
                (all, t.cashAllAccounts),
                for (final a in lk.accounts) (a.id, a.active ? a.label : '${a.label} ${t.inactiveSuffix}'),
              ], accountId);
              if (v != null) onChanged(filter.copyWith(accounts: v == all ? const {} : {v}));
            },
          ),
          chip(
            'period',
            filter.period == null ? t.cashFilterPeriod : periodLabel(filter.period!),
            filter.period != null,
            () async {
              final v = await _pick<String>(context, t.cashFilterPeriod, [
                ('', t.cashAllPeriods),
                for (final m in months) (m, periodLabel(m)),
              ], filter.period);
              if (v != null) onChanged(filter.copyWith(period: () => v.isEmpty ? null : v));
            },
          ),
          chip('in', t.cashIn, filter.direction == 'masuk', () {
            onChanged(filter.copyWith(direction: () => filter.direction == 'masuk' ? null : 'masuk'));
          }),
          chip('out', t.cashOut, filter.direction == 'keluar', () {
            onChanged(filter.copyWith(direction: () => filter.direction == 'keluar' ? null : 'keluar'));
          }),
          chip('void', t.cashStatusVoid, filter.status == 'void', () {
            onChanged(filter.copyWith(status: () => filter.status == 'void' ? null : 'void'));
          }),
          chip(
            'source',
            source == null ? t.cashFilterSource : cashSourceLabels[source] ?? source,
            filter.sources.isNotEmpty,
            () async {
              final v = await _pick<String>(context, t.cashFilterSource, [
                ('', t.cashAllSources),
                for (final e in cashSourceLabels.entries) (e.key, e.value),
              ], source);
              if (v != null) onChanged(filter.copyWith(sources: v.isEmpty ? const {} : {v}));
            },
          ),
          if (filter.active)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: ActionChip(
                key: const Key('cash-filter-clear'),
                avatar: const Icon(Icons.clear, size: 18),
                label: Text(t.cashClearFilter),
                onPressed: () => onChanged(CashFilter(q: filter.q)),
              ),
            ),
        ],
      ),
    );
  }
}

/// One ledger row (web LedgerTable, phone card): PT · date, number + description, void / reversal / request /
/// intercompany links, account, "Dibebankan / kategori", status pill, ± amount. Tap = the row sheet (Bukti, Edit, Void).
class CashEntryCard extends ConsumerWidget {
  const CashEntryCard({
    super.key,
    required this.row,
    required this.book,
    required this.showPt,
    required this.onChanged,
  });
  final CashRow row;
  final CashBook book;
  final bool showPt;
  final Future<void> Function() onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final r = row;
    final lk = book.lookups;
    final (pillText, pillColor) = r.voided
        ? (t.cashStatusVoid, context.pk.badText)
        : r.isReversal
        ? (t.cashStatusReversal, context.pk.warnText)
        : (t.cashStatusPosted, context.pk.okText);
    final scope =
        CashLookups.labelOf(lk.projects, r.projectId) ?? CashLookups.labelOf(lk.costCenters, r.costCenterId) ?? '—';
    final cat = [
      CashLookups.labelOf(lk.categories, r.categoryId) ?? CashLookups.labelOf(lk.sources, r.cashInSourceId),
      CashLookups.labelOf(lk.vehicles, r.vehicleId),
    ].whereType<String>().join(' · ');
    final small = theme.textTheme.bodySmall;
    final strike = r.voided ? const TextStyle(decoration: TextDecoration.lineThrough) : null;
    return Card(
      key: Key('cash-row-${r.id}'),
      margin: const EdgeInsets.only(bottom: 8),
      color: r.voided ? theme.colorScheme.surfaceContainerHighest : null,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => showCashEntrySheet(context, ref, row: r, book: book, onChanged: onChanged),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (showPt) CompanyChipLead(companyId: r.companyId),
                  Expanded(child: Text(dayMonth(r.entryDate), style: theme.textTheme.labelMedium)),
                  _Pill(text: pillText, color: pillColor),
                ],
              ),
              const SizedBox(height: 4),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          r.entryNo,
                          key: Key('cash-row-${r.id}-no'),
                          style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary),
                        ),
                        Text(r.description ?? r.sourceLabel, style: theme.textTheme.bodyMedium?.merge(strike)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    '${r.inbound ? '+' : '−'} ${formatRupiah(r.amount)}',
                    key: Key('cash-row-${r.id}-amount'),
                    style: theme.textTheme.titleSmall
                        ?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: r.inbound ? context.pk.okText : null,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        )
                        .merge(strike),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(CashLookups.labelOf(lk.accounts, r.cashAccountId) ?? '#${r.cashAccountId}', style: small),
              Text('$scope · ${cat.isEmpty ? r.sourceLabel : cat}', style: small),
              ...cashRowLinks(
                t,
                r,
              ).map((l) => Text(l, style: small?.copyWith(color: theme.colorScheme.onSurfaceVariant))),
            ],
          ),
        ),
      ),
    );
  }
}

/// The web link lines under a row: "Void: … · dibalik oleh KM/…", "Jurnal balik dari KK/…", "Pengajuan PB/…", Antar PT.
List<String> cashRowLinks(AppLocalizations t, CashRow r) => [
  if (r.voided)
    [t.cashVoidReason(r.voidReason ?? '—'), if (r.reversedBy != null) t.cashReversedBy(r.reversedBy!.no)].join(' · '),
  if (r.reversalOf != null) t.cashReversalOf(r.reversalOf!.no),
  if (r.request != null) t.cashRequestLink(r.request!.no),
  if (r.intercompany != null) r.intercompany!.text,
];

class _Pill extends StatelessWidget {
  const _Pill({required this.text, required this.color});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
    child: Text(
      text,
      style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color, fontWeight: FontWeight.w700),
    ),
  );
}

/// Row sheet: the entry's fields and the actions of Finance of its PT (the server decides: `canEdit` / `canVoid`,
/// `voidHint` when there is no Void). Void asks for a reason (web ReasonAction text).
Future<void> showCashEntrySheet(
  BuildContext context,
  WidgetRef ref, {
  required CashRow row,
  required CashBook book,
  required Future<void> Function() onChanged,
}) => showModalBottomSheet<void>(
  context: context,
  showDragHandle: true,
  isScrollControlled: true,
  builder: (c) => _CashEntrySheet(row: row, book: book, onChanged: onChanged),
);

class _CashEntrySheet extends ConsumerStatefulWidget {
  const _CashEntrySheet({required this.row, required this.book, required this.onChanged});
  final CashRow row;
  final CashBook book;
  final Future<void> Function() onChanged;

  @override
  ConsumerState<_CashEntrySheet> createState() => _CashEntrySheetState();
}

class _CashEntrySheetState extends ConsumerState<_CashEntrySheet> {
  bool _busy = false;
  String? _key;

  Future<void> _void() async {
    final t = AppLocalizations.of(context);
    final r = widget.row;
    final lock = widget.book.pt(r.companyId)?.lockDate;
    final closed = lock != null && r.entryDate.compareTo(lock) <= 0;
    final reason = await showReasonDialog(
      context,
      title: t.cashVoidTitle(r.entryNo),
      description: t.cashVoidBody(
        r.inbound ? t.cashOutLower : t.cashInLower,
        formatRupiah(r.amount),
        closed ? t.cashVoidDatedToday : t.cashVoidDatedOn(dayMonth(r.entryDate)),
      ),
      confirm: t.cashVoidConfirm,
      keyPrefix: 'cash-void',
    );
    if (reason == null || !mounted) return;
    setState(() => _busy = true);
    try {
      _key ??= const Uuid().v4();
      final no = await ref.read(cashApiProvider).voidEntry(r.id, reason, idempotencyKey: _key!);
      if (!mounted) return;
      final done = no == null ? t.cashVoided(r.entryNo) : t.cashVoidedWith(r.entryNo, no);
      await showActionResult(context, message: done, action: t.cashVoidConfirm);
      if (!mounted) return;
      Navigator.pop(context);
      await widget.onChanged();
    } on ApiException catch (e) {
      if (mounted) await showActionError(context, e, action: t.cashVoidConfirm);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _edit() async {
    final r = widget.row;
    final nav = GoRouter.of(context);
    Navigator.pop(context);
    final saved = await nav.push<bool>('/cash/${r.id}/edit', extra: r);
    if (saved == true) await widget.onChanged();
  }

  void _proof() {
    final t = AppLocalizations.of(context);
    final id = widget.row.proofId!;
    showPhotoViewer(context, [
      ViewerPhoto(
        caption: t.cashProofOf(widget.row.entryNo),
        builder: (_) => Consumer(
          builder: (_, ref, _) => switch (ref.watch(cashAttachmentProvider(id))) {
            AsyncData(:final value) => Image.memory(
              value,
              fit: BoxFit.contain,
              errorBuilder: (_, _, _) => Center(
                child: Text(t.cashProofNotImage, style: const TextStyle(color: Colors.white)),
              ),
            ),
            AsyncError(:final error) => Center(
              child: Text(errorText(error), style: const TextStyle(color: Colors.white)),
            ),
            _ => const Center(child: CircularProgressIndicator()),
          },
        ),
      ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final r = widget.row;
    final lk = widget.book.lookups;
    final p = ref.watch(currentProfileProvider);
    Widget line(String k, String? v) => v == null || v.isEmpty
        ? const SizedBox.shrink()
        : Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(width: 130, child: Text(k, style: theme.textTheme.bodySmall)),
                Expanded(child: Text(v)),
              ],
            ),
          );
    return SafeArea(
      child: SingleChildScrollView(
        key: const Key('cash-sheet'),
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children:
              [
                    Text(r.entryNo, style: theme.textTheme.titleLarge),
                    const SizedBox(height: 8),
                    if (widget.book.pts.length > 1)
                      line(
                        t.cashPt,
                        '${p?.companyCode(r.companyId ?? -1) ?? ''} ${p?.company(r.companyId ?? -1)?.name ?? ''}'
                            .trim(),
                      ),
                    line(t.cashDate, dayMonth(r.entryDate)),
                    line(t.cashKind, r.inbound ? t.cashIn : t.cashOut),
                    line(t.cashAmount, formatRupiah(r.amount)),
                    line(t.cashAccountLabel, CashLookups.labelOf(lk.accounts, r.cashAccountId)),
                    line(
                      r.inbound ? t.cashSourceIn : t.cashCategory,
                      CashLookups.labelOf(
                        r.inbound ? lk.sources : lk.categories,
                        r.inbound ? r.cashInSourceId : r.categoryId,
                      ),
                    ),
                    line(t.cashProject, CashLookups.labelOf(lk.projects, r.projectId)),
                    line(t.cashCostCenter, CashLookups.labelOf(lk.costCenters, r.costCenterId)),
                    line(t.cashVehicle, CashLookups.labelOf(lk.vehicles, r.vehicleId)),
                    line(t.cashDescription, r.description),
                    line(t.cashSource, r.sourceLabel),
                    for (final l in cashRowLinks(t, r)) Text(l, style: theme.textTheme.bodySmall),
                    if (r.voidHint != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          r.voidHint!,
                          key: const Key('cash-void-hint'),
                          style: theme.textTheme.bodySmall?.copyWith(color: context.pk.warnText),
                        ),
                      ),
                    const SizedBox(height: 16),
                    if (r.proofId != null)
                      OutlinedButton.icon(
                        key: const Key('cash-proof'),
                        onPressed: _proof,
                        icon: const Icon(Icons.image_outlined),
                        label: Text(t.cashProof),
                      ),
                    if (r.request != null)
                      OutlinedButton.icon(
                        key: const Key('cash-open-request'),
                        onPressed: () {
                          final nav = GoRouter.of(context);
                          Navigator.pop(context);
                          nav.push('/requests/${r.request!.id}');
                        },
                        icon: const Icon(Icons.receipt_long_outlined),
                        label: Text(t.cashRequestLink(r.request!.no)),
                      ),
                    if (r.canEdit)
                      OutlinedButton.icon(
                        key: const Key('cash-edit'),
                        onPressed: _busy ? null : _edit,
                        icon: const Icon(Icons.edit_outlined),
                        label: Text(t.cashEdit),
                      ),
                    if (r.canVoid)
                      FilledButton.tonalIcon(
                        key: const Key('cash-void'),
                        onPressed: _busy ? null : _void,
                        icon: const Icon(Icons.block),
                        label: Text(_busy ? t.processing : t.cashVoid),
                      ),
                  ]
                  .map((w) => w is ButtonStyleButton ? Padding(padding: const EdgeInsets.only(bottom: 8), child: w) : w)
                  .toList(),
        ),
      ),
    );
  }
}
