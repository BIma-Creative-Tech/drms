# ADR 0012 — Mobile in-app password login (Keycloak Direct Access Grant) on staging

- **Status:** accepted (user decision 2026-09-25)
- **Date:** 2026-09-25
- **Author:** flutter-developer (for the Lead), fix `fix/mobile-native-login`
- **Related:** ADR 0003 §1 (client `proyekkas-mobile`: Authorization Code + PKCE via the system browser), §4, §5,
  §7; ADR 0010 (mobile stack, token storage); `apps/mobile/README.md` "Login mode"; phase-plan F6 backlog
  ("decide prod mobile login mode"); RFC 9700 §2.4; RFC 8252 §4, §8.12

## Context

### What happened (reported by the Lead from the user's phone test and Keycloak events, 2026-09-25)

- With flutter_appauth 12.1.0 (Custom Tab, `lib/features/auth/data/oidc_client.dart`) the user's phone recreated
  the app process while the Custom Tab was open. Keycloak recorded `LOGIN` for `proyekkas-mobile`, the app
  cold-started about 1 s later, and there was **no `CODE_TO_TOKEN`**: the pending AppAuth request (PKCE verifier,
  state) did not survive the process death, so the redirect was never exchanged and the user landed on the login
  screen again, in a loop. The earlier App Link → custom-scheme change (`525fe26`) did not fix this.
