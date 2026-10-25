# ADR 0018 — Employee privacy notice: bundling, versioned acknowledgement, attendance gate

- **Status:** accepted (owner decisions 2026-10-05: Q-46 collection of selfie + location approved, employees must be
  shown the notice; Q-33 selfie retention 6 months). Notice **text** = draft v1, wording still awaiting DRMS HR/legal.
- **Date:** 2026-10-05
- **Author:** nextjs + flutter developer (branch `feat/privacy-notice`, based on `main` `26f9341`)
- **Related:** ADR 0006 (audit), ADR 0010 (APK offline), ADR 0016 (multi-PT); `../legal/pemberitahuan-privasi.md`;
  `../security/asvs-l1-checklist.md` 8.3.3 / G-06; `../open-questions-client.md` Q-33, Q-46.

## Decision

1. **Single source of the text:** `docs/proyekkas/legal/pemberitahuan-privasi.md` (owned by HR/legal). No wording of
   the notice is written anywhere else. `apps/web/scripts/gen-privacy-notice.mjs` bundles it at build time into
   `apps/web/src/legal/privacy-notice.generated.ts` (markdown, sha256, version, title, safe HTML) because `docs/` is not
   in the Docker build context; CI (`check:privacy-notice`) and a unit test fail when the bundle is stale.
2. **Version = the integer after `**Versi:**`** in the markdown (text after it, e.g. "(DRAF …)", is ignored). The
   generator refuses a notice without it. **Bumping that number is the only way to ask everybody again**; editorial
   fixes that do not need a new acknowledgement keep the number.
3. **Safe rendering, no new dependency:** `src/legal/markdown.ts` parses a small subset (headings, paragraphs, lists,
   pipe tables, rules, strong/em/code) into an AST. HTML output escapes every text node and emits only a fixed set of
   attribute-less tags; raw HTML, links and images stay literal text. React renders the same AST (no
   `dangerouslySetInnerHTML`); the APK has its own port (`features/privacy/domain/markdown.dart`) and builds Text
   widgets. `marked` (only a transitive dependency of monaco-editor, old major, passes raw HTML) was not reused.
4. **Acknowledgement = server fact.** `users.privacyAckVersion` + `users.privacyAckAt` (DB clock), written only by
   `POST /api/v1/me/privacy-ack { version }` (own account; `version` must equal the current one, else 409
   `PRIVACY_VERSION_MISMATCH`; Idempotency-Key required from the APK; re-ack of an acknowledged version = 200
   `alreadyAcknowledged`, unchanged timestamp, no new audit row). One `privacy_ack` audit row per acknowledgement (doc
   type `user`, no PT). Fields are read-only in admin/REST; a DB trigger keeps them monotonic (no withdraw, no lower
   version, no re-dating) and a CHECK keeps the pair consistent. "Acknowledged" means `ackVersion ≥ currentVersion`.
5. **Surfaces:** `GET /api/v1/privacy-notice` (public, `{version,title,html,markdown}`, cacheable 5 min); public page
   `/privasi` (noindex, linked from the web login page and `/unduh`); `GET /me` → `privacy {currentVersion, ackVersion,
   ackAt}` (additive).
6. **Web admin:** while not acknowledged, a non-dismissable interstitial over every admin page (rendered by the shell
   Nav) with the notice and "Saya mengerti". The Users list shows "Privasi dibaca (versi/tanggal)".
7. **APK (0.3.3):** after login / at every start while not acknowledged, a full-screen notice (from the API markdown,
   cached in the encrypted DB for offline reading) with "Saya mengerti" and "Nanti" (= this app run only).
   **Attendance** (own check-in/out, on-behalf, selfie capture, distance check) is blocked until the server has the
   acknowledgement; other features work. Offline the acknowledgement is retried when the server is reachable again
   (same Idempotency-Key) — never assumed locally. Profile → "Pemberitahuan privasi" re-reads it.
