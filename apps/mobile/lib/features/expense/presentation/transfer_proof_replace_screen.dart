import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../app/providers.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/action_feedback.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/online_only_button.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_keuangan.dart';
import '../../auth/application/auth_controller.dart';
import '../../finance/application/finance_providers.dart';
import '../../finance/presentation/transfer_form_screen.dart';
import '../application/expense_providers.dart';
import '../domain/expense_request.dart';
import 'receipt_capture.dart';

/// D0311 (user 2026-11-03) "Ganti bukti transfer" — the web dialog on the phone: Finance / Admin of the PT replace the
/// bank proof of a posted transfer once the request is "Selesai" (offered when `allowedActions` has
/// `transfer_proof_replace`). New photo (camera / gallery, compressed like "Catat transfer") + required reason; the
/// photo is uploaded first (`POST /media/transfer-proofs`), then `POST …/transfers/{id}/proof`. Nothing else of the
/// transfer changes; the old file stays in the Riwayat. Online only. Pops `true` after the replacement.
class TransferProofReplaceScreen extends ConsumerStatefulWidget {
  const TransferProofReplaceScreen({super.key, required this.detail, required this.transfer});
  final ExpenseDetail detail;
  final TransferInfo transfer;

  @override
  ConsumerState<TransferProofReplaceScreen> createState() => _TransferProofReplaceScreenState();
}

class _TransferProofReplaceScreenState extends ConsumerState<TransferProofReplaceScreen> {
  final _reason = TextEditingController();
  Uint8List? _proof;
  int? _proofMediaId;
  bool _busy = false;
  bool _tried = false;
  String? _error;

  /// One idempotency key per distinct body (a retry of the same body replays).
  final _keys = <String, String>{};

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Map<String, String> _issues(AppLocalizations t) => {
    if (_proof == null) 'proof': t.transferProofNewLabel,
    if (_reason.text.trim().length < 3) 'reason': t.reasonTooShort,
  };

  Future<void> _addProof({required bool fromCamera}) async {
    final t = AppLocalizations.of(context);
    final raw = await ref.read(proofPickerProvider)(context, fromCamera: fromCamera);
    if (raw == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final photo = await ref
          .read(photoCompressorProvider)
          .compress(raw, receiptTargetFor(ref.read(currentProfileProvider)));
      setState(() {
        _proof = photo.bytes;
        _proofMediaId = null; // a new photo is uploaded again
      });
    } on PhotoTooLargeException catch (e) {
      if (mounted) showSnack(context, e.message);
    } on Object {
      if (mounted) showSnack(context, t.cameraUnavailable);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit() async {
    final t = AppLocalizations.of(context);
    setState(() {
      _tried = true;
      _error = null;
    });
    if (_issues(t).isNotEmpty) return;
    final tr = widget.transfer;
    final label = t.transferProofReplace;
    final summary = [tr.docNo, widget.detail.docNo, formatRupiah(tr.amount)];
    if (!await confirmAction(context, action: label, summary: summary, note: t.transferProofReplaceNote) || !mounted) {
      return;
    }
    setState(() => _busy = true);
    try {
      _proofMediaId ??= await ref
          .read(financeApiProvider)
          .uploadProof(_proof!, filename: 'bukti-transfer-${tr.docNo ?? tr.id}.jpg');
      final reason = _reason.text.trim();
      final key = _keys.putIfAbsent('$_proofMediaId|$reason', () => const Uuid().v4());
      await ref
          .read(expenseApiProvider)
          .replaceTransferProof(
            widget.detail.id,
            tr.id,
            proofMediaId: _proofMediaId!,
            reason: reason,
            idempotencyKey: key,
          );
      ref.invalidate(requestDetailProvider(widget.detail.id));
      if (!mounted) return;
      await showActionResult(context, message: t.transferProofReplaceDone(tr.docNo ?? '#${tr.id}'), action: label);
      if (mounted) Navigator.of(context).pop(true);
    } on Object catch (e) {
      if (!mounted) return;
      setState(() => _error = errorText(e));
      await showActionError(context, e, action: label);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final tr = widget.transfer;
    final issues = _tried ? _issues(t) : const <String, String>{};
    return Scaffold(
      appBar: AppBar(title: Text(t.transferProofReplace)),
      body: AbsorbPointer(
        absorbing: _busy,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            PkCard(
              key: const Key('replace-proof-summary'),
              margin: const EdgeInsets.only(bottom: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${tr.docNo ?? '#${tr.id}'} · ${formatRupiah(tr.amount)}',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  if (widget.detail.docNo != null) Text(widget.detail.docNo!, style: theme.textTheme.bodySmall),
                  const SizedBox(height: 8),
                  Text(
                    t.transferProofReplaceNote,
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            PkCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(t.transferProofNewLabel, style: theme.textTheme.labelLarge),
                  const SizedBox(height: 8),
                  TransferProofPicker(
                    proof: _proof,
                    error: issues['proof'] == null ? null : t.transferProofNewLabel,
                    onAdd: (fromCamera) => _addProof(fromCamera: fromCamera),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    key: const Key('replace-proof-reason'),
                    controller: _reason,
                    minLines: 2,
                    maxLines: 5,
                    maxLength: 1000,
                    decoration: InputDecoration(
                      labelText: t.transferProofReplaceReason,
                      helperText: t.transferProofReplaceReasonHint,
                      errorText: issues['reason'],
                    ),
                    onChanged: (_) => _tried ? setState(() {}) : null,
                  ),
                ],
              ),
            ),
            if (_error != null)
              PkNoticeCard(
                key: const Key('replace-proof-error'),
                tone: PkTone.bad,
                margin: const EdgeInsets.only(top: 16),
                icon: Icons.error_outline,
                title: Text(_error!),
              ),
            const SizedBox(height: 20),
            OnlineOnlyButton(
              key: const Key('replace-proof-submit'),
              label: _busy ? t.processing : t.transferProofReplace,
              icon: Icons.published_with_changes,
              onPressed: _busy ? null : _submit,
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}
