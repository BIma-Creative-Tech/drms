import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/doc_no_chip.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../approvals/data/approvals_api.dart';
import '../../approvals/presentation/decision_sheet.dart';
import '../../auth/application/auth_controller.dart';
import '../application/expense_providers.dart';
import '../domain/expense_request.dart';
import '../domain/turn_timeline.dart';
import 'requester_actions.dart';
import 'widgets/rap_item_picker.dart';
import 'widgets/receipt_mismatch_chip.dart';
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

class _DetailBody extends ConsumerWidget {
  const _DetailBody({required this.detail, this.zone});
  final ExpenseDetail detail;
  final String? zone;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final d = detail;
    final theme = Theme.of(context);
    Widget row(String k, String v, {Key? key}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 150, child: Text(k, style: theme.textTheme.bodySmall)),
          Expanded(child: Text(v, key: key)),
        ],
      ),
    );
    // d1010 (WA-09): the same section titles on web and APK.
    Widget section(String title, {Key? key}) => Padding(
      key: key,
      padding: const EdgeInsets.only(top: 16, bottom: 4),
      child: Text(title, style: theme.textTheme.titleMedium),
    );
    String refText(RefItem r) => '${r.code ?? ''} ${r.name ?? ''}'.trim();
    final over = (d.budget.pctAfter ?? 0) > 85;
    // d1010 (WA-08): PT inline as "shortCode — name" (the membership's name; the code alone for a PT the
    // user is no longer a member of).
    final profile = ref.watch(accountProfileProvider);
    final pt = profile?.company(d.companyId);
    final ptText = d.companyId == null
        ? null
        : (pt == null ? profile?.companyCode(d.companyId) : (pt.name.isEmpty ? pt.code : '${pt.code} — ${pt.name}'));
    final receiptPhotos = [
      for (final l in d.lines)
        for (final r in d.receipts)
          if (r.lineId == l.id && r.status != 'removed' && r.imageId != null)
            (imageId: r.imageId!, caption: receiptCaption(t, l, r)),
    ];
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(d.title, style: theme.textTheme.titleLarge),
        const SizedBox(height: 4),
        Wrap(
          spacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Chip(label: Text(d.typeLabel)),
            Chip(label: Text(d.statusLabel)),
            if (d.docNo != null) DocNoChip(docNo: d.docNo!),
            // D3: at least one line's "Nominal sesuai nota" differs from its total (details on the line).
            if (d.lines.any((l) => lineReceiptMismatch(d, l)))
              const ReceiptMismatchChip(key: Key('detail-receipt-mismatch')),
            // D4: at least one line is above the remaining budget of its RAP item.
            if (d.lines.any((l) => lineRapOverBudget(d, l))) const RapOverBudgetChip(key: Key('detail-rap-over')),
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
        // ADR 0021: narrow G1 exception, recorded on the request (audit + PDF + panel).
        if (d.approvalRule?.direkturViaPm ?? false)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                const Icon(Icons.info_outline, size: 18),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    d.approvalRule!.direkturViaPmSelf ? t.direkturViaPmSelfNote : t.direkturViaPmNote,
                    key: const Key('direktur-via-pm-note'),
                  ),
                ),
              ],
            ),
          ),
        section(t.sectionRequestDetails, key: const Key('section-details')),
        if (ptText != null) row(t.draftCompany, ptText, key: const Key('detail-company')),
        row(t.grandTotal, formatRupiah(d.grandTotal)),
        if (d.approvedAmount != null) row(t.approvedAmount, formatRupiah(d.approvedAmount!)),
        // D2: project of the request; the cost center is Finance's (set at transfer) — shown once known.
        row(t.fieldProject, d.project == null ? '-' : refText(d.project!), key: const Key('detail-project')),
        if (d.costCenter != null) row(t.fieldCostCenter, refText(d.costCenter!), key: const Key('detail-cost-center')),
        if (d.urgencyLevel != null) row(t.fieldUrgency, d.urgencyLevel!.name ?? '-'),
        if (d.requestDate != null) row(t.requestDate, formatDateOnly(d.requestDate)),
        row(t.neededDate, formatDateOnly(d.neededDate)),
        if (d.notes != null && d.notes!.trim().isNotEmpty) row(t.fieldNotes, d.notes!.trim()),
        row(
          t.budgetImpact,
          d.budget.hasBudget ? t.budgetChange(pct(d.budget.pctBefore), pct(d.budget.pctAfter)) : t.budgetNone,
        ),
        if (over)
          Row(
            children: [
              Icon(Icons.warning_amber_rounded, size: 18, color: context.pk.badText),
              const SizedBox(width: 6),
              Expanded(
                child: Text('${t.budgetImpact} > 85%', style: TextStyle(color: context.pk.badText)),
              ),
            ],
          ),
        if (d.rejectReason != null) row(t.rejectReasonLabel, d.rejectReason!),
        section(t.sectionRequester, key: const Key('section-requester')),
        row(t.requesters, d.requesters.map((r) => r.name ?? '-').join(', ')),
        if (d.createdByName != null) row(t.createdBy, d.createdByName!),
        section(t.bankAccount, key: const Key('section-bank')),
        if (d.bankName == null && d.bankAccountNo == null && d.bankAccountHolder == null)
          Text('-', style: theme.textTheme.bodyMedium)
        else ...[
          if (d.bankName != null) row(t.bankNameLabel, d.bankName!),
          if (d.bankAccountHolder != null) row(t.bankHolderLabel, d.bankAccountHolder!),
          // Masked by the server unless this user may see the full number (dto.ts maskAccountNo).
          if (d.bankAccountNo != null) row(t.bankNumberLabel, d.bankAccountNo!, key: const Key('detail-bank-no')),
        ],
        if (TransferSection.visibleFor(d)) TransferSection(detail: d, zone: zone),
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
            photos: receiptPhotos,
          ),
        if (d.flags.isNotEmpty) ...[
          const Divider(height: 32),
          Text(t.flagsTitle, style: theme.textTheme.titleMedium),
          for (final f in d.flags)
            ListTile(
              dense: true,
              leading: Icon(Icons.flag, color: f.level == 'warning' ? context.pk.warnText : theme.colorScheme.outline),
              title: Text(f.kindLabel),
              subtitle: Text('${f.lineNo != null ? 'Baris ${f.lineNo}: ' : ''}${f.message}'),
            ),
        ],
        const SizedBox(height: 80),
      ],
    );
  }
}

