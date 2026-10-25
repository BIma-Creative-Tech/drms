import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../app/theme.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_exception.dart';
import '../../core/platform/report_files.dart';
import '../../l10n/gen/app_localizations.dart';
import 'async_body.dart';
import 'photo_viewer.dart';

/// D2510 (user 2026-10-25): one image behind an AUTHORIZED API path — `/media/<kind>/<id>/file` (the media file
/// endpoint, bearer + device headers of the [ApiClient]; `variant=thumb` for the small tile) or another image
/// endpoint such as `/attendance/<id>/selfie` ([thumbVariant] false: no thumbnail variant there). A bare
/// `Image.network` can never show these (no auth header), which is why the APK draws them from bytes.
class MediaPhoto {
  const MediaPhoto(this.path, {this.caption, this.thumbVariant = true, this.fileName});

  /// A file of a media collection (`receipts`, `transfer-proofs`, `attachments`, `progress-photos`, `signatures`,
  /// `selfies`, `company`).
  MediaPhoto.media(String kind, int id, {String? caption, String? fileName})
    : this('/media/$kind/$id/file', caption: caption, fileName: fileName ?? '$kind-$id');

  /// The selfie of one attendance row (own, or PM of the team / Direktur / Finance / Admin / Admin Staff — the server
  /// checks and audits).
  MediaPhoto.selfie(int attendanceId, {String? caption})
    : this('/attendance/$attendanceId/selfie', caption: caption, thumbVariant: false, fileName: 'selfie-$attendanceId');

  /// Path under `/api/v1`.
  final String path;
  final String? caption;
  final bool thumbVariant;

  /// Base name when the file turns out not to be an image (a PDF proof is saved and opened as a file).
  final String? fileName;

  @override
  bool operator ==(Object other) => other is MediaPhoto && other.path == path;

  @override
  int get hashCode => path.hashCode;
}

/// Bytes of [MediaPhoto.path] (`(path, thumb)`); kept in memory only while shown, never written to disk.
final mediaImageProvider = FutureProvider.autoDispose.family<Uint8List, (String, bool)>((ref, key) {
  final (path, thumb) = key;
  return ref
      .watch(apiClientProvider)
      .run(
        (d) => d.get<dynamic>(
          path,
          queryParameters: {if (thumb) 'variant': 'thumb'},
          options: ApiClient.allCompanies(Options(responseType: ResponseType.bytes)),
        ),
        (data) => Uint8List.fromList(data as List<int>),
      );
});

/// A PDF (`%PDF`) instead of an image: the proof / attachment stays a file link.
bool isPdfBytes(Uint8List b) => b.length > 4 && b[0] == 0x25 && b[1] == 0x50 && b[2] == 0x44 && b[3] == 0x46;

/// Fullscreen viewer over [photos] (pinch / double-tap zoom, swipe, close button, caption — the shared
/// [PhotoViewer]).
Future<void> showMediaViewer(BuildContext context, List<MediaPhoto> photos, {int initialIndex = 0}) =>
    showPhotoViewer(context, [
      for (final p in photos)
        ViewerPhoto(
          caption: p.caption,
          builder: (_) => MediaFullImage(photo: p),
        ),
    ], initialIndex: initialIndex);

/// The full-size image inside the viewer.
class MediaFullImage extends ConsumerWidget {
  const MediaFullImage({super.key, required this.photo});
  final MediaPhoto photo;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    Widget message(String text) => Padding(
      padding: const EdgeInsets.all(24),
      child: Text(
        text,
        style: const TextStyle(color: Colors.white),
        textAlign: TextAlign.center,
      ),
    );
    return switch (ref.watch(mediaImageProvider((photo.path, false)))) {
      AsyncData(:final value) => Image.memory(
        value,
        key: Key('media-full-${photo.path}'),
        fit: BoxFit.contain,
        errorBuilder: (_, _, _) => message(t.mediaNotImage),
      ),
      AsyncError(:final error) => message(errorText(error)),
      _ => const CircularProgressIndicator(),
    };
  }
}

/// Thumbnail of [photo]; a tap opens [showMediaViewer] swiping through [group] (default: this photo only). A file
/// that is not an image (PDF) shows a file tile and opens in the phone's viewer app instead.
class MediaThumb extends ConsumerWidget {
  const MediaThumb({super.key, required this.photo, this.group = const [], this.size = 64, this.semanticLabel});
  final MediaPhoto photo;
  final List<MediaPhoto> group;
  final double size;
  final String? semanticLabel;

  /// [bytes] = the whole file (a PDF has no thumbnail variant, so the tile already holds the full file).
  Future<void> _openFile(BuildContext context, WidgetRef ref, Uint8List bytes) async {
    final t = AppLocalizations.of(context);
    final files = ref.read(reportFilesProvider);
    try {
      final name = '${(photo.fileName ?? 'file').replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_')}.pdf';
      if (!await files.save(name, bytes)) {
        if (context.mounted) showSnack(context, t.reportsSaveFailed);
        return;
      }
      if (!await files.open(name) && !await files.share(name) && context.mounted) showSnack(context, t.reportsNoApp);
    } on Object catch (e) {
      if (context.mounted) showSnack(context, errorText(e));
    }
  }

  void _openViewer(BuildContext context) {
    final photos = group.contains(photo) ? group : [photo];
    showMediaViewer(context, photos, initialIndex: photos.indexOf(photo));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final radius = BorderRadius.circular(PkRadius.sm);
    Widget tile(Widget child, {VoidCallback? onTap}) => SizedBox.square(
      dimension: size,
      child: Material(
        color: scheme.surfaceContainerHigh,
        borderRadius: radius,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: Key('media-thumb-${photo.path}'),
          onTap: onTap,
          child: IconTheme.merge(
            data: IconThemeData(color: scheme.onSurfaceVariant),
            child: Center(child: child),
          ),
        ),
      ),
    );
    final thumb = ref.watch(mediaImageProvider((photo.path, photo.thumbVariant)));
    // A file without a thumbnail (a PDF proof / attachment: 404 on `variant=thumb`) → the file itself.
    final err = thumb.error;
    final noThumb = photo.thumbVariant && err is ProblemException && err.status == 404;
    final image = noThumb ? ref.watch(mediaImageProvider((photo.path, false))) : thumb;
    return switch (image) {
      AsyncData(:final value) when isPdfBytes(value) => tile(
        Tooltip(message: t.mediaOpenFile, child: const Icon(Icons.picture_as_pdf)),
        onTap: () => _openFile(context, ref, value),
      ),
      AsyncData(:final value) => SizedBox.square(
        dimension: size,
        child: Material(
          borderRadius: radius,
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            key: Key('media-thumb-${photo.path}'),
            onTap: () => _openViewer(context),
            child: Semantics(
              button: true,
              label: semanticLabel ?? photo.caption ?? t.mediaOpenPhoto,
              child: Image.memory(
                value,
                fit: BoxFit.cover,
                gaplessPlayback: true,
                errorBuilder: (_, _, _) => const Center(child: Icon(Icons.insert_drive_file)),
              ),
            ),
          ),
        ),
      ),
      AsyncError() => tile(Tooltip(message: t.receiptThumbFailed, child: const Icon(Icons.broken_image))),
      _ => tile(const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))),
    };
  }
}

/// A row of [MediaThumb]s of one record (the viewer swipes across all of them).
class MediaThumbStrip extends StatelessWidget {
  const MediaThumbStrip({super.key, required this.photos, this.size = 64});
  final List<MediaPhoto> photos;
  final double size;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: [for (final p in photos) MediaThumb(photo: p, group: photos, size: size)],
  );
}
