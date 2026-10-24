import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../app/providers.dart';
import '../../../app/theme.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/online_only_button.dart';
import '../../auth/application/auth_controller.dart';
import '../application/expense_providers.dart';
import '../data/expense_api.dart';
import '../domain/expense_request.dart';
import '../domain/request_status.dart';
import 'lpj_submit_screen.dart';
import 'receipt_capture.dart';

/// Online requester actions after approval (ADR 0010 decision 5: online-only): receipts on a Pengajuan
/// Baru (`advance`) after the transfer / in LPJ revision and on a Reimburse in receipt revision (US-07, US-38, T4),
/// "Nota sudah lengkap" + "Kirim LPJ" (US-08, US-21, T5), "Kirim ulang nota" and "Tandai selesai".
/// Shown only for actions the server lists in `allowedActions`; the server re-checks every call.
class RequesterActionsSection extends ConsumerWidget {
  const RequesterActionsSection({super.key, required this.detail});
  final ExpenseDetail detail;

  /// Receipts are added here only on a SERVER request past draft (drafts use the offline editor).
  static bool canAddReceipts(ExpenseDetail d) =>
      d.allowedActions.contains('add_receipt') && d.status != RequestStatus.draft;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final a = detail.allowedActions;
    final canAdd = canAddReceipts(detail);
    final lpjAgain = detail.settlement != null && (detail.settlement!.submitCount > 0);
    // D3: a pre-D3 line needs Qty & Harga satuan before "Kirim ulang nota" (server rule; edited on the web)
    final incomplete = [
      for (final l in detail.lines)
        if (lineNeedsCompletion(detail, l)) l.no,
    ];
    final buttons = <Widget>[
      if (canAdd) ...[
        OnlineOnlyButton(
          key: const Key('receipt-add-camera'),
          label: t.addReceiptOnlineCamera,
          icon: Icons.photo_camera,
          onPressed: () => addServerReceipt(context, ref, detail, fromCamera: true),
        ),
        OnlineOnlyButton(
          key: const Key('receipt-add-gallery'),
          label: t.addReceiptOnlineGallery,
          icon: Icons.photo_library,
          outlined: true,
          onPressed: () => addServerReceipt(context, ref, detail, fromCamera: false),
        ),
      ],
      if (a.contains(RequesterAction.receiptsComplete.code))
        OnlineOnlyButton(
          key: const Key('action-receipts-complete'),
          label: t.actionReceiptsComplete,
          icon: Icons.fact_check,
          onPressed: () =>
              _confirmAndRun(context, ref, RequesterAction.receiptsComplete, t.actionReceiptsCompleteConfirm),
        ),
      if (a.contains(RequesterAction.lpjSubmit.code))
        OnlineOnlyButton(
          key: const Key('action-lpj-submit'),
          label: lpjAgain ? t.actionLpjResubmit : t.actionLpjSubmit,
          icon: Icons.send,
          onPressed: () => _submitLpj(context, ref, lpjAgain ? t.actionLpjResubmit : t.actionLpjSubmit),
        ),
      if (a.contains(RequesterAction.receiptsResubmit.code) && incomplete.isNotEmpty)
        Text(
          t.linesIncompleteResubmit(incomplete.join(', ')),
          key: const Key('lines-incomplete-note'),
          style: TextStyle(color: context.pk.warnText, fontWeight: FontWeight.w600),
        ),
      if (a.contains(RequesterAction.receiptsResubmit.code))
        OnlineOnlyButton(
          key: const Key('action-receipts-resubmit'),
          label: t.actionReceiptsResubmit,
          icon: Icons.replay,
          onPressed: incomplete.isNotEmpty
              ? null
              : () => _confirmAndRun(context, ref, RequesterAction.receiptsResubmit, t.actionReceiptsResubmitConfirm),
        ),
      // Finance also holds `complete`; on the phone it is the requester's "dana diterima".
      if (a.contains(RequesterAction.complete.code) && !a.contains('transfer_void'))
        OnlineOnlyButton(
          key: const Key('action-complete'),
          label: t.actionComplete,
          icon: Icons.task_alt,
          outlined: true,
          onPressed: () => _confirmAndRun(context, ref, RequesterAction.complete, t.actionCompleteConfirm),
        ),
    ];
    if (buttons.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Divider(height: 32),
        Text(t.requesterActionsTitle, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        for (final b in buttons) Padding(padding: const EdgeInsets.only(bottom: 8), child: b),
      ],
    );
  }

  Future<void> _confirmAndRun(BuildContext context, WidgetRef ref, RequesterAction action, String question) async {
    final t = AppLocalizations.of(context);
    final label = switch (action) {
      RequesterAction.receiptsComplete => t.actionReceiptsCompleteVerb,
      RequesterAction.receiptsResubmit => t.actionReceiptsResubmit,
      _ => t.actionComplete,
    };
    final ok = await confirmAction(context, action: label, summary: requestSummary(detail), note: question);
    if (!ok || !context.mounted) return;
    await _run(context, ref, label, () {
      return ref.read(expenseApiProvider).requesterAction(detail.id, action, idempotencyKey: const Uuid().v7());
    });
  }

  /// d1010 (13): usage notes + LPJ photos (camera or gallery, compressed on the phone, max 10). New photos
  /// are uploaded first (`POST /media/receipts`, like receipts), then `lpj/submit` carries every photo id.
  Future<void> _submitLpj(BuildContext context, WidgetRef ref, String label) async {
    final t = AppLocalizations.of(context);
    final first = (detail.settlement?.submitCount ?? 0) == 0;
    final sent = await Navigator.of(context).push<LpjSubmission>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => LpjSubmitScreen(settlement: detail.settlement, first: first),
      ),
    );
    if (sent == null || !context.mounted) return;
    final summary = [detail.settlement?.docNo, ...requestSummary(detail)];
    final ok = await confirmAction(context, action: label, summary: summary);
    if (!ok || !context.mounted) return;
    if (sent.newPhotos.isNotEmpty) showSnack(context, t.lpjUploadingPhotos);
    await _run(context, ref, label, () {
      return submitLpjWithPhotos(
        ref.read(expenseApiProvider),
        requestId: detail.id,
        submission: sent,
        idempotencyKey: const Uuid().v7(),
      );
    });
  }

  Future<void> _run(BuildContext context, WidgetRef ref, String label, Future<Object?> Function() call) async {
    final t = AppLocalizations.of(context);
    try {
      await call();
      ref.invalidate(requestDetailProvider(detail.id));
      if (context.mounted) await showActionResult(context, message: t.actionSaved, action: label);
    } on Object catch (e) {
      ref.invalidate(requestDetailProvider(detail.id));
      if (context.mounted) await showActionError(context, e, action: label);
    }
  }
}

