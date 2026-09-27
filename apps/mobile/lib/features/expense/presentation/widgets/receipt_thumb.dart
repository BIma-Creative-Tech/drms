import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/providers.dart';
import '../../../../l10n/gen/app_localizations.dart';

/// Thumbnails are fetched through the authorized file endpoint (bearer + X-Device-Id); nothing is
/// cached on disk.
final receiptThumbProvider = FutureProvider.autoDispose.family<Uint8List, int>(
  (ref, imageId) => ref.watch(expenseApiProvider).receiptImage(imageId),
);

class ReceiptThumb extends ConsumerWidget {
  const ReceiptThumb({super.key, required this.imageId, this.size = 64});
  final int? imageId;
  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    Widget box(Widget child) => SizedBox.square(dimension: size, child: child);
    if (imageId == null) return box(const Icon(Icons.image_not_supported));
    return switch (ref.watch(receiptThumbProvider(imageId!))) {
      AsyncData(:final value) => box(
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: Image.memory(value, fit: BoxFit.cover, gaplessPlayback: true),
        ),
      ),
      AsyncError() => box(Tooltip(message: t.receiptThumbFailed, child: const Icon(Icons.broken_image))),
      _ => box(const Center(child: SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)))),
    };
  }
}
