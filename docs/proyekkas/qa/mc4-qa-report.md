# ProyekKas MC4 QA — multi-company security review + media-access performance (3 PTs)

- **Date:** 2026-10-01 · **Tester:** qa-security agent (Claude) for the Lead · **Branch:** `docs/mc4-qa` (worktree
  `/opt/src/proyekkas-wt/mc4-qa`), based on `origin/develop` `f9d0f92` (MC1–MC3 = v0.5.x + MC4 code gaps, PR #9).
- **Scope:** ADR 0016 risk #8 (isolation between PTs) on the whole `develop` tree, the MC4 code gaps (ADR 0016
  "Implementation notes (MC4)" 1–9), and the open MC2/MC4 item "media-access performance with 3 PTs".
- **Everything ran LOCALLY:** throwaway containers `pk-mc4qa-*` on a private docker network. There was no traffic
  to staging or prod, and Keycloak, `/opt/infra` and the staging/prod containers and DBs were not touched.
- **Result:** 4 HIGH findings were confirmed by a failing integration test and fixed on this branch (separate
  test → fix commits). No CRITICAL. 3 MEDIUM, 6 LOW and 9 INFO findings are open (§3). Isolation between PTs is
  sound in the `/api/v1` layer and in raw SQL. The HIGH findings were in the generic Payload REST layer
  (2), the audit trail (1) and media access (1).
- **Performance (local ESTIMATE, §5):**
  - On `develop`, a Finance user of 2 of 3 PTs opening ONE attendance selfie crashed the web process (V8 heap OOM
    at the ADR 0002 256 MiB heap), using one year of data for 3 PTs.
  - After the fix, media files take p95 0.1 s with media load alone and p95 0.3–0.9 s under the Q-34 mix across
    3 PTs.
  - Q-34 **× 3** (90 field + 15 office users) saturates the web CPU limit of 0.75 vCPU, and every target is missed.
    This is a capacity decision (P-1 in §5.4).

## 1. Method

| Area | How |
|---|---|
| Context | ADR 0016 (+ notes MC1–MC4), `mc/mc1..mc4-progress.md`, `mc2-contract.md`, requirements v1.2 (US-MC-14), `qa/s3-e9-qa-report.md` (load method, Q-34 mix), `uat/mc4-uat-report.md` (MC4-01) |
| Code review | Every `/api/v1` route with an id or company (91 routes), Payload REST `/api/<slug>/:id` access for the 30 per-PT collections + 7 media, media file endpoints (v1 file / signed URL / Payload static `/api/<media>/file/<name>`), request PDF, report exports, header `X-Company-Ids` + cookie `pk-company-ids` / `__Host-pk-company-ids`, the MC4 code (copy defaults, body `company`, `/app/config` OR flags, notification-template access, legacy scope literals, list-column migration) |
| Inventories | All 218 `overrideAccess: true` (§6). All raw SQL: 297 `sql` templates, 2 `sql.raw`, 54 `.execute(` in 33 files, about 117 functions (§7). Each one was classified by tracing it from the HTTP entry point. Three review sub-agents did the sweeps in parallel; every HIGH/MEDIUM claim was then re-checked by hand. |
| Confirmation | Integration tests against the CI replica: throwaway postgres 16.15 with `ci-bootstrap.mjs` roles, migrations as owner and tests as the app role; Mailpit with STARTTLS + AUTH and a throwaway CA, certificate SAN `pk-mc4qa-mailpit`. The HIGH findings are covered by `tests/integration/mc4-qa.int.test.ts` (committed). MEDIUM/LOW were checked with a scratch probe that was not committed, or by code reading where marked. |
| Performance | §5: local `next start` (standalone build of this branch) with the ADR 0002 limits, 3 fictional PTs with one year of data, and the Q-34 k6 mix plus a media scenario |

Baseline before any change (`f9d0f92`): integration **40 files / 528 + 1 skipped green** (same as `mc4-progress.md`).

## 2. Findings table

