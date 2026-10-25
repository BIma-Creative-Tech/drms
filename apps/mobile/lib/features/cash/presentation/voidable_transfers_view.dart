import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/network/api_exception.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/list_search.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_proyek.dart';
import '../../../shared/widgets/reason_dialog.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../companies/presentation/company_chip.dart';
import '../../expense/application/expense_providers.dart';
import '../../expense/domain/request_status.dart';
import '../../finance/application/finance_providers.dart';
import '../application/cash_providers.dart';
import '../domain/cash_book.dart';

/// User 2026-10-19 (phase 3): the web "Transfer tercatat — dapat dibatalkan" (Antrian Transfer, E2 / T8) — recorded
/// transfers whose request is still "Sudah Ditransfer"; "Void transfer" for Finance of the request's PT (reason). The
/// void reverses the transfer's KK and puts the request back in the queue.
class VoidableTransfersView extends ConsumerStatefulWidget {
  const VoidableTransfersView({super.key});

  @override
  ConsumerState<VoidableTransfersView> createState() => _VoidableTransfersViewState();
}

class _VoidableTransfersViewState extends ConsumerState<VoidableTransfersView> {
  String _q = '';
  final List<VoidableTransfer> _more = [];
  int _page = 1;
  bool _loadingMore = false;
  final _keys = <int, String>{};
  int? _busy;

  Future<void> _loadMore(VoidablePage first) async {
    if (_loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final next = await ref.read(cashApiProvider).voidableTransfers(q: _q, page: _page + 1);
      if (!mounted) return;
      setState(() {
        _page = next.page;
        _more.addAll(next.items.where((i) => !first.items.any((x) => x.transferId == i.transferId)));
      });
    } on Object catch (e) {
      if (mounted) showSnack(context, errorText(e));
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  Future<void> _void(VoidableTransfer x) async {
    final t = AppLocalizations.of(context);
    final reason = await showReasonDialog(
      context,
      title: t.voidTransferTitle(x.transferNo),
      description: t.voidTransferBody(
        x.requestNo ?? '',
        x.advance ? t.voidTransferBackAdvance : t.voidTransferBackReimburse,
      ),
      confirm: t.voidTransfer,
      keyPrefix: 'void-transfer-${x.transferId}',
    );
    if (reason == null || !mounted) return;
    setState(() => _busy = x.transferId);
    try {
      final key = _keys.putIfAbsent(x.transferId, () => const Uuid().v4());
      await ref.read(cashApiProvider).voidTransfer(x.requestId, x.transferId, reason, idempotencyKey: key);
      if (!mounted) return;
      setState(() {
        _more.clear();
        _page = 1;
      });
      ref.invalidate(voidableTransfersProvider);
      ref.invalidate(transferQueueProvider);
      ref.invalidate(requestDetailProvider(x.requestId));
      ref.invalidate(inboxProvider);
      ref.invalidate(cashBookProvider);
      await showActionResult(context, message: t.voidTransferDone(x.transferNo), action: t.voidTransfer);
    } on ApiException catch (e) {
      if (mounted) await showActionError(context, e, action: t.voidTransfer);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final value = ref.watch(voidableTransfersProvider(_q));
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: ListSearchField(
            key: const Key('void-transfer-search'),
            hint: t.voidTransferSearchHint,
            onChanged: (v) => setState(() {
              _q = v;
              _more.clear();
              _page = 1;
            }),
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () {
              setState(() {
                _more.clear();
                _page = 1;
              });
              return ref.refresh(voidableTransfersProvider(_q).future);
            },
            child: AsyncBody<VoidablePage>(
              value: value,
              onRetry: () => ref.invalidate(voidableTransfersProvider(_q)),
              data: (first) {
                final items = [...first.items, ..._more];
                final more = _page < first.totalPages;
                return ListView(
                  key: const Key('void-transfer-list'),
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                  children: [
                    PkListTitle(
                      t.voidTransferLead(first.total),
                      sub: t.voidTransferNote,
                      padding: const EdgeInsets.only(top: 4, bottom: 12),
                    ),
                    if (items.isEmpty)
                      PkEmptyState(
                        key: const Key('void-transfer-empty'),
                        icon: Icons.task_alt,
                        message: t.voidTransferEmpty,
                      ),
                    for (final x in items)
                      PkCard(
                        key: Key('void-transfer-${x.transferId}'),
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.all(14),
                        onTap: () => context.push('/requests/${x.requestId}'),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const PkIconChip(icon: Icons.account_balance, size: 38),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          CompanyChipLead(companyId: x.companyId),
                                          Expanded(
                                            child: Text(formatDateOnly(x.transferDate), style: pkMetaStyle(context)),
                                          ),
                                        ],
                                      ),
                                      Text(
                                        x.transferNo,
                                        style: theme.textTheme.labelLarge?.copyWith(
                                          color: theme.colorScheme.primary,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Text(formatRupiah(x.amount), style: pkMoneyStyle(context)),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(
                              '${x.requestNo ?? '#${x.requestId}'} · ${x.requestTitle}',
                              style: pkTitleStyle(context),
                            ),
                            const SizedBox(height: 6),
                            Align(
                              alignment: Alignment.centerLeft,
                              child: PkPill(
                                label: (x.advance ? RequestType.advance : RequestType.reimburse).label,
                                tone: PkTone.info,
                              ),
                            ),
                            const SizedBox(height: 10),
                            if (x.canVoid)
                              OutlinedButton.icon(
                                key: Key('void-transfer-${x.transferId}-action'),
                                onPressed: _busy == null ? () => _void(x) : null,
                                icon: const Icon(Icons.block),
                                label: Text(_busy == x.transferId ? t.processing : t.voidTransfer),
                              )
                            else
                              Text(t.voidTransferFinanceOnly, style: pkMetaStyle(context)),
                          ],
                        ),
                      ),
                    if (more)
                      _loadingMore
                          ? const Padding(
                              padding: EdgeInsets.all(16),
                              child: Center(child: CircularProgressIndicator()),
                            )
                          : LoadMoreTrigger(key: ValueKey('void-more-${items.length}'), onLoad: () => _loadMore(first)),
                  ],
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}
