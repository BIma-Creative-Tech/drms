import 'dart:developer' as developer;

/// Minimal levelled logger. Never pass tokens, names, amounts or coordinates (ADR 0010 security):
/// callers log codes and ids only; [redact] masks anything that looks like a JWT or a long number.
class Log {
  static bool verbose = false;

  /// Test seam: receives every emitted (already redacted) line, e.g. to assert that no secret is logged.
  static void Function(String line)? testSink;

  static void _emit(String line, int level) {
    testSink?.call(line);
    developer.log(line, name: 'pk', level: level);
  }

  static void d(String msg) {
    if (verbose) _emit(redact(msg), 500);
  }

  static void i(String msg) => _emit(redact(msg), 800);

  static void w(String msg, [Object? error]) =>
      _emit(redact('$msg${error == null ? '' : ' (${error.runtimeType})'}'), 900);

  static final _jwt = RegExp(r'eyJ[\w-]+\.[\w-]+\.[\w-]*');
  static final _bearer = RegExp(r'Bearer\s+\S+', caseSensitive: false);
  static final _longDigits = RegExp(r'\d{7,}');

  static String redact(String s) =>
      s.replaceAll(_jwt, '<jwt>').replaceAll(_bearer, 'Bearer <redacted>').replaceAll(_longDigits, '<num>');
}
