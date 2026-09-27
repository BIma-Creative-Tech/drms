# ProyekKas MC — Code impact inventory (MC1–MC3)

- **Status:** MC0 deliverable (Analyst, 2026-09-27) · **Basis:** `develop` `74cf7f2` · **Design:** `../adr/0016-multi-company.md`
- **Purpose:** the concrete change list implementation agents work from. Every path is relative to `apps/web/src/`
  unless it starts with `apps/mobile/`. Counts were produced with the greps quoted in each section (run from
  `apps/web/src`); re-run them before starting a work package, the tree moves.
- **Terms:** *PT* = company; *per-PT* = table gets `company_id NOT NULL`; *SYSTEM-READ* = Local API call with
  `overrideAccess: true`; *company helper* = `rolesIn` / `hasRole(req, role, companyId)` / `companiesWithRole` /
  `companyScopeSql` of ADR 0016 §5–§6.

## Totals (greps)

| What | Count | Command |
|---|---|---|
| Collections | 46 (39 files + 7 upload collections) | `ls collections/*.ts \| grep -v fields-f2`; `grep -c "slug: 'media-" collections/media/index.ts` |
| `hasRole(` occurrences | 60 in 33 files (incl. definition) | `grep -rc "hasRole(" --include=*.ts --include=*.tsx .` |
| `byRole(` occurrences | 54 in 35 files | same with `byRole(` |
| `rolesAllowed(` / `fieldRoles(` | 37 in 27 files | same |
| `userRoles(` / `rolesOf(` / `isStaffOnly(` | 12 / 13 / 5 in 6 / 9 / 4 files | same |
| `resolveScope(` | 18 in 14 files | same |
| `'pk-owner'` literal and friends | `pk-owner`: 191 lines | `grep -rn "pk-owner" --include=*.ts --include=*.tsx . \| wc -l` |
| `sql` template fragments outside migrations | 233 in 32 files (223 in 26 business files) | ``grep -rc 'sql`' --include=*.ts --include=*.tsx . \| grep -v migrations/`` |
| SYSTEM-READ `overrideAccess: true` | 199 in 55 files | `grep -rc "overrideAccess: true" …` |
| `findGlobal({ slug: 'company-settings'` | 16 call sites (+ 1 inside the `settings(req)` helper, `domain/expense/common.ts:99-101`, which has 15 callers) | `grep -rn findGlobal`; `grep -rn "settings(req"` |
| `process.env.TZ` | 14 in 14 files | `grep -rn "process.env.TZ"` |
| `/api/v1` routes | ≈ 83 in 16 endpoint files (63 literal `path:` + 12 request actions + 3 receipt actions + 5 dashboards) | `grep -ho "path: '[^']*'" api/v1/endpoints/*.ts`; `grep -o "action('" …/expense-requests.ts`; `grep -o "dashboard('" …/reports.ts` |
| Admin custom views | 23 `path:` entries in `admin/config.ts` (views in 19 files of `admin/views/`) | `grep -c "path:" admin/config.ts`; `ls admin/views` |
| Jobs | 5 (`jobs/tasks.ts:20,58,92,113,138`) | — |
| APK Dart files (non-generated) | 122; 35 test files | `find apps/mobile/lib -name "*.dart" \| grep -v "\.g\.dart\|freezed"` |

---

## MC1 — Web foundation (data model, migration, access, auth, isolation tests)

### MC1-1 New collections / globals

| Item | Change |
|---|---|
| `collections/Companies.ts` (new) | Fields moved from `globals/CompanySettings.ts` (classification table ADR 0016 §1) + `legalName`, `active`; `shortCode` unique, immutable once a numbered document exists (hook). Access: read = members of the row's PT (+ `groupAdmin`); create/deactivate = `groupAdmin`; update = Admin/Owner of that PT. `withAudit({ docType: 'company' })`. Admin group "Sistem". |
| `collections/CompanyMemberships.ts` (new) | `user`, `company`, `employee` (filterOptions: `company = data.company`), `roles` (hasMany select of `ROLES`), `active`; unique `(user, company)`, partial unique `(company, employee)`. Access: read = own rows + Admin of the PT (+ groupAdmin); write = Admin of `data.company` (+ groupAdmin). Audit action `role_change` with company. |
| `globals/CompanySettings.ts` | Keep `minAppVersion`, `latestAppVersion`, `appDownloadUrl`, `offlineMaxAgeDays`, `imageTargets`, `selfieRetentionBatch`; add `groupName`, `groupLogo` (`media-company`), `groupPdfHeader`; update = `groupAdmin`. Remove the rest after backfill. |
| `collections/Users.ts` | Remove `roles` (L114-122) and `employee` (L123, unique); `ADMIN_FIELDS` (L15) and `norm` (L17-22) accordingly; add `groupAdmin` (checkbox, only settable by a groupAdmin); `defaultColumns` (L60) → email, name, active; `actionFor` `role_sync`/`role_change` (L150) moves to memberships. Access read/update (L68-83): Admin/Owner "true" → users with a membership in PTs where the caller is Admin/Owner. |
| `payload.config.ts` | register the two collections; `withStaffPanelVisibility` list unchanged. |
| `payload-types.ts` | regenerate. |

