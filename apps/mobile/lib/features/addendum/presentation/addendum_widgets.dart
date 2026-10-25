import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/icons/iconsax.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../progress/domain/progress.dart' show fmtPct;
import '../domain/addendum.dart';
import '../../companies/presentation/company_chip.dart';

/// Status chip: icon + label (never colour alone).
class AddendumStatusChip extends StatelessWidget {
  const AddendumStatusChip({super.key, required this.a});
  final Addendum a;

  @override
  Widget build(BuildContext context) {
    // D2510: a soft status pill (icon + label, never colour alone).
    final (IconData icon, PkTone tone) = switch (a.status) {
      AddendumStatus.draft => (Icons.edit_note, PkTone.neutral),
      AddendumStatus.pendingAck || AddendumStatus.pendingApproval => (Icons.hourglass_top, PkTone.warn),
      AddendumStatus.approved => (Icons.check_circle, PkTone.ok),
      AddendumStatus.rejected => (Icons.cancel, PkTone.bad),
      AddendumStatus.cancelled => (Icons.block, PkTone.neutral),
    };
    return PkPill(icon: icon, tone: tone, label: a.statusLabel.isEmpty ? a.status.name : a.statusLabel);
  }
}

/// RAB before → after and the committed share before → after (US-30 impact).
class AddendumImpact extends StatelessWidget {
  const AddendumImpact({super.key, required this.a});
  final Addendum a;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final b = a.budget;
    final before = b?.current ?? a.oldBudget ?? a.projectBudget;
    final after = b?.afterAddition ?? a.newBudget ?? (before == null ? null : before + a.addition);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '+${formatRupiah(a.addition)}',
          style: theme.textTheme.headlineSmall?.copyWith(
            fontWeight: FontWeight.w700,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
        if (before != null && after != null)
          Text(
            t.addendumRabBeforeAfter(formatRupiah(before), formatRupiah(after)),
            style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w500),
          ),
        if (b?.committedPctBefore != null && b?.committedPctAfter != null)
          Text(
            t.addendumCommittedPct(fmtPct(b!.committedPctBefore!), fmtPct(b.committedPctAfter!)),
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
      ],
    );
  }
}

class AddendumCard extends StatelessWidget {
  const AddendumCard({super.key, required this.a});
  final Addendum a;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    // D2510: a bordered card — addendum chip, number / step + status pill, project, impact, reason.
    return PkCard(
      key: Key('addendum-${a.id}'),
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      onTap: () => context.push('/addenda/${a.id}'),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const PkIconChip(icon: PkIcons.addendum, size: 40),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CompanyChipLead(companyId: a.companyId),
                    Expanded(
                      child: Text(
                        [a.docNo ?? 'Draft', if (a.stepLabel != null && a.status.isOpen) a.stepLabel!].join(' · '),
                        style: theme.textTheme.labelMedium?.copyWith(
                          color: theme.colorScheme.primary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                AddendumStatusChip(a: a),
                const SizedBox(height: 6),
                Text(a.projectLabel, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                AddendumImpact(a: a),
                const SizedBox(height: 6),
                Text(a.reason, maxLines: 2, overflow: TextOverflow.ellipsis, style: muted),
                if (a.createdByName != null) Text(a.createdByName!, style: muted),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
