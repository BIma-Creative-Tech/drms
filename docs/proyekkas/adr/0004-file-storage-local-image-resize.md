# ADR 0004 — File storage: local volume now, S3-compatible later; server-side image resize

- **Status:** accepted (user, GATE F0 2026-09-23); revised 2026-09-23 in F1 foundation and 2026-09-24 after F2b (see Revision history)
- **Date:** 2026-09-23
- **Author:** Analyst/Architect — Phase 0
- **Related:** brief §2 #4; requirements v1.0 §9 ("File"); `/opt/infra/docs/adr/0006-backup.md`;
  `/opt/infra/scripts/backup.sh`, `/opt/infra/scripts/lib/restic-common.sh`; ADR 0001, 0002, 0008;
  `../architecture.md` §9; mobile ADR `0010-*.md` (device-side compression)

## Context

### Verified (Payload tag v3.90.1, fetched 2026-09-23)
- Upload collection options (`docs/upload/overview.mdx`): `staticDir`, `imageSizes`, `resizeOptions`,
  `formatOptions` (`{format, options}`), `trimOptions`, `constructorOptions`, `withMetadata`,
  `mimeTypes`, `adminThumbnail`, `crop`, `focalPoint`, `pasteURL` (default **enabled**; `false` disables),
  `filesRequiredOnCreate`, `disableLocalStorage`, `handlers`, `modifyResponseHeaders`,
  `allowRestrictedFileTypes`, `bulkUpload`, `hideRemoveFile`, `filenameCompoundIndex`.
- Global upload limits (`upload.limits`, Busboy): defaults `requestSizeLimit` 50 MiB, `fileSize` 20 MiB,
  `files` 3, `fields` 20, `fieldSize` 1 MiB; `useTempFiles` to stream to disk instead of RAM.
- Source `packages/payload/src/uploads/generateFileData.ts`: when any of `resizeOptions|formatOptions|
  trimOptions|constructorOptions` is set, the **uploaded original itself** is processed:
  `sharp(...).rotate()` (EXIF auto-orient) → `.resize(resizeOptions)` → `.toFormat(...)` → `.trim(...)`;
  metadata only kept when `withMetadata` is set (`optionallyAppendMetadata.ts`). ⇒ **the unprocessed
  original is not stored.**
- sharp 0.35.4 (`docs/src/content/docs/api-output.md`, `api-resize.md`, tag `v0.35.4`): default output
  strips all metadata incl. EXIF/ICC (converted to sRGB) unless `keepMetadata()`; `jpeg` options
  `quality` (default 80), `mozjpeg` (bool); `webp` `quality` (80), `effort` (0–6, default 4);
  `png` `compressionLevel` (6), `palette`, `quality`, `effort`; resize `fit` `inside`,
  `withoutEnlargement`.
- File access: "All files … automatically support the `read` Access Control function from the Collection"
  (`docs/upload/overview.mdx` §Access Control) — files are served through Payload, not a public dir.
- Storage adapters: `@payloadcms/storage-s3@3.90.1` exists (MIT; deps `@aws-sdk/client-s3`, `lib-storage`,
  `s3-request-presigner`, `@payloadcms/plugin-cloud-storage@3.90.1`) — registry. Options `signedDownloads`
  (presigned URLs, per collection, `shouldUseSignedURL`), `clientUploads`, `disablePayloadAccessControl`,
  `generateFileURL` (`docs/upload/storage-adapters.mdx`). **No signed-URL feature for local disk.**
- PDF engine (ADR 0008) `@react-pdf/image@3.1.2` accepts only **JPEG, PNG, SVG** (`isValidFormat` in
  `lib/index.js`) → images embedded in PDFs must be JPEG/PNG.
- CrowdSec AppSec in Traefik: `crowdsecAppsecBodyLimit: 10485760` (10 MiB) (`/opt/infra/traefik/dynamic/
  middlewares/crowdsec.yml`) → keep any single request ≤ 10 MiB (behaviour above the limit not verified).