### MC1-2 Collections: company column, unique indexes, access rules

Legend: **C** = add `company` relationship (`required`, `index`, `admin.position: sidebar`, read-only after create,
`defaultColumns` gets `company` first) · **D** = company derived in a `beforeChange` hook from the parent (never from
input) · **U** = unique index change · **A** = access rule rewrite (`byRole` per PT) · counts = `byRole`/`hasRole`/
`rolesAllowed|fieldRoles` occurrences in the file.

| Collection file | Class | Company | U | Access (byRole/hasRole/rA+fR) | Notes |
|---|---|---|---|---|---|
| `ApprovalRules.ts` | per-PT master | C | — | 2/0/1 | hook: named users (`acknowledgeUser`, `approverUser`) must be members of `company` with `pk-owner`/`pk-finance` (today `rolesOf` global); `category`/`project`/`costCenter` filterOptions by company |
| `Approvals.ts` | tx | D (request/addendum) | — | 0/1/0 | satellite read via `domain/expense/access.ts` |
| `AttendanceCorrections.ts` | tx | D (attendance) | — | 1/0/0 | |
| `Attendances.ts` | tx | D (employee; project/cost center must match) | — | 1/0/0 | `attendances_one_per_day*` stay (employee is per PT) |
| `AuditLogs.ts` | tagged | nullable `company_id` (set by `audit/writer.ts` from the doc) | — | 1/0/0 | read: office roles of the row's PT; rows without company → Admin/groupAdmin |
| `Banks.ts` | shared | — | — | 1/0/1 | roles evaluated "in any PT" |
| `BudgetAddenda.ts` | tx | D (project) | `budget_addenda_doc_no_idx` → `(company_id, doc_no)` | 1/0/0 | |
| `BudgetLines.ts` | per-PT | D (project) | — | 2/0/1 | category must be same PT (trigger) |
| `CashAccounts.ts` | per-PT | C | `cash_accounts_name_idx` → `(company_id, name)` | 2/0/1 | bank = shared |
| `CashEntries.ts` | tx | D (cash account) | `cash_entries_entry_no_idx` → `(company_id, entry_no)` | 1/0/0 | lock date per PT (MC1-4) |
| `CashInSources.ts` | per-PT | C | `cash_in_sources_code_idx` → `(company_id, code)` | 2/0/1 | seed "Pengembalian LPJ" per PT (used by settlement refund) |
| `Clients.ts` | per-PT | C | — | 2/0/1 | |
| `CostCenters.ts` | per-PT | C | `cost_centers_code_idx` → `(company_id, code)` | 2/0/1 | `manager` must be a member of the PT |
| `Devices.ts` | per user | — | — | 2/0/1 | Admin "see all" → devices of users with a membership in the Admin's PTs |
| `DocumentSequences.ts` | per-PT | C | `document_sequences_doc_type_idx` → `(company_id, doc_type)` | 2/0/1 | L28-36 `unique: true` removed; per-PT defaults on company create |
| `EmployeeBankAccounts.ts` | per-PT | D (employee) | — | 2/0/2 | |
| `Employees.ts` | per-PT | **C (required)** | `employees_code_idx` → `(company_id, code)` | 1/1/1 | own-row read (L37) uses the membership employee; `workSchedule` same PT |
| `ExpenseCategories.ts` | per-PT | C | `expense_categories_code_idx` → `(company_id, code)` | 1/0/1 | uoms shared |
| `ExpenseLineSnapshots.ts` | tx | D (request) | — | — | |
| `ExpenseRequests.ts` | tx | C on create (from project/cost center; must equal) | `expense_requests_doc_no_idx` → `(company_id, doc_no)` | 0/0/1 (+ `domain/expense/access.ts` 2 byRole) | own-requester check (L105) uses membership employee of the PT; `clientUuid` stays global |
| `Holidays.ts` | shared | — | `holidays_date_idx` stays | 1/0/1 | |
| `Notifications.ts` | tagged | nullable `company_id` | — | 1/0/0 | own rows only (unchanged) |
| `NotificationTemplates.ts` | app-wide | — | stays | 2/0/1 | Admin in any PT → **groupAdmin** (texts are shared) |
| `PeriodClosings.ts` | per-PT | C | `period_closings_one_closed` → `(company_id, period) WHERE status='closed'` | 1/0/0 | |
| `ProgressReports.ts` | tx | D (project) | `progress_reports_doc_no_idx` → `(company_id, doc_no)` | 1/0/0 | |
| `ProjectStages.ts` | per-PT | D (project) | — | 2/0/1 | |
| `Projects.ts` | per-PT | C | `projects_code_idx` → `(company_id, code)` | 2/0/2 | `pm` must be member of the PT; client same PT |
| `ReceiptFlags.ts` | tx | D (request) | — | — | |
| `Receipts.ts` | tx | D (request) | — | — (`isStaffOnly`) | vendor same PT |
| `Settlements.ts` | tx | D (request) | `settlements_doc_no_idx` → `(company_id, doc_no)` | — | |
| `StageTemplates.ts` | per-PT | C | `stage_templates_name_idx` → `(company_id, name)` | 2/0/1 | |
| `TeamAssignments.ts` | per-PT | D (employee; project/cost center must match) | — | 2/1/1 | |
| `Transfers.ts` | tx | D (request; cash account must match) | `transfers_doc_no_idx` → `(company_id, doc_no)` | 0/1/0 | |
| `Uoms.ts` | shared | — | stays | 1/0/1 | |
| `Users.ts` | per user | — | `users_employee_idx` dropped | 2/1/3 | see MC1-1 |
| `Vehicles.ts` | per-PT | C | `vehicles_plate_no_idx` **stays global** (ADR 0016 §4, Q-61) | 1/0/1 | default project/cost center same PT |
| `Vendors.ts` | per-PT | C | — | 2/0/1 | |
| `WebSessions.ts` | per user | — | — | 1/1/0 | |
| `WorkSchedules.ts` | per-PT | C | `work_schedules_name_idx` → `(company_id, name)` | 1/0/1 | |
| `media/index.ts` (7 upload collections) | per owner doc / per user | — (`media-company`: read by members of a PT whose logo it is, or any member for the group logo) | `*_filename_idx` stay | 3/0/6 | owner-document checks in `api/v1/endpoints/media.ts` (3 SYSTEM-READs) must include the company check |

