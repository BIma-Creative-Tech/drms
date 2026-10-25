import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/providers.dart';
import '../../../../app/theme.dart';
import '../../../../l10n/gen/app_localizations.dart';
import '../../../../shared/widgets/photo_viewer.dart';

/// Thumbnails are fetched through the authorized file endpoint (bearer + X-Device-Id); nothing is
/// cached on disk.
final receiptThumbProvider = FutureProvider.autoDispose.family<Uint8List, int>(
  (ref, imageId) => ref.watch(expenseApiProvider).receiptImage(imageId),
);

/// Full-size receipt photo for the viewer (same authorized endpoint, no `variant`).
final receiptFullProvider = FutureProvider.autoDispose.family<Uint8List, int>(
  (ref, imageId) => ref.watch(expenseApiProvider).receiptImage(imageId, thumb: false),
);

/// One receipt photo of a viewer group (image id + caption shown under the photo).
typedef ReceiptPhoto = ({int imageId, String caption});

/// Receipt thumbnail; tap = fullscreen viewer (d1010 12c) swiping through [group] (default: this one only).
class ReceiptThumb extends ConsumerWidget {
  const ReceiptThumb({super.key, required this.imageId, this.size = 64, this.group = const [], this.caption});
  final int? imageId;
  final double size;
  final List<ReceiptPhoto> group;
  final String? caption;

  void _open(BuildContext context) {
    final id = imageId!;
    final photos = group.any((p) => p.imageId == id) ? group : [(imageId: id, caption: caption ?? '')];
    showPhotoViewer(context, [
      for (final p in photos)
        ViewerPhoto(
          builder: (_) => _ReceiptFull(imageId: p.imageId),
          caption: p.caption,
        ),
    ], initialIndex: photos.indexWhere((p) => p.imageId == id));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    Widget box(Widget child) => SizedBox.square(dimension: size, child: child);
    // D2510: placeholders on a rounded tinted tile (same radius as the photo).
    final scheme = Theme.of(context).colorScheme;
    Widget tile(Widget child) => box(
      DecoratedBox(
        decoration: BoxDecoration(color: scheme.surfaceContainerHigh, borderRadius: BorderRadius.circular(PkRadius.sm)),
        child: IconTheme.merge(
          data: IconThemeData(color: scheme.onSurfaceVariant),
          child: Center(child: child),
        ),
      ),
    );
    if (imageId == null) return tile(const Icon(Icons.image_not_supported));
    return switch (ref.watch(receiptThumbProvider(imageId!))) {
      AsyncData(:final value) => box(
        Material(
          borderRadius: BorderRadius.circular(PkRadius.sm),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            key: Key('receipt-thumb-$imageId'),
            onTap: () => _open(context),
            child: Semantics(
              button: true,
              label: t.receiptOpenPhoto,
              child: Image.memory(value, fit: BoxFit.cover, gaplessPlayback: true),
            ),
          ),
        ),
      ),
      AsyncError() => tile(Tooltip(message: t.receiptThumbFailed, child: const Icon(Icons.broken_image))),
      _ => tile(const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))),
    };
  }
}

class _ReceiptFull extends ConsumerWidget {
  const _ReceiptFull({required this.imageId});
  final int imageId;
  @override
  Widget build(BuildContext context, WidgetRef ref) => switch (ref.watch(receiptFullProvider(imageId))) {
    AsyncData(:final value) => Image.memory(value, fit: BoxFit.contain),
    AsyncError() => const Icon(Icons.broken_image, size: 64, color: Colors.white),
    _ => const CircularProgressIndicator(),
  };
}