/// Request lifecycle actions of the requester, same endpoints/status/audit as the web
/// (`apps/web/src/admin/components/RequesterActions.tsx`, US-04/US-06): "Tarik kembali ke Draft"
/// (reason), "Batalkan pengajuan" (reason), "Ajukan ulang" (rejected → new draft) and — for a server
/// Draft — "Ubah & ajukan di HP" (imports it into the offline editor). Online only; the buttons follow
/// the server's `allowedActions`, the server re-checks every call.
class RequestLifecycleActions extends ConsumerWidget {
  const RequestLifecycleActions({super.key, required this.detail});
  final ExpenseDetail detail;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final a = detail.allowedActions;
    final isDraft = detail.status == RequestStatus.draft;
    // MC3: the roles IN the request's PT (not the union of the selected PTs).
    final canEditHere = ref.watch(currentProfileProvider)?.forCompany(detail.companyId).canCreateRequests ?? false;
    final buttons = <Widget>[
      if (isDraft && canEditHere && (a.contains('edit') || a.contains('submit')))
        OnlineOnlyButton(
          key: const Key('action-edit-on-phone'),
          label: t.actionEditOnPhone,
          icon: Icons.edit_note,
          onPressed: () => _openInEditor(context, ref, detail),
        ),
      if (a.contains('resubmit') && canEditHere)
        OnlineOnlyButton(
          key: const Key('action-resubmit'),
          label: t.actionResubmit,
          icon: Icons.replay,
          onPressed: () => _resubmit(context, ref),
        ),
      if (a.contains('withdraw'))
        OnlineOnlyButton(
          key: const Key('action-withdraw'),
          label: t.actionWithdraw,
          icon: Icons.undo,
          outlined: true,
          onPressed: () => _withReason(context, ref, withdraw: true),
        ),
      if (a.contains('cancel'))
        OnlineOnlyButton(
          key: const Key('action-cancel'),
          label: t.actionCancelRequest,
          icon: Icons.block,
          outlined: true,
          onPressed: () => _withReason(context, ref, withdraw: false),
        ),
    ];
    if (buttons.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Divider(height: 32),
        Text(t.lifecycleActionsTitle, style: Theme.of(context).textTheme.titleMedium),
        if (isDraft && !canEditHere) Padding(padding: const EdgeInsets.only(top: 4), child: Text(t.editOnWebHint)),
        const SizedBox(height: 8),
        for (final b in buttons) Padding(padding: const EdgeInsets.only(bottom: 8), child: b),
      ],
    );
  }

  void _refreshLists(WidgetRef ref) {
    ref.invalidate(requestDetailProvider(detail.id));
    ref.invalidate(requestListProvider);
  }

  Future<void> _withReason(BuildContext context, WidgetRef ref, {required bool withdraw}) async {
    final t = AppLocalizations.of(context);
    final label = withdraw ? t.actionWithdraw : t.actionCancelRequest;
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => _TextPromptDialog(
        title: t.confirmActionTitle(actionPhrase(label)),
        summary: requestSummary(detail),
        confirm: label,
        label: withdraw ? t.withdrawReason : t.cancelReason,
        hint: withdraw ? t.withdrawHint : t.cancelHint,
        required: true,
        fieldKey: Key(withdraw ? 'withdraw-reason' : 'cancel-reason'),
      ),
    );
    if (reason == null || !context.mounted) return;
    final api = ref.read(expenseApiProvider);
    try {
      final key = const Uuid().v7();
      if (withdraw) {
        await api.withdraw(detail.id, reason.trim(), idempotencyKey: key);
      } else {
        await api.cancel(detail.id, reason.trim(), idempotencyKey: key);
      }
      _refreshLists(ref);
      final done = withdraw ? t.withdrawDone : t.cancelDone;
      if (context.mounted) await showActionResult(context, message: done, action: label);
    } on Object catch (e) {
      _refreshLists(ref);
      if (context.mounted) await showActionError(context, e, action: label);
    }
  }

  Future<void> _resubmit(BuildContext context, WidgetRef ref) async {
    final t = AppLocalizations.of(context);
    final label = t.actionResubmit;
    final ok = await confirmAction(context, action: label, summary: requestSummary(detail), note: t.resubmitConfirm);
    if (!ok || !context.mounted) return;
    try {
      // One key per original request: a retry after a lost answer returns the same new draft.
      final created = await ref
          .read(expenseApiProvider)
          .resubmit(detail.id, idempotencyKey: const Uuid().v5(Namespace.url.value, 'pk-resubmit:${detail.id}'));
      _refreshLists(ref);
      if (!context.mounted) return;
      await showActionResult(context, message: t.resubmitDone, action: label);
      if (context.mounted) await _openInEditor(context, ref, created);
    } on Object catch (e) {
      if (context.mounted) await showActionError(context, e, action: label);
    }
  }
}

