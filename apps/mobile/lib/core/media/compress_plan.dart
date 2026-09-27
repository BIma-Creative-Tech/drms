/// Device-side photo targets (requirements v1.1 §9 "Target resize foto"; ADR 0010 decision 11).
class PhotoTarget {
  const PhotoTarget({required this.maxSide, required this.quality, required this.maxBytes});
  final int maxSide;
  final int quality;
  final int maxBytes;

  /// Receipt / progress photo: 1600 px, JPEG q≈80, ≤ 400 KB.
  static const receipt = PhotoTarget(maxSide: 1600, quality: 80, maxBytes: 400 * 1024);

  /// Attendance selfie (F5): 720 px, q≈75, ≤ 150 KB.
  static const selfie = PhotoTarget(maxSide: 720, quality: 75, maxBytes: 150 * 1024);
}

/// Raw uploads above this are refused before any processing (§9 "Upload mentah ditolak bila > 15 MB").
const maxRawBytes = 15 * 1024 * 1024;

/// flutter_image_compress scales by `max(1, min(w/minWidth, h/minHeight))` (README "minWidth and
/// minHeight", native `calcScale`). To cap the LONGEST side at [maxSide] we pass the source size
/// divided by the needed scale, so both ratios are ≥ that scale.
({int minWidth, int minHeight}) boundsFor(int width, int height, int maxSide) {
  final longest = width > height ? width : height;
  if (longest <= maxSide) return (minWidth: width, minHeight: height);
  final scale = longest / maxSide;
  final w = (width / scale).floor();
  final h = (height / scale).floor();
  return (minWidth: w < 1 ? 1 : w, minHeight: h < 1 ? 1 : h);
}

/// Resulting size after the plugin's scaling rule (used by tests to prove the bound holds).
({int width, int height}) scaledSize(int width, int height, int minWidth, int minHeight) {
  final sw = width / minWidth;
  final sh = height / minHeight;
  var s = sw < sh ? sw : sh;
  if (s < 1) s = 1;
  return (width: (width / s).floor(), height: (height / s).floor());
}

/// Successive attempts when the output is still above [PhotoTarget.maxBytes]: lower quality first,
/// then shrink the longest side (keeps receipts legible as long as possible).
List<({int maxSide, int quality})> compressionLadder(PhotoTarget t) => [
  (maxSide: t.maxSide, quality: t.quality),
  (maxSide: t.maxSide, quality: t.quality - 10),
  (maxSide: t.maxSide, quality: t.quality - 20),
  (maxSide: (t.maxSide * 0.85).round(), quality: t.quality - 20),
  (maxSide: (t.maxSide * 0.7).round(), quality: t.quality - 25),
];
