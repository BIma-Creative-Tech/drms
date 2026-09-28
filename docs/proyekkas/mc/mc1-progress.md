# MC1 — progress log (multi-company web foundation)

- **Branch / worktree:** `feat/mc1-foundation` in `/opt/src/proyekkas-wt/mc1`, based on `develop` `47e2853`.
- **Design:** `../adr/0016-multi-company.md`; work list `impact-inventory.md` §MC1-1…MC1-6.
- **Purpose of this file:** resume point for another agent. Updated + committed with every work package.

## How to run (host has no node)

Containers created by this phase (remove by exact name only, never `docker … prune`):
`pk-mc1-net` (network), `pk-mc1-pg` (postgres:16.15-bookworm), `pk-mc1-node` (node:24.21.0-bookworm-slim,
worktree mounted at `/w`), `pk-mc1-mailpit` (SMTP sink, CI replica). Role passwords live in the agent scratchpad
(throwaway). Unit = `npm -w apps/web run lint && … typecheck && … test`; integration = `vitest -c
vitest.integration.config.ts` with `PK_TEST_DATABASE_URL{,_OWNER,_RO}` → `pk_test`. Migration check on staging-like
data: `pg_dump` of a DB migrated to develop head and filled by the full integration suite (269 users, 637 requests,
475 cash entries), restored as `pk_mig`, then `payload migrate` / `migrate:down` / `migrate` again.
`payload migrate:create` asks drizzle rename prompts → answered "create" through a pty.

## Baseline (develop 47e2853)

- unit: 34 files / 518 tests green; integration: 33 files / 435 passed + 1 skipped (≈ 14 min).

## Work packages

| WP | Status | Commit | Notes |
|---|---|---|---|
| MC1-1 collections, global shrink, users | done | `42586c8` | unit 518/518, integration all 33 files green (C1 full run + reruns) |
| MC1-2 company column + access per PT | done | `4b8095b` | incl. MC1-3 remainder (selection, per-PT decision guards); integration 33 files / 437 + 1 skipped green |
| MC1-3 access helpers + auth | done | `42586c8` + `4b8095b` | split: context/auth in MC1-1, per-PT policies/guards in MC1-2 |
| MC1-4 security migration (triggers, lock date, NOT NULL) | done | see git log | NOT NULL + derive triggers already in MC1-2's migration; this one: immutability, cross-PT refs, lock date per PT, `reminder_runs` per PT |
| MC1-5 numbering per PT | done | see git log | counters `(company_id, doc_type, period_key)`, `{COMPANY}` = document PT, shortCode immutable once numbered |
| MC1-6 isolation tests + seed shapes | in progress | — | seed shapes landed in MC1-2 (needed by the per-PT masters); isolation suite + helper unit tests here |

### MC1-1 (done)

- New collections `companies` (identity + per-PT operational settings moved from the global, `COMPANY_SETTING_FIELDS`)
  and `company-memberships` (user × PT: roles, employee, active; unique (user, company), (company, employee)).
- Global `company-settings` = app-wide only (APK gate, image targets, offline max age, selfie batch, group letterhead);
  update = `groupAdmin` only.
- `users`: `roles` + `employee` removed; `groupAdmin` (DB only, settable by a group admin).
- Access context (needed at once because the columns are dropped): `access/roles.ts` (membership context on
  `req.user._pkCompanies`; derived `roles`/`employee` = union over the selected PTs = UI hints / MC2 transition;
  `hasRole(req, role, companyId)` company REQUIRED; legacy variadic calls renamed `hasRoleAny` = "any selected PT",
  every call is an MC2 review point), `access/company-context.ts` (memberships loader, `X-Company-Ids` header,
  cookie `pk-company-ids`, `assertCompanyAccess`).
- Auth: strategies attach the company context; login gate `tokenAllowsLogin` = `pk-user` OR any legacy `pk-*` realm
  role (MC1 transition, documented); callback no longer syncs roles; `users-sync` assigns only `pk-user` (fallback
  `pk-staff` marker while the realm lacks `pk-user`, KC 422), never role mappings.
