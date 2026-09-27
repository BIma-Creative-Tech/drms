# F4 gap analysis — Android APK completion (F4b)

- **Date:** 2026-09-25 · **Branch:** `feat/f4b-mobile-completion` (from `develop` `08adc46`)
- **Baseline:** F4a (`d35dd8e`) + native password login (ADR 0012, `fe352fb`).
- **Sources read:** `phase-plan.md` §F4 (scope + acceptance gate), ADR 0003/0010/0011/0012,
  `requirements-v1.1.md` (US-01, US-02, US-08, US-26, US-42, US-43, §9), `apps/mobile/README.md`, code on `develop`.
- **Status legend:** *done* = in `develop` before F4b · *done (F4b)* = added on this branch · *partial* · *missing* ·
  *blocked* = needs something outside the code (client decision / account).

Line numbers refer to this branch.

## 1. F4 scope (phase-plan §F4 "Scope")

| Item | Status | Evidence (file:line) | Plan / note |
|---|---|---|---|
| Login (AppAuth/PKCE; staging in-app password, ADR 0012) | done | `apps/mobile/lib/features/auth/data/oidc_client.dart:24`, `…/auth/data/password_login_client.dart:47`, `…/auth/presentation/login_screen.dart:84` | Unchanged. Prod login mode = F6 decision. |
| Device registration | done | `apps/web/src/domain/devices.ts:55`, `apps/mobile/lib/features/auth/application/auth_controller.dart:104` | Registered on every start/login. |
| Remote revocation, blocked ≤ 1 request | done (F4b: explicit code) | Server: `apps/web/src/auth/strategies.ts:162`, `apps/web/src/api/v1/http.ts:109` (401 `code: DEVICE_REVOKED`), Keycloak session end `apps/web/src/collections/Devices.ts:25`. App: `apps/mobile/lib/core/network/api_client.dart:78` (no refresh, no retry), `…/auth/data/token_manager.dart:130`, `…/auth/application/auth_controller.dart:211` (new install id + message) | Before F4b a revoked device was also blocked, but only after a refresh attempt and with the generic "Sesi berakhir" text. Tests: `apps/mobile/test/unit/device_revocation_test.dart`, `…/unit/auth_revocation_flow_test.dart`, `apps/web/tests/integration/f4-mobile.int.test.ts` ("blocked on the NEXT request"). |
| Role home screens | done | `apps/mobile/lib/features/auth/domain/user_profile.dart:57`, `…/home/presentation/home_screen.dart`, `apps/mobile/lib/app/router.dart:59` | F4b adds the notification bell, the attendance button and the rooted-device warning. |
| Expense requests with lines + camera receipts, device compression | done | `apps/mobile/lib/features/expense/application/draft_service.dart:24`, `…/core/media/photo_compressor.dart:25` (1600 px / q80 / ≤ 400 KB, EXIF dropped) | Receipt picker/dialog extracted to `…/expense/presentation/receipt_capture.dart:14` and shared with the new online receipt flow. |
| Owner approval inbox with signature | done | `apps/mobile/lib/features/approvals/presentation/inbox_screen.dart:14`, `…/approvals/presentation/decision_sheet.dart:30` (profile or drawn signature, PNG ≤ 50 KB), `…/approvals/data/approvals_api.dart:30` | The web flow's `SignBody.signatureMediaId` is optional (profile signature by default); the phone offers both (US-43). Covered by `test/integration/mock_backend_flow_test.dart`. |
| Receipts / LPJ from the phone | done (F4b) | `apps/mobile/lib/features/expense/presentation/requester_actions.dart:164` (add receipt: camera/gallery → compression → `POST /media/receipts` → `POST …/receipts`), `:247` (remove with reason), `:67` (LPJ submit/resubmit with usage notes), receipts-complete / receipts-resubmit / complete | Was **missing**: after approval the requester had no receipt/LPJ action on the phone (Uang Muka after transfer, LPJ revision, Reimburse receipt revision). Online only (ADR 0010 decision 5), actions shown from `allowedActions`. Tests: `test/widget/requester_flow_test.dart`. |
| Transfer status visible to the requester | done (F4b) | `apps/mobile/lib/features/expense/data/expense_mappers.dart:189`, `…/expense/presentation/widgets/transfer_lpj.dart` (`TransferSection`, `LpjSection`), `…/request_detail_screen.dart:111` | Was **partial**: status label only. Now kind, amount, date, bank reference, void reason, total transferred, LPJ totals/difference/Finance note. |
| Notifications (FCM, ADR 0011) | blocked (push) · done (F4b, in-app) | In-app: `apps/mobile/lib/features/notifications/application/notifications_providers.dart:17` (poll 2 min + pull-to-refresh), `…/notifications/presentation/notifications_screen.dart:34`. Push seam: `…/notifications/data/push_service.dart:24`. Server flag: `apps/web/src/lib/env.ts:152`/`:171`, `apps/web/src/api/v1/endpoints/app.ts:75` | FCM needs the Firebase project (Q-44) — see §4. `PUSH_FCM_ENABLED` is now in the env schema (F6 backlog item closed) and refuses `true` while no dispatcher exists. |
| Offline queue for drafts | done | `apps/mobile/lib/features/sync/application/sync_engine.dart`, encrypted DB `apps/mobile/pubspec.yaml:58` (sqlite3mc) | — |
| Offline queue for attendance | done (F4b, F4 slice) | App: `apps/mobile/lib/features/attendance/presentation/attendance_screen.dart:23`, `…/attendance/application/attendance_service.dart:31`, `…/sync/data/outbox_repository.dart:120`. Server: `apps/web/src/domain/sync/service.ts:403`, `apps/web/src/collections/Attendances.ts:27`, guards `apps/web/src/migrations/20260925_023716_f4b_attendance_security.ts:30` | Was **missing** (server answered `unsupported`, "Absensi (segera hadir)"). In F4 scope and gate, so the minimum slice was built: own check-in/out at an assigned project, front-camera selfie, GPS + `isMocked`, geofence (radius + accuracy ≤ 50 m), one in/out per day, offline with server-estimated time. Behind `company-settings.syncAttendanceEnabled` (default **off**). **Remaining for F5:** PM on-behalf (US-14), cost-center geofences (QM-1b), corrections T10, schedules/late minutes, recap, reminders, selfie viewer. |
| Mock location & root detection | done (F4b) | Root/emulator/dev-options/ADB: `apps/mobile/android/app/src/main/kotlin/id/co/drms/proyekkas/MainActivity.kt:39,62`, reported `…/auth/application/auth_controller.dart:109,115`, stored `apps/web/src/domain/devices.ts:37` + `Devices.integrityRisk`. Mock location: per GPS fix `Position.isMocked` → phone refuses and server rejects `MOCK_LOCATION` (`apps/web/src/domain/sync/service.ts:410`). Warning on home `…/home/presentation/home_screen.dart:98` | Recorded, not blocking (Q-43 proposal "warn + flag"); fake GPS always blocked for attendance (US-01). See §3 for the package decision. |
| Signed release APK in CI | done (staging) | `.github/workflows/mobile.yml:132` (stable staging key) | Production key/job (two custodians) = later step (ADR 0010 decision 13). |
| Backend `/api/v1/sync/batch` + idempotency | done | `apps/web/src/domain/sync/service.ts:653`, `apps/web/src/migrations/20260924_025115_f4_security.ts:25` (`sync_receipts`), `Idempotency-Key` on online actions `apps/web/src/api/v1/endpoints/expense-requests.ts:222` | Attendance items added (F4b). |
| Files endpoint | done | `apps/web/src/api/v1/endpoints/media.ts:32` (upload), `:123` (authorized file read) | F4b adds kind `selfies`; **bug fixed**: `media-selfies` re-encoded to WebP while accepting only `image/jpeg`, so every selfie upload failed (`apps/web/src/collections/media/index.ts:90`, now JPEG q75). |
| Min-version check (force update) | done | Server 426 `apps/web/src/api/v1/http.ts` (`Upgrade Required`), `apps/web/src/api/v1/endpoints/app.ts:64`; app `apps/mobile/lib/core/network/api_client.dart:124`, `apps/mobile/lib/app/router.dart:58` (`/update`) | Widget test added (`test/widget/notifications_test.dart`). |
| Background sync (WorkManager, ADR 0010 decision 12) | partial | `apps/mobile/lib/features/sync/application/sync_coordinator.dart:20` | Triggers today: app start, connectivity regained, after each enqueue, manual. A WorkManager task (sync while the app is closed) needs a background isolate that opens the encrypted DB and the token store — not done; not a gate item. Plan: F5 or F6 after measuring field behaviour. |

