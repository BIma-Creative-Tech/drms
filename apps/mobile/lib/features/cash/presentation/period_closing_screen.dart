import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../app/theme.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/network/api_exception.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/reason_dialog.dart';
import '../../auth/application/auth_controller.dart';
import '../application/cash_providers.dart';
import '../domain/cash_book.dart';

/// User 2026-10-19 (phase 3): the web "Tutup buku" (`/admin/tutup-buku`) — per PT (closing PT A never locks PT B):
/// Finance / Direktur pick the PT, see "Terkunci s/d", the last closed month and the months ready to close, the
/// 13-month overview (Masuk / Keluar without void pairs, Koreksi separately) with "Tutup buku" per closable month and
/// "Buka kembali" (Direktur, latest closed month, reason), and the closing history.
class PeriodClosingScreen extends ConsumerStatefulWidget {
  const PeriodClosingScreen({super.key, this.pt});
  final int? pt;

  @override
  ConsumerState<PeriodClosingScreen> createState() => _PeriodClosingScreenState();
}

class _PeriodClosingScreenState extends ConsumerState<PeriodClosingScreen> {
  late int? _pt = widget.pt;
  bool _busy = false;
  final _keys = <String, String>{};

  Future<void> _close(PeriodOverview o, PeriodRow r, {required bool multi}) async {
    final t = AppLocalizations.of(context);
    final p = ref.read(currentProfileProvider);
    final company = o.company!;
    final note = await showReasonDialog(
      context,
      title: t.closingCloseTitle(periodLabel(r.period), multi ? ' — ${p?.companyCode(company) ?? ''}' : ''),
      description: [
        t.closingCloseBody(dayMonth(periodEnd(r.period))),
        if (multi) t.closingOnlyPt(p?.company(company)?.name ?? p?.companyCode(company) ?? ''),
      ].join(' '),
      confirm: t.closingTitle,
      fieldLabel: t.closingNote,
      required: false,
      keyPrefix: 'close-${r.period}',
    );
    if (note == null) return;
    await _run(
      'close:$company:${r.period}',
      (key) => ref.read(cashApiProvider).close(r.period, company, note: note, idempotencyKey: key),
      t.closingClosed(periodLabel(r.period)),
    );
  }

  Future<void> _reopen(PeriodOverview o, PeriodRow r, {required bool multi}) async {
    final t = AppLocalizations.of(context);
    final p = ref.read(currentProfileProvider);
    final company = o.company!;
    final reason = await showReasonDialog(
      context,
      title: t.closingReopenTitle(periodLabel(r.period), multi ? ' — ${p?.companyCode(company) ?? ''}' : ''),
      description: t.closingReopenBody,
      confirm: t.closingReopen,
      keyPrefix: 'reopen-${r.period}',
    );
    if (reason == null) return;
    await _run(
      'reopen:$company:${r.period}:$reason',
      (key) => ref.read(cashApiProvider).reopen(r.period, company, reason, idempotencyKey: key),
      t.closingReopened(periodLabel(r.period)),
    );
  }

  Future<void> _run(String id, Future<void> Function(String key) action, String done) async {
    setState(() => _busy = true);
    try {
      await action(_keys.putIfAbsent(id, () => const Uuid().v4()));
      _keys.remove(id); // the same month may be closed again after a reopen
      if (mounted) showSnack(context, done);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message);
    } finally {
      ref.invalidate(periodOverviewProvider);
      ref.invalidate(cashBookProvider);
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(periodOverviewProvider(_pt));
    final p = ref.watch(currentProfileProvider);
    final o = value.value;
    final multi = o != null && o.locks.length > 1;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          multi && o.company != null ? '${t.closingTitle} · ${p?.companyCode(o.company!) ?? ''}' : t.closingTitle,
        ),
        actions: [
          IconButton(
            key: const Key('closing-book'),
            tooltip: t.cashTitle,
            icon: const Icon(Icons.menu_book_outlined),
            onPressed: () => context.push(o?.company != null && multi ? '/cash?pt=${o.company}' : '/cash'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(periodOverviewProvider(_pt).future),
        child: AsyncBody<PeriodOverview>(
          value: value,
          onRetry: () => ref.invalidate(periodOverviewProvider(_pt)),
          data: (o) =>
              o.company == null ? _chooser(context, o) : AbsorbPointer(absorbing: _busy, child: _body(context, o)),
        ),
      ),
    );
  }

