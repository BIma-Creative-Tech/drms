import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Opens a web page of the app in the phone's browser (user 2026-10-19: "Keamanan akun" → the web 2FA page, where
/// Keycloak re-authenticates and the change is audited). No plugin: one Android intent (MainActivity
/// `id.co.drms.proyekkas/browser`), https only.
abstract interface class Browser {
  /// false = no browser could take the URL (or not https).
  Future<bool> open(String url);
}

class AndroidBrowser implements Browser {
  static const _channel = MethodChannel('id.co.drms.proyekkas/browser');

  @override
  Future<bool> open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null || uri.scheme != 'https') return false;
    try {
      return await _channel.invokeMethod<bool>('open', {'url': uri.toString()}) ?? false;
    } on Object {
      return false;
    }
  }
}

final browserProvider = Provider<Browser>((ref) => AndroidBrowser());