- Backup: `backup.sh` dumps **all** DBs dynamically but only backs up volumes listed in
  `FILESTORE_VOLUMES=(odoo_pool_a_data odoo_staging_data)` and expects a `filestore/` subdir
  (`restic-common.sh` L19, `backup.sh` L58–65) → ProyekKas media would **not** be backed up today.

## Decision

### 1. Storage now: local named volumes via Payload local storage
- Volumes `drms_pk_media_prod`, `drms_pk_media_stg` mounted at `/data/media` (rw) in web + worker.
- One upload collection per resize policy; `staticDir: /data/media/<slug>`; file names = server-generated
  UUIDv4 + extension (via `beforeOperation` renaming `req.file.name` — pattern verified in docs).
- **Abstraction for S3 later:** all app code reads/writes files only through Payload (Local API /
  upload fields) or a thin `FileStore` port (`read(collection, filename)`) used by the PDF renderer.
  Switching = add `@payloadcms/storage-s3@<pinned 3.x>` plugin with `collections: {…}` + env
  (endpoint/bucket/keys) + one-off copy of `/data/media` to the bucket. No schema change.

### 2. Media collections and targets (device compresses first — ADR 0010; server enforces)

| Collection | Content | `mimeTypes` (in) | `resizeOptions` (original) | `formatOptions` | `imageSizes` | Est. stored size |
|---|---|---|---|---|---|---|
| `media-receipts` | receipt photos/screenshots (US-07, reimburse at submit) | image/jpeg, image/png, image/webp, image/heic? (HEIC decode support in prebuilt sharp **UNVERIFIED** → APK sends JPEG) | `{width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true}` | `jpeg {quality: 82, mozjpeg: true}` | `thumb` 320 px webp q70 | ≈ 250–450 KB + 15 KB (ESTIMATE) |
| `media-transfer-proofs` | bank transfer proof (US-20) | image/jpeg, image/png, **application/pdf** (≤ 2 MB) | images: 1600 inside | `jpeg q80` | `thumb` 320 | ≈ 150–300 KB |
| `media-selfies` | attendance selfie (US-01) | image/jpeg | 720 inside | `webp {quality: 70}` | — | ≈ 30–60 KB |
| `media-progress-photos` | progress report photos (≤ 5/report, US-10) | image/jpeg | 1600 inside | `jpeg q78, mozjpeg` (JPEG so PDF reports can embed) | `thumb` 320 webp | ≈ 200–350 KB |
| `media-signatures` | user signature image / on-screen signature (form item 3) | image/png | 800×300 inside | `png {palette: true, compressionLevel: 9}` | — | ≈ 5–20 KB |
| `media-company` | company logo (PDF header) | image/png, image/jpeg | 600 inside | `png` | — | < 100 KB |
| `media-attachments` | other request attachments (quotes, PDFs) | application/pdf, image/jpeg, image/png | images 2000 inside | `jpeg q82` | `thumb` | ≤ 5 MB PDF |

Global: `upload.limits = { fileSize: 8 MiB, files: 5, fields: 30 }`, `requestSizeLimit: 10 MiB`
(fits AppSec 10 MiB); `pasteURL: false`, `crop: false`, `focalPoint: false` on every collection
(prevents SSRF and editing of evidence). `sharp.concurrency(1)` at boot (sharp `docs/src/content/docs/api-utility.md` §concurrency @v0.35.4) — note:
Payload uses the `sharp` instance passed in `buildConfig({ sharp })`, so configure that instance.
Legibility check for receipts: 2000 px long edge ≈ 170 dpi on a 30 cm thermal receipt — expected
legible (ESTIMATE); **F1 acceptance test** with the three receipts in the client form (Pertamina,
Soto Mas Joko, POP! Hotel screenshot) printed via the PDF (ADR 0008).