/// D4: "A.1 — Solar alat berat" (`#501` when the server sent the id only).
String rapRefLabel(RefItem r) {
  final s = [?r.code, ?r.name].where((e) => e.isNotEmpty).join(' — ');
  return s.isEmpty ? '#${r.id}' : s;
}

/// Viewer caption of a receipt photo: "Baris 2 · Toko Maju · No. 123 · Rp 600.000".
String receiptCaption(AppLocalizations t, ExpenseLine l, ReceiptInfo r) => [
  t.receiptLineCaption(l.no),
  r.vendorName,
  if (r.receiptNo != null) 'No. ${r.receiptNo}',
  formatRupiah(r.amount),
].where((e) => e.isNotEmpty).join(' · ');

class _LineCard extends ConsumerWidget {
  const _LineCard({required this.detail, required this.line, required this.receipts, required this.photos});
  final ExpenseDetail detail;
  final ExpenseLine line;
  final List<ReceiptInfo> receipts;

  /// Every receipt photo of the request (the viewer swipes across lines).
  final List<ReceiptPhoto> photos;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final canRemove = RequesterActionsSection.canAddReceipts(detail) && ref.watch(connectivityProvider);
    // D3: same columns as the web lines table — Qty Satuan × Harga satuan · Kategori · Kendaraan.
    final price = line.unitPrice ?? line.unitPriceDisplay;
    final qtyUom = line.qty == null ? null : '${formatQty(line.qty!)} ${line.uom?.name ?? ''}'.trim();
    final qtyPrice = [?qtyUom, if (price != null) formatRupiah(price)].join(' × ');
    final meta = [if (qtyPrice.isNotEmpty) qtyPrice, ?line.category?.name, ?line.vehiclePlate].join(' · ');
    final mismatch = lineReceiptMismatch(detail, line);
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
            Text(meta, key: Key('line-${line.no}-meta')),
            // D4: RAP item the line is charged to.
            if (line.rapItem != null)
              Text('${t.fieldRapItem}: ${rapRefLabel(line.rapItem!)}', key: Key('line-${line.no}-rap'))
            else if (lineNeedsRapItem(detail, line))
              Text(
                t.lineNeedsRapItemShort,
                key: Key('line-${line.no}-needs-rap'),
                style: TextStyle(color: context.pk.warnText, fontWeight: FontWeight.w600),
              ),
            if (lineRapOverBudget(detail, line))
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: RapOverBudgetChip(key: Key('line-${line.no}-rap-over')),
              ),
            // D3: "Nominal sesuai nota" beside the computed total; "Selisih nota" when they differ.
            if (line.receiptAmount != null)
              Text(
                '${t.fieldReceiptAmount}: ${formatRupiah(line.receiptAmount!)}',
                key: Key('line-${line.no}-receipt-amount'),
              ),
            if (mismatch)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: ReceiptMismatchChip(
                  key: Key('line-${line.no}-receipt-mismatch'),
                  receiptAmount: line.receiptAmount,
                  total: line.total,
                ),
              ),
            if (lineNeedsCompletion(detail, line))
              Text(
                t.lineNeedsUnitPriceShort,
                key: Key('line-${line.no}-needs-unit-price'),
                style: TextStyle(color: context.pk.warnText, fontWeight: FontWeight.w600),
              ),
            if (line.notes != null) Text(line.notes!, style: Theme.of(context).textTheme.bodySmall),
            if (receipts.isNotEmpty) const SizedBox(height: 8),
            for (final r in receipts)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  children: [
                    ReceiptThumb(imageId: r.imageId, group: photos, caption: receiptCaption(t, line, r)),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '${r.vendorName}\n${r.receiptNo ?? '-'} · ${formatDateOnly(r.receiptDate)} · '
                        '${receiptStatusLabel(r.status)}',
                      ),
                    ),
                    Text(formatRupiah(r.amount)),
                    if (canRemove && receiptRemovable(r.status))
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
    // DRMS 10/10 point 10: Finance records the transfer from the APK too (same form as the Finance menu).
    if (a.contains('transfer') && !canAck && !canApprove && !canReject) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: FilledButton.icon(
            key: const Key('action-transfer'),
            onPressed: () async {
              await context.push<bool>('/finance/transfer/${detail.id}');
              ref.invalidate(requestDetailProvider(detail.id));
            },
            icon: const Icon(Icons.account_balance),
            label: Text(t.transferRecord),
          ),
        ),
      );
    }
    if (!canAck && !canApprove && !canReject) return const SizedBox.shrink();

    Future<void> open(Decision decision) async {
      final done = await showDecisionSheet(context, detail: detail, decision: decision);
      if (done == true && context.mounted) showSnack(context, t.decisionDone);
      // Also after a refusal (403/409): the buttons must reflect the server's current allowedActions.
      ref.invalidate(requestDetailProvider(detail.id));
      ref.invalidate(inboxProvider);
    }

    final pm = detail.approvalRule?.pmApproval ?? false;
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
                    canApprove
                        ? t.actionApprove
                        : (pm ? t.actionAcknowledgePm : (direktur ? t.actionAcknowledgeDirektur : t.actionAcknowledge)),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
