import 'package:dio/dio.dart';

import '../../../core/config/app_env.dart';
import '../../../core/logging/log.dart';
import '../../../core/network/idp_dio.dart';
import 'oidc_client.dart';

/// Why an in-app (password) login failed. Each value has a Bahasa Indonesia message for the UI.
enum PasswordLoginError {
  invalidCredentials('Email/username atau kata sandi salah.'),
  accountDisabled('Akun Anda dinonaktifkan. Hubungi Admin.'),
  accountNotSetUp(
    'Akun Anda belum siap dipakai (misalnya kata sandi sementara belum diganti). '
    'Atur kata sandi lewat halaman login web ProyekKas atau hubungi Admin.',
  ),
  directGrantDisabled('Login langsung belum diaktifkan di server. Hubungi Admin.'),
  clientRejected('Aplikasi ditolak oleh server login. Hubungi Admin.'),
  timeout('Server login tidak merespons. Periksa koneksi internet lalu coba lagi.'),
  network('Tidak dapat terhubung ke server login. Periksa sinyal atau data internet.'),
  server('Server login sedang bermasalah. Coba lagi nanti.'),
  incompleteResponse('Jawaban server login tidak lengkap. Coba lagi atau hubungi Admin.');

  const PasswordLoginError(this.message);
  final String message;
}

class PasswordLoginException implements Exception {
  const PasswordLoginException(this.error);
  final PasswordLoginError error;
  String get message => error.message;

  /// Never includes the username, password or any token.
  @override
  String toString() => 'PasswordLoginException(${error.name})';
}

/// In-app login against Keycloak without a browser (ADR 0012, `PK_LOGIN_MODE=password`, staging only):
/// Resource Owner Password Credentials grant for the public client, plus the non-browser logout.
abstract interface class PasswordLoginClient {
  /// Throws [PasswordLoginException] on every failure.
  Future<OidcTokens> login({required String username, required String password});

  /// Ends the Keycloak (offline) session of [refreshToken]. Best effort: never throws.
  Future<void> logout({required String refreshToken});
}

class KeycloakPasswordClient implements PasswordLoginClient {
  KeycloakPasswordClient(this.env, {Dio? dio}) : _dio = dio ?? createIdpDio();

  final AppEnv env;
  final Dio _dio;

  /// `POST <issuer>/protocol/openid-connect/token`, `grant_type=password` (Keycloak 26.7.4
  /// `ResourceOwnerPasswordCredentialsGrantType`; the client needs Direct Access Grants enabled).
  @override
  Future<OidcTokens> login({required String username, required String password}) async {
    final Response<dynamic> res;
    try {
      res = await _dio.post<dynamic>(
        env.tokenEndpoint,
        data: {
          'grant_type': 'password',
          'client_id': env.oidcClientId,
          'username': username,
          'password': password,
          'scope': AppEnv.scopes.join(' '),
        },
        options: idpFormOptions(),
      );
    } on DioException catch (e) {
      throw PasswordLoginException(_transportError(e));
    }
    final status = res.statusCode ?? 0;
    final body = res.data;
    if (status == 200 && body is Map<String, dynamic>) {
      final access = body['access_token'];
      final refresh = body['refresh_token'];
      if (access is! String || access.isEmpty || refresh is! String || refresh.isEmpty) {
        Log.w('auth: password grant response incomplete');
        throw const PasswordLoginException(PasswordLoginError.incompleteResponse);
      }
      final expiresIn = body['expires_in'];
      return OidcTokens(
        accessToken: access,
        refreshToken: refresh,
        idToken: body['id_token'] is String ? body['id_token'] as String : null,
        accessTokenExpiry: expiresIn is num ? DateTime.now().toUtc().add(Duration(seconds: expiresIn.toInt())) : null,
      );
    }
    final error = mapTokenError(body);
    Log.w('auth: password grant rejected ($status ${error.name})');
    throw PasswordLoginException(error);
  }

  /// Keycloak 26.7.4 `LogoutEndpoint.logoutToken`: form `client_id` + `refresh_token` for a public
  /// client (no secret), 204 on success; also ends an offline session.
  @override
  Future<void> logout({required String refreshToken}) async {
    try {
      final res = await _dio.post<dynamic>(
        env.endSessionEndpoint,
        data: {'client_id': env.oidcClientId, 'refresh_token': refreshToken},
        options: idpFormOptions(),
      );
      if (res.statusCode != 204 && res.statusCode != 200) {
        Log.i('auth: keycloak logout answered ${res.statusCode}');
      }
    } on DioException catch (e) {
      Log.i('auth: keycloak logout skipped (${e.type.name})');
    }
  }

  static PasswordLoginError _transportError(DioException e) => switch (e.type) {
    DioExceptionType.connectionTimeout ||
    DioExceptionType.sendTimeout ||
    DioExceptionType.receiveTimeout => PasswordLoginError.timeout,
    _ => PasswordLoginError.network,
  };

  /// Maps a Keycloak token-endpoint error (RFC 6749 §5.2 body `error` / `error_description`) to a
  /// UI error. Descriptions verified in Keycloak 26.7.4 source (`ValidateUsername`, `ValidatePassword`,
  /// `ResourceOwnerPasswordCredentialsGrantType`). A brute-force lockout deliberately answers
  /// "Invalid user credentials" too, so it maps to [PasswordLoginError.invalidCredentials].
  static PasswordLoginError mapTokenError(Object? body) {
    final map = body is Map<String, dynamic> ? body : const <String, dynamic>{};
    final error = map['error'] is String ? map['error'] as String : '';
    final description = map['error_description'] is String ? map['error_description'] as String : '';
    switch (error) {
      case 'invalid_grant':
        if (description == 'Account disabled') return PasswordLoginError.accountDisabled;
        if (description == 'Account is not fully set up') return PasswordLoginError.accountNotSetUp;
        return PasswordLoginError.invalidCredentials;
      case 'unauthorized_client':
        return PasswordLoginError.directGrantDisabled;
      case 'invalid_client':
        return PasswordLoginError.clientRejected;
      case 'invalid_request' when description == 'Invalid user credentials':
        return PasswordLoginError.invalidCredentials;
    }
    // 5xx, 429, a proxy error page or an unknown OAuth error: nothing the user can fix in the form.
    return PasswordLoginError.server;
  }
}
