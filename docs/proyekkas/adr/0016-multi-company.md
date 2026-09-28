# ADR 0016 — Multi-company: several PTs in one ProyekKas deployment, per-PT roles, full consolidation

- **Status:** proposed — design approved by the user 2026-09-27; final acceptance at the **MC0 gate** (client answers
  Q-51…Q-61, `../open-questions-client.md` §L). **MC1 implemented** on branch `feat/mc1-foundation` (2026-09-28) with
  the deviations listed in "Implementation notes (MC1)" below.
- **Date:** 2026-09-27
- **Author:** Analyst (phase MC0, branch `docs/mc0-multi-company`, based on `develop` `74cf7f2`)
- **Related:** ADR 0003 (auth, roles), 0005 (cash ledger, period closing), 0006 (audit, DB roles), 0007 (numbering),
  0009 (Odoo mirror), 0010 (APK offline sync), 0013 (approval flow); `../requirements-v1.2.md` (US-MC-01…19);
  `../mc/impact-inventory.md` (code change list MC1–MC3); `../mc/wireframes.md`; `../phase-plan.md` phase MC.
- **Revises (paper, dated sections "Revisi 2026-09-27 (ADR 0016)"):** ADR 0003, 0005, 0007, 0009, 0010, 0013.

## Context

### User requirement and decisions (2026-09-27, binding)

> The client has several companies (PT) that must be managed in **one** ProyekKas application. One user can manage
> more than one company with a **different role in each company** (role matrix per user per company). Users are
> mapped to companies and to their employees.

| # | Decision |
|---|---|
| D1 | 1 employee record = 1 company. A person working in 2 PTs has **2 employee records but 1 login account**. |
| D2 | **Shared across PTs:** banks, UoM, national holidays. **Everything else is per PT** (expense categories/COA, vendors, clients, cash accounts, vehicles, projects, cost centers, work schedules, approval rules, numbering, period closing, company identity/letterhead/logo/TZ/operational flags). |
| D3 | **Full consolidation:** lists, approval inbox, dashboards and reports may show several PTs at once (per-PT breakdown + combined total, single currency IDR). **Mutations** (create, approve, transfer, period close) are always **within one PT** and checked against the user's role **in that document's PT**. |
| D4 | Done **before go-live** (no production data yet). |

### Current implementation (read on `develop` @ `74cf7f2`)

| Area | Fact | Evidence |
|---|---|---|
| Company identity | One global `company-settings` holds identity (name, `shortCode`, logo, letterhead, address, phone, TZ) **and** operational flags **and** app-wide settings (APK versions, image targets). Read by 16 `findGlobal` call sites + `settings(req)` helper. | `apps/web/src/globals/CompanySettings.ts:25-251`; `domain/expense/common.ts:99-101`; `grep -rn findGlobal apps/web/src` |
| Roles | 5 Keycloak realm roles, **one set per user** (`users.roles`, hasMany select), mirrored from the token at web login (`role_sync`) and pushed to Keycloak by the Admin (`users-sync`). | `access/roles.ts:4`; `collections/Users.ts:114-122`; `app/(auth)/auth/callback/route.ts:52-61`; `domain/users-sync.ts:50-56` |
| Effective roles (APK) | token realm roles ∩ `users.roles` | `auth/strategies.ts:139-142` |
| Access helpers | `hasRole(req, ...roles)` (60 calls / 33 files), `byRole` (54 calls / 35 files; `true` = "see all"), `rolesAllowed`/`fieldRoles` (37 / 27). "See all" rules of office roles have no company dimension. | `access/roles.ts:46-48`; `access/policies.ts:13-40`; e.g. `domain/expense/access.ts:33-39` |
| Scope | `resolveScope` = PM/team/assigned projects & cost centers of `req.user.employee`, cached per user in `req.context.pkScope`. | `access/scope.ts:33-108` |
| Employee link | `users.employee` **unique** 1:1; used by scope, requester checks, attendance, and by DB guards joining `users.employee_id`. | `collections/Users.ts:123`; `migrations/20260923_103218_initial.ts:761`; `migrations/20260923_133050_f2a_security.ts:158`; `migrations/20260924_020344_f2e_security.ts:28`; `migrations/20260926_114555_e5_budget_addenda.ts:103` |
| Approver pools | active users holding a role, **company-blind**: `activeUsersWithRole` (snapshot), `usersWithRole` (notifications, addendum), `roleHolders` (reminders, raw SQL on `users_roles`). | `domain/expense/snapshot.ts:116-128`; `domain/notifications.ts:82-93`; `domain/addendum/service.ts:232-243`; `domain/reminders/service.ts:60-63` |
| Decision guard | `matchesStep` / `matchesAcknowledger` compare the snapshot role with `caller.roles` = all roles of the user. | `domain/expense/rules.ts:220-236`; `domain/expense/common.ts:146-160` |
| Numbering | `{COMPANY}` = global `shortCode`; counters keyed `(doc_type, period_key)`; `document-sequences.docType` unique. | `domain/numbering-db.ts:36-44,63-70`; `migrations/20260923_103219_security.ts:100-105`; `collections/DocumentSequences.ts:28-36` |
| Period lock | `pk_cash_lock_date()` = end of the latest closed period, company-wide; used by the `transfers` and `cash_entries` guards; one closed row per `period`. | `migrations/20260923_133050_f2a_security.ts:61-64,227,265,332`; `migrations/20260923_161854_f2b_security.ts:165` |
| Reports | `ReportScope` = `all` (Finance/Owner → SQL `TRUE`) / `team` / `own`; 233 `sql` template fragments in 32 non-migration files (223 in 26 business files); several KPI functions take no scope at all. | `domain/reports/scope.ts:19-33,69-72`; `domain/reports/kpi.ts:94,129,166,180,200,377,736,757` |
| Jobs | 5 tasks, one pass each, reading the global settings; `reminder_runs` keyed by `run_date` only. | `jobs/tasks.ts:20,58,92,113,138`; `migrations/20260926_104606_s2b_attendance_reminders.ts:60-64` |
| Timezone | 14 places use the **process** TZ (`process.env.TZ`), not the settings value. | `grep -rn "process.env.TZ" apps/web/src` (14 hits in 14 files) |
| APK | drift schema v2, drafts/outbox/progress keyed by `userSub` only; masters cached per `sub`; `/me` returns one role set, one `settings` object. | `apps/mobile/lib/core/db/app_database.dart:14-177`; `features/masters/data/masters_repository.dart:23,31`; `apps/web/src/api/v1/endpoints/me.ts:33-68` |
| Production | Prod DB `pk_drms` has no business data yet; staging has UAT data of one company (DRMS). | ADR 0013 "Production data"; user decision D4 |
| Deployment pattern | Platform = one realm + one DB + one compose **per client** (`drms`, `pk_drms`). | ADR 0003 §1, ADR 0002; `../phase-plan.md` F1 item 7 |