8. **Compatibility:** APK ≤ 0.3.2 ignores the new `/me` field and is not gated by the server. APK 0.3.3 against a server
   without the feature (`/me` without `privacy`, 404 on the endpoints) blocks nothing.

## Owner decisions (2026-10-05)

- **Web-only users must acknowledge too** (office roles without attendance): the web interstitial stays mandatory —
  their account, bank and signature data are processed as well.
- **Server-side enforcement — yes, once 0.3.3 is the minimum APK version:** while the app setting "Versi APK minimum"
  is ≥ 0.3.3, attendance writes (check-in/out, on-behalf) of a user without an acknowledgement of the current version
  are refused (`PRIVACY_ACK_REQUIRED`); below that, older APKs keep working.
- **Final HR/legal wording is published as version 2**: everybody (including those who acknowledged v1) is asked
  again. Version 1 = this text, approved by the owner, effective 5 Oct 2026; contact PIC: Rivaldo AK.

## Implementation note — server-side enforcement (owner decision 2026-10-05)

- **Switch = the app-wide setting "Versi APK minimum"** (`company-settings.minAppVersion`, the same value as the 426
  gate, 60 s process cache in `src/lib/app-min-version.ts`). Enforcement is ON when it parses as strict `x.y.z` and is
  ≥ `0.3.3` (numeric per part: `0.3.10` > `0.3.3`); unset, empty or unreadable (`0.3`, `0.3.3-beta`, garbage) = OFF.
  No separate flag: raising the minimum to 0.3.3 already locks out every APK without the notice screen.
- **Refused while ON and `privacyAckVersion` < current version** (`src/legal/privacy-enforcement.ts`, a fresh DB read
  of the acting user):
  - `POST /api/v1/sync/batch` items `attendance.check_in` / `check_out` / `on_behalf` → `rejected` with
    `PRIVACY_ACK_REQUIRED` (stored in `sync_receipts` like every rejection: final, a replay answers `duplicate`). For
    `on_behalf` the **acting PM** must have acknowledged; the employee's own account is not checked (may have none).
  - Selfie capture: `POST /api/v1/media/selfies` → 403 problem `code: PRIVACY_ACK_REQUIRED` (before the image is
    queued/stored), and the generic Payload REST create of `media-selfies` (collection `createGuard`) → 403.
  - Each refusal writes one `access_denied` audit row in its own transaction: reason `PRIVACY_ACK_REQUIRED`,
    `new_value {currentVersion, ackVersion, minAppVersion}`, doc type `attendance` (field = item type, PT = item PT)
    or `media_selfies` (field `upload`, app-wide).
- **Not affected:** reads, `/me`, the acknowledgement endpoint itself, other sync item types, web admin, and T10
  corrections by PM/Admin (no selfie/location capture).
- **APK 0.3.3** blocks attendance locally first, so the code only arrives when the phone's cached `/me` is stale (e.g.
  a new notice version). It maps it to a fixed Indonesian text (`privacyAckRequiredMessage`), never retries the item
  (selfie 403 = final rejection too) and reloads `/me`, which brings the notice screen back.
- Tests: `tests/unit/privacy-enforcement.test.ts`, `tests/integration/privacy-enforcement.int.test.ts`,
  `apps/mobile/test/unit/privacy_enforcement_test.dart`.

## Consequences

- Changing the text = edit the markdown, `npm run gen:privacy-notice`, commit both, release the web; bump "Versi"
  when everybody must acknowledge again.
- The selfie retention stated in the notice (§4) must equal the `selfieRetentionMonths` default (unit test). Changing
  a PT's retention away from 6 months requires updating the notice.
- **Amendment 2026-10-25 (web 0.21.1, user decision):** viewing a selfie collected under this notice is always
  audited for anyone but the uploader — the unaudited Payload route to `media-selfies` is closed (ADR 0004 revision
  2026-10-25); the notice text is unchanged.