/// Confirmation summary of a request (D2410): number, title, amount.
List<String?> requestSummary(ExpenseDetail d) => [d.docNo, d.title, formatRupiah(d.grandTotal)];

/// Server Draft → local editor (fresh server copy first, so the import carries the current `rev`).
Future<void> _openInEditor(BuildContext context, WidgetRef ref, ExpenseDetail d) async {
  final sub = ref.read(currentSubProvider);
  if (sub == null) return;
  try {
    final fresh = await ref.read(expenseApiProvider).detail(d.id);
    final draft = await ref.read(draftServiceProvider).importServerDraft(sub, fresh);
    if (context.mounted) await context.push('/drafts/${draft.clientUuid}');
  } on Object catch (e) {
    if (context.mounted) showSnack(context, errorText(e));
  }
}

/// Camera/gallery → device compression (≤ 1600 px, ≤ 400 KB, EXIF dropped) → `POST /media/receipts`
/// → `POST /expense-requests/{id}/receipts` (Idempotency-Key). Online only; nothing is queued.
Future<void> addServerReceipt(BuildContext context, WidgetRef ref, ExpenseDetail d, {required bool fromCamera}) async {
  final t = AppLocalizations.of(context);
  if (d.lines.isEmpty) return;
  final line = d.lines.length == 1
      ? d.lines.single
      : await showModalBottomSheet<ExpenseLine>(
          context: context,
          builder: (c) => SafeArea(
            child: ListView(
              shrinkWrap: true,
              children: [
                ListTile(title: Text(t.chooseLine, style: Theme.of(c).textTheme.titleMedium)),
                for (final l in d.lines)
                  ListTile(
                    key: Key('pick-line-${l.no}'),
                    title: Text('${l.no}. ${l.description ?? '-'}'),
                    trailing: Text(formatRupiah(l.total)),
                    onTap: () => Navigator.pop(c, l),
                  ),
              ],
            ),
          ),
        );
  if (line == null || !context.mounted) return;
  final raw = await pickReceiptImage(context, fromCamera: fromCamera);
  if (raw == null || !context.mounted) return;
  final CompressedPhoto photo;
  try {
    photo = await ref.read(photoCompressorProvider).compress(raw, receiptTargetFor(ref.read(currentProfileProvider)));
  } on PhotoTooLargeException catch (e) {
    if (context.mounted) showSnack(context, e.message);
    return;
  } on Object {
    if (context.mounted) showSnack(context, t.cameraUnavailable);
    return;
  }
  if (!context.mounted) return;
  final fields = await showDialog<ReceiptFields>(
    context: context,
    barrierDismissible: false,
    builder: (_) => ReceiptDetailsDialog(photo: photo.bytes),
  );
  if (fields == null || !context.mounted) return;
  final label = t.receiptSaveAction;
  final summary = [d.docNo, '${line.no}. ${line.description ?? '-'}', fields.vendorName, formatRupiah(fields.amount)];
  if (!await confirmAction(context, action: label, summary: summary) || !context.mounted) return;
  showSnack(context, t.uploadingReceipt);
  try {
    await uploadServerReceipt(
      ref.read(expenseApiProvider),
      requestId: d.id,
      lineId: line.id,
      jpeg: photo.bytes,
      fields: fields,
      idempotencyKey: const Uuid().v7(),
    );
    ref.invalidate(requestDetailProvider(d.id));
    if (context.mounted) await showActionResult(context, message: t.receiptSaved, action: label);
  } on Object catch (e) {
    ref.invalidate(requestDetailProvider(d.id));
    if (context.mounted) await showActionError(context, e, action: label);
  }
}