Conclusion: the code has **no company dimension anywhere**; the change is cross-cutting (data model, access layer,
raw SQL, DB triggers, jobs, APK) but mechanical once a single access context exists. Doing it before go-live avoids a
production data migration.

## Decision

### 1. Company master `companies`; the global shrinks to app-wide settings

- New collection **`companies`** (table `companies`): identity + operational fields moved from `company-settings`.
  `shortCode` unique (token `{COMPANY}`), `legalName`, `active`. Company **#1 = DRMS** (created by the migration from
  the current global values).
- `company-settings` stays as a global for **app-wide** values only (APK gate, device image targets, group
  letterhead for consolidated reports). Field classification:

| Field (`CompanySettings.ts` line) | Target | Why |
|---|---|---|
| `name` (32), `shortCode` (33-41), `logo` (42), `pdfHeader` (43), `address` (44), `phone` (45) | **per PT** (`companies`) | identity / letterhead (D2) |
| `timezone` (46-54) | **per PT** — but MC1 enforces *= process TZ* (see §9) | D2; code uses process TZ in 14 places |
| `defaultGeofenceRadiusM` (55-59), `lateReportDays` (60), `budgetWarnPct`/`budgetOverPct` (61-67), `progressWarnGapPct`/`progressBadGapPct` (68-74), `receiptRoundingTolerance` (75), `receiptMaxAgeDays` (76), `reimburseAutoCloseDays` (77), `lpjDueDays` (80-83) | **per PT** | operational policy of the company |
| `syncExpenseDraftsEnabled` (108-114), `syncAttendanceEnabled` (115-124), `syncProgressReportsEnabled` (153-159) | **per PT** | operational flags (a PT may start attendance later) |
| `defaultWorkSchedule` (126-132) | **per PT** | relation to a per-PT `work-schedules` row |
| `selfieRetentionMonths`, `selfieRetentionDeleteEnabled`, `selfieRetentionBatch` (136-152) | **per PT** (months, enabled); batch = **app-wide** | retention is a company (UU PDP controller) decision; batch size protects the server |
| reminders collapsible (164-205: `remindersEnabled`, `reminderHour`, `reminderEmailEnabled`, 5 rule toggles, `reminderRevisionDays`) | **per PT** | operational |
| `notifyRequesterStatusEnabled`, `approvalEmailEnabled` (209-234) | **per PT** | operational |
| `minAppVersion` (84-90), `latestAppVersion` (93-99), `appDownloadUrl` (100-107) | **app-wide** | one APK for all PTs (Q-58); `http.ts:58-62` enforces it before any company is known |
| `offlineMaxAgeDays` (235) | **app-wide** | device/session property, not company |
| `imageTargets.*` (236-247) | **app-wide** | device-side resize targets |
| *new* `groupName`, `groupLogo`, `groupPdfHeader` | **app-wide** | letterhead of consolidated (multi-PT) reports (Q-56) |

