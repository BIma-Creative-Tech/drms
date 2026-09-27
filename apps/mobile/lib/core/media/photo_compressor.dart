import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:crypto/crypto.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';

import 'compress_plan.dart';

class CompressedPhoto {
  const CompressedPhoto(this.bytes, this.sha256Hex);
  final Uint8List bytes;
  final String sha256Hex;
}

class PhotoTooLargeException implements Exception {
  const PhotoTooLargeException(this.message);
  final String message;
}

abstract interface class PhotoCompressor {
  Future<CompressedPhoto> compress(Uint8List raw, PhotoTarget target);
}

/// JPEG output, EXIF dropped (`keepExif: false`, plugin default — GPS never leaves the phone).
class DevicePhotoCompressor implements PhotoCompressor {
  @override
  Future<CompressedPhoto> compress(Uint8List raw, PhotoTarget target) async {
    if (raw.length > maxRawBytes) {
      throw const PhotoTooLargeException('Foto lebih dari 15 MB dan tidak bisa dipakai.');
    }
    final size = await _decodeSize(raw);
    Uint8List? out;
    for (final step in compressionLadder(target)) {
      final b = boundsFor(size.width, size.height, step.maxSide);
      out = await FlutterImageCompress.compressWithList(
        raw,
        minWidth: b.minWidth,
        minHeight: b.minHeight,
        quality: step.quality,
        format: CompressFormat.jpeg,
        keepExif: false,
      );
      if (out.length <= target.maxBytes) break;
    }
    if (out == null || out.length > target.maxBytes) {
      throw const PhotoTooLargeException('Foto tidak bisa dikompres di bawah batas ukuran. Ambil ulang foto.');
    }
    return CompressedPhoto(out, sha256.convert(out).toString());
  }

  /// Reads only the header (ImageDescriptor) — no full decode of a 12 MP photo in Dart memory.
  Future<({int width, int height})> _decodeSize(Uint8List raw) async {
    final buffer = await ui.ImmutableBuffer.fromUint8List(raw);
    final desc = await ui.ImageDescriptor.encoded(buffer);
    final r = (width: desc.width, height: desc.height);
    desc.dispose();
    buffer.dispose();
    return r;
  }
}
