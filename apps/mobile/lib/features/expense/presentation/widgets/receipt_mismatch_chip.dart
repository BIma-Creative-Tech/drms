import 'package:flutter/material.dart';

import '../../../../app/theme.dart';
import '../../../../core/format/rupiah.dart';
import '../../../../l10n/gen/app_localizations.dart';

/// DRMS 10/10 D3: "Selisih nota" — the line's "Nominal sesuai nota" differs from its computed total
/// (awareness only: approval and transfer use the total). Same wording as the web badge. With both amounts
/// the tooltip / semantics say which values differ.
class ReceiptMismatchChip extends StatelessWidget {
  const ReceiptMismatchChip({super.key, this.receiptAmount, this.total, this.count});
  final int? receiptAmount;
  final int? total;

  /// Queue badge (approval inbox, like the web Antrian Transfer): "Selisih nota (n)" = n lines.
  final int? count;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    // D2510: soft pill (tone fill + readable text) like PkPill.
    final color = context.pk.warnOn;
    final detail = receiptAmount != null && total != null
        ? t.receiptMismatchDetail(formatRupiah(receiptAmount!), formatRupiah(total!))
        : null;
    final chip = Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: context.pk.warnBg, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.warning_amber_rounded, size: 14, color: color),
          const SizedBox(width: 4),
          Text(
            count == null ? t.receiptMismatchChip : t.receiptMismatchCount(count!),
            style: Theme.of(context).textTheme.labelSmall
                ?.copyWith(color: color, fontWeight: FontWeight.w700, fontSize: 12),
          ),
        ],
      ),
    );
    return Semantics(
      label: detail ?? (count == null ? t.receiptMismatchChip : t.receiptMismatchCount(count!)),
      excludeSemantics: true,
      child: detail == null ? chip : Tooltip(message: detail, child: chip),
    );
  }
}
