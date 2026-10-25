import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../app/theme.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../approvals/application/inbox_providers.dart';
import '../application/expense_providers.dart';
import '../data/expense_api.dart';
import '../domain/expense_request.dart';
import 'requester_actions.dart';

// D2510 (user 2026-10-25): Finance reviews the LPJ of a Pengajuan Baru on the APK too — the web "Verifikasi LPJ"
// actions (apps/web/src/admin/views/LpjVerification.tsx): per receipt Valid / Tolak, "Tandai flag diperiksa", then
// "Minta revisi" or "Verifikasi LPJ". Shown only for the actions the server lists in `allowedActions` (Finance of the
// PT, status `lpj_submitted`); "settle" (penyelesaian selisih) stays on the web. Every action asks first and reports
// after (D2410); a reason / note dialog IS the confirmation.

/// The LPJ decision bar (bottom of the request detail).
bool showsFinanceLpjBar(ExpenseDetail d) =>
    d.allowedActions.contains('lpj_verify') || d.allowedActions.contains('lpj_request_revision');

/// Valid / Tolak on a receipt (web: `receipt_verify` allowed; a removed receipt has no actions).
bool canReviewReceipt(ExpenseDetail d, ReceiptInfo r) =>
    d.allowedActions.contains('receipt_verify') && r.status != 'removed';

/// "Tandai flag diperiksa" on an open flag.
bool canReviewFlag(ExpenseDetail d, FlagInfo f) => d.allowedActions.contains('review_flag') && f.status == 'open';

/// Popup label of [action] ("Yakin ingin <label>?", "Berhasil: <label>").
String financeLpjActionLabel(AppLocalizations t, FinanceLpjAction action) => switch (action) {
  FinanceLpjAction.verify => t.lpjVerifyTitle,
  FinanceLpjAction.requestRevision => t.lpjActionRevision,
  FinanceLpjAction.receiptVerify => t.receiptActionVerify,
  FinanceLpjAction.receiptReject => t.receiptActionReject,
  FinanceLpjAction.flagReview => t.flagReviewAction,
};

/// Confirm (or the note / reason dialog) → POST → refresh the detail and the LPJ queue → result popup (the server's
/// message on a refusal, e.g. 409 "Masih ada 1 nota yang belum diputuskan").
Future<void> runFinanceLpjAction(
  BuildContext context,
  WidgetRef ref,
  ExpenseDetail d,
  FinanceLpjAction action, {
  ReceiptInfo? receipt,
  FlagInfo? flag,
}) async {
  final t = AppLocalizations.of(context);
  final label = financeLpjActionLabel(t, action);
  final summary = switch (action) {
    FinanceLpjAction.receiptVerify || FinanceLpjAction.receiptReject => [
      d.docNo,
      receipt?.vendorName,
      if (receipt?.receiptNo != null) 'No. ${receipt!.receiptNo}',
      if (receipt != null) formatRupiah(receipt.amount),
    ],
    FinanceLpjAction.flagReview => [d.docNo, flag?.kindLabel, flag?.message],
    _ => [d.docNo, d.settlement?.docNo, d.title],
  };
  String? text;
  switch (action) {
    case FinanceLpjAction.verify || FinanceLpjAction.receiptVerify:
      final yes = await confirmAction(
        context,
        action: label,
        summary: summary,
        note: action == FinanceLpjAction.verify ? t.lpjVerifyNote : null,
      );
      if (!yes) return;
    case FinanceLpjAction.requestRevision:
      text = await showTextPrompt(
        context,
        action: label,
        label: t.lpjRevisionNoteLabel,
        hint: t.lpjRevisionNoteHint,
        summary: summary,
        fieldKey: const Key('lpj-revision-note'),
      );
      if (text == null) return;
    case FinanceLpjAction.receiptReject:
      text = await showTextPrompt(
        context,
        action: label,
        label: t.receiptRejectReasonLabel,
        summary: summary,
        fieldKey: const Key('receipt-reject-reason'),
      );
      if (text == null) return;
    case FinanceLpjAction.flagReview:
      text = await showTextPrompt(
        context,
        action: label,
        label: t.flagReviewNoteLabel,
        summary: summary,
        required: false,
        fieldKey: const Key('flag-review-note'),
      );
      if (text == null) return;
  }
  if (!context.mounted) return;
  void refresh() {
    ref.invalidate(requestDetailProvider(d.id));
    ref.invalidate(lpjQueueProvider);
  }

  try {
    await ref
        .read(expenseApiProvider)
        .financeLpjAction(
          d.id,
          action,
          idempotencyKey: const Uuid().v7(),
          targetId: receipt?.id ?? flag?.id,
          text: text,
        );
    refresh();
    final done = switch (action) {
      FinanceLpjAction.verify => t.lpjVerifiedDone,
      FinanceLpjAction.requestRevision => t.lpjRevisionDone,
      FinanceLpjAction.receiptVerify => t.receiptVerifiedDone,
      FinanceLpjAction.receiptReject => t.receiptRejectedDone,
      FinanceLpjAction.flagReview => t.flagReviewedDone,
    };
    if (context.mounted) await showActionResult(context, message: done, action: label);
  } on Object catch (e) {
    // Also after a refusal (403/409): the buttons must reflect the server's current allowedActions.
    refresh();
    if (context.mounted) await showActionError(context, e, action: label);
  }
}