| ID | Sev | Component | Summary | Status |
|---|---|---|---|---|
| QA-MC4-01 | **HIGH** | `access/policies.ts:76-85` `rolesAllowed` × `fields/company.ts:105-111` | A REST create of a derived-company document (PT copied from the parent) that names the caller's own PT A in the body skips the role check in the parent's PT B | **fixed** `f4a4931` (test `96702e5`) |
| QA-MC4-02 | **HIGH** | `collections/Users.ts:81` update access (`usersOfMyCompanies`) | The Admin of PT A can rename, deactivate or change the e-mail (synced to Keycloak) of accounts that also belong to PT B, including group admins | **fixed** `87906f8` (test `96702e5`) |
| QA-MC4-03 | **HIGH** | `audit/writer.ts`, `collections/AuditLogs.ts:68`, `domain/reports/registry.ts:1024`, `dashboards.ts:343` | Audit rows of PT B documents written without a PT, and all untagged rows, are readable by the Admin / Direktur of any PT. This exposes request lines with amounts and descriptions, signatures, PDF exports and doc numbers | **fixed** `74ba23b` (test `ff03b4e`) |
| QA-MC4-04 | **HIGH** (availability) | `collections/media/index.ts:37-85` office media rules | Reading one media file as an office user in a subset of the PTs loads every attendance / request / report of those PTs. With 3 PTs × 1 year this is 3.6–4 s and more than 400 MiB per selfie, which ends in a heap OOM crash of the whole web process | **fixed** `8f07103` + `b8d70c1` (tests `6bcb8d4`, `c3e35e5`) |
| QA-MC4-05 | MEDIUM | `collections/media/index.ts` `officeScope` (`all = active.every(...)`) | Once PT B is **deactivated**, the office users of the remaining PTs read every media row, B's included | **fixed** on `feat/mc4-pt-scope-rule` (§11) |
| QA-MC4-06 | MEDIUM | `domain/expense/receipts.ts:389` `duplicateHits` | Duplicate-receipt detection searches all PTs. A flag on a PT A request names the PT B doc number (`flags.ts:144`) and links `relatedRequest` to B; this also works as an oracle ("does B hold this receipt?") | **fixed** (owner decision 2026-10-02) on `feat/mc4-pt-scope-rule` (§11) |
| QA-MC4-07 | MEDIUM (perf) | media LIST rules (admin lists, upload population, `/api/<media>?…`) | They still use id lists: 0.5–1.7 s per list after the fix. A Postgres bind limit of 65 535 parameters will break them once one office user's PTs exceed about 65 k attendances (about 2 years at Q-34 × 2 PTs) | **fixed** on `feat/mc4-pt-scope-rule`: `ownerCompany` column + migration (§11) |
| QA-MC4-08 | LOW | `domain/progress/stages.ts:43` `templateStages` | `PUT /api/v1/projects/{A}/stages {templateId: <B template>}` copies PT B's stage names and weights into A and returns them. Confirmed by probe (200) | **fixed** (§11) |
| QA-MC4-09 | LOW | `domain/expense/drafts.ts:75-78,104,134-139` | The on-behalf check (Q-09) uses a role from another PT on a draft without a project (Admin in A + Staff in B → a draft for B employees). Submit or a body `company` rejects it later. Code review only | **fixed** (§11, `fix/mc4-qa-open-items`) |
| QA-MC4-10 | LOW | `drafts.ts:65,117,123,145`, `cash/ledger.ts:98` (+ `transfers.ts:47`, `lpj.ts:209`), `progress/guards.ts:29` | Validation messages answer before the PT check, so they work as oracles for other PTs: the project/cost-center archived or finished state, which B employee owns bank account Y, **PT B's lock date** (settle with a B cash account → 409 "tutup buku s/d …"), project/stage `progressPct = X`. Writes are blocked by the hooks and triggers | **fixed** (§11) |
| QA-MC4-11 | LOW | `collections/media/index.ts` `MediaCompany` read = `anyRole` | Logos of all PTs are readable by any user (the ADR says "members of that PT") | **fixed** (§11) |
| QA-MC4-12 | LOW | `media/index.ts` `officeSignatures`, `domain/devices.ts:123` `canRevoke` | Inactive memberships still count: office users of A read signatures of former members, and Admin/Owner of A can revoke the device of someone who now works only in B | **fixed** (§11) |
| QA-MC4-13 | LOW (tooling) | `tests/unit/mc2-sql-lint.test.ts` | The lint does not scan `domain/expense|progress|addendum|sync`, misses 7 per-PT tables, and `company_id\s*(=|IN)` also accepts join conditions (`ws.company_id = e.company_id`) | **fixed** (§11, `fix/mc4-qa-open-items`) |
| QA-MC4-14 | INFO | various | `attachmentIds` on drafts: uploader not checked (no read impact). `employees.faceRefPhoto`: PT not checked. Sync replays return a stored result for 30 days after a PT is lost. `/me` without a membership shows the name of PT #1. Notifications of a PT the user left stay readable (own rows). `?pt=` / `?company=` / the period-closing fallback narrow silently. `lockRequest` row-locks before the visibility check (no data). `displayNames` falls back to an employee name from another PT. Existence-only oracles (sync `COMPANY_MISMATCH` vs `NOT_FOUND`, body-company `COMPANY_MISMATCH`, addendum 404 vs 403, REST "cross-company reference"). | **fixed / accepted** (§11): `/me`, notifications, `faceRefPhoto`, `displayNames`, `?pt=` (+ period-closing view), the sync / body-company / addendum oracles fixed; the rest accepted with reasons |

There is no CRITICAL. Areas checked and found OK are listed in §4.

### 2.1 HIGH findings — detail and fixes

**QA-MC4-01 — cross-PT create of derived documents (bank accounts, team assignments, budget lines, project stages)**

- **Exploit (authorised test, PT A = DRMS, PT B = fictional CQA):**
  - Finance of A only sends `POST /api/employee-bank-accounts {company: A, employee: <employee of B>, accountNo: <attacker>, isDefault: true, verificationStatus: "verified"}`. Actual: **201, row in PT B** (`company_id = B`). Expected: 403.
  - On a B request, an empty `bankAccount` means "the requester's default account", so a B payout could be redirected.
  - Same with `POST /api/team-assignments {company: A, employee: <own B employee>, project: <B project>, roleInProject: "pm"}` by an Admin of A who is only Staff in B: 201. This makes the caller PM of a B project and widens their B scope.
  - Same with `POST /api/budget-lines {company: A, project: <B project>, …}` by the Direktur of A: 201.
- **Cause:** with a body `company`, `rolesAllowed` checked the role in A and returned `true` without arming the `companyHook` re-check. On derived collections, field access drops `company` and the hook copies the parent's PT B. The DB trigger accepts the row because every reference is in B.
- **Fix `f4a4931`:** `rolesAllowed` always sets `PENDING_CREATE_ROLES`, so the hook re-checks the role in the resolved PT. Every collection using `rolesAllowed` has `companyHook` (18 checked).

**QA-MC4-02 — PT Admin changes cross-PT accounts (takeover / lock-out of a group admin)**

- **Exploit:**
  - The Admin of A (not a group admin) sends `POST /api/company-memberships {user: <group admin G, member of B only>, company: A, roles: [pk-staff]}` → 201. Adding a person of another PT stays allowed (onboarding).
  - Then `PATCH /api/users/G {name | email | active: false}` → **200**. The change is synced to Keycloak, and deactivation ends every session and device of G.
  - A group admin without any membership can be changed directly.
- **Fix `87906f8`:**
  - Users **update** for a PT Admin is limited to accounts whose ACTIVE memberships are ALL in PTs where the caller is Admin, plus accounts without a membership (onboarding). Group admins are never included.
  - Group admins keep managing everyone. Read access is unchanged.
  - **Behaviour change for the owner:** a person active in two PTs can now be edited only by a group admin or by someone who is Admin in both PTs.

