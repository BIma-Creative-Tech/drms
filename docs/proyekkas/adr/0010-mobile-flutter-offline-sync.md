# ADR 0010 — Android app: Flutter stack, offline queue & sync contract

- **Status:** accepted (user, GATE F0 2026-09-23) 
- **Date:** 2026-09-23
- **Author:** Analyst (mobile & integration), Phase 0
- **Related:** `docs/proyekkas/f0-brief.md` §2–§3; requirements v1.1 (US-01, US-02, US-03, US-07, US-10, US-26,
  US-36…US-44, §8 audit log, §9 NFR incl. photo resize targets); `/opt/infra/CLAUDE.md` §0.10 (licences,
  maintenance < 6 months), §3.6, §3.7; ADR 0011 (push); auth/storage/API ADRs 0001–0008 (parallel agent).
  Client questions referenced: Q-15, Q-16, Q-29, Q-33, Q-34; new questions at the end (QM-1…QM-4 → merged as Q-39…Q-43 in open-questions-client.md).

## Context

Field staff (Staff, PM) and Owner (quick approval) use an **Android-only** app (Q-29 proposal: Android only).
Connectivity on sites between Banjarmasin and Palangka Raya is unreliable; attendance and draft expense requests
(with receipt photos) must work offline (US-02, §9). All authoritative timestamps come from the server; device
time is kept only as a comparison value. Server-side guards are authoritative (brief §3 "never trust UI").

### Facts verified this session

**Flutter** — `https://storage.googleapis.com/flutter_infra_release/releases/releases_linux.json` (fetched
2026-09-23): current stable **3.47.5** (released 2026-09-18, Dart **3.13.4**, commit `6a19cca56475`), archive
`stable/linux/flutter_linux_3.47.5-stable.tar.xz`, sha256
`2132e990f236f8d22e7c6314b29a191a95b10d7cbcfec9b4e2e303d996652cbb`.
Android defaults at tag 3.47.5 (`packages/flutter_tools/gradle/src/main/kotlin/FlutterExtension.kt`,
`packages/flutter_tools/lib/src/android/gradle_utils.dart`): `minSdkVersion = 24`, `compileSdkVersion = 36`,
`targetSdkVersion = 36`, `ndkVersion = "28.2.13676358"`.

**Packages** — every row fetched from `https://pub.dev/api/packages/<name>` + `/score` + `/publisher` on
2026-09-23 (version = latest stable; "Pub pts" = granted/max; "DL30" = downloads last 30 days).