/// Bottom bar of a submitted LPJ for Finance: "Minta revisi" (outlined) + "Verifikasi LPJ" (filled); the number of
/// receipts still undecided above (the server refuses the verification while one is pending).
class FinanceLpjBar extends ConsumerWidget {
  const FinanceLpjBar({super.key, required this.detail});
  final ExpenseDetail detail;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final a = detail.allowedActions;
    final pending = detail.receipts.where((r) => r.status == 'pending').length;
    return Column(
      key: const Key('lpj-finance-bar'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (pending > 0 && a.contains('lpj_verify'))
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(
              t.lpjPendingReceipts(pending),
              key: const Key('lpj-pending-receipts'),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: context.pk.warnText),
            ),
          ),
        Row(
          children: [
            if (a.contains('lpj_request_revision'))
              Expanded(
                child: OutlinedButton.icon(
                  key: const Key('action-lpj-revision'),
                  onPressed: () => runFinanceLpjAction(context, ref, detail, FinanceLpjAction.requestRevision),
                  icon: const Icon(Icons.undo),
                  label: Text(t.lpjActionRevision),
                ),
              ),
            if (a.contains('lpj_request_revision') && a.contains('lpj_verify')) const SizedBox(width: 12),
            if (a.contains('lpj_verify'))
              Expanded(
                child: FilledButton.icon(
                  key: const Key('action-lpj-verify'),
                  onPressed: () => runFinanceLpjAction(context, ref, detail, FinanceLpjAction.verify),
                  icon: const Icon(Icons.verified_outlined),
                  label: Text(t.lpjVerifyTitle),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

/// "Tolak" / "Valid" under a receipt (Valid hidden when already valid, Tolak when already rejected).
class ReceiptReviewButtons extends ConsumerWidget {
  const ReceiptReviewButtons({super.key, required this.detail, required this.receipt});
  final ExpenseDetail detail;
  final ReceiptInfo receipt;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final r = receipt;
    final scheme = Theme.of(context).colorScheme;
    const dense = VisualDensity.compact;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Wrap(
        alignment: WrapAlignment.end,
        spacing: 8,
        runSpacing: 6,
        children: [
          if (r.status != 'rejected')
            OutlinedButton.icon(
              key: Key('receipt-reject-${r.id}'),
              style: OutlinedButton.styleFrom(
                visualDensity: dense,
                foregroundColor: scheme.error,
                side: BorderSide(color: scheme.error.withValues(alpha: 0.5)),
              ),
              onPressed: () =>
                  runFinanceLpjAction(context, ref, detail, FinanceLpjAction.receiptReject, receipt: receipt),
              icon: const Icon(Icons.close, size: 18),
              label: Text(t.actionReject),
            ),
          if (r.status != 'valid')
            FilledButton.tonalIcon(
              key: Key('receipt-verify-${r.id}'),
              style: FilledButton.styleFrom(visualDensity: dense),
              onPressed: () =>
                  runFinanceLpjAction(context, ref, detail, FinanceLpjAction.receiptVerify, receipt: receipt),
              icon: const Icon(Icons.check, size: 18),
              label: Text(t.receiptValidButton),
            ),
        ],
      ),
    );
  }
}

/// "Tandai flag diperiksa" (open flag, `review_flag` allowed).
class FlagReviewButton extends ConsumerWidget {
  const FlagReviewButton({super.key, required this.detail, required this.flag});
  final ExpenseDetail detail;
  final FlagInfo flag;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    return Align(
      alignment: Alignment.centerLeft,
      child: TextButton.icon(
        key: Key('flag-review-${flag.id}'),
        style: TextButton.styleFrom(visualDensity: VisualDensity.compact, padding: EdgeInsets.zero),
        onPressed: () => runFinanceLpjAction(context, ref, detail, FinanceLpjAction.flagReview, flag: flag),
        icon: const Icon(Icons.task_alt, size: 18),
        label: Text(t.flagReviewAction),
      ),
    );
  }
}
