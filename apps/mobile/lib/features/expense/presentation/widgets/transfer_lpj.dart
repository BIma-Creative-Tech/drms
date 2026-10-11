import 'package:flutter/material.dart';

import '../../../../app/theme.dart';
import '../../../../core/format/dates.dart';
import '../../../../core/format/rupiah.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/doc_no_chip.dart';
import '../../domain/expense_request.dart';
import '../../domain/request_status.dart';
import 'receipt_thumb.dart';

/// Transfer status for the requester (US-08: "Ditransfer" + amount, date, bank reference; void shown
/// with its reason). Data = `ExpenseRequestDetail.transfers` (Finance posts them on the web).
class TransferSection extends StatelessWidget {
  const TransferSection({super.key, required this.detail});
  final ExpenseDetail detail;

  static bool visibleFor(ExpenseDetail d) =>
      d.transfers.isNotEmpty ||
      d.status == RequestStatus.approved && d.type == RequestType.advance ||
      d.status == RequestStatus.receiptsVerified;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Column(
      key: const Key('transfer-section'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Divider(height: 32),
        Text(t.transferTitle, style: theme.textTheme.titleMedium),
        if (detail.transfers.isEmpty) Text(t.transferNone),
        for (final tr in detail.transfers)
          Card(
            child: ListTile(
              key: Key('transfer-${tr.id}'),
              // d1010 (12b): no transfer screen on the APK — a tap copies the TRF number.
              onTap: tr.docNo == null ? null : () => DocNoChip.copy(context, tr.docNo!),
              leading: Icon(
                tr.isVoid ? Icons.money_off : Icons.account_balance,
                color: tr.isVoid ? context.pk.badText : context.pk.okText,
              ),
              title: Text('${tr.kindLabel} · ${formatRupiah(tr.amount)}'),
              subtitle: Text(
                [
                  '${tr.docNo ?? '-'} · ${formatDateOnly(tr.transferDate)}',
                  if (tr.bankRef != null) '${t.transferRef}: ${tr.bankRef}',
                  if (tr.isVoid && tr.voidReason != null) t.transferVoidReason(tr.voidReason!),
                ].join('\n'),
              ),
              trailing: Chip(label: Text(tr.isVoid ? t.transferVoid : t.transferPosted)),
            ),
          ),
        if (detail.transferredTotal > 0)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              '${t.transferTotal}: ${formatRupiah(detail.transferredTotal)}',
              key: const Key('transfer-total'),
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
      ],
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
    Widget row(String k, String v, {Key? key}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 150, child: Text(k, style: Theme.of(context).textTheme.bodySmall)),
          Expanded(child: Text(v, key: key)),
        ],
      ),
    );
    String money(int? v) => v == null ? '-' : formatRupiah(v);
    return Column(
      key: const Key('lpj-section'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Divider(height: 32),
        Text(t.lpjTitle, style: Theme.of(context).textTheme.titleMedium),
        row(t.lpjStatus, [s.docNo, s.statusLabel].whereType<String>().join(' · '), key: const Key('lpj-status')),
        // d1010 (12b): the LPJ lives on this screen (no separate APK screen) — the chip copies its number.
        if (s.docNo != null)
          Align(
            alignment: Alignment.centerLeft,
            child: DocNoChip(docNo: s.docNo!),
          ),
        row(t.transferTotal, money(s.transferredTotal)),
        row(t.lpjReceiptsTotal, money(s.receiptsTotal)),
        if (s.verifiedReceiptsTotal != null) row(t.lpjVerifiedTotal, money(s.verifiedReceiptsTotal)),
        if (s.difference != null) row(t.lpjDifference, money(s.difference)),
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
          Card(
            color: Theme.of(context).colorScheme.errorContainer,
            child: ListTile(
              leading: const Icon(Icons.feedback),
              title: Text(t.lpjFinanceNotes),
              subtitle: Text(s.financeNotes!, key: const Key('lpj-finance-notes')),
            ),
          ),
      ],
    );
  }
}
