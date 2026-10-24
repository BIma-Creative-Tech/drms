import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../expense/domain/expense_request.dart';
import '../../expense/presentation/request_detail_screen.dart' show pct;
import '../../expense/presentation/widgets/fund_check_panel.dart';
import '../../expense/presentation/widgets/receipt_mismatch_chip.dart';
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
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
                  children: [
                    const AddendumInboxSection(),
                    const LoanInboxSection(),
                    const LpjQueueSection(),
                    Padding(
                      padding: const EdgeInsets.all(32),
                      child: Column(
                        children: [
                          Icon(Icons.task_alt, size: 48, color: Theme.of(context).colorScheme.primary),
                          const SizedBox(height: 12),
                          Text(t.inboxEmpty, textAlign: TextAlign.center),
                        ],
                      ),
                    ),
                  ],
                )
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
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
class InboxCard extends StatelessWidget {
  const InboxCard({super.key, required this.item});
  final InboxItem item;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final it = item;
    final after = it.budget.pctAfter;
    return Card(
      key: Key('inbox-${it.id}'),
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/requests/${it.id}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CompanyChipLead(companyId: it.companyId),
                  Flexible(
                    child: Chip(
                      key: Key('inbox-step-${it.id}'),
                      avatar: Icon(it.step == 'acknowledge' ? Icons.verified_user : Icons.fact_check, size: 18),
                      label: Text(inboxStepLabel(t, it), overflow: TextOverflow.ellipsis),
                      visualDensity: VisualDensity.compact,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(it.typeLabel, style: theme.textTheme.labelMedium),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: Text(it.title, style: theme.textTheme.titleMedium)),
                  const SizedBox(width: 12),
                  Text(
                    formatRupiah(it.grandTotal),
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text('${it.docNo ?? '-'} · ${it.scope}', style: theme.textTheme.bodySmall),
              Text(it.requesters, style: theme.textTheme.bodySmall),
              if (it.neededDate != null)
                Text('${t.neededDate}: ${formatDateOnly(it.neededDate)}', style: theme.textTheme.bodySmall),
              const SizedBox(height: 12),
              if (it.budget.hasBudget) ...[
                Row(
                  children: [
                    Expanded(child: Text(t.budgetImpact, style: theme.textTheme.labelMedium)),
                    Text(
                      t.budgetChange(pct(it.budget.pctBefore), pct(after)),
                      style: theme.textTheme.labelMedium?.copyWith(
                        color: it.budgetOverWarn ? context.pk.badText : null,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (it.budgetOverWarn) ...[
                      const SizedBox(width: 4),
                      Icon(Icons.warning_amber, color: context.pk.badText, size: 18, semanticLabel: t.budgetOverWarn),
                    ],
                  ],
                ),
                const SizedBox(height: 6),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: ((after ?? 0) / 100).clamp(0, 1).toDouble(),
                    minHeight: 8,
                    color: it.budgetOverWarn ? context.pk.badText : theme.colorScheme.primary,
                    backgroundColor: theme.colorScheme.surfaceContainerHighest,
                  ),
                ),
              ] else
                Text('${t.budgetImpact}: ${t.budgetNone}', style: theme.textTheme.labelMedium),
              const SizedBox(height: 8),
              Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                runSpacing: 4,
                children: [
                  Icon(
                    Icons.flag,
                    size: 16,
                    color: it.warningFlags > 0 ? context.pk.warnText : theme.colorScheme.outline,
                  ),
                  const SizedBox(width: 4),
                  Text(t.flagsCount(it.warningFlags, it.infoFlags), style: theme.textTheme.bodySmall),
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
            padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
            child: Text('${t.lpjQueueTitle} · ${t.lpjQueueCount(items.length)}', style: theme.textTheme.titleMedium),
          ),
          for (final r in items)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                key: Key('lpj-${r.id}'),
                title: Row(
                  children: [
                    CompanyChipLead(companyId: r.companyId),
                    Expanded(child: Text(r.title, overflow: TextOverflow.ellipsis)),
                  ],
                ),
                subtitle: Text('${r.docNo ?? '-'} · ${r.statusLabel}'),
                trailing: Text(formatRupiah(r.approvedAmount ?? r.grandTotal)),
                onTap: () => context.push('/requests/${r.id}'),
              ),
            ),
        ],
      ),
    );
  }
}
