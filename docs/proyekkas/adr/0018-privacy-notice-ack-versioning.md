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

## Not decided here (open, owner)

- **Server-side enforcement:** the server does not refuse attendance from an unacknowledged user (that would break the
  released APK 0.3.2). Once 0.3.3 is the minimum APK version, `sync/batch` could refuse attendance items without an
  acknowledgement.
- **Web-only users** (office roles that never use the APK) are gated by the web interstitial too; whether they must
  acknowledge at all is an owner question.
- **Effective date / final wording:** set by HR/legal in the markdown; publishing the final text as version 1 or 2
  (re-ask everybody who acknowledged the draft) is an owner/HR decision.

## Consequences

- Changing the text = edit the markdown, `npm run gen:privacy-notice`, commit both, release the web; bump "Versi"
  when everybody must acknowledge again.
- The selfie retention stated in the notice (§4) must equal the `selfieRetentionMonths` default (unit test). Changing
  a PT's retention away from 6 months requires updating the notice.
