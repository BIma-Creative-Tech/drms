import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../auth/application/auth_controller.dart';
import '../../masters/domain/master_item.dart';
import '../data/draft_repository.dart';
import '../domain/draft.dart';
import '../domain/draft_validation.dart';
import 'receipt_capture.dart';
import 'widgets/master_picker.dart';

/// Edits one line item (US-37) and its receipts (US-7/US-38). Returns the updated [DraftLine].
class LineEditorScreen extends ConsumerStatefulWidget {
  const LineEditorScreen({super.key, required this.line, required this.masters});
  final DraftLine line;
  final Map<String, List<MasterItem>> masters;

  @override
  ConsumerState<LineEditorScreen> createState() => _LineEditorScreenState();
}

class _LineEditorScreenState extends ConsumerState<LineEditorScreen> {
  final _form = GlobalKey<FormState>();
  late DraftLine _line = widget.line;
  late final _desc = TextEditingController(text: widget.line.description);
  late final _qty = TextEditingController(text: widget.line.qty?.toString().replaceAll(RegExp(r'\.0$'), '') ?? '');
  late final _unit = TextEditingController(text: widget.line.unitPrice == null ? '' : '${widget.line.unitPrice}');
  late final _total = TextEditingController(text: widget.line.total == null ? '' : '${widget.line.total}');
  late final _notes = TextEditingController(text: widget.line.notes ?? '');
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_desc, _qty, _unit, _total, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  DraftLine _collect() => _line.copyWith(
    description: _desc.text.trim(),
    qty: double.tryParse(_qty.text.replaceAll(',', '.')),
    unitPrice: parseRupiah(_unit.text),
    total: parseRupiah(_total.text),
    notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
  );

  Future<void> _addReceipt({required bool fromCamera}) async {
    final t = AppLocalizations.of(context);
    final sub = ref.read(currentSubProvider);
    if (sub == null) return;
    final raw = await pickReceiptImage(context, fromCamera: fromCamera);
    if (raw == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final target = receiptTargetFor(ref.read(currentProfileProvider));
      final photo = await ref.read(photoCompressorProvider).compress(raw, target);
      final mediaUuid = ref.read(draftServiceProvider).newId();
      await ref
          .read(draftRepositoryProvider)
          .addMedia(sub, uuid: mediaUuid, kind: 'receipt', bytes: photo.bytes, sha256: photo.sha256Hex);
      if (!mounted) return;
      final fields = await showDialog<ReceiptFields>(
        context: context,
        barrierDismissible: false,
        builder: (_) => ReceiptDetailsDialog(photo: photo.bytes, defaultAmount: parseRupiah(_total.text)),
      );
      final receipt = fields == null
          ? null
          : DraftReceipt(
              clientUuid: ref.read(draftServiceProvider).newId(),
              receiptNo: fields.receiptNo,
              vendorName: fields.vendorName,
              receiptDate: fields.receiptDate,
              receiptTime: fields.receiptTime,
              amount: fields.amount,
              mediaUuid: mediaUuid,
            );
      if (receipt != null) setState(() => _line = _line.copyWith(receipts: [..._line.receipts, receipt]));
    } on PhotoTooLargeException catch (e) {
      if (mounted) showSnack(context, e.message);
    } on QueueFullException catch (e) {
      if (mounted) showSnack(context, e.message);
    } on Object {
      if (mounted) showSnack(context, t.cameraUnavailable);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final m = widget.masters;
    final current = _collect();
    final diff = receiptDifference(current);
    String? req(String? v) => (v == null || v.trim().isEmpty) ? t.required : null;
    String? money(String? v, {bool required = false}) {
      if (v == null || v.trim().isEmpty) return required ? t.required : null;
      final p = parseRupiah(v);
      if (p == null || (required && p <= 0)) return t.invalidAmount;
      return null;
    }

    return Scaffold(
      appBar: AppBar(title: Text(t.lineTitle(_line.no))),
      body: AbsorbPointer(
        absorbing: _busy,
        child: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              TextFormField(
                key: const Key('line-description'),
                controller: _desc,
                maxLength: 500,
                decoration: InputDecoration(labelText: t.fieldDescription),
                validator: req,
              ),
              MasterPickerField(
                label: t.fieldCategory,
                items: m[MasterTypes.categories] ?? const [],
                value: _line.categoryId,
                onChanged: (v) => setState(() => _line = _line.copyWith(categoryId: v)),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      key: const Key('line-qty'),
                      controller: _qty,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: InputDecoration(labelText: t.fieldQty),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: MasterPickerField(
                      label: t.fieldUom,
                      items: m[MasterTypes.uoms] ?? const [],
                      value: _line.uomId,
                      onChanged: (v) => setState(() => _line = _line.copyWith(uomId: v)),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _unit,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: InputDecoration(
                  labelText: t.fieldUnitPrice,
                  helperText: t.unitPriceHint,
                  prefixText: 'Rp ',
                ),
                validator: (v) => money(v),
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const Key('line-total'),
                controller: _total,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: InputDecoration(labelText: t.fieldTotal, prefixText: 'Rp '),
                validator: (v) => money(v, required: true),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 12),
              MasterPickerField(
                label: t.fieldVehicle,
                items: m[MasterTypes.vehicles] ?? const [],
                value: _line.vehicleId,
                onChanged: (v) => setState(() => _line = _line.copyWith(vehicleId: v)),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _notes,
                maxLength: 500,
                decoration: InputDecoration(labelText: t.fieldLineNotes),
              ),
              const Divider(height: 24),
              Text(t.receiptsTitle, style: Theme.of(context).textTheme.titleMedium),
              for (final r in _line.receipts)
                ListTile(
                  leading: const Icon(Icons.receipt),
                  title: Text(r.vendorName),
                  subtitle: Text(
                    '${r.receiptNo ?? '-'} · ${formatDateOnly(r.receiptDate)}${r.receiptTime != null ? ' ${r.receiptTime}' : ''}'
                    '${r.isServerReceipt ? '\n${t.serverReceiptLocked}' : ''}',
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(formatRupiah(r.amount)),
                      // Receipts of an imported server draft stay on the server (read-only here).
                      if (r.isServerReceipt)
                        Padding(
                          padding: const EdgeInsets.all(12),
                          child: Icon(Icons.cloud_done, semanticLabel: t.serverReceiptLocked),
                        )
                      else
                        IconButton(
                          icon: const Icon(Icons.delete_outline),
                          onPressed: () => setState(
                            () => _line = _line.copyWith(
                              receipts: [
                                for (final x in _line.receipts)
                                  if (x.clientUuid != r.clientUuid) x,
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              if (_line.receipts.isNotEmpty && diff != 0) Text(t.receiptDiff(formatRupiah(diff))),
              if (_busy) Padding(padding: const EdgeInsets.all(8), child: Text(t.photoCompressing)),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      key: const Key('add-receipt-camera'),
                      onPressed: () => _addReceipt(fromCamera: true),
                      icon: const Icon(Icons.photo_camera),
                      label: Text(t.addReceiptCamera),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _addReceipt(fromCamera: false),
                      icon: const Icon(Icons.photo_library),
                      label: Text(t.addReceiptGallery),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              FilledButton(
                key: const Key('line-save'),
                onPressed: () {
                  if (!(_form.currentState?.validate() ?? false)) return;
                  Navigator.of(context).pop(_collect());
                },
                child: Text(t.save),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
