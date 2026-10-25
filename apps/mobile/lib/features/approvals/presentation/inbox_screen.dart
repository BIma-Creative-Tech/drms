import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_keuangan.dart';
import '../../expense/domain/expense_request.dart';
import '../../expense/presentation/request_detail_screen.dart' show pct;
import '../../expense/presentation/widgets/fund_check_panel.dart';
import '../../expense/presentation/widgets/receipt_mismatch_chip.dart';
import '../../expense/presentation/widgets/request_ui.dart';
import '../../addendum/presentation/addendum_providers.dart';
import '../../addendum/presentation/addendum_screens.dart';
import '../../companies/presentation/company_chip.dart';
import '../../loans/presentation/loan_providers.dart';
import '../../loans/presentation/loan_widgets.dart';
import '../application/inbox_providers.dart';

/// Inbox label of the caller's step: the server's `stepLabel` (E1) wins; older servers get the local text.
String inboxStepLabel(AppLocalizations t, InboxItem it) {
  final server = it.stepLabel?.trim();
  if (server != null && server.isNotEmpty) return server;
  if (it.step == 'acknowledge') return it.decisionFlow ? t.stepAcknowledgeDirektur : t.stepAcknowledge;
  return t.stepApprove(it.level ?? 1);
}

/// PM project / Direktur / Finance inbox (ADR 0013, ADR 0021) with budget impact (red above the warn %, US-26) and open flags (US-59).
/// E5: budget addenda waiting for the caller are listed above the expense requests ([AddendumInboxSection]);
/// ADR 0022: inter-project loans waiting for the Direktur ([LoanInboxSection]); user decision 2026-10-24: also for the
/// Owner (level 2), with the repayment requests.
class InboxScreen extends ConsumerWidget {
  const InboxScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(t.inboxTitle)),
      body: RefreshIndicator(
        onRefresh: () {
          ref.invalidate(addendumInboxProvider);
          ref.invalidate(loanInboxProvider);
          ref.invalidate(lpjQueueProvider);
          return ref.refresh(inboxProvider.future);
        },
        child: AsyncBody(
          value: ref.watch(inboxProvider),
          onRetry: () => ref.invalidate(inboxProvider),
          data: (page) => page.items.isEmpty
              ? ListView(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                  children: [
                    const AddendumInboxSection(),
                    const LoanInboxSection(),
                    const LpjQueueSection(),
                    PkEmptyState(icon: Icons.task_alt, message: t.inboxEmpty),
                  ],
                )
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                  itemCount: page.items.length + 1,
                  itemBuilder: (_, i) => i == 0
                      ? const Column(children: [AddendumInboxSection(), LoanInboxSection(), LpjQueueSection()])
                      : InboxCard(item: page.items[i - 1]),
                ),
        ),
      ),
    );
  }
}

/// One waiting request: step chip, title, amount, scope/requesters, budget meter and flag counts.
/// D2510: Banani "ApprovalItem" layout — requester avatar, type + step pill, bold title and amount, muted meta lines,
/// rounded budget bar.
class InboxCard extends StatelessWidget {
  const InboxCard({super.key, required this.item});
  final InboxItem item;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final it = item;
    final after = it.budget.pctAfter;
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant, height: 1.35);
    final risky = it.budgetOverWarn || it.fundShort != null;
    return PkCard(
      key: Key('inbox-${it.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: () => context.push('/requests/${it.id}'),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PkAvatar(name: it.requesters, size: 40),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CompanyChipLead(companyId: it.companyId),
                    Expanded(
                      child: Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(
                            it.typeLabel,
                            style: theme.textTheme.labelMedium?.copyWith(
                              color: theme.colorScheme.primary,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          PkPill(
                            key: Key('inbox-step-${it.id}'),
                            label: inboxStepLabel(t, it),
                            tone: risky ? PkTone.warn : PkTone.info,
                            icon: it.step == 'acknowledge' ? Icons.verified_user_outlined : Icons.fact_check_outlined,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        it.title,
                        style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700, height: 1.3),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      formatRupiah(it.grandTotal),
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        height: 1.3,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                Text('${it.docNo ?? '-'} · ${it.scope}', style: muted),
                Text(it.requesters, style: muted),
                if (it.neededDate != null) Text('${t.neededDate}: ${formatDateOnly(it.neededDate)}', style: muted),
                const SizedBox(height: 12),
                if (it.budget.hasBudget) ...[
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          t.budgetImpact,
                          style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                        ),
                      ),
                      Text(
                        t.budgetChange(pct(it.budget.pctBefore), pct(after)),
                        style: theme.textTheme.labelMedium?.copyWith(
                          color: it.budgetOverWarn ? context.pk.badText : null,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      if (it.budgetOverWarn) ...[
                        const SizedBox(width: 4),
                        Icon(Icons.warning_amber, color: context.pk.badText, size: 18, semanticLabel: t.budgetOverWarn),
                      ],
                    ],
                  ),
                  const SizedBox(height: 6),
                  PkProgressBar(value: (after ?? 0) / 100, color: it.budgetOverWarn ? context.pk.badText : null),
                ] else
                  Text(
                    '${t.budgetImpact}: ${t.budgetNone}',
                    style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                const SizedBox(height: 10),
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  runSpacing: 6,
                  children: [
                    Icon(
                      Icons.flag,
                      size: 16,
                      color: it.warningFlags > 0 ? context.pk.warnText : theme.colorScheme.outline,
                    ),
                    const SizedBox(width: 4),
                    Text(t.flagsCount(it.warningFlags, it.infoFlags), style: muted),
                    // D3: same badge as the web Antrian Transfer — lines whose "Nominal sesuai nota" ≠ total
                    if (it.receiptMismatchFlags > 0) ...[
                      const SizedBox(width: 8),
                      ReceiptMismatchChip(key: Key('inbox-mismatch-${it.id}'), count: it.receiptMismatchFlags),
                    ],
                    // ADR 0029: the PT is short for this request at its final step ("Setujui" is refused)
                    if (it.fundShort case final gap?) ...[
                      const SizedBox(width: 8),
                      FundShortBadge(key: Key('inbox-fund-short-${it.id}'), gap: gap),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// MC3 / US-21: LPJ waiting for Finance / Direktur (`GET /lpj-queue`), read-only list above the requests;
/// the verification itself is done in the request detail (server `allowedActions`). Hidden when empty
/// or when the queue cannot be loaded (the inbox itself stays usable).
class LpjQueueSection extends ConsumerWidget {
  const LpjQueueSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final items = ref.watch(lpjQueueProvider).value ?? const <ExpenseSummary>[];
    if (items.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        key: const Key('lpj-queue'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Text(
              '${t.lpjQueueTitle} · ${t.lpjQueueCount(items.length)}',
              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
          ),
          for (final r in items)
            PkListCard(
              key: Key('lpj-${r.id}'),
              leading: PkIconChip(
                icon: Icons.assignment_turned_in_outlined,
                tone: requestStatusTone(r.status),
                size: 40,
              ),
              title: Row(
                children: [
                  CompanyChipLead(companyId: r.companyId),
                  Expanded(child: Text(r.title, overflow: TextOverflow.ellipsis)),
                ],
              ),
              subtitle: Text('${r.docNo ?? '-'} · ${r.statusLabel}'),
              amount: formatRupiah(r.approvedAmount ?? r.grandTotal),
              onTap: () => context.push('/requests/${r.id}'),
            ),
        ],
      ),
    );
  }
}
