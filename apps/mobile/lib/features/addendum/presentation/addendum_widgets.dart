import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../app/theme.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../progress/domain/progress.dart' show fmtPct;
import '../domain/addendum.dart';

/// Status chip: icon + label (never colour alone).
class AddendumStatusChip extends StatelessWidget {
  const AddendumStatusChip({super.key, required this.a});
  final Addendum a;

  @override
  Widget build(BuildContext context) {
    final (IconData icon, Color? color) = switch (a.status) {
      AddendumStatus.draft => (Icons.edit_note, null),
      AddendumStatus.pendingAck || AddendumStatus.pendingApproval => (Icons.hourglass_top, StatusColors.warning),
      AddendumStatus.approved => (Icons.check_circle, StatusColors.ok),
      AddendumStatus.rejected => (Icons.cancel, StatusColors.danger),
      AddendumStatus.cancelled => (Icons.block, null),
    };
    return Chip(
      avatar: Icon(icon, size: 18, color: color),
      label: Text(a.statusLabel.isEmpty ? a.status.name : a.statusLabel),
      visualDensity: VisualDensity.compact,
    );
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
          style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
        ),
        if (before != null && after != null) Text(t.addendumRabBeforeAfter(formatRupiah(before), formatRupiah(after))),
        if (b?.committedPctBefore != null && b?.committedPctAfter != null)
          Text(
            t.addendumCommittedPct(fmtPct(b!.committedPctBefore!), fmtPct(b.committedPctAfter!)),
            style: theme.textTheme.bodySmall,
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
    return Card(
      key: Key('addendum-${a.id}'),
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: () => context.push('/addenda/${a.id}'),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      [a.docNo ?? 'Draft', if (a.stepLabel != null && a.status.isOpen) a.stepLabel!].join(' · '),
                      style: theme.textTheme.labelMedium,
                    ),
                  ),
                  AddendumStatusChip(a: a),
                ],
              ),
              Text(a.projectLabel, style: theme.textTheme.titleSmall),
              const SizedBox(height: 4),
              AddendumImpact(a: a),
              const SizedBox(height: 4),
              Text(a.reason, maxLines: 2, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodySmall),
              if (a.createdByName != null) Text(a.createdByName!, style: theme.textTheme.bodySmall),
            ],
          ),
        ),
      ),
    );
  }
}
