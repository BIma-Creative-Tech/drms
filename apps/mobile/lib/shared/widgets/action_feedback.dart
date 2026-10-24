import 'package:flutter/material.dart';

import '../../l10n/gen/app_localizations.dart';
import 'async_body.dart';

/// D2410 (user decision 2026-10-24): every data-changing action asks first and reports after — the APK side of the
/// web ConfirmDialog / ResultDialog. BEFORE: [confirmAction] "Yakin ingin <aksi>?" with a short summary (document
/// number, amount, person/unit/date) and [Ya, <aksi>] / [Batal]; destructive actions (Tolak, Batalkan, Hapus,
/// Nonaktifkan, Void) get the error-coloured button. AFTER: [showActionResult] "Berhasil: <aksi>" with the result
/// text, "Gagal: <aksi>" with the server's message, or "Tersimpan di antrian" when the outbox keeps it until online.
/// A reason dialog (reason_dialog.dart) already IS the confirmation — never stacked with [confirmAction].
/// Keys: confirm `confirm-action` (or `confirmKey`), cancel `confirm-cancel`, result OK `result-ok`.
final _destructive = RegExp(r'tolak|batal|hapus|nonaktif|void|cabut|reset', caseSensitive: false);

/// "Kirim LPJ" → "kirim LPJ" (mid-sentence); a leading acronym ("LPJ", "KM") stays.
String actionPhrase(String label) {
  if (label.length < 2) return label.toLowerCase();
  final second = label[1];
  if (second.toUpperCase() == second && second.toLowerCase() != second) return label;
  return label[0].toLowerCase() + label.substring(1);
}

/// True for Tolak / Batalkan / Hapus / Nonaktifkan / Void / Cabut / Reset labels.
bool isDestructiveAction(String action) => _destructive.hasMatch(action);

/// Asks "Yakin ingin <action>?" — true only when the user taps "Ya, <action>".
Future<bool> confirmAction(
  BuildContext context, {
  required String action,
  List<String?> summary = const [],
  String? note,
  bool? danger,
  Key? confirmKey,
}) async {
  final dialog = ConfirmActionDialog(
    action: action,
    summary: summary,
    note: note,
    danger: danger ?? isDestructiveAction(action),
    confirmKey: confirmKey,
  );
  final ok = await showDialog<bool>(context: context, builder: (_) => dialog);
  return ok == true;
}

/// The dialog of [confirmAction] (exposed for widget tests).
class ConfirmActionDialog extends StatelessWidget {
  const ConfirmActionDialog({
    super.key,
    required this.action,
    this.summary = const [],
    this.note,
    this.danger = false,
    this.confirmKey,
  });
  final String action;
  final List<String?> summary;
  final String? note;
  final bool danger;
  final Key? confirmKey;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final phrase = actionPhrase(action);
    final lines = [
      for (final s in summary)
        if (s != null && s.trim().isNotEmpty) s.trim(),
    ];
    final extra = note?.trim() ?? '';
    const bold = TextStyle(fontWeight: FontWeight.w600);
    final style = danger
        ? FilledButton.styleFrom(backgroundColor: scheme.error, foregroundColor: scheme.onError)
        : null;
    return AlertDialog(
      key: const Key('confirm-dialog'),
      title: Text(t.confirmActionTitle(phrase)),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final l in lines) Text(l, style: bold),
            if (lines.isNotEmpty && extra.isNotEmpty) const SizedBox(height: 8),
            if (extra.isNotEmpty) Text(extra),
          ],
        ),
      ),
      actions: [
        TextButton(
          key: const Key('confirm-cancel'),
          onPressed: () => Navigator.pop(context, false),
          child: Text(t.cancel),
        ),
        FilledButton(
          key: confirmKey ?? const Key('confirm-action'),
          style: style,
          onPressed: () => Navigator.pop(context, true),
          child: Text(t.confirmActionYes(phrase)),
        ),
      ],
    );
  }
}

/// How an action ended.
enum ActionOutcome { success, failed, queued }

/// The result popup: "Berhasil: <action>" + [message] / "Gagal: <action>" + the server's message / "Tersimpan di
/// antrian" (sent automatically once online). Completes when the user taps OK; navigation can follow.
Future<void> showActionResult(
  BuildContext context, {
  required String message,
  String? action,
  ActionOutcome outcome = ActionOutcome.success,
}) async {
  if (!context.mounted) return;
  final dialog = ActionResultDialog(message: message, action: action, outcome: outcome);
  await showDialog<void>(context: context, builder: (_) => dialog);
}

/// [showActionResult] for a failure: the server's problem text (errorText), never a raw exception.
Future<void> showActionError(BuildContext context, Object error, {String? action}) {
  return showActionResult(context, message: errorText(error), action: action, outcome: ActionOutcome.failed);
}

/// [showActionResult] for a failure whose text the screen already built (e.g. a domain-specific 409 message).
Future<void> showActionFailure(BuildContext context, String message, {String? action}) {
  return showActionResult(context, message: message, action: action, outcome: ActionOutcome.failed);
}

/// [showActionResult] for an outbox write: "Tersimpan di antrian, akan dikirim saat online."
Future<void> showActionQueued(BuildContext context, {String? action, String? message}) {
  final text = message ?? AppLocalizations.of(context).resultQueuedBody;
  return showActionResult(context, message: text, action: action, outcome: ActionOutcome.queued);
}

/// The dialog of [showActionResult] (exposed for widget tests).
class ActionResultDialog extends StatelessWidget {
  const ActionResultDialog({super.key, required this.message, this.action, this.outcome = ActionOutcome.success});
  final String message;
  final String? action;
  final ActionOutcome outcome;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final phrase = action == null ? null : actionPhrase(action!);
    final String title;
    final IconData icon;
    final Color color;
    switch (outcome) {
      case ActionOutcome.success:
        title = phrase == null ? t.resultSuccessTitle : t.resultSuccessAction(phrase);
        icon = Icons.check_circle;
        color = scheme.primary;
      case ActionOutcome.failed:
        title = phrase == null ? t.resultFailedTitle : t.resultFailedAction(phrase);
        icon = Icons.error;
        color = scheme.error;
      case ActionOutcome.queued:
        title = t.resultQueuedTitle;
        icon = Icons.schedule_send;
        color = scheme.tertiary;
    }
    return AlertDialog(
      key: Key('result-${outcome.name}'),
      icon: Icon(icon, color: color, size: 40),
      title: Text(title, textAlign: TextAlign.center),
      content: SingleChildScrollView(child: Text(message)),
      actions: [
        FilledButton(key: const Key('result-ok'), onPressed: () => Navigator.pop(context), child: Text(t.resultOk)),
      ],
    );
  }
}

/// Confirm → run → result in one call (the common shape of an online action). Returns the call's value, or null when
/// cancelled or failed (the failure popup was shown). [success] builds the result text from the value.
Future<T?> runConfirmedAction<T>(
  BuildContext context, {
  required String action,
  required Future<T> Function() run,
  required String Function(T value) success,
  List<String?> summary = const [],
  String? note,
  bool? danger,
  bool confirm = true,
}) async {
  if (confirm) {
    final yes = await confirmAction(context, action: action, summary: summary, note: note, danger: danger);
    if (!yes || !context.mounted) return null;
  }
  try {
    final v = await run();
    if (context.mounted) await showActionResult(context, message: success(v), action: action);
    return v;
  } on Object catch (e) {
    if (context.mounted) await showActionError(context, e, action: action);
    return null;
  }
}
