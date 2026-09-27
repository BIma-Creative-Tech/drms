# ProyekKas — Android app (Flutter)

Flutter **3.47.5** / Dart 3.13.4, Android minSdk 24 / target 36, package `id.co.drms.proyekkas`
(ADR 0010). Feature-first layout under `lib/features/<feature>/{domain,data,application,presentation}`;
Riverpod, go_router, drift + SQLite3MultipleCiphers (encrypted DB), dio, flutter_appauth (Keycloak PKCE;
staging uses the in-app password login instead, see below).
All UI text is Bahasa Indonesia (`lib/l10n/app_id.arb`).

## Build flavors

| Flavor | Config | API / Keycloak realm |
|---|---|---|
| `staging` | `config/staging.json` | `https://drms-kas.staging.bimacreative.tech`, realm `drms-staging` |
| `prod` | `config/prod.json` | `https://drms-kas.bimacreative.tech`, realm `drms` |

```sh
flutter pub get --enforce-lockfile
dart run build_runner build --delete-conflicting-outputs   # drift / freezed (generated files are committed)
flutter analyze && flutter test
flutter build apk --debug --flavor staging --dart-define-from-file=config/staging.json \
  --dart-define=PK_OIDC_REDIRECT_URI=id.co.drms.proyekkas:/oauth2redirect
```

The config files hold URLs and the public client id only. Nothing in them is secret.
Push is off (`PK_PUSH_ENABLED=false`, no `google-services.json`) until the Firebase project exists (Q-44).
Until then the home screen bell polls `GET /api/v1/notifications` (every 2 minutes while shown). What FCM needs:
`docs/proyekkas/f4/f4-gap-analysis.md` §4.

## Device security (F4b)

- **Remote revoke:** a `401` with `code: DEVICE_REVOKED` ends the session at once (no token refresh), gives the
  install a new id and shows "Perangkat ini sudah dicabut …" on the login screen.
- **Integrity signals** (ADR 0010 decision 10): `MainActivity.kt` channel `id.co.drms.proyekkas/integrity` reports
  root (su/Magisk files, `test-keys`), emulator, developer options and ADB. They are sent in
  `POST /devices/register` at every start/login, recorded on the server and **never block** (Q-43). Mock location is
  checked per GPS fix (`Position.isMocked`) at attendance. Both the phone and the server refuse a fake location.

## Online state, logout, start-up (phone fixes, ADR 0010 "Phone test fixes")

- **Online** = the server answered the last request (any HTTP status). No answer → red banner "Offline …" and a
  `GET /api/v1/health` probe every 3–60 s until the server answers; tap the banner to check at once. Mobile data,
  Wi-Fi, VPN and "other" all count as a network; a wrong "none" from Android no longer sticks.
- **Logout** always returns to the login screen: device revoke + Keycloak logout get at most 5 s together, then the
  local session is cleared even offline. Unsent data is **kept** (encrypted, locked to the same user); the dialog warns
  and asks "Tetap keluar".
- **Start-up**: home is shown from the cached profile at once; device registration, `/me`, `/app/config`, masters and
  notifications load in the background. `flutter run` (debug) prints `[pk.startup] +… ms` marks.

## Attendance (F4 slice)

`/attendance` (home button "Absensi"; check-in enabled when `/app/config` `features.syncAttendance` is true = company
setting "Absensi dari APK"): pick an assigned project or cost center, tap Absen masuk/pulang → GPS fix (geolocator 14.0.3, while-in-use
permission only) → the phone checks the radius and refuses mock locations → front-camera selfie (no gallery)
compressed to 720 px / ≤ 150 KB → queued in the encrypted outbox → `POST /media/selfies` + `attendance.check_*`
sync item. Works offline; the server decides and stamps the time (ADR 0010 decisions 7/8).

## Attendance E6 & progress reports E4 (S2)

- **Absensi** (`/attendance`, tabs by role): *Absen* at an assigned project **or** cost center ("pusat biaya", masters
  `cost-centers` lat/lng/radiusM) with a distance card (distance vs radius + GPS allowance ≤ 50 m); *Rekap* = own month
  (`GET /attendance/me`, calendar + totals); *Tim* = `GET /attendance/team-today` for PM/Direktur/Finance/Admin.
  PM **on-behalf** (`attendance.on_behalf`: employee from cached `team-assignments`, reason, front/back camera, queued
  offline) and **corrections** (`POST /attendance/{id}/correct`, online, reason). Check-in and on-behalf follow
  `features.syncAttendance`; recap/team/corrections are online reads and work with the flag off.