| Purpose | Package | Version | Licence | Published | Publisher | Likes / Pub pts / DL30 | Decision |
|---|---|---|---|---|---|---|---|
| State management | `flutter_riverpod` (+ `riverpod`) | 3.4.3 | MIT | 2026-09-03 | dash-overflow.net | 2 909 / 140 / 3.2 M | **Use** |
| State (alt.) | `flutter_bloc` | 9.1.1 | MIT | 2025-05-02 | bloclibrary.dev | 8 077 / 160 / 1.9 M | Rejected: last publish > 6 months (§0.10) |
| Routing | `go_router` | 18.0.1 | BSD-3-Clause | 2026-09-02 | flutter.dev | 5 784 / 150 / 4.2 M | **Use** |
| OIDC + PKCE | `flutter_appauth` | 12.1.0 | BSD-3-Clause | 2026-08-29 | dexterx.dev | 431 / 160 / 368 k | **Use** (AppAuth; README: PKCE, `endSession`, manifest placeholder `appAuthRedirectScheme`) |
| Secure storage | `flutter_secure_storage` | 11.2.0 | BSD-3-Clause | 2026-09-16 | steenbakker.dev | 4 490 / 160 / 4.4 M | **Use** (README: v10+ custom ciphers, Jetpack `encryptedSharedPreferences` deprecated; disable Android auto-backup) |
| Local DB | `drift` | 2.35.0 | MIT | 2026-09-09 | simonbinder.eu | 2 470 / 160 / 1.3 M | **Use** |
| Local DB (Flutter glue) | `drift_flutter` | 0.3.1 | MIT | 2026-07-11 | simonbinder.eu | 68 / 160 / 431 k | **Use** |
| SQLite binding | `sqlite3` | 3.6.0 | MIT | 2026-09-13 | simonbinder.eu | 464 / 150 / 2.5 M | **Use**, with hook `source: sqlite3mc` (below) |
| DB codegen | `drift_dev`, `build_runner` | 2.35.0 / 2.16.1 | MIT / BSD-3 | 2026-09-09 / 2026-09-02 | simonbinder.eu / tools.dart.dev | — | dev only |
| Encrypted DB (old way) | `sqlcipher_flutter_libs` | 0.7.0+eol | MIT/BSD | 2026-02-15 | simonbinder.eu | — | Rejected: **EOL**, "no longer does anything" (README) |
| Encrypted DB (alt.) | `sqflite_sqlcipher` | 3.4.1 | MIT | 2026-08-04 | *(no verified publisher)* | 165 / 150 / 85 k | Rejected: unverified publisher, smaller user base, no typed queries |
| Local DB (alt.) | `isar` | 3.1.0+1 | Apache-2.0 | **2023-04-25** | isar.dev | — | Rejected: unmaintained, Dart SDK `<3.0.0` |
| Local DB (alt.) | `isar_community` | 3.3.2 | Apache-2.0 | 2026-03-23 | isar-community.dev | 161 / 140 / 98 k | Rejected: fork, no built-in encryption documented, fewer users |
| HTTP | `dio` | 5.11.1 | MIT | 2026-09-04 | flutter.cn | 8 351 / 160 / 4.4 M | **Use** (interceptors: auth refresh, retry, request id) |
| HTTP (alt.) | `http` | 1.6.0 | BSD-3-Clause | 2025-11-10 | dart.dev | — | Not chosen (no interceptors; > 6 months since publish) |
| Camera (selfie, receipts) | `camera` | 0.12.1 | BSD-3-Clause | 2026-09-03 | flutter.dev | 2 599 / 160 / 640 k | **Use**; select `CameraLensDirection.front` (enum verified in `camera_platform_interface/lib/src/types/camera_description.dart`) |
| Gallery picker | `image_picker` | 1.2.3 | Apache-2.0/BSD-3 | 2026-06-30 | flutter.dev | — | **Not included** for selfies (no gallery path in the binary for attendance). For receipts see QM-2. |
| On-device compression | `flutter_image_compress` | 2.5.1 | MIT | 2026-07-25 | fluttercandies.com | 1 822 / 150 / 1.05 M | **Use**; `keepExif` defaults to `false` (README) → EXIF/GPS stripped |
| Pure-Dart image fallback | `image` | 4.10.1 | MIT | 2026-09-13 | loki3d.com | 1 756 / 160 / 7.2 M | Fallback only (slow on device) |
| Location | `geolocator` | 14.0.3 | MIT | 2026-06-12 | baseflow.com | 6 128 / 160 / 2.3 M | **Use**: `getCurrentPosition`, `distanceBetween`, `Position.isMocked` (verified in `geolocator/lib/geolocator.dart` L47/119/249 and `geolocator_platform_interface/lib/src/models/position.dart`: "true on Android … when the location came from the mocked provider") |
| Root / mock / emulator | `safe_device` | 1.4.1 | MIT | 2026-07-07 | ufuksahin.dev | 383 / 140 / 151 k | **Use** as a *signal* (`isJailBroken`, `isMockLocation`, `isRealDevice`, `rootDetectionDetails` — README) |
| RASP (alt.) | `freerasp` | 8.2.2 | MIT (open part) | 2026-08-26 | talsec.app | 612 / 160 / 48 k | Rejected: README "SDK … consists of open-source and **binary parts, which is the property of Talsec**", fair-usage policy → not fully open source (§0.10) |
| Root (alt.) | `flutter_jailbreak_detection` | 1.10.0 | BSD-3 | **2023-01-11** | appmire.be | — | Rejected: unmaintained |
| Mock (alt.) | `trust_location` | 2.0.13 | BSD-3 | **2021-05-23** | — | — | Rejected: unmaintained, Dart `<3.0.0` |
| Root (alt.) | `jailbreak_root_detection` | 1.2.3 | **unknown** | 2026-08-15 | — | — | Rejected: licence unknown on pub.dev |
| Root (alt.) | `root_checker_plus` | 1.1.1 | MIT | 2026-09-12 | *(none)* | 23 / 150 / 25 k | Rejected: unverified publisher, low adoption |
| Mock (alt.) | `detect_fake_location` | 2.3.2 | BSD-3 | 2026-01-25 | zeexan.com | 41 / 140 / 3 k | Rejected: low adoption; geolocator already exposes `isMocked` |
| Background work | `workmanager` | 0.10.10 | MIT | 2026-09-07 | fluttercommunity.dev | 2 420 / 140 / 267 k | **Use** (one-off task with network constraint) |
| Background (alt.) | `background_fetch` | 1.7.0 | MIT | 2026-05-25 | transistorsoft.com | — | Not chosen (periodic-fetch model; workmanager suffices) |
| Connectivity | `connectivity_plus` | 7.3.1 | BSD-3-Clause | 2026-07-23 | fluttercommunity.dev | 4 095 / 160 / 3.5 M | **Use** (trigger only; real check = API call) |
| Signature pad | `signature` | 6.4.0 | MIT | 2026-07-28 | 4q.eu | 663 / 160 / 283 k | **Use** (export PNG) |
| Signature (alt.) | `syncfusion_flutter_signaturepad` | 34.2.9 | **unknown** (Syncfusion licence) | 2026-09-22 | syncfusion.com | — | Rejected: not OSI licence |
| Signature (alt.) | `hand_signature` | 3.1.0+2 | MIT | 2025-07-06 | basecontrol.dev | — | Rejected: > 6 months |
| Push | `firebase_core`, `firebase_messaging` | 4.15.0 / 16.7.0 | BSD-3-Clause | 2026-09-14 | firebase.google.com | 4 076 / 3 948 likes | **Use** — see ADR 0011 |
| Foreground notif. | `flutter_local_notifications` | 22.3.1 | BSD-3-Clause | 2026-09-13 | dexterx.dev | 7 347 / 150 / 2.8 M | **Use** (show FCM data messages while app in foreground) |
| PDF view | `pdfx` | 2.11.0 | MIT | 2026-08-20 | serge.software | 528 / 160 / 394 k | Candidate |
| PDF view | `pdfrx` | 2.6.5 | MIT | 2026-09-18 | espresso3389.jp | 346 / 160 / 453 k | Candidate (requires Flutter ≥ 3.47.0, Dart ^3.13.0 — compatible) |
| PDF view (alt.) | `syncfusion_flutter_pdfviewer` / `flutter_pdfview` | 34.2.9 / 1.4.5 | unknown / MIT | — | syncfusion.com / *(none)* | — | Rejected: licence / unverified publisher |
| IDs | `uuid` | 4.6.0 | MIT | 2026-07-15 | yuli.dev | 2 733 / 160 / 14 M | **Use** (`v7()` time-ordered, README "Monotonic v7") |
| Models | `freezed`, `json_serializable` | 4.0.2 / 6.14.1 | MIT / BSD-3 | 2026-09-18 / 2026-07-30 | dash-overflow.net / google.dev | — | **Use** (codegen) |
| Permissions | `permission_handler` | 13.0.2 | MIT | 2026-09-04 | baseflow.com | 6 014 / 160 / 3.3 M | **Use** |
| App/device info | `package_info_plus`, `device_info_plus` | 10.2.1 / 13.2.0 | BSD-3 | 2026-07-15 / 2026-06-26 | fluttercommunity.dev | — | **Use** (app version + model in audit `sumber`) |
| i18n / format | `intl` | 0.20.3 | BSD-3-Clause | 2026-06-25 | dart.dev | — | **Use** (`Rp 1.447.500`, `id_ID`) |
| Paths | `path_provider` | 2.1.6 | BSD-3-Clause | 2026-06-15 | flutter.dev | — | **Use** |
| Cert pinning | `http_certificate_pinning` | 3.0.2 | Apache-2.0 | 2026-07-21 | softarch.dev | 161 / 125 / 47 k | Not used (see decision 9) |
| Lints | `flutter_lints` | 6.0.0 | BSD-3-Clause | 2025-05-27 | flutter.dev | — | **Use** (official; > 6 months but dev-only lint set, acceptable — Lead to confirm) |
| Tests | `mocktail` | 1.0.5 | MIT | 2026-04-10 | felangel.dev | 1 244 / 160 / 3.3 M | **Use** |
| Tests (native dialogs) | `patrol` | 4.10.0 | Apache-2.0 | 2026-09-15 | leancode.co | 725 / 150 / 651 k | **Use** for E2E on emulator (permission dialogs, camera) |

**Encrypted SQLite** — `sqlite3` README + `sqlite3/doc/hook.md` (GitHub `simolus3/sqlite3.dart`, main) and
`https://drift.simonbinder.eu/platforms/encryption/`: from drift 2.32.0 encryption uses
**SQLite3MultipleCiphers** selected through Dart build hooks in `pubspec.yaml`
(`hooks: user_defines: sqlite3: source: sqlite3mc`); binaries are downloaded from the package's GitHub release and
checked against sha256 references published with the package; key applied with `pragma key`. SQLite3MultipleCiphers
licence = MIT (GitHub API `utelle/SQLite3MultipleCiphers`, last push 2026-09-22). `drift_flutter 0.3.1` still
depends on the EOL shims `sqlite3_flutter_libs ^0.6.0+eol` / `sqlcipher_flutter_libs ^0.7.0+eol`, which are
documented no-ops — harmless.

