import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Key/value secrets (refresh token, DB key, install id). Android: Keystore-wrapped AES-GCM
/// (`AndroidOptions()` default cipher of flutter_secure_storage 10+, README "Encryption Options").
abstract interface class SecureStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class PlatformSecureStore implements SecureStore {
  PlatformSecureStore() : _s = const FlutterSecureStorage(aOptions: AndroidOptions());
  final FlutterSecureStorage _s;

  @override
  Future<String?> read(String key) => _s.read(key: key);
  @override
  Future<void> write(String key, String value) => _s.write(key: key, value: value);
  @override
  Future<void> delete(String key) => _s.delete(key: key);
}

/// In-memory store for tests.
class MemorySecureStore implements SecureStore {
  final Map<String, String> data = {};
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> write(String key, String value) async => data[key] = value;
  @override
  Future<void> delete(String key) async => data.remove(key);
}

abstract final class SecureKeys {
  static const refreshToken = 'pk.refresh_token';
  static const idToken = 'pk.id_token';
  static const sessionSub = 'pk.session_sub';
  static const dbKey = 'pk.db_key';
  static const installId = 'pk.install_id';
}