**QA-MC4-03 — audit trail of PT B readable by the Admin/Direktur of PT A**

- **Probe and test:**
  - A B-only staff member creates and submits a request, then downloads its PDF.
  - The rows `create/lines` (amount 4 321 000, description), `sign/dibuat`, `sign/diajukan` and `export/pdf` had `company_id NULL`.
  - Admin and Direktur of A (not group admins) saw them through `GET /api/audit-logs`, and the audit-log report contained B's doc number. They also saw untagged rows of B users, such as uploads and the signature profile.
- **Fix `74ba23b`:**
  1. `writeAudit` derives `company` from the document when the call site passes none (a map from `docType` to the 15 per-PT tables; `docId` is the row id; constant SQL fragments).
  2. Rows without a PT are readable only by group admins and by the Admin/Direktur of **every active PT** (`mayReadUntaggedAudit`). This applies to REST access, the report (`auditCompanies`) and the admin dashboard.
  - A single-PT deployment (staging / prod today) behaves as before.
  - Old untagged rows on staging (DRMS only) therefore stay hidden from the Admin of a future CS1.
  - No data migration (audit rows are append-only and hash-anchored).

**QA-MC4-04 — media access per file loads PT-wide id lists → web crash**

- **Measured locally (§5.2):** Finance of PT 1+2 with 3 PTs active and one year of data.
  - With the production heap of 256 MiB: one receipt file takes 2.9 s, and **one selfie file crashes the web process** ("Ineffective mark-compacts near heap limit").
  - With a 1 200 MiB heap: selfie 3.6–4.0 s, RSS 510 MiB.
  - Cause: `idsOfCompanies` ran `payload.find` over 31 200 attendance DOCUMENTS (1.7–2.5 s, ~300 MiB heap) to build `id IN (…31 200…)`. Receipts did the same over 4 800 requests, plus `visibleRequestIds`.
- **Fix `8f07103`:** a single-row read (`findByID` → v1 file / signed URL; Payload static file by `filename` or thumbnail name) first resolves that row's owner link. It then evaluates the same per-PT rules against that one request / report / attendance with `limit 1` queries.
  - The test asserts the same 200/404 answers (A selfie 200, B selfie 404, B receipt 200 for B Finance / 404 for A Finance, signed URL, static file), with no PT-wide loads.
- **Fix `b8d70c1` (list path):** the id lists now come from plain SQL with the same company predicate, on the request transaction when there is one. This took 31 200 ids from 1.7–2.5 s to 43 ms. The `IN` size is unchanged, which is why QA-MC4-07 stays open.

## 3. Open MEDIUM / LOW — recommendations

| ID | Recommendation | Owner |
|---|---|---|
| QA-MC4-05 | `officeScope.all` must compare against **all** companies (active or not), or media of an inactive PT should need group admin. Confirmed by probe: `GET /api/v1/media/receipts/{B}/file` as Finance of A was 404 while B was active and **200** after B was deactivated; the list contained it too. | nextjs |
| QA-MC4-06 | Decide whether duplicate detection is group-wide. If yes, redact the other PT's doc number and do not link `relatedRequest` across PTs; if no, add `e.company_id = <request PT>`. | owner + nextjs |
| QA-MC4-07 | Add a `company_id` column to the owner-linked media tables (receipts, transfer proofs, attachments, progress photos, selfies), backfilled from the owner document / attendance and set when the link is made. The office rule then becomes `company IN (…)`. This removes the 65 535-parameter ceiling. | nextjs (migration) |
| QA-MC4-08 | `templateStages`: require `template.company = project.company`, else return the same 400. | nextjs |
| QA-MC4-09 | Evaluate the Q-09 on-behalf role in the derived PT (that of the requesters / employees). **Done** (§11). | nextjs |
| QA-MC4-10 | Run the PT/scope check before validation in `validateContent`, `activeIds` and `assertAccount` (pass the expected company), and return 404 for other PTs. `progressWriteGuard`: check access before comparing values. | nextjs |
| QA-MC4-11 / 12 | `media-company` read → members of that PT (or keep public and record the decision). Filter memberships on `active` in `officeSignatures` / `canRevoke`. | nextjs |
| QA-MC4-13 | Extend `mc2-sql-lint` (scope, tables, bound-parameter rule), see §7. **Done** (§11). | nextjs / qa |

## 4. Checked and OK (coverage)

- **Header / cookie spoofing:**
  - `X-Company-Ids` and the cookie only narrow: the selection is ∩ active memberships, re-read from the DB on every request (`access/company-context.ts:77-102`).
  - A foreign or malformed header → `/api/v1` 403 `COMPANY_NOT_ALLOWED` + audit; generic REST uses the intersection.
  - The switcher `POST /api/v1/me/companies` validates against memberships and sets an HttpOnly cookie.
  - `withCompanyContext` puts the context after the user spread (a stored field cannot override it). Mutations use `rolesIn` of the document's PT.
  - No path where the selection widens access was found.
- **`/api/v1` (91 routes):**
  - Expense requests (all transitions, receipts, flags, transfer/void, settle/reverse, history, PDF incl. the internal variant), cash, period closings, approvals inbox, transfer / LPJ queues, progress (stages, reports, K-09), addenda (10 routes), attendance (own, recap, team today, correction, selfie), sync batch (`company_id`, `COMPANY_MISMATCH`, on-behalf), notifications, masters, membership batch, `/me`, devices, `admin/test-email`, `app/config`.
  - Each loads with the caller's access or with a SYSTEM-READ followed by a role check in the document's PT.