**Android platform** — developer.android.com "Network security configuration": apps targeting API 28+ default to
`cleartextTrafficPermitted="false"` and trust only `system` CAs (user CAs trusted only for targets ≤ 23); pinning
via `<pin-set expiration=…>` with backup pins. Geofencing guide recommends a **minimum radius of 100 m** for OS
geofences. WorkManager `PeriodicWorkRequest.MIN_PERIODIC_INTERVAL_MILLIS` exists (value not shown on the page —
**UNVERIFIED**, commonly 15 min).

**Keycloak 26.7.4** (GitHub source at tag): client attribute `pkce.code.challenge.method`
(`server-spi-private/.../OIDCConfigAttributes.java` L64), `client.offline.session.idle.timeout` /
`client.offline.session.max.lifespan` (L62–63), `dpop.bound.access.tokens` (L49); scope `offline_access`
(`core/.../OAuth2Constants.java` L95). Realm/client configuration itself belongs to the auth ADR.

**Flutter Android release docs** (`docs.flutter.dev/deployment/android`): `android/key.properties` with
`storePassword`, `keyPassword`, `keyAlias`, `storeFile` (not committed); `flutter build apk --split-per-abi`;
`--build-name` → `versionName`, `--build-number` → `versionCode`. CI actions (GitHub API): `actions/checkout`
v7.0.1, `actions/setup-java` v6.0.1 (2026-09-09), `actions/upload-artifact` v7.0.1, `subosito/flutter-action`
v2.23.0 (MIT, last push 2026-04-30).

## Decision

1. **Toolchain:** Flutter **3.47.5** stable / Dart 3.13.4 pinned (CI downloads the official tarball and verifies the
   sha256 above; `subosito/flutter-action` allowed only pinned by commit SHA). Android `minSdk 24` (Flutter default;
   raise only if a plugin requires it — verified at F4 by the Gradle manifest merge), `targetSdk`/`compileSdk 36`.
   Package id proposal `id.co.drms.proyekkas` (**client to confirm domain**). Android only (no iOS build in scope).
2. **Architecture:** feature-first folders (`auth`, `attendance`, `expense`, `receipts`, `approvals`, `progress`,
   `sync`, `notifications`, `settings`); layers *presentation (widgets) → application (Riverpod notifiers) →
   domain (freezed models, pure Dart) → data (dio API client, drift DAOs)*. `go_router` with a redirect guard on
   auth state and role (Staff / PM / Owner / Finance read-only). Bottom navigation, large action buttons (v1.0 #12).
   All strings Bahasa Indonesia in ARB files; money `intl` `id_ID` → `Rp 1.447.500`; display TZ from
   `company-settings` (default `Asia/Makassar`), server sends UTC ISO-8601.
3. **Auth:** Keycloak realm `drms`, public client `proyekkas-mobile` (ADR 0003, no secret in APK), Authorization
   Code + **PKCE S256** via `flutter_appauth`. **Redirect:** ADR 0003 prefers a claimed HTTPS App Link
   (`https://<pk-host>/app/callback`) over a custom scheme. `flutter_appauth` README allows replacing the
   `appAuthRedirectScheme` placeholder by a manual `intent-filter` on `net.openid.appauth.RedirectUriReceiverActivity`
   (scheme + host) → an `https` filter with `android:autoVerify="true"` + `/.well-known/assetlinks.json` on the
   ProyekKas host is the chosen target; that this works end-to-end with AppAuth/Chrome Custom Tabs is
   **UNVERIFIED** → F4 spike, fallback = private-use reverse-domain scheme (lowercase, per README) e.g.
   `id.co.drms.proyekkas:/oauth2redirect`. Scope `openid offline_access` (ADR 0003); Keycloak **Revoke Refresh
   Token = on** (ADR 0003) ⇒ refresh tokens rotate: the app must persist the new refresh token atomically before
   using the new access token, and serialise refreshes (single-flight dio interceptor). Refresh token stored in
   `flutter_secure_storage`; access token kept **in memory**. Every `/api/v1` call sends `X-Device-Id`
   (`devices` registry and `POST /api/v1/devices/register` are defined in ADR 0003 §5).
   Logout = `endSession` + server-side revocation; remote logout = Keycloak session revocation (auth ADR) → next
   refresh fails → app wipes tokens, keeps the encrypted offline queue but locks it until the **same** user logs in
   again (queue rows carry `user_sub`). Android `allowBackup=false` (secure-storage README warning).
4. **Encrypted offline store:** drift + `sqlite3` with `source: sqlite3mc`. A random 256-bit DB key is generated on
   first run and stored in `flutter_secure_storage` (Android Keystore-backed). Photos waiting for upload are stored
   in app-private storage **after compression**, encrypted with a per-file AES-GCM key (**package UNVERIFIED** — F4
   must pick a maintained crypto package or store photo bytes as BLOBs inside the encrypted DB; the latter is the
   default because it needs no extra package; size budget ≤ 100 MB queue, warning at 80 %).
5. **Offline scope:**
   - **Offline allowed:** attendance check-in/out (own; PM "absen atas nama" also allowed offline, US-14), draft
     expense requests (create/edit draft header + lines), receipt photos + receipt data attached to draft lines,
     draft progress reports incl. ≤ 5 photos (US-10; PM field work — QM-1).
   - **Online-only** (server state machine, numbering, money): submit ("Ajukan"), cancel, Diketahui/Approve/Reject
     (incl. signature), transfer, LPJ submit/verify, settlement, cash entries, void, corrections of attendance,
     profile/bank account changes, anything by Owner/Finance. The UI disables these buttons offline with the text
     "Butuh koneksi internet".
6. **Sync protocol** — see "Sync contract" below. Summary: each queued item has a client-generated **UUIDv7**
   (`client_uuid`) = idempotency key; media are uploaded first (`PUT /api/v1/sync/media/{client_uuid}`), then JSON
   items via `POST /api/v1/sync/batch`; server processes items in order, each in its own DB transaction, and returns
   a per-item result; a replayed `client_uuid` returns the stored result (`duplicate`) without re-applying.
   Reference data (assigned projects + geofences, categories, UoMs, vehicles, own bank accounts, schedule) is pulled
   with `GET /api/v1/sync/reference?since=<server_cursor>`.
7. **Time rules:** the server stamps `received_at` (authoritative, audit). Offline items carry `device_time`
   (wall clock + TZ offset), `elapsed_ms` (Android monotonic time since boot, via a ~20-line Kotlin method channel —
   no package; **UNVERIFIED** implementation detail) and `boot_id`, plus the last server time/elapsed pair recorded
   at the last successful online call. Server computes `estimated_time = last_server_time + (elapsed_ms −
   last_elapsed_ms)` when `boot_id` matches, compares with `device_time`, and sets `time_trust`
   (`server`|`estimated`|`device_only`) + flag `clock_skew` if |device − estimated| > 5 min (setting). `offline=true`
   is stored. Which time counts as "jam masuk" for payroll when offline is **QM-3** (proposal: `estimated_time`, else
   `device_time` flagged for PM review).
8. **Attendance validation on sync (server, authoritative):** recompute distance (haversine) to the project
   geofence of `project_id` **as valid at `estimated/device` time**; reject if outside radius (+ GPS accuracy
   allowance, capped) → result `rejected` code `OUTSIDE_GEOFENCE` and an audit event "percobaan di luar radius"
   (§8 T9); reject if `mock_detected=true` or Android `isMocked` → `MOCK_LOCATION`; require selfie media present
   and front-camera capture metadata; enforce one check-in per employee per project per local date and
   check-out after check-in; `offline=true`, `source=apk_offline`. Client-side geofence check only enables the
   button (US-01); it is never trusted.
9. **Certificate pinning: NOT in v1.** Certificates are Let's Encrypt via HTTP-01 on this platform (CLAUDE.md
   §3.5.1), leaf keys rotate; a stale pin bricks field devices that cannot easily update. Instead: Android Network
   Security Config with `cleartextTrafficPermitted="false"` and **system CAs only** (explicit, although it is the
   API 28+ default), HSTS at Traefik, short-lived access tokens, and DPoP-bound tokens evaluated in the auth ADR
   (Keycloak attribute `dpop.bound.access.tokens` exists). Revisit pinning of the ISRG intermediate/root with backup
   pins + `expiration` if a threat assessment requires it.