## 2. F4 acceptance gate

| Gate item | Status | Evidence | Plan / note |
|---|---|---|---|
| E2E on a physical phone against staging: create → approve (Owner on phone) → transfer (web) → receipts → LPJ | ready for test | All steps exist on the phone except the transfer (web by design). Script: `docs/proyekkas/f4/f4-e2e-scenario.md` | Needs the staging redeploy (§5) and a new APK build. |
| Offline check-in synced with "offline" flag and server time | ready for test (F4b) | `apps/web/tests/integration/f4b-attendance.int.test.ts` (flag `OFFLINE`, `time_trust=estimated`, `received_at` = DB clock), `apps/mobile/test/unit/attendance_test.dart` | Admin must switch on "Absensi dari APK" and set the project's latitude/longitude/radius; staff must be assigned to the project. |
| Revoked device blocked ≤ 1 request | done | See §1 row "Remote revocation" | E2E step in the script. |
| APK signed | done (staging key) | `.github/workflows/mobile.yml:132` | — |
| No secrets in APK (static scan) | done (F4b) | `.github/workflows/mobile.yml:120` and `:157` → `apps/mobile/tool/apk_secret_scan.sh` (unpack + string dumps of dex/`libapp.so`, forbidden files, deny-list, gitleaks 8.30.1 `dir`, trivy 0.74.0 secret) | Verified locally on this branch: debug APK and 3 split release APKs clean; a tainted copy (fake `ghp_…` token + `google-services.json`) fails all three checks. One allow-listed false positive (flutter_secure_storage preference key names, `apps/mobile/tool/apk-gitleaks.toml`). |

