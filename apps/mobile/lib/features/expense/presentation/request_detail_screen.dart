import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../approvals/data/approvals_api.dart';
import '../../approvals/presentation/decision_sheet.dart';
import '../../auth/application/auth_controller.dart';
import '../application/expense_providers.dart';
import '../domain/expense_request.dart';
import '../domain/turn_timeline.dart';
import 'requester_actions.dart';
import 'widgets/receipt_thumb.dart';
import 'widgets/transfer_lpj.dart';
import 'widgets/timeline_view.dart';

String pct(double? v) => v == null ? '-' : '${v.toStringAsFixed(1).replaceAll('.', ',')}%';

/// Server request detail: lines, receipts (thumbnails), flags, budget impact, "Giliran" timeline,
/// and — when the server allows it for this user — Diketahui / Setujui / Tolak (US-26, US-42).
class RequestDetailScreen extends ConsumerWidget {
  const RequestDetailScreen({super.key, required this.id});
  final int id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final value = ref.watch(requestDetailProvider(id));
    final zone = ref.watch(currentProfileProvider)?.timezone;
    return Scaffold(
      appBar: AppBar(
        title: Text(t.detailTitle),
        actions: [
          IconButton(
            key: const Key('open-history'),
            tooltip: t.historyTitle,
            icon: const Icon(Icons.history),
            onPressed: () => context.push('/requests/$id/history'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(requestDetailProvider(id).future),
        child: AsyncBody(
          value: value,
          onRetry: () => ref.invalidate(requestDetailProvider(id)),
          data: (d) => _DetailBody(detail: d, zone: zone),
        ),
      ),
      bottomNavigationBar: switch (value) {
        AsyncData(:final value) => _DecisionBar(detail: value),
        _ => null,
      },
    );
  }
}

class _DetailBody extends StatelessWidget {
  const _DetailBody({required this.detail, this.zone});
  final ExpenseDetail detail;
  final String? zone;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final d = detail;
    final theme = Theme.of(context);
    Widget row(String k, String v) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 150, child: Text(k, style: theme.textTheme.bodySmall)),
          Expanded(child: Text(v)),
        ],
      ),
    );
    final scope = d.project ?? d.costCenter;
    final over = (d.budget.pctAfter ?? 0) > 85;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(d.title, style: theme.textTheme.titleLarge),
        const SizedBox(height: 4),
        Wrap(
          spacing: 8,
          children: [
            Chip(label: Text(d.typeLabel)),
            Chip(label: Text(d.statusLabel)),
            if (d.docNo != null) Chip(label: Text(d.docNo!)),
          ],
        ),
        Card(
          color: theme.colorScheme.primaryContainer,
          child: ListTile(
            leading: const Icon(Icons.flag_circle),
            title: Text(t.turnLabel),
            subtitle: Text(currentTurn(d), key: const Key('turn-text')),
          ),
        ),
        row(t.grandTotal, formatRupiah(d.grandTotal)),
        if (d.approvedAmount != null) row(t.approvedAmount, formatRupiah(d.approvedAmount!)),
        row(t.scopeLabel, scope == null ? '-' : '${scope.code ?? ''} ${scope.name ?? ''}'.trim()),
        row(t.requesters, d.requesters.map((r) => r.name ?? '-').join(', ')),
        if (d.createdByName != null) row(t.createdBy, d.createdByName!),
        row(t.neededDate, formatDateOnly(d.neededDate)),
        if (d.requestDate != null) row(t.requestDate, formatDateOnly(d.requestDate)),
        if (d.bankName != null || d.bankAccountNo != null)
          row(t.bankAccount, [d.bankName, d.bankAccountHolder, d.bankAccountNo].whereType<String>().join(' · ')),
        row(
          t.budgetImpact,
          d.budget.hasBudget ? t.budgetChange(pct(d.budget.pctBefore), pct(d.budget.pctAfter)) : t.budgetNone,
        ),
        if (over) Text('⚠ ${t.budgetImpact} > 85%', style: const TextStyle(color: StatusColors.danger)),
        if (d.rejectReason != null) row(t.rejectReasonLabel, d.rejectReason!),
        if (TransferSection.visibleFor(d)) TransferSection(detail: d),
        if (d.settlement != null) LpjSection(settlement: d.settlement!),
        RequestLifecycleActions(detail: d),
        RequesterActionsSection(detail: d),
        const Divider(height: 32),
        Text(t.timelineTitle, style: theme.textTheme.titleMedium),
        TimelineView(steps: buildTimeline(d), zone: zone),
        const Divider(height: 32),
        Text(t.linesTitle, style: theme.textTheme.titleMedium),
        for (final l in d.lines)
          _LineCard(
            detail: d,
            line: l,
            receipts: d.receipts.where((r) => r.lineId == l.id && r.status != 'removed').toList(),
          ),
        if (d.flags.isNotEmpty) ...[
          const Divider(height: 32),
          Text(t.flagsTitle, style: theme.textTheme.titleMedium),
          for (final f in d.flags)
            ListTile(
              dense: true,
              leading: Icon(Icons.flag, color: f.level == 'warning' ? StatusColors.warning : theme.colorScheme.outline),
              title: Text(f.kindLabel),
              subtitle: Text('${f.lineNo != null ? 'Baris ${f.lineNo}: ' : ''}${f.message}'),
            ),
        ],
        const SizedBox(height: 80),
      ],
    );
  }
}

