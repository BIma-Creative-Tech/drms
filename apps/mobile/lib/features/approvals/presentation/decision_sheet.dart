import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:signature/signature.dart';
import 'package:uuid/uuid.dart';

import '../../../app/providers.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/format/rupiah.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/online_only_button.dart';
import '../../expense/domain/expense_request.dart';
import '../data/approvals_api.dart';

/// Signature PNG limit (requirements §9: ≤ 800×300 px, ≤ 50 KB).
const maxSignatureBytes = 50 * 1024;

Future<bool?> showDecisionSheet(BuildContext context, {required ExpenseDetail detail, required Decision decision}) =>
    showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => DecisionSheet(detail: detail, decision: decision),
    );

enum SignatureMode { profile, draw }

/// Diketahui / Setujui / Tolak with signature (profile or drawn on screen, US-43). Online-only.
class DecisionSheet extends ConsumerStatefulWidget {
  const DecisionSheet({super.key, required this.detail, required this.decision});
  final ExpenseDetail detail;
  final Decision decision;

  @override
  ConsumerState<DecisionSheet> createState() => _DecisionSheetState();
}

class _DecisionSheetState extends ConsumerState<DecisionSheet> {
  final _reason = TextEditingController();
  final _pad = SignatureController(penStrokeWidth: 2.5, exportBackgroundColor: Colors.transparent);
  SignatureMode _mode = SignatureMode.profile;
  bool _busy = false;
  String? _error;
  // One idempotency key per opened sheet: a retry after a network drop is not applied twice.
  final _idempotencyKey = const Uuid().v7();

  @override
  void dispose() {
    _reason.dispose();
    _pad.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    final t = AppLocalizations.of(context);
    final isReject = widget.decision == Decision.reject;
    if (isReject && _reason.text.trim().length < 3) {
      setState(() => _error = t.rejectReasonTooShort);
      return;
    }
    Uint8List? png;
    if (_mode == SignatureMode.draw) {
      if (_pad.isEmpty) {
        setState(() => _error = t.signatureEmpty);
        return;
      }
      png = await _pad.toPngBytes(width: 800, height: 300);
      if (png == null || png.length > maxSignatureBytes) {
        setState(() => _error = t.signatureTooLarge);
        return;
      }
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final api = ref.read(approvalsApiProvider);
      final sigId = png == null ? null : await api.uploadSignature(png);
      await api.decide(
        widget.detail.id,
        widget.decision,
        idempotencyKey: _idempotencyKey,
        signatureMediaId: sigId,
        reason: isReject ? _reason.text.trim() : null,
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ProblemException catch (e) {
      // 403: the server refused the decision (ADR 0013: only Direktur/Finance decide; also a request
      // that moved on meanwhile). Show a clear reason; the caller reloads the detail and the inbox.
      if (mounted) setState(() => _error = e.status == 403 ? t.decisionForbidden : errorText(e));
    } on Object catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final d = widget.detail;
    final direktur = d.approvalRule?.decisionFlow ?? false;
    final title = switch (widget.decision) {
      Decision.acknowledge => direktur ? t.decisionTitleAcknowledgeDirektur : t.decisionTitleAcknowledge,
      Decision.approve => t.decisionTitleApprove,
      Decision.reject => t.decisionTitleReject,
    };
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleLarge),
            Text('${d.docNo ?? ''} ${d.title}\n${formatRupiah(d.grandTotal)}'),
            if (widget.decision == Decision.acknowledge && direktur)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(t.decisionHintDirektur, key: const Key('decision-hint-direktur')),
              ),
            const SizedBox(height: 12),
            if (widget.decision == Decision.reject)
              TextField(
                key: const Key('reject-reason'),
                controller: _reason,
                maxLength: 1000,
                minLines: 2,
                maxLines: 4,
                decoration: InputDecoration(labelText: t.rejectReason),
              ),
            Text(t.signatureMode, style: Theme.of(context).textTheme.titleSmall),
            SegmentedButton<SignatureMode>(
              segments: [
                ButtonSegment(value: SignatureMode.profile, label: Text(t.signatureProfile)),
                ButtonSegment(value: SignatureMode.draw, label: Text(t.signatureDraw)),
              ],
              selected: {_mode},
              onSelectionChanged: (s) => setState(() => _mode = s.first),
            ),
            if (_mode == SignatureMode.draw) ...[
              const SizedBox(height: 8),
              AspectRatio(
                aspectRatio: 8 / 3,
                child: DecoratedBox(
                  decoration: BoxDecoration(border: Border.all(color: Theme.of(context).colorScheme.outline)),
                  child: Signature(key: const Key('signature-pad'), controller: _pad, backgroundColor: Colors.white),
                ),
              ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(onPressed: _pad.clear, child: Text(t.signatureClear)),
              ),
            ],
            if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  _error!,
                  key: const Key('decision-error'),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            const SizedBox(height: 12),
            OnlineOnlyButton(
              key: const Key('decision-confirm'),
              label: title,
              icon: widget.decision == Decision.reject ? Icons.close : Icons.check,
              danger: widget.decision == Decision.reject,
              onPressed: _busy ? null : _confirm,
            ),
            TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(false), child: Text(t.cancel)),
          ],
        ),
      ),
    );
  }
}
