import 'package:flutter/material.dart';

import '../../../../app/theme.dart';
import '../../../../core/format/dates.dart';
import '../../../../core/format/rupiah.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/doc_no_chip.dart';
import '../../../../shared/widgets/pk_ui.dart';
import '../../../../shared/widgets/pk_ui_keuangan.dart';
import '../../domain/expense_request.dart';
import '../../domain/request_status.dart';
import 'receipt_thumb.dart';

/// Transfer status for the requester (US-08: "Ditransfer" + amount, date, bank reference; void shown
/// with its reason). Data = `ExpenseRequestDetail.transfers` (Finance posts them on the web).
class TransferSection extends StatelessWidget {
  const TransferSection({super.key, required this.detail, this.zone});
  final ExpenseDetail detail;

  /// Time zone of the request's PT (transfer time display).
  final String? zone;

  static bool visibleFor(ExpenseDetail d) =>
      d.transfers.isNotEmpty ||
      d.status == RequestStatus.approved && d.type == RequestType.advance ||
      d.status == RequestStatus.receiptsVerified;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    // D2510: a titled section card; each transfer a soft bordered tile with a status pill.
    return PkSectionCard(
      key: const Key('transfer-section'),
      title: t.transferTitle,
      icon: Icons.account_balance_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (detail.transfers.isEmpty)
            Text(t.transferNone, style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
          for (final tr in detail.transfers)
            Container(
              margin: const EdgeInsets.only(bottom: 8),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerLow,
                border: Border.all(color: context.pk.border),
                borderRadius: BorderRadius.circular(PkRadius.sm),
              ),
              clipBehavior: Clip.antiAlias,
              child: ListTile(
                key: Key('transfer-${tr.id}'),
                // d1010 (12b): no transfer screen on the APK — a tap copies the TRF number.
                onTap: tr.docNo == null ? null : () => DocNoChip.copy(context, tr.docNo!),
                contentPadding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
                leading: PkIconChip(
                  icon: tr.isVoid ? Icons.money_off : Icons.account_balance,
                  tone: tr.isVoid ? PkTone.bad : PkTone.ok,
                ),
                title: Text(
                  '${tr.kindLabel} · ${formatRupiah(tr.amount)}',
                  style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                ),
                subtitle: Text(
                  [
                    // item 11: date + time of the proof when recorded with a time
                    '${tr.docNo ?? '-'} · ${tr.transferAt != null ? formatServerDateTime(tr.transferAt, zone: zone) : formatDateOnly(tr.transferDate)}',
                    // ADR 0031: the Pusat Biaya the transfer is charged to (D2 legacy: the cost center chosen by Finance)
                    if (tr.cashAccount != null)
                      '${t.fieldCostCenter}: ${tr.cashAccount!.label}'
                    else if (tr.costCenter != null)
                      '${t.fieldCostCenter}: ${'${tr.costCenter!.code ?? ''} ${tr.costCenter!.name ?? ''}'.trim()}',
                    // ADR 0031: paid from another account → the automatic inter-project loan
                    if (tr.paidFromCashAccount != null) t.transferPaidFrom(tr.paidFromCashAccount!.label),
                    if (tr.projectLoan != null)
                      t.transferProjectLoan(tr.projectLoan!.docNo ?? '#${tr.projectLoan!.id}'),
                    if (tr.bankRef != null) '${t.transferRef}: ${tr.bankRef}',
                    if (tr.isVoid && tr.voidReason != null) t.transferVoidReason(tr.voidReason!),
                  ].join('\n'),
                ),
                trailing: PkPill(
                  label: tr.isVoid ? t.transferVoid : t.transferPosted,
                  tone: tr.isVoid ? PkTone.bad : PkTone.ok,
                ),
              ),
            ),
          if (detail.transferredTotal > 0)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                '${t.transferTotal}: ${formatRupiah(detail.transferredTotal)}',
                key: const Key('transfer-total'),
                textAlign: TextAlign.end,
                style: pkMoneyStyle(context),
              ),
            ),
        ],
      ),
    );
  }
}

/// LPJ summary of an Pengajuan Baru (T5): status, totals, difference and Finance's revision note.
class LpjSection extends StatelessWidget {
  const LpjSection({super.key, required this.settlement});
  final SettlementInfo settlement;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final s = settlement;
    Widget row(String k, String v, {Key? key, bool money = false}) => PkInfoRow(
      label: k,
      value: Text(v, key: key),
      valueStyle: money ? pkMoneyStyle(context) : null,
    );
    String money(int? v) => v == null ? '-' : formatRupiah(v);
    // D2510: a titled section card like the other detail sections.
    return PkSectionCard(
      key: const Key('lpj-section'),
      title: t.lpjTitle,
      icon: Icons.assignment_turned_in_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          row(t.lpjStatus, [s.docNo, s.statusLabel].whereType<String>().join(' · '), key: const Key('lpj-status')),
          // d1010 (12b): the LPJ lives on this screen (no separate APK screen) — the chip copies its number.
          if (s.docNo != null)
            Align(
              alignment: Alignment.centerLeft,
              child: DocNoChip(docNo: s.docNo!),
            ),
          row(t.transferTotal, money(s.transferredTotal), money: true),
          row(t.lpjReceiptsTotal, money(s.receiptsTotal), money: true),
          if (s.verifiedReceiptsTotal != null) row(t.lpjVerifiedTotal, money(s.verifiedReceiptsTotal), money: true),
          if (s.difference != null) row(t.lpjDifference, money(s.difference), money: true),
          if (s.settlementTypeLabel != null) row(t.lpjSettlement, s.settlementTypeLabel!),
          if (s.usageNotes != null) row(t.lpjUsageNotes, s.usageNotes!),
          // d1010 (13): LPJ photos, read-only here (changed only in "Kirim LPJ" while the LPJ is editable);
          // a tap opens the shared viewer swiping through every LPJ photo.
          if (s.photos.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text('${t.lpjPhotos} (${s.photos.length})', style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 4),
            Wrap(
              key: const Key('lpj-photos'),
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final (i, id) in s.photos.indexed)
                  ReceiptThumb(
                    key: Key('lpj-photo-$id'),
                    imageId: id,
                    caption: t.lpjPhotoCaption(i + 1),
                    group: [for (final (j, p) in s.photos.indexed) (imageId: p, caption: t.lpjPhotoCaption(j + 1))],
                  ),
              ],
            ),
          ],
          if (s.financeNotes != null)
            PkNoticeCard(
              tone: PkTone.bad,
              icon: Icons.feedback_outlined,
              margin: const EdgeInsets.only(top: 10),
              title: Text(t.lpjFinanceNotes),
              body: Text(s.financeNotes!, key: const Key('lpj-finance-notes')),
            ),
        ],
      ),
    );
  }
}
