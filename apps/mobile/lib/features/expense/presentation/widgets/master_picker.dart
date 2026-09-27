import 'package:flutter/material.dart';

import '../../../../l10n/gen/app_localizations.dart';
import '../../../masters/domain/master_item.dart';

/// Tap-to-open searchable picker for master data (works offline from the cached masters).
class MasterPickerField extends StatelessWidget {
  const MasterPickerField({
    super.key,
    required this.label,
    required this.items,
    required this.value,
    required this.onChanged,
    this.allowNone = true,
    this.errorText,
  });

  final String label;
  final List<MasterItem> items;
  final int? value;
  final ValueChanged<int?> onChanged;
  final bool allowNone;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final selected = items.where((i) => i.id == value).firstOrNull;
    return InkWell(
      onTap: () async {
        final picked = await showDialog<({int? id})>(
          context: context,
          builder: (_) => _PickerDialog(title: label, items: items, allowNone: allowNone),
        );
        if (picked != null) onChanged(picked.id);
      },
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          errorText: errorText,
          suffixIcon: const Icon(Icons.arrow_drop_down),
        ),
        child: Text(selected?.label ?? (value == null ? t.choose : '#$value')),
      ),
    );
  }
}

class _PickerDialog extends StatefulWidget {
  const _PickerDialog({required this.title, required this.items, required this.allowNone});
  final String title;
  final List<MasterItem> items;
  final bool allowNone;

  @override
  State<_PickerDialog> createState() => _PickerDialogState();
}

class _PickerDialogState extends State<_PickerDialog> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final q = _q.toLowerCase();
    final filtered = widget.items.where((i) => q.isEmpty || i.label.toLowerCase().contains(q)).toList();
    return AlertDialog(
      title: Text(widget.title),
      contentPadding: const EdgeInsets.fromLTRB(8, 12, 8, 0),
      content: SizedBox(
        width: double.maxFinite,
        height: 420,
        child: Column(
          children: [
            TextField(
              autofocus: false,
              decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: t.searchHint),
              onChanged: (v) => setState(() => _q = v),
            ),
            Expanded(
              child: ListView(
                children: [
                  if (widget.allowNone) ListTile(title: Text(t.none), onTap: () => Navigator.pop(context, (id: null))),
                  for (final i in filtered)
                    ListTile(title: Text(i.label), onTap: () => Navigator.pop(context, (id: i.id))),
                ],
              ),
            ),
          ],
        ),
      ),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel))],
    );
  }
}