- **Generic REST:** none of the 30 per-PT collections is company-blind; `fieldRoles` on update sees the stored document.
- **Reports and exports:** the scope is built per PT, id filters are AND-ed with the scope, the letterhead comes only from PTs in scope, and the legacy scope literals match nothing (MC4 note 7).
- **`sql.raw`** (2 uses): safe — `scope.ts:195` alias regex `^[a-z][a-z0-9_]{0,15}$` with literal columns; `attendance/queries.ts:87` alias typed `'a' | 'ta'`. No string concatenation into SQL anywhere.
- **MC4 code gaps:**
  - Companies create and "copy defaults" (incl. `copyDefaultsFrom`) are group-admin only.
  - The body `company` (`withNamedCompany`) checks the role IN that PT and reference PTs (only an existence oracle, INFO).
  - `/app/config` exposes only an OR of three booleans (no PT id, name or count).
  - Notification templates: write = group admin, read = Admin / Direktur.
  - The list-column migration uses a constant slug list as bound parameters, guarded to `*_owner`, and touches preferences only.
- **Next route handlers and server actions:** auth callback, logout, account action, APK download and `assetlinks` serve no per-PT data. There are no collection `endpoints:`.

## 5. Media-access performance with 3 PTs — **local single-host ESTIMATE**

### 5.1 Setup