### 3. Keep or discard the original? → **Discard (Payload default when resizing)**, keep a fingerprint — **accepted by user 2026-09-23** (receipts kept at 2000 px long edge)
- Store `sha256Original` (hash of the bytes as received, computed in `beforeOperation` before sharp),
  `sha256Stored`, original width/height/size, `capturedAt` (device), `receivedAt` (server),
  `capturedLat/Lng` (from APK payload, **not** from EXIF — EXIF is stripped by sharp).
- Duplicate-receipt detection (form item 7) uses `sha256Original` + receipt no/vendor/amount.
- **Flag (client question):** Is the paper receipt the legal original (kept physically), making the
  digital copy a working copy? If DRMS needs pixel-original digital evidence, switch receipts to
  "keep original" = store original in a second, non-resized collection (+≈1–3 MB/photo).

### 4. Access control on files and time-limited URLs
- Each media collection `read` access returns a `Where` derived from the **owning document's** scope
  (e.g. receipt readable iff the parent expense-request is readable; selfies: own, PM of project, Finance
  for payroll, Owner/Admin). Media docs store `ownerDocType/ownerDocId` + `uploadedBy`.
- Files are fetched via `GET /api/<media-slug>/file/<filename>` (Payload-proxied, cookie auth for web). For
  the APK: `GET /api/v1/files/{collection}/{id}` with bearer (Traefik strips bearer on non-v1 paths).
- **Signed, time-limited URLs** (needed for: notification deep-links, `<img>` in contexts without
  headers): our own HMAC scheme `GET /api/v1/files/{collection}/{id}?exp=<unix>&sig=<base64url(HMAC-SHA256(
  key, collection|id|variant|exp|userId))>`; TTL 5 min; key rotated via env with 2-key overlap; still
  re-checks that `userId` has read access. Payload offers presigned URLs only for S3 (`signedDownloads`).
- Response headers via `modifyResponseHeaders`: `Cache-Control: private, no-store`,
  `X-Content-Type-Options: nosniff`, `Content-Disposition: inline` (PDF `attachment`).

### 5. Disk growth (ESTIMATE — client volumes are open questions)
Assumptions: 30 field staff, 22 workdays/month, 2 selfies/day; 150 expense requests/month × 4 receipts;
150 transfer proofs; 5 active projects × 22 reports × 4 photos.

| Stream | Monthly | Per year |
|---|---:|---:|
| Selfies 1 320 × 45 KB | 59 MB | 0.7 GB |
| Receipts 600 × (400 + 15) KB | 249 MB | 3.0 GB |
| Transfer proofs 150 × 250 KB | 38 MB | 0.45 GB |
| Progress photos 440 × (300 + 15) KB | 139 MB | 1.7 GB |
| **Total media** | **≈ 485 MB** | **≈ 5.8 GB** |
| Generated PDFs | 0 (rendered on demand, not stored; ADR 0008) | — |

Without server/device resize (typical 3–5 MB phone photos) the same volume would be ≈ 8–12× larger.

### 6. Backup (restic, platform ADR 0006)
- DBs `…drms…` are picked up automatically by `backup.sh` (dynamic `pg_database` list).
- **Required infra change:** add a generic `MEDIA_VOLUMES` list (volume root, no `filestore/` subdir) →
  `drms_pk_media_prod` (staging media optional). Order stays: DB dump first, files second.
- Reconciliation job `media.orphanSweep` (weekly) reports DB rows whose file is missing (possible after a
  restore when uploads happened between dump and file snapshot) and files without rows (never auto-delete
  evidence; report only).

## Alternatives

| Alternative | Rejected because |
|---|---|
| MinIO now (original lead prompt) | User decision #4: no MinIO until needed; +RAM (not budgeted) |
| Keep originals + derived sizes | 8–12× disk; EXIF GPS/PII retained; no requirement (pending client answer) |
| Client-side resize only | Server must not trust clients (brief §3); APK bugs/old versions would bloat disk |
| Store WebP for receipts | Not embeddable by `@react-pdf/renderer` (JPEG/PNG only) → extra conversion at PDF time |
| Public static dir + unguessable names | No access control; violates least privilege |