### 2. `company_memberships` is the source of per-PT roles; Keycloak keeps identity + `pk-user`

- New collection **`company-memberships`** (table `company_memberships`): `user` (required), `company` (required),
  `employee` (optional, **must belong to the same company**), `roles[]` (subset of the 5 existing roles), `active`,
  audit fields. Unique `(user_id, company_id)`; unique `(company_id, employee_id) WHERE employee_id IS NOT NULL`.
- **Keycloak** keeps identity, credentials, sessions and **one coarse realm role `pk-user`** (= allowed to log in to
  ProyekKas). Per-PT roles are **not** synced to Keycloak any more: `users-sync` stops `applyRoles`
  (`domain/users-sync.ts:50-56,86,113`), the web callback stops the `role_sync` write
  (`app/(auth)/auth/callback/route.ts:52-61`) and instead requires `pk-user` in the token.
- The **token ∩ DB** rule (`auth/strategies.ts:139-142`) is replaced by: token must carry `pk-user`; effective roles =
  **active memberships of the active user** (DB only). A role removed in the matrix stops working on the next
  request (stronger than today's ≤ 300 s window).
- `users.roles` and the unique `users.employee` (`collections/Users.ts:114-123`, index `users_employee_idx`) are
  **removed** after the backfill; the employee of a user *in a PT* is `membership.employee`.
- New DB-only flag **`users.groupAdmin`** (not a Keycloak role): may create/deactivate companies and edit the
  app-wide global. *Addition to the approved design:* the design names no owner for cross-PT administration.
  Shared masters (banks, UoM, holidays) keep today's role rules, evaluated as "holds the role in **any** PT".

### 3. `employees.company` required

`employees.company` NOT NULL; employee codes unique per company. A person in two PTs = two employee rows, each with
its own bank accounts, attendance, work schedule and team assignments; both rows can be linked to the same user via
two memberships.

### 4. `company_id NOT NULL` on every per-PT table, composite uniques, per-PT numbering and closing, cross-PT triggers

**Collection classification** (all 46 collections: 39 files in `apps/web/src/collections` + 7 upload collections in `media/index.ts`):

| Class | Collections | Company column |
|---|---|---|
| **Per PT — master** | `projects`, `project-stages`, `stage-templates`, `budget-lines`, `cost-centers`, `clients`, `vendors`, `expense-categories`, `cash-in-sources`, `cash-accounts`, `vehicles`, `work-schedules`, `approval-rules`, `document-sequences`, `employees`, `employee-bank-accounts`, `team-assignments`, `period-closings` (18) | `company_id NOT NULL` |
| **Per PT — transaction** | `expense-requests`, `expense-line-snapshots`, `approvals`, `receipts`, `receipt-flags`, `transfers`, `cash-entries`, `settlements`, `budget-addenda`, `progress-reports`, `attendances`, `attendance-corrections` (12) | `company_id NOT NULL`, copied from the parent on insert (never user input), immutable (`pk_protect_columns`) |
| **Shared (group)** | `banks`, `uoms`, `holidays` | none |
| **App-wide / system** | `notification-templates`, `company-settings` (global), `payload-*` | none |
| **Per user** | `users`, `devices`, `web-sessions`, `company-memberships` (per user × PT), `media-signatures` | none (memberships carry `company_id`) |
| **Per user, tagged with PT** | `notifications`, `audit-logs` | `company_id` **nullable** (set when the event concerns a per-PT document; used for filtering and the PT label) |
| **Media owned by a document** | `media-receipts`, `media-transfer-proofs`, `media-selfies`, `media-progress-photos`, `media-attachments` | none — access follows the owning document (ADR 0004 §4a); `media-company` holds PT logos, readable by members of that PT |

Non-collection tables: `document_sequence_counters` (PK → `(company_id, doc_type, period_key)`), `reminder_runs`
(PK `run_date` → `(company_id, run_date)`), `reminder_deliveries` (unchanged: subject keys embed globally unique
ids), `idempotency_keys` / `sync_receipts` (per user, unchanged).

**Global unique indexes → composite** (from `grep -oh "CREATE UNIQUE INDEX…" apps/web/src/migrations`):

| Index today | Becomes |
|---|---|
| `projects_code_idx (code)` | `(company_id, code)` |
| `cost_centers_code_idx (code)` | `(company_id, code)` |
| `employees_code_idx (code)` | `(company_id, code)` |
| `expense_categories_code_idx (code)` | `(company_id, code)` |
| `cash_in_sources_code_idx (code)` | `(company_id, code)` |
| `cash_accounts_name_idx (name)` | `(company_id, name)` |
| `stage_templates_name_idx (name)` | `(company_id, name)` |
| `work_schedules_name_idx (name)` | `(company_id, name)` |
| `document_sequences_doc_type_idx (doc_type)` | `(company_id, doc_type)` |
| `document_sequence_counters` PK `(doc_type, period_key)` | `(company_id, doc_type, period_key)` |
| `period_closings_one_closed (period) WHERE status='closed'` | `(company_id, period) WHERE status='closed'` |
| `expense_requests_doc_no_idx`, `transfers_doc_no_idx`, `settlements_doc_no_idx`, `progress_reports_doc_no_idx`, `budget_addenda_doc_no_idx` (`doc_no`), `cash_entries_entry_no_idx` (`entry_no`) | `(company_id, doc_no)` / `(company_id, entry_no)` — `TRF/2609/0001` has no `{COMPANY}` token and repeats across PTs |
| `reminder_runs` PK `(run_date)` | `(company_id, run_date)` |
| `users_employee_idx (employee_id)` | **dropped** (replaced by the membership uniques of §2) |

Kept global on purpose: `banks_code`, `uoms_code`, `holidays_date` (shared), `notification_templates_event`
(app-wide), `users_email`, `users_keycloak_sub`, `devices_device_id`, `web_sessions_id_hash`, all `uuid` /
`client_uuid` / media `filename` indexes (globally unique by construction), `vehicles_plate_no` (a plate identifies
one physical vehicle that belongs to one PT; moving it = changing its company — *deviation from "all composite",
confirm with Q-61*), and the per-document indexes that are already company-disjoint through their parent
(`approvals_*`, `attendances_one_per_day*`, `cash_entries_one_reversal`, `settlements_request_idx`,
`project_category_idx`).

**Numbering (ADR 0007):** `document-sequences` per company (seeded per new PT from the DRMS defaults of
`domain/numbering.ts:97-105`, own `startAt`), counters `(company_id, doc_type, period_key)`, `{COMPANY}` = the
document's PT `shortCode`. `allocateDocNo(req, docType, { companyId })` — the company is mandatory.
Example: `229/PB-DRMS/27/IX/2026` and `1/PB-CS1/27/IX/2026` on the same day (Q-54 for start values).

**Period closing (ADR 0005 §6):** `period_closings.company_id`; `pk_cash_lock_date(company_id int)`; the
`pk_transfers_guard`, `pk_cash_entries_guard`, `pk_cash_entries_opening_guard`/`pk_cash_accounts_opening_lock`
(S3b) and settlement checks pass the row's company. Closing PT A never locks PT B.

**Cross-PT reference triggers (new):** one generic function `pk_same_company(child, parent_table, parent_id)` used by
`BEFORE INSERT OR UPDATE` triggers that reject (SQLSTATE `23514`, message `cross-company reference`) any row whose
per-PT references point to another company: e.g. `expense_requests` → project, cost center, employee bank account,
approval rule, requesters (`_rels`), line category/vehicle; `cash_entries` → cash account, category, cash-in source,
project, cost center, vehicle, request, transfer; `transfers` → cash account, request; `team_assignments` → employee,
project, cost center; `company_memberships.employee` → employee of the same company; `projects.pm` /
`cost_centers.manager` / rule named users → user with an active membership in that company. The full pair list is in
`../mc/impact-inventory.md` §MC1-4. Shared masters (bank, UoM) are always allowed.

### 5. Access context = the set of selected PTs, always intersected with memberships

- **Resolution (once per request, `req.context.pkCompanies`):** active memberships of the user →
  `Map<companyId, { roles, employeeId }>`. The **selection** comes from the web cookie `__Host-pk-companies`
  (set by the PT switcher through an endpoint, `HttpOnly`, `SameSite=Lax`) or the API/APK header
  **`X-Company-Ids: 1,3`**. No selection = all memberships. The effective set = selection ∩ memberships; a header that
  names a company without an active membership → **403** `COMPANY_NOT_ALLOWED` (fail closed, audited
  `access_denied`); a stale cookie is reset to "all".
- **Helpers:** `rolesIn(req, companyId)`, `hasRole(req, role, companyId)` (company argument **required**),
  `companiesWithRole(req, ...roles)` (within the selection). `byRole` evaluates each role **per company**: a `true`
  rule becomes `{ company: { in: companiesWithRole(role) } }`, a scope rule becomes
  `{ and: [{ company: { equals: c } }, rule] }`; results are OR-ed. "See all" therefore means **"all rows of the PTs
  where I hold that role"**. `resolveScope` becomes per company (employee of that membership).
- **Mutations:** the company is taken from the **document** (existing rows) or from the create body (`company`,
  required when more than one PT is selected); the caller must hold the required role **in that company**
  (`hasRole(req, role, doc.company)`), independent of the read selection. Create access receives `data`, and a
  `beforeChange` hook repeats the check (defence in depth).
- **Approver pools and recipients** are resolved in the document's PT: `activeUsersWithRole(req, role, companyId)`
  (`snapshot.ts`), `usersWithRole` (`notifications.ts`, `addendum/service.ts`), `roleHolders`
  (`reminders/service.ts`) join `company_memberships` instead of `users.roles`. `actorContext`
  (`domain/expense/common.ts:146-160`) uses `rolesIn(req, doc.company)` and the membership employee of that PT for
  `isRequester`. The ADR 0013 skip rule (`planPositions`) counts holders **of that PT** only. Q-07/Q-08 delegation
  (F2e, Owner else Admin) exists only in pre-E1 snapshots (`snapshot.ts:68` never passes a delegation); its check
  `caller.roles.includes(...)` (`rules.ts:232`) is evaluated with the document PT's roles.
- **Queues** (`domain/expense/queues.ts:72-123`): read with the caller's access, i.e. automatically limited to the
  selected PTs where the caller has the role; each item carries `company { id, shortCode }`.

### 6. Reports and exports

`ReportScope` (`domain/reports/scope.ts`) becomes a **list of per-company scopes**
`{ companies: Array<{ id, kind: 'all'|'team'|'own', projects, costCenters, employeeId }> }` built from the effective
selection; every SQL filter becomes `OR` over companies of `(x.company_id = $c AND <kind predicate>)`; an empty list
= `FALSE`. The KPI functions that take no scope today (`kpi.ts:94,129,166,180,200,377,736,757`) get one. Results carry
`company_id`; consolidated views show a per-PT breakdown and a combined total (IDR only). Exports/PDF: one PT →
that PT's letterhead; several PTs → the group letterhead (`groupName`/`groupLogo`) plus a PT column/section. The
PDF "Pengajuan Biaya" always uses the document PT's letterhead and `{COMPANY}`.

### 7. Jobs

`reimburseAutoClose`, `selfieRetention` and `dailyReminders` loop over **active companies** with that PT's settings
(`reminder_runs` per company); `auditDailyAnchor` and `sendEmail` stay global. A failure in one PT is logged and does
not stop the others.

### 8. APK

PT switcher (one PT or "Semua PT"); `/me` returns `companies[]` with per-PT roles, capabilities, employee and
settings, plus app-wide settings; drift schema **v3** adds `companyId` to drafts, outbox and progress reports;
master caches are keyed per PT; each outbox item is synced **under its own PT** (`X-Company-Ids` = that PT; the
server re-derives the company from the referenced project/cost center/employee and rejects a mismatch with
`COMPANY_MISMATCH`). One APK and one Firebase project for all PTs (Q-58).

### 9. Timezone (adjustment)

`companies.timezone` exists, but MC1 **validates it equals the process TZ** (all PTs in `Asia/Makassar`, Q-59):
14 call sites use `process.env.TZ` (cron, business dates, scope "today"). True per-PT timezones would need those
call sites plus the job schedules reworked — out of scope unless Q-59 says otherwise.

### 10. Odoo (F7, paper only)

Each ProyekKas PT maps to one **`res.company`** in the single client DB (`drms_prod`); per-PT records carry the Odoo
`company_id`; shared masters (banks, UoM) map to records without company. Details in the ADR 0009 revision; nothing
is built before F7.

### 11. Admin UI

Company master (`companies`, group "Sistem"), editable **role matrix** (user × PT × role, writes
`company-memberships`), employee ↔ PT mapping (employee form `company`; membership `employee`), PT switcher in
`admin/shell/ModuleBar.tsx` (next to the bell), a `PT` column + filter in every per-PT list view, a `PT` column in
the go-live import workbook (`apps/web/src/import/*`). Wireframes: `../mc/wireframes.md`.

## Security model

| Threat | Control |
|---|---|
| **IDOR across PTs** (guessing ids of another PT via `/api/<slug>/:id`, `/api/v1/...:id`, media files, PDF, exports) | Every read goes through access `Where`s that contain `company in <allowed>`; custom endpoints load documents with `overrideAccess: false` **or** call `assertCompanyAccess(req, doc.company, role)` right after a SYSTEM-READ; media files inherit the owner document check (ADR 0004 §4a). Out-of-PT ids answer **404** (no existence leak). Isolation test suite (MC1/MC4) iterates every collection and every `/api/v1` route with a user of PT A against ids of PT B. |
| **Header / cookie spoofing** (`X-Company-Ids`, `__Host-pk-companies`) | The selection only **narrows**: it is intersected with active memberships resolved from the DB for the authenticated user; unknown/foreign ids → 403 + audit `access_denied`; the cookie is `HttpOnly` and set only by the server. Mutations ignore the selection and check the role in the document's PT. |
| **Raw SQL bypassing Payload access** (233 `sql` fragments, reports, reminders, attendance, sync) | Company predicates come only from `ReportScope`/`companyScopeSql()` built from memberships (bound parameters); a new Semgrep rule flags `sql` template literals in `domain/reports/**`, `domain/reminders/**`, `domain/attendance/**` without a company helper in the same function; reconciliation tests per PT (numbers of PT A unaffected by PT B data). |
| **SYSTEM-READ (`overrideAccess: true`, 199 occurrences in 55 files)** | Inventory in `../mc/impact-inventory.md`; each one either works on an already company-checked document id or gets a company filter. The existing Semgrep rule `payload-local-api-implicit-override-access` (`.semgrep/proyekkas.yml:5`) stays. |
| **Cross-PT writes by bugs** (a PT A request pointing at a PT B project or cash account) | DB triggers of §4 (`cross-company reference`), `company_id NOT NULL`, immutable company columns. |
| **Privilege confusion** (Finance in PT A approves in PT B) | Decision guards use `rolesIn(req, doc.company)`; DB G1 guard rewritten to join `company_memberships`; tests for a user with different roles in two PTs. |
| **Stale role in token** | Per-PT roles are DB-only; token only proves identity + `pk-user`. |

Postgres **RLS was considered and is not adopted now**: the app role `pk_drms_app` is `NOBYPASSRLS` (ADR 0006), so
RLS would apply, but Payload reads outside transactions on pooled connections, so a per-request
`SET LOCAL app.company_ids` cannot be guaranteed on every query; jobs need all PTs (a second role or policy
exception); and the failure mode (empty results) is hard to debug. The DB-level defence is the NOT NULL + triggers +
composite uniques above. **Revisit** after MC4 for the raw-SQL report path only (reports already run inside a
transaction handle).

## Migration / backfill (staging → company #1 DRMS)

1. **Schema migration (Payload-generated):** create `companies`, `company_memberships` (+ `_roles`), add nullable
   `company_id` to every per-PT table, `users.group_admin`.
2. **Backfill migration (same release):** insert company #1 from the current `company_settings` row (name, short code
   `DRMS`, logo, letterhead, TZ, operational fields); `UPDATE … SET company_id = 1` on every per-PT table; one
   membership per user with `roles = users.roles` and `employee = users.employee_id`; `users.group_admin = true` for
   the existing Admins (staging: the user's account); counters `(1, doc_type, period_key)`.
3. **Security migration:** `SET NOT NULL`, composite uniques (§4), `pk_cash_lock_date(company_id)`, guards rewritten
   (G1 join via memberships), cross-PT triggers, `pk_protect_columns('company_id')`.
4. **Code cut-over in the same release**, then drop `users.roles`, `users.employee`, and the moved global fields.
5. **Keycloak (infra):** create realm role `pk-user` in `drms` and `drms-staging`, assign it to every ProyekKas user
   (script via the service account), later remove the five `pk-*` realm role mappings.
6. **APK:** drift v3 migration assigns existing local drafts/outbox rows to the user's only membership after the
   first `/me` (staging only; prod has no local data).
7. **Prod:** empty DB → migrations + seed create company #1; the go-live import fills the other PTs (Q-51).

Down migrations exist for 1–3 (pre-go-live only; after go-live a rollback would lose PT assignments).

## Alternatives

| Alternative | Why not |
|---|---|
| **One deployment per PT** (the infra per-client pattern: realm + DB + compose per client) | One person would need one login **per PT** (separate realms/tokens, APK re-login to switch), no consolidated inbox/dashboard/report across PTs (D3), duplicated employees/users, and 2–N × the RAM of ADR 0002 on a host that is already at ≈ 57 % of its remaining budget (phase-plan risk #2). Contradicts "one login across PTs". |
| **Keycloak Organizations / groups for per-PT roles** | Keycloak 26 offers Organizations (membership) and groups; per-organization *roles* are not a built-in token claim and would need a group per PT × role (`/CS1/finance`) plus a group mapper — **UNVERIFIED** against Keycloak 26.7.4 in this session. Even then: roles in the token are stale up to 300 s, the realm console is not reachable for the client (IP allow-list, ADR 0003 §2) so ProyekKas would still manage everything via the Admin API, every realm change is an infra change, and DB triggers/raw SQL cannot read token claims — the DB must hold memberships anyway. Rejected. |
| **Postgres RLS as the primary isolation** | See "Security model": not reliable with Payload's pooled, partly non-transactional reads; kept as a later hardening option for the report path. |
| **Schema per PT in one DB** | Consolidated reports would need `UNION` over N schemas, migrations × N, Payload does not support per-request schemas. |
| **Company in the URL** (`/admin/c/{id}/…`, `/api/v1/c/{id}/…`) | Payload admin routes are fixed; a URL company cannot express a multi-PT selection (D3). |
| **Shared masters with a company tag on transactions only** | Contradicts D2 (COA, vendors, cash accounts, projects per PT). |
| **Keep `users.roles` as a global fallback** | Would re-introduce "Finance everywhere"; no source of truth ambiguity allowed (D3). |

## Consequences

- Positive: one login, one APK, one deployment for all PTs; consolidation is a query over allowed companies; DB
  guarantees no cross-PT reference; per-PT roles take effect immediately.
- Negative: cross-cutting change touching almost every collection, 60 `hasRole`/54 `byRole` call sites, 26 raw-SQL
  files, 5 jobs, the APK DB schema; **60–88 pd** (`../phase-plan.md` phase MC) and a go-live shift of ≈ 4–6 calendar
  weeks with parallel agents.
- Admin work grows: role matrix per PT, masters per PT (copy-from-DRMS action proposed for categories/sequences/
  rules/schedules).
- Two employee rows for a person in two PTs means two bank-account sets and two attendance histories (by design, D1).
- Keycloak loses role information (the realm console no longer shows who is Finance) — by design.
- `architecture.md` §4, §7, §10, §11 and `requirements-v1.1.md` are superseded where `../requirements-v1.2.md` says so;
  `architecture.md` is updated in MC1 with the implementation.

## Rollback

Before go-live: revert the MC migrations (down migrations) and the code; Keycloak keeps the old `pk-*` role
mappings until step 5 of the backfill is completed, so the old login path works again after a revert. After go-live
with more than one PT: no rollback (data of several PTs cannot be merged back into one company without losing
separation) — forward fixes only.

## Open items

- Client answers Q-51…Q-61 (`../open-questions-client.md` §L) are needed for seeds, numbering start values,
  approval rules per PT and letterheads; the model does not depend on them.
- `groupAdmin` flag (§2) and `vehicles.plate_no` staying global (§4) are Analyst additions — confirm at the MC0 gate.
- Per-PT timezone beyond WITA (§9) only if Q-59 requires it.

## Implementation notes (MC1, 2026-09-28)

Implemented as designed (companies, memberships, `groupAdmin`, `company_id NOT NULL` on the 30 per-PT tables with
backfill to company #1, per-PT uniques, counters `(company_id, doc_type, period_key)`, `pk_cash_lock_date(company_id)`,
cross-PT triggers, per-PT `byRole` / `resolveScope`, decision guards on the document PT, `pk-user` login). Deviations:

| # | Design | Implementation | Reason |
|---|---|---|---|
| 1 | Cookie `__Host-pk-companies` | `pk-company-ids` (`__Host-pk-company-ids` on https, same pattern as the session cookie) | name fixed by the MC1 task; the switcher that sets it is MC2 |
| 2 | Header naming a foreign PT → 403 everywhere | `/api/v1` → 403 `COMPANY_NOT_ALLOWED` + `access_denied` audit; generic `/api/<slug>` uses the intersection (foreign ids ignored, empty = no rows) | auth strategies cannot answer 403 for Payload's own REST; the result never contains foreign rows |
| 3 | Token must carry `pk-user` | MC1 transition: `pk-user` **or** any legacy `pk-*` realm role is the login marker (never a permission); user create assigns `pk-user`, falls back to `pk-staff` while the realm lacks `pk-user` (Keycloak 422) | the realm change is an infra request (see phase plan); logins must keep working until it is applied |
| 4 | `company` required on per-PT masters | Payload field not `required` (DB `NOT NULL`); `companyHook` fills it (caller's only selected PT, or the only active PT for a system write, else 400 "PT wajib dipilih") | typed Local API calls (seed, import, fixtures) stay valid; same guarantee |
| 5 | Composite uniques as Payload indexes | raw SQL unique indexes `<table>_company_<col>_key` (migration `*_mc1_company_columns`) | Payload names compound indexes by column list only (`company_code_idx` collides across tables) |
| 6 | `users.roles` removed | removed as a column; `req.user.roles` / `req.user.employee` remain as DERIVED per-request values (union over the selected PTs) for UI hints and the MC2 transition; legacy checks renamed `hasRoleAny` | 60+ call sites (admin views, list endpoints) move to per-PT checks in MC2; no second source of truth |
| 7 | Rows without PT (audit) → Admin/group admin only | office roles in any PT (as before) | domain audit rows are not tagged yet (MC2); keeps single-PT behaviour identical |
| 8 | Users read by Admin/Direktur of the PT | users with a membership in those PTs **plus accounts without any membership** | onboarding: the Admin creates the account first, then the membership |
| 9 | Jobs per PT | `reminder_runs` keyed `(company_id, run_date)`; the jobs still run company #1 only (MC2 loop) | MC2 scope |

## Implementation notes (MC2 backend, 2026-09-28)

Branch `feat/mc2-backend` (domain, reports, jobs, media, sync; the admin UI + import run in parallel on
`feat/mc2-admin-ui`). Contract for the UI: `../mc/mc2-contract.md`; progress: `../mc/mc2-progress.md`.

| # | Design | Implementation | Reason |
|---|---|---|---|
| 1 | `ReportScope` = `{ companies: CompanyScope[] }` | `{ kind (summary), …legacy team/own fields, companies }`; a literal WITHOUT `companies` is fail-closed (`all` → FALSE, team/own ids unchanged) | admin views (other branch) still build/read `scope.kind`; fail-closed keeps them safe until they adopt the builders |
| 2 | Per-PT subtotal rows in reports | leading `PT` column + a separate "Subtotal per PT" table (Σ = total); paged reports get their per-PT totals from SQL | keeps the table model (CSV/XLSX/PDF) unchanged; no interleaved total rows in exports |
| 3 | Dashboards per PT | each layout reads the PTs where the caller holds THAT role (Owner layout: `pk-owner` PTs, Finance: `pk-finance` PTs, PM: team per PM PT, Admin: `pk-admin` PTs); `byCompany` next to every combined total; Finance "last closed period" combined = the OLDEST of the PTs' latest | a Direktur of A who is Staff in B must not get B numbers on the Direktur home |
| 4 | Media access follows the owning document (no company column) | office roles: all rows only when they hold the role in EVERY active PT (always with one PT); otherwise own uploads + files owned by requests / progress reports of their PTs, selfies of attendances of their PTs, signatures uploaded by members of their PTs (id lists, cached per request) | no migration; exact per-PT answer; performance to be measured with 3 PTs in MC4 |
| 5 | Selfie retention per PT | selfies without attendance and selfies of INACTIVE PTs are handled by the first active PT's run; the app-wide batch caps one run across all PTs | every file belongs to exactly one run (UU PDP: nothing is kept forever) |
| 6 | `COMPANY_MISMATCH` when the item PT ≠ header | item PT derived from project / cost center / existing draft or report; rejected when not in the EFFECTIVE selection (header ∩ memberships, default all memberships); on-behalf also when employee PT ≠ location PT | same rule for header and no-header requests; the DB triggers stay the last line |
| 7 | Semgrep rule for raw `sql` without company helper | unit test `tests/unit/mc2-sql-lint.test.ts` (per function, per-PT tables, allow-list with reasons) | runs in the existing unit job (no new CI tool); fails on a new unscoped function |
| 8 | Notification texts prefixed `[shortCode]` | not prefixed; rows carry `company` (reminders + late-progress now too) for the UI label | texts stay stable for the one-PT case and the APK; label = UI concern |
| 9 | Group logo on consolidated PDFs | text letterhead only (name, header lines, PT list; Author/Subject metadata) | the report PDF had no logo before (F3); logo rendering is a UI/PDF follow-up |
| 10 | "Gabungkan kategori berkode sama" [Usulan] | not implemented — categories are never merged across PTs | proposal only (requirements v1.2 §5) |

MC1 leftovers fixed here (security): addendum decisions used the union of roles over the selected PTs; manual
cash posting/edit/void checked "Finance in any PT"; internal PDF, full bank number in the DTO, cash rows in the
request history, device revoke, attendance correction, PM on-behalf check-in — all now check the role in the
document's PT.

## Revision history

- **2026-09-28 (MC2 backend):** implementation notes MC2 (deviations 1–10).
- **2026-09-28 (MC1):** implementation notes added (deviations 1–9 above).
- **2026-09-27 (MC0):** proposed; design approved by the user the same day; Analyst additions: `groupAdmin`,
  global vehicle plate, TZ = process TZ in MC1, `reminder_runs` per company, `period-closings/:period/reopen` needs a
  company parameter.
