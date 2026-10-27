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
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_proyek.dart';
import '../../../shared/widgets/reason_dialog.dart';
import '../../auth/application/auth_controller.dart';
import '../../home/domain/route_access.dart';
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
      t.closingTitle,
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
      t.closingReopen,
    );
  }

  Future<void> _run(String id, Future<void> Function(String key) action, String done, String label) async {
    setState(() => _busy = true);
    String? error;
    try {
      await action(_keys.putIfAbsent(id, () => const Uuid().v4()));
      _keys.remove(id); // the same month may be closed again after a reopen
    } on ApiException catch (e) {
      error = e.message;
    } finally {
      ref.invalidate(periodOverviewProvider);
      ref.invalidate(cashBookProvider);
      if (mounted) setState(() => _busy = false);
    }
    if (!mounted) return;
    final outcome = error == null ? ActionOutcome.success : ActionOutcome.failed;
    await showActionResult(context, message: error ?? done, action: label, outcome: outcome);
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
      padding: const EdgeInsets.all(16),
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(t.closingPickPt, style: pkMetaStyle(context)),
        ),
        for (final e in o.locks.entries)
          PkCard(
            key: Key('closing-pt-${e.key}'),
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(14),
            onTap: () => setState(() => _pt = e.key),
            child: Row(
              children: [
                const PkIconChip(icon: Icons.business, size: 38),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${p?.companyCode(e.key) ?? ''} — ${p?.company(e.key)?.name ?? ''}',
                        style: pkTitleStyle(context),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        t.closingLockedUntil(e.value == null ? t.closingNoLock : dayMonth(e.value)),
                        style: pkMetaStyle(context),
                      ),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right, color: Theme.of(context).colorScheme.outline),
              ],
            ),
          ),
      ],
    );
  }

  Widget _body(BuildContext context, PeriodOverview o) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final p = ref.watch(currentProfileProvider);
    final canOpenHistory = canOpenApkRoute('/data/period-closings/0', p);
    final multi = o.locks.length > 1;
    Widget kpi(String key, String label, String value, String sub, {required Object icon, PkTone tone = PkTone.info}) =>
        PkMiniKpi(key: Key('closing-kpi-$key'), icon: icon, label: label, value: value, sub: sub, tone: tone);
    return ListView(
      key: const Key('closing-body'),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      children: [
        Text(
          [if (multi) p?.company(o.company!)?.name ?? '', t.closingLead].where((s) => s.isNotEmpty).join(' · '),
          style: pkMetaStyle(context),
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
        const SizedBox(height: 12),
        PkKpiRow(
          children: [
            kpi(
              'lock',
              t.closingKpiLock,
              o.lockDate == null ? t.closingNoLockShort : dayMonth(o.lockDate),
              t.closingKpiLockSub,
              icon: Icons.lock_outline,
              tone: PkTone.primary,
            ),
            kpi(
              'last',
              t.closingKpiLast,
              o.latestClosed == null ? '—' : periodLabel(o.latestClosed!),
              t.closingKpiLastSub(o.history.length),
              icon: Icons.event_available,
              tone: PkTone.ok,
            ),
            kpi(
              'closable',
              t.closingKpiClosable,
              '${o.closable.length}',
              o.closable.isEmpty ? t.closingKpiClosableNone : o.closable.map(periodLabel).join(', '),
              icon: Icons.pending_actions,
              tone: o.closable.isEmpty ? PkTone.neutral : PkTone.warn,
            ),
          ],
        ),
        PkListTitle(
          t.closingPerMonth,
          sub: [
            t.closingPerMonthSub1,
            if (o.booksStart != null) t.closingBooksStart(dayMonth(o.booksStart)),
            t.closingPerMonthSub2,
          ].join(' '),
          padding: const EdgeInsets.only(top: 20, bottom: 10),
        ),
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
        PkListTitle(t.closingHistory, sub: t.closingHistorySub, padding: const EdgeInsets.only(top: 20, bottom: 10)),
        if (o.history.isEmpty)
          Text(t.closingHistoryEmpty, key: const Key('closing-history-empty'), style: pkMetaStyle(context)),
        for (final h in o.history)
          PkCard(
            key: Key('closing-history-${h.id}'),
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(14),
            // D2510: a history row opens its record (the web "Riwayat tutup buku" document)
            onTap: canOpenHistory ? () => context.push('/data/period-closings/${h.id}') : null,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                PkIconChip(
                  icon: h.closed ? Icons.lock_outline : Icons.lock_open,
                  tone: h.closed ? PkTone.ok : PkTone.warn,
                  size: 34,
                  round: true,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(child: Text(periodLabel(h.period), style: pkTitleStyle(context))),
                          PkPill(
                            label: h.closed ? t.closingStateClosed : t.closingStateReopened,
                            tone: h.closed ? PkTone.ok : PkTone.warn,
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text([h.closedBy ?? '—', ?h.closedAt].join(' · '), style: pkMetaStyle(context)),
                      if (h.note != null) Text(t.closingNoteText(h.note!), style: pkMetaStyle(context)),
                      if (!h.closed)
                        Text(
                          t.closingReopenedBy(h.reopenedBy ?? '—', h.reopenedAt ?? '', h.reopenReason ?? ''),
                          style: theme.textTheme.bodySmall?.copyWith(color: context.pk.warnText),
                        ),
                    ],
                  ),
                ),
                if (canOpenHistory) ...[
                  const SizedBox(width: 4),
                  Icon(Icons.chevron_right, size: 20, color: theme.colorScheme.outline),
                ],
              ],
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
    final r = row;
    final (label, tone, icon) = switch (r.state) {
      PeriodState.closed =>
        r.explicit
            ? (t.closingStateClosed, PkTone.ok, Icons.lock_outline)
            : (t.closingStateLocked, PkTone.neutral, Icons.lock_outline),
      PeriodState.current => (t.closingStateCurrent, PkTone.info, Icons.today),
      PeriodState.open => (t.closingStateOpen, PkTone.warn, Icons.lock_open),
    };
    final money = pkMetaStyle(context)?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]);
    return PkCard(
      key: Key('closing-period-${r.period}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: onOpenBook,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PkIconChip(icon: icon, tone: tone, size: 34, round: true),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(child: Text(periodLabel(r.period), style: pkTitleStyle(context))),
                    PkPill(key: Key('closing-state-${r.period}'), label: label, tone: tone),
                  ],
                ),
                const SizedBox(height: 4),
                Text(t.closingCount(r.n, r.voids > 0 ? t.closingVoids(r.voids) : ''), style: pkMetaStyle(context)),
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
                    padding: const EdgeInsets.only(top: 10),
                    child: FilledButton.icon(
                      key: Key('closing-close-${r.period}'),
                      onPressed: onClose,
                      icon: const Icon(Icons.lock_outline),
                      label: Text(t.closingTitle),
                    ),
                  )
                else if (r.canReopen)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: OutlinedButton.icon(
                      key: Key('closing-reopen-${r.period}'),
                      onPressed: onReopen,
                      icon: const Icon(Icons.lock_open),
                      label: Text(t.closingReopen),
                    ),
                  )
                else if (latestClosed && !canReopenHere)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(t.closingReopenDirektur, style: pkMetaStyle(context)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