### MC1-3 Access helpers and auth

| File | Change |
|---|---|
| `access/roles.ts` | `hasRole(req, role \| role[], companyId)` (company **required**; L46-48), `rolesIn(req, companyId)`, `companiesWithRole(req, ...roles)`, `memberCompanies(req)`; `userRoles`/`rolesOf` (L37-44) become "roles in any selected PT" and are only allowed for UI hints (rename `anyRoleHints`); `anyRole` (L58) = has at least one active membership in the selection; `isStaffOnly` (L28-31) per selection. |
| `access/policies.ts` | `byRole` (L13-30) per company as in ADR 0016 §5; `rolesAllowed` (L33-35) → true if the role is held in any selected PT **and** a `create` check on `data.company`; `fieldRoles` (L38-40) → uses the document's company when available (`siblingData`/`doc`), else any PT. Scope rules (`teamProjects`, `ownEmployee`, …; L47-97) take the per-company scope. |
| `access/scope.ts` | `resolveScope` (L33-108) → `resolveScopes(req): Map<companyId, Scope>`; employee from the membership (L39 today `req.user.employee`); cache key = user + selection. |
| `access/company-context.ts` (new) | parse `X-Company-Ids` / cookie `__Host-pk-companies`, load memberships (SYSTEM-READ), intersect, 403 `COMPANY_NOT_ALLOWED` + audit `access_denied` on foreign ids; `assertCompanyAccess(req, companyId, roles)` for custom endpoints after a SYSTEM-READ. |
| `access/panel-visibility.ts` | unchanged logic; `isStaffOnly` per selection. |
| `auth/strategies.ts` | `mobileBearerStrategy`: require `pk-user` in `realm_access.roles`; drop the token ∩ DB role filter (L139-142); `user.roles` no longer set (L165). `oidcSessionStrategy` unchanged apart from not carrying roles. |
| `app/(auth)/auth/callback/route.ts` | L36-61: require `pk-user`; remove the `role_sync` update; `createWebSession(…, { id, roles })` (L63) without roles. |
| `domain/users-sync.ts` | stop `applyRoles` (L50-56, L86, L113-114); on create assign `pk-user`; compensation (L174-176) only for `pk-user`. |
| `auth/keycloak-admin.ts` | unchanged API; role name constant `pk-user`. |
| `audit/writer.ts` | add `company` to rows (from the doc or `req.context`); `rolesOf` (1×) for actor roles → roles in that PT. |
| `api/v1/http.ts` | `v1({ roles })` option (L70) → evaluated against the document's company inside handlers, or "any selected PT" for list endpoints; min-version check (L58-62) stays app-wide. |
| `lib/admin-gate.ts` / `proxy.ts` | no change (cookie presence only). |