## Consequences

- Deterministic, small files; EXIF (incl. GPS) removed server-side — location evidence comes from explicit
  API fields instead.
- Server CPU spikes on upload (sharp); bounded by sharp concurrency 1 and 10 MiB request cap. **E9 P-1 (2026-09-27):**
  plus a process-wide FIFO queue (`apps/web/src/lib/image-queue.ts`, max `IMAGE_RESIZE_CONCURRENCY` = 2 jobs,
  `IMAGE_RESIZE_MAX_QUEUE` = 20 waiting → 503 + `Retry-After`), libvips cache off; upload target p95 < 5 s (user decision).
- Loss of the unprocessed original is irreversible for receipts (flagged to client).

## Security implications

- MIME allow-lists + sharp re-encode neutralise most polyglot/malformed-image payloads; PDFs are **not**
  re-encoded → size cap, `Content-Disposition: attachment`, never rendered inline in admin without
  sandbox; ClamAV optional later (CLAUDE.md §3.6 "opsional").
- `pasteURL: false` everywhere (SSRF). Filenames server-generated (path traversal).
- HMAC URL key compromise → attacker still needs a valid `userId` with access (re-check) — defence in depth.

## Rollback

Resize policy is config per collection → revert to previous config (new uploads only; existing files
unchanged). Storage switch to S3 is reversible by copying objects back to the volume and removing the
plugin. Backup change is additive.

## Proposed CLAUDE.md changes (need user approval; author does not edit)

None (backup script change goes to platform ADR 0006 revision by infra-engineer).

### 4a. As implemented (F2b, `develop` `59ba0a4`)

Verified in `apps/web/src/api/v1/endpoints/media.ts`, `tests/integration/files.int.test.ts`:
- The APK/file path is **`GET /api/v1/media/{collection}/{id}/file[?variant=thumb]`** (not `/api/v1/files/…`),
  `{collection}` ∈ `receipts | transfer-proofs | signatures | attachments | company`. Access = the media
  collection's own `read` access with `overrideAccess: false`; anything the caller may not read, unknown
  collection, non-numeric id or missing file → **404** (no existence leak; unknown `variant` → 400). A
  signature is additionally readable when referenced by an approval row of a request the caller may read.
  The stored filename comes from the DB and must resolve inside the collection's `staticDir`.
- Headers: `Cache-Control: private, no-store`, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
  `Content-Disposition` `inline` (PDF `attachment`). Transfer-proof reads audited **`view_sensitive`**
  (at most one row per user/file/10 min, in-process). Rate limit 240/min per user.
- ~~Signed, time-limited URLs are still open~~ → implemented in E9, see §4b.

### 4b. Signed, time-limited URLs — as implemented (E9, branch `feat/s3a-e9-hardening`)

Verified in `apps/web/src/lib/signed-url.ts`, `apps/web/src/api/v1/endpoints/media.ts`,
`tests/unit/e9-hardening.test.ts`, `tests/integration/e9-hardening.int.test.ts`:
- **Mint:** `GET /api/v1/media/{collection}/{id}/signed-url[?variant=thumb]` (bearer or cookie, same visibility as
  the download, else 404) → `{ url, expiresAt, ttlSeconds }`; `url` is **relative** to the API origin:
  `/api/v1/media/{collection}/{id}/file?[variant=thumb&]exp=<unix s>&uid=<user id>&sig=<b64url>`.
- **Scheme:** `sig = base64url(HMAC-SHA256(key, "pk-media-v1|collection|id|variant|exp|uid"))` (the §4 sketch plus a
  version label); TTL **300 s**, an `exp` more than TTL + 60 s in the future is refused. Keys: env
  `MEDIA_URL_KEYS` / `MEDIA_URL_KEYS_FILE` (comma separated, each ≥ 32 chars; the **first** signs, **all** verify →
  rotation = prepend the new key, drop the old one after ≥ 5 min). Unset → one key derived from `PAYLOAD_SECRET`
  with HKDF-SHA256 (own label; the secret itself is never the HMAC key) — so staging/prod need no new secret, and
  rotating `PAYLOAD_SECRET` invalidates outstanding URLs (harmless at 5 min).
