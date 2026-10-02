# Changelog

All notable changes to ProyekKas are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### MC4 — staging UAT fixes (2026-10-02, `docs/proyekkas/uat/mc4/` run on staging `3dd8a96`)
- **UI-CO (copy defaults in the company form):** after the MC4-02 read fix the two fields were visible but
  **disabled** — Payload makes `virtual` fields `admin.readOnly` by default (`fields/config/sanitize.js`); both now set
  `admin.readOnly: false` (unit test). The API path was already fine (the UAT fixture created PT CS1 with copied
  defaults).

### MC4 — QA open items (branch `fix/mc4-qa-open-items`; report `docs/proyekkas/qa/mc4-qa-report.md` §11)

Closes QA-MC4-09, QA-MC4-13 and the read-rule parts of QA-MC4-14 under the PT scope rule. Web/API only, no
migration. The APK 0.3.x keeps working: no error code was added, removed or renamed.

#### Security
- **On-behalf drafts (QA-MC4-09):** "Admin/Finance may create a request for others" (Q-09) now needs that role in
  the PT of the request. That PT comes from the project or cost center and from every requester. A role in another
  PT no longer counts: for example, Admin of PT A + Staff of PT B → 403 for a draft for PT B employees.
- **Existence oracles (QA-MC4-14):** a reference in a PT the caller is not mapped to now gets the same answer as a
  missing one:
  - sync items: no `COMPANY_MISMATCH`; attendance locations and on-behalf employees → `NOT_FOUND`; drafts → the
    usual validation error;
  - a create with a body `company`;
  - a new addendum: 404 instead of 403;
  - manual cash entries: a missing project / cost center / category / source / vehicle is now a 400 (was a 500).

  `COMPANY_MISMATCH` stays for a mismatch between two PTs the caller is mapped to.
- **`?pt=` (QA-MC4-14):** a PT outside the caller's selection now gets 403 `COMPANY_NOT_ALLOWED` in the
  `/api/v1/reports` JSON and downloads (it used to narrow silently to an empty report). The panel views Laporan,
  Audit Log, Kas, Catat kas, Tutup buku, Absensi and Rekap absensi show a denial instead.
- **Display names (QA-MC4-14):** names in Riwayat, request DTOs, PDFs and the audit-log report and its filter come
  from the document's PT or from a PT the viewer is mapped to, else the account name. They never show an employee
  name from another PT.
- **Face reference photo (QA-MC4-14):** `employees.faceRefPhoto` takes only a selfie of the employee's PT, or the
  caller's own upload that is not linked yet. Any other selfie, or a missing id, gets the same 400.

#### Changed
- `mc2-sql-lint` (QA-MC4-13) now:
  - scans all of `domain/expense|progress|addendum|sync`;
  - knows 7 more per-PT tables;
  - accepts a company predicate only when it is a helper call or a bound parameter (`company_id = ${…}`,
    `IN (${…})`, `= ANY(${…})`), not a join condition.

  Its allow-list has 17 entries, each with a reason, and the test fails on an entry that is no longer needed.
- OpenAPI: the report query parameter `pt` is documented; the descriptions of `COMPANY_MISMATCH` and the body
  `company` were updated (no shape change).

#### Fixed (found by the MC4 UAT suite, local run 2026-10-02)
- **MC4-02:** "Salin default saat dibuat" / "Salin dari PT" were never shown on the company create form (field
  `read: () => false` → Payload hides the field); now readable by the group admin only.
- **MC4-03:** 2 px horizontal page overflow at 390 px on `/admin/persetujuan`: the table wrapper `.pk-tw` bleeds to
  the card edge only inside a `.pk-card` (`--pk-tw-bleed`), no negative margin elsewhere.

### CI — Trivy image scan: retry, IPv4 only
- `ci.yml` job `image`: the Trivy report and gate run through `.github/scripts/trivy-image.sh` — 3 attempts with
  back-off (0 / 30 / 90 s) for network errors, the container started with IPv6 disabled (Go then skips AAAA records;
  falls back to a normal run if the daemon refuses the sysctl). The gate now uses `--exit-code 3` for "fixable
  CRITICAL found", which is never retried, and `set -euo pipefail` (a failing first image used to be masked by the
  second). Cause: develop `3dd8a96` (2026-10-02) failed in the gate fetching a GHCR blob from
  `pkg-containers.githubusercontent.com` ("dial tcp [2606:50c0:…]:443: connect: network is unreachable").

### CI — image build retry
- `ci.yml` job `image`: each buildx step (web/migrate, local and push-by-digest) runs once with
  `continue-on-error`, then after a 45 s back-off one retry; later steps take the digest of whichever attempt
  succeeded. Cause: develop `bff95ac` (2026-10-02) failed resolving `docker.io/docker/dockerfile:1` during a transient
  Docker Hub outage on the self-hosted runner (IPv4 blip; the runner network has no IPv6). The BuildKit cache makes
  the retry cheap; a second failure still fails the job.

### MC4 — PT scope rule (owner decision 2026-10-02; branch `feat/mc4-pt-scope-rule`, ADR 0016 "Implementation notes — Scope rule")

Read and search scope = the PTs a user is mapped to (active memberships): one PT → that PT only; several → the
consolidated data of those PTs, never another PT. Group admin unchanged; mutations stay single-PT. Web/API only.
Migration: `20261002_080000_mc4_scope_rule` (schema + backfill, idempotent, down migration; ~12 s for 74 400 media
rows locally).

#### Security
- **Duplicate receipts (QA-MC4-06):** the check compares a receipt only with requests in the request's PT and the
  PTs its uploader is mapped to. A hit in another PT is shown (with its number and link) only to users mapped to that
  PT; everyone else sees nothing of it — counts, the "Verifikasi semua nota" gate, the internal PDF, reports, REST,
  Riwayat and the audit log follow the same rule (audit rows of such a flag carry no PT).
- **Deactivated PT (QA-MC4-05):** files of a deactivated PT are no longer readable by the office users of the other
  PTs; the "office in every PT" shortcut (media) and the "rows without PT" audit rule count inactive PTs too (with a
  deactivated PT, only group admins read audit rows without PT).
- **Oracles (QA-MC4-08/10):** a stage template, project, cost center, bank account, category, cash account or
  `progressPct` of a PT the caller is not mapped to is answered like a missing one (no lock date, no state, no
  template copy).
- PT logos only for members of that PT (+ group logo); signatures and device revoke count active memberships only;
  notifications about a PT the user left are hidden; `/me` without membership no longer shows PT #1.

#### Changed
- **Media lists (QA-MC4-07):** new derived column `ownerCompany` on receipt / transfer-proof / attachment /
  progress-photo / selfie media (set by DB triggers, backfilled); office access is `ownerCompany IN (…)` instead of id
  lists (65 535 bind-parameter cap). Cash-entry attachments are now readable by the office roles of that PT.
- Receipt flags carry `relatedCompany` (PT of the related request when it is another PT).

### MC4 — QA security fixes (branch `docs/mc4-qa`; report `docs/proyekkas/qa/mc4-qa-report.md`)

#### Security
- **QA-MC4-01 (HIGH):** REST creates that name a `company` in the body re-check the create role in the derived PT
  (Finance/Admin of PT A could create bank accounts, team assignments or budget lines in PT B).
- **QA-MC4-02 (HIGH):** a PT Admin may only change accounts that belong solely to PTs where they are Admin (no
  rename / deactivate / e-mail change of users of other PTs or of group admins).
