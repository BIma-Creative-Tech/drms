# MC3 — progress log (multi-company: `/api/v1` + APK)

- **Design:** `../adr/0016-multi-company.md` §5/§8 (+ "Implementation notes (MC3-1 API)"); work list
  `impact-inventory.md` §MC3-1 (API) / §MC3-2 (APK); offline sync `../adr/0010-mobile-flutter-offline-sync.md` (+ MC revision).
- **Two parts:** MC3-1 API (this section, branch `feat/mc3-api`) and MC3-2 APK (`apps/mobile`, own section, added by
  the APK session after its mobile work lands). Each part owns its section; a merge keeps both.
- **Purpose of this file:** resume point for another agent; updated with every commit.

## API (MC3-1) — branch `feat/mc3-api`

Worktree `/opt/src/proyekkas-wt/mc3-api`, based on `develop` `3fe5f26` (MC1 + MC2 + 2FA), fast-forwarded to
`1ff5eb8` (semgrep fix of the admin view). Not touched: `apps/mobile/**`, `.github/workflows/**`,
`api/v1/endpoints/app.ts`.

### How to run (host has no node)

Containers of this branch (remove by exact name only, never `docker … prune`): `pk-mc3a-net`, `pk-mc3a-pg`
(postgres:16.15-bookworm, bootstrap `apps/web/test-env/ci-bootstrap.mjs`), `pk-mc3a-mailpit` (CI replica, throwaway
certs in the agent scratchpad), `pk-mc3a-node` (node:24.21.0-bookworm-slim, worktree at `/w`), `pk-mc3a-semgrep`
(CI semgrep step, `--rm`). Checks = `npm ci`, `lint`, `typecheck`, `test:coverage`, `check:openapi`,
`check:import-template`, `TZ=Asia/Makassar npm run test:int`, `npm run build`, semgrep (CI `security` job rules).

### Status

| WP | Status | Where |
|---|---|---|
| `/me` `companies[]` + deprecated single-PT fields | done | `api/v1/endpoints/me.ts`, `schemas.ts` (`Me`, `MeCompany`, `Capabilities`) |
| company context per route (route table, gaps fixed) | done | §Route table below; `api/v1/company-query.ts` |
| masters per PT (company on items, shared, radius per PT, version + ETag) | done | `api/v1/endpoints/masters.ts` |
| `sync/batch` per-item `company_id` | done | `domain/sync/service.ts`, `api/v1/endpoints/sync.ts`, `schemas-sync.ts` |
| queue `?company=` filters (+ `GET /lpj-queue`) | done | `endpoints/{expense-requests,addenda,progress,attendance,cash,notifications}.ts` |
| `companyId` on list/detail DTOs | done | expense list/detail, cash entries, notifications, addenda, progress reports |
| OpenAPI (`X-Company-Ids` component, new fields/params) | done | `openapi.ts` (`components.parameters.CompanyIds`), `packages/api-contract/openapi.json` |
| tests | done | `tests/integration/mc3-api.int.test.ts` (19), `tests/unit/mc3-api.test.ts` (6), `mc2-isolation` sync test adapted |

### Result (tree of the last commit)

- Baseline (MC2 end, `mc2-progress.md`): unit 37 files / 535 tests; integration 36 files / 483 + 1 skipped.
- Now: unit 43 files / 593 tests (coverage gate green: lines 39.0 %, statements 37.6 %, functions 35.1 %,
  branches 28.4 %); integration **39 files / 512 passed + 1 skipped** (incl. `mc3-api` 19 tests, `mc2-isolation` sync
  test adapted to `company_id`); lint, typecheck, `check:openapi`, `check:import-template`, `npm run build` green;
  semgrep (CI rules incl. `payload-local-api-implicit-override-access`) 0 findings; gitleaks over the branch commits
  clean. Dockerfile / dependencies untouched (trivy fs / hadolint inputs unchanged).
- Test fixtures use the fictional PTs "PT Contoh Enam" (CS6) and "PT Contoh Tujuh" (CS7) — CS4 is used by
  `mc2-integration`, and a PT deactivated by one file would stay inactive for the next file seeding the same code.

### Contract for the APK (short)

