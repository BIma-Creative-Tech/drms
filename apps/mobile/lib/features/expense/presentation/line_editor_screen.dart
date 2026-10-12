import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/format/dates.dart';
import '../../../core/format/rupiah.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/photo_viewer.dart';
import '../../auth/application/auth_controller.dart';
import '../../masters/domain/master_item.dart';
import '../../projects/application/projects_providers.dart';
import '../data/draft_repository.dart';
import '../domain/draft.dart';
import '../domain/draft_validation.dart';
import 'receipt_capture.dart';
import 'widgets/master_picker.dart';
import 'widgets/rap_item_picker.dart';
import 'widgets/receipt_mismatch_chip.dart';

/// Edits one line item (US-37) and its receipts (US-7/US-38). Returns the updated [DraftLine].
class LineEditorScreen extends ConsumerStatefulWidget {
  const LineEditorScreen({super.key, required this.line, required this.masters, this.projectId});
  final DraftLine line;
  final Map<String, List<MasterItem>> masters;

  /// D4: project of the draft — the "Item RAP" picker lists its RAP items (null = no project chosen yet).
  final int? projectId;

  @override
  ConsumerState<LineEditorScreen> createState() => _LineEditorScreenState();
}

class _LineEditorScreenState extends ConsumerState<LineEditorScreen> {
  final _form = GlobalKey<FormState>();
  late DraftLine _line = widget.line;
  late final _desc = TextEditingController(text: widget.line.description);
  late final _qty = TextEditingController(text: widget.line.qty?.toString().replaceAll(RegExp(r'\.0$'), '') ?? '');
  late final _unit = TextEditingController(text: groupRupiah(widget.line.unitPrice));
  late final _receiptAmount = TextEditingController(text: groupRupiah(widget.line.receiptAmount));
  late final _notes = TextEditingController(text: widget.line.notes ?? '');
  bool _busy = false;

  /// Set by "Simpan": pickers outside the Form (Satuan) show their error from then on.
  bool _tried = false;

