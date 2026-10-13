import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/media/photo_compressor.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/async_body.dart';
import '../../../shared/widgets/form_grid.dart';
import '../../../shared/widgets/photo_viewer.dart';
import '../../auth/application/auth_controller.dart';
import '../domain/expense_request.dart';
import 'receipt_capture.dart';
import 'widgets/receipt_thumb.dart';

/// What the requester sends with "Kirim LPJ": usage notes, the server photos kept and the new photos
/// (compressed JPEG, uploaded by the caller through `POST /media/receipts`).
class LpjSubmission {
  const LpjSubmission({
    required this.usageNotes,
    required this.keptPhotoIds,
    required this.newPhotos,
    this.hadPhotos = false,
  });
  final String usageNotes;
  final List<int> keptPhotoIds;
  final List<Uint8List> newPhotos;

  /// The LPJ had photos before: an empty list must then be sent (all removed).
  final bool hadPhotos;
}

/// d1010 (13): free photo slots of an LPJ ([maxLpjPhotos] in total, server photos included).
int lpjPhotoSlots(int photos) => (maxLpjPhotos - photos).clamp(0, maxLpjPhotos);

/// "Kirim LPJ" / "Kirim ulang LPJ" (US-08, US-21, T5) with the LPJ photos (d1010 point 13): camera or gallery
/// (only attendance is camera-only), compressed on the phone like receipts, at most [maxLpjPhotos]. Opened only
/// while the server allows `lpj_submit` (LPJ not submitted yet, or in revision) — after that the photos are
/// read-only in [LpjSection]. Returns null when cancelled.
class LpjSubmitScreen extends ConsumerStatefulWidget {
  const LpjSubmitScreen({super.key, required this.settlement, required this.first});
  final SettlementInfo? settlement;

  /// First submit: usage notes are required.
  final bool first;

  @override
  ConsumerState<LpjSubmitScreen> createState() => _LpjSubmitScreenState();
}

class _LpjSubmitScreenState extends ConsumerState<LpjSubmitScreen> {
  late final _notes = TextEditingController(text: widget.settlement?.usageNotes ?? '');
  late final List<int> _kept = [...?widget.settlement?.photos];
  final List<Uint8List> _new = [];
  bool _busy = false;
  String? _error;

