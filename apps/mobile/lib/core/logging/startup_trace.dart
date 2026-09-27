import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';

/// Debug-only start-up timing (`flutter run` → `[pk.startup] +123 ms first frame`). In profile and
/// release builds [mark] is a constant-false branch (`kDebugMode`), so nothing is measured or logged.
abstract final class StartupTrace {
  static final Stopwatch _sw = Stopwatch()..start();

  static void mark(String label) {
    if (!kDebugMode) return;
    developer.log('+${_sw.elapsedMilliseconds} ms $label', name: 'pk.startup');
  }
}
