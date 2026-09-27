# ADR 0011 — Push notifications via Firebase Cloud Messaging (HTTP v1)

- **Status:** accepted (user, GATE F0 2026-09-23); F2b groundwork recorded 2026-09-24 (see Revision history)
- **Date:** 2026-09-23
- **Author:** Analyst (mobile & integration), Phase 0
- **Related:** `docs/proyekkas/f0-brief.md` §3 ("Push: FCM (needs ADR — third-party Google service)"); requirements
  v1.1 M12, US-05, US-11, §9 "Notifikasi"; ADR 0010 (mobile stack, `devices`); `/opt/infra/CLAUDE.md` §0.10,
  §3.6 (secrets, "log tanpa PII sensitif"); job runner / notifications design in the architecture ADR (parallel).

## Context

Staff must be told about every status change of their requests (US-05), PMs about missing progress reports
(US-11), Owner about pending approvals, Finance about the transfer queue. The Android app is side-loaded (not
necessarily from Play). In-app notifications (bell, collection `notifications`) are the source of truth; push is a
wake-up/alert channel on top.

### Facts verified this session (fetched 2026-09-23)

- **Send endpoint** (`firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send`):
  `POST https://fcm.googleapis.com/v1/{parent=projects/*}/messages:send`, `parent` = `projects/{project_id}`.
  Body `{ "validate_only": boolean, "message": Message }`. OAuth scopes: `https://www.googleapis.com/auth/firebase.messaging`
  or `https://www.googleapis.com/auth/cloud-platform`; IAM permission `cloudmessaging.messages.create`.
- **Message** (`…/projects.messages`): fields `data` (map string→string), `notification`, `android`
  (`collapse_key`, `priority` `normal|high`, `ttl`, `restricted_package_name`, `data`, `notification`,
  `direct_boot_ok`, …), and exactly one target of `token` | **`fid`** | `topic` | `condition`.
- **Payload limit** (`…/cloud-messaging/customize-messages/set-message-type`): "Maximum payload for both message
  types is 4096 bytes".
- **Errors** (`…/fcm/rest/v1/ErrorCode`): `UNREGISTERED` (HTTP 404) — token no longer valid, must be removed;
  `QUOTA_EXCEEDED` (HTTP 429); `ttl` must be 0…2 419 200 s (4 weeks).
- **Token lifecycle** (`…/cloud-messaging/manage-tokens`): FCM now documents **Firebase Installation IDs (FIDs)** as
  the per-instance target, co-supported with "legacy registration tokens"; server should store the ID with a
  timestamp updated on every upload; Android registrations inactive **270 days** are expired by FCM; devices not
  connected for over a month are considered stale.
- **FlutterFire** `firebase_messaging` 16.7.0 (BSD-3-Clause, published 2026-09-14, pub.dev API) exposes
  `getToken()`, `onTokenRefresh`, `deleteToken()` (`lib/src/messaging.dart`); no FID-registration API found in its
  source/CHANGELOG head → ProyekKas uses the **`token`** target (co-supported per the docs above).
- **Server libraries** (npm registry): `firebase-admin` 14.4.0 (Apache-2.0, 2026-09-10, engines `node >=22`);
  `google-auth-library` 11.1.0 (Apache-2.0, 2026-09-16, `node >=22`). Platform Node = 24 → compatible.
- **Privacy** (`firebase.google.com/support/privacy`): "Firebase Cloud Messaging uses Firebase installation IDs to
  determine which devices to deliver messages to. Retention: Firebase retains Firebase installation IDs until the
  Firebase customer makes an API call to delete the ID … removed … within 180 days."
- **Self-hosted alternative:** ntfy (`binwiederhier/ntfy`, dual Apache-2.0 / GPLv2, latest release v2.28.0
  2026-08-27, active). ntfy docs (`docs.ntfy.sh/config/`): *"FCM is the only method that an Android app can receive
  messages without having to run a foreground service."* UnifiedPush (`unifiedpush.org/users/distributors/`):
  "you need to choose a distributor" app on the phone. Flutter package `unifiedpush` 6.2.0 (Apache-2.0) last
  published **2025-10-13** (> 6 months, fails §0.10 maintenance rule).

## Decision

1. **Use FCM HTTP v1** for Android push. Firebase project owned by the client's Google account (vendor gets a
   scoped role) — **client decision needed** (QP-1). Firebase client config (`google-services.json`) is not a
   secret but is kept out of public repos.
