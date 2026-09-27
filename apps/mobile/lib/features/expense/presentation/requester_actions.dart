import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../app/providers.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/online_only_button.dart';
import '../../auth/application/auth_controller.dart';
import '../application/expense_providers.dart';
import '../data/expense_api.dart';
import '../domain/expense_request.dart';
import '../domain/request_status.dart';
import 'receipt_capture.dart';

/// Online requester actions after approval (ADR 0010 decision 5: online-only): receipts on an Uang
/// Muka after the transfer / in LPJ revision and on a Reimburse in receipt revision (US-07, US-38, T4),
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
          onPressed: () => _submitLpj(context, ref),
        ),
      if (a.contains(RequesterAction.receiptsResubmit.code))
        OnlineOnlyButton(
          key: const Key('action-receipts-resubmit'),
          label: t.actionReceiptsResubmit,
          icon: Icons.replay,
          onPressed: () =>
              _confirmAndRun(context, ref, RequesterAction.receiptsResubmit, t.actionReceiptsResubmitConfirm),
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
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(question),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(t.cancel)),
          FilledButton(
            key: const Key('confirm-action'),
            onPressed: () => Navigator.pop(c, true),
            child: Text(t.confirm),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    await _run(context, ref, () {
      return ref.read(expenseApiProvider).requesterAction(detail.id, action, idempotencyKey: const Uuid().v7());
    });
  }

  Future<void> _submitLpj(BuildContext context, WidgetRef ref) async {
    final t = AppLocalizations.of(context);
    final first = (detail.settlement?.submitCount ?? 0) == 0;
    final notes = await showDialog<String>(
      context: context,
      builder: (_) => _TextPromptDialog(
        title: first ? t.actionLpjSubmit : t.actionLpjResubmit,
        label: t.lpjUsageNotes,
        hint: t.lpjUsageNotesHint,
        initial: detail.settlement?.usageNotes ?? '',
        required: first,
        fieldKey: const Key('lpj-usage-notes'),
      ),
    );
    if (notes == null || !context.mounted) return;
    await _run(context, ref, () {
      return ref
          .read(expenseApiProvider)
          .requesterAction(
            detail.id,
            RequesterAction.lpjSubmit,
            idempotencyKey: const Uuid().v7(),
            usageNotes: notes.trim().isEmpty ? null : notes.trim(),
          );
    });
  }

  Future<void> _run(BuildContext context, WidgetRef ref, Future<Object?> Function() call) async {
    final t = AppLocalizations.of(context);
    try {
      await call();
      if (!context.mounted) return;
      showSnack(context, t.actionSaved);
    } on Object catch (e) {
      if (context.mounted) showSnack(context, errorText(e));
    } finally {
      ref.invalidate(requestDetailProvider(detail.id));
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
    final canEditHere = ref.watch(currentProfileProvider)?.canCreateRequests ?? false;
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
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => _TextPromptDialog(
        title: withdraw ? t.actionWithdraw : t.actionCancelRequest,
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
      if (context.mounted) showSnack(context, withdraw ? t.withdrawDone : t.cancelDone);
    } on Object catch (e) {
      if (context.mounted) showSnack(context, errorText(e));
    } finally {
      _refreshLists(ref);
    }
  }

  Future<void> _resubmit(BuildContext context, WidgetRef ref) async {
    final t = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(t.resubmitConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(t.cancel)),
          FilledButton(
            key: const Key('confirm-action'),
            onPressed: () => Navigator.pop(c, true),
            child: Text(t.confirm),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      // One key per original request: a retry after a lost answer returns the same new draft.
      final created = await ref
          .read(expenseApiProvider)
          .resubmit(detail.id, idempotencyKey: const Uuid().v5(Namespace.url.value, 'pk-resubmit:${detail.id}'));
      _refreshLists(ref);
      if (!context.mounted) return;
      showSnack(context, t.resubmitDone);
      await _openInEditor(context, ref, created);
    } on Object catch (e) {
      if (context.mounted) showSnack(context, errorText(e));
    }
  }
}

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
    if (context.mounted) showSnack(context, t.receiptSaved);
  } on Object catch (e) {
    if (context.mounted) showSnack(context, errorText(e));
  } finally {
    ref.invalidate(requestDetailProvider(d.id));
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

/// Soft-removes a receipt (reason required, audited server-side).
Future<void> removeServerReceipt(BuildContext context, WidgetRef ref, ExpenseDetail d, ReceiptInfo r) async {
  final t = AppLocalizations.of(context);
  final reason = await showDialog<String>(
    context: context,
    builder: (_) => _TextPromptDialog(
      title: '${t.receiptRemove}: ${r.vendorName} · ${formatRupiah(r.amount)} · ${formatDateOnly(r.receiptDate)}',
      label: t.receiptRemoveReason,
      required: true,
      fieldKey: const Key('receipt-remove-reason'),
    ),
  );
  if (reason == null || !context.mounted) return;
  try {
    await ref.read(expenseApiProvider).removeReceipt(d.id, r.id, reason.trim(), idempotencyKey: const Uuid().v7());
    if (context.mounted) showSnack(context, t.receiptRemoved);
  } on Object catch (e) {
    if (context.mounted) showSnack(context, errorText(e));
  } finally {
    ref.invalidate(requestDetailProvider(d.id));
  }
}

class _TextPromptDialog extends StatefulWidget {
  const _TextPromptDialog({
    required this.title,
    required this.label,
    required this.required,
    required this.fieldKey,
    this.hint,
    this.initial = '',
  });
  final String title;
  final String label;
  final String? hint;
  final String initial;
  final bool required;
  final Key fieldKey;

  @override
  State<_TextPromptDialog> createState() => _TextPromptDialogState();
}

class _TextPromptDialogState extends State<_TextPromptDialog> {
  late final _c = TextEditingController(text: widget.initial);
  String? _error;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(widget.title),
      content: TextField(
        key: widget.fieldKey,
        controller: _c,
        minLines: 2,
        maxLines: 5,
        maxLength: 2000,
        decoration: InputDecoration(labelText: widget.label, helperText: widget.hint, errorText: _error),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(t.cancel)),
        FilledButton(
          key: const Key('prompt-ok'),
          onPressed: () {
            final v = _c.text.trim();
            if ((widget.required || v.isNotEmpty) && v.length < 3) {
              setState(() => _error = t.reasonTooShort);
              return;
            }
            Navigator.pop(context, v);
          },
          child: Text(t.confirm),
        ),
      ],
    );
  }
}