## 3. Decisions taken in F4b

1. **Root/emulator detection without a plugin.** `safe_device` 1.4.1 (ADR 0010 choice) is still maintained
   (pub.dev: published 2026-07-07, MIT, publisher ufuksahin.dev, 140/160 points, ≈ 155 k downloads/30 d). Its
   Android part, read from the 1.4.1 archive, adds `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION`,
   `play-services-location`, appcompat/material, a `buildscript` with AGP 7.2.2 + `kotlin-android`, and its mock
   check subscribes to fused location updates. The app builds with AGP 9.1 / built-in Kotlin, and whether the plugin
   builds there was not tested (**UNVERIFIED**). A ~60-line method channel in `MainActivity.kt` covers what we need
   (su/Magisk paths + `test-keys`, emulator build properties, developer options, ADB) and adds no permission. Mock
   location is a property of a GPS fix, so it comes from geolocator's `Position.isMocked` at check-in. Both are
   reported only (Q-43), which matches ADR 0010 decision 10. **ADR 0010 needs a revision note** (Lead).
2. **Integrity reported at register, not in every request.** ADR 0010 decision 10 proposed an `X-Device-Integrity`
   header on every call. F4b sends `integrity` in `POST /devices/register`, which the app calls on every start and
   login. The result is the same data without extra writes per request.
