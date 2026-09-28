# ADR 0017 — Optional self-service 2FA (TOTP), web and APK

- **Status:** accepted (user decision 2026-09-28)
- **Date:** 2026-09-28
- **Author:** nextjs + flutter developer (branch `feat/2fa-self-service`, based on `develop` `47e2853`)
- **Related:** ADR 0003 (Keycloak realm `drms`, web Authorization Code + PKCE, Admin API service account),
  ADR 0006 (audit), ADR 0012 (APK password login = Direct Access Grant), ADR 0014/0015 (visual system);
  `../security/asvs-l1-checklist.md` 4.3.1 / G-01; `../plans/fase1-golive.md` G1-3.
- **Revises:** ADR 0012 (the APK *can* log in users who have 2FA), ASVS gap G-01 (decided, not "open").

## Decision (user, 2026-09-28)

1. 2FA (TOTP, authenticator app) is **optional**. **Each user decides for their own account**, enables it and
   disables it themselves. Nobody is forced; admins do not enforce it; there is no role-based requirement.
2. **Web:** page **"Keamanan akun"** (`/admin/keamanan-akun`, avatar menu next to "Profil & tanda tangan") shows
   *2FA aktif / nonaktif / status tidak diketahui* with the registered authenticator(s) (label + date), a button
   **Aktifkan 2FA** and, per authenticator, **Nonaktifkan 2FA** with a confirmation step. Bahasa Indonesia.
3. **APK (password mode, ADR 0012):** the form stays email + password. After a failed login
   (`invalid_grant`) the field **"Kode autentikator (bila 2FA aktif)"** appears (6 digits, numeric keyboard,
   one-time-code autofill); the retry sends the code as form parameter `totp`. Empty field → no `totp` parameter.
   The code is never logged or stored. Users without 2FA see no change until a login fails.

## How it works

### Keycloak (no realm change needed — verify live, see "Infra requests")

Realm exports `drms` / `drms-staging` (read 2026-09-28) = Keycloak 26 defaults: browser flow sub-flow
"Browser - Conditional 2FA" (`conditional-user-configured` → `auth-otp-form`), direct grant sub-flow
"Direct Grant - Conditional OTP" (`conditional-user-configured` → `direct-grant-validate-otp`); required actions
`CONFIGURE_TOTP` and `delete_credential` enabled, not default. So the second factor is asked **only** from users
who configured one — exactly "optional per user". OTP policy: TOTP HmacSHA1, 6 digits, 30 s, look-ahead 1,
code not reusable.

### Enable (web)

`POST /auth/account-action` (form `action=enable`) → 303 to the Keycloak authorization endpoint with
`kc_action=CONFIGURE_TOTP`, `prompt=login`, `login_hint=<email>`, PKCE S256, `state`, `nonce`, `redirect_uri` =
the already registered `/auth/callback`. Keycloak asks for the password again, shows the QR code (or the manual
key), the user confirms with a first code and names the device → back to `/auth/callback` with
`kc_action_status=success|cancelled|error`.

### Disable (web) — chosen option and why

`POST /auth/account-action` (`action=disable`, `credentialId`) → the server lists the caller's OWN OTP
credentials via the Admin API and accepts the id only if it is one of them → 303 to Keycloak with
`kc_action=delete_credential:<id>` + `prompt=login`. Keycloak re-authenticates the user with **password AND the
current code** (the conditional 2FA sub-flow), shows its own confirmation page (`delete-credential.ftl`), deletes,
and returns with `kc_action_status`.

Chosen over "app endpoint + Admin API `DELETE /users/{id}/credentials/{cid}`" because:

- the proof of possession of the factor is made **at Keycloak** (password + OTP), not reimplemented in the app;
  a hijacked web session alone cannot remove the factor (it cannot pass `prompt=login`);
- Keycloak itself re-checks that the credential belongs to the authenticated user (a foreign/unknown id →
  `kc_action_status=error`, verified live), in addition to the app's own check;
- the service account needs **no new write privilege** for 2FA (it only lists credential metadata);
- one mechanism (AIA) for both directions; Keycloak events (`UPDATE_CREDENTIAL` /
  `REMOVE_CREDENTIAL`, legacy `UPDATE_TOTP` / `REMOVE_TOTP`) record it on the IdP side.

`prompt=login` is used for enable too (Keycloak's own `max_auth_age` for these actions is 300 s; forcing a fresh
login makes the rule simple: every 2FA change = fresh re-authentication). Verified live: `prompt=login` keeps the
same Keycloak SSO session (`sid` unchanged).

### Return leg — `/auth/callback` without a second login

The AIA transaction lives in its **own** encrypted cookie `__Host-pk_aia_tx` (A256GCM, key derived from
`PAYLOAD_SECRET` with its own label, 10 min, HttpOnly, SameSite=Lax), bound to: user id, Keycloak subject, the
hash of the web session id, PKCE verifier, state, nonce, action (+ credential id), and the OTP credential ids
before the action. `/auth/callback` first calls `handleAccountActionCallback`: only when that cookie exists
**and** `state` matches does it take over; otherwise the normal login callback runs unchanged. It then

1. requires the SAME web session and user that started the action (else `forbidden`);
2. exchanges the code (PKCE + state + nonce checked by openid-client) and requires ID-token `sub` = the user's
   Keycloak subject (a different person logged in at Keycloak in the same browser → `error`, nothing recorded);