  /// "Pilih PT" (web PtChooser): one row per PT with its current lock date.
  Widget _chooser(BuildContext context, PeriodOverview o) {
    final t = AppLocalizations.of(context);
    final p = ref.watch(currentProfileProvider);
    return ListView(
      key: const Key('closing-pt-chooser'),
      children: [
        Padding(padding: const EdgeInsets.all(16), child: Text(t.closingPickPt)),
        for (final e in o.locks.entries)
          ListTile(
            key: Key('closing-pt-${e.key}'),
            leading: const Icon(Icons.business),
            title: Text('${p?.companyCode(e.key) ?? ''} — ${p?.company(e.key)?.name ?? ''}'),
            subtitle: Text(t.closingLockedUntil(e.value == null ? t.closingNoLock : dayMonth(e.value))),
            onTap: () => setState(() => _pt = e.key),
          ),
      ],
    );
  }

  Widget _body(BuildContext context, PeriodOverview o) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final p = ref.watch(currentProfileProvider);
    final multi = o.locks.length > 1;
    Widget kpi(String key, String label, String value, String sub) => Expanded(
      child: Card(
        key: Key('closing-kpi-$key'),
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: theme.textTheme.labelSmall),
              Text(value, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
              Text(sub, style: theme.textTheme.bodySmall),
            ],
          ),
        ),
      ),
    );
    return ListView(
      key: const Key('closing-body'),
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
      children: [
        Text(
          [if (multi) p?.company(o.company!)?.name ?? '', t.closingLead].where((s) => s.isNotEmpty).join(' · '),
          style: theme.textTheme.bodySmall,
        ),
        if (multi)
          SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                for (final c in o.locks.keys)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      key: Key('closing-tab-$c'),
                      label: Text(p?.companyCode(c) ?? '#$c'),
                      selected: c == o.company,
                      onSelected: (_) => setState(() => _pt = c),
                    ),
                  ),
              ],
            ),
          ),
        const SizedBox(height: 8),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            kpi(
              'lock',
              t.closingKpiLock,
              o.lockDate == null ? t.closingNoLockShort : dayMonth(o.lockDate),
              t.closingKpiLockSub,
            ),
            const SizedBox(width: 6),
            kpi(
              'last',
              t.closingKpiLast,
              o.latestClosed == null ? '—' : periodLabel(o.latestClosed!),
              t.closingKpiLastSub(o.history.length),
            ),
            const SizedBox(width: 6),
            kpi(
              'closable',
              t.closingKpiClosable,
              '${o.closable.length}',
              o.closable.isEmpty ? t.closingKpiClosableNone : o.closable.map(periodLabel).join(', '),
            ),
          ],
        ),
        const SizedBox(height: 16),
        Text(t.closingPerMonth, style: theme.textTheme.titleMedium),
        Text(
          [
            t.closingPerMonthSub1,
            if (o.booksStart != null) t.closingBooksStart(dayMonth(o.booksStart)),
            t.closingPerMonthSub2,
          ].join(' '),
          style: theme.textTheme.bodySmall,
        ),
        const SizedBox(height: 8),
        if (o.rows.isEmpty) Text(t.closingNoData),
        for (final r in o.rows)
          _PeriodCard(
            row: r,
            canReopenHere: o.canReopen,
            latestClosed: r.state == PeriodState.closed && r.period == o.latestClosed,
            onClose: () => _close(o, r, multi: multi),
            onReopen: () => _reopen(o, r, multi: multi),
            onOpenBook: () => context.push('/cash?periode=${r.period}${multi ? '&pt=${o.company}' : ''}'),
          ),
        const SizedBox(height: 16),
        Text(t.closingHistory, style: theme.textTheme.titleMedium),
        Text(t.closingHistorySub, style: theme.textTheme.bodySmall),
        const SizedBox(height: 8),
        if (o.history.isEmpty) Text(t.closingHistoryEmpty, key: const Key('closing-history-empty')),
        for (final h in o.history)
          Card(
            key: Key('closing-history-${h.id}'),
            margin: const EdgeInsets.only(bottom: 8),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(child: Text(periodLabel(h.period), style: theme.textTheme.labelLarge)),
                      _StatePill(
                        text: h.closed ? t.closingStateClosed : t.closingStateReopened,
                        color: h.closed ? context.pk.okText : context.pk.warnText,
                      ),
                    ],
                  ),
                  Text([h.closedBy ?? '—', ?h.closedAt].join(' · '), style: theme.textTheme.bodySmall),
                  if (h.note != null) Text(t.closingNoteText(h.note!), style: theme.textTheme.bodySmall),
                  if (!h.closed)
                    Text(
                      t.closingReopenedBy(h.reopenedBy ?? '—', h.reopenedAt ?? '', h.reopenReason ?? ''),
                      style: theme.textTheme.bodySmall?.copyWith(color: context.pk.warnText),
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _PeriodCard extends StatelessWidget {
  const _PeriodCard({
    required this.row,
    required this.canReopenHere,
    required this.latestClosed,
    required this.onClose,
    required this.onReopen,
    required this.onOpenBook,
  });
  final PeriodRow row;
  final bool canReopenHere;

  /// The latest closed month: the only one that can be reopened (Direktur).
  final bool latestClosed;
  final VoidCallback onClose;
  final VoidCallback onReopen;
  final VoidCallback onOpenBook;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final r = row;
    final (label, color) = switch (r.state) {
      PeriodState.closed =>
        r.explicit ? (t.closingStateClosed, context.pk.okText) : (t.closingStateLocked, theme.colorScheme.outline),
      PeriodState.current => (t.closingStateCurrent, theme.colorScheme.primary),
      PeriodState.open => (t.closingStateOpen, context.pk.warnText),
    };
    final money = theme.textTheme.bodySmall?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]);
    return Card(
      key: Key('closing-period-${r.period}'),
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        onTap: onOpenBook,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(periodLabel(r.period), style: theme.textTheme.titleSmall)),
                  _StatePill(key: Key('closing-state-${r.period}'), text: label, color: color),
                ],
              ),
              const SizedBox(height: 4),
              Text(t.closingCount(r.n, r.voids > 0 ? t.closingVoids(r.voids) : ''), style: theme.textTheme.bodySmall),
              Text(
                t.closingFigures(formatRupiah(r.tin), formatRupiah(r.tout), formatRupiah(r.tin - r.tout)),
                style: money,
              ),
              if (r.nKoreksi > 0)
                Text(
                  t.closingKoreksi(formatRupiah(r.koreksi), r.nKoreksi),
                  key: Key('closing-koreksi-${r.period}'),
                  style: money,
                ),
              if (r.canClose)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: FilledButton.icon(
                    key: Key('closing-close-${r.period}'),
                    onPressed: onClose,
                    icon: const Icon(Icons.lock_outline),
                    label: Text(t.closingTitle),
                  ),
                )
              else if (r.canReopen)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: OutlinedButton.icon(
                    key: Key('closing-reopen-${r.period}'),
                    onPressed: onReopen,
                    icon: const Icon(Icons.lock_open),
                    label: Text(t.closingReopen),
                  ),
                )
              else if (latestClosed && !canReopenHere)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(t.closingReopenDirektur, style: theme.textTheme.bodySmall),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatePill extends StatelessWidget {
  const _StatePill({super.key, required this.text, required this.color});
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
