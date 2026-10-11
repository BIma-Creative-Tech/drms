import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme.dart';
import '../../../../core/format/rupiah.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/async_body.dart' as async_body;
import '../../../projects/application/projects_providers.dart';
import '../../../projects/domain/project.dart';

/// DRMS 10/10 D4: "Melebihi RAP" — the line (or a line of the request) is above the remaining budget of its RAP
/// item (server flag `rap_over_budget`, or the live remaining budget in the line editor). Awareness only.
class RapOverBudgetChip extends StatelessWidget {
  const RapOverBudgetChip({super.key, this.detail});

  /// Tooltip / semantics, e.g. "Total Rp 600.000 > sisa Rp 250.000".
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final color = context.pk.badText;
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
          Icon(Icons.trending_up_rounded, size: 14, color: color),
          const SizedBox(width: 4),
          Text(
            t.rapOverBudgetChip,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
    return Semantics(
      label: detail ?? t.rapOverBudgetChip,
      excludeSemantics: true,
      child: detail == null ? chip : Tooltip(message: detail, child: chip),
    );
  }
}

/// Plan / realisation bar of a RAP item (red once the realisation passes the plan).
class RapProgressBar extends StatelessWidget {
  const RapProgressBar({super.key, required this.item});
  final RapBudgetItem item;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ClipRRect(
      borderRadius: BorderRadius.circular(4),
      child: LinearProgressIndicator(
        value: item.progress ?? 0,
        minHeight: 6,
        color: item.overBudget ? context.pk.badText : theme.colorScheme.primary,
        backgroundColor: theme.colorScheme.surfaceContainerHighest,
      ),
    );
  }
}

/// "Sisa Rp 250.000 dari Rp 1.000.000 · 75%" / "Lebih Rp 1.200.000 dari Rp 15.000.000 · 108%" (null without money
/// figures, e.g. offline or a role without RAP prices).
String? rapRemainingText(AppLocalizations t, RapBudgetItem i) {
  if (i.remaining == null) return null;
  final of = i.planned == null ? '' : ' ${t.rapOf(formatRupiah(i.planned!))}';
  final pct = i.progress == null ? '' : ' · ${((i.percent ?? (i.progress! * 100))).toStringAsFixed(0)}%';
  final rest = i.remaining! < 0 ? t.rapOverBy(formatRupiah(-i.remaining!)) : t.rapRemaining(formatRupiah(i.remaining!));
  return '$rest$of$pct';
}

/// D4 required "Item RAP" picker of a draft line: RAP items of the draft's project, searchable, each with its
/// remaining budget. [lineTotal] (qty × harga satuan) shows "Melebihi RAP" when it is above the remaining budget.
class RapItemPickerField extends ConsumerWidget {
  const RapItemPickerField({
    super.key,
    required this.projectId,
    required this.value,
    required this.onChanged,
    this.lineTotal,
    this.errorText,
  });

  final int? projectId;
  final int? value;
  final ValueChanged<int> onChanged;
  final int? lineTotal;
  final String? errorText;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final pid = projectId;
    final load = pid == null ? null : ref.watch(projectRapProvider(pid));
    final data = load?.value;
    final selected = data?.byId(value);
    final remaining = selected == null ? null : rapRemainingText(t, selected);
    final over = selected?.exceeds(lineTotal) ?? false;
    String? helper;
    if (pid == null) {
      helper = t.rapPickProjectFirst;
    } else if (load?.error case final err? when data == null) {
      helper = errorText == null ? async_body.errorText(err) : null;
    } else if (selected != null) {
      helper = remaining ?? (data!.offline ? t.rapOfflineNoBudget : null);
    } else if (data != null && data.pickable.isEmpty) {
      helper = t.rapNoItems;
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          key: const Key('line-rap-item'),
          onTap: data == null || data.pickable.isEmpty
              ? (load is AsyncError && pid != null ? () => ref.invalidate(projectRapProvider(pid)) : null)
              : () async {
                  final picked = await showDialog<int>(
                    context: context,
                    builder: (_) => _RapPickerDialog(items: data.pickable, offline: data.offline, lineTotal: lineTotal),
                  );
                  if (picked != null) onChanged(picked);
                },
          child: InputDecorator(
            decoration: InputDecoration(
              labelText: t.fieldRapItem,
              errorText: errorText,
              helperText: helper,
              helperMaxLines: 2,
              suffixIcon: load is AsyncLoading
                  ? const Padding(
                      padding: EdgeInsets.all(14),
                      child: SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                    )
                  : const Icon(Icons.arrow_drop_down),
            ),
            child: selected != null || value != null
                ? Text(selected?.label ?? '#$value', key: const Key('line-rap-item-label'))
                : Text(t.rapPickHint, style: theme.textTheme.bodyLarge?.copyWith(color: theme.hintColor)),
          ),
        ),
        if (over)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: RapOverBudgetChip(
              key: const Key('line-rap-over'),
              detail: t.rapOverDetail(formatRupiah(lineTotal!), formatRupiah(selected!.remaining!)),
            ),
          ),
      ],
    );
  }
}

class _RapPickerDialog extends StatefulWidget {
  const _RapPickerDialog({required this.items, required this.offline, this.lineTotal});
  final List<RapBudgetItem> items;
  final bool offline;
  final int? lineTotal;

  @override
  State<_RapPickerDialog> createState() => _RapPickerDialogState();
}

class _RapPickerDialogState extends State<_RapPickerDialog> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final q = _q.toLowerCase();
    final filtered = widget.items.where((i) => q.isEmpty || i.label.toLowerCase().contains(q)).toList();
    return AlertDialog(
      title: Text(t.fieldRapItem),
      contentPadding: const EdgeInsets.fromLTRB(8, 12, 8, 0),
      content: SizedBox(
        width: double.maxFinite,
        height: 460,
        child: Column(
          children: [
            TextField(
              key: const Key('rap-search'),
              decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: t.searchHint),
              onChanged: (v) => setState(() => _q = v),
            ),
            if (widget.offline)
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
                child: Text(t.rapOfflineNoBudget, style: theme.textTheme.bodySmall),
              ),
            Expanded(
              child: filtered.isEmpty
                  ? Center(child: Text(t.noSearchResults))
                  : ListView.separated(
                      itemCount: filtered.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (_, k) {
                        final i = filtered[k];
                        final rest = rapRemainingText(t, i);
                        final over = i.overBudget || (i.exceeds(widget.lineTotal) ?? false);
                        return ListTile(
                          key: Key('rap-option-${i.id}'),
                          title: Text(i.label),
                          subtitle: rest == null
                              ? (i.uom.isEmpty ? null : Text(i.uom))
                              : Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      rest,
                                      style: over
                                          ? TextStyle(color: context.pk.badText, fontWeight: FontWeight.w600)
                                          : null,
                                    ),
                                    const SizedBox(height: 4),
                                    RapProgressBar(item: i),
                                  ],
                                ),
                          onTap: () => Navigator.pop(context, i.id),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel))],
    );
  }
}