2. **Server auth:** a dedicated Google **service account** with only the role that grants
   `cloudmessaging.messages.create` (exact predefined role name **UNVERIFIED** — pick the narrowest role containing
   that permission in the GCP console at F4). Key JSON stored as a Docker secret / `.env` mode 600
   (`FCM_SERVICE_ACCOUNT_JSON`), never in git, never in `NEXT_PUBLIC_*`. Access token minted with
   `google-auth-library` (scope `…/auth/firebase.messaging`) and cached until expiry; plain HTTPS call to the v1
   endpoint (fewer transitive deps than `firebase-admin`; `firebase-admin` acceptable if the implementer prefers —
   both Apache-2.0). Key rotation yearly or on suspicion.
3. **Data minimisation — payload carries no PII and no business data.** Every push is a **data message** with
   only: `{"t": "<event_code>", "n": "<notification_uuid>", "v": "1"}` plus `android.collapse_key` per event type,
   `android.priority` `high` only for approval requests/transfer done, else `normal`, `ttl` 24 h (attendance
   reminders 2 h). The app then fetches `GET /api/v1/notifications/{uuid}` with the user's token and renders the
   Bahasa Indonesia text locally via `flutter_local_notifications`. No names, amounts, request numbers, project
   names or GPS in the FCM payload. Generic fallback text if the fetch fails: "Ada pembaruan di ProyekKas".
4. **Token registry in `devices`** (collection defined in ADR 0003 §5 with `deviceId`, `user`, `platform`, `model`,
   `appVersion`, `fcmToken`, `lastSeenAt`, `status`, `revokedAt/By`): this ADR requires `fcmToken` **unique**,
   and adds `fcmTokenUpdatedAt`, `lastSyncAt` (ADR 0010), `integrityFlags` (ADR 0010) and status value `stale`
   (push-only meaning: token dropped, device may still log in). App uploads the token after login and on
   `onTokenRefresh` (`PUT /api/v1/devices/me/push-token`). On logout / remote logout: server clears the token and
   the app calls `deleteToken()`. Token sent to a different user's login on the same device → reassigned (one
   token ↔ one active device-user). `UNREGISTERED`/404 → mark `stale`, clear token. No `last_seen_at` for 30 days
   → stop sending, mark `stale` (FCM guidance); 270 days → delete token.
5. **Delivery pipeline:** business event → row in `notifications` (in-app, same transaction) → job (runner from
   the architecture ADR) → FCM send per active device of the recipient; retries on 429/5xx with back-off (honour
   `Retry-After` if present — **UNVERIFIED** header behaviour), no retry on 400/404. User preferences (mute
   categories) respected server-side. Rate: volumes are tiny (Q-34: ~30 users).
6. **Audit & logs:** log `notification_uuid`, event code, device id, FCM response status and message `name`; never
   the token in full (first 8 chars) and never payload text.
7. **No topics / no broadcast** (everything per-device, recipients computed server-side by role + scope).

### Implemented so far (F2b, `develop` `59ba0a4`) — in-app only, push gated off

Verified in `apps/web/src/collections/Notifications.ts`, `src/domain/notifications.ts`,
`src/api/v1/endpoints/notifications.ts`, `migrations/20260923_161853_f2b_lpj_notifications.ts`:
- `notifications` rows are written by the domain service in the same transaction as the status change
  (§5 step 1); each user reads only their own rows: `GET /api/v1/notifications`, `GET /api/v1/notifications/{id}`
  (`{id}` = numeric id **or uuid**, as §3 requires), `POST …/{id}/read`, `POST …/read-all`. DB: Class B
  (ADR 0006 §2).
- Column **`pushStatus`** (`push_status`, enum `skipped | pending | sent | failed`, default `skipped`). Rows are
  written `pending` only when env **`PUSH_FCM_ENABLED=true`**, else `skipped`. **No FCM dispatcher exists yet**
  and `PUSH_FCM_ENABLED` is **not yet in the env schema** (`src/lib/env.ts`) or `deploy/staging/.env.example`
  — both F4 (F6 backlog item in `phase-plan.md`). Nothing in §2–§7 beyond the in-app row is implemented.

## Alternatives