- **Laporan progress** (`/progress`, PM/Direktur create, Finance reads): project/stage picker (stages from
  `GET /projects/{id}/stages`, offline from cached `project-stages`), stage % never below the current %, ≤ 5 rear-camera
  photos (1600 px / ≤ 400 KB JPEG, EXIF dropped, encrypted in `media_blobs` kind `progress`), edit ≤ 24 h with reason,
  conflict screen (server version vs phone version). With `features.syncProgressReports` the report goes through the
  queue (`progress_report.draft_upsert`, table `local_progress_reports`, drift schema v2); without it the app posts
  online (`POST/PATCH /progress-reports`, Idempotency-Key). K-09 cards: `GET /projects/progress`.
- **Addendum RAB** (E5, `/addenda`): PM creates/submits for a team project; Direktur ("Setujui") and Finance
  (approval) decide from the **Persetujuan** inbox section (`GET /budget-addenda/inbox`) or the detail, whose buttons
  follow `allowedActions`. All writes online with an Idempotency-Key (server rate limit 30/min); the server uses the
  profile signature.

## APK secret scan

`tool/apk_secret_scan.sh <apk>…` (python3 + docker) unpacks the APK, dumps strings from dex / `libapp.so`, fails on
signing material or `google-services.json` inside the APK, on server secret names, and on gitleaks/trivy findings.
CI runs it on every APK it builds. Allow-listed false positives live in `tool/apk-gitleaks.toml`, each with a reason.

## Login mode (`PK_LOGIN_MODE`, ADR 0012)

| Value | Flow | Used by |
|---|---|---|
| `browser` (default of the code) | Authorization Code + PKCE in a Custom Tab (flutter_appauth, ADR 0003) | rollback only |
| `password` | In-app form, Keycloak Direct Access Grant (`grant_type=password`) to `<issuer>/protocol/openid-connect/token`; logout = `POST <issuer>/protocol/openid-connect/logout` with `client_id` + `refresh_token` | `config/staging.json`, `config/prod.json` (user decision K3 / GATE G1-3, 2026-09-26: prod login = staging) |

**Prod prerequisite:** Direct Access Grants must be enabled on client `proyekkas-mobile` in realm `drms` (E10)
before a prod APK is handed out; until then the prod APK shows "Login langsung belum diaktifkan di server".

`password` needs **Direct Access Grants** enabled on Keycloak client `proyekkas-mobile` (otherwise the app shows
"Login langsung belum diaktifkan di server"). Users with a pending required action (e.g. a temporary password)
cannot log in this way and must set their password on the web first. Rollback: build with
`--dart-define=PK_LOGIN_MODE=browser` and turn Direct Access Grants off again. Token refresh is the same plain
`refresh_token` grant in both modes (`TokenManager`).

## OIDC redirect: App Link vs. fallback scheme (browser mode)

- **App Link** `https://<host>/app/callback` is the default (ADR 0003/0010). Android only verifies it when the
  APK is signed with a key whose SHA-256 is listed in the server's `/.well-known/assetlinks.json` (env
  `ANDROID_APP_CERT_SHA256`). The server has **no** page at `/app/callback`. With an unverified link the browser
  opens that URL and the user is left on it. The login screen then says to close the browser and try again.
- **Fallback** `id.co.drms.proyekkas:/oauth2redirect` (private-use scheme, lowercase) is used for builds without
  the stable key, e.g. the CI debug APK (`--dart-define=PK_OIDC_REDIRECT_URI=…`). Keycloak client
  `proyekkas-mobile` must allow this redirect URI.

## Background sync (WorkManager, E3-b)

`workmanager` 0.10.10 (ADR 0010 decision 12). While a user is signed in, a **periodic task** (every 15 min — the
Android minimum; the OS may delay it under Doze/battery saver) and, when a foreground run leaves items behind or
the phone is offline, a **one-off task** (both with "network connected") send the encrypted outbox even when the
app is closed. `lib/features/sync/background/background_sync.dart`:

- the task runs in a separate Flutter engine/isolate: it opens the encrypted DB (same key from the Keystore-backed
  secure storage), reads the refresh token and uses the normal `SyncEngine` (`/media/*` + `/sync/batch`);
