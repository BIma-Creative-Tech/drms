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
| MC1-1 collections, global shrink, users | done | (this commit) | unit 518/518, integration all 33 files green (C1 full run + reruns) |
| MC1-2 company column + access per PT | done | (commit 2) | incl. MC1-3 remainder (selection, per-PT decision guards); integration 33 files / 437 + 1 skipped green |
| MC1-3 access helpers + auth | done | commits 1 + 2 | split: context/auth in MC1-1, per-PT policies/guards in MC1-2 |
| MC1-4 security migration (triggers, lock date, NOT NULL) | open | — | |
| MC1-5 numbering per PT | open | — | |
| MC1-6 isolation tests + seed shapes | open | — | |

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

## `// MC2:` leak points (raw SQL / company-blind paths)

- `domain/reminders/service.ts` `roleHolders` (holders in any PT), reminder settings = company #1.
- `domain/attendance/retention.ts` retention months/enabled = company #1.
- `domain/reports/attendance-report.ts`, `domain/reports/export.ts` settings / letterhead of the context PT.
- `domain/companies.ts` `contextCompanyId` (settings without a document), `displayNames` (first membership).