- The client (user) also requires that login **stays inside the app** (no browser hand-off).
- OTP (`CONFIGURE_TOTP`) was removed for the staging users. Direct Access Grants were enabled by the user on
  client `proyekkas-mobile` in realm `drms-staging` (verified by the Lead; not re-checked by this ADR's author).

### Standards (read 2026-09-25 from rfc-editor.org)

- **RFC 9700** (BCP 240, OAuth 2.0 Security BCP, January 2025) §2.4: "The resource owner password credentials
  grant [RFC6749] MUST NOT be used." Reasons given: credentials exposed to the client, more places where they can
  leak, users trained to type credentials outside the authorization server, no fit for 2FA / multi-step login.
- **RFC 8252** (BCP 212, OAuth 2.0 for Native Apps) §4: the best current practice is to make the authorization
  request in an external user-agent (the browser); §8.12: native apps MUST NOT use embedded user-agents, and
  "even when used by trusted apps belonging to the same party as the authorization server" in-app credential
  entry violates least privilege and trains users to enter credentials without checking the site.
- ADR 0003 §1 follows both: `proyekkas-mobile` = public client, Authorization Code + PKCE S256 in the system
  browser. This ADR **deviates** from ADR 0003 §1 and from both RFCs, for staging only.

### Keycloak 26.7.4 behaviour used (source at tag `26.7.4`, raw.githubusercontent.com, read 2026-09-25)

- `services/.../grants/ResourceOwnerPasswordCredentialsGrantType.java`
  - L71–75: client without Direct Access Grants → `400 unauthorized_client`,
    "Client not allowed for direct access grants".
  - L124–132: user with a pending required action (e.g. temporary password → `UPDATE_PASSWORD`) →
    `400 invalid_grant`, "Account is not fully set up". Such users cannot log in with this flow.
- `services/.../authenticators/directgrant/ValidateUsername.java`
  - L77–91: unknown user / service account → `400 invalid_grant`, "Invalid user credentials".
  - L94–101: user locked by **brute-force detection** → the same `invalid_grant` "Invalid user credentials"
    (no hint that the account is locked, no user enumeration).
  - L104–113: disabled user → "Account disabled" **only if the password is correct**, else
    "Invalid user credentials".
  - L71: duplicate user match → `401 invalid_request`, "Invalid user credentials".
- `.../directgrant/ValidatePassword.java` L54: wrong password → `400 invalid_grant`, "Invalid user credentials".
- `services/.../endpoints/LogoutEndpoint.java`
  - L327–344: `POST …/protocol/openid-connect/logout` with a form containing `refresh_token` goes to
    `logoutToken()`.
  - L486–559: "If the client is a public client, then you must include a "client_id" form parameter";
    the refresh token is verified, the user session (or the **offline** session for an offline token) is logged
    out; answers **204**. So public-client logout without a browser is supported in Keycloak 26.7.4.
- Token refresh (`grant_type=refresh_token`) already runs as a plain HTTP call in `TokenManager` in both modes;
  AppAuth is only used for the browser authorization request and RP-initiated logout.

## Decision

1. New build flag `PK_LOGIN_MODE` (dart-define, `AppEnv.loginMode`): `browser` (default, ADR 0003 flow,
   unchanged) or `password`. Unknown values fall back to `browser`. `config/staging.json` = `password`;
   `config/prod.json` = `browser`. The prod decision is an F6 backlog item.
2. Password mode, `KeycloakPasswordClient` (`lib/features/auth/data/password_login_client.dart`):
   - Login: `POST <issuer>/protocol/openid-connect/token`, form `grant_type=password`, `client_id`, `username`,
     `password`, `scope=openid offline_access` (same scopes as the browser flow, so the session stays an offline
     session with the ADR 0003 lifetimes). Result = the same `OidcTokens` → `TokenManager.saveLogin` (refresh
     token only in secure storage, access token only in memory, ADR 0010).
   - A response without `access_token` or `refresh_token` is rejected ("Jawaban server login tidak lengkap").
   - Error mapping (Bahasa Indonesia): `invalid_grant` "Invalid user credentials" (also brute-force lockout) →
     "Email/username atau kata sandi salah."; "Account disabled" → "Akun Anda dinonaktifkan. Hubungi Admin.";
     "Account is not fully set up" → set the password on the ProyekKas web login or contact the Admin;
     `unauthorized_client` → "Login langsung belum diaktifkan di server."; `invalid_client` → app rejected;
     timeouts / no connection / 5xx / 429 → connection or server messages.
   - Logout: after the server-side device revoke (ADR 0003 §5, unchanged), `POST <issuer>/protocol/openid-connect/logout`
     with `client_id` + `refresh_token` (best effort, never blocks), then local state is cleared as before.
   - The issuer calls use a dedicated dio (`lib/core/network/idp_dio.dart`) without logging interceptors; the
     password and tokens are never logged or persisted, and the password field is cleared after every attempt.
3. Login screen in password mode: username/email field (email keyboard, autofill username/email), password field
   (show/hide, autofill password), "Masuk" with loading state, inline error, "Lupa kata sandi? Hubungi Admin.";
   no browser is opened. Browser mode keeps the previous screen and flow.
4. This mode is for **staging only** until the F6 decision. Users who must change a temporary password do it on
   the web (browser login with required actions) before using the APK.

## Alternatives

| Alternative | Rejected because |
|---|---|
| Keep Custom Tab + AppAuth and persist the pending authorization request across process death | Needs native changes to AppAuth-Android state handling; flutter_appauth 12.1.0 has no documented option for it (UNVERIFIED, not researched further); and the client explicitly wants login inside the app. |
| Embedded WebView showing the Keycloak login page | Also collects credentials in the app (RFC 8252 §8.12 MUST NOT), plus cookie/JS handling and no password-manager/autofill parity; no advantage over a native form. |
| App Link redirect instead of custom scheme | Tried (`525fe26` switched away from it); the loop is caused by process death, not by the redirect type. |
| Device Authorization Grant (RFC 8628) | Needs a second device/browser to approve; unusable for field staff. |

## Consequences

- Positive: login no longer depends on the Custom Tab returning to a live process; the whole login stays in the
  app, as the client requires; refresh/logout work without AppAuth.
- Negative: the app handles the user's password (the risk RFC 9700 §2.4 describes). Password mode cannot do OTP /
  WebAuthn / required actions / identity brokering; users with a pending required action must use the web first.
  Users with OTP configured are expected to fail in the direct-grant flow (exact response **UNVERIFIED**; OTP was
  removed for staging users).
- Two login code paths must be kept working and tested until the prod decision (F6).

## Security implications

Mitigations accepted with this deviation:

- **First-party app and IdP:** the APK, the Keycloak realm and the API are operated by the same party; no third
  party ever sees the credentials.
- **TLS only:** the issuer is `https://auth.bimacreative.tech`; the APK's Network Security Config forbids
  cleartext and trusts only system CAs (ADR 0010). No certificate pinning (ADR 0010 decision 9).
- **Brute force:** Keycloak brute-force detection applies to the direct-grant flow (`ValidateUsername` L94–101,
  locked users get the generic error). ADR 0003 records `bruteForceProtected` for the realm and the Traefik
  `ratelimit-login` (10 req/min/IP) on `…/openid-connect/(auth|token)` — both from ADR 0003, **not re-verified
  for `drms-staging` in this session (UNVERIFIED; Lead/infra to confirm)**. Note the rate limit also counts
  refresh-token calls from the same IP.
- **No password persisted:** the password lives only in the text field and the single request body; the field
  is cleared after each attempt; exceptions and logs carry only error codes (`Log` already redacts JWTs).
- **Public client, no secret in the APK** (unchanged); Direct Access Grants enabled only on `proyekkas-mobile`
  in `drms-staging`.
- **Staging only:** `config/prod.json` stays `browser`; realm `drms` keeps Direct Access Grants off (state of
  realm `drms` not checked in this session).

## Rollback

1. Build the APK with `PK_LOGIN_MODE=browser` (edit `config/staging.json` or pass
   `--dart-define=PK_LOGIN_MODE=browser`) and ship it.
2. Turn **Direct Access Grants off** on client `proyekkas-mobile` in realm `drms-staging` (Keycloak admin).
   Old password-mode APKs then show "Login langsung belum diaktifkan di server." and existing sessions keep
   refreshing normally (refresh is not a direct grant).
3. Optionally revert this change; browser mode is untouched by it.

## Proposed CLAUDE.md changes (need user approval; author does not edit)

None.

## Revision 2026-09-26 — prod uses the same login (user decision K3, GATE G1-3)

- `plans/fase1-golive.md` K3 / G1-3 (approved 2026-09-26): the prod APK logs in like staging. Branch
  `feat/mobile-e1-e3` sets `config/prod.json` `PK_LOGIN_MODE=password`; the "Staging only" consequence above no
  longer holds for the APK config.
- **Prerequisite (E10, infra):** Direct Access Grants on client `proyekkas-mobile` in realm `drms`, no OTP
  required action for APK users. Until then a prod APK answers "Login langsung belum diaktifkan di server".
- The RFC 9700 / RFC 8252 deviation now applies to production too; the mitigations above (TLS only, no
  credential storage, brute-force lockout, refresh-token rotation) stay mandatory. Rollback unchanged (build with
  `PK_LOGIN_MODE=browser`, turn Direct Access Grants off in realm `drms`).
