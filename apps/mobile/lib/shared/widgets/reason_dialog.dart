import 'package:flutter/material.dart';

import '../../l10n/gen/app_localizations.dart';
import 'action_feedback.dart';

/// The web `ReasonAction` dialog (Void, Tutup buku, Buka kembali): title, what happens, a reason (min. 3 characters,
/// or optional with [required] false — e.g. "Catatan (opsional)") and the confirm button. Pops the trimmed text, null
/// when cancelled. Keys: `<keyPrefix>-field`, `<keyPrefix>-ok`. D2410: this dialog IS the confirmation of its action
/// (title + summary in [description]); a destructive [confirm] (Void, Tolak, Batalkan…) gets the error colour.
Future<String?> showReasonDialog(
  BuildContext context, {
  required String title,
  required String description,
  required String confirm,
  String? fieldLabel,
  bool required = true,
  String keyPrefix = 'reason',
}) => showDialog<String>(
  context: context,
  builder: (_) => _ReasonDialog(
    title: title,
    description: description,
    confirm: confirm,
    fieldLabel: fieldLabel,
    required: required,
    keyPrefix: keyPrefix,
  ),
);

class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog({
    required this.title,
    required this.description,
    required this.confirm,
    required this.fieldLabel,
    required this.required,
    required this.keyPrefix,
  });
  final String title;
  final String description;
  final String confirm;
  final String? fieldLabel;
  final bool required;
  final String keyPrefix;

  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final _c = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final style = isDestructiveAction(widget.confirm)
        ? FilledButton.styleFrom(backgroundColor: scheme.error, foregroundColor: scheme.onError)
        : null;
    return AlertDialog(
      title: Text(widget.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.description),
            const SizedBox(height: 8),
            TextField(
              key: Key('${widget.keyPrefix}-field'),
              controller: _c,
              autofocus: true,
              minLines: 1,
              maxLines: 4,
              maxLength: widget.required ? 1000 : 500,
              decoration: InputDecoration(labelText: widget.fieldLabel ?? t.reasonLabel, errorText: _error),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
        FilledButton(
          key: Key('${widget.keyPrefix}-ok'),
          style: style,
          onPressed: () {
            final v = _c.text.trim();
            if (widget.required && v.length < 3) {
              setState(() => _error = t.reasonTooShort);
              return;
            }
            Navigator.pop(context, v);
          },
          child: Text(widget.confirm),
        ),
      ],
    );
  }
}