/// Media first (server resize, ADR 0004), then the receipt row referencing it.
Future<ExpenseDetail> uploadServerReceipt(
  ExpenseApi api, {
  required int requestId,
  required String lineId,
  required Uint8List jpeg,
  required ReceiptFields fields,
  required String idempotencyKey,
}) async {
  final imageId = await api.uploadMedia('receipts', jpeg, filename: 'nota-${const Uuid().v4()}.jpg');
  return api.addReceipt(requestId, {
    'lineId': lineId,
    'vendorName': fields.vendorName,
    'receiptNo': fields.receiptNo,
    'receiptDate': fields.receiptDate,
    'receiptTime': fields.receiptTime,
    'amount': fields.amount,
    'imageId': imageId,
  }, idempotencyKey: idempotencyKey);
}

/// d1010 (13): uploads the new LPJ photos (`POST /media/receipts`, same path as receipt photos), then
/// `lpj/submit` with the usage notes and every photo id (kept + new; the server caps the LPJ at 10). The photo
/// list is sent only when the LPJ has photos, so an LPJ without photos keeps the pre-d1010 body.
Future<ExpenseDetail> submitLpjWithPhotos(
  ExpenseApi api, {
  required int requestId,
  required LpjSubmission submission,
  required String idempotencyKey,
}) async {
  final ids = [...submission.keptPhotoIds];
  for (final jpeg in submission.newPhotos.take(lpjPhotoSlots(ids.length))) {
    ids.add(await api.uploadMedia('receipts', jpeg, filename: 'lpj-${const Uuid().v4()}.jpg'));
  }
  final notes = submission.usageNotes.trim();
  return api.requesterAction(
    requestId,
    RequesterAction.lpjSubmit,
    idempotencyKey: idempotencyKey,
    usageNotes: notes.isEmpty ? null : notes,
    photos: ids.isEmpty && !submission.hadPhotos ? null : ids,
  );
}