  @override
  void dispose() {
    for (final c in [_desc, _qty, _unit, _receiptAmount, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  /// D4: the RAP items of the project are known here (online, or cached) — the line cannot be saved without
  /// one. Without the list (no project yet, offline without a cached list) the line is saved and submit asks.
  bool get _rapPickable {
    final pid = widget.projectId;
    if (pid == null) return false;
    return ref.read(projectRapProvider(pid)).value?.pickable.isNotEmpty ?? false;
  }

  /// D3: the total is never typed — qty × harga satuan (a pre-D3 line keeps its old total until both are
  /// filled).
  DraftLine _collect() {
    final l = _line.copyWith(
      description: _desc.text.trim(),
      qty: double.tryParse(_qty.text.replaceAll(',', '.')),
      unitPrice: parseRupiah(_unit.text),
      receiptAmount: parseRupiah(_receiptAmount.text),
      notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
    );
    return l.copyWith(total: l.computedTotal ?? (l.unitPrice == null ? widget.line.total : null));
  }

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
        builder: (_) => ReceiptDetailsDialog(
          photo: photo.bytes,
          defaultAmount: parseRupiah(_receiptAmount.text) ?? _collect().computedTotal,
        ),
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
    final theme = Theme.of(context);
    String? req(String? v) => (v == null || v.trim().isEmpty) ? t.required : null;
    String? qty(String? v) {
      if (v == null || v.trim().isEmpty) return t.required;
      final q = double.tryParse(v.replaceAll(',', '.'));
      return (q == null || q <= 0) ? t.invalidAmount : null;
    }

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
              // D3: a line saved before the computed total — ask for qty / satuan / harga satuan.
              // D4: a line saved before the RAP link (or whose project changed) — pick its RAP item.
              // (not when the loaded project has no RAP item at all — the RAP field then says why)
              if (widget.line.needsRapItem &&
                  widget.line.description.isNotEmpty &&
                  !(widget.projectId != null &&
                      (ref.watch(projectRapProvider(widget.projectId!)).value?.pickable.isEmpty ?? false)))
                Card(
                  key: const Key('line-needs-rap-item'),
                  color: theme.colorScheme.tertiaryContainer,
                  child: ListTile(leading: const Icon(Icons.info_outline), title: Text(t.lineNeedsRapItem)),
                ),
              if (widget.line.needsUnitPrice && widget.line.total != null)
                Card(
                  key: const Key('line-needs-unit-price'),
                  color: theme.colorScheme.tertiaryContainer,
                  child: ListTile(
                    leading: const Icon(Icons.info_outline),
                    title: Text(t.lineNeedsUnitPrice(formatRupiah(widget.line.total!))),
                  ),
                ),
              TextFormField(
                key: const Key('line-description'),
                controller: _desc,
                maxLength: 500,
                decoration: InputDecoration(labelText: t.fieldDescription),
                validator: req,
              ),
              // D4: required RAP item of the draft's project (remaining budget shown; "Melebihi RAP" when above it).
              RapItemPickerField(
                projectId: widget.projectId,
                value: _line.rapItemId,
                lineTotal: current.computedTotal,
                errorText: _tried && _line.rapItemId == null && _rapPickable ? t.required : null,
                onChanged: (v) => setState(() => _line = _line.copyWith(rapItemId: v)),
              ),
              const SizedBox(height: 12),
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
                      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
                      decoration: InputDecoration(labelText: t.fieldQty),
                      validator: qty,
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: MasterPickerField(
                      label: t.fieldUom,
                      items: m[MasterTypes.uoms] ?? const [],
                      value: _line.uomId,
                      errorText: _tried && _line.uomId == null ? t.required : null,
                      onChanged: (v) => setState(() => _line = _line.copyWith(uomId: v)),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const Key('line-unit-price'),
                controller: _unit,
                keyboardType: TextInputType.number,
                inputFormatters: const [RupiahInputFormatter()],
                decoration: InputDecoration(labelText: t.fieldUnitPrice, prefixText: 'Rp '),
                validator: (v) => money(v, required: true),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 12),
              // D3: Total = Qty × Harga satuan, shown live, read-only (not an input).
              InputDecorator(
                decoration: InputDecoration(
                  labelText: t.fieldTotal,
                  helperText: t.lineTotalHelper,
                  helperMaxLines: 2,
                  filled: true,
                  enabled: false,
                ),
                child: Text(
                  current.computedTotal == null ? '-' : formatRupiah(current.computedTotal!),
                  key: const Key('line-total'),
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const Key('line-receipt-amount'),
                controller: _receiptAmount,
                keyboardType: TextInputType.number,
                inputFormatters: const [RupiahInputFormatter()],
                decoration: InputDecoration(
                  labelText: t.fieldReceiptAmount,
                  helperText: t.receiptAmountHelper,
                  helperMaxLines: 2,
                  prefixText: 'Rp ',
                ),
                validator: (v) => money(v),
                onChanged: (_) => setState(() {}),
              ),
              if (current.receiptMismatch)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: ReceiptMismatchChip(
                      key: const Key('line-receipt-mismatch'),
                      receiptAmount: current.receiptAmount,
                      total: current.computedTotal,
                    ),
                  ),
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
                  // d1010 (12c): local photo thumbnail, tap = fullscreen viewer over this line's local receipts.
                  leading: r.isServerReceipt
                      ? const Icon(Icons.receipt)
                      : _DraftReceiptThumb(
                          uuid: r.mediaUuid,
                          group: [
                            for (final x in _line.receipts)
                              if (!x.isServerReceipt) (uuid: x.mediaUuid, caption: x.vendorName),
                          ],
                        ),
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
                  setState(() => _tried = true);
                  final ok = _form.currentState?.validate() ?? false;
                  if (!ok || _line.uomId == null || (_line.rapItemId == null && _rapPickable)) return;
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

/// Bytes of a local draft photo (encrypted DB); null once purged after the upload.
final _draftMediaProvider = FutureProvider.autoDispose.family<Uint8List?, String>(
  (ref, uuid) async => (await ref.watch(draftRepositoryProvider).media(uuid))?.bytes,
);

class _DraftReceiptThumb extends ConsumerWidget {
  const _DraftReceiptThumb({required this.uuid, required this.group});
  final String uuid;
  final List<({String uuid, String caption})> group;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bytes = ref.watch(_draftMediaProvider(uuid)).value;
    if (bytes == null) return const SizedBox.square(dimension: 48, child: Icon(Icons.receipt));
    return SizedBox.square(
      dimension: 48,
      child: Material(
        borderRadius: BorderRadius.circular(6),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: Key('draft-receipt-thumb-$uuid'),
          onTap: () => showPhotoViewer(context, [
            for (final p in group)
              ViewerPhoto(
                caption: p.caption,
                builder: (_) => Consumer(
                  builder: (_, ref, _) => switch (ref.watch(_draftMediaProvider(p.uuid))) {
                    AsyncData(:final value?) => Image.memory(value, fit: BoxFit.contain),
                    AsyncLoading() => const CircularProgressIndicator(),
                    _ => const Icon(Icons.broken_image, size: 64, color: Colors.white),
                  },
                ),
              ),
          ], initialIndex: group.indexWhere((p) => p.uuid == uuid)),
          child: Image.memory(bytes, fit: BoxFit.cover, gaplessPlayback: true),
        ),
      ),
    );
  }
}
