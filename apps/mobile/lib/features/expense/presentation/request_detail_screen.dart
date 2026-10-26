import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/connectivity/connectivity_controller.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/doc_no_chip.dart';
import '../../../shared/widgets/form_grid.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_keuangan.dart';
import '../../approvals/application/inbox_providers.dart';
import '../../approvals/data/approvals_api.dart';
import '../../approvals/presentation/decision_sheet.dart';
import '../../auth/application/auth_controller.dart';
import '../application/expense_providers.dart';
import '../domain/expense_request.dart';
import '../domain/project_loan_instruction.dart';
import '../domain/turn_timeline.dart';
import 'finance_lpj_actions.dart';
import 'requester_actions.dart';
import 'widgets/attachments.dart';
import 'widgets/fund_check_panel.dart';
import 'widgets/project_loan_instruct_sheet.dart';
import 'widgets/rap_item_picker.dart';
import 'widgets/request_stepper.dart';
import 'widgets/request_ui.dart';
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
    // D2510: label / value rows inside section cards (value right-aligned, amounts bold).
    Widget row(String k, String v, {Key? key, bool money = false}) => PkInfoRow(
      label: k,
      value: Text(v, key: key),
      valueStyle: money ? pkMoneyStyle(context) : null,
    );
    // d1010 (WA-09): the same section titles on web and APK — D2510: each section is a titled card.
    Widget section(String title, List<Widget> children, {Key? key, Object? icon}) => PkSectionCard(
      key: key,
      title: title,
      icon: icon,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
    );
    String refText(RefItem r) => '${r.code ?? ''} ${r.name ?? ''}'.trim();
    // ADR 0031: the latest posted transfer paid from an account other than the Pusat Biaya (→ its automatic loan)
    final paidFrom = d.transfers.where((x) => !x.isVoid && x.paidFromCashAccount != null).lastOrNull;
    final paidFromAccount = paidFrom?.paidFromCashAccount?.label;
    final paidFromLoan = paidFrom?.projectLoan?.docNo;
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
      // D2510: header card — type icon + title, type / status pills, PT badge, document number chip.
      PkCard(
        key: const Key('detail-header'),
        radius: PkRadius.lg,
        margin: const EdgeInsets.only(bottom: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                requestTypeChip(d.type, payee: d.payeeType, size: 44),
                const SizedBox(width: 12),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      d.title,
                      style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700, height: 1.25),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                PkPill(label: d.typeLabel),
                PkPill(label: d.statusLabel, tone: requestStatusTone(d.status)),
                // Persetujuan #8: the PT as a small badge (code + name), no "PT:" label.
                if (ptText != null) _PtBadge(text: ptText),
              ],
            ),
            if (d.docNo != null) ...[const SizedBox(height: 6), DocNoChip(docNo: d.docNo!)],
          ],
        ),
      ),
      // Persetujuan #9: "Tahapan saat ini" — "Menunggu keputusan Anda" when this user decides now.
      PkNoticeCard(
        key: const Key('turn-card'),
        icon: decides ? Icons.flag_rounded : Icons.timelapse_rounded,
        title: Text(decides ? t.turnYours : t.turnLabel, key: const Key('turn-title')),
        body: Text(currentTurn(d), key: const Key('turn-text')),
      ),
      // ADR 0021: narrow G1 exception, recorded on the request (audit + PDF + panel).
      if (d.approvalRule?.direkturViaPm ?? false)
        PkNoticeCard(
          dense: true,
          tone: PkTone.neutral,
          icon: Icons.info_outline,
          title: Text(
            d.approvalRule!.direkturViaPmSelf ? t.direkturViaPmSelfNote : t.direkturViaPmNote,
            key: const Key('direktur-via-pm-note'),
          ),
        ),
      // ADR 0024: a Direktur's own request without approval (audited policy exception; web panel note).
      if (d.approvalRule?.noApproval ?? false)
        PkNoticeCard(
          dense: true,
          tone: PkTone.neutral,
          icon: Icons.info_outline,
          title: Text(t.noApprovalNote, key: const Key('no-approval-note')),
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
      section(t.sectionRequestDetails, key: const Key('section-details'), icon: Icons.description_outlined, [
        if (d.approvedAmount != null) row(t.approvedAmount, formatRupiah(d.approvedAmount!), money: true),
        row(t.fieldProject, d.project == null ? '-' : refText(d.project!), key: const Key('detail-project')),
        // ADR 0031 (DRMS 21/10): the Pusat Biaya = the project's cash account (read-only; the requester never picks it)
        if (d.project != null)
          row(t.fieldCostCenter, d.pusatBiaya?.label ?? t.pusatBiayaUnmapped, key: const Key('detail-pusat-biaya')),
        // D2 legacy: the own cost center of an old non-project request
        if (d.project == null && d.costCenter != null)
          row(t.costCenterLegacyLabel, refText(d.costCenter!), key: const Key('detail-cost-center')),
        // ADR 0031: a transfer paid from another account → the automatic inter-project loan
        if (paidFromAccount != null)
          row(
            t.paidFromAccountLabel,
            paidFromLoan == null ? paidFromAccount : t.paidFromAccountLoan(paidFromAccount, paidFromLoan),
            key: const Key('detail-paid-from'),
          ),
        if (d.urgencyLevel != null) row(t.fieldUrgency, d.urgencyLevel!.name ?? '-'),
        if (d.requestDate != null) row(t.requestDate, formatDateOnly(d.requestDate)),
        row(t.neededDate, formatDateOnly(d.neededDate)),
        if (d.notes != null && d.notes!.trim().isNotEmpty) row(t.fieldNotes, d.notes!.trim()),
        // owner 2026-10-11: the RAB % is money (the server sends basis "none" to Staff) — no row instead of "Tanpa
        // anggaran"
        if (d.budget.hasBudget || (pt?.seesProjectMoney ?? profile?.seesProjectMoney ?? false))
          row(
            t.budgetImpact,
            d.budget.hasBudget ? t.budgetChange(pct(d.budget.pctBefore), pct(d.budget.pctAfter)) : t.budgetNone,
          ),
        if (over)
          Padding(
            padding: const EdgeInsets.only(top: 4, bottom: 2),
            child: Align(
              alignment: Alignment.centerRight,
              child: PkPill(label: '${t.budgetImpact} > 85%', tone: PkTone.bad, icon: Icons.warning_amber_rounded),
            ),
          ),
        if (d.rejectReason != null) row(t.rejectReasonLabel, d.rejectReason!),
      ]),
      // D2410 (point 6): the general attachments ("Lampiran", photo / PDF) — a tap opens the file
      if (d.attachments.isNotEmpty)
        section(t.sectionAttachments, key: const Key('section-attachments'), icon: Icons.attach_file, [
          RequestAttachmentList(attachments: d.attachments),
        ]),
      section(t.sectionRequester, key: const Key('section-requester'), icon: Icons.person_outline, [
        row(t.requesters, d.requesters.map((r) => r.name ?? '-').join(', ')),
        if (d.createdByName != null) row(t.createdBy, d.createdByName!),
      ]),
      // ADR 0027: a vendor payment — vendor + invoice (the proof; no receipts / LPJ), paid to the vendor account
      if (d.isVendor)
        section(t.sectionVendorPayment, key: const Key('section-vendor'), icon: Icons.storefront_outlined, [
          row(t.fieldVendor, d.vendor?.name ?? '-', key: const Key('detail-vendor')),
          row(t.fieldInvoiceNo, d.invoiceNo ?? '-', key: const Key('detail-invoice-no')),
          row(t.fieldInvoiceDate, formatDateOnly(d.invoiceDate)),
          if (d.invoiceDueDate != null) row(t.fieldInvoiceDueDate, formatDateOnly(d.invoiceDueDate)),
          row(
            t.fieldInvoiceFile,
            d.invoiceFileName ?? (d.invoiceFileId == null ? '-' : '#${d.invoiceFileId}'),
            key: const Key('detail-invoice-file'),
          ),
        ]),
      // ADR 0028: a PT grup payment — the receiving PT + its document (tagihan / memo), paid to its designated receiving
      // account; after the transfer the receiving PT's Kas Masuk number
      if (d.isPtGrup)
        section(t.sectionIntercompanyPayment, key: const Key('section-intercompany'), icon: Icons.apartment_outlined, [
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
        ]),
      section(
        d.isVendor
            ? t.fieldVendorBankAccount
            : d.isPtGrup
            ? t.intercompanyReceivingAccount
            : t.bankAccount,
        key: const Key('section-bank'),
        icon: Icons.account_balance_outlined,
        [
          if (d.bankName == null && d.bankAccountNo == null && d.bankAccountHolder == null)
            Text('-', style: theme.textTheme.bodyMedium)
          else ...[
            if (d.bankName != null) row(t.bankNameLabel, d.bankName!),
            if (d.bankAccountHolder != null) row(t.bankHolderLabel, d.bankAccountHolder!),
            // Masked by the server unless this user may see the full number (dto.ts maskAccountNo).
            if (d.bankAccountNo != null) row(t.bankNumberLabel, d.bankAccountNo!, key: const Key('detail-bank-no')),
          ],
        ],
      ),
    ];
    // Persetujuan #3: one stepper (overall flow + approval steps); after the summary on phones, right column on
    // tablets.
    final stepper = section(t.timelineTitle, key: const Key('section-stepper'), icon: Icons.timeline, [
      const SizedBox(height: 4),
      RequestStepper(steps: buildRequestStepper(d), zone: zone),
    ]);
    final requestFlags = d.flags.where((f) => f.lineNo == null).toList();
    final lines = [
      for (final l in d.lines)
        _LineCard(
          detail: d,
          line: l,
          receipts: d.receipts.where((r) => r.lineId == l.id && r.status != 'removed').toList(),
          photos: receiptPhotos,
        ),
    ];
    final rest = <Widget>[
      if (TransferSection.visibleFor(d)) TransferSection(detail: d, zone: zone),
      if (d.settlement != null) LpjSection(settlement: d.settlement!),
      RequestLifecycleActions(detail: d),
      RequesterActionsSection(detail: d),
      section(t.linesTitle, key: const Key('section-lines'), icon: Icons.receipt_long_outlined, [
        for (final (i, line) in lines.indexed) ...[if (i > 0) Divider(height: 1, color: context.pk.border), line],
        // Persetujuan #10: the grand total is the footer row of "Rincian item" (not in the header).
        _GrandTotalRow(total: d.grandTotal),
      ]),
      // Flags of a line are shown on its card; only request-level flags are listed here.
      if (requestFlags.isNotEmpty)
        section(t.flagsTitle, key: const Key('section-flags'), icon: Icons.flag_outlined, [
          for (final f in requestFlags)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.flag, color: f.level == 'warning' ? context.pk.warnText : theme.colorScheme.outline),
              title: Text(f.kindLabel, style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(f.message),
                  if (f.status == 'reviewed') Text(t.flagReviewedLabel, key: Key('flag-reviewed-${f.id}')),
                  // D2510: Finance marks the flag reviewed (web Verifikasi LPJ / Reimburse review)
                  if (canReviewFlag(d, f)) FlagReviewButton(detail: d, flag: f),
                ],
              ),
            ),
        ]),
      const SizedBox(height: 80),
    ];
    if (MediaQuery.sizeOf(context).width < FormGridLayout.twoColumnsMinWidth) {
      return ListView(
        key: const Key('detail-main'),
        padding: const EdgeInsets.all(16),
        children: [...header, ...summary, stepper, ...rest],
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
            children: [stepper],
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
    final style = theme.textTheme.labelSmall?.copyWith(
      color: context.pk.infoOn,
      fontWeight: FontWeight.w700,
      fontSize: 12,
      height: 1.3,
    );
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: context.pk.infoBg,
        border: Border.all(color: scheme.primary.withValues(alpha: 0.25)),
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
      color: context.pk.infoOn,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
    return Container(
      key: const Key('lines-footer'),
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: BoxDecoration(color: context.pk.infoBg, borderRadius: BorderRadius.circular(PkRadius.sm)),
      child: Row(
        children: [
          Expanded(
            child: Text(
              t.grandTotal,
              style: theme.textTheme.titleSmall?.copyWith(color: context.pk.infoOn, fontWeight: FontWeight.w700),
            ),
          ),
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
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    // D2510: a block inside the "Rincian item" card (divider between lines) instead of a card of its own.
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  '${line.no}. ${line.description ?? '-'}',
                  style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
              const SizedBox(width: 10),
              Text(formatRupiah(line.total), style: pkMoneyStyle(context)),
            ],
          ),
          const SizedBox(height: 2),
          Text(meta, key: Key('line-${line.no}-meta'), style: muted),
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
                        if (f.status == 'reviewed')
                          Text(
                            t.flagReviewedLabel,
                            key: Key('flag-reviewed-${f.id}'),
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
                          ),
                        // D2510: Finance marks the flag reviewed (web Verifikasi LPJ / Reimburse review)
                        if (canReviewFlag(detail, f)) FlagReviewButton(detail: detail, flag: f),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          if (line.notes != null) Text(line.notes!, style: Theme.of(context).textTheme.bodySmall),
          if (receipts.isNotEmpty) const SizedBox(height: 8),
          for (final r in receipts)
            // D2510: a Material tile (the review buttons keep their ink); Finance decides each receipt here.
            PkTile(
              key: Key('receipt-${r.id}'),
              margin: const EdgeInsets.only(top: 6),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 8, 4, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        ReceiptThumb(imageId: r.imageId, group: photos, caption: receiptCaption(t, line, r)),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            '${r.vendorName}\n${r.receiptNo ?? '-'} · ${formatDateOnly(r.receiptDate)} · '
                            '${receiptStatusLabel(r.status)}',
                            key: Key('receipt-${r.id}-text'),
                            style: theme.textTheme.bodySmall,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(formatRupiah(r.amount), style: pkMoneyStyle(context)),
                        if (canRemove && receiptRemovable(r.status))
                          IconButton(
                            key: Key('receipt-remove-${r.id}'),
                            tooltip: t.receiptRemove,
                            icon: const Icon(Icons.delete_outline),
                            onPressed: () => removeServerReceipt(context, ref, detail, r),
                          ),
                      ],
                    ),
                    if (canReviewReceipt(detail, r))
                      Padding(
                        padding: const EdgeInsets.only(right: 4),
                        child: ReceiptReviewButtons(detail: detail, receipt: r),
                      ),
                  ],
                ),
              ),
            ),
        ],
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
    // D2510: the action bar sits on a card-coloured strip with a hairline top border.
    Widget bar(Widget child) => DecoratedBox(
      decoration: BoxDecoration(
        color: context.pk.card,
        border: Border(top: BorderSide(color: context.pk.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 10), child: child),
      ),
    );
    // DRMS 10/10 point 10: Finance records the transfer from the APK too (same form as the Finance menu).
    if (a.contains('transfer') && !canAck && !canApprove && !canReject) {
      return bar(
        FilledButton.icon(
          key: const Key('action-transfer'),
          onPressed: () async {
            await context.push<bool>('/finance/transfer/${detail.id}');
            ref.invalidate(requestDetailProvider(detail.id));
          },
          icon: const Icon(Icons.account_balance),
          label: Text(t.transferRecord),
        ),
      );
    }
    // D2510: Finance on a submitted LPJ — "Minta revisi" / "Verifikasi LPJ" (the web Verifikasi LPJ actions).
    if (showsFinanceLpjBar(detail) && !canAck && !canApprove && !canReject) {
      return bar(FinanceLpjBar(detail: detail));
    }
    if (!canAck && !canApprove && !canReject) return const SizedBox.shrink();

    Future<void> open(Decision decision) async {
      final done = await showDecisionSheet(context, detail: detail, decision: decision);
      // Also after a refusal (403/409): the buttons must reflect the server's current allowedActions.
      ref.invalidate(requestDetailProvider(detail.id));
      ref.invalidate(inboxProvider);
      if (done != true || !context.mounted) return;
      final message = '${detail.docNo ?? detail.title}: ${t.decisionDone}';
      await showActionResult(context, message: message, action: decisionActionLabel(t, decision));
    }

    final pm = detail.approvalRule?.pmApproval ?? false;
    final direktur = detail.approvalRule?.decisionFlow ?? false;
    // ADR 0029: the PT is short at the decision that makes the request "Disetujui" — the server refuses it (409
    // FUND_INSUFFICIENT); "Setujui" stays visible but disabled with the reason, "Tolak" stays.
    final blocked = detail.fundCheck?.blockedReason;

    return bar(
      Column(
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
          // DRMS 26/10 #1: the project's cash account is short → the final decider instructs an inter-project loan
          if (detail.allowedActions.contains(instructProjectLoanAction))
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ProjectLoanInstructButton(requestId: detail.id, docNo: detail.docNo, filled: false),
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
    );
  }
}