**Headers.** `X-Company-Ids: 1,3` = READ selection of any authenticated call (OpenAPI parameter component
`CompanyIds`); it only narrows the active memberships; a PT without membership or a malformed value → 403
`code: COMPANY_NOT_ALLOWED` (audited). Absent = all memberships.

**`GET /me`** (new fields; old ones kept):

- `companies[]` — every active membership (active PT), ascending id: `{ id, code, name, timezone, selected, roles[],
  employeeId, employee {id, code, name} | null, capabilities {approvalInbox, teamMonitor, progressReportCreate},
  settings {defaultGeofenceRadiusM, receiptRoundingTolerance, receiptMaxAgeDays, budgetWarnPct,
  syncExpenseDraftsEnabled, syncAttendanceEnabled, syncProgressReportsEnabled} }`. Capabilities use the same rule as
  before, applied to the roles IN that PT.
- `activeCompanyIds` — effective selection of this request (ascending). `appSettings` — app-wide
  `{minAppVersion, latestAppVersion, offlineMaxAgeDays, imageTargets}`.
- **Deprecated** (for mobile-v0.2.0): `roles` / `capabilities` = union over the SELECTED PTs (unchanged);
  `employee` / `settings` = the PT `legacyCompanyId` = first selected membership (ascending id) that has an employee,
  else the first selected one. One PT → that PT, i.e. byte-for-byte the pre-MC3 values. (Fix: before MC3 `settings`
  of a multi-PT user without DRMS membership came from company #1.)

**`GET /masters?types=&since=&company=`** — per-PT types come from the selection (header, narrowed by `?company=`);
every item has `company` (id) + `shared: false`; `uoms`, `banks`, `holidays` have `company: null, shared: true`.
Projects / cost centers without own radius get the default radius of THEIR PT. New types `vendors`,
`cash-in-sources` (collection read access applies: Staff/PM get an empty list). Answer: `companies[] {id, code,
defaultGeofenceRadiusM, version}` + `sharedVersion` + `types`; weak `ETag` (`W/"m1-…"`), `If-None-Match` → 304 (no
body). Cache per PT = one request per PT with `X-Company-Ids: <pt>` (or `?company=<pt>`); same `types` → same
`version` when nothing changed. `Cache-Control: private, no-store` (the APK stores the ETag itself).

**`POST /sync/batch`** — each item carries `company_id` (snake_case like the rest of the envelope). Per item:
`company_id` must be an active membership (else `rejected COMPANY_NOT_ALLOWED`, result `company_id: null`); the PT
derived from the references (project / cost center / existing draft or report) must equal it (else
`COMPANY_MISMATCH`); progress reports need PM/Direktur and on-behalf check-ins PM IN that PT (else `FORBIDDEN`); the
item runs with the read selection narrowed to its PT (a draft without project/cost center lands in that PT),
feature flags / TZ / own employee of that PT — **whatever `X-Company-Ids` says**. The result carries `company_id`.
Idempotency by `client_uuid` unchanged (a replay answers `duplicate` with the stored result, any header). Items
WITHOUT `company_id` (released APK): accepted only when the account has exactly one active PT (processed under it);
otherwise the WHOLE batch → **409 `code: COMPANY_REQUIRED`**, `errors[].path = items.<i>.company_id`, nothing
processed or stored.

**Queues / lists.** `?company=1,3` (must be ⊆ selection, else 403 `COMPANY_NOT_ALLOWED`; malformed → 400) on
`GET /approvals/inbox`, `/transfer-queue`, new `/lpj-queue` (Finance/Direktur, US-21), `/expense-requests`,
`/budget-addenda`, `/budget-addenda/inbox`, `/progress-reports`, `/cash-entries`, `/cash-accounts/balances`,
`/notifications`, `/attendance/team-today`; `/attendance/me` and `/period-closings` take ONE PT. Items carry
`companyId` (expense list/detail, transfer queue, cash entries, notifications, addenda, progress reports) or
`company {id, shortCode, name}` (approval inbox, LPJ queue). Labels: `GET /me companies[]`.

### Route table (91 routes incl. 2 HEAD; 90 before MC3 + `GET /lpj-queue`)

Classes (source of truth + completeness check: `ROUTE_CLASSES` in `tests/integration/mc3-api.int.test.ts` — a new
route without a class fails CI):

| Class | Rule | # | Routes |
|---|---|---|---|
| public | no company data | 6 | `GET/HEAD /health`, `GET/HEAD /health/ready`, `GET /app/config`, `GET /openapi.json` |
| own | caller's own profile / rows only | 10 | `GET /me`, `POST /me/companies`, `POST /devices/register`, `POST /admin/test-email`, `POST /media/:kind`, `GET /notifications`, `POST /notifications/read-all`, `GET /notifications/:id`, `POST /notifications/:id/read`, `GET /attendance/me` |
| selection (a) | rows of selection ∩ memberships, role per PT (collection access `byRole` per PT / per-PT scopes); `?company=` narrows | 20 | `GET /masters`, `/expense-requests`, `/transfer-queue`, `/approvals/inbox`, `/lpj-queue`, `/cash-entries`, `/cash-accounts/balances`, `/period-closings`, `/dashboard/{owner,finance,pm,admin,me}`, `/reports/:code`, `/reports/:code/:format`, `/attendance/team-today`, `/projects/progress`, `/progress-reports`, `/budget-addenda`, `/budget-addenda/inbox` |
| document (b) | one document read within the selection (out-of-PT → 404), action checked against the role IN the document's PT | 47 | `GET/PATCH /expense-requests/:id`, `…/history`, `…/pdf`, the 23 `POST /expense-requests/:id/…` actions + `PATCH …/receipts/:rid`, `PATCH /cash-entries/:id`, `POST /cash-entries/:id/void`, `POST /devices/:id/revoke`, `GET /media/:collection/:id/{file,signed-url}`, `GET /attendance/recap`, `POST /attendance/:id/correct`, `GET /attendance/:id/selfie`, `GET/PUT /projects/:id/stages`, `GET/PATCH /progress-reports/:id`, `GET/PATCH /budget-addenda/:id` + 5 actions |
| named-pt (b) | the PT is named by the request (body `company`, `?company=`, sync `company_id`, or derived from the referenced project / cash account) and checked against membership + role IN that PT | 8 | `POST /expense-requests`, `/cash-entries`, `/period-closings`, `/period-closings/:period/reopen`, `/company-memberships/batch`, `/progress-reports`, `/budget-addenda`, `/sync/batch` |

The `roles` gate of the `v1()` wrapper stays "role in ANY selected PT" (a gate only); every row / document is then
filtered or checked per PT. Mutations of existing documents load them with the caller's read access, so a document
outside the header selection answers 404 (consistent "selection narrows everything").

**Gaps found and fixed**

| # | Route | Gap | Fix |
|---|---|---|---|
| 1 | `GET /cash-accounts/balances?company=X` | `company` passed to `balances()` unchecked → balances of ANY PT (cross-PT leak) | `?company=` ⊆ selection (else 403 `COMPANY_NOT_ALLOWED`, audited), then ∩ Kas PTs of the caller |
| 2 | `GET /period-closings?company=X` | lock date of any PT readable | `?company=` ⊆ selection; lock dates only of PTs where the caller holds Finance/Direktur/Admin |
| 3 | `GET /me` | `settings` of a multi-PT user = company #1 even without membership there | legacy PT rule (above) |
| 4 | `GET /masters` | default radius of the context PT for every item | radius of the item's PT |
| 5 | `POST /sync/batch` | item PT had to be in the header selection; project-less drafts fell back to the selection | per-item `company_id`, processed under that PT (selection narrowed per item) |
| 6 | `GET /attendance/:id/selfie` | "own" (no `view_sensitive` audit) only for the first PT's employee | any of the caller's employees (audit hygiene, no data exposure) |

**Test evidence** (integration unless noted): `mc3-api.int.test.ts` — route-table completeness; header spoofing on
own/selection/document/mutation routes (403 `COMPANY_NOT_ALLOWED`, malformed header); `?company=` outside the
selection on 12 list routes (403 + audit row); selection (expense list per PT, header / `?company=` narrowing);
document (other PT's request / PDF / cash entry / stages / attendance recap → 404/403; Finance-only-in-C cannot act
on an A request); named-pt (create with a C project by an A-only user, closing a foreign PT, cash entry by a
non-Finance of the account's PT); own (notifications `companyId` + filter); queues; masters; sync. Existing
per-route cross-PT evidence: `mc-isolation.int.test.ts` (MC1: expense routes, `/me`, media), `mc2-isolation` (media
per PT, PDF internal, approve, reports / exports per PT, closing, role-matrix batch, sync), `mc2-integration`
(transfer queue, dashboards, `/me/companies`, closings), `e5-addendum` (addendum decisions `access_denied`).

### Released APK (mobile-v0.2.0) compatibility matrix

The released APK sends no `X-Company-Ids` and no `company_id`; its parsers ignore unknown JSON keys (manual
`fromJson` / freezed defaults) and it does not send `If-None-Match`.

| Area | Account with 1 PT | Account with > 1 PT |
|---|---|---|
| `GET /me` | identical values (roles, capabilities, employee, settings of that PT); extra keys ignored | roles/capabilities = union over all PTs (as in MC1/MC2); `employee`/`settings` = `legacyCompanyId` PT (lowest id with an employee) — menus may show a module the user holds in only one PT; the server still checks per document |
| `GET /masters` | same items (+ `company`, `shared` keys), always 200 | items of all member PTs mixed in one cache (only PTs where the collection access allows) — pickers may list projects of several PTs; no foreign PT |
| lists / inbox / queues | unchanged | rows of all member PTs where the role grants access (no `company` chip in the old UI) |
| online actions (approve, transfer, create via REST) | unchanged | work per document PT (role checked IN that PT; a role held only in another PT → 403/404 with a message) |
| `POST /sync/batch` | unchanged (items processed under the only PT; `company_id` in results ignored) | **409 `COMPANY_REQUIRED`** for every batch: the old APK keeps the items queued (`_deferAll`, back-off) and shows the `detail` "Akun Anda terdaftar di lebih dari satu PT. Perbarui aplikasi …" — nothing is lost, nothing lands in a wrong PT |
| `GET /attendance/me` | unchanged | recap of the legacy PT's employee |
| 403 `COMPANY_NOT_ALLOWED` | cannot happen (no header) | cannot happen (no header) |

Verdict: 1 PT = exactly as before (asserted: `/me` legacy keys/values, sync without `company_id` applied under the
only PT, a foreign project still `COMPANY_MISMATCH`); > 1 PT = degraded but safe (no cross-PT data, offline queue
held with a clear message until the APK is updated).

### What the APK session needs (MC3-2)

1. Read `GET /me` `companies[]` (roles, `employeeId`, `capabilities`, `settings` per PT) + `activeCompanyIds`;
   stop using the top-level `roles`/`capabilities`/`employee`/`settings` (deprecated, kept for 0.2.x).
2. Send `X-Company-Ids` = the chosen PT(s) on every call ("Semua PT" = omit the header). Handle 403
   `COMPANY_NOT_ALLOWED` (membership removed → refresh `/me`, reset the selection).
3. Masters: one request per PT with `X-Company-Ids: <pt>`, cache key `sub + pt`, keep the `ETag` per PT and send
   `If-None-Match` (304 = keep cache); shared masters (`shared: true`) can be cached once per `sub`.
4. Outbox: every item carries `company_id` (the draft's / report's / attendance location's PT). The header of the
   batch no longer matters (items may be mixed); handle per item `COMPANY_MISMATCH` / `COMPANY_NOT_ALLOWED`
   (rejected, never retry) and a batch 409 `COMPANY_REQUIRED` (should not happen once every item has `company_id`;
   migrated v2 rows must get a PT before they are sent).
5. Feature flags per PT: `companies[].settings.sync*Enabled` (`GET /app/config` still reports company #1 — app.ts
   is owned by another session).
6. PT chips: `companyId` / `company` on list items, labels from `companies[]`; queues accept `?company=`; LPJ list
   `GET /lpj-queue`; own attendance recap per PT `GET /attendance/me?company=<pt>`.

### Residual (not changed, MC4 review)

- `contextCompanyId` fallback (sole selected PT, else company #1) still feeds values without a document: the
  top-level `budgetWarnPct` of `GET /approvals/inbox` (items carry their own PT's `warnPct`), K-09 thresholds of
  `GET /projects/progress`, `GET /app/config` flags (public, no user). Settings values only, never rows.
- `GET /masters` `hasMore` is per type across the requested PTs (≤ 500); request per PT for large masters.