3. **Attendance slice in F4.** The gate requires an offline check-in, so the smallest server-authoritative version
   was built (see §1). The feature is off by default and does not pre-empt the F5 design of corrections, recap and
   schedules: rows are append-only, and F5 adds its own tables and actions.
   US-01 "button active only inside the radius" is implemented as "tap → GPS fix → refused outside the radius
   (with the distance)", because the fix is taken at the moment of the check-in anyway.
4. **Attendance time (QM-3 proposal).** Online: server receive time. Offline: server estimate from the monotonic
   clock. Otherwise the device clock, flagged `DEVICE_TIME_ONLY`. `received_at` is always the DB clock (trigger).
5. **geolocator 14.0.3** added (ADR 0010 table; re-checked on pub.dev 2026-09-25: published 2026-06-12, MIT,
   baseflow.com, 160/160). It brings `play-services-location` 21.2.0 (from `geolocator_android` 5.0.3 build.gradle).
   Only while-in-use location: no background permission and no foreground service.

## 4. Blocked: FCM push (ADR 0011, Q-44)

The code path is **not** compiled in. Without a Firebase project there is no `google-services.json` /
`FirebaseOptions`, so the FCM code could not be run or tested, and the plugin would ship unused. Current state:
`PushService` seam + `DisabledPushService` (app), `features.pushEnabled` in `/app/config`, `PUSH_FCM_ENABLED` in
the env schema (refused when `true`), in-app notifications by polling.

Needed once the client provides the Firebase project:

1. **Client (Q-44):** Firebase project on the company Google account; Android app `id.co.drms.proyekkas` registered
   (one project per environment, or one project with two apps if the staging package gets a suffix — decide);
   the vendor gets a scoped role; SHA-256 of the staging/prod signing keys added in Firebase.
2. **Secrets (infra):** `google-services.json` per flavor as a CI secret (never committed; `.gitignore` already
   blocks it); service-account key with only `cloudmessaging.messages.create` as a Docker secret
   `FCM_SERVICE_ACCOUNT_JSON_FILE` (exact predefined role name **UNVERIFIED**, ADR 0011 §2).
3. **App:** add `firebase_core` / `firebase_messaging` / `flutter_local_notifications` (versions to re-verify on
   pub.dev at that time; ADR 0010 lists 4.15.0 / 16.7.0 / 22.3.1 as of 2026-09-23), the Google Services Gradle
   plugin (version **UNVERIFIED**), `FcmPushService implements PushService` (token → `POST /devices/register`
   `fcmToken`, `onTokenRefresh`, `deleteToken()` on logout), `POST_NOTIFICATIONS` runtime permission (Android 13+),
   show server texts only (`GET /notifications/{uuid}`).
4. **Server:** FCM HTTP v1 dispatcher job (retry/back-off, `UNREGISTERED` → token cleared), `fcmToken` unique,
   remove the `PUSH_FCM_ENABLED=true` refusal in `src/lib/env.ts`, then set `PUSH_FCM_ENABLED=true`.
5. The APK secret scan must stay green: a Firebase Android API key inside the APK is **not** a secret, but gitleaks
   will flag it (`gcp-api-key`). Allow-list it in `apps/mobile/tool/apk-gitleaks.toml` with a written reason.

## 5. Staging redeploy (for the infra lead)

- **Migrations (additive, staging-safe, run by the one-shot migrate container as `pk_drms_stg_owner`):**
  `20260925_015425_f4b_device_integrity`, `20260925_023715_f4b_attendance`,
  `20260925_023716_f4b_attendance_security`.
- **Env:** `PUSH_FCM_ENABLED=false` (new, optional: the default is false; `true` fails at boot). No other new
  variables. Compose (`deploy/staging/docker-compose.yml`) passes it through.
- **After deploy (Admin, web):** "Setting perusahaan" → tick "Absensi dari APK (termasuk offline) aktif"; set
  latitude/longitude/radius on the test project; assign the test staff to it (team assignment). New APK from this
  branch (location permission, attendance screen).
