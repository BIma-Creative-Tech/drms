import 'package:flutter_appauth/flutter_appauth.dart';

import '../../../core/config/app_env.dart';

class OidcTokens {
  const OidcTokens({required this.accessToken, required this.refreshToken, this.idToken, this.accessTokenExpiry});
  final String accessToken;
  final String refreshToken;
  final String? idToken;
  final DateTime? accessTokenExpiry;
}

class LoginCancelled implements Exception {
  const LoginCancelled();
}

/// Browser part of OIDC (system browser / Custom Tabs via AppAuth): Authorization Code + PKCE S256
/// (AppAuth-Android generates the S256 verifier/challenge itself) and RP-initiated logout.
abstract interface class OidcBrowserClient {
  Future<OidcTokens> login();
  Future<void> endSession({required String? idTokenHint});
}

class AppAuthBrowserClient implements OidcBrowserClient {
  AppAuthBrowserClient(this.env, [this._appAuth = const FlutterAppAuth()]);
  final AppEnv env;
  final FlutterAppAuth _appAuth;

  AuthorizationServiceConfiguration get _config => AuthorizationServiceConfiguration(
    authorizationEndpoint: env.authorizationEndpoint,
    tokenEndpoint: env.tokenEndpoint,
    endSessionEndpoint: env.endSessionEndpoint,
  );

  @override
  Future<OidcTokens> login() async {
    try {
      final res = await _appAuth.authorizeAndExchangeCode(
        AuthorizationTokenRequest(
          env.oidcClientId,
          env.oidcRedirectUri,
          serviceConfiguration: _config,
          scopes: AppEnv.scopes,
          promptValues: const ['login'],
        ),
      );
      final access = res.accessToken;
      final refresh = res.refreshToken;
      if (access == null || refresh == null) {
        throw StateError('Token tidak lengkap dari server login');
      }
      return OidcTokens(
        accessToken: access,
        refreshToken: refresh,
        idToken: res.idToken,
        accessTokenExpiry: res.accessTokenExpirationDateTime,
      );
    } on FlutterAppAuthUserCancelledException {
      throw const LoginCancelled();
    }
  }

  @override
  Future<void> endSession({required String? idTokenHint}) async {
    await _appAuth.endSession(
      EndSessionRequest(
        idTokenHint: idTokenHint,
        postLogoutRedirectUrl: env.oidcRedirectUri,
        serviceConfiguration: _config,
      ),
    );
  }
}