### MC1-4 Migrations and DB guards (new files; never edit applied migrations)

1. `YYYYMMDD_mc1_companies` (Payload-generated): tables `companies`, `company_memberships`, `company_memberships_roles`,
   nullable `company_id` columns + FKs + indexes on the 30 per-PT tables of ADR 0016 §4, `audit_logs.company_id`,
   `notifications.company_id`, `users.group_admin`.
2. `YYYYMMDD_mc1_backfill`: company #1 from `company_settings`; `UPDATE … SET company_id = 1`; memberships from
   `users_roles` + `users.employee_id`; `group_admin` for current Admins; counters re-keyed.
3. `YYYYMMDD_mc1_security` (raw SQL, owner role):
   - `SET NOT NULL` on per-PT `company_id`; `pk_protect_columns('company_id')` triggers on every per-PT table.
   - Composite uniques of MC1-2 (drop old, create new): the 18 index/PK changes of ADR 0016 §4 (incl. the
     `document_sequence_counters` and `reminder_runs` primary keys); drop `users_employee_idx`.
   - `pk_cash_lock_date(company_id int)` replacing `pk_cash_lock_date()` (`migrations/20260923_133050_f2a_security.ts:61-64`);
     callers: `pk_transfers_guard` (f2a L227; redefined f2b L165), `pk_cash_entries_guard` (f2a L265),
     `pk_cash_entries_opening_guard` + `pk_cash_accounts_opening_lock` (`20260926_133934_s3b_data_import.ts`, uses
     `min(period)` of closings L41 → per company), `domain/cash/ledger.ts:60`, `import/run.ts:541`.
   - G1 guards joining `users.employee_id` → `company_memberships`: `pk_approvals_before_insert`
     (f2a L158, e5 L103), `pk_request_involves` (f2e L28), addendum variant (e5 L220 in `down`).
   - Cross-PT reference triggers `pk_same_company(...)`. **FK pairs** (child column → parent):
     `expense_requests.{project_id, cost_center_id, bank_account_id, approval_rule_id, resubmit_of_id}`,
     `expense_requests_rels.employees_id (requesters)`, `expense_requests_lines.{category_id, vehicle_id}` (uom shared),
     `receipts.{request_id, vendor_id}`, `receipt_flags.request_id`, `approvals.{request_id, addendum_id}`,
     `transfers.{request_id, cash_account_id, cash_entry_id}`, `cash_entries.{cash_account_id, category_id, cash_in_source_id,
     project_id, cost_center_id, vehicle_id, expense_request_id, transfer_id, reversal_of_id}`, `settlements.{request_id,
     refund_cash_entry_id, shortfall_transfer_id}`, `budget_addenda.{project_id, approval_rule_id}`, `budget_lines.{project_id,
     category_id}`, `progress_reports.{project_id, stage_id}`, `project_stages.project_id`, `projects.client_id`,
     `vehicles.{project_id, cost_center_id}`, `team_assignments.{employee_id, project_id, cost_center_id}`,
     `attendances.{employee_id, project_id, cost_center_id}`, `attendance_corrections.attendance_id`,
     `employees.work_schedule_id`, `employee_bank_accounts.employee_id`, `approval_rules.{category_id, project_id,
     cost_center_id}`, `company_memberships.employee_id`; user-typed references that need an **active membership in the
     row's company**: `projects.pm_id`, `cost_centers.manager_id`, `approval_rules.{acknowledge_user_id,
     steps.approver_user_id}`. (Column names to be confirmed against the generated schema; the list is from the
     collection relationships, `grep -o "relationTo: '[a-z-]*'" collections/*.ts`.)
4. Keycloak (infra): realm role `pk-user` in `drms` / `drms-staging` (realm export + Admin API script).

### MC1-5 Numbering

| File | Change |
|---|---|
| `domain/numbering-db.ts` | `companyCode(req)` (L36-44) → `companyCode(req, companyId)` from `companies`; `loadSequence(req, docType, companyId)`; counter SQL (L63-70) with `company_id`; `allocateDocNo(req, docType, { companyId, … })` required. |
| `domain/numbering.ts` | `DEFAULT_SEQUENCES` (L97-105) = template for new PTs; `startAt` per PT from company creation / import. |
| callers of `allocateDocNo` | `grep -rn "allocateDocNo(" domain` — expense submit, transfers, settlements, cash entries, progress reports, addenda: pass the document company. |

### MC1-6 Tests (qa-security + nextjs)

- `tests/integration/flow-world.ts`, `helpers.ts`: fixture with **two PTs** (DRMS, CS1) and users with different roles
  per PT; all existing suites must pass on it (≈ 34 integration files).
- New `tests/integration/mc-isolation.int.test.ts` (generated per collection + per `/api/v1` route with `:id`),
  `mc-db-crosscompany.int.test.ts` (every FK pair above, raw SQL as app role), `mc-auth.int.test.ts` (`pk-user`,
  header/cookie spoofing), `mc-migration.int.test.ts` (backfill on a snapshot), numbering 2 PTs × 50 parallel
  (`numbering.int.test.ts`).
- `.semgrep/proyekkas.yml`: rule for `sql` template literals in `domain/{reports,reminders,attendance,sync,cash}/**`
  without `companyScopeSql`/`companyIn` in the same function; rule forbidding `hasRole(` with fewer than 3 args.

---

## MC2 — Domain, reports, jobs, admin UI, import

### MC2-1 Domain services (approval, notifications, queues, cash, attendance, progress, addendum)

| File | `sql` / SYSTEM-READ / hasRole | Change |
|---|---|---|
| `domain/expense/snapshot.ts` | 1 / 6 / 0 | `loadActiveRules` (L80-113) filter `company`; `activeUsersWithRole(req, role, companyId)` (L116-128) via memberships; `usersById` (L131ff) returns roles in the rule's PT; `rolesOf` (1×). |
| `domain/expense/common.ts` | 4 / 9 / 0 | `settings(req)` (L99-101) → `companySettings(req, companyId)`; `actorContext` (L146-165): `rolesIn(req, doc.company)`, membership employee for `isRequester`; `userRoles` (1×). |
| `domain/expense/rules.ts` | — | no signature change; callers pass PT roles (`matchesStep`/`matchesAcknowledger` L220-236). |
| `domain/expense/decision.ts` | — | `planPositions` receives PT holders (unchanged logic). |
| `domain/expense/queues.ts` | 0 / 1 / 0 | items get `company {id, shortCode}`; `settings(req)` per item PT (budget warn %). |
| `domain/expense/access.ts` | — / — / 1 (+2 byRole) | "see all" rules (L33-39) per PT; satellite access (L82-90) per PT. |
| `domain/expense/drafts.ts` | 0 / 7 / 2 | create: `company` required when >1 PT selected; creator employee from membership (L121, L217); master pickers per PT. |
| `domain/expense/workflow.ts`, `transfers.ts` (3 sql), `receipts.ts` (3 sql, 19 SYSTEM-READ), `lpj.ts` (8), `dto.ts` (3), `timeline.ts`, `flags.ts`, `line-audit.ts`, `auto-close.ts` (1 sql) | see counts | company-aware settings (tolerance, age, auto-close days), PT roles in guards, company on numbering calls; `workflow.ts:170` employee from membership. |
| `domain/notifications.ts` | 0 / 5 / 0 | `usersWithRole` (L82-93) per PT; toggles (L220-222) per PT; notification rows get `company_id`; texts prefix `[shortCode]`. |
| `domain/addendum/service.ts`, `access.ts`, `rules.ts` | 1 / 10 / 2+2 | `usersWithRole` (L232-243) and Finance notify (L484) per PT; `resolveScope` per PT. |
| `domain/cash/ledger.ts` (5 sql, 9 SYSTEM-READ), `book.ts` (4 sql), `periods.ts` | | lock date per company (`currentLockDate` L58); `closePeriod`/`reopenPeriod` (L269, L293) take `companyId`; `balances` (L249) per PT; `assertAccount` (L64) checks company. |
| `domain/attendance/{record (3 sql, 9 SR), service, queries (12 sql), web (6 sql), corrections (2 sql), aggregate, calendar, schedule, retention (8 sql)}.ts` | | employee = membership employee of the project's PT; settings per PT (geofence radius `record.ts:136`, default schedule `record.ts:97`, `queries.ts:46`); retention per PT. |
| `domain/progress/{reports, stages, recalc (3 sql), guards, access, dto, reminders (1 sql)}.ts` | | settings per PT (`reports.ts:182`, `reports/progress.ts:40`); PT roles for Direktur/PM checks. |
| `domain/sync/service.ts` (7 sql), `sync/attendance.ts`, `sync/progress.ts` | | feature flags per PT (`service.ts:678`); company derived per item; `COMPANY_MISMATCH` rejection code. |
| `domain/history.ts` | 0 / 3 / 1 | Riwayat filtered by PT of the document. |
| `domain/devices.ts` | 0 / 5 / 1 | Admin revoke: only users with a membership in the Admin's PTs. |
| `domain/reminders/service.ts` (12 sql), `reminders/rules.ts` | | `roleHolders` (L60-63) joins `company_memberships`; `requestPeople` (L66-72) joins memberships; run per company (`reminder_runs` key); settings per PT (L252). |
| `pdf/data.ts` (3 SR), `pdf/PengajuanBiaya.tsx`, `pdf/format.ts` | | letterhead/logo/shortCode from the request's PT (`data.ts:57-59,142`). |
| `seed/{data,seed,uat,uat-seed}.ts` | seed.ts 7 SR | company #1 DRMS in seed data (`data.ts:18-19`), per-PT defaults; UAT seed adds fictional PT `CS1` with its own users/roles. |

### MC2-2 Reports / KPI / exports (raw SQL)

| File | `sql` fragments | Change |
|---|---|---|
| `domain/reports/scope.ts` | 18 | `ReportScope` → `{ companies: CompanyScope[] }`; `officeScope`/`attendanceOfficeScope`/`teamScope`/`ownScope` (L26-55) per company; `requestScopeSql`, `cashScopeSql`, `projectScopeSql`, `costCenterScopeSql` (L69-108) → OR over companies with `x.company_id = $c`; `includesManualCash` (L111) per company; new `companyScopeSql(col, scope)`. |
| `domain/reports/kpi.ts` | 88 | every exported function gets `company_id` in SELECT/GROUP BY for breakdowns; functions without scope today get one: `reportContext` (L61, settings per PT), `cashBalances` (L94), `cashFlowMonthly` (L129), `accountMonthFlows` (L166), `cashBreakdown` (L180), `requestMoney` (L200, check doc PT), `transferQueueSummary` (L377), `masterGaps` (L736), `lastClosedPeriod` (L757, per PT). |
| `domain/reports/registry.ts` | 17 | 8 reports (`rekap-kas` L163, `buku-kas` L287, `pengeluaran-kategori` L395, `anggaran-project` L474, `rekap-pengajuan` L583, `kelengkapan` L694, `biaya-kendaraan` L777, `audit-log` L838): parameter `company` (multi), PT column, per-PT subtotal rows + total. |
| `domain/reports/audit-log.ts` | 13 | `company_id` filter; actor name join via membership employee (L113, L160 join `users.employee_id` today). |
| `domain/reports/dashboards.ts` | 0 (uses kpi) | per-PT breakdown + total per card (5 loaders). |
| `domain/reports/attendance-report.ts` | 3 | settings per PT (L48); scope per company. |
| `domain/reports/progress.ts` | 2 | colour thresholds per PT (L40). |
| `domain/reports/export.ts` | 0 (1 SR) | letterhead: 1 PT → PT letterhead, >1 → group letterhead (L196-197). |
| `domain/reports/rules.ts`, `viz.ts` | — | series per PT (colour order by PT code). |
| `pdf/ReportPdf.tsx`, `pdf/report-render.ts` | — | group letterhead + PT sections. |

### MC2-3 Jobs (`jobs/tasks.ts`)

| Task | Line | Change |
|---|---|---|
| `auditDailyAnchor` | L20 | none (global hash chain) |
| `sendEmail` | L58 | none |
| `reimburseAutoClose` | L92-100 | loop active companies; `autoCloseReimburse(payload, company)` with that PT's `reimburseAutoCloseDays` (`domain/expense/auto-close.ts:23`) |
| `selfieRetention` | L113-127 | loop companies; months/enabled per PT, batch app-wide (`domain/attendance/retention.ts:34`) |
| `dailyReminders` | L138-155 | loop companies; `reminderHour`/toggles per PT; `reminder_runs (company_id, run_date)`; one PT's failure logged, others continue |

### MC2-4 Admin UI

| File | Change |
|---|---|
| `admin/shell/ModuleBar.tsx` (506 lines, `ModuleBar` L387) | PT switcher component next to the bell (wireframe §1a); chip with current selection. |
| `admin/shell/modules-server.ts`, `admin/modules/registry.ts` | menu visibility per role **in any selected PT** (`rolesOf` today); Sistem module (L211) adds `companies`, `company-memberships`, view "Pengguna & akses PT". |
| `admin/config.ts` | new custom view `/akses-pt` (role matrix, wireframe §2); endpoint for the switcher cookie. |
| `admin/views/Dashboard.tsx` (`rolesOf`), `Reports.tsx` (4 hasRole), `ApprovalInbox.tsx`, `TransferQueue.tsx`, `LpjVerification.tsx`, `Kas.tsx`, `Absensi.tsx` (2 hasRole, 1 SR, `findGlobal` L1025, own employee L556), `Progress.tsx` (8 hasRole), `Addendum.tsx` (3 hasRole), `Notifikasi.tsx`, `RiwayatView.tsx` (TZ `findGlobal` L73), `shared.tsx` (1 hasRole), `f3-ui.tsx`, `viz.tsx`, `frame.tsx`, `Launcher*.tsx` | PT column/chips, per-PT breakdown + totals (wireframes §4–§5), `hasRole(req, role, companyId)`; forms (Kas baru, Addendum baru) get a PT field when >1 PT selected; Tutup buku per PT. |
| `admin/components/{WorkflowPanel (1 SR, employee L246), RequesterActions, ReimburseReceiptReview, ReviewDetails, PdfLinks, NotificationBell}.tsx`, `components/{kas,addendum,absensi,progress}/*` | PT roles for buttons; `AttendanceActions.tsx:302-312` posts `defaultWorkSchedule` to the global → to the company. |
| Collection list views | `defaultColumns` start with `company` on every per-PT collection; list filter `company`. |

### MC2-5 Import workbook (`import/*`)

| File | Change |
|---|---|
| `import/spec.ts` | new sheet `Perusahaan`; column `kode_pt` on Kategori (L134), Karyawan (L150), Rekening (L182), PusatBiaya (L197), Project (L212), Tahapan (L231), RAB (L244), Kendaraan (L256), Penugasan (L271), AkunKas (L286); `Pengaturan` (L99) → per-PT settings; `Pengguna` (L165, `peran` L175) → sheet `AksesPT` (username, kode_pt, peran, kode_karyawan); Bank (L111), Satuan (L122) unchanged. |
| `import/parse.ts` (`roles` L164), `resolve.ts`, `run.ts` (3 sql, 12 SR, `findGlobal` L527, lock L541), `report.ts`, `template.ts`, `sample.ts`, `xlsx-io.ts`, `cli.ts` | references resolved **within** `kode_pt`; `nomor_pb_mulai` per PT; report grouped per PT. |
| `docs/proyekkas/templates/*.xlsx`, `runbooks/import-data-golive.md` | regenerate template + fictional sample with two PTs; runbook per PT. |

---

## MC3 — API + OpenAPI + APK

### MC3-1 `/api/v1` (≈ 83 routes)

| Endpoint file (routes) | Change |
|---|---|
| `me.ts` (1) | `companies[]` (id, name, shortCode, roles, capabilities, employee, settings) + app-wide `settings`; `findGlobal` (L33) split; capabilities (L38-45) per PT. New `POST /me/companies` (web switcher cookie). |
| `masters.ts` (1 `/masters`) | per PT (header) + shared masters; default geofence per PT (L50). |
| `expense-requests.ts` (14 literal + 15 action routes) | items/detail carry `company`; create body `company`; role checks per doc PT (2 hasRole, `resolveScope`). |
| `addenda.ts` (10), `progress.ts` (7), `attendance.ts` (5; own employee L123), `cash.ts` (8 incl. `/period-closings`, `/period-closings/:period/reopen` L163/L174 → `company` param, `/cash-accounts/balances` L127 per PT) | same pattern. |
| `reports.ts` (2 + 5 dashboards) | `company` query param (multi); `dashboard()` helper (L25) roles per PT. |
| `sync.ts` (1) | per-PT batch, `COMPANY_MISMATCH`. |
| `media.ts` (3; 3 SR) | owner-document company check before streaming/signing. |
| `notifications.ts` (4) | `company` field on items; filter by selection optional. |
| `devices.ts` (2), `app.ts` (1, app-wide `findGlobal` L29), `health.ts` (2), `openapi.ts` (1), `admin.ts` (1) | `app.ts` reads only app-wide fields; others unchanged. |
| `api/v1/schemas*.ts`, `openapi*.ts`, `packages/api-contract/openapi.json` | `X-Company-Ids` header parameter (global component), `company` fields, `CompanyRef`, error codes `COMPANY_NOT_ALLOWED`, `COMPANY_MISMATCH`; regenerate. |

### MC3-2 APK (`apps/mobile`)

| File(s) | Change |
|---|---|
| `lib/core/db/app_database.dart` | schema v3 (L177): `companyId` on `LocalDrafts` (L14-37), `LocalProgressReports` (L92-134), `Outbox` (L138-160); `onUpgrade` 2→3 (L181-184); kv keys per PT. Regenerate `app_database.g.dart`. |
| `lib/core/network/api_client.dart` | header `X-Company-Ids` next to `X-Device-Id` (L141) from the selection provider (per request override for sync). |
| `lib/features/auth/domain/user_profile.dart` (+ `.freezed.dart`), `data/profile_api.dart`, `application/auth_controller.dart` (profile cache L119, L146) | `companies[]`, per-PT `Capabilities` (L36-55); `Capabilities.fromRoles` fallback per PT; selection persisted per `sub`. |
| `lib/features/settings/presentation/profile_screen.dart`, `lib/features/home/presentation/{home_screen,home_shell}.dart`, `lib/shared/widgets/module_tile.dart` | PT switcher (wireframe §1b), PT chip, launcher tiles by per-PT capabilities. |
| `lib/features/masters/data/masters_repository.dart` (L23, L31), `domain/master_item.dart` | cache key `sub` + PT; picker loads the draft's PT. |
| `lib/features/expense/{data/draft_repository, data/expense_api, data/expense_mappers, domain/draft, domain/draft_validation, application/draft_service, application/expense_providers, presentation/draft_editor_screen, presentation/requests_screen, presentation/request_detail_screen, presentation/widgets/master_picker}.dart` | draft `companyId` (chosen first when "Semua PT"), PT chip in lists, mappers read `company`. |
| `lib/features/sync/{application/sync_engine, application/sync_coordinator, data/outbox_repository, data/sync_api, background/background_sync, presentation/queue_screen}.dart` | batch per PT with header = item PT; handle `COMPANY_MISMATCH`; queue screen shows PT. |
| `lib/features/progress/*` (11 files), `lib/features/attendance/*` (10 files), `lib/features/addendum/*` (5 files), `lib/features/approvals/*` (4 files), `lib/features/dashboard/*` (4 files), `lib/features/notifications/*` (5 files) | PT on items; attendance/on-behalf candidates per PT; inbox mixed PTs with chip; dashboard breakdown per PT; notification PT prefix. |
| `lib/l10n/*.arb` + gen | strings "Pilih PT", "Semua PT", error texts. |
| Tests (`apps/mobile/test`, 35 files) | `encrypted_db_test` (v2→v3), `sync_engine_test`, `sync_models_test`, `progress_sync_test`, `draft_domain_test`, `e1_e3_domain_test` (capabilities per PT), widget `screens_test`, `e1_e3_screens_test`, `profile_logout_test`; `integration/mock_backend_flow_test.dart` with two PTs. |

---

## Not affected (checked)

`lib/idempotency.ts` (4 sql; keyed per user), `lib/system-tx.ts` (2), `email/rate-guard.ts` (1), `audit` hash chain
(`jobs/tasks.ts:20`), `api/v1/endpoints/health.ts` (1), `import/cli.ts` (1 — transaction wrapper only), `idempotency_keys`
and `sync_receipts` tables (per user), `approvals_*` unique indexes, `attendances_one_per_day*`, `cash_entries_one_reversal`,
`settlements_request_idx`, `project_category_idx`, media filename indexes, `uuid`/`client_uuid` indexes.

## Open for implementation agents

- Confirm the generated column names of MC1-4 against `payload-types.ts`/the Payload migration JSON before writing the
  trigger list.
- Timezone: keep `process.env.TZ` (14 sites) and validate `companies.timezone = TZ` (ADR 0016 §9) unless Q-59 changes.
- `LOCK TABLE period_closings` (`domain/cash/ledger.ts:273,297`) stays table-wide (serialises closings of all PTs).