| Item | Value |
|---|---|
| App | Standalone `next build` of this branch, run as `node apps/web/server.js` in `node:24.21.0-bookworm-slim`. Limits as staging/prod web: **`--memory 384m` (no swap), `--cpus 0.75`, `NODE_OPTIONS=--max-old-space-size=256`, `DATABASE_POOL_MAX=5`**, `NODE_ENV=production`, `TZ=Asia/Makassar`. The worker was not running. There was no Traefik/CrowdSec; traffic stayed on a private docker network. |
| DB | `postgres:16.15-bookworm` (`--memory 1g`), DB `pk_perf` with roles `pk_perf_owner` / `_app` / `_ro`. Migrations ran as owner; the app connects as `_app`. |
| Auth | Bearer path as in the APK, through `tests/load/mc4/fake-idp.mjs`: a local RS256 JWKS plus password/refresh grant, signing any username — throwaway only, never deployed. The app verifies tokens unchanged (JWKS, `iss`, `azp`, `typ`, `pk-user`). Devices are registered by k6 via `POST /devices/register`. |
| Data (`tests/load/mc4/seed-3pt.ts` + `bulk-3pt.sql`) | 3 active PTs (DRMS + fictional CS1, CS2), each with 30 field + 3 office accounts (Finance, Direktur, PM), 4 projects × 3 stages, sync flags on. Plus 6 cross-PT office accounts: Finance 1+2, Finance 2+3, Finance 1+2+3, Direktur 1+2, Direktur 1+2+3, PM 1+3. **One year per PT:** 2 400 requests × 3 receipts = 7 200 receipt photos (**2 × Q-34** volume); 30 × 2 × 260 attendances = 15 600 selfies; 1 000 progress reports × 2 photos. **Totals: 21 600 receipt photos, 46 800 selfies, 6 000 progress photos (74 400 media rows), 7 200 requests, 46 800 attendances.** Files are hard links to the k6 fixtures (`photo.jpg` 295 KB, `selfie.jpg` 84 KB). |
| Load | k6 v2.3.0 (`grafana/k6`, same version as E9). `tests/load/q34-mix.js` is unchanged except an optional per-account `pid` (the project of that account's PT; without it the script behaves as in E9). The new scenario `tests/load/mc4/media-3pt.js` runs per iteration: request list → detail → up to 3 receipt thumbs + 1 file → progress-report list + 1 photo thumb → 1 selfie of the caller's PTs. Profile: 1 min ramp, 8 min hold, 30 s down, with think times as in Q-34. |
| Host | The production VPS (4 vCPU, shared with prod). Resources were sampled every 5 s. There was no traffic to prod. |

### 5.2 Single requests (no load) — before / after the fix (Finance of PT 1+2 = id-list path)

| Request | `develop` `f9d0f92` code | after `b8d70c1` |
|---|---|---|
| `GET /api/v1/media/receipts/{id}/file` | 2.9 s (256 MiB heap); 1.8–1.9 s (1 200 MiB heap) | 34–60 ms |
| `GET /api/v1/media/selfies/{id}/file` | **web process crash (heap OOM)** at 256 MiB; 3.6–4.0 s and RSS 510 MiB at 1 200 MiB | 31–94 ms |
| same, Finance of PT 1 only / of all 3 PTs | (id-list path / all path) | 36–71 ms / 33–126 ms |
| `GET /api/media-selfies?limit=25` (admin list) | 10.7–13.4 s, RSS 306 MiB | 1.3 s (first call 4.6 s) |
| `GET /api/media-receipts?limit=25` | 2.8–3.2 s | 1.7 s |
| `GET /api/attendances?limit=25&depth=1` (populates the selfie) | 10.3–13.2 s | 0.62–0.68 s |
| same lists, Finance of PT 1 only | 3.4 s / 1.2 s / 3.4 s | 0.5 s / 0.75 s / 0.35–0.42 s |

### 5.3 Load runs (build `b8d70c1`)

| Run | Load | Result |
|---|---|---|
| **R1 — Q-34 × 3** | 90 field (30 per PT) + 15 office + 15 media VUs | **CPU-bound**: web CPU p50 77 % / p95 92 % of one core with a 0.75 limit; host load1 max 5.7. Every p95 is over target: uploads 20.7–23.8 s; `/me` 12.3 s; check-in 7.3 s; draft (`/sync/batch`) 10.3 s; dashboard 10.6 s; inbox 10.9 s; media file 9.9–13.1 s. 53× 503 `UPLOAD_BUSY`, 3 uploads gave up. **RAM peak 285.5 MiB (74 % of 384 MiB, below the 307 MiB flag), 0 OOM, 0 restarts.** |
| **R2 — media only** | 15 media VUs (5 min) | p50 21–38 ms, **p95 102–133 ms** for every media action (receipt thumb / file, selfie file, photo thumb, request list / detail, report list). RAM peak 223.5 MiB, CPU p95 28 %. The 13 failed checks are expected 404s: PM personas asking for selfies outside their team. |
| **R3 — Q-34 × 1 over 3 PTs** | 30 field (interleaved across PTs) + 5 office (Finance 1+2, Direktur 1+2+3, Finance PT2, PM PT3, PM 1+3) + 5 media VUs | Field p95: selfie upload 1.72 s, receipt upload 2.40 s, check-in 0.95 s, draft 2.06 s, `/me` 0.70 s, masters 0.71 s, request list 0.49 s, dashboard/me 0.27 s. Office p95: progress report 2.02 s, photo upload 2.26 s, dashboard **2.46 s**, approvals inbox **3.28 s**, transfer queue 0.40 s, report 0.74 s, projects progress 0.64 s. **Media p95: receipt file 0.68 s, receipt thumb 0.53 s, selfie file 0.36 s, photo thumb 0.30 s, request list 0.72 s / detail 0.86 s, report list 0.84 s.** RAM peak 295.6 MiB (77 %), CPU p50 42 % / p95 81 %, 0 OOM. Errors: field 0.16 %, office 0 %; the media errors are the PM 404s above. |

**Against the documented targets** (E9: uploads p95 < 5 s, other actions < 2 s, `/sync/batch` < 5 s per decision
P-1b; requirements v1.2: "konsolidasi 3 PT, volume Q-34 × 3, p95 E9"):

- **Media access (the MC2/MC4 open item):** passes after the fix (R2 p95 ≤ 0.13 s, R3 p95 ≤ 0.86 s).
  On `develop` it fails hard: one request crashes the process.
- **Q-34 × 1 over 3 PTs (R3):** uploads, check-in and sync are within target. Consolidated **dashboard (2.46 s)**
  and **approvals inbox (3.28 s)** are over 2 s. Caveat: the synthetic data leaves 10 % of all requests in
  `pending_approval`, so inboxes hold about 240 items per PT, far more than real use. Measured unloaded, these
  calls take 0.3–0.8 s.
- **Q-34 × 3 (R1):** fails across the board because the web container is CPU-saturated at 0.75 vCPU (sharp
  resizes + 105 users), as already seen in E9 P-1. RAM stays within the ADR 0002 limit.

### 5.4 Performance findings

| ID | Sev | Finding | Next step |
|---|---|---|---|
| P-1 | MEDIUM (capacity, decision) | Q-34 × 3 on one web container with `cpus 0.75` is CPU-saturated: every p95 is over target, while RAM is fine (74 %). | Owner/Lead: raise web `cpus` (e.g. 1.5, RAM unchanged), move image resize to the worker (ADR 0002 §6 b), or accept a lower concurrent load. Then repeat R1 **on staging after the redeploy**. |
| P-2 | LOW | Consolidated owner dashboard and approvals inbox p95 2.5 / 3.3 s at Q-34 × 1 with 1-year data (inflated inbox, see above) | Re-measure on staging with realistic data; if confirmed, profile `approvalInbox` / `ownerDashboard` for multi-PT users |
| (QA-MC4-07) | MEDIUM | Media list path (admin lists, upload population) is still id-list based: 0.5–1.7 s, and capped at 65 535 parameters | company column on media (§3) |

All numbers are a **local single-host estimate**: no Traefik/TLS, no worker, a fake IdP, synthetic data at 2×
Q-34 request volume, and the production host's 4 vCPU shared with the running prod stack.

## 6. SYSTEM-READ inventory (`overrideAccess: true`, base `f9d0f92`, migrations excluded)

218 occurrences in 60 files, each traced to its HTTP entry point:

| Class | Count | Meaning |
|---|---:|---|
| AUTH | 19 | authentication, company-context resolution, sessions, devices |
| SYSTEM | 42 | jobs, seed, import CLI, numbering, audit writer, the cross-PT check itself |
| CHECKED | 124 | result is a document whose PT role is checked before any data or side effect (`assertCompanyAccess`, `hasRole(req, …, doc.company)`, id from an access-controlled read) |
| FILTERED | 5 | query carries a company predicate from the caller's memberships |
| SHARED / APP-WIDE | 21 | shared masters, app-wide global, the caller's own rows |
| **NEEDS-FILTER** | 6 | `stages.ts:43` (QA-MC4-08); `progress/guards.ts:29`, `drafts.ts:117,123,145`, `cash/ledger.ts:98` (oracles, QA-MC4-10) |
| UNSURE | 1 | `drafts.ts:65` `activeIds` (existence oracle, QA-MC4-10) |

Per group:

| Group | Total | Classes |
|---|---:|---|
| access / auth | 19 | 15 AUTH, 3 SYSTEM, 1 SHARED |
| api/v1 | 12 | 5 CHECKED, 6 SHARED, 1 AUTH |
| collections | 6 | 4 CHECKED, 1 FILTERED, 1 SHARED |
| domain | 144 | 112 CHECKED, 9 SYSTEM, 9 SHARED, 4 FILTERED, 3 AUTH, 6 NEEDS-FILTER, 1 UNSURE |
| admin / app | 4 | 4 SHARED |
| jobs / seed / import / pdf | 33 | 30 SYSTEM, 3 CHECKED |

The largest CHECKED files are `domain/expense/receipts.ts` (18), `import/run.ts` (17, SYSTEM), `domain/companies.ts` (13), `domain/addendum/service.ts` (9), `cash/ledger.ts` (9) and `seed/seed.ts` (9, SYSTEM).

**Delta of this branch:**
- +1 in `Users.ts` (the update rule reads the active memberships).
- +2 in `media/index.ts` (the owner link of the one row being read; the owner-document check `limit 1`).
- The PT-wide `payload.find` in `idsOfCompanies` is replaced by SQL with a company predicate.

All new uses are annotated `SYSTEM-READ` (Semgrep rule `payload-local-api-implicit-override-access`: 0 findings).

## 7. Raw-SQL inventory and the Semgrep proposal

**Inventory (base `f9d0f92`):** 297 `sql` templates, 2 `sql.raw` and 54 `.execute(` in 33 files, about 117 functions.

| Class | Functions |
|---|---:|
| SCOPED (scope helpers, `companyScopeSql` / `ptSql` / `ledgerWhere` …) | ~48 |
| BOUND (one checked document / id, or ids from a scoped list) | ~17 |
| SYSTEM (per-PT jobs with explicit `company_id`, numbering, locks, health, audit anchor) | ~22 |
| NON-PT (`users`, `idempotency_keys`, `sync_receipts`, `mail_rate_buckets`, `holidays`, …) | ~14 |
| **GAP** | 2 |

- The two GAP functions are the untagged audit read (QA-MC4-03, fixed) and `duplicateHits` (QA-MC4-06, open).
- `sql.raw`: both uses are safe (§4).
- Caller-supplied filters (`?pt=`, project / cost-center / account / category / vehicle ids) are always AND-ed
  with the scope and never widen it.
- Largest files: `reports/kpi.ts` 122 templates (SCOPED); `reports/audit-log.ts` 19; `reports/scope.ts` 19 +
  1 raw (helpers); `attendance/queries.ts` 19 + 1 raw; `reports/registry.ts` 18.

**Delta of this branch:**
- `audit/writer.ts`: 1 template, `SELECT company_id FROM <constant table> WHERE id = <docId>` (BOUND).
- `collections/media/index.ts`: 4 id-list templates, each with `company_id IN (<caller's office PTs>)` (SCOPED).

**Semgrep rule, evaluated and NOT added to `.semgrep/proyekkas.yml`.** It flags a `sql` template over a per-PT
table that sits in no enclosing function containing a company helper:

```yaml
  - id: raw-sql-per-pt-without-company-predicate
    languages: [typescript]
    severity: ERROR
    message: Raw SQL over a per-PT table without a company predicate in the enclosing function (ADR 0016 security model).
    paths: { include: ["/apps/web/src/**"], exclude: ["/apps/web/src/migrations/**", "/apps/web/src/import/**", "/apps/web/src/seed/**"] }
    patterns:
      - pattern: sql`...`
      - pattern-regex: (?is)\b(FROM|JOIN)\s+"?(expense_requests|approvals|receipts|receipt_flags|transfers|cash_entries|cash_accounts|settlements|budget_addenda|budget_lines|progress_reports|attendances|attendance_corrections|projects|project_stages|cost_centers|employees|employee_bank_accounts|team_assignments|period_closings|audit_logs|company_memberships|…)\b
      - pattern-not-inside:
          patterns:
            - pattern-either:
                - pattern: function $F(...) { $...BODY }
                - pattern: ($...P) => { $...BODY }
                - pattern: ($...P) => $BODY
            - metavariable-regex:
                metavariable: $...BODY
                regex: (?s).*([A-Za-z]+ScopeSql\(|employeeCompanySql\(|candidateWhere\(|ptSql\(|ledgerWhere\(|\bwhere\(f|company_id\s*(=|IN)\s*\(?\$\{|FOR UPDATE)
```

It was run with semgrep 1.177.0 on this tree and produced **21 hits in 13 functions**:
- 3 hits are the one true positive, `duplicateHits` (QA-MC4-06).
- 18 hits in 12 functions are false positives, all BOUND or SYSTEM: `effectiveTime`, `currentSchedules`, `employeeRef`, `dayRowsAt`, `selfieState`, `requestPeople`, `attendanceMonth`, `projectCommitted`, `writeSnapshot`, `approvedByCaller`, `reportContext` (constant fragments) and the `auditDailyAnchor` job (`jobs/tasks.ts:36`).

Comments are not part of `$...BODY` for `metavariable-regex` (verified), so a `PT-BOUND:` marker cannot exempt a
function. Every bound function would need a `nosemgrep` line, which repeats the per-function allow-list that
`tests/unit/mc2-sql-lint.test.ts` already keeps with reasons.

**Recommendation (QA-MC4-13):** keep the unit-test lint as the gate and extend it:
- Scan `domain/expense`, `domain/progress`, `domain/addendum` and `domain/sync`.
- Add `approvals`, `budget_addenda`, `project_stages`, `attendance_corrections`, `employee_bank_accounts`, `company_memberships` and `document_sequence_counters`.
- Require a bound parameter after `company_id =|IN` (closes the join-condition loophole).
- Allow-list `duplicateHits` as a known gap until QA-MC4-06 is decided.

The CI Semgrep command (OWASP + TypeScript + project rules, `--error`) is clean on this branch.

## 8. Checks run on this branch (before push)

| Check | Result |
|---|---|
| `npm run lint` | 0 warnings |
| `npm run typecheck` | clean |
| `npm run test:coverage` | 45 files / 647 tests green (gate met) |
| `npm run check:openapi` | up to date (no API shape change) |
| `TZ=Asia/Makassar npm run test:int` (CI replica) | **41 files / 544 passed + 1 skipped** (baseline 40 / 528 + the 16 tests of `mc4-qa.int.test.ts`) |
| `npm audit --omit=dev --audit-level=high` | exit 0 (moderate/low unchanged, Payload-pinned) |
| semgrep 1.177.0, CI command | 0 findings (`--exclude .next` locally: the local build output is not in a CI checkout) |

There are no migrations, no new dependencies and no OpenAPI changes, and `apps/mobile` is untouched.

## 9. Remaining MC4 items

1. **Staging redeploy** of this branch once it is merged to `develop`. All 4 fixes are code-only: no migration,
   no env change.
2. **ZAP baseline rerun** (anonymous + authenticated) against staging after the redeploy.
3. **Load test on staging** after the redeploy:
   - R1/R3 with the `lt-*` accounts spread over 3 PTs. This needs the CS1/CS2 fixture, which is blocked by UAT B-1/B-2.
   - Decide **P-1** (web CPU for Q-34 × 3) first.
   - The k6 scripts of this branch (`q34-mix.js` with `pid`, `mc4/media-3pt.js`) are ready; on staging use the real Keycloak token URL, not the fake IdP.
4. **UAT** (`uat/mc4-uat-report.md`): blocked by B-1 (fictional group admin, owner step) and B-2 / **MC4-01**
   (`pk-user` missing from the client scope mappings, infra). Add the isolation sweep for QA-MC4-01..04 to the
   UAT security pass.
5. **APK phone test** on a real device (PT switcher, per-PT outbox).
6. Open MEDIUM items QA-MC4-05/06/07 (nextjs, one owner decision for QA-MC4-06), P-1 (owner/Lead), and the
   LOW / INFO list.
7. The prod check of MC4-01 is still open (UAT report §6).

## 10. Housekeeping

- Containers / network `pk-mc4qa-{net,pg,mailpit,node,web,idp,k6-*,semgrep}` were removed by exact name after the
  run; no `docker prune` was used.
- Throwaway passwords, the session cookies of the perf DB, the k6 env files and the Mailpit CA lived only in the agent
  scratchpad (mode 600) and were never printed or committed.
- No staging/prod/Keycloak/infra access.
- Committed test tooling (local only): `tests/integration/mc4-qa.int.test.ts`; `tests/load/mc4/{seed-3pt.ts,bulk-3pt.sql,fake-idp.mjs,media-3pt.js}` (each refuses or is documented as throwaway-only: `pk_perf*` DB guard, fake IdP never deployed); `tests/load/q34-mix.js` (optional `pid`).

## 11. Follow-up — PT scope rule (owner decision 2026-10-02)

**Decision:** read and search scope = the PTs a user is MAPPED to (active memberships in active PTs); ≥ 2 PTs =
consolidated over those PTs only; group admin unchanged (ADR 0016 §2); mutations single-PT. Implemented on
`feat/mc4-pt-scope-rule` (ADR 0016 "Implementation notes — Scope rule"), migration `20261002_080000_mc4_scope_rule`.

| ID | Status | Fix |
|---|---|---|
| QA-MC4-06 | **fixed** | Search per receipt over the request's PT + the PTs the **uploader** is mapped to. A cross-PT hit is stored with `related_company_id` and shown **only** to viewers mapped to that PT; everyone else sees **nothing** of it (chosen over a neutral "possible duplicate" text, which would still tell a viewer of PT A only that another PT holds the receipt). Applied to the request detail, internal PDF, REST, inbox / transfer-queue / KPI counts, the verify-all gate, the review endpoint (404), Riwayat and the audit rows (written without PT). Stored `approvals.openFlags` counts same-PT flags only. |
| QA-MC4-05 | **fixed** | The office "every PT" shortcut compares with ALL companies (active or not); untagged audit rows follow the same rule. |
| QA-MC4-07 | **fixed** | `owner_company_id` on the five owner-linked media tables, derived by DB triggers (client values replaced), backfilled by the migration; office rule `ownerCompany IN (…)`; the "visible owner" id lists leave out the office PTs (also for receipt / flag / approval / transfer REST lists). |
| QA-MC4-08 / 10 / 11 / 12 | **fixed** | Template of the project's PT only; draft references, cash account and `progressPct` of an unmapped PT answered like missing ones; logos for members of the PT; ACTIVE memberships only for signatures / device revoke. |
| QA-MC4-14 (part) | **fixed** | `/me` without membership names no PT; notifications of a PT the user left are hidden. |
| QA-MC4-09 | **fixed** (`fix/mc4-qa-open-items`) | see "Follow-up — open items" below |

**Tests:** `tests/integration/mc4-scope.int.test.ts` (21: 1-PT user, 2-PT user over A + B, 2-PT user vs unmapped C →
404 / 403 / no flag, deactivated PT, duplicate-flag visibility per viewer, LOW findings); `tests/unit/mc4-scope.test.ts`
(7). The QA-MC4-05 test fails on the old rule (200 instead of 404) and passes with the fix. `e9-hardening` selfie test:
the selfie is now linked to an attendance (an unlinked upload has no PT).

**Migration check on a seeded copy** (local throwaway DB, `seed-3pt.ts` + `bulk-3pt.sql` = 3 PTs × 1 year, 74 400
media rows with `owner_company_id` empty as before the migration, plus 6 synthetic duplicate flags): down → columns
gone; up → backfill **12.1 s**, 0 rows with a wrong PT (receipts, progress photos, selfies, flags), 4 cross-PT flags
tagged; up again → 0.27 s, identical checksum (idempotent); `receipt_flags_guard` re-enabled. Local API timings
on that copy (no HTTP, not 1:1 comparable with §5.2): `media-selfies` list 22–37 ms (31 200 rows visible) and
`media-receipts` 23–33 ms for Finance PT 1+2 (§5.2 after `b8d70c1`: 1.3 s / 1.7 s over HTTP); a list page is one
`owner_company_id IN (1, 2)` predicate instead of 31 200 bind parameters.

### 11.1 Follow-up — open items (branch `fix/mc4-qa-open-items`, 2026-10-02)

Branch `fix/mc4-qa-open-items`, based on `develop` `bff95ac`. ADR 0016 "Scope rule" notes 9–11. No migration, and
the APK 0.3.x is unaffected: `apps/mobile/lib` keys on `COMPANY_REQUIRED`, `COMPANY_MISMATCH`,
`COMPANY_NOT_ALLOWED`, `NOT_FOUND` and the HTTP status. Every rejected sync item is final, and no code string was
added, removed or renamed.

| ID | Status | Fix / reason |
|---|---|---|
| QA-MC4-09 | **fixed** | `validateContent` checks Q-09 "Admin/Finance for others" with the role in **every derived PT**: the PT of the project / cost center and of each requester (requesters of an unmapped PT count as missing). Admin of A + Staff of B → 403 for a draft for B employees, with or without a B project, and when an update swaps the requesters to B. The failing test was written first (201 before the fix). |
| QA-MC4-13 | **fixed** | `mc2-sql-lint`: scans the whole of `domain/expense|progress|addendum|sync`; adds `approvals`, `budget_addenda`, `project_stages`, `attendance_corrections`, `employee_bank_accounts`, `company_memberships` and `document_sequence_counters` (and `UPDATE <table>`). A company predicate counts only as a **helper call** (`…ScopeSql(`, `ptSql(`, `candidateWhere(` …) or a **bound parameter** (`company_id = ${…}`, `IN (${…})`, `= ANY(${…})`). A join condition does not count, which a self-test asserts. The rule is checked per function, not per table (a per-table rule would need SQL alias resolution). Allow-list: 17 entries with reasons, 0 false positives. 7 old entries that were no longer needed were removed, 7 new BOUND / lock functions were added (`lockRequest`, `projectCommitted`, `duplicateHits`, `writeSnapshot`, `approvedByCaller`, `lockProject`, `lockAddendum`), and a new test fails on any entry that is no longer needed. |
| QA-MC4-14 `faceRefPhoto` | **fixed** | A newly set photo must be a selfie whose `ownerCompany` is the employee's PT, or the caller's own unlinked upload. Anything else gets the same 400 as a missing id. This also stops another PT's selfie from being kept out of selfie retention. |
| QA-MC4-14 `displayNames` | **fixed** | The fallback looks only at memberships in the document's PT and the viewer's mapped PTs, else the account name. Riwayat gets the request's PT. The audit-log report and its user filter use only employees of the PTs shown (SQL `LATERAL`). The unused `USER_DISPLAY_EMPLOYEE_SQL` (first membership of any PT) was removed. |
| QA-MC4-14 `?pt=` / `?company=` / period-closing fallback | **fixed** | `?company=` already gave 403. A report `pt` outside the selection → 403 `COMPANY_NOT_ALLOWED`, audited (JSON and downloads, shared `assertSelectedCompanies`). The panel views Laporan, Audit Log, Kas, Catat kas, **Tutup buku** (the period-closing fallback), Absensi hari ini and Rekap absensi show a denial instead of silently narrowing. A selected PT where the caller lacks the right is still ignored (never widens). |
| QA-MC4-14 sync `COMPANY_MISMATCH` vs `NOT_FOUND` | **fixed** | `COMPANY_MISMATCH` only when the referenced PT is mapped to the caller. A reference in an unmapped PT runs on like a missing id: a draft gets the same `VALIDATION` "Project tidak ditemukan"; an attendance location (`loadLocation`) and an on-behalf employee get `NOT_FOUND`; a request id gets `NOT_FOUND`. `mc3-api` "released APK item referencing another PT" now expects the missing-project answer. |
| QA-MC4-14 body-company `COMPANY_MISMATCH` | **fixed** | `withNamedCompany` raises `COMPANY_MISMATCH` only for a reference in a mapped PT and leaves an unmapped one to the service, which answers it like a missing one. Manual cash entries now check project / cost center / category / source / vehicle (a missing id was a **500** from the foreign key; now 400 like an unmapped one). |
| QA-MC4-14 addendum 404 vs 403 | **fixed** | `createAddendum`: a project of an unmapped PT → 404 `NOT_FOUND` (was 403 `FORBIDDEN`, audited), with or without a body `company`. |
| QA-MC4-14 `attachmentIds` uploader | accepted | Not a read: a request's `attachments` relation does not set the media owner link (`claimMedia` / `ownerCompany`), so the file stays readable only under its own owner rules. Same conclusion as the QA. |
| QA-MC4-14 sync replay after a PT is lost | accepted | The replay returns the caller's own stored result for their own `client_uuid` (ADR 0010 idempotency, 30 days). It carries no data of another user, and new items of that PT are refused `COMPANY_NOT_ALLOWED`. |
| QA-MC4-14 `lockRequest` before the visibility check | accepted | The lock returns no data, and the request is answered 404 right after. Checking visibility first would let the state change between the check and the lock. What is left is a timing difference under concurrent writes only. |
| QA-MC4-14 REST "cross-company reference" | accepted | This is the generic Payload REST create / update in the admin panel by office roles: the company hook / DB trigger answer for a reference of another PT, while a missing id is a foreign-key error. Making them identical needs an existence check for every per-PT relationship in `companyHook`, which is not cheap. The `/api/v1` paths (drafts, cash, addenda, progress, sync) are consistent now. |

**Tests:** `tests/integration/mc4-open-items.int.test.ts` (12). Each one failed before its fix (10 failed on `develop`
`bff95ac`; the cash test found the 500); the controls and the "mapped mismatch keeps `COMPANY_MISMATCH`" checks
pass. `tests/unit/mc2-sql-lint.test.ts` (5) and `tests/unit/mc4-scope.test.ts` (+1, `foreignPtParam`). Updated
expectations: `mc2-isolation` (foreign `pt` → 403) and `mc3-api` (unmapped reference = missing project).

**Checks (CI replica, local throwaway containers `pk-mc4fix-*`):**

| Check | Result |
|---|---|
| `npm run lint` | 0 warnings |
| `npm run typecheck` | clean |
| `npm run test:coverage` | 46 files / 657 tests green (gate met) |
| `npm run check:openapi` | up to date: regenerated; the report `pt` parameter is documented and the `COMPANY_MISMATCH` / body `company` descriptions were updated, with no shape change |
| `TZ=Asia/Makassar npm run test:int` | 43 files / 577 passed + 1 skipped |
| `npm audit --omit=dev --audit-level=high` | exit 0 |
| semgrep 1.177.0, CI command | 0 findings |