- **Verify (same file endpoint):** a request with `sig` is a signed request — no session/bearer needed, and it never
  falls back to the cookie. Incomplete/malformed/tampered → **403** `code: URL_INVALID`; expired → **403**
  `URL_EXPIRED`; the `uid` must be an **active** user; then the normal read check runs **as that user** — no access
  (any more) → **403** `FORBIDDEN` + audit `access_denied` (field `signed_url`). Transfer proofs / other people's
  selfies stay audited `view_sensitive` under that user. Rate limit keyed on the claimed `uid`.
- **Unchanged:** without `sig` the endpoint behaves as in §4a (APK bearer / web cookie; anonymous 401; not
  readable 404 — no existence leak for normal reads). The signed path answers 403 (not 404) for "no access" because
  the E9 acceptance criterion requires it; the caller already holds a URL minted for that file.
- **Selfies** are now also served here (`{collection}` = `selfies`): uploader, office roles, and everyone who may
  read an attendance that references the selfie (same rule as `GET /api/v1/attendance/{id}/selfie`; since 0.21.1 the
  office roles get there through the attendance, see the 2026-10-25 revision); a retention
  tombstone (`removedAt`) → 404. Every response adds `Referrer-Policy: no-referrer` (the signed query must not leak
  through a Referer).
- **APK impact:** none required — the APK keeps using the bearer path (`progress_api.dart`, `expense_api.dart`).
  Optional: where a URL must be handed to a context without headers (share sheet, external viewer, WebView `<img>`,
  notification deep link), call `…/signed-url` and prefix the base URL; refresh on 403 `URL_EXPIRED`.

## Revision history

- **2026-09-23 (F0 gate):** accepted by user.
- **2026-09-23 (F1 foundation):** §2 slug confirmed as implemented: the company-logo collection is
  **`media-company`** (`apps/web/src/collections/media/index.ts`; referenced by `company-settings.logo` and
  the seed), **not** `media-company-logo`; the old slug was also corrected in `requirements-v1.1.md` §9 and
  `traceability-matrix.md` (US-57). Status stays accepted.
- **2026-09-24 (F2b):** §4a added, verified against `develop` `59ba0a4`: file endpoint
  `GET /api/v1/media/{collection}/{id}/file[?variant=thumb]` (other users' files → 404, transfer proofs audited
  `view_sensitive`); §4 signed URLs still open (F6). Status stays accepted.
- **2026-09-26 (E9, S3 track A):** §4b added — signed, time-limited media URLs implemented (HMAC-SHA256, TTL 5 min,
  key rotation via `MEDIA_URL_KEYS`, re-check of the user's access, 403 for expired/invalid/no access); selfies
  served by the media file endpoint. Status stays accepted.
- **2026-10-25 (D2510, web 0.21.1, user decision):** selfies have **no unaudited read path** any more. The Payload side
  of `media-selfies` — REST list / by id, `GET /api/media-selfies/file/<name>`, the admin library and upload
  previews — answers only the uploader's own rows (`selfieRead`); office roles (Admin, Direktur, Finance), Admin
  Staff and the PM of the team read a selfie only through `GET /api/v1/attendance/{id}/selfie` or
  `GET /api/v1/media/selfies/{id}/file` (+ signed URL), visibility = read access of the referencing attendance
  (Q-33), someone else's selfie audited `view_sensitive` (throttled per viewer + file). The Media → Selfie absensi
  library is hidden (`admin.hidden`: no admin menu / route, not in `/me/modules`). Upload (web + APK), check-in and
  the uploader's own capture are unchanged. Status stays accepted.