| Alternative | Decision / reason |
|---|---|
| Self-hosted **ntfy** + **UnifiedPush** | Rejected for v1: needs a distributor app on every phone (UnifiedPush docs) or a foreground service (ntfy docs: FCM is the only way without one) → battery/UX burden for field staff; extra container (RAM from the ≈ 2.5 GiB client budget, ADR 0004); Flutter connector last published 2025-10-13 (> 6 months). Revisit if the client rejects Google (QP-2). |
| Polling only (app polls `/notifications` every N min) | Kept as **fallback**: in-app bell + fetch on app open/resume + workmanager periodic check; alone it cannot wake the app reliably. |
| SMS / WhatsApp gateway | Paid third party, PII in message text; out of scope. |
| FCM legacy HTTP / server key | Legacy API; v1 with OAuth service account is the documented API (fetched reference). |
| `fid` target instead of `token` | FlutterFire 16.7.0 exposes tokens, not FID registration; switch when the SDK supports it (both co-supported per docs). |

## Consequences

- (+) Reliable wake-up on Android without foreground services; tiny payloads; in-app remains source of truth.
- (−) Dependency on Google (Firebase project, Google Play services on the phone). Phones without Google Play
  services (some Huawei devices) receive **no push** → polling fallback only; device inventory needed (Q-29).
- (−) One more secret (service account key) to rotate and back up.

## Security implications

- **Third-party processing:** Google processes the FCM token/installation ID, device metadata and message metadata.
  Because the payload holds only an opaque event code + UUID, no personal or financial data is disclosed to
  Google. This must be stated in the privacy notice for staff (UU No. 27/2022 PDP; wording by client/legal —
  QP-3). Retention on Google side per Firebase privacy page (IDs until deleted via API, then ≤ 180 days).
- Service-account key = ability to push arbitrary text to all DRMS phones (phishing vector) → least-privilege
  role, secret storage, rotation, alert on send-rate anomaly; the app **renders only server-fetched text**, so a
  leaked key alone cannot inject text into ProyekKas notifications (data message ignored if the fetch by UUID
  fails authorization → shows generic text only).
- Notification fetch endpoint enforces the same access control as the underlying document.
- Licences: firebase_messaging/firebase_core BSD-3-Clause; google-auth-library / firebase-admin Apache-2.0. The
  Firebase SDK pulls Google Play services components (proprietary, but runtime-provided by the OS vendor) —
  **Lead to confirm** this is acceptable under §0.10 (it is not code we distribute, except the FlutterFire
  wrappers and Firebase Android SDK artifacts in the APK — Firebase Android SDK licence **UNVERIFIED**).

## Rollback

Feature flag `PUSH_FCM_ENABLED=false` → server stops sending; in-app notifications and polling continue unchanged.
To leave Firebase entirely: delete the service account key, delete tokens in `devices`, call the Firebase
installations deletion API if required by the client (endpoint **UNVERIFIED**), ship an APK without
`firebase_messaging`.

## Open questions for the client (Lead to merge into the Bahasa Indonesia list)

- **QP-1:** Akun Google milik siapa yang dipakai untuk proyek Firebase (usulan: akun perusahaan DRMS)?
- **QP-2:** Apakah DRMS keberatan memakai layanan Google (FCM) untuk notifikasi? Isi notifikasi tidak memuat data
  pribadi atau nominal.
- **QP-3:** Perlu pemberitahuan privasi untuk karyawan (selfie, lokasi, notifikasi via Google) — siapa yang
  menyiapkan teksnya?

## Proposed CLAUDE.md changes (need user approval; the ADR author does not edit)

None.

## Revision history

- **2026-09-23 (F0 gate):** accepted by user.
- **2026-09-24 (F2b):** in-app `notifications` implemented (API incl. fetch by uuid, Class B in the DB);
  `pushStatus` column (`skipped` default, `pending` only with `PUSH_FCM_ENABLED=true`); the gate is not yet in
  the env schema and there is no FCM dispatcher (F4). Decisions unchanged; status stays accepted.
- **2026-09-25 (F4b, branch `feat/f4b-mobile-completion`):** `PUSH_FCM_ENABLED` is in the env schema (default
  false) and `true` is refused at boot until a dispatcher exists; `/api/v1/app/config` `features.pushEnabled` reads it.
  The APK shows in-app notifications (bell + list, polling every 2 min while the home screen is open) — the fallback
  of this ADR. No Firebase packages in the APK yet: the Firebase project (Q-44) is still missing. The checklist for
  enabling FCM is in `docs/proyekkas/f4/f4-gap-analysis.md` §4. Decisions unchanged.