- refresh tokens rotate, so only one isolate may refresh at a time: when the app's UI isolate is alive in the
  process (port `pk.sync.foreground`), the task only asks it to sync; while a task works (port
  `pk.sync.background`) the app's token refresh waits (≤ 30 s, stale ports are detected by a ping);
- signed out → the task does nothing (the queue stays locked to its user); logout cancels the tasks;
- no foreground service, no expedited work: the FOREGROUND_SERVICE* / POST_NOTIFICATIONS permissions merged in
  by `workmanager_android` are removed in `AndroidManifest.xml` (POST_NOTIFICATIONS returns with FCM, E8).

Check on a phone: `f4/f4-e2e-scenario.md` section O (app closed, back online, draft on the server ≤ 15 min).

## Staging signing key (stable, for App Link verification)

Generate the key once, offline, on a trusted machine. Never commit it.

```sh
keytool -genkeypair -v -storetype PKCS12 -keystore proyekkas-staging.jks \
  -alias proyekkas-staging -keyalg RSA -keysize 4096 -validity 9125 \
  -dname "CN=ProyekKas Staging, O=DRMS, C=ID"
# SHA-256 of the signing certificate → server env ANDROID_APP_CERT_SHA256 (staging)
keytool -list -v -keystore proyekkas-staging.jks -alias proyekkas-staging | grep 'SHA256:'
# GitHub secret ANDROID_STAGING_KEYSTORE_B64
base64 -w0 proyekkas-staging.jks
```

GitHub secrets for `.github/workflows/mobile.yml`: `ANDROID_STAGING_KEYSTORE_B64`, `ANDROID_STAGING_KEY_ALIAS`,
`ANDROID_STAGING_KEYSTORE_PASSWORD`, `ANDROID_STAGING_KEY_PASSWORD`. With PKCS12 both passwords are the same.
If the secrets are missing, CI builds only the debug APK. The production key (`ANDROID_KEYSTORE_*`) is
a separate key with two custodians (ADR 0010 decision 13). Gradle reads signing only from
`ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`
(see `android/app/build.gradle.kts`).

## Production signing key (E3-c) — custodian steps

The CI job `release-prod` (`.github/workflows/mobile.yml`) builds the **prod** flavor only on a push to `main` or
a tag `mobile-vX.Y.Z` (must equal `version:` in `pubspec.yaml`), waits for approval of the GitHub environment
`android-release-prod`, signs with the production key, verifies every APK with `apksigner verify --print-certs`,
prints the certificate SHA-256 (log + job summary), runs the APK secret scan and uploads
`proyekkas-prod-release-apk` (APKs + obfuscation symbols, 90 days). Nobody but the custodians ever holds the key
file; CI decodes it to `$RUNNER_TEMP` and deletes it in an `always()` step.

One-time setup (custodian 1 = client, custodian 2 = vendor; do it together, offline, on a trusted machine):

1. Generate the key (never on a server, never committed; the passwords go into both custodians' password
   managers):
   ```sh
   keytool -genkeypair -v -storetype PKCS12 -keystore proyekkas-prod.jks \
     -alias proyekkas-prod -keyalg RSA -keysize 4096 -validity 9125 \
     -dname "CN=ProyekKas, O=DRMS, C=ID"
   keytool -list -v -keystore proyekkas-prod.jks -alias proyekkas-prod | grep 'SHA256:'   # note it down
   ```
   An app signed with this key can only ever be updated with the same key — losing it means users must
   uninstall and reinstall. Keep **two offline backups** (e.g. two encrypted USB drives, one per custodian).
2. GitHub → repository **Settings → Environments → New environment** `android-release-prod`:
   **Required reviewers** = both custodians (or at least one who did not start the release);
   **Deployment branches and tags** = `main` and tag pattern `mobile-v*`.
3. In that environment (not as repository secrets) add: `ANDROID_KEYSTORE_B64` (`base64 -w0 proyekkas-prod.jks`),
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD` (same as the store password for PKCS12),
   `ANDROID_KEY_ALIAS` (`proyekkas-prod`). Then delete the base64 text from the clipboard/shell history.
4. Record the SHA-256 in the prod server env `ANDROID_APP_CERT_SHA256` (App Links) and, when push is enabled
   (ADR 0011, E8), in the Firebase Android app. The CI summary of every release shows the same value.
5. Release: bump `version:` in `pubspec.yaml`, merge to `main`, tag `mobile-vX.Y.Z`, approve the job, download
   the artifact, `apksigner verify --print-certs` locally if desired, distribute the `arm64-v8a` APK.