10. **Root / mock-location policy:** detection is **best effort** (root hiding tools defeat client checks; mock
    detection relies on the OS flag). Every request sends `X-Device-Integrity` (root, emulator, mock, dev-mode
    flags); the server logs them in `devices` and the audit log. Proposal: **block** attendance when mock location
    is detected (US-01 says "Mock location ditolak"); **warn + flag** on rooted devices for everything else, block
    attendance on rooted devices only if the client decides so — **QM-4**. Google Play Integrity API is out of
    scope (APK is side-loaded; **UNVERIFIED** whether it applies outside Play distribution).
11. **Camera & photos:** selfie screen opens `camera` with the front lens only; no gallery path; fail closed if no
    front camera. Receipts/progress: rear camera; gallery import for receipts is QM-2 (e.g. hotel booking
    screenshot from Traveloka in the seed form). Device output format is always **JPEG** (storage ADR 0004 accepts
    only `image/jpeg` for selfies/progress and treats HEIC as unverified). Compression on device with `flutter_image_compress` to the v1.1 §9
    targets (receipt 1600 px / q≈80 / ≤ 400 KB; selfie 720 px / q≈75 / ≤ 150 KB; progress 1600 px), EXIF not kept;
    the server re-validates MIME/size and re-encodes (storage ADR). Upload of raw files > 15 MB is impossible by
    construction.
12. **Background sync:** triggers = app start, connectivity regained (`connectivity_plus`), after each enqueue, and
    a `workmanager` one-off task with `NetworkType.connected` constraint (+ periodic safety net). Retries with
    exponential back-off (5 s → 10 min, jitter), per-item max 20 attempts, then the item shows "Gagal dikirim"
    with a manual retry and a "Laporkan" option. Items with a `4xx` business rejection are not retried.
13. **Build, signing, versioning (GitHub Actions):** workflow `android.yml`: `flutter analyze` → `dart format
    --set-exit-if-changed` → unit + widget tests → `flutter build apk --release --split-per-abi --obfuscate
    --split-debug-info=build/symbols` (flags verified in `docs.flutter.dev/deployment/obfuscate`; workmanager
    `NetworkType.connected` verified in `workmanager_platform_interface/lib/src/pigeon/workmanager_api.g.dart`)
    → upload APKs + symbols as
    artifacts (retention 90 days; symbols never published). Keystore: base64 in GitHub secret
    `ANDROID_KEYSTORE_B64`, passwords `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`, alias
    `ANDROID_KEY_ALIAS`; decoded to `$RUNNER_TEMP`, `key.properties` generated at build time, deleted in an
    `always()` step; release job only on `main`/tags with GitHub environment approval. Keystore backup: offline,
    two custodians (client + vendor). Versioning: `pubspec.yaml` `version: X.Y.Z+N`; `N` = CI run number
    (`--build-number`), tag `mobile-vX.Y.Z`; app version sent in every request (`X-App-Version`) and the server can
    enforce a minimum version (`426 UPGRADE_REQUIRED`). Distribution: side-loaded APK (MDM/Play: out of scope).
14. **Performance/capacity:** API-side cost is part of the ProyekKas container budget (architecture ADR). Batch
    limits: ≤ 50 items and ≤ 256 KB JSON per batch; media ≤ 2 MB each after device compression.

### Sync contract (`/api/v1/sync/*`)

Auth: `Authorization: Bearer <access token>` (Keycloak). Headers: `X-Device-Id` (UUID generated at install,
registered in `devices`), `X-App-Version`, `X-Device-Integrity` (compact JSON), `Idempotency-Key` = `batch_id`.
All money = integer rupiah; all timestamps ISO-8601 with offset; server responses in UTC.

**1. Media upload** — `PUT /api/v1/sync/media/{client_uuid}` (multipart: `file`, `kind` ∈ `selfie|receipt|
progress|signature`, `sha256`). Idempotent: same `client_uuid` + same sha256 → `200` with the stored id; different
sha256 → `409`. Response `{ "client_uuid": "...", "media_id": "...", "status": "stored" }`.

