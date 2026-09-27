import 'dart:developer' as developer;

/// Minimal levelled logger. Never pass tokens, names, amounts or coordinates (ADR 0010 security):
/// callers log codes and ids only; [redact] masks anything that looks like a JWT or a long number.
class Log {
  static bool verbose = false;

  static void d(String msg) {
    if (verbose) developer.log(redact(msg), name: 'pk', level: 500);
  }

  static void i(String msg) => developer.log(redact(msg), name: 'pk', level: 800);

  static void w(String msg, [Object? error]) =>
      developer.log(redact('$msg${error == null ? '' : ' (${error.runtimeType})'}'), name: 'pk', level: 900);

  static final _jwt = RegExp(r'eyJ[\w-]+\.[\w-]+\.[\w-]*');
  static final _bearer = RegExp(r'Bearer\s+\S+', caseSensitive: false);
  static final _longDigits = RegExp(r'\d{7,}');

  static String redact(String s) =>
      s.replaceAll(_jwt, '<jwt>').replaceAll(_bearer, 'Bearer <redacted>').replaceAll(_longDigits, '<num>');
}
