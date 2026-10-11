import 'package:flutter/material.dart';

import '../../../../app/theme.dart';
import '../../../../core/format/rupiah.dart';
import '../../../../l10n/gen/app_localizations.dart';

/// DRMS 10/10 D3: "Selisih nota" — the line's "Nominal sesuai nota" differs from its computed total
/// (awareness only: approval and transfer use the total). Same wording as the web badge. With both amounts
/// the tooltip / semantics say which values differ.
class ReceiptMismatchChip extends StatelessWidget {
  const ReceiptMismatchChip({super.key, this.receiptAmount, this.total});
  final int? receiptAmount;
  final int? total;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final color = context.pk.warnText;
    final detail = receiptAmount != null && total != null
        ? t.receiptMismatchDetail(formatRupiah(receiptAmount!), formatRupiah(total!))
        : null;
    final chip = Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.warning_amber_rounded, size: 14, color: color),
          const SizedBox(width: 4),
          Text(
            t.receiptMismatchChip,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
    return Semantics(
      label: detail ?? t.receiptMismatchChip,
      excludeSemantics: true,
      child: detail == null ? chip : Tooltip(message: detail, child: chip),
    );
  }
}
