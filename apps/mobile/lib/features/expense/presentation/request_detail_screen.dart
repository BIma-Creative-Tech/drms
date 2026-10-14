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
import '../../../shared/widgets/form_grid.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../approvals/data/approvals_api.dart';
import '../../approvals/presentation/decision_sheet.dart';
import '../../auth/application/auth_controller.dart';
import '../application/expense_providers.dart';
import '../domain/expense_request.dart';
import '../domain/turn_timeline.dart';
import 'requester_actions.dart';
import 'widgets/fund_check_panel.dart';
import 'widgets/rap_item_picker.dart';
import 'widgets/request_stepper.dart';
import 'widgets/receipt_mismatch_chip.dart';
import 'widgets/receipt_thumb.dart';
import 'widgets/transfer_lpj.dart';

String pct(double? v) => v == null ? '-' : '${v.toStringAsFixed(1).replaceAll('.', ',')}%';

/// Server request detail: lines (grand total in the footer), receipts (thumbnails), flags per line, budget impact,
/// ONE stepper of the whole flow ("Tahapan saat ini", DRMS 13/10 Persetujuan #3) and — when the server allows it for
/// this user — Diketahui / Setujui / Tolak (US-26, US-42).
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
    // d1010 (WA-08): PT as "shortCode — name" (the membership's name; the code alone for a PT the user is no longer
    // a member of) — a badge in the header since DRMS 13/10 Persetujuan #8.
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
    final decides = d.allowedActions.any(_decisionActions.contains);
    final header = <Widget>[
      Text(d.title, style: theme.textTheme.titleLarge),
      const SizedBox(height: 4),
      Wrap(
        spacing: 8,
        runSpacing: 4,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Chip(label: Text(d.typeLabel)),
          Chip(label: Text(d.statusLabel)),
          if (d.docNo != null) DocNoChip(docNo: d.docNo!),
          // Persetujuan #8: the PT as a small badge (code + name), no "PT:" label.
          if (ptText != null) _PtBadge(text: ptText),
        ],
      ),
      // Persetujuan #9: "Tahapan saat ini" — "Menunggu keputusan Anda" when this user decides now.
      Card(
        key: const Key('turn-card'),
        color: theme.colorScheme.primaryContainer,
        child: ListTile(
          leading: const Icon(Icons.flag_circle),
          title: Text(decides ? t.turnYours : t.turnLabel, key: const Key('turn-title')),
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
      // ADR 0024: a Direktur's own request without approval (audited policy exception; web panel note).
      if (d.approvalRule?.noApproval ?? false)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(
            children: [
              const Icon(Icons.info_outline, size: 18),
              const SizedBox(width: 6),
              Expanded(child: Text(t.noApprovalNote, key: const Key('no-approval-note'))),
            ],
          ),
        ),
      // ADR 0029: "Ketersediaan dana PT" (Finance / Direktur / Owner of the PT) + "Perintahkan pinjaman antar-PT"
      if (d.fundCheck != null)
        FundCheckPanel(
          detail: d,
          onInstructLoan: d.allowedActions.contains(instructLoanAction)
              ? () async {
                  await GoRouter.maybeOf(context)?.push(icLoanInstructPath(d));
                  ref.invalidate(requestDetailProvider(d.id));
                }
              : null,
        ),
    ];
    final summary = <Widget>[
      section(t.sectionRequestDetails, key: const Key('section-details')),
      if (d.approvedAmount != null) row(t.approvedAmount, formatRupiah(d.approvedAmount!)),
      // D2: project of the request; the cost center is Finance's (set at transfer) — shown once known.
      row(t.fieldProject, d.project == null ? '-' : refText(d.project!), key: const Key('detail-project')),
      if (d.costCenter != null) row(t.fieldCostCenter, refText(d.costCenter!), key: const Key('detail-cost-center')),
      if (d.urgencyLevel != null) row(t.fieldUrgency, d.urgencyLevel!.name ?? '-'),
      if (d.requestDate != null) row(t.requestDate, formatDateOnly(d.requestDate)),
      row(t.neededDate, formatDateOnly(d.neededDate)),
      if (d.notes != null && d.notes!.trim().isNotEmpty) row(t.fieldNotes, d.notes!.trim()),
      // owner 2026-10-11: the RAB % is money (the server sends basis "none" to Staff) — no row instead of "Tanpa anggaran"
      if (d.budget.hasBudget || (pt?.seesProjectMoney ?? profile?.seesProjectMoney ?? false))
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
      // ADR 0027: a vendor payment — vendor + invoice (the proof; no receipts / LPJ), paid to the vendor account
      if (d.isVendor) ...[
        section(t.sectionVendorPayment, key: const Key('section-vendor')),
        row(t.fieldVendor, d.vendor?.name ?? '-', key: const Key('detail-vendor')),
        row(t.fieldInvoiceNo, d.invoiceNo ?? '-', key: const Key('detail-invoice-no')),
        row(t.fieldInvoiceDate, formatDateOnly(d.invoiceDate)),
        if (d.invoiceDueDate != null) row(t.fieldInvoiceDueDate, formatDateOnly(d.invoiceDueDate)),
        row(
          t.fieldInvoiceFile,
          d.invoiceFileName ?? (d.invoiceFileId == null ? '-' : '#${d.invoiceFileId}'),
          key: const Key('detail-invoice-file'),
        ),
      ],
      // ADR 0028: a PT grup payment — the receiving PT + its document (tagihan / memo), paid to its designated receiving
      // account; after the transfer the receiving PT's Kas Masuk number
      if (d.isPtGrup) ...[
        section(t.sectionIntercompanyPayment, key: const Key('section-intercompany')),
        row(
          t.fieldPayeeCompany,
          d.payeeCompany == null
              ? '-'
              : [?d.payeeCompany!.code, ?d.payeeCompany!.name].where((e) => e.isNotEmpty).join(' — '),
          key: const Key('detail-payee-company'),
        ),
        row(t.fieldDocumentNo, d.invoiceNo ?? '-', key: const Key('detail-invoice-no')),
        row(t.fieldDocumentDate, formatDateOnly(d.invoiceDate)),
        if (d.invoiceDueDate != null) row(t.fieldInvoiceDueDate, formatDateOnly(d.invoiceDueDate)),
        row(
          t.fieldDocumentFile,
          d.invoiceFileName ?? (d.invoiceFileId == null ? '-' : '#${d.invoiceFileId}'),
          key: const Key('detail-invoice-file'),
        ),
        if (d.intercompany case final km?)
          row(
            t.intercompanyEntryLabel(km.companyCode ?? d.payeeCompany?.code ?? '-'),
            km.voided ? t.intercompanyEntryVoided(km.targetEntryNo) : km.targetEntryNo,
            key: const Key('detail-intercompany-entry'),
          ),
      ],
      section(
        d.isVendor
            ? t.fieldVendorBankAccount
            : d.isPtGrup
            ? t.intercompanyReceivingAccount
            : t.bankAccount,
        key: const Key('section-bank'),
      ),
      if (d.bankName == null && d.bankAccountNo == null && d.bankAccountHolder == null)
        Text('-', style: theme.textTheme.bodyMedium)
      else ...[
        if (d.bankName != null) row(t.bankNameLabel, d.bankName!),
        if (d.bankAccountHolder != null) row(t.bankHolderLabel, d.bankAccountHolder!),
        // Masked by the server unless this user may see the full number (dto.ts maskAccountNo).
        if (d.bankAccountNo != null) row(t.bankNumberLabel, d.bankAccountNo!, key: const Key('detail-bank-no')),
      ],
    ];
    // Persetujuan #3: one stepper (overall flow + approval steps); after the summary on phones, right column on
    // tablets.
    final stepper = <Widget>[
      section(t.timelineTitle, key: const Key('section-stepper')),
      RequestStepper(steps: buildRequestStepper(d), zone: zone),
    ];
    final requestFlags = d.flags.where((f) => f.lineNo == null).toList();
    final rest = <Widget>[
      if (TransferSection.visibleFor(d)) TransferSection(detail: d, zone: zone),
      if (d.settlement != null) LpjSection(settlement: d.settlement!),
      RequestLifecycleActions(detail: d),
      RequesterActionsSection(detail: d),
      section(t.linesTitle, key: const Key('section-lines')),
      for (final l in d.lines)
        _LineCard(
          detail: d,
          line: l,
          receipts: d.receipts.where((r) => r.lineId == l.id && r.status != 'removed').toList(),
          photos: receiptPhotos,
        ),
      // Persetujuan #10: the grand total is the footer row of "Rincian item" (not in the header).
      _GrandTotalRow(total: d.grandTotal),
      // Flags of a line are shown on its card; only request-level flags are listed here.
      if (requestFlags.isNotEmpty) ...[
        section(t.flagsTitle, key: const Key('section-flags')),
        for (final f in requestFlags)
          ListTile(
            dense: true,
            leading: Icon(Icons.flag, color: f.level == 'warning' ? context.pk.warnText : theme.colorScheme.outline),
            title: Text(f.kindLabel),
            subtitle: Text(f.message),
          ),
      ],
      const SizedBox(height: 80),
    ];
    if (MediaQuery.sizeOf(context).width < FormGridLayout.twoColumnsMinWidth) {
      return ListView(
        key: const Key('detail-main'),
        padding: const EdgeInsets.all(16),
        children: [...header, ...summary, ...stepper, ...rest],
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: ListView(
            key: const Key('detail-main'),
            padding: const EdgeInsets.all(16),
            children: [...header, ...summary, ...rest],
          ),
        ),
        SizedBox(
          width: 360,
          child: ListView(
            key: const Key('detail-side'),
            padding: const EdgeInsets.fromLTRB(0, 16, 16, 80),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: stepper),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Decisions on a request ("Menunggu keputusan Anda" while the server allows one of them to this user).
const _decisionActions = {'acknowledge', 'approve', 'reject'};

/// Persetujuan #8: PT of the request as a small badge.
class _PtBadge extends StatelessWidget {
  const _PtBadge({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final style = theme.textTheme.labelMedium?.copyWith(color: scheme.primary, fontWeight: FontWeight.w700);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: scheme.primary.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(text, key: const Key('detail-company'), style: style),
    );
  }
}

/// Persetujuan #10: "Grand total" as the footer row of the line items.
class _GrandTotalRow extends StatelessWidget {
  const _GrandTotalRow({required this.total});
  final int total;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final style = theme.textTheme.titleMedium?.copyWith(
      fontWeight: FontWeight.w700,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
    return Container(
      key: const Key('lines-footer'),
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: theme.colorScheme.outlineVariant, width: 2)),
      ),
      child: Row(
        children: [
          Expanded(child: Text(t.grandTotal, style: theme.textTheme.titleSmall)),
          Text(formatRupiah(total), key: const Key('lines-grand-total'), style: style),
        ],
      ),
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

/// Flags already shown as chips on the line (D3 "Selisih nota", D4 "Melebihi RAP").
const _chipFlags = {receiptAmountMismatchFlag, rapOverBudgetFlag};

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
    // Persetujuan #11: the flags of this line, on the line (no summary sentence); "Selisih nota" and "Melebihi RAP"
    // have their chips.
    final flags = detail.flags.where((f) => f.lineNo == line.no && !_chipFlags.contains(f.kind)).toList();
    Color flagColor(FlagInfo f) => f.level == 'warning' ? context.pk.warnText : Theme.of(context).colorScheme.outline;
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
            for (final f in flags)
              Padding(
                key: Key('line-${line.no}-flag-${f.id}'),
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.flag, size: 16, color: flagColor(f)),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(f.kindLabel, style: const TextStyle(fontWeight: FontWeight.w600)),
                          Text(f.message, style: Theme.of(context).textTheme.bodySmall),
                        ],
                      ),
                    ),
                  ],
                ),
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
    // ADR 0029: the PT is short at the decision that makes the request "Disetujui" — the server refuses it (409
    // FUND_INSUFFICIENT); "Setujui" stays visible but disabled with the reason, "Tolak" stays.
    final blocked = detail.fundCheck?.blockedReason;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (blocked != null && (canAck || canApprove))
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(
                  blocked,
                  key: const Key('decision-blocked-text'),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.error),
                ),
              ),
            Row(
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
                      onPressed: blocked != null
                          ? null
                          : () => open(canApprove ? Decision.approve : Decision.acknowledge),
                      icon: const Icon(Icons.check),
                      label: Text(
                        canApprove
                            ? t.actionApprove
                            : (pm
                                  ? t.actionAcknowledgePm
                                  : (direktur ? t.actionAcknowledgeDirektur : t.actionAcknowledge)),
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