  int get _count => _kept.length + _new.length;

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  Future<void> _add({required bool fromCamera}) async {
    final t = AppLocalizations.of(context);
    if (lpjPhotoSlots(_count) == 0) {
      showSnack(context, t.lpjPhotosFull(maxLpjPhotos));
      return;
    }
    final raw = await pickReceiptImage(context, fromCamera: fromCamera);
    if (raw == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final photo = await ref
          .read(photoCompressorProvider)
          .compress(raw, receiptTargetFor(ref.read(currentProfileProvider)));
      if (mounted && lpjPhotoSlots(_count) > 0) setState(() => _new.add(photo.bytes));
    } on PhotoTooLargeException catch (e) {
      if (mounted) showSnack(context, e.message);
    } on Object {
      if (mounted) showSnack(context, t.cameraUnavailable);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _send() {
    final t = AppLocalizations.of(context);
    final v = _notes.text.trim();
    if ((widget.first || v.isNotEmpty) && v.length < 3) {
      setState(() => _error = t.reasonTooShort);
      return;
    }
    Navigator.of(context).pop(
      LpjSubmission(
        usageNotes: v,
        keptPhotoIds: [..._kept],
        newPhotos: [..._new],
        hadPhotos: widget.settlement?.photos.isNotEmpty ?? false,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final full = lpjPhotoSlots(_count) == 0;
    final viewer = [
      for (final (i, id) in _kept.indexed)
        ViewerPhoto(
          caption: t.lpjPhotoCaption(i + 1),
          builder: (_) => Consumer(
            builder: (_, ref, _) => switch (ref.watch(receiptFullProvider(id))) {
              AsyncData(:final value) => Image.memory(value, fit: BoxFit.contain),
              AsyncError() => const Icon(Icons.broken_image, size: 64, color: Colors.white),
              _ => const CircularProgressIndicator(),
            },
          ),
        ),
      for (final (i, b) in _new.indexed)
        ViewerPhoto(
          caption: t.lpjPhotoCaption(_kept.length + i + 1),
          builder: (_) => Image.memory(b, fit: BoxFit.contain),
        ),
    ];
    Widget removable(Widget thumb, VoidCallback onRemove, Key key) => Stack(
      clipBehavior: Clip.none,
      children: [
        thumb,
        Positioned(
          top: -10,
          right: -10,
          child: IconButton.filledTonal(
            key: key,
            visualDensity: VisualDensity.compact,
            iconSize: 16,
            tooltip: t.lpjPhotoRemove,
            icon: const Icon(Icons.close),
            onPressed: _busy ? null : onRemove,
          ),
        ),
      ],
    );
    return Scaffold(
      appBar: AppBar(title: Text(widget.first ? t.actionLpjSubmit : t.actionLpjResubmit)),
      body: AbsorbPointer(
        absorbing: _busy,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // DRMS 13/10 Umum #2 / D4: label left of the field on wide screens; notes and photos are full width.
            FormGrid(
              rowGap: 16,
              children: [
                FormGridCell(
                  label: t.lpjUsageNotes,
                  full: true,
                  builder: (label) => TextField(
                    key: const Key('lpj-usage-notes'),
                    controller: _notes,
                    minLines: 2,
                    maxLines: 5,
                    maxLength: 2000,
                    decoration: InputDecoration(
                      labelText: label,
                      helperText: t.lpjUsageNotesHint,
                      helperMaxLines: 2,
                      errorText: _error,
                    ),
                  ),
                ),
                FormGridCell(
                  label: t.lpjPhotos,
                  full: true,
                  stackedLabel: true,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t.lpjPhotosCount(_count, maxLpjPhotos), key: const Key('lpj-photo-count')),
                      Text(t.lpjPhotosHint(maxLpjPhotos), style: theme.textTheme.bodySmall),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 14,
                        runSpacing: 14,
                        children: [
                          for (final (i, id) in _kept.indexed)
                            removable(
                              ReceiptThumb(
                                key: Key('lpj-photo-server-$id'),
                                imageId: id,
                                caption: t.lpjPhotoCaption(i + 1),
                              ),
                              () => setState(() => _kept.remove(id)),
                              Key('lpj-photo-remove-server-$id'),
                            ),
                          for (final (i, b) in _new.indexed)
                            removable(
                              SizedBox.square(
                                dimension: 64,
                                child: Material(
                                  borderRadius: BorderRadius.circular(6),
                                  clipBehavior: Clip.antiAlias,
                                  child: InkWell(
                                    key: Key('lpj-photo-new-$i'),
                                    onTap: () => showPhotoViewer(context, viewer, initialIndex: _kept.length + i),
                                    child: Image.memory(b, fit: BoxFit.cover, gaplessPlayback: true),
                                  ),
                                ),
                              ),
                              () => setState(() => _new.removeAt(i)),
                              Key('lpj-photo-remove-new-$i'),
                            ),
                        ],
                      ),
                      if (_busy) Padding(padding: const EdgeInsets.all(8), child: Text(t.photoCompressing)),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              key: const Key('lpj-photo-camera'),
                              onPressed: full ? null : () => _add(fromCamera: true),
                              icon: const Icon(Icons.photo_camera),
                              label: Text(t.lpjPhotoCamera),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: OutlinedButton.icon(
                              key: const Key('lpj-photo-gallery'),
                              onPressed: full ? null : () => _add(fromCamera: false),
                              icon: const Icon(Icons.photo_library),
                              label: Text(t.addReceiptGallery),
                            ),
                          ),
                        ],
                      ),
                      if (full)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(t.lpjPhotosFull(maxLpjPhotos), key: const Key('lpj-photos-full')),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              key: const Key('lpj-send'),
              onPressed: _busy ? null : _send,
              icon: const Icon(Icons.send),
              label: Text(widget.first ? t.actionLpjSubmit : t.actionLpjResubmit),
            ),
          ],
        ),
      ),
    );
  }
}