**2. Batch** — `POST /api/v1/sync/batch`, request JSON Schema (draft 2020-12, abbreviated):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["batch_id", "device_id", "clock", "items"],
  "properties": {
    "batch_id":  { "type": "string", "format": "uuid" },
    "device_id": { "type": "string", "format": "uuid" },
    "clock": {
      "type": "object",
      "required": ["device_time", "elapsed_ms", "boot_id"],
      "properties": {
        "device_time": { "type": "string", "format": "date-time" },
        "elapsed_ms": { "type": "integer" },
        "boot_id": { "type": "string" },
        "last_server_time": { "type": ["string", "null"], "format": "date-time" },
        "last_server_elapsed_ms": { "type": ["integer", "null"] }
      }
    },
    "items": {
      "type": "array", "minItems": 1, "maxItems": 50,
      "items": {
        "type": "object",
        "required": ["client_uuid", "type", "schema_version", "offline", "device_time", "elapsed_ms", "payload"],
        "properties": {
          "client_uuid": { "type": "string", "format": "uuid" },
          "type": { "enum": ["attendance.check_in", "attendance.check_out", "attendance.on_behalf",
                             "expense_request.draft_upsert", "expense_request.draft_delete",
                             "progress_report.draft_upsert"] },
          "schema_version": { "const": 1 },
          "offline": { "type": "boolean" },
          "device_time": { "type": "string", "format": "date-time" },
          "elapsed_ms": { "type": "integer" },
          "base_rev": { "type": ["integer", "null"] },
          "depends_on": { "type": "array", "items": { "type": "string", "format": "uuid" } },
          "payload": { "type": "object" }
        }
      }
    }
  }
}
```

Response `200` (always per-item; `4xx` only for an invalid envelope/auth, `423` during cutover freeze):

```json
{
  "type": "object",
  "required": ["batch_id", "server_time", "results"],
  "properties": {
    "batch_id": { "type": "string", "format": "uuid" },
    "server_time": { "type": "string", "format": "date-time" },
    "results": { "type": "array", "items": {
      "type": "object",
      "required": ["client_uuid", "status"],
      "properties": {
        "client_uuid": { "type": "string" },
        "status": { "enum": ["applied", "duplicate", "rejected", "conflict", "deferred"] },
        "server_id": { "type": ["string", "null"] },
        "rev": { "type": ["integer", "null"] },
        "received_at": { "type": "string", "format": "date-time" },
        "time_trust": { "enum": ["server", "estimated", "device_only"] },
        "flags": { "type": "array", "items": { "type": "string" } },
        "errors": { "type": "array", "items": { "type": "object",
          "properties": { "code": { "type": "string" }, "field": { "type": "string" },
                          "message": { "type": "string" } } } },
        "server_copy": { "type": ["object", "null"] }
      }
    } }
  }
}
```

**Per-item rules**
- `applied`: stored; `duplicate`: `client_uuid` seen before → original result replayed (no side effects);
  `rejected`: business rule failed (codes e.g. `OUTSIDE_GEOFENCE`, `MOCK_LOCATION`, `NOT_ASSIGNED`,
  `ALREADY_CHECKED_IN`, `NOT_EDITABLE`, `MEDIA_MISSING`, `VALIDATION`) — never retried, shown to the user in
  Bahasa Indonesia; `deferred`: dependency (`depends_on` / media) not yet present → retry later;
  `conflict`: `base_rev` < server `rev` for a draft edited elsewhere (web) → **server wins**, `server_copy`
  returned, client keeps its version as a local "Salinan konflik" the user can re-apply manually.
- Drafts can be edited only while `status = draft` and only by the creator ("Dibuat Oleh"); anything else →
  `rejected NOT_EDITABLE`. Deleting a draft is a soft delete (no hard delete, requirements §1.2 #6).
- Server recomputes everything derived: line totals per Q-05 rule, grand total, flags (US-47…US-50), distances.
  Client-sent totals are advisory and are compared; mismatch → flag `CLIENT_TOTAL_MISMATCH`, never trusted.
- Every applied/rejected item writes the audit log (`sumber = apk <version>`, `device_id`, lat/long, `offline`).
- Storage: each target collection gets a unique `client_uuid` column; replay results are kept in a small
  `sync-receipts` system collection (proposed addition to the brief's slug list; retention 30 days).

**Example A — offline check-in** (Staff, site without signal, synced later):

```json
{
  "batch_id": "0192f7a1-6c1e-7b3a-9d10-1f2e3a4b5c6d",
  "device_id": "5b0c2f7e-2d1a-4e0b-8f5e-7a9d3c1b2e44",
  "clock": { "device_time": "2026-09-21T12:05:10+08:00", "elapsed_ms": 86523000, "boot_id": "b-7f3e",
             "last_server_time": "2026-09-20T23:30:02Z", "last_server_elapsed_ms": 70202000 },
  "items": [{
    "client_uuid": "0192f5c8-1a2b-7c3d-8e4f-5a6b7c8d9e01",
    "type": "attendance.check_in",
    "schema_version": 1,
    "offline": true,
    "device_time": "2026-09-21T07:58:31+08:00",
    "elapsed_ms": 71711000,
    "depends_on": ["0192f5c8-1a2b-7c3d-8e4f-5a6b7c8d9e02"],
    "payload": {
      "employee_id": "emp-doni-pratama",
      "project_id": null,
      "cost_center_id": "cc-ops-palangka-banjar",
      "lat": -2.2135790, "lng": 113.9135420, "accuracy_m": 12.5,
      "is_mocked": false,
      "selfie_media_client_uuid": "0192f5c8-1a2b-7c3d-8e4f-5a6b7c8d9e02",
      "camera_lens": "front",
      "integrity": { "rooted": false, "emulator": false, "dev_mode": false }
    }
  }]
}
```

Response (estimated time = 23:30:02Z + (71 711 000 − 70 202 000) ms = 23:55:11Z = 07:55:11 WITA; device says
07:58:31 → skew 3 min 20 s, within the 5 min threshold, so no `CLOCK_SKEW` flag):

```json
{
  "batch_id": "0192f7a1-6c1e-7b3a-9d10-1f2e3a4b5c6d",
  "server_time": "2026-09-21T04:05:11Z",
  "results": [{
    "client_uuid": "0192f5c8-1a2b-7c3d-8e4f-5a6b7c8d9e01",
    "status": "applied",
    "server_id": "att-7c1d…",
    "rev": 1,
    "received_at": "2026-09-21T04:05:11Z",
    "time_trust": "estimated",
    "flags": ["OFFLINE"],
    "errors": []
  }]
}
```

(Coordinates are illustrative, not real site data. Whether attendance may target a **cost center** instead of a
project — the seed form is "Ops Palangka Banjar" — follows requirements v1.1 `team-assignments` "project atau pusat
biaya"; geofences for cost centers are **QM-1b**.)

**Example B — draft expense request with 3 lines (client form 228/PB-DRMS/20/IX/2026)**, created offline by
Citra ("Dibuat Oleh" = the authenticated user, set by the server, not sent), requesters Budi and Doni:

```json
{
  "batch_id": "0192f7b0-0000-7000-8000-000000000001",
  "device_id": "5b0c2f7e-2d1a-4e0b-8f5e-7a9d3c1b2e44",
  "clock": { "device_time": "2026-09-21T13:10:00+08:00", "elapsed_ms": 90400000, "boot_id": "b-7f3e",
             "last_server_time": "2026-09-21T04:05:11Z", "last_server_elapsed_ms": 86523500 },
  "items": [{
    "client_uuid": "0192f6d0-aaaa-7bbb-8ccc-000000000100",
    "type": "expense_request.draft_upsert",
    "schema_version": 1,
    "offline": true,
    "device_time": "2026-09-21T12:50:00+08:00",
    "elapsed_ms": 89200000,
    "base_rev": null,
    "depends_on": ["0192f6d0-aaaa-7bbb-8ccc-000000000201", "0192f6d0-aaaa-7bbb-8ccc-000000000202",
                   "0192f6d0-aaaa-7bbb-8ccc-000000000203"],
    "payload": {
      "kind": "reimburse",
      "project_id": null,
      "cost_center_id": "cc-ops-palangka-banjar",
      "title": "Pengajuan Reimburse Ops Palangka Banjar keperluan Service Tronton",
      "needed_date": "2026-09-22",
      "notes": null,
      "requester_ids": ["emp-budi", "emp-doni-pratama"],
      "bank_account_id": "eba-doni-mandiri-1234567890123",
      "client_grand_total": 1447500,
      "lines": [
        { "client_uuid": "0192f6d0-aaaa-7bbb-8ccc-000000000011", "no": 1,
          "description": "BBM Hilux Banjarmasin-Palangka", "qty": 1, "uom_id": "uom-bulan",
          "unit_price": null, "total": 600000, "category_id": "cat-bbm", "vehicle_id": "veh-DA1234XY",
          "remark": null,
          "receipts": [{ "client_uuid": "0192f6d0-aaaa-7bbb-8ccc-000000000301",
            "receipt_no": "7654321", "vendor_name": "SPBU 61234501 Pertamina",
            "receipt_time": "2026-09-21T11:42:59+08:00", "amount": 600000,
            "media_client_uuid": "0192f6d0-aaaa-7bbb-8ccc-000000000201" }] },
        { "client_uuid": "0192f6d0-aaaa-7bbb-8ccc-000000000012", "no": 2,
          "description": "Penginapan", "qty": 2, "uom_id": "uom-kamar",
          "unit_price": 339000, "total": 677000, "category_id": "cat-penginapan", "vehicle_id": null,
          "remark": null,
          "receipts": [{ "client_uuid": "0192f6d0-aaaa-7bbb-8ccc-000000000302",
            "receipt_no": "9876543210", "vendor_name": "POP! Hotel Banjarmasin (Traveloka)",
            "receipt_time": "2026-09-20T00:00:00+08:00", "amount": 676876,
            "media_client_uuid": "0192f6d0-aaaa-7bbb-8ccc-000000000202" }] },
        { "client_uuid": "0192f6d0-aaaa-7bbb-8ccc-000000000013", "no": 3,
          "description": "Makan siang", "qty": null, "uom_id": null,
          "unit_price": null, "total": 170500, "category_id": "cat-konsumsi", "vehicle_id": null,
          "remark": null,
          "receipts": [{ "client_uuid": "0192f6d0-aaaa-7bbb-8ccc-000000000303",
            "receipt_no": "TX0101.0001.000123", "vendor_name": "Soto \"Mas Joko\"",
            "receipt_time": "2026-09-21T10:47:00+08:00", "amount": 170500,
            "media_client_uuid": "0192f6d0-aaaa-7bbb-8ccc-000000000203" }] }
      ]
    }
  }]
}
```

Expected response item (flags computed by the server per requirements v1.1 US-47…US-49 with tolerance Rp 1.000
and the request date still unset because the request is a draft; date flags are evaluated at submit):

```json
{
  "client_uuid": "0192f6d0-aaaa-7bbb-8ccc-000000000100",
  "status": "applied",
  "server_id": "er-…",
  "rev": 1,
  "received_at": "2026-09-21T05:10:02Z",
  "time_trust": "estimated",
  "flags": ["OFFLINE", "LINE2_AMOUNT_DIFF_INFO:124", "LINE1_UOM_UNUSUAL:bulan", "LINE2_TOTAL_NE_QTYxPRICE:678000"],
  "errors": [],
  "server_copy": { "status": "draft", "grand_total": 1447500, "number": null }
}
```

Notes: grand total 1 447 500 assumes line totals are accepted as entered; if Q-05 is decided as "total = qty ×
unit price", line 2 becomes 678 000 and grand total 1 448 500 (requirements v1.1 US-37). The request **number**
(`228/PB-DRMS/20/IX/2026` style) is assigned only at online submit (US-45), never offline.

### Implemented server side (F4 backend, branch `feat/nextjs-f4-mobile-backend`)

Verified in `apps/web/src/api/v1/{schemas-sync.ts,endpoints/sync.ts,endpoints/app.ts}`,
`src/domain/sync/{service.ts,clock.ts}`, `src/app/.well-known/assetlinks.json/route.ts`,
`tests/integration/f4-mobile.int.test.ts`. Contract for the Dart client: `packages/api-contract/openapi.json`
(`SyncBatch`, `SyncItem`, `SyncDraftUpsertPayload`, `SyncDraftDeletePayload`, `SyncBatchResponse`, `SyncResult`,
`SyncDraftCopy`, `AppConfig`). Differences from / precisions of the contract above:
- **Media:** receipt images are uploaded first with the existing `POST /api/v1/media/receipts` (server resize,
  ADR 0004) and referenced by numeric `media_id`; `PUT /api/v1/sync/media/{client_uuid}` is **not** built.
  Missing media → `rejected MEDIA_MISSING`, another user's upload → `rejected FORBIDDEN`; the image of a synced
  receipt cannot change (remove + add online).
- **Draft payload** (snake_case like the envelope, numeric server ids): `kind`, `title` (both required for a new
  draft), `project_id` | `cost_center_id`, `needed_date`, `period_from/_to`, `notes`, `requester_ids`,
  `bank_account_id`, `client_grand_total`, `lines[]` (`id` = server line id or `client_uuid` = becomes the server
  line id; `receipts[]` per line with `client_uuid`, `receipt_no`, `vendor_name`, `receipt_date` YYYY-MM-DD,
  `receipt_time` HH:MM, `amount`, `tax_amount`, `media_id`). Target draft = `request_id` (created online) or
  `draft_client_uuid` (default: the item's own `client_uuid`). Omitted fields stay; `lines` replaces all lines;
  receipts are upserted by `client_uuid` and never removed by sync; a line that still has a receipt cannot be
  dropped (`VALIDATION`). Receipts only on Reimburse drafts (Uang Muka receipts come after transfer, online).
- **`rev`:** new column `expense_requests.sync_rev` — 1 at create, +1 on every content edit of an editable
  request (web or APK), never on transitions. Exposed as `rev` in `SyncResult`, `SyncDraftCopy` and
  `GET /expense-requests/{id}`. Edit of an existing draft needs `base_rev` = server `rev`; missing or lower →
  `conflict` + `server_copy` (code `STALE_REV`, nothing changes). Queued edits of a draft created offline predict
  `base_rev` 1, 2, … in queue order (each applied edit adds exactly 1).
- **Statuses:** `applied | duplicate (+ original_status) | rejected | conflict | deferred | unsupported`.
  `unsupported` (addition) = item type accepted by the schema but not enabled yet (attendance.*,
  progress_report.draft_upsert until F5): keep it queued, not an attempt, not stored. `deferred`:
  `DEPENDENCY_PENDING` (a `depends_on` item not yet received) or `INTERNAL` (unexpected server error).
  Error codes: `VALIDATION`, `NOT_EDITABLE`, `NOT_FOUND`, `FORBIDDEN`, `MEDIA_MISSING`, `CLIENT_UUID_CONFLICT`,
  `FEATURE_DISABLED`, `DEPENDENCY_FAILED`, `STATE_CONFLICT`, `INTEGRITY`, `STALE_REV`.
- **Authz:** bearer (`mobileBearer`) only, `device_id` = the verified `X-Device-Id`; the draft's creator only
  (a readable foreign draft → `NOT_EDITABLE` without `server_copy`, an unreadable one → `NOT_FOUND`). Delete =
  cancel with reason (default "Draft dihapus dari aplikasi"). Domain validation (G9, G10, Q-09, masters, US-37)
  is the same code as `POST/PATCH /api/v1/expense-requests`.
- **Idempotency / storage:** raw table `sync_receipts` (not a Payload collection; app role SELECT/INSERT/DELETE,
  no UPDATE; 30-day retention with opportunistic purge) keeps `client_uuid`, user, device, batch, status,
  result JSON and the comparison clock facts (`device_time`, `elapsed_ms`, `estimated_time`, `offline`,
  `time_trust`; `received_at` = DB clock). Applied/conflict results are stored in the item's transaction,
  rejections in a new transaction after the rollback. `Idempotency-Key` (= `batch_id`) is accepted but not needed.
  Every stored result writes audit `sync_offline` (with `device_time`).
- **Time:** `time_trust` = `server` for `offline=false`; `estimated` when the item's boot (`boot_id`, default
  `clock.boot_id`) matches and `clock.last_server_time/_elapsed_ms` exist and the estimate is not in the future;
  else `device_only`. `CLOCK_SKEW` when |device − estimate| > 5 min (or, without an estimate, device clock > 5 min
  ahead of the server).
- **Limits:** ≤ 50 items (400), ≤ 256 KiB body (413), 12 batches/min per user (429). Server flag
  `company-settings.syncExpenseDraftsEnabled` (default on) → `rejected FEATURE_DISABLED` when off.
- **App gate:** `GET /api/v1/app/config` is **public** (the APK must learn it is too old before login):
  `minSupportedVersion` (= `company-settings.minAppVersion`, also enforced as 426), `latestVersion`,
  `downloadUrl` (null until published), `updateRequired/updateAvailable` for `?version=x.y.z`, company
  `timezone`, `android.packageName`, `features` (`pushEnabled: false` until FCM — ADR 0011 —, `syncExpenseDrafts`,
  `syncAttendance: false`, `syncProgressReports: false`) and the sync limits. Admin/Owner edit the values in
  "Setting perusahaan".
- **App Links:** `GET /.well-known/assetlinks.json` (Next route, public, `Cache-Control: public, max-age=3600`)
  from env `ANDROID_APP_PACKAGE` (default `id.co.drms.proyekkas`, still pending client confirmation) and
  `ANDROID_APP_CERT_SHA256` (comma-separated `AA:BB:…` fingerprints, validated at boot). No fingerprint → `[]`
  (verification fails closed → APK uses the private-use scheme fallback). Traefik: served by the host's
  catch-all web router (`drms-pk-stg-web`, priority 1), no infra change.

### Implemented in F4b (branch `feat/f4b-mobile-completion`, 2026-09-25) — precisions / deviations

Details and evidence: `docs/proyekkas/f4/f4-gap-analysis.md`. Needs the Lead's review before merge.
- **Decision 10, root/emulator (deviation):** no `safe_device`. It is still maintained (1.4.1, 2026-07-07, MIT,
  140/160) but its Android part adds location permissions, `play-services-location`, appcompat/material, an AGP 7.2.2
  `buildscript` with `kotlin-android` (build under AGP 9.1 / built-in Kotlin **UNVERIFIED**), and its mock check
  subscribes to fused location updates. Instead a method channel `id.co.drms.proyekkas/integrity` in `MainActivity.kt`
  reports `rooted` (su/Magisk paths, `test-keys`), `emulator` (build properties), `developerMode`, `adbEnabled`.
  Mock location = `Position.isMocked` of the attendance GPS fix (geolocator 14.0.3).
- **Decision 10, transport (deviation):** the flags are sent as `integrity` in `POST /api/v1/devices/register` (every
  app start and login), not as an `X-Device-Integrity` header on every request. Stored on `devices`
  (`integrity*`, `integrityRisk` = rooted ∨ emulator ∨ mocked fix), audited by the field diff, never blocking
  (Q-43 proposal). The app shows a warning on the home screen when the report is risky.
- **Remote logout (decision 3):** a valid token on a revoked/lost device now gets `401` with `code: DEVICE_REVOKED`;
  the app ends the session on that first answer (no refresh), rotates the install id and shows an Indonesian notice.
- **Attendance (decisions 5/7/8), F4 slice:** `attendance.check_in` / `attendance.check_out` are processed (no longer
  `unsupported`) when `company-settings.syncAttendanceEnabled` is on (default off; else `rejected FEATURE_DISABLED`).
  Payload `SyncAttendancePayload`: `project_id`, `lat`, `lng`, `accuracy_m`, `is_mocked`, `selfie_media_id` (uploaded
  first with `POST /api/v1/media/selfies` — numeric id like receipts, not `selfie_media_client_uuid`), `camera_lens`.
  Server checks: own employee, project with a geofence (`NO_GEOFENCE`), assignment on the local date
  (`NOT_ASSIGNED`), haversine distance ≤ radius + min(accuracy, 50 m) (`OUTSIDE_GEOFENCE`), `MOCK_LOCATION`, own
  selfie (`MEDIA_MISSING`/`FORBIDDEN`), one check-in and one check-out per employee/project/local date
  (`ALREADY_CHECKED_IN`, `NO_CHECK_IN`, `ALREADY_CHECKED_OUT`; DB unique index as backstop). Time that counts
  (QM-3 proposal): server time online, else the monotonic estimate, else the device clock flagged
  `DEVICE_TIME_ONLY`. Table `attendances` is append-only (no UPDATE/DELETE for the app role, reject triggers;
  `received_at` set by a DB trigger). Still F5: `attendance.on_behalf`, cost-center geofences (QM-1b), corrections
  (T10), schedules/late minutes, recap.
- **Media:** `media-selfies` now stores JPEG q75 (it was WebP, which Payload rejected against the collection's
  `image/jpeg` mime list, so no selfie upload could succeed).
- **Build (decision 13):** every APK is scanned for secrets in CI (`apps/mobile/tool/apk_secret_scan.sh`).
- **Background sync (decision 12):** WorkManager still not added (foreground triggers only).
  *Update 2026-09-26 (E3-b, branch `feat/mobile-e1-e3`):* `workmanager` 0.10.10 added — periodic task (15 min,
  network connected) + one-off task after an unfinished foreground run; the task opens the encrypted DB and the
  secure token store in its own isolate; one token owner per process via `IsolateNameServer` ports (see
  `apps/mobile/README.md` "Background sync"). Workmanager's merged FOREGROUND_SERVICE* / POST_NOTIFICATIONS
  permissions are removed (no foreground service used).

### Phone test fixes (branch `fix/mobile-startup-offline-logout`, 2026-09-25) — precisions

Found on a real phone with the staging APK (password login, ADR 0012): "Offline" shown on working mobile data, logout
that never finished, slow first load. Server answers were all fast (Traefik log), so the fixes are client-side.
- **Online state (decision 12, precision):** the server decides. Any HTTP answer from `/api/v1` — success or problem —
  sets the app ONLINE, even when connectivity_plus reported `none` (before, a `none` could only be cleared by the next
  OS network event, so the app stayed "Offline" while every API call succeeded). A request without an answer sets
  OFFLINE and starts a probe of `GET /api/v1/health` (public, own dio, 5 s timeout) with backoff 3/10/20/30/60 s
  until the server answers; a `none` from the OS is verified the same way. Tapping the red banner probes at once.
  All connectivity_plus 7.3.1 values except `none` (mobile, wifi, vpn, other, …) count as a network. A cancelled
  request is not reported as offline.
- **Logout (decision 3, precision):** logout ALWAYS ends on the login screen. The network part (device revoke, then
  the Keycloak logout) is best effort with a 5 s budget in total; afterwards the local session is cleared in every
  case (tokens, push, new install id), each Keystore step isolated and bounded. A token refresh still in flight when
  the session is cleared can no longer write tokens back (generation check in `TokenManager`). The button shows
  "Sedang keluar…" and ignores a second tap.
- **Unsent data on logout (decision 3, decision):** never deleted. Pending and failed/rejected outbox items and local
  drafts stay in the encrypted DB, locked to the user's `sub`, and are sent after the SAME user signs in again. When
  such items exist, the confirmation dialog says so in Bahasa Indonesia ("… data belum terkirim … TIDAK dihapus …")
  and the button reads "Tetap keluar"; "Batal" keeps the session so the user can send them first (Antrean).
  Rationale: deleting would silently lose expense/attendance evidence; another user on the same phone cannot see or
  send them (queue owner = `sub`). Wiping a lost phone stays the Admin's remote revoke + the 30-day offline limit.
- **Start-up (decision 12 / 10, precision):** before `runApp` only the install id, app version, model, DB handle and
  date symbols are loaded, in parallel (the encrypted DB opens lazily in drift's background isolate). `/app/config`
  no longer holds the splash (the update gate redirects when it arrives; the server enforces 426 anyway). With a
  cached profile the home screen shows as soon as tokens + cached profile are read; `POST /devices/register` and
  `/me` then run in the background. The integrity report and push token wait at most 2 s before registration is
  sent without them. The integrity checks run on a background thread in `MainActivity.kt`, because in Flutter 3.47.5
  Dart runs on the Android main thread by default (engine `Settings::merged_platform_ui_thread = kEnabled`), so
  main-thread native work freezes the UI. Debug builds log start-up marks (`pk.startup`); release builds do not.

## Alternatives

| Alternative | Rejected because |
|---|---|
| React Native / Kotlin native | Brief and lead prompt fix Flutter; one codebase, team agent defined for Flutter. |
| Hive/Isar/ObjectBox local store | Isar unmaintained (2023, Dart < 3); others lack a verified encrypted SQL store with typed migrations; queue needs transactions + relational drafts → SQLite. |
| `sqflite_sqlcipher` | Unverified publisher; drift + sqlite3mc is the maintained path documented by the drift author. |
| Full two-way sync of everything (CRDT/replication) | Money/approval flows need server-side state machines; last-write-wins on financial data is unacceptable. Offline limited to drafts + attendance. |
| Certificate pinning now | Operational risk with LE rotation, side-loaded APK update latency (decision 9). |
| Blocking all rooted devices | Client-side root detection is bypassable and may lock out legitimate staff; policy left to client (QM-4). |
| `freerasp` | Proprietary binary component (§0.10). |

## Consequences

- (+) Field staff can work a full day offline; server stays authoritative; idempotent replay makes flaky networks
  safe.
- (+) Photos compressed on device → small uploads, less disk (user decision #4).
- (−) Conflict UX ("Salinan konflik") and time-trust flags add complexity to PM/Finance screens.
- (−) Offline queue on a lost device contains PII (selfies, receipts) — mitigated by encryption + remote logout lock,
  not by remote wipe (no MDM).
- (−) Root/mock detection is imperfect; the geofence + server checks + audit trail are the real control.
- (−) Build depends on downloading sqlite3mc binaries from GitHub in CI (sha256-checked); mirror via `url_pattern`
  if GitHub is unavailable.

## Security implications

- Tokens: refresh token only in Keystore-backed secure storage; access token in memory; PKCE S256; no client
  secret in APK; `allowBackup=false`; screenshots of approval screens allowed (no `FLAG_SECURE`) unless client asks.
- Transport: TLS only, system CAs only, no cleartext; no pinning v1 (documented risk: device with a malicious
  *system* CA — requires root).
- Data at rest: encrypted SQLite (sqlite3mc), photos inside encrypted DB, key in Keystore; queue locked to
  `user_sub`.
- Integrity: server recomputes geofence, totals, flags; replay protection via `client_uuid`; device integrity flags
  logged; minimum app version enforcement.
- Privacy (UU 27/2022 PDP): selfies & GPS only for attendance; EXIF stripped; retention per Q-33.
- Licences: all chosen packages MIT / BSD / Apache-2.0 (table above); no GPL in the APK.
- QA must test: replay same batch twice (no duplicates), mock location app, rooted emulator, clock set back
  2 hours offline, conflict after web edit, token revoked while queue non-empty, geofence edge (radius ± accuracy).

## Rollback

Mobile features ship behind server-side feature flags per endpoint (`sync.attendance`, `sync.expense_drafts`); the
server can refuse offline item types (`rejected FEATURE_DISABLED`) and force online-only mode without an APK
update. A bad APK is rolled back by distributing the previous signed APK with a higher `versionCode`
(build number) — keep the last 3 signed artifacts.

## Open questions for the client (Bahasa Indonesia in the client list; Lead to merge)

- **QM-1:** Apakah PM perlu membuat laporan progress (dengan foto) saat offline? (usulan: ya, sebagai draft).
  **QM-1b:** Apakah absensi di lokasi operasional (pusat biaya, mis. "Ops Palangka Banjar") juga pakai geofence?
- **QM-2:** Bolehkah foto nota diambil dari galeri (mis. screenshot bukti pesan hotel Traveloka), atau wajib kamera?
- **QM-3:** Untuk absensi offline, jam mana yang dipakai sebagai jam masuk resmi: perkiraan server dari jam
  monotonic HP, atau jam HP dengan tinjauan PM?
- **QM-4:** HP ter-root: cukup diperingatkan dan ditandai, atau absensi diblokir?

## Proposed CLAUDE.md changes (need user approval; the ADR author does not edit)

None for the platform `CLAUDE.md`. Adds agent definition `.claude/agents/flutter-developer.md` in the ProyekKas
repo (not the infra repo).