class _LineCard extends ConsumerWidget {
  const _LineCard({required this.detail, required this.line, required this.receipts});
  final ExpenseDetail detail;
  final ExpenseLine line;
  final List<ReceiptInfo> receipts;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final canRemove = RequesterActionsSection.canAddReceipts(detail) && ref.watch(connectivityProvider);
    final qty = line.qty == null
        ? ''
        : '${line.qty!.toString().replaceAll(RegExp(r'\.0$'), '')} ${line.uom?.name ?? ''} · ';
    final unit = line.unitPriceDisplay == null ? '' : '@ ${formatRupiah(line.unitPriceDisplay!)} · ';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${line.no}. ${line.description ?? '-'}',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                Text(formatRupiah(line.total), style: const TextStyle(fontWeight: FontWeight.bold)),
              ],
            ),
            Text('$qty$unit${line.category?.name ?? ''}${line.vehiclePlate != null ? ' · ${line.vehiclePlate}' : ''}'),
            if (line.notes != null) Text(line.notes!, style: Theme.of(context).textTheme.bodySmall),
            if (receipts.isNotEmpty) const SizedBox(height: 8),
            for (final r in receipts)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  children: [
                    ReceiptThumb(imageId: r.imageId),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '${r.vendorName}\n${r.receiptNo ?? '-'} · ${formatDateOnly(r.receiptDate)} · '
                        '${receiptStatusLabel(r.status)}',
                      ),
                    ),
                    Text(formatRupiah(r.amount)),
                    if (canRemove)
                      IconButton(
                        key: Key('receipt-remove-${r.id}'),
                        tooltip: t.receiptRemove,
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () => removeServerReceipt(context, ref, detail, r),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _DecisionBar extends ConsumerWidget {
  const _DecisionBar({required this.detail});
  final ExpenseDetail detail;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final a = detail.allowedActions;
    final canAck = a.contains('acknowledge');
    final canApprove = a.contains('approve');
    final canReject = a.contains('reject');
    if (!canAck && !canApprove && !canReject) return const SizedBox.shrink();

    Future<void> open(Decision decision) async {
      final done = await showDecisionSheet(context, detail: detail, decision: decision);
      if (done == true && context.mounted) showSnack(context, t.decisionDone);
      // Also after a refusal (403/409): the buttons must reflect the server's current allowedActions.
      ref.invalidate(requestDetailProvider(detail.id));
      ref.invalidate(inboxProvider);
    }

    final direktur = detail.approvalRule?.decisionFlow ?? false;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
        child: Row(
          children: [
            if (canReject)
              Expanded(
                child: OutlinedButton.icon(
                  key: const Key('action-reject'),
                  onPressed: () => open(Decision.reject),
                  icon: const Icon(Icons.close),
                  label: Text(t.actionReject),
                ),
              ),
            if (canReject) const SizedBox(width: 12),
            if (canAck || canApprove)
              Expanded(
                child: FilledButton.icon(
                  key: Key(canApprove ? 'action-approve' : 'action-acknowledge'),
                  onPressed: () => open(canApprove ? Decision.approve : Decision.acknowledge),
                  icon: const Icon(Icons.check),
                  label: Text(
                    canApprove ? t.actionApprove : (direktur ? t.actionAcknowledgeDirektur : t.actionAcknowledge),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