/// Soft-removes a receipt (reason required, audited server-side).
Future<void> removeServerReceipt(BuildContext context, WidgetRef ref, ExpenseDetail d, ReceiptInfo r) async {
  final t = AppLocalizations.of(context);
  final reason = await showDialog<String>(
    context: context,
    builder: (_) => _TextPromptDialog(
      title: t.confirmActionTitle(actionPhrase(t.receiptRemove)),
      summary: [d.docNo, r.vendorName, formatRupiah(r.amount), formatDateOnly(r.receiptDate)],
      confirm: t.receiptRemove,
      label: t.receiptRemoveReason,
      required: true,
      fieldKey: const Key('receipt-remove-reason'),
    ),
  );
  if (reason == null || !context.mounted) return;
  try {
    await ref.read(expenseApiProvider).removeReceipt(d.id, r.id, reason.trim(), idempotencyKey: const Uuid().v7());
    ref.invalidate(requestDetailProvider(d.id));
    if (context.mounted) await showActionResult(context, message: t.receiptRemoved, action: t.receiptRemove);
  } on Object catch (e) {
    ref.invalidate(requestDetailProvider(d.id));
    if (context.mounted) await showActionError(context, e, action: t.receiptRemove);
  }
}

class _TextPromptDialog extends StatefulWidget {
  const _TextPromptDialog({
    required this.title,
    required this.label,
    required this.required,
    required this.fieldKey,
    required this.confirm,
    this.summary = const [],
    this.hint,
  });
  final String title;
  final List<String?> summary;
  final String confirm;
  final String label;
  final String? hint;
  final bool required;
  final Key fieldKey;

  @override
  State<_TextPromptDialog> createState() => _TextPromptDialogState();
}

class _TextPromptDialogState extends State<_TextPromptDialog> {
  late final _c = TextEditingController();
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
    final lines = [
      for (final s in widget.summary)
        if (s != null && s.trim().isNotEmpty) s.trim(),
    ];
    return AlertDialog(
      title: Text(widget.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final l in lines) Text(l, style: const TextStyle(fontWeight: FontWeight.w600)),
            if (lines.isNotEmpty) const SizedBox(height: 8),
            TextField(
              key: widget.fieldKey,
              controller: _c,
              minLines: 2,
              maxLines: 5,
              maxLength: 2000,
              decoration: InputDecoration(labelText: widget.label, helperText: widget.hint, errorText: _error),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
        FilledButton(
          key: const Key('prompt-ok'),
          style: style,
          onPressed: () {
            final v = _c.text.trim();
            if ((widget.required || v.isNotEmpty) && v.length < 3) {
              setState(() => _error = t.reasonTooShort);
              return;
            }
            Navigator.pop(context, v);
          },
          child: Text(t.confirmActionYes(actionPhrase(widget.confirm))),
        ),
      ],
    );
  }
}