- Domain readers of `users.roles` / `users.employee` switched to memberships (`domain/companies.ts`):
  approver pools (`snapshot.ts`, `notifications.ts`, `addendum/service.ts`) per document PT, requester accounts (G1),
  display names, reminders SQL, KPI master gaps, audit-log report SQL, import users → membership.
- Settings readers → `settings(req, companyId?)` (app-wide ∪ PT; default = caller's only PT, else company #1) and
  `settingsOf(payload, companyId?)` for jobs.
- Migration `20260927_230033_mc1_companies`: generated + backfill (company #1 DRMS from the global; one membership per
  user with its old roles/employee; `group_admin` for Admins) + drops + G1 functions (`pk_approvals_before_insert`,
  `pk_request_involves`) joined through `company_memberships`. Down restores the single-company shape.
  Verified on the develop-head snapshot: 1 company, 269 memberships, 275 role rows, 108 employee links,
  29 group admins; down → up round trip identical.

### MC1-2 (done)

- `fields/company.ts`: `companyField()` (not `required` at the Payload level — the hook always fills it; DB NOT NULL)
  + `companyHook(slug, { derive, check })` (derive = parents the PT is copied from, check = further per-PT
  references incl. `member` = user with an active membership in the PT; pending create-role check).
- `access/policies.ts`: `byRole` per PT, `byRoleAny`, `rolesAllowed` (role in `data.company` / pending check),
  `rolesAllowedAny`, `fieldRoles` (document PT), `anyMember`, `usersOfMyCompanies` (users/devices of the caller's PTs
  + accounts without membership). `access/scope.ts`: `resolveScope(req, companyId | null)`.
- Decision paths per PT: `actorContext` (roles + employee in the document PT), `byVisibleRequest` (office roles of
  the PT), drafts (`validateContent`/create), addendum `isTeamPm`, progress `canReportOn`, stages, team assignments,
  employee phone field, rule loading (`loadActiveRules(…, companyId)`), approver pools (`snapshotForRule(…, companyId)`).
- Audit rows carry `company` (from the document; `companies` rows → their id), actor roles = roles in that PT.
- Migration `20260927_234849_mc1_company_columns`: generated columns/FKs/indexes + backfill (user triggers disabled
  for the one UPDATE), NOT NULL, per-PT unique indexes (`<table>_company_<col>_key`), derive triggers
  (`<table>_00_company`, sorted first). Verified on the staging copy (637 requests, 475 cash entries → company #1).
- `// MC2:` leak points are listed in the final section of this file (kept up to date per WP).

### MC1-4 (done)

- Migration `20260928_000100_mc1_security`: `<table>_company_protect` (immutable `company_id`, 30 tables + tags),
  `pk_same_company` (`<table>_company_refs`, every per-PT FK pair of the inventory, verified column names),
  `pk_child_same_company` (requesters `_rels`, request lines), `pk_company_member` (projects.pm, cost_centers.manager,
  approval_rules.acknowledge_user) + `pk_rule_step_member` (steps.approver_user), `pk_companies_schedule`,
  `pk_cash_lock_date(company_id)` in the transfer / cash-entry / opening-balance guards (old function dropped),
  `reminder_runs` PK `(company_id, run_date)`. G1 guards were already switched to memberships in MC1-1.
- App: `currentLockDate(req, companyId)`, `closePeriod/reopenPeriod(…, companyId)` (role in THAT PT), import cut-over
  per PT, reminders write the run of their PT.

### MC1-5 (done)

- `allocateDocNo(req, docType, { companyId, … })` (company required), `loadSequence(req, docType, companyId)`,
  `{COMPANY}` = `companies.shortCode` of the document; every caller passes the document PT (submit, transfer, LPJ,
  cash entry, progress report, addendum). Migration `20260928_000200_mc1_numbering` (counters → company #1, PK
  per PT, monotonic guard freezes the company). `companies.shortCode` immutable once the PT has a counter.

## Migration check (US-MC-19)

Develop-head DB filled by the full integration suite (269 users, 637 requests, 475 cash entries, 346 transfers,
2 050 approvals, 58 519 audit rows) restored as `pk_mig`, `payload migrate` (4 MC1 migrations in one batch):
row counts and money sums of 16 tables identical before/after; 1 company (DRMS), 269 memberships (1 per user),
275 membership roles (= `users_roles`), 108 employee links (= `users.employee_id`), 29 group admins (= Admins);
every per-PT row + 20 counter rows → company #1 (PB counter unchanged). `migrate:down` of the batch → identical to
the pre-migration DB (`users_roles`, `users.employee_id`, global columns restored); `migrate` again → identical.

## `// MC2:` leak points (raw SQL / company-blind paths)

Harmless with one PT (behaviour identical to develop); each leaks across PTs once a 2nd PT is active. All marked
`// MC2:` / `// MC3:` in code (`grep -rn "// MC2" apps/web/src`).

- **Reports / KPI (MC2-2):** `domain/reports/scope.ts` `officeScope` → `all` = SQL `TRUE`, role "any selected PT";
  `domain/reports/kpi.ts` (cashBalances, cashFlowMonthly, accountMonthFlows, cashBreakdown, requestMoney,
  transferQueueSummary, masterGaps, lastClosedPeriod: no scope); `domain/reports/registry.ts`,
  `domain/reports/audit-log.ts` (log + filter options of every PT), `domain/reports/attendance-report.ts`,
  `domain/reports/export.ts` (letterhead of the context PT, group letterhead for >1 PT).
- **Attendance:** `domain/attendance/queries.ts` `AttScope all` = `TRUE`, `domain/attendance/web.ts`; retention
  months/enabled = company #1 (`domain/attendance/retention.ts`).
- **Cash:** `domain/cash/book.ts` (book / balances SQL without company); Kas view lock date = context PT.
- **Reminders / jobs (MC2-3):** `domain/reminders/service.ts` `roleHolders` (holders in any PT), settings + run =
  company #1; `reimburseAutoClose`, `selfieRetention` = company #1.
- **Sync (MC3):** `domain/sync/service.ts` flags of the context PT, no `COMPANY_MISMATCH` (DB triggers still reject
  mixed rows); `domain/sync/attendance.ts` `employeeOfUser` = first membership.
- **Media (MC2/MC3):** `collections/media/index.ts` office roles read media of every PT; `api/v1/endpoints/media.ts`
  owner-document check without company.
- **Settings without a document:** `domain/companies.ts` `contextCompanyId` (caller's only PT, else company #1) —
  `settings(req)` callers in admin views, `/me`, `/app/config`, masters radius, queues (budget warn %).
- **Display names:** `displayNames` / PDF "Dibuat Oleh" = employee of the FIRST membership.
- **Role checks "any selected PT" (`hasRoleAny`, ~90 call sites):** admin views, `/api/v1` `roles` option, list
  endpoints — rows stay filtered per PT by access control, but UI hints / some list shortcuts are PT-blind.
- **Notification templates / devices / users:** templates editable by an Admin of any PT (inventory: group admin).

## Open TODOs / notes for the next agent

- MC2: PT switcher (sets `pk-company-ids`), role matrix UI, PT column/filter in lists, import `kode_pt`,
  per-company `ReportScope`, jobs loop, `activeUsersWithRole` etc. already per PT.
- MC3: `/me` `companies[]`, `X-Company-Ids` in OpenAPI, per-route company re-check, `COMPANY_MISMATCH`.
- Infra: realm role `pk-user` (`drms`, `drms-staging`), assign to every ProyekKas user; afterwards remove the
  transition in `auth/strategies.ts` `tokenAllowsLogin` (legacy `pk-*` marker) and the `pk-staff` fallback in
  `domain/users-sync.ts` `grantLoginRole`.
