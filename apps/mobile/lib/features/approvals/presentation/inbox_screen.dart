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
import '../../addendum/presentation/addendum_providers.dart';
import '../../addendum/presentation/addendum_screens.dart';
import '../application/inbox_providers.dart';

/// Inbox label of the caller's step: the server's `stepLabel` (E1) wins; older servers get the local text.
String inboxStepLabel(AppLocalizations t, InboxItem it) {
  final server = it.stepLabel?.trim();
  if (server != null && server.isNotEmpty) return server;
  if (it.step == 'acknowledge') return it.decisionFlow ? t.stepAcknowledgeDirektur : t.stepAcknowledge;
  return t.stepApprove(it.level ?? 1);
}

/// Direktur/Finance inbox (ADR 0013) with budget impact (red above the warn %, US-26) and open flags (US-59).
/// E5: budget addenda waiting for the caller are listed above the expense requests ([AddendumInboxSection]).
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
                  itemBuilder: (_, i) => i == 0 ? const AddendumInboxSection() : InboxCard(item: page.items[i - 1]),
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
                        color: it.budgetOverWarn ? StatusColors.danger : null,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (it.budgetOverWarn) ...[
                      const SizedBox(width: 4),
                      Icon(Icons.warning_amber, color: StatusColors.danger, size: 18, semanticLabel: t.budgetOverWarn),
                    ],
                  ],
                ),
                const SizedBox(height: 6),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: ((after ?? 0) / 100).clamp(0, 1).toDouble(),
                    minHeight: 8,
                    color: it.budgetOverWarn ? StatusColors.danger : theme.colorScheme.primary,
                    backgroundColor: theme.colorScheme.surfaceContainerHighest,
                  ),
                ),
              ] else
                Text('${t.budgetImpact}: ${t.budgetNone}', style: theme.textTheme.labelMedium),
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(
                    Icons.flag,
                    size: 16,
                    color: it.warningFlags > 0 ? StatusColors.warning : theme.colorScheme.outline,
                  ),
                  const SizedBox(width: 4),
                  Text(t.flagsCount(it.warningFlags, it.infoFlags), style: theme.textTheme.bodySmall),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