- **QA-MC4-03 (HIGH):** per-PT document audit rows are tagged with their PT; rows without PT only for users with an
  office role in every PT (Admin/Direktur of PT A no longer read PT B's audit rows).
- **QA-MC4-04 (HIGH):** single media file access is decided on the row's own owner document and office id lists load
  via SQL (opening one selfie no longer exhausts the web heap for a multi-PT Finance user).

### APK 0.3.1 (branch `feat/mobile-0.3.1-ux`, pubspec `0.3.1+1`; not tagged yet)

APK-only UX fixes from the module check; no server change needed (web ≥ 0.5.1 / MC4 API). Release notes
`docs/release-notes/apk/0.3.1.md`.

#### Added
- **Notification tap routing** for every document type the server writes (`AppNotification.route`, same mapping as
  the web `notificationHref`): `budget_addendum` (addendum.*) → `/addenda/:id`; `project` +
  `progress.late_report` → `/progress?project=:id` (reports filtered to that project); other `project` events
  (`reminder.budget_threshold`) → `/progress?tab=projects`; `progress_report` → `/progress/report/:id`;
  `attendance` → `/attendance` (team tab without own attendance); `expense_request` unchanged. Progress targets
  only for PM / Direktur / Finance; unknown types or non-numeric ids stay non-tappable (read rows without a target
  have no tap action; routable rows show a chevron).
- **Edit an addendum draft** (`PATCH /api/v1/budget-addenda/{id}`, `BudgetAddendumUpdate`: `addition`, `reason`; the
  project stays fixed): "Ubah draft" on the detail only when `allowedActions` contains `edit`; route
  `/addenda/:id/edit` reuses the create form prefilled, "Simpan perubahan" and — when `submit` is also allowed —
  "Simpan & ajukan" (PATCH then submit). One Idempotency-Key per PATCH body (the server answers 422 to a reused key
  with another body). A non-editable addendum shows a notice instead of the form.
- **Finance home: US-12 "Progress fisik vs anggaran"** card (`ProjectProgressSummary`, `GET /projects/progress`
  allows `pk-finance`), as on the web Finance Beranda; shown for every role with `canReadProgress`.
- **Per-PT dashboard breakdown** ("Per PT" card under the KPI totals) when `/dashboard/*` `companies[]` has ≥ 2 PTs:
  Direktur `cash.byCompany` + `approvals.byCompany`, Finance `cashByCompany` + `transferQueue.byCompany`, PM
  `teamMonthByCompany`.

#### Changed
- PM "Absenkan anggota tim" stays visible but disabled with the line "Absen atas nama belum bisa: absensi dari
  aplikasi belum diaktifkan Admin (Setting perusahaan)." when `syncAttendanceEnabled` is off for every PT in scope
  (was: hidden silently).

### MC4 — code gaps (branch `feat/mc4-code-gaps`; ADR 0016 "Implementation notes (MC4)", `docs/proyekkas/mc/mc4-progress.md`)

Web/API only (no APK change). Migration: `20260930_120000_mc4_list_company_column` (data only, preferences).

#### Added
- **Copy defaults on PT create (US-MC-01):** a PT created by the group admin gets, in the same transaction, the
  document sequences (every doc type of the source PT, `startAt` 1), the approval rules without per-PT references
  (rules naming a project / category / cost center / user, or refused by today's rule checks, are skipped and
  reported), the default work schedule and the per-PT settings still at their default — from PT #1 (DRMS) or the
  PT chosen in "Salin dari PT"; "Salin default saat dibuat" off = bare PT. Idempotent (create-only by natural key),
  audited (rows + one summary `defaultsCopied` row). Seed and go-live import keep their built-in defaults.
- **Optional body `company`** on `POST /api/v1/expense-requests`, `/progress-reports`, `/budget-addenda`,
  `/cash-entries`: must be a membership with the role the create needs IN that PT (else 403
  `COMPANY_NOT_ALLOWED`, audited) and the PT of the referenced project / cost center / cash account (else 400
  `COMPANY_MISMATCH`); the create runs under that PT. Absent = unchanged (APK 0.2.x / 0.3.0).
- **Report PDF logo:** the letterhead logo (PT logo; group logo on a consolidated report) is drawn left of the kop
  (JPEG/PNG ≤ 3 MiB, same image guard as the document PDF, ADR 0008).
- **Per-PT fields documented for the APK** (`/dashboard/*`: `companies`, every `byCompany` row, `companyId` on
  embedded rows, `viz.warnPctByCompany`; approval inbox `items[].budget.warnPct`; K-09 rows `companyId`,
  `warnGapPct`, `badGapPct`) — additive; OpenAPI regenerated.

#### Changed
- `GET /api/v1/app/config` (public): the three sync feature flags are the OR over the ACTIVE PTs (was company #1);
  `timezone` = the server timezone every PT uses. One PT = identical answer. Per-PT truth: `GET /me`
  `companies[].settings`; the server keeps enforcing the item's PT flag (`FEATURE_DISABLED`).
- Notification templates are app-wide: create/update = group admin only (was: Admin of any PT); PT Admin /
  Direktur keep read access (default decision, the owner may override).
- Settings without a document (inbox `budgetWarnPct`, K-09 top-level thresholds, dashboard `viz.warnPct`, lock date
  / today fallbacks) use the caller's only / LOWEST selected PT instead of company #1 (which could be a PT the caller
  is not a member of); every item / row carries its own PT's value.
- Scope literals without PT parts (`{ kind: 'team', projects }`, `{ kind: 'own' }`, `{ kind: 'all' }`) now match
  nothing in every report / attendance query (was: `all` only).
- Saved list-column preferences that never named the PT column get it prepended once (migration above).

## [0.5.1] - 2026-09-30

Security patch on top of 0.5.0 (no migrations, no API change): npm audit high findings in `undici` and `nodemailer`
fixed with root `overrides`. Deploy this instead of 0.5.0 (same database migrations as 0.5.0; rollback = restore the
pre-deploy dump). Also carries the APK `mobile-v0.3.0` release files (pubspec, notes, runbook).

### Security
- **npm audit (high) fixed with root `overrides`** — `payload` 3.90.1/3.90.2 pins `undici` 7.29.0 (GHSA-rfgv-xxqx-mfg5,
  GHSA-w293-vg96-wgc3 high + 8 moderate/low, patched in 7.29.1) and `@payloadcms/email-nodemailer` takes
  `nodemailer` ^9.1.1 (GHSA-v53p-9fqp-m79j high, GHSA-g57g-f23g-4646; patched in 10.0.9). Overrides: `undici` 7.29.1,
  `nodemailer` 10.0.10 (10.x only drops Node < 20; newest versions respecting `.npmrc` `min-release-age=7`). Remove
  the overrides once Payload ships the patched versions. Remaining audit: 6 moderate + 1 low, all needing a Payload
  downgrade (`npm audit fix --force` → 3.85.1) — not applied.

### APK mobile-v0.3.0 (tag `mobile-v0.3.0`, pubspec `0.3.0`)

First APK release since `mobile-v0.2.0`; ships the APK parts of 0.5.0 that were never released: multi-company
(MC3-2: PT switcher, per-PT masters/capabilities, drift schema v3 with `company_id` on the offline queue), the optional
authenticator code on password login (ADR 0017) and the release-notes sheet on the update banner/screen. Release notes
`docs/release-notes/apk/0.3.0.md` replace the never-tagged `0.2.1.md`. **Requires web ≥ v0.5.0** (`/me`
`companies[]`) — publish on `/unduh` only after that deploy (runbook `rilis-apk.md` Prasyarat); do not raise the
minimum APK version yet (0.2.x keeps working for single-PT accounts).

## [0.5.0] - 2026-09-29

Multi-company (MC1–MC3, ADR 0016), optional self-service 2FA (ADR 0017), admin loading dots (0.4.2) and the
self-hosted CI runner support. Database migrations are NOT backward compatible (rollback = restore the pre-deploy dump).

### MC3 — APK (MC3-2, branch `feat/mc3-mobile`; ADR 0016 §8, ADR 0010 MC note, `docs/proyekkas/mc/mc3-progress.md` §APK)

#### Added
- **Profile per PT:** `GET /me` `companies[]` parsed (roles, employee, capabilities, settings incl. sync flags per PT);
  menus and home tiles follow the union over the selected PTs, document actions the roles IN the document's PT.
- **PT switcher** (home app bar + Profil "PT aktif"): "Semua PT" or any subset, stored per user, sent as
  `X-Company-Ids`; one PT = static code. 403 `COMPANY_NOT_ALLOWED` resets the selection and reloads `/me`.
- **Create in one PT:** new request asks the PT first when several are possible; progress reports and check-ins take
  the PT of their project / location; pickers show that PT's masters only; check-in / progress queue flags per PT.
- **PT chips** on requests, drafts, inbox, LPJ queue, notifications, addenda, progress reports, team attendance and
  the send queue when more than one PT is shown; **LPJ queue** (`GET /lpj-queue`) in the Persetujuan inbox; own
  attendance recap per PT (`/attendance/me?company=`).
- **"Pilih PT untuk data offline"**: offline data from before the update, when the account has several PTs.

#### Changed
- drift schema **v3**: `company_id` on local drafts, progress reports and outbox; migration keeps every v2 row
  (one PT → assigned, several PTs → held until chosen, never guessed).
- Sync: every item sends its own row's `company_id`, one batch per PT, no `X-Company-Ids`; `COMPANY_MISMATCH` /
  `COMPANY_NOT_ALLOWED` = final rejection with a clear Indonesian text; batch 409 `COMPANY_REQUIRED` holds PT-less
  items without losing them.
- Masters cache per user **and** PT with `ETag` / `If-None-Match` (304 keeps the cache).

### MC3 — API (MC3-1, branch `feat/mc3-api`; ADR 0016 §5/§8, `docs/proyekkas/mc/mc3-progress.md`)

#### Added
- **`GET /api/v1/me` company context:** `companies[]` (every active membership: `code`, `name`, `timezone`,
  `selected`, roles, `employeeId`/`employee`, capabilities and APK settings per PT), `activeCompanyIds`,
  `legacyCompanyId`, app-wide `appSettings`.
- **Masters per PT:** `company` + `shared` on every item (banks, UoM, holidays shared), default geofence radius of the
  item's PT, `companies[].version` + `sharedVersion`, weak `ETag` with `If-None-Match` → 304, `?company=`; new types
  `vendors`, `cash-in-sources`.
- **`sync/batch` per-item `company_id`:** processed under that PT whatever `X-Company-Ids` says (flags, TZ, own
  employee of that PT); codes `COMPANY_NOT_ALLOWED` / `COMPANY_MISMATCH` per item, `company_id` in results; items of
  the released APK (no `company_id`) accepted for one-PT accounts, otherwise 409 `COMPANY_REQUIRED` for the batch.
- **`?company=` PT filter** (subset of the selection, else 403 `COMPANY_NOT_ALLOWED`) on the approval inbox,
  transfer queue, new `GET /api/v1/lpj-queue`, expense list, addenda list/inbox, progress reports, cash entries,
  balances, period closings, notifications, attendance (`/attendance/me` per PT, team today).
- `companyId` on expense list/detail, cash entries, notifications, addenda and progress reports; `company` ref on
  approval inbox rows.
- OpenAPI: reusable header parameter `X-Company-Ids` (`components.parameters.CompanyIds`) on every authenticated
  path; contract regenerated (`packages/api-contract/openapi.json`).
- Route table of all 91 `/api/v1` routes with a completeness test (`tests/integration/mc3-api.int.test.ts`,
  `tests/unit/mc3-api.test.ts`).

#### Deprecated
- Top-level `roles`, `capabilities`, `employee`, `settings` of `GET /me` (kept for mobile-v0.2.0; one PT → unchanged
  values; several PTs → union roles, employee/settings of `legacyCompanyId`).

#### Security
- `GET /api/v1/cash-accounts/balances?company=` returned the balances of any PT; `GET /api/v1/period-closings?company=`
  the lock date of any PT — both now limited to the caller's selection (403 + audit otherwise).
- `GET /me` `settings` no longer falls back to company #1 for a user who is not a member there.

### Added
- **MC1-1 — companies + per-PT memberships** (`apps/web`, branch `feat/mc1-foundation`, ADR 0016 §1–§2):
  collections `companies` (identity + per-PT operational settings moved from the `company-settings` global; company
  #1 = DRMS) and `company-memberships` (user × PT: roles, employee link, active; unique (user, PT) and (PT, employee));
  `users.groupAdmin` (DB-only flag: companies, app-wide settings). Access context per request = active memberships
  ∩ selection (`X-Company-Ids` header / `pk-company-ids` cookie); `hasRole(req, role, companyId)` requires the PT,
  legacy "any selected PT" checks are `hasRoleAny` (MC2 review points). Approver pools, recipients, G1 requester
  accounts and display names resolve through memberships. Migration `20260927_230033_mc1_companies` (backfill:
  company #1 from the global, one membership per user from its former roles/employee, Admins → group admins;
  down migration restores the single-company shape).

- **MC1-2/MC1-3 — company column + access per PT** (ADR 0016 §4–§5): `company` on the 30 per-PT collections
  (masters chosen on create — default = the caller's only PT; transactions derived from their parent by
  `fields/company.ts` `companyHook` and, for raw inserts, the DB trigger `pk_company_from_parent`), nullable PT tag on
  `notifications` / `audit-logs`. `byRole` is evaluated PER PT ("see all" = all rows of the PTs where the role is held;
  scope rules AND-ed with their PT; `resolveScope` per PT), shared masters / per-user rows use `byRoleAny`; creates
  are re-checked against the role in the resolved PT. Decision guards (approve, acknowledge, transfer, LPJ …) use
  the caller's roles and employee IN THE DOCUMENT's PT; `X-Company-Ids` naming a foreign PT → 403
  `COMPANY_NOT_ALLOWED` (audited `access_denied`). Codes/names/document numbers unique per PT. Migration
  `20260927_234849_mc1_company_columns` (backfill → company #1, NOT NULL, per-PT unique indexes).
- **MC1-4 — DB guards per PT** (migration `20260928_000100_mc1_security`): `company_id` immutable, cross-PT
  references rejected by triggers (SQLSTATE 23514 `cross-company reference`: every per-PT FK pair, requester/line
  child rows, PM / cost-center manager / named approvers need an active membership in the row's PT),
  `pk_cash_lock_date(company_id)` in the transfer / cash-entry / opening-balance guards (closing PT A never locks
  PT B), `closePeriod` / `reopenPeriod` per PT, `reminder_runs` keyed `(company_id, run_date)`.
- **MC1-5 — numbering per PT** (migration `20260928_000200_mc1_numbering`): counters `(company_id, doc_type,
  period_key)`, `{COMPANY}` = short code of the document's PT, DRMS counters continue (PB 229…), `shortCode`
  immutable once a PT has numbered documents.
- **Go-live import / LPJ refund per PT:** the import matches and creates per-PT masters inside its PT (MC1: first
  active PT; `kode_pt` = MC2); the LPJ refund cash entry uses the "Pengembalian LPJ" source of the request's PT.
- **MC1-6 — isolation suite** `tests/integration/mc-isolation.int.test.ts` (two PTs, per-PT reads/writes/approvals,
  forged header/cookie, DB cross-PT guards, per-PT numbering and period lock) + unit tests `mc1-access.test.ts`.
- **MC2 — multi-company domain, reports, jobs, admin UI and import** (branch `feat/mc2-integration` =
  `feat/mc2-backend` + `feat/mc2-admin-ui`, ADR 0016 §5–§11, requirements v1.2 §5/§6; progress `mc/mc2-progress.md`):
  - **Reports / KPI / exports per PT (MC2-2)** (ADR 0016 §6, requirements v1.2 §5/§6):
    `ReportScope` = list of per-PT scopes built from the role IN each selected PT (`officeScope`, `roleScope`,
    `auditScope`, `teamScope`, `ownScope`); every raw SQL carries a company predicate (`companyScopeSql`,
    `ledgerScopeSql`, …; "all" = the caller's PTs for that role, a company-blind `{ kind: 'all' }` matches nothing);
    the 8 formerly unscoped KPI functions take a scope. Reports: parameter `pt` (narrows only), PT column + "Subtotal
    per PT" table when > 1 PT, master labels prefixed `[CS1]`, categories never merged across PTs. Dashboards: per-PT
    breakdown (`byCompany`) next to every combined total. Exports/PDF: one PT → that PT's letterhead, several → the
    group letterhead (`groupName`/`groupPdfHeader`, else "Laporan gabungan: …") + PT list; PDF Author/Subject
    metadata. Audit-log report per PT (rows without PT: Admin/Owner only).
  - **Domain services per PT (MC2-1):** approval inbox / transfer queue / LPJ queue (`lpjQueue`) consolidated with a
    PT ref per item + optional PT filter; Kas balances / flows / period summaries limited to the Kas PTs of the
    caller (`kasAccessIn`, `lockDates`), `POST /period-closings` `company` + `?company=` on reopen / list / balances
    (400 "PT wajib dipilih" when ambiguous); attendance scope per PT (`AttScope.parts`, `narrowAttScope`), recap /
    team today / corrections per employee PT, default schedule of the employee's PT; progress thresholds per project
    PT; display names / PDF "Dibuat Oleh" = employee of the document's PT.
  - **Jobs per active PT (MC2-3):** daily reminders (own hour/toggles, recipients holding the role IN that PT,
    notifications tagged with the PT, `reminder_runs (company_id, run_date)`, one PT's failure logged), reimburse
    auto-close (that PT's days), selfie retention (months/switch per PT, app-wide batch per run).
  - **Media / sync:** office roles read media of their PTs only (all rows only when they hold the role in
    every active PT); sync items are processed under the PT derived from their references — outside the
    `X-Company-Ids` selection → rejected `COMPANY_MISMATCH`; feature flags / own employee of the item's PT.
  - **Role matrix batch save:** `POST /api/v1/company-memberships/batch` — all-or-nothing, Admin of each item's PT
    or group admin, reason → `role_change` audit rows; errors name the item (`errors[].path = items.<i>`).
  - **PT switcher (MC2-4)** (ADR 0016 §5, wireframe `mc/wireframes.md` §1a):
    module-bar control left of the bell (`admin/shell/CompanySwitcher.tsx`): one membership → the PT code as text;
    several → dialog with "Semua PT saya" (tri-state) + one checkbox per PT (code, name, the user's roles there),
    Terapkan / Batal, ≥ 1 PT, ↑/↓/Space/Esc, bottom sheet ≤ 768 px. New `POST /api/v1/me/companies` sets the HttpOnly
    cookie `pk-company-ids` (`__Host-` on https; "Semua PT" = cookie cleared); a PT without membership → 403
    `COMPANY_NOT_ALLOWED` (audited). OpenAPI regenerated.
  - **Master Perusahaan + PT column/filter + employee ↔ PT (MC2-4)** (ADR 0016 §11, wireframes §3–§4): companies form
    in tabs (Identitas / Operasional / Absensi & retensi / Pengingat & notifikasi), list Kode · Nama · Zona waktu ·
    Anggota · Aktif · Dibuat; every list with a PT column (30 per-PT collections, memberships, notifications, audit
    logs) shows the PT short-code chip first and, with more than one PT selected, PT filter chips above the table
    (`admin/company-list.ts`). A chosen PT sits at the top of master forms; employee create requires the PT when
    several PTs are selected; employee / project / cost-center / work-schedule pickers list only the document's PT.
  - **Role matrix "Pengguna & akses PT" (MC2-4)** (`/admin/akses-pt`, wireframe §2): users × PTs, cell = membership
    (role checkboxes, employee of that PT, add / deactivate), Admin of the PT or group admin, reason required, saved
    in ONE atomic batch (a refused batch saves nothing and marks the failing cell), audit `role_change`, warnings for
    a PT without active Direktur / Finance, mobile cards.
  - **PT in custom views + dashboards (MC2-4):** approval inbox, transfer queue, LPJ verification and addendum list
    show a PT column when more than one PT is selected; transfer / settlement forms offer only cash accounts of the
    request's PT (transfer / void actions only for Finance OF that PT); Direktur / Finance / PM dashboard tiles show
    per-PT rows under the combined totals (cash, waiting approvals, budget colours, completeness, transfer queue,
    last closed period); K-09 progress rows carry a PT chip.
  - **Kas + Tutup buku per PT:** balances with per-PT subtotal next to the combined total, PT filter + PT chip in the
    book, edit / void and lock date per row PT; "Kas masuk/keluar" and "Tutup buku" act on ONE PT (PT chooser / tabs
    when the caller holds the role in several), close / reopen always send `company` (a 400 "PT wajib dipilih" is
    explained instead of echoed).
  - **Absensi per PT:** PT filter on "Tim hari ini" and the monthly recap, project / cost-center filters bound to their
    PT (`narrowAttScope`), PT chips on the grid and board (`TeamToday.members[].companyId`), option labels `[PT]`.
  - **Reports view:** audit log uses `auditScope`; letterhead line of the effective PTs above the tables.
  - **Go-live import per PT (MC2-5)** (`apps/web/src/import`, runbook §4.1): sheet `Perusahaan` (target PTs; existing
    ones untouched, new ones created with default numbering + approval rules), `kode_pt` as first column of every
    per-PT sheet (codes unique per PT; empty = the only PT), sheet `AksesPT` (roles per user per PT), validation of
    unknown / inactive PTs and cross-PT references, cut-over per PT (PB start per PT). Template `MC2-5` regenerated,
    new fictional two-PT sample `drms-impor-golive-contoh-fiktif-2pt.xlsx`.
  - **Tests:** `tests/integration/mc2-isolation.int.test.ts` (3 PTs, users with different roles per PT: reports,
    KPI, dashboards, exports/letterhead, queues, Kas, attendance, reminders, retention, media, sync) and the raw-SQL
    company lint `tests/unit/mc2-sql-lint.test.ts`; `tests/integration/mc2-integration.int.test.ts` (2 PTs, different
    roles per PT: switcher cookie × dashboards × queue × closing × role-matrix batch, Absensi filter regression),
    `mc2-import`, unit `mc2-{admin-ui,switcher,role-matrix,import,integration}`. Contract backend ↔ UI:
    `docs/proyekkas/mc/mc2-contract.md`.

- **Seed:** `SEED_DATA_FILE` accepts the old single-company shape (→ company #1 DRMS) and a new
  `{ uoms, banks, companies: [...] }` shape; every PT gets the default sequences and approval rules.

- **Optional self-service 2FA (TOTP)** (branch `feat/2fa-self-service`, ADR 0017, user decision 2026-09-28): each
  user turns 2FA on/off for their OWN account; nobody is forced.
  - Web: page **"Keamanan akun"** (`/admin/keamanan-akun`, avatar menu) with status *2FA aktif / nonaktif / tidak
    diketahui* + authenticator label/date, **Aktifkan 2FA** (Keycloak AIA `kc_action=CONFIGURE_TOTP`) and
    **Nonaktifkan 2FA** with confirmation (AIA `delete_credential:<own id>`), both with `prompt=login`
    (fresh password + code). `POST /auth/account-action` (same-origin, web session only, own credential only,
    6 / 10 min / user); return leg in `/auth/callback` via its own `pk_aia_tx` cookie + state — no second web
    session / `login` row; outcome verified via the Admin API (`listUserCredentials`, OTP metadata only); audit
    `2fa_enabled` / `2fa_disabled` (migration `20260928_090000_two_factor_audit`: two enum values).
  - APK (password mode): after a failed login the optional field **"Kode autentikator (bila 2FA aktif)"** appears
    (6 digits, numeric keyboard, one-time-code autofill); the retry sends `totp`; empty → not sent; never logged.
  - Tests: web unit + integration (Keycloak mocked), `tests/kc/two-factor.kc.test.ts` against a real throwaway
    Keycloak 26.7.4 (`test-env/kc-setup.sh` gains a TEST-ONLY `proyekkas-web` client + user); mobile unit + widget.
  - Docs: ADR 0017; revisions in ADR 0012, `plans/fase1-golive.md` G1-3, ASVS checklist 4.3.1 / G-01 (decided).
- **Public APK download on the DRMS server** (`apps/web`, branch `feat/apk-download-page`; user decision 2026-09-27
  "host on the DRMS server"): `GET /unduh` — a public page in Indonesian (web-starter tokens/fonts, light/dark, 390 px,
  server component, `noindex`): version, size, publish date (WITA), big **Unduh APK** button, install/update steps,
  SHA-256 of the file and of the signing certificate, "Hanya untuk karyawan PT DRMS". `GET|HEAD /unduh/proyekkas.apk`
  — stable URL for Pengaturan → "URL unduh APK": streams the current release with
  `application/vnd.android.package-archive`, `attachment; filename="ProyekKas-<version>.apk"`, `Content-Length`,
  `Cache-Control: no-cache` + `ETag` (= SHA-256, 304 on match), `nosniff`, `X-Robots-Tag`; 404 with an Indonesian
  message while nothing is published. No login; the `/admin` gate and CSP nonce proxy are unchanged (own root layout
  in route group `(public)`, no Payload, no client components).
  - Files live in the existing media volume under `${MEDIA_DIR}/app-release/` with a manifest `latest.json`
    validated strictly by zod (`src/lib/app-release.ts`: fixed file-name pattern, path kept inside the directory,
    size must match → a partial copy is never served).
  - `apps/web/scripts/publish-apk.mjs` (Node built-ins only, shipped in the runner image): copies an APK, computes
    SHA-256, writes `latest.json` atomically, keeps the current + 2 previous versions; refuses a different file under
    an already published version. Runbook `docs/proyekkas/runbooks/rilis-apk.md` (one-shot `docker run --rm` with the
    running web image + media volume; no running container is touched).
  - Tests: `tests/unit/apk-download.test.ts` (manifest schema incl. traversal, route 404/200/HEAD/304, publish
    retention, page markup). No new dependency.
- **Release notes per version ("deskripsi rilis") in three places** (web + APK 0.2.1; user decision 2026-09-28):
  - Source of truth for the APK: `docs/release-notes/apk/<X.Y.Z>.md` — short Indonesian bullets for field employees
    (0.2.0 and 0.2.1 written; format rules in `docs/release-notes/README.md`). Must exist before the tag is pushed.
  - **`/unduh`**: `scripts/publish-apk.mjs --notes <file.md>` stores the bullets as plain text `notes: string[]` in
    `latest.json` (markdown bullets, continuation lines, title/blank lines ignored, inline markup reduced to text;
    1–15 bullets × ≤ 300 chars, no control characters; a bad file fails before anything is copied). The zod manifest
    schema accepts the optional field (older manifests stay valid); the page shows "Yang baru di versi X" as escaped
    text. Retention unchanged. Runbook `rilis-apk.md` passes `--notes /in/notes.md`.
  - **In the APK**: `GET /api/v1/app/config` gains optional `releaseNotes: string[]` — the manifest notes when the
    published APK's version equals "Versi APK terbaru" (else omitted; cached with the settings for 60 s). OpenAPI
    regenerated. APK: tolerant parsing (`AppConfig.releaseNotes`, ≤ 15 × ≤ 300), the home line "Versi baru tersedia"
    became a tappable banner → sheet with "Yang baru di versi X", install hint and the download link (copy button as
    before); the blocking "Perbarui aplikasi" screen shows the same list and scrolls when long. New ARB strings only.
  - **GitHub Releases**: `mobile.yml` job `release-prod` fails before building when the notes file for the tag version
    is missing, and after the APKs are verified creates/updates the Release of `mobile-vX.Y.Z` (body = notes file +
    certificate SHA-256 + CHANGELOG link; assets = the three ABI APKs + `SHA256SUMS.txt`; job-level
    `contents: write`, workflow default stays read). New workflow `release-notes.yml`: tag `vX.Y.Z` → Release with the
    `## [X.Y.Z]` section of this file (fails when the section is missing).
  - Tests: `tests/unit/apk-download.test.ts` (schema limits, markdown parsing, publish with/without notes,
    `releaseNotesFor`, page escaping), `tests/integration/f4-mobile.int.test.ts` (app config `releaseNotes`),
    APK `test/unit/misc_test.dart` + `test/widget/release_notes_test.dart`. No new dependency.

### Changed
- **Release APK on self-hosted**: release builds (R8 + obfuscation) get Gradle heap 2.5 GiB / metaspace 512 MiB
  (`GRADLE_OPTS_RELEASE`; debug keeps 1.5 GiB) — `assembleStagingRelease` died after ~8 min with exit 1 and no kernel
  OOM at 1.5–2 GiB. `tool/build_with_retry.sh` now prints a failure excerpt (FAILURE / What went wrong /
  OutOfMemoryError / error:) and can keep the full log (`BUILD_LOG_KEEP`); the staging release log is uploaded on
  failure (3 days).
- **Trivy cache on self-hosted** uses the runner's persistent `TRIVY_CACHE_DIR` instead of `_temp` (root-owned files
  there could not be cleaned by the runner); GitHub-hosted unchanged.
- **Self-hosted image publish hang (plan 12 R10)**: buildkitd (docker-container) now runs with
  `--oci-worker-no-process-sandbox` on self-hosted — RUN steps in a nested pid namespace hung forever under
  sysbox-fs 0.7.1 (leaked unreaped helper). GitHub-hosted keeps the default buildkitd flags.
- **Self-hosted runner fixes (infra plan 12 R10)**: APK jobs on self-hosted use Gradle heap 1.5 GiB, metaspace 384 MiB,
  1 worker (F1: the 4 GiB cgroup OOM-killed Gradle during the staging APK build); publishing image builds always use
  buildx `docker-container` because the `docker` driver cannot push-by-digest (F2); local-only builds keep `docker`.
- **CI runner switchable + fewer runs** (GitHub Free minutes exhausted 2026-09-28; owner chose a self-hosted runner,
  infra plan 12): every job's `runs-on` reads repo variable `CI_RUNS_ON` (deploy-prod: `DEPLOY_RUNS_ON`) as JSON, e.g.
  `["self-hosted","linux","x64","drms"]`; unset = `ubuntu-24.04` as before, so switching back needs no code change.
  `ci` / `mobile` no longer run on pushes to `feat/**`, `fix/**` (they run on the pull request; a push + PR used to
  run everything twice). Staging APK artifacts kept 7 days (was 30), coverage 3 days (was 14) to stay under 500 MB.
  **Self-hosted-ready (plan 12 R8):** on `runner.environment == 'self-hosted'` no GitHub cache (`actions/cache`,
  `setup-node` npm cache) — the runner image's persistent `npm_config_cache` / `PUB_CACHE` / `GRADLE_USER_HOME` are
  used; the Flutter tarball is kept in `/cache/flutter` (`FLUTTER_TARBALL_CACHE`) and sha256-checked on every use
  (`apps/mobile/tool/ci_install_flutter.sh`); buildx `docker` driver without `type=gha` (GitHub-hosted keeps
  `type=gha`); release tags `v*` build images with `no-cache`, `release-prod` APK with job-local pub/Gradle dirs;
  APK jobs get `GRADLE_OPTS` for 4 GiB (no daemon, 2 workers, `-Xmx2g`, Kotlin in-process); mobile coverage
  artifact on GitHub-hosted only (job summary line everywhere); staging release APK kept 3 days; timeouts raised
  for 2 vCPU (verify/security 30, integration 40, mobile verify 45, image/APK 75 min); `ci` image job reads the
  version with `jq` (no `node` on the runner PATH).
- **`company-settings` global = app-wide only** (APK gate, device image targets, offline max age, selfie batch
  size, new group letterhead `groupName`/`groupLogo`/`groupPdfHeader`); editable by the group admin only. Per-PT
  settings (thresholds, reminders, sync flags, default schedule, retention) live on the company record.
- **Login / Keycloak (ADR 0016 §2):** per-PT roles are DB-only; the web callback no longer syncs realm roles into
  `users.roles` (removed), the APK bearer no longer intersects token roles; a login needs the realm role `pk-user` —
  **MC1 transition:** any legacy `pk-*` realm role is accepted as the same login marker until the infra change
  assigns `pk-user`. User create in the admin assigns only `pk-user` in Keycloak (fallback `pk-staff` marker while
  the realm lacks `pk-user`); role edits never call Keycloak.

### Security
- **MC2 per-PT fixes of MC1 leftovers:** addendum decisions used the union of the caller's roles over the selected
  PTs (Finance of PT A + PM of PT B could decide a PT B addendum) → roles IN the addendum's PT; manual cash
  posting / edit / void checked only "Finance in any PT" → Finance of the account's / entry's PT (else 400/404);
  internal PDF copy, full bank number in the request DTO, cash rows in the request history, device revoke,
  attendance correction and PM on-behalf check-in now check the role in the document's PT.
- **MC2 integration:** the Absensi recap built a company-less team scope from the query string — an office user of
  PT A filtering by a project id of PT B saw B's attendance → `narrowAttScope` (filters stay inside each PT). The
  Finance queues (transfer queue, LPJ verification, `GET /api/v1/transfer-queue`) listed the team requests of a PT
  where the caller is only PM (with the bank snapshot) → limited to the PTs where the caller is Finance / Direktur.

### Removed
- `users.roles` and `users.employee` (replaced by `company-memberships`).

### Fixed
- **Mobile token parity** (`apps/mobile/lib/app/theme/tokens.dart`): the web token `primarySoft` added in 0.4.2
  (loader dots) was missing on the Flutter side, so `test/unit/theme_tokens_test.dart` failed (22 ≠ 23 keys) and
  the mobile workflow was red on develop. `PkTokens.primarySoft` added (light `#BFDBFE`, dark `#1E40AF`).
- **CI semgrep red on develop** (`admin/views/AksesPt.tsx`, MC2 role matrix): five Local API reads passed their
  access arguments through a spread (`...read`), which rule `payload-local-api-implicit-override-access` cannot see.
  The arguments `user, overrideAccess: false, req, depth: 0` are now written literally in each call (same behaviour).

## [0.4.2] - 2026-09-28

### Added
- **Admin loader** (`apps/web`, branch `feat/admin-loading-dots`): five pulsing dots (Uiverse.io
  "thin-lionfish-5" by adamgiebl, MIT © 2023 Uiverse.io — provenance + licence in ADR 0014 addendum and
  `src/admin/loading/_loading-dots.scss`) on every **module navigation** (launcher, module menu, breadcrumbs, links
  inside views, filter forms, Payload redirects) and during every **create / update / delete** (Payload Save /
  Publish / Delete / bulk actions / Duplicate and every custom-view `/api/v1` POST/PATCH/DELETE). One client
  provider (`admin.components.providers` → `src/admin/loading/LoadingProvider.tsx`): same-origin link clicks +
  `useRouteTransition` for navigation, a single `window.fetch` wrapper counting unsafe `/api/` requests for
  mutations (exclusions: autosave, preferences, document locks, access probes, auth/session, notification
  read-marks, POST-as-GET queries, server actions). Shown after 180 ms, ≥ 300 ms, never > 15 s; navigation overlay
  keeps the module bar visible, the save overlay blocks pointer input (no double submit). Colours follow the admin
  theme (light pale primary → primary, dark primary → primaryHover; new token `primarySoft`); reduced motion =
  static dots; `role="status"` "Memuat…" / "Menyimpan…". Unit tests `tests/unit/admin-loading.test.ts` + theme
  contrast checks.

### Fixed
- **Flaky F3 KPI integration test across midnight** (`tests/integration/f3-kpi-reconciliation.int.test.ts`): the
  suite runs ~10 min and captured "today" once in `beforeAll`; a CI run started 23:57 WITA crossed midnight, so the
  code's today (company TZ) moved on while the expectations did not (K-01, K-02, K-11, K-12 off by one day). "today"
  and the current month are now re-read before every test. Test-only change, no app code touched.

## [0.4.1] - 2026-09-27

### Added
- **MC0 — multi-company analysis (docs only, branch `docs/mc0-multi-company`; user decision 2026-09-27):** several PTs
  of the client group in one ProyekKas, one login per person, per-PT role matrix, full consolidation, mutations always
  within one PT, before go-live.
  - ADR 0016 `docs/proyekkas/adr/0016-multi-company.md` (proposed; design approved by the user): `companies` master
    (identity + operational settings; `company-settings` keeps app-wide values), `company-memberships` as the source of
    per-PT roles (Keycloak keeps identity + realm role `pk-user`), `company_id NOT NULL` + composite uniques + per-PT
    numbering counters and period lock + cross-PT DB triggers, access context = selected PTs ∩ memberships
    (`X-Company-Ids`, cookie), per-PT reports/jobs/APK; alternatives (deployment per PT, Keycloak Organizations, RLS),
    security model, staging backfill to company #1 DRMS.
  - Dated "Revisi 2026-09-27 (ADR 0016)" sections in ADR 0003, 0005, 0007, 0009, 0010, 0013.
  - `requirements-v1.2.md` (delta on v1.1: shared vs per-PT data, per-PT role matrix, consolidation rules per screen,
    letterheads, numbering examples, US-MC-01…19); client questions Q-51…Q-61 (`open-questions-client.md` §L);
    phase **MC** (MC0–MC4, 60–88 pd, go-live ≈ 4–6 weeks later) and risk #8 in `phase-plan.md`; traceability rows;
    wireframes `docs/proyekkas/mc/wireframes.md`; code change inventory `docs/proyekkas/mc/impact-inventory.md`.

### Changed
- **Admin breadcrumbs** (`apps/web`): Payload's AppHeader row under the module bar (a lone graphics-Icon "D" home
  crumb, and an empty row on pages without crumbs) is replaced by a slim **breadcrumb line** under the bar
  (`ModuleBar` → `PageCrumbs`, pure derivation in `src/admin/shell/crumbs.ts`): home = the current module (icon +
  name → its first menu item; "Semua modul" outside every module), then Payload's steps, e.g. **Keuangan › Pengajuan
  biaya › PB-2026-0001**; last crumb `aria-current="page"`. Shown on collection list/edit, globals and account; custom
  views and the launcher have no crumbs → no row, no gap. Steps left over from the previous page (custom views set
  none) are ignored; before Payload sets them, the module menu labels are used (no jump after hydration).
- **APK 0.2.0 — tampilan selaras web admin** (`apps/mobile`, branch `feat/mobile-ui-refresh`; ADR 0015 accepted,
  plan `docs/proyekkas/plans/mobile-ui-refresh.md`). Look only — behaviour, API, sync and DB unchanged:
  - Theme built from the web tokens (`apps/web/src/theme/tokens.ts` → `lib/app/theme/tokens.dart`): primary #2563EB,
    accent #EA580C, slate surfaces, radius 14, surface-style app bar, **light and dark**; field sizes kept (52 dp
    buttons, ≥ 48 dp targets). `StatusColors` replaced by the `PkColors` theme extension (`context.pk`, ok/warn/bad +
    dark-mode text variants). New **Profil → Tampilan** (Sistem / Terang / Gelap), stored on the phone.
  - Space Grotesk + DM Sans bundled as assets (SIL OFL 1.1, from google/fonts, licence texts in the licence page).
  - Iconsax glyphs identical to the web (path data from `icons.ts`, drawn by an in-house SVG path parser; no icon
    package).
  - Home = module launcher: greeting + role, gradient tiles (web module gradients, count badges, staggered entrance,
    off with reduced motion) replacing the big-button list, shown above the KPI section so no role has to scroll to
    its menu; all visibility rules, routes and test keys kept. Bottom
    navigation with Iconsax Linear/Bulk icons on a primary-tint pill. Login/splash in the new palette.
  - Hard-coded colours on the other screens moved to theme tokens (status chips, timeline, attendance distance/recap/
    team, tab bars made for the old solid app bar).
  - Request detail: the "Dampak anggaran > 85%" warning uses a warning icon instead of a ⚠ text glyph (not in DM Sans).
  - Tests: token drift + WCAG contrast (`theme_tokens_test.dart`), glyph drift + parser (`iconsax_test.dart`),
    Tampilan/launcher (`ui_refresh_test.dart`); widget tests now run with the real theme. Preview screenshots without
    a device: `test_preview/screens_preview_test.dart` (manual, not in CI). No new package.

### Fixed
- **No horizontal page scroll at 390 px** (audit of every custom view, launcher, collection list/edit, globals and
  account × 5 roles): Antrian Transfer (−253 px) becomes stacked cards per request on screens ≤ 640 px (the transfer
  form stays inside its card); the other custom-view tables (Verifikasi LPJ −28 px, Persetujuan, Notifikasi, transfer
  void list, Riwayat, nota tables in the edit view) scroll inside their own focusable box with edge shadows
  (`TableScroll`); the account view (−60 px, Payload's settings divider wider than the page) is contained.

## [0.4.0] - 2026-09-27

### Changed
- **Admin navigation "gaya Odoo"** (`apps/web`, ADR 0014 accepted):
  - `/admin` is now a **module launcher**: greeting (name + role) and a tile per visible module — Iconsax Bulk glyph
    in white on a module gradient, badge = summed pending counts, staggered entrance / hover lift (motion), off with
    `prefers-reduced-motion`. 11 modules: Dashboard, Persetujuan, Proyek, Keuangan, Absensi, Laporan, Pengguna & Akses,
    Master Data, Media, Pengaturan, Sistem (`src/admin/modules/registry.ts`, single source of truth).
  - The left sidebar is replaced by a **sticky top module bar** (`admin.components.Nav` →
    `src/admin/shell/ModuleNav.tsx` + `ModuleBar.tsx`): ⊞ launcher, current module, horizontal menu with ▾ dropdowns
    and an animated active pill, notification bell (moved from `beforeNavLinks`) and an avatar menu (Profil & tanda
    tangan, light/dark theme, logout). Narrow screens (≤ 768 px or a menu that does not fit) get a ☰ sheet; keyboard:
    ←/→/Home/End, ↓ opens, Esc closes, focus rings, `aria-current`.
  - The role dashboard ("Beranda") moved to its own module at **`/admin/dashboard`** (same tabs `?peran=`/`bulan=`).
  - Visibility unchanged in substance: Payload read permission ∧ `visibleEntities` (F2c staff whitelist) ∧ the role
    rules formerly in `F2NavLinks.tsx` (retired; `beforeNavLinks`/`afterNavLinks` removed). Badge counts unchanged
    (S3e S-07 transfer queue definition).

### Added
- Module gradient tokens (light + dark) in `src/theme/tokens.ts`; white glyph ≥ 3:1 on every stop (theme test).
- Dependency `motion` 13.4.0 (MIT, exact pin). Iconsax glyphs are inline SVG (`src/admin/modules/icons.ts`) — the
  `iconsax-reactjs`/`iconsax-react` packages were rejected (last release 2025-04 / 2022-05, §0.10 maintenance rule).
- Tests: `tests/unit/admin-modules.test.ts` (every collection/global in exactly one module, per-role tiles with the
  real config, active-module resolution, bar SSR); nav tests (f2d, e2, s3e) target the registry; launcher
  integration test with the real access layer.

## [0.3.0] - 2026-09-27

Fase 1 go-live build (web + API; images `ghcr.io/bctech-adm/proyekkas-{web,migrate}:0.3.0`). Covers F3 dashboards,
reports and exports, the F4 APK backend (`/api/v1/sync/batch`, devices, masters) and fase1-golive epics E1–E11:
approval flow Direktur → Finance (ADR 0013), Finance cash UI (E2), project stages/progress + Addendum RAB (E4/E5),
attendance + selfie retention (E6), scheduled reminders (E7), E9 hardening (signed media URLs, settlement reversal,
coverage gate, upload resize queue), E10 GHCR images + prod compose, E11 Excel import/cut-over, and the S3 Fase 1 UAT
gap fixes. The APK (`apps/mobile`) changes listed here ship on their own `mobile-vX.Y.Z` tags (pubspec version),
not with this web release.

### Added
- **E9 follow-ups — upload resize queue, B-1, B-2** (`apps/web`, branch `fix/e9-upload-resize-queue`; QA report
  `docs/proyekkas/qa/s3-e9-qa-report.md` §7, user decision 2026-09-27):
  - P-1: process-wide FIFO image queue (`src/lib/image-queue.ts`): at most `IMAGE_RESIZE_CONCURRENCY` (default 2)
    sharp jobs at once, `IMAGE_RESIZE_MAX_QUEUE` (default 20) waiting, 30 s max wait; `POST /api/v1/media/{kind}`
    queues the whole upload (DB transaction opened only after the slot is granted) and answers 503 + `Retry-After: 5`
    (`code: UPLOAD_BUSY`) when full; generic REST uploads are gated per sharp pipeline and refused (503) while the
    queue is saturated. `sharp.cache(false)`, `sharp.concurrency(1)` kept. Outputs unchanged. Queue wait logged at
    debug (`image queue slot`). AC E9: uploads p95 < 5 s, everything else < 2 s.
  - B-1 (ASVS G-21): generic REST create/update with a non-object body (form/text, multipart without `_payload`, JSON
    array/null) → 400 with a clear message instead of a 500 from the collection hooks (`src/lib/body-guard.ts`, first
    `beforeOperation` hook of every collection and the `company-settings` global).
  - B-2 (ASVS G-22): the E11 import no longer tries Keycloak per revoked device (audit `keycloak_skipped`); the report
    prints ONE `PERINGATAN KEYCLOAK` block listing users to disable + log out (or re-enable) and the CLI writes
    `…-keycloak-tindak-lanjut.csv`; Keycloak step (`kc_*`, realm drms) added to the import and cabut-perangkat runbooks.
- **S3 track E — Fase 1 UAT gap fixes** (`apps/web`, branch `feat/s3e-uat-gap-fixes`; S-ids of
  `docs/proyekkas/uat/fase1/README.md`):
  - S-01 PM home: "Pengajuan tim menunggu keputusan" (Direktur / Finance) instead of the empty "Diketahui saya" card;
    `GET /api/v1/dashboard/pm` adds `teamWaiting`.
  - S-03 web bank account picker filtered to the requesters' active accounts; empty = first requester's default.
  - S-04 in-app notifications on submit / withdraw / created on behalf; optional approval email to the deciding
    Direktur/Finance (sendEmail queue); web notification bell + `/admin/notifikasi`. Settings
    `notifyRequesterStatusEnabled` (on), `approvalEmailEnabled` (off, upgrade copies `reminderEmailEnabled`).
  - S-05 Persetujuan + request panel show lines, receipt photos and per-line flags to deciders; `approvals.openFlags`
    = open flags of both levels.
  - S-06 reject/revision reason: client min length, server detail "Alasan wajib diisi, minimal 3 karakter.".
  - S-07 Antrian Transfer badge = page count. S-08 LPJ "Tandai flag diperiksa". S-29 "Anda juga yang menyetujui".
  - S-19 default geofence radius for points without radius (server + masters). S-23 Admin attendance report export.
  - S-24 receipts ≤ 1600 px, logo ≤ 1024 px, 50 MP / 2 MB caps. S-26 resubmit copies receipts.
  - Migration `20260926_141606_s3e_uat_gap_fixes` (additive, `company_settings`).
- **S3 web A — E9 hardening F6** (`apps/web`, fase1-golive §E9; branch `feat/s3a-e9-hardening`):
  - Signed, time-limited media URLs (ADR 0004 §4b): `GET /api/v1/media/{collection}/{id}/signed-url` mints a 5-minute
    HMAC-SHA256 URL of the file endpoint (keys `MEDIA_URL_KEYS[_FILE]` with rotation, default derived from
    `PAYLOAD_SECRET`); expired/invalid → 403, valid signature but the user may not read the file → 403 +
    `access_denied`. Bearer/cookie downloads unchanged (APK compatible). Selfies are served by the media file
    endpoint too (`selfies`), with `view_sensitive` for other people's selfies.
  - `/admin/*` without a session cookie → real **302** to `/admin/login?redirect=…` (Next proxy) instead of the 200 shell.
  - Settlement reversal: `POST /api/v1/expense-requests/{id}/settle/reverse {reason}` (Finance) voids the refund KM /
    shortfall transfer + KK, LPJ back to "Terverifikasi", request "LPJ Terverifikasi", balances restored, audited;
    closed period → 409; button "Batalkan penyelesaian LPJ" on the request detail. Migration
    `20260926_131136_s3a_e9_hardening` (4 additive columns on `settlements`, guard update).
  - 403 before 409 (UAT 5.2): authorization failures are answered before state conflicts (expense flow, addendum).
  - `login_failed` audit for logins refused on the ProyekKas side (OIDC callback failure, unknown/inactive account);
    Keycloak event log = source of truth for wrong passwords (ADR 0003 §7). Hash chain deferred (ADR 0006 §5).
  - CI: unit-test coverage gate (`npm run test:coverage`, thresholds in `apps/web/vitest.config.ts`).
  - Docs: ASVS L1 self-checklist `docs/proyekkas/security/asvs-l1-checklist.md`.
- **S3 track C — E10 images on GHCR + prod compose** (branch `feat/s3c-e10-ghcr-ci`): `ci.yml` job `image` builds web +
  migrate on GitHub runners (buildx, GHA cache), Trivy gate (fail on fixable CRITICAL, HIGH/CRITICAL reported in the job
  summary), pushes `ghcr.io/bctech-adm/proyekkas-{web,migrate}` with OCI labels, SBOM and provenance (`develop` →
  `sha-<sha7>` + `<ver>-stg-<sha7>`, tag `vX.Y.Z` → `X.Y.Z`, `ci/ghcr-*` → `test-<sha7>`); `deploy/prod/docker-compose.yml`
  (identical to the infra prep except comments); inert, approval-gated `deploy-prod.yml` (environment `infra-deploy`);
  runbook `docs/proyekkas/runbooks/ci-ghcr.md`.
- **S3 web B — E11 data go-live: template Excel + impor idempoten + cut-over** (`apps/web`, fase1-golive §E11,
  Q-17/19/20/22/23/36/37/40; branch `feat/s3b-e11-data-import`):
  - Workbook `docs/proyekkas/templates/drms-impor-golive-template.xlsx` (sheet Petunjuk + Pengaturan, Bank, Satuan,
    Kategori, Karyawan, Pengguna, Rekening, PusatBiaya, Project, Tahapan, RAB, Kendaraan, Penugasan, AkunKas; header
    check, dropdowns, number ranges, input hints) and a FICTIONAL sample, both generated reproducibly by
    `npm run gen:import-template` (`check:import-template` guards drift).
  - Import CLI `payload run src/import/cli.ts -- (--dry-run|--commit) --file … [--kc-map …] [--out …]` (migrate image,
    APP role): errors per sheet/row/column; dry-run executes every write in one transaction that is always rolled
    back; commit = one transaction per master, upsert on natural keys (second run = no-op), audit action `import`.
    Keycloak is not called: users without a `username → id` mapping are skipped and exported
    (`…-keycloak-users.json/csv`, no passwords) for the infra Lead.
  - Cut-over: opening balance + `openingBalanceDate` = go-live date, month before go-live closed, PB `startAt` from the
    workbook (229, Q-17; counter raised upward only, audited).
  - Opening balance lock after the first close on/after the opening month (hook 409 + DB trigger); no cash entry
    before an account's opening date (ADR 0005 "As implemented (S3b)"). Runbook `docs/proyekkas/runbooks/import-data-golive.md`.
  - Migration `20260926_133934_s3b_data_import` (additive: enum value `import`, `cash_accounts.opening_balance_date`,
    CHECK + two triggers).
- **APK S2 — laporan progress (E4) + absensi lengkap (E6)** (`apps/mobile`, branch
  `feat/mobile-s2-progress-attendance`). Progress: offline-first reports (project/stage, % never below the stage %,
  ≤ 5 rear-camera photos compressed on the phone, `progress_report.draft_upsert` or online POST/PATCH when
  `syncProgressReports` is off), list/detail with photo thumbs, edit ≤ 24 h with reason, conflict screen (server vs
  phone), K-09 "progress fisik vs anggaran" cards (PM/Direktur home + tab). Absensi: check-in/out at a project or a
  pusat biaya with distance feedback, monthly recap calendar, "Tim hari ini", PM on-behalf (reason, front/back
  camera, offline), corrections (online). Local DB schema v2 (`local_progress_reports`, additive). Fix: saving an
  expense draft no longer deletes queued selfies/progress photos. E5 Addendum RAB on the APK: section in the
  Direktur/Finance inbox, detail with RAB impact + timeline + server `allowedActions` (Setujui Direktur / Finance,
  Tolak with reason), PM create/submit/cancel (online, Idempotency-Key).
- **S2 web A — E4 progress web + E5 Addendum RAB** (`apps/web`, fase1-golive §E4/§E5, US-12/18/29/30/31; branch
  `feat/s2a-progress-web-addendum`):
  - Admin views `/admin/progress` (K-09 progress fisik vs % anggaran per project, KPI tiles, table view),
    `/admin/progress/project/{id}` (stage bars, stage editor with live 100 % validation — Direktur add/deactivate,
    PM rename/reorder/re-weight, reason on re-weight — timeline per stage, addenda of the project),
    `/admin/progress/laporan` (filters project/stage/date) and `/admin/progress/laporan/{id}` (photo gallery). Beranda
    Direktur/Finance/PM: card "Progress fisik vs anggaran" (US-12) and "Progress fisik" column; PM "Lapangan" card shows
    the latest progress reports. Report `anggaran-project`: "Progress fisik" + K-09 status columns (was "F5").
  - Addendum RAB (T12): collection `budget-addenda` (`ADD/YYMM/####`), `/api/v1/budget-addenda` (list, inbox, detail,
    create/patch/submit/cancel for the PM of the team, acknowledge = Direktur, approve = Finance, reject with reason;
    Idempotency-Key, APK-ready). Approval through `approval-rules` docType `budget_addendum` (ADR 0013 engine);
    decisions are `approvals` rows (docType `budget_addendum`); final approval raises `projects.budget` = current RAB +
    addition in the same transaction (audit before → after); in-app notifications. Web `/admin/addendum`,
    `/admin/addendum/baru`, `/admin/addendum/detail/{id}`; "Persetujuan" lists addenda too. Nav: Progress project,
    Laporan progress, Addendum RAB.
  - Migration `20260926_114555_e5_budget_addenda` (additive: new table + guards, `approvals.addendum_id`,
    `approvals.request_id` nullable with an owner CHECK per docType, G1 trigger for addenda, default rule
    "Default Addendum RAB — Direktur lalu Finance").
- **S2 web B — E6 absensi web + retensi selfie + E7 pengingat terjadwal** (`apps/web`, fase1-golive §E6/§E7, US-09/11/13/14/15,
  M12/M13, Q-30/33/40; branch `feat/s2b-attendance-web-reminders`):
  - Admin views `/admin/absensi` "Tim hari ini" (belum absen / hadir / selesai board, times, project/pusat biaya, late,
    diabsenkan PM, filters date/project/cost center), `/admin/absensi/rekap` (per employee: month calendar with
    status legend, KPI tiles, day detail, T10 correction dialog before → after with mandatory reason, correction history,
    audited selfie viewer; without employee: team grid employees × days + totals; Staff: own recap), `/admin/absensi/jadwal`
    (company default schedule, schedule list, employee schedule assignment, holidays per year + add, cost-center geofence
    lat/lng/radius editor with an OpenStreetMap link — no embedded map). Nav "Absensi" (PM/Finance/Direktur/Admin),
    "Rekap absensi saya" (Staff). Beranda PM: widget "Kehadiran tim hari ini" replaces the F5 placeholder. Laporan
    absensi rows link to the employee recap; stale "Rekap absensi (F5)" row removed from `/admin/laporan`.
  - Retensi selfie (Q-33): job `selfieRetention` deletes selfie FILES older than `selfieRetentionMonths` when
    `company-settings.selfieRetentionDeleteEnabled` is on (**default OFF** = dry run), at most `selfieRetentionBatch`
    (default 200) per night, oldest first, face reference photos never; media row kept as tombstone
    (`media_selfies.removed_at`, immutable once set) because attendances are append-only; one `retention_purge` audit row
    per run (counts only). Attendance rows untouched; selfie endpoint answers 404.
  - Pengingat terjadwal (E7, M12/US-11): job `dailyReminders` (hourly tick, one run per business day at/after
    `reminderHour`, company TZ) — laporan progress terlambat → PM + Direktur; uang muka tanpa nota/LPJ > `lpjDueDays` →
    pemohon + Finance; revisi nota/LPJ menggantung ≥ `reminderRevisionDays` → pemohon; komitmen anggaran ≥ ambang
    kuning/merah → Direktur + Finance + PM (once per threshold per project). Exactly one notification per recipient,
    rule, subject and day (`reminder_deliveries`, append-only); inactive users and archived projects excluded; in-app
    always, email via the `sendEmail` queue when `reminderEmailEnabled` (**default OFF**). Settings per rule in
    company-settings ("Pengingat terjadwal (E7)").
  - Migration `20260926_104606_s2b_attendance_reminders` (additive: nullable/defaulted columns, 2 new tables, enum values).
- **E6 backend — absensi lengkap** (`apps/web`, fase1-golive §E6, US-01/02/09/13/14/15, Q-30/33/40; branch
  `feat/e6-attendance-backend`). Web/APK screens follow in S2; `syncAttendanceEnabled` stays **off** by default.
  - Cost-center geofence (Q-40): `cost-centers` lat/lng/radius (optional); sync check-in/out takes `project_id` XOR
    `cost_center_id`; one check-in/out per employee/location/day (DB unique index for both).
  - "Diabsenkan oleh PM" (US-14): sync item `attendance.on_behalf` (was `unsupported`) — PM only, team location,
    employee assigned that day, not the PM themself, reason required, GPS + photo from the PM phone; stored with
    `source = pm`, `recordedBy`, `onBehalfReason` (DB CHECK); employees without an account supported (`user` empty).
  - Koreksi absensi T10 (US-15): `POST /api/v1/attendance/{id}/correct` (team PM or Admin, never own attendance,
    reason ≥ 3, same local date, order check-in ≤ check-out, not in the future, Idempotency-Key). New append-only
    collection `attendance-corrections` (DB triggers + no UPDATE/DELETE for the app role); the newest correction is
    the effective time everywhere; audit `update attendanceTime` old → new with the reason; denied attempts audited.
  - Jadwal/libur/terlambat (Q-30): `work-schedules.workDays` (Mon–Sat default), `employees.workSchedule`,
    `company-settings.defaultWorkSchedule`; schedule snapshot on each attendance; late = minutes after start when
    above the tolerance, early leave, work minutes, holiday/off-day attendance flagged (never late).
  - Rekap bulanan (US-09) `GET /api/v1/attendance/me?month=`, recap of an employee `GET /api/v1/attendance/recap`
    (PM team / Direktur / Finance / Admin), tim hari ini (US-13) `GET /api/v1/attendance/team-today`, selfie viewer
    `GET /api/v1/attendance/{id}/selfie` (Q-33 roles, audited `view_sensitive`).
  - Laporan absensi (M13): report `absensi` (CSV/XLSX) on `/admin/laporan` and `/api/v1/reports/absensi`.
  - Retensi selfie (Q-33): `company-settings.selfieRetentionMonths` (default 12) + daily job `selfieRetention`
    (**dry run**: counts candidates, never face reference photos; file deletion = S2).
  - Masters for the APK: cost centers with lat/lng/radius, work schedules with `workDays`.
  - Migration `20260926_091848_e6_attendance` (additive; staging-safe: no existing row rewritten).
- **E4 backend — project stages + progress reports** (`apps/web`, fase1-golive §E4, T11, US-10/11/12/29/31; branch
  `feat/e4-progress-backend`; web views = Sprint S2, APK screens = E4-APK):
  - Collection `progress-reports` (`LP/YYMM/####`; project, stage, % before → after, project % before → after, pekerjaan,
    kendala, pelapor, ≤ 5 photos in `media-progress-photos`, offline/time-trust flags). Written only by the domain
    service; HTTP collection writes closed. Read: PM team, Direktur/Finance all (Staff/Admin none).
  - API: `POST/GET /api/v1/progress-reports`, `GET/PATCH /api/v1/progress-reports/{id}` (edit ≤ 24 h by the reporter,
    reason required), `GET/PUT /api/v1/projects/{id}/stages` (stage editor: whole set = 100 %, G11), `GET
    /api/v1/projects/progress` (K-09 progress fisik vs anggaran), media kind/file collection `progress-photos`,
    `/me` capability `progressReportCreate`, masters `projects.progressPct`, `project-stages.active`. Problem responses
    of E4 carry a `code` (e.g. `WEIGHTS_INCOMPLETE`, `PROGRESS_DECREASED`, `PHOTO_LIMIT`). OpenAPI regenerated.
  - Project physical progress `projects.progressPct` = Σ(weight × stage %) / 100, recalculated in the same transaction
    as the report / stage edit, audited before → after; stage/project % cannot be written directly (403 + DB guard).
  - Sync: `progress_report.draft_upsert` is processed (was `unsupported`): create or edit (base_rev, conflict +
    `server_report`), idempotent by `client_uuid`; `GET /app/config` `features.syncProgressReports` from the new
    company setting `syncProgressReportsEnabled` (default on).
  - E7 hook points: `lateProgressProjects()` / `notifyLateProgressReport()` (no schedule).
  - Migration `20260926_095319_e4_progress_reports` (additive: new table + 4 defaulted/nullable columns; DB guards:
    progress_pct guard, report 24 h window, no delete, immutable identity columns, ≤ 5 photos per report).
- **E1 APK + E3 APK parity** (`apps/mobile`, fase1-golive §E1 AC-10, §E3-b/c/d; branch `feat/mobile-e1-e3`):
  - Approval inbox/tab from `GET /api/v1/me` `capabilities.approvalInbox` (Direktur + Finance, ADR 0013), no longer
    `owner || pm`; PM gets a read-only **team monitor** (home KPIs from `/dashboard/pm`, "Tim" tab = `scope=team`).
    Inbox cards show the server `stepLabel`; the Direktur's "Diketahui" is a "Setujui (Diketahui)" decision;
    403 on a decision shows why and reloads. Timeline: "Diketahui (Direktur)", "Approval (Finance)", skipped
    positions "(tidak berlaku — pemohon)"; pre-E1 snapshots keep the PM label. "Owner" → "Direktur" in the app.
  - Requester parity with the web: "Tarik kembali ke Draft" / "Batalkan pengajuan" (reason ≥ 3), "Ajukan ulang"
    (rejected → new draft), "Ubah & ajukan di HP" imports a server draft into the offline editor (server receipts
    read-only, `draft_upsert` identifies it by `request_id`); "Riwayat" screen (`GET …/history`, web labels).
  - Home KPI cards for Direktur/Finance (`/dashboard/owner|finance`, same data as the web Beranda) with sparklines,
    a budget meter and a tappable monthly cash-flow chart.
  - Background sync with WorkManager (`workmanager` 0.10.10): periodic 15 min + one-off after an unfinished run;
    encrypted DB + token store opened in the task isolate; one token owner per process.
  - Unknown routes show an Indonesian error page; release builds show readable text instead of a grey box
    (salvaged from `fix/mobile-login-redirect`).
  - CI: job `release-prod` (main / tag `mobile-vX.Y.Z`, environment `android-release-prod` approval, production key
    from environment secrets, SHA-256 printed, `apksigner` check, secret scan). No key is created by CI.
  - `config/prod.json` login mode = `password` (K3 / G1-3; needs Direct Access Grants in realm `drms`, E10).
- **E2 — web Finance UI for cash** (`apps/web`, fase1-golive §E2, US-23/US-24, ADR 0005; branch
  `feat/e2-finance-cash-ui`): admin views `/admin/kas` (buku kas with filters akun/periode/project/pusat biaya/arah/
  status, saldo per akun tiles, void rows kept and linked to their jurnal balik), `/admin/kas/baru` (kas masuk/keluar:
  tanggal, akun, sumber/kategori, project XOR pusat biaya, nominal, keterangan, bukti upload, kendaraan for kas keluar),
  `/admin/kas/:id/ubah` (edit before period close, reason required), `/admin/tutup-buku` (close a past month; re-open =
  Direktur = role `pk-owner`, G1-1). Void (cash entry) and Void transfer (Antrian Transfer + request detail) through a
  reason dialog. All writes go to the existing `/api/v1` domain endpoints with `Idempotency-Key`; the collections keep
  `create/update: denyAll`. Menu "Kas"/"Tutup buku" for Finance and Direktur only.
  - API: `GET /api/v1/cash-entries` filters `projectId`/`costCenterId`; `PATCH /api/v1/cash-entries/{id}` honours
    `Idempotency-Key`. No migration.
- **F4b APK completion** (branch `feat/f4b-mobile-completion`; gap analysis `docs/proyekkas/f4/f4-gap-analysis.md`,
  phone test script `docs/proyekkas/f4/f4-e2e-scenario.md`):
  - API: a valid token on a revoked/lost device gets `401` with `code: DEVICE_REVOKED`; the APK logs out on that first
    answer with an Indonesian message and a new install id.
  - Device integrity flags (root, emulator, developer options, ADB; mocked GPS per attendance fix) reported in
    `POST /api/v1/devices/register` and stored on `devices` (`integrityRisk`, `integrity*`) — recorded, never blocking
    (Q-43 proposal); warning on the APK home screen. Migration `20260925_015425_f4b_device_integrity` (additive).
  - APK: transfer status (amount, date, bank reference, void reason) and LPJ summary on the request detail; online
    receipts after approval (camera/gallery, device compression), remove receipt, "Nota sudah lengkap",
    "Kirim LPJ"/"Kirim ulang LPJ", "Kirim ulang nota", "Tandai selesai"; in-app notifications (bell + list, polling).
  - Attendance, F4 slice: own check-in/out at an assigned project from the APK, offline-capable (GPS via geolocator
    14.0.3, front-camera selfie, server geofence/mock/assignment/one-per-day checks, server-estimated time). Company
    setting `syncAttendanceEnabled` (default off). New collection `attendances` (append-only), migrations
    `20260925_023715_f4b_attendance` + `20260925_023716_f4b_attendance_security` (additive), `POST /api/v1/media/selfies`.
  - Env `PUSH_FCM_ENABLED` in the schema (default false; `true` refused until the FCM dispatcher exists).
  - CI: static secret scan of every built APK (`apps/mobile/tool/apk_secret_scan.sh`: gitleaks + trivy + deny-list).
- **F3 dashboards, reports and exports** (`apps/web`; design `docs/proyekkas/f3/*`, approved by the user 2026-09-24 with
  all defaults Q-F3-1…8): role home pages replacing the Payload dashboard (`admin.components.views.dashboard`) for
  Owner, Finance, PM (team scope), Admin and Staff, server-rendered with inline SVG charts (no chart library,
  `<title>` tooltips + data table), budget status always with a text label (Komitmen basis), attendance/progress as
  "F5" placeholders; `/admin/laporan` with 7 reports (Rekap Kas, Buku Kas, Pengeluaran per Kategori, Anggaran Project,
  Rekap Pengajuan, Kelengkapan Nota/LPJ, Biaya per Kendaraan) with plain GET filters and keyset paging; global
  `/admin/audit-log` for Owner/Admin/Finance (read-only; opening it is audited). Every KPI follows
  `kpi-definitions.md` (K-01…K-17) and is reconciled against its SQL rule on ≥ 500 generated requests
  (`tests/integration/f3-kpi-reconciliation.int.test.ts`).
- **API:** `GET /api/v1/dashboard/{owner,finance,pm,admin,me}`, `GET /api/v1/reports/{code}` (JSON, same filters/scope
  as the web page) and `GET /api/v1/reports/{code}/{csv|xlsx|pdf}` (audited `export`, 10/min per user).
- **Exports:** CSV always (streamed in 1 000-row keyset pages, UTF-8 BOM, `;`, CRLF, formula-injection guard, ≤ 100 000
  rows); XLSX via `write-excel-file` 4.1.1 (MIT, lazy import, ≤ 10 000 rows → else 413, amounts `#,##0`, real dates,
  no formula cells; env `EXPORT_XLSX_ENABLED=false` hides it / 404); PDF (A4 landscape, ≤ 500 rows) for Rekap Kas,
  Pengeluaran per Kategori and Anggaran Project with the existing `@react-pdf/renderer`. XLSX and PDF share one
  in-process semaphore (2 concurrent, 10 s → 503) with the F2 document PDF (`lib/heavy-gate.ts`).
- **Company setting `lpjDueDays`** (default 7, Q-F3-1): Uang Muka without LPJ older than this since the first advance
  transfer is "LPJ terlambat". Migration `20260924_110138_f3_reports` (one column with a constant default) — additive.
- Nav links "Laporan" (Finance/Owner/PM) and "Audit Log" (Owner/Admin/Finance); `data-pk-*` selectors for UAT.

- **F4 APK backend** (`apps/web`, ADR 0010): `POST /api/v1/sync/batch` (bearer + registered device; drafts
  create/edit/delete + receipts per line, per-item transactions, idempotent by `client_uuid` via `sync_receipts`,
  `rev`/`base_rev` conflicts — server wins, offline device time stored as comparison only, attendance/progress →
  `unsupported` until F5); public `GET /api/v1/app/config` (min/latest APK version, download URL, company TZ,
  feature flags incl. `pushEnabled:false`); `/.well-known/assetlinks.json` (env `ANDROID_APP_PACKAGE`,
  `ANDROID_APP_CERT_SHA256`); request detail gains `rev`, `timeline` and `nextActor` ("Giliran"); device
  registration accepts `fcmToken: null`. Migrations `20260924_025114_f4_mobile_sync` (columns
  `expense_requests.sync_rev`, `receipts.client_uuid`, company-settings gate fields) and
  `20260924_025115_f4_security` (table `sync_receipts`, immutable `receipts.client_uuid`) — additive.

### Changed
- **Approval flow Direktur → Finance, PM monitors only** (Epic E1, ADR 0013 accepted, GATE 1 fase1-golive 2026-09-26;
  branch `feat/e1-approval-direktur-finance`): the role `pk-owner` is shown as **"Direktur"** (no new Keycloak role).
  "Diketahui" is now the Direktur's **approval** (inbox "Persetujuan Direktur (Diketahui)", button "Setujui"), followed
  by **Finance** approval, for every amount. Approval rules refuse PM/Staff/Admin deciders, the retired "PM project /
  penanggung jawab" acknowledger and an optional Direktur (400); PM/Staff/Admin acknowledge/approve/reject → 403 +
  `access_denied` audit; the PM keeps read access to team requests and no longer gets approval notifications or the
  "Persetujuan" link. G1-2: a position whose only holder is the requester/creator is skipped (audit
  `approval_skipped`, PDF "(tidak berlaku — pemohon)"); no independent decision → submit 409. Status label
  "Menunggu Diketahui (Direktur)"; notification "… menunggu persetujuan Anda sebagai Direktur". Requests submitted
  before the change finish on their old snapshot (PM "Diketahui", F2e delegation).
  - Migration `20260926_022918_e1_approval_direktur_finance` (additive): audit action `approval_skipped`, new
    `approval_rules` column defaults, the two seeded rules rewritten + renamed with audit rows. Seed and UAT seed
    (up to two Direktur and two Finance users) follow.
  - API (additive, for the APK): `GET /api/v1/me` → `capabilities.{approvalInbox,teamMonitor}`; request detail
    `approvalRule.{acknowledgeBy,acknowledgeRole,decisionRoles,skipped}`; `GET /api/v1/approvals/inbox` items
    `stepLabel`, `decisionFlow`.
- **Admin UI retheme to the web-starter design system** (branch `feat/cms-theme-web-starter`; visual only, no
  behaviour/data change): trust blue `#2563EB` primary, orange `#EA580C` CTA (SSO login button), slate surfaces with a
  designed dark palette, Space Grotesk headings / DM Sans body self-hosted via `next/font` (CSP `font-src 'self'`
  unchanged), radius 0.875rem, glass login card and header, card/table surfaces, visible 2px focus ring (also on
  Payload's nav group toggle), reduced-motion honoured. Mechanism (Payload 3.90.1): `(payload)/custom.scss` inside
  `@layer payload`, colour tokens on `<html>` via `RootLayout` `htmlProps`, `admin.components.graphics` Icon/Logo
  with the ProyekKas DRMS name. Tokens in `apps/web/src/theme/tokens.ts`, WCAG contrast checked by
  `tests/unit/theme.test.ts`; hard-coded status colours in the work views replaced by tokens (white on the old
  orange `#ef6c00` was 2.9:1).
- **Beranda redesigned as a data dashboard** (same branch; user feedback 2026-09-25 "terlalu text based"): per role
  a KPI stat-tile row (compact value + exact value, delta vs previous month, 12-point mini columns, meters), charts
  and card tables in a responsive 12-column bento grid (tablet 2 columns, phone 1). Owner: saldo kas, pengajuan
  menunggu (Diketahui/Approval split), pencairan bulan ini, realisasi vs anggaran; arus kas bulanan (masuk vs keluar
  columns, one axis), status pipeline, realisasi vs RAB per project (bullet rows), komposisi biaya per kategori
  (sorted bars, top 6 + "Lainnya", no donut), tren pengajuan, saldo per akun, menunggu tindakan saya, transaksi
  kas terbaru, project realisasi tertinggi. Finance: saldo, antrian transfer, menunggu verifikasi, kas
  masuk/keluar bulan ini, selisih LPJ; antrian transfer teratas, uang muka belum LPJ, pencairan per bulan. PM (team
  scope): menunggu Diketahui, pengajuan tim, LPJ tim, realisasi anggaran; bullets, pipeline, tren, komposisi.
  Staff: perlu tindakan, diproses, bulan ini, selesai; own pipeline and monthly value. **No chart library** (kept
  the existing server-rendered inline SVG approach; one ~70-line client component for hover/focus tooltips, text
  via React); every chart has a table view, focusable marks with accessible names, status always icon + label,
  skeleton via Suspense, one subtle enter animation off under `prefers-reduced-motion`. Chart colours are ramp
  steps of `theme/tokens.ts` validated per mode with the dataviz palette validator (dark mode uses blue-450: the
  dark primary blue-400 fails the chart lightness band). New read-only, scope-parameterised queries
  (`requestStatusCounts`, `requestTrendMonthly`, `disbursedMonthly`, `recentCashEntries`, `transferQueueTop`);
  the cash-ledger rows are office-scope only. `GET /api/v1/dashboard/*` responses gain an additive `viz` object
  (owner `approvals.pendingAck/pendingApproval`, staff `month`); OpenAPI regenerated. No schema change/migration.
  `data-pk-*` UAT selectors kept (the KPI list items of Owner/Finance/PM now sit in tiles/cards, tables in
  "Tabel angka").
- The F2 PDF semaphore moved to `lib/heavy-gate.ts` (shared with the F3 exports); behaviour unchanged.

### Fixed
- Reimburse receipt revision with a changed grand total now goes back to "Menunggu Diketahui (Direktur)" (new cycle)
  instead of straight to "Menunggu Approval" (ADR 0013 §6); a role-based "Diketahui" without any active holder is
  refused at submit (409) instead of leaving the request stuck in "Menunggu Diketahui".
- Manual cash entry with a proof (`proofId`) always failed with 400 "Alasan wajib diisi saat mengedit transaksi kas."
  (the proof was attached by a follow-up update that hit the edit-reason rule); the proof is now set on insert (E2).
- APK (staging phone test, ADR 0010 "Phone test fixes"): "Offline" shown on working mobile data — a successful API
  answer now always means online and a `GET /api/v1/health` probe recovers from failures and wrong `none` reports;
  logout that never finished — now always returns to the login screen (network part ≤ 5 s, local clean-up always,
  unsent data kept with a warning); slow first load — home from the cached profile at once, device registration,
  `/me` and `/app/config` in the background, integrity checks off the Android main thread.
- `media-selfies` stored WebP while accepting only `image/jpeg`, so every selfie upload failed with "Invalid file type";
  selfies are now stored as JPEG q75 (F4b).
- APK: a failed masters refresh at login (e.g. 401/5xx) no longer surfaces as an unhandled async error (F4b).
- **Report "Anggaran Project" with a project filter** (F3 UAT): the per-category table used
  `FULL JOIN … ON category_id IS NOT DISTINCT FROM …`, which PostgreSQL 16 rejects ("FULL JOIN is only supported with
  merge-joinable or hash-joinable join conditions"), so the page ("Data tidak dapat dimuat…"), JSON and CSV/XLSX/PDF
  exports failed. RAB and Komitmen per category are now merged with `UNION ALL` + `GROUP BY` (same K-07 result,
  uncategorised lines in one "Tanpa kategori" bucket). New `tests/integration/f3-report-filters.int.test.ts`: the
  per-category detail in all formats against the K-07 SQL rule, plus a smoke matrix of every report × every filter.

## [0.2.1] - 2026-09-24

### Fixed
- OpenAPI documents regenerated for the release version (the 0.2.0 bump missed `gen:openapi`, which failed the
  CI drift check). No code change.

## [0.2.0] - 2026-09-24

F2 expense-request flow (F2a–F2e) — GATE F2 approved by the user 2026-09-24 after browser UAT on staging (run 4: 56 PASS, 2 FAIL non-blocking, 1 not testable; `docs/proyekkas/uat/f2-uat-report.md`).

F2a (expense request core, `c8c1af6`), F2b (LPJ/settlement, PDF, admin views, notifications, file endpoint,
`4d952ba`), F2c (requester actions in the web panel, `59ba0a4`), F2d (`c11907a`) and F2e (`e9c07ab`) UAT fixes
merged to `develop`; staging runs `0.1.0-stg-e9c07ab`. UAT E2E run 4 on staging: 56 PASS, 2 FAIL (1 by design,
1 wording), 1 not testable (`docs/proyekkas/uat/f2-uat-report.md`); **F2 ready for gate**.

### Added
- **F2e acknowledge delegation** (user decision 2026-09-24, option a; Q-07/Q-08 edge case): when the project PM /
  cost-center manager is a requester or the creator, or is missing, "Diketahui" is delegated at submit to an
  eligible active Owner, else Admin (not a requester/creator; distinct-person matching so the acknowledger is
  never also needed as approver). Delegates fixed in the approval snapshot (`acknowledgeDelegatedTo`,
  `acknowledgeDelegateUserIds`, `acknowledgeDelegationReason`, `acknowledgeOriginalUserId`); audit action
  `acknowledge_delegated`; PDF prints "(dilimpahkan)". Submit still returns 409 when nobody qualifies.
- **F2e Finance self-involvement guard**: Finance cannot verify/reject receipts, review flags, verify all
  receipts, request LPJ revision, verify the LPJ or settle on a request it requested or created → 403; DB
  triggers `receipts_self_verify_guard` / `receipt_flags_self_review_guard` (function `pk_request_involves`).
- **F2e audit action `access_denied`**: refused self-involvement attempts (G1 acknowledge/approve/reject and the
  Finance guard) are recorded in their own transaction (`writeAuditDetached`, also used for `delete_attempt`).
- **F2d Finance Reimburse receipt verification UI** in Antrian Transfer (per receipt Valid/Tolak, flags reviewed,
  "Verifikasi semua nota"); nav badge counts Reimburse requests awaiting verification.
- **F2 UAT report** `docs/proyekkas/uat/f2-uat-report.md` (Playwright E2E runs 1–4 on staging).
- **F2c requester web panel** (`apps/web`): `pk-staff` may use the admin panel with a restricted nav (own
  requests, receipts, notifications, own profile); self-service profile signature; workflow panel with status
  timeline + next actor and the requester actions (Kirim pengajuan, Tarik kembali/Batalkan, Ajukan ulang, upload
  nota per baris, Tandai nota lengkap, Kirim/Kirim ulang LPJ, Konfirmasi selesai) via `/api/v1` with
  `Idempotency-Key`.
- **F2b LPJ & settlement** (T5): `settlements` collection; receipts-complete, LPJ submit/revision/verify, settle —
  exact amount settles at verification, surplus → KM "Pengembalian LPJ" (`settlement_refund`), shortfall →
  `lpj_shortfall` transfer + KK.
- **F2b PDF "Pengajuan Biaya"**: `GET /api/v1/expense-requests/{id}/pdf[?variant=internal]`, `@react-pdf/renderer`
  4.9.0 (MIT), built-in Helvetica, receipts on separate pages (2 per page), semaphore 2 / 10 s → 503; layout
  approved by the user 2026-09-24 (logo pending, Q-32). Measured peak RSS ≈ 138 MiB isolated, 149 MiB web cgroup
  after 3 renders.
- **F2b admin views**: approval inbox (`/admin/persetujuan`, budget impact), transfer queue
  (`/admin/antrian-transfer`), LPJ verification (`/admin/verifikasi-lpj`), "Riwayat" tab; `GET /api/v1/approvals/inbox`.
- **F2b notifications** (in-app): `notifications` collection, `GET /api/v1/notifications[/{id|uuid}]`,
  `POST …/{id}/read`, `POST …/read-all`; column `pushStatus` (`skipped` unless `PUSH_FCM_ENABLED=true`; no FCM
  dispatcher yet — F4).
- **F2b file endpoint** `GET /api/v1/media/{collection}/{id}/file[?variant=thumb]` (scoped; other users' files → 404).
- **F2b Reimburse auto-close** worker job `reimburseAutoClose`, daily 01:15 WITA (`reimburseAutoCloseDays`, default 30).
- **UAT seed** (`apps/web/src/seed/uat.ts`, staging only): idempotent one-off that links app users to
  EXISTING Keycloak users from `UAT_USERS` (no Keycloak call), creates employees `UJI-*`, sets the OPS-PB
  manager to the PM only when empty, a fictional bank account, project `UJI-PRJ` + team assignments;
  run command in `deploy/staging/.env.example`.
- **F2a expense request flow** (`apps/web`): collections `expense-requests` (+ lines), `approval-rules`,
  `approvals`, `expense-line-snapshots`, `receipts`, `receipt-flags`, `transfers`, `cash-entries`,
  `period-closings`; T1 state machines (advance, reimburse incl. "Nota Terverifikasi (Antri Transfer)",
  "Menunggu Diketahui", withdraw); approval rules (default Owner-only; "Diketahui" required, Q-07);
  receipts with validation flags; transfers posting exactly one KK; manual cash in/out; void/reversal
  numbered in the KM/KK series; monthly closing and Owner-only re-open of the latest closed period;
  `/api/v1` expense-request, cash and media endpoints + OpenAPI; `Idempotency-Key` (table `idempotency_keys`,
  72 h; required for the APK); historical number registration for the form-228 fixture without touching the
  live counter; audit actions `approve`, `reject`, `verify`.

### Changed
- **F2e:** "Pengajuan ulang dari" shows the previous request's number and title (read-only link); office-only
  fields hidden in the panel (`approvalRule`/`approvalSnapshot` for Staff/PM, `receipts.vendor` for Staff) —
  removes the 403 noise on `POST /api/approval-rules`; operational 4xx (403/404/409) are logged at `warn`,
  5xx stay `error`.
- **F2d:** "Profil & tanda tangan" linked for every panel role incl. Owner; hint above "Baris item" for the
  Payload 3.90.1 row race.
- Docs: `architecture.md` §5.2/§5.5 (delegation, G1 extended, new G17, guard order, logging), ADR 0006 (F2e
  triggers and audit actions), `open-questions-client.md` (Q-07/Q-08 edge case answered; main question open),
  `phase-plan.md` (F2 ready for gate, gate evidence, carried-over items).
- **Onboarding/staging:** the "submit 409 until PM / cost-center manager is set" prerequisite now applies only
  when no Owner/Admin qualifies for the delegated "Diketahui".
- ADR 0003, 0004, 0005, 0006, 0008, 0011, `architecture.md` (§5.1, §5.2, §6.3, §7.2, §9.2, §9.3, §11), `phase-plan.md`
  and `traceability-matrix.md` (F2 implementation status) updated with the F2b/F2c outcomes (Revision history in
  each; statuses stay accepted).
- Build: `outputFileTracingIncludes` traces the pdfkit standard fonts into the standalone output (first render in
  the image failed with `Cannot find module …/Helvetica.cjs`); the worker bundle replaces the PDF renderer with an
  esbuild stub (the worker never renders PDFs).
- ADR 0001, 0002, 0005, 0006, 0007, `architecture.md` (§5.2, G6, §9.1) and `phase-plan.md` updated with the
  F2a outcomes (Revision history in each; statuses stay accepted). Business dates stored as text `YYYY-MM-DD`.
- Build: `next build` skips its own type check (`typescript.ignoreBuildErrors`) because it OOMs at the 2 GiB
  build cap; `npm run typecheck` remains a required CI gate before the image build.
- **Onboarding/staging prerequisite:** set the PM on every project and the manager on every cost center —
  with the default approval rule, submit returns 409 until the "Diketahui Oleh" party can be resolved.

### Fixed
- The F2b down migration is runnable (it dropped an FK already removed by `DROP TABLE … CASCADE` and re-cast the
  job enums).
- Image uploads to `media-transfer-proofs`, `media-attachments` and `media-progress-photos` always failed:
  the WebP thumbnail was rejected by the collections' `mimeTypes`; these now use a JPEG thumbnail.

### Security
- **Admin form validation:** creating/editing an expense request through the admin panel (generic REST) now runs the
  same `validateContent` as `/api/v1` (Q-09 on-behalf only Admin/Finance, G9 bank account of a requester, G10 scope,
  project XOR cost center); before F2c this path skipped these rules.
- Self-service profile updates are limited to the caller's own row and the `signature` field (403 otherwise; the
  signature must be uploaded by the caller).
- F2b DB guards: `settlements` and `notifications` are Class B (settlement status graph, settled rows frozen,
  refund/shortfall amounts cross-checked; notifications identity immutable, no DELETE); `lpj_shortfall` transfers and
  `settlement_refund` cash entries constrained. Void of a refund KM / shortfall transfer → 409 (settlement reversal
  not implemented, F6 backlog).
- PDF downloads audited `export`; transfer-proof file reads audited `view_sensitive`. Signed media URLs still open (F6).
- DB guards (F2a security migration): request content frozen outside Draft/Revisi Nota via `content_hash` +
  DEFERRED constraint triggers (child tables `expense_requests_lines/_rels` keep DELETE only for Payload's
  rewrite); `approvals` and `expense_line_snapshots` append-only (Class A, G1 in the DB); Class B guards on
  receipts, transfers (amount = approved amount), cash entries and period closings; period lock trigger.
- Payload 3.90.1 swallows COMMIT errors (`@payloadcms/drizzle` `commitTransaction`) → deferred checks are
  forced inside every app-owned transaction so a violation fails the request instead of silently rolling back.

## [0.1.0] - 2026-09-23

F0 design + F1 foundation (GATE F1 approved by the user 2026-09-23). Staging runs image `0.1.0-stg-f8529e6`
at `https://drms-kas.staging.bimacreative.tech`; first admin login (password + TOTP) and real SMTP delivery verified.

### Added
- **F0 discovery & design** (GATE F0 approved by user 2026-09-23): requirements v1.1, open client questions,
  traceability matrix, `docs/proyekkas/architecture.md`, ADR 0001–0011 (accepted), phase plan F0–F7
  (`docs/proyekkas/`). Recorded user decisions: build outside Odoo on Payload CMS 3; DB names
  `pk_drms`/`pk_drms_stg`; hostnames `drms-kas.bimacreative.tech` / `drms-kas.staging.bimacreative.tech`;
  expense-request numbering never resets (start 229); receipt originals discarded after resize; 14-day
  offline session idle.
- **F1 spike week** (`apps/web`, report `docs/proyekkas/spikes/f1-spike-report.md`): Payload 3.90.1 +
  Next 16.3.6 scaffold (npm workspaces), OIDC-only admin login (`oidcSession`), `mobileBearer` on
  `/api/v1/me`, append-only `audit_logs` migrations, in-transaction numbering, jobs worker bundled outside
  Next (`dist/worker.mjs`), nonce CSP proxy, receipt resize (≤ 2000 px JPEG q82, `sha256Original`),
  production Dockerfile (webpack build). Spike-only code (`apps/web/spike/**`, `spike-*` collections/tasks)
  is to be removed in F1.
- **F1 foundation** (`develop` `e2bf46b`): masters, users/role sync via the Keycloak Admin API, devices,
  web-sessions, append-only audit + `pk_protect_columns` migrations, numbering with `number_issued` audit,
  media collections, `/api/v1` skeleton + `packages/api-contract/openapi.json`, idempotent seed (fictional
  default data; real data only via `SEED_DATA_FILE` at deploy time, existing rows never overwritten),
  `deploy/staging/` compose, CI workflow. Spike-only code removed.
- **Staging deployed** at `https://drms-kas.staging.bimacreative.tech` (infra Lead,
  `/opt/infra/staging/drms-proyekkas/`): separate web (640m) + worker (320m) + one-shot migrate; images built
  locally on the VPS until GHCR (temporary). Measured idle RAM web 82 MiB, worker 47 MiB.
- **Outbound email (SMTP)**: `@payloadcms/email-nodemailer` 3.90.1 (MIT; nodemailer 9.1.1 MIT-0) configured
  from `SMTP_HOST/PORT/USER/FROM_ADDRESS/FROM_NAME` + `SMTP_PASSWORD_FILE` (all-or-nothing, From must equal
  `SMTP_USER`; STARTTLS required on 587, certificate verification on). From is forced by the adapter. Mailbox
  limit 30/h (burst 10) → DB-backed token bucket `mail_rate_buckets` shared by web + worker (burst 5, 24/h,
  ≤ 29 in any hour). Mails go through the Jobs queue (`sendEmail`, worker, retried with backoff; input holds
  the user id, not the address). `POST /api/v1/admin/test-email` (Admin, own address, audited `email_test`,
  3/h). REST `/api/payload-jobs/*` closed (worker uses the Local API). Without SMTP_* → console adapter.
- Public GitHub repository `bctech-adm/drms`; CI green on the first run (run 35857158248, commit `e2bf46b`).

### Changed
- ADR 0001, 0002, 0003, 0006, 0007 and `architecture.md` revised with the F1 spike results and the user
  decisions of 2026-09-23 (see each document's Revision history): Payload 3.90.1 = GO; admin CSP
  `style-src 'self' 'unsafe-inline'`, scripts nonce-strict without `'strict-dynamic'`, `form-action 'self'
  https://auth.bimacreative.tech`; no `json`/`code` field editors in the admin; Keycloak offline session max
  lifespan 30 days (+ 14-day idle); app reaches Keycloak via the public issuer (hairpin) on network
  `drms-kas-edge`; back-channel logout disabled; cron evaluated in process `TZ=Asia/Makassar`; measured
  RAM (web idle 108 / peak 205 MiB, worker idle 47 / peak 51 MiB), limits kept until F6.
- `phase-plan.md`: F1 spike gate passed; F1 item 7 (infra) done — infra `main` commit `c557c28`.
- ADR 0002, 0003, 0004, 0006, 0007, `architecture.md` and `phase-plan.md` updated with the F1 foundation
  outcomes (Revision history in each): staging topology as deployed (ADR 0002 §7; pools 5 + 3 + 2 ≤
  CONNECTION LIMIT 10); Keycloak role lookup via `role-mappings/realm/available`, service account
  `manage-users` + `view-users` only, Admin API via internal networks `drms-kc-admin[-stg]`, first staging
  admin bootstrap; `action` enum + `user_roles` text; role names derived from `current_user`; counter
  monotonic trigger. Remaining F1: `HEAD` health (in progress), SMTP adapter (pending infra), F1 gate review.

### Fixed
- Docs: company-logo media slug is `media-company` (was `media-company-logo` in `requirements-v1.1.md` and
  `traceability-matrix.md`).

### Security
- **Public-repo sanitization**: client reference inputs (form image, requirements v1.0, lead prompt) removed
  from the tree (held by the project Lead, `docs/proyekkas/reference/README.md`); person names, bank account,
  receipt/transaction numbers, vehicle plate and vendor name in docs/seed/tests replaced by fictional
  pseudonyms (amounts, dates and analyses unchanged). Seed accepts the real master data from an untracked
  JSON file via `SEED_DATA_FILE` (zod-validated, same shape as the default data).
- Every upload collection must carry the remote-URL guard hook: `pasteURL: false` alone does not stop
  Payload 3.90.1 from fetching a remote `{filename,url}` on REST create (SSRF; spike §h).
- `admin.avatar: 'default'` (no gravatar request leaking `md5(email)`).
- APK bearer tokens are never authenticated on Payload generic REST (`/api/<slug>` → 403 or `{user:null}`);
  Traefik strips `Authorization` outside `/api/v1` (staging routers live).
