/// How the app signs the user in to Keycloak (`PK_LOGIN_MODE`, ADR 0012).
enum LoginMode {
  /// Authorization Code + PKCE in the system browser / Custom Tab via AppAuth (ADR 0003, default).
  browser,

  /// In-app username/password form, Keycloak Direct Access Grant (staging only, ADR 0012).
  password;

  /// Unknown or empty values fall back to [browser] (the safer, standards-conform mode).
  static LoginMode parse(String raw) => raw.trim().toLowerCase() == 'password' ? password : browser;
}

/// Build-time configuration injected with `--dart-define-from-file=config/<flavor>.json`
/// (no secrets: URLs and the public OIDC client id only — ADR 0003, no client secret in the APK).
class AppEnv {
  const AppEnv({
    required this.flavor,
    required this.apiBaseUrl,
    required this.oidcIssuer,
    required this.oidcClientId,
    required this.oidcRedirectUri,
    required this.pushEnabled,
    this.loginMode = LoginMode.browser,
  });

  factory AppEnv.fromEnvironment() => AppEnv(
    flavor: const String.fromEnvironment('PK_FLAVOR', defaultValue: 'staging'),
    apiBaseUrl: const String.fromEnvironment(
      'PK_API_BASE_URL',
      defaultValue: 'https://drms-kas.staging.bimacreative.tech',
    ),
    oidcIssuer: const String.fromEnvironment(
      'PK_OIDC_ISSUER',
      defaultValue: 'https://auth.bimacreative.tech/realms/drms-staging',
    ),
    oidcClientId: const String.fromEnvironment('PK_OIDC_CLIENT_ID', defaultValue: 'proyekkas-mobile'),
    oidcRedirectUri: const String.fromEnvironment(
      'PK_OIDC_REDIRECT_URI',
      defaultValue: 'https://drms-kas.staging.bimacreative.tech/app/callback',
    ),
    // Push (FCM, ADR 0011) stays off until the Firebase project exists (Q-44).
    pushEnabled: const bool.fromEnvironment('PK_PUSH_ENABLED'),
    // `password` only for staging (ADR 0012); prod stays `browser` until the F6 decision.
    loginMode: LoginMode.parse(const String.fromEnvironment('PK_LOGIN_MODE', defaultValue: 'browser')),
  );

  final String flavor;
  final String apiBaseUrl;
  final String oidcIssuer;
  final String oidcClientId;
  final String oidcRedirectUri;
  final bool pushEnabled;
  final LoginMode loginMode;

  bool get usesPasswordLogin => loginMode == LoginMode.password;

  /// Fallback redirect when the HTTPS App Link cannot be verified (e.g. build not signed with the key
  /// listed in /.well-known/assetlinks.json): private-use reverse-domain scheme (flutter_appauth README,
  /// lowercase). Must also be allowed in Keycloak client `proyekkas-mobile`.
  static const customSchemeRedirect = 'id.co.drms.proyekkas:/oauth2redirect';

  bool get usesAppLink => oidcRedirectUri.startsWith('https://');

  static const scopes = ['openid', 'offline_access'];

  bool get isProd => flavor == 'prod';

  String get apiV1 => '$apiBaseUrl/api/v1';

  /// Keycloak OIDC endpoints (ADR 0003 "Keycloak 26.7.4 facts used").
  String get tokenEndpoint => '$oidcIssuer/protocol/openid-connect/token';
  String get authorizationEndpoint => '$oidcIssuer/protocol/openid-connect/auth';
  String get endSessionEndpoint => '$oidcIssuer/protocol/openid-connect/logout';
}