3. **verifies the outcome via the Admin API** (enable: a new OTP credential id appeared; disable: the id is gone) —
   `kc_action_status` alone is not trusted; when the Admin API is unreachable, `kc_action_status=success` is
   accepted and the audit row says `verifiedByAdminApi: false`;
4. writes audit `2fa_enabled` / `2fa_disabled` (`doc_type=user`, `doc_id=<user id>`, `field=two_factor`,
   `new_value` = authenticator label / remaining count — never a secret or code), refreshes the web session's
   `id_token` hint (logout), and redirects to `/admin/keamanan-akun?status=…`.

No new web session, no `login` audit row, no role sync happen on this path.

### Status

`listUserCredentials(kcUserId)` (Admin API `GET /admin/realms/{realm}/users/{id}/credentials`, needs
`view-users`; the service account has `view-users` + `manage-users`) — filtered to `type=otp` and reduced to
`id`, `userLabel`, `createdDate` (never `credentialData`/`secretData`). Unreachable or not configured → the page
shows "Status tidak diketahui"; enabling stays possible, disabling does not (no verified ownership).

### APK (Direct Access Grant)

Keycloak 26.7.4 (`ValidateOTP`, verified live): missing, wrong or reused code **and** wrong password all answer
`400 {"error":"invalid_grant","error_description":"Invalid user credentials"}` — the app cannot know whether a code
was needed. Hence the UX: after an `invalidCredentials` failure the optional code field appears; the message then
reads "Email/username, kata sandi, atau kode autentikator salah" and mentions that repeated failures can lock the
account temporarily. The code field is cleared after every attempt (single-use codes). Keycloak reads the form
parameter `otp` first, then `totp`; the APK sends `totp`.

## Security

- **CSRF:** start = POST only, `Origin` must be the app origin and `Sec-Fetch-Site`, when sent, `same-origin`;
  return leg bound to state + own cookie + web session hash + subject.
- **Only the own account:** the user comes from the web session cookie (a bearer token is not accepted on this
  route); the credential id to delete must be in the caller's own Admin API list; Keycloak re-checks.
- **Rate limit:** 6 starts / 10 min / user (in-process token bucket, like other auth limits); Keycloak
  brute-force detection covers the re-authentication and the APK.
- **Re-authentication** for every change (`prompt=login`, password + current code when 2FA is active).
- **No secrets in the app:** TOTP secret and codes stay in Keycloak / the APK text field; nothing is logged.
- **Recovery (lost phone):** Admin removes the OTP credential in the Keycloak admin console (Users → user →
  Credentials → Delete) after verifying the person out of band; the user can then log in with the password and
  re-enrol. Recovery codes (`CONFIGURE_RECOVERY_AUTHN_CODES`) stay disabled in the flows (not decided).
- Accounts bootstrapped with the `CONFIGURE_TOTP` required action (ADR 0003 bootstrap) keep 2FA until the user
  turns it off; that is their choice now.

## Infra requests (not changed by this branch)

1. **Verify live** in realms `drms` and `drms-staging` (exports may be stale): browser flow = "Browser -
   Conditional 2FA" with `auth-otp-form` ALTERNATIVE under `conditional-user-configured`; direct grant flow =
   "Direct Grant - Conditional OTP" CONDITIONAL; required actions `CONFIGURE_TOTP` and `delete_credential`
   **enabled** (not default); no realm-wide OTP enforcement; OTP policy as above; `bruteForceProtected=true`.
2. Client `proyekkas-web`: no new redirect URI needed (`https://<host>/auth/callback` is reused). Check that
   `prompt=login` and `kc_action` are not stripped by Traefik/WAF on `…/protocol/openid-connect/auth`.
3. Service account `proyekkas-admin-api`: `realm-management` **`view-users`** must stay mapped (role + scope
   mapping, `fullScopeAllowed=false`); the admin router must allow `GET /admin/realms/<realm>/users/<id>/credentials`.
   Without it the page shows "Status tidak diketahui" and disabling is refused.
4. Optional: Keycloak events `UPDATE_CREDENTIAL`, `REMOVE_CREDENTIAL` (legacy `UPDATE_TOTP`, `REMOVE_TOTP`) in
   the saved event types.

## Verification

- Unit: `apps/web/tests/unit/two-factor.test.ts` (Admin API path, metadata-only filtering). Mobile unit + widget
  tests (`password_login_test.dart`, `login_password_test.dart`).
- Integration (throwaway Postgres, Keycloak mocked): `apps/web/tests/integration/two-factor.int.test.ts`.
- Real throwaway Keycloak 26.7.4 (`apps/web/tests/kc/two-factor.kc.test.ts`, realm from `test-env/kc-setup.sh` =
  default flows): AIA enable (cancel + success), Admin API listing, direct grant with/without/wrong/reused code,
  AIA delete with `prompt=login` (password + code + confirmation page), foreign id → error.

## Rollback

Remove the avatar-menu link / route (users who enabled 2FA keep it — Keycloak still asks for the code; the APK
field stays needed). To switch 2FA off for everyone: delete the OTP credentials in Keycloak (admin console).
The migration only adds two audit enum values.
